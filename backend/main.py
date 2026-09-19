import re
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn
import asyncio
from llm_agent.ollama_client import generate_response_stream
from audio_processing.stt import transcribe_audio
from audio_processing.tts import synthesize_speech

app = FastAPI(title="Project Antigravity Backend")

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Project Antigravity Backend Running"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            # We can receive binary (audio for STT) or text (direct prompt)
            message = await websocket.receive()
            
            if "bytes" in message and message["bytes"]:
                audio_data = message["bytes"]
                print(f"Received audio chunk ({len(audio_data)} bytes)")
                
                # 1. STT
                user_text = await asyncio.to_thread(transcribe_audio, audio_data)
                print(f"STT result: '{user_text}'")
                
                if not user_text:
                    await websocket.send_text("[DONE]")
                    continue
                    
                # Tell frontend: "I heard you, now thinking…"
                await websocket.send_text("[STT_OK]")
                
            elif "text" in message and message["text"]:
                user_text = message["text"]
                print(f"Received text: '{user_text}'")
                await websocket.send_text("[STT_OK]")
            else:
                continue
                
            # 2. LLM → stream text → buffer into sentences → TTS each sentence
            sentence_buffer = ""
            sentence_end_pattern = re.compile(r'(?<=[.!?])\s+')
            first_audio = True
            
            async for chunk in generate_response_stream(user_text):
                sentence_buffer += chunk
                
                if any(p in sentence_buffer for p in ['.', '!', '?']):
                    parts = sentence_end_pattern.split(sentence_buffer)
                    if len(parts) > 1:
                        sentence_to_synth = parts[0]
                        sentence_buffer = " ".join(parts[1:])
                        
                        if sentence_to_synth.strip():
                            print(f"TTS: {sentence_to_synth}")
                            
                            if first_audio:
                                await websocket.send_text("[SPEAKING]")
                                first_audio = False
                            
                            wav_bytes = await asyncio.to_thread(
                                synthesize_speech, sentence_to_synth
                            )
                            if wav_bytes:
                                await websocket.send_bytes(wav_bytes)
                                
            # Flush remaining buffer
            if sentence_buffer.strip():
                print(f"TTS (flush): {sentence_buffer}")
                if first_audio:
                    await websocket.send_text("[SPEAKING]")
                wav_bytes = await asyncio.to_thread(
                    synthesize_speech, sentence_buffer
                )
                if wav_bytes:
                    await websocket.send_bytes(wav_bytes)
            
            await websocket.send_text("[DONE]")
            
    except WebSocketDisconnect:
        print("Client disconnected")
    except Exception as e:
        print(f"WebSocket error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
