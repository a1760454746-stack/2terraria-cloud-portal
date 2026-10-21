import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

window.addEventListener('error', (event) => {
  console.error('Global error caught:', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  // 忽略 Vite HMR WebSocket 导致的预期内的报错
  if (event.reason && event.reason.message && event.reason.message.includes('WebSocket closed without opened')) {
    event.preventDefault(); // 阻止浏览器在控制台打印 Uncaught (in promise)
    return;
  }
  console.error('Unhandled promise rejection caught:', event.reason);
});

createRoot(document.getElementById('root')!).render(
  <App />,
);
