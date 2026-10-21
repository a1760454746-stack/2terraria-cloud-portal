import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Home, Trash2, Pencil, Maximize, Download, Camera, LayoutGrid, LogOut, Plus, Settings, FolderOpen } from 'lucide-react';
import P2PFileTransfer from './P2PFileTransfer';
import HomePage from './HomePage';
import GamingMode from './GamingMode';
import IndustrialMode from './IndustrialMode';
import StreamingView from './StreamingView';
import UserProfile from './UserProfile';

const SERVER_IP = import.meta.env.VITE_SERVER_IP || window.location.hostname || '127.0.0.1';
const SERVER_PORT = import.meta.env.VITE_SERVER_PORT || window.location.port || '3000';
const PAGE_IS_HTTPS = window.location.protocol === 'https:';
const API_PROTOCOL = import.meta.env.VITE_API_PROTOCOL || (PAGE_IS_HTTPS ? 'https' : 'http');
const WS_PROTOCOL = import.meta.env.VITE_WS_PROTOCOL || (PAGE_IS_HTTPS ? 'wss' : 'ws');
const API_BASE = `${API_PROTOCOL}://${SERVER_IP}:${SERVER_PORT}`;
const SIGNALING_WS_URL = `${WS_PROTOCOL}://${SERVER_IP}:${SERVER_PORT}/signaling`;
const deriveTurnHost = (host: string) => {
  if (!host) return host;
  if (host.startsWith('portal.')) return `turn.${host.slice('portal.'.length)}`;
  return host;
};
const TURN_SERVER_IP = import.meta.env.VITE_TURN_SERVER_IP || deriveTurnHost(SERVER_IP);
const TURN_SERVER_PORT = import.meta.env.VITE_TURN_SERVER_PORT || '3478';
const TURN_USERNAME = import.meta.env.VITE_TURN_USERNAME || 'cloudplay';
const TURN_CREDENTIAL = import.meta.env.VITE_TURN_CREDENTIAL || 'cloudplaypassword';
const DIRECT_CONNECT_TIMEOUT_MS = Number(import.meta.env.VITE_DIRECT_CONNECT_TIMEOUT_MS || '12000');
const FORCE_RELAY_ONLY = import.meta.env.VITE_FORCE_RELAY_ONLY === '1';
const TURN_TRANSPORT = (import.meta.env.VITE_TURN_TRANSPORT || 'all').toLowerCase();
const STREAM_BACKEND = (import.meta.env.VITE_STREAM_BACKEND || 'legacy').toLowerCase();
const USE_SRS_WHEP = STREAM_BACKEND === 'srs_whep';
const SRS_WHEP_URL = import.meta.env.VITE_SRS_WHEP_URL || '';
const SRS_WHEP_URL_1080 = import.meta.env.VITE_SRS_WHEP_URL_1080 || '';
const SRS_WHEP_URL_720 = import.meta.env.VITE_SRS_WHEP_URL_720 || '';
const INPUT_MOUSE_INTERVAL_MS = Math.max(2, Number(import.meta.env.VITE_INPUT_MOUSE_INTERVAL_MS || '4'));

const buildTurnUrls = () => {
  const udp = `turn:${TURN_SERVER_IP}:${TURN_SERVER_PORT}?transport=udp`;
  const tcp = `turn:${TURN_SERVER_IP}:${TURN_SERVER_PORT}?transport=tcp`;
  if (TURN_TRANSPORT === 'udp') return [udp];
  if (TURN_TRANSPORT === 'tcp') return [tcp];
  return [udp, tcp];
};

const ALPHANUMERIC_KEY_PREFIXES = ['Key', 'Digit', 'Numpad'];
const GAME_CONTROL_KEY_CODES = new Set([
  'Space',
  'Tab',
  'Escape',
  'Enter',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Pause',
  'PrintScreen',
  'ContextMenu',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12'
]);
const GAME_SYMBOL_KEY_CODES = new Set([
  'Backquote',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Comma',
  'Period',
  'Slash'
]);

const isGameControlKey = (code: string) => {
  if (!code) return false;
  if (GAME_CONTROL_KEY_CODES.has(code) || GAME_SYMBOL_KEY_CODES.has(code)) return true;
  return ALPHANUMERIC_KEY_PREFIXES.some((prefix) => code.startsWith(prefix));
};

interface App {
  id: string;
  name: string;
  icon: string;
  description: string;
  path?: string;
  builtin?: boolean;
}

interface Device {
  deviceId: string;
  deviceName: string;
  addedAt: string;
  online?: boolean;
  connectedAt?: string | null;
}

interface RunningInstance {
  instanceId: string;
  deviceId: string;
  appId: string;
  appName: string;
  appIcon: string;
  startedAt: string;
  category?: 'gaming' | 'industrial' | 'remote'; // 添加分类字段
}

const App: React.FC = () => {
  const [currentMode, setCurrentMode] = useState<'home' | 'gaming' | 'industrial' | 'remote'>('home');
  const [showGamingLibrary, setShowGamingLibrary] = useState(true); // 是否显示游戏库（而不是游戏画面）
  const [showIndustrialLibrary, setShowIndustrialLibrary] = useState(true); // 是否显示应用库（而不是应用画面）
  const [currentAppName, setCurrentAppName] = useState('');
  const [currentAppIcon, setCurrentAppIcon] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userData, setUserData] = useState({
    username: '用户123',
    avatar: '👤'
  });
  const [showUserProfile, setShowUserProfile] = useState(false); // 是否显示用户资料页面
  
  // 使用时长统计（秒）：累计时长
  const [accumulatedTime, setAccumulatedTime] = useState({
    gaming: 0,
    industrial: 0,
    remote: 0
  });
  const modeStartTimeRef = useRef<number | null>(null);
  // 当前实时时长（用于显示）
  const [currentSessionTime, setCurrentSessionTime] = useState(0);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const candidatesQueue = useRef<RTCIceCandidateInit[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [status, setStatus] = useState<string>('等待连接信令服务器...');
  const [apps, setApps] = useState<App[]>([]);
  const [notification, setNotification] = useState<string>('');
  const [showAppManager, setShowAppManager] = useState(false);
  const [editingApp, setEditingApp] = useState<App | null>(null);
  const [appForm, setAppForm] = useState({ name: '', icon: '⚙️', description: '', path: '' });
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [showToolbar, setShowToolbar] = useState(true);
  
  const [fps, setFps] = useState(0);
  
  // 性能指标
  const [rtt, setRtt] = useState(0);
  const [latency, setLatency] = useState(0);
  const [controlLatency, setControlLatency] = useState(0);
  const [bitrate, setBitrate] = useState(0);
  const [packetLoss, setPacketLoss] = useState(0);
  const [availableOutgoingKbps, setAvailableOutgoingKbps] = useState(0);
  const [candidatePath, setCandidatePath] = useState('unknown');
  const [connectionMode, setConnectionMode] = useState<'direct' | 'relay' | 'unknown'>('unknown');

  // 文件传输
  const [showP2PFileTransfer, setShowP2PFileTransfer] = useState(false);

  // 画质设置
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [currentQuality, setCurrentQuality] = useState<'gaming' | 'low_latency'>('gaming');

  // 设备管理
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const selectedDeviceRef = useRef<Device | null>(null);
  const [showDeviceManager, setShowDeviceManager] = useState(false);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [deviceForm, setDeviceForm] = useState({ deviceName: '', deviceId: '' });
  const connectAttemptIdRef = useRef(0);
  const iceDisconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectionLockRef = useRef(false);
  const signalingSessionIdRef = useRef<string | null>(null);
  const suppressWsErrorRef = useRef(false);
  const whepResourceUrlRef = useRef<string | null>(null);
  const whepStatsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const whepDisconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlPingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 运行实例管理
  const [runningInstances, setRunningInstances] = useState<RunningInstance[]>([]);
  const [showInstancesPage, setShowInstancesPage] = useState(false);
  const pressedKeysRef = useRef<Map<string, { key: string; code: string }>>(new Map());
  const pressedMouseButtonsRef = useRef<Set<number>>(new Set());

  const isEditableElement = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    if (!element) return false;
    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element.isContentEditable;
  };

  const resolveWhepEndpoint = useCallback((quality: 'gaming' | 'low_latency') => {
    const modeSpecific = quality === 'gaming' ? SRS_WHEP_URL_1080 : SRS_WHEP_URL_720;
    const base = (modeSpecific || SRS_WHEP_URL || '').trim();
    if (!base) return '';
    return base
      .replace('{quality}', quality)
      .replace('{mode}', quality)
      .replace('{profile}', quality);
  }, []);

  const waitIceGatheringComplete = useCallback(async (pc: RTCPeerConnection, timeoutMs = 2500) => {
    if (pc.iceGatheringState === 'complete') return;

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        pc.removeEventListener('icegatheringstatechange', onStateChange);
        resolve();
      };
      const onStateChange = () => {
        if (pc.iceGatheringState === 'complete') finish();
      };
      pc.addEventListener('icegatheringstatechange', onStateChange);
      setTimeout(finish, timeoutMs);
    });
  }, []);

  const stopWhepStats = useCallback(() => {
    if (whepStatsTimerRef.current) {
      clearInterval(whepStatsTimerRef.current);
      whepStatsTimerRef.current = null;
    }
    if (whepDisconnectTimerRef.current) {
      clearTimeout(whepDisconnectTimerRef.current);
      whepDisconnectTimerRef.current = null;
    }
  }, []);

  const stopControlPing = useCallback(() => {
    if (controlPingTimerRef.current) {
      clearInterval(controlPingTimerRef.current);
      controlPingTimerRef.current = null;
    }
  }, []);

  const startControlPing = useCallback((attemptId: number, hostId: string) => {
    stopControlPing();
    if (!hostId) return;

    controlPingTimerRef.current = setInterval(() => {
      if (!USE_SRS_WHEP) return;
      if (connectAttemptIdRef.current !== attemptId) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      ws.send(JSON.stringify({
        type: 'control_ping',
        targetHostId: hostId,
        pingTs: Date.now(),
        attemptId
      }));
    }, 500);
  }, [stopControlPing]);

  const startWhepStats = useCallback((pc: RTCPeerConnection, attemptId: number) => {
    stopWhepStats();

    let prevBytes = 0;
    let prevFramesDecoded = 0;
    let prevTimestamp = 0;

    whepStatsTimerRef.current = setInterval(async () => {
      if (connectAttemptIdRef.current !== attemptId) return;
      if (!pcRef.current || pcRef.current !== pc) return;
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') return;

      try {
        const stats = await pc.getStats();

        let inboundVideo: RTCStats | null = null;
        let selectedPair: RTCStats | null = null;

        stats.forEach((stat) => {
          const statType = (stat as any).type;
          const kind = (stat as any).kind;
          const mediaType = (stat as any).mediaType;
          if (statType === 'inbound-rtp' && (kind === 'video' || mediaType === 'video')) {
            inboundVideo = stat;
          }
          if (statType === 'candidate-pair' && (stat as any).state === 'succeeded' && ((stat as any).nominated || (stat as any).selected)) {
            selectedPair = stat;
          }
        });

        if (inboundVideo) {
          const anyIn = inboundVideo as any;
          const bytesReceived = Number(anyIn.bytesReceived || 0);
          const framesDecoded = Number(anyIn.framesDecoded || 0);
          const ts = Number(anyIn.timestamp || 0);

          if (prevTimestamp > 0 && ts > prevTimestamp) {
            const dt = (ts - prevTimestamp) / 1000;
            if (dt > 0) {
              const bitrateKbps = Math.max(0, Math.round(((bytesReceived - prevBytes) * 8) / 1000 / dt));
              const fpsFromDecode = Math.max(0, Math.round((framesDecoded - prevFramesDecoded) / dt));

              if (bitrateKbps >= 0) setBitrate(bitrateKbps);
              if (fpsFromDecode >= 0) setFps(fpsFromDecode);
            }
          }

          prevBytes = bytesReceived;
          prevFramesDecoded = framesDecoded;
          prevTimestamp = ts;

          const packetsLost = Number(anyIn.packetsLost || 0);
          const packetsReceived = Number(anyIn.packetsReceived || 0);
          const totalPackets = packetsLost + packetsReceived;
          if (totalPackets > 0) {
            setPacketLoss(Number(((packetsLost / totalPackets) * 100).toFixed(2)));
          }
        }

        if (selectedPair) {
          const anyPair = selectedPair as any;
          const rttSec = Number(anyPair.currentRoundTripTime || 0);
          const rttMs = Math.max(0, Math.round(rttSec * 1000));
          setRtt(rttMs);
          setLatency(rttMs);

          const availableIncoming = Number(anyPair.availableIncomingBitrate || 0);
          const availableOutgoing = Number(anyPair.availableOutgoingBitrate || 0);
          const availKbps = Math.max(0, Math.round((availableIncoming || availableOutgoing) / 1000));
          setAvailableOutgoingKbps(availKbps);

          const localId = anyPair.localCandidateId;
          const remoteId = anyPair.remoteCandidateId;
          let localType = 'unknown';
          let remoteType = 'unknown';
          let protocol = 'unknown';

          if (localId && stats.has(localId)) {
            const lc: any = stats.get(localId);
            localType = lc?.candidateType || 'unknown';
            protocol = lc?.protocol || protocol;
          }
          if (remoteId && stats.has(remoteId)) {
            const rc: any = stats.get(remoteId);
            remoteType = rc?.candidateType || 'unknown';
          }

          setCandidatePath(`${localType} -> ${remoteType} (${protocol})`);
          if (localType === 'relay' || remoteType === 'relay') {
            setConnectionMode('relay');
          } else {
            setConnectionMode('direct');
          }
        }
      } catch (err) {
        console.warn('WHEP getStats failed:', err);
      }
    }, 1000);
  }, [stopWhepStats]);

  const flushPressedInputs = useCallback(() => {
    const dataChannel = dcRef.current;
    const targetHostId = selectedDeviceRef.current?.deviceId;
    const signaling = wsRef.current;

    const canSendDc = Boolean(dataChannel && dataChannel.readyState === 'open');
    const canSendWs = Boolean(
      USE_SRS_WHEP &&
      signaling &&
      signaling.readyState === WebSocket.OPEN
    );

    if (canSendDc || canSendWs) {
      pressedKeysRef.current.forEach(({ key, code }) => {
        const payload = JSON.stringify({ action: 'keyup', key, code, targetHostId });
        if (canSendDc && dataChannel) dataChannel.send(payload);
        if (canSendWs && signaling) signaling.send(JSON.stringify({ type: 'input', action: 'keyup', key, code, targetHostId }));
      });
      pressedMouseButtonsRef.current.forEach((button) => {
        const payload = JSON.stringify({ action: 'mouseup', button, targetHostId });
        if (canSendDc && dataChannel) dataChannel.send(payload);
        if (canSendWs && signaling) signaling.send(JSON.stringify({ type: 'input', action: 'mouseup', button, targetHostId }));
      });
    }

    pressedKeysRef.current.clear();
    pressedMouseButtonsRef.current.clear();
  }, []);

  const stopStreamingSession = useCallback((nextStatus = '已断开连接') => {
    connectAttemptIdRef.current += 1;
    connectionLockRef.current = false;
    signalingSessionIdRef.current = null;
    setConnectionMode('unknown');
    stopWhepStats();
    stopControlPing();
    setControlLatency(0);
    if (iceDisconnectTimerRef.current) {
      clearTimeout(iceDisconnectTimerRef.current);
      iceDisconnectTimerRef.current = null;
    }
    flushPressedInputs();

    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (whepResourceUrlRef.current) {
      const resourceUrl = whepResourceUrlRef.current;
      whepResourceUrlRef.current = null;
      void fetch(resourceUrl, { method: 'DELETE' }).catch(() => {
        // ignore teardown errors
      });
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    setIsPlaying(false);
    setIsConnecting(false);
    setShowP2PFileTransfer(false);
    setShowQualityMenu(false);
    setShowToolbar(true);
    setStatus(nextStatus);
  }, [flushPressedInputs, stopControlPing, stopWhepStats]);
  
  // 处理模式选择
  const handleModeSelect = (mode: 'gaming' | 'industrial' | 'remote') => {
    if (isPlaying || isConnecting) {
      stopStreamingSession('已结束上一条串流会话');
    }
    if (currentMode !== 'home' && modeStartTimeRef.current) {
      const elapsed = Math.floor((Date.now() - modeStartTimeRef.current) / 1000);
      setAccumulatedTime(prev => ({
        ...prev,
        [currentMode]: prev[currentMode as keyof typeof prev] + elapsed
      }));
      setCurrentSessionTime(0);
    }
    
    // 切换到新模式
    setCurrentMode(mode);
    modeStartTimeRef.current = Date.now();
    
    if (mode === 'gaming') {
      setShowGamingLibrary(true); // 进入云游戏时先显示游戏库
      // 云游戏：自动选择第一个在线设备（固定服务器）
      const onlineDevices = devices.filter(d => d.online);
      if (onlineDevices.length > 0) {
        setSelectedDevice(onlineDevices[0]);
        console.log('✅ [云游戏] 自动选择固定服务器:', onlineDevices[0].deviceName);
      } else {
        console.warn('⚠️ [云游戏] 没有在线设备');
      }
    } else if (mode === 'industrial') {
      setShowIndustrialLibrary(true); // 进入工业应用时先显示应用库
      // 云工业：自动选择第一个在线设备（固定服务器）
      const onlineDevices = devices.filter(d => d.online);
      if (onlineDevices.length > 0) {
        setSelectedDevice(onlineDevices[0]);
        console.log('✅ [云工业] 自动选择固定服务器:', onlineDevices[0].deviceName);
      } else {
        console.warn('⚠️ [云工业] 没有在线设备');
      }
    }
    // 远程办公模式不自动选择设备，让用户手动选择
  };
  
  // 返回首页
  const handleBackToHome = () => {
    if (isPlaying || isConnecting) {
      stopStreamingSession('已返回首页');
    }
    if (currentMode !== 'home' && modeStartTimeRef.current) {
      const elapsed = Math.floor((Date.now() - modeStartTimeRef.current) / 1000);
      setAccumulatedTime(prev => ({
        ...prev,
        [currentMode]: prev[currentMode as keyof typeof prev] + elapsed
      }));
      modeStartTimeRef.current = null;
      setCurrentSessionTime(0);
    }
    
    setCurrentMode('home');
    setShowGamingLibrary(true);
    setShowIndustrialLibrary(true);
  };
  
  const getUsageTime = () => {
    const result = { ...accumulatedTime };
    if (currentMode !== 'home' && modeStartTimeRef.current) {
      const currentElapsed = Math.floor((Date.now() - modeStartTimeRef.current) / 1000);
      result[currentMode as keyof typeof result] += currentElapsed;
    }
    return result;
  };
  
  const handleLogout = () => {
    if (isPlaying || isConnecting) {
      stopStreamingSession('Logged out');
    }
    setIsLoggedIn(false);
    setShowUserProfile(false);
    setCurrentMode('home');
  };
  
  const handleLaunchGame = async (gameId: string) => {
    const gameInfo: Record<string, { name: string; icon: string; path: string }> = {
      game1: { name: '极限竞速：地平线4', icon: '🎮', path: 'D:\\steam\\steamapps\\common\\ForzaHorizon4\\ForzaHorizon4.exe' },
      game2: { name: '赛博朋克2077', icon: '🌆', path: 'D:\\sbpk2077\\Cyberpunk 2077 v2.12.H1\\Cyberpunk 2077 v2.12.H1\\bin\\x64\\Cyberpunk2077.exe' },
      game3: { name: '永劫无间', icon: '⚔️', path: 'D:\\steam\\steamapps\\common\\NARAKA BLADEPOINT\\StartGame.exe' },
      game4: { name: '超级兔子人', icon: '🐰', path: 'C:\\Windows\\System32\\notepad.exe' },
      game5: { name: 'LIMBO', icon: '🌑', path: 'C:\\Windows\\System32\\notepad.exe' },
      game6: { name: 'Slime Rancher', icon: '🐾', path: 'C:\\Windows\\System32\\notepad.exe' },
      game7: { name: "Another Crab's Treasure", icon: '🦀', path: 'C:\\Windows\\System32\\notepad.exe' },
      game8: { name: '黎明杀机', icon: '🪓', path: 'C:\\Windows\\System32\\notepad.exe' },
      game9: { name: '黑神话：悟空', icon: '🐵', path: 'C:\\Windows\\System32\\notepad.exe' }
    };

    const game = gameInfo[gameId];
    if (!game) {
      showNotification('游戏未配置，请先补充启动路径');
      return;
    }

    if (!selectedDevice) {
      showNotification('请先选择设备');
      return;
    }

    const targetDevice = selectedDevice;
    setCurrentAppName(game.name);
    setCurrentAppIcon(game.icon);

    let launchAccepted = false;
    try {
      const res = await fetch(`${API_BASE}/api/launch-app`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId: gameId,
          appPath: game.path,
          appName: game.name,
          appIcon: game.icon,
          category: 'gaming',
          targetHostId: targetDevice.deviceId
        })
      });
      const raw = await res.text();
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }

      launchAccepted = Boolean(data?.success);
      if (launchAccepted) {
        showNotification(data?.message || '启动请求已发送');
      } else if (!res.ok) {
        showNotification(`启动接口异常(${res.status})，继续尝试连接串流`);
      } else {
        showNotification(data?.message || '启动状态不明确，继续尝试连接串流');
      }
    } catch (err) {
      console.error('launch game failed:', err);
      showNotification('启动接口失败，继续尝试连接串流');
    }

    setShowGamingLibrary(false);
    setTimeout(() => {
      startGame(targetDevice);
    }, videoRef.current ? 100 : 500);
    setTimeout(loadRunningInstances, launchAccepted ? 500 : 1000);
  };

  useEffect(() => {
    selectedDeviceRef.current = selectedDevice;
  }, [selectedDevice]);

  useEffect(() => {
    if (!isConnecting && !isPlaying) return;
    const modeText = connectionMode === 'direct' ? '直连' : connectionMode === 'relay' ? 'TURN' : '未知';
    console.log(`[stream] 当前链路模式: ${modeText}`);
  }, [connectionMode, isConnecting, isPlaying]);

  useEffect(() => {
    console.log(
      `[stream] TURN endpoint = turn:${TURN_SERVER_IP}:${TURN_SERVER_PORT}, ` +
      `signaling = ${SIGNALING_WS_URL}, forceRelay=${FORCE_RELAY_ONLY}, turnTransport=${TURN_TRANSPORT}, ` +
      `backend=${STREAM_BACKEND}, whep=${resolveWhepEndpoint('gaming') || 'unset'}`
    );
  }, [resolveWhepEndpoint]);

  useEffect(() => {
    const current = selectedDeviceRef.current;
    if (!current) return;

    const latest = devices.find((d) => d.deviceId === current.deviceId);
    if (!latest) {
      if (isPlaying || isConnecting) {
        stopStreamingSession('当前设备已不可用');
      }
      setSelectedDevice(null);
      return;
    }

    const onlineChanged = Boolean(latest.online) !== Boolean(current.online);
    const nameChanged = latest.deviceName !== current.deviceName;
    if (onlineChanged || nameChanged) {
      setSelectedDevice(latest);
    }

    if (!latest.online && (isPlaying || isConnecting)) {
      stopStreamingSession('设备已离线，连接已断开');
    }
  }, [devices, isConnecting, isPlaying, stopStreamingSession]);

  const handleDeviceSelect = (device: Device) => {
    if (!device.online) return;

    const switched = selectedDeviceRef.current?.deviceId !== device.deviceId;
    if (switched && (isPlaying || isConnecting)) {
      stopStreamingSession(`已切换到 ${device.deviceName}，请重新连接`);
      showNotification('设备已切换，串流连接已重置');
    }

    setSelectedDevice(device);
  };

  const handleLaunchIndustrialApp = async (appId: string) => {
    const appInfo: Record<string, { name: string; icon: string; path: string }> = {
      blender: { name: 'Blender', icon: '🧊', path: 'C:\\Windows\\System32\\notepad.exe' },
      photoshop: { name: 'Adobe Photoshop', icon: '🖼️', path: 'C:\\Windows\\System32\\notepad.exe' },
      unity: { name: 'Unity', icon: '🎮', path: 'C:\\Windows\\System32\\notepad.exe' },
      vscode: { name: 'Visual Studio Code', icon: '🧑‍💻', path: 'D:\\Program Files (x86)\\Microsoft VS Code\\Code.exe' },
      autocad: { name: 'AutoCAD', icon: '📐', path: 'C:\\Windows\\System32\\notepad.exe' },
      davinci: { name: 'DaVinci Resolve', icon: '🎬', path: 'C:\\Windows\\System32\\notepad.exe' },
      matlab: { name: 'MATLAB', icon: '📊', path: 'C:\\Windows\\System32\\notepad.exe' },
      solidworks: { name: 'SolidWorks', icon: '⚙️', path: 'C:\\Windows\\System32\\notepad.exe' },
      figma: { name: 'Figma', icon: '🎨', path: 'C:\\Windows\\System32\\notepad.exe' }
    };

    const app = appInfo[appId];
    if (!app) {
      showNotification('应用未配置');
      return;
    }

    if (!selectedDevice) {
      showNotification('请先选择设备');
      return;
    }

    const targetDevice = selectedDevice;
    setCurrentAppName(app.name);
    setCurrentAppIcon(app.icon);

    let launchAccepted = false;
    try {
      const res = await fetch(`${API_BASE}/api/launch-app`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appId,
          appPath: app.path,
          appName: app.name,
          appIcon: app.icon,
          category: 'industrial',
          targetHostId: targetDevice.deviceId
        })
      });
      const raw = await res.text();
      let data: any = null;
      try {
        data = raw ? JSON.parse(raw) : null;
      } catch {
        data = null;
      }

      launchAccepted = Boolean(data?.success);
      if (launchAccepted) {
        showNotification(data?.message || '启动请求已发送');
      } else if (!res.ok) {
        showNotification(`启动接口异常(${res.status})，继续尝试连接串流`);
      } else {
        showNotification(data?.message || '启动状态不明确，继续尝试连接串流');
      }
    } catch (err) {
      console.error('launch industrial app failed:', err);
      showNotification('启动接口失败，继续尝试连接串流');
    }

    setShowIndustrialLibrary(false);
    setTimeout(() => {
      startGame(targetDevice);
    }, videoRef.current ? 100 : 500);
    setTimeout(loadRunningInstances, launchAccepted ? 500 : 1000);
  };

  // 获取应用列表
  const loadApps = () => {
    if (!selectedDevice) {
      setApps([]);
      return;
    }
    
    fetch(`${API_BASE}/api/apps?deviceId=${selectedDevice.deviceId}`)
      .then(res => res.json())
      .then(data => setApps(data))
      .catch(err => console.error('获取应用列表失败:', err));
  };

  // 显示通知
  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(''), 3000);
  };

  // 获取设备列表
  const loadDevices = () => {
    fetch(`${API_BASE}/api/devices`)
      .then(res => res.json())
      .then(data => {
        setDevices(data.devices || []);
        const onlineCount = data.devices.filter((d: Device) => d.online).length;
        if (onlineCount > 0) {
          setStatus(`发现 ${onlineCount} 台在线设备`);
        }
      })
      .catch(err => console.error('获取设备列表失败:', err));
  };

  // 获取运行实例列表
  const loadRunningInstances = () => {
    fetch(`${API_BASE}/api/running-instances`)
      .then(res => res.json())
      .then(data => {
        setRunningInstances(data.instances || []);
      })
      .catch(err => console.error('获取运行实例失败:', err));
  };

  useEffect(() => {
    loadApps();
  }, [selectedDevice]);

  useEffect(() => {
    loadDevices();
    loadRunningInstances();
    // 每 5 秒刷新一次设备状态和运行实例
    const interval = setInterval(() => {
      loadDevices();
      loadRunningInstances();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (currentMode !== 'home' && modeStartTimeRef.current) {
      const interval = setInterval(() => {
        setCurrentSessionTime(Math.floor((Date.now() - modeStartTimeRef.current!) / 1000));
      }, 1000);
      
      return () => clearInterval(interval);
    }
  }, [currentMode]);

  useEffect(() => {
    if (showInstancesPage && runningInstances.length > 0) {
      const interval = setInterval(() => {
        setRunningInstances(prev => [...prev]);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [showInstancesPage, runningInstances.length]);

  // 启动应用
  const launchApp = async (appId: string) => {
    if (!selectedDevice) {
      showNotification('请先连接设备');
      return;
    }
    
    try {
      const res = await fetch(`${API_BASE}/api/launch-app`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId, targetHostId: selectedDevice.deviceId })
      });
      const data = await res.json();
      showNotification(data.message);
      if (data.success) {
        // 刷新运行实例列表
        setTimeout(loadRunningInstances, 500);
      }
    } catch (err) {
      console.error('launch app failed:', err);
      showNotification('启动失败，请检查网络连接');
    }
  };

  // 停止应用实例
  const stopInstance = async (instanceId: string) => {
    if (!confirm('确定要停止这个应用吗？')) return;
    
    try {
      const res = await fetch(`${API_BASE}/api/stop-instance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId })
      });
      const data = await res.json();
      showNotification(data.message);
      if (data.success) {
        loadRunningInstances();
      }
    } catch (err) {
      console.error('停止应用失败:', err);
      showNotification('停止失败');
    }
  };

  // 计算运行时长
  const getRunningDuration = (startedAt: string) => {
    const start = new Date(startedAt).getTime();
    const now = Date.now();
    const diff = now - start;
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    
    if (hours > 0) {
      return `${hours}小时${minutes}分钟`;
    } else if (minutes > 0) {
      return `${minutes}分钟${seconds}秒`;
    } else {
      return `${seconds}秒`;
    }
  };

  // 添加应用
  const addApp = async () => {
    if (!selectedDevice) {
      showNotification('请先连接设备');
      return;
    }
    
    if (!appForm.name || !appForm.path) {
      showNotification('应用名称和路径不能为空');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...appForm, deviceId: selectedDevice.deviceId })
      });
      const data = await res.json();
      showNotification(data.message);
      if (data.success) {
        loadApps();
        setAppForm({ name: '', icon: '⚙️', description: '', path: '' });
        setShowAppManager(false);
      }
    } catch (err) {
      console.error('添加应用失败:', err);
      showNotification('添加失败');
    }
  };

  // 更新应用
  const updateApp = async () => {
    if (!selectedDevice) {
      showNotification('请先连接设备');
      return;
    }
    
    if (!editingApp || !appForm.name || !appForm.path) {
      showNotification('应用名称和路径不能为空');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/apps/${editingApp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...appForm, deviceId: selectedDevice.deviceId })
      });
      const data = await res.json();
      showNotification(data.message);
      if (data.success) {
        loadApps();
        setEditingApp(null);
        setAppForm({ name: '', icon: '⚙️', description: '', path: '' });
        setShowAppManager(false);
      }
    } catch (err) {
      console.error('更新应用失败:', err);
      showNotification('更新失败');
    }
  };

  // 删除应用
  const deleteApp = async (appId: string) => {
    if (!selectedDevice) {
      showNotification('请先连接设备');
      return;
    }
    
    if (!confirm('确定要删除这个应用吗？')) return;

    try {
      const res = await fetch(`${API_BASE}/api/apps/${appId}?deviceId=${selectedDevice.deviceId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      showNotification(data.message);
      if (data.success) {
        loadApps();
      }
    } catch (err) {
      console.error('删除应用失败:', err);
      showNotification('删除失败');
    }
  };

  const startEditApp = (app: App) => {
    setEditingApp(app);
    setAppForm({
      name: app.name,
      icon: app.icon,
      description: app.description,
      path: app.path || ''
    });
    setShowAppManager(true);
  };

  // 添加设备
  const addDevice = async () => {
    if (!deviceForm.deviceName || !deviceForm.deviceId) {
      showNotification('设备名称和ID不能为空');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deviceForm)
      });
      const data = await res.json();
      showNotification(data.message);
      if (data.success) {
        loadDevices();
        setDeviceForm({ deviceName: '', deviceId: '' });
        setShowDeviceManager(false);
      }
    } catch (err) {
      console.error('添加设备失败:', err);
      showNotification('添加失败');
    }
  };

  // 更新设备
  const updateDevice = async () => {
    if (!editingDevice || !deviceForm.deviceName) {
      showNotification('设备名称不能为空');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/devices/${editingDevice.deviceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceName: deviceForm.deviceName })
      });
      const data = await res.json();
      showNotification(data.message);
      if (data.success) {
        loadDevices();
        setEditingDevice(null);
        setDeviceForm({ deviceName: '', deviceId: '' });
        setShowDeviceManager(false);
      }
    } catch (err) {
      console.error('更新设备失败:', err);
      showNotification('更新失败');
    }
  };

  // 删除设备
  const deleteDevice = async (deviceId: string) => {
    if (!confirm('确定要删除这个设备吗？')) return;

    try {
      const res = await fetch(`${API_BASE}/api/devices/${deviceId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      showNotification(data.message);
      if (data.success) {
        loadDevices();
      }
    } catch (err) {
      console.error('删除设备失败:', err);
      showNotification('删除失败');
    }
  };

  const startEditDevice = (device: Device) => {
    setEditingDevice(device);
    setDeviceForm({
      deviceName: device.deviceName,
      deviceId: device.deviceId
    });
    setShowDeviceManager(true);
  };

  const sendCommand = async (command: string, params?: any) => {
    try {
      const res = await fetch(`${API_BASE}/api/send-command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, params, targetHostId: selectedDevice?.deviceId })
      });
      const data = await res.json();
      showNotification(data.message);
    } catch (err) {
      console.error('send command failed:', err);
      showNotification('命令发送失败');
    }
  };

  // 切换画质
  const changeQuality = (mode: 'gaming' | 'low_latency') => {
    const modeNames = {
      gaming: '1080p 60FPS',
      low_latency: '720p 60FPS'
    } as const;

    if (!selectedDeviceRef.current) {
      showNotification('请先选择在线设备');
      return;
    }

    setCurrentQuality(mode);
    setShowQualityMenu(false);

    if (!isPlaying || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      showNotification(`已设置为 ${modeNames[mode]}，下次连接生效`);
      return;
    }

    try {
      const message = {
        type: 'change_quality',
        target: 'host',
        targetHostId: selectedDeviceRef.current.deviceId,
        mode
      };

      wsRef.current.send(JSON.stringify(message));
      if (USE_SRS_WHEP) {
        showNotification(`已切换到 ${modeNames[mode]}，重新连接后生效`);
      } else {
        showNotification(`已切换到 ${modeNames[mode]}`);
      }
      console.log('quality change request sent');
    } catch (err) {
      console.error('❌ 切换画质失败:', err);
      showNotification('画质切换请求发送失败');
    }
  };

  // 1. 初始化信令服务器连接
  useEffect(() => {
    let isMounted = true;

    const connectWS = () => {
      if (!isMounted) return;
      try {
        const ws = new WebSocket(SIGNALING_WS_URL);
        wsRef.current = ws;
        suppressWsErrorRef.current = false;

        ws.onopen = () => {
          try {
            console.log('Connected to signaling server');
            setStatus('已连接服务器，准备就绪');
            ws.send(JSON.stringify({ type: 'register_client' }));
          } catch (err) {
            console.error('WebSocket onopen error:', err);
          }
        };

        ws.onmessage = async (event) => {
          try {
            if (event.data instanceof Blob) {
              const url = URL.createObjectURL(event.data);
              if (imgRef.current) {
                imgRef.current.src = url;
              }
              return;
            }
            
            // 处理 JSON 数据（信令消息）
            const msg = JSON.parse(event.data);
            if (!msg || typeof msg !== 'object') return;
            const msgSessionId = typeof msg.sessionId === 'string' ? msg.sessionId : null;
            if (msgSessionId && signalingSessionIdRef.current && msgSessionId !== signalingSessionIdRef.current) {
              return;
            }

            const activeHostId = selectedDeviceRef.current?.deviceId;
            const needsHostMatch = msg.type === 'answer' || msg.type === 'ice_candidate' || msg.type === 'renegotiate' || msg.type === 'renegotiate_answer';
            if (needsHostMatch && msg.targetHostId && activeHostId && msg.targetHostId !== activeHostId) {
              return;
            }
            
            if (msg.type === 'device_list') {
              console.log('收到设备列表:', msg.devices);
              // 不再使用 WebSocket 的设备列表，改用 API 获取
              loadDevices();
            } else if (msg.type === 'host_available') {
              console.log('新设备上线:', msg.hostName, msg.hostId);
              // 设备上线时刷新列表
              loadDevices();
              showNotification(`设备上线: ${msg.hostName}`);
            } else if (msg.type === 'host_disconnected') {
              console.log('设备离线:', msg.hostId);
              loadDevices();
              showNotification('设备已离线');
            } else if (msg.type === 'instance_started') {
              console.log('应用实例启动:', msg.instance);
              loadRunningInstances();
            } else if (msg.type === 'instance_stopped') {
              console.log('应用实例停止:', msg.instanceId);
              loadRunningInstances();
            } else if (msg.type === 'control_pong') {
              const targetHostId = typeof msg.targetHostId === 'string' ? msg.targetHostId : '';
              const selectedHostId = selectedDeviceRef.current?.deviceId || '';
              if (targetHostId && selectedHostId && targetHostId !== selectedHostId) {
                return;
              }

              const pingTs = Number(msg.pingTs || 0);
              const attemptId = Number(msg.attemptId || 0);
              if (!Number.isFinite(pingTs) || pingTs <= 0) {
                return;
              }
              if (attemptId > 0 && attemptId !== connectAttemptIdRef.current) {
                return;
              }

              const now = Date.now();
              const sample = Math.max(0, now - pingTs);
              setControlLatency((prev) => (prev > 0 ? Math.round(prev * 0.6 + sample * 0.4) : sample));
            } else if (msg.type === 'fps_update') {
              // 接收FPS更新
              if (typeof msg.fps === 'number') {
                setFps(msg.fps);
              }
            } else if (msg.type === 'performance_stats') {
              // 接收性能指标更新
              if (typeof msg.rtt === 'number') setRtt(msg.rtt);
              if (typeof msg.latency === 'number') setLatency(msg.latency);
              if (typeof msg.bitrate === 'number') setBitrate(msg.bitrate);
              if (typeof msg.packetLoss === 'number') setPacketLoss(msg.packetLoss);
              if (typeof msg.fps === 'number') setFps(msg.fps);
              if (typeof msg.availableOutgoingKbps === 'number') {
                setAvailableOutgoingKbps(msg.availableOutgoingKbps);
              }
              const localType = typeof msg.localCandidateType === 'string' ? msg.localCandidateType : 'unknown';
              const remoteType = typeof msg.remoteCandidateType === 'string' ? msg.remoteCandidateType : 'unknown';
              const protocol = typeof msg.candidateProtocol === 'string' ? msg.candidateProtocol : 'unknown';
              setCandidatePath(`${localType} -> ${remoteType} (${protocol})`);
              if (msg.transportMode === 'direct' || msg.transportMode === 'relay') {
                setConnectionMode(msg.transportMode);
              }
            } else if (msg.type === 'renegotiate' && pcRef.current && !USE_SRS_WHEP) {
              // 处理画质切换后的重新协商
              console.log('📺 收到重新协商请求，正在应用新画质配置...');
              console.log('Received renegotiate offer SDP:', msg.offer.sdp);
              
              try {
                if (pcRef.current.signalingState !== 'stable') {
                  console.warn(`忽略 renegotiate，当前状态: ${pcRef.current.signalingState}`);
                  return;
                }
                await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.offer));
                const answer = await pcRef.current.createAnswer();
                await pcRef.current.setLocalDescription(answer);
                
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({
                    type: 'renegotiate_answer',
                    target: 'host',
                    targetHostId: selectedDeviceRef.current?.deviceId,
                    sessionId: signalingSessionIdRef.current,
                    answer: { type: answer.type, sdp: answer.sdp }
                  }));
                  console.log('renegotiation finished');
                }
              } catch (err) {
                console.error('重新协商失败:', err);
              }
            } else if (msg.type === 'answer' && pcRef.current && !USE_SRS_WHEP) {
              if (!msg.answer?.sdp || !msg.answer?.type) {
                return;
              }
              if (pcRef.current.signalingState !== 'have-local-offer') {
                console.warn(`忽略重复/过期 answer，当前状态: ${pcRef.current.signalingState}`);
                return;
              }
              console.log('收到主机 Answer，正在建立 P2P 连接...');
              console.log('Received answer SDP:', msg.answer.sdp);
              await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.answer));
              // 处理队列中的 candidate
              while (candidatesQueue.current.length > 0) {
                const candidate = candidatesQueue.current.shift();
                if (candidate) {
                  try {
                    await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                  } catch (err) {
                    console.warn('丢弃过期 candidate:', err);
                  }
                }
              }
            } else if (msg.type === 'ice_candidate' && pcRef.current && !USE_SRS_WHEP) {
              if (!msg.candidate) return;
              if (pcRef.current.remoteDescription) {
                try {
                  await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate));
                } catch (err) {
                  console.warn('addIceCandidate ignored:', err);
                }
              } else {
                candidatesQueue.current.push(msg.candidate);
              }
            }
          } catch (err) {
            console.error('处理信令消息失败:', err);
          }
        };

        ws.onerror = (err) => {
          if (suppressWsErrorRef.current) return;
          console.error('WebSocket error:', err);
        };

        ws.onclose = () => {
          try {
            if (!isMounted) return;
            setStatus('信令服务已断开，请刷新页面重新连接');
            setIsConnecting(false);
            setIsPlaying(false);
            stopWhepStats();
            stopControlPing();
            setControlLatency(0);
            connectionLockRef.current = false;
            signalingSessionIdRef.current = null;
            setConnectionMode('unknown');
            setShowP2PFileTransfer(false);
            flushPressedInputs();
            if (dcRef.current) {
              dcRef.current.close();
              dcRef.current = null;
            }
            if (pcRef.current) {
              pcRef.current.close();
              pcRef.current = null;
            }
            if (whepResourceUrlRef.current) {
              const resourceUrl = whepResourceUrlRef.current;
              whepResourceUrlRef.current = null;
              void fetch(resourceUrl, { method: 'DELETE' }).catch(() => {
                // ignore teardown errors
              });
            }
            if (videoRef.current) {
              videoRef.current.pause();
              videoRef.current.srcObject = null;
            }
          } catch (err) {
            console.error('WebSocket onclose error:', err);
          }
        };
      } catch (err) {
        console.error('websocket setup failed:', err);
        setStatus('连接服务器失败，请刷新重试');
      }
    };

    connectWS();

    return () => {
      isMounted = false;
      suppressWsErrorRef.current = true;
      if (wsRef.current) wsRef.current.close();
      pressedKeysRef.current.clear();
      pressedMouseButtonsRef.current.clear();
      stopWhepStats();
      stopControlPing();
      connectionLockRef.current = false;
      signalingSessionIdRef.current = null;
      if (dcRef.current) {
        dcRef.current.close();
        dcRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      if (whepResourceUrlRef.current) {
        const resourceUrl = whepResourceUrlRef.current;
        whepResourceUrlRef.current = null;
        void fetch(resourceUrl, { method: 'DELETE' }).catch(() => {
          // ignore teardown errors
        });
      }
    };
  }, [flushPressedInputs, stopControlPing, stopWhepStats]);

  const startSrsWhepStream = useCallback(async (targetDevice: Device) => {
    const whepEndpoint = resolveWhepEndpoint(currentQuality);
    if (!whepEndpoint) {
      setStatus('未配置 SRS WHEP 地址，请设置 VITE_SRS_WHEP_URL');
      setIsConnecting(false);
      connectionLockRef.current = false;
      showNotification('缺少 WHEP 地址配置');
      return;
    }

    const attemptId = connectAttemptIdRef.current + 1;
    connectAttemptIdRef.current = attemptId;
    stopWhepStats();
    stopControlPing();
    setControlLatency(0);
    candidatesQueue.current = [];
    signalingSessionIdRef.current = null;

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }
    if (whepResourceUrlRef.current) {
      const oldResource = whepResourceUrlRef.current;
      whepResourceUrlRef.current = null;
      void fetch(oldResource, { method: 'DELETE' }).catch(() => {
        // ignore stale session cleanup failures
      });
    }

    const turnServer: RTCIceServer = {
      urls: buildTurnUrls(),
      username: TURN_USERNAME,
      credential: TURN_CREDENTIAL
    };
    const iceServers: RTCIceServer[] = FORCE_RELAY_ONLY
      ? [turnServer]
      : [{ urls: 'stun:stun.l.google.com:19302' }, turnServer];

    const pc = new RTCPeerConnection({
      iceServers,
      iceTransportPolicy: FORCE_RELAY_ONLY ? 'relay' : 'all'
    });
    pcRef.current = pc;
    setConnectionMode(FORCE_RELAY_ONLY ? 'relay' : 'unknown');

    pc.oniceconnectionstatechange = () => {
      if (connectAttemptIdRef.current !== attemptId) return;
      const state = pc.iceConnectionState;
      console.log(`ICE state (WHEP): ${state}`);
      if (state === 'connected' || state === 'completed') {
        if (whepDisconnectTimerRef.current) {
          clearTimeout(whepDisconnectTimerRef.current);
          whepDisconnectTimerRef.current = null;
        }
        setIsConnecting(false);
        connectionLockRef.current = false;
        if (FORCE_RELAY_ONLY) {
          setConnectionMode('relay');
        }
        setStatus('WHEP 已连接，正在接收画面...');
        startControlPing(attemptId, targetDevice.deviceId);
        return;
      }
      if (state === 'disconnected') {
        setStatus('链路波动中，正在尝试恢复...');
        if (!whepDisconnectTimerRef.current) {
          whepDisconnectTimerRef.current = setTimeout(() => {
            if (connectAttemptIdRef.current !== attemptId) return;
            if (!pcRef.current || pcRef.current !== pc) return;
            if (pc.iceConnectionState === 'disconnected') {
              setStatus('WHEP 已断开，请点击重新连接');
              setIsPlaying(false);
              stopControlPing();
            }
            whepDisconnectTimerRef.current = null;
          }, 6000);
        }
        return;
      }
      if (state === 'failed' || state === 'closed') {
        setIsConnecting(false);
        connectionLockRef.current = false;
        setIsPlaying(false);
        stopControlPing();
        setStatus('WHEP 连接失败，请检查 SRS/网络配置');
      }
    };

    pc.ontrack = (event) => {
      if (connectAttemptIdRef.current !== attemptId) return;
      const stream = event.streams?.[0] ?? new MediaStream([event.track]);
      if (!videoRef.current) return;

      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      videoRef.current.muted = !USE_SRS_WHEP;
      videoRef.current.play()
        .then(() => {
          setIsPlaying(true);
          setIsConnecting(false);
          connectionLockRef.current = false;
          startControlPing(attemptId, targetDevice.deviceId);
          setStatus('');
        })
        .catch((err) => {
          console.error('WHEP video play failed:', err);
          setIsConnecting(false);
          connectionLockRef.current = false;
          setStatus('画面播放被浏览器拦截，请点击画面重试');
        });
    };

    const videoTransceiver = pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    if (typeof RTCRtpReceiver !== 'undefined' && 'getCapabilities' in RTCRtpReceiver) {
      const capabilities = RTCRtpReceiver.getCapabilities('video');
      if (capabilities?.codecs?.length && 'setCodecPreferences' in videoTransceiver) {
        const preferredCodecs = capabilities.codecs
          .filter((codec) => {
            const mime = codec.mimeType.toLowerCase();
            return mime.startsWith('video/') && mime !== 'video/red' && mime !== 'video/ulpfec' && mime !== 'video/flexfec-03';
          })
          .sort((a, b) => {
            const rank = (mimeType: string) => {
              const mime = mimeType.toLowerCase();
              if (mime === 'video/h264') return 0;
              if (mime === 'video/vp9') return 1;
              if (mime === 'video/vp8') return 2;
              return 3;
            };
            return rank(a.mimeType) - rank(b.mimeType);
          });
        if (preferredCodecs.length > 0) {
          videoTransceiver.setCodecPreferences(preferredCodecs);
        }
      }
    }

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceGatheringComplete(pc);

      const localSdp = pc.localDescription?.sdp || offer.sdp || '';
      const response = await fetch(whepEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp'
        },
        body: localSdp
      });

      if (!response.ok) {
        throw new Error(`WHEP negotiate failed (${response.status})`);
      }

      const answerSdp = await response.text();
      const resourceLocation = response.headers.get('Location') || response.headers.get('location');
      if (resourceLocation) {
        whepResourceUrlRef.current = new URL(resourceLocation, whepEndpoint).toString();
      }
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      startWhepStats(pc, attemptId);

      setStatus(`已连接 SRS，正在拉流: ${targetDevice.deviceName}`);
    } catch (err) {
      console.error('WHEP startup failed:', err);
      if (pcRef.current === pc) {
        pc.close();
        pcRef.current = null;
      }
      stopControlPing();
      setIsConnecting(false);
      connectionLockRef.current = false;
      setConnectionMode('unknown');
      setStatus('WHEP 启动失败，请检查 SRS 地址和服务状态');
      showNotification('WHEP 建连失败');
    }
  }, [
    currentQuality,
    resolveWhepEndpoint,
    startControlPing,
    startWhepStats,
    stopControlPing,
    stopWhepStats,
    waitIceGatheringComplete
  ]);

  // 2. 启动游戏串流（直连优先，TURN 兜底）
  const startGame = async (targetDevice?: Device) => {
    if (isConnecting || connectionLockRef.current) {
      return;
    }

    if (!targetDevice) {
      if (selectedDeviceRef.current?.online) {
        targetDevice = selectedDeviceRef.current;
      } else {
        const onlineDevices = devices.filter((d) => d.online);
        if (onlineDevices.length === 0) {
          showNotification('没有在线设备');
          return;
        }
        if (onlineDevices.length > 1) {
          showNotification('请先在左侧选择一个在线设备');
          return;
        }
        targetDevice = onlineDevices[0];
      }
    }

    if (!targetDevice.online) {
      showNotification('该设备不在线');
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      showNotification('信令服务未连接，请刷新页面后重试');
      setStatus('信令服务未连接');
      setIsConnecting(false);
      return;
    }

    connectionLockRef.current = true;
    setSelectedDevice(targetDevice);
    selectedDeviceRef.current = targetDevice;
    setIsConnecting(true);
    setIsPlaying(false);
    setFps(0);
    setBitrate(0);
    setAvailableOutgoingKbps(0);
    setCandidatePath('unknown');
    setRtt(0);
    setLatency(0);
    setControlLatency(0);
    setPacketLoss(0);
    setConnectionMode(
      USE_SRS_WHEP
        ? (FORCE_RELAY_ONLY ? 'relay' : 'unknown')
        : (FORCE_RELAY_ONLY ? 'relay' : 'direct')
    );
    setStatus(
      FORCE_RELAY_ONLY
        ? `正在通过 TURN 中继连接 ${targetDevice.deviceName}...`
        : `正在直连 ${targetDevice.deviceName}...`
    );

    wsRef.current.send(JSON.stringify({
      type: 'change_quality',
      target: 'host',
      targetHostId: targetDevice.deviceId,
      mode: currentQuality
    }));

    if (USE_SRS_WHEP) {
      setStatus(`正在连接 SRS WHEP 流: ${targetDevice.deviceName}...`);
      await startSrsWhepStream(targetDevice);
      return;
    }

    const attemptId = connectAttemptIdRef.current + 1;
    connectAttemptIdRef.current = attemptId;

    let relayFallbackTriggered = false;
    let directTimer: ReturnType<typeof setTimeout> | null = null;

    const clearDirectTimer = () => {
      if (directTimer) {
        clearTimeout(directTimer);
        directTimer = null;
      }
    };

    const cleanupPeerConnection = () => {
      flushPressedInputs();
      signalingSessionIdRef.current = null;
      if (iceDisconnectTimerRef.current) {
        clearTimeout(iceDisconnectTimerRef.current);
        iceDisconnectTimerRef.current = null;
      }
      if (dcRef.current) {
        dcRef.current.close();
        dcRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      candidatesQueue.current = [];
    };

    const connectWithPolicy = async (useRelay: boolean) => {
      if (connectAttemptIdRef.current !== attemptId) return;

      cleanupPeerConnection();

      const iceServers: RTCIceServer[] = useRelay
        ? [{
            urls: buildTurnUrls(),
            username: TURN_USERNAME,
            credential: TURN_CREDENTIAL
          }]
        : [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun.qq.com:3478' }
          ];

      const pc = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: useRelay ? 'relay' : 'all'
      });
      pcRef.current = pc;
      const sessionId = `${attemptId}-${useRelay ? 'relay' : 'direct'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      signalingSessionIdRef.current = sessionId;

      const fallbackToRelay = () => {
        if (useRelay || relayFallbackTriggered || connectAttemptIdRef.current !== attemptId) return;
        relayFallbackTriggered = true;
        clearDirectTimer();
        stopControlPing();
        setControlLatency(0);
        if (iceDisconnectTimerRef.current) {
          clearTimeout(iceDisconnectTimerRef.current);
          iceDisconnectTimerRef.current = null;
        }
        setConnectionMode('relay');
        setStatus('直连未成功，正在切换 TURN 中继...');
        showNotification('直连不可用，已切换 TURN 中继');
        void connectWithPolicy(true);
      };

      const dc = pc.createDataChannel('input');
      dcRef.current = dc;
      dc.onopen = () => {
        console.log(`DataChannel ready (${useRelay ? 'TURN relay' : 'direct'})`);
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        wsRef.current.send(JSON.stringify({
          type: 'ice_candidate',
          target: 'host',
          targetHostId: targetDevice.deviceId,
          sessionId,
          candidate: event.candidate
        }));
      };

      pc.oniceconnectionstatechange = () => {
        if (connectAttemptIdRef.current !== attemptId) return;
        const state = pc.iceConnectionState;
        console.log(`ICE state (${useRelay ? 'TURN' : 'direct'}): ${state}`);

        if (state === 'connected' || state === 'completed') {
          clearDirectTimer();
          if (iceDisconnectTimerRef.current) {
            clearTimeout(iceDisconnectTimerRef.current);
            iceDisconnectTimerRef.current = null;
          }
          setConnectionMode(useRelay ? 'relay' : 'direct');
          setIsConnecting(false);
          connectionLockRef.current = false;
          startControlPing(attemptId, targetDevice.deviceId);
          setStatus(useRelay ? 'TURN 中继连接成功，正在接收画面...' : '直连成功，正在接收画面...');
          return;
        }

        if (!useRelay && state === 'disconnected') {
          if (!iceDisconnectTimerRef.current) {
            iceDisconnectTimerRef.current = setTimeout(() => {
              if (connectAttemptIdRef.current !== attemptId) return;
              if (pcRef.current !== pc) return;
              if (pc.iceConnectionState === 'disconnected') {
                fallbackToRelay();
              }
            }, 3000);
          }
          return;
        }

        if (!useRelay && state === 'failed') {
          if (iceDisconnectTimerRef.current) {
            clearTimeout(iceDisconnectTimerRef.current);
            iceDisconnectTimerRef.current = null;
          }
          fallbackToRelay();
          return;
        }

        if (state === 'closed') {
          if (iceDisconnectTimerRef.current) {
            clearTimeout(iceDisconnectTimerRef.current);
            iceDisconnectTimerRef.current = null;
          }
        }

        if (useRelay && (state === 'failed' || state === 'closed')) {
          clearDirectTimer();
          if (iceDisconnectTimerRef.current) {
            clearTimeout(iceDisconnectTimerRef.current);
            iceDisconnectTimerRef.current = null;
          }
          stopControlPing();
          setIsConnecting(false);
          connectionLockRef.current = false;
          setConnectionMode('unknown');
          setStatus('连接失败，请检查 TURN 配置或网络');
        }
      };

      pc.ontrack = (event) => {
        if (connectAttemptIdRef.current !== attemptId) return;
        const stream = event.streams?.[0] ?? new MediaStream([event.track]);
        if (!videoRef.current) return;

        if (videoRef.current.srcObject !== stream) {
          videoRef.current.srcObject = stream;
        }
        videoRef.current.muted = !USE_SRS_WHEP;
        videoRef.current.play()
          .then(() => {
            setIsPlaying(true);
            setIsConnecting(false);
            connectionLockRef.current = false;
            startControlPing(attemptId, targetDevice.deviceId);
            setConnectionMode(useRelay ? 'relay' : 'direct');
            setStatus('');
          })
          .catch((err) => {
            console.error('video play failed:', err);
            setIsConnecting(false);
            connectionLockRef.current = false;
            setStatus('画面播放被浏览器拦截，请点击画面重试');
          });
      };

      const transceiver = pc.addTransceiver('video', { direction: 'recvonly' });
      if (typeof RTCRtpReceiver !== 'undefined' && 'getCapabilities' in RTCRtpReceiver) {
        const capabilities = RTCRtpReceiver.getCapabilities('video');
        if (capabilities?.codecs?.length) {
          console.log('Browser video codecs:', capabilities.codecs.map((c) => c.mimeType).join(', '));
          if ('setCodecPreferences' in transceiver) {
            const preferredCodecs = capabilities.codecs
              .filter((codec) => {
                const mime = codec.mimeType.toLowerCase();
                return mime.startsWith('video/') && mime !== 'video/red' && mime !== 'video/ulpfec' && mime !== 'video/flexfec-03';
              })
              .sort((a, b) => {
                const rank = (mimeType: string) => {
                  const mime = mimeType.toLowerCase();
                  if (mime === 'video/h264') return 0;
                  if (mime === 'video/vp9') return 1;
                  if (mime === 'video/vp8') return 2;
                  return 3;
                };
                return rank(a.mimeType) - rank(b.mimeType);
              });
            if (preferredCodecs.length > 0) {
              transceiver.setCodecPreferences(preferredCodecs);
            }
          }
        }
      }
      void transceiver;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      wsRef.current?.send(JSON.stringify({
        type: 'offer',
        target: 'host',
        targetHostId: targetDevice.deviceId,
        sessionId,
        transportMode: useRelay ? 'relay' : 'direct',
        offer: { type: offer.type, sdp: offer.sdp }
      }));

      if (!useRelay) {
        clearDirectTimer();
        directTimer = setTimeout(() => {
          if (connectAttemptIdRef.current !== attemptId) return;
          const iceState = pcRef.current?.iceConnectionState;
          if (iceState !== 'connected' && iceState !== 'completed') {
            fallbackToRelay();
          }
        }, DIRECT_CONNECT_TIMEOUT_MS);
      }
    };

    try {
      await connectWithPolicy(FORCE_RELAY_ONLY);
    } catch (err) {
      console.error('❌ 启动串流失败:', err);
      setStatus('启动失败，请查看控制台错误');
      setIsConnecting(false);
      connectionLockRef.current = false;
      clearDirectTimer();
    }
  };

  // 3. 键盘鼠标输入捕获逻辑
  const sendInput = (data: Record<string, unknown>) => {
    try {
      if (USE_SRS_WHEP) {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'input',
            ...data,
            targetHostId: selectedDeviceRef.current?.deviceId
          }));
        }
        return;
      }

      if (dcRef.current && dcRef.current.readyState === 'open') {
        dcRef.current.send(JSON.stringify({
          ...data,
          targetHostId: selectedDeviceRef.current?.deviceId
        }));
      }
    } catch (err) {
      console.error('发送输入指令失败:', err);
    }
  };

  const releaseMouseButtons = () => {
    if (pressedMouseButtonsRef.current.size === 0) return;
    pressedMouseButtonsRef.current.forEach((button) => {
      sendInput({ action: 'mouseup', button });
    });
    pressedMouseButtonsRef.current.clear();
  };

  const lastMoveTime = useRef<number>(0);

  const handleMouseMove = (e: React.MouseEvent<HTMLVideoElement>) => {
    try {
      if (!videoRef.current) return;

      const now = performance.now();
      if (isPlaying && now - lastMoveTime.current < INPUT_MOUSE_INTERVAL_MS) return;
      lastMoveTime.current = now;

      const video = videoRef.current;
      const rect = video.getBoundingClientRect();
      setCursorPos({ x: e.clientX, y: e.clientY });

      if (!isPlaying) return;

      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      if (!videoWidth || !videoHeight) return;

      const scale = Math.min(rect.width / videoWidth, rect.height / videoHeight);
      const renderedWidth = videoWidth * scale;
      const renderedHeight = videoHeight * scale;
      const offsetX = (rect.width - renderedWidth) / 2;
      const offsetY = (rect.height - renderedHeight) / 2;

      const x = (e.clientX - rect.left - offsetX) / renderedWidth;
      const y = (e.clientY - rect.top - offsetY) / renderedHeight;

      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        sendInput({
          action: 'mousemove',
          x: Number(x.toFixed(4)),
          y: Number(y.toFixed(4))
        });
      }
    } catch (err) {
      console.error('mousemove error:', err);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLVideoElement>) => {
    try {
      if (!isPlaying || showP2PFileTransfer) return;
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      pressedMouseButtonsRef.current.add(e.button);
      sendInput({ action: 'mousedown', button: e.button });
    } catch (err) {
      console.error('mousedown error:', err);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLVideoElement>) => {
    try {
      if (!isPlaying || showP2PFileTransfer) return;
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      pressedMouseButtonsRef.current.delete(e.button);
      sendInput({ action: 'mouseup', button: e.button });
    } catch (err) {
      console.error('mouseup error:', err);
    }
  };

  const handleMouseLeave = () => {
    if (!isPlaying) return;
    releaseMouseButtons();
  };

  const handleWheel = (e: React.WheelEvent<HTMLVideoElement>) => {
    try {
      if (!isPlaying || showP2PFileTransfer) return;
      e.preventDefault();
      e.stopPropagation();

      const scrollAmount = Math.sign(e.deltaY) * Math.max(1, Math.abs(Math.round(e.deltaY / 80)));
      if (scrollAmount !== 0) {
        sendInput({ action: 'wheel', delta: scrollAmount });
      }
    } catch (err) {
      console.error('wheel error:', err);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      try {
        if (!isPlaying || showP2PFileTransfer) return;
        if (isEditableElement(e.target)) return;
        if (!isGameControlKey(e.code)) return;

        const keyId = e.code || e.key;
        if (!keyId || pressedKeysRef.current.has(keyId)) {
          e.preventDefault();
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        pressedKeysRef.current.set(keyId, { key: e.key, code: e.code });
        sendInput({ action: 'keydown', key: e.key, code: e.code, repeat: Boolean(e.repeat) });
      } catch (err) {
        console.error('keydown error:', err);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      try {
        if (!isPlaying || showP2PFileTransfer) return;
        if (isEditableElement(e.target)) return;
        if (!isGameControlKey(e.code)) return;

        const keyId = e.code || e.key;
        const pressed = keyId ? pressedKeysRef.current.get(keyId) : undefined;
        if (keyId) {
          pressedKeysRef.current.delete(keyId);
        }

        e.preventDefault();
        e.stopPropagation();

        sendInput({
          action: 'keyup',
          key: pressed?.key ?? e.key,
          code: pressed?.code ?? e.code
        });
      } catch (err) {
        console.error('keyup error:', err);
      }
    };

    const handleBlur = () => {
      if (!isPlaying) return;
      flushPressedInputs();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        flushPressedInputs();
      }
    };

    const shouldCaptureInput = isPlaying && !showP2PFileTransfer;
    const releaseOnLeave = () => {
      if (!isPlaying) return;
      flushPressedInputs();
    };

    const stopBrowserDefault = (e: Event, stopBubble = true) => {
      e.preventDefault();
      if (stopBubble) {
        e.stopPropagation();
      }
      (e as Event & { stopImmediatePropagation?: () => void }).stopImmediatePropagation?.();
    };

    const handleContextMenu = (e: MouseEvent) => {
      if (!shouldCaptureInput) return;
      stopBrowserDefault(e);
    };

    const handleAuxClick = (e: MouseEvent) => {
      if (!shouldCaptureInput) return;
      if (e.button === 1 || e.button === 2) {
        stopBrowserDefault(e);
      }
    };

    const handleMouseDownGlobal = (e: MouseEvent) => {
      if (!shouldCaptureInput) return;
      if (e.button === 2) {
        // Block browser menu but keep event flow to video target so right click still reaches host.
        stopBrowserDefault(e, false);
      }
    };

    const previousUserSelect = document.body.style.userSelect;
    const previousWebkitUserSelect = (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect;
    if (shouldCaptureInput) {
      document.body.style.userSelect = 'none';
      (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = 'none';
    }

    window.addEventListener('keydown', handleKeyDown, { passive: false, capture: true });
    window.addEventListener('keyup', handleKeyUp, { passive: false, capture: true });
    window.addEventListener('blur', handleBlur);
    window.addEventListener('pagehide', releaseOnLeave);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('contextmenu', handleContextMenu, true);
    window.addEventListener('auxclick', handleAuxClick, true);
    document.addEventListener('auxclick', handleAuxClick, true);
    window.addEventListener('mousedown', handleMouseDownGlobal, true);
    document.addEventListener('mousedown', handleMouseDownGlobal, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('pagehide', releaseOnLeave);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('contextmenu', handleContextMenu, true);
      window.removeEventListener('auxclick', handleAuxClick, true);
      document.removeEventListener('auxclick', handleAuxClick, true);
      window.removeEventListener('mousedown', handleMouseDownGlobal, true);
      document.removeEventListener('mousedown', handleMouseDownGlobal, true);
      document.body.style.userSelect = previousUserSelect;
      (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect = previousWebkitUserSelect;
      flushPressedInputs();
    };
  }, [isPlaying, showP2PFileTransfer, flushPressedInputs]);
  // 如果显示用户资料页面
  if (showUserProfile) {
    return (
      <UserProfile
        onBack={() => setShowUserProfile(false)}
        userData={userData}
        usageTime={getUsageTime()}
        onLogout={handleLogout}
      />
    );
  }

  // 渲染运行实例页面（覆盖在所有模式之上）
  const renderInstancesPage = () => {
    if (!showInstancesPage) return null;
    
    const gamingInstances = runningInstances.filter(inst => inst.category === 'gaming');
    const industrialInstances = runningInstances.filter(inst => inst.category === 'industrial');
    const remoteInstances = runningInstances.filter(inst => !inst.category || inst.category === 'remote');
    
    // 渲染单个实例卡片
    const renderInstanceCard = (instance: RunningInstance) => {
      const device = devices.find(d => d.deviceId === instance.deviceId);
      const categoryLabel = instance.category === 'gaming'
        ? '云游戏'
        : instance.category === 'industrial'
          ? '工业应用'
          : '远程办公';
      const categoryColor = instance.category === 'gaming' ? '#8b5cf6' : 
                           instance.category === 'industrial' ? '#3b82f6' : 
                           '#10b981';
      
      return (
        <div key={instance.instanceId} className="instance-card-large">
          <div className="instance-card-header">
            <span className="app-icon-large">{instance.appIcon}</span>
            <div className="instance-card-info">
              <div className="instance-card-name">{instance.appName}</div>
              <div className="instance-card-meta">
                <span 
                  className="instance-category-badge" 
                  style={{ 
                    background: `${categoryColor}20`, 
                    color: categoryColor,
                    border: `1px solid ${categoryColor}40`
                  }}
                >
                  {categoryLabel}
                </span>
                <span className="instance-card-device">
                  📱 {device?.deviceName || '未知设备'}
                </span>
              </div>
            </div>
            <button
              onClick={() => stopInstance(instance.instanceId)}
              className="stop-instance-btn"
              title="停止应用"
            >
              <Trash2 size={18} />
            </button>
          </div>
          <div className="instance-card-footer">
            <div className="instance-duration">
              ⏱ 运行时长: {getRunningDuration(instance.startedAt)}
            </div>
            <div className="instance-started">
              启动于 {new Date(instance.startedAt).toLocaleString('zh-CN')}
            </div>
          </div>
        </div>
      );
    };
    
    return (
      <div className="instances-page-overlay">
        <div className="instances-page">
          <div className="instances-page-header">
            <h2 className="instances-page-title">运行中的应用</h2>
            <button
              onClick={() => setShowInstancesPage(false)}
              className="close-page-btn"
            >
              ✕
            </button>
          </div>

          <div className="instances-page-content">
            {runningInstances.length === 0 ? (
              <div className="empty-state-large">
                <div className="empty-icon">📱</div>
                <div className="empty-text">暂无运行中的应用</div>
              </div>
            ) : (
              <div className="instances-by-category">
                {/* 云游戏分类 */}
                {gamingInstances.length > 0 && (
                  <div className="category-section">
                    <div className="category-header">
                      <div className="category-icon" style={{ background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)' }}>
                        🎮
                      </div>
                      <h3 className="category-title">云游戏</h3>
                      <span className="category-count">{gamingInstances.length}</span>
                    </div>
                    <div className="instances-grid">
                      {gamingInstances.map(renderInstanceCard)}
                    </div>
                  </div>
                )}
                
                {/* 工业应用分类 */}
                {industrialInstances.length > 0 && (
                  <div className="category-section">
                    <div className="category-header">
                      <div className="category-icon" style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}>
                        ⚙️
                      </div>
                      <h3 className="category-title">工业应用</h3>
                      <span className="category-count">{industrialInstances.length}</span>
                    </div>
                    <div className="instances-grid">
                      {industrialInstances.map(renderInstanceCard)}
                    </div>
                  </div>
                )}
                
                {/* 远程办公分类 */}
                {remoteInstances.length > 0 && (
                  <div className="category-section">
                    <div className="category-header">
                      <div className="category-icon" style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>
                        💼
                      </div>
                      <h3 className="category-title">远程办公</h3>
                      <span className="category-count">{remoteInstances.length}</span>
                    </div>
                    <div className="instances-grid">
                      {remoteInstances.map(renderInstanceCard)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // 如果在首页，显示首页
  if (currentMode === 'home') {
    return (
      <>
        <HomePage 
          onSelectMode={handleModeSelect} 
          usageTime={getUsageTime()}
          isLoggedIn={isLoggedIn}
          setIsLoggedIn={setIsLoggedIn}
          userData={userData}
          setUserData={setUserData}
          onShowUserProfile={() => setShowUserProfile(true)}
        />
        {renderInstancesPage()}
      </>
    );
  }
  
  // 如果在云游戏模式且显示游戏库
  if (currentMode === 'gaming' && showGamingLibrary) {
    return (
      <>
        <GamingMode 
          onBack={handleBackToHome}
          onLaunchGame={handleLaunchGame}
          isLoggedIn={isLoggedIn}
          userData={userData}
          onShowUserProfile={() => setShowUserProfile(true)}
          runningInstances={runningInstances}
          onShowInstances={() => setShowInstancesPage(true)}
        />
        {renderInstancesPage()}
      </>
    );
  }
  
  if (currentMode === 'industrial' && showIndustrialLibrary) {
    return (
      <>
        <IndustrialMode 
          onBack={handleBackToHome}
          onLaunchApp={handleLaunchIndustrialApp}
          isLoggedIn={isLoggedIn}
          userData={userData}
          onShowUserProfile={() => setShowUserProfile(true)}
          runningInstances={runningInstances}
          onShowInstances={() => setShowInstancesPage(true)}
        />
        {renderInstancesPage()}
      </>
    );
  }
  
  // 如果正在运行应用（游戏或工业应用），显示串流视图
  if ((currentMode === 'gaming' && !showGamingLibrary) || 
      (currentMode === 'industrial' && !showIndustrialLibrary)) {
    return (
      <>
        <StreamingView
          onBack={() => {
            stopStreamingSession('已返回应用库');
            if (currentMode === 'gaming') {
              setShowGamingLibrary(true);
            } else if (currentMode === 'industrial') {
              setShowIndustrialLibrary(true);
            }
          }}
          appName={currentAppName}
          appIcon={currentAppIcon}
          videoRef={videoRef}
          isPlaying={isPlaying}
          fps={fps}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onMouseLeave={handleMouseLeave}
          cursorPos={cursorPos}
          showToolbar={showToolbar}
          setShowToolbar={setShowToolbar}
          currentQuality={currentQuality}
          connectionMode={connectionMode}
          onQualityChange={changeQuality}
          rtt={rtt}
          latency={latency}
          controlLatency={controlLatency}
          bitrate={bitrate}
          availableOutgoingKbps={availableOutgoingKbps}
          packetLoss={packetLoss}
          candidatePath={candidatePath}
          muted={!USE_SRS_WHEP}
        />
        {renderInstancesPage()}
      </>
    );
  }

  return (
    <div className="dashboard-container">
      {/* 左侧导航栏 */}
      <div className="dashboard-sidebar">
        <div className="sidebar-header">
          <h1 className="sidebar-logo">
            {currentMode === 'gaming' ? '云游戏' : currentMode === 'industrial' ? '工业应用' : '远程办公'}
          </h1>
          <div className="sidebar-header-row">
            <button 
              onClick={handleBackToHome}
              className="sidebar-back-btn"
            >
              ← 返回首页
            </button>
            {isLoggedIn && (
              <button className="sidebar-user-info" onClick={() => setShowUserProfile(true)}>
                <span className="avatar-icon">{userData.avatar}</span>
                <span className="username">{userData.username}</span>
              </button>
            )}
          </div>
        </div>
        
        {/* 运行中按钮 - 始终显示 */}
        <div className="sidebar-section">
          <button
            onClick={() => setShowInstancesPage(true)}
            className="running-instances-btn"
          >
            <div className="running-btn-content">
              <div className="running-btn-icon">▶</div>
              <div className="running-btn-text">
                <div className="running-btn-title">运行中</div>
                <div className="running-btn-subtitle">
                  {runningInstances.length > 0
                    ? `${runningInstances.length} 个应用正在运行`
                    : '暂无运行中的应用'}
                </div>
              </div>
              {runningInstances.length > 0 && (
                <span className="instance-count">{runningInstances.length}</span>
              )}
            </div>
          </button>
        </div>
        
        {/* 设备列表 */}
        <div className="sidebar-section">
          <div className="section-header">
            <h3 className="section-title">我的设备</h3>
            <button
              onClick={() => {
                setEditingDevice(null);
                setDeviceForm({ deviceName: '', deviceId: '' });
                setShowDeviceManager(true);
              }}
              className="icon-btn"
              title="添加设备"
            >
              <Plus size={16} />
            </button>
          </div>
          <div className="device-list">
            {devices.length === 0 ? (
              <div className="empty-state">暂无设备</div>
            ) : (
              devices.map(device => (
                <div
                  key={device.deviceId}
                  className={`device-card ${selectedDevice?.deviceId === device.deviceId ? 'active' : ''} ${!device.online ? 'offline' : ''}`}
                  onClick={() => handleDeviceSelect(device)}
                >
                  <div className="device-status">
                    <span className={`status-dot ${device.online ? 'online' : 'offline'}`}></span>
                  </div>
                  <div className="device-info">
                    <div className="device-name">{device.deviceName}</div>
                    <div className="device-meta">
                      {device.online ? '在线' : '离线'}
                    </div>
                  </div>
                  <div className="device-actions">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditDevice(device);
                      }}
                      className="action-icon-btn"
                      title="编辑"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteDevice(device.deviceId);
                      }}
                      className="action-icon-btn danger"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 应用列表 */}
        {selectedDevice && (
          <div className="sidebar-section">
            <div className="section-header">
              <h3 className="section-title">应用</h3>
              <button
                onClick={() => {
                  setEditingApp(null);
                  setAppForm({ name: '', icon: '⚙️', description: '', path: '' });
                  setShowAppManager(true);
                }}
                className="icon-btn"
                title="添加应用"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="app-list-sidebar">
              {apps.length === 0 ? (
                <div className="empty-state">暂无应用</div>
              ) : (
                apps.map(app => (
                  <div key={app.id} className="app-card-sidebar">
                    <button
                      onClick={() => launchApp(app.id)}
                      className="app-card-btn"
                    >
                      <span className="app-icon-small">{app.icon}</span>
                      <div className="app-info-small">
                        <div className="app-name-small">{app.name}</div>
                        <div className="app-desc-small">{app.description}</div>
                      </div>
                    </button>
                    {!app.builtin && (
                      <div className="app-card-actions">
                        <button
                          onClick={() => startEditApp(app)}
                          className="action-icon-btn"
                          title="编辑"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => deleteApp(app.id)}
                          className="action-icon-btn danger"
                          title="删除"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* 底部操作按钮 */}
        <div className="sidebar-footer">
          <a 
            href={`${API_BASE}/api/download/host`}
            download="host.exe"
            className="footer-btn"
          >
            <Download size={16} />
            <span>下载 Host</span>
          </a>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="dashboard-main">
        {/* 欢迎屏幕 */}
        {!isPlaying && !isConnecting && (
          <div className="welcome-screen">
            <div className="welcome-content">
              <h2 className="welcome-title">欢迎使用 Cloud Working</h2>
              <p className="welcome-subtitle">{status}</p>
              {selectedDevice ? (
                <div className="welcome-actions">
                  <button 
                    onClick={() => startGame(selectedDevice)}
                    className="primary-btn large"
                    disabled={!selectedDevice.online}
                  >
                    {selectedDevice.online ? `连接到 ${selectedDevice.deviceName}` : '设备离线'}
                  </button>
                </div>
              ) : (
                <div className="welcome-hint">
                  <p>👉 请从右侧选择一个在线设备开始</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 连接中提示 */}
        {isConnecting && !isPlaying && (
          <div className="welcome-screen">
            <div className="welcome-content">
              <h2 className="welcome-title">正在连接...</h2>
              <p className="welcome-subtitle">{status}</p>
            </div>
          </div>
        )}
        
        {/* 视频播放器 - 始终渲染，通过 CSS 控制显示 */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={() => console.log('Video event: loadedmetadata')}
          onCanPlay={() => console.log('Video event: canplay')}
          onPlay={() => console.log('Video event: play')}
          onPlaying={() => {
            console.log('Video event: playing');
            setIsPlaying(true);
            setIsConnecting(false);
            setStatus('');
          }}
          onWaiting={() => console.log('Video event: waiting')}
          onStalled={() => console.log('Video event: stalled')}
          onSuspend={() => console.log('Video event: suspend')}
          onError={(e) => console.error('Video event: error', e.currentTarget.error)}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
          onAuxClick={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
          className="video-player"
          style={{ display: isPlaying ? 'block' : 'none' }}
        />
        
        {/* 自定义鼠标指针 */}
        {isPlaying && (
          <div 
            className="custom-cursor" 
            style={{ 
              left: `${cursorPos.x}px`, 
              top: `${cursorPos.y}px`
            }}
          />
        )}

        {/* FPS 显示 - 左上角 */}
        {isPlaying && fps > 0 && (
          <div 
            className="fps-display"
            style={{
              position: 'absolute',
              top: '60px',
              left: '20px',
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              color: '#00ff00',
              padding: '8px 12px',
              borderRadius: '6px',
              fontSize: '16px',
              fontFamily: 'monospace',
              fontWeight: 'bold',
              zIndex: 15,
              pointerEvents: 'none',
              userSelect: 'none'
            }}
          >
            {Math.round(fps)} FPS
          </div>
        )}

        {/* 文件传输弹窗 */}
        {isPlaying && !USE_SRS_WHEP && showP2PFileTransfer && (
          <P2PFileTransfer
            dataChannel={dcRef.current}
            onClose={() => setShowP2PFileTransfer(false)}
            onNotification={showNotification}
          />
        )}

        {/* 顶部工具栏 */}
        {isPlaying && (
          <>
            {/* 工具栏切换按钮 - 始终可见 */}
            <button
              onClick={() => setShowToolbar(!showToolbar)}
              className="toolbar-toggle-btn"
              style={{
                position: 'absolute',
                top: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 20
              }}
            >
              {showToolbar ? '▼ 隐藏' : '▲ 显示'}
            </button>

            {/* 工具栏内容 */}
            <div className={`video-toolbar ${!showToolbar ? 'hidden' : ''}`}>
              <div className="toolbar-content">
                <div className="toolbar-left">
                  <span className="toolbar-device-name">💻 {selectedDevice?.deviceName}</span>
                </div>
                <div className="toolbar-right">
                  <button
                    onClick={() => {
                      // 切换回桌面捕获
                      launchApp('desktop');
                    }}
                    className="toolbar-icon-btn"
                    title="返回桌面"
                  >
                    <Home size={18} />
                  </button>
                  <button
                    onClick={() => {
                      const mainElement = document.querySelector('.dashboard-main');
                      if (mainElement) {
                        if (document.fullscreenElement) {
                          document.exitFullscreen();
                        } else {
                          mainElement.requestFullscreen();
                        }
                      }
                    }}
                    className="toolbar-icon-btn"
                    title="全屏"
                  >
                    <Maximize size={18} />
                  </button>
                  <button
                    onClick={() => sendCommand('screenshot')}
                    className="toolbar-icon-btn"
                    title="截图"
                  >
                    <Camera size={18} />
                  </button>
                  <button
                    onClick={() => {
                      if (USE_SRS_WHEP) {
                        showNotification('SRS/WHEP 模式暂不支持 DataChannel 文件传输');
                        return;
                      }
                      setShowP2PFileTransfer(!showP2PFileTransfer);
                    }}
                    className="toolbar-icon-btn"
                    title="文件传输"
                    style={{ background: showP2PFileTransfer ? 'rgba(76, 175, 80, 0.3)' : 'transparent' }}
                  >
                    <FolderOpen size={18} />
                  </button>
                  <div style={{ position: 'relative' }}>
                    <button
                      onClick={() => setShowQualityMenu(!showQualityMenu)}
                      className="toolbar-icon-btn"
                      title="画质设置"
                    >
                      <Settings size={18} />
                    </button>
                    {showQualityMenu && (
                      <div className="quality-menu">
                        <button
                          onClick={() => changeQuality('gaming')}
                          className={`quality-option ${currentQuality === 'gaming' ? 'active' : ''}`}
                        >
                          <span className="quality-icon">🎮</span>
                          <div className="quality-info">
                            <div className="quality-name">游戏模式</div>
                            <div className="quality-desc">60 FPS · 1080p</div>
                          </div>
                          {currentQuality === 'gaming' && <span className="quality-check">✓</span>}
                        </button>
                        <button
                          onClick={() => changeQuality('low_latency')}
                          className={`quality-option ${currentQuality === 'low_latency' ? 'active' : ''}`}
                        >
                          <span className="quality-icon">⚡</span>
                          <div className="quality-info">
                            <div className="quality-name">低延迟模式</div>
                            <div className="quality-desc">60 FPS · 720p</div>
                          </div>
                          {currentQuality === 'low_latency' && <span className="quality-check">✓</span>}
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      stopStreamingSession('已断开连接');
                    }}
                    className="toolbar-icon-btn danger"
                    title="断开连接"
                  >
                    <LogOut size={18} />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      
      {/* 设备管理弹窗 */}
      {showDeviceManager && (
        <div 
          className="app-manager"
          onClick={(e) => {
            // 只有点击背景时才关闭
            if (e.target === e.currentTarget) {
              setShowDeviceManager(false);
              setEditingDevice(null);
              setDeviceForm({ deviceName: '', deviceId: '' });
            }
          }}
        >
          <div className="app-manager-content">
            <h2 className="app-manager-title">{editingDevice ? '编辑设备' : '添加设备'}</h2>
            
            <div className="form-group">
              <label className="form-label">设备名称</label>
              <input
                type="text"
                className="form-input"
                value={deviceForm.deviceName}
                onChange={(e) => setDeviceForm({...deviceForm, deviceName: e.target.value})}
                placeholder="例如：我的电脑"
              />
            </div>

            <div className="form-group">
              <label className="form-label">设备ID</label>
              <input
                type="text"
                className="form-input"
                value={deviceForm.deviceId}
                onChange={(e) => setDeviceForm({...deviceForm, deviceId: e.target.value})}
                placeholder="从 host.py 启动日志中复制设备ID"
                disabled={!!editingDevice}
              />
              {!editingDevice && (
                <div className="app-description" style={{marginTop: '8px', fontSize: '12px'}}>
                  提示：运行 host.py 后，从控制台复制显示的设备ID
                </div>
              )}
            </div>

            <div className="form-buttons">
              <button
                onClick={() => {
                  setShowDeviceManager(false);
                  setEditingDevice(null);
                  setDeviceForm({ deviceName: '', deviceId: '' });
                }}
                className="form-btn form-btn-secondary"
              >
                取消
              </button>
              <button
                onClick={editingDevice ? updateDevice : addDevice}
                className="form-btn form-btn-primary"
              >
                {editingDevice ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 应用管理弹窗 */}
      {showAppManager && (
        <div 
          className="app-manager"
          onClick={(e) => {
            // 只有点击背景时才关闭
            if (e.target === e.currentTarget) {
              setShowAppManager(false);
              setEditingApp(null);
              setAppForm({ name: '', icon: '⚙️', description: '', path: '' });
            }
          }}
        >
          <div className="app-manager-content">
            <h2 className="app-manager-title">{editingApp ? '编辑应用' : '添加应用'}</h2>
            
            <div className="form-group">
              <label className="form-label">应用名称</label>
              <input
                type="text"
                className="form-input"
                value={appForm.name}
                onChange={(e) => setAppForm({...appForm, name: e.target.value})}
                placeholder="例如：我的游戏"
              />
            </div>

            <div className="form-group">
              <label className="form-label">图标 (Emoji)</label>
              <input
                type="text"
                className="form-input"
                value={appForm.icon}
                onChange={(e) => setAppForm({...appForm, icon: e.target.value})}
                placeholder="例如：🎮"
              />
            </div>

            <div className="form-group">
              <label className="form-label">描述</label>
              <input
                type="text"
                className="form-input"
                value={appForm.description}
                onChange={(e) => setAppForm({...appForm, description: e.target.value})}
                placeholder="例如：我最喜欢的游戏"
              />
            </div>

            <div className="form-group">
              <label className="form-label">应用路径</label>
              <input
                type="text"
                className="form-input"
                value={appForm.path}
                onChange={(e) => setAppForm({...appForm, path: e.target.value})}
                placeholder="例如：C:\\Games\\MyGame.exe"
              />
            </div>

            <div className="form-buttons">
              <button
                onClick={() => {
                  setShowAppManager(false);
                  setEditingApp(null);
                  setAppForm({ name: '', icon: '⚙️', description: '', path: '' });
                }}
                className="form-btn form-btn-secondary"
              >
                取消
              </button>
              <button
                onClick={editingApp ? updateApp : addApp}
                className="form-btn form-btn-primary"
              >
                {editingApp ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 通知提示 */}
      {notification && (
        <div className="notification">
          {notification}
        </div>
      )}


    </div>
  );
};

export default App;



