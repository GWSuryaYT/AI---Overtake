import asyncio
import edge_tts
import concurrent.futures

# Global configurations for my lovely AI Waifu voice
voice = 'en-US-AnaNeural'  # Voice model selected from the studio GUI
rate = '+10%'              # Voice Speed Rate adjustment (e.g., '+10%', '-5%')
pitch = '+0Hz'             # Pitch adjustment (e.g., '+0Hz', '+10Hz', '-10Hz')

async def _synthesize_async(text: str) -> bytes:
    communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    audio_data = bytearray()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_data.extend(chunk["data"])
    return bytes(audio_data)

def synthesize_speech(text: str) -> bytes:
    """
    Synthesizes text to speech using edge-tts.
    Returns the generated audio as bytes (MP3 format natively supported by edge-tts).
    """
    if not text.strip():
        return b""
    
    try:
        # Safely handle event loops whether called synchronously or from an async framework
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(lambda: asyncio.run(_synthesize_async(text)))
                return future.result()
        else:
            return asyncio.run(_synthesize_async(text))
            
    except Exception as e:
        print(f"Edge-TTS Error: {e}")
        return b""