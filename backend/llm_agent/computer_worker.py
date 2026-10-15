from enum import Enum
from google import genai
from google.genai import types
from dotenv import load_dotenv
import os
import pyautogui
from pydantic import BaseModel, Field
from typing import List, Optional
import time
import json
from PIL import Image, ImageDraw


load_dotenv()

class ActionType(str, Enum):
    CLICK = "click"
    RIGHT_CLICK = "right_click"
    DOUBLE_CLICK = "double_click"
    HOT_KEY = "hot_key"
    TYPE = "type"
    PRESS_ENTER = "press_enter"
    COMPLETE = "complete"
    SCROLL_UP = "scroll_up"
    SCROLL_DOWN = "scroll_down"
    OPEN_APP = "open_app"
    WAIT = "wait"


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
    thought: str = Field(description="reasoning for the action (2 line max)")
    hot_key: Optional[str] = Field(
        default=None, 
        description="Hot key when action='hot_key'"
    )
    wait_time: Optional[int] = Field(
        default=None, 
        description="Wait time in seconds when action='wait'"
    )


class computer_agent:
    def __init__(self):
        self.ai_client = genai.Client(api_key=os.getenv("GEMINI_KEY_PAID"))
        print('Initialized GEMINI client.')
    
    def screen_shot(self):
        try:
            image = pyautogui.screenshot()
            image.save('debug_screenshot.png')
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
        
        # Token tracking for this session
        session_tokens = {
            'input_tokens': 0,
            'output_tokens': 0,
            'total_tokens': 0
        }

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

            #wait before taking an ss
            time.sleep(1.0)

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
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                    max_output_tokens=300
                )
            )
            end_time = time.perf_counter()
            print(f'Response received in: {end_time - start_time:.2f}s')

            # Token Counter and Estimated price based on the model's input and output token amounts:
            prompt_token_count = results.usage_metadata.prompt_token_count
            output_token_count = results.usage_metadata.candidates_token_count
            total_token_count = results.usage_metadata.total_token_count
            
            session_tokens['input_tokens'] += prompt_token_count
            session_tokens['output_tokens'] += output_token_count
            session_tokens['total_tokens'] += total_token_count
            






            #this is where our output become commands and get executed.
            try:
                command = UIAction.model_validate_json(results.text) 
                print(f'Executing: {command.action.value.upper()} -> {command.thought}')
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
            if command.hot_key:
                action_desc += f" {command.hot_key}"
            if command.wait_time:
                action_desc += f" {command.wait_time}"
            if command.thought:
                cut_spaces = command.thought.strip() #this is to remove extra spaces
                clean_text = cut_spaces.replace('\n', ' ') #this will make 2 lines togather 1 line
                action_desc += f" {clean_text}"

            previous_actions.append(f"{turn}. {action_desc}")
            if len(previous_actions) > 3:
                previous_actions = previous_actions[-3:] #reduce the history to only past 3 turns.



            #--------------Image Draw a bounding box this will be saved in debug screenshot.png------------
            if command.box_2d and len(command.box_2d) == 4:
                ymin, xmin, ymax, xmax = command.box_2d
                draw = ImageDraw.Draw(image)
                draw.rectangle(
                    [
                        (xmin / 1000) * image.width,
                        (ymin / 1000) * image.height,
                        (xmax / 1000) * image.width,
                        (ymax / 1000) * image.height,
                    ],
                    outline="red",
                    width=2
                )
                image.save("debug_screenshot.png")




            #---------------Execution Router--------------------
            # 1. Handle coordinate based movements (click & type):
            if command.action in [ActionType.CLICK, ActionType.TYPE, ActionType.RIGHT_CLICK, ActionType.DOUBLE_CLICK]: 
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

            #6. Handle wait command:
            elif command.action == ActionType.WAIT:
                if command.wait_time:
                    time.sleep(command.wait_time)
                else:
                    print('Error: wait action selected but wait_time was not specified')

            elif command.action == ActionType.HOT_KEY:
                if command.hot_key:
                    # Splits "ctrl+c" or "ctrl + shift + t" into separate keys for pyautogui
                    keys = [k.strip().lower() for k in command.hot_key.replace(",", "+").split("+")]
                    pyautogui.hotkey(*keys)
                    pyautogui.sleep(0.3)
                else:
                    print('Error: hot_key action selected but hot_key string was empty')

            else:
                print(f"Unknown action: {command.action}")
                break
            
            turn += 1
        



        #pricing:

        standard_input_price_per_million = 0.25
        standard_output_price_per_million = 1.50

        #this sessions total cost:

        total_input_cost = session_tokens['input_tokens'] / 1_000_000 * standard_input_price_per_million
        total_output_cost = session_tokens['output_tokens'] / 1_000_000 * standard_output_price_per_million

        total_session_cost = total_input_cost + total_output_cost

        
        with open('spending_data.json', 'a') as f:
            log = {
                'goal': goal,
                'turns': turn,
                'total_input_cost': total_input_cost,
                'total_output_cost': total_output_cost,
                'total_session_cost': total_session_cost,
                'timestamp': time.time(),                
            } 
            f.write(json.dumps(log) + '\n')
        
        print('Saved the session cost in spending_data.json')
        


if __name__ == "__main__":
    obj = computer_agent()
    obj.work("go to amazon and search for red shoe and click on the image of the shoe")