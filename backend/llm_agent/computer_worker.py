from PIL.ImagePalette import load
from enum import Enum
from google import genai
from google.genai import types
from dotenv import load_dotenv
import os
import pyautogui
from pydantic import BaseModel
from typing import List, Optional
from pydantic import Field
import json


load_dotenv()

class ActionType(str, Enum):
    CLICK = "click"
    TYPE = "type"
    PRESS_ENTER = "press_enter"
    COMPLETE = "complete"
    SCROLL_UP = "scroll_up"
    SCROLL_DOWN = "scroll_down"


# 2. Upgrade the schema to support dynamic actions and text payloads
class UIAction(BaseModel):
    action: ActionType = Field(description="The action to perform on the target item.")
    box_2d: Optional[List[int]] = Field(
        default=None,
        description="The 2D bounding box of the target item as [ymin, xmin, ymax, xmax] normalized to 0-1000. Required for click and type actions."
    )
    text_to_type: Optional[str] = Field(
        default=None, 
        description="The text payload to type. REQUIRED only if the action is 'type'."
    )
    scroll_amount: Optional[int] = Field(
        default=None, 
        description="The amount to scroll. REQUIRED only if the action is 'scroll_up' or 'scroll_down'."
    )
    label: str = Field(description="Brief description of what the agent is targeting or doing.")


#intence object:
class computer_agent:
    def __init__(self):
        self.ai_client = genai.Client(api_key=os.getenv("GEMINI_KEY"))
        print('Intialized GEMINI INTENCE.')
    
    def screen_shot(self):
        try:
            image = pyautogui.screenshot()
            return image
        except Exception as e:
            print(f"Error taking screenshot: {e}")

    def app_open(self,app:str):
        pyautogui.press('win')
        pyautogui.write(app, interval=0.1)
        pyautogui.press('enter', interval=0.1)

    def work(self, goal:str):

        complete = False
        print(goal)

        turn = 1
        previous_actions_and_intends = []

        while not complete:
            print("\n------------------------------------------------------")
            print(f"Turn: {turn}")
            print("------------------------------------------------------")
            
            # take screenshot
            image = self.screen_shot()
            #------------------------------------------------------
            # call model
            #------------------------------------------------------
            prompt = (
                f"You are a desktop automation agent.\n"
                f"Current Turn: {turn}\n"
                f"Master Goal: {goal}\n\n"
                f"Previously:"
                f"Executed Actions: {json.dumps(previous_actions_and_intends, indent=2)}\n"
                f"Your task: Analyze the screenshot and output the **NEXT SINGLE ACTION** you want to perform.\n"
                f"- Use 'type' ONLY if you need to enter text into a field.\n"
                f"- Always provide the label and box_2d for where you are clicking/typing."
            )
            results = self.ai_client.models.generate_content(
                model='gemini-3.1-flash-lite',
                contents=[prompt, image],
                config = types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=UIAction,
                    thinking_config=types.ThinkingConfig(thinking_budget=0)
                )
            )
            
            try:
                command = UIAction.model_validate_json(results.text)
                print(f'Executing: {command.action.value.upper()} -> {command.label}')
        
            except Exception as parse_error:
                print(
                    f"Failed to parse UIAction: {parse_error}"
                    f"Raw response: {results.text[:200]}"
                )

            # append the command to the list:
            previous_actions_and_intends.append({
                "action": command.action.value,
                "box_2d": command.box_2d,
                "text_to_type": command.text_to_type
            })
            # Keep only the last 3 actions to reduce token usage
            if len(previous_actions_and_intends) > 3:
                previous_actions_and_intends = previous_actions_and_intends[-3:] 
            
        

        #---------------Execution Router--------------------
        #1. Handel cordinate based movements (click & types):
            if command.action in [ActionType.CLICK, ActionType.TYPE]:
                if not command.box_2d:
                    print("Error: Missing box_2d coordinate required for this action.")
                    continue

                ymin, xmin, ymax, xmax = command.box_2d
                center_norm_x = (xmax + xmin) /2
                center_norm_y = (ymax + ymin) /2

                screen_width, screen_height = pyautogui.size()
            
                real_x = int((center_norm_x/1000) * screen_width)
                real_y = int((center_norm_y/1000) * screen_height)

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
                        print('Error: Type action selected buyt text_to_type was empty')

            #2. Handle scroll actions
            elif command.action == ActionType.SCROLL_UP:
                scroll_amount = command.scroll_amount or 500
                pyautogui.scroll(scroll_amount)
                pyautogui.sleep(0.5)
            elif command.action == ActionType.SCROLL_DOWN:
                scroll_amount = command.scroll_amount or 500
                pyautogui.scroll(-scroll_amount)
                pyautogui.sleep(0.5)
            
            #3. Handle press enter actions
            elif command.action == ActionType.PRESS_ENTER:
                pyautogui.press('enter')
                pyautogui.sleep(0.5)

            #4. Handle completion signals
            elif command.action == ActionType.COMPLETE:
                complete = True
                break

            else:
                print(f"Unknown action: {command.action}")
                break
            
            turn += 1