import asyncio
import os
import tempfile
import pygame
import edge_tts

async def speak_with_prosody(text: str, voice_name: str, pitch: str, rate: str):
    """Generates and plays TTS with specific pitch and speed adjustments."""
    print(f"Testing -> Pitch: {pitch} | Rate: {rate}")
    
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp_file:
        temp_file_path = tmp_file.name
        
    try:
        # 1. Pass the pitch and rate arguments to Communicate
        communicate = edge_tts.Communicate(
            text=text, 
            voice=voice_name, 
            pitch=pitch, 
            rate=rate
        )
        await communicate.save(temp_file_path)

        # 2. Play the audio
        pygame.mixer.init()
        pygame.mixer.music.load(temp_file_path)
        pygame.mixer.music.play()

        while pygame.mixer.music.get_busy():
            pygame.time.Clock().tick(10)

        pygame.mixer.quit()
        
    finally:
        # 3. Clean up
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except OSError:
                pass

async def main():
    # Pick a baseline female voice to experiment on. 
    base_voice = "ja-JP-NanamiNeural" #ja-JP-NanamiNeural #hi-IN-SwaraNeural

    # We will announce the settings so you know which one you are hearing
    test_variations_jp = [
        # (Pitch, Rate)
        ("+0Hz", "-1%"),      # The original, default voice
        ("+10Hz", "-2%"),     # Slightly higher and faster
        ("+20Hz", "-1%"),    # Noticeably younger
        ("+30Hz", "-3%"),    # Very high energy, much younger
        ("+40Hz", "-2%"),    # Pushing into extreme/anime character territory
        ("+25Hz", "-2%"),     # Using percentage instead of Hz for pitch
    ]
    test_variations_others = [
        # (Pitch, Rate)
        ("+0Hz", "+0%"),      # The original, default voice
        ("+10Hz", "+5%"),     # Slightly higher and faster
        ("+20Hz", "+10%"),    # Noticeably younger
        ("+30Hz", "+15%"),    # Very high energy, much younger
        ("+40Hz", "+20%"),    # Pushing into extreme/anime character territory
        ("+25%", "+10%"),     # Using percentage instead of Hz for pitch
    ]

    print(f"Finding the perfect age for {base_voice}...\n")

    for pitch, rate in test_variations_jp:
        phrase = f"The ReadTimeout error was happening because the local Ollama model took longer than the default 5 seconds to start generating a response (which is very common for local models since they have to load into VRAM first)."
        await speak_with_prosody(phrase, base_voice, pitch, rate)
        await asyncio.sleep(1) # Small pause between tests

    print("\nTest complete.")

if __name__ == "__main__":
    asyncio.run(main())