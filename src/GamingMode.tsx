import React, { useState, useEffect } from 'react';
import { Play, Star, Users, Clock, Search, Filter, ArrowLeft } from 'lucide-react';

interface Game {
  id: string;
  name: string;
  cover: string;
  description: string;
  category: string;
  rating: number;
  players: string;
  playtime: string;
  tags: string[];
  featured?: boolean;
}

interface GamingModeProps {
  onBack: () => void;
  onLaunchGame: (gameId: string) => void;
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

const GamingMode: React.FC<GamingModeProps> = ({ onBack, onLaunchGame, isLoggedIn, userData, onShowUserProfile, runningInstances, onShowInstances }) => {
  const [games, setGames] = useState<Game[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [loading, setLoading] = useState(true);
  const [currentSlide, setCurrentSlide] = useState(0);

  // 模拟游戏数据（实际应该从服务器获取）
  useEffect(() => {
    // 模拟加载游戏列表
    setTimeout(() => {
      setGames([
        {
          id: 'game1',
          name: '极限竞速：地平线4',
          cover: '/image/dipingxian4.jpg',
          description: '《极限竞速：地平线4》是一款开放世界赛车游戏，在英国美丽的风景中自由驾驶',
          category: '竞速',
          rating: 4.7,
          players: '单人/多人',
          playtime: '好评如潮',
          tags: ['竞速', '开放世界', '驾驶', '多人'],
          featured: true
        },
        {
          id: 'game2',
          name: '赛博朋克2077',
          cover: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1091500/header.jpg',
          description: '《赛博朋克2077》是一款开放世界动作冒险RPG，在夜之城展开史诗般的冒险',
          category: 'RPG',
          rating: 4.6,
          players: '单人',
          playtime: '特别好评',
          tags: ['RPG', '开放世界', '科幻', '赛博朋克'],

        },
        {
          id: 'game3',
          name: '永劫无间',
          cover: '/image/yongjiewujian.jpg',
          description: '《永劫无间》是一款多人动作竞技游戏，在神秘的聚窟洲展开60人生存大逃杀',
          category: '竞技',
          rating: 4.5,
          players: '多人在线',
          playtime: '特别好评',
          tags: ['竞技', '动作', '多人', '武侠'],
       
        },
        {
          id: 'game4',
          name: '超级兔子人',
          cover: 'https://cdn.cloudflare.steamstatic.com/steam/apps/673750/header.jpg',
          description: '《超级兔子人》是一款物理平台游戏，可以单人或多人合作游玩',
          category: '休闲',
          rating: 4.8,
          players: '单人/多人',
          playtime: '特别好评',
          tags: ['休闲', '多人', '物理', '搞笑'],
          // featured: true
        },
        {
          id: 'game5',
          name: 'LIMBO',
          cover: 'https://cdn.cloudflare.steamstatic.com/steam/apps/48000/header.jpg',
          description: '《LIMBO》是一款黑白风格的解谜平台游戏，讲述一个男孩在地狱边境寻找姐姐的故事',
          category: '冒险',
          rating: 4.8,
          players: '单人',
          playtime: '好评如潮',
          tags: ['冒险', '解谜', '独立', '黑暗']
        },
        {
          id: 'game6',
          name: 'Slime Rancher',
          cover: 'https://cdn.cloudflare.steamstatic.com/steam/apps/433340/header.jpg',
          description: '史莱姆牧场是一款充满魅力的第一人称沙盒游戏，在遥远的星球上经营牧场',
          category: '休闲',
          rating: 4.9,
          players: '单人',
          playtime: '超好评',
          tags: ['休闲', '模拟', '冒险', '可爱'],
          featured: true
        },
        {
          id: 'game7',
          name: "Another Crab's Treasure",
          cover: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1887840/header.jpg',
          description: '《Another Crab\'s Treasure》是一款魂类动作冒险游戏，扮演一只寄居蟹在海底世界冒险',
          category: '动作',
          rating: 4.8,
          players: '单人',
          playtime: '特别好评',
          tags: ['动作', '冒险', '魂类', '可爱'],
          // featured: true
        },
        {
          id: 'game8',
          name: '黎明杀机',
          cover: 'https://cdn.cloudflare.steamstatic.com/steam/apps/381210/header.jpg',
          description: '《黎明杀机》是一款多人恐怖生存游戏，4名逃生者对抗1名杀手',
          category: '生存',
          rating: 4.5,
          players: '多人在线',
          playtime: '特别好评',
          tags: ['生存', '多人', '恐怖', '非对称竞技'],
      
        },
        {
          id: 'game9',
          name: '黑神话：悟空',
          cover: '/image/heishenhua.jpg',
          description: '《黑神话：悟空》是一款以中国神话为背景的动作角色扮演游戏',
          category: '动作',
          rating: 4.9,
          players: '单人',
          playtime: '特别好评',
          tags: ['动作', 'RPG', '中国神话', '魂类'],
          featured: true
        }
      ]);
      setLoading(false);
    }, 500);
  }, []);

  const categories = ['全部', '生存', '动作', 'RPG', '竞技', '休闲', '模拟', '竞速', '冒险'];

  const filteredGames = games.filter(game => {
    const matchesSearch = game.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         game.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === '全部' || game.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const featuredGames = games.filter(game => game.featured);

  // 自动轮播
  useEffect(() => {
    if (featuredGames.length > 1) {
      const timer = setInterval(() => {
        setCurrentSlide((prev) => (prev === featuredGames.length - 1 ? 0 : prev + 1));
      }, 5000); // 每5秒切换一次
      
      return () => clearInterval(timer);
    }
  }, [featuredGames.length]);

  return (
    <div className="gaming-mode">
      {/* 顶部导航栏 */}
      <div className="gaming-header">
        <button onClick={onBack} className="back-btn">
          <ArrowLeft size={20} />
          返回首页
        </button>
        <h1 className="gaming-title">云游戏</h1>
        <div className="gaming-header-right">
          <button 
            onClick={onShowInstances}
            className="running-instances-header-btn"
            title="查看运行中的游戏"
          >
            <span className="running-icon">▶</span>
            <span className="running-text">运行中</span>
            {runningInstances.length > 0 && (
              <span className="running-badge">{runningInstances.length}</span>
            )}
          </button>
          <div className="gaming-search">
            <Search size={18} />
            <input
              type="text"
              placeholder="搜索游戏..."
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

      {/* 精选游戏轮播 */}
      {featuredGames.length > 0 && !searchQuery && (
        <div className="featured-section">
          <div className="featured-carousel-container">
            <div 
              className="featured-carousel-wrapper"
              style={{ transform: `translateX(-${currentSlide * 100}%)` }}
            >
              {featuredGames.map((game, index) => (
                <div key={game.id} className="featured-slide">
                  <img src={game.cover} alt={game.name} className="featured-bg" />
                  <div className="featured-overlay"></div>
                  <div className="featured-content">
                    <div className="featured-tags">
                      <span className="featured-tag">版本更新</span>
                      <span className="featured-tag">热门游戏</span>
                    </div>
                    <h2 className="featured-title">{game.name}</h2>
                    <p className="featured-description">{game.description}</p>
                    <button 
                      onClick={() => onLaunchGame(game.id)}
                      className="featured-launch-btn"
                    >
                      立即前往
                    </button>
                  </div>
                  <div className="featured-indicators">
                    {featuredGames.map((_, idx) => (
                      <button
                        key={idx}
                        className={`indicator ${idx === currentSlide ? 'active' : ''}`}
                        onClick={() => setCurrentSlide(idx)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {featuredGames.length > 1 && (
              <>
                <button 
                  className="carousel-nav prev"
                  onClick={() => setCurrentSlide((prev) => (prev === 0 ? featuredGames.length - 1 : prev - 1))}
                >
                  ‹
                </button>
                <button 
                  className="carousel-nav next"
                  onClick={() => setCurrentSlide((prev) => (prev === featuredGames.length - 1 ? 0 : prev + 1))}
                >
                  ›
                </button>
              </>
            )}
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

      {/* 游戏网格 */}
      <div className="games-section">
        <h2 className="section-title">
          {selectedCategory === '全部' ? '全部游戏' : `${selectedCategory}游戏`}
          <span className="game-count">({filteredGames.length})</span>
        </h2>
        
        {loading ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <p>加载中...</p>
          </div>
        ) : filteredGames.length === 0 ? (
          <div className="empty-state">
            <p>未找到相关游戏</p>
          </div>
        ) : (
          <div className="games-grid">
            {filteredGames.map(game => (
              <div key={game.id} className="game-card">
                <div className="game-cover-wrapper">
                  <img src={game.cover} alt={game.name} className="game-cover" />
                  <div className="game-overlay">
                    <button 
                      onClick={() => onLaunchGame(game.id)}
                      className="play-btn"
                    >
                      <Play size={24} />
                      云玩
                    </button>
                  </div>
                </div>
                <div className="game-info">
                  <h3 className="game-name">{game.name}</h3>
                  <p className="game-desc">{game.description}</p>
                  <div className="game-tags">
                    {game.tags.map(tag => (
                      <span key={tag} className="game-tag">{tag}</span>
                    ))}
                  </div>
                  <div className="game-meta">
                    <span className="meta-item">
                      <Star size={12} fill="#f59e0b" color="#f59e0b" />
                      {game.rating}
                    </span>
                    <span className="meta-item">
                      <Users size={12} />
                      {game.playtime}
                    </span>
                    <span className={`status-badge ${game.players === '在线' ? 'online' : ''}`}>
                      {game.players}
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

export default GamingMode;
