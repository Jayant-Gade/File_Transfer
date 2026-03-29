import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
  FaCheckCircle,
  FaArrowRight,
  FaBell,
  FaTimes,
  FaCheck,
  FaHeart,
  FaRegHeart,
  FaPowerOff,
  FaLink,
  FaEnvelope,
  FaShareSquare,
  FaGlobe
} from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import './App.css';

const API_BASE = window.location.port === '5173' || window.location.port === '5174' ? 'http://localhost:3000' : '';

function App() {
  const [myInfo, setMyInfo] = useState({ id: 'ALPHA', ip: '0.0.0.0', port: 3000 });
  const [hostedFiles, setHostedFiles] = useState([]);
  const [peers, setPeers] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [transfers, setTransfers] = useState([]); // Dynamic from API
  const [uploadStatus, setUploadStatus] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [activeTab, setActiveTab] = useState('discovery'); // 'discovery', 'transfers', 'requests', 'publish'
  const [activePeerMenu, setActivePeerMenu] = useState(null); 
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  // --- Fetch Logic ---

  const fetchAll = useCallback(async () => {
    try {
      const [status, hosted, peersRes, favs, reqs, xfers] = await Promise.all([
        axios.get(`${API_BASE}/status`),
        axios.get(`${API_BASE}/hosted`),
        axios.get(`${API_BASE}/peers`),
        axios.get(`${API_BASE}/favorites`),
        axios.get(`${API_BASE}/requests`),
        axios.get(`${API_BASE}/transfers`)
      ]);
      setMyInfo(status.data);
      setHostedFiles(hosted.data);
      setPeers(peersRes.data);
      setFavorites(favs.data);
      setIncomingRequests(reqs.data);
      setTransfers(xfers.data);
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 3000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // --- Actions ---

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setSelectedFile(file);
    setUploadStatus(`Ready to publish: ${file.name}`);
    
    // Auto-Host if selected via profile/publish buttons?
    // Let's actually host it immediately as the user asked for a "Publish" button
    const formData = new FormData();
    formData.append('file', file);
    try {
        await axios.post(`${API_BASE}/host`, formData);
        fetchAll();
        setUploadStatus(`Directly Hosted: ${file.name}`);
        setSelectedFile(null);
        setTimeout(() => setUploadStatus(''), 4000);
    } catch (err) {
        setUploadStatus(`Hosting failed: ${err.message}`);
    }
  };

  const sendFileToPeer = async (peer) => {
    if (!selectedFile) {
        alert("Please select a file first via the Profile Menu or Drag & Drop");
        return;
    }
    setUploadStatus(`Initializing transfer to ${peer.id}...`);
    setActivePeerMenu(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      const { data: hostData } = await axios.post(`${API_BASE}/host`, formData);
      
      const peerApiUrl = `http://${peer.ip}:${peer.port}/receive-request`;
      await axios.post(peerApiUrl, {
        senderId: myInfo.id,
        senderIp: myInfo.ip,
        senderPort: myInfo.port,
        fileId: hostData.fileId,
        fileName: selectedFile.name,
        size: selectedFile.size
      });

      setUploadStatus(`Request sent to ${peer.id}!`);
      setSelectedFile(null);
      setTimeout(() => setUploadStatus(''), 4000);
    } catch (err) {
      setUploadStatus(`Transfer failed: ${err.message}`);
    }
  };

  const toggleFavorite = async (peerId) => {
    try {
      const { data } = await axios.post(`${API_BASE}/favorites/toggle`, { peerId });
      setFavorites(data.favorites);
    } catch (err) { console.error(err); }
  };

  const handleRequestAction = async (requestId, action) => {
    try {
      const { data } = await axios.post(`${API_BASE}/requests/${requestId}/action`, { action });
      if (action === 'accept' && data.downloadUrl) {
        window.open(data.downloadUrl, '_blank');
      }
      fetchAll();
    } catch (err) { console.error(err); }
  };

  const handleManualSync = async (addr) => {
    if (!addr) return;
    const parts = addr.split(':');
    const ip = parts[0];
    const port = parts[1] || '3000';
    setUploadStatus(`SYNCING_MANUALLY_WITH_${ip}:${port}...`);
    try {
        await axios.post(`${API_BASE}/peers/manual`, { ip, port });
        fetchAll();
        setUploadStatus(`SYNC_SUCCESSFUL_PEER_CONNECTED!`);
        setTimeout(() => setUploadStatus(''), 3000);
    } catch (e) {
        setUploadStatus(`SYNC_FAILED: CHECK_TARGET_STATUS`);
        setTimeout(() => setUploadStatus(''), 3000);
    }
  };

  // --- Radar Calculations ---
  const peerPositions = useMemo(() => {
    const radius = 220; 
    return peers.map((peer, index) => {
        const angle = (index / peers.length) * 2 * Math.PI - Math.PI / 2;
        return { ...peer, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    });
  }, [peers]);

  const [discoveryView, setDiscoveryView] = useState('devices'); // 'devices', 'files'
  const [nearbyFiles, setNearbyFiles] = useState([]); // Aggregated files from peers

  // --- Aggregation logic for nearby files ---
  useEffect(() => {
    if (activeTab === 'discovery' && discoveryView === 'files') {
        const fetchPeerFiles = async () => {
            const allFiles = [];
            for (const peer of peers) {
                try {
                    const { data } = await axios.get(`http://${peer.ip}:${peer.port}/hosted`);
                    allFiles.push(...data.map(f => ({ ...f, ownerId: peer.id, ownerIp: peer.ip, ownerPort: peer.port })));
                } catch (e) { console.error(`Failed to fetch from ${peer.id}`); }
            }
            setNearbyFiles(allFiles);
        };
        fetchPeerFiles();
    }
  }, [peers, activeTab, discoveryView]);

  // (Structural alignment)

  return (
    <div className="g-os-container" onClick={() => setShowProfileMenu(false)}>
      {/* Top Bar */}
      <nav className="kinetic-nav" onClick={(e) => e.stopPropagation()}>
        <div className="nav-left">
          <span className="brand">G_OS</span>
          <span className="separator">|</span>
          <span className="command-title">KINETIC_COMMAND</span>
        </div>
        
        {/* TAB BAR */}
        <div className="tab-switcher">
            <button className={activeTab === 'discovery' ? 'active' : ''} onClick={() => setActiveTab('discovery')}>
                <FaSatelliteDish /> RADAR
            </button>
            <button className={activeTab === 'publish' ? 'active' : ''} onClick={() => setActiveTab('publish')}>
                <FaGlobe /> PUBLISH
            </button>
            <button className={activeTab === 'transfers' ? 'active' : ''} onClick={() => setActiveTab('transfers')}>
                <FaArrowRight /> TRANSMISSION
            </button>
            <button className={activeTab === 'requests' ? 'active' : ''} onClick={() => setActiveTab('requests')}>
                <FaBell /> REQUESTS
                {incomingRequests.length > 0 && <span className="notif-badge">{incomingRequests.length}</span>}
            </button>
        </div>

        <div className="nav-right profile-section">
          <div className="profile-trigger" onClick={() => setShowProfileMenu(!showProfileMenu)}>
              <div className="trigger-info">
                  <span className="t-status">ONLINE</span>
                  <span className="t-id">0x{myInfo.id.toUpperCase()}</span>
              </div>
              <img src={`https://api.dicebear.com/7.x/pixel-art/svg?seed=${myInfo.id}`} alt="user" className="avatar" />
          </div>

          <AnimatePresence>
            {showProfileMenu && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="profile-dropdown">
                    <div className="dropdown-section">
                        <label>NODE_IDENTITY</label>
                        <div className="d-val">ID: {myInfo.id}</div>
                    </div>
                    <div className="dropdown-section">
                        <button className="btn-host-new" onClick={() => document.getElementById('file-input').click()}>
                            <FaCloudUploadAlt /> HOST_NEW_STREAM
                        </button>
                        <input type="file" id="file-input" hidden onChange={handleFileUpload} />
                        {selectedFile && <div className="queued-hint">P_LIST: {selectedFile.name.substring(0, 15)}</div>}
                    </div>
                </motion.div>
            )}
          </AnimatePresence>
        </div>
      </nav>

      <main className="radar-layout">
        <div className="radar-main">
          {activeTab === 'discovery' && (
            <div className={`discovery-tab-layout ${discoveryView === 'files' ? 'files-active' : ''}`}>
                <div className="discovery-subtabs">
                    <button className={discoveryView === 'devices' ? 'active' : ''} onClick={() => setDiscoveryView('devices')}>DEVICES</button>
                    <button className={discoveryView === 'files' ? 'active' : ''} onClick={() => setDiscoveryView('files')}>NEARBY_FILES</button>
                </div>

                {discoveryView === 'devices' ? (
                    <div className="radar-circle-container">
                        <div className="radar-outer-ring"></div>
                        <div className="radar-inner-ring"></div>
                        <div className="radar-crosshair-h"></div>
                        <div className="radar-crosshair-v"></div>
                        <div className="central-status-display">
                            <span className="scan-text">SCANNING_PROTOCOL_v1.1</span>
                            {uploadStatus && <div className="live-status-toast">{uploadStatus}</div>}
                            <div className="manual-sync-bar">
                                <input id="manual-ip-input" placeholder="IP:PORT (e.g. 192.168.1.5:3000)" onKeyDown={(e) => { if(e.key === 'Enter') handleManualSync(e.target.value); }} />
                                <button onClick={() => handleManualSync(document.getElementById('manual-ip-input').value)}>MANUAL_SYNC</button>
                            </div>
                        </div>
                        {peerPositions.map((peer) => (
                            <div key={peer.id} className="peer-wrapper" style={{ transform: `translate(${peer.x}px, ${peer.y}px)` }}>
                                <motion.div className={`peer-node-icon ${favorites.includes(peer.id) ? 'is-fav' : ''}`} whileHover={{ scale: 1.2 }} onClick={() => setActivePeerMenu(activePeerMenu === peer.id ? null : peer.id)}>
                                    <FaUserCircle className="small-icon" />
                                    {favorites.includes(peer.id) && <FaHeart className="fav-star-mini" />}
                                </motion.div>
                                <AnimatePresence>
                                    {activePeerMenu === peer.id && (
                                        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="peer-action-dialog">
                                            <div className="dialog-header"><strong>{peer.id.toUpperCase()}</strong><span>{peer.ip}</span></div>
                                            <div className="dialog-body">
                                                <button className="btn-direct-send" onClick={() => sendFileToPeer(peer)}><FaPaperPlane /> SEND_DIRECT</button>
                                                <button className={`btn-fav-toggle ${favorites.includes(peer.id) ? 'active' : ''}`} onClick={() => toggleFavorite(peer.id)}>
                                                    {favorites.includes(peer.id) ? <FaHeart /> : <FaRegHeart />} STAR_FAV
                                                </button>
                                            </div>
                                            <button className="btn-close-dialog" onClick={() => setActivePeerMenu(null)}>CLOSE</button>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="nearby-files-view">
                        <div className="hosted-files-grid">
                            {nearbyFiles.length === 0 ? (
                                <div className="empty-box">NO_NEARBY_FILES_FOUND</div>
                            ) : nearbyFiles.map((f, idx) => (
                                <div key={idx} className="hosted-card nearby">
                                    <FaFolderOpen className="card-icon" />
                                    <div className="card-info">
                                        <strong>{f.name}</strong>
                                        <span>FROM: {f.ownerId.toUpperCase()}</span>
                                    </div>
                                    <button className="btn-download-quick" onClick={() => window.open(`http://${f.ownerIp}:${f.ownerPort}/download/${f.id}`, '_blank')}>
                                        <FaDownload />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
          )}

          {activeTab === 'publish' && (
            <div className="publish-view-content">
                <button className="btn-publish-fixed" onClick={() => document.getElementById('file-input-tab').click()}>
                    <FaShareSquare /> START_NEW_PUBLIC
                </button>
                <input type="file" id="file-input-tab" hidden onChange={handleFileUpload} />
                
                <div className="publish-header-compact"><h3>PUBLIC_STREAMS</h3></div>
                <div className="hosted-files-grid compact-grid">
                    {hostedFiles.length === 0 ? (
                        <div className="empty-box">NO_STREAMS_ACTIVE_CURRENTLY</div>
                    ) : hostedFiles.map(f => (
                        <div key={f.id} className="hosted-card">
                            <FaFolderOpen className="card-icon" />
                            <div className="card-info">
                                <strong>{f.name}</strong>
                                <span>SIZE: {(f.size / 1024 / 1024).toFixed(2)} MB</span>
                            </div>
                            <div className="card-status-badge">PUBLIC</div>
                        </div>
                    ))}
                </div>
            </div>
          )}

          {activeTab === 'transfers' && (
            <div className="transfer-view-content stretch">
                <div className="publish-header-compact"><h3>ACTIVE_TRANSMISSIONS</h3></div>
                <div className="hosted-files-grid">
                    {transfers.length === 0 ? (
                         <div className="empty-box">NO_DATA_FLOWING</div>
                    ) : transfers.map(t => (
                        <div key={t.id} className={`hosted-card transmission-card ${t.status}`}>
                            <div className="card-progress-circle">
                                <svg width="40" height="40">
                                    <circle cx="20" cy="20" r="18" stroke="rgba(0,255,0,0.1)" strokeWidth="2.5" fill="none" />
                                    <circle cx="20" cy="20" r="18" stroke="var(--primary)" strokeWidth="2.5" 
                                            fill="none" strokeDasharray="113" strokeDashoffset={113 - (113 * t.progress / 100)} />
                                </svg>
                                <div className="status-center-icon">
                                    {t.status === 'completed' && <FaCheck className="ic-ok" />}
                                    {t.status === 'transferring' && <span className="p-text">{t.progress}%</span>}
                                    {t.status === 'pending' && <FaSyncAlt className="ic-spin" />}
                                    {t.status === 'failed' && <FaTimes className="ic-err" />}
                                </div>
                            </div>
                            <div className="card-info">
                                <strong>{t.name}</strong>
                                <span>PEER: {t.peer} | {t.size}</span>
                            </div>
                            <div className={`transfer-status-tag ${t.status}`}>{t.status.toUpperCase()}</div>
                        </div>
                    ))}
                </div>
            </div>
          )}

          {activeTab === 'requests' && (
            <div className="requests-view-content">
                <h3>INCOMING_TRANSMISSIONS</h3>
                <div className="requests-grid-list">
                    {incomingRequests.length === 0 ? (
                        <div className="empty-box">NO_PENDING_REQUESTS</div>
                    ) : incomingRequests.map(req => (
                        <div key={req.id} className="request-pane">
                            <div className="r-head">
                                <strong>PEER_{req.senderId.toUpperCase()}</strong>
                                <span>{req.senderIp}</span>
                            </div>
                            <div className="r-file">{req.fileName}</div>
                            <div className="r-actions">
                                <button onClick={() => handleRequestAction(req.id, 'accept')}>ACCEPT_STREAM</button>
                                <button className="r-decline" onClick={() => handleRequestAction(req.id, 'decline')}>ABORT</button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
          )}
        </div>
      </main>

      <footer className="kinetic-footer">
        <div className="footer-left">
            <span>NODE_ID: 0x{myInfo.id.toUpperCase()}_ALPHA</span>
            <span>ENCRYPTION: AES_X_KINETIC</span>
        </div>
        <div className="footer-right">
            <FaPowerOff />
            <span className="help-icon">?</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
