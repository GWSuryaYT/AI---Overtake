/**
 * AI Overtake - Chrome Extension Content Script (v2.0 Enhanced Parser)
 * 1. Comprehensive DOM scanner: captures all standard HTML controls, ARIA roles,
 *    and modern framework custom clickables (cursor:pointer, jsaction, svg icon buttons).
 * 2. Smart hierarchy deduplication: targets the root actionable component.
 * 3. Translates bounding boxes into absolute OS screen coordinates for PyAutoGUI.
 * 4. Dispatches DOM-level actions (click, fill, scroll).
 * 5. Animated neon blue gradient border strictly hugging viewport edges when worker is active.
 */

(() => {
  // Prevent duplicate script execution
  if (window.__aiOvertakeInitialized) return;
  window.__aiOvertakeInitialized = true;

  // In-memory cache for fast element resolution by sequential ID
  const elementRegistry = new Map();
  let overlayElement = null;
  let statusTextElement = null;

  /**
   * Inject or retrieve the worker gradient overlay
   */
  function getOrCreateOverlay() {
    if (overlayElement && document.contains(overlayElement)) {
      return overlayElement;
    }

    const overlay = document.createElement("div");
    overlay.id = "ai-overtake-worker-overlay";
    overlay.innerHTML = `
      <div class="ai-border-beam"></div>
      <div class="ai-status-pill">
        <span class="ai-status-dot"></span>
        <span class="ai-status-text">AI Agent Active</span>
      </div>
    `;

    document.documentElement.appendChild(overlay);
    overlayElement = overlay;
    statusTextElement = overlay.querySelector(".ai-status-text");
    return overlay;
  }

  /**
   * Activate or deactivate the blue gradient worker border
   */
  function setWorkerStatus(isActive, message = "AI Agent Working...") {
    const overlay = getOrCreateOverlay();
    if (statusTextElement && message) {
      statusTextElement.textContent = message;
    }

    if (isActive) {
      overlay.classList.add("active");
    } else {
      overlay.classList.remove("active");
    }
  }

  /**
   * Temporary click ripple effect
   */
  function showClickEffect(x, y) {
    const ripple = document.createElement("div");
    ripple.className = "ai-overtake-click-ripple";
    ripple.style.left = `${x + window.scrollX}px`;
    ripple.style.top = `${y + window.scrollY}px`;
    document.body.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  }

  /**
   * Temporary highlight border on element
   */
  function highlightElement(el, id = null, durationMs = 2000) {
    if (!el || !document.contains(el)) return;
    const rect = el.getBoundingClientRect();
    const hl = document.createElement("div");
    hl.className = "ai-overtake-highlight";
    hl.style.left = `${rect.left + window.scrollX}px`;
    hl.style.top = `${rect.top + window.scrollY}px`;
    hl.style.width = `${rect.width}px`;
    hl.style.height = `${rect.height}px`;

    if (id !== null) {
      const badge = document.createElement("span");
      badge.className = "ai-overtake-highlight-badge";
      badge.textContent = `#${id}`;
      hl.appendChild(badge);
    }

    document.body.appendChild(hl);
    setTimeout(() => {
      hl.style.opacity = "0";
      setTimeout(() => hl.remove(), 250);
    }, durationMs);
  }

  /**
   * Extract human-readable label for any interactive element
   */
  function getElementLabel(el) {
    // 1. Explicit ARIA label
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    // 2. ARIA labelledby reference
    const ariaLabelledBy = el.getAttribute("aria-labelledby");
    if (ariaLabelledBy) {
      const ids = ariaLabelledBy.split(/\s+/);
      const parts = ids
        .map((id) => {
          const node = document.getElementById(id);
          return node ? node.textContent.trim() : "";
        })
        .filter(Boolean);
      if (parts.length > 0) return parts.join(" ");
    }

    // 3. Form input associated <label>
    if (el.id) {
      const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (labelEl && labelEl.textContent.trim()) {
        return labelEl.textContent.trim();
      }
    }
    const parentLabel = el.closest("label");
    if (parentLabel && parentLabel.textContent.trim()) {
      return parentLabel.textContent.trim();
    }

    // 4. Placeholder
    const placeholder = el.getAttribute("placeholder") || el.getAttribute("aria-placeholder");
    if (placeholder && placeholder.trim()) return placeholder.trim();

    // 5. Title / Alt / Tooltip
    const title = el.getAttribute("title") || el.getAttribute("data-tooltip");
    if (title && title.trim()) return title.trim();

    const alt = el.getAttribute("alt");
    if (alt && alt.trim()) return alt.trim();

    // 6. SVG <title> element inside
    if (el.tagName === "svg" || el.querySelector("svg")) {
      const svgTitle = el.querySelector("title");
      if (svgTitle && svgTitle.textContent.trim()) {
        return svgTitle.textContent.trim();
      }
    }

    // 7. Value for buttons or inputs
    if (el.tagName === "INPUT" && ["button", "submit", "reset"].includes(el.type)) {
      if (el.value && el.value.trim()) return el.value.trim();
    }

    // 8. Direct visible text content (clean single-line)
    const text = el.innerText || el.textContent || "";
    const cleanText = text.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
    if (cleanText) {
      return cleanText.length > 80 ? cleanText.substring(0, 77) + "..." : cleanText;
    }

    // 9. Nearby text for checkboxes/radios (sibling label or span)
    if (el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio")) {
      const sibling = el.nextElementSibling || el.previousElementSibling;
      if (sibling && sibling.textContent.trim()) {
        return sibling.textContent.trim();
      }
    }

    // 10. Fallback to name or role
    if (el.getAttribute("name")) return `[name="${el.getAttribute("name")}"]`;
    if (el.getAttribute("role")) return `[role="${el.getAttribute("role")}"]`;
    if (el.id) return `#${el.id}`;

    return "";
  }

  /**
   * Get current input / selection value
   */
  function getElementValue(el) {
    if (el.tagName === "INPUT") {
      if (el.type === "checkbox" || el.type === "radio") {
        return el.checked ? "checked" : "unchecked";
      }
      return el.value || "";
    }
    if (el.tagName === "TEXTAREA") {
      return el.value || "";
    }
    if (el.tagName === "SELECT") {
      const selected = el.options[el.selectedIndex];
      return selected ? selected.text : "";
    }
    if (el.isContentEditable) {
      return el.innerText.trim();
    }
    const ariaChecked = el.getAttribute("aria-checked");
    if (ariaChecked !== null) {
      return ariaChecked === "true" ? "checked" : "unchecked";
    }
    return null;
  }

  /**
   * Determine control classification compatible with computer_worker short types
   */
  function getControlType(el) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute("role") || "").toLowerCase();

    if (role === "button" || tag === "button") return "Button";
    if (role === "link" || tag === "a") return "Link";
    if (role === "checkbox" || (tag === "input" && el.type === "checkbox")) return "Check";
    if (role === "radio" || (tag === "input" && el.type === "radio")) return "Radio";
    if (role === "combobox" || tag === "select") return "Combo";
    if (role === "menuitem" || role === "menuitemcheckbox" || role === "menuitemradio") return "Menu";
    if (role === "tab") return "Tab";
    if (role === "treeitem") return "Tree";
    if (role === "option" || role === "listitem") return "ListItem";

    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset"].includes(type)) return "Button";
      return "Edit";
    }
    if (tag === "textarea" || el.isContentEditable || role === "textbox" || role === "searchbox") {
      return "Edit";
    }

    if (tag === "summary") return "Button";

    // Custom clickable element with pointer cursor or click handlers
    return "Btn";
  }

  /**
   * Check if element is truly visible and within the viewport
   */
  function isElementVisibleInViewport(el) {
    if (!el.isConnected) return false;
    if (el.disabled) return false;

    // Fast style check
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      parseFloat(style.opacity) <= 0.02 ||
      el.getAttribute("aria-hidden") === "true"
    ) {
      return false;
    }

    // Geometry check
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;

    // Viewport containment check
    const inViewport =
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth;

    if (!inViewport) return false;

    // Occlusion check: ensure not obscured by another completely unrelated layer (like a modal backdrop)
    const cx = Math.min(Math.max(rect.left + rect.width / 2, 2), window.innerWidth - 2);
    const cy = Math.min(Math.max(rect.top + rect.height / 2, 2), window.innerHeight - 2);

    const hit = document.elementFromPoint(cx, cy);
    if (hit) {
      // Element is visible if hit is el, an ancestor of el, a child of el, or shares an immediate common parent
      const isRelated = hit === el || el.contains(hit) || hit.contains(el);
      if (!isRelated) {
        // Also check corners in case center is covered by a badge or icon
        const testPoints = [
          [rect.left + 5, rect.top + 5],
          [rect.right - 5, rect.top + 5],
          [rect.left + 5, rect.bottom - 5],
          [rect.right - 5, rect.bottom - 5]
        ];
        let cornerHit = false;
        for (const [px, py] of testPoints) {
          if (px > 0 && px < window.innerWidth && py > 0 && py < window.innerHeight) {
            const h = document.elementFromPoint(px, py);
            if (h && (h === el || el.contains(h) || h.contains(el))) {
              cornerHit = true;
              break;
            }
          }
        }
        if (!cornerHit) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check if an element is interactive by tag, ARIA role, attributes, or style
   */
  function isInteractiveElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;

    const tag = el.tagName.toLowerCase();

    // 1. Direct standard interactive tags
    if (["button", "select", "textarea", "summary"].includes(tag)) return true;
    if (tag === "a" && (el.hasAttribute("href") || el.hasAttribute("role"))) return true;
    if (tag === "input" && el.type !== "hidden") return true;

    // 2. Interactive ARIA roles
    const role = (el.getAttribute("role") || "").toLowerCase();
    const interactiveRoles = new Set([
      "button", "link", "checkbox", "radio", "switch", "tab",
      "menuitem", "menuitemcheckbox", "menuitemradio",
      "combobox", "searchbox", "textbox", "option", "treeitem",
      "gridcell", "slider", "spinbutton"
    ]);
    if (interactiveRoles.has(role)) return true;

    // 3. Explicit interactive attributes
    if (el.isContentEditable) return true;
    if (el.hasAttribute("onclick") || el.hasAttribute("onmousedown") || el.hasAttribute("onmouseup")) return true;
    if (el.hasAttribute("jsaction") || el.hasAttribute("data-action")) return true;
    if (el.hasAttribute("aria-haspopup") || el.hasAttribute("aria-expanded") || el.hasAttribute("aria-pressed")) return true;

    // 4. Tabindex indicating keyboard interactivity
    const tabIndex = el.getAttribute("tabindex");
    if (tabIndex !== null && parseInt(tabIndex, 10) >= 0) return true;

    // 5. Computed cursor: pointer (detects custom React/Vue/Tailwind button divs/spans)
    try {
      const style = window.getComputedStyle(el);
      if (style.cursor === "pointer") {
        return true;
      }
    } catch (e) {}

    return false;
  }

  /**
   * Calculate absolute OS screen coordinates
   */
  function calculateScreenCoordinates(rect) {
    const clientX = rect.left;
    const clientY = rect.top;
    const clientWidth = rect.width;
    const clientHeight = rect.height;

    const clientCenterX = clientX + clientWidth / 2;
    const clientCenterY = clientY + clientHeight / 2;

    const osWindowX = window.screenX;
    const osWindowY = window.screenY;
    const osOuterWidth = window.outerWidth;
    const osOuterHeight = window.outerHeight;
    const osInnerWidth = window.innerWidth;
    const osInnerHeight = window.innerHeight;

    const browserChromeOffsetX = osOuterWidth - osInnerWidth;
    const browserChromeOffsetY = osOuterHeight - osInnerHeight;

    const screenX = osWindowX + browserChromeOffsetX + clientX;
    const screenY = osWindowY + browserChromeOffsetY + clientY;
    const screenCenterX = osWindowX + browserChromeOffsetX + clientCenterX;
    const screenCenterY = osWindowY + browserChromeOffsetY + clientCenterY;

    return {
      client: {
        x: Math.round(clientX),
        y: Math.round(clientY),
        width: Math.round(clientWidth),
        height: Math.round(clientHeight),
        center_x: Math.round(clientCenterX),
        center_y: Math.round(clientCenterY)
      },
      screen: {
        x: Math.round(screenX),
        y: Math.round(screenY),
        center_x: Math.round(screenCenterX),
        center_y: Math.round(screenCenterY)
      }
    };
  }

  /**
   * Scan active viewport for all actionable interactive elements
   */
  function scanViewport() {
    setWorkerStatus(true, "Scanning Viewport...");
    setTimeout(() => {
      // Keep active if requested, or fade to idle
    }, 1500);

    elementRegistry.clear();

    // 1. Broad selector query covering standard HTML + ARIA + event markup
    const primaryQuery = [
      "a[href]",
      "button",
      "input:not([type='hidden'])",
      "select",
      "textarea",
      "summary",
      "[role]",
      "[tabindex]:not([tabindex='-1'])",
      "[contenteditable='true']",
      "[contenteditable='']",
      "[onclick]",
      "[onmousedown]",
      "[jsaction]",
      "[data-action]",
      "[aria-haspopup]",
      "[aria-expanded]",
      "[aria-pressed]"
    ].join(",");

    const primaryCandidates = Array.from(document.querySelectorAll(primaryQuery));

    // 2. Secondary scan: find custom clickable styled containers (div, span, li, svg with cursor: pointer)
    const secondaryQuery = "div, span, li, svg, [class*='btn'], [class*='button'], [class*='clickable']";
    const potentialCustomNodes = Array.from(document.querySelectorAll(secondaryQuery));
    const pointerCustomNodes = [];

    for (const node of potentialCustomNodes) {
      if (node.closest("#ai-overtake-worker-overlay") || node.classList.contains("ai-overtake-highlight")) {
        continue;
      }
      try {
        const style = window.getComputedStyle(node);
        if (style.cursor === "pointer") {
          pointerCustomNodes.push(node);
        }
      } catch (e) {}
    }

    // Combine and remove references to our own overlay
    const allCandidates = Array.from(new Set([...primaryCandidates, ...pointerCustomNodes])).filter((el) => {
      return !el.closest("#ai-overtake-worker-overlay") && !el.classList.contains("ai-overtake-highlight");
    });

    // 3. Filter to truly visible nodes
    const visibleInteractiveNodes = allCandidates.filter((el) => {
      return isInteractiveElement(el) && isElementVisibleInViewport(el);
    });

    // 4. Smart Hierarchy Deduplication:
    // If element A is an interactive container (e.g. <button> or <div role="button">), and element B is a child
    // (e.g. <span> or <svg>), we want the button to represent the click target, not both!
    const finalElements = [];
    const nodeSet = new Set(visibleInteractiveNodes);

    for (const el of visibleInteractiveNodes) {
      // Check if there is an interactive parent also in nodeSet
      let parent = el.parentElement;
      let hasInteractiveAncestor = false;

      while (parent && parent !== document.body && parent !== document.documentElement) {
        if (nodeSet.has(parent)) {
          // If the parent is a standard interactive button/link/role, prefer the parent
          const pTag = parent.tagName.toLowerCase();
          const pRole = (parent.getAttribute("role") || "").toLowerCase();
          if (["button", "a", "select", "summary"].includes(pTag) || ["button", "link", "tab"].includes(pRole)) {
            hasInteractiveAncestor = true;
            break;
          }
        }
        parent = parent.parentElement;
      }

      if (!hasInteractiveAncestor) {
        finalElements.push(el);
      }
    }

    // 5. Serialize into standard format
    const elementsList = [];
    let sequentialId = 1;

    for (const el of finalElements) {
      const rect = el.getBoundingClientRect();
      const coords = calculateScreenCoordinates(rect);
      const label = getElementLabel(el);
      const controlType = getControlType(el);
      const val = getElementValue(el);

      const currentId = sequentialId++;
      elementRegistry.set(currentId, el);

      // Rect in format [left, top, right, bottom] in absolute screen pixels
      const screenRect = [
        coords.screen.x,
        coords.screen.y,
        coords.screen.x + coords.client.width,
        coords.screen.y + coords.client.height
      ];

      const item = {
        id: currentId,
        type: controlType,
        tag: el.tagName.toLowerCase(),
        name: label || (controlType + " " + currentId),
        label: label,
        value: val,
        center_x: coords.screen.center_x,
        center_y: coords.screen.center_y,
        rect: screenRect,
        coords: coords.screen,
        client_rect: coords.client
      };

      elementsList.push(item);
    }

    return {
      viewport: {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        devicePixelRatio: window.devicePixelRatio
      },
      window_metrics: {
        screenX: window.screenX,
        screenY: window.screenY,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        chromeOffsetX: window.outerWidth - window.innerWidth,
        chromeOffsetY: window.outerHeight - window.innerHeight
      },
      elements_count: elementsList.length,
      elements: elementsList
    };
  }

  /**
   * Execute programmatic click on an element
   */
  function executeClick(elementId) {
    const el = elementRegistry.get(Number(elementId));
    if (!el || !document.contains(el)) {
      throw new Error(`Element #${elementId} not found or no longer present in DOM.`);
    }

    setWorkerStatus(true, `Clicking #${elementId}...`);

    const rect = el.getBoundingClientRect();
    showClickEffect(rect.left + rect.width / 2, rect.top + rect.height / 2);
    highlightElement(el, elementId, 800);

    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    el.focus();

    const mouseEvents = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
    for (const eventName of mouseEvents) {
      const evt = new MouseEvent(eventName, {
        bubbles: true,
        cancelable: true,
        view: window
      });
      el.dispatchEvent(evt);
    }

    if (typeof el.click === "function") {
      el.click();
    }

    setTimeout(() => setWorkerStatus(false), 800);

    return {
      element_id: elementId,
      clicked: true,
      tag: el.tagName.toLowerCase()
    };
  }

  /**
   * Execute programmatic fill / typing on an input element
   */
  function executeFill(elementId, text, clear = true, submit = false) {
    const el = elementRegistry.get(Number(elementId));
    if (!el || !document.contains(el)) {
      throw new Error(`Element #${elementId} not found in DOM.`);
    }

    setWorkerStatus(true, `Typing into #${elementId}...`);
    highlightElement(el, elementId, 1200);

    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    el.focus();

    if (el.isContentEditable) {
      if (clear) el.innerText = "";
      el.innerText += text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      const proto = Object.getPrototypeOf(el);
      const valSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set ||
                        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

      const finalValue = clear ? text : (el.value || "") + text;
      if (valSetter) {
        valSetter.call(el, finalValue);
      } else {
        el.value = finalValue;
      }

      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (submit) {
      const form = el.form || el.closest("form");
      if (form) {
        form.requestSubmit ? form.requestSubmit() : form.submit();
      } else {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true }));
      }
    }

    setTimeout(() => setWorkerStatus(false), 800);

    return {
      element_id: elementId,
      value: text,
      cleared: clear,
      submitted: submit
    };
  }

  /**
   * Execute scroll action
   */
  function executeScroll(direction = "down", amount = 450) {
    setWorkerStatus(true, `Scrolling ${direction}...`);
    const delta = direction === "up" ? -Math.abs(amount) : Math.abs(amount);
    window.scrollBy({ top: delta, behavior: "smooth" });
    setTimeout(() => setWorkerStatus(false), 600);
    return {
      direction,
      amount,
      currentScrollY: window.scrollY
    };
  }

  /**
   * Message listener from background service worker
   */
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
      switch (request.action) {
        case "PING_CONTENT": {
          sendResponse({ status: "pong", url: window.location.href });
          break;
        }

        case "SET_WORKER_STATUS": {
          setWorkerStatus(Boolean(request.is_working), request.message || "AI Worker Active");
          sendResponse({ status: "success", is_working: request.is_working });
          break;
        }

        case "SCAN_VIEWPORT": {
          const scanData = scanViewport();
          sendResponse(scanData);
          break;
        }

        case "CLICK_ELEMENT": {
          const elementId = request.element_id || request.id;
          const res = executeClick(elementId);
          sendResponse({ status: "success", ...res });
          break;
        }

        case "FILL_ELEMENT": {
          const elementId = request.element_id || request.id;
          const text = request.text || "";
          const clear = request.clear !== false;
          const submit = Boolean(request.submit);
          const res = executeFill(elementId, text, clear, submit);
          sendResponse({ status: "success", ...res });
          break;
        }

        case "SCROLL": {
          const res = executeScroll(request.direction || "down", request.amount || 450);
          sendResponse({ status: "success", ...res });
          break;
        }

        case "HIGHLIGHT_ELEMENT": {
          const elementId = request.element_id || request.id;
          const el = elementRegistry.get(Number(elementId));
          if (el) {
            highlightElement(el, elementId, 2500);
            sendResponse({ status: "success", element_id: elementId });
          } else {
            sendResponse({ status: "error", error: `Element #${elementId} not found` });
          }
          break;
        }

        default:
          sendResponse({ status: "error", error: `Unknown content action: ${request.action}` });
          break;
      }
    } catch (err) {
      console.error("[Bridge ContentScript] Action execution error:", err);
      sendResponse({ status: "error", error: err.message });
    }

    return true;
  });

  console.log("[AI Overtake] Content script loaded & ready for bridge commands.");
})();
