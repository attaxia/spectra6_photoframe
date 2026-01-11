#include "WiFiConfig.h"

DNSServer dnsServer;
WebServer server(80);
bool captivePortalActive = false;

// HTML for captive portal
const char* CAPTIVE_PORTAL_HTML = "<!DOCTYPE html>\n"
"<html>\n"
"<head>\n"
"  <meta charset=\"utf-8\">\n"
"  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
"  <title>E-Paper WiFi Setup</title>\n"
"  <style>\n"
"    body {\n"
"      font-family: Arial, sans-serif;\n"
"      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);\n"
"      margin: 0;\n"
"      padding: 20px;\n"
"      min-height: 100vh;\n"
"      display: flex;\n"
"      justify-content: center;\n"
"      align-items: center;\n"
"    }\n"
"    .container {\n"
"      background: white;\n"
"      border-radius: 10px;\n"
"      box-shadow: 0 10px 25px rgba(0,0,0,0.2);\n"
"      padding: 30px;\n"
"      max-width: 400px;\n"
"      width: 100%;\n"
"    }\n"
"    h1 {\n"
"      text-align: center;\n"
"      color: #333;\n"
"      margin-top: 0;\n"
"    }\n"
"    .form-group {\n"
"      margin-bottom: 20px;\n"
"    }\n"
"    label {\n"
"      display: block;\n"
"      margin-bottom: 8px;\n"
"      color: #555;\n"
"      font-weight: bold;\n"
"    }\n"
"    input {\n"
"      width: 100%;\n"
"      padding: 10px;\n"
"      border: 1px solid #ddd;\n"
"      border-radius: 5px;\n"
"      font-size: 16px;\n"
"      box-sizing: border-box;\n"
"    }\n"
"    button {\n"
"      width: 100%;\n"
"      padding: 12px;\n"
"      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);\n"
"      color: white;\n"
"      border: none;\n"
"      border-radius: 5px;\n"
"      font-size: 16px;\n"
"      cursor: pointer;\n"
"      font-weight: bold;\n"
"    }\n"
"    button:hover {\n"
"      opacity: 0.9;\n"
"    }\n"
"    .message {\n"
"      text-align: center;\n"
"      padding: 10px;\n"
"      margin-top: 20px;\n"
"      border-radius: 5px;\n"
"      display: none;\n"
"    }\n"
"    .success {\n"
"      background-color: #d4edda;\n"
"      color: #155724;\n"
"      border: 1px solid #c3e6cb;\n"
"    }\n"
"    .error {\n"
"      background-color: #f8d7da;\n"
"      color: #721c24;\n"
"      border: 1px solid #f5c6cb;\n"
"    }\n"
"  </style>\n"
"</head>\n"
"<body>\n"
"  <div class=\"container\">\n"
"    <h1>E-Paper WiFi Setup</h1>\n"
"    <form onsubmit=\"submitForm(event)\">\n"
"      <div class=\"form-group\">\n"
"        <label for=\"ssid\">WiFi Network (SSID):</label>\n"
"        <input type=\"text\" id=\"ssid\" name=\"ssid\" required autofocus>\n"
"      </div>\n"
"      <div class=\"form-group\">\n"
"        <label for=\"password\">Password:</label>\n"
"        <input type=\"password\" id=\"password\" name=\"password\">\n"
"      </div>\n"
"      <div class=\"form-group\">\n"
"        <label for=\"server\">Server URL:</label>\n"
"        <input type=\"url\" id=\"server\" name=\"server\" placeholder=\"http://192.168.1.100:3000\" required>\n"
"      </div>\n"
"      <button type=\"submit\">Connect</button>\n"
"    </form>\n"
"    <div id=\"message\" class=\"message\"></div>\n"
"  </div>\n"
"  <script>\n"
"    async function submitForm(event) {\n"
"      event.preventDefault();\n"
"      const ssid = document.getElementById('ssid').value;\n"
"      const password = document.getElementById('password').value;\n"
"      const server = document.getElementById('server').value;\n"
"      const messageDiv = document.getElementById('message');\n"
"      try {\n"
"        const response = await fetch('/api/wifi/connect', {\n"
"          method: 'POST',\n"
"          headers: {'Content-Type': 'application/json'},\n"
"          body: JSON.stringify({ssid: ssid, password: password, server: server})\n"
"        });\n"
"        const result = await response.json();\n"
"        if (response.ok) {\n"
"          messageDiv.classList.remove('error');\n"
"          messageDiv.classList.add('success');\n"
"          messageDiv.textContent = 'Settings saved! Device will connect to WiFi...';\n"
"          messageDiv.style.display = 'block';\n"
"          setTimeout(() => { window.location.href = '/'; }, 3000);\n"
"        } else {\n"
"          messageDiv.classList.remove('success');\n"
"          messageDiv.classList.add('error');\n"
"          messageDiv.textContent = 'Error: ' + result.message;\n"
"          messageDiv.style.display = 'block';\n"
"        }\n"
"      } catch (error) {\n"
"        messageDiv.classList.remove('success');\n"
"        messageDiv.classList.add('error');\n"
"        messageDiv.textContent = 'Connection error: ' + error.message;\n"
"        messageDiv.style.display = 'block';\n"
"      }\n"
"    }\n"
"  </script>\n"
"</body>\n"
"</html>\n";

// Initialize SPIFFS
bool initSPIFFS() {
  if (!SPIFFS.begin(true)) {
    Serial.println("SPIFFS Mount Failed");
    return false;
  }
  Serial.println("SPIFFS mounted successfully");
  return true;
}

// Save WiFi credentials to SPIFFS
void saveWiFiCredentials(const char* ssid, const char* password) {
  DynamicJsonDocument doc(256);
  doc["ssid"] = ssid;
  doc["password"] = password;

  File configFile = SPIFFS.open(WIFI_CONFIG_FILE, "w");
  if (!configFile) {
    Serial.println("Failed to open config file for writing");
    return;
  }

  serializeJson(doc, configFile);
  configFile.close();
  Serial.println("WiFi credentials saved");
}

// Load WiFi credentials from SPIFFS
bool loadWiFiCredentials(char* ssid, char* password) {
  if (!SPIFFS.exists(WIFI_CONFIG_FILE)) {
    Serial.println("Config file does not exist");
    return false;
  }

  File configFile = SPIFFS.open(WIFI_CONFIG_FILE, "r");
  if (!configFile) {
    Serial.println("Failed to open config file");
    return false;
  }

  DynamicJsonDocument doc(256);
  DeserializationError error = deserializeJson(doc, configFile);
  configFile.close();

  if (error) {
    Serial.println("Failed to parse config file");
    return false;
  }

  if (!doc.containsKey("ssid") || !doc.containsKey("password")) {
    Serial.println("Config file missing required fields");
    return false;
  }

  strcpy(ssid, doc["ssid"].as<const char*>());
  strcpy(password, doc["password"].as<const char*>());
  Serial.println("WiFi credentials loaded");
  return true;
}

// Save server URL
void saveServerUrl(const char* url) {
  DynamicJsonDocument doc(512);
  
  // Load existing WiFi config if it exists
  if (SPIFFS.exists(WIFI_CONFIG_FILE)) {
    File configFile = SPIFFS.open(WIFI_CONFIG_FILE, "r");
    if (configFile) {
      deserializeJson(doc, configFile);
      configFile.close();
    }
  }
  
  doc["server_url"] = url;

  File configFile = SPIFFS.open(WIFI_CONFIG_FILE, "w");
  if (!configFile) {
    Serial.println("Failed to open config file for writing");
    return;
  }

  serializeJson(doc, configFile);
  configFile.close();
  Serial.println("Server URL saved");
}

// Load server URL
bool loadServerUrl(char* url) {
  if (!SPIFFS.exists(WIFI_CONFIG_FILE)) {
    return false;
  }

  File configFile = SPIFFS.open(WIFI_CONFIG_FILE, "r");
  if (!configFile) {
    return false;
  }

  DynamicJsonDocument doc(512);
  DeserializationError error = deserializeJson(doc, configFile);
  configFile.close();

  if (error) {
    return false;
  }

  if (!doc.containsKey("server_url")) {
    return false;
  }

  strcpy(url, doc["server_url"].as<const char*>());
  return true;
}

// Handle root path during captive portal
void handleRoot() {
  server.send(200, "text/html", CAPTIVE_PORTAL_HTML);
}

// Handle connect request from portal
void handleConnect() {
  if (server.method() != HTTP_POST) {
    server.send(405, "application/json", "{\"message\":\"Method not allowed\"}");
    return;
  }

  if (!server.hasArg("plain")) {
    server.send(400, "application/json", "{\"message\":\"No body provided\"}");
    return;
  }

  DynamicJsonDocument doc(512);
  DeserializationError error = deserializeJson(doc, server.arg("plain"));

  if (error) {
    server.send(400, "application/json", "{\"message\":\"Invalid JSON\"}");
    return;
  }

  if (!doc.containsKey("ssid") || !doc.containsKey("server")) {
    server.send(400, "application/json", "{\"message\":\"Missing required fields\"}");
    return;
  }

  const char* ssid = doc["ssid"];
  const char* password = doc["password"].isNull() ? "" : doc["password"].as<const char*>();
  const char* serverUrl = doc["server"];

  // Save credentials and server URL
  saveWiFiCredentials(ssid, password);
  saveServerUrl(serverUrl);

  server.send(200, "application/json", "{\"message\":\"Configuration saved. Device will restart...\"}");

  // Give the response time to send before restarting
  delay(1000);
  ESP.restart();
}

// Start captive portal
void startCaptivePortal() {
  Serial.println("Starting Captive Portal...");
  captivePortalActive = true;

  // Stop any existing WiFi first
  WiFi.disconnect(true);
  delay(500);

  // Set mode to AP only
  WiFi.mode(WIFI_AP);
  delay(500);

  // Start soft AP
  bool apStarted = WiFi.softAP("E-Paper Setup", "");
  if (!apStarted) {
    Serial.println("Failed to start soft AP");
    return;
  }

  Serial.print("Soft AP IP: ");
  Serial.println(WiFi.softAPIP());

  // Setup DNS server for all domains point to ESP32
  if (!dnsServer.start(DNS_PORT, "*", WiFi.softAPIP())) {
    Serial.println("Failed to start DNS server");
    return;
  }

  // Setup web server routes
  server.on("/", handleRoot);
  server.on("/api/wifi/connect", handleConnect);
  
  // Catch-all for captive portal redirect
  server.onNotFound(handleRoot);

  server.begin();
  Serial.println("Captive Portal started. Connect to 'E-Paper Setup' network");
}

// Connect to WiFi
bool connectToWiFi() {
  char ssid[WIFI_SSID_LENGTH] = {0};
  char password[WIFI_PASSWORD_LENGTH] = {0};

  if (!loadWiFiCredentials(ssid, password)) {
    Serial.println("No saved WiFi credentials. Starting captive portal...");
    startCaptivePortal();
    return false;
  }

  Serial.print("Connecting to WiFi: ");
  Serial.println(ssid);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);

  int attempts = 0;
  const int maxAttempts = 30; // 30 seconds timeout

  while (WiFi.status() != WL_CONNECTED && attempts < maxAttempts) {
    delay(1000);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.print("Connected! IP: ");
    Serial.println(WiFi.localIP());
    return true;
  } else {
    Serial.println();
    Serial.println("Failed to connect to WiFi. Starting captive portal...");
    startCaptivePortal();
    return false;
  }
}

// Check WiFi connection status
bool isWiFiConnected() {
  return WiFi.status() == WL_CONNECTED;
}

// Process captive portal requests (call in loop when portal is active)
void processCaptivePortal() {
  if (captivePortalActive) {
    dnsServer.processNextRequest();
    server.handleClient();
  }
}

// Stop captive portal
void stopCaptivePortal() {
  if (captivePortalActive) {
    dnsServer.stop();
    server.stop();
    captivePortalActive = false;
    WiFi.softAPdisconnect(true);
  }
}
