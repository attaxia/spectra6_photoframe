#ifndef _IMAGE_DOWNLOADER_H_
#define _IMAGE_DOWNLOADER_H_

#include <HTTPClient.h>
#include <WiFi.h>

// Chunk size for streaming packed framebuffer data
#define FRAME_CHUNK_SIZE 4096

/**
 * Downloads an image from the server and displays it on the e-paper display
 * The image should be packed 4bpp framebuffer data from the /esp32/frame endpoint
 * 
 * @param serverUrl The base URL of the server (e.g., "http://192.168.1.100:3000")
 * @return true if successful, false otherwise
 */
bool downloadAndDisplayImage(const char* serverUrl);

/**
 * Cleanup and deinitialize display after error
 */
void cleanupDisplay();

// Optional: allow callers to skip display operations when network-only failures happen.

#endif
