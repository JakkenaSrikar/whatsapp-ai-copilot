const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// --- Process Crash Prevention (Ignore Puppeteer EBUSY lock release failures) ---
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    if (reason && reason.message && reason.message.includes('EBUSY')) {
        console.log('[Notice] Caught EBUSY session lock release error. Safe to ignore during browser cleanup/restart.');
    }
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception thrown:', err);
    if (err && err.message && err.message.includes('EBUSY')) {
        console.log('[Notice] Caught EBUSY session lock release error. Safe to ignore during browser cleanup/restart.');
    }
});

// --- Configuration Setup ---
const CONFIG_FILE = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG = {
    apiProvider: 'gemini',
    apiKey: '',
    modelName: 'gemini-2.5-flash',
    systemPrompt: 'You are replying on behalf of the user in a casual, helpful, and friendly manner. Keep replies concise, conversational, and natural, exactly like a human texting on WhatsApp. Do NOT add any signatures, disclosures, or bot labels (like "[Automated Agent]" or "AI Bot"). Use natural capitalization, simple formatting, and emojis occasionally.',
    replyDelayMin: 3,
    replyDelayMax: 15,
    manualPauseDuration: 15,
    interactionMode: 'all', // 'all' or 'whitelist'
    whitelist: [],
    dashboardPassword: '', // Password to access the dashboard (empty = no password)
    scheduleEnabled: false,
    scheduleStartHour: '22',
    scheduleEndHour: '08',
    customRules: [] // Array of { pattern, response, exact }
};

let config = { ...DEFAULT_CONFIG };

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            const loaded = JSON.parse(data);
            
            // Migration for older config format
            if (loaded.geminiApiKey && !loaded.apiKey) {
                loaded.apiKey = loaded.geminiApiKey;
            }
            if (loaded.geminiModel && !loaded.modelName) {
                loaded.modelName = loaded.geminiModel;
            }
            
            config = { ...DEFAULT_CONFIG, ...loaded };
            console.log('Configuration loaded from disk.');
        } else {
            saveConfig(DEFAULT_CONFIG);
            console.log('Default configuration created.');
        }
    } catch (err) {
        console.error('Error loading config:', err);
    }
}

function saveConfig(newConfig) {
    try {
        config = { ...config, ...newConfig };
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('Error saving config:', err);
        return false;
    }
}

// Load config immediately
loadConfig();

// --- Express & Socket.io Setup ---
const app = Math.floor(Math.random()) ? express() : express(); // normal express instance
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// In-memory application state
let client = null;
let botState = 'disconnected'; // 'disconnected', 'connecting', 'connected'
let botDetail = 'System initialized';
let repliesCount = 0;

// Analytics counters
const appStats = {
    totalReceived: 0,
    totalReplies: 0,
    totalErrors: 0,
    manualOverrides: 0,
    startTime: Date.now()
};

// Chats tracking dictionary
// Key: chat JID (e.g. '1234567890@c.us')
const chats = {};

// Keep track of message IDs sent by the bot to avoid triggering manual pause
const sentByBotMessageIds = new Set();
const sendingReplies = new Set();

// Dictionary for message queueing
const chatQueues = {};

// Helpers for Socket logs
function sendLog(source, message, type = 'system') {
    console.log(`[${source}] ${message}`);
    io.emit('log', { source, message, type });
}

function broadcastStatus() {
    io.emit('status-update', {
        state: botState,
        detail: botDetail,
        repliesCount
    });
    broadcastStats();
}

function broadcastStats() {
    io.emit('stats-update', {
        ...appStats,
        uptime: Math.floor((Date.now() - appStats.startTime) / 1000)
    });
}

function broadcastChats() {
    // Sanize chat history and limit size before broadcasting to prevent clogging websocket
    const sanitizedChats = {};
    for (const jid in chats) {
        sanitizedChats[jid] = {
            name: chats[jid].name,
            lastMsgBody: chats[jid].lastMsgBody,
            lastMsgTime: chats[jid].lastMsgTime,
            autoReplyEnabled: chats[jid].autoReplyEnabled,
            pausedUntil: chats[jid].pausedUntil
        };
    }
    io.emit('update-chats', sanitizedChats);
}

// --- Groq Audio Whisper Transcription ---
async function transcribeAudioWithGroq(apiKey, media) {
    try {
        const formData = new FormData();
        const buffer = Buffer.from(media.data, 'base64');
        
        let extension = 'ogg';
        if (media.mimetype.includes('mp3')) extension = 'mp3';
        else if (media.mimetype.includes('wav')) extension = 'wav';
        else if (media.mimetype.includes('m4a')) extension = 'm4a';
        else if (media.mimetype.includes('ogg')) extension = 'ogg';
        else if (media.mimetype.includes('aac')) extension = 'aac';

        const fileBlob = new Blob([buffer], { type: media.mimetype });
        formData.append('file', fileBlob, `voice.${extension}`);
        formData.append('model', 'whisper-large-v3-turbo');

        sendLog('Groq', 'Transcribing voice note using Whisper large-v3-turbo...', 'system');
        const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Whisper API returned ${response.status}: ${errText}`);
        }

        const data = await response.json();
        return data.text || '';
    } catch (err) {
        sendLog('Groq', `Transcription failed: ${err.message}`, 'error');
        return '';
    }
}

// --- Groq API Helper ---
async function callGroqAPI(apiKey, model, history, systemPrompt) {
    // Format history from Gemini format to OpenAI/Groq format
    const messages = [
        { role: 'system', content: systemPrompt }
    ];

    history.forEach(turn => {
        const role = turn.role === 'model' ? 'assistant' : 'user';
        const text = turn.parts[0].text || '';
        messages.push({ role, content: text });
    });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: model || 'llama-3.1-8b-instant',
            messages: messages,
            temperature: 0.7,
            max_tokens: 250
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Groq API returned ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content || '';
}

// --- AI Reply Logic ---
async function generateAIReply(jid, messageBody, mediaList = []) {
    if (!config.apiKey) {
        sendLog('AI', 'API Key missing. Cannot generate response.', 'error');
        return 'Sorry, my auto-reply system is currently missing its API key configuration.';
    }

    try {
        // Initialize chat history if not present
        if (!chats[jid]) {
            chats[jid] = {
                name: '',
                lastMsgBody: '',
                lastMsgTime: Date.now(),
                autoReplyEnabled: true,
                pausedUntil: null,
                history: []
            };
        }

        const provider = config.apiProvider || 'gemini';
        const activeModel = config.modelName || (provider === 'groq' ? 'llama-3.1-8b-instant' : 'gemini-2.5-flash');

        const parts = [];

        // 1. Process audio/voice notes for Groq (requires Whisper transcription)
        let groqAudioTranscripts = [];
        if (provider === 'groq' && mediaList.length > 0) {
            for (const media of mediaList) {
                if (media && media.mimetype.startsWith('audio/')) {
                    const transcript = await transcribeAudioWithGroq(config.apiKey, media);
                    if (transcript) {
                        groqAudioTranscripts.push(`[Voice Note Transcribed]: "${transcript}"`);
                    }
                }
            }
        }

        // 2. Build parts for Gemini (native multimodal support) or text for Groq
        if (provider === 'gemini') {
            if (messageBody) {
                parts.push({ text: messageBody });
            }
            mediaList.forEach(m => {
                if (m) {
                    parts.push({
                        inlineData: {
                            data: m.data,
                            mimeType: m.mimetype
                        }
                    });
                }
            });
            if (parts.length === 0) {
                parts.push({ text: "[Sent media attachment]" });
            }
        } else {
            // Groq text injection
            let consolidatedText = messageBody || '';
            if (groqAudioTranscripts.length > 0) {
                consolidatedText += (consolidatedText ? '\n' : '') + groqAudioTranscripts.join('\n');
            }
            
            const imageMedia = mediaList.filter(m => m && m.mimetype.startsWith('image/'));
            if (imageMedia.length > 0) {
                consolidatedText += `\n[User also sent ${imageMedia.length} image(s) that could not be processed directly by this model]`;
                sendLog('Groq', `Model ${activeModel} does not support direct image analysis. Ignoring image data, replying to caption/voice note transcription.`, 'system');
            }
            
            parts.push({ text: consolidatedText || "[Sent media attachment]" });
        }

        // Add current user message to history in Gemini format
        chats[jid].history.push({
            role: 'user',
            parts: parts
        });

        // Cap history to last 10 messages (5 turns)
        if (chats[jid].history.length > 10) {
            chats[jid].history = chats[jid].history.slice(-10);
        }

        let replyText = '';

        if (provider === 'groq') {
            sendLog('Groq', `Generating reply using Groq (${activeModel}) for ${jid}...`, 'system');
            replyText = await callGroqAPI(config.apiKey, activeModel, chats[jid].history, config.systemPrompt);
        } else {
            sendLog('Gemini', `Generating reply using Gemini (${activeModel}) for ${jid}...`, 'system');
            const ai = new GoogleGenAI({ apiKey: config.apiKey });
            const response = await ai.models.generateContent({
                model: activeModel,
                contents: chats[jid].history,
                config: {
                    systemInstruction: config.systemPrompt,
                    temperature: 0.7,
                    maxOutputTokens: 250
                }
            });
            replyText = response.text || '';
        }

        // Append model response to history
        chats[jid].history.push({
            role: 'model',
            parts: [{ text: replyText }]
        });

        return replyText;
    } catch (error) {
        appStats.totalErrors++;
        sendLog(config.apiProvider === 'groq' ? 'Groq' : 'Gemini', `Error calling AI API: ${error.message}`, 'error');
        return null;
    }
}

// --- Scheduler Helper ---
function isOutsideSchedule() {
    if (!config.scheduleEnabled) return false;
    const now = new Date();
    const currentHour = now.getHours(); // 0-23
    const start = parseInt(config.scheduleStartHour, 10);
    const end = parseInt(config.scheduleEndHour, 10);

    if (start === end) return false;
    if (start < end) {
        // e.g. 09:00 to 17:00
        return currentHour < start || currentHour >= end;
    } else {
        // e.g. 22:00 to 08:00 (overnight)
        return currentHour < start && currentHour >= end;
    }
}

// --- Custom Trigger Rules Helper ---
function findCustomRuleMatch(text) {
    if (!config.customRules || config.customRules.length === 0) return null;
    const cleanText = (text || '').trim().toLowerCase();
    for (const rule of config.customRules) {
        const pattern = rule.pattern.trim().toLowerCase();
        if (rule.exact) {
            if (cleanText === pattern) return rule.response;
        } else {
            if (cleanText.includes(pattern)) return rule.response;
        }
    }
    return null;
}

// --- Message Accumulation Core Callback ---
async function processAccumulatedMessages(chatId) {
    if (!chatQueues[chatId] || chatQueues[chatId].messages.length === 0) return;

    // Grab all accumulated messages for this chat
    const queuedItems = [...chatQueues[chatId].messages];
    chatQueues[chatId].messages = []; // Clear the queue

    // The reference message to reply to (we'll reply to the last one received)
    const lastMsgObj = queuedItems[queuedItems.length - 1].msgObj;

    // Fetch contact details (if not already fetched)
    let contactName = chatId.split('@')[0];
    try {
        const contact = await lastMsgObj.getContact();
        contactName = contact.pushname || contact.name || contactName;
    } catch (err) {
        // ignore
    }

    // Initialize/Update chat state
    if (!chats[chatId]) {
        chats[chatId] = {
            name: contactName,
            lastMsgBody: lastMsgObj.body,
            lastMsgTime: Date.now(),
            autoReplyEnabled: true,
            pausedUntil: null,
            history: []
        };
    } else {
        chats[chatId].name = contactName;
        chats[chatId].lastMsgBody = lastMsgObj.body;
        chats[chatId].lastMsgTime = Date.now();
    }

    broadcastChats();

    // 1. Is auto-reply enabled locally for this chat?
    if (!chats[chatId].autoReplyEnabled) {
        sendLog('WhatsApp', `Auto-reply is disabled locally for ${contactName}. Ignoring.`, 'system');
        return;
    }

    // 2. Whitelist check
    if (config.interactionMode === 'whitelist') {
        const cleanNumber = chatId.split('@')[0];
        const isWhitelisted = config.whitelist.some(num => cleanNumber.includes(num));
        if (!isWhitelisted) {
            sendLog('WhatsApp', `Contact ${contactName} (${cleanNumber}) is not in whitelist. Ignoring.`, 'system');
            return;
        }
    }

    // 3. Check manual override pause status
    if (chats[chatId].pausedUntil && chats[chatId].pausedUntil > Date.now()) {
        const minLeft = Math.ceil((chats[chatId].pausedUntil - Date.now()) / (60 * 1000));
        sendLog('WhatsApp', `Bot is paused for ${contactName} for another ${minLeft}m due to a manual reply. Ignoring.`, 'system');
        return;
    }

    // 4. Check Scheduler hour filter
    if (isOutsideSchedule()) {
        sendLog('WhatsApp', `Message from ${contactName} ignored because it is outside scheduled active hours (${config.scheduleStartHour}:00 - ${config.scheduleEndHour}:00).`, 'system');
        return;
    }

    // Consolidate text content and media list from the accumulated batch
    let consolidatedText = '';
    const mediaList = [];

    queuedItems.forEach(item => {
        if (item.body) {
            consolidatedText += (consolidatedText ? '\n' : '') + item.body;
        }
        if (item.media) {
            mediaList.push(item.media);
        }
    });

    sendLog('WhatsApp', `Processing ${queuedItems.length} accumulated messages from ${contactName}...`, 'system');

    // 5. Check Custom Keyword Rules
    let replyText = findCustomRuleMatch(consolidatedText);
    let isRuleReply = false;

    if (replyText) {
        sendLog('WhatsApp', `Custom Keyword Rule triggered for ${contactName}. Bypassing AI model.`, 'system');
        isRuleReply = true;
    } else {
        // Generate AI Reply
        replyText = await generateAIReply(chatId, consolidatedText, mediaList);
    }

    if (!replyText) {
        sendLog('WhatsApp', 'Failed to generate AI response. Skipping.', 'error');
        return;
    }

    // 6. Calculate random delay (humanization)
    const minDelay = isRuleReply ? 1 : config.replyDelayMin;
    const maxDelay = isRuleReply ? 4 : config.replyDelayMax;
    const delaySec = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

    sendLog('WhatsApp', `Waiting ${delaySec}s before replying to ${contactName} (simulating typing)...`, 'system');
    
    // Simulate typing
    try {
        const chatObj = await lastMsgObj.getChat();
        await chatObj.sendStateTyping();
    } catch (e) {
        // ignore
    }

    // Send reply after delay
    setTimeout(async () => {
        try {
            // Double check pause status again to avoid race conditions
            if (chats[chatId].pausedUntil && chats[chatId].pausedUntil > Date.now()) {
                sendLog('WhatsApp', `Aborting queued reply to ${contactName} - a manual message was sent in the meantime.`, 'system');
                return;
            }

            // Add to sending replies to prevent triggering manual pause
            sendingReplies.add(chatId);

            // Send reply
            const sentMsg = await lastMsgObj.reply(replyText);
            
            // Track this message ID so our own message_create event doesn't trigger a manual pause
            sentByBotMessageIds.add(sentMsg.id.id);
            // Clean up Set after 5 mins to prevent memory leakage
            setTimeout(() => sentByBotMessageIds.delete(sentMsg.id.id), 5 * 60 * 1000);

            repliesCount++;
            appStats.totalReplies++;
            chats[chatId].lastMsgBody = replyText;
            chats[chatId].lastMsgTime = Date.now();
            
            sendLog('WhatsApp', `Auto-replied to ${contactName}: "${replyText}"`, 'outgoing');
            broadcastStatus();
            broadcastChats();
        } catch (err) {
            appStats.totalErrors++;
            sendLog('WhatsApp', `Failed to send reply to ${contactName}: ${err.message}`, 'error');
        } finally {
            sendingReplies.delete(chatId);
        }
    }, delaySec * 1000);
}

// --- Zombie Chromium Cleaner ---
function cleanZombieChromium(callback) {
    if (process.platform !== 'win32') {
        if (callback) callback();
        return;
    }

    console.log('[System] Scanning for zombie Chromium processes...');
    const psCmd = 'powershell -Command "Get-CimInstance Win32_Process -Filter \\"Name = \'chrome.exe\'\\" | Where-Object { $_.CommandLine -like \'*puppeteer*\' -or $_.CommandLine -like \'*whatsapp-web.js*\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"';
    
    exec(psCmd, (err, stdout, stderr) => {
        if (err) {
            console.log('[System] Zombie cleanup notice: No running zombie Chromium instances found or command skipped.');
        } else {
            console.log('[System] Zombie Chromium cleanup completed successfully.');
        }
        if (callback) callback();
    });
}

// --- WhatsApp Client Logic ---
function initializeWhatsAppClient() {
    if (client) {
        try {
            client.destroy();
            sendLog('WhatsApp', 'Destroyed existing client session.', 'system');
        } catch (err) {
            sendLog('WhatsApp', `Error destroying client: ${err.message}`, 'error');
        }
    }

    botState = 'connecting';
    botDetail = 'Booting headless browser...';
    broadcastStatus();

    sendLog('WhatsApp', 'Initializing whatsapp-web.js client with LocalAuth...', 'system');

    client = new Client({
        authStrategy: new LocalAuth({
            clientId: 'whatsapp-ai-session'
        }),
        puppeteer: {
            headless: true,
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-extensions',
                '--no-default-browser-check',
                '--disable-gpu',
                '--disable-dev-shm-usage'
            ],
            timeout: 60000
        }
    });

    // Client Events
    client.on('qr', (qr) => {
        botState = 'connecting';
        botDetail = 'Scan QR code in dashboard';
        broadcastStatus();
        
        io.emit('qr', qr);
        sendLog('WhatsApp', 'Scan the QR code printed below to connect.', 'system');
        qrcodeTerminal.generate(qr, { small: true });
    });

    client.on('ready', async () => {
        botState = 'connected';
        botDetail = 'Active and Listening';
        broadcastStatus();
        sendLog('WhatsApp', 'Client connected successfully! Bot is ready.', 'system');
        
        // Pre-populate chats list after page settling delay (15 seconds)
        setTimeout(async () => {
            try {
                sendLog('WhatsApp', 'Pre-populating active chats list...', 'system');
                const activeChats = await client.getChats();
                sendLog('WhatsApp', `Loaded ${activeChats.length} active chats from WhatsApp.`, 'system');
                
                activeChats.forEach(c => {
                    if (c.id._serialized.endsWith('@g.us') || c.id._serialized.endsWith('@broadcast') || c.id._serialized.endsWith('@newsletter') || c.isGroup) return;

                    if (!chats[c.id._serialized]) {
                        chats[c.id._serialized] = {
                            name: c.name || c.id.user,
                            lastMsgBody: c.lastMessage ? c.lastMessage.body : '',
                            lastMsgTime: c.lastMessage ? c.lastMessage.timestamp * 1000 : Date.now(),
                            autoReplyEnabled: true,
                            pausedUntil: null,
                            history: []
                        };
                    } else {
                        chats[c.id._serialized].name = c.name || chats[c.id._serialized].name;
                    }
                });
                broadcastChats();
            } catch (err) {
                sendLog('WhatsApp', `Notice: Active chats table pre-population skipped (${err.message}). The bot is still active and listening for new messages.`, 'system');
            }
        }, 15000);
    });

    client.on('authenticated', () => {
        sendLog('WhatsApp', 'Authentication successful. Saving session...', 'system');
    });

    client.on('auth_failure', (msg) => {
        botState = 'disconnected';
        botDetail = `Auth Failure: ${msg}`;
        broadcastStatus();
        sendLog('WhatsApp', `Authentication failure: ${msg}`, 'error');
    });

    client.on('disconnected', (reason) => {
        botState = 'disconnected';
        botDetail = `Disconnected: ${reason}`;
        broadcastStatus();
        sendLog('WhatsApp', `Client was disconnected: ${reason}`, 'error');
    });

    // Listen for incoming messages
    client.on('message', async (msg) => {
        const chatId = msg.from;

        // Debug Log
        sendLog('WhatsApp', `Raw message event detected: from=${chatId}, body="${msg.body}", isStatus=${msg.isStatus || false}`, 'system');

        // 1. Ignore group chats, broadcasts, and newsletters
        if (chatId.endsWith('@g.us') || chatId.endsWith('@broadcast') || chatId.endsWith('@newsletter') || msg.isStatus) {
            return;
        }

        appStats.totalReceived++;

        // Handle downloading media if present (images/audio)
        let mediaData = null;
        if (msg.hasMedia) {
            try {
                mediaData = await msg.downloadMedia();
            } catch (err) {
                sendLog('WhatsApp', `Failed to download attachment: ${err.message}`, 'error');
            }
        }

        // Put message into JID accumulation queue
        if (!chatQueues[chatId]) {
            chatQueues[chatId] = {
                messages: [],
                timer: null
            };
        }

        // Add to active batch
        chatQueues[chatId].messages.push({
            body: msg.body,
            media: mediaData,
            msgObj: msg
        });

        // Reset accumulation timer
        if (chatQueues[chatId].timer) {
            clearTimeout(chatQueues[chatId].timer);
        }

        sendLog('WhatsApp', `Accumulating messages from ${chatId.split('@')[0]}...`, 'system');
        chatQueues[chatId].timer = setTimeout(() => {
            processAccumulatedMessages(chatId);
        }, 3500); // 3.5 seconds accumulation window
    });

    // Listen to sent messages (for manual override detection)
    client.on('message_create', (msg) => {
        if (!msg.fromMe) return;

        const chatId = msg.to;
        if (chatId.endsWith('@g.us') || chatId.endsWith('@broadcast') || chatId.endsWith('@newsletter') || msg.isStatus) return;

        // If this message was sent by our bot, ignore it (it shouldn't pause itself)
        if (sentByBotMessageIds.has(msg.id.id) || sendingReplies.has(chatId)) {
            return;
        }

        // Otherwise, it was typed manually by the owner from their phone!
        const pauseTimeMs = config.manualPauseDuration * 60 * 1000;
        if (pauseTimeMs <= 0) return;

        appStats.manualOverrides++;

        if (!chats[chatId]) {
            chats[chatId] = {
                name: chatId.split('@')[0],
                lastMsgBody: msg.body,
                lastMsgTime: Date.now(),
                autoReplyEnabled: true,
                pausedUntil: Date.now() + pauseTimeMs,
                history: []
            };
        } else {
            chats[chatId].pausedUntil = Date.now() + pauseTimeMs;
            chats[chatId].lastMsgBody = msg.body;
            chats[chatId].lastMsgTime = Date.now();
        }

        sendLog('WhatsApp', `Manual reply detected in chat ${chats[chatId].name || chatId.split('@')[0]}. Pausing auto-reply for ${config.manualPauseDuration} mins.`, 'system');
        broadcastChats();
        broadcastStatus();
    });

    client.initialize().catch(err => {
        botState = 'disconnected';
        botDetail = `Init Failed: ${err.message}`;
        broadcastStatus();
        sendLog('WhatsApp', `Initialization error: ${err.message}`, 'error');
    });
}

// --- Socket.io Handlers ---
io.on('connection', (socket) => {
    console.log('Dashboard web client connected.');
    
    let isAuthenticated = !config.dashboardPassword;

    if (!isAuthenticated) {
        socket.emit('require-auth');
    } else {
        sendInitialState(socket);
    }

    socket.on('auth', (data) => {
        const { password } = data;
        if (!config.dashboardPassword || password === config.dashboardPassword) {
            isAuthenticated = true;
            socket.emit('auth-status', { success: true });
            sendInitialState(socket);
        } else {
            socket.emit('auth-status', { success: false, error: 'Incorrect password' });
        }
    });

    function sendInitialState(targetSocket) {
        targetSocket.emit('load-config', config);
        targetSocket.emit('status-update', {
            state: botState,
            detail: botDetail,
            repliesCount
        });
        targetSocket.emit('update-chats', chats);
        broadcastStats();
    }

    // 2. Save config
    socket.on('save-config', (newConfig) => {
        if (!isAuthenticated) return socket.emit('config-saved-status', { success: false, error: 'Unauthenticated' });
        
        const success = saveConfig(newConfig);
        socket.emit('config-saved-status', { success });
        if (success) {
            sendLog('System', 'Updated configurations and synced with config.json', 'system');
            if (newConfig.dashboardPassword !== undefined) {
                sendLog('System', 'Dashboard settings configuration updated.', 'system');
            }
        }
    });

    // 3. Toggle chat auto reply
    socket.on('toggle-chat-auto-reply', (data) => {
        if (!isAuthenticated) return;
        const { chatId, enabled } = data;
        if (chats[chatId]) {
            chats[chatId].autoReplyEnabled = enabled;
            if (enabled) {
                chats[chatId].pausedUntil = null;
            }
            broadcastChats();
        }
    });

    // 4. Force restart client
    socket.on('restart-client', () => {
        if (!isAuthenticated) return;
        sendLog('System', 'Restarting WhatsApp Client by dashboard request...', 'system');
        cleanZombieChromium(() => {
            initializeWhatsAppClient();
        });
    });
});

// --- Server Startup ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(`WhatsApp AI Agent Dashboard running at:`);
    console.log(`http://localhost:${PORT}`);
    console.log(`===================================================`);
    
    // Auto-initialize WhatsApp client
    cleanZombieChromium(() => {
        initializeWhatsAppClient();
    });
});
