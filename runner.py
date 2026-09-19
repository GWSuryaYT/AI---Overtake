import subprocess
import time
import sys
import os

print("🚀 Starting full-stack application with Ollama...")

# ---------------------------------------------------------
# Step 1: Start Ollama (if not already running)
# ---------------------------------------------------------
print("-> Checking Ollama status...")

# Get the standard path to Ollama on Windows
local_app_data = os.environ.get("LOCALAPPDATA", "")
ollama_exe = os.path.join(local_app_data, "Programs", "Ollama", "ollama app.exe")

# Fallback path just in case
if not os.path.exists(ollama_exe):
    ollama_exe = os.path.join(os.environ.get("ProgramFiles", "C:\\Program Files"), "Ollama", "ollama app.exe")

ollama_process = None

# Check if Ollama is already running by checking the process list
try:
    tasks = subprocess.check_output('tasklist /FI "IMAGENAME eq ollama app.exe"', text=True)
    if "ollama app.exe" in tasks:
        print("   Ollama is already running.")
    else:
        if os.path.exists(ollama_exe):
            print("   Ollama is not running. Launching it now...")
            ollama_process = subprocess.Popen([ollama_exe])
            # Give Ollama a bit extra time to wake up and host its server
            time.sleep(4)
        else:
            print("❌ Warning: Could not find 'ollama app.exe' in standard installation paths.")
except Exception as e:
    print(f"⚠️ Could not check/start Ollama automatically: {e}")

# ---------------------------------------------------------
# Step 2: Start FastAPI Backend
# ---------------------------------------------------------
print("-> Starting FastAPI Backend...")
backend_exe = os.path.join("backend", "venv", "Scripts", "uvicorn.exe")

if not os.path.exists(backend_exe):
    backend_exe = os.path.join("backend", ".venv", "Scripts", "uvicorn.exe")

backend_process = subprocess.Popen(
    [backend_exe, "main:app", "--host", "127.0.0.1", "--port", "8000"],
    cwd="backend"
)
time.sleep(2)

# ---------------------------------------------------------
# Step 3: Start Vite Dev Server
# ---------------------------------------------------------
print("-> Starting Vite Dev Server...")
vite_process = subprocess.Popen(
    ["npm.cmd", "run", "dev"], 
    cwd="frontend"
)
time.sleep(2)

# ---------------------------------------------------------
# Step 4: Start Electron
# ---------------------------------------------------------
print("-> Starting Electron App...")
electron_process = subprocess.Popen(
    ["npm.cmd", "start"], 
    cwd="frontend"
)

print("\nAll systems are running! Press Ctrl+C here to terminate all tasks.")

# Keep the main script alive and handle clean shutdown
try:
    electron_process.wait()
except KeyboardInterrupt:
    print("\n🛑 Shutting down all processes...")
finally:
    backend_process.terminate()
    vite_process.terminate()
    electron_process.terminate()
    
    # Only kill Ollama if *this script* was the one that started it
    if ollama_process:
        print("-> Closing Ollama...")
        ollama_process.terminate()
        
    sys.exit(0)
