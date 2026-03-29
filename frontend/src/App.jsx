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
  const [droppedFiles, setDroppedFiles] = useState([]); // Storage for drag-dropped files (tactical vault)

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

  // --- AUTO_RECEIVE HANDLER (Favorite Peers) ---
  const [downloadedRequestIds, setDownloadedRequestIds] = useState(new Set());
  useEffect(() => {
     incomingRequests.forEach(req => {
         if (req.status === 'accepted' && !downloadedRequestIds.has(req.id)) {
             console.log(`Auto-Initializing Retrieval for Request ${req.id}`);
             // Trigger download
             const fileData = {
                 id: req.fileId,
                 name: req.fileName,
                 size: req.size,
                 ownerIp: req.senderIp,
                 ownerPort: req.senderPort,
                 ownerId: req.senderId
             };
             handleDownload(fileData);
             setDownloadedRequestIds(prev => new Set(prev).add(req.id));
         }
     });
  }, [incomingRequests, downloadedRequestIds]);

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

  const sendFileToPeer = async (peer, fileItem, isAlreadyHosted = false) => {
    if (!fileItem) return;
    setUploadStatus(`Initializing transfer of ${fileItem.name} to ${peer.id}...`);
    setActivePeerMenu(null);

    try {
      let fileId = fileItem.id;
      if (!isAlreadyHosted) {
          // Host it first
          const formData = new FormData();
          formData.append('file', fileItem);
          const { data } = await axios.post(`${API_BASE}/host`, formData);
          fileId = data.fileId;
      }
      
      const formattedIp = peer.ip.includes(':') ? `[${peer.ip}]` : peer.ip;
      const peerApiUrl = `http://${formattedIp}:${peer.port}/receive-request`;
      
      const { data: receiveRes } = await axios.post(peerApiUrl, {
        senderId: myInfo.id,
        senderIp: myInfo.ip || '127.0.0.1',
        senderPort: myInfo.port,
        fileId: fileId,
        fileName: fileItem.name,
        size: fileItem.size
      });

      if (receiveRes.status === 'accepted') {
          setUploadStatus(`AUTO_ACCEPTED by ${peer.id}! Stream initialized.`);
      } else {
          setUploadStatus(`Request sent to ${peer.id}! Awaiting approval...`);
      }
      fetchAll();
      setTimeout(() => setUploadStatus(''), 4000);
    } catch (err) {
      setUploadStatus(`Transfer failed: ${err.message}`);
    }
  };

  const handleRadarDrop = (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
        setDroppedFiles(prev => [...prev, ...files]);
        setUploadStatus(`${files.length} FILES_STORE_IN_CENTRAL_VAULT`);
        setTimeout(() => setUploadStatus(''), 3000);
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
      if (action === 'accept' && data.fileInfo) {
          handleDownload(data.fileInfo);
      }
      fetchAll();
    } catch (err) { console.error(err); }
  };

  const handleRefresh = () => {
    setUploadStatus("RE_SCANNING_NETWORK...");
    fetchAll();
    // If we are in files view, also trigger the peer file probe immediately
    if (discoveryView === 'files') {
        const fetchPeerFiles = async () => {
            const allFiles = [];
            for (const peer of peers) {
                try {
                    const formattedIp = peer.ip.includes(':') ? `[${peer.ip}]` : peer.ip;
                    const { data } = await axios.get(`http://${formattedIp}:${peer.port}/hosted`, { timeout: 2000 });
                    allFiles.push(...data.map(f => ({ ...f, ownerId: peer.id, ownerIp: peer.ip, ownerPort: peer.port })));
                } catch (e) { /* silent fail */ }
            }
            setNearbyFiles(allFiles);
        };
        fetchPeerFiles();
    }
    setTimeout(() => setUploadStatus(""), 2000);
  };

  const handleDownload = async (file) => {
    const formattedIp = file.ownerIp.includes(':') ? `[${file.ownerIp}]` : file.ownerIp;
    const downloadUrl = `http://${formattedIp}:${file.ownerPort}/download/${file.id}`;
    const localId = Math.random().toString(36).substring(2, 10);
    const useHighPrecision = (file.size < 500 * 1024 * 1024);

    try {
        const newTransferRecord = {
            id: localId,
            name: file.name,
            size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
            peer: file.ownerId,
            status: 'transferring',
            type: 'received',
            progress: 0,
            timestamp: new Date().toISOString().replace('T', ' ').split('.')[0]
        };

        // 1. Log to server and initialize local state
        await axios.post(`${API_BASE}/transfers/log`, newTransferRecord);
        setTransfers(prev => [newTransferRecord, ...prev]); 
        fetchAll(); // Sync other records

        if (!useHighPrecision) {
            setUploadStatus(`INIT_MASSIVE_RETRIEVAL: ${file.name.substring(0, 15)}...`);
            window.open(downloadUrl, '_blank');
            return;
        }

        setUploadStatus(`RECLAIMING ${file.name.substring(0, 15)}...`);

        const response = await axios({
            url: downloadUrl,
            method: 'GET',
            responseType: 'blob',
            onDownloadProgress: (progressEvent) => {
                const total = progressEvent.total || file.size;
                const loaded = progressEvent.loaded;
                const percent = Math.min(Math.round((loaded * 100) / total), 99);
                
                // Update local state IMMEDIATELY for millisecond UI updates
                setTransfers(prev => prev.map(t => 
                    t.id === localId ? { ...t, progress: percent } : t
                ));

                // Background sync to server ledger every 10% for persistence
                if (percent % 10 === 0) {
                    axios.post(`${API_BASE}/transfers/update`, { id: localId, progress: percent });
                }
            }
        });

        // Trigger browser save
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', file.name);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);

        await axios.post(`${API_BASE}/transfers/update`, { id: localId, progress: 100, status: 'completed' });
        setTransfers(prev => prev.map(t => 
            t.id === localId ? { ...t, progress: 100, status: 'completed' } : t
        ));
        setUploadStatus(`SYNC_COMPLETE: ${file.name}`);
        setTimeout(() => setUploadStatus(''), 3000);
        
    } catch (e) { 
        console.error("Retrieval failed", e);
        setUploadStatus("PRECISION_FAIL: CASCADE_TO_LEGACY_DOWNLOAD");
        window.open(downloadUrl, '_blank');
        await axios.post(`${API_BASE}/transfers/update`, { id: localId, status: 'completed' }); 
        fetchAll();
    }
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
  const [showOwnInNetwork, setShowOwnInNetwork] = useState(false); // Toggle to see own files in Network view
  const [transmissionView, setTransmissionView] = useState('received'); // 'sent', 'received'

  // --- Aggregation logic for nearby files (Server-Side Cached + Self) ---
  useEffect(() => {
    if (activeTab === 'discovery' && discoveryView === 'files') {
        const externalFiles = peers.flatMap(p => (p.files || []).map(f => ({
            ...f,
            ownerId: p.id,
            ownerIp: p.ip,
            ownerPort: p.port
        })));
        
        const ownFiles = showOwnInNetwork ? hostedFiles.map(f => ({
            ...f,
            ownerId: 'LOCAL_NODE',
            ownerIp: '127.0.0.1',
            ownerPort: myInfo.port,
            isLocal: true
        })) : [];

        setNearbyFiles([...ownFiles, ...externalFiles]);
    } else {
        setNearbyFiles([]);
    }
  }, [peers, hostedFiles, activeTab, discoveryView, showOwnInNetwork, myInfo.port]);

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
                    <div className="tab-separator"></div>
                    <button className="btn-refresh-scan" onClick={handleRefresh} title="Manual Network Rescan">
                        <FaSyncAlt /> REFRESH_GRID
                    </button>
                    <div className="tab-separator"></div>
                    <label className="self-toggle">
                        <input type="checkbox" checked={showOwnInNetwork} onChange={(e) => setShowOwnInNetwork(e.target.checked)} />
                        <span>SHOW_OWN_PUBLISHES</span>
                    </label>
                </div>

                {discoveryView === 'devices' ? (
                    <div className="radar-circle-container" onDragOver={(e) => e.preventDefault()} onDrop={handleRadarDrop}>
                        <div className="radar-outer-ring"></div>
                        <div className="radar-inner-ring"></div>
                        <div className="radar-crosshair-h"></div>
                        <div className="radar-crosshair-v"></div>
                        
                        {/* DATA VAULT ICON - Center */}
                        {droppedFiles.length > 0 && (
                            <div className="central-vault-node" title={`${droppedFiles.length} FILES_QUEUED`}>
                                <FaFolderOpen />
                                <span className="vault-count">{droppedFiles.length}</span>
                            </div>
                        )}

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
                                        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} className="peer-action-dialog extended">
                                            <div className="dialog-header"><strong>PEER_{peer.id.toUpperCase()}</strong><span>📡 {peer.ip}</span></div>
                                            <div className="dialog-body">
                                                <div className="action-grid-columns">
                                                    <div className="col">
                                                        <label>INITIALIZE_NEW</label>
                                                        <button className="btn-direct-send" onClick={() => {
                                                            const input = document.createElement('input');
                                                            input.type = 'file';
                                                            const tempId = Math.random().toString(36).substring(2, 10);
                                                            input.onchange = (e) => sendFileToPeer(peer, e.target.files[0], false);
                                                            input.click();
                                                        }}><FaPaperPlane /> NEW_STREAM</button>
                                                    </div>
                                                    
                                                    {hostedFiles.length > 0 && (
                                                    <div className="col">
                                                        <label>SYNC_EXISTING</label>
                                                        <select className="vault-select" onChange={(e) => {
                                                            const f = hostedFiles.find(xf => xf.id === e.target.value);
                                                            if(f) sendFileToPeer(peer, f, true);
                                                        }}>
                                                            <option>SELECT_PUBLISH...</option>
                                                            {hostedFiles.map(f => <option key={f.id} value={f.id}>{f.name.substring(0,10)}...</option>)}
                                                        </select>
                                                    </div>
                                                    )}

                                                    {droppedFiles.length > 0 && (
                                                    <div className="col">
                                                        <label>DATA_VAULT</label>
                                                        <select className="vault-select" onChange={(e) => {
                                                            const f = droppedFiles[parseInt(e.target.value)];
                                                            if(f) sendFileToPeer(peer, f, false);
                                                        }}>
                                                            <option>SELECT_VAULT...</option>
                                                            {droppedFiles.map((f, i) => <option key={i} value={i}>{f.name.substring(0,10)}...</option>)}
                                                        </select>
                                                    </div>
                                                    )}
                                                </div>
                                                
                                                <div className="dialog-footer-actions">
                                                    <button className={`btn-fav-toggle ${favorites.includes(peer.id) ? 'active' : ''}`} onClick={() => toggleFavorite(peer.id)}>
                                                        {favorites.includes(peer.id) ? <FaHeart /> : <FaRegHeart />} STAR_FAV
                                                    </button>
                                                    <button className="btn-close-dialog" onClick={() => setActivePeerMenu(null)}>ABORT</button>
                                                </div>
                                            </div>
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
                                    <button className="btn-download-quick" onClick={() => handleDownload(f)}>
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
                <div className="discovery-subtabs">
                    <button className={transmissionView === 'received' ? 'active' : ''} onClick={() => setTransmissionView('received')}>RECEIVED</button>
                    <button className={transmissionView === 'sent' ? 'active' : ''} onClick={() => setTransmissionView('sent')}>SENT</button>
                    <div className="tab-separator"></div>
                    <button className="btn-refresh-scan" onClick={fetchAll} title="Manual History Refresh">
                        <FaSyncAlt /> SYNC_LEDGER
                    </button>
                </div>
                
                <div className="hosted-files-grid">
                    {transfers.filter(t => t.type === transmissionView).length === 0 ? (
                         <div className="empty-box">NO_{transmissionView.toUpperCase()}_DATA_FLOWING</div>
                    ) : transfers.filter(t => t.type === transmissionView).map(t => (
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
                                <div className="card-meta">
                                    <span>{t.type === 'sent' ? 'TO' : 'FROM'}: {t.peer} | {t.size}</span>
                                    <span className="timestamp-badge">{t.timestamp}</span>
                                </div>
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
