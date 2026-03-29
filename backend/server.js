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

// 1. Host a file
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
    
    // Publish update
    updateAnnouncement();
    
    res.json({ message: 'File hosted successfully', fileId: fileId, info: fileInfo });
});

// 2. List locally hosted files (for this instance)
app.get('/hosted', (req, res) => {
    res.json(Array.from(hostedFiles.values()));
});

// 3. Download a file
app.get('/download/:id', (req, res) => {
    const fileInfo = hostedFiles.get(req.params.id);
    if (!fileInfo) return res.status(404).send('File not found');

    const filePath = fileInfo.path;
    const stat = fs.statSync(filePath);

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
