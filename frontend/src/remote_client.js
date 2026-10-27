/**
 * Project Anna - Futuristic Remote Command Deck
 * 
 * High-performance, responsive Cyberpunk Glassmorphism interface for
 * remote PC monitoring, hardware power management, and AI companion control.
 * 
 * Features:
 * - Dual Mode: Full 3D VRM Avatar OR Lightweight 2D Holographic AI Core (0% GPU for older phones)
 * - Wake-on-LAN (WoL) & Power Matrix via ESP8266 NodeMCU
 * - Quick App Launch Deck with brand accents
 * - Natural Language AI Automation Console
 * - Real-Time Terminal Log with filtering and copy
 * - Live Connection Telemetry & Diagnostic Drawer
 */

import { initVRM, stopVRM, isVRMActive, setRemoteViewMode, triggerAvatarAnimation } from './renderer.js';

// Dynamic configuration resolver (checks Vercel Env Vars -> LocalStorage -> defaults)
export function getRemoteConfig() {
    return {
        relayUrl: import.meta.env?.VITE_CF_RELAY_URL || localStorage.getItem('anna_relay_url') || 'wss://ai-overtake-relay.gravitymarts.workers.dev/ws',
        authSecret: import.meta.env?.VITE_AUTH_SECRET || localStorage.getItem('anna_auth_secret') || 'anna-secret-token-change-me',
        targetMac: import.meta.env?.VITE_TARGET_MAC || localStorage.getItem('anna_target_mac') || '74:56:3C:63:A9:9A'
    };
}

export function isVRMEnabled() {
    const val = localStorage.getItem('anna_vrm_enabled');
    // If not explicitly set, default to true, or false if screen is small mobile
    if (val === null) {
        // Safe default: true, but if mobile user toggles off, it persists
        return true;
    }
    return val === 'true';
}

export function setVRMEnabled(enabled) {
    localStorage.setItem('anna_vrm_enabled', enabled ? 'true' : 'false');
    updateVRMDisplayState(enabled);
}

let socket = null;
let pingInterval = null;
let currentFilter = 'all';
let autoScroll = true;
let logs = [];
let pingStartTime = 0;
let lastLatency = null;

export function initRemoteClient() {
    console.log("📱 [RemoteClient] Initializing futuristic mobile remote command deck...");

    // Setup viewport background and style
    document.documentElement.style.background = '#070913';
    document.body.style.background = '#070913';
    document.body.style.overflow = 'auto';

    // Hide desktop Electron settings if present
    const settingsContainer = document.getElementById('settings-container');
    if (settingsContainer) {
        settingsContainer.style.display = 'none';
    }

    // Mount the Futuristic Remote Controller UI
    mountRemoteUI();

    // Check VRM setting and initialize if enabled
    const vrmPref = isVRMEnabled();
    updateVRMDisplayState(vrmPref, true);

    // Connect to Cloudflare Worker WebSocket Relay
    connectToRelay();
}

function updateVRMDisplayState(vrmEnabled, isInitial = false) {
    const avatarCard = document.getElementById('avatar-card-wrapper');
    const avatarCanvas = document.getElementById('avatar-container');
    const hologramCore = document.getElementById('hologram-lite-core');
    const toggleHeaderBtn = document.getElementById('header-vrm-toggle');
    const settingsToggle = document.getElementById('cfg-vrm-toggle');
    const vrmBadgeText = document.getElementById('vrm-status-badge-text');

    if (vrmEnabled) {
        // Enable 3D Mode
        if (avatarCanvas) avatarCanvas.style.display = 'block';
        if (hologramCore) hologramCore.style.display = 'none';
        if (avatarCard) avatarCard.classList.remove('lite-mode-active');
        if (toggleHeaderBtn) {
            toggleHeaderBtn.innerHTML = `
                <span class="vrm-pill-dot active"></span>
                <span class="vrm-pill-text">3D Avatar</span>
            `;
            toggleHeaderBtn.title = "Click to switch to Lite Mode (Save battery on older phones)";
        }
        if (settingsToggle) settingsToggle.checked = true;
        if (vrmBadgeText) vrmBadgeText.textContent = "3D VRM Active (60 FPS)";

        // Initialize VRM scene if not already active
        if (!isVRMActive()) {
            initVRM();
        }
        if (avatarCanvas) {
            setRemoteViewMode(avatarCanvas);
        }
        if (!isInitial) {
            logEvent("✨ 3D VRM Avatar scene activated.", "success");
        }
    } else {
        // Enable Lite Mode (Battery / Old Phone Saver)
        if (avatarCanvas) avatarCanvas.style.display = 'none';
        if (hologramCore) hologramCore.style.display = 'flex';
        if (avatarCard) avatarCard.classList.add('lite-mode-active');
        if (toggleHeaderBtn) {
            toggleHeaderBtn.innerHTML = `
                <span class="vrm-pill-dot lite"></span>
                <span class="vrm-pill-text">⚡ Lite Core</span>
            `;
            toggleHeaderBtn.title = "Lite Mode active (0% GPU). Click to switch to 3D Avatar";
        }
        if (settingsToggle) settingsToggle.checked = false;
        if (vrmBadgeText) vrmBadgeText.textContent = "⚡ Lite Hologram (0% GPU)";

        // Tear down 3D VRM immediately to free 100% GPU memory & WebGL context
        if (isVRMActive()) {
            stopVRM();
        }
        if (!isInitial) {
            logEvent("🧊 VRM Model disabled. 2D Hologram Core active (0% GPU / Battery Saver).", "system");
        }
    }
}

function mountRemoteUI() {
    if (document.getElementById('remote-dashboard')) return;

    const config = getRemoteConfig();
    const vrmActive = isVRMEnabled();

    const dashboard = document.createElement('div');
    dashboard.id = 'remote-dashboard';
    dashboard.innerHTML = `
        <!-- Cyber Background Glow Gradients -->
        <div class="ambient-glow glow-1"></div>
        <div class="ambient-glow glow-2"></div>
        <div class="ambient-glow glow-3"></div>

        <!-- Sticky Futuristic Header -->
        <header class="remote-header">
            <div class="header-inner">
                <div class="remote-brand">
                    <div class="brand-orb">
                        <span class="orb-core"></span>
                        <span class="orb-ring"></span>
                    </div>
                    <div class="brand-text">
                        <div class="brand-name">ANNA <span class="brand-sub">CORE</span></div>
                        <div class="brand-role">REMOTE DECK</div>
                    </div>
                </div>

                <!-- Telemetry Badges & Quick Action Controls -->
                <div class="header-actions">
                    <!-- Live PC Online Status -->
                    <div id="pc-status-badge" class="telemetry-pill offline" title="Target PC Status">
                        <span class="pulse-indicator"></span>
                        <span class="pill-label">PC: OFFLINE</span>
                    </div>

                    <!-- ESP8266 Hardware Status -->
                    <div id="hw-status-badge" class="telemetry-pill offline" title="ESP8266 WoL Relay Node Status">
                        <span class="pulse-indicator"></span>
                        <span class="pill-label">ESP: OFFLINE</span>
                    </div>

                    <!-- Quick VRM / Lite Toggle Pill in Header -->
                    <button id="header-vrm-toggle" class="vrm-quick-toggle" title="Toggle 3D VRM or Lite Mode">
                        <span class="vrm-pill-dot ${vrmActive ? 'active' : 'lite'}"></span>
                        <span class="vrm-pill-text">${vrmActive ? '3D Avatar' : '⚡ Lite Core'}</span>
                    </button>

                    <!-- Settings Drawer Toggle -->
                    <button id="btn-toggle-config" class="icon-action-btn" title="System Settings & Relay Credentials">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                        </svg>
                    </button>
                </div>
            </div>
        </header>

        <!-- Main Body Container -->
        <main class="remote-main-container">
            <!-- Quick Diagnostics & Status Strip -->
            <section class="telemetry-strip glass-card">
                <div class="telem-item">
                    <span class="telem-label">RELAY LINK</span>
                    <span class="telem-value" id="telem-relay-status">CONNECTING…</span>
                </div>
                <div class="telem-separator"></div>
                <div class="telem-item">
                    <span class="telem-label">LATENCY</span>
                    <span class="telem-value text-accent" id="telem-latency">-- ms</span>
                </div>
                <div class="telem-separator"></div>
                <div class="telem-item mac-item" id="btn-copy-mac" title="Click to copy Target MAC">
                    <span class="telem-label">PC MAC (WOL)</span>
                    <span class="telem-value font-mono">
                        <code id="display-mac">${config.targetMac}</code>
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </span>
                </div>
            </section>

            <!-- ══════════════════════════════════════════════
                 AVATAR VIEWPORT / 2D HOLOGRAPHIC CORE CARD
            ══════════════════════════════════════════════ -->
            <section class="companion-card glass-card" id="avatar-card-wrapper">
                <!-- Top HUD Bar inside Avatar Card -->
                <div class="companion-hud-top">
                    <div class="hud-status-chip">
                        <span class="hud-dot"></span>
                        <span id="vrm-status-badge-text">3D VRM Active</span>
                    </div>

                    <!-- Fast Mode Switch Button inside Viewport -->
                    <button id="btn-card-vrm-toggle" class="btn-ghost-sm" title="Toggle 3D / Lite Mode">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>
                        </svg>
                        <span id="card-toggle-text">Switch Mode</span>
                    </button>
                </div>

                <!-- 1. 3D WebGL Avatar Viewport -->
                <div class="avatar-canvas-wrapper" id="avatar-container">
                    <!-- Three.js Canvas (#app) is mounted here -->
                </div>

                <!-- 2. Lightweight 2D Holographic AI Core (for older phones / battery saver) -->
                <div class="hologram-lite-container" id="hologram-lite-core" style="display: none;">
                    <div class="holo-energy-field">
                        <!-- Concentric Rotating Cyber Rings -->
                        <div class="holo-ring outer-ring"></div>
                        <div class="holo-ring middle-ring"></div>
                        <div class="holo-ring inner-ring"></div>
                        
                        <!-- Core Pulsing Orb -->
                        <div class="holo-orb">
                            <div class="orb-inner-light"></div>
                            <div class="orb-pulse-wave"></div>
                        </div>

                        <!-- Soundwave Spectrum Bars -->
                        <div class="holo-spectrum">
                            <span class="spec-bar b1"></span>
                            <span class="spec-bar b2"></span>
                            <span class="spec-bar b3"></span>
                            <span class="spec-bar b4"></span>
                            <span class="spec-bar b5"></span>
                            <span class="spec-bar b6"></span>
                            <span class="spec-bar b7"></span>
                            <span class="spec-bar b8"></span>
                        </div>
                    </div>

                    <div class="holo-details">
                        <h3 class="holo-title">ANNA // NEURAL MATRIX</h3>
                        <p class="holo-subtitle">⚡ Lite Performance Mode (0% GPU · 60 FPS)</p>
                        <p class="holo-hint">WebGL disabled to ensure ultra-smooth performance on older mobile hardware.</p>
                        <button id="btn-enable-3d-from-holo" class="btn-holo-enable">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                                <polyline points="2 17 12 22 22 17"></polyline>
                                <polyline points="2 12 12 17 22 12"></polyline>
                            </svg>
                            Activate 3D Avatar Model
                        </button>
                    </div>
                </div>

                <!-- Bottom Avatar Controls & Emotion Triggers -->
                <div class="companion-hud-bottom" id="avatar-action-bar">
                    <button class="anim-btn" data-anim="waving" title="Wave Hello">👋 Wave</button>
                    <button class="anim-btn" data-anim="thinking" title="Thinking Pose">🤔 Think</button>
                    <button class="anim-btn" data-anim="talking" title="Speaking Gesture">🗣️ Talk</button>
                    <button class="anim-btn" data-anim="nodding" title="Head Nod">🙂 Nod</button>
                    <button class="anim-btn ghost" id="btn-recenter-cam" title="Reset Camera Framing">🎯 Recenter</button>
                </div>
            </section>

            <!-- ══════════════════════════════════════════════
                 REMOTE POWER & MOTHERBOARD CONTROLS
            ══════════════════════════════════════════════ -->
            <section class="controls-card glass-card">
                <div class="card-header">
                    <div class="card-title-group">
                        <span class="card-icon-badge power-badge">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                            </svg>
                        </span>
                        <div>
                            <h2 class="card-title">POWER & HARDWARE CONTROL</h2>
                            <p class="card-desc">Motherboard relay control via ESP8266 & Windows ACPI</p>
                        </div>
                    </div>
                </div>

                <div class="power-grid">
                    <!-- Wake on LAN Hero Button -->
                    <button id="btn-power-on" class="power-card-btn btn-wake" title="Send Wake-on-LAN Magic Packet">
                        <div class="btn-icon-wrapper">
                            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                            </svg>
                        </div>
                        <div class="btn-content">
                            <span class="btn-label-title">WAKE PC</span>
                            <span class="btn-label-sub">ESP8266 WoL Magic Packet</span>
                        </div>
                    </button>

                    <!-- Sleep PC Button -->
                    <button id="btn-sleep-pc" class="power-card-btn btn-sleep" title="Put PC into low power sleep">
                        <div class="btn-icon-wrapper">
                            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                            </svg>
                        </div>
                        <div class="btn-content">
                            <span class="btn-label-title">SLEEP PC</span>
                            <span class="btn-label-sub">Suspend Workstation</span>
                        </div>
                    </button>

                    <!-- Lock PC Button -->
                    <button id="btn-lock-pc" class="power-card-btn btn-lock" title="Lock Windows screen">
                        <div class="btn-icon-wrapper">
                            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                            </svg>
                        </div>
                        <div class="btn-content">
                            <span class="btn-label-title">LOCK PC</span>
                            <span class="btn-label-sub">Lock Windows Session</span>
                        </div>
                    </button>

                    <!-- Shutdown PC Button -->
                    <button id="btn-force-off" class="power-card-btn btn-shutdown" title="Safely shutdown target PC">
                        <div class="btn-icon-wrapper">
                            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
                                <line x1="12" y1="2" x2="12" y2="12"></line>
                            </svg>
                        </div>
                        <div class="btn-content">
                            <span class="btn-label-title">SHUTDOWN</span>
                            <span class="btn-label-sub">Graceful Power Off</span>
                        </div>
                    </button>
                </div>
            </section>

            <!-- ══════════════════════════════════════════════
                 QUICK APP LAUNCH DECK
            ══════════════════════════════════════════════ -->
            <section class="controls-card glass-card">
                <div class="card-header">
                    <div class="card-title-group">
                        <span class="card-icon-badge apps-badge">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="7" height="7"></rect>
                                <rect x="14" y="3" width="7" height="7"></rect>
                                <rect x="14" y="14" width="7" height="7"></rect>
                                <rect x="3" y="14" width="7" height="7"></rect>
                            </svg>
                        </span>
                        <div>
                            <h2 class="card-title">QUICK LAUNCH DECK</h2>
                            <p class="card-desc">Execute desktop applications with single-tap</p>
                        </div>
                    </div>
                </div>

                <div class="quick-apps-grid">
                    <button class="app-chip app-chrome" data-app="chrome">
                        <span class="app-icon">🌐</span>
                        <span class="app-name">Chrome</span>
                    </button>
                    <button class="app-chip app-vscode" data-app="code">
                        <span class="app-icon">💻</span>
                        <span class="app-name">VS Code</span>
                    </button>
                    <button class="app-chip app-spotify" data-app="spotify">
                        <span class="app-icon">🎵</span>
                        <span class="app-name">Spotify</span>
                    </button>
                    <button class="app-chip app-youtube" data-app="youtube">
                        <span class="app-icon">📺</span>
                        <span class="app-name">YouTube</span>
                    </button>
                    <button class="app-chip app-discord" data-app="discord">
                        <span class="app-icon">💬</span>
                        <span class="app-name">Discord</span>
                    </button>
                    <button class="app-chip app-notepad" data-app="notepad">
                        <span class="app-icon">📝</span>
                        <span class="app-name">Notepad</span>
                    </button>
                    <button class="app-chip app-calc" data-app="calc">
                        <span class="app-icon">🧮</span>
                        <span class="app-name">Calculator</span>
                    </button>
                    <button class="app-chip app-explorer" data-app="explorer">
                        <span class="app-icon">📁</span>
                        <span class="app-name">Explorer</span>
                    </button>
                </div>
            </section>

            <!-- ══════════════════════════════════════════════
                 REMOTE COMMAND & AI AUTOMATION CONSOLE
            ══════════════════════════════════════════════ -->
            <section class="controls-card glass-card">
                <div class="card-header">
                    <div class="card-title-group">
                        <span class="card-icon-badge cmd-badge">
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="4 17 10 11 4 5"></polyline>
                                <line x1="12" y1="19" x2="20" y2="19"></line>
                            </svg>
                        </span>
                        <div>
                            <h2 class="card-title">AI COMMAND & AUTOMATION</h2>
                            <p class="card-desc">Execute natural language instructions on host PC</p>
                        </div>
                    </div>
                </div>

                <form id="remote-cmd-form" class="cmd-form-wrapper">
                    <div class="cmd-input-container">
                        <span class="cmd-prompt-symbol">&gt;</span>
                        <input 
                            type="text" 
                            id="cmd-input" 
                            class="cmd-input" 
                            placeholder="e.g. Open YouTube and play lofi beats, mute volume..."
                            autocomplete="off"
                        />
                        <button type="submit" class="cmd-submit-btn" id="cmd-send-btn" title="Send Command">
                            <span>Execute</span>
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                            </svg>
                        </button>
                    </div>
                </form>

                <!-- Prompt Suggestion Chips -->
                <div class="prompt-suggestions">
                    <span class="prompt-chip" data-prompt="Open YouTube and search synthwave lofi music">🎵 Play Synthwave</span>
                    <span class="prompt-chip" data-prompt="Take a screenshot of the desktop">📸 Take Screenshot</span>
                    <span class="prompt-chip" data-prompt="Set master volume to 50 percent">🔊 Volume 50%</span>
                    <span class="prompt-chip" data-prompt="Mute system sound">🔇 Mute PC</span>
                    <span class="prompt-chip" data-prompt="Open Notepad and write 'Connected via Anna Remote'">📝 Quick Note</span>
                </div>
            </section>

            <!-- ══════════════════════════════════════════════
                 LIVE EVENT & TELEMETRY TERMINAL LOG
            ══════════════════════════════════════════════ -->
            <section class="controls-card glass-card terminal-card">
                <div class="terminal-header">
                    <div class="terminal-title-area">
                        <span class="terminal-led"></span>
                        <span class="terminal-title">REAL-TIME EXECUTION LOG</span>
                        <span class="terminal-count" id="log-count-badge">0 events</span>
                    </div>

                    <div class="terminal-controls">
                        <!-- Filter Chips -->
                        <div class="filter-group">
                            <button class="filter-pill active" data-filter="all">All</button>
                            <button class="filter-pill" data-filter="sent">Commands</button>
                            <button class="filter-pill" data-filter="hardware">Hardware</button>
                            <button class="filter-pill" data-filter="error">Errors</button>
                        </div>
                        <button id="btn-copy-log" class="term-btn" title="Copy Log to Clipboard">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                        <button id="btn-clear-log" class="term-btn" title="Clear Log Output">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                </div>

                <div id="event-log" class="terminal-body font-mono">
                    <div class="log-entry system">[BOOT] Project Anna Remote deck initialized. Ready.</div>
                </div>
            </section>
        </main>

        <!-- ══════════════════════════════════════════════
             SLIDE-OUT SETTINGS & PREFERENCES DRAWER / MODAL
        ══════════════════════════════════════════════ -->
        <div id="settings-backdrop" class="modal-backdrop hidden"></div>
        <aside id="remote-config-card" class="settings-drawer hidden">
            <div class="drawer-header">
                <div class="drawer-title-group">
                    <span class="drawer-icon">⚙️</span>
                    <div>
                        <h2 class="drawer-title">SETTINGS & NETWORK</h2>
                        <span class="drawer-sub">Preferences & Connection Keys</span>
                    </div>
                </div>
                <button id="btn-close-config" class="drawer-close-btn" title="Close Settings">✕</button>
            </div>

            <div class="drawer-body">
                <!-- Section 1: Performance & Device Capability -->
                <div class="settings-group">
                    <div class="group-title">PERFORMANCE & GRAPHICS</div>

                    <!-- VRM 3D Avatar Toggle -->
                    <div class="setting-toggle-row">
                        <div class="setting-text">
                            <span class="setting-label">3D VRM Avatar</span>
                            <span class="setting-hint">Disable for low-end or older phones to achieve 60 FPS, save battery, and reduce RAM by 95%.</span>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="cfg-vrm-toggle" ${vrmActive ? 'checked' : ''}>
                            <span class="slider round"></span>
                        </label>
                    </div>

                    <!-- Reduced Motion / Glass Effects Toggle -->
                    <div class="setting-toggle-row">
                        <div class="setting-text">
                            <span class="setting-label">Glassmorphism Blur</span>
                            <span class="setting-hint">Toggle backdrop blur filters for maximum speed on legacy mobile browsers.</span>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="cfg-blur-toggle" checked>
                            <span class="slider round"></span>
                        </label>
                    </div>
                </div>

                <!-- Section 2: Relay & Hardware Credentials -->
                <div class="settings-group">
                    <div class="group-title">RELAY & HARDWARE CONNECTION</div>

                    <div class="config-field">
                        <label for="cfg-relay-url">Cloudflare Relay WebSocket URL</label>
                        <input type="text" id="cfg-relay-url" value="${config.relayUrl}" placeholder="wss://.../ws" class="font-mono" />
                    </div>

                    <div class="config-field">
                        <label for="cfg-auth-secret">Shared Secret Token (AUTH_SECRET)</label>
                        <div class="password-wrapper">
                            <input type="password" id="cfg-auth-secret" value="${config.authSecret}" placeholder="Secret token" class="font-mono" />
                            <button type="button" id="btn-toggle-secret" class="btn-eye" title="Show/Hide Token">👁️</button>
                        </div>
                    </div>

                    <div class="config-field">
                        <label for="cfg-target-mac">Target PC Ethernet MAC (for Wake-on-LAN)</label>
                        <input type="text" id="cfg-target-mac" value="${config.targetMac}" placeholder="e.g. 74:56:3C:63:A9:9A" class="font-mono" />
                    </div>
                </div>

                <div class="drawer-footer">
                    <button id="btn-save-config" class="btn-primary-action">
                        <span>Save & Reconnect Link</span>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </button>
                    <button id="btn-test-ping" class="btn-secondary-action">
                        <span>⚡ Test Relay Ping</span>
                    </button>
                </div>
            </div>
        </aside>

        <!-- Toast Notification Container -->
        <div id="remote-toast" class="toast-notification hidden"></div>
    `;

    document.body.appendChild(dashboard);
    injectRemoteStyles();
    bindUIEvents();
}

function injectRemoteStyles() {
    if (document.getElementById('remote-mode-styles')) return;

    const style = document.createElement('style');
    style.id = 'remote-mode-styles';
    style.textContent = `
        :root {
            --bg-deep: #070913;
            --bg-surface: rgba(13, 17, 30, 0.72);
            --bg-surface-solid: #0d1222;
            --card-border: rgba(255, 255, 255, 0.08);
            --card-border-glow: rgba(99, 102, 241, 0.35);
            
            --neon-indigo: #6366f1;
            --neon-cyan: #06b6d4;
            --neon-emerald: #10b981;
            --neon-rose: #f43f5e;
            --neon-amber: #f59e0b;
            --neon-purple: #a855f7;
            
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            
            --font-ui: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            --font-mono: 'JetBrains Mono', SFMono-Regular, Consolas, Menlo, monospace;
            --radius-sm: 8px;
            --radius-md: 14px;
            --radius-lg: 20px;
            --radius-full: 9999px;
            --blur-strength: 20px;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            -webkit-tap-highlight-color: transparent;
        }

        body {
            background-color: var(--bg-deep) !important;
            color: var(--text-primary);
            font-family: var(--font-ui);
            line-height: 1.5;
            min-height: 100vh;
            overflow-x: hidden;
            overflow-y: auto;
        }

        .font-mono {
            font-family: var(--font-mono) !important;
        }

        /* ── Ambient Background Glows ── */
        .ambient-glow {
            position: fixed;
            width: 450px;
            height: 450px;
            border-radius: 50%;
            filter: blur(120px);
            opacity: 0.18;
            pointer-events: none;
            z-index: 0;
        }

        .glow-1 {
            top: -100px;
            left: -100px;
            background: radial-gradient(circle, var(--neon-indigo), transparent 70%);
        }

        .glow-2 {
            top: 40%;
            right: -150px;
            background: radial-gradient(circle, var(--neon-cyan), transparent 70%);
        }

        .glow-3 {
            bottom: -100px;
            left: 20%;
            background: radial-gradient(circle, var(--neon-purple), transparent 70%);
        }

        /* ── Glassmorphism Card Base ── */
        .glass-card {
            background: var(--bg-surface);
            backdrop-filter: blur(var(--blur-strength));
            -webkit-backdrop-filter: blur(var(--blur-strength));
            border: 1px solid var(--card-border);
            border-radius: var(--radius-lg);
            box-shadow: 0 12px 36px -10px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.03);
            position: relative;
            z-index: 1;
            transition: border-color 0.25s ease, box-shadow 0.25s ease;
        }

        .glass-card:hover {
            border-color: rgba(255, 255, 255, 0.13);
        }

        #remote-dashboard {
            display: flex;
            flex-direction: column;
            min-height: 100vh;
            width: 100%;
            position: relative;
        }

        /* ── Header ── */
        .remote-header {
            position: sticky;
            top: 0;
            z-index: 90;
            background: rgba(7, 9, 19, 0.85);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border-bottom: 1px solid var(--card-border);
            padding: 12px 18px;
        }

        .header-inner {
            max-width: 680px;
            margin: 0 auto;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .remote-brand {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .brand-orb {
            position: relative;
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .orb-core {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--neon-indigo), var(--neon-cyan));
            box-shadow: 0 0 14px var(--neon-indigo);
            animation: pulse-orb 2.4s infinite ease-in-out;
        }

        .orb-ring {
            position: absolute;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            border: 1px dashed var(--neon-indigo);
            opacity: 0.6;
            animation: spin-slow 12s linear infinite;
        }

        .brand-text {
            display: flex;
            flex-direction: column;
        }

        .brand-name {
            font-size: 14px;
            font-weight: 800;
            letter-spacing: 1.5px;
            color: #fff;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .brand-sub {
            color: var(--neon-cyan);
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 1px;
            padding: 1px 5px;
            background: rgba(6, 182, 212, 0.12);
            border: 1px solid rgba(6, 182, 212, 0.3);
            border-radius: 4px;
        }

        .brand-role {
            font-size: 10px;
            font-weight: 600;
            color: var(--text-muted);
            letter-spacing: 1.2px;
        }

        .header-actions {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .telemetry-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 9px;
            border-radius: var(--radius-full);
            font-size: 10.5px;
            font-weight: 700;
            letter-spacing: 0.5px;
            border: 1px solid var(--card-border);
            background: rgba(255, 255, 255, 0.04);
            transition: all 0.25s ease;
        }

        .telemetry-pill .pulse-indicator {
            width: 7px;
            height: 7px;
            border-radius: 50%;
        }

        .telemetry-pill.offline {
            color: var(--text-secondary);
            border-color: rgba(244, 63, 94, 0.25);
            background: rgba(244, 63, 94, 0.06);
        }

        .telemetry-pill.offline .pulse-indicator {
            background: var(--neon-rose);
            box-shadow: 0 0 6px var(--neon-rose);
        }

        .telemetry-pill.online {
            color: #e2e8f0;
            border-color: rgba(16, 185, 129, 0.35);
            background: rgba(16, 185, 129, 0.08);
        }

        .telemetry-pill.online .pulse-indicator {
            background: var(--neon-emerald);
            box-shadow: 0 0 8px var(--neon-emerald);
            animation: pulse-dot 2s infinite;
        }

        /* VRM Quick Toggle in Header */
        .vrm-quick-toggle {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 10px;
            border-radius: var(--radius-full);
            font-size: 11px;
            font-weight: 600;
            background: rgba(99, 102, 241, 0.12);
            border: 1px solid rgba(99, 102, 241, 0.35);
            color: #e0e7ff;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .vrm-quick-toggle:hover {
            background: rgba(99, 102, 241, 0.25);
            border-color: var(--neon-indigo);
            transform: translateY(-1px);
        }

        .vrm-pill-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
        }

        .vrm-pill-dot.active {
            background: var(--neon-indigo);
            box-shadow: 0 0 8px var(--neon-indigo);
        }

        .vrm-pill-dot.lite {
            background: var(--neon-emerald);
            box-shadow: 0 0 8px var(--neon-emerald);
        }

        .icon-action-btn {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid var(--card-border);
            color: var(--text-secondary);
            width: 32px;
            height: 32px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .icon-action-btn:hover {
            background: rgba(255, 255, 255, 0.12);
            color: #fff;
            border-color: rgba(255, 255, 255, 0.2);
            transform: rotate(30deg);
        }

        /* ── Main Container ── */
        .remote-main-container {
            max-width: 680px;
            margin: 0 auto;
            width: 100%;
            padding: 16px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            z-index: 10;
        }

        /* ── Telemetry Quick Strip ── */
        .telemetry-strip {
            display: flex;
            align-items: center;
            justify-content: space-around;
            padding: 10px 14px;
            border-radius: var(--radius-md);
            font-size: 11px;
        }

        .telem-item {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .telem-label {
            font-size: 9px;
            font-weight: 700;
            color: var(--text-muted);
            letter-spacing: 0.8px;
        }

        .telem-value {
            font-weight: 600;
            color: #e2e8f0;
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .telem-separator {
            width: 1px;
            height: 20px;
            background: var(--card-border);
        }

        .mac-item {
            cursor: pointer;
            transition: opacity 0.2s;
        }

        .mac-item:hover {
            opacity: 0.8;
        }

        .mac-item code {
            color: var(--neon-cyan);
            font-size: 11px;
        }

        /* ── Companion Viewport Card ── */
        .companion-card {
            border-radius: var(--radius-lg);
            overflow: hidden;
            position: relative;
            background: radial-gradient(circle at 50% 25%, rgba(99, 102, 241, 0.18) 0%, rgba(13, 17, 30, 0.95) 75%, #070913 100%);
            border: 1px solid rgba(99, 102, 241, 0.25);
            box-shadow: 0 16px 40px -10px rgba(0, 0, 0, 0.75), 0 0 20px rgba(99, 102, 241, 0.12);
            min-height: 400px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }

        .companion-card.lite-mode-active {
            min-height: 340px;
            background: radial-gradient(circle at 50% 35%, rgba(6, 182, 212, 0.14) 0%, rgba(13, 17, 30, 0.95) 70%, #070913 100%);
            border-color: rgba(6, 182, 212, 0.25);
        }

        .companion-hud-top {
            position: absolute;
            top: 12px;
            left: 14px;
            right: 14px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            z-index: 20;
            pointer-events: auto;
        }

        .hud-status-chip {
            display: flex;
            align-items: center;
            gap: 6px;
            background: rgba(0, 0, 0, 0.65);
            backdrop-filter: blur(10px);
            border: 1px solid var(--card-border);
            padding: 4px 10px;
            border-radius: var(--radius-full);
            font-size: 11px;
            font-weight: 600;
            color: #e2e8f0;
        }

        .hud-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: var(--neon-emerald);
            box-shadow: 0 0 8px var(--neon-emerald);
        }

        .btn-ghost-sm {
            background: rgba(0, 0, 0, 0.55);
            backdrop-filter: blur(10px);
            border: 1px solid var(--card-border);
            color: var(--text-secondary);
            padding: 4px 10px;
            border-radius: var(--radius-full);
            font-size: 11px;
            font-weight: 500;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .btn-ghost-sm:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.1);
            border-color: rgba(255, 255, 255, 0.2);
        }

        /* 3D Canvas Mount */
        .avatar-canvas-wrapper {
            width: 100%;
            height: 380px;
            position: relative;
            overflow: hidden;
        }

        .avatar-canvas-wrapper #app {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            z-index: 10;
        }

        .avatar-canvas-wrapper #app canvas {
            width: 100% !important;
            height: 100% !important;
            display: block;
        }

        /* ── 2D Holographic AI Core (Lite Mode) ── */
        .hologram-lite-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 20px 24px;
            text-align: center;
            z-index: 15;
            min-height: 320px;
        }

        .holo-energy-field {
            position: relative;
            width: 160px;
            height: 160px;
            margin: 0 auto 16px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .holo-ring {
            position: absolute;
            border-radius: 50%;
            border: 1px solid transparent;
        }

        .outer-ring {
            width: 150px;
            height: 150px;
            border-top: 2px solid var(--neon-cyan);
            border-bottom: 2px solid var(--neon-cyan);
            border-left: 1px dashed rgba(6, 182, 212, 0.4);
            border-right: 1px dashed rgba(6, 182, 212, 0.4);
            animation: spin-clockwise 8s linear infinite;
        }

        .middle-ring {
            width: 110px;
            height: 110px;
            border-left: 2px solid var(--neon-indigo);
            border-right: 2px solid var(--neon-indigo);
            animation: spin-counter 6s linear infinite;
        }

        .inner-ring {
            width: 75px;
            height: 75px;
            border-top: 1px dotted var(--neon-purple);
            border-bottom: 1px dotted var(--neon-purple);
            animation: spin-clockwise 4s linear infinite;
        }

        .holo-orb {
            width: 44px;
            height: 44px;
            border-radius: 50%;
            background: radial-gradient(circle, #fff 0%, var(--neon-cyan) 40%, var(--neon-indigo) 100%);
            box-shadow: 0 0 24px var(--neon-cyan), 0 0 45px rgba(6, 182, 212, 0.5);
            position: relative;
            animation: pulse-holo-orb 3s ease-in-out infinite alternate;
        }

        .holo-spectrum {
            position: absolute;
            bottom: -8px;
            display: flex;
            align-items: flex-end;
            gap: 3px;
            height: 24px;
        }

        .spec-bar {
            width: 3px;
            border-radius: 2px;
            background: var(--neon-cyan);
            box-shadow: 0 0 6px var(--neon-cyan);
            animation: spec-bounce 1.2s infinite ease-in-out alternate;
        }

        .spec-bar.b1 { height: 35%; animation-delay: 0.1s; }
        .spec-bar.b2 { height: 75%; animation-delay: 0.3s; }
        .spec-bar.b3 { height: 50%; animation-delay: 0.2s; }
        .spec-bar.b4 { height: 95%; animation-delay: 0.4s; }
        .spec-bar.b5 { height: 60%; animation-delay: 0.15s; }
        .spec-bar.b6 { height: 80%; animation-delay: 0.35s; }
        .spec-bar.b7 { height: 45%; animation-delay: 0.25s; }
        .spec-bar.b8 { height: 30%; animation-delay: 0.05s; }

        .holo-details {
            max-width: 340px;
        }

        .holo-title {
            font-size: 15px;
            font-weight: 800;
            letter-spacing: 1.5px;
            color: #fff;
            margin-bottom: 4px;
        }

        .holo-subtitle {
            font-size: 12px;
            font-weight: 600;
            color: var(--neon-emerald);
            margin-bottom: 6px;
        }

        .holo-hint {
            font-size: 11px;
            color: var(--text-muted);
            margin-bottom: 14px;
            line-height: 1.4;
        }

        .btn-holo-enable {
            background: linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(6, 182, 212, 0.25));
            border: 1px solid var(--neon-indigo);
            color: #e0e7ff;
            padding: 8px 16px;
            border-radius: var(--radius-full);
            font-size: 12px;
            font-weight: 600;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .btn-holo-enable:hover {
            background: linear-gradient(135deg, var(--neon-indigo), var(--neon-cyan));
            color: #fff;
            box-shadow: 0 4px 18px rgba(99, 102, 241, 0.4);
            transform: translateY(-1px);
        }

        /* Bottom Action Bar */
        .companion-hud-bottom {
            padding: 10px 14px;
            background: rgba(7, 9, 19, 0.8);
            backdrop-filter: blur(12px);
            border-top: 1px solid var(--card-border);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            flex-wrap: wrap;
            z-index: 20;
        }

        .anim-btn {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid var(--card-border);
            color: #e2e8f0;
            padding: 6px 12px;
            border-radius: var(--radius-md);
            font-size: 11.5px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .anim-btn:hover {
            background: rgba(99, 102, 241, 0.2);
            border-color: var(--neon-indigo);
            color: #fff;
            transform: translateY(-1px);
        }

        .anim-btn:active {
            transform: scale(0.96);
        }

        .anim-btn.ghost {
            background: transparent;
            color: var(--text-muted);
            border-color: transparent;
        }

        .anim-btn.ghost:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.08);
            border-color: var(--card-border);
        }

        /* ── Controls Cards Generic Styling ── */
        .controls-card {
            padding: 18px;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .card-title-group {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .card-icon-badge {
            width: 32px;
            height: 32px;
            border-radius: var(--radius-md);
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .power-badge {
            background: rgba(6, 182, 212, 0.12);
            border: 1px solid rgba(6, 182, 212, 0.3);
            color: var(--neon-cyan);
        }

        .apps-badge {
            background: rgba(168, 85, 247, 0.12);
            border: 1px solid rgba(168, 85, 247, 0.3);
            color: var(--neon-purple);
        }

        .cmd-badge {
            background: rgba(99, 102, 241, 0.12);
            border: 1px solid rgba(99, 102, 241, 0.3);
            color: var(--neon-indigo);
        }

        .card-title {
            font-size: 13px;
            font-weight: 700;
            letter-spacing: 0.8px;
            color: #fff;
        }

        .card-desc {
            font-size: 11px;
            color: var(--text-muted);
        }

        /* ── Power Buttons Matrix ── */
        .power-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
        }

        .power-card-btn {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 14px;
            border-radius: var(--radius-md);
            border: 1px solid var(--card-border);
            background: rgba(255, 255, 255, 0.03);
            cursor: pointer;
            text-align: left;
            transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .power-card-btn:active {
            transform: scale(0.97);
        }

        .power-card-btn .btn-icon-wrapper {
            width: 38px;
            height: 38px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            transition: all 0.25s ease;
        }

        .power-card-btn .btn-content {
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .btn-label-title {
            font-size: 12.5px;
            font-weight: 700;
            letter-spacing: 0.5px;
            color: #fff;
        }

        .btn-label-sub {
            font-size: 10px;
            color: var(--text-muted);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* Wake Button (Cyan/Electric) */
        .btn-wake {
            border-color: rgba(6, 182, 212, 0.35);
            background: linear-gradient(135deg, rgba(6, 182, 212, 0.12), rgba(99, 102, 241, 0.08));
        }

        .btn-wake .btn-icon-wrapper {
            background: linear-gradient(135deg, var(--neon-cyan), var(--neon-indigo));
            color: #fff;
            box-shadow: 0 4px 14px rgba(6, 182, 212, 0.35);
        }

        .btn-wake:hover {
            border-color: var(--neon-cyan);
            box-shadow: 0 4px 20px rgba(6, 182, 212, 0.2);
            transform: translateY(-2px);
        }

        /* Sleep Button (Twilight Indigo) */
        .btn-sleep {
            border-color: rgba(99, 102, 241, 0.25);
            background: rgba(99, 102, 241, 0.06);
        }

        .btn-sleep .btn-icon-wrapper {
            background: rgba(99, 102, 241, 0.18);
            color: #a5b4fc;
            border: 1px solid rgba(99, 102, 241, 0.4);
        }

        .btn-sleep:hover {
            border-color: var(--neon-indigo);
            background: rgba(99, 102, 241, 0.12);
            transform: translateY(-2px);
        }

        /* Lock Button (Amber) */
        .btn-lock {
            border-color: rgba(245, 158, 11, 0.25);
            background: rgba(245, 158, 11, 0.06);
        }

        .btn-lock .btn-icon-wrapper {
            background: rgba(245, 158, 11, 0.18);
            color: #fbbf24;
            border: 1px solid rgba(245, 158, 11, 0.4);
        }

        .btn-lock:hover {
            border-color: var(--neon-amber);
            background: rgba(245, 158, 11, 0.12);
            transform: translateY(-2px);
        }

        /* Shutdown Button (Crimson Alert) */
        .btn-shutdown {
            border-color: rgba(244, 63, 94, 0.25);
            background: rgba(244, 63, 94, 0.06);
        }

        .btn-shutdown .btn-icon-wrapper {
            background: rgba(244, 63, 94, 0.18);
            color: #fda4af;
            border: 1px solid rgba(244, 63, 94, 0.4);
        }

        .btn-shutdown:hover {
            border-color: var(--neon-rose);
            background: rgba(244, 63, 94, 0.12);
            box-shadow: 0 4px 18px rgba(244, 63, 94, 0.2);
            transform: translateY(-2px);
        }

        /* ── Quick App Chips ── */
        .quick-apps-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 10px;
        }

        @media (max-width: 480px) {
            .quick-apps-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }

        .app-chip {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            border-radius: var(--radius-md);
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--card-border);
            cursor: pointer;
            transition: all 0.2s ease;
            text-align: left;
        }

        .app-chip:hover {
            background: rgba(255, 255, 255, 0.08);
            border-color: rgba(255, 255, 255, 0.2);
            transform: translateY(-2px);
        }

        .app-chip:active {
            transform: scale(0.95);
        }

        .app-icon {
            font-size: 16px;
        }

        .app-name {
            font-size: 12px;
            font-weight: 600;
            color: #e2e8f0;
        }

        /* ── Command Input ── */
        .cmd-form-wrapper {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }

        .cmd-input-container {
            display: flex;
            align-items: center;
            gap: 10px;
            background: rgba(0, 0, 0, 0.45);
            border: 1px solid var(--card-border);
            border-radius: var(--radius-md);
            padding: 6px 6px 6px 14px;
            transition: all 0.25s ease;
        }

        .cmd-input-container:focus-within {
            border-color: var(--neon-indigo);
            box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25), 0 4px 20px rgba(0, 0, 0, 0.5);
            background: rgba(0, 0, 0, 0.65);
        }

        .cmd-prompt-symbol {
            color: var(--neon-cyan);
            font-weight: 700;
            font-family: var(--font-mono);
            font-size: 14px;
        }

        .cmd-input {
            flex: 1;
            background: transparent;
            border: none;
            outline: none;
            color: #fff;
            font-size: 13px;
            font-family: inherit;
        }

        .cmd-input::placeholder {
            color: var(--text-muted);
            font-size: 12px;
        }

        .cmd-submit-btn {
            background: linear-gradient(135deg, var(--neon-indigo), #4f46e5);
            color: #fff;
            border: none;
            padding: 9px 16px;
            border-radius: 10px;
            font-size: 12px;
            font-weight: 700;
            letter-spacing: 0.5px;
            display: flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .cmd-submit-btn:hover {
            box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
            transform: translateY(-1px);
        }

        .cmd-submit-btn:active {
            transform: scale(0.96);
        }

        .prompt-suggestions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }

        .prompt-chip {
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid var(--card-border);
            color: var(--text-secondary);
            padding: 4px 10px;
            border-radius: var(--radius-full);
            font-size: 11px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .prompt-chip:hover {
            background: rgba(99, 102, 241, 0.15);
            border-color: rgba(99, 102, 241, 0.4);
            color: #e0e7ff;
            transform: translateY(-1px);
        }

        /* ── Terminal Card ── */
        .terminal-card {
            padding: 16px;
        }

        .terminal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 10px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--card-border);
        }

        .terminal-title-area {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .terminal-led {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--neon-emerald);
            box-shadow: 0 0 8px var(--neon-emerald);
        }

        .terminal-title {
            font-size: 11.5px;
            font-weight: 700;
            letter-spacing: 0.8px;
            color: #e2e8f0;
        }

        .terminal-count {
            font-size: 10px;
            color: var(--text-muted);
            padding: 2px 6px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 4px;
        }

        .terminal-controls {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .filter-group {
            display: flex;
            gap: 4px;
        }

        .filter-pill {
            background: transparent;
            border: 1px solid transparent;
            color: var(--text-muted);
            padding: 3px 8px;
            border-radius: 6px;
            font-size: 10.5px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .filter-pill.active {
            background: rgba(255, 255, 255, 0.08);
            border-color: var(--card-border);
            color: #fff;
        }

        .term-btn {
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid var(--card-border);
            color: var(--text-secondary);
            width: 28px;
            height: 28px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: all 0.2s;
        }

        .term-btn:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.1);
        }

        .terminal-body {
            margin-top: 10px;
            max-height: 180px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 6px;
            padding: 6px;
            background: rgba(0, 0, 0, 0.4);
            border-radius: var(--radius-sm);
        }

        .log-entry {
            font-size: 11px;
            line-height: 1.45;
            word-break: break-all;
            padding: 2px 4px;
            border-radius: 3px;
        }

        .log-entry.system { color: #38bdf8; }
        .log-entry.success { color: #34d399; }
        .log-entry.sent { color: #c084fc; }
        .log-entry.error { color: #f87171; background: rgba(248, 113, 113, 0.06); }
        .log-entry.hardware { color: #fbbf24; }

        /* ── Slide-Out Settings Drawer ── */
        .modal-backdrop {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.65);
            backdrop-filter: blur(8px);
            z-index: 150;
            transition: opacity 0.3s ease;
        }

        .modal-backdrop.hidden {
            opacity: 0;
            pointer-events: none;
        }

        .settings-drawer {
            position: fixed;
            top: 0;
            right: 0;
            bottom: 0;
            width: 100%;
            max-width: 440px;
            background: var(--bg-surface-solid);
            border-left: 1px solid var(--card-border);
            box-shadow: -10px 0 40px rgba(0, 0, 0, 0.8);
            z-index: 200;
            display: flex;
            flex-direction: column;
            transform: translateX(0);
            transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        }

        .settings-drawer.hidden {
            transform: translateX(100%);
            pointer-events: none;
        }

        .drawer-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 20px 24px;
            border-bottom: 1px solid var(--card-border);
        }

        .drawer-title-group {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .drawer-icon {
            font-size: 20px;
        }

        .drawer-title {
            font-size: 14px;
            font-weight: 800;
            letter-spacing: 1px;
            color: #fff;
        }

        .drawer-sub {
            font-size: 11px;
            color: var(--text-muted);
        }

        .drawer-close-btn {
            background: transparent;
            border: none;
            color: var(--text-muted);
            font-size: 18px;
            cursor: pointer;
            padding: 6px;
            border-radius: 6px;
            transition: all 0.2s;
        }

        .drawer-close-btn:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.1);
        }

        .drawer-body {
            padding: 24px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 24px;
            flex: 1;
        }

        .settings-group {
            display: flex;
            flex-direction: column;
            gap: 14px;
        }

        .group-title {
            font-size: 10.5px;
            font-weight: 800;
            letter-spacing: 1.2px;
            color: var(--neon-cyan);
        }

        .setting-toggle-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 12px;
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid var(--card-border);
            border-radius: var(--radius-md);
        }

        .setting-text {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .setting-label {
            font-size: 13px;
            font-weight: 600;
            color: #fff;
        }

        .setting-hint {
            font-size: 10.5px;
            color: var(--text-muted);
            line-height: 1.35;
        }

        /* Modern Toggle Switch */
        .switch {
            position: relative;
            display: inline-block;
            width: 44px;
            height: 24px;
            flex-shrink: 0;
        }

        .switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }

        .slider {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(255, 255, 255, 0.15);
            transition: .3s;
        }

        .slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: .3s;
        }

        input:checked + .slider {
            background-color: var(--neon-indigo);
            box-shadow: 0 0 10px rgba(99, 102, 241, 0.5);
        }

        input:checked + .slider:before {
            transform: translateX(20px);
        }

        .slider.round {
            border-radius: 34px;
        }

        .slider.round:before {
            border-radius: 50%;
        }

        .config-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .config-field label {
            font-size: 11px;
            font-weight: 600;
            color: var(--text-secondary);
        }

        .config-field input {
            padding: 10px 12px;
            border-radius: var(--radius-sm);
            background: rgba(0, 0, 0, 0.45);
            border: 1px solid var(--card-border);
            color: #fff;
            font-size: 12px;
            outline: none;
            transition: border-color 0.2s;
        }

        .config-field input:focus {
            border-color: var(--neon-indigo);
        }

        .password-wrapper {
            position: relative;
            display: flex;
            align-items: center;
        }

        .password-wrapper input {
            width: 100%;
            padding-right: 36px;
        }

        .btn-eye {
            position: absolute;
            right: 8px;
            background: transparent;
            border: none;
            cursor: pointer;
            font-size: 14px;
            opacity: 0.6;
            transition: opacity 0.2s;
        }

        .btn-eye:hover {
            opacity: 1;
        }

        .drawer-footer {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 10px;
        }

        .btn-primary-action {
            background: linear-gradient(135deg, var(--neon-indigo), #4f46e5);
            color: #fff;
            border: none;
            padding: 13px;
            border-radius: var(--radius-md);
            font-size: 13px;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .btn-primary-action:hover {
            box-shadow: 0 4px 18px rgba(99, 102, 241, 0.4);
            transform: translateY(-1px);
        }

        .btn-secondary-action {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid var(--card-border);
            color: var(--text-secondary);
            padding: 10px;
            border-radius: var(--radius-md);
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }

        .btn-secondary-action:hover {
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
        }

        /* Toast Notification */
        .toast-notification {
            position: fixed;
            bottom: 24px;
            left: 50%;
            transform: translateX(-50%) translateY(0);
            background: rgba(13, 18, 34, 0.95);
            backdrop-filter: blur(16px);
            border: 1px solid var(--neon-indigo);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.7);
            color: #fff;
            padding: 10px 18px;
            border-radius: var(--radius-full);
            font-size: 12px;
            font-weight: 600;
            z-index: 300;
            transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: none;
        }

        .toast-notification.hidden {
            opacity: 0;
            transform: translateX(-50%) translateY(20px);
        }

        /* Keyframe Animations */
        @keyframes pulse-orb {
            0%, 100% { transform: scale(1); opacity: 0.9; }
            50% { transform: scale(1.15); opacity: 1; }
        }

        @keyframes pulse-dot {
            0%, 100% { transform: scale(1); opacity: 0.8; }
            50% { transform: scale(1.3); opacity: 1; }
        }

        @keyframes spin-slow {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        @keyframes spin-clockwise {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        @keyframes spin-counter {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(-360deg); }
        }

        @keyframes pulse-holo-orb {
            0% { transform: scale(0.92); box-shadow: 0 0 18px var(--neon-cyan), 0 0 30px rgba(6, 182, 212, 0.3); }
            100% { transform: scale(1.08); box-shadow: 0 0 32px var(--neon-cyan), 0 0 60px rgba(6, 182, 212, 0.6); }
        }

        @keyframes spec-bounce {
            0% { transform: scaleY(0.3); }
            100% { transform: scaleY(1); }
        }
    `;

    document.head.appendChild(style);
}

function bindUIEvents() {
    // 0. Toggle Settings Drawer
    const configToggle = document.getElementById('btn-toggle-config');
    const closeDrawerBtn = document.getElementById('btn-close-config');
    const drawer = document.getElementById('remote-config-card');
    const backdrop = document.getElementById('settings-backdrop');

    function openSettings() {
        drawer?.classList.remove('hidden');
        backdrop?.classList.remove('hidden');
    }

    function closeSettings() {
        drawer?.classList.add('hidden');
        backdrop?.classList.add('hidden');
    }

    configToggle?.addEventListener('click', openSettings);
    closeDrawerBtn?.addEventListener('click', closeSettings);
    backdrop?.addEventListener('click', closeSettings);

    // 0.1 Toggle VRM Mode from Header button
    document.getElementById('header-vrm-toggle')?.addEventListener('click', () => {
        const nextState = !isVRMEnabled();
        setVRMEnabled(nextState);
        showToast(nextState ? "✨ 3D VRM Model Activated" : "🧊 Lite Mode Active (0% GPU)");
    });

    // 0.2 Toggle VRM Mode from Viewport Card Button
    document.getElementById('btn-card-vrm-toggle')?.addEventListener('click', () => {
        const nextState = !isVRMEnabled();
        setVRMEnabled(nextState);
        showToast(nextState ? "✨ 3D VRM Model Activated" : "🧊 Lite Mode Active (0% GPU)");
    });

    // 0.3 Toggle VRM from Hologram banner button
    document.getElementById('btn-enable-3d-from-holo')?.addEventListener('click', () => {
        setVRMEnabled(true);
        showToast("✨ 3D VRM Model Activated");
    });

    // 0.4 Toggle VRM from Settings Drawer switch
    document.getElementById('cfg-vrm-toggle')?.addEventListener('change', (e) => {
        setVRMEnabled(e.target.checked);
        showToast(e.target.checked ? "✨ 3D VRM Model Activated" : "🧊 Lite Mode Active (0% GPU)");
    });

    // 0.5 Toggle Backdrop Blur (for legacy phones)
    document.getElementById('cfg-blur-toggle')?.addEventListener('change', (e) => {
        document.documentElement.style.setProperty('--blur-strength', e.target.checked ? '20px' : '0px');
        showToast(e.target.checked ? "Glass blur enabled" : "Performance mode: Blur disabled");
    });

    // 0.6 Toggle password visibility
    const secretInput = document.getElementById('cfg-auth-secret');
    document.getElementById('btn-toggle-secret')?.addEventListener('click', () => {
        if (secretInput) {
            secretInput.type = secretInput.type === 'password' ? 'text' : 'password';
        }
    });

    // 0.7 Copy MAC Address
    document.getElementById('btn-copy-mac')?.addEventListener('click', () => {
        const cfg = getRemoteConfig();
        navigator.clipboard?.writeText(cfg.targetMac).then(() => {
            showToast("Copied MAC: " + cfg.targetMac);
        }).catch(() => {
            showToast("Target MAC: " + cfg.targetMac);
        });
    });

    // 0.8 Save Connection Settings
    document.getElementById('btn-save-config')?.addEventListener('click', () => {
        const url = document.getElementById('cfg-relay-url')?.value.trim();
        const secret = document.getElementById('cfg-auth-secret')?.value.trim();
        const mac = document.getElementById('cfg-target-mac')?.value.trim();

        if (url) localStorage.setItem('anna_relay_url', url);
        if (secret) localStorage.setItem('anna_auth_secret', secret);
        if (mac) {
            localStorage.setItem('anna_target_mac', mac);
            const displayMac = document.getElementById('display-mac');
            if (displayMac) displayMac.textContent = mac;
        }

        closeSettings();
        showToast("Configuration saved!");
        logEvent('Settings saved to localStorage. Reconnecting link...', 'success');
        connectToRelay();
    });

    // 0.9 Test Relay Ping
    document.getElementById('btn-test-ping')?.addEventListener('click', () => {
        pingStartTime = performance.now();
        sendPayload({ type: 'PING' });
        showToast("Testing ping to Cloudflare Worker...");
    });

    // 1. Wake PC via ESP8266 Wake-on-LAN Magic Packet
    document.getElementById('btn-power-on')?.addEventListener('click', () => {
        const cfg = getRemoteConfig();
        logEvent(`Triggering ESP8266 Wake-on-LAN packet to PC (${cfg.targetMac})...`, 'hardware');
        sendPayload({
            type: 'HARDWARE_CMD',
            action: 'WAKE_ON_LAN',
            mac: cfg.targetMac
        });
        showToast("⚡ WoL Magic Packet Dispatched");
    });

    // 2. Sleep PC
    document.getElementById('btn-sleep-pc')?.addEventListener('click', () => {
        logEvent('Dispatching PC sleep command...', 'sent');
        sendPayload({
            type: 'EXECUTE_TOOL',
            tool_name: 'sleep_pc',
            tool_args: {}
        });
        showToast("🌙 Sleep command sent");
    });

    // 3. Lock PC
    document.getElementById('btn-lock-pc')?.addEventListener('click', () => {
        logEvent('Dispatching Windows screen lock command...', 'sent');
        sendPayload({
            type: 'EXECUTE_TOOL',
            tool_name: 'access_computer_tool',
            tool_args: {
                goal: 'Lock workstation',
                app: 'rundll32.exe user32.dll,LockWorkStation',
                continue_to_agent: false
            }
        });
        showToast("🔒 Workstation locked");
    });

    // 4. Clean Shutdown PC with Confirmation
    document.getElementById('btn-force-off')?.addEventListener('click', () => {
        const confirmed = window.confirm("⚠️ SHUTDOWN CONFIRMATION:\nAre you sure you want to shut down your PC?");
        if (confirmed) {
            logEvent('Sending Windows system shutdown command...', 'sent');
            sendPayload({
                type: 'EXECUTE_TOOL',
                tool_name: 'shutdown_pc',
                tool_args: {}
            });
            showToast("🛑 Shutdown command sent");
        }
    });

    // 5. Quick Launch App Chips
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
            showToast(`Opening ${app.toUpperCase()}...`);
        });
    });

    // 6. Command Input Form
    const form = document.getElementById('remote-cmd-form');
    const input = document.getElementById('cmd-input');
    form?.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;

        logEvent(`Dispatching AI Goal: "${text}"`, 'sent');
        sendPayload({
            type: 'EXECUTE_TOOL',
            tool_name: 'access_computer_tool',
            tool_args: {
                goal: text,
                continue_to_agent: true
            }
        });

        showToast(`Dispatched: "${text}"`);
        input.value = '';
    });

    // 7. Prompt Suggestion Chips
    document.querySelectorAll('.prompt-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
            const promptText = chip.getAttribute('data-prompt');
            if (input) {
                input.value = promptText;
                input.focus();
            }
        });
    });

    // 8. Avatar Animation Trigger Buttons
    document.querySelectorAll('.anim-btn[data-anim]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const anim = btn.getAttribute('data-anim');
            if (isVRMActive()) {
                const ok = triggerAvatarAnimation(anim);
                if (ok) {
                    logEvent(`Avatar triggered gesture: ${anim}`, 'success');
                }
            } else {
                showToast(`Anna: "${anim.toUpperCase()}"!`);
                logEvent(`[AI Core] Mood signaled: ${anim}`, 'system');
            }
        });
    });

    // 9. Recenter Camera
    document.getElementById('btn-recenter-cam')?.addEventListener('click', () => {
        const avatarContainer = document.getElementById('avatar-container');
        if (avatarContainer && isVRMActive()) {
            setRemoteViewMode(avatarContainer);
            showToast("Camera recentered");
        }
    });

    // 10. Clear Log
    document.getElementById('btn-clear-log')?.addEventListener('click', () => {
        logs = [];
        renderLogs();
        showToast("Log cleared");
    });

    // 11. Copy Log
    document.getElementById('btn-copy-log')?.addEventListener('click', () => {
        const text = logs.map(l => `[${l.time}] [${l.type.toUpperCase()}] ${l.text}`).join('\n');
        navigator.clipboard?.writeText(text).then(() => {
            showToast("Logs copied to clipboard");
        });
    });

    // 12. Log Filter Buttons
    document.querySelectorAll('.filter-pill').forEach((pill) => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentFilter = pill.getAttribute('data-filter');
            renderLogs();
        });
    });
}

function connectToRelay() {
    if (socket) {
        try { socket.close(); } catch (e) {}
    }

    const config = getRemoteConfig();
    const wsUrl = `${config.relayUrl}?role=remote&token=${config.authSecret}`;
    logEvent(`Connecting to Cloudflare Worker Relay (${config.relayUrl})...`, 'system');

    const telemStatus = document.getElementById('telem-relay-status');
    if (telemStatus) {
        telemStatus.textContent = "CONNECTING…";
        telemStatus.className = "telem-value";
    }

    try {
        socket = new WebSocket(wsUrl);
    } catch (err) {
        logEvent(`WebSocket connection failure: ${err.message}`, 'error');
        return;
    }

    socket.onopen = () => {
        logEvent('Connected to Cloudflare Worker Relay as role=remote.', 'success');
        if (telemStatus) {
            telemStatus.textContent = "ONLINE (CF)";
            telemStatus.className = "telem-value text-accent";
        }
        
        // Setup keepalive ping
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                pingStartTime = performance.now();
                socket.send(JSON.stringify({ type: 'PING' }));
            }
        }, 20000);
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
        if (telemStatus) {
            telemStatus.textContent = "DISCONNECTED";
            telemStatus.className = "telem-value";
        }
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
            logEvent(`[Hardware] ${data.action || 'Action'} status: ${data.status}`, 'hardware');
            break;
        }

        case 'PONG': {
            if (pingStartTime > 0) {
                lastLatency = Math.round(performance.now() - pingStartTime);
                const telemLat = document.getElementById('telem-latency');
                if (telemLat) {
                    telemLat.textContent = `${lastLatency} ms`;
                }
            }
            break;
        }

        default:
            console.log('[RemoteClient] Received message:', data);
    }
}

function updateStatusBadges(pcOnline, hwOnline) {
    const pcBadge = document.getElementById('pc-status-badge');
    const hwBadge = document.getElementById('hw-status-badge');

    if (pcBadge) {
        pcBadge.className = `telemetry-pill ${pcOnline ? 'online' : 'offline'}`;
        pcBadge.querySelector('.pill-label').textContent = pcOnline ? 'PC: ONLINE' : 'PC: OFFLINE';
    }

    if (hwBadge) {
        hwBadge.className = `telemetry-pill ${hwOnline ? 'online' : 'offline'}`;
        hwBadge.querySelector('.pill-label').textContent = hwOnline ? 'ESP: ONLINE' : 'ESP: OFFLINE';
    }
}

function sendPayload(payload) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        logEvent('Error: Relay connection is offline. Message dropped.', 'error');
        showToast('Error: Relay is offline');
        return;
    }
    socket.send(JSON.stringify(payload));
}

function logEvent(text, type = 'system') {
    const entry = {
        id: Date.now() + Math.random(),
        time: new Date().toLocaleTimeString(),
        text,
        type
    };

    logs.push(entry);
    if (logs.length > 200) logs.shift();

    renderLogs();
}

function renderLogs() {
    const logBox = document.getElementById('event-log');
    const countBadge = document.getElementById('log-count-badge');
    if (!logBox) return;

    const filtered = currentFilter === 'all' 
        ? logs 
        : logs.filter(l => l.type === currentFilter);

    if (countBadge) {
        countBadge.textContent = `${filtered.length} events`;
    }

    logBox.innerHTML = '';
    filtered.forEach(item => {
        const div = document.createElement('div');
        div.className = `log-entry ${item.type}`;
        div.textContent = `[${item.time}] ${item.text}`;
        logBox.appendChild(div);
    });

    logBox.scrollTop = logBox.scrollHeight;
}

let toastTimer = null;
function showToast(message) {
    const toast = document.getElementById('remote-toast');
    if (!toast) return;

    toast.textContent = message;
    toast.classList.remove('hidden');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.add('hidden');
    }, 2800);
}
