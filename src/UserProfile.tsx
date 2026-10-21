import React from 'react';
import { ArrowLeft, Clock, Gamepad2, Wrench, Monitor, LogOut, TrendingUp } from 'lucide-react';

interface UserProfileProps {
  onBack: () => void;
  userData: {
    username: string;
    avatar: string;
  };
  usageTime: {
    gaming: number;
    industrial: number;
    remote: number;
  };
  onLogout: () => void;
}

const UserProfile: React.FC<UserProfileProps> = ({ onBack, userData, usageTime, onLogout }) => {
  // 格式化时长
  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}小时${minutes}分钟`;
    } else if (minutes > 0) {
      return `${minutes}分钟${secs}秒`;
    } else {
      return `${secs}秒`;
    }
  };

  const totalTime = usageTime.gaming + usageTime.industrial + usageTime.remote;

  // 计算百分比
  const getPercentage = (time: number) => {
    if (totalTime === 0) return 0;
    return Math.round((time / totalTime) * 100);
  };

  // 生成简单的趋势线数据（模拟）
  const generateTrendData = (baseValue: number) => {
    const points = [];
    for (let i = 0; i < 20; i++) {
      const variation = Math.sin(i * 0.5) * 20 + Math.random() * 10;
      points.push(baseValue + variation);
    }
    return points;
  };

  const gamingTrend = generateTrendData(usageTime.gaming / 60);
  const industrialTrend = generateTrendData(usageTime.industrial / 60);
  const remoteTrend = generateTrendData(usageTime.remote / 60);

  // 生成 SVG 路径
  const generatePath = (data: number[], color: string) => {
    const width = 200;
    const height = 60;
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    
    const points = data.map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x},${y}`;
    });
    
    return `M ${points.join(' L ')}`;
  };

  return (
    <div className="user-profile-page-v2">
      {/* 顶部导航栏 */}
      <div className="profile-header-v2">
        <button onClick={onBack} className="back-btn-v2">
          <ArrowLeft size={20} />
        </button>
        <h1 className="profile-title-v2">个人中心</h1>
        <div className="header-actions">
          <button className="icon-btn-v2">
            <TrendingUp size={20} />
          </button>
        </div>
      </div>

      {/* 主要内容 */}
      <div className="profile-content-v2">
        {/* 左侧用户信息 */}
        <div className="profile-sidebar-v2">
          <div className="user-card-v2">
            <div className="user-avatar-v2">{userData.avatar}</div>
            <h2 className="user-name-v2">{userData.username}</h2>
            <p className="user-email-v2">user@example.com</p>
          </div>

          <div className="sidebar-menu-v2">
            <button className="menu-item-v2 active">
              <Clock size={18} />
              使用统计
            </button>
            <button className="menu-item-v2">
              <Gamepad2 size={18} />
              我的游戏
            </button>
            <button className="menu-item-v2">
              <Wrench size={18} />
              我的应用
            </button>
          </div>

          <button className="logout-btn-v2" onClick={onLogout}>
            <LogOut size={18} />
            退出登录
          </button>
        </div>

        {/* 右侧统计内容 */}
        <div className="profile-main-v2">
          {/* 总时长卡片 */}
          <div className="total-time-card-v2">
            <div className="total-time-header">
              <span className="total-time-label-v2">总使用时长</span>
              <span className="total-time-badge">+{getPercentage(usageTime.gaming)}%</span>
            </div>
            <div className="total-time-value-v2">{formatTime(totalTime)}</div>
            <div className="total-time-subtitle">本周累计使用时间</div>
          </div>

          {/* 三个服务卡片 */}
          <div className="services-grid-v2">
            {/* 云游戏 */}
            <div className="service-card-v2 gaming-card-v2">
              <div className="service-header-v2">
                <div className="service-icon-v2 gaming-icon">
                  <Gamepad2 size={20} />
                </div>
                <div className="service-info-v2">
                  <div className="service-name-v2">云游戏</div>
                  <div className="service-time-v2">{formatTime(usageTime.gaming)}</div>
                </div>
              </div>
              <div className="service-chart-v2">
                <svg width="200" height="60" viewBox="0 0 200 60">
                  <defs>
                    <linearGradient id="gamingGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d={generatePath(gamingTrend, '#3b82f6') + ' L 200,60 L 0,60 Z'}
                    fill="url(#gamingGradient)"
                  />
                  <path
                    d={generatePath(gamingTrend, '#3b82f6')}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="2"
                  />
                </svg>
              </div>
              <div className="service-progress-v2">
                <div className="progress-bar-v2" style={{ width: `${getPercentage(usageTime.gaming)}%`, background: '#3b82f6' }}></div>
              </div>
            </div>

            {/* 云工业 */}
            <div className="service-card-v2 industrial-card-v2">
              <div className="service-header-v2">
                <div className="service-icon-v2 industrial-icon">
                  <Wrench size={20} />
                </div>
                <div className="service-info-v2">
                  <div className="service-name-v2">云工业</div>
                  <div className="service-time-v2">{formatTime(usageTime.industrial)}</div>
                </div>
              </div>
              <div className="service-chart-v2">
                <svg width="200" height="60" viewBox="0 0 200 60">
                  <defs>
                    <linearGradient id="industrialGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d={generatePath(industrialTrend, '#a78bfa') + ' L 200,60 L 0,60 Z'}
                    fill="url(#industrialGradient)"
                  />
                  <path
                    d={generatePath(industrialTrend, '#a78bfa')}
                    fill="none"
                    stroke="#a78bfa"
                    strokeWidth="2"
                  />
                </svg>
              </div>
              <div className="service-progress-v2">
                <div className="progress-bar-v2" style={{ width: `${getPercentage(usageTime.industrial)}%`, background: '#a78bfa' }}></div>
              </div>
            </div>

            {/* 远程办公 */}
            <div className="service-card-v2 remote-card-v2">
              <div className="service-header-v2">
                <div className="service-icon-v2 remote-icon">
                  <Monitor size={20} />
                </div>
                <div className="service-info-v2">
                  <div className="service-name-v2">远程办公</div>
                  <div className="service-time-v2">{formatTime(usageTime.remote)}</div>
                </div>
              </div>
              <div className="service-chart-v2">
                <svg width="200" height="60" viewBox="0 0 200 60">
                  <defs>
                    <linearGradient id="remoteGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d={generatePath(remoteTrend, '#10b981') + ' L 200,60 L 0,60 Z'}
                    fill="url(#remoteGradient)"
                  />
                  <path
                    d={generatePath(remoteTrend, '#10b981')}
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="2"
                  />
                </svg>
              </div>
              <div className="service-progress-v2">
                <div className="progress-bar-v2" style={{ width: `${getPercentage(usageTime.remote)}%`, background: '#10b981' }}></div>
              </div>
            </div>
          </div>

          {/* 使用详情表格 */}
          <div className="usage-table-v2">
            <div className="table-header-v2">
              <h3>使用详情</h3>
              <div className="table-tabs-v2">
                <button className="table-tab-v2 active">最近</button>
                <button className="table-tab-v2">本周</button>
              </div>
            </div>
            <div className="table-content-v2">
              <div className="table-row-v2">
                <div className="table-cell-v2">
                  <div className="cell-icon gaming-icon">
                    <Gamepad2 size={16} />
                  </div>
                  <div className="cell-info">
                    <div className="cell-name">云游戏</div>
                    <div className="cell-date">今天</div>
                  </div>
                </div>
                <div className="table-cell-v2 cell-value positive">
                  +{formatTime(usageTime.gaming)}
                </div>
              </div>
              <div className="table-row-v2">
                <div className="table-cell-v2">
                  <div className="cell-icon industrial-icon">
                    <Wrench size={16} />
                  </div>
                  <div className="cell-info">
                    <div className="cell-name">云工业</div>
                    <div className="cell-date">今天</div>
                  </div>
                </div>
                <div className="table-cell-v2 cell-value positive">
                  +{formatTime(usageTime.industrial)}
                </div>
              </div>
              <div className="table-row-v2">
                <div className="table-cell-v2">
                  <div className="cell-icon remote-icon">
                    <Monitor size={16} />
                  </div>
                  <div className="cell-info">
                    <div className="cell-name">远程办公</div>
                    <div className="cell-date">今天</div>
                  </div>
                </div>
                <div className="table-cell-v2 cell-value positive">
                  +{formatTime(usageTime.remote)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserProfile;
