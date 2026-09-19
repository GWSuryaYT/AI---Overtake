import asyncio
import os
import tempfile
import pygame
import edge_tts

async def get_filtered_voices():
    """Fetches all voices and filters for English, Hindi, and Japanese."""
    print("Fetching available voices from edge-tts...")
    # Fetch the complete list of voices available
    all_voices = await edge_tts.list_voices()
    
    english_voices = []
    hindi_voices = []
    japanese_voices = []

    # Organize voices by checking the beginning of their locale code
    for voice in all_voices:
        locale = voice['Locale']
        if locale.startswith('en-'):
            english_voices.append(voice)
        elif locale.startswith('hi-'):
            hindi_voices.append(voice)
        elif locale.startswith('ja-'):
            japanese_voices.append(voice)
            
    return {
        "English": english_voices,
        "Hindi": hindi_voices,
        "Japanese": japanese_voices
    }

async def speak_text(text: str, voice_name: str):
    """Generates TTS audio and auto-plays it using pygame."""
    print(f"Generating audio for voice: {voice_name}...")
    
    # We use tempfile to ensure the file path is safe and unique
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as tmp_file:
        temp_file_path = tmp_file.name
        
    try:
        # 1. Generate the MP3 using Edge-TTS
        communicate = edge_tts.Communicate(text=text, voice=voice_name)
        await communicate.save(temp_file_path)

        # 2. Initialize pygame mixer and load the MP3 file
        pygame.mixer.init()
        pygame.mixer.music.load(temp_file_path)
        pygame.mixer.music.play()

        # 3. Wait until the playback is entirely finished
        while pygame.mixer.music.get_busy():
            pygame.time.Clock().tick(10)

        # 4. Quit the mixer to release the file handle so it can be deleted
        pygame.mixer.quit()
        
    finally:
        # 5. Clean up the temporary MP3 file
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except OSError as e:
                print(f"Warning: Could not delete {temp_file_path}: {e}")


async def test_voices_for_language(language_name: str, voices: list, test_phrase: str):
    """Loops through a list of voices and plays a test phrase."""
    print(f"\n{'='*40}")
    print(f"Testing {len(voices)} {language_name} voices...")
    print(f"{'='*40}")
    
    for i, voice in enumerate(voices):
        short_name = voice['ShortName']
        gender = voice['Gender']
        locale = voice['Locale']
        
        print(f"\n[{i+1}/{len(voices)}] Playing {short_name} ({gender}, {locale})")
        # Announce the voice name before speaking the phrase (using the voice itself)
        intro_text = f"Voice {short_name}. {test_phrase}"
        
        await speak_text(intro_text, short_name)
        
        # Add a short delay between voices
        await asyncio.sleep(1)

async def main():
    # 1. Get the filtered lists
    voices_dict = await get_filtered_voices()
    
    # Define the phrases you want to test in different languages
    test_phrases = {
        "English": "This is a test of the text to speech engine.",
        "Japanese": "Hello! Surya I hope you are doing well, how about lets go on a adventure",
        "Hindi": "यह हिंदी आवाज़ का परीक्षण है। Hello! Surya I hope you are doing well, how about lets go on a adventure"
    }

    # 2. You can choose which languages to test here. 
    # To test everything, leave all three uncommented.
    # Warning: Testing ALL English voices will take a long time, as there are many!
    
    #await test_voices_for_language("Hindi", voices_dict["Hindi"], test_phrases["Hindi"])
    await test_voices_for_language("Japanese", voices_dict["Japanese"], test_phrases["Japanese"])
    #await test_voices_for_language("English", voices_dict["English"], test_phrases["English"])
    
    print("\nFinished testing all selected voices.")

if __name__ == "__main__":
    asyncio.run(main())