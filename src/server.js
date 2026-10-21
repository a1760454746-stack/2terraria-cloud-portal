// import express from 'express';
// import { createServer as createViteServer } from 'vite';
// import { WebSocketServer, WebSocket } from 'ws';
// import http from 'http';
// import path from 'path';
// import Turn from 'node-turn';

// async function startServer() {
//   const app = express();
//   const PORT = 8443;

//   const server = http.createServer(app);
//   const wss = new WebSocketServer({ server, path: '/signaling' });

//   // 多设备管理：{ hostId: { socket, hostName, connectedAt } }
//   const hosts = new Map();
//   const clients = new Set();

//   wss.on('connection', (ws) => {
//     console.log('New WebSocket connection');
//     ws.on('message', (message) => {
//       try {
//         const data = JSON.parse(message.toString());
//         switch (data.type) {
//           case 'register_host':
//             const hostId = data.hostId || `host_${Date.now()}`;
//             const hostName = data.hostName || `设备_${hostId.slice(-4)}`;
//             console.log(`Host registered: ${hostName} (${hostId})`);
            
//             hosts.set(hostId, {
//               socket: ws,
//               hostName: hostName,
//               hostId: hostId,
//               connectedAt: new Date().toISOString()
//             });
            
//             // 通知所有客户端有新设备上线
//             clients.forEach(client => {
//               if (client.readyState === WebSocket.OPEN) {
//                 client.send(JSON.stringify({ 
//                   type: 'host_available',
//                   hostId: hostId,
//                   hostName: hostName
//                 }));
//               }
//             });
//             break;
//           case 'register_client':
//             console.log('Client registered');
//             clients.add(ws);
//             // 发送当前所有在线设备列表
//             const deviceList = Array.from(hosts.values()).map(h => ({
//               hostId: h.hostId,
//               hostName: h.hostName,
//               connectedAt: h.connectedAt
//             }));
//             ws.send(JSON.stringify({ 
//               type: 'device_list',
//               devices: deviceList
//             }));
//             break;
//           case 'offer':
//           case 'answer':
//           case 'ice_candidate':
//             const targetHostId = data.targetHostId;
            
//             if (data.target === 'host' && targetHostId) {
//               // 客户端发给指定设备
//               const targetHost = hosts.get(targetHostId);
//               if (targetHost && targetHost.socket.readyState === WebSocket.OPEN) {
//                 targetHost.socket.send(JSON.stringify({ ...data, sender: 'client' }));
//               } else {
//                 console.log(`Target host ${targetHostId} not available`);
//               }
//             } else if (data.target === 'client') {
//               // 设备发给客户端
//               clients.forEach(client => {
//                 if (client.readyState === WebSocket.OPEN) {
//                   client.send(JSON.stringify({ ...data, sender: 'host' }));
//                 }
//               });
//             }
//             break;
//           case 'input':
//             const inputTargetHostId = data.targetHostId;
//             if (inputTargetHostId) {
//               const targetHost = hosts.get(inputTargetHostId);
//               if (targetHost && targetHost.socket.readyState === WebSocket.OPEN) {
//                 targetHost.socket.send(JSON.stringify(data));
//               }
//             }
//             break;
//           default:
//             console.log('Unknown message type:', data.type);
//         }
//       } catch (err) {
//         console.error('Error parsing message:', err);
//       }
//     });
//     ws.on('close', () => {
//       // 检查是否是设备断开
//       let disconnectedHostId = null;
//       for (const [hostId, hostInfo] of hosts.entries()) {
//         if (hostInfo.socket === ws) {
//           disconnectedHostId = hostId;
//           hosts.delete(hostId);
//           console.log(`Host disconnected: ${hostInfo.hostName} (${hostId})`);
//           break;
//         }
//       }
      
//       if (disconnectedHostId) {
//         // 通知所有客户端设备离线
//         clients.forEach(client => {
//           if (client.readyState === WebSocket.OPEN) {
//             client.send(JSON.stringify({ 
//               type: 'host_disconnected',
//               hostId: disconnectedHostId
//             }));
//           }
//         });
//       } else {
//         // 客户端断开
//         console.log('Client disconnected');
//         clients.delete(ws);
//       }
//     });
//   });

//   app.get('/api/health', (req, res) => {
//     res.json({ 
//       status: 'ok', 
//       hostsCount: hosts.size, 
//       clients: clients.size 
//     });
//   });

//   // 新增：获取在线设备列表
//   app.get('/api/devices', (req, res) => {
//     const deviceList = Array.from(hosts.values()).map(h => ({
//       hostId: h.hostId,
//       hostName: h.hostName,
//       connectedAt: h.connectedAt
//     }));
//     res.json({ devices: deviceList });
//   });

//   if (process.env.NODE_ENV !== 'production') {
//     const vite = await createViteServer({
//       server: { middlewareMode: true },
//       appType: 'spa',
//     });
//     app.use(vite.middlewares);
//   } else {
//     const distPath = path.join(process.cwd(), 'dist');
//     app.use(express.static(distPath));
//     app.get('*', (req, res) => {
//       res.sendFile(path.join(distPath, 'index.html'));
//     });
//   }

//   server.listen(PORT, '0.0.0.0', () => {
//     console.log(`Signaling Server running on http://localhost:${PORT}`);
//   });
// }

// startServer();
