# AutoChat-AI: Multimodal WhatsApp Auto-Reply System with LLM Orchestration

An autonomous, self-hosted AI messaging agent and copilot for WhatsApp. Built with **Node.js**, **Express**, **Socket.io**, and **Puppeteer**, AutoChat-AI intercepts incoming messages, transcribes voice notes, inspects images, buffers rapid messages, and replies in a realistic, humanized manner using **Google Gemini** or **Groq LLMs** (Llama 3.1 / Gemma).

Includes a modern, glassmorphic real-time web dashboard for configuration management, QR login, keyword automation, analytics, and contact management.

---

## 🌟 Core Highlights

* **🧠 Multi-LLM Orchestration**:
  * **Groq Cloud API**: High-speed, high-rate-limit inference with `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`, or `gemma2-9b-it`.
  * **Google Gemini API**: Native multimodal processing with `gemini-2.5-flash` and `gemini-2.5-pro`.
* **🎙️ Multimodal Intelligence**:
  * **Voice Note Audio Transcription**: Voice messages are automatically downloaded and transcribed via **Groq Whisper Large v3** or processed natively with Gemini.
  * **Image Comprehension**: Understands and replies contextually to incoming pictures.
* **⚡ Message Accumulation Queueing**:
  * Consolidates multiple rapid messages sent within a configurable time window into a single unified context to prevent duplicate replies.
* **👤 Human-Like Conversational Behavior**:
  * **Simulated Typing Delay**: Waits a randomized duration (3–15s) while broadcasting native WhatsApp typing state.
  * **Manual Message Override**: Automatically pauses auto-replies for $N$ minutes when you manually message a contact from your phone.
* **🎯 Granular Filtering & Automation**:
  * **Active Hours Scheduler**: Restrict automated replies to specific hours (e.g., overnight 22:00 to 08:00).
  * **Custom Keyword Triggers**: Define instant static template responses for specific keywords without consuming LLM tokens.
  * **Modes**: Switch between *Reply to All* or *Whitelist Only*.
  * **Chat Exclusions**: Automatically ignores group chats, broadcast channels, and newsletters.
* **📊 Glassmorphic Live Dashboard**:
  * Interactive QR code scanner for authentication.
  * Real-time WebSocket console logs, live uptime, message telemetry, and per-contact auto-reply toggles.
  * Password-protected security gate.

---

## 📁 Repository Structure

```
├── .wwebjs_auth/        # Session tokens & cookies (local only, gitignored)
├── config.example.json  # Configuration template
├── public/              # Real-time Web Dashboard
│   ├── index.html       # Dashboard layout
│   ├── style.css        # Glassmorphic dark theme stylesheet
│   └── app.js           # Client-side WebSocket controller & UI state
├── server.js            # Express server, Socket.io backend, & WhatsApp client
├── Dockerfile           # Production container build with Chromium & Puppeteer
├── docker-compose.yml   # Container orchestration with volume persistence
├── DEPLOYMENT.md        # Cloud deployment guide (VPS, PM2, Docker, Render)
└── README.md            # Project documentation
```

---

## 🚀 Quick Start (Local Setup)

### 1. Prerequisites
* [Node.js](https://nodejs.org/) (v18 or higher recommended)
* Google Chrome / Chromium installed

### 2. Installation
```bash
git clone https://github.com/JakkenaSrikar/whatsapp-ai-copilot.git
cd whatsapp-ai-copilot
npm install
```

### 3. Configuration
Copy the example config and add your API key:
```bash
cp config.example.json config.json
```
*(Or configure your keys directly from the web dashboard once launched).*

### 4. Run Server
```bash
npm start
```

### 5. Connect WhatsApp
1. Open **`http://localhost:3000`** in your browser.
2. Open WhatsApp on your phone -> **Settings / Linked Devices** -> **Link a Device**.
3. Scan the QR code displayed on the dashboard.
4. The dashboard will transition to **`Bot Connected & Ready`**.

---

## 🐳 Docker Deployment

Run with Docker Compose:
```bash
docker compose up -d --build
```
The WhatsApp session and configuration will persist automatically in the mounted `./data` volume.

---

## 🔒 Security & Privacy Notice
* **Local Session Privacy**: Session data is stored strictly in your local `.wwebjs_auth/` directory and is never sent to external servers.
* **API Credentials**: Store your API keys in `config.json` (which is gitignored). Never commit secret keys to public repositories.

---

## 📄 License
This project is licensed under the MIT License.
