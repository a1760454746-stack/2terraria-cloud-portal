import React, { useState } from 'react';
import { Gamepad2, Wrench, ArrowRight, Zap, Shield, Cloud, Monitor, Users, Lock, User, LogOut, Clock } from 'lucide-react';

interface HomePageProps {
  onSelectMode: (mode: 'gaming' | 'industrial' | 'remote') => void;
  usageTime: {
    gaming: number;
    industrial: number;
    remote: number;
  };
  isLoggedIn: boolean;
  setIsLoggedIn: (value: boolean) => void;
  userData: {
    username: string;
    avatar: string;
  };
  setUserData: (value: { username: string; avatar: string }) => void;
  onShowUserProfile: () => void;
}

const HomePage: React.FC<HomePageProps> = ({ 
  onSelectMode, 
  usageTime, 
  isLoggedIn, 
  setIsLoggedIn,
  userData,
  setUserData,
  onShowUserProfile
}) => {
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ username: '', password: '', confirmPassword: '' });

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

  // 处理登录
  const handleLogin = () => {
    if (loginForm.username && loginForm.password) {
      // 这里应该调用后端API验证
      setIsLoggedIn(true);
      setShowLoginModal(false);
      setLoginForm({ username: '', password: '' });
      // 设置用户名
      setUserData({ ...userData, username: loginForm.username });
    }
  };

  // 处理注册
  const handleRegister = () => {
    if (registerForm.username && registerForm.password && 
        registerForm.password === registerForm.confirmPassword) {
      // 这里应该调用后端API注册
      setIsLoggedIn(true);
      setShowLoginModal(false);
      setRegisterForm({ username: '', password: '', confirmPassword: '' });
      setUserData({ ...userData, username: registerForm.username });
    }
  };

  // 计算总时长
  const totalTime = usageTime.gaming + usageTime.industrial + usageTime.remote;

  return (
    <div className="home-page">
      {/* 顶部导航栏 */}
      <nav className="top-navbar">
        <div className="navbar-brand">
          <Cloud size={28} />
          <span className="brand-name">云端工作站</span>
        </div>
        
        <div className="navbar-right">
          {!isLoggedIn ? (
            <button 
              className="login-btn"
              onClick={() => setShowLoginModal(true)}
            >
              登录 / 注册
            </button>
          ) : (
            <div className="user-menu">
              <button 
                className="user-avatar-btn"
                onClick={onShowUserProfile}
              >
                <span className="avatar-icon">{userData.avatar}</span>
                <span className="username">{userData.username}</span>
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* 登录/注册模态框 */}
      {showLoginModal && (
        <div className="modal-overlay" onClick={() => setShowLoginModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{isRegistering ? '注册账号' : '登录账号'}</h2>
              <button 
                className="modal-close"
                onClick={() => setShowLoginModal(false)}
              >
                ×
              </button>
            </div>
            
            <div className="modal-body">
              {!isRegistering ? (
                // 登录表单
                <div className="auth-form">
                  <div className="form-group">
                    <label>用户名</label>
                    <input
                      type="text"
                      placeholder="请输入用户名"
                      value={loginForm.username}
                      onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>密码</label>
                    <input
                      type="password"
                      placeholder="请输入密码"
                      value={loginForm.password}
                      onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                    />
                  </div>
                  
                  <button className="submit-btn" onClick={handleLogin}>
                    登录
                  </button>
                  
                  <div className="auth-switch">
                    还没有账号？
                    <button onClick={() => setIsRegistering(true)}>立即注册</button>
                  </div>
                </div>
              ) : (
                // 注册表单
                <div className="auth-form">
                  <div className="form-group">
                    <label>用户名</label>
                    <input
                      type="text"
                      placeholder="请输入用户名"
                      value={registerForm.username}
                      onChange={(e) => setRegisterForm({ ...registerForm, username: e.target.value })}
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>密码</label>
                    <input
                      type="password"
                      placeholder="请输入密码"
                      value={registerForm.password}
                      onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                    />
                  </div>
                  
                  <div className="form-group">
                    <label>确认密码</label>
                    <input
                      type="password"
                      placeholder="请再次输入密码"
                      value={registerForm.confirmPassword}
                      onChange={(e) => setRegisterForm({ ...registerForm, confirmPassword: e.target.value })}
                    />
                  </div>
                  
                  <button className="submit-btn" onClick={handleRegister}>
                    注册
                  </button>
                  
                  <div className="auth-switch">
                    已有账号？
                    <button onClick={() => setIsRegistering(false)}>立即登录</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="home-header">
        <h1 className="home-title">Cloud Workstation</h1>
        <p className="home-subtitle">选择您的应用场景，开启云端体验</p>
      </div>

      <div className="mode-grid">
        {/* 云游戏卡片 */}
        <div 
          className="mode-card gaming-card"
          onClick={() => onSelectMode('gaming')}
        >
          <div className="card-badge">热门推荐</div>
          <div className="card-background-pattern"></div>
          
          <div className="card-icon-wrapper">
            <Gamepad2 size={64} className="card-icon" />
          </div>
          
          <h2 className="card-title">云游戏</h2>
          <p className="card-description">
            随时随地畅玩大型游戏<br/>无需高配置设备，即点即玩
          </p>
          
          <div className="card-features">
            <span className="feature-tag">
              <Zap size={14} />
              高帧率
            </span>
            <span className="feature-tag">
              <Shield size={14} />
              低延迟
            </span>
            <span className="feature-tag">
              <Cloud size={14} />
              云端运行
            </span>
          </div>
          
          <button className="card-button">
            开始游戏 <ArrowRight size={18} />
          </button>
          
          <div className="card-stats">
            <div className="stat-item">
              <div className="stat-value">100+</div>
              <div className="stat-label">游戏库</div>
            </div>
            <div className="stat-divider"></div>
            <div className="stat-item">
              <div className="stat-value">24/7</div>
              <div className="stat-label">在线服务</div>
            </div>
          </div>
        </div>

        {/* 工业应用卡片 */}
        <div 
          className="mode-card industrial-card"
          onClick={() => onSelectMode('industrial')}
        >
          <div className="card-badge new">全新上线</div>
          <div className="card-background-pattern"></div>
          
          <div className="card-icon-wrapper">
            <Wrench size={64} className="card-icon" />
          </div>
          
          <h2 className="card-title">工业应用</h2>
          <p className="card-description">
            专业建模、设计、数字孪生<br/>工业级云端创作平台
          </p>
          
          <div className="card-features">
            <span className="feature-tag">
              Blender 建模
            </span>
            <span className="feature-tag">
              Photoshop 设计
            </span>
            <span className="feature-tag">
              数字孪生
            </span>
          </div>
          
          <button className="card-button">
            开始创作 <ArrowRight size={18} />
          </button>
          
          <div className="card-stats">
            <div className="stat-item">
              <div className="stat-value">专业级</div>
              <div className="stat-label">GPU 加速</div>
            </div>
            <div className="stat-divider"></div>
            <div className="stat-item">
              <div className="stat-value">实时</div>
              <div className="stat-label">协作编辑</div>
            </div>
          </div>
        </div>

        {/* 远程办公卡片 */}
        <div 
          className="mode-card remote-card"
          onClick={() => onSelectMode('remote')}
        >
          <div className="card-badge popular">企业推荐</div>
          <div className="card-background-pattern"></div>
          
          <div className="card-icon-wrapper">
            <Monitor size={64} className="card-icon" />
          </div>
          
          <h2 className="card-title">远程办公</h2>
          <p className="card-description">
            随时随地访问办公电脑<br/>安全高效的远程桌面体验
          </p>
          
          <div className="card-features">
            <span className="feature-tag">
              <Users size={14} />
              多人协作
            </span>
            <span className="feature-tag">
              <Lock size={14} />
              安全加密
            </span>
            <span className="feature-tag">
              <Monitor size={14} />
              全平台支持
            </span>
          </div>
          
          <button className="card-button">
            开始办公 <ArrowRight size={18} />
          </button>
          
          <div className="card-stats">
            <div className="stat-item">
              <div className="stat-value">企业级</div>
              <div className="stat-label">安全保障</div>
            </div>
            <div className="stat-divider"></div>
            <div className="stat-item">
              <div className="stat-value">高效</div>
              <div className="stat-label">远程协作</div>
            </div>
          </div>
        </div>
      </div>

      <div className="home-footer">
        <div className="footer-features">
          <div className="footer-feature">
            <Cloud size={20} />
            <span>云端高性能计算</span>
          </div>
          <div className="footer-feature">
            <Shield size={20} />
            <span>企业级安全保障</span>
          </div>
          <div className="footer-feature">
            <Zap size={20} />
            <span>随时随地访问</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HomePage;
