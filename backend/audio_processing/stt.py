import os
import tempfile
import traceback
from faster_whisper import WhisperModel

# Load the model once at startup.
# tiny.en + int8 on CPU keeps VRAM free for the LLM.
model_size = "tiny.en"
print(f"[STT] Loading faster-whisper model '{model_size}' (int8, CPU)...")
model = WhisperModel(model_size, device="cpu", compute_type="int8")
print("[STT] Model loaded.")

def transcribe_audio(audio_data: bytes) -> str:
    """
    Transcribes raw audio bytes (webm from browser MediaRecorder) to text.
    faster-whisper uses its internal av/ffmpeg to decode audio formats.
    """
    if not audio_data or len(audio_data) < 100:
        print(f"[STT] Audio too small ({len(audio_data)} bytes), skipping.")
        return ""
        
    try:
        # Write to temp file — faster-whisper needs a file path
        with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
            f.write(audio_data)
            temp_path = f.name

        print(f"[STT] Transcribing {len(audio_data)} bytes from {temp_path}")
        segments, info = model.transcribe(
            temp_path, 
            beam_size=5, 
            condition_on_previous_text=False
        )
        text = "".join([segment.text for segment in segments])

        os.remove(temp_path)
        
        result = text.strip()
        print(f"[STT] Result: '{result}'")
        return result
    except Exception as e:
        print(f"[STT] Error: {e}")
        traceback.print_exc()
        return ""
