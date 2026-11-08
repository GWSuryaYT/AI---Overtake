/**
 * AI Overtake - Popup Logic
 * Controls connection settings, manual test scan, and visual worker border test.
 */

document.addEventListener("DOMContentLoaded", () => {
  const wsUrlInput = document.getElementById("wsUrlInput");
  const saveReconnectBtn = document.getElementById("saveReconnectBtn");
  const testScanBtn = document.getElementById("testScanBtn");
  const toggleGlowBtn = document.getElementById("toggleGlowBtn");
  const statusPill = document.getElementById("statusPill");
  const statusLabel = document.getElementById("statusLabel");
  const elementsBadge = document.getElementById("elementsBadge");
  const outputConsole = document.getElementById("outputConsole");

  let isGlowActive = false;

  // 1. Fetch current status and settings
  chrome.storage.local.get(["wsUrl"], (res) => {
    wsUrlInput.value = res.wsUrl || "ws://127.0.0.1:8765";
  });

  chrome.runtime.sendMessage({ type: "GET_BRIDGE_STATUS" }, (response) => {
    if (response) {
      updateStatusBadge(response.state);
      if (response.wsUrl) {
        wsUrlInput.value = response.wsUrl;
      }
    }
  });

  // Listen for state changes from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "CONNECTION_STATE_CHANGED") {
      updateStatusBadge(message.state);
    }
  });

  function updateStatusBadge(state) {
    statusPill.className = "status-badge";
    if (state === "CONNECTED") {
      statusPill.classList.add("connected");
      statusLabel.textContent = "CONNECTED";
    } else if (state === "CONNECTING") {
      statusPill.classList.add("connecting");
      statusLabel.textContent = "CONNECTING";
    } else {
      statusPill.classList.add("disconnected");
      statusLabel.textContent = "OFFLINE";
    }
  }

  // 2. Save WebSocket URL & Trigger Reconnect
  saveReconnectBtn.addEventListener("click", () => {
    const newUrl = wsUrlInput.value.trim();
    if (!newUrl) return;

    chrome.storage.local.set({ wsUrl: newUrl }, () => {
      saveReconnectBtn.textContent = "Connecting...";
      chrome.runtime.sendMessage({ type: "MANUAL_RECONNECT" }, () => {
        setTimeout(() => {
          saveReconnectBtn.textContent = "Connect";
        }, 1000);
      });
    });
  });

  // 3. Test Viewport Scan
  testScanBtn.addEventListener("click", () => {
    testScanBtn.disabled = true;
    testScanBtn.textContent = "Scanning...";
    outputConsole.innerHTML = '<div class="console-placeholder">Analyzing DOM and viewport geometry...</div>';

    chrome.runtime.sendMessage({ type: "TEST_SCAN" }, (response) => {
      testScanBtn.disabled = false;
      testScanBtn.innerHTML = '<span class="btn-icon">🔍</span><span>Scan Active Tab</span>';

      if (!response || response.status === "error") {
        outputConsole.innerHTML = `<div style="color: #f87171;">Scan Failed: ${response ? response.error : "No response"}</div>`;
        elementsBadge.textContent = "0 Elements";
        return;
      }

      const scan = response.scan || {};
      const elements = scan.elements || [];
      elementsBadge.textContent = `${elements.length} Elements`;

      if (elements.length === 0) {
        outputConsole.innerHTML = '<div class="console-placeholder">No interactive elements detected in current viewport.</div>';
        return;
      }

      let html = "";
      for (const el of elements) {
        const coords = el.coords || {};
        html += `
          <div class="element-row">
            <div class="el-header">
              <span class="el-id">#${el.id}</span>
              <span class="el-type">${el.type}</span>
              <span class="el-label" title="${escapeHtml(el.label || "")}">${escapeHtml(el.label || "No text")}</span>
            </div>
            <div class="el-coords">
              Screen Center: [${coords.center_x}, ${coords.center_y}] | Value: "${escapeHtml(el.value || "null")}"
            </div>
          </div>
        `;
      }
      outputConsole.innerHTML = html;
    });
  });

  // 4. Toggle Worker Blue Gradient Glow Border
  toggleGlowBtn.addEventListener("click", () => {
    isGlowActive = !isGlowActive;
    toggleGlowBtn.classList.toggle("btn-secondary", isGlowActive);
    toggleGlowBtn.classList.toggle("btn-gradient", !isGlowActive);

    chrome.runtime.sendMessage({
      type: "TOGGLE_WORKER_GLOW",
      is_working: isGlowActive,
      message: isGlowActive ? "AI Worker Active (Manual Test)" : "Idle"
    });
  });

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});

