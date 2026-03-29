import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import ip from 'ip';
import { Bonjour } from 'bonjour-service';
import morgan from 'morgan';
import cors from 'cors';
import mime from 'mime-types';
import axios from 'axios';
import dgram from 'dgram'; // Added for UDP Broadcast

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const bonjour = new Bonjour();
const PORT = process.env.PORT || 3000;
const DISCOVERY_PORT = 4000; // Specific port for UDP broadcasts
const SERVICE_TYPE = 'p2pfile-transfer';
const MY_IP = ip.address();
const MY_ID = uuidv4().split('-')[0];

console.log(`Starting Node on ${MY_IP}:${PORT} (ID: ${MY_ID})`);

// --- KINETIC_HEARTBEAT (UDP DISCOVERY) ---

const udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

// Broadcast heartbeat every 3 seconds
setInterval(() => {
    const message = JSON.stringify({ id: MY_ID, ip: MY_IP, port: PORT });
    udpSocket.send(message, DISCOVERY_PORT, '255.255.255.255', (err) => {
        if (err) console.error('Heartbeat blast failed:', err.message);
    });
}, 3000);

udpSocket.on('listening', () => {
    udpSocket.setBroadcast(true);
    console.log(`Kinetic Heartbeat scanning on port ${DISCOVERY_PORT}`);
});

let peers = new Map(); // PeerID -> { id, ip, port, lastSeen }

udpSocket.on('message', async (msg, rinfo) => {
    try {
        const data = JSON.parse(msg.toString());
        if (data.id === MY_ID) return; // Skip self
        
        // Use merging to preserve metadata
        const existing = peers.get(data.id) || {};
        const ipToUse = rinfo.address || data.ip; // Prioritize real IP seen by socket

        peers.set(data.id, {
            ...existing,
            ...data,
            ip: ipToUse,
            lastSeen: Date.now()
        });

        // Trigger an immediate proactive scan for their files if we haven't seen them yet
        if (!existing.files || existing.files.length === 0) {
            probePeerFiles(data.id, ipToUse, data.port);
        }
    } catch (e) { /* Ignore malformed heartbeats */ }
});

udpSocket.bind(DISCOVERY_PORT);

// --- PROACTIVE SCANNER ENGINE ---

async function probePeerFiles(peerId, peerIp, peerPort) {
    try {
        const formattedIp = peerIp.includes(':') ? `[${peerIp}]` : peerIp;
        const res = await axios.get(`http://${formattedIp}:${peerPort}/hosted`, { timeout: 3000 });
        const existing = peers.get(peerId);
        if (existing) {
            peers.set(peerId, {
                ...existing,
                files: res.data.map(f => ({ ...f, ownerId: peerId, ownerIp: peerIp, ownerPort: peerPort }))
            });
            console.log(`Successfully indexed ${res.data.length} files from ${peerId}`);
        }
    } catch (e) { /* silent fail for unreachable nodes */ }
}

// Global Re-Scan every 20 seconds to keep files updated
setInterval(() => {
    for (const [id, peer] of peers.entries()) {
        probePeerFiles(id, peer.ip, peer.port);
    }
}, 20000);

// Auto-expire peers after 10 seconds of silence
setInterval(() => {
    const now = Date.now();
    for (const [id, peer] of peers.entries()) {
        if (now - peer.lastSeen > 12000) {
            peers.delete(id);
            console.log(`Node Expired: ${id}`);
        }
    }
}, 5000);

// Storage for hosted files
const hostedFiles = new Map(); // ID -> { name, path, size, type }
// Storage for incoming transfer requests
const incomingRequests = new Map(); // ID -> { senderId, senderIp, senderFileName, fileId, status }
// Storage for "Favorite" (auto-accept) peers
const favorites = new Set(); // Peer IDs

// Persistent History for the current session
const HISTORY_FILE = path.join(__dirname, 'transfers_log.json');
let transfers = []; // Added back the missing declaration

function saveHistory() {
    try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(transfers, null, 2)); }
    catch (e) { console.error('History save error:', e); }
}

// End of persistence logic

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

// Serve production frontend build if it exists
const frontendBuildPath = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(frontendBuildPath)) {
    app.use(express.static(frontendBuildPath));
}

// Configure Multer for local temporary storage before hosting
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({ storage: storage });

// --- API ROUTES ---

// 1. Host a file (makes it public)
app.post('/host', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const fileId = uuidv4().split('-')[0];
    const fileInfo = {
        id: fileId,
        name: req.file.originalname,
        path: req.file.path,
        size: req.file.size,
        type: req.file.mimetype,
        hostIp: MY_IP,
        hostPort: PORT,
        hostId: MY_ID
    };

    hostedFiles.set(fileId, fileInfo);
    updateAnnouncement();
    res.json({ message: 'File hosted successfully', fileId: fileId, info: fileInfo });
});

// 2. Receive a transfer request (from a sender)
app.post('/receive-request', (req, res) => {
    const { senderId, senderIp, senderPort, fileId, fileName, size } = req.body;
    
    // Check if sender is in favorites for auto-accept
    if (favorites.has(senderId)) {
        const requestId = uuidv4().split('-')[0];
        incomingRequests.set(requestId, {
            id: requestId, senderId, senderIp, senderPort, 
            fileId, fileName, size, status: 'accepted', timestamp: Date.now()
        });
        
        // Log Transfer History (Auto-Accepted)
        transfers.push({
            id: uuidv4().split('-')[0],
            name: fileName,
            size: (size / 1024 / 1024).toFixed(2) + ' MB',
            progress: 0,
            status: 'transferring',
            peer: senderId,
            type: 'received', // This node is receiving it from the sender
            timestamp: new Date().toISOString().replace('T', ' ').split('.')[0]
        });

        console.log(`Auto-Accepted Transfer from Favorite Peer: ${senderId}`);
        return res.json({ message: 'Auto-Accepted', status: 'accepted', downloadUrl: `http://${senderIp}:${senderPort}/download/${fileId}` });
    }

    const requestId = uuidv4().split('-')[0];
    incomingRequests.set(requestId, {
        id: requestId, senderId, senderIp, senderPort, 
        fileId, fileName, size, status: 'pending', timestamp: Date.now()
    });

    console.log(`Direct Transfer Request Received from ${senderId} for ${fileName}`);
    res.json({ message: 'Request received', requestId });
});

// 2b. Favorites Management
app.get('/favorites', (req, res) => {
    res.json(Array.from(favorites));
});

app.post('/favorites/toggle', (req, res) => {
    const { peerId } = req.body;
    if (favorites.has(peerId)) {
        favorites.delete(peerId);
        res.json({ message: 'Removed from favorites', favorites: Array.from(favorites) });
    } else {
        favorites.add(peerId);
        res.json({ message: 'Added to favorites', favorites: Array.from(favorites) });
    }
});

// 3. Get incoming requests (Including pending and newly accepted for auto-download)
app.get('/requests', (req, res) => {
    res.json(Array.from(incomingRequests.values()).filter(r => r.status === 'pending' || r.status === 'accepted'));
});

// 4. Accept/Decline request
app.post('/requests/:id/action', (req, res) => {
    const { action } = req.body; // 'accept' or 'decline'
    const request = incomingRequests.get(req.params.id);
    if (!request) return res.status(404).send('Request not found');

    if (action === 'accept') {
        request.status = 'accepted';
        
        // Log Transfer History (Manual Accept)
        transfers.push({
            id: uuidv4().split('-')[0],
            name: request.fileName,
            size: (request.size / 1024 / 1024).toFixed(2) + ' MB',
            progress: 0,
            status: 'transferring',
            peer: request.senderId,
            type: 'received', // This node has approved a retrieval
            timestamp: new Date().toISOString().replace('T', ' ').split('.')[0]
        });

        // In this simple version, the client will just trigger a download from the sender
        res.json({ message: 'Accepted', downloadUrl: `http://${request.senderIp}:${request.senderPort}/download/${request.fileId}` });
    } else {
        request.status = 'declined';
        
        // Log transfer but ignore and mark as failed
        transfers.push({
            id: uuidv4().split('-')[0],
            name: request.fileName,
            size: (request.size / 1024 / 1024).toFixed(2) + ' MB',
            progress: 0,
            status: 'failed',
            peer: request.senderId,
            type: 'sent',
            timestamp: new Date().toISOString().replace('T', ' ').split('.')[0]
        });

        res.json({ message: 'Declined' });
    }
});

// 5. Get Transfer History
app.get('/transfers', (req, res) => {
    res.json(transfers);
});

// 5b. Manually Log a Transfer (for when THIS node downloads from another)
app.post('/transfers/log', (req, res) => {
    const { name, size, peer, status, type } = req.body;
    const newTransfer = {
        id: uuidv4().split('-')[0],
        name,
        size,
        peer,
        status: status || 'completed', 
        progress: status === 'completed' ? 100 : 0,
        type: type || 'received',
        timestamp: new Date().toISOString().replace('T', ' ').split('.')[0]
    };
    transfers.push(newTransfer);
    saveHistory();
    res.json(newTransfer);
});

// 5. List locally hosted files
app.get('/hosted', (req, res) => {
    res.json(Array.from(hostedFiles.values()));
});

// 3. Download a file
app.get('/download/:id', (req, res) => {
    const fileInfo = hostedFiles.get(req.params.id);
    if (!fileInfo) return res.status(404).json({ error: 'File not found' });

    const filePath = fileInfo.path;
    const stat = fs.statSync(filePath);
    const totalSize = stat.size;
    let bytesSent = 0;

    const transferId = uuidv4().split('-')[0];
    const transferRecord = {
        id: transferId,
        name: fileInfo.name,
        size: (totalSize / 1024 / 1024).toFixed(2) + ' MB',
        progress: 0,
        status: 'transferring',
        peer: req.ip || 'REMOTE_PEER',
        type: 'sent', // We are sending it to them
        timestamp: new Date().toISOString().replace('T', ' ').split('.')[0]
    };
    
    transfers.push(transferRecord);
    saveHistory();

    res.writeHead(200, {
        'Content-Type': fileInfo.type || 'application/octet-stream',
        'Content-Length': totalSize,
        'Content-Disposition': `attachment; filename="${fileInfo.name}"`
    });

    const readStream = fs.createReadStream(filePath);
    
    readStream.on('data', (chunk) => {
        bytesSent += chunk.length;
        const currentProgress = Math.floor((bytesSent / totalSize) * 100);
        
        // Update history in-memory for the /transfers endpoint
        const idx = transfers.findIndex(t => t.id === transferId);
        if (idx !== -1 && transfers[idx].progress !== currentProgress) {
            transfers[idx].progress = currentProgress;
        }
    });

    readStream.on('end', () => {
        const idx = transfers.findIndex(t => t.id === transferId);
        if (idx !== -1) {
            transfers[idx].progress = 100;
            transfers[idx].status = 'completed';
            saveHistory();
        }
    });

    readStream.on('error', () => {
        const idx = transfers.findIndex(t => t.id === transferId);
        if (idx !== -1) {
            transfers[idx].status = 'failed';
            saveHistory();
        }
    });

    readStream.pipe(res);
});

// 4. Get Network Status (Self-Info)
app.get('/status', (req, res) => {
    res.json({ id: MY_ID, ip: MY_IP, port: PORT });
});

// 5. Get Network Peers (Discovery)
// (peers Map is now defined at the top for UDP/mDNS unification)

app.get('/peers', (req, res) => {
    res.json(Array.from(peers.values()));
});

// 6. Manual Connect (for Termux/VPN where mDNS fails)
app.post('/peers/manual', async (req, res) => {
    const { ip: peerIp, port: peerPort } = req.body;
    try {
        console.log(`Manually probing node at ${peerIp}:${peerPort}...`);
        // Probe status
        const statusRes = await axios.get(`http://${peerIp}:${peerPort}/status`, { timeout: 3000 });
        const hostedRes = await axios.get(`http://${peerIp}:${peerPort}/hosted`, { timeout: 3000 });
        
        const existing = peers.get(statusRes.data.id) || {};
        const peerInfo = {
            ...existing,
            id: statusRes.data.id,
            name: `Manual-${statusRes.data.id}`,
            ip: peerIp,
            port: peerPort || 3000,
            files: hostedRes.data.map(f => ({ id: f.id, name: f.name, size: f.size })),
            lastSeen: Date.now()
        };
        
        peers.set(peerInfo.id, peerInfo);
        res.json({ message: 'Peer added manually', peer: peerInfo });
    } catch (err) {
        console.error(`Manual connect failed for ${peerIp}: ${err.message}`);
        res.status(500).json({ error: 'Could not connect to peer' });
    }
});

// --- DISCOVERY LOGIC ---

let serviceInstance = null;

function updateAnnouncement() {
    if (serviceInstance) serviceInstance.stop();

    const fileSummary = Array.from(hostedFiles.values()).map(f => ({
        id: f.id,
        name: f.name,
        size: f.size
    }));

    serviceInstance = bonjour.publish({
        name: `NetShare-${MY_ID}`,
        type: SERVICE_TYPE,
        port: PORT,
        txt: {
            id: MY_ID,
            files: JSON.stringify(fileSummary)
        }
    });

    console.log(`Updated network announcement with ${fileSummary.length} files.`);
}

// Initial announcement
updateAnnouncement();

// Browse for other nodes
const browser = bonjour.find({ type: SERVICE_TYPE });

browser.on('up', (service) => {
    // Basic service validation
    if (!service.txt || !service.txt.id) {
        console.log(`Discovered service missing metadata: ${service.name}`);
        return;
    }
    
    if (service.txt.id === MY_ID) return; // Skip self

    const peerAddr = service.addresses && service.addresses.length > 0 ? service.addresses[0] : 'unknown';
    console.log(`Successfully Discovered Peer: ${service.name} (${service.txt.id}) at ${peerAddr}:${service.port}`);
    
    let peerFiles = [];
    try {
        peerFiles = service.txt.files ? JSON.parse(service.txt.files) : [];
    } catch (e) {
        console.warn(`Failed to parse file list for peer ${service.txt.id}`);
    }
    
    const existing = peers.get(service.txt.id) || {};
    peers.set(service.txt.id, {
        ...existing,
        id: service.txt.id,
        name: service.name,
        ip: peerAddr,
        port: service.port,
        files: peerFiles,
        lastSeen: Date.now()
    });
    
    console.log(`Updated peer list. Total online peers: ${peers.size}`);
});

browser.on('down', (service) => {
    const peerId = service.txt ? service.txt.id : null;
    if (peerId && peerId !== MY_ID) {
        console.log(`Peer Went Offline: ${peerId}`);
        peers.delete(peerId);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`P2P NetShare Server listening on http://${MY_IP}:${PORT}`);
    console.log(`Open http://localhost:${PORT} in your browser.`);
});
