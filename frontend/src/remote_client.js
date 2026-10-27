/**
 * Project Anna - Remote Client Mode
 * 
 * Activated when running in a standard web browser (e.g. Mobile Safari, Chrome, Vercel)
 * without the Electron runtime (isElectron === false).
 * 
 * Provides:
 * 1. 3D Avatar Rendering with IndexedDB caching.
 * 2. Real-time WebSocket connection to Cloudflare Relay (`role=remote`).
 * 3. Motherboard power management via ESP8266 NodeMCU.
 * 4. Remote PC Tool execution (launch apps, visual agent automation, context memory).
 */

import { setRemoteViewMode } from './renderer.js';

// Dynamic configuration resolver (checks Vercel Env Vars -> LocalStorage -> defaults)
export function getRemoteConfig() {
    return {
        relayUrl: import.meta.env?.VITE_CF_RELAY_URL || localStorage.getItem('anna_relay_url') || 'wss://ai-overtake-relay.gravitymarts.workers.dev/ws',
        authSecret: import.meta.env?.VITE_AUTH_SECRET || localStorage.getItem('anna_auth_secret') || 'anna-secret-token-change-me',
        targetMac: import.meta.env?.VITE_TARGET_MAC || localStorage.getItem('anna_target_mac') || '74:56:3C:63:A9:9A'
    };
}

let socket = null;
let pingInterval = null;

export function initRemoteClient() {
    console.log("📱 [RemoteClient] Initializing mobile / browser remote mode...");

    // Remove desktop-specific window drag and click-through attributes
    document.documentElement.style.background = '#0a0d14';
    document.body.style.background = '#0a0d14';
    document.body.style.overflow = 'auto';

    // Hide desktop Electron settings if present
    const settingsContainer = document.getElementById('settings-container');
    if (settingsContainer) {
        settingsContainer.style.display = 'none';
    }

    // Mount Remote Controller UI
    mountRemoteUI();

    // Attach 3D Anna avatar inside the avatar-container card
    const avatarContainer = document.getElementById('avatar-container');
    if (avatarContainer) {
        setRemoteViewMode(avatarContainer);
    }

    // Connect to Cloudflare Worker WebSocket Relay
    connectToRelay();
}

function mountRemoteUI() {
    // Avoid double mounting
    if (document.getElementById('remote-dashboard')) return;

    const config = getRemoteConfig();

    const dashboard = document.createElement('div');
    dashboard.id = 'remote-dashboard';
    dashboard.innerHTML = `
        <div class="remote-header">
            <div class="remote-brand">
                <span class="remote-logo-dot"></span>
                <span class="remote-title">ANNA REMOTE</span>
            </div>
            <div class="remote-status-indicators">
                <div id="pc-status-badge" class="status-badge offline">
                    <span class="status-dot"></span>
                    <span class="status-text">PC: Offline</span>
                </div>
                <div id="hw-status-badge" class="status-badge offline">
                    <span class="status-dot"></span>
                    <span class="status-text">ESP8266: Offline</span>
                </div>
                <button id="btn-toggle-config" class="config-gear-btn" title="Connection Settings">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg>
                </button>
            </div>
        </div>

        <div class="remote-main-container">
            <!-- Collapsible Connection Settings -->
            <div id="remote-config-card" class="controls-card config-card hidden">
                <div class="card-section-title">RELAY & CREDENTIAL SETTINGS</div>
                <div class="config-field">
                    <label>Cloudflare Relay WebSocket URL</label>
                    <input type="text" id="cfg-relay-url" value="${config.relayUrl}" placeholder="wss://.../ws" />
                </div>
                <div class="config-field">
                    <label>Shared Secret Token (AUTH_SECRET)</label>
                    <input type="password" id="cfg-auth-secret" value="${config.authSecret}" placeholder="Secret token" />
                </div>
                <div class="config-field">
                    <label>Target PC Ethernet MAC (for Wake-on-LAN)</label>
                    <input type="text" id="cfg-target-mac" value="${config.targetMac}" placeholder="e.g. 74:56:3C:63:A9:9A" />
                </div>
                <button id="btn-save-config" class="btn-primary" style="margin-top: 10px; width: 100%;">Save & Reconnect</button>
            </div>
            <!-- 3D Avatar Viewport -->
            <div class="avatar-remote-card">
                <div class="avatar-canvas-wrapper" id="avatar-container">
                    <!-- The existing Three.js canvas in #app stays visible here -->
                </div>
                <div class="avatar-overlay-label">Anna · Virtual Companion</div>
            </div>

            <!-- Quick Controls & Hardware Actions -->
            <!-- Power & Wake-on-LAN Controls -->
            <div class="controls-card">
                <div class="card-section-title">REMOTE POWER CONTROLS</div>
                <div class="button-grid">
                    <button id="btn-power-on" class="btn-primary">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                        </svg>
                        Wake PC (WoL)
                    </button>
                    <button id="btn-sleep-pc" class="btn-secondary">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                        </svg>
                        Sleep PC
                    </button>
                    <button id="btn-force-off" class="btn-danger" style="grid-column: span 2;">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                            <line x1="12" y1="2" x2="12" y2="12"></line>
                        </svg>
                        Shutdown PC
                    </button>
                </div>
                <div class="wol-target-badge">
                    <span>📡 Target MAC:</span>
                    <code>74:56:3C:63:A9:9A</code>
                </div>
            </div>

            <!-- Quick App Triggers -->
            <div class="controls-card">
                <div class="card-section-title">QUICK LAUNCH APPLICATIONS</div>
                <div class="quick-apps-grid">
                    <button class="app-chip" data-app="notepad">📝 Notepad</button>
                    <button class="app-chip" data-app="chrome">🌐 Chrome</button>
                    <button class="app-chip" data-app="spotify">🎵 Spotify</button>
                    <button class="app-chip" data-app="calc">🧮 Calculator</button>
                    <button class="app-chip" data-app="code">💻 VS Code</button>
                </div>
            </div>

            <!-- Command & Goal Input -->
            <div class="controls-card">
                <div class="card-section-title">REMOTE DESKTOP COMMAND</div>
                <form id="remote-cmd-form" class="cmd-form">
                    <input 
                        type="text" 
                        id="cmd-input" 
                        class="cmd-input" 
                        placeholder="e.g. Open YouTube and play lofi music..."
                        autocomplete="off"
                    />
                    <button type="submit" class="cmd-send-btn" id="cmd-send-btn">
                        <span>Send</span>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="22" y1="2" x2="11" y2="13"></line>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                        </svg>
                    </button>
                </form>
            </div>

            <!-- Live Event Activity Log -->
            <div class="controls-card">
                <div class="log-header">
                    <div class="card-section-title">ACTIVITY & EXECUTION LOG</div>
                    <button id="btn-clear-log" class="btn-text">Clear</button>
                </div>
                <div id="event-log" class="event-log-container">
                    <div class="log-entry system">Initializing Project Anna remote link...</div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(dashboard);
    injectRemoteStyles();
    bindUIEvents();
}

function injectRemoteStyles() {
    const style = document.createElement('style');
    style.id = 'remote-mode-styles';
    style.textContent = `
        :root {
            --bg-dark: #0a0e17;
            --card-bg: rgba(18, 24, 38, 0.75);
            --card-border: rgba(255, 255, 255, 0.08);
            --accent: #6366f1;
            --accent-glow: rgba(99, 102, 241, 0.35);
            --success: #10b981;
            --danger: #ef4444;
            --text-main: #f3f4f6;
            --text-dim: #9ca3af;
        }

        #remote-dashboard {
            display: flex;
            flex-direction: column;
            min-height: 100vh;
            color: var(--text-main);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            padding-bottom: 24px;
            box-sizing: border-box;
        }

        .remote-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 20px;
            background: rgba(10, 14, 23, 0.85);
            backdrop-filter: blur(16px);
            border-bottom: 1px solid var(--card-border);
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .remote-brand {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .remote-logo-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: var(--accent);
            box-shadow: 0 0 10px var(--accent);
        }

        .remote-title {
            font-size: 15px;
            font-weight: 700;
            letter-spacing: 1.5px;
            color: #fff;
        }

        .remote-status-indicators {
            display: flex;
            gap: 10px;
        }

        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.5px;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid var(--card-border);
            transition: all 0.3s ease;
        }

        .status-badge .status-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
        }

        .status-badge.offline .status-dot {
            background: #ef4444;
            box-shadow: 0 0 6px #ef4444;
        }

        .status-badge.online {
            border-color: rgba(16, 185, 129, 0.3);
            background: rgba(16, 185, 129, 0.08);
        }

        .status-badge.online .status-dot {
            background: #10b981;
            box-shadow: 0 0 8px #10b981;
        }

        .remote-main-container {
            max-width: 640px;
            margin: 0 auto;
            width: 100%;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            box-sizing: border-box;
        }

        .avatar-remote-card {
            background: radial-gradient(circle at 50% 28%, rgba(99, 102, 241, 0.22) 0%, rgba(18, 24, 38, 0.95) 70%, #0a0e17 100%);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            overflow: hidden;
            position: relative;
            height: 380px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .avatar-canvas-wrapper {
            width: 100%;
            height: 100%;
            position: relative;
            overflow: hidden;
        }

        .avatar-canvas-wrapper #app {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            z-index: 1;
            pointer-events: auto;
        }

        .avatar-canvas-wrapper #app canvas {
            width: 100% !important;
            height: 100% !important;
            display: block;
        }

        .avatar-overlay-label {
            position: absolute;
            bottom: 12px;
            left: 14px;
            font-size: 11px;
            color: var(--text-dim);
            letter-spacing: 0.8px;
            background: rgba(0, 0, 0, 0.6);
            padding: 4px 10px;
            border-radius: 12px;
            backdrop-filter: blur(8px);
            z-index: 2;
        }

        .controls-card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: 16px;
            padding: 16px;
            backdrop-filter: blur(12px);
        }

        .card-section-title {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 1.2px;
            color: var(--text-dim);
            margin-bottom: 12px;
        }

        .button-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }

        button {
            cursor: pointer;
            border: none;
            outline: none;
            font-family: inherit;
        }

        .btn-primary, .btn-secondary, .btn-danger {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 12px;
            border-radius: 10px;
            font-size: 13px;
            font-weight: 600;
            transition: all 0.2s ease;
        }

        .btn-primary {
            background: linear-gradient(135deg, #4f46e5, #6366f1);
            color: #fff;
            box-shadow: 0 4px 14px var(--accent-glow);
        }

        .btn-primary:active {
            transform: scale(0.98);
        }

        .btn-secondary {
            background: rgba(255, 255, 255, 0.08);
            color: #e2e8f0;
            border: 1px solid var(--card-border);
        }

        .btn-secondary:active {
            background: rgba(255, 255, 255, 0.14);
            transform: scale(0.98);
        }

        .btn-danger {
            background: rgba(239, 68, 68, 0.15);
            color: #ef4444;
            border: 1px solid rgba(239, 68, 68, 0.3);
        }

        .btn-danger:active {
            transform: scale(0.98);
            background: rgba(239, 68, 68, 0.25);
        }

        .config-gear-btn {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid var(--card-border);
            color: var(--text-dim);
            padding: 6px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
        }

        .config-gear-btn:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.1);
        }

        .config-card {
            border: 1px solid rgba(99, 102, 241, 0.35);
            box-shadow: 0 4px 20px var(--accent-glow);
        }

        .config-card.hidden {
            display: none;
        }

        .config-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 10px;
        }

        .config-field label {
            font-size: 11px;
            font-weight: 600;
            color: var(--text-dim);
        }

        .config-field input {
            padding: 10px 12px;
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.4);
            border: 1px solid var(--card-border);
            color: #fff;
            font-size: 12px;
            font-family: inherit;
            outline: none;
        }

        .config-field input:focus {
            border-color: var(--accent);
        }

        .button-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }

        .app-chip {
            padding: 8px 14px;
            border-radius: 20px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid var(--card-border);
            color: var(--text-main);
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s ease;
        }

        .app-chip:hover {
            background: rgba(255, 255, 255, 0.12);
            border-color: rgba(255, 255, 255, 0.2);
            transform: translateY(-1px);
        }

        .app-chip:active {
            transform: scale(0.96);
        }

        .cmd-form {
            display: flex;
            gap: 8px;
        }

        .cmd-input {
            flex: 1;
            padding: 12px 14px;
            border-radius: 10px;
            background: rgba(0, 0, 0, 0.35);
            border: 1px solid var(--card-border);
            color: #fff;
            font-size: 13px;
            outline: none;
            transition: border-color 0.2s ease;
        }

        .cmd-input:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 2px var(--accent-glow);
        }

        .cmd-send-btn {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 12px 18px;
            background: var(--accent);
            color: #fff;
            font-weight: 600;
            font-size: 13px;
            border-radius: 10px;
            transition: opacity 0.2s ease;
        }

        .cmd-send-btn:active {
            opacity: 0.85;
        }

        .log-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .btn-text {
            background: transparent;
            color: var(--text-dim);
            font-size: 11px;
            padding: 2px 6px;
        }

        .event-log-container {
            margin-top: 10px;
            max-height: 180px;
            overflow-y: auto;
            background: rgba(0, 0, 0, 0.4);
            border-radius: 8px;
            padding: 10px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
            font-size: 11px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .log-entry {
            color: #cbd5e1;
            line-height: 1.4;
            word-break: break-word;
        }

        .log-entry.system { color: #94a3b8; }
        .log-entry.success { color: #34d399; }
        .log-entry.error { color: #f87171; }
        .log-entry.sent { color: #818cf8; }
    `;
    document.head.appendChild(style);
}

function bindUIEvents() {
    // 0. Toggle Connection Settings Panel
    const configToggle = document.getElementById('btn-toggle-config');
    const configCard = document.getElementById('remote-config-card');
    configToggle?.addEventListener('click', () => {
        configCard?.classList.toggle('hidden');
    });

    // 0.1 Save Connection Settings
    document.getElementById('btn-save-config')?.addEventListener('click', () => {
        const url = document.getElementById('cfg-relay-url')?.value.trim();
        const secret = document.getElementById('cfg-auth-secret')?.value.trim();
        const mac = document.getElementById('cfg-target-mac')?.value.trim();

        if (url) localStorage.setItem('anna_relay_url', url);
        if (secret) localStorage.setItem('anna_auth_secret', secret);
        if (mac) {
            localStorage.setItem('anna_target_mac', mac);
            const badgeCode = document.querySelector('.wol-target-badge code');
            if (badgeCode) badgeCode.textContent = mac;
        }

        configCard?.classList.add('hidden');
        logEvent('Settings saved to localStorage. Reconnecting...', 'success');
        connectToRelay();
    });

    // 1. Wake PC via ESP8266 Wake-on-LAN Magic Packet
    document.getElementById('btn-power-on')?.addEventListener('click', () => {
        const cfg = getRemoteConfig();
        logEvent(`Triggering ESP8266 Wake-on-LAN Magic Packet to PC (${cfg.targetMac})...`, 'sent');
        sendPayload({
            type: 'HARDWARE_CMD',
            action: 'WAKE_ON_LAN',
            mac: cfg.targetMac
        });
    });

    // 2. Sleep PC
    document.getElementById('btn-sleep-pc')?.addEventListener('click', () => {
        logEvent('Sending PC sleep command...', 'sent');
        sendPayload({
            type: 'EXECUTE_TOOL',
            tool_name: 'sleep_pc',
            tool_args: {}
        });
    });

    // 3. Clean Shutdown PC
    document.getElementById('btn-force-off')?.addEventListener('click', () => {
        if (confirm("Are you sure you want to shut down your PC?")) {
            logEvent('Sending Windows system shutdown command...', 'sent');
            sendPayload({
                type: 'EXECUTE_TOOL',
                tool_name: 'shutdown_pc',
                tool_args: {}
            });
        }
    });

    // 4. Quick Launch App Chips
    document.querySelectorAll('.app-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            const app = chip.getAttribute('data-app');
            logEvent(`Requesting PC to open app: ${app}`, 'sent');
            sendPayload({
                type: 'EXECUTE_TOOL',
                tool_name: 'access_computer_tool',
                tool_args: {
                    app: app,
                    goal: `Open ${app}`,
                    continue_to_agent: false
                }
            });
        });
    });

    // 4. Command Input Form
    const form = document.getElementById('remote-cmd-form');
    const input = document.getElementById('cmd-input');
    form?.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;

        logEvent(`Dispatching command: "${text}"`, 'sent');
        sendPayload({
            type: 'EXECUTE_TOOL',
            tool_name: 'access_computer_tool',
            tool_args: {
                goal: text,
                continue_to_agent: true
            }
        });

        input.value = '';
    });

    // 5. Clear Log
    document.getElementById('btn-clear-log')?.addEventListener('click', () => {
        const logBox = document.getElementById('event-log');
        if (logBox) logBox.innerHTML = '';
    });
}

function connectToRelay() {
    if (socket) {
        try { socket.close(); } catch (e) {}
    }

    const config = getRemoteConfig();
    const wsUrl = `${config.relayUrl}?role=remote&token=${config.authSecret}`;
    logEvent(`Connecting to Cloudflare Relay (${config.relayUrl})...`, 'system');

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        logEvent('Connected to Cloudflare Worker Relay as role=remote.', 'success');
        
        // Setup keepalive ping
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'PING' }));
            }
        }, 25000);
    };

    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleIncomingRelayMessage(data);
        } catch (e) {
            console.error('[RemoteClient] Parse error:', e);
        }
    };

    socket.onclose = () => {
        logEvent('Disconnected from relay. Reconnecting in 5s...', 'error');
        updateStatusBadges(false, false);
        if (pingInterval) clearInterval(pingInterval);
        setTimeout(connectToRelay, 5000);
    };

    socket.onerror = (err) => {
        console.error('[RemoteClient] Socket error:', err);
    };
}

function handleIncomingRelayMessage(data) {
    switch (data.type) {
        case 'SYSTEM_STATUS': {
            updateStatusBadges(data.pc_online, data.hardware_online);
            break;
        }

        case 'TOOL_RESULT': {
            const toolName = data.tool_name || 'Tool';
            const res = data.result || {};
            const isOk = res.status === 'success';
            const detail = res.message || JSON.stringify(res);
            logEvent(`[${toolName}] ${detail}`, isOk ? 'success' : 'error');
            break;
        }

        case 'HARDWARE_STATUS': {
            logEvent(`[Hardware] ${data.action || 'Action'} status: ${data.status}`, 'success');
            break;
        }

        case 'PONG':
            // Pong keepalive response
            break;

        default:
            console.log('[RemoteClient] Unhandled message:', data);
    }
}

function updateStatusBadges(pcOnline, hwOnline) {
    const pcBadge = document.getElementById('pc-status-badge');
    const hwBadge = document.getElementById('hw-status-badge');

    if (pcBadge) {
        pcBadge.className = `status-badge ${pcOnline ? 'online' : 'offline'}`;
        pcBadge.querySelector('.status-text').textContent = `PC: ${pcOnline ? 'Online' : 'Offline'}`;
    }

    if (hwBadge) {
        hwBadge.className = `status-badge ${hwOnline ? 'online' : 'offline'}`;
        hwBadge.querySelector('.status-text').textContent = `ESP8266: ${hwOnline ? 'Online' : 'Offline'}`;
    }
}

function sendPayload(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        logEvent('Error: Relay is offline. Message not sent.', 'error');
        return;
    }
    socket.send(JSON.stringify(payload));
}

function logEvent(text, type = 'system') {
    const logBox = document.getElementById('event-log');
    if (!logBox) return;

    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${text}`;
    logBox.appendChild(entry);
    logBox.scrollTop = logBox.scrollHeight;
}
