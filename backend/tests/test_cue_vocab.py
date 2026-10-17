import unittest
import json
from pathlib import Path
from backend.llm_agent.cue_vocab import (
    EMOTIONS,
    GESTURES,
    GAZE_TARGETS,
    EMOTION_SYNONYMS,
    GESTURE_SYNONYMS,
    GAZE_SYNONYMS,
    INTERNAL_GESTURES,
    canonicalize_cue,
    render_cue_prompt,
    VOCAB_PATH
)
from backend.llm_agent.cue_parser import CueParser

class TestCueVocab(unittest.TestCase):
    def setUp(self):
        with open(VOCAB_PATH, "r", encoding="utf-8") as f:
            self.json_data = json.load(f)

    def test_vocab_parity_with_json(self):
        """Python sets must match cue_vocab.json exactly."""
        self.assertEqual(EMOTIONS, set(self.json_data["emotions"]))
        self.assertEqual(GESTURES, set(self.json_data["gestures"]))
        self.assertEqual(GAZE_TARGETS, set(self.json_data["gaze_targets"]))
        self.assertEqual(EMOTION_SYNONYMS, self.json_data["emotion_synonyms"])
        self.assertEqual(GESTURE_SYNONYMS, self.json_data["gesture_synonyms"])
        self.assertEqual(GAZE_SYNONYMS, self.json_data["gaze_synonyms"])
        self.assertEqual(INTERNAL_GESTURES, set(self.json_data["internal_gestures"]))

    def test_emotions_resolve_to_emotion_map(self):
        """Every emotion in vocab must exist in emotion_map.json."""
        emotion_map_path = VOCAB_PATH.parent / "emotion_map.json"
        self.assertTrue(emotion_map_path.exists())
        with open(emotion_map_path, "r", encoding="utf-8") as f:
            emotion_map = json.load(f)
        for emo in EMOTIONS:
            self.assertIn(emo, emotion_map, f"Emotion '{emo}' in vocab missing from emotion_map.json")

    def test_gestures_resolve_to_library(self):
        """Every gesture in vocab must be 'none' or in gesture_library.json."""
        lib_path = VOCAB_PATH.parent / "gesture_library.json"
        self.assertTrue(lib_path.exists())
        with open(lib_path, "r", encoding="utf-8") as f:
            lib_data = json.load(f)
        programs = lib_data.get("GESTURE_LIBRARY", {})
        for g in GESTURES:
            if g == "none":
                continue
            self.assertIn(g, programs, f"Gesture '{g}' in vocab missing from gesture_library.json")

    def test_internal_gestures_resolve_to_library(self):
        """Internal gestures must exist in gesture_library.json."""
        lib_path = VOCAB_PATH.parent / "gesture_library.json"
        with open(lib_path, "r", encoding="utf-8") as f:
            lib_data = json.load(f)
        programs = lib_data.get("GESTURE_LIBRARY", {})
        for g in INTERNAL_GESTURES:
            self.assertIn(g, programs, f"Internal gesture '{g}' missing from gesture_library.json")

    def test_canonicalize_cues(self):
        """Synonyms and canonical cues must canonicalize properly."""
        for emo in EMOTIONS:
            res = canonicalize_cue("emotion", emo, 0.8)
            self.assertIsNotNone(res)
            self.assertEqual(res[1], emo)
            self.assertAlmostEqual(res[2], 0.8)

        for syn, canon in EMOTION_SYNONYMS.items():
            res = canonicalize_cue("emotion", syn)
            self.assertIsNotNone(res)
            self.assertEqual(res[1], canon)

        for gest in GESTURES:
            res = canonicalize_cue("gesture", gest)
            self.assertIsNotNone(res)
            self.assertEqual(res[1], gest)

        for syn, canon in GESTURE_SYNONYMS.items():
            res = canonicalize_cue("gesture", syn)
            self.assertIsNotNone(res)
            self.assertEqual(res[1], canon)

        for gaze in GAZE_TARGETS:
            res = canonicalize_cue("gaze", gaze)
            self.assertIsNotNone(res)
            self.assertEqual(res[1], gaze)

        for syn, canon in GAZE_SYNONYMS.items():
            res = canonicalize_cue("gaze", syn)
            self.assertIsNotNone(res)
            self.assertEqual(res[1], canon)

        # Invalid cues must return None
        self.assertIsNone(canonicalize_cue("emotion", "non_existent_emotion"))
        self.assertIsNone(canonicalize_cue("gesture", "non_existent_gesture"))
        self.assertIsNone(canonicalize_cue("gaze", "non_existent_gaze"))
        self.assertIsNone(canonicalize_cue("invalid_key", "happy"))

    def test_prompt_rendering(self):
        """Prompt rendering must list all canonical emotions, gestures, and gaze."""
        prompt = render_cue_prompt()
        for emo in EMOTIONS:
            self.assertIn(emo, prompt)
        for g in GESTURES:
            self.assertIn(g, prompt)
        for gz in GAZE_TARGETS:
            self.assertIn(gz, prompt)

    def test_cue_parser_e2e_streaming(self):
        """Stream chunks with cues and verify no tags leak into text."""
        parser = CueParser()
        full_text = ""
        cues = []
        stream = "[emotion: happy, 0.9][gesture: wave][gaze: user] Hello world! *smiles* How are you today? [emotion: thinking] Let me think."
        
        # Split at irregular small chunk boundaries to simulate LLM token stream
        chunks = [stream[i:i+3] for i in range(0, len(stream), 3)]
        for chunk in chunks:
            for evt_type, data in parser.parse_chunk(chunk):
                if evt_type == "text":
                    full_text += data
                elif evt_type == "cue":
                    cues.append(data)
        for evt_type, data in parser.flush():
            if evt_type == "text":
                full_text += data
            elif evt_type == "cue":
                cues.append(data)

        self.assertNotIn("[emotion:", full_text)
        self.assertNotIn("[gesture:", full_text)
        self.assertNotIn("[gaze:", full_text)
        self.assertNotIn("*smiles*", full_text)
        self.assertIn("Hello world!", full_text)
        self.assertIn("How are you today?", full_text)
        self.assertIn("Let me think.", full_text)

        # Check emitted cues
        keys = [c["key"] for c in cues]
        values = [c["value"] for c in cues]
        self.assertIn("happy", values)
        self.assertIn("wave", values)
        self.assertIn("user", values)
        self.assertIn("thinking", values)

if __name__ == "__main__":
    unittest.main()
