import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { 
  FaSatelliteDish, 
  FaPaperPlane, 
  FaCloudUploadAlt, 
  FaNetworkWired, 
  FaFolderOpen, 
  FaSyncAlt, 
  FaUserCircle, 
  FaDownload, 
  FaCheckCircle 
} from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import './App.css';

// Configure Axios with base URL based on current host if needed
// For development, we'll assume backend is on port 3000
const API_BASE = window.location.port === '5173' ? 'http://localhost:3000' : '';

function App() {
  const [myInfo, setMyInfo] = useState({ id: '...', ip: '...' });
  const [hostedFiles, setHostedFiles] = useState([]);
  const [peers, setPeers] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/status`);
      setMyInfo(data);
    } catch (err) {
      console.error('Failed to fetch node status', err);
    }
  }, []);

  const fetchHostedFiles = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/hosted`);
      setHostedFiles(data);
    } catch (err) {
      console.error('Failed to fetch hosted files', err);
    }
  }, []);

  const fetchPeers = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_BASE}/peers`);
      setPeers(data);
    } catch (err) {
      console.error('Failed to fetch network peers', err);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchHostedFiles();
    fetchPeers();
    const interval = setInterval(fetchPeers, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchHostedFiles, fetchPeers]);

  const handleFileUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadStatus(`Sharing ${file.name}...`);
    
    const formData = new FormData();
    formData.append('file', file);

    try {
      await axios.post(`${API_BASE}/host`, formData);
      setUploadStatus(`Successfully shared: ${file.name}`);
      fetchHostedFiles();
      setTimeout(() => setUploadStatus(''), 4000);
    } catch (err) {
      setUploadStatus(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  const downloadFromPeer = (peerIp, peerPort, fileId, fileName) => {
    const url = `http://${peerIp}:${peerPort}/download/${fileId}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="netshare-container">
      <header className="glass-header">
        <div className="logo-group">
          <motion.div animate={{ scale: [1, 1.1, 1] }} transition={{ repeat: Infinity, duration: 2 }}>
            <FaSatelliteDish className="logo-icon" />
          </motion.div>
          <h1>P2P NetShare</h1>
        </div>
        <div className="node-info-badges">
          <div className="badge primary">ID: {myInfo.id}</div>
          <div className="badge secondary">IP: {myInfo.ip}</div>
        </div>
      </header>

      <main className="content-grid">
        {/* Upload Section */}
        <section className="card-section upload-area">
          <h3><FaPaperPlane /> Share a New File</h3>
          <div 
            className={`drop-zone ${isDragOver ? 'dragover' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragOver(false); handleFileUpload(e.dataTransfer.files[0]); }}
            onClick={() => document.getElementById('file-input').click()}
          >
            <input 
              type="file" 
              id="file-input" 
              hidden 
              onChange={(e) => handleFileUpload(e.target.files[0])} 
            />
            <FaCloudUploadAlt className="upload-icon" />
            <p>Drag & Drop or click to host file</p>
            <span className="hint">Publicly available on local network</span>
          </div>
          <AnimatePresence>
            {uploadStatus && (
              <motion.p 
                initial={{ opacity: 0, y: 10 }} 
                animate={{ opacity: 1, y: 0 }} 
                exit={{ opacity: 0 }}
                className="status-text"
              >
                {uploadStatus}
              </motion.p>
            )}
          </AnimatePresence>
        </section>

        <div className="peer-and-myfiles">
          {/* Peer Discovery Section */}
          <section className="card-section">
            <div className="section-header">
              <h3><FaNetworkWired /> Online Peers</h3>
              <button onClick={fetchPeers} className="refresh-btn"><FaSyncAlt /></button>
            </div>
            <div className="list-container">
              {peers.length === 0 ? (
                <div className="empty-state">Searching for nodes...</div>
              ) : peers.map(peer => (
                <motion.div layout id={peer.id} key={peer.id} className="item-card peer-node">
                  <div className="peer-title">
                    <FaUserCircle className="user-icon" />
                    <div>
                      <h4>Node-{peer.id}</h4>
                      <span>{peer.ip}:{peer.port}</span>
                    </div>
                  </div>
                  <div className="peer-files">
                    {peer.files.map(f => (
                      <div key={f.id} className="file-row">
                        <span>{f.name}</span>
                        <button onClick={() => downloadFromPeer(peer.ip, peer.port, f.id, f.name)}>
                          <FaDownload />
                        </button>
                      </div>
                    ))}
                    {peer.files.length === 0 && <span className="no-files">No files shared yet</span>}
                  </div>
                </motion.div>
              ))}
            </div>
          </section>

          {/* My Hosted Files Section */}
          <section className="card-section">
            <h3><FaFolderOpen /> My Hosted Files</h3>
            <div className="list-container">
              {hostedFiles.length === 0 ? (
                <div className="empty-state">Not hosting anything yet.</div>
              ) : hostedFiles.map(file => (
                <div key={file.id} className="item-card my-file">
                  <div>
                    <h4>{file.name}</h4>
                    <span>{(file.size / 1024).toFixed(1)} KB | ID: {file.id}</span>
                  </div>
                  <FaCheckCircle className="success-icon" />
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>

      <footer>
        <p>Reliable P2P File Sharing Engine v1.0 &copy; 2026</p>
      </footer>
    </div>
  );
}

export default App;
