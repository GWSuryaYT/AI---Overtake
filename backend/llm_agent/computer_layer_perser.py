import ctypes
from ctypes import wintypes
import os
import time
import pyautogui
import uiautomation as auto
from PIL import ImageDraw, ImageFont, ImageGrab

user32 = ctypes.windll.user32
shcore = ctypes.windll.shcore

# 1. Enable Per-Monitor DPI Awareness
try:
    shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        user32.SetProcessDPIAware()
    except Exception:
        pass

SCREEN_WIDTH = 2560
SCREEN_HEIGHT = 1440
GA_ROOT = 2  # GetAncestor flag for the root owner window

INTERACTIVE_TYPES = {
    auto.ControlType.ButtonControl,
    auto.ControlType.EditControl,
    auto.ControlType.MenuItemControl,
    auto.ControlType.ListItemControl,
    auto.ControlType.CheckBoxControl,
    auto.ControlType.RadioButtonControl,
    auto.ControlType.ComboBoxControl,
    auto.ControlType.HyperlinkControl,
    auto.ControlType.TabItemControl,
    auto.ControlType.TreeItemControl,
    auto.ControlType.SplitButtonControl,
}

# Types where we should try to read the current text value
VALUE_TYPES = {
    auto.ControlType.EditControl,
    auto.ControlType.ComboBoxControl,
}

# Short type names to save tokens (no info lost, just shorter)
TYPE_SHORT = {
    "ButtonControl":      "Btn",
    "EditControl":        "Edit",
    "MenuItemControl":    "Menu",
    "ListItemControl":    "ListItem",
    "CheckBoxControl":    "Check",
    "RadioButtonControl": "Radio",
    "ComboBoxControl":    "Combo",
    "HyperlinkControl":   "Link",
    "TabItemControl":     "Tab",
    "TreeItemControl":    "Tree",
    "SplitButtonControl": "SplitBtn",
}


def is_on_screen(rect) -> bool:
    """Verifies that an element has physical dimensions and falls within monitor bounds."""
    if rect.width() <= 2 or rect.height() <= 2:
        return False
    if (
        rect.right <= 0
        or rect.left >= SCREEN_WIDTH
        or rect.bottom <= 0
        or rect.top >= SCREEN_HEIGHT
    ):
        return False
    return True


def get_top_level_windows_in_z_order():
    """Returns top-level visible windows in true front-to-back Z-order."""
    windows = []
    hwnd = user32.GetTopWindow(None)

    while hwnd:
        if user32.IsWindowVisible(hwnd) and not user32.IsIconic(hwnd):
            rect = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            w = rect.right - rect.left
            h = rect.bottom - rect.top
            if w > 0 and h > 0:
                windows.append((hwnd, (rect.left, rect.top, rect.right, rect.bottom)))
        hwnd = user32.GetWindow(hwnd, 2)  # GW_HWNDNEXT

    return windows


def is_rect_fully_occluded(rect, occluding_rects) -> bool:
    """Checks if a window rectangle is completely covered by windows in front of it."""
    r_left, r_top, r_right, r_bottom = rect
    for o_left, o_top, o_right, o_bottom in occluding_rects:
        if (
            o_left <= r_left
            and o_top <= r_top
            and o_right >= r_right
            and o_bottom >= r_bottom
        ):
            return True
    return False


def is_point_visible_to_window(x: int, y: int, expected_hwnd: int) -> bool:
    """Verifies with Win32 WindowFromPoint that (x, y) is not covered by a higher window."""
    point = wintypes.POINT(x, y)
    hit_hwnd = user32.WindowFromPoint(point)
    if not hit_hwnd:
        return False

    root_hit = user32.GetAncestor(hit_hwnd, GA_ROOT) or hit_hwnd
    root_expected = user32.GetAncestor(expected_hwnd, GA_ROOT) or expected_hwnd

    return root_hit == root_expected


def scan_desktop(max_depth: int = 25):
    """
    Scans the desktop adhering to Z-order and prunes dead branches recursively.
    Captures current text values for EditControl/ComboBoxControl elements.
    Filters out noise elements that have no name, no value, and aren't input fields.
    Uses short type names to save tokens.
    """
    start_time = time.perf_counter()
    z_windows = get_top_level_windows_in_z_order()

    elements = []
    element_id = 0
    covered_regions = []

    def traverse(control, current_depth, window_hwnd, win_name):
        nonlocal element_id
        if current_depth > max_depth:
            return

        c_rect = control.BoundingRectangle

        # --- EARLY BRANCH PRUNING ---
        # If this container is offscreen, collapsed, or outside screen bounds,
        # prune this entire branch immediately (skips thousands of hidden web elements)
        if not is_on_screen(c_rect) or control.IsOffscreen:
            return

        # Check for target actionable element
        if control.ControlType in INTERACTIVE_TYPES:
            cx = c_rect.xcenter()
            cy = c_rect.ycenter()

            # Hit-test element center against Z-order
            if is_point_visible_to_window(cx, cy, window_hwnd):
                x1 = max(0, c_rect.left)
                y1 = max(0, c_rect.top)
                x2 = min(SCREEN_WIDTH, c_rect.right)
                y2 = min(SCREEN_HEIGHT, c_rect.bottom)

                name = control.Name.strip()
                display_name = name[:50] if name else (control.AutomationId or "")

                # Capture current value for text-input controls
                value = ""
                if control.ControlType in VALUE_TYPES:
                    try:
                        vp = control.GetValuePattern()
                        if vp:
                            value = (vp.Value or "").strip()[:80]
                    except Exception:
                        pass

                # ── Noise filter ──
                # Drop elements with no name AND no value AND not an input field.
                # This kills invisible spacers/separators but keeps everything clickable.
                if not display_name and not value and control.ControlType not in VALUE_TYPES:
                    # skip this element - it has no name, no value, and isn't a text input
                    pass
                else:
                    if not display_name:
                        display_name = "Unnamed"

                    # Short type name
                    raw_type = control.ControlTypeName.replace("ControlTypeId", "")
                    short_type = TYPE_SHORT.get(raw_type, raw_type)

                    elements.append({
                        "id": element_id,
                        "window": win_name[:25],
                        "type": short_type,
                        "name": display_name,
                        "value": value,
                        "rect": (x1, y1, x2, y2),
                        "center_x": cx,
                        "center_y": cy,
                    })
                    element_id += 1

        # Traverse children directly
        try:
            children = control.GetChildren()
        except Exception:
            return

        for child in children:
            traverse(child, current_depth + 1, window_hwnd, win_name)

    for hwnd, win_rect in z_windows:
        # 1. Skip completely covered windows
        if is_rect_fully_occluded(win_rect, covered_regions):
            continue

        control_window = auto.ControlFromHandle(hwnd)
        if not control_window or not control_window.Exists(0, 0):
            continue

        c_wrect = control_window.BoundingRectangle
        if not is_on_screen(c_wrect) or control_window.IsOffscreen:
            continue

        win_name = (control_window.Name or control_window.ClassName or "Window").strip()

        # 2. Traverse window controls with recursive branch pruning
        traverse(control_window, 1, hwnd, win_name)

        # 3. Add to occluding regions for windows underneath
        covered_regions.append(win_rect)

    elapsed_ms = (time.perf_counter() - start_time) * 1000
    return elements, elapsed_ms


def save_annotated_preview(elements: list, output_path: str = "desktop_annotated.png"):
    screenshot = ImageGrab.grab(bbox=(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT), all_screens=True)
    draw = ImageDraw.Draw(screenshot)

    try:
        font = ImageFont.truetype("arial.ttf", 12)
    except IOError:
        font = ImageFont.load_default()

    for el in elements:
        x1, y1, x2, y2 = el["rect"]
        tag = f"[{el['id']}]"

        draw.rectangle([x1, y1, x2, y2], outline="#00FF66", width=2)

        badge_w = len(tag) * 8 + 4
        badge_h = 14
        badge_y = max(0, y1 - badge_h)

        draw.rectangle([x1, badge_y, x1 + badge_w, badge_y + badge_h], fill="#000000")
        draw.text((x1 + 2, badge_y), tag, fill="#00FF66", font=font)

    screenshot.save(output_path)
    print(f"Preview screenshot saved to: {os.path.abspath(output_path)}")


if __name__ == "__main__":
    MAX_DEPTH = 30

    print(f"Scanning 2560x1440 display with Branch Pruning (max depth = {MAX_DEPTH})...")

    time.sleep(3)

    elements, duration = scan_desktop(max_depth=MAX_DEPTH)

    print(f"Scan complete in {duration:.1f}ms. Found {len(elements)} actionable elements on screen.\n")

    print("=" * 90)
    print(f"{'ID':<6} | {'Window':<25} | {'Type':<10} | {'Name':<30} | {'Value'}")
    print("=" * 90)
    for el in elements:
        val = el.get("value", "")
        val_display = f'"{val}"' if val else ""
        print(f"[{el['id']:<4}] | {el['window']:<25} | {el['type']:<10} | {el['name']:<30} | {val_display}")
    print("=" * 90)

    save_annotated_preview(elements, "debug_screenshot_perser.png")
