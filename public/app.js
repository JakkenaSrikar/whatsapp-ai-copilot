// Frontend controller for the WhatsApp AI Agent Dashboard

document.addEventListener('DOMContentLoaded', () => {
    // Socket.io initialization
    const socket = io();

    // DOM Elements - Connection Status
    const connectionDot = document.getElementById('connection-dot');
    const connectionText = document.getElementById('connection-text');
    const btnRestart = document.getElementById('btn-restart');
    
    // Status views
    const qrContainer = document.getElementById('qr-container');
    const qrCodeDiv = document.getElementById('qr-code');
    const connectedView = document.getElementById('connected-view');
    const connectingView = document.getElementById('connecting-view');
    const connectingStatusText = document.getElementById('connecting-status-text');

    // Stats (Status Card)
    const statReplies = document.getElementById('stat-replies');
    const statChatsCount = document.getElementById('stat-chats-count');

    // Stats (Analytics Card)
    const statReceived = document.getElementById('stat-received');
    const statRepliesSent = document.getElementById('stat-replies-sent');
    const statOverrides = document.getElementById('stat-overrides');
    const statErrors = document.getElementById('stat-errors');
    const uptimeDisplay = document.getElementById('uptime-display');

    // Security Elements
    const loginOverlay = document.getElementById('login-overlay');
    const loginForm = document.getElementById('login-form');
    const loginPasswordInput = document.getElementById('dashboard-login-password');
    const loginErrorMsg = document.getElementById('login-error-msg');
    const dashboardPasswordInput = document.getElementById('dashboard-password');

    // Configuration elements
    const configForm = document.getElementById('config-form');
    const apiProviderSelect = document.getElementById('api-provider');
    const apiKeyLabel = document.getElementById('api-key-label');
    const apiKeyInput = document.getElementById('api-key');
    const apiKeyHelp = document.getElementById('api-key-help');
    const modelNameSelect = document.getElementById('model-name');
    const btnToggleKey = document.getElementById('btn-toggle-key');
    const systemPromptInput = document.getElementById('system-prompt');
    const replyDelayMinInput = document.getElementById('reply-delay-min');
    const replyDelayMaxInput = document.getElementById('reply-delay-max');
    const manualPauseInput = document.getElementById('manual-pause');
    const whitelistGroup = document.getElementById('whitelist-group');
    const whitelistInput = document.getElementById('whitelist');
    
    // Scheduler Elements
    const scheduleEnabledCheckbox = document.getElementById('schedule-enabled');
    const scheduleHoursGroup = document.getElementById('schedule-hours-group');
    const scheduleStartInput = document.getElementById('schedule-start');
    const scheduleEndInput = document.getElementById('schedule-end');

    // Custom Rules Elements
    const addRuleForm = document.getElementById('add-rule-form');
    const rulePatternInput = document.getElementById('rule-pattern');
    const ruleResponseInput = document.getElementById('rule-response');
    const ruleExactCheckbox = document.getElementById('rule-exact');
    const rulesListBody = document.getElementById('rules-list-body');

    // Console logs elements
    const consoleLogs = document.getElementById('console-logs');
    const logFilter = document.getElementById('log-filter');
    const btnClearConsole = document.getElementById('btn-clear-console');

    // Chats list elements
    const chatsListBody = document.getElementById('chats-list-body');

    // State Variables
    let qrGenerator = null;
    let rawLogs = [];
    let customRules = [];
    let lastSavedConfig = {};
    let savedAuthPassword = localStorage.getItem('dashboard_auth_pass') || '';

    // --- Key Toggle Action ---
    btnToggleKey.addEventListener('click', () => {
        const type = apiKeyInput.getAttribute('type') === 'password' ? 'text' : 'password';
        apiKeyInput.setAttribute('type', type);
        const icon = btnToggleKey.querySelector('i');
        if (type === 'password') {
            icon.className = 'fa-solid fa-eye';
        } else {
            icon.className = 'fa-solid fa-eye-slash';
        }
    });

    // --- Dynamic Provider Model Loading ---
    const modelsByProvider = {
        gemini: [
            { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Default)' },
            { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (Higher Quota)' },
            { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (Legacy)' },
            { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Complex Tasks)' }
        ],
        groq: [
            { value: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B (OpenAI / Groq)' },
            { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (Free & Instant)' },
            { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (High Quality)' },
            { value: 'gemma2-9b-it', label: 'Gemma 2 9B (Google Model)' }
        ]
    };

    function updateModelSelector(provider, selectedModel = null) {
        modelNameSelect.innerHTML = '';
        const models = modelsByProvider[provider] || [];
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.value;
            option.textContent = model.label;
            if (selectedModel && model.value === selectedModel) {
                option.selected = true;
            }
            modelNameSelect.appendChild(option);
        });

        // Update key helper texts
        if (provider === 'groq') {
            apiKeyLabel.textContent = 'Groq API Key';
            apiKeyHelp.innerHTML = 'Keys are stored locally in config.json. Get a free key from <a href="https://console.groq.com/keys" target="_blank" style="color:var(--accent-primary);text-decoration:underline;">Groq Console</a>.';
        } else {
            apiKeyLabel.textContent = 'Gemini API Key';
            apiKeyHelp.innerHTML = 'Keys are stored locally in config.json. Get a free key from <a href="https://aistudio.google.com/" target="_blank" style="color:var(--accent-primary);text-decoration:underline;">Google AI Studio</a>.';
        }
    }

    // Default initialization
    updateModelSelector('gemini');

    apiProviderSelect.addEventListener('change', (e) => {
        updateModelSelector(e.target.value);
    });

    // --- Radio Whitelist toggle ---
    document.querySelectorAll('input[name="mode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'whitelist') {
                whitelistGroup.classList.remove('hidden');
            } else {
                whitelistGroup.classList.add('hidden');
            }
        });
    });

    // --- Scheduler Toggling ---
    scheduleEnabledCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
            scheduleHoursGroup.classList.remove('hidden');
        } else {
            scheduleHoursGroup.classList.add('hidden');
        }
    });

    // --- Config Save Action ---
    configForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const selectedMode = document.querySelector('input[name="mode"]:checked').value;
        const config = {
            apiProvider: apiProviderSelect.value,
            apiKey: apiKeyInput.value.trim(),
            modelName: modelNameSelect.value,
            dashboardPassword: dashboardPasswordInput.value.trim(),
            scheduleEnabled: scheduleEnabledCheckbox.checked,
            scheduleStartHour: scheduleStartInput.value,
            scheduleEndHour: scheduleEndInput.value,
            systemPrompt: systemPromptInput.value.trim(),
            replyDelayMin: parseInt(replyDelayMinInput.value) || 3,
            replyDelayMax: parseInt(replyDelayMaxInput.value) || 15,
            manualPauseDuration: parseInt(manualPauseInput.value) || 15,
            interactionMode: selectedMode,
            whitelist: whitelistInput.value.split(',').map(n => n.trim()).filter(n => n.length > 0),
            customRules: customRules // Save keyword rules state
        };
        socket.emit('save-config', config);
        addLog('System', 'Saving configuration settings...', 'system');
    });

    // --- Login Form Submission ---
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const pass = loginPasswordInput.value;
        socket.emit('auth', { password: pass });
    });

    // --- Restart Action ---
    btnRestart.addEventListener('click', () => {
        if (confirm('Are you sure you want to restart the WhatsApp client? This will reload the browser session.')) {
            socket.emit('restart-client');
            addLog('System', 'Restarting WhatsApp client...', 'system');
        }
    });

    // --- Clear Console Action ---
    btnClearConsole.addEventListener('click', () => {
        rawLogs = [];
        consoleLogs.innerHTML = '';
    });

    // --- Filter Log Action ---
    logFilter.addEventListener('change', () => {
        renderLogs();
    });

    // --- Custom Rules Handling ---
    addRuleForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const pattern = rulePatternInput.value.trim();
        const responseText = ruleResponseInput.value.trim();
        const exact = ruleExactCheckbox.checked;

        if (!pattern || !responseText) return;

        // Check if rule already exists
        const duplicate = customRules.find(r => r.pattern.toLowerCase() === pattern.toLowerCase());
        if (duplicate) {
            alert('A rule with this trigger keyword already exists!');
            return;
        }

        customRules.push({ pattern, response: responseText, exact });
        renderRulesTable();
        
        // Reset inputs
        rulePatternInput.value = '';
        ruleResponseInput.value = '';
        ruleExactCheckbox.checked = false;

        // Auto-save configuration with new rule
        saveRulesToServer();
        addLog('System', `Added custom auto-reply rule for keyword: "${pattern}"`, 'system');
    });

    function renderRulesTable() {
        if (customRules.length === 0) {
            rulesListBody.innerHTML = `
                <tr class="empty-rules-row">
                    <td colspan="4" class="text-center text-muted">No custom rules added yet.</td>
                </tr>
            `;
            return;
        }

        rulesListBody.innerHTML = '';
        customRules.forEach((rule, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><code class="rule-pattern-code">${escapeHTML(rule.pattern)}</code></td>
                <td><span class="rule-response-snippet" title="${escapeHTML(rule.response)}">${escapeHTML(rule.response)}</span></td>
                <td><span class="badge ${rule.exact ? 'badge-paused' : 'badge-active'}">${rule.exact ? 'Exact' : 'Contains'}</span></td>
                <td>
                    <button class="btn btn-secondary btn-sm btn-delete-rule" data-index="${idx}">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </td>
            `;

            tr.querySelector('.btn-delete-rule').addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.getAttribute('data-index'), 10);
                const deleted = customRules.splice(index, 1)[0];
                renderRulesTable();
                saveRulesToServer();
                addLog('System', `Deleted custom auto-reply rule for keyword: "${deleted.pattern}"`, 'system');
            });

            rulesListBody.appendChild(tr);
        });
    }

    function saveRulesToServer() {
        // Send updated config back
        const updated = {
            ...lastSavedConfig,
            customRules: customRules
        };
        socket.emit('save-config', updated);
    }

    // --- Helper function to add logs ---
    function addLog(source, message, type = 'system') {
        const time = new Date().toLocaleTimeString();
        const log = { time, source, message, type };
        rawLogs.push(log);
        
        // Cap logs at 200 items in memory
        if (rawLogs.length > 200) {
            rawLogs.shift();
        }

        renderLogs();
    }

    function renderLogs() {
        const filter = logFilter.value;
        consoleLogs.innerHTML = '';
        
        const filtered = rawLogs.filter(log => {
            if (filter === 'all') return true;
            if (filter === 'incoming') return log.type === 'incoming';
            if (filter === 'outgoing') return log.type === 'outgoing';
            if (filter === 'system') return log.type === 'system';
            if (filter === 'error') return log.type === 'error';
            return true;
        });

        if (filtered.length === 0) {
            consoleLogs.innerHTML = `<div class="log-entry system"><span class="log-time">[System]</span> No logs in this category.</div>`;
            return;
        }

        filtered.forEach(log => {
            const div = document.createElement('div');
            div.className = `log-entry ${log.type}`;
            div.innerHTML = `<span class="log-time">[${log.time}]</span> <strong>${log.source}:</strong> ${escapeHTML(log.message)}`;
            consoleLogs.appendChild(div);
        });

        // Auto-scroll
        consoleLogs.scrollTop = consoleLogs.scrollHeight;
    }

    // --- Socket.io Event Listeners ---

    socket.on('connect', () => {
        addLog('System', 'Connected to dashboard backend server.', 'system');
        // If we have a saved password, send auth automatically on connect/reconnect
        if (savedAuthPassword) {
            socket.emit('auth', { password: savedAuthPassword });
        }
    });

    socket.on('disconnect', () => {
        updateConnectionState('disconnected', 'Disconnected from server');
        addLog('System', 'Disconnected from dashboard backend server.', 'error');
    });

    // Auth gate signals
    socket.on('require-auth', () => {
        loginOverlay.classList.remove('hidden');
    });

    socket.on('auth-status', (status) => {
        if (status.success) {
            loginOverlay.classList.add('hidden');
            loginPasswordInput.value = '';
            loginErrorMsg.classList.add('hidden');
            // Save valid password in memory and localStorage
            savedAuthPassword = loginPasswordInput.value || savedAuthPassword;
            localStorage.setItem('dashboard_auth_pass', savedAuthPassword);
            addLog('System', 'Authentication succeeded. Dashboard unlocked.', 'system');
        } else {
            loginOverlay.classList.remove('hidden');
            loginErrorMsg.textContent = status.error || 'Access denied';
            loginErrorMsg.classList.remove('hidden');
            localStorage.removeItem('dashboard_auth_pass');
            savedAuthPassword = '';
        }
    });

    // Configuration loaded from backend
    socket.on('load-config', (config) => {
        lastSavedConfig = config;
        
        const provider = config.apiProvider || 'gemini';
        const key = config.apiKey || '';
        const model = config.modelName || (provider === 'groq' ? 'llama-3.1-8b-instant' : 'gemini-2.5-flash');

        apiProviderSelect.value = provider;
        updateModelSelector(provider, model);
        apiKeyInput.value = key;
        dashboardPasswordInput.value = config.dashboardPassword || '';

        // Schedule Loading
        scheduleEnabledCheckbox.checked = config.scheduleEnabled || false;
        if (config.scheduleEnabled) {
            scheduleHoursGroup.classList.remove('hidden');
        } else {
            scheduleHoursGroup.classList.add('hidden');
        }
        scheduleStartInput.value = config.scheduleStartHour !== undefined ? config.scheduleStartHour : '22';
        scheduleEndInput.value = config.scheduleEndHour !== undefined ? config.scheduleEndHour : '08';

        systemPromptInput.value = config.systemPrompt || '';
        replyDelayMinInput.value = config.replyDelayMin || 3;
        replyDelayMaxInput.value = config.replyDelayMax || 15;
        manualPauseInput.value = config.manualPauseDuration || 15;
        
        // Custom Rules loading
        customRules = config.customRules || [];
        renderRulesTable();

        // Mode Loading
        const modeVal = config.interactionMode || 'all';
        const radio = document.querySelector(`input[name="mode"][value="${modeVal}"]`);
        if (radio) {
            radio.checked = true;
            if (modeVal === 'whitelist') {
                whitelistGroup.classList.remove('hidden');
            } else {
                whitelistGroup.classList.add('hidden');
            }
        }

        whitelistInput.value = (config.whitelist || []).join(', ');
        addLog('System', 'Configuration loaded.', 'system');
    });

    socket.on('config-saved-status', (status) => {
        if (status.success) {
            addLog('System', 'Settings saved successfully!', 'system');
            alert('Settings saved successfully!');
            // If dashboard password is changed and it is blank, we can clear auth storage
            if (dashboardPasswordInput.value.trim() === '') {
                localStorage.removeItem('dashboard_auth_pass');
                savedAuthPassword = '';
            } else {
                savedAuthPassword = dashboardPasswordInput.value.trim();
                localStorage.setItem('dashboard_auth_pass', savedAuthPassword);
            }
        } else {
            addLog('System', `Failed to save settings: ${status.error}`, 'error');
            alert(`Error saving settings: ${status.error}`);
        }
    });

    // Bot status updates
    socket.on('status-update', (data) => {
        const { state, detail, repliesCount } = data;
        updateConnectionState(state, detail);
        
        if (repliesCount !== undefined) {
            statReplies.textContent = repliesCount;
        }
    });

    // Analytics updates
    socket.on('stats-update', (stats) => {
        statReceived.textContent = stats.totalReceived || 0;
        statRepliesSent.textContent = stats.totalReplies || 0;
        statOverrides.textContent = stats.manualOverrides || 0;
        statErrors.textContent = stats.totalErrors || 0;
        
        // Format uptime
        uptimeDisplay.textContent = 'Uptime: ' + formatUptime(stats.uptime || 0);
    });

    // QR Code received
    socket.on('qr', (qrString) => {
        updateConnectionState('connecting', 'QR Code generated');
        
        connectingView.classList.add('hidden');
        connectedView.classList.add('hidden');
        qrContainer.classList.remove('hidden');
        
        // Clear old QR code
        qrCodeDiv.innerHTML = '';
        
        // Generate new QR code
        if (typeof QRCode !== 'undefined') {
            qrGenerator = new QRCode(qrCodeDiv, {
                text: qrString,
                width: 200,
                height: 200,
                colorDark : "#000000",
                colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.H
            });
            addLog('System', 'New QR Code generated. Scan to log in.', 'system');
        } else {
            qrCodeDiv.innerText = qrString;
            addLog('System', 'QR Code string received, but QRCode library is not loaded. QR string: ' + qrString, 'error');
        }
    });

    // Logging event
    socket.on('log', (data) => {
        addLog(data.source, data.message, data.type);
    });

    // Chats state updates
    socket.on('update-chats', (chatsData) => {
        statChatsCount.textContent = Object.keys(chatsData).length;
        renderChats(chatsData);
    });

    // --- Helper UI Updates ---
    function updateConnectionState(state, text) {
        connectionDot.className = `status-dot ${state}`;
        connectionText.textContent = text;

        if (state === 'connected') {
            qrContainer.classList.add('hidden');
            connectingView.classList.add('hidden');
            connectedView.classList.remove('hidden');
        } else if (state === 'connecting') {
            connectedView.classList.add('hidden');
            if (qrContainer.classList.contains('hidden')) {
                connectingView.classList.remove('hidden');
            }
            connectingStatusText.textContent = text;
        } else {
            qrContainer.classList.add('hidden');
            connectedView.classList.add('hidden');
            connectingView.classList.remove('hidden');
            connectingStatusText.textContent = 'Disconnected. Booting engine...';
        }
    }

    function renderChats(chats) {
        const keys = Object.keys(chats);
        if (keys.length === 0) {
            chatsListBody.innerHTML = `
                <tr class="empty-row">
                    <td colspan="4">No active conversations monitored yet. Sent/received messages will appear here.</td>
                </tr>
            `;
            return;
        }

        chatsListBody.innerHTML = '';

        // Sort chats by lastMsgTime descending
        const sortedChats = keys.map(k => ({ id: k, ...chats[k] }))
            .sort((a, b) => b.lastMsgTime - a.lastMsgTime);

        sortedChats.forEach(chat => {
            const tr = document.createElement('tr');
            
            // Status determination
            let badgeClass = 'badge-active';
            let badgeText = 'Active';
            
            if (!chat.autoReplyEnabled) {
                badgeClass = 'badge-disabled';
                badgeText = 'Disabled';
            } else if (chat.pausedUntil && chat.pausedUntil > Date.now()) {
                badgeClass = 'badge-paused';
                const secondsLeft = Math.ceil((chat.pausedUntil - Date.now()) / 1000);
                const minutesLeft = Math.ceil(secondsLeft / 60);
                badgeText = `Manual Pause (${minutesLeft}m)`;
            }

            const cleanNumber = chat.id.split('@')[0];

            tr.innerHTML = `
                <td>
                    <span class="chat-name">${escapeHTML(chat.name || cleanNumber)}</span>
                    <span class="chat-number">${cleanNumber}</span>
                </td>
                <td>
                    <span class="chat-msg-snippet" title="${escapeHTML(chat.lastMsgBody || '')}">${escapeHTML(chat.lastMsgBody || 'No text')}</span>
                </td>
                <td>
                    <span class="badge ${badgeClass}">${badgeText}</span>
                </td>
                <td>
                    <label class="switch">
                        <input type="checkbox" class="chat-toggle" data-chat-id="${chat.id}" ${chat.autoReplyEnabled ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </td>
            `;

            tr.querySelector('.chat-toggle').addEventListener('change', (e) => {
                const chatId = e.target.getAttribute('data-chat-id');
                const isEnabled = e.target.checked;
                socket.emit('toggle-chat-auto-reply', { chatId, enabled: isEnabled });
                addLog('System', `${isEnabled ? 'Enabled' : 'Disabled'} auto-reply for ${chat.name || cleanNumber}`, 'system');
            });

            chatsListBody.appendChild(tr);
        });
    }

    // Safe HTML Escaping
    function escapeHTML(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Uptime Formatter
    function formatUptime(seconds) {
        if (seconds < 60) return seconds + 's';
        const minutes = Math.floor(seconds / 60);
        const remSeconds = seconds % 60;
        if (minutes < 60) return `${minutes}m ${remSeconds}s`;
        const hours = Math.floor(minutes / 60);
        const remMinutes = minutes % 60;
        if (hours < 24) return `${hours}h ${remMinutes}m`;
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        return `${days}d ${remHours}h`;
    }
});
