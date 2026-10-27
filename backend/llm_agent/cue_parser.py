"""
Streaming Cue Parser for Anna Avatar Engine.
State-machine parser that extracts [emotion: ...], [gesture: ...], [gaze: ...] tags
from a streaming token stream without leaking tags or stage directions into speech.
"""
import re
from typing import List, Tuple, Dict, Any, Optional
from .cue_vocab import canonicalize_cue, STAGE_DIRECTIONS

# Tag item pattern: key: value or key: value, intensity
# Supports both single tag [emotion: happy, 0.8] and multi-tag [emotion: happy, gesture: wave]
TAG_ITEM_REGEX = re.compile(
    r'([a-zA-Z_]+)\s*:\s*([a-zA-Z_]+)(?:\s*,\s*([0-9]*\.?[0-9]+))?'
)

# Common stage direction mappings loaded from cue_vocab.json
STAGE_DIRECTION_MAP = STAGE_DIRECTIONS

MAX_TAG_HOLD = 60
MAX_STAGE_HOLD = 40


class CueParser:
    """
    Streaming parser that processes chunks and emits:
    - ("text", string)
    - ("cue", {"key": "emotion"|"gesture"|"gaze", "value": str, "intensity": float})
    """
    def __init__(self):
        self._buffer = ""

    def parse_chunk(self, chunk: str) -> List[Tuple[str, Any]]:
        """
        Feed a string chunk (e.g. from LLM stream).
        Returns a list of ('text', str) and ('cue', dict) events in order.
        """
        if not chunk:
            return []

        self._buffer += chunk
        events: List[Tuple[str, Any]] = []

        while self._buffer:
            # Find earliest potential control character: '[' or '*'
            b_idx = self._buffer.find('[')
            s_idx = self._buffer.find('*')

            # Neither found: everything is text
            if b_idx == -1 and s_idx == -1:
                events.append(("text", self._buffer))
                self._buffer = ""
                break

            # Pick the earliest occurrence
            if b_idx != -1 and (s_idx == -1 or b_idx < s_idx):
                # Tag bracket '[' comes first
                if b_idx > 0:
                    events.append(("text", self._buffer[:b_idx]))
                    self._buffer = self._buffer[b_idx:]

                # Now self._buffer starts with '['
                close_idx = self._buffer.find(']')
                if close_idx != -1:
                    # We have a full [ ... ]
                    content = self._buffer[1:close_idx]
                    self._buffer = self._buffer[close_idx + 1:]

                    tag_matches = list(TAG_ITEM_REGEX.finditer(content))
                    if tag_matches:
                        for tm in tag_matches:
                            key, val, raw_int = tm.group(1), tm.group(2), tm.group(3)
                            canon = canonicalize_cue(key, val, float(raw_int) if raw_int else None)
                            if canon:
                                events.append(("cue", {
                                    "key": canon[0],
                                    "value": canon[1],
                                    "intensity": canon[2]
                                }))
                        # Strip from text so it is never spoken aloud
                    elif any(c in content.lower() for c in ("emotion", "gesture", "gaze", "emo", "gest")):
                        # Malformed cue tag (e.g. [emotion: ]); discard so never spoken aloud
                        pass
                    else:
                        # Does not have cue identifiers -> normal prose like [1] or [Note]
                        events.append(("text", f"[{content}]"))
                else:
                    # Unclosed '[': check if we should release because it exceeded hold length or newline
                    if len(self._buffer) > MAX_TAG_HOLD or '\n' in self._buffer:
                        # Release the '[' as plain text and continue
                        events.append(("text", self._buffer[:1]))
                        self._buffer = self._buffer[1:]
                    else:
                        # Still waiting for closing ']'
                        break

            else:
                # Stage direction '*' comes first
                if s_idx > 0:
                    events.append(("text", self._buffer[:s_idx]))
                    self._buffer = self._buffer[s_idx:]

                # self._buffer starts with '*'
                # Look for second '*'
                close_idx = self._buffer.find('*', 1)
                if close_idx != -1:
                    content = self._buffer[1:close_idx].strip()
                    # If content is short words like *smiles*, consider it stage direction
                    if 0 < len(content) <= 30 and '\n' not in content:
                        self._buffer = self._buffer[close_idx + 1:]
                        # Check if mapped to a known cue
                        norm_word = content.lower()
                        if norm_word in STAGE_DIRECTION_MAP:
                            val_item = STAGE_DIRECTION_MAP[norm_word]
                            k, v, intens = val_item[0], val_item[1], val_item[2]
                            events.append(("cue", {"key": k, "value": v, "intensity": intens}))
                        # Stripped from text regardless!
                    else:
                        # Multiple lines or too long: release first '*' as text
                        events.append(("text", self._buffer[:1]))
                        self._buffer = self._buffer[1:]
                else:
                    # Unclosed '*'
                    if len(self._buffer) > MAX_STAGE_HOLD or '\n' in self._buffer:
                        events.append(("text", self._buffer[:1]))
                        self._buffer = self._buffer[1:]
                    else:
                        # Still waiting for closing '*'
                        break

        return self._collapse_text_events(events)

    def flush(self) -> List[Tuple[str, Any]]:
        """
        Flush any remaining held buffer as text at the end of stream.
        """
        events = []
        if self._buffer:
            events.append(("text", self._buffer))
            self._buffer = ""
        return events

    def _collapse_text_events(self, events: List[Tuple[str, Any]]) -> List[Tuple[str, Any]]:
        """
        Collapses consecutive ('text', ...) events into one.
        """
        if not events:
            return []
        collapsed = []
        current_text = []

        for evt_type, data in events:
            if evt_type == "text":
                current_text.append(data)
            else:
                if current_text:
                    collapsed.append(("text", "".join(current_text)))
                    current_text = []
                collapsed.append((evt_type, data))

        if current_text:
            collapsed.append(("text", "".join(current_text)))

        return collapsed
