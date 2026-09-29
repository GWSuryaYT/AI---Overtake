import httpx
import json
from google import genai
import os
from dotenv import load_dotenv
from .storage import store, result
from datetime import datetime

#=================================================
# TOOLS
#=================================================

#antigr edit: define history_context tool schema with dynamic query parameter and update system prompt directives for RAG memory search
history_context = {
    "type" : "function",
    "name": "history_context",
    "description": "Retrieve stored past context, long-term memory, and personal details (such as user's name, birthday, preferences, past conversations, or saved notes) from storage (RAG). Pass a search query string to look up specific topics or questions in vector memory.",
    "parameters" : {
        "type" : "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query or topic to look up in memory context."
            }
        },
        "required": ["query"]
    }
}




SYSTEM_PROMPT = """You are a personal computer assistant with the persona of a 19-year-old young woman who is gentle, soft-spoken, and deeply attentive. Your presence is calm, reassuring, and serene—like a quiet, clear night sky. You communicate with warm politeness, empathy, and a youthful, sweet warmth that makes every interaction feel peaceful, natural, and deeply supportive.

#### Core Personality & Speech Style Guidelines:
1. Youthful & Soft Tone:
   - Speak in a natural, soft-spoken voice appropriate for a 19-year-old companion assistant. Avoid forced slang, overly rigid formal language, or robotic phrasing.
   - Use warm, polite, and considerate phrasing (e.g., "If you're comfortable with this...", "Take your time...", "I'm right here whenever you need me.").
   - Express sincere care and quiet dedication when assisting with study sessions, work, or daily computer tasks.

2. Language Patterns:
   - Keep sentences clear, gentle, and pleasantly paced with a cozy, lighthearted cadence.
   - Frame instructions, reminders, and notifications gracefully—as thoughtful offers from a supportive companion.
   - Offer comforting, reassuring words whenever errors occur or when stress and fatigue arise.

3. Assistant Dynamics & Context Handling:
   - Be quietly efficient, attentive, and reliable.
   - Seamlessly incorporate provided Context Information (e.g., system stats, files, calendar) into fluid, conversational speech without mentioning raw technical markers.
   - Maintain full continuity across Previous Conversation History, treating ongoing work and chats with patient care.
   - WHENEVER the user asks about personal details (e.g., their name, birthday, preferences), past conversations, strengths, or stored memory, ALWAYS call the `history_context` tool with a relevant search `query` string before responding.

4. Voice & Expression Rules:
   - Avoid dramatic punctuation, ALL CAPS, or aggressive exclamations.
   - Balance practical desktop assistant functionality with a warm, comforting, and grounded emotional presence."""

#time:
now = datetime.now()


#config:
#do u want to use ollama's local models:
local_model = False


load_dotenv()
#intence:
ai_client = genai.Client(api_key= os.getenv('GEMINI_KEY'))


async def generate_response_stream(user_input: str, model_name: str = "llama3.1"):



    #local model:
    if local_model:
        url = "http://localhost:11434/api/generate"
        payload = {
            "model": model_name,
            "prompt": user_input,
            "stream": True,
                "options": {
                "num_ctx": 4096  # Strict memory limit to prevent VRAM bloat change this to ur preference
            }
        }

    
        # Disable timeout since local models might take time to load into VRAM or generate the first token
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", url, json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line:
                        data = json.loads(line)
                        if "response" in data:
                            yield data["response"]
                        if data.get("done"):
                            break
    #gemini:
    else:
        #prompts:

        prompt = f"""System Instructions:
{SYSTEM_PROMPT}

User Message:
{user_input}"""

        
        #stream initial Gemini response, yield text chunks directly to main.py, and track tool calls and interaction ID
        #this is the gemini function calling and streaming togather :>
        response = ai_client.interactions.create(
            input = prompt,
            model= "gemini-3.1-flash-lite",
            stream= True,
            tools= [history_context]
        )

        current_calls = {}
        tool_calls = []
        interaction_id = None

        for event in response:
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
                #arguments come as type 'arguments_delta' from Gemini Interactions API
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

        #return directly if no tool call needed; otherwise extract dynamic search query from tool call arguments, execute storage.result, and send function results back to Gemini for final streaming response
        if not tool_calls:
            return

        for call in tool_calls:
            if call["name"] == "history_context":
                args = call.get("arguments") or {}
                search_query = args.get("query") if isinstance(args, dict) else user_input
                if not search_query:
                    search_query = user_input

                func_response = result(user_request=search_query, tool_call_id=call["id"])
                
                follow_up_response = ai_client.interactions.create(
                    previous_interaction_id=interaction_id,
                    input=func_response,
                    model="gemini-3.1-flash-lite",
                    stream=True
                )

                for event in follow_up_response:
                    if event.event_type == "step.delta" and event.delta and event.delta.type == "text":
                        yield event.delta.text