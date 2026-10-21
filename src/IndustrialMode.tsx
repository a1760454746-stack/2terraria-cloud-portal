import React, { useState, useEffect } from 'react';
import { Play, Star, Clock, Search, Filter, ArrowLeft, Cpu, HardDrive, Zap, Package } from 'lucide-react';

interface IndustrialApp {
  id: string;
  name: string;
  icon: string;
  cover: string; // 应用封面图片
  description: string;
  category: string;
  version: string;
  size: string;
  requirements: string;
  tags: string[];
  featured?: boolean;
  color: string; // 主题色
}

interface IndustrialModeProps {
  onBack: () => void;
  onLaunchApp: (appId: string) => void;
  isLoggedIn: boolean;
  userData: {
    username: string;
    avatar: string;
  };
  onShowUserProfile: () => void;
  runningInstances: Array<{
    instanceId: string;
    deviceId: string;
    appId: string;
    appName: string;
    appIcon: string;
    startedAt: string;
  }>;
  onShowInstances: () => void;
}

const IndustrialMode: React.FC<IndustrialModeProps> = ({ onBack, onLaunchApp, isLoggedIn, userData, onShowUserProfile, runningInstances, onShowInstances }) => {
  const [apps, setApps] = useState<IndustrialApp[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [loading, setLoading] = useState(true);

  // 模拟应用数据（实际应该从服务器获取）
  useEffect(() => {
    setTimeout(() => {
      setApps([
        {
          id: 'blender',
          name: 'Blender',
          icon: '🎨',
          cover: 'https://upload.wikimedia.org/wikipedia/commons/0/0c/Blender_logo_no_text.svg',
          description: '开源3D建模、动画和渲染软件，支持完整的3D创作流程',
          category: '3D建模',
          version: '4.0.2',
          size: '342 MB',
          requirements: 'GPU: RTX 3060+',
          tags: ['3D建模', '动画', '渲染'],
          featured: false,
          color: '#f5792a'
        },
        {
          id: 'photoshop',
          name: 'Adobe Photoshop',
          icon: '🖼️',
          cover: 'https://upload.wikimedia.org/wikipedia/commons/a/af/Adobe_Photoshop_CC_icon.svg',
          description: '专业图像编辑软件，行业标准的照片处理和设计工具',
          category: '图像处理',
          version: '2024',
          size: '2.1 GB',
          requirements: 'RAM: 16GB+',
          tags: ['图像编辑', '设计', '修图'],
          featured: true,
          color: '#31a8ff'
        },
        {
          id: 'unity',
          name: 'Unity',
          icon: '🎮',
          cover: 'https://upload.wikimedia.org/wikipedia/commons/c/c4/Unity_2021.svg',
          description: '跨平台游戏引擎和数字孪生开发平台',
          category: '游戏引擎',
          version: '2023.2',
          size: '1.8 GB',
          requirements: 'GPU: GTX 1060+',
          tags: ['游戏开发', '数字孪生', 'VR/AR'],
          featured: true,
          color: '#000000'
        },
        {
          id: 'vscode',
          name: 'Visual Studio Code',
          icon: '💻',
          cover: 'https://upload.wikimedia.org/wikipedia/commons/9/9a/Visual_Studio_Code_1.35_icon.svg',
          description: '轻量级但功能强大的代码编辑器，支持多种编程语言',
          category: '开发工具',
          version: '1.85',
          size: '95 MB',
          requirements: 'RAM: 4GB+',
          tags: ['代码编辑', '开发', '调试'],
          color: '#007acc'
        },
        {
          id: 'autocad',
          name: 'AutoCAD',
          icon: '📐',
          cover: 'https://cdn.simpleicons.org/autodesk/0696D7',
          description: '专业CAD设计软件，用于2D和3D工程图纸绘制',
          category: 'CAD设计',
          version: '2024',
          size: '3.2 GB',
          requirements: 'GPU: Quadro P2000+',
          tags: ['CAD', '工程设计', '建筑'],
          color: '#e51937'
        },
        {
          id: 'davinci',
          name: 'DaVinci Resolve',
          icon: '🎬',
          // cover: 'https://raw.githubusercontent.com/gilbarbara/logos/main/logos/solidworks.svg',
          cover:'https://cdn.simpleicons.org/davinciresolve',
          description: '专业视频编辑、调色和后期制作软件',
          category: '视频编辑',
          version: '18.6',
          size: '2.5 GB',
          requirements: 'GPU: RTX 2060+',
          tags: ['视频编辑', '调色', '后期'],
          color: '#ff2d55'
        },
        {
          id: 'matlab',
          name: 'MATLAB',
          icon: '📊',
          cover: 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/matlab/matlab-original.svg',
          description: '数值计算和算法开发平台，用于数据分析和可视化',
          category: '数据分析',
          version: 'R2023b',
          size: '1.5 GB',
          requirements: 'RAM: 8GB+',
          tags: ['数据分析', '算法', '仿真'],
          color: '#0076a8'
        },
        {
          id: 'solidworks',
          name: 'SolidWorks',
          icon: '⚙️',
          // cover: 'https://raw.githubusercontent.com/gilbarbara/logos/main/logos/solidworks.svg',
          cover:'/image/Primary Logo -  Horizontal Red on Transparent.png',
          description: '3D机械设计和工程软件，用于产品设计和仿真',
          category: 'CAD设计',
          version: '2024',
          size: '4.1 GB',
          requirements: 'GPU: Quadro P4000+',
          tags: ['机械设计', '仿真', '工程'],
          color: '#ff0000'
        },
        {
          id: 'figma',
          name: 'Figma',
          icon: '🎨',
          cover: 'https://upload.wikimedia.org/wikipedia/commons/3/33/Figma-logo.svg',
          description: '协作式UI/UX设计工具，支持实时多人编辑',
          category: 'UI设计',
          version: 'Desktop',
          size: '128 MB',
          requirements: 'RAM: 4GB+',
          tags: ['UI设计', '原型', '协作'],
          color: '#f24e1e'
        }
      ]);
      setLoading(false);
    }, 500);
  }, []);

  const categories = ['全部', '3D建模', '图像处理', '游戏引擎', '开发工具', 'CAD设计', '视频编辑', '数据分析', 'UI设计'];

  const filteredApps = apps.filter(app => {
    const matchesSearch = app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         app.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === '全部' || app.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const featuredApps = apps.filter(app => app.featured);

  return (
    <div className="industrial-mode">
      {/* 顶部导航栏 */}
      <div className="industrial-header">
        <button onClick={onBack} className="back-btn">
          <ArrowLeft size={20} />
          返回首页
        </button>
        <h1 className="industrial-title">工业应用</h1>
        <div className="industrial-header-right">
          <button 
            onClick={onShowInstances}
            className="running-instances-header-btn"
            title="查看运行中的应用"
          >
            <span className="running-icon">▶</span>
            <span className="running-text">运行中</span>
            {runningInstances.length > 0 && (
              <span className="running-badge">{runningInstances.length}</span>
            )}
          </button>
          <div className="industrial-search">
            <Search size={18} />
            <input
              type="text"
              placeholder="搜索专业软件..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
          {isLoggedIn && (
            <button className="user-avatar-display" onClick={onShowUserProfile}>
              <span className="avatar-icon">{userData.avatar}</span>
              <span className="username">{userData.username}</span>
            </button>
          )}
        </div>
      </div>

      {/* 精选应用 */}
      {featuredApps.length > 0 && !searchQuery && (
        <div className="featured-section">
          <h2 className="section-title">
            <Star size={20} />
            专业推荐
          </h2>
          <div className="featured-carousel">
            {featuredApps.map(app => (
              <div key={app.id} className="featured-app-card" style={{ borderColor: `${app.color}40` }}>
                <div className="featured-badge professional">专业版</div>
                
                <div className="featured-app-cover">
                  <img src={app.cover} alt={app.name} className="app-cover-img" />
                </div>
                
                <div className="featured-app-info">
                  <h3 className="featured-app-name">{app.name}</h3>
                  <p className="featured-app-version">版本 {app.version}</p>
                  <p className="featured-app-desc">{app.description}</p>
                  
                  <div className="featured-app-specs">
                    <span className="spec-item">
                      <HardDrive size={14} />
                      {app.size}
                    </span>
                    <span className="spec-item">
                      <Cpu size={14} />
                      {app.requirements}
                    </span>
                  </div>
                  
                  <button 
                    onClick={() => onLaunchApp(app.id)}
                    className="featured-launch-btn"
                    style={{ background: `linear-gradient(135deg, ${app.color}, ${app.color}dd)` }}
                  >
                    <Play size={18} />
                    启动应用
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 分类筛选 */}
      <div className="category-filter">
        <Filter size={18} />
        <div className="category-tabs">
          {categories.map(category => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`category-tab ${selectedCategory === category ? 'active' : ''}`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {/* 应用网格 */}
      <div className="apps-section">
        <h2 className="section-title">
          {selectedCategory === '全部' ? '全部应用' : `${selectedCategory}应用`}
          <span className="app-count">({filteredApps.length})</span>
        </h2>
        
        {loading ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <p>加载中...</p>
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="empty-state">
            <Package size={48} />
            <p>未找到相关应用</p>
          </div>
        ) : (
          <div className="apps-grid">
            {filteredApps.map(app => (
              <div key={app.id} className="app-card">
                <div className="app-card-header">
                  <img src={app.cover} alt={app.name} className="app-cover-img" />
                  <div className="app-overlay">
                    <button 
                      onClick={() => onLaunchApp(app.id)}
                      className="launch-btn"
                      style={{ background: `linear-gradient(135deg, ${app.color}, ${app.color}dd)` }}
                    >
                      <Play size={20} />
                      启动
                    </button>
                  </div>
                </div>
                
                <div className="app-card-body">
                  <h3 className="app-name">{app.name}</h3>
                  <p className="app-version">v{app.version}</p>
                  <p className="app-desc">{app.description}</p>
                  
                  <div className="app-tags">
                    {app.tags.map(tag => (
                      <span key={tag} className="app-tag" style={{ 
                        background: `${app.color}15`,
                        borderColor: `${app.color}30`,
                        color: app.color
                      }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                  
                  <div className="app-specs">
                    <span className="spec-item">
                      <HardDrive size={12} />
                      {app.size}
                    </span>
                    <span className="spec-item">
                      <Zap size={12} />
                      {app.category}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default IndustrialMode;
