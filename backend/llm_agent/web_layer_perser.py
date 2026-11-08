"""
AI Overtake - Web Layer Parser
Bidirectional WebSocket Server bridging Python AI Computer Worker with Google Chrome Extension.
Runs an asynchronous WebSocket server on a background daemon thread, exposes synchronous
thread-safe methods for scanning viewport elements, translating coordinates, and controlling DOM actions.
"""

import asyncio
import json
import logging
import threading
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

import websockets

logger = logging.getLogger("WebLayerParser")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


class Web_layer_perser:
    """
    WebSocket server bridge between Python and Chrome Extension.
    """

    def __init__(self, host: str = "127.0.0.1", port: int = 8765):
        self.host = host
        self.port = port
        self.persed_data: List[Dict[str, Any]] = []

        # Client connection management
        self.active_client: Optional[websockets.WebSocketServerProtocol] = None
        self._client_lock = threading.Lock()

        # Request-Response futures correlation
        self._pending_requests: Dict[str, asyncio.Future] = {}
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._server = None
        self._is_running = False

        # Metadata from last scan
        self.last_active_tab: Dict[str, Any] = {}
        self.last_tabs_list: List[Dict[str, Any]] = []
        self.last_viewport: Dict[str, Any] = {}

    def start(self):
        """Starts the local WebSocket server in a background daemon thread."""
        if self._is_running:
            return

        self._is_running = True
        started_event = threading.Event()
        self._thread = threading.Thread(
            target=self._run_event_loop,
            args=(started_event,),
            name="WebBridgeServerThread",
            daemon=True
        )
        self._thread.start()
        started_event.wait(timeout=5.0)
        logger.info(f"Web_layer_perser running on ws://{self.host}:{self.port}")

    def _run_event_loop(self, started_event: threading.Event):
        """Internal daemon thread event loop."""
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)

        async def _main():
            self._server = await websockets.serve(
                self._handle_client,
                self.host,
                self.port,
                ping_interval=None,  # Handled by custom keep-alive
                max_size=10 * 1024 * 1024  # 10 MB payload limit for DOM dumps
            )
            started_event.set()
            await asyncio.Future()  # Run forever

        try:
            self._loop.run_until_complete(_main())
        except Exception as e:
            if self._is_running:
                logger.error(f"WebSocket server encountered error: {e}")
        finally:
            self._loop.close()

    async def _handle_client(self, websocket):
        """Handles incoming Chrome extension connections."""
        with self._client_lock:
            self.active_client = websocket
        remote = websocket.remote_address
        logger.info(f"[Bridge] Chrome Extension connected from {remote}")

        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    self._dispatch_incoming_message(data)
                except json.JSONDecodeError:
                    logger.warning(f"[Bridge] Invalid JSON received: {message[:100]}")
        except websockets.exceptions.ConnectionClosed as e:
            logger.info(f"[Bridge] Chrome Extension disconnected: {e}")
        finally:
            with self._client_lock:
                if self.active_client == websocket:
                    self.active_client = None

    def _dispatch_incoming_message(self, data: Dict[str, Any]):
        """Dispatches incoming message from Chrome to waiting futures or handlers."""
        # 1. Match requestId for pending async requests
        req_id = data.get("requestId") or data.get("id")
        if req_id and req_id in self._pending_requests:
            fut = self._pending_requests.pop(req_id)
            if not fut.done():
                fut.set_result(data)
            return

        # 2. Handle background events / heartbeat
        msg_action = data.get("action")
        msg_event = data.get("event")

        if msg_action == "PING":
            # Echo PONG back
            if self._loop and self.active_client:
                asyncio.run_coroutine_threadsafe(
                    self.active_client.send(json.dumps({"action": "PONG", "timestamp": time.time()})),
                    self._loop
                )
        elif msg_event == "CLIENT_READY":
            logger.info(f"[Bridge] Extension handshake complete: {data.get('agent')}")

    def is_connected(self) -> bool:
        """Returns True if the Chrome Extension is currently connected."""
        with self._client_lock:
            return self.active_client is not None

    def send_command(self, action: str, timeout: float = 5.0, **kwargs) -> Dict[str, Any]:
        """
        Thread-safe synchronous command dispatcher to Chrome Extension.
        Awaits response correlated by requestId.
        """
        if not self._is_running:
            self.start()

        if not self.is_connected() or not self._loop:
            raise ConnectionError("Chrome extension is not connected to WebSocket server.")

        req_id = f"py_{uuid.uuid4().hex[:8]}"
        payload = {"action": action, "requestId": req_id, **kwargs}

        fut = self._loop.create_future()
        self._pending_requests[req_id] = fut

        async def _send():
            with self._client_lock:
                client = self.active_client
            if client:
                await client.send(json.dumps(payload))
            else:
                raise ConnectionError("Active client lost before send.")

        # Dispatch send onto event loop
        asyncio.run_coroutine_threadsafe(_send(), self._loop)

        # Wait on future from caller thread
        start = time.perf_counter()
        while not fut.done():
            if time.perf_counter() - start > timeout:
                self._pending_requests.pop(req_id, None)
                raise TimeoutError(f"Action '{action}' timed out after {timeout}s waiting for Chrome.")
            time.sleep(0.02)

        return fut.result()

    # ── High-Level Agent Methods ─────────────────────────────────────────────

    def scan_web(self, timeout: float = 4.0) -> Tuple[List[Dict[str, Any]], float]:
        """
        Scans active browser tab viewport for interactive elements.
        Returns a tuple of (raw_elements, scan_duration_ms), 100% schema-compatible
        with computer_worker's universal element structure.
        """
        t0 = time.perf_counter()
        response = self.send_command("SCAN_VIEWPORT", timeout=timeout)
        duration_ms = (time.perf_counter() - t0) * 1000

        if response.get("status") != "success":
            err = response.get("error", "Unknown scan error")
            logger.error(f"[Bridge] SCAN_VIEWPORT failed: {err}")
            return [], duration_ms

        self.last_active_tab = response.get("active_tab", {})
        self.last_tabs_list = response.get("tabs", [])
        self.last_viewport = response.get("viewport", {})

        active_title = self.last_active_tab.get("title") or "Google Chrome"
        active_url = self.last_active_tab.get("url") or ""
        window_label = f"Chrome: {active_title}"

        raw_elements = []
        incoming_elements = response.get("elements", [])

        for el in incoming_elements:
            # Normalize to computer_layer_perser / computer_worker schema:
            # - id: int
            # - name: str
            # - type: str ("Btn", "Edit", "Link", "Check", "Radio", "Combo", etc.)
            # - value: str
            # - window: str
            # - center_x: int
            # - center_y: int
            # - rect: [left, top, right, bottom]
            el_type = el.get("type", "Btn")
            # Map type to short type for compatibility
            type_mapping = {
                "button": "Btn",
                "Button": "Btn",
                "Btn": "Btn",
                "link": "Link",
                "Link": "Link",
                "input[text]": "Edit",
                "Edit": "Edit",
                "edit": "Edit",
                "textarea": "Edit",
                "select": "Combo",
                "Combo": "Combo",
                "checkbox": "Check",
                "Check": "Check",
                "radio": "Radio",
                "Radio": "Radio",
                "tab": "Tab",
                "Tab": "Tab",
                "menu": "Menu",
                "Menu": "Menu",
            }
            norm_type = type_mapping.get(el_type, "Btn")

            coords = el.get("coords", {})
            center_x = coords.get("center_x") or el.get("center_x", 0)
            center_y = coords.get("center_y") or el.get("center_y", 0)

            # Absolute screen rect [left, top, right, bottom]
            rect = el.get("rect")
            if not rect:
                x = coords.get("x", center_x - 10)
                y = coords.get("y", center_y - 10)
                rect = [x, y, x + 20, y + 20]

            item = {
                "id": el["id"],
                "name": el.get("name") or el.get("label") or f"{norm_type} #{el['id']}",
                "type": norm_type,
                "value": el.get("value") or "",
                "window": window_label,
                "center_x": center_x,
                "center_y": center_y,
                "rect": rect,
                "url": active_url,
                "tag": el.get("tag", ""),
            }
            raw_elements.append(item)

        self.persed_data = raw_elements
        return raw_elements, duration_ms

    def set_worker_status(self, is_working: bool, message: str = "AI Agent Working..."):
        """Activates or deactivates the animated neon blue gradient border & badge in Chrome."""
        try:
            if self.is_connected():
                self.send_command("SET_WORKER_STATUS", timeout=1.5, is_working=is_working, message=message)
        except Exception as e:
            logger.debug(f"[Bridge] Failed to update worker status overlay: {e}")

    def click_element(self, element_id: int) -> Dict[str, Any]:
        """Dispatches synthetic DOM-level click to the target element."""
        return self.send_command("CLICK_ELEMENT", element_id=element_id)

    def fill_element(self, element_id: int, text: str, clear: bool = True, submit: bool = False) -> Dict[str, Any]:
        """Dispatches synthetic DOM-level typing/fill to the target input."""
        return self.send_command("FILL_ELEMENT", element_id=element_id, text=text, clear=clear, submit=submit)

    def switch_tab(self, tab_id: int) -> Dict[str, Any]:
        """Switches active Chrome tab."""
        return self.send_command("SWITCH_TAB", tabId=tab_id)

    def navigate(self, url: str, tab_id: Optional[int] = None) -> Dict[str, Any]:
        """Navigates active tab or specified tab to a URL."""
        return self.send_command("NAVIGATE", url=url, tabId=tab_id)

    def scroll(self, direction: str = "down", amount: int = 450) -> Dict[str, Any]:
        """Scrolls active page smoothly."""
        return self.send_command("SCROLL", direction=direction, amount=amount)

    def highlight_element(self, element_id: int) -> Dict[str, Any]:
        """Draws visual debugging highlight on element in Chrome."""
        return self.send_command("HIGHLIGHT_ELEMENT", element_id=element_id)

    def stop(self):
        """Stops the WebSocket server."""
        self._is_running = False
        if self._server:
            self._server.close()
        if self._loop:
            self._loop.call_soon_threadsafe(self._loop.stop)


# Global singleton instance for easy import across modules
_global_web_parser: Optional[Web_layer_perser] = None


def get_web_parser() -> Web_layer_perser:
    """Returns the running global Web_layer_perser instance."""
    global _global_web_parser
    if _global_web_parser is None:
        _global_web_parser = Web_layer_perser()
        _global_web_parser.start()
    return _global_web_parser
