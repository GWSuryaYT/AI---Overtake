/**
 * Project Anna - Cloudflare Durable Object Relay Hub
 * 
 * Provides global real-time synchronization between:
 * 1. Remote Client (Vercel PWA / Phone)
 * 2. PC Host Daemon (Desktop Worker & Screen Streamer)
 * 3. Hardware Controller (ESP32 / Arduino Power Node)
 */

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        // Handle HTTP CORS for health checks and status queries
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization",
                },
            });
        }

        // WebSocket upgrade endpoint: /ws?role=pc|remote|hardware&token=SECRET
        if (url.pathname === "/ws") {
            const upgradeHeader = request.headers.get("Upgrade");
            if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
                return new Response("Expected Upgrade: websocket", { status: 426 });
            }

            // Route all connections to a single Durable Object instance ("main-room")
            // to ensure all devices share the exact same edge state.
            const id = env.RELAY_ROOM.idFromName("main-room");
            const roomObject = env.RELAY_ROOM.get(id);

            return roomObject.fetch(request);
        }

        // Health check endpoint
        if (url.pathname === "/status") {
            const id = env.RELAY_ROOM.idFromName("main-room");
            const roomObject = env.RELAY_ROOM.get(id);
            return roomObject.fetch(request);
        }

        return new Response("Project Anna Relay Running.", { status: 200 });
    },
};

// ============================================================================
// Durable Object: AnnaRelayRoom
// ============================================================================
export class AnnaRelayRoom {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        // Map socket -> metadata: { role: 'pc' | 'remote' | 'hardware', id: string }
        this.sessions = new Map();
    }

    async fetch(request) {
        const url = new URL(request.url);

        // Return current system status to HTTP requests
        if (url.pathname === "/status") {
            const roles = Array.from(this.sessions.values()).map((s) => s.role);
            return new Response(
                JSON.stringify({
                    status: "online",
                    pc_connected: roles.includes("pc"),
                    hardware_connected: roles.includes("hardware"),
                    active_remotes: roles.filter((r) => r === "remote").length,
                }),
                {
                    headers: {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*",
                    },
                }
            );
        }

        // Validate Auth Token
        const authToken = url.searchParams.get("token");
        const expectedToken = this.env.AUTH_SECRET || "anna-secret-token-change-me";
        if (authToken !== expectedToken) {
            return new Response("Unauthorized", { status: 401 });
        }

        // Validate Role
        const role = url.searchParams.get("role");
        if (!["pc", "remote", "hardware"].includes(role)) {
            return new Response("Invalid role. Must be 'pc', 'remote', or 'hardware'.", { status: 400 });
        }

        // Initialize WebSocket pair
        const webSocketPair = new WebSocketPair();
        const [client, server] = Object.values(webSocketPair);

        await this.handleSession(server, role);

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }

    async handleSession(webSocket, role) {
        webSocket.accept();

        const sessionId = crypto.randomUUID();
        const sessionMeta = { role, id: sessionId, joinedAt: Date.now() };
        this.sessions.set(webSocket, sessionMeta);

        console.log(`[Relay] New connection: role=${role}, id=${sessionId}`);

        // Broadcast updated state to all connected remotes
        this.broadcastSystemStatus();

        webSocket.addEventListener("message", async (msg) => {
            try {
                const data = JSON.parse(msg.data);
                this.routeMessage(webSocket, sessionMeta, data);
            } catch (err) {
                console.error("[Relay] Error parsing incoming message:", err);
            }
        });

        const cleanup = () => {
            console.log(`[Relay] Disconnected: role=${role}, id=${sessionId}`);
            this.sessions.delete(webSocket);
            this.broadcastSystemStatus();
        };

        webSocket.addEventListener("close", cleanup);
        webSocket.addEventListener("error", cleanup);
    }

    /**
     * Routes messages between remote client, host PC, and hardware.
     */
    routeMessage(senderSocket, senderMeta, message) {
        const { type } = message;

        switch (type) {
            // 1. Tool Execution: Remote -> PC
            case "EXECUTE_TOOL": {
                this.forwardToRole("pc", {
                    ...message,
                    sender_id: senderMeta.id,
                });
                break;
            }

            // 2. Tool Results: PC -> Remote
            case "TOOL_RESULT": {
                // If a specific target sender is defined, route directly to it
                if (message.target_id) {
                    this.sendToId(message.target_id, message);
                } else {
                    this.forwardToRole("remote", message);
                }
                break;
            }

            // 3. WebRTC Signaling (Offer, Answer, ICE Candidates): Bidirectional
            case "SIGNALING": {
                const targetRole = senderMeta.role === "pc" ? "remote" : "pc";
                this.forwardToRole(targetRole, {
                    ...message,
                    from_role: senderMeta.role,
                });
                break;
            }

            // 4. Hardware Power Commands: Remote/PC -> Hardware (ESP32)
            case "HARDWARE_CMD": {
                this.forwardToRole("hardware", {
                    ...message,
                    sender_id: senderMeta.id,
                });
                break;
            }

            // 5. Ping / Keepalive
            case "PING": {
                senderSocket.send(JSON.stringify({ type: "PONG", timestamp: Date.now() }));
                break;
            }

            default:
                console.warn(`[Relay] Unhandled message type: ${type}`);
        }
    }

    /**
     * Forwards a payload to all connected clients matching a specific role.
     */
    forwardToRole(targetRole, payload) {
        const json = JSON.stringify(payload);
        for (const [socket, meta] of this.sessions.entries()) {
            if (meta.role === targetRole) {
                try {
                    socket.send(json);
                } catch (e) {
                    console.error(`[Relay] Failed to send to ${targetRole}:`, e);
                }
            }
        }
    }

    /**
     * Sends a payload to a specific session ID.
     */
    sendToId(sessionId, payload) {
        const json = JSON.stringify(payload);
        for (const [socket, meta] of this.sessions.entries()) {
            if (meta.id === sessionId) {
                try {
                    socket.send(json);
                    break;
                } catch (e) {
                    console.error(`[Relay] Failed to send to session ${sessionId}:`, e);
                }
            }
        }
    }

    /**
     * Notifies all remote clients about the availability of the PC and hardware.
     */
    broadcastSystemStatus() {
        const roles = Array.from(this.sessions.values()).map((s) => s.role);
        const statusPayload = JSON.stringify({
            type: "SYSTEM_STATUS",
            pc_online: roles.includes("pc"),
            hardware_online: roles.includes("hardware"),
            timestamp: Date.now(),
        });

        for (const [socket, meta] of this.sessions.entries()) {
            if (meta.role === "remote") {
                try {
                    socket.send(statusPayload);
                } catch (e) {
                    // Socket might be terminating
                }
            }
        }
    }
}