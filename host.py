import asyncio
import concurrent.futures
import fractions
import json
import os
import platform
import re
import socket
import subprocess
import time
import uuid
from datetime import datetime

import av
import cv2
import dxcam
import numpy as np
import pydirectinput
import websockets
import win32gui
import win32process
from aiortc import (
    RTCConfiguration,
    RTCIceServer,
    RTCPeerConnection,
    RTCSessionDescription,
    VideoStreamTrack,
)
from aiortc.exceptions import InvalidStateError as AiortcInvalidStateError
from aiortc.mediastreams import VIDEO_CLOCK_RATE, VIDEO_TIME_BASE
from aiortc.codecs import h264 as aiortc_h264
from aiortc.codecs import vpx as aiortc_vpx
from aiortc.sdp import candidate_from_sdp
from av import VideoFrame


# ========== Device Identity ==========

def get_device_id():
    """Read or create a persistent host identity."""
    config_file = 'device_config.json'

    if os.path.exists(config_file):
        try:
            with open(config_file, 'r', encoding='utf-8') as f:
                config = json.load(f)
                device_id = config.get('device_id')
                device_name = config.get('device_name')
                if device_id and device_name:
                    return device_id, device_name
        except Exception:
            pass

    device_id = str(uuid.uuid4())

    try:
        hostname = socket.gethostname() or 'CloudHost'
    except Exception:
        hostname = 'CloudHost'

    device_name = f"{hostname} ({platform.system()})"

    try:
        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(
                {
                    'device_id': device_id,
                    'device_name': device_name,
                    'created_at': datetime.now().isoformat(),
                    'hostname': hostname,
                    'platform': platform.system(),
                },
                f,
                ensure_ascii=False,
                indent=2,
            )
    except Exception as e:
        print(f'Failed to write {config_file}: {e}', flush=True)

    return device_id, device_name


# ========== Runtime Config ==========

pydirectinput.FAILSAFE = False
pydirectinput.PAUSE = 0

# Keep frame capture isolated so app launching cannot starve media frames.
capture_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix='capture')
app_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix='app')
input_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix='input')

SIGNALING_SERVER_IP = os.getenv('SIGNALING_SERVER_IP', '146.56.217.146')
SIGNALING_SERVER_PORT = os.getenv('SIGNALING_SERVER_PORT', '3000')
SIGNALING_SERVER_URL = os.getenv('SIGNALING_SERVER_URL', '').strip()
SIGNALING_SERVER_SCHEME = os.getenv('SIGNALING_SERVER_SCHEME', 'ws').strip().lower()
TURN_SERVER_IP = os.getenv('TURN_SERVER_IP', SIGNALING_SERVER_IP)
TURN_SERVER_PORT = os.getenv('TURN_SERVER_PORT', '3478')
TURN_USERNAME = os.getenv('TURN_USERNAME', 'cloudplay')
TURN_CREDENTIAL = os.getenv('TURN_CREDENTIAL', 'cloudplaypassword')
TURN_TRANSPORT = os.getenv('TURN_TRANSPORT', 'all').strip().lower()
FORCE_H264 = os.getenv('FORCE_H264', '1').strip() == '1'
ENABLE_QUALITY_RENEGOTIATION = os.getenv('ENABLE_QUALITY_RENEGOTIATION', '0').strip() == '1'
DISABLE_GOOG_REMB = os.getenv('DISABLE_GOOG_REMB', '1').strip() == '1'
ENCODER_DEFAULT_BITRATE_BPS = int(os.getenv('ENCODER_DEFAULT_BITRATE_BPS', '12000000'))
ENCODER_MIN_BITRATE_BPS = int(os.getenv('ENCODER_MIN_BITRATE_BPS', '6000000'))
ENCODER_MAX_BITRATE_BPS = int(os.getenv('ENCODER_MAX_BITRATE_BPS', '30000000'))
ENCODER_STRICT_BITRATE_FLOOR = os.getenv('ENCODER_STRICT_BITRATE_FLOOR', '1').strip() == '1'
VIDEO_ENCODER = os.getenv('VIDEO_ENCODER', 'auto').strip().lower()
X264_PRESET = os.getenv('X264_PRESET', 'veryfast').strip()
APP_STARTUP_GRACE_SECONDS = float(os.getenv('APP_STARTUP_GRACE_SECONDS', '3.0'))

current_app_process = None
current_app_hwnd = None
last_valid_frame = None


def create_camera():
    try:
        cam = dxcam.create(output_color='BGR', max_buffer_len=2)
        print('DXCAM initialized', flush=True)
        return cam
    except Exception as e:
        print(f'DXCAM init failed: {e}', flush=True)
        return None


camera = create_camera()


def build_signaling_candidates():
    """Build signaling websocket URL candidates from env config."""
    host = (SIGNALING_SERVER_IP or '').strip()
    port = (SIGNALING_SERVER_PORT or '').strip()
    scheme = SIGNALING_SERVER_SCHEME if SIGNALING_SERVER_SCHEME in ('ws', 'wss') else 'ws'

    candidates = []
    if SIGNALING_SERVER_URL:
        candidates.append(SIGNALING_SERVER_URL.rstrip('/'))

    if host:
        if port:
            candidates.append(f'{scheme}://{host}:{port}/signaling')
            if port == '3000':
                candidates.append(f'ws://{host}:{port}/signaling')
            if port == '443':
                candidates.append(f'wss://{host}:{port}/signaling')
        candidates.append(f'ws://{host}/signaling')
        candidates.append(f'wss://{host}/signaling')

    # Preserve order while de-duplicating.
    unique = []
    for url in candidates:
        if url and url not in unique:
            unique.append(url)
    return unique


class CaptureConfig:
    """Streaming presets."""

    GAMING_MODE = {
        'fps': 60,
        'resolution': (1920, 1080),
        'max_bitrate': 30000,
        'min_bitrate': 12000,
        'max_quantization': 18,
    }

    LOW_LATENCY_MODE = {
        'fps': 60,
        'resolution': (1280, 720),
        'max_bitrate': 12000,
        'min_bitrate': 5000,
        'max_quantization': 26,
        'disable_nack': True,
    }

    CURRENT = GAMING_MODE


def patch_aiortc_codec_limits():
    """
    aiortc defaults are tuned for low bitrate + 30fps:
    - H264 MAX_BITRATE = 3 Mbps, MAX_FRAME_RATE = 30
    - VP8  MAX_BITRATE = 1.5 Mbps, MAX_FRAME_RATE = 30
    This causes 1080p mode to look blurry and capped around 3~4 Mbps.
    Raise these limits for cloud-gaming workloads.
    """
    try:
        floor_default = max(1_000_000, ENCODER_DEFAULT_BITRATE_BPS)
        floor_min = max(500_000, min(ENCODER_MIN_BITRATE_BPS, floor_default))
        floor_max = max(floor_default, ENCODER_MAX_BITRATE_BPS)

        aiortc_h264.DEFAULT_BITRATE = floor_default
        aiortc_h264.MIN_BITRATE = floor_min
        aiortc_h264.MAX_BITRATE = floor_max
        aiortc_h264.MAX_FRAME_RATE = 60

        aiortc_vpx.DEFAULT_BITRATE = max(1_000_000, floor_default // 2)
        aiortc_vpx.MIN_BITRATE = max(400_000, floor_min // 2)
        aiortc_vpx.MAX_BITRATE = max(aiortc_vpx.DEFAULT_BITRATE, floor_max)
        aiortc_vpx.MAX_FRAME_RATE = 60

        print(
            'Patched aiortc codec limits: '
            f'H264(max={aiortc_h264.MAX_BITRATE}, fps={aiortc_h264.MAX_FRAME_RATE}), '
            f'VP8(max={aiortc_vpx.MAX_BITRATE}, fps={aiortc_vpx.MAX_FRAME_RATE})',
            flush=True,
        )
    except Exception as e:
        print(f'Failed to patch aiortc codec limits: {e}', flush=True)


def _detect_h264_encoder_backend():
    if VIDEO_ENCODER in {'libx264', 'x264'}:
        return 'libx264'
    if VIDEO_ENCODER in {'h264_nvenc', 'nvenc'}:
        return 'h264_nvenc'

    # auto mode: prefer NVENC if available.
    try:
        test_codec = av.CodecContext.create('h264_nvenc', 'w')
        del test_codec
        return 'h264_nvenc'
    except Exception:
        return 'libx264'


def patch_h264_encoder_backend():
    backend = _detect_h264_encoder_backend()
    original_method = aiortc_h264.H264Encoder._encode_frame

    def compute_effective_bitrate(target_bitrate):
        profile_min = int(CaptureConfig.CURRENT.get('min_bitrate', 4000) * 1000)
        profile_max = int(CaptureConfig.CURRENT.get('max_bitrate', 12000) * 1000)
        min_cap = max(ENCODER_MIN_BITRATE_BPS, profile_min)
        max_cap = max(min_cap, min(ENCODER_MAX_BITRATE_BPS, profile_max))
        if ENCODER_STRICT_BITRATE_FLOOR:
            floor = min_cap
        else:
            floor = max(1_500_000, min_cap // 2)
        return max(floor, min(int(target_bitrate), max_cap)), min_cap, max_cap

    def patched_encode_frame(self, frame, force_keyframe):
        target_bitrate = int(getattr(self, 'target_bitrate', ENCODER_DEFAULT_BITRATE_BPS) or ENCODER_DEFAULT_BITRATE_BPS)
        effective_bitrate, bitrate_floor, bitrate_ceiling = compute_effective_bitrate(target_bitrate)

        if self.codec and (
            frame.width != self.codec.width
            or frame.height != self.codec.height
            or abs(effective_bitrate - self.codec.bit_rate) / max(1, self.codec.bit_rate) > 0.15
        ):
            self.buffer_data = b''
            self.buffer_pts = None
            self.codec = None

        if force_keyframe:
            frame.pict_type = av.video.frame.PictureType.I
        else:
            frame.pict_type = av.video.frame.PictureType.NONE

        if self.codec is None:
            codec_name = backend
            try:
                self.codec = av.CodecContext.create(codec_name, 'w')
            except Exception:
                codec_name = 'libx264'
                self.codec = av.CodecContext.create(codec_name, 'w')

            self.codec.width = frame.width
            self.codec.height = frame.height
            self.codec.bit_rate = effective_bitrate
            self.codec.pix_fmt = 'yuv420p'
            self.codec.framerate = fractions.Fraction(aiortc_h264.MAX_FRAME_RATE, 1)
            self.codec.time_base = fractions.Fraction(1, aiortc_h264.MAX_FRAME_RATE)
            try:
                self.codec.thread_count = max(2, (os.cpu_count() or 4) // 2)
            except Exception:
                pass

            if codec_name == 'h264_nvenc':
                # OBS-like low-latency hardware profile.
                self.codec.options = {
                    'preset': 'p5',
                    'tune': 'll',
                    'rc': 'cbr',
                    'zerolatency': '1',
                    'g': '120',
                    'bf': '0',
                    'rc-lookahead': '0',
                    'b': str(effective_bitrate),
                    'maxrate': str(bitrate_ceiling),
                    'minrate': str(bitrate_floor),
                    'bufsize': str(max(bitrate_floor, bitrate_ceiling // 2)),
                }
            else:
                # Faster x264 preset to avoid CPU bottleneck dropping to ~20 FPS in-game.
                vbv_maxrate = max(1000, bitrate_ceiling // 1000)
                vbv_bufsize = max(vbv_maxrate, bitrate_floor // 1000)
                self.codec.options = {
                    'level': '42',
                    'tune': 'zerolatency',
                    'preset': X264_PRESET,
                    'x264-params': (
                        f'keyint=120:min-keyint=120:scenecut=0:bframes=0:'
                        f'vbv-maxrate={vbv_maxrate}:vbv-bufsize={vbv_bufsize}:'
                        'nal-hrd=cbr:force-cfr=1'
                    ),
                }
                self.codec.profile = 'high'
        else:
            # Keep bitrate aligned with active quality profile, even when GCC drops too aggressively.
            try:
                self.codec.bit_rate = effective_bitrate
            except Exception:
                pass

        data_to_send = b''
        for package in self.codec.encode(frame):
            data_to_send += bytes(package)

        if data_to_send:
            yield from self._split_bitstream(data_to_send)

    aiortc_h264.H264Encoder._encode_frame = patched_encode_frame
    return backend, original_method


patch_aiortc_codec_limits()
encoder_backend, _ = patch_h264_encoder_backend()
print(
    (
        f'Host TURN settings: server={TURN_SERVER_IP}:{TURN_SERVER_PORT}, '
        f'transport={TURN_TRANSPORT}, force_h264={FORCE_H264}, '
        f'quality_renegotiation={ENABLE_QUALITY_RENEGOTIATION}, '
        f'disable_remb={DISABLE_GOOG_REMB}, h264_backend={encoder_backend}, '
        f'x264_preset={X264_PRESET}, strict_floor={ENCODER_STRICT_BITRATE_FLOOR}'
    ),
    flush=True,
)


def build_turn_urls():
    udp = f'turn:{TURN_SERVER_IP}:{TURN_SERVER_PORT}?transport=udp'
    tcp = f'turn:{TURN_SERVER_IP}:{TURN_SERVER_PORT}?transport=tcp'
    if TURN_TRANSPORT == 'udp':
        return [udp]
    if TURN_TRANSPORT == 'tcp':
        return [tcp]
    return [udp, tcp]


# ========== Capture Helpers ==========

def get_window_rect_safe(hwnd):
    """Get visible window bounds, fallback to GetWindowRect."""
    try:
        import ctypes
        from ctypes import wintypes

        dwmapi = ctypes.windll.dwmapi
        rect = wintypes.RECT()
        DWMWA_EXTENDED_FRAME_BOUNDS = 9
        dwmapi.DwmGetWindowAttribute(
            wintypes.HWND(hwnd),
            wintypes.DWORD(DWMWA_EXTENDED_FRAME_BOUNDS),
            ctypes.byref(rect),
            ctypes.sizeof(rect),
        )
        return rect.left, rect.top, rect.right, rect.bottom
    except Exception:
        try:
            return win32gui.GetWindowRect(hwnd)
        except Exception:
            return None


def find_window_by_pid(pid):
    """Find best visible window for a process ID."""
    result = []

    def callback(hwnd, _):
        try:
            if not win32gui.IsWindowVisible(hwnd):
                return True

            _, found_pid = win32process.GetWindowThreadProcessId(hwnd)
            if found_pid != pid:
                return True

            title = win32gui.GetWindowText(hwnd)
            class_name = win32gui.GetClassName(hwnd)
            if not title and class_name not in {
                'ApplicationFrameWindow',
                'Chrome_WidgetWin_1',
                'Qt5QWindowIcon',
                'UnityWndClass',
            }:
                return True

            left, top, right, bottom = win32gui.GetWindowRect(hwnd)
            width = right - left
            height = bottom - top
            if width > 120 and height > 120:
                result.append((hwnd, width * height))
        except Exception:
            pass
        return True

    win32gui.EnumWindows(callback, None)

    if not result:
        return None

    result.sort(key=lambda x: x[1], reverse=True)
    return result[0][0]


def find_window_by_title(title_keyword):
    """Find window handle by title keyword."""
    found = []

    def callback(hwnd, _):
        try:
            if win32gui.IsWindowVisible(hwnd):
                title = win32gui.GetWindowText(hwnd)
                if title_keyword.lower() in title.lower():
                    found.append(hwnd)
        except Exception:
            pass
        return True

    win32gui.EnumWindows(callback, None)
    return found[0] if found else None


def grab_and_process_image(_monitor_index):
    """Capture app window or full screen and fit to target resolution."""
    global camera, current_app_hwnd, last_valid_frame

    if camera is None:
        camera = create_camera()

    if camera is None:
        if last_valid_frame is not None:
            return last_valid_frame
        w, h = CaptureConfig.CURRENT['resolution']
        return np.zeros((h, w, 3), dtype=np.uint8)

    region = None
    is_window_capture = False

    if current_app_hwnd and win32gui.IsWindow(current_app_hwnd):
        rect = get_window_rect_safe(current_app_hwnd)
        if rect:
            left, top, right, bottom = rect
            width = right - left
            height = bottom - top
            if width >= 200 and height >= 200:
                region = rect
                is_window_capture = True

    img = None
    try:
        if region:
            img = camera.grab(region=region)
            if img is None:
                img = camera.grab()
                is_window_capture = False
        else:
            img = camera.grab()
    except Exception:
        camera = create_camera()
        if camera:
            try:
                img = camera.grab()
                is_window_capture = False
            except Exception:
                img = None

    if img is None:
        if last_valid_frame is not None:
            return last_valid_frame
        w, h = CaptureConfig.CURRENT['resolution']
        return np.zeros((h, w, 3), dtype=np.uint8)

    target_w, target_h = CaptureConfig.CURRENT['resolution']
    src_h, src_w = img.shape[:2]

    if is_window_capture:
        if src_w != target_w or src_h != target_h:
            scale = min(target_w / max(1, src_w), target_h / max(1, src_h))
            new_w = max(1, int(src_w * scale))
            new_h = max(1, int(src_h * scale))

            if new_w != src_w or new_h != src_h:
                interpolation = cv2.INTER_LINEAR if scale >= 1 else cv2.INTER_AREA
                resized = cv2.resize(img, (new_w, new_h), interpolation=interpolation)
            else:
                resized = img

            if new_w == target_w and new_h == target_h:
                img = resized
            else:
                result = np.zeros((target_h, target_w, 3), dtype=np.uint8)
                x_offset = (target_w - new_w) // 2
                y_offset = (target_h - new_h) // 2
                result[y_offset:y_offset + new_h, x_offset:x_offset + new_w] = resized
                img = result
    elif src_w != target_w or src_h != target_h:
        interpolation = cv2.INTER_AREA if (src_w > target_w or src_h > target_h) else cv2.INTER_LINEAR
        img = cv2.resize(img, (target_w, target_h), interpolation=interpolation)

    # Keep a fallback frame reference without extra copy to reduce CPU overhead.
    last_valid_frame = img
    return img


# ========== Input ==========

def execute_input(action, *args):
    """Execute low-latency input actions on the host machine."""
    try:
        if action == 'mousemove':
            x_ratio = float(args[0])
            y_ratio = float(args[1])

            if current_app_hwnd and win32gui.IsWindow(current_app_hwnd):
                rect = get_window_rect_safe(current_app_hwnd)
                if rect:
                    left, top, right, bottom = rect
                    width = max(1, right - left)
                    height = max(1, bottom - top)
                    target_x = left + int(x_ratio * width)
                    target_y = top + int(y_ratio * height)
                    target_x = max(left, min(target_x, right - 1))
                    target_y = max(top, min(target_y, bottom - 1))
                    pydirectinput.moveTo(target_x, target_y)
                    return

            screen_w, screen_h = pydirectinput.size()
            target_x = max(0, min(int(x_ratio * screen_w), screen_w - 1))
            target_y = max(0, min(int(y_ratio * screen_h), screen_h - 1))
            pydirectinput.moveTo(target_x, target_y)

        elif action == 'keydown':
            pydirectinput.keyDown(str(args[0]))

        elif action == 'keyup':
            pydirectinput.keyUp(str(args[0]))

        elif action == 'mousedown':
            pydirectinput.mouseDown(button=str(args[0]))

        elif action == 'mouseup':
            pydirectinput.mouseUp(button=str(args[0]))

        elif action == 'wheel':
            delta = int(args[0])
            pydirectinput.scroll(-120 * delta)

    except Exception:
        pass


KEY_MAP = {
    'arrowup': 'up', 'arrowdown': 'down', 'arrowleft': 'left', 'arrowright': 'right',
    'escape': 'esc', 'esc': 'esc', ' ': 'space', 'spacebar': 'space',
    'control': 'ctrl', 'ctrl': 'ctrl', 'alt': 'alt', 'altgraph': 'alt',
    'shift': 'shift', 'meta': 'win', 'os': 'win',
    'enter': 'enter', 'backspace': 'backspace', 'tab': 'tab', 'delete': 'delete',
    'home': 'home', 'end': 'end', 'pageup': 'pgup', 'pagedown': 'pgdn',
    'capslock': 'capslock', 'numlock': 'numlock', 'scrolllock': 'scrolllock',
    'insert': 'insert', 'pause': 'pause', 'printscreen': 'printscreen',
    'contextmenu': 'apps',
    **{f'f{i}': f'f{i}' for i in range(1, 13)},
}

CODE_MAP = {
    **{f'Key{c}': c.lower() for c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'},
    **{f'Digit{i}': str(i) for i in range(10)},
    **{f'Numpad{i}': f'num{i}' for i in range(10)},
    'Minus': '-', 'Equal': '=',
    'BracketLeft': '[', 'BracketRight': ']',
    'Backslash': '\\', 'Semicolon': ';', 'Quote': "'",
    'Comma': ',', 'Period': '.', 'Slash': '/', 'Backquote': '`',
    'Space': 'space', 'Tab': 'tab', 'Enter': 'enter', 'NumpadEnter': 'enter',
    'Escape': 'esc', 'Backspace': 'backspace', 'Delete': 'delete', 'Insert': 'insert',
    'Home': 'home', 'End': 'end', 'PageUp': 'pgup', 'PageDown': 'pgdn',
    'ArrowUp': 'up', 'ArrowDown': 'down', 'ArrowLeft': 'left', 'ArrowRight': 'right',
    'ShiftLeft': 'shift', 'ShiftRight': 'shift',
    'ControlLeft': 'ctrl', 'ControlRight': 'ctrl',
    'AltLeft': 'alt', 'AltRight': 'alt',
    'MetaLeft': 'win', 'MetaRight': 'win',
    'NumpadAdd': 'add', 'NumpadSubtract': 'subtract',
    'NumpadMultiply': 'multiply', 'NumpadDivide': 'divide', 'NumpadDecimal': 'decimal',
}


def normalize_keyboard_key(raw_key, raw_code):
    key = KEY_MAP.get(raw_key, raw_key)

    if raw_code in CODE_MAP:
        if raw_code.startswith('Key') or raw_code.startswith('Digit') or raw_code.startswith('Numpad'):
            key = CODE_MAP[raw_code]
        elif raw_key in ('', 'dead', 'process', 'unidentified'):
            key = CODE_MAP[raw_code]

    return key


APP_PATHS = {
    'terraria': r'C:\Program Files (x86)\Steam\steamapps\common\Terraria\Terraria.exe',
    'unity': r'C:\Program Files\Unity\Hub\Editor\2022.3.0f1\Editor\Unity.exe',
    'blender': r'C:\Program Files\Blender Foundation\Blender 3.6\blender.exe',
    'custom': r'C:\YourApp\app.exe',
}


def _extract_steam_game_context(app_path):
    lower = app_path.lower()
    marker = '\\steamapps\\common\\'
    idx = lower.find(marker)
    if idx < 0:
        return None

    steam_root = app_path[:idx]
    steamapps_dir = os.path.join(steam_root, 'steamapps')
    common_dir = os.path.join(steamapps_dir, 'common')

    try:
        rel = os.path.relpath(os.path.dirname(app_path), common_dir)
    except Exception:
        return None

    install_dir = rel.split(os.sep)[0] if rel and rel != '.' else ''
    if not install_dir:
        return None

    return {
        'steam_root': steam_root,
        'steamapps_dir': steamapps_dir,
        'install_dir': install_dir,
    }


def _find_steam_appid_by_install_dir(steamapps_dir, install_dir):
    if not os.path.isdir(steamapps_dir):
        return None

    try:
        manifests = [f for f in os.listdir(steamapps_dir) if f.startswith('appmanifest_') and f.endswith('.acf')]
    except Exception:
        return None

    target = install_dir.lower()
    for manifest in manifests:
        path = os.path.join(steamapps_dir, manifest)
        try:
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
        except Exception:
            continue

        appid_match = re.search(r'"appid"\s*"(\d+)"', content)
        dir_match = re.search(r'"installdir"\s*"([^"]+)"', content, re.IGNORECASE)
        if not appid_match or not dir_match:
            continue

        manifest_dir = dir_match.group(1).strip().lower()
        if manifest_dir == target:
            return appid_match.group(1)

    return None


def _launch_steam_game(app_path, app_id):
    context = _extract_steam_game_context(app_path)
    if not context:
        return False, None

    steam_exe = os.path.join(context['steam_root'], 'steam.exe')
    if not os.path.exists(steam_exe):
        return False, None

    appid = _find_steam_appid_by_install_dir(context['steamapps_dir'], context['install_dir'])
    if not appid:
        return False, None

    # Steam-managed games (e.g. Forza Horizon 4) are more stable via appid launch.
    subprocess.Popen([steam_exe, '-applaunch', appid], cwd=context['steam_root'])
    print(f'Steam launch requested: appid={appid}, install_dir={context["install_dir"]}', flush=True)

    window_keywords = [context['install_dir'], os.path.splitext(os.path.basename(app_path))[0]]
    if app_id == 'game1':
        window_keywords.extend(['Forza Horizon', 'ForzaHorizon'])
    return True, window_keywords


def launch_application(app_id, app_path=None):
    """Launch target app and lock capture to its main window when possible."""
    global current_app_process, current_app_hwnd

    try:
        if app_id in ('desktop', 'fullscreen'):
            print('Switch to desktop capture mode', flush=True)
            current_app_hwnd = None
            current_app_process = None
            return True

        if not app_path:
            app_path = APP_PATHS.get(app_id)

        if not app_path:
            print(f'Unknown app id: {app_id}', flush=True)
            return False

        app_path = os.path.normpath(app_path)

        if os.path.isdir(app_path):
            print(f'Path is a directory, not executable: {app_path}', flush=True)
            return False

        if not os.path.exists(app_path):
            print(f'App path does not exist: {app_path}', flush=True)
            return False

        app_dir = os.path.dirname(app_path) or None
        current_app_hwnd = None
        current_app_process = None
        launch_notes = []
        window_keywords = [os.path.splitext(os.path.basename(app_path))[0]]
        launched = False
        launched_via_steam = False

        # Prefer Steam appid launch for Steam games to avoid direct exe flash exit.
        steam_launched, steam_keywords = _launch_steam_game(app_path, app_id)
        if steam_launched:
            launched = True
            launched_via_steam = True
            if steam_keywords:
                window_keywords.extend(steam_keywords)
        else:
            # Primary launch: run from the app's own directory (many games require this).
            try:
                current_app_process = subprocess.Popen([app_path], cwd=app_dir)
                launched = True
                print(f'App started (PID: {current_app_process.pid})', flush=True)
            except Exception as e:
                launch_notes.append(f'Popen failed: {e}')

        # Detect immediate exit ("flash crash") and fallback to shell start.
        if current_app_process:
            time.sleep(min(APP_STARTUP_GRACE_SECONDS, 1.0))
            if current_app_process.poll() is not None:
                launch_notes.append(f'process exited early with code {current_app_process.returncode}')
                current_app_process = None

        if (not launched) or (current_app_process is None and not launched_via_steam):
            try:
                os.startfile(app_path)
                launched = True
                print('App started via os.startfile fallback (PID unknown)', flush=True)
            except Exception as e:
                launch_notes.append(f'os.startfile failed: {e}')

        if not launched and launch_notes:
            print(f'Launch failed: {" | ".join(launch_notes)}', flush=True)
            return False

        max_attempts = 100
        for i in range(max_attempts):
            time.sleep(0.1)

            if current_app_process and current_app_process.poll() is not None:
                print(f'App exited during startup, code={current_app_process.returncode}', flush=True)
                return False

            hwnd = None
            if current_app_process:
                hwnd = find_window_by_pid(current_app_process.pid)
            else:
                # Fallback launch path has no PID. Try title-based probing.
                for keyword in window_keywords:
                    if keyword:
                        hwnd = find_window_by_title(keyword)
                        if hwnd:
                            break

            if hwnd:
                current_app_hwnd = hwnd
                try:
                    win32gui.SetForegroundWindow(hwnd)
                except Exception:
                    pass
                return True

            if i % 10 == 0 and i > 0:
                print(f'  still searching... ({i / 10:.1f}s)', flush=True)

        current_app_hwnd = None
        if launch_notes:
            print(f'Launch notes: {" | ".join(launch_notes)}', flush=True)
        print('App window not found, fallback to full-screen capture', flush=True)
        return True
    except Exception as e:
        print(f'Launch failed: {e}', flush=True)
        return False


def stop_current_application():
    """Stop current running application process if it exists."""
    global current_app_process, current_app_hwnd

    try:
        if current_app_process:
            current_app_process.terminate()
            try:
                current_app_process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                current_app_process.kill()

        current_app_process = None
        current_app_hwnd = None
        return True
    except Exception as e:
        print(f'Stop app failed: {e}', flush=True)
        return False


def execute_command(command, params=None):
    """Execute predefined host commands."""
    try:
        if command == 'reset_view':
            pydirectinput.press('home')

        elif command == 'save_scene':
            pydirectinput.keyDown('ctrl')
            pydirectinput.press('s')
            pydirectinput.keyUp('ctrl')

        elif command == 'screenshot':
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            screenshot_path = f'screenshot_{timestamp}.png'
            if camera is not None:
                img = camera.grab()
                if img is not None:
                    cv2.imwrite(screenshot_path, img)
                    print(f'Screenshot saved: {screenshot_path}', flush=True)

        elif command == 'toggle_pause':
            pydirectinput.press('space')

        elif command == 'fullscreen':
            pydirectinput.keyDown('alt')
            pydirectinput.press('enter')
            pydirectinput.keyUp('alt')

        elif command == 'exit_app':
            pydirectinput.keyDown('alt')
            pydirectinput.press('f4')
            pydirectinput.keyUp('alt')

    except Exception as e:
        print(f'Command execution failed: {e}', flush=True)


def handle_input_data(data):
    """Route data-channel input events to host input executor."""
    action = data.get('action')
    loop = asyncio.get_event_loop()

    if action in ['keydown', 'keyup']:
        raw_key = str(data.get('key', '')).lower()
        raw_code = str(data.get('code', ''))
        key = normalize_keyboard_key(raw_key, raw_code)
        if key:
            loop.run_in_executor(input_executor, execute_input, action, key)

    elif action in ['mousedown', 'mouseup']:
        button_code = data.get('button')
        if button_code not in (0, 2):
            return
        button = 'left' if button_code == 0 else 'right'
        loop.run_in_executor(input_executor, execute_input, action, button)

    elif action == 'mousemove':
        x_ratio = data.get('x')
        y_ratio = data.get('y')
        loop.run_in_executor(input_executor, execute_input, action, x_ratio, y_ratio)

    elif action == 'wheel':
        delta = data.get('delta', 0)
        loop.run_in_executor(input_executor, execute_input, action, delta)


def handle_asyncio_exception(loop, context):
    """Ignore harmless aioice state errors."""
    exc = context.get('exception')
    if isinstance(exc, asyncio.InvalidStateError):
        return
    if isinstance(exc, AiortcInvalidStateError) and 'RTCIceTransport is closed' in str(exc):
        return
    loop.default_exception_handler(context)


# ========== SDP ==========

def optimize_sdp(sdp_string):
    """Tune SDP based on current quality profile."""
    config = CaptureConfig.CURRENT
    sdp_lines = sdp_string.split('\r\n')

    payload_codec = {}
    rtx_apt = {}
    for line in sdp_lines:
        if line.startswith('a=rtpmap:'):
            try:
                header, codec_desc = line.split(' ', 1)
                payload = header.split(':', 1)[1]
                codec = codec_desc.split('/', 1)[0].upper()
                payload_codec[payload] = codec
            except Exception:
                pass
        elif line.startswith('a=fmtp:') and ' apt=' in line:
            try:
                left, right = line.split(' ', 1)
                payload = left.split(':', 1)[1]
                for part in right.split(';'):
                    part = part.strip()
                    if part.startswith('apt='):
                        rtx_apt[payload] = part.split('=', 1)[1].strip()
                        break
            except Exception:
                pass

    allowed_payloads = set()
    if FORCE_H264:
        h264_payloads = [p for p, codec in payload_codec.items() if codec == 'H264']
        if h264_payloads:
            allowed_payloads.update(h264_payloads)
            allowed_payloads.update(
                p for p, apt_payload in rtx_apt.items() if apt_payload in allowed_payloads
            )

    def get_attr_payload(line):
        if not line.startswith('a='):
            return None
        if not (line.startswith('a=rtpmap:') or line.startswith('a=fmtp:') or line.startswith('a=rtcp-fb:')):
            return None
        try:
            return line.split(':', 1)[1].split(' ', 1)[0]
        except Exception:
            return None

    def sort_video_payloads(payloads):
        h264_primary = [p for p in payloads if payload_codec.get(p) == 'H264']
        h264_primary_set = set(h264_primary)
        h264_rtx = [p for p in payloads if rtx_apt.get(p) in h264_primary_set]
        others = [p for p in payloads if p not in h264_primary_set and p not in h264_rtx]
        return h264_primary + h264_rtx + others

    new_lines = []
    video_payloads = []
    fmtp_patched_payloads = set()

    def build_fmtp(existing):
        params = [p.strip() for p in existing.split(';') if p.strip()] if existing else []
        params.extend([
            f"x-google-max-bitrate={config['max_bitrate']}",
            f"x-google-min-bitrate={config['min_bitrate']}",
            f"x-google-start-bitrate={(config['max_bitrate'] + config['min_bitrate']) // 2}",
            f"x-google-max-quantization={config['max_quantization']}",
            'x-google-min-quantization=20',
        ])
        return ';'.join(params)

    for line in sdp_lines:
        if config.get('disable_nack', False):
            if 'rtcp-fb' in line and 'nack' in line and 'pli' not in line:
                continue
        if DISABLE_GOOG_REMB and line.startswith('a=rtcp-fb:') and 'goog-remb' in line:
            continue

        if line.startswith('a=rtpmap:'):
            try:
                header, codec_desc = line.split(' ', 1)
                payload = header.split(':', 1)[1]
                codec = codec_desc.split('/', 1)[0].upper()
                if codec in {'VP8', 'VP9', 'H264', 'AV1', 'AV1X'}:
                    video_payloads.append(payload)
            except Exception:
                pass

        if line.startswith('m=video'):
            parts = line.split(' ')
            header = parts[:3]
            payloads = parts[3:]
            if allowed_payloads:
                payloads = [p for p in payloads if p in allowed_payloads]
            payloads = sort_video_payloads(payloads)
            new_lines.append(' '.join(header + payloads))
            new_lines.append(f"b=AS:{config['max_bitrate']}")
            new_lines.append(f"b=TIAS:{config['max_bitrate'] * 1000}")
            continue

        payload_for_filter = get_attr_payload(line)
        if allowed_payloads and payload_for_filter is not None and payload_for_filter not in allowed_payloads:
            continue

        if line.startswith('a=fmtp:'):
            params = line.split(' ', 1)
            payload = params[0].split(':', 1)[1]
            existing = params[1] if len(params) > 1 else ''
            if 'apt=' not in existing:
                new_lines.append(f"a=fmtp:{payload} {build_fmtp(existing)}")
                fmtp_patched_payloads.add(payload)
                continue

        new_lines.append(line)

    # VP8 often has no default fmtp line; add one so bitrate settings take effect.
    if video_payloads:
        primary_payload = video_payloads[0]
        if primary_payload not in fmtp_patched_payloads:
            for i, line in enumerate(new_lines):
                if line.startswith(f'a=rtpmap:{primary_payload} '):
                    new_lines.insert(i + 1, f"a=fmtp:{primary_payload} {build_fmtp('')}")
                    break

    return '\r\n'.join(new_lines)


# ========== Video Track ==========

class SafeScreenTrack(VideoStreamTrack):
    """Desktop capture track with frame pacing."""

    def __init__(self, target_fps=None):
        super().__init__()
        self.target_fps = target_fps or CaptureConfig.CURRENT['fps']
        self.frame_interval = 1.0 / max(1, self.target_fps)
        self.last_capture_time = time.perf_counter()
        self.frame_count = 0
        self._pts = 0

    async def recv(self):
        now = time.perf_counter()
        elapsed = now - self.last_capture_time
        if elapsed < self.frame_interval:
            await asyncio.sleep(self.frame_interval - elapsed)

        self.last_capture_time = time.perf_counter()
        self.frame_count += 1
        pts_step = max(1, int(VIDEO_CLOCK_RATE / max(1, self.target_fps)))
        self._pts += pts_step

        try:
            loop = asyncio.get_event_loop()
            img_bgr = await loop.run_in_executor(capture_executor, grab_and_process_image, 1)
            frame = VideoFrame.from_ndarray(img_bgr, format='bgr24')
            frame.pts = self._pts
            frame.time_base = VIDEO_TIME_BASE
            return frame
        except Exception:
            w, h = CaptureConfig.CURRENT['resolution']
            img = np.zeros((h, w, 3), dtype=np.uint8)
            frame = VideoFrame.from_ndarray(img, format='bgr24')
            frame.pts = self._pts
            frame.time_base = VIDEO_TIME_BASE
            return frame


def _stats_timestamp_to_seconds(value):
    if value is None:
        return None
    try:
        if hasattr(value, 'timestamp'):
            return float(value.timestamp())
        return float(value)
    except Exception:
        return None


async def report_performance(ws, pc, track, host_id, transport_mode='unknown'):
    """Send live performance stats to client so overlay isn't stuck at 0."""
    prev_bytes_sent = None
    prev_timestamp = None
    prev_frames_sent = None
    prev_frame_count = track.frame_count if track else 0
    prev_fps_time = time.perf_counter()

    try:
        while True:
            await asyncio.sleep(1)

            if pc.connectionState in {'failed', 'closed'}:
                break

            try:
                stats = await pc.getStats()
            except Exception:
                continue

            selected_pair = None
            outbound_video = None
            remote_inbound_video = None
            selected_pair_local_type = 'unknown'
            selected_pair_remote_type = 'unknown'
            selected_pair_protocol = 'unknown'
            available_outgoing_kbps = 0

            for stat in stats.values():
                stat_type = getattr(stat, 'type', '')
                kind = getattr(stat, 'kind', '')
                if (
                    stat_type == 'candidate-pair'
                    and getattr(stat, 'state', None) == 'succeeded'
                    and getattr(stat, 'nominated', False)
                ):
                    selected_pair = stat
                elif stat_type == 'outbound-rtp' and kind == 'video':
                    outbound_video = stat
                elif stat_type == 'remote-inbound-rtp' and kind == 'video':
                    remote_inbound_video = stat

            if selected_pair is not None:
                available_outgoing = getattr(selected_pair, 'availableOutgoingBitrate', None)
                if available_outgoing is not None:
                    try:
                        available_outgoing_kbps = int(float(available_outgoing) / 1000)
                    except Exception:
                        available_outgoing_kbps = 0

                local_candidate_id = getattr(selected_pair, 'localCandidateId', None)
                remote_candidate_id = getattr(selected_pair, 'remoteCandidateId', None)
                if local_candidate_id and local_candidate_id in stats:
                    local_candidate = stats[local_candidate_id]
                    selected_pair_local_type = str(getattr(local_candidate, 'candidateType', 'unknown'))
                    selected_pair_protocol = str(getattr(local_candidate, 'protocol', 'unknown'))
                if remote_candidate_id and remote_candidate_id in stats:
                    remote_candidate = stats[remote_candidate_id]
                    selected_pair_remote_type = str(getattr(remote_candidate, 'candidateType', 'unknown'))

            rtt_ms = 0
            pair_rtt = getattr(selected_pair, 'currentRoundTripTime', None) if selected_pair else None
            remote_rtt = getattr(remote_inbound_video, 'roundTripTime', None) if remote_inbound_video else None
            if pair_rtt is not None:
                rtt_ms = int(float(pair_rtt) * 1000)
            elif remote_rtt is not None:
                rtt_ms = int(float(remote_rtt) * 1000)

            packet_loss = 0.0
            if remote_inbound_video:
                fraction_lost = getattr(remote_inbound_video, 'fractionLost', None)
                if fraction_lost is not None:
                    fraction = float(fraction_lost)
                    packet_loss = round(fraction * 100 if fraction <= 1 else fraction, 2)
                else:
                    packets_lost = getattr(remote_inbound_video, 'packetsLost', None)
                    packets_received = getattr(remote_inbound_video, 'packetsReceived', None)
                    if packets_lost is not None and packets_received is not None:
                        total = packets_lost + packets_received
                        if total > 0:
                            packet_loss = round((packets_lost / total) * 100, 2)

            bytes_sent = None
            ts_seconds = None
            if outbound_video is not None:
                bytes_sent = getattr(outbound_video, 'bytesSent', None)
                ts_seconds = _stats_timestamp_to_seconds(getattr(outbound_video, 'timestamp', None))
            elif selected_pair is not None:
                bytes_sent = getattr(selected_pair, 'bytesSent', None)
                ts_seconds = _stats_timestamp_to_seconds(getattr(selected_pair, 'timestamp', None))

            bitrate_kbps = 0
            fps_from_sender = 0.0
            delta_seconds = None
            if (
                bytes_sent is not None
                and ts_seconds is not None
                and prev_bytes_sent is not None
                and prev_timestamp is not None
            ):
                delta_bytes = max(0, int(bytes_sent) - int(prev_bytes_sent))
                delta_seconds = max(1e-3, float(ts_seconds) - float(prev_timestamp))
                bitrate_kbps = int((delta_bytes * 8) / 1000 / delta_seconds)

            if outbound_video is not None and delta_seconds is not None:
                frames_sent = getattr(outbound_video, 'framesSent', None)
                if frames_sent is not None and prev_frames_sent is not None:
                    frame_delta = max(0, int(frames_sent) - int(prev_frames_sent))
                    fps_from_sender = round(frame_delta / max(1e-3, delta_seconds), 1)
                if frames_sent is not None:
                    prev_frames_sent = int(frames_sent)

            if bytes_sent is not None and ts_seconds is not None:
                prev_bytes_sent = bytes_sent
                prev_timestamp = ts_seconds

            fps = fps_from_sender
            if fps <= 0 and track is not None:
                now = time.perf_counter()
                frame_delta = max(0, track.frame_count - prev_frame_count)
                elapsed = max(1e-3, now - prev_fps_time)
                fps = round(frame_delta / elapsed, 1)
                prev_frame_count = track.frame_count
                prev_fps_time = now

            payload = {
                'type': 'performance_stats',
                'hostId': host_id,
                'transportMode': transport_mode,
                'fps': fps,
                'rtt': rtt_ms,
                'latency': rtt_ms,
                'bitrate': bitrate_kbps,
                'packetLoss': packet_loss,
                'availableOutgoingKbps': available_outgoing_kbps,
                'localCandidateType': selected_pair_local_type,
                'remoteCandidateType': selected_pair_remote_type,
                'candidateProtocol': selected_pair_protocol,
            }

            try:
                await ws.send(json.dumps(payload))
            except Exception:
                break
            if bitrate_kbps > 0:
                print(
                    f"[stats] mode={transport_mode} fps={fps} bitrate={bitrate_kbps}kbps "
                    f"avail={available_outgoing_kbps}kbps pair={selected_pair_local_type}->{selected_pair_remote_type}({selected_pair_protocol})",
                    flush=True,
                )
    except asyncio.CancelledError:
        pass


# ========== Main Loop ==========

async def run_host(signaling_url):
    global last_valid_frame

    loop = asyncio.get_event_loop()
    loop.set_exception_handler(handle_asyncio_exception)

    device_id, device_name = get_device_id()
    print(f'Connecting to signaling server: {signaling_url}', flush=True)
    print(f'Device ID: {device_id}', flush=True)
    print(f'Device name: {device_name}', flush=True)

    async with websockets.connect(
        signaling_url,
        ping_interval=20,
        ping_timeout=20,
        open_timeout=8,
        close_timeout=3,
    ) as ws:
        await ws.send(json.dumps({
            'type': 'register_host',
            'hostId': device_id,
            'hostName': device_name,
        }))
        print(f'Host registered: {device_name}', flush=True)

        pc = None
        active_track = None
        current_session_id = None
        stats_task = None
        pending_launch_task = None

        async def launch_in_background(app_id, app_path):
            try:
                await loop.run_in_executor(app_executor, launch_application, app_id, app_path)
            except asyncio.CancelledError:
                pass
            except Exception as e:
                print(f'Background launch failed: {e}', flush=True)

        async for message in ws:
            try:
                data = json.loads(message)
            except Exception as e:
                print(f'Invalid signaling message: {e}', flush=True)
                continue

            msg_type = data.get('type')

            if msg_type == 'launch_app':
                app_id = data.get('appId')
                app_path = data.get('appPath')
                if pending_launch_task and not pending_launch_task.done():
                    pending_launch_task.cancel()
                pending_launch_task = asyncio.create_task(launch_in_background(app_id, app_path))

            elif msg_type == 'stop_app':
                if pending_launch_task and not pending_launch_task.done():
                    pending_launch_task.cancel()
                    pending_launch_task = None
                await loop.run_in_executor(app_executor, stop_current_application)

            elif msg_type == 'command':
                command = data.get('command')
                params = data.get('params')
                await loop.run_in_executor(app_executor, execute_command, command, params)

            elif msg_type == 'offer':
                current_session_id = data.get('sessionId')
                transport_mode = data.get('transportMode', 'auto')
                if stats_task:
                    stats_task.cancel()
                    stats_task = None
                if pc:
                    await pc.close()
                active_track = None

                if transport_mode == 'direct':
                    ice_servers = [
                        RTCIceServer(urls=['stun:stun.l.google.com:19302']),
                        RTCIceServer(urls=['stun:stun1.l.google.com:19302']),
                        RTCIceServer(urls=['stun:stun.qq.com:3478']),
                    ]
                elif transport_mode == 'relay':
                    ice_servers = [
                        RTCIceServer(
                            urls=build_turn_urls(),
                            username=TURN_USERNAME,
                            credential=TURN_CREDENTIAL,
                        ),
                    ]
                else:
                    ice_servers = [
                        RTCIceServer(urls=['stun:stun.l.google.com:19302']),
                        RTCIceServer(urls=['stun:stun1.l.google.com:19302']),
                        RTCIceServer(
                            urls=build_turn_urls(),
                            username=TURN_USERNAME,
                            credential=TURN_CREDENTIAL,
                        ),
                    ]

                pc = RTCPeerConnection(
                    configuration=RTCConfiguration(
                        iceServers=ice_servers
                    )
                )
                print(f'Negotiation transport mode: {transport_mode}', flush=True)

                @pc.on('iceconnectionstatechange')
                async def on_ice_connection_state_change():
                    print(f'ICE state: {pc.iceConnectionState}', flush=True)

                @pc.on('connectionstatechange')
                async def on_connection_state_change():
                    print(f'Peer state: {pc.connectionState}', flush=True)

                @pc.on('datachannel')
                def on_datachannel(channel):
                    print(f'Data channel opened: {channel.label}', flush=True)

                    @channel.on('message')
                    def on_message(raw_message):
                        try:
                            payload = json.loads(raw_message)
                            handle_input_data(payload)
                        except Exception:
                            pass

                active_track = SafeScreenTrack()
                pc.addTrack(active_track)

                remote_offer = data.get('offer') or {}
                sdp = remote_offer.get('sdp')
                typ = remote_offer.get('type')
                if not sdp or not typ:
                    continue

                await pc.setRemoteDescription(RTCSessionDescription(sdp=sdp, type=typ))

                answer = await pc.createAnswer()
                optimized_sdp = optimize_sdp(answer.sdp)
                optimized_answer = RTCSessionDescription(sdp=optimized_sdp, type=answer.type)
                await pc.setLocalDescription(optimized_answer)

                await ws.send(json.dumps({
                    'type': 'answer',
                    'target': 'client',
                    'targetHostId': device_id,
                    'sessionId': current_session_id,
                    'answer': {
                        'sdp': pc.localDescription.sdp,
                        'type': pc.localDescription.type,
                    },
                }))

                print(
                    f"Streaming profile: {CaptureConfig.CURRENT['fps']} FPS, "
                    f"{CaptureConfig.CURRENT['resolution']}, "
                    f"{CaptureConfig.CURRENT['min_bitrate']}-{CaptureConfig.CURRENT['max_bitrate']} kbps",
                    flush=True,
                )
                stats_task = asyncio.create_task(
                    report_performance(ws, pc, active_track, device_id, transport_mode)
                )

            elif msg_type == 'ice_candidate':
                candidate_session_id = data.get('sessionId')
                if (
                    current_session_id is not None
                    and candidate_session_id is not None
                    and candidate_session_id != current_session_id
                ):
                    print(
                        f'Ignore stale candidate, session={candidate_session_id}, current={current_session_id}',
                        flush=True,
                    )
                    continue
                candidate_wrapper = data.get('candidate') or {}
                candidate_value = candidate_wrapper.get('candidate')
                if pc and candidate_value:
                    candidate = candidate_from_sdp(candidate_value)
                    candidate.sdpMid = candidate_wrapper.get('sdpMid')
                    candidate.sdpMLineIndex = candidate_wrapper.get('sdpMLineIndex')
                    await pc.addIceCandidate(candidate)

            elif msg_type == 'renegotiate_answer':
                answer_session_id = data.get('sessionId')
                if (
                    current_session_id is not None
                    and answer_session_id is not None
                    and answer_session_id != current_session_id
                ):
                    print(
                        f'Ignore stale renegotiate answer, session={answer_session_id}, current={current_session_id}',
                        flush=True,
                    )
                    continue
                if pc and data.get('answer'):
                    answer = data['answer']
                    await pc.setRemoteDescription(
                        RTCSessionDescription(sdp=answer.get('sdp'), type=answer.get('type'))
                    )
                    print('Renegotiation completed', flush=True)

            elif msg_type == 'change_quality':
                mode = data.get('mode', 'gaming')
                if mode == 'document':
                    mode = 'gaming'
                mode_map = {
                    'gaming': CaptureConfig.GAMING_MODE,
                    'low_latency': CaptureConfig.LOW_LATENCY_MODE,
                }

                if mode not in mode_map:
                    print(f'Unknown quality mode: {mode}, fallback to gaming', flush=True)
                    mode = 'gaming'

                CaptureConfig.CURRENT = mode_map[mode]
                last_valid_frame = None

                if active_track:
                    active_track.target_fps = CaptureConfig.CURRENT['fps']
                    active_track.frame_interval = 1.0 / max(1, active_track.target_fps)

                print(
                    f"Switched quality mode to {mode}: "
                    f"{CaptureConfig.CURRENT['fps']} FPS, {CaptureConfig.CURRENT['resolution']}, "
                    f"{CaptureConfig.CURRENT['min_bitrate']}-{CaptureConfig.CURRENT['max_bitrate']} kbps",
                    flush=True,
                )

                if ENABLE_QUALITY_RENEGOTIATION and pc and pc.connectionState in ['connected', 'connecting']:
                    try:
                        offer = await pc.createOffer()
                        await pc.setLocalDescription(offer)
                        await ws.send(json.dumps({
                            'type': 'renegotiate',
                            'target': 'client',
                            'targetHostId': device_id,
                            'sessionId': current_session_id,
                            'offer': {
                                'sdp': pc.localDescription.sdp,
                                'type': pc.localDescription.type,
                            },
                        }))
                    except Exception as e:
                        print(f'Renegotiation failed: {e}', flush=True)
                elif pc and pc.connectionState in ['connected', 'connecting']:
                    print('Skip renegotiation on quality change (disabled by config)', flush=True)

            elif msg_type == 'input':
                handle_input_data(data)

            elif msg_type == 'download_file':
                file_url = data.get('fileUrl')
                file_name = data.get('fileName')
                if not file_url or not file_name:
                    continue

                try:
                    import requests

                    response = requests.get(file_url, timeout=60)
                    response.raise_for_status()

                    download_dir = os.path.join(os.path.expanduser('~'), 'Downloads')
                    os.makedirs(download_dir, exist_ok=True)

                    save_path = os.path.join(download_dir, file_name)
                    if os.path.exists(save_path):
                        base_name, ext = os.path.splitext(file_name)
                        counter = 1
                        while os.path.exists(save_path):
                            save_path = os.path.join(download_dir, f'{base_name} ({counter}){ext}')
                            counter += 1

                    with open(save_path, 'wb') as f:
                        f.write(response.content)

                    print(f'File downloaded: {save_path}', flush=True)
                except Exception as e:
                    print(f'File download failed: {e}', flush=True)

        if stats_task:
            stats_task.cancel()
        if pending_launch_task and not pending_launch_task.done():
            pending_launch_task.cancel()
        if pc:
            await pc.close()


if __name__ == '__main__':
    import sys
    import warnings

    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(line_buffering=True)

    warnings.filterwarnings('ignore', category=RuntimeWarning, module='comtypes')

    print('=' * 60, flush=True)
    print('WebRTC Optimized Host', flush=True)
    print('=' * 60, flush=True)
    candidates = build_signaling_candidates()

    if not candidates:
        print('No signaling endpoint candidate was built. Check SIGNALING_SERVER_* env.', flush=True)
        raise SystemExit(1)

    print('Signaling endpoint candidates:', flush=True)
    for idx, candidate in enumerate(candidates, start=1):
        print(f'  {idx}. {candidate}', flush=True)

    last_error = None
    for candidate in candidates:
        try:
            print(f'Connecting to: {candidate}', flush=True)
            asyncio.run(run_host(candidate))
            last_error = None
            break
        except KeyboardInterrupt:
            print('\nHost stopped.', flush=True)
            raise
        except Exception as e:
            last_error = e
            print(f'Connection failed: {candidate}', flush=True)
            print(f'Reason: {type(e).__name__}: {e}', flush=True)

    if last_error is not None:
        print('\nAll signaling endpoints failed.', flush=True)
        print('Please verify:', flush=True)
        print('1) portal server process is running;', flush=True)
        print('2) security group allows TCP 3000;', flush=True)
        print('3) domain DNS points to the portal server.', flush=True)
        raise SystemExit(1)


