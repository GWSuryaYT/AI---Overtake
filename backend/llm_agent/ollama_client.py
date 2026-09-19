import httpx
import json

async def generate_response_stream(prompt: str, model_name: str = "llama3.1"):
    url = "http://localhost:11434/api/generate"
    payload = {
        "model": model_name,
        "prompt": prompt,
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
                    if "response" in data:
                        yield data["response"]
                    if data.get("done"):
                        break
