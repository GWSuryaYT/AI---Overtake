/*
 * Project Anna - ESP8266 NodeMCU Wake-on-LAN (WoL) Controller
 * 
 * Target Board: NodeMCU 1.0 (ESP-12E Module) or generic ESP8266
 * Microcontroller: ESP8266
 *
 * Description:
 * Connects securely to the Cloudflare Worker Relay over WebSocket (WSS).
 * Listens for remote wake commands and broadcasts Wake-on-LAN (WoL) Magic Packets
 * over your local network (LAN) to wake your Ethernet-connected PC.
 *
 * Required Libraries (Install via Arduino Library Manager):
 * 1. "WebSockets" by Markus Sattler (v2.4.0 or newer)
 * 2. "ArduinoJson" by Benoit Blanchon (v6 or v7)
 * 3. "ESP8266WiFi" & "WiFiUdp" (included in ESP8266 Arduino Core)
 */

#include <ESP8266WiFi.h>
#include <WiFiUdp.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// ============================================================================
// CONFIGURATION
// ============================================================================
const char* WIFI_SSID     = "YOUR_WIFI_SSID";      // Must be your 2.4GHz home Wi-Fi
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Target PC Ethernet MAC Address: 74-56-3C-63-A9-9A
byte TARGET_MAC[6]        = { 0x74, 0x56, 0x3C, 0x63, 0xA9, 0x9A };

// Cloudflare Worker Relay Configuration
const char* RELAY_HOST    = "ai-overtake-relay.gravitymarts.workers.dev";
const int   RELAY_PORT    = 443;
const char* AUTH_TOKEN    = "anna-secret-token-change-me";

// Status LED (NodeMCU onboard LED is D4 / GPIO 2, active LOW)
const int STATUS_LED      = D4;

// Optional: Optional physical relay/optocoupler pin (set to -1 if not using)
const int OPTIONAL_RELAY_PIN = D1; // NodeMCU D1 / GPIO 5

const unsigned long PING_INTERVAL = 25000; // 25s keepalive ping

// ============================================================================
// GLOBALS
// ============================================================================
WebSocketsClient webSocket;
WiFiUDP udp;
unsigned long lastPingTime = 0;
bool isRelayConnected = false;

void setStatusLed(bool on) {
    digitalWrite(STATUS_LED, on ? LOW : HIGH);
}

// ============================================================================
// WAKE-ON-LAN (WoL) MAGIC PACKET SENDER
// ============================================================================
/**
 * Constructs and broadcasts a standard 102-byte Magic Packet:
 * - 6 bytes of 0xFF
 * - Followed by 16 repetitions of the 6-byte target MAC address.
 */
bool sendWakeOnLan(const byte* macAddress) {
    byte magicPacket[102];

    // 1. First 6 bytes are 0xFF
    for (int i = 0; i < 6; i++) {
        magicPacket[i] = 0xFF;
    }

    // 2. Repeat MAC address 16 times
    for (int i = 0; i < 16; i++) {
        for (int j = 0; j < 6; j++) {
            magicPacket[6 + i * 6 + j] = macAddress[j];
        }
    }

    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
             macAddress[0], macAddress[1], macAddress[2],
             macAddress[3], macAddress[4], macAddress[5]);

    Serial.printf("[WoL] Broadcasting Magic Packet to %s over UDP port 9 & 7...\n", macStr);

    // Blink status LED during transmission
    setStatusLed(true);

    // Calculate subnet broadcast IP
    IPAddress subnetBroadcast = WiFi.localIP();
    subnetBroadcast[3] = 255; // e.g. 192.168.0.255
    IPAddress globalBroadcast(255, 255, 255, 255);

    // Send to both global (255.255.255.255) and subnet broadcast on ports 9 and 7
    // Transmit multiple bursts to guarantee delivery over switch/router
    for (int burst = 0; burst < 3; burst++) {
        // Port 9 (Subnet Broadcast)
        udp.beginPacket(subnetBroadcast, 9);
        udp.write(magicPacket, sizeof(magicPacket));
        udp.endPacket();

        // Port 9 (Global Broadcast)
        udp.beginPacket(globalBroadcast, 9);
        udp.write(magicPacket, sizeof(magicPacket));
        udp.endPacket();

        // Port 7 (Standard Echo / Alternate WoL)
        udp.beginPacket(subnetBroadcast, 7);
        udp.write(magicPacket, sizeof(magicPacket));
        udp.endPacket();

        delay(30);
    }

    setStatusLed(false);
    Serial.println("[WoL] Magic Packet transmission complete.");

    // Optional physical pulse if wired
    if (OPTIONAL_RELAY_PIN >= 0) {
        digitalWrite(OPTIONAL_RELAY_PIN, HIGH);
        delay(350);
        digitalWrite(OPTIONAL_RELAY_PIN, LOW);
    }

    // Send execution result back to Cloudflare Relay
    if (isRelayConnected) {
        StaticJsonDocument<256> doc;
        doc["type"] = "HARDWARE_STATUS";
        doc["status"] = "WOL_PACKET_SENT";
        doc["target_mac"] = macStr;
        doc["timestamp"] = millis();

        String responseJson;
        serializeJson(doc, responseJson);
        webSocket.sendTXT(responseJson);
    }

    return true;
}

// Parse "AA:BB:CC:DD:EE:FF" or "AA-BB-CC-DD-EE-FF" into 6-byte array
bool parseMacAddress(const char* macStr, byte* macBytes) {
    if (!macStr) return false;
    int values[6];
    if (sscanf(macStr, "%x:%x:%x:%x:%x:%x", &values[0], &values[1], &values[2], &values[3], &values[4], &values[5]) == 6 ||
        sscanf(macStr, "%x-%x-%x-%x-%x-%x", &values[0], &values[1], &values[2], &values[3], &values[4], &values[5]) == 6) {
        for (int i = 0; i < 6; i++) {
            macBytes[i] = (byte)values[i];
        }
        return true;
    }
    return false;
}

// ============================================================================
// WEBSOCKET EVENT LISTENER
// ============================================================================
void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
    switch (type) {
        case WStype_DISCONNECTED:
            isRelayConnected = false;
            setStatusLed(false);
            Serial.println("[Relay] Disconnected from Cloudflare Worker.");
            break;

        case WStype_CONNECTED:
            isRelayConnected = true;
            setStatusLed(true);
            Serial.printf("[Relay] Connected successfully to: %s\n", payload);

            // Announce presence
            {
                StaticJsonDocument<256> doc;
                doc["type"] = "HARDWARE_HELLO";
                doc["device"] = "ESP8266_NodeMCU";
                doc["mode"] = "WAKE_ON_LAN";
                doc["ip"] = WiFi.localIP().toString();
                String out;
                serializeJson(doc, out);
                webSocket.sendTXT(out);
            }
            break;

        case WStype_TEXT: {
            Serial.printf("[Relay] Incoming message: %s\n", payload);

            StaticJsonDocument<512> doc;
            DeserializationError err = deserializeJson(doc, payload);
            if (err) {
                Serial.printf("[Relay] JSON parsing failed: %s\n", err.c_str());
                return;
            }

            const char* msgType = doc["type"];
            if (!msgType) return;

            // Handle power / wake commands
            if (strcmp(msgType, "HARDWARE_CMD") == 0) {
                const char* action = doc["action"];

                // Check if incoming payload specifies a custom target MAC
                byte customMac[6];
                byte* activeMac = TARGET_MAC;
                if (doc.containsKey("mac")) {
                    if (parseMacAddress(doc["mac"], customMac)) {
                        activeMac = customMac;
                    }
                }

                if (!action || strcmp(action, "WAKE_ON_LAN") == 0 ||
                    strcmp(action, "PRESS_POWER_BUTTON") == 0 ||
                    strcmp(action, "WAKE_PC") == 0) {
                    sendWakeOnLan(activeMac);
                } 
                else if (strcmp(action, "FORCE_SHUTDOWN") == 0 && OPTIONAL_RELAY_PIN >= 0) {
                    digitalWrite(OPTIONAL_RELAY_PIN, HIGH);
                    delay(6000);
                    digitalWrite(OPTIONAL_RELAY_PIN, LOW);
                }
                else {
                    Serial.printf("[Relay] Unknown hardware action: %s\n", action ? action : "null");
                }
            } 
            else if (strcmp(msgType, "PING") == 0) {
                webSocket.sendTXT("{\"type\":\"PONG\"}");
            }
            break;
        }

        case WStype_ERROR:
            Serial.printf("[Relay] WebSocket Error\n");
            break;

        default:
            break;
    }
}

// ============================================================================
// SETUP
// ============================================================================
void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n\n==========================================");
    Serial.println("  Project Anna - ESP8266 Wake-on-LAN Node ");
    Serial.println("==========================================");

    pinMode(STATUS_LED, OUTPUT);
    setStatusLed(false);

    if (OPTIONAL_RELAY_PIN >= 0) {
        pinMode(OPTIONAL_RELAY_PIN, OUTPUT);
        digitalWrite(OPTIONAL_RELAY_PIN, LOW);
    }

    // Connect to Wi-Fi
    Serial.printf("[WiFi] Connecting to %s", WIFI_SSID);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 40) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[WiFi] Connected!");
        Serial.printf("[WiFi] Local IP: %s\n", WiFi.localIP().toString().c_str());
        Serial.printf("[WiFi] Subnet: %s\n", WiFi.subnetMask().toString().c_str());
        Serial.printf("[WiFi] Gateway: %s\n", WiFi.gatewayIP().toString().c_str());
    } else {
        Serial.println("\n[WiFi] Timeout connecting. Retrying in loop...");
    }

    // Initialize UDP for WoL magic packet broadcasting
    udp.begin(9);

    // Build WebSocket URL
    String wsUrl = "/ws?role=hardware&token=";
    wsUrl += AUTH_TOKEN;

    Serial.printf("[Relay] Connecting WSS: %s:%d%s\n", RELAY_HOST, RELAY_PORT, wsUrl.c_str());
    webSocket.beginSSL(RELAY_HOST, RELAY_PORT, wsUrl.c_str());
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(5000);
}

// ============================================================================
// MAIN LOOP
// ============================================================================
void loop() {
    webSocket.loop();

    // Reconnect Wi-Fi if dropped
    if (WiFi.status() != WL_CONNECTED) {
        static unsigned long lastWifiCheck = 0;
        if (millis() - lastWifiCheck > 10000) {
            lastWifiCheck = millis();
            Serial.println("[WiFi] Reconnecting...");
            WiFi.reconnect();
        }
    }

    // Keepalive ping
    if (isRelayConnected && (millis() - lastPingTime > PING_INTERVAL)) {
        lastPingTime = millis();
        webSocket.sendTXT("{\"type\":\"PING\"}");
    }
}
