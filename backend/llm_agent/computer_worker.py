from enum import Enum
from google import genai
from google.genai import types
from dotenv import load_dotenv
import os
import ctypes
import pyautogui
from pydantic import BaseModel, Field
from typing import List, Optional
import time
import json
from PIL import Image, ImageDraw
import webbrowser

from computer_layer_perser import scan_desktop
from web_layer_perser import get_web_parser

from pathlib import Path
load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env")

user32 = ctypes.windll.user32


# ─── Action Types ────────────────────────────────────────────────────────────

class ActionType(str, Enum):
    CLICK = "click"                 # Click element by ID (preferred) or box_2d fallback
    RIGHT_CLICK = "right_click"
    DOUBLE_CLICK = "double_click"
    TYPE = "type"                   # Click + type text (appends)
    CLEAR_AND_TYPE = "clear_and_type"  # Ctrl+A, Delete, then type new text
    PRESS_KEY = "press_key"         # Single key: enter, tab, escape, backspace, delete, etc.
    HOT_KEY = "hot_key"             # Key combo: ctrl+c, ctrl+a, alt+f4
    SCROLL_UP = "scroll_up"
    SCROLL_DOWN = "scroll_down"
    OPEN_APP = "open_app"
    OPEN_WEBSITE = "open_website"
    WAIT = "wait"
    COMPLETE = "complete"


# ─── Response Schema (Hybrid: element_id OR box_2d) ─────────────────────────

class UIAction(BaseModel):
    thought: str = Field(description="Brief reasoning (1-2 lines)")
    action: ActionType = Field(description="Action to perform")
    element_id: Optional[int] = Field(
        default=None,
        description="ID from element list (preferred targeting method)"
    )
    box_2d: Optional[List[int]] = Field(
        default=None,
        description="[ymin,xmin,ymax,xmax] 0-1000. Use ONLY when target is visible in screenshot but NOT in element list"
    )
    text_to_type: Optional[str] = Field(
        default=None,
        description="Text for type/clear_and_type"
    )
    key: Optional[str] = Field(
        default=None,
        description="Key for press_key (enter/tab/escape/backspace/delete/up/down/left/right)"
    )
    hot_key: Optional[str] = Field(
        default=None,
        description="Combo for hot_key (ctrl+a, ctrl+c, alt+f4)"
    )
    scroll_amount: Optional[int] = Field(
        default=None,
        description="Scroll clicks (default 500)"
    )
    app_or_web_name: Optional[str] = Field(
        default=None,
        description="App name or full URL (e.g. https://flights.google.com/)"
    )
    wait_time: Optional[int] = Field(
        default=3,
        description="Seconds for wait action"
    )


# ══════════════════════════════════════════════════════════════════════════════
# FILTER & OPTIMIZATION LAYER (Agent-Side)
# ══════════════════════════════════════════════════════════════════════════════

BLACKLISTED_NAMES = {
    # Window management / titlebar buttons
    "close", "minimize", "maximize", "restore", "restore down",
    "system menu bar", "system",
    # Browser chrome & static tools
    "reload", "back", "forward", "new tab", "close tab",
    "browser back", "browser forward", "extensions", "profile",
    "downloads", "bookmark", "bookmarks", "customize and control google chrome",
    "chrome menu", "settings and more", "more tools", "tab search", "side panel",
    # Taskbar & System tray clutter
    "start", "task view", "widgets", "copilot", "notification chevron",
    "show desktop", "show hidden icons", "clock", "network", "speakers", "volume"
}

BLACKLISTED_SUBSTRINGS = (
    "system tray", "running applications", "notification area"
)

TYPE_ULTRA_SHORT = {
    "Btn": "B",
    "Button": "B",
    "Edit": "E",
    "Menu": "M",
    "ListItem": "LI",
    "Check": "CK",
    "Radio": "R",
    "Combo": "CB",
    "Link": "L",
    "Tab": "T",
    "Tree": "TR",
    "SplitBtn": "SB",
}


def _get_foreground_window_name() -> str:
    """Returns the title of the currently focused/foreground window."""
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return ""
    buf = ctypes.create_unicode_buffer(512)
    user32.GetWindowTextW(hwnd, buf, 512)
    return buf.value.strip()


def _is_blacklisted(name: str) -> bool:
    clean = name.lower().strip()
    if clean in BLACKLISTED_NAMES:
        return True
    return any(sub in clean for sub in BLACKLISTED_SUBSTRINGS)

#--this filter is for computer_layer_perser.py
def filter_elements_for_prompt(raw_elements: list) -> tuple:
    """
    1. Scopes interactive element list to active window only.
    2. Drops shell noise, taskbar icons, window controls, and redundant tabs.
    3. Keeps background windows as single-line references.
    4. Compresses control types down to 1-2 characters.
    """
    fg_name = _get_foreground_window_name()
    fg_lower = fg_name.lower().strip()

    # 1. Group raw elements by window
    by_window = {}
    for el in raw_elements:
        win = el["window"] or "Desktop"
        by_window.setdefault(win, []).append(el)

    # 2. Resilient active window matching
    active_win_key = None
    for win_key in by_window:
        wk_lower = win_key.lower().strip()
        if wk_lower and (wk_lower in fg_lower or fg_lower in wk_lower):
            active_win_key = win_key
            break

    # Fallback to the top Z-order window from parser
    if active_win_key is None and by_window:
        active_win_key = next(iter(by_window))

    filtered = []
    new_id = 0
    id_remap = {}  # new_id -> old_id mapping for execution
    background_windows = []
    stats = {"raw": len(raw_elements), "blacklisted": 0, "background": 0}

    for win_key, win_elements in by_window.items():
        if win_key != active_win_key:
            background_windows.append(win_key)
            stats["background"] += len(win_elements)
            continue

        for el in win_elements:
            if _is_blacklisted(el["name"]):
                stats["blacklisted"] += 1
                continue

            ultra_type = TYPE_ULTRA_SHORT.get(el["type"], el["type"][:2])

            el_copy = el.copy()
            el_copy["id"] = new_id
            el_copy["type"] = ultra_type
            el_copy["_original_id"] = el["id"]
            id_remap[new_id] = el["id"]
            filtered.append(el_copy)
            new_id += 1

    stats["filtered"] = len(filtered)
    return filtered, background_windows, active_win_key or "Active Window", id_remap, stats


def format_elements_for_prompt(filtered_elements: list, background_windows: list, active_window: str) -> str:
    """Ultra-dense prompt format: minimal whitespace and symbols."""
    lines = []

    if filtered_elements:
        lines.append(f"[{active_window}]")
        for el in filtered_elements:
            val_str = f' ="{el["value"]}"' if el.get("value") else ""
            lines.append(f'#{el["id"]} {el["type"]} "{el["name"]}"{val_str}')
    else:
        lines.append("No interactive elements detected in active window.")

    if background_windows:
        lines.append(f"\nOther open windows: {', '.join(background_windows)}")

    return "\n".join(lines)


# ─── Main Agent ──────────────────────────────────────────────────────────────

class computer_agent:
    def __init__(self):
        self.ai_client = genai.Client(api_key=os.getenv("GEMINI_KEY_PAID"))
        self.web_perser = get_web_parser()
        print('Initialized GEMINI client & Web Bridge Parser.')

    def _get_screenshot_for_llm(self):
        screenshot = pyautogui.screenshot()
        screenshot.save('debug_screenshot.png')
        return screenshot

    def app_open(self, app: str):
        pyautogui.press('win')
        pyautogui.write(app, interval=0.1)
        pyautogui.press('enter', interval=0.1)

    def open_web(self, web: str):
        webbrowser.open(web)

    def work(self, goal: str):
        turn = 1
        session_tokens = {
            'input_tokens': 0,
            'output_tokens': 0,
            'total_tokens': 0
        }
        session_dir = Path("debug_logs") / time.strftime("%Y%m%d_%H%M%S")
        session_dir.mkdir(parents=True, exist_ok=True)
        print(f"Saving turn screenshots to: {session_dir}")

        try:
            complete = False
            print(f"Goal: {goal}")

            previous_actions = []

            system_instruction = (
                "You are a desktop GUI automation agent. You receive:\n"
                "1. A raw screenshot for full visual context (layout, web canvas, styling, forms).\n"
                "2. A filtered list of interactive elements inside the ACTIVE window:\n"
                "   [Active Window]\n"
                "   #ID Type \"Name\" =\"CurrentValue\"\n"
                "   Types: B=Button, E=Edit, M=Menu, LI=ListItem, CK=Checkbox, R=Radio, CB=ComboBox, L=Link, T=Tab\n\n"
                "TARGETING:\n"
                "- PREFER element_id whenever your target is listed (system executes an exact click).\n"
                "- Use box_2d [ymin,xmin,ymax,xmax] (0-1000) ONLY when the target is visible in the screenshot but missing from the element list (e.g., canvas elements, custom web pickers, Google Docs body).\n"
                "- Do not provide both element_id and box_2d.\n\n"
                "WINDOW & APP NAVIGATION:\n"
                "- Background windows are listed by name only (they do not have element IDs).\n"
                "- Switch windows using: hot_key='alt+tab', open_app='<name>', or open_website='<url>'.\n"
                "- 'open_website' opens browser URLs directly. Do not launch Chrome manually first.\n"
                "- In google chrome always use Narayan Chandra profile it have premium features.\n"
                "- Offload workspace writing/coding to built-in AI (e.g. Gemini button in Docs, Antigravity for code).\n\n"
                "TEXT FIELDS:\n"
                "- =\"value\" shows existing contents. Empty = no value.\n"
                "- Empty field → 'type'. Wrong value → 'clear_and_type'. Correct value → leave it alone.\n\n"
                "COMPLETION:\n"
                "- action='complete' ONLY when the goal is achieved and the final confirmation is visible.\n"
                "- After forms or searches, use 'wait' to allow the UI to finish updating before concluding."
            )

            while not complete:
                print("\n------------------------------------------------------")
                print(f"Turn: {turn}")
                print("------------------------------------------------------")

                # ── STEP 1: Scan UI elements (Web Bridge or Desktop) ──
                is_chrome_active = "chrome" in _get_foreground_window_name().lower()
                use_web_bridge = is_chrome_active and self.web_perser.is_connected()
                is_web_mode = False

                if use_web_bridge:
                    print("Active Chrome window detected & WebSocket bridge connected. Scanning via Web Layer Parser...")
                    self.web_perser.set_worker_status(True, f"Turn {turn}: Analyzing web page...")
                    raw_elements, scan_ms = self.web_perser.scan_web()
                    if raw_elements:
                        print(f"Web scan: {len(raw_elements)} elements in {scan_ms:.0f}ms")
                        is_web_mode = True
                    else:
                        print("Web scan returned 0 elements, falling back to desktop scan...")
                        raw_elements, scan_ms = scan_desktop(max_depth=25)
                else:
                    print("Scanning UI elements via universal desktop scanner...")
                    raw_elements, scan_ms = scan_desktop(max_depth=25)
                    print(f"Raw scan: {len(raw_elements)} elements in {scan_ms:.0f}ms")

                # ── STEP 2: Agent-side filtering ──
                if is_web_mode:
                    filtered = []
                    new_id = 0
                    id_remap = {}
                    for el in raw_elements:
                        ultra_type = TYPE_ULTRA_SHORT.get(el["type"], el["type"][:2])
                        el_copy = el.copy()
                        el_copy["id"] = new_id
                        el_copy["type"] = ultra_type
                        el_copy["_original_id"] = el["id"]
                        id_remap[new_id] = el["id"]
                        filtered.append(el_copy)
                        new_id += 1

                    active_win = self.web_perser.last_active_tab.get("title") or "Google Chrome"
                    bg_windows = [
                        f"Tab: {t['title']}" for t in self.web_perser.last_tabs_list
                        if not t.get("active") and t.get("title")
                    ]
                    print(f"Filtered (Web): {len(filtered)} elements kept | {len(bg_windows)} background tabs")
                else:
                    filtered, bg_windows, active_win, id_remap, stats = filter_elements_for_prompt(raw_elements)
                    print(f"Filtered: {stats['filtered']} kept | {stats['blacklisted']} blacklisted | {stats['background']} background items suppressed")

                raw_element_map = {el["id"]: el for el in raw_elements}

                # ── STEP 3: Capture full-fidelity screenshot ──
                full_screenshot = self._get_screenshot_for_llm()

                # ── STEP 4: Format ultra-dense prompt ──
                element_text = format_elements_for_prompt(filtered, bg_windows, active_win)
                history_text = "\n".join(previous_actions) if previous_actions else "None"

                prompt_text = (
                    f"Goal: {goal}\n"
                    f"Turn: {turn}\n"
                    f"Actions:\n{history_text}\n\n"
                    f"Elements:\n{element_text}\n\n"
                    f"Next action?"
                )

                print('Request sent...')
                start_time = time.perf_counter()
                results = self.ai_client.models.generate_content(
                    model='gemini-3.1-flash-lite',
                    contents=[prompt_text, full_screenshot],
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        response_mime_type="application/json",
                        response_schema=UIAction,
                        thinking_config=types.ThinkingConfig(thinking_budget=0),
                        max_output_tokens=300
                    )
                )
                end_time = time.perf_counter()
                print(f'Response in: {end_time - start_time:.2f}s')

                prompt_token_count = results.usage_metadata.prompt_token_count
                output_token_count = results.usage_metadata.candidates_token_count
                total_token_count = results.usage_metadata.total_token_count

                session_tokens['input_tokens'] += prompt_token_count
                session_tokens['output_tokens'] += output_token_count
                session_tokens['total_tokens'] += total_token_count

                print(f'Tokens this turn: {prompt_token_count} in / {output_token_count} out (Total: {total_token_count})')

                try:
                    command = UIAction.model_validate_json(results.text)
                    print(f'Executing: {command.action.value.upper()} -> {command.thought}')
                    if is_web_mode:
                        self.web_perser.set_worker_status(True, f"Turn {turn}: {command.action.value.upper()}")
                except Exception as parse_error:
                    print(f"Failed to parse UIAction: {parse_error}\nRaw: {results.text[:200]}")
                    continue

                # ── Record action log ──
                action_desc = f"{command.action.value}"
                if command.element_id is not None:
                    orig_id = id_remap.get(command.element_id, command.element_id)
                    el_info = raw_element_map.get(orig_id)
                    el_label = f'#{command.element_id}'
                    if el_info:
                        el_label += f'({el_info["name"][:20]})'
                    action_desc += f" {el_label}"
                if command.box_2d:
                    action_desc += f" @{command.box_2d}"
                if command.action in (ActionType.TYPE, ActionType.CLEAR_AND_TYPE) and command.text_to_type:
                    action_desc += f' "{command.text_to_type}"'
                elif command.action == ActionType.OPEN_APP and command.app_or_web_name:
                    action_desc += f' "{command.app_or_web_name}"'
                elif command.action == ActionType.OPEN_WEBSITE and command.app_or_web_name:
                    action_desc += f' "{command.app_or_web_name}"'
                if command.hot_key:
                    action_desc += f" [{command.hot_key}]"
                if command.key:
                    action_desc += f" [{command.key}]"
                if command.thought:
                    clean = command.thought.strip().replace('\n', ' ')
                    action_desc += f" | {clean}"

                previous_actions.append(f"{turn}. {action_desc}")
                if len(previous_actions) > 3:
                    previous_actions = previous_actions[-3:]

                self._save_debug_screenshot(command, id_remap, raw_element_map, full_screenshot, turn, session_dir)

                # ═══════════════ Execution Router ════════════════════════════

                target_x, target_y = None, None

                # Remap filtered ID to physical coordinate from raw scan
                if command.element_id is not None:
                    orig_id = id_remap.get(command.element_id)
                    if orig_id is not None:
                        target = raw_element_map.get(orig_id)
                        if target:
                            target_x, target_y = target["center_x"], target["center_y"]
                        else:
                            print(f"Error: Original element #{orig_id} not found.")
                    else:
                        print(f"Error: Filtered element #{command.element_id} has no mapped raw element.")

                elif command.box_2d and len(command.box_2d) == 4:
                    ymin, xmin, ymax, xmax = command.box_2d
                    screen_w, screen_h = pyautogui.size()
                    target_x = int(((xmin + xmax) / 2 / 1000) * screen_w)
                    target_y = int(((ymin + ymax) / 2 / 1000) * screen_h)
                    target_x = max(0, min(target_x, screen_w - 1))
                    target_y = max(0, min(target_y, screen_h - 1))

                # 1. Coordinate-based actions
                if command.action in (
                    ActionType.CLICK, ActionType.TYPE, ActionType.CLEAR_AND_TYPE,
                    ActionType.RIGHT_CLICK, ActionType.DOUBLE_CLICK
                ):
                    if target_x is None or target_y is None:
                        print("Error: No valid target (need element_id or box_2d).")
                        continue

                    pyautogui.moveTo(target_x, target_y, duration=0.1)

                    if command.action == ActionType.CLICK:
                        pyautogui.click()
                        pyautogui.sleep(0.3)

                    elif command.action == ActionType.RIGHT_CLICK:
                        pyautogui.rightClick()
                        pyautogui.sleep(0.3)

                    elif command.action == ActionType.DOUBLE_CLICK:
                        pyautogui.doubleClick()
                        pyautogui.sleep(0.3)

                    elif command.action == ActionType.TYPE:
                        pyautogui.click()
                        pyautogui.sleep(0.2)
                        if command.text_to_type:
                            pyautogui.write(command.text_to_type, interval=0.05)
                        else:
                            print('Error: type action but text_to_type is empty')

                    elif command.action == ActionType.CLEAR_AND_TYPE:
                        pyautogui.click()
                        pyautogui.sleep(0.1)
                        pyautogui.hotkey('ctrl', 'a')
                        pyautogui.sleep(0.05)
                        pyautogui.press('delete')
                        pyautogui.sleep(0.1)
                        if command.text_to_type:
                            pyautogui.write(command.text_to_type, interval=0.05)
                        else:
                            print('Error: clear_and_type but text_to_type is empty')

                # 2. Press single key
                elif command.action == ActionType.PRESS_KEY:
                    if command.key:
                        pyautogui.press(command.key.lower().strip())
                        pyautogui.sleep(0.3)
                    else:
                        print('Error: press_key but key is empty')

                # 3. Hot key combo
                elif command.action == ActionType.HOT_KEY:
                    if command.hot_key:
                        keys = [k.strip().lower() for k in command.hot_key.replace(",", "+").split("+")]
                        pyautogui.hotkey(*keys)
                        pyautogui.sleep(0.3)
                    else:
                        print('Error: hot_key but hot_key string is empty')

                # 4. Scroll
                elif command.action == ActionType.SCROLL_UP:
                    pyautogui.scroll(command.scroll_amount or 500)
                    pyautogui.sleep(0.5)
                elif command.action == ActionType.SCROLL_DOWN:
                    pyautogui.scroll(-(command.scroll_amount or 500))
                    pyautogui.sleep(0.5)

                # 5. Open app
                elif command.action == ActionType.OPEN_APP:
                    if command.app_or_web_name:
                        self.app_open(command.app_or_web_name)
                        time.sleep(3)
                    else:
                        print('Error: open_app but app_or_web_name is empty')

                # 6. Open website
                elif command.action == ActionType.OPEN_WEBSITE:
                    if command.app_or_web_name:
                        self.open_web(command.app_or_web_name)
                        time.sleep(3)
                    else:
                        print('Error: open_website but app_or_web_name is empty')

                # 7. Wait
                elif command.action == ActionType.WAIT:
                    time.sleep(command.wait_time or 3)

                # 8. Complete
                elif command.action == ActionType.COMPLETE:
                    if self.web_perser.is_connected():
                        self.web_perser.set_worker_status(False)
                    complete = True
                    break

                else:
                    print(f"Unknown action: {command.action}")
                    break

                time.sleep(1.5)
                turn += 1

        except KeyboardInterrupt:
            print("\nExecution interrupted by user.")

        finally:
            if hasattr(self, 'web_perser') and self.web_perser.is_connected():
                self.web_perser.set_worker_status(False)

            standard_input_price_per_million = 0.25
            standard_output_price_per_million = 1.50

            total_input_cost = session_tokens['input_tokens'] / 1_000_000 * standard_input_price_per_million
            total_output_cost = session_tokens['output_tokens'] / 1_000_000 * standard_output_price_per_million
            total_session_cost = total_input_cost + total_output_cost

            with open('spending_data.json', 'a') as f:
                log = {
                    'goal': goal,
                    'turns': turn,
                    'input_tokens': session_tokens['input_tokens'],
                    'output_tokens': session_tokens['output_tokens'],
                    'total_input_cost': total_input_cost,
                    'total_output_cost': total_output_cost,
                    'total_session_cost': total_session_cost,
                    'timestamp': time.time(),
                }
                f.write(json.dumps(log) + '\n')

            print(f'\n=== Session Summary ===')
            print(f'Turns: {turn}')
            print(f'Total tokens: {session_tokens["input_tokens"]} in / {session_tokens["output_tokens"]} out')
            print(f'Estimated cost: ${total_session_cost:.6f}')
            print('Saved to spending_data.json')

    def _save_debug_screenshot(self, command: UIAction, id_remap: dict, raw_element_map: dict, screenshot: Image.Image, turn: int, session_dir: Path):
        """Save a turn-specific debug screenshot highlighting the targeted element or box_2d region."""
        try:
            draw = ImageDraw.Draw(screenshot)

            if command.element_id is not None:
                orig_id = id_remap.get(command.element_id)
                if orig_id is not None and orig_id in raw_element_map:
                    target = raw_element_map[orig_id]
                    x1, y1, x2, y2 = target["rect"]
                    draw.rectangle([x1, y1, x2, y2], outline="red", width=3)

            elif command.box_2d and len(command.box_2d) == 4:
                ymin, xmin, ymax, xmax = command.box_2d
                draw.rectangle(
                    [
                        (xmin / 1000) * screenshot.width,
                        (ymin / 1000) * screenshot.height,
                        (xmax / 1000) * screenshot.width,
                        (ymax / 1000) * screenshot.height,
                    ],
                    outline="red",
                    width=3
                )

            filename = f"turn_{turn:02d}_{command.action.value}.png"
            screenshot.save(session_dir / filename)
            screenshot.save(session_dir / "latest_turn.png")
        except Exception as e:
            print(f"Debug screenshot error: {e}")


if __name__ == "__main__":
    obj = computer_agent()
    print('Starting in 3sec please close the vscode window.')
    time.sleep(3)
    obj.work("fill the form's required ones with full marks and write good in the typing areas and submit it in the end")