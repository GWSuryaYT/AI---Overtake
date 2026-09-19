## What we built

### Backend (`/backend`)
- **FastAPI + WebSockets**: Real-time communication server initialized in `main.py`.
- **STT (Speech-to-Text)**: `faster-whisper` (`tiny.en`) loaded via `audio_processing/stt.py` using CPU int8 execution to guarantee VRAM usage remains strictly under budget.
- **TTS (Text-to-Speech)**: `silero-tts` loaded via `audio_processing/tts.py` to synthesize speech using very minimal memory footprint.
- **LLM Agent**: `llm_agent/ollama_client.py` connects to your local Ollama instance on port 11434 with a strict 2048 token context window.

### Frontend (`/frontend`)
- **Electron Shell**: A transparent, borderless, always-on-top frameless window initialized in `main.cjs`.
- **Three.js VRM Renderer**: Renders the 3D VRM model with basic lighting, and includes idle animations (chest breathing & head swaying) and blinking (`src/renderer.js`).
- **Lip Sync & Audio Capture**: Web Audio API connects to the WebSocket to decode speech, analyze volume, map it to mouth blendshapes (`src/audio_sync.js`), and includes logic to hold the **Spacebar** to record microphone audio and send it to the backend for transcription!

## ⚠️ Action Required Before Running

> [!WARNING]
> You must place a `.vrm` 3D model file at the following path before starting the frontend:
> [frontend/public/models/avatar.vrm](file:///C:/Users/surya/Desktop/workspace/Webapp%20Projects/AI%20-%20Overtake/frontend/public/models)
> 
> Ensure your local Ollama is running and has the `llama3.1` or `qwen3.1` model downloaded.

## How to Run

You will need two separate terminal tabs.

### 1. Start the Backend
Navigate to the `backend` folder and run the FastAPI server:
```powershell
cd backend
.\venv\Scripts\activate
uvicorn main:app --host 127.0.0.1 --port 8000
```

### 2. Start the Frontend
Navigate to the `frontend` folder. Start the Vite dev server, and then Electron in another terminal (or concurrently):
```powershell
cd frontend
npm run dev
```

Open a third terminal in `frontend`:
```powershell
cd frontend
npm start
```
*(This starts Electron, which loads the transparent Vite app).*

## Interacting with the Pet
- **Move the Pet**: Click and drag anywhere on the 3D model to move the floating window around your screen.
- **Speak**: Click the window once (to authorize Web Audio API), then press and hold the **Spacebar** to speak into your microphone. Release the spacebar to send the audio for processing. The model will respond and lip-sync to the answer!