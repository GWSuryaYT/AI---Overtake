from enum import Enum
from google import genai
from google.genai import types
from dotenv import load_dotenv
import os
import pyautogui
from pydantic import BaseModel, Field
from typing import List, Optional
import time


load_dotenv()

class ActionType(str, Enum):
    CLICK = "click"
    TYPE = "type"
    PRESS_ENTER = "press_enter"
    COMPLETE = "complete"
    SCROLL_UP = "scroll_up"
    SCROLL_DOWN = "scroll_down"
    OPEN_APP = "open_app"


# Compact schema descriptions to reduce OpenAPI token footprint
class UIAction(BaseModel):
    action: ActionType = Field(description="Action to perform")
    box_2d: Optional[List[int]] = Field(
        default=None,
        description="[ymin, xmin, ymax, xmax] normalized 0-1000 for click/type"
    )
    text_to_type: Optional[str] = Field(
        default=None, 
        description="Text to type when action='type'"
    )
    scroll_amount: Optional[int] = Field(
        default=None, 
        description="Scroll amount (default 500)"
    )
    app_name: Optional[str] = Field(
        default=None, 
        description="App name when action='open_app'"
    )
    label: str = Field(description="Target element or brief intent")


class computer_agent:
    def __init__(self):
        self.ai_client = genai.Client(api_key=os.getenv("GEMINI_KEY"))
        print('Initialized GEMINI client.')
    
    def screen_shot(self):
        try:
            image = pyautogui.screenshot()
            return image
        except Exception as e:
            print(f"Error taking screenshot: {e}")

    def app_open(self, app: str):
        pyautogui.press('win')
        pyautogui.write(app, interval=0.1)
        pyautogui.press('enter', interval=0.1)

    def work(self, goal: str):
        complete = False
        print(f"Goal: {goal}")

        turn = 1
        previous_actions = []

        system_instruction = (
            "You are a desktop GUI automation agent. Analyze the screenshot and return the single next UIAction to achieve the user's goal.\n"
            "- For click/type: box_2d must be [ymin, xmin, ymax, xmax] normalized 0-1000.\n"
            "- For type: specify text_to_type.\n"
            "- When the goal is completed: action='complete'."
        )

        while not complete:
            print("\n------------------------------------------------------")
            print(f"Turn: {turn}")
            print("------------------------------------------------------")
            
            # take screenshot
            image = self.screen_shot()

            # Format compact history to minimize tokens while preserving context
            history_text = "\n".join(previous_actions) if previous_actions else "None"

            # Dense, high-signal per-turn prompt
            prompt = (
                f"Goal: {goal}\n"
                f"Turn: {turn}\n"
                f"Recent actions:\n{history_text}\n\n"
                f"Determine the next action from the screenshot."
            )

            print('Request sent...')
            start_time = time.perf_counter()
            results = self.ai_client.models.generate_content(
                model='gemini-3.1-flash-lite',
                contents=[prompt, image],
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    response_mime_type="application/json",
                    response_schema=UIAction,
                    thinking_config=types.ThinkingConfig(thinking_budget=0)
                )
            )
            end_time = time.perf_counter()
            print(f'Response received in: {end_time - start_time:.2f}s')

            try:
                command = UIAction.model_validate_json(results.text)
                print(f'Executing: {command.action.value.upper()} -> {command.label}')
            except Exception as parse_error:
                print(
                    f"Failed to parse UIAction: {parse_error}\n"
                    f"Raw response: {results.text[:200]}"
                )
                continue

            # Record compact action log for future turns (avoids JSON null padding)
            action_desc = f"{command.action.value}"
            if command.action == ActionType.TYPE and command.text_to_type:
                action_desc += f' "{command.text_to_type}"'
            elif command.action == ActionType.OPEN_APP and command.app_name:
                action_desc += f' "{command.app_name}"'
            if command.box_2d:
                action_desc += f" @ {command.box_2d}"
            if command.label:
                action_desc += f" ({command.label})"

            previous_actions.append(f"{turn}. {action_desc}")
            if len(previous_actions) > 3:
                previous_actions = previous_actions[-3:]

            #---------------Execution Router--------------------
            # 1. Handle coordinate based movements (click & type):
            if command.action in [ActionType.CLICK, ActionType.TYPE]:
                if not command.box_2d:
                    print("Error: Missing box_2d coordinate required for this action.")
                    continue

                ymin, xmin, ymax, xmax = command.box_2d
                center_norm_x = (xmax + xmin) / 2
                center_norm_y = (ymax + ymin) / 2

                screen_width, screen_height = pyautogui.size()
            
                real_x = int((center_norm_x / 1000) * screen_width)
                real_y = int((center_norm_y / 1000) * screen_height)

                # Safeguard: Clamp coordinates to actual screen boundaries
                real_x = max(0, min(real_x, screen_width - 1))
                real_y = max(0, min(real_y, screen_height - 1))

                pyautogui.moveTo(real_x, real_y, duration=0.1)
                pyautogui.click()
                pyautogui.sleep(0.3)

                if command.action == ActionType.TYPE:
                    if command.text_to_type:
                        pyautogui.write(command.text_to_type, interval=0.1)
                    else:
                        print('Error: Type action selected but text_to_type was empty')

            # 2. Handle scroll actions
            elif command.action == ActionType.SCROLL_UP:
                scroll_amount = command.scroll_amount or 500
                pyautogui.scroll(scroll_amount)
                pyautogui.sleep(0.5)
            elif command.action == ActionType.SCROLL_DOWN:
                scroll_amount = command.scroll_amount or 500
                pyautogui.scroll(-scroll_amount)
                pyautogui.sleep(0.5)
            
            # 3. Handle press enter actions
            elif command.action == ActionType.PRESS_ENTER:
                pyautogui.press('enter')
                pyautogui.sleep(0.5)
            
            # 4. Handle open app actions
            elif command.action == ActionType.OPEN_APP:
                if command.app_name:
                    self.app_open(command.app_name)
                else:
                    print('Error: open_app action selected but app_name was empty')

            # 5. Handle completion signals
            elif command.action == ActionType.COMPLETE:
                complete = True
                break

            else:
                print(f"Unknown action: {command.action}")
                break
            
            turn += 1


if __name__ == "__main__":
    obj = computer_agent()
    obj.work("go to google flights and show me all flights from goa to delhi")