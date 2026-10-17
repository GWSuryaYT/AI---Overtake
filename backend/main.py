import re
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn
import asyncio
from llm_agent.ollama_client import generate_response_stream
from audio_processing.stt import transcribe_audio
from audio_processing.tts import synthesize_speech

app = FastAPI(title="Project Ai - Automation Backend")

#do u want to use ollama's local models:
local_model = False

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Project Ai - Automation Backend Running"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    hands_free_mode = False
    last_chunk_hands_free = None
    try:
        while True:
            # We can receive binary (audio for STT) or text (direct prompt or config)
            message = await websocket.receive()
            
            if "bytes" in message and message["bytes"]:
                audio_data = message["bytes"]
                is_hands_free = last_chunk_hands_free if last_chunk_hands_free is not None else hands_free_mode
                last_chunk_hands_free = None  # Reset for next chunk
                print(f"Received audio chunk ({len(audio_data)} bytes, hands_free={is_hands_free})")
                
                # 1. STT
                user_text = await asyncio.to_thread(transcribe_audio, audio_data)
                print(f"STT result: '{user_text}'")
                
                if not user_text:
                    await websocket.send_text("[DONE]")
                    continue
                
                # In hands-free mode, ensure the trigger word "Anna" exists anywhere in the sentence
                if is_hands_free:
                    wake_word_pattern = re.compile(r'\b(anna|ana)\b', re.IGNORECASE)
                    if not wake_word_pattern.search(user_text):
                        print(f"🚫 [Hands-Free] Ignored utterance (wake word 'Anna' not found): '{user_text}'")
                        await websocket.send_text("[DONE]")
                        continue
                    print(f"✨ [Hands-Free] Wake word 'Anna' detected in: '{user_text}'")
                    
                # Tell frontend: "I heard you, now thinking…"
                await websocket.send_text("[STT_OK]")
                
            elif "text" in message and message["text"]:
                raw_text = message["text"]
                # Check if it's a control message
                try:
                    data = json.loads(raw_text)
                    if isinstance(data, dict):
                        msg_type = data.get("type")
                        if msg_type == "audio_meta":
                            last_chunk_hands_free = data.get("hands_free", False)
                            continue
                        elif msg_type == "set_hands_free":
                            hands_free_mode = data.get("enabled", False)
                            print(f"[WS] Hands-free mode set to: {hands_free_mode}")
                            continue
                except (json.JSONDecodeError, TypeError):
                    pass
                
                user_text = raw_text
                print(f"Received text: '{user_text}'")
                await websocket.send_text("[STT_OK]")
            else:
                continue
                
            # 2. LLM → stream text → parse cues → buffer into sentences → TTS each sentence
            from llm_agent.cue_parser import CueParser
            parser = CueParser()
            pending_cue = {}
            cue_id = 0
            sentence_buffer = ""
            sentence_end_pattern = re.compile(r'(?<=[.!?])\s+')
            first_audio = True

            async def send_sentence_audio(text_to_synth: str):
                nonlocal first_audio, pending_cue, cue_id
                clean_text = text_to_synth.strip()
                if not clean_text:
                    return

                print(f"TTS: {clean_text}")

                # Send pending cue frame right before the WAV audio if non-empty
                if pending_cue:
                    cue_id += 1
                    cue_payload = {"type": "cue", "id": cue_id, **pending_cue}
                    print(f"[WS] Sending cue frame: {cue_payload}")
                    await websocket.send_text(json.dumps(cue_payload))
                    pending_cue = {}

                if first_audio:
                    await websocket.send_text("[SPEAKING]")
                    first_audio = False

                wav_bytes = await asyncio.to_thread(synthesize_speech, clean_text)
                if wav_bytes:
                    await websocket.send_bytes(wav_bytes)

            async for raw_chunk in generate_response_stream(user_text):
                events = parser.parse_chunk(raw_chunk)
                for evt_type, data in events:
                    if evt_type == "cue":
                        pending_cue[data["key"]] = data["value"]
                        if "intensity" in data:
                            pending_cue["intensity"] = data["intensity"]
                    elif evt_type == "text":
                        sentence_buffer += data
                        if any(p in sentence_buffer for p in ['.', '!', '?']):
                            parts = sentence_end_pattern.split(sentence_buffer)
                            if len(parts) > 1:
                                for part in parts[:-1]:
                                    await send_sentence_audio(part)
                                sentence_buffer = parts[-1]

            # Flush remaining parser output
            for evt_type, data in parser.flush():
                if evt_type == "cue":
                    pending_cue[data["key"]] = data["value"]
                    if "intensity" in data:
                        pending_cue["intensity"] = data["intensity"]
                elif evt_type == "text":
                    sentence_buffer += data

            # Flush remaining sentence buffer
            if sentence_buffer.strip():
                await send_sentence_audio(sentence_buffer)

            # If cues remain with no sentence, send them before [DONE]
            if pending_cue:
                cue_id += 1
                cue_payload = {"type": "cue", "id": cue_id, **pending_cue}
                print(f"[WS] Sending trailing cue frame: {cue_payload}")
                await websocket.send_text(json.dumps(cue_payload))
                pending_cue = {}

            await websocket.send_text("[DONE]")
            
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"WebSocket error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
