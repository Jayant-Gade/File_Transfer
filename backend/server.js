const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const ip = require('ip');
const Bonjour = require('bonjour-service').Bonjour;
const morgan = require('morgan');
const cors = require('cors');
const mime = require('mime-types');

const app = express();
const bonjour = new Bonjour();
const PORT = process.env.PORT || 3000;
const SERVICE_TYPE = 'p2pfile-transfer';
const MY_IP = ip.address();
const MY_ID = uuidv4().split('-')[0];

console.log(`Starting Node on ${MY_IP}:${PORT} (ID: ${MY_ID})`);

// Storage for hosted files
const hostedFiles = new Map(); // ID -> { name, path, size, type }
// Storage for incoming transfer requests
const incomingRequests = new Map(); // ID -> { senderId, senderIp, senderFileName, fileId, status }
// Storage for "Favorite" (auto-accept) peers
const favorites = new Set(); // Peer IDs

// Persistent History for the current session
const HISTORY_FILE = path.join(__dirname, 'transfers_log.json');
function saveHistory() {
    try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(transfers, null, 2)); }
    catch (e) { console.error('History save error:', e); }
}

// Simulation loop: update progress for active transfers every 2 seconds
setInterval(() => {
    let changed = false;
    transfers = transfers.map(t => {
        if (t.status === 'transferring') {
            const next = t.progress + Math.floor(Math.random() * 15) + 5;
            changed = true;
            if (next >= 100) return { ...t, progress: 100, status: 'completed' };
            return { ...t, progress: next };
        }
        return t;
    });
    if (changed) saveHistory();
}, 2000);

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
            peer: senderId
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

// 3. Get incoming requests
app.get('/requests', (req, res) => {
    res.json(Array.from(incomingRequests.values()).filter(r => r.status === 'pending'));
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
            peer: request.senderId
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
            peer: request.senderId
        });

        res.json({ message: 'Declined' });
    }
});

// 5. Get Transfer History
app.get('/transfers', (req, res) => {
    res.json(transfers);
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

    // Log the transfer start (Direct download)
    transfers.push({
        id: uuidv4().split('-')[0],
        name: fileInfo.name,
        size: (fileInfo.size / 1024 / 1024).toFixed(2) + ' MB',
        progress: 0,
        status: 'transferring',
        peer: req.ip || 'REMOTE_PEER' 
    });
    saveHistory();

    res.writeHead(200, {
        'Content-Type': fileInfo.type || 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${fileInfo.name}"`
    });

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
});

// 4. Get Network Status (Self-Info)
app.get('/status', (req, res) => {
    res.json({ id: MY_ID, ip: MY_IP, port: PORT });
});

// 5. Get Network Peers (Discovery)
let peers = new Map(); // PeerID -> { id, ip, port, files }

app.get('/peers', (req, res) => {
    res.json(Array.from(peers.values()));
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
    
    peers.set(service.txt.id, {
        id: service.txt.id,
        name: service.name,
        ip: peerAddr,
        port: service.port,
        files: peerFiles
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
