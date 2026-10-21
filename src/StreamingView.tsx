import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Maximize, Minimize, Settings } from 'lucide-react';

type QualityMode = 'gaming' | 'low_latency';
type ConnectionMode = 'direct' | 'relay' | 'unknown';

interface StreamingViewProps {
  onBack: () => void;
  appName: string;
  appIcon: string;
  videoRef: React.RefObject<HTMLVideoElement>;
  isPlaying: boolean;
  fps: number;
  onMouseMove: (e: React.MouseEvent<HTMLVideoElement>) => void;
  onMouseDown: (e: React.MouseEvent<HTMLVideoElement>) => void;
  onMouseUp: (e: React.MouseEvent<HTMLVideoElement>) => void;
  onWheel: (e: React.WheelEvent<HTMLVideoElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<HTMLVideoElement>) => void;
  cursorPos: { x: number; y: number };
  showToolbar: boolean;
  setShowToolbar: (show: boolean) => void;
  currentQuality: QualityMode;
  connectionMode: ConnectionMode;
  onQualityChange: (quality: QualityMode) => void;
  rtt?: number;
  latency?: number;
  controlLatency?: number;
  bitrate?: number;
  availableOutgoingKbps?: number;
  packetLoss?: number;
  candidatePath?: string;
  muted?: boolean;
}

const qualityOptions: Array<{
  id: QualityMode;
  name: string;
  desc: string;
  icon: string;
}> = [
  { id: 'gaming', name: '1080p 60Hz', desc: '高画质模式', icon: '🎮' },
  { id: 'low_latency', name: '720p 60Hz', desc: '低延迟模式', icon: '⚡' }
];

const StreamingView: React.FC<StreamingViewProps> = ({
  onBack,
  appName,
  appIcon,
  videoRef,
  isPlaying,
  fps,
  onMouseMove,
  onMouseDown,
  onMouseUp,
  onWheel,
  onMouseLeave,
  cursorPos,
  showToolbar,
  setShowToolbar,
  currentQuality,
  connectionMode,
  onQualityChange,
  rtt = 0,
  latency = 0,
  controlLatency = 0,
  bitrate = 0,
  availableOutgoingKbps = 0,
  packetLoss = 0,
  candidatePath = 'unknown',
  muted = true
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const modeLabel = connectionMode === 'direct' ? '直连(SRS)' : connectionMode === 'relay' ? 'TURN中继' : '未知';
  const qualityLabel = currentQuality === 'gaming' ? '1080p60' : '720p60';

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await containerRef.current?.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error('toggle fullscreen failed:', error);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`streaming-view quality-${currentQuality}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onAuxClick={(e) => {
        if (e.button === 1 || e.button === 2) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onMouseDownCapture={(e) => {
        if (e.button === 2) {
          e.preventDefault();
        }
      }}
    >
      <div className={`streaming-toolbar ${!showToolbar ? 'hidden' : ''}`}>
        <div className="toolbar-left">
          <button onClick={onBack} className="toolbar-btn back-btn">
            <ArrowLeft size={20} />
            <span>返回</span>
          </button>
          <div className="app-info">
            <span className="app-icon-small">{appIcon}</span>
            <span className="app-name-small">{appName}</span>
          </div>
        </div>

        <div className="toolbar-center">
          {isPlaying && (
            <div className="status-indicators">
              <div className="status-item">
                <div className="status-dot online" />
                <span>运行中</span>
              </div>
              {fps > 0 && (
                <div className="status-item">
                  <span>{Math.round(fps)} FPS</span>
                </div>
              )}
              <div className="status-item">
                <span>链路: {modeLabel}</span>
              </div>
            </div>
          )}
        </div>

        <div className="toolbar-right">
          <div className="quality-selector">
            <button
              onClick={() => setShowQualityMenu((prev) => !prev)}
              className="toolbar-btn"
              title="画质设置"
            >
              <Settings size={20} />
            </button>

            {showQualityMenu && (
              <div className="quality-dropdown">
                {qualityOptions.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      onQualityChange(option.id);
                      setShowQualityMenu(false);
                    }}
                    className={`quality-option ${currentQuality === option.id ? 'active' : ''}`}
                  >
                    <span className="quality-icon">{option.icon}</span>
                    <div className="quality-info">
                      <div className="quality-name">{option.name}</div>
                      <div className="quality-desc">{option.desc}</div>
                    </div>
                    {currentQuality === option.id && <span className="quality-check">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={toggleFullscreen}
            className="toolbar-btn"
            title={isFullscreen ? '退出全屏' : '进入全屏'}
          >
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>

          <button
            onClick={() => setShowToolbar(false)}
            className="toolbar-btn"
            title="隐藏工具栏"
          >
            <ChevronUp size={20} />
          </button>
        </div>
      </div>

      {!showToolbar && (
        <button
          onClick={() => setShowToolbar(true)}
          className="show-toolbar-btn"
          title="显示工具栏"
        >
          <ChevronDown size={20} />
          <span>显示</span>
        </button>
      )}

      <div className="video-container">
        {!isPlaying && (
          <div className="waiting-screen">
            <div className="waiting-content">
              <div className="waiting-icon">{appIcon}</div>
              <h2 className="waiting-title">正在连接 {appName}</h2>
              <p className="waiting-subtitle">请稍候，正在建立实时串流连接...</p>
              <div className="loading-spinner" />
            </div>
          </div>
        )}

        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          className="video-player"
          style={{ display: isPlaying ? 'block' : 'none' }}
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onWheel={onWheel}
          onMouseLeave={onMouseLeave}
          onContextMenu={(e) => e.preventDefault()}
          onContextMenuCapture={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onAuxClick={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
          aria-label="streaming video"
        />

        {isPlaying && showToolbar && (
          <div className="performance-stats">
            <div className="stat-item">
              <span className="stat-label">链路:</span>
              <span className="stat-value">{modeLabel}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">档位:</span>
              <span className="stat-value">{qualityLabel}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">RTT:</span>
              <span className="stat-value">{rtt} ms</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">延迟:</span>
              <span className="stat-value">{latency} ms</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">控制:</span>
              <span className="stat-value">{controlLatency} ms</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">码率:</span>
              <span className="stat-value">{(bitrate / 1000).toFixed(2)} Mbit/s</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">链路上限:</span>
              <span className="stat-value">{(availableOutgoingKbps / 1000).toFixed(2)} Mbit/s</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">帧率:</span>
              <span className="stat-value">{Math.round(fps)} fps</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">丢包:</span>
              <span className="stat-value">{packetLoss}%</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">候选:</span>
              <span className="stat-value">{candidatePath}</span>
            </div>
          </div>
        )}

        {isPlaying && (
          <div
            className="custom-cursor"
            style={{
              left: `${cursorPos.x}px`,
              top: `${cursorPos.y}px`
            }}
          />
        )}

        {isPlaying && (
          <div className="connection-badge">
            {modeLabel} / {qualityLabel}
          </div>
        )}
      </div>

      {isPlaying && showToolbar && (
        <div className="streaming-hint">ESC 或点击“返回”退出，右键和滚轮已映射到远端应用</div>
      )}
    </div>
  );
};

export default StreamingView;
