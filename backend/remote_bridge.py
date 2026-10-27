"""
Project Anna - Background Remote Bridge Client
Connects outbound from your PC to the Cloudflare Worker Relay as `role=pc`.
Allows receiving remote tool calls (desktop automation, context saving)
and returning results back to mobile/remote clients without altering local `/ws`.
"""

import os
import json
import asyncio
import traceback
import websockets
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
load_dotenv(dotenv_path=Path(__file__).resolve().parent / "llm_agent" / ".env")

# Cloudflare Relay Configuration
DEFAULT_RELAY_URL = os.getenv(
    "CF_RELAY_URL", 
    "wss://ai-overtake-relay.gravitymarts.workers.dev/ws"
)
AUTH_TOKEN = os.getenv("CF_AUTH_SECRET", "anna-secret-token-change-me")


async def execute_remote_tool(tool_name: str, tool_args: dict) -> dict:
    """
    Executes tool calls received from the remote client on the local PC.
    Runs blocking operations in asyncio threads.
    """
    print(f"[RemoteBridge] Executing tool '{tool_name}' with args: {tool_args}")

    if tool_name == "access_computer_tool":
        try:
            from llm_agent.computer_worker import computer_agent
            computer = computer_agent()

            app = tool_args.get("app")
            goal = tool_args.get("goal")
            continue_to_agent = tool_args.get("continue_to_agent", False)

            output_messages = []

            # 1. Launch app if specified
            if app:
                print(f"[RemoteBridge] Launching app: {app}")
                await asyncio.to_thread(computer.app_open, app)
                await asyncio.sleep(2)
                output_messages.append(f"Launched application: {app}")

            # 2. Hand off to computer agent if needed
            if continue_to_agent or (not app and goal):
                if goal:
                    print(f"[RemoteBridge] Handing off to computer vision agent with goal: '{goal}'")
                    await asyncio.to_thread(computer.work, goal)
                    output_messages.append(f"Completed visual agent goal: {goal}")

            return {
                "status": "success",
                "message": "\n".join(output_messages) if output_messages else "Tool executed successfully."
            }
        except Exception as e:
            traceback.print_exc()
            return {"status": "error", "message": f"access_computer_tool failed: {str(e)}"}

    elif tool_name == "save_context_tool":
        try:
            from llm_agent.storage import store
            context_text = tool_args.get("context") or tool_args.get("para") or tool_args.get("text") or ""
            if context_text:
                await asyncio.to_thread(store, context_text)
                return {"status": "success", "message": "Context stored into RAG memory."}
            else:
                return {"status": "warning", "message": "save_context_tool called with empty text."}
        except Exception as e:
            traceback.print_exc()
            return {"status": "error", "message": f"save_context_tool failed: {str(e)}"}

    elif tool_name in ("shutdown_pc", "power_off_pc"):
        try:
            print("[RemoteBridge] Executing remote PC shutdown in 3 seconds...")
            await asyncio.to_thread(os.system, 'shutdown /s /t 3 /c "Project Anna Remote Shutdown"')
            return {"status": "success", "message": "Initiated Windows system shutdown in 3s."}
        except Exception as e:
            return {"status": "error", "message": f"Shutdown failed: {str(e)}"}

    elif tool_name in ("sleep_pc", "suspend_pc"):
        try:
            print("[RemoteBridge] Putting PC to sleep...")
            await asyncio.to_thread(os.system, "rundll32.exe powrprof.dll,SetSuspendState 0,1,0")
            return {"status": "success", "message": "PC entering sleep / suspend state."}
        except Exception as e:
            return {"status": "error", "message": f"Sleep command failed: {str(e)}"}

    elif tool_name == "restart_pc":
        try:
            print("[RemoteBridge] Restarting PC...")
            await asyncio.to_thread(os.system, 'shutdown /r /t 3 /c "Project Anna Remote Restart"')
            return {"status": "success", "message": "PC restarting in 3s."}
        except Exception as e:
            return {"status": "error", "message": f"Restart failed: {str(e)}"}

    else:
        return {"status": "error", "message": f"Unknown tool: '{tool_name}'"}


async def start_remote_bridge():
    """
    Persistent background worker that keeps an outbound WebSocket connection
    open to the Cloudflare Worker Relay. Reconnects on connection drops.
    """
    ws_uri = f"{DEFAULT_RELAY_URL}?role=pc&token={AUTH_TOKEN}"

    while True:
        try:
            print(f"[RemoteBridge] Connecting to Cloudflare Relay at: {DEFAULT_RELAY_URL} as role=pc...")
            async with websockets.connect(ws_uri, ping_interval=20, ping_timeout=20) as ws:
                print("✨ [RemoteBridge] Connected to Cloudflare Relay as role=pc")

                # Send initial handshake/announcement
                await ws.send(json.dumps({
                    "type": "PC_HELLO",
                    "status": "online",
                    "platform": "windows"
                }))

                async for message_str in ws:
                    try:
                        data = json.loads(message_str)
                    except Exception as e:
                        print(f"[RemoteBridge] Error decoding incoming message: {e}")
                        continue

                    msg_type = data.get("type")

                    if msg_type == "EXECUTE_TOOL":
                        tool_name = data.get("tool_name")
                        tool_args = data.get("tool_args", {})
                        sender_id = data.get("sender_id")

                        # Execute tool in background task so bridge loop is never blocked
                        async def run_and_respond(t_name=tool_name, t_args=tool_args, target_id=sender_id):
                            result = await execute_remote_tool(t_name, t_args)
                            response_payload = {
                                "type": "TOOL_RESULT",
                                "tool_name": t_name,
                                "result": result,
                                "target_id": target_id
                            }
                            try:
                                await ws.send(json.dumps(response_payload))
                                print(f"[RemoteBridge] Sent tool result to sender {target_id}")
                            except Exception as ex:
                                print(f"[RemoteBridge] Failed to send tool result: {ex}")

                        asyncio.create_task(run_and_respond())

                    elif msg_type == "PING":
                        await ws.send(json.dumps({"type": "PONG"}))

                    elif msg_type == "SYSTEM_STATUS":
                        print(f"[RemoteBridge] System status update: {data}")

        except (websockets.ConnectionClosedError, websockets.ConnectionClosedOK) as e:
            print(f"⚠️ [RemoteBridge] Connection closed ({e}). Reconnecting in 5s...")
        except Exception as e:
            print(f"⚠️ [RemoteBridge] Unexpected error: {e}. Reconnecting in 5s...")
            traceback.print_exc()

        await asyncio.sleep(5)


if __name__ == "__main__":
    # Allows testing remote_bridge directly
    asyncio.run(start_remote_bridge())
