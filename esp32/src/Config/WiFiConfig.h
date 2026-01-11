#ifndef _WIFI_CONFIG_H_
#define _WIFI_CONFIG_H_

#include <WiFi.h>
#include <DNSServer.h>
#include <WebServer.h>
#include <SPIFFS.h>
#include <ArduinoJson.h>

#define DNS_PORT 53
#define WIFI_SSID_LENGTH 32
#define WIFI_PASSWORD_LENGTH 64
#define SERVER_URL_LENGTH 128

// WiFi credentials storage in SPIFFS
#define WIFI_CONFIG_FILE "/wifi_config.json"

// Default server URL (change this or configure via portal)
#define DEFAULT_SERVER_URL "http://192.168.1.100:3000"

/**
 * Stores WiFi credentials in SPIFFS
 */
void saveWiFiCredentials(const char* ssid, const char* password);

/**
 * Loads WiFi credentials from SPIFFS
 */
bool loadWiFiCredentials(char* ssid, char* password);

/**
 * Saves server URL configuration
 */
void saveServerUrl(const char* url);

/**
 * Loads server URL from storage
 */
bool loadServerUrl(char* url);

/**
 * Starts the captive portal for WiFi setup
 */
void startCaptivePortal();

/**
 * Connects to saved WiFi network
 * Returns true if successful, false otherwise
 */
bool connectToWiFi();

/**
 * Gets current WiFi status
 */
bool isWiFiConnected();

/**
 * Initializes SPIFFS filesystem
 */
bool initSPIFFS();

/**
 * Process captive portal requests (call in loop when portal is active)
 */
void processCaptivePortal();

/**
 * Stop captive portal
 */
void stopCaptivePortal();

#endif
