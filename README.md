# P2P NetShare

A premium, localized file sharing server built with Node.js. It allows any device on the same local network to host files and discover others automatically using mDNS/Bonjour.

## Features
- **Auto-Discovery**: Instantly see other nodes on your local network.
- **Dual Mode**: Every node acts as both a sender and a receiver.
- **ID-Based Sharing**: Files are referenced by unique IDs.
- **Modern UI**: Dark mode, glassmorphism, and responsive design.
- **No Configuration**: Just run and share.

## Quick Start

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Start the Server**:
   ```bash
   node server.js
   ```

3. **Access the UI**:
   Open `http://localhost:3000` (or `http://YOUR_LOCAL_IP:3000`) in your browser.

## How to Test on One Machine
To simulate multiple peers on a single machine, you can run the server on different ports:
```bash
$env:PORT=3001; node server.js
$env:PORT=3002; node server.js
```
Each instance will discover the others and you can transfer files between them!

## Tech Stack
- **Backend**: Node.js, Express, Multer, Bonjour-Service
- **Frontend**: Vanilla JS, HSL CSS, FontAwesome
- **Discovery**: mDNS (ZeroConf)
