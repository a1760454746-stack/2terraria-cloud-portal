import React, { useState, useRef, useEffect } from 'react';
import { Upload, Download, X } from 'lucide-react';

interface P2PFileTransferProps {
  dataChannel: RTCDataChannel | null;
  onClose: () => void;
  onNotification: (msg: string) => void;
}

const P2PFileTransfer: React.FC<P2PFileTransferProps> = ({
  dataChannel,
  onClose,
  onNotification
}) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [savePath, setSavePath] = useState('C:/Users/Public/Downloads');
  const [remotePath, setRemotePath] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 接收文件的缓冲区
  const receivingFilesRef = useRef<{[key: string]: {
    name: string;
    size: number;
    chunks: Uint8Array[];
    received: number;
  }}>({});

  const generateFileId = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  // 监听来自被控制端的文件
  useEffect(() => {
    if (!dataChannel) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        if (typeof event.data === 'string') {
          const data = JSON.parse(event.data);

          // 接收来自被控制端的文件开始信号
          if (data.type === 'file_start_from_host') {
            console.log('📥 开始接收来自被控制端的文件:', data.fileName);
            setIsDownloading(true);
            setDownloadProgress(0);
            receivingFilesRef.current[data.fileId] = {
              name: data.fileName,
              size: data.fileSize,
              chunks: [],
              received: 0
            };
          }

          // 接收文件结束信号
          else if (data.type === 'file_end_from_host') {
            console.log('✅ 文件接收完成:', data.fileId);
            const fileData = receivingFilesRef.current[data.fileId];
            if (fileData) {
              // 合并所有块并下载
              const blob = new Blob(fileData.chunks as BlobPart[]);
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = fileData.name;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);

              onNotification(`✅ 已下载: ${fileData.name}`);
              delete receivingFilesRef.current[data.fileId];
            }
            setIsDownloading(false);
            setDownloadProgress(0);
          }
        }
        // 接收二进制数据块
        else if (event.data instanceof ArrayBuffer) {
          const data = new Uint8Array(event.data);
          if (data.length > 36) {
            const fileId = new TextDecoder().decode(data.slice(0, 36));
            const chunkData = data.slice(36);

            const fileData = receivingFilesRef.current[fileId];
            if (fileData) {
              fileData.chunks.push(chunkData);
              fileData.received += chunkData.length;
              const progress = Math.round((fileData.received / fileData.size) * 100);
              setDownloadProgress(progress);
            }
          }
        }
      } catch (err) {
        console.error('处理接收消息失败:', err);
      }
    };

    dataChannel.addEventListener('message', handleMessage);
    return () => {
      dataChannel.removeEventListener('message', handleMessage);
    };
  }, [dataChannel, onNotification]);

  // 发送文件到被控制端
  const sendFileToHost = async (file: File) => {
    if (!dataChannel || dataChannel.readyState !== 'open') {
      onNotification('❌ 数据通道未连接');
      return;
    }

    console.log('📤 开始发送文件到被控制端:', file.name);
    setIsUploading(true);
    setUploadProgress(0);

    const fileId = generateFileId();
    const chunkSize = 16384;

    try {
      dataChannel.send(JSON.stringify({
        type: 'file_start',
        fileId,
        fileName: file.name,
        fileSize: file.size,
        savePath
      }));

      await new Promise(resolve => setTimeout(resolve, 50));

      const reader = new FileReader();
      let offset = 0;

      const readSlice = () => {
        const slice = file.slice(offset, offset + chunkSize);
        reader.readAsArrayBuffer(slice);
      };

      reader.onload = async (e) => {
        if (e.target?.result) {
          const fileIdBytes = new TextEncoder().encode(fileId);
          const chunkData = new Uint8Array(e.target.result as ArrayBuffer);
          const message = new Uint8Array(fileIdBytes.length + chunkData.length);
          message.set(fileIdBytes, 0);
          message.set(chunkData, fileIdBytes.length);

          dataChannel.send(message);
          offset += chunkSize;
          setUploadProgress(Math.round(Math.min((offset / file.size) * 100, 100)));

          if (offset < file.size) {
            readSlice();
          } else {
            await new Promise(resolve => setTimeout(resolve, 100));
            dataChannel.send(JSON.stringify({
              type: 'file_end',
              fileId,
              savePath
            }));
            onNotification(`✅ 文件已发送: ${file.name}`);
            setIsUploading(false);
            setUploadProgress(0);
          }
        }
      };

      readSlice();
    } catch (err) {
      console.error('发送文件失败:', err);
      onNotification('❌ 发送失败');
      setIsUploading(false);
    }
  };

  // 请求从被控制端下载文件
  const requestFileFromHost = () => {
    if (!dataChannel || dataChannel.readyState !== 'open') {
      onNotification('❌ 数据通道未连接');
      return;
    }

    if (!remotePath.trim()) {
      onNotification('❌ 请输入远程文件路径');
      return;
    }

    console.log('📥 请求下载文件:', remotePath);
    dataChannel.send(JSON.stringify({
      type: 'request_file',
      filePath: remotePath
    }));
    onNotification('⏳ 正在请求文件...');
  };

  return (
    <div role="dialog" style={{
      position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
      background: 'rgba(0, 0, 0, 0.95)', border: '2px solid #4CAF50', borderRadius: '12px',
      padding: '24px', minWidth: '500px', maxWidth: '600px', zIndex: 1000, color: 'white',
      maxHeight: '80vh', overflowY: 'auto'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h3 style={{ margin: 0 }}>📁 双向文件传输</h3>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}>
          <X size={20} />
        </button>
      </div>

      {/* 上传 */}
      <div style={{ marginBottom: '30px', padding: '16px', background: 'rgba(76, 175, 80, 0.1)', borderRadius: '8px' }}>
        <h4 style={{ margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Upload size={18} /> 上传到被控制端
        </h4>
        <input type="text" value={savePath} onChange={(e) => setSavePath(e.target.value)}
          placeholder="C:/Users/Public/Downloads"
          style={{ width: '100%', padding: '10px', marginBottom: '12px', background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.3)', borderRadius: '6px', color: 'white' }} />
        <input ref={fileInputRef} type="file" onChange={(e) => e.target.files?.[0] && sendFileToHost(e.target.files[0])}
          style={{ display: 'none' }} />
        <button onClick={() => fileInputRef.current?.click()} disabled={isUploading}
          style={{ width: '100%', padding: '12px', background: isUploading ? '#666' : '#4CAF50',
            border: 'none', borderRadius: '6px', color: 'white', cursor: isUploading ? 'not-allowed' : 'pointer' }}>
          {isUploading ? `上传中... ${uploadProgress}%` : '选择文件上传'}
        </button>
        {isUploading && <div style={{ marginTop: '12px', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>
          <div style={{ width: `${uploadProgress}%`, height: '100%', background: '#4CAF50', transition: 'width 0.3s' }} />
        </div>}
      </div>

      {/* 下载 */}
      <div style={{ padding: '16px', background: 'rgba(33, 150, 243, 0.1)', borderRadius: '8px' }}>
        <h4 style={{ margin: '0 0 12px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Download size={18} /> 从被控制端下载
        </h4>
        <input type="text" value={remotePath} onChange={(e) => setRemotePath(e.target.value)}
          placeholder="C:/Users/用户名/Desktop/file.txt"
          style={{ width: '100%', padding: '10px', marginBottom: '12px', background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.3)', borderRadius: '6px', color: 'white' }} />
        <button onClick={requestFileFromHost} disabled={isDownloading}
          style={{ width: '100%', padding: '12px', background: isDownloading ? '#666' : '#2196F3',
            border: 'none', borderRadius: '6px', color: 'white', cursor: isDownloading ? 'not-allowed' : 'pointer' }}>
          {isDownloading ? `下载中... ${downloadProgress}%` : '请求下载文件'}
        </button>
        {isDownloading && <div style={{ marginTop: '12px', height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }}>
          <div style={{ width: `${downloadProgress}%`, height: '100%', background: '#2196F3', transition: 'width 0.3s' }} />
        </div>}
      </div>

      <div style={{ marginTop: '16px', fontSize: '12px', color: '#aaa' }}>
        💡 提示: 文件通过 WebRTC 点对点传输 • 使用正斜杠路径
      </div>
    </div>
  );
};

export default P2PFileTransfer;
