"""
Central Cue Vocabulary & Synonym Mapping for Anna Avatar Engine.
Single source of truth for emotions, gestures, gaze targets, and prompt rendering.
"""
import json
from pathlib import Path
from typing import Dict, Optional, Tuple, Set, Any

VOCAB_PATH = Path(__file__).resolve().parent.parent.parent / "frontend" / "src" / "avatar" / "cue_vocab.json"

def _load_vocab() -> Dict[str, Any]:
    with open(VOCAB_PATH, "r", encoding="utf-8") as f:
        return json.load(f)

_DATA = _load_vocab()

# Allowed canonical emotions
EMOTIONS: Set[str] = set(_DATA["emotions"])

# Emotion synonyms / aliases mapping to canonical emotions
EMOTION_SYNONYMS: Dict[str, str] = _DATA["emotion_synonyms"]

# Allowed canonical gestures
GESTURES: Set[str] = set(_DATA["gestures"])

# Gesture synonyms
GESTURE_SYNONYMS: Dict[str, str] = _DATA["gesture_synonyms"]

# Allowed canonical gaze targets
GAZE_TARGETS: Set[str] = set(_DATA["gaze_targets"])

# Gaze synonyms
GAZE_SYNONYMS: Dict[str, str] = _DATA["gaze_synonyms"]

# Internal gestures (not LLM reachable)
INTERNAL_GESTURES: Set[str] = set(_DATA.get("internal_gestures", []))

# Stage directions
STAGE_DIRECTIONS: Dict[str, Any] = _DATA.get("stage_directions", {})



def canonicalize_cue(key: str, value: str, raw_intensity: Optional[float] = None) -> Optional[Tuple[str, str, float]]:
    """
    Validates and canonicalizes a parsed cue.
    Returns (key, canonical_value, intensity) or None if invalid.
    """
    k = key.strip().lower()
    v = value.strip().lower()

    intensity = 1.0
    if raw_intensity is not None:
        try:
            val = float(raw_intensity)
            intensity = max(0.1, min(1.0, val))
        except (ValueError, TypeError):
            intensity = 1.0

    if k in ("emotion", "emo"):
        canonical = EMOTION_SYNONYMS.get(v, v)
        if canonical in EMOTIONS:
            return ("emotion", canonical, intensity)
        return None

    if k in ("gesture", "gest"):
        canonical = GESTURE_SYNONYMS.get(v, v)
        if canonical in GESTURES:
            return ("gesture", canonical, intensity)
        return None

    if k in ("gaze", "look"):
        canonical = GAZE_SYNONYMS.get(v, v)
        if canonical in GAZE_TARGETS:
            return ("gaze", canonical, intensity)
        return None

    return None


def render_cue_prompt() -> str:
    """
    Generates the system prompt addition ensuring documentation matches vocabulary exactly.
    Kept concise and focused to prevent overwhelming smaller models or suppressing tool calls.
    """
    emotions_str = ", ".join(sorted(EMOTIONS))
    gestures_str = ", ".join(sorted(GESTURES))
    gaze_str = ", ".join(sorted(GAZE_TARGETS))

    return f"""#### Avatar Expressive Cues (Spoken Dialogue Only)
In your spoken conversational responses, you may prepend cue tags in square brackets to control your avatar's expressions:
Format: [emotion: NAME, STRENGTH] [gesture: NAME] [gaze: NAME]   (STRENGTH is 0.1 to 1.0, optional)
emotions: {emotions_str}
gestures: {gestures_str}
gaze: {gaze_str}
Example: "[emotion: happy][gesture: waving] Right away, Surya!"

Rules:
- Expressive cues are strictly for spoken conversational text. NEVER use cues inside tool arguments.
- NEVER substitute spoken text with cues for an actual tool call. When asked to perform computer tasks, you MUST invoke `access_computer_tool` as function call.
"""