import httpx
import json
from google import genai
import os
from dotenv import load_dotenv
from .storage import store, result
from datetime import datetime

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

        
        response = ai_client.interactions.create(
            input = prompt,
            model= "gemini-3.1-flash-lite",
            stream= True,
        )

        for event in response:
            # Check if the event contains a delta (incremental change)
            if event.event_type == "step.delta":
                #extract text delta if available:
                if event.delta and event.delta.type == "text":
                    yield event.delta.text