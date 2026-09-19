import tkinter as tk
from tkinter import ttk, scrolledtext, messagebox
import asyncio
import edge_tts
import threading
import tempfile
import os

# Hide pygame's default welcome message in the console
os.environ['PYGAME_HIDE_SUPPORT_PROMPT'] = "hide"
import pygame

class VoiceEditorApp:
    def __init__(self, root):
        self.root = root
        self.root.title("AI Voice & Pitch Studio")
        self.root.geometry("600x650")
        
        # Initialize the audio mixer for immediate playback
        pygame.mixer.init()
        self.current_audio_file = None
        
        self.all_voices = []
        self.locales = []
        self.locale_to_voices = {}

        self.setup_ui()
        self.load_voices_thread()
        
    def setup_ui(self):
        # Main Layout Frame
        frame = ttk.Frame(self.root, padding="20")
        frame.pack(fill=tk.BOTH, expand=True)

        # 1. Locality Selection
        ttk.Label(frame, text="1. Select Language / Locality (e.g., en-IN for Indian Accent, en-GB):", font=("Helvetica", 10, "bold")).pack(anchor=tk.W, pady=(0, 5))
        self.combo_locale = ttk.Combobox(frame, state="readonly", width=40)
        self.combo_locale.pack(fill=tk.X, pady=(0, 15))
        self.combo_locale.bind("<<ComboboxSelected>>", self.on_locale_change)

        # 2. Voice Model Selection
        ttk.Label(frame, text="2. Select Voice Model:", font=("Helvetica", 10, "bold")).pack(anchor=tk.W, pady=(0, 5))
        self.combo_voice = ttk.Combobox(frame, state="readonly", width=40)
        self.combo_voice.pack(fill=tk.X, pady=(0, 15))

        # 3. Text Input
        ttk.Label(frame, text="3. Enter Text to Synthesize:", font=("Helvetica", 10, "bold")).pack(anchor=tk.W, pady=(0, 5))
        self.text_area = scrolledtext.ScrolledText(frame, height=6, width=50, wrap=tk.WORD, font=("Helvetica", 11))
        self.text_area.pack(fill=tk.BOTH, expand=True, pady=(0, 15))
        
        # Default testing text loaded into the editor
        self.text_area.insert("1.0", "WE PROMISE WE DELIVER")

        # 4. Pitch Editor
        ttk.Label(frame, text="4. Pitch Editor (Hz):", font=("Helvetica", 10, "bold")).pack(anchor=tk.W)
        self.scale_pitch = tk.Scale(frame, from_=-50, to=50, orient=tk.HORIZONTAL, resolution=1)
        self.scale_pitch.set(0)
        self.scale_pitch.pack(fill=tk.X, pady=(0, 10))

        # 5. Rate (Speed) Editor
        ttk.Label(frame, text="5. Voice Speed Rate (%):", font=("Helvetica", 10, "bold")).pack(anchor=tk.W)
        self.scale_rate = tk.Scale(frame, from_=-50, to=50, orient=tk.HORIZONTAL, resolution=1)
        self.scale_rate.set(0)
        self.scale_rate.pack(fill=tk.X, pady=(0, 20))

        # Action Button
        self.btn_generate = ttk.Button(frame, text="Generate & Play Audio", command=self.generate_and_play)
        self.btn_generate.pack(fill=tk.X, ipady=5, pady=5)

        # Status Bar
        self.status_var = tk.StringVar()
        self.status_var.set("Connecting to Edge TTS servers to fetch latest voices...")
        self.status_label = ttk.Label(frame, textvariable=self.status_var, foreground="#555555")
        self.status_label.pack(anchor=tk.W, pady=(10, 0))

    def load_voices_thread(self):
        # Run network requests in a separate thread to avoid freezing the GUI
        threading.Thread(target=self.fetch_voices, daemon=True).start()

    def fetch_voices(self):
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            self.all_voices = loop.run_until_complete(edge_tts.list_voices())
            
            # Group the fetched voices by their Locale (e.g., 'en-IN', 'en-US')
            for voice in self.all_voices:
                loc = voice.get("Locale")
                if loc not in self.locale_to_voices:
                    self.locale_to_voices[loc] = []
                self.locale_to_voices[loc].append(voice)
            
            self.locales = sorted(list(self.locale_to_voices.keys()))
            
            # Update the UI from the background thread safely
            self.root.after(0, self.update_locale_dropdown)
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("Network Error", f"Failed to load voices: {e}"))

    def update_locale_dropdown(self):
        self.combo_locale['values'] = self.locales
        
        # Set a smart default if available
        if "en-IN" in self.locales:
            self.combo_locale.set("en-IN")
        elif "en-US" in self.locales:
            self.combo_locale.set("en-US")
        elif self.locales:
            self.combo_locale.set(self.locales[0])
            
        self.on_locale_change(None)
        self.status_var.set("Voices loaded successfully. Ready.")

    def on_locale_change(self, event):
        selected_locale = self.combo_locale.get()
        if not selected_locale:
            return
            
        voices_for_locale = self.locale_to_voices.get(selected_locale, [])
        
        # Format the dropdown to show ShortName and Gender
        formatted_voices = []
        for v in voices_for_locale:
            display_name = f"{v['ShortName']} | {v['Gender']}"
            formatted_voices.append(display_name)
            
        self.combo_voice['values'] = formatted_voices
        if formatted_voices:
            self.combo_voice.set(formatted_voices[0])

    def format_rate_pitch(self, val, is_pitch=False):
        # Edge-TTS expects formatting strictly like "+10Hz" or "-20%"
        val = int(float(val))
        sign = "+" if val >= 0 else ""
        unit = "Hz" if is_pitch else "%"
        return f"{sign}{val}{unit}"

    def generate_and_play(self):
        text = self.text_area.get("1.0", tk.END).strip()
        selected_voice_string = self.combo_voice.get()
        
        if not text or not selected_voice_string:
            messagebox.showwarning("Input Required", "Please ensure both text and a voice model are selected.")
            return
            
        # Extract just the ShortName (e.g., 'en-IN-PrabhatNeural') from the formatted string
        voice_short_name = selected_voice_string.split(" | ")[0]
        
        rate_str = self.format_rate_pitch(self.scale_rate.get(), is_pitch=False)
        pitch_str = self.format_rate_pitch(self.scale_pitch.get(), is_pitch=True)
        
        self.status_var.set("Synthesizing audio... Please wait.")
        self.btn_generate.config(state="disabled")
        
        # Run generation in background to keep GUI responsive
        threading.Thread(
            target=self.run_tts, 
            args=(text, voice_short_name, rate_str, pitch_str), 
            daemon=True
        ).start()

    def run_tts(self, text, voice, rate, pitch):
        try:
            # Create a temporary file to hold the MP3 audio
            fd, temp_path = tempfile.mkstemp(suffix=".mp3")
            os.close(fd)
            
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
            loop.run_until_complete(communicate.save(temp_path))
            
            self.root.after(0, lambda: self.play_audio(temp_path))
        except Exception as e:
            self.root.after(0, lambda: messagebox.showerror("TTS Error", str(e)))
            self.root.after(0, lambda: self.status_var.set("Error during synthesis."))
        finally:
            self.root.after(0, lambda: self.btn_generate.config(state="normal"))

    def play_audio(self, file_path):
        try:
            pygame.mixer.music.load(file_path)
            pygame.mixer.music.play()
            self.current_audio_file = file_path
            self.status_var.set("Playing audio...")
        except Exception as e:
            messagebox.showerror("Playback Error", f"Failed to play audio: {e}")
            self.status_var.set("Ready.")

if __name__ == "__main__":
    root = tk.Tk()
    app = VoiceEditorApp(root)
    root.mainloop()