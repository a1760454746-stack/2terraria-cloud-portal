// import React from 'react';
// import { X, Maximize2 } from 'lucide-react';

// interface RunningApp {
//   instanceId: string;
//   appId: string;
//   appName: string;
//   deviceId: string;
//   deviceName: string;
//   startedAt: string;
//   pid?: number;
// }

// interface RunningAppsProps {
//   runningApps: RunningApp[];
//   onFocusApp: (instanceId: string) => void;
//   onStopApp: (instanceId: string) => void;
// }

// const RunningApps: React.FC<RunningAppsProps> = ({ runningApps, onFocusApp, onStopApp }) => {
//   if (runningApps.length === 0) {
//     return (
//       <div className="running-apps-empty">
//         <p>暂无运行中的应用</p>
//       </div>
//     );
//   }

//   return (
//     <div className="running-apps-container">
//       <h3 className="running-apps-title">运行中的应用 ({runningApps.length})</h3>
//       <div className="running-apps-list">
//         {runningApps.map(app => (
//           <div key={app.instanceId} className="running-app-card">
//             <div className="running-app-info">
//               <div className="running-app-name">{app.appName}</div>
//               <div className="running-app-device">{app.deviceName}</div>
//               <div className="running-app-time">
//                 启动于 {new Date(app.startedAt).toLocaleTimeString()}
//               </div>
//             </div>
//             <div className="running-app-actions">
//               <button
//                 onClick={() => onFocusApp(app.instanceId)}
//                 className="running-app-btn running-app-btn-focus"
//                 title="切换到此应用"
//               >
//                 <Maximize2 size={16} />
//               </button>
//               <button
//                 onClick={() => onStopApp(app.instanceId)}
//                 className="running-app-btn running-app-btn-stop"
//                 title="停止应用"
//               >
//                 <X size={16} />
//               </button>
//             </div>
//           </div>
//         ))}
//       </div>
//     </div>
//   );
// };

// export default RunningApps;
