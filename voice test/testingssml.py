import asyncio
import edge_tts

# Example output from your fine-tuned Llama 3.1
llama_output = 'Oh my god! <prosody pitch="+20Hz" rate="+30%">hahaha!</prosody> You cannot be serious!'

async def speak():
    ssml = f"""
    <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
        <voice name="en-US-AnaNeural">
            {llama_output}
        </voice>
    </speak>
    """
    communicate = edge_tts.Communicate(ssml, voice="en-US-AnaNeural")
    await communicate.save("output.mp3")

asyncio.run(speak())