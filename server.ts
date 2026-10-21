import express from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import fs from 'fs';
// @ts-ignore
import Turn from 'node-turn';

const APPS_FILE = path.join(process.cwd(), 'apps.json');
const DEVICES_FILE = path.join(process.cwd(), 'devices.json');

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || '3000');
  const rawAllowedHosts = (process.env.ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  const allowedHosts =
    rawAllowedHosts.length > 0
      ? rawAllowedHosts
      : ['portal.qifen.xyz', '.qifen.xyz', 'localhost', '127.0.0.1'];
  const ENABLE_EMBEDDED_TURN = process.env.ENABLE_EMBEDDED_TURN === '1';
  const TURN_PORT = Number(process.env.TURN_PORT || '3478');
  const TURN_USERNAME = process.env.TURN_USERNAME || 'cloudplay';
  const TURN_CREDENTIAL = process.env.TURN_CREDENTIAL || 'cloudplaypassword';

  // 添加 CORS 支持
  app.use((req, res, next) => {
    console.log(`收到请求: ${req.method} ${req.url}`);
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // 添加 JSON 解析中间件（必须在路由之前）
  app.use(express.json());
  
  // 添加调试中间件
  app.use((req, res, next) => {
    console.log('请求体:', req.body);
    next();
  });

  // Optional embedded TURN (disabled by default when using external coturn)
  if (ENABLE_EMBEDDED_TURN) {
    try {
      const turnServer = new Turn({
        authMech: 'long-term',
        credentials: {
          [TURN_USERNAME]: TURN_CREDENTIAL
        },
        listeningPort: TURN_PORT,
        debugLevel: 'ALL'
      });
      turnServer.start();
      console.log(`✅ Embedded TURN started on port ${TURN_PORT}`);
    } catch (err) {
      console.error('Failed to start embedded TURN server:', err);
    }
  } else {
    console.log('ℹ️ Embedded TURN disabled (use external coturn)');
  }

  // Create HTTP server
  const server = http.createServer(app);

  // Create WebSocket server for WebRTC Signaling on a specific path
  const wss = new WebSocketServer({ server, path: '/signaling' });

  // 多设备管理：{ hostId: { socket, hostName, connectedAt } }
  const hosts = new Map<string, { socket: WebSocket; hostName: string; hostId: string; connectedAt: string }>();
  const clients: Set<WebSocket> = new Set();
  
  // 运行中的应用实例：{ instanceId: { deviceId, appId, appName, appIcon, category, startedAt } }
  const runningInstances = new Map<string, { deviceId: string; appId: string; appName: string; appIcon: string; category?: string; startedAt: string }>();

  wss.on('connection', (ws) => {
    console.log('New WebSocket connection');

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        switch (data.type) {
          case 'register_host':
            const hostId = data.hostId || `host_${Date.now()}`;
            const hostName = data.hostName || `设备_${hostId.slice(-4)}`;
            
            // 检查是否已存在相同 ID 的设备
            if (hosts.has(hostId)) {
              console.log(`⚠️  设备 ${hostName} (${hostId.slice(0, 8)}...) 重新注册，替换旧连接`);
              const oldHost = hosts.get(hostId);
              if (oldHost && oldHost.socket !== ws) {
                try {
                  oldHost.socket.close();
                } catch (e) {}
              }
            } else {
              console.log(`✅ 新设备注册: ${hostName} (${hostId.slice(0, 8)}...)`);
            }
            
            hosts.set(hostId, {
              socket: ws,
              hostName: hostName,
              hostId: hostId,
              connectedAt: new Date().toISOString()
            });
            
            console.log(`📊 当前在线设备数: ${hosts.size}`);
            
            // 通知所有客户端有新设备上线
            clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ 
                  type: 'host_available',
                  hostId: hostId,
                  hostName: hostName
                }));
              }
            });
            break;

          case 'register_client':
            console.log('Client registered');
            clients.add(ws);
            // 发送当前所有在线设备列表
            const deviceList = Array.from(hosts.values()).map(h => ({
              hostId: h.hostId,
              hostName: h.hostName,
              connectedAt: h.connectedAt
            }));
            ws.send(JSON.stringify({ 
              type: 'device_list',
              devices: deviceList
            }));
            break;

          case 'offer':
          case 'answer':
          case 'ice_candidate':
          case 'renegotiate':
          case 'renegotiate_answer':
            const targetHostId = data.targetHostId;
            
            if (data.target === 'host' && targetHostId) {
              // 客户端发给指定设备
              const targetHost = hosts.get(targetHostId);
              if (targetHost && targetHost.socket.readyState === WebSocket.OPEN) {
                targetHost.socket.send(JSON.stringify({ ...data, sender: 'client' }));
              } else {
                console.log(`Target host ${targetHostId} not available`);
              }
            } else if (data.target === 'client') {
              // 设备发给客户端
              clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ ...data, sender: 'host' }));
                }
              });
            }
            break;

          case 'input':
          case 'control_input':
            const inputTargetHostId = data.targetHostId;
            if (inputTargetHostId) {
              const targetHost = hosts.get(inputTargetHostId);
              if (targetHost && targetHost.socket.readyState === WebSocket.OPEN) {
                const payload = data.type === 'control_input'
                  ? { ...data, type: 'input' }
                  : data;
                targetHost.socket.send(JSON.stringify(payload));
              }
            }
            break;

          case 'control_ping':
            const pingTargetHostId = data.targetHostId;
            if (pingTargetHostId) {
              const targetHost = hosts.get(pingTargetHostId);
              if (targetHost && targetHost.socket.readyState === WebSocket.OPEN) {
                targetHost.socket.send(JSON.stringify(data));
              }
            }
            break;

          case 'control_pong':
            clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
              }
            });
            break;

          case 'change_quality':
            // 转发画质切换消息到指定设备
            const qualityTargetHostId = data.targetHostId;
            console.log(`📺 收到画质切换请求: mode=${data.mode}, targetHostId=${qualityTargetHostId}`);
            
            if (qualityTargetHostId) {
              const targetHost = hosts.get(qualityTargetHostId);
              if (targetHost && targetHost.socket.readyState === WebSocket.OPEN) {
                console.log(`✅ 转发画质切换请求到设备 ${targetHost.hostName}: ${data.mode}`);
                targetHost.socket.send(JSON.stringify(data));
              } else {
                console.log(`❌ 目标设备 ${qualityTargetHostId} 未连接或不可用`);
              }
            } else {
              console.log(`❌ 未指定目标设备ID`);
            }
            break;

          case 'app_stopped':
            // Host 通知应用已停止
            const stoppedInstanceId = data.instanceId;
            console.log(`收到应用停止通知: ${stoppedInstanceId}`);
            
            if (runningInstances.has(stoppedInstanceId)) {
              runningInstances.delete(stoppedInstanceId);
              
              // 通知所有客户端实例已停止
              clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({
                    type: 'instance_stopped',
                    instanceId: stoppedInstanceId
                  }));
                }
              });
              
              console.log(`实例已从运行列表中移除: ${stoppedInstanceId}`);
            }
            break;

          case 'fps_update':
            // Host 发送 FPS 更新，转发给所有客户端
            clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: 'fps_update',
                  fps: data.fps,
                  hostId: data.hostId
                }));
              }
            });
            break;

          case 'performance_stats':
            // Host 发送性能指标更新，转发给所有客户端
            console.log('📊 收到性能指标，准备转发:', data);
            clients.forEach(client => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  type: 'performance_stats',
                  fps: data.fps,
                  rtt: data.rtt,
                  latency: data.latency,
                  bitrate: data.bitrate,
                  packetLoss: data.packetLoss,
                  transportMode: data.transportMode,
                  availableOutgoingKbps: data.availableOutgoingKbps,
                  localCandidateType: data.localCandidateType,
                  remoteCandidateType: data.remoteCandidateType,
                  candidateProtocol: data.candidateProtocol,
                  hostId: data.hostId
                }));
              }
            });
            console.log(`✅ 已转发给 ${clients.size} 个客户端`);
            break;

          default:
            console.log('Unknown message type:', data.type);
        }
      } catch (err) {
        console.error('Error parsing message:', err);
      }
    });

    ws.on('close', () => {
      // 检查是否是设备断开
      let disconnectedHostId: string | null = null;
      for (const [hostId, hostInfo] of hosts.entries()) {
        if (hostInfo.socket === ws) {
          disconnectedHostId = hostId;
          hosts.delete(hostId);
          console.log(`Host disconnected: ${hostInfo.hostName} (${hostId})`);
          break;
        }
      }
      
      if (disconnectedHostId) {
        // 通知所有客户端设备离线
        clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ 
              type: 'host_disconnected',
              hostId: disconnectedHostId
            }));
          }
        });
      } else {
        // 客户端断开
        console.log('Client disconnected');
        clients.delete(ws);
      }
    });
  });

  // API routes
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      hostsCount: hosts.size, 
      clients: clients.size 
    });
  });

  // 新增：获取在线设备列表（包含配置的设备和在线状态）
  app.get('/api/devices', (req, res) => {
    const devicesData = readDevices();
    const deviceList = devicesData.devices.map((device: any) => {
      const onlineHost = hosts.get(device.deviceId);
      return {
        ...device,
        online: !!onlineHost,
        connectedAt: onlineHost?.connectedAt || null
      };
    });
    res.json({ devices: deviceList });
  });

  // 新增：获取运行中的应用实例列表
  app.get('/api/running-instances', (req, res) => {
    const { deviceId } = req.query;
    
    let instances = Array.from(runningInstances.entries()).map(([instanceId, instance]) => ({
      instanceId,
      ...instance
    }));
    
    // 如果指定了设备ID，只返回该设备的实例
    if (deviceId) {
      instances = instances.filter(inst => inst.deviceId === deviceId);
    }
    
    res.json({ instances });
  });

  // 新增：关闭运行中的应用实例
  app.post('/api/stop-instance', (req, res) => {
    const { instanceId } = req.body;
    
    console.log(`收到停止实例请求: ${instanceId}`);
    
    if (!instanceId) {
      return res.status(400).json({ success: false, message: '需要指定实例ID' });
    }
    
    const instance = runningInstances.get(instanceId);
    if (!instance) {
      console.log(`❌ 实例不存在: ${instanceId}`);
      console.log(`   当前运行实例: ${Array.from(runningInstances.keys()).join(', ')}`);
      return res.status(404).json({ success: false, message: '实例不存在或已停止' });
    }
    
    console.log(`📤 发送停止命令到设备: ${instance.deviceId}`);
    console.log(`   应用: ${instance.appName}`);
    
    // 发送停止命令给设备
    const targetHost = hosts.get(instance.deviceId);
    if (targetHost && targetHost.socket.readyState === WebSocket.OPEN) {
      targetHost.socket.send(JSON.stringify({
        type: 'stop_app',
        instanceId: instanceId
      }));
      console.log(`✅ 停止命令已发送到 Host`);
    } else {
      console.log(`⚠️  设备未连接，无法发送停止命令`);
    }
    
    // 从运行列表中移除
    runningInstances.delete(instanceId);
    console.log(`🗑️  实例已从运行列表中移除`);
    console.log(`   剩余运行实例数: ${runningInstances.size}`);
    
    // 通知所有客户端实例已停止
    console.log(`📢 广播实例停止消息到 ${clients.size} 个客户端`);
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'instance_stopped',
          instanceId: instanceId
        }));
      }
    });
    
    res.json({ success: true, message: '应用已停止' });
  });

  // 添加新设备（简化版，直接添加）
  app.post('/api/devices', (req, res) => {
    try {
      const { deviceName, deviceId } = req.body;
      
      console.log('收到添加设备请求:', { deviceName, deviceId });
      
      if (!deviceName || !deviceId) {
        console.log('验证失败：设备名称或ID为空');
        return res.status(400).json({ success: false, message: '设备名称和ID不能为空' });
      }

      const devicesData = readDevices();
      console.log('当前设备列表:', devicesData);
      
      // 检查设备ID是否已存在
      const exists = devicesData.devices.find((d: any) => d.deviceId === deviceId);
      if (exists) {
        console.log('验证失败：设备ID已存在');
        return res.status(400).json({ success: false, message: '该设备ID已存在' });
      }
      
      const newDevice = {
        deviceId,
        deviceName,
        addedAt: new Date().toISOString()
      };
      
      devicesData.devices.push(newDevice);
      writeDevices(devicesData);
      
      console.log('设备添加成功:', newDevice);
      return res.json({ success: true, message: '设备添加成功', device: newDevice });
    } catch (error) {
      console.error('添加设备时出错:', error);
      return res.status(500).json({ success: false, message: '服务器错误: ' + error });
    }
  });

  // 更新设备
  app.put('/api/devices/:id', (req, res) => {
    const { id } = req.params;
    const { deviceName } = req.body;
    
    const devicesData = readDevices();
    const deviceIndex = devicesData.devices.findIndex((d: any) => d.deviceId === id);
    
    if (deviceIndex === -1) {
      return res.status(404).json({ success: false, message: '设备不存在' });
    }
    
    devicesData.devices[deviceIndex].deviceName = deviceName || devicesData.devices[deviceIndex].deviceName;
    
    writeDevices(devicesData);
    res.json({ success: true, message: '设备更新成功', device: devicesData.devices[deviceIndex] });
  });

  // 删除设备
  app.delete('/api/devices/:id', (req, res) => {
    const { id } = req.params;
    
    const devicesData = readDevices();
    const deviceIndex = devicesData.devices.findIndex((d: any) => d.deviceId === id);
    
    if (deviceIndex === -1) {
      return res.status(404).json({ success: false, message: '设备不存在' });
    }
    
    devicesData.devices.splice(deviceIndex, 1);
    writeDevices(devicesData);
    
    res.json({ success: true, message: '设备删除成功' });
  });

  // 读取应用配置
  function readApps() {
    try {
      const data = fs.readFileSync(APPS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      return { apps: [] };
    }
  }

  // 写入应用配置
  function writeApps(appsData: any) {
    fs.writeFileSync(APPS_FILE, JSON.stringify(appsData, null, 2), 'utf-8');
  }

  // 读取设备配置
  function readDevices() {
    try {
      const data = fs.readFileSync(DEVICES_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (err) {
      return { devices: [] };
    }
  }

  // 写入设备配置
  function writeDevices(devicesData: any) {
    fs.writeFileSync(DEVICES_FILE, JSON.stringify(devicesData, null, 2), 'utf-8');
  }

  // 获取可用应用列表
  app.get('/api/apps', (req, res) => {
    const { deviceId } = req.query;
    
    if (!deviceId) {
      return res.status(400).json({ success: false, message: '需要指定设备ID' });
    }
    
    const devicesData = readDevices();
    const deviceApps = devicesData.deviceApps || {};
    const customApps = deviceApps[deviceId as string] || [];
    
    // 返回自定义应用列表
    res.json(customApps);
  });

  // 添加新应用
  app.post('/api/apps', (req, res) => {
    const { name, icon, description, path: appPath, deviceId } = req.body;
    
    if (!name || !appPath) {
      return res.status(400).json({ success: false, message: '应用名称和路径不能为空' });
    }
    
    if (!deviceId) {
      return res.status(400).json({ success: false, message: '需要指定设备ID' });
    }

    const devicesData = readDevices();
    if (!devicesData.deviceApps) {
      devicesData.deviceApps = {};
    }
    if (!devicesData.deviceApps[deviceId]) {
      devicesData.deviceApps[deviceId] = [];
    }
    
    const newApp = {
      id: `custom_${Date.now()}`,
      name,
      icon: icon || '⚙️',
      description: description || '',
      path: appPath,
      builtin: false
    };
    
    devicesData.deviceApps[deviceId].push(newApp);
    writeDevices(devicesData);
    
    res.json({ success: true, message: '应用添加成功', app: newApp });
  });

  // 更新应用
  app.put('/api/apps/:id', (req, res) => {
    const { id } = req.params;
    const { name, icon, description, path: appPath, deviceId } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({ success: false, message: '需要指定设备ID' });
    }
    
    const devicesData = readDevices();
    if (!devicesData.deviceApps || !devicesData.deviceApps[deviceId]) {
      return res.status(404).json({ success: false, message: '设备应用列表不存在' });
    }
    
    const apps = devicesData.deviceApps[deviceId];
    const appIndex = apps.findIndex((app: any) => app.id === id);
    
    if (appIndex === -1) {
      return res.status(404).json({ success: false, message: '应用不存在' });
    }

    if (apps[appIndex].builtin) {
      return res.status(403).json({ success: false, message: '内置应用不能编辑' });
    }
    
    apps[appIndex] = {
      ...apps[appIndex],
      name: name || apps[appIndex].name,
      icon: icon || apps[appIndex].icon,
      description: description || apps[appIndex].description,
      path: appPath || apps[appIndex].path
    };
    
    writeDevices(devicesData);
    res.json({ success: true, message: '应用更新成功', app: apps[appIndex] });
  });

  // 删除应用
  app.delete('/api/apps/:id', (req, res) => {
    const { id } = req.params;
    const { deviceId } = req.query;
    
    if (!deviceId) {
      return res.status(400).json({ success: false, message: '需要指定设备ID' });
    }
    
    const devicesData = readDevices();
    if (!devicesData.deviceApps || !devicesData.deviceApps[deviceId as string]) {
      return res.status(404).json({ success: false, message: '设备应用列表不存在' });
    }
    
    const apps = devicesData.deviceApps[deviceId as string];
    const appIndex = apps.findIndex((app: any) => app.id === id);
    
    if (appIndex === -1) {
      return res.status(404).json({ success: false, message: '应用不存在' });
    }

    if (apps[appIndex].builtin) {
      return res.status(403).json({ success: false, message: '内置应用不能删除' });
    }
    
    apps.splice(appIndex, 1);
    writeDevices(devicesData);
    
    res.json({ success: true, message: '应用删除成功' });
  });

  // 启动应用
  app.post('/api/launch-app', (req, res) => {
    const { appId, targetHostId, appPath, appName, appIcon, category } = req.body;
    console.log(`Request to launch app: ${appId} on host: ${targetHostId || 'default'}`);
    console.log(`  appName: ${appName}, appIcon: ${appIcon}, category: ${category}`);
    
    if (!targetHostId) {
      return res.status(400).json({ success: false, message: '需要指定目标设备' });
    }
    
    // 特殊处理：桌面捕获
    if (appId === 'desktop') {
      const targetHost = hosts.get(targetHostId);
      if (targetHost && targetHost.socket.readyState === WebSocket.OPEN) {
        targetHost.socket.send(JSON.stringify({
          type: 'launch_app',
          appId: 'desktop',
          appPath: 'desktop'
        }));
        console.log('⚠️  桌面捕获模式不创建实例记录');
        return res.json({ success: true, message: '已切换到桌面捕获模式' });
      } else {
        return res.status(503).json({ success: false, message: '目标设备未连接' });
      }
    }
    
    // 如果直接提供了 appPath（用于游戏和工业应用等），直接使用
    if (appPath) {
      const targetHost = hosts.get(targetHostId);
      if (targetHost && targetHost.socket.readyState === WebSocket.OPEN) {
        // 创建实例ID
        const instanceId = `${targetHostId}_${appId}_${Date.now()}`;
        
        // 使用前端传递的名称、图标和分类，如果没有则使用默认值
        const finalAppName = appName || appId;
        const finalAppIcon = appIcon || '🔧';
        const finalCategory = category || 'remote';
        
        // 记录运行实例
        runningInstances.set(instanceId, {
          deviceId: targetHostId,
          appId: appId,
          appName: finalAppName,
          appIcon: finalAppIcon,
          category: finalCategory,
          startedAt: new Date().toISOString()
        });
        
        console.log(`✅ 创建运行实例: ${instanceId}`);
        console.log(`   应用: ${finalAppName} (${finalAppIcon})`);
        console.log(`   分类: ${finalCategory}`);
        console.log(`   路径: ${appPath}`);
        console.log(`   设备: ${targetHost.hostName}`);
        
        targetHost.socket.send(JSON.stringify({
          type: 'launch_app',
          appId: appId,
          appPath: appPath,
          instanceId: instanceId
        }));
        
        // 通知所有客户端有新实例启动
        const instanceData = {
          type: 'instance_started',
          instance: {
            instanceId,
            deviceId: targetHostId,
            appId: appId,
            appName: finalAppName,
            appIcon: finalAppIcon,
            category: finalCategory,
            startedAt: new Date().toISOString()
          }
        };
        
        clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(instanceData));
          }
        });
        
        return res.json({ success: true, message: `正在启动 ${finalAppName}...` });
      } else {
        return res.status(503).json({ success: false, message: '目标设备未连接' });
      }
    }
    
    // 从设备的应用列表中查找应用
    const devicesData = readDevices();
    const deviceApps = devicesData.deviceApps || {};
    const apps = deviceApps[targetHostId] || [];
    const app = apps.find((a: any) => a.id === appId);
    
    if (!app) {
      console.log(`❌ 应用不存在: ${appId}`);
      return res.status(404).json({ success: false, message: '应用不存在' });
    }
    
    // 发送给目标设备
    const targetHost = hosts.get(targetHostId);
    if (targetHost && targetHost.socket.readyState === WebSocket.OPEN) {
      // 创建实例ID
      const instanceId = `${targetHostId}_${appId}_${Date.now()}`;
      
      // 记录运行实例
      runningInstances.set(instanceId, {
        deviceId: targetHostId,
        appId: appId,
        appName: app.name,
        appIcon: app.icon,
        category: category || 'remote',
        startedAt: new Date().toISOString()
      });
      
      console.log(`✅ 创建运行实例: ${instanceId}`);
      console.log(`   应用: ${app.name} (${app.icon})`);
      console.log(`   分类: ${category || 'remote'}`);
      console.log(`   设备: ${targetHost.hostName}`);
      console.log(`   当前运行实例数: ${runningInstances.size}`);
      
      targetHost.socket.send(JSON.stringify({
        type: 'launch_app',
        appId: appId,
        appPath: app.path,
        instanceId: instanceId
      }));
      
      // 通知所有客户端有新实例启动
      const instanceData = {
        type: 'instance_started',
        instance: {
          instanceId,
          deviceId: targetHostId,
          appId: appId,
          appName: app.name,
          appIcon: app.icon,
          category: category || 'remote',
          startedAt: new Date().toISOString()
        }
      };
      
      console.log(`📢 广播实例启动消息到 ${clients.size} 个客户端`);
      clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify(instanceData));
        }
      });
      
      return res.json({ success: true, message: `正在在 ${targetHost.hostName} 上启动 ${app.name}`, instanceId });
    } else {
      return res.status(503).json({ success: false, message: '目标设备未连接' });
    }
  });

  // 发送预设命令
  app.post('/api/send-command', (req, res) => {
    const { command, params, targetHostId } = req.body;
    console.log(`Request to send command: ${command} to host: ${targetHostId || 'default'}`, params);
    
    // 如果指定了目标设备，发送给该设备
    if (targetHostId) {
      const targetHost = hosts.get(targetHostId);
      if (targetHost && targetHost.socket.readyState === WebSocket.OPEN) {
        targetHost.socket.send(JSON.stringify({
          type: 'command',
          command: command,
          params: params || {}
        }));
        return res.json({ success: true, message: `命令 ${command} 已发送到 ${targetHost.hostName}` });
      } else {
        return res.status(503).json({ success: false, message: '目标设备未连接' });
      }
    }
    
    // 如果没有指定设备，发送给第一个在线设备
    const firstHost = Array.from(hosts.values())[0];
    if (firstHost && firstHost.socket.readyState === WebSocket.OPEN) {
      firstHost.socket.send(JSON.stringify({
        type: 'command',
        command: command,
        params: params || {}
      }));
      res.json({ success: true, message: `命令 ${command} 已发送` });
    } else {
      res.status(503).json({ success: false, message: '没有可用的设备' });
    }
  });

  // 下载 host.exe 文件
  app.get('/api/download/host', (req, res) => {
    // 优先查找 host_optimized.exe，如果不存在则查找 host.exe
    let exePath = path.join(process.cwd(), 'downloads', 'host_optimized.exe');
    let fileName = 'host_optimized.exe';
    
    if (!fs.existsSync(exePath)) {
      exePath = path.join(process.cwd(), 'downloads', 'host.exe');
      fileName = 'host.exe';
    }
    
    // 检查文件是否存在
    if (!fs.existsSync(exePath)) {
      return res.status(404).json({ 
        success: false, 
        message: 'host.exe 文件不存在，请先将打包好的 exe 文件放到 downloads 文件夹中' 
      });
    }
    
    // 设置下载响应头
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
    
    // 发送文件
    res.sendFile(exePath, (err) => {
      if (err) {
        console.error('下载文件失败:', err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: '下载失败' });
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Signaling Server running on http://localhost:${PORT}`);
  });
}

startServer();
