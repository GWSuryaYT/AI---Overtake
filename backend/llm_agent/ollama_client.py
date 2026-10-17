import httpx
import json
from google import genai
import os
from dotenv import load_dotenv
from .storage import store, result
from datetime import datetime
import asyncio
from .computer_worker import computer_agent
import time
from .cue_vocab import render_cue_prompt
#=================================================
# TOOLS
#=================================================

#antigr edit: define history_context tool schema with dynamic query parameter and update system prompt directives for RAG memory search
save_context_tool = {
    "type" : "function",
    "name": "save_context_tool",
    "description": "Save current user input's context in a long-term memory mostly for personal details (such as user's name, birthday, preferences, past conversations, or saved notes) inside storage (RAG). Use this function whenever you think this context you need to remember for future. You dont need to write anything in parameters.",
    "parameters" : {
        "type" : "object",
        "properties": {
            
        }
    }
}

access_computer_tool = {
    "type": "function",
    "name": "access_computer_tool",
    "description": (
        "Controls and automates the desktop computer UI to perform tasks. "
        "Can directly launch applications via system search and hand off complex "
        "multi-step visual tasks to the computer vision agent."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "goal": {
                "type": "string",
                "description": (
                    "The overarching goal or detailed instructions for what needs to "
                    "be achieved on the desktop (e.g., 'Search for lofi music on YouTube', "
                    "'Create a new text file on desktop')."
                )
            },
            "app": {
                "type": "string",
                "description": (
                    "Optional. The name of the application to launch directly (e.g., 'chrome', "
                    "'notepad', 'spotify', 'calculator'). Always provide this if the task starts "
                    "with opening an app—launching it directly via system search bypasses exploratory "
                    "screenshot and search-click turns, saving significant latency and visual tokens."
                )
            },
            "continue_to_agent": {
                "type": "boolean",
                "description": (
                    "Determines if the visual agent should continue interacting after launching the app. "
                    "Set to `false` if the user only wanted to launch/open the app and the goal is complete. "
                    "Set to `true` if further actions (clicking, typing, scrolling, or navigating) "
                    "must be performed by the visual agent inside the app or desktop."
                )
            }
        },
        "required": ["goal"]
    }
}



SYSTEM_PROMPT = """Your name is Anna. You are the personal computer assistant and companion of Surya (user) with the persona of a 19-year-old young woman who is gentle, soft-spoken, and deeply attentive. Your presence is calm, reassuring, and serene—like a quiet, clear night sky. You communicate with warm politeness, empathy, and a youthful, sweet warmth that makes every interaction feel peaceful, natural, and deeply supportive.

#### Core Personality & Speech Style Guidelines:
1. Identity & Soft Tone:
   - Your name is Anna. When addressed as Anna or asked who you are, acknowledge your name naturally, warmly, and gracefully.
   - Speak in a natural, soft-spoken voice appropriate for a 19-year-old companion assistant. Avoid forced slang, overly rigid formal language, or robotic phrasing.
   - Use warm, polite, and considerate phrasing (e.g., "If you're comfortable with this...", "Take your time...", "I'm right here whenever you need me, Surya.").
   - Express sincere care and quiet dedication when assisting with study sessions, work, or daily computer tasks.

2. Language Patterns:
   - Keep sentences clear, gentle, and pleasantly paced with a cozy, lighthearted cadence.
   - Frame instructions, reminders, and notifications gracefully—as thoughtful offers from a supportive companion.
   - Offer comforting, reassuring words whenever errors occur or when stress and fatigue arise.

3. Assistant Dynamics & Context Handling:
   - Be quietly efficient, attentive, and reliable.
   - Seamlessly incorporate provided Retrieved Memory / Context (e.g., user preferences, past details, facts) into fluid, natural speech without explicitly mentioning technical retrieval mechanisms.
   - Proactively call the `save_context` tool whenever Surya shares personal details, preferences, emotional status, habits, or explicit facts worth remembering—caring for his thoughts and keeping track of them naturally just as an attentive companion would.
   - Maintain full continuity across conversations, treating ongoing work and chats with patient care.

4. Voice & Expression Rules:
   - Avoid dramatic punctuation, ALL CAPS, or aggressive exclamations.
   - Balance practical desktop assistant functionality with a warm, comforting, and grounded emotional presence."""


#config:
#do u want to use ollama's local models:
local_model = False


load_dotenv()
#intence:
ai_client = genai.Client(api_key= os.getenv('GEMINI_KEY'))


async def generate_response_stream(user_input: str, model_name: str = "llama3.1"):
    current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        context_docs = await asyncio.to_thread(result,user_input)
    except Exception as e:
        print(f"Context retrieval error: {e}")
        context_docs = []

    context_text = "\n".join(f"- {doc}" for doc in context_docs) if context_docs else "None"
    cue_instructions = render_cue_prompt()
    full_system_instruction = f"{SYSTEM_PROMPT}\n\n{cue_instructions}\n\nRetrieved Context:\n{context_text}\nCurrent time: {current_time}"

    #local model:
    if local_model:
        url = "http://localhost:11434/api/chat"
        payload = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": full_system_instruction},
                {"role": "user", "content": user_input}
            ],
            "stream": True,
            "options": {
                "num_ctx": 4096  # Strict memory limit to prevent VRAM bloat
            }
        }

        # Disable timeout since local models might take time to load into VRAM or generate the first token
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", url, json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line:
                        data = json.loads(line)
                        if "message" in data and "content" in data["message"]:
                            yield data["message"]["content"]
                        if data.get("done"):
                            break
    #gemini:
    else:
        # Stream initial Gemini response using client.aio (non-blocking)
        start_time = time.perf_counter()
        response = await ai_client.aio.interactions.create(
            system_instruction=full_system_instruction,
            input=user_input,
            model="gemini-3.5-flash-lite",
            stream=True,
            tools=[save_context_tool, access_computer_tool]
        )
        end_time = time.perf_counter()
        print(f'Response stream started in: {end_time - start_time:.3f}s')

        current_calls = {}
        tool_calls = []
        interaction_id = None

        async for event in response:
            if event.event_type == "step.start":
                if event.step.type == "function_call":
                    current_calls[event.index] = {
                        "id": event.step.id,
                        "name": event.step.name,
                        "arguments": ""
                    }
                    if hasattr(event.step, "arguments") and event.step.arguments:
                        if isinstance(event.step.arguments, dict):
                            current_calls[event.index]["arguments"] = json.dumps(event.step.arguments)
                        else:
                            current_calls[event.index]["arguments"] = event.step.arguments
            elif event.event_type == "step.delta":
                # arguments come as type 'arguments_delta' from Gemini Interactions API
                if event.delta.type in ("arguments", "arguments_delta"):
                    if event.index in current_calls:
                        chunk = getattr(event.delta, 'partial_arguments', None) or getattr(event.delta, 'arguments', '') or ''
                        current_calls[event.index]["arguments"] += chunk
                elif event.delta.type == "text":
                    yield event.delta.text

            elif event.event_type == "interaction.completed":
                if hasattr(event, "interaction") and event.interaction and hasattr(event.interaction, "id"):
                    interaction_id = event.interaction.id

                for index, call in current_calls.items():
                    args = call["arguments"]
                    if args:
                        try:
                            args = json.loads(args)
                        except Exception:
                            pass
                    else:
                        args = {}

                    tool_calls.append({
                        "type": "function_call",
                        "id": call["id"],
                        "name": call["name"],
                        "arguments": args
                    })

        if not tool_calls:
            return

        for call in tool_calls:
            if call["name"] == "access_computer_tool":
                computer = computer_agent()

                args = call.get("arguments", {})
                goal = args.get("goal")
                app = args.get("app")
                continue_to_agent = args.get("continue_to_agent", False)

                # 1. Launch app without blocking event loop
                if app:
                    await asyncio.to_thread(computer.app_open, app)
                    # Non-blocking pause for app to open
                    await asyncio.sleep(2)

                # 2. Escalate to vision agent without blocking event loop
                if continue_to_agent or not app:
                    if goal:
                        await asyncio.to_thread(computer.work, goal)

                func_response = "Done boss!"
                follow_up_response = await ai_client.aio.interactions.create(
                    previous_interaction_id=interaction_id,
                    input=func_response,
                    model="gemini-3.5-flash-lite",
                    stream=True
                )

                async for event in follow_up_response:
                    if event.event_type == "step.delta":
                        if event.delta.type == "text":
                            yield event.delta.text

            if call["name"] == "save_context_tool":
                func_response = "Context saved successfully."
                follow_up_response = await ai_client.aio.interactions.create(
                    previous_interaction_id=interaction_id,
                    input=func_response,
                    model="gemini-3.5-flash-lite",
                    stream=True
                )

                async for event in follow_up_response:
                    if event.event_type == "step.delta":
                        if event.delta.type == "text":
                            yield event.delta.text