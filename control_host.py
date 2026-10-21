import asyncio
import concurrent.futures
import ctypes
import json
import os
import platform
import re
import socket
import subprocess
import time
import uuid
from datetime import datetime

import pydirectinput
import websockets
import win32gui
import win32process


def get_device_id():
    config_file = "device_config.json"
    if os.path.exists(config_file):
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                device_id = cfg.get("device_id")
                device_name = cfg.get("device_name")
                if device_id and device_name:
                    return device_id, device_name
        except Exception:
            pass

    device_id = str(uuid.uuid4())
    hostname = socket.gethostname() or "CloudHost"
    device_name = f"{hostname} ({platform.system()})"
    try:
        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "device_id": device_id,
                    "device_name": device_name,
                    "created_at": datetime.now().isoformat(),
                    "hostname": hostname,
                    "platform": platform.system(),
                },
                f,
                ensure_ascii=False,
                indent=2,
            )
    except Exception as e:
        print(f"Failed to write {config_file}: {e}", flush=True)
    return device_id, device_name


pydirectinput.FAILSAFE = False
pydirectinput.PAUSE = 0
if hasattr(pydirectinput, "MINIMUM_DURATION"):
    pydirectinput.MINIMUM_DURATION = 0
if hasattr(pydirectinput, "MINIMUM_SLEEP"):
    pydirectinput.MINIMUM_SLEEP = 0
if hasattr(pydirectinput, "DARWIN_CATCH_UP_TIME"):
    pydirectinput.DARWIN_CATCH_UP_TIME = 0

SIGNALING_SERVER_IP = os.getenv("SIGNALING_SERVER_IP", "146.56.217.146")
SIGNALING_SERVER_PORT = os.getenv("SIGNALING_SERVER_PORT", "3000")
SIGNALING_SERVER_URL = os.getenv("SIGNALING_SERVER_URL", "").strip()
SIGNALING_SERVER_SCHEME = os.getenv("SIGNALING_SERVER_SCHEME", "ws").strip().lower()
APP_STARTUP_GRACE_SECONDS = float(os.getenv("APP_STARTUP_GRACE_SECONDS", "3.0"))

app_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="app")
input_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="input")
mouse_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="mouse")

MOUSE_SEND_INTERVAL_MS = max(1, int(os.getenv("MOUSE_SEND_INTERVAL_MS", "2")))

current_app_process = None
current_app_hwnd = None
latest_mouse_move = None
mouse_move_event = None


def set_cursor_pos(x, y):
    try:
        ctypes.windll.user32.SetCursorPos(int(x), int(y))
    except Exception:
        pydirectinput.moveTo(int(x), int(y), _pause=False)


def build_signaling_candidates():
    host = (SIGNALING_SERVER_IP or "").strip()
    port = (SIGNALING_SERVER_PORT or "").strip()
    scheme = SIGNALING_SERVER_SCHEME if SIGNALING_SERVER_SCHEME in ("ws", "wss") else "ws"
    candidates = []
    if SIGNALING_SERVER_URL:
        candidates.append(SIGNALING_SERVER_URL.rstrip("/"))
    if host:
        if port:
            candidates.append(f"{scheme}://{host}:{port}/signaling")
            if port == "3000":
                candidates.append(f"ws://{host}:{port}/signaling")
            if port == "443":
                candidates.append(f"wss://{host}:{port}/signaling")
        candidates.append(f"ws://{host}/signaling")
        candidates.append(f"wss://{host}/signaling")

    unique = []
    for url in candidates:
        if url and url not in unique:
            unique.append(url)
    return unique


def get_window_rect_safe(hwnd):
    try:
        return win32gui.GetWindowRect(hwnd)
    except Exception:
        return None


def find_window_by_pid(pid):
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
                "ApplicationFrameWindow",
                "Chrome_WidgetWin_1",
                "Qt5QWindowIcon",
                "UnityWndClass",
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


def execute_input(action, *args):
    try:
        if action == "mousemove":
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
                    set_cursor_pos(target_x, target_y)
                    return

            screen_w, screen_h = pydirectinput.size()
            target_x = max(0, min(int(x_ratio * screen_w), screen_w - 1))
            target_y = max(0, min(int(y_ratio * screen_h), screen_h - 1))
            set_cursor_pos(target_x, target_y)
            return

        if action == "keydown":
            pydirectinput.keyDown(str(args[0]), _pause=False)
            return
        if action == "keyup":
            pydirectinput.keyUp(str(args[0]), _pause=False)
            return
        if action == "mousedown":
            pydirectinput.mouseDown(button=str(args[0]), _pause=False)
            return
        if action == "mouseup":
            pydirectinput.mouseUp(button=str(args[0]), _pause=False)
            return
        if action == "wheel":
            delta = int(args[0])
            pydirectinput.scroll(-120 * delta)
            return
    except Exception:
        pass


KEY_MAP = {
    "arrowup": "up",
    "arrowdown": "down",
    "arrowleft": "left",
    "arrowright": "right",
    "escape": "esc",
    "esc": "esc",
    " ": "space",
    "spacebar": "space",
    "control": "ctrl",
    "ctrl": "ctrl",
    "alt": "alt",
    "altgraph": "alt",
    "shift": "shift",
    "meta": "win",
    "os": "win",
    "enter": "enter",
    "backspace": "backspace",
    "tab": "tab",
    "delete": "delete",
    "home": "home",
    "end": "end",
    "pageup": "pgup",
    "pagedown": "pgdn",
    "capslock": "capslock",
    "numlock": "numlock",
    "scrolllock": "scrolllock",
    "insert": "insert",
    "pause": "pause",
    "printscreen": "printscreen",
    "contextmenu": "apps",
    **{f"f{i}": f"f{i}" for i in range(1, 13)},
}

CODE_MAP = {
    **{f"Key{c}": c.lower() for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"},
    **{f"Digit{i}": str(i) for i in range(10)},
    **{f"Numpad{i}": f"num{i}" for i in range(10)},
    "Minus": "-",
    "Equal": "=",
    "BracketLeft": "[",
    "BracketRight": "]",
    "Backslash": "\\",
    "Semicolon": ";",
    "Quote": "'",
    "Comma": ",",
    "Period": ".",
    "Slash": "/",
    "Backquote": "`",
    "Space": "space",
    "Tab": "tab",
    "Enter": "enter",
    "NumpadEnter": "enter",
    "Escape": "esc",
    "Backspace": "backspace",
    "Delete": "delete",
    "Insert": "insert",
    "Home": "home",
    "End": "end",
    "PageUp": "pgup",
    "PageDown": "pgdn",
    "ArrowUp": "up",
    "ArrowDown": "down",
    "ArrowLeft": "left",
    "ArrowRight": "right",
    "ShiftLeft": "shift",
    "ShiftRight": "shift",
    "ControlLeft": "ctrl",
    "ControlRight": "ctrl",
    "AltLeft": "alt",
    "AltRight": "alt",
    "MetaLeft": "win",
    "MetaRight": "win",
    "NumpadAdd": "add",
    "NumpadSubtract": "subtract",
    "NumpadMultiply": "multiply",
    "NumpadDivide": "divide",
    "NumpadDecimal": "decimal",
}


def normalize_keyboard_key(raw_key, raw_code):
    key = KEY_MAP.get(raw_key, raw_key)
    if raw_code in CODE_MAP:
        if raw_code.startswith("Key") or raw_code.startswith("Digit") or raw_code.startswith("Numpad"):
            key = CODE_MAP[raw_code]
        elif raw_key in ("", "dead", "process", "unidentified"):
            key = CODE_MAP[raw_code]
    return key


def _extract_steam_game_context(app_path):
    lower = app_path.lower()
    marker = "\\steamapps\\common\\"
    idx = lower.find(marker)
    if idx < 0:
        return None
    steam_root = app_path[:idx]
    steamapps_dir = os.path.join(steam_root, "steamapps")
    common_dir = os.path.join(steamapps_dir, "common")
    try:
        rel = os.path.relpath(os.path.dirname(app_path), common_dir)
    except Exception:
        return None
    install_dir = rel.split(os.sep)[0] if rel and rel != "." else ""
    if not install_dir:
        return None
    return {
        "steam_root": steam_root,
        "steamapps_dir": steamapps_dir,
        "install_dir": install_dir,
    }


def _find_steam_appid_by_install_dir(steamapps_dir, install_dir):
    if not os.path.isdir(steamapps_dir):
        return None
    try:
        manifests = [f for f in os.listdir(steamapps_dir) if f.startswith("appmanifest_") and f.endswith(".acf")]
    except Exception:
        return None

    target = install_dir.lower()
    for manifest in manifests:
        path = os.path.join(steamapps_dir, manifest)
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
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


def _launch_steam_game(app_path):
    context = _extract_steam_game_context(app_path)
    if not context:
        return False, None
    steam_exe = os.path.join(context["steam_root"], "steam.exe")
    if not os.path.exists(steam_exe):
        return False, None
    appid = _find_steam_appid_by_install_dir(context["steamapps_dir"], context["install_dir"])
    if not appid:
        return False, None
    subprocess.Popen([steam_exe, "-applaunch", appid], cwd=context["steam_root"])
    print(f"Steam launch requested: appid={appid}, install_dir={context['install_dir']}", flush=True)
    return True, [context["install_dir"], os.path.splitext(os.path.basename(app_path))[0]]


def launch_application(app_id, app_path=None):
    global current_app_process, current_app_hwnd
    try:
        if app_id in ("desktop", "fullscreen"):
            current_app_hwnd = None
            current_app_process = None
            return True

        if not app_path:
            return False
        app_path = os.path.normpath(app_path)
        if os.path.isdir(app_path) or not os.path.exists(app_path):
            return False

        app_dir = os.path.dirname(app_path) or None
        current_app_hwnd = None
        current_app_process = None
        window_keywords = [os.path.splitext(os.path.basename(app_path))[0]]
        launched = False
        launched_via_steam = False

        steam_launched, steam_keywords = _launch_steam_game(app_path)
        if steam_launched:
            launched = True
            launched_via_steam = True
            if steam_keywords:
                window_keywords.extend(steam_keywords)
        else:
            try:
                current_app_process = subprocess.Popen([app_path], cwd=app_dir)
                launched = True
                print(f"App started (PID: {current_app_process.pid})", flush=True)
            except Exception as e:
                print(f"Popen failed: {e}", flush=True)

        if current_app_process:
            time.sleep(min(APP_STARTUP_GRACE_SECONDS, 1.0))
            if current_app_process.poll() is not None:
                print(f"Process exited early: {current_app_process.returncode}", flush=True)
                current_app_process = None

        if (not launched) or (current_app_process is None and not launched_via_steam):
            try:
                os.startfile(app_path)
                launched = True
                print("App started via os.startfile fallback", flush=True)
            except Exception as e:
                print(f"os.startfile failed: {e}", flush=True)

        if not launched:
            return False

        for i in range(100):
            time.sleep(0.1)
            if current_app_process and current_app_process.poll() is not None:
                print(f"App exited during startup: {current_app_process.returncode}", flush=True)
                return False

            hwnd = None
            if current_app_process:
                hwnd = find_window_by_pid(current_app_process.pid)
            else:
                for keyword in window_keywords:
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
                print(f"  still searching... ({i / 10:.1f}s)", flush=True)

        print("App window not found", flush=True)
        return True
    except Exception as e:
        print(f"Launch failed: {e}", flush=True)
        return False


def stop_current_application():
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
        print(f"Stop app failed: {e}", flush=True)
        return False


def execute_command(command, params=None):
    try:
        if command == "reset_view":
            pydirectinput.press("home")
        elif command == "save_scene":
            pydirectinput.keyDown("ctrl")
            pydirectinput.press("s")
            pydirectinput.keyUp("ctrl")
        elif command == "toggle_pause":
            pydirectinput.press("space")
        elif command == "fullscreen":
            pydirectinput.keyDown("alt")
            pydirectinput.press("enter")
            pydirectinput.keyUp("alt")
        elif command == "exit_app":
            pydirectinput.keyDown("alt")
            pydirectinput.press("f4")
            pydirectinput.keyUp("alt")
    except Exception as e:
        print(f"Command execution failed: {e}", flush=True)


async def mouse_dispatch_loop(loop):
    global latest_mouse_move
    while True:
        await mouse_move_event.wait()
        await asyncio.sleep(MOUSE_SEND_INTERVAL_MS / 1000.0)

        mouse_move_event.clear()
        move = latest_mouse_move
        latest_mouse_move = None
        if not move:
            continue

        x_ratio, y_ratio = move
        try:
            execute_input("mousemove", x_ratio, y_ratio)
        except Exception:
            pass


def handle_input_data(loop, data):
    global latest_mouse_move
    action = data.get("action")
    if action in ["keydown", "keyup"]:
        raw_key = str(data.get("key", "")).lower()
        raw_code = str(data.get("code", ""))
        key = normalize_keyboard_key(raw_key, raw_code)
        if key:
            loop.run_in_executor(input_executor, execute_input, action, key)
        return

    if action in ["mousedown", "mouseup"]:
        button_code = data.get("button")
        if button_code not in (0, 2):
            return
        button = "left" if button_code == 0 else "right"
        loop.run_in_executor(input_executor, execute_input, action, button)
        return

    if action == "mousemove":
        x_ratio = data.get("x")
        y_ratio = data.get("y")
        try:
            x_ratio = float(x_ratio)
            y_ratio = float(y_ratio)
        except Exception:
            return
        if x_ratio < 0 or x_ratio > 1 or y_ratio < 0 or y_ratio > 1:
            return
        latest_mouse_move = (x_ratio, y_ratio)
        if mouse_move_event:
            mouse_move_event.set()
        return

    if action == "wheel":
        delta = data.get("delta", 0)
        loop.run_in_executor(input_executor, execute_input, action, delta)


async def run_control_host(signaling_url):
    global mouse_move_event
    loop = asyncio.get_event_loop()
    mouse_move_event = asyncio.Event()
    mouse_task = asyncio.create_task(mouse_dispatch_loop(loop))
    device_id, device_name = get_device_id()

    print(f"Connecting to signaling server: {signaling_url}", flush=True)
    print(f"Device ID: {device_id}", flush=True)
    print(f"Device name: {device_name}", flush=True)

    try:
        async with websockets.connect(
            signaling_url,
            ping_interval=20,
            ping_timeout=20,
            open_timeout=8,
            close_timeout=3,
        ) as ws:
            await ws.send(
                json.dumps(
                    {
                        "type": "register_host",
                        "hostId": device_id,
                        "hostName": device_name,
                    }
                )
            )
            print(f"Control host registered: {device_name}", flush=True)

            async for message in ws:
                try:
                    data = json.loads(message)
                except Exception:
                    continue

                msg_type = data.get("type")
                if msg_type == "launch_app":
                    app_id = data.get("appId")
                    app_path = data.get("appPath")
                    loop.run_in_executor(app_executor, launch_application, app_id, app_path)
                elif msg_type == "stop_app":
                    loop.run_in_executor(app_executor, stop_current_application)
                elif msg_type == "command":
                    command = data.get("command")
                    params = data.get("params")
                    loop.run_in_executor(app_executor, execute_command, command, params)
                elif msg_type == "input":
                    handle_input_data(loop, data)
                elif msg_type == "control_ping":
                    ping_ts = data.get("pingTs")
                    attempt_id = data.get("attemptId")
                    try:
                        await ws.send(
                            json.dumps(
                                {
                                    "type": "control_pong",
                                    "target": "client",
                                    "targetHostId": device_id,
                                    "pingTs": ping_ts,
                                    "attemptId": attempt_id,
                                    "hostTs": int(time.time() * 1000),
                                }
                            )
                        )
                    except Exception:
                        pass
    finally:
        mouse_task.cancel()


if __name__ == "__main__":
    print("=" * 60, flush=True)
    print("Control Host for OBS/FFmpeg + SRS Stack", flush=True)
    print("=" * 60, flush=True)

    candidates = build_signaling_candidates()
    if not candidates:
        print("No signaling endpoint candidate built.", flush=True)
        raise SystemExit(1)

    print("Signaling endpoint candidates:", flush=True)
    for idx, candidate in enumerate(candidates, start=1):
        print(f"  {idx}. {candidate}", flush=True)

    while True:
        last_error = None
        for candidate in candidates:
            try:
                asyncio.run(run_control_host(candidate))
                last_error = None
                break
            except KeyboardInterrupt:
                print("\nControl host stopped.", flush=True)
                raise
            except Exception as e:
                last_error = e
                print(f"Connection failed: {candidate}", flush=True)
                print(f"Reason: {type(e).__name__}: {e}", flush=True)
                time.sleep(2)

        if last_error is None:
            continue
        print("All signaling endpoints failed, retry in 3s...", flush=True)
        time.sleep(3)
