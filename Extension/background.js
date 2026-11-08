/**
 * AI Overtake - Chrome Extension Background Service Worker
 * Manages persistent WebSocket connection to Python agent (computer_worker / web_layer_perser),
 * implements keep-alive loop, and routes JSON-RPC actions to tabs and content scripts.
 */

const DEFAULT_WS_URL = "ws://127.0.0.1:8765";
const RECONNECT_INTERVAL_MS = 2500;
const HEARTBEAT_INTERVAL_MS = 15000;

let socket = null;
let isConnecting = false;
let heartbeatTimer = null;
let currentWsUrl = DEFAULT_WS_URL;
let connectionState = "DISCONNECTED"; // "CONNECTED" | "CONNECTING" | "DISCONNECTED"
let lastActiveTabId = null;

// Initialize stored URL or set default
chrome.storage.local.get(["wsUrl"], (res) => {
  if (res.wsUrl) {
    currentWsUrl = res.wsUrl;
  }
  connectWebSocket();
});

// Watch for setting updates from popup
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.wsUrl) {
    currentWsUrl = changes.wsUrl.newValue;
    console.log(`[Bridge Background] WS URL updated to: ${currentWsUrl}`);
    reconnectWebSocket();
  }
});

/**
 * Connect to Python local WebSocket server
 */
function connectWebSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  isConnecting = true;
  setConnectionState("CONNECTING");
  console.log(`[Bridge Background] Connecting to Python server at ${currentWsUrl}...`);

  try {
    socket = new WebSocket(currentWsUrl);
  } catch (err) {
    console.warn("[Bridge Background] WebSocket instantiation error:", err);
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    isConnecting = false;
    setConnectionState("CONNECTED");
    console.log("[Bridge Background] WebSocket connected to Python agent!");
    
    // Broadcast initial ready frame
    sendToPython({
      type: "EVENT",
      event: "CLIENT_READY",
      timestamp: Date.now(),
      agent: "AI-Overtake-Chrome-Bridge-v1.0"
    });

    startHeartbeat();
  };

  socket.onmessage = async (event) => {
    try {
      const message = JSON.parse(event.data);
      console.log("[Bridge Background] Received message from Python:", message);
      await handleIncomingPythonMessage(message);
    } catch (err) {
      console.error("[Bridge Background] Failed to parse message from Python:", event.data, err);
      sendToPython({
        status: "error",
        error: "INVALID_JSON",
        details: err.message
      });
    }
  };

  socket.onclose = (event) => {
    isConnecting = false;
    setConnectionState("DISCONNECTED");
    stopHeartbeat();
    console.warn(`[Bridge Background] WebSocket closed (code: ${event.code}, reason: ${event.reason || "none"}). Reconnecting...`);
    scheduleReconnect();
  };

  socket.onerror = (err) => {
    console.warn("[Bridge Background] WebSocket error occurred:", err);
    // onclose will be triggered automatically
  };
}

/**
 * Schedule reconnect with backoff
 */
let reconnectTimeout = null;
function scheduleReconnect() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  reconnectTimeout = setTimeout(() => {
    connectWebSocket();
  }, RECONNECT_INTERVAL_MS);
}

function reconnectWebSocket() {
  if (socket) {
    try {
      socket.close();
    } catch (e) {}
    socket = null;
  }
  connectWebSocket();
}

/**
 * Update connection state badge & notify extension views
 */
function setConnectionState(state) {
  connectionState = state;
  const badgeConfig = {
    CONNECTED: { text: "ON", color: "#10B981" },     // Emerald green
    CONNECTING: { text: "...", color: "#F59E0B" },    // Amber
    DISCONNECTED: { text: "OFF", color: "#EF4444" }  // Red
  };
  const config = badgeConfig[state] || { text: "", color: "#6B7280" };

  chrome.action.setBadgeText({ text: config.text });
  chrome.action.setBadgeBackgroundColor({ color: config.color });

  // Inform popup if active
  chrome.runtime.sendMessage({
    type: "CONNECTION_STATE_CHANGED",
    state: connectionState,
    wsUrl: currentWsUrl
  }).catch(() => {
    // Popup might be closed, harmless
  });
}

/**
 * Keep-alive heartbeat loop
 * Prevents MV3 service worker from idling during agent tasks
 */
function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    // 1. Send WebSocket ping frame to Python
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ action: "PING", timestamp: Date.now() }));
    }
    // 2. Query lightweight Chrome API to keep worker thread active
    chrome.runtime.getPlatformInfo(() => {
      /* keeps worker alive */
    });
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

/**
 * Send JSON message to Python
 */
function sendToPython(data) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(data));
    return true;
  }
  console.warn("[Bridge Background] Cannot send message, WebSocket not open:", data);
  return false;
}

/**
 * Helper: Find currently active tab
 */
async function getActiveTab() {
  try {
    let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tabs || tabs.length === 0) {
      tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    }
    if (!tabs || tabs.length === 0) {
      tabs = await chrome.tabs.query({ active: true });
    }
    return tabs && tabs.length > 0 ? tabs[0] : null;
  } catch (err) {
    console.error("[Bridge Background] Error fetching active tab:", err);
    return null;
  }
}

/**
 * Ensure content script is injected into tab
 */
async function ensureContentScriptInjected(tabId) {
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { action: "PING_CONTENT" });
    if (ping && ping.status === "pong") {
      return true;
    }
  } catch (e) {
    // Script not present, dynamically inject
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["content.css"]
      });
      // Small pause to allow initialization
      await new Promise((r) => setTimeout(r, 100));
      return true;
    } catch (injectErr) {
      console.warn(`[Bridge Background] Could not inject into tab ${tabId}:`, injectErr);
      return false;
    }
  }
  return true;
}

/**
 * Handle incoming Python JSON RPC commands
 */
async function handleIncomingPythonMessage(message) {
  const action = message.action;
  const requestId = message.requestId || message.id || null;

  switch (action) {
    case "PING": {
      sendToPython({
        action: "PONG",
        requestId,
        timestamp: Date.now()
      });
      break;
    }

    case "GET_TABS": {
      try {
        const allTabs = await chrome.tabs.query({});
        const tabList = allTabs.map((t) => ({
          id: t.id,
          windowId: t.windowId,
          title: t.title,
          url: t.url,
          active: t.active,
          favIconUrl: t.favIconUrl || ""
        }));
        sendToPython({
          action: "GET_TABS",
          requestId,
          status: "success",
          tabs: tabList
        });
      } catch (err) {
        sendToPython({
          action: "GET_TABS",
          requestId,
          status: "error",
          error: err.message
        });
      }
      break;
    }

    case "SWITCH_TAB": {
      const tabId = message.tabId || message.tab_id;
      if (!tabId) {
        sendToPython({
          action: "SWITCH_TAB",
          requestId,
          status: "error",
          error: "Missing 'tabId' argument."
        });
        return;
      }

      try {
        const updatedTab = await chrome.tabs.update(tabId, { active: true });
        if (updatedTab.windowId) {
          await chrome.windows.update(updatedTab.windowId, { focused: true });
        }
        sendToPython({
          action: "SWITCH_TAB",
          requestId,
          status: "success",
          tabId: updatedTab.id,
          title: updatedTab.title,
          url: updatedTab.url
        });
      } catch (err) {
        sendToPython({
          action: "SWITCH_TAB",
          requestId,
          status: "error",
          error: err.message
        });
      }
      break;
    }

    case "NAVIGATE": {
      const url = message.url;
      let tabId = message.tabId || message.tab_id;

      if (!url) {
        sendToPython({
          action: "NAVIGATE",
          requestId,
          status: "error",
          error: "Missing 'url' argument."
        });
        return;
      }

      try {
        if (!tabId) {
          const activeTab = await getActiveTab();
          tabId = activeTab ? activeTab.id : null;
        }

        let updatedTab;
        if (tabId) {
          updatedTab = await chrome.tabs.update(tabId, { url });
        } else {
          updatedTab = await chrome.tabs.create({ url });
        }

        sendToPython({
          action: "NAVIGATE",
          requestId,
          status: "success",
          tabId: updatedTab.id,
          url: updatedTab.url
        });
      } catch (err) {
        sendToPython({
          action: "NAVIGATE",
          requestId,
          status: "error",
          error: err.message
        });
      }
      break;
    }

    case "SCAN_VIEWPORT": {
      try {
        const allTabs = await chrome.tabs.query({});
        const activeTab = await getActiveTab();

        if (!activeTab || !activeTab.id) {
          sendToPython({
            action: "SCAN_VIEWPORT",
            requestId,
            status: "error",
            error: "No active Chrome tab found in focused window."
          });
          return;
        }

        lastActiveTabId = activeTab.id;

        // Ensure content script is ready
        await ensureContentScriptInjected(activeTab.id);

        // Tell content script to scan viewport elements
        const scanResult = await chrome.tabs.sendMessage(activeTab.id, {
          action: "SCAN_VIEWPORT",
          options: message.options || {}
        });

        // Simplified tab summary
        const tabsSummary = allTabs.map((t) => ({
          id: t.id,
          title: t.title,
          url: t.url,
          active: t.id === activeTab.id
        }));

        sendToPython({
          action: "SCAN_VIEWPORT",
          requestId,
          status: "success",
          timestamp: Date.now(),
          active_tab: {
            id: activeTab.id,
            title: activeTab.title,
            url: activeTab.url,
            windowId: activeTab.windowId
          },
          tabs: tabsSummary,
          viewport: scanResult ? scanResult.viewport : {},
          window_metrics: scanResult ? scanResult.window_metrics : {},
          elements_count: scanResult && scanResult.elements ? scanResult.elements.length : 0,
          elements: scanResult ? scanResult.elements : []
        });
      } catch (err) {
        console.error("[Bridge Background] SCAN_VIEWPORT error:", err);
        sendToPython({
          action: "SCAN_VIEWPORT",
          requestId,
          status: "error",
          error: err.message
        });
      }
      break;
    }

    case "CLICK_ELEMENT":
    case "FILL_ELEMENT":
    case "SCROLL":
    case "HIGHLIGHT_ELEMENT":
    case "SET_WORKER_STATUS": {
      try {
        let tabId = message.tabId || message.tab_id || lastActiveTabId;
        if (!tabId) {
          const activeTab = await getActiveTab();
          tabId = activeTab ? activeTab.id : null;
        }

        if (!tabId) {
          sendToPython({
            action,
            requestId,
            status: "error",
            error: "No target tab found."
          });
          return;
        }

        await ensureContentScriptInjected(tabId);
        const result = await chrome.tabs.sendMessage(tabId, message);
        sendToPython({
          action,
          requestId,
          status: "success",
          ...result
        });
      } catch (err) {
        sendToPython({
          action,
          requestId,
          status: "error",
          error: err.message
        });
      }
      break;
    }

    default: {
      console.warn(`[Bridge Background] Unknown action received: ${action}`);
      sendToPython({
        action,
        requestId,
        status: "error",
        error: `Unknown action '${action}'`
      });
      break;
    }
  }
}

/**
 * Handle messages from extension popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_BRIDGE_STATUS") {
    sendResponse({
      state: connectionState,
      wsUrl: currentWsUrl,
      lastActiveTabId
    });
    return true;
  }

  if (request.type === "TEST_SCAN") {
    (async () => {
      try {
        const activeTab = await getActiveTab();
        if (!activeTab) {
          sendResponse({ status: "error", error: "No active tab" });
          return;
        }
        await ensureContentScriptInjected(activeTab.id);
        const scan = await chrome.tabs.sendMessage(activeTab.id, { action: "SCAN_VIEWPORT" });
        sendResponse({ status: "success", activeTab, scan });
      } catch (err) {
        sendResponse({ status: "error", error: err.message });
      }
    })();
    return true; // Keep message channel open for async response
  }

  if (request.type === "TOGGLE_WORKER_GLOW") {
    (async () => {
      try {
        const activeTab = await getActiveTab();
        if (activeTab) {
          await ensureContentScriptInjected(activeTab.id);
          await chrome.tabs.sendMessage(activeTab.id, {
            action: "SET_WORKER_STATUS",
            is_working: request.is_working,
            message: request.message || "AI Worker Active"
          });
          sendResponse({ status: "success" });
        }
      } catch (err) {
        sendResponse({ status: "error", error: err.message });
      }
    })();
    return true;
  }

  if (request.type === "MANUAL_RECONNECT") {
    reconnectWebSocket();
    sendResponse({ status: "reconnecting" });
    return true;
  }
});

