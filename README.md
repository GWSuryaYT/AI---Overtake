
# AI Overtake Assistant

AI Overtake is a 3D animated AI desktop assistant capable of running 100% locally or using cloud models. It leverages local large language models (via Ollama) or cloud LLMs (via Google Gemini API), local speech-to-text (STT), and local text-to-speech (Silero TTS) to create an interactive, private, and engaging voice assistant that lives right on your desktop.

The frontend features a fully rigged and animated 3D anime avatar (VRM format) that automatically syncs its lips to the spoken audio and reacts with animations based on the context of the conversation.

## 🚀 Features

* **Local or Cloud LLM Inference:** Run locally using Ollama, or switch to Google Gemini API if your computer lacks local AI hardware capabilities.
* **Autonomous Computer Worker (GUI Automation):** Powered by Gemini vision models (`gemini-3.1-flash-lite`) and PyAutoGUI, allowing the assistant to visually inspect your desktop, click elements via normalized bounding boxes, type text, open apps, scroll, and complete complex multi-step goals autonomously.
* **Session Cost & Token Tracking:** Built-in usage tracking that monitors prompt and output tokens turn-by-turn during computer automation and calculates estimated expenditure logged to `spending_data.json`.
* **3D Animated Avatar:** Uses `three-vrm` to render a 3D avatar on your desktop.
* **Real-time Lip Sync:** Analyzes the generated speech audio in real-time to match the avatar's mouth movements (visemes).
* **Contextual Animations & Facial Emotions:** Blends expressive facial blendshapes, gaze tracking, and contextual animations (Idle, Listening, Thinking, Talking, Waving) retargeted from Mixamo.
* **Voice Interaction:** Built-in microphone toggle bar to speak directly to the AI.
* **Dynamic Click-Through Overlay:** Clicks on transparent space pass through to background windows, while clicking directly on the avatar lets you drag and reposition the window freely.

## 🛠️ Tech Stack

* **Backend & Automation:** Python, FastAPI, WebSockets, PyAutoGUI, Google GenAI SDK, Pydantic, Silero TTS (Text-to-Speech)
* **Frontend:** Vite, HTML/CSS/JavaScript, Three.js, `@pixiv/three-vrm`
* **Desktop Wrapper:** Electron
* **AI Engine:** [Ollama](https://ollama.ai/) (Local) / [Google Gemini API](https://aistudio.google.com/) (Cloud Vision & LLM)

## 🏎️ Getting Started

### Prerequisites

1. **AI Model Engine (Choose One / Both):**
   * **Ollama (Local):** Download and install [Ollama](https://ollama.ai/). Make sure you have pulled your preferred model (e.g., `ollama run llama3`).
   * **Google Gemini API (Cloud & Computer Worker):** Used for cloud conversations and autonomous desktop automation:
     1. Head over to [Google AI Studio](https://aistudio.google.com/).
     2. Create and copy your Gemini API Key.
     3. Create a `.env` file inside the `backend` or `backend/llm_agent` directory.
     4. Add your API keys:
        ```env
        GEMINI_KEY=your_gemini_api_key_here
        GEMINI_KEY_PAID=your_paid_tier_gemini_key_here  # Used by computer_worker.py for vision tasks
        ```
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
   pip install pyautogui google-genai pydantic python-dotenv pillow
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

### Running the Autonomous Computer Worker

To run the desktop GUI automation agent independently for visual task execution:

```bash
python backend/llm_agent/computer_worker.py
```

The agent will capture the screen, plan the next interaction (click, type, open application, scroll), execute it with PyAutoGUI, and repeat until the target goal is completed.

---

## 💰 Token Usage & Cost Estimation Notice

The Computer Worker (`computer_worker.py`) performs multimodal visual reasoning by sending desktop screenshots on every turn:

* **Automated Cost Logging:** Every session tracks `input_tokens` and `output_tokens` across all turns and records the breakdown into `spending_data.json` with the format:
  ```json
  {
    "goal": "example goal",
    "turns": 5,
    "total_input_cost": 0.00125,
    "total_output_cost": 0.00075,
    "total_session_cost": 0.002,
    "timestamp": 1729000000.0
  }
  ```
* **⚠️ Check Standard Pricings:** 
  The cost calculations in `computer_worker.py` are baseline estimates (configured for `gemini-3.1-flash-lite` at ~$0.25 / 1M input tokens and ~$1.50 / 1M output tokens). Because visual screenshots consume significant prompt tokens each turn and API rates change over time, **always verify the latest official rates** on the [Google AI Studio / Gemini Pricing Page](https://ai.google.dev/pricing).
  > **Note:** Make sure your API key has appropriate billing and budget alerts configured in Google AI Studio / Google Cloud Console to prevent unexpected costs during extended automation loops.

---

## 🔮 Roadmap / Upcoming Features

* **Persistent Memory System:** We will soon be adding a persistent memory system (powered by vector embeddings and ChromaDB) to allow the assistant to retain long-term memories, user context, and preferences across sessions.
* **Integrated Voice-to-Action:** Direct invocation of the Computer Worker via avatar voice commands.

## 📂 Project Structure

* `/backend` - The FastAPI Python server handling TTS, STT, and Ollama/Gemini LLM streaming via WebSockets.
  * `/backend/llm_agent/computer_worker.py` - Autonomous GUI agent using Gemini vision + PyAutoGUI to interact with desktop apps.
  * `/backend/llm_agent/ollama_client.py` - LLM interaction logic supporting Ollama and Gemini fallback.
  * `/backend/llm_agent/storage.py` & `/backend/llm_agent/chunker.py` - Context storage and chunking utilities.
* `/frontend/src` - The Vite + Three.js application driving the VRM model, lip-sync, and animations.
* `/frontend/main.cjs` - The Electron main process script configuring the transparent, borderless desktop window.
* `/frontend/public/models` - Place your `.vrm` 3D avatars here.
* `/frontend/public/animations` - Place your Mixamo `.fbx` animation files here.
* `spending_data.json` - Generated session log containing token consumption and estimated costs from computer worker runs.
* `runner.py` - The master startup script.

## 🎭 Customizing the Avatar

To use your own 3D model:

1. Obtain a `.vrm` model (e.g., from VRoid Studio).
2. Rename it to `avatar.vrm` and replace the existing file in `frontend/public/models/`.
3. The app will automatically load and retarget the existing Mixamo `.fbx` animations to your new model!
