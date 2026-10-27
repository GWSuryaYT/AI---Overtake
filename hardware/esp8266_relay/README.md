# ESP8266 NodeMCU Wake-on-LAN (WoL) PC Controller

This module enables turning your PC on remotely using **Wake-on-LAN (WoL)** magic packets sent over your local area network (LAN / Ethernet), and shutting down or sleeping your PC remotely via the Project Anna Cloudflare Relay.

---

## 1. Why Wake-on-LAN (WoL)?
- **Zero Motherboard Wiring Required:** You don't need to open your PC case or wire optocouplers/relays to front panel headers!
- Just power your NodeMCU with any 5V phone charger / micro-USB cable in your room, connected to the same Wi-Fi router that your PC's Ethernet cable connects to.
- When you click **"Wake PC (WoL)"** on your phone (or ask Anna), the Cloudflare Worker relays the command to the ESP8266, which immediately broadcasts the standard 102-byte Magic Packet across UDP port 9 and port 7 to your Ethernet card.

---

## 2. Pre-Configured Parameters

Your PC's Ethernet hardware settings have been automatically detected and configured in the firmware:

- **Ethernet Card:** Realtek PCIe GbE Family Controller
- **Target MAC Address:** `74:56:3C:63:A9:9A` (Configured in `TARGET_MAC` in `esp8266_relay.ino`)
- **Local Network Subnet:** `192.168.0.x` (Broadcast: `192.168.0.255` & `255.255.255.255`)
- **Cloudflare Relay Host:** `ai-overtake-relay.gravitymarts.workers.dev`

---

## 3. Power Control Architecture

| Desired Action | How It Works |
|---|---|
| **Turn On / Wake PC (When PC is sleeping or powered off)** | Phone sends `WAKE_ON_LAN` to Relay ➔ ESP8266 broadcasts UDP Magic Packet ➔ Ethernet NIC wakes PC. |
| **Put PC to Sleep (When PC is on)** | Phone sends `sleep_pc` ➔ Cloudflare Relay ➔ `remote_bridge.py` executes Windows sleep command. |
| **Clean Shutdown (When PC is on)** | Phone sends `shutdown_pc` ➔ Cloudflare Relay ➔ `remote_bridge.py` executes clean `shutdown /s /t 3`. |

---

## 4. Arduino IDE Setup & Flashing

1. **Add ESP8266 Board Support (if not done already):**
   - File ➔ Preferences ➔ **Additional Board Manager URLs**:
     ```
     http://arduino.esp8266.com/stable/package_esp8266com_index.json
     ```
   - Tools ➔ Board ➔ Boards Manager ➔ Search `ESP8266` ➔ Install.
   - Select Board: **NodeMCU 1.0 (ESP-12E Module)**.

2. **Install Required Libraries in Arduino IDE:**
   - Tools ➔ Manage Libraries...
   - Search & Install **WebSockets** by *Markus Sattler* (v2.4.0+).
   - Search & Install **ArduinoJson** by *Benoit Blanchon* (v6 or v7).
   - *(Note: `ESP8266WiFi` and `WiFiUdp` are built into the ESP8266 core, no external install needed).*

3. **Configure Wi-Fi & Flash:**
   - Open `hardware/esp8266_relay/esp8266_relay.ino`.
   - Update lines 24–25 with your 2.4GHz Wi-Fi credentials:
     ```cpp
     const char* WIFI_SSID     = "YOUR_WIFI_SSID";
     const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
     ```
   - Plug the NodeMCU into your PC with a micro-USB cable.
   - Select the COM port under Tools ➔ Port.
   - Click **Upload**.
