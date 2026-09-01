# 🚀 WhatsApp AI Agent Deployment Guide

This guide covers how to deploy the WhatsApp AI Agent so that it runs 24/7 in the cloud without needing your personal computer to stay turned on.

---

## 📌 Important Deployment Architecture Notes
Because this agent uses **`whatsapp-web.js`** (which runs a headless Chromium browser under the hood):
1. **Chromium Required**: The hosting environment must support running Chromium/Puppeteer.
2. **Persistent Storage Required**: The session directory (`.wwebjs_auth/`) must be stored on persistent disk so you only need to scan the QR code once.
3. **RAM**: At least **1 GB of RAM** is recommended.

---

## Option 1: VPS / Virtual Server (Most Recommended & Reliable)
* **Platforms**: DigitalOcean Droplet ($4-$6/mo), Hetzner ($4/mo), Linode / Akamai, AWS EC2 (t3.small), or Google Cloud Compute Engine.
* **Why**: Full persistent disk, no random sleep timeouts, easy to maintain with `pm2` or Docker.

### Steps on Ubuntu / Debian VPS:
1. **Connect to your server via SSH**:
   ```bash
   ssh root@YOUR_SERVER_IP
   ```

2. **Install Node.js 18+ and Chromium**:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get update
   sudo apt-get install -y nodejs chromium-browser git
   ```

3. **Install PM2 (Process Manager to run 24/7 in background)**:
   ```bash
   npm install -g pm2
   ```

4. **Clone or Copy your project onto the VPS**:
   ```bash
   git clone YOUR_GIT_REPOSITORY_URL whatsapp-agent
   cd whatsapp-agent
   npm install
   ```

5. **Start with PM2**:
   ```bash
   pm2 start server.js --name "whatsapp-agent"
   pm2 save
   pm2 startup
   ```

6. **Access Dashboard**:
   * Open `http://YOUR_SERVER_IP:3000` in your web browser.
   * Scan the QR code with WhatsApp, and your bot is live 24/7!

---

## Option 2: Docker / Docker Compose Deployment
If your VPS has Docker and Docker Compose installed:

1. **Upload your code to the server**:
   ```bash
   cd whatsapp-agent
   ```

2. **Build and start the container**:
   ```bash
   docker compose up -d --build
   ```

3. **View Logs / QR Code in terminal**:
   ```bash
   docker compose logs -f
   ```

4. **Open in browser**:
   Navigate to `http://YOUR_SERVER_IP:3000`.

---

## Option 3: Render.com / Railway (Managed Containers)

If using Render or Railway:
1. **Push your code to a GitHub repository**.
2. **On Render / Railway**:
   * Create a **New Web Service** connected to your GitHub repository.
   * Choose **Environment**: `Docker` (Render will use the included `Dockerfile`).
   * **Crucial Setting**: Add a **Persistent Disk / Volume** mounted at:
     * Mount Path: `/app/.wwebjs_auth`
     * Size: 1 GB
3. **Deploy**: Render will build the Docker container with Chromium pre-installed.
4. **Open your Render URL**: Scan the QR code in the web dashboard.

---

## 🛠️ Management Commands (VPS with PM2)
* Check status: `pm2 status`
* View live logs: `pm2 logs whatsapp-agent`
* Restart bot: `pm2 restart whatsapp-agent`
* Stop bot: `pm2 stop whatsapp-agent`
