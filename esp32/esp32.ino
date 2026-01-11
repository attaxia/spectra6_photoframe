/**
 * ESP32 E-Paper Display with WiFi
 * 
 * Features:
 * - WiFi setup via captive portal
 * - Downloads image from server
 * - Displays on e-paper display
 * - Goes to deep sleep to save power
 * 
 * Hardware:
 * - ESP32 with e-Paper 7.3" display (800x480)
 * - Waveshare EPD_7in3e module
 * 
 * Server:
 * - Node.js server at /esp32/frame endpoint
 * - Provides packed 4bpp framebuffer data (best for ESP32 without PSRAM)
 */

#include "src/Config/Debug.h"
#include "src/Config/DEV_Config.h"
#include "src/Config/WiFiConfig.h"
#include "src/Config/ImageDownloader.h"
#include "src/GUI/GUI_Paint.h"
#include "src/Fonts/fonts.h"
#include "src/e-Paper/EPD_7in3e.h"
// For explicit deep sleep wake configuration and diagnostics
#include <esp_sleep.h>

// Sleep duration in seconds (default: 1 hour)
#define SLEEP_DURATION_SECONDS 86400

// Forward declarations
void handleCaptivePortal();
void displayError(const char* message);
void goToSleep();

/**
 * Setup function - runs once at startup
 */
void setup() {
  // Initialize serial for debugging
  Serial.begin(115200);
  delay(100);
  
  Serial.println("\n\nE-Paper WiFi Display Starting...");
  Serial.println("================================");
  Serial.printf("Free heap: %d bytes\n", ESP.getFreeHeap());

  // Print wakeup cause to aid troubleshooting
  esp_sleep_wakeup_cause_t cause = esp_sleep_get_wakeup_cause();
  Serial.printf("Wakeup cause: %d (0=undef, 2=timer)\n", (int)cause);

  // Initialize SPIFFS for configuration storage
  if (!initSPIFFS()) {
    Serial.println("ERROR: Failed to initialize SPIFFS");
    displayError("SPIFFS Init Failed");
    delay(5000);
    ESP.restart();
  }

  Serial.println("SPIFFS initialized");
  delay(1000); // Give system time to settle

  // Try to connect to saved WiFi
  Serial.println("\nAttempting WiFi connection...");
  if (connectToWiFi()) {
    // WiFi connected successfully
    Serial.println("WiFi connection successful!");
    
    // Load server URL
    char serverUrl[SERVER_URL_LENGTH] = {0};
    if (!loadServerUrl(serverUrl)) {
      Serial.println("No server URL configured. Using default.");
      strcpy(serverUrl, DEFAULT_SERVER_URL);
    }

    Serial.printf("Server URL: %s\n", serverUrl);
    Serial.printf("Free heap before download: %d bytes\n", ESP.getFreeHeap());

    // Download and display image
    if (downloadAndDisplayImage(serverUrl)) {
      Serial.println("Image display successful!");
    } else {
      Serial.println("Image download failed. Displaying error message.");
      // Note: cleanupDisplay() is handled in downloadAndDisplayImage if display was initialized
      delay(1000);
      displayError("Image Download Failed");
      delay(3000);
    }
  } else {
    // WiFi connection failed or no credentials - show captive portal
    Serial.println("Starting captive portal for WiFi setup...");
    handleCaptivePortal();
    // After portal setup, the device will restart
  }

  // Go to sleep to save power
  Serial.println("\nEntering deep sleep mode...");
  goToSleep();
}

/**
 * Loop function - typically not reached due to sleep
 */
void loop() {
  // This is rarely executed due to deep sleep
  delay(1000);
}

/**
 * Handle captive portal setup
 * Blocks until device is configured or timeout occurs
 */
void handleCaptivePortal() {
  Serial.println("Captive portal active. Waiting for WiFi configuration...");
  Serial.println("Connect to 'E-Paper Setup' network and open http://192.168.1.4");
  
  // Portal is started in connectToWiFi() when no credentials exist
  // Keep processing requests
  const unsigned long portalTimeout = 600000; // 10 minutes
  unsigned long startTime = millis();
  unsigned long lastPrint = startTime;

  while (millis() - startTime < portalTimeout) {
    // Print status every 30 seconds
    if (millis() - lastPrint > 30000) {
      unsigned long remaining = (portalTimeout - (millis() - startTime)) / 1000;
      Serial.printf("Waiting for configuration... %lu seconds remaining\n", remaining);
      lastPrint = millis();
    }

    // Process portal requests
    processCaptivePortal();
    delay(100);

    // If somehow connected, exit
    if (isWiFiConnected()) {
      Serial.println("WiFi connected via portal!");
      return;
    }
  }

  Serial.println("Captive portal timeout. Restarting...");
  delay(2000);
  ESP.restart();
}

/**
 * Display error message on e-paper
 */
void displayError(const char* message) {
  Serial.printf("Displaying error: %s\n", message);

  // Initialize display module if needed
  Serial.println("Initializing display module...");
  if (DEV_Module_Init() != 0) {
    Serial.println("Failed to initialize display module - skipping error display");
    return;
  }

  // Initialize EPD
  Serial.println("Initializing e-Paper display...");
  EPD_7IN3E_Init();
  delay(500);

  // Low-RAM boards (ESP32-WROOM-32 without PSRAM) often can't allocate a full
  // 192KB framebuffer for text rendering. Indicate error with a solid RED fill.
  Serial.println("Clearing display to RED to indicate error...");
  EPD_7IN3E_Clear(EPD_7IN3E_RED);
  delay(1000);
}

/**
 * Enter deep sleep mode
 * Reduces power consumption to near zero
 */
void goToSleep() {
  // Shutdown display to save power
  Serial.println("Shutting down e-Paper display...");
  EPD_7IN3E_Sleep();
  delay(500);

  // Disable WiFi to save power
  WiFi.disconnect(true); // true = turn off radio
  WiFi.mode(WIFI_OFF);

  Serial.printf("Going to deep sleep for %d seconds...\n", SLEEP_DURATION_SECONDS);
  Serial.flush();

  // Configure timer wakeup explicitly, then enter deep sleep
  // Note: Using esp_sleep_enable_timer_wakeup + esp_deep_sleep_start()
  // is more robust across core/IDF versions than esp_deep_sleep(timeout).
  esp_sleep_enable_timer_wakeup((uint64_t)SLEEP_DURATION_SECONDS * 1000000ULL);
  esp_deep_sleep_start();

  // Code after this line won't execute until wake-up
}