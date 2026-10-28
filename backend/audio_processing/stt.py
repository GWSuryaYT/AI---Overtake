import io
import os
import tempfile
import traceback
import av
import speech_recognition as sr

# Initialize SpeechRecognition Recognizer
print("[STT] Initializing speech_recognition (Google Speech Recognition API)...")
recognizer = sr.Recognizer()
print("[STT] Recognizer ready.")


def _decode_to_audio_data(audio_data: bytes) -> sr.AudioData | None:
    """
    Decodes audio bytes (such as WebM/Opus from browser MediaRecorder, WAV, etc.)
    and converts them to a 16kHz mono 16-bit PCM AudioData instance for SpeechRecognition.
    """
    resampler = av.audio.resampler.AudioResampler(
        format="s16",
        layout="mono",
        rate=16000,
    )
    raw_buffer = io.BytesIO()
    input_source = io.BytesIO(audio_data)
    temp_path = None

    try:
        try:
            container = av.open(input_source, mode="r", metadata_errors="ignore")
        except Exception:
            # Fallback to temporary file if in-memory container probing fails
            with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
                f.write(audio_data)
                temp_path = f.name
            container = av.open(temp_path, mode="r", metadata_errors="ignore")

        with container:
            if not container.streams.audio:
                print("[STT] No audio stream found in container.")
                return None

            for frame in container.decode(audio=0):
                frame.pts = None
                resampled = resampler.resample(frame)
                if resampled:
                    for rf in resampled:
                        raw_buffer.write(rf.to_ndarray().tobytes())

            for rf in resampler.resample(None):
                raw_buffer.write(rf.to_ndarray().tobytes())

    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

    pcm_bytes = raw_buffer.getvalue()
    if not pcm_bytes:
        return None

    return sr.AudioData(pcm_bytes, sample_rate=16000, sample_width=2)


def transcribe_audio(audio_data: bytes) -> str:
    """
    Transcribes raw audio bytes (WebM from browser MediaRecorder) to text
    using speech_recognition.recognize_google.
    """
    if not audio_data or len(audio_data) < 100:
        print(f"[STT] Audio too small ({len(audio_data)} bytes), skipping.")
        return ""

    try:
        print(f"[STT] Decoding {len(audio_data)} audio bytes...")
        audio = _decode_to_audio_data(audio_data)
        if audio is None:
            print("[STT] Could not decode valid audio stream, skipping.")
            return ""

        print("[STT] Transcribing with Google Speech Recognition...")
        text = recognizer.recognize_google(audio)
        result = text.strip()
        print(f"[STT] Result: '{result}'")
        return result
    except sr.UnknownValueError:
        print("[STT] Google Speech Recognition could not understand audio.")
        return ""
    except sr.RequestError as e:
        print(f"[STT] Google Speech Recognition request failed: {e}")
        return ""
    except Exception as e:
        print(f"[STT] Error: {e}")
        traceback.print_exc()
        return ""
