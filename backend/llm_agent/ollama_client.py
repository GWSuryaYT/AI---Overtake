import httpx
import json
from google import genai
import os
from dotenv import load_dotenv

#do u want to use ollama's local models:
local_model = False


load_dotenv()
#intence:
ai_client = genai.Client(api_key= os.getenv('GEMINI_KEY'))


async def generate_response_stream(prompt: str, model_name: str = "llama3.1"):

    #local model:
    if local_model:
        url = "http://localhost:11434/api/generate"
        payload = {
            "model": model_name,
            "prompt": prompt,
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
