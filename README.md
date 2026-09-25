# AI Overtake Assistant

AI Overtake is a fully local, 3D animated AI desktop assistant. It leverages local large language models (via Ollama), local speech-to-text (STT), and local text-to-speech (Silero TTS) to create an interactive, private, and engaging voice assistant that lives right on your desktop.

The frontend features a fully rigged and animated 3D anime avatar (VRM format) that automatically syncs its lips to the spoken audio and reacts with animations based on the context of the conversation.

## 🌟 Features

* **100% Local & Private:** No cloud APIs required. Runs entirely on your own hardware using Ollama for LLM inference.
* **3D Animated Avatar:** Uses `three-vrm` to render a 3D avatar on your desktop.
* **Real-time Lip Sync:** Analyzes the generated speech audio in real-time to match the avatar's mouth movements (visemes).
* **Contextual Animations:** The avatar seamlessly transitions between states (Idle, Listening, Thinking, Talking, Waving) based on the conversation flow using retargeted Mixamo animations.
* **Voice Interaction:** Built-in microphone toggle bar to speak directly to the AI.
* **Desktop Overlay:** Runs in a borderless Electron window designed to overlay on your desktop like a traditional widget.

## 🏗️ Tech Stack

* **Backend:** Python, FastAPI, WebSockets, Silero TTS (Text-to-Speech)
* **Frontend:** Vite, HTML/CSS/JavaScript, Three.js, `@pixiv/three-vrm`
* **Desktop Wrapper:** Electron
* **AI Engine:** [Ollama](https://ollama.ai/)

## 🚀 Getting Started

### Prerequisites

1. **Ollama:** Download and install [Ollama](https://ollama.ai/). Make sure you have pulled your preferred model (e.g., `ollama run llama3`).
2. **Node.js:** Ensure you have Node.js installed for the frontend and Electron.
3. **Python 3.10+:** Ensure you have Python installed.

### Installation

1. **Clone the repository**
2. **Setup the Python Backend:**
   ```bash
   cd backend
   python -m venv venv
   # Activate venv: `venv\Scripts\activate` (Windows) or `source venv/bin/activate` (Mac/Linux)
   pip install -r requirements.txt
   cd ..
   ```
3. **Setup the Frontend/Electron:**
   ```bash
   cd frontend
   npm install
   cd ..
   ```

### Running the App

We have included a convenient unified runner script that automatically starts Ollama, the FastAPI backend, the Vite dev server, and the Electron app simultaneously!

Simply run:
```bash
python runner.py
```

*When you're done, pressing `Ctrl+C` in the terminal will gracefully shut down all the spawned processes.*

## 📁 Project Structure

* `/backend` - The FastAPI Python server handling TTS, STT, and Ollama LLM streaming via WebSockets.
* `/frontend/src` - The Vite + Three.js application driving the VRM model, lip-sync, and animations.
* `/frontend/main.cjs` - The Electron main process script configuring the transparent, borderless desktop window.
* `/frontend/public/models` - Place your `.vrm` 3D avatars here.
* `/frontend/public/animations` - Place your Mixamo `.fbx` animation files here.
* `runner.py` - The master startup script.

## 🎨 Customizing the Avatar

To use your own 3D model:
1. Obtain a `.vrm` model (e.g., from VRoid Studio).
2. Rename it to `avatar.vrm` and replace the existing file in `frontend/public/models/`.
3. The app will automatically load and retarget the existing Mixamo `.fbx` animations to your new model!
