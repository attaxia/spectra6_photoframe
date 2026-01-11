#include "ImageDownloader.h"
#include "DEV_Config.h"
#include "../GUI/GUI_Paint.h"
#include "../Fonts/fonts.h"
#include "../e-Paper/EPD_7in3e.h"

static uint16_t readLe16(const uint8_t* p) {
  return (uint16_t)p[0] | ((uint16_t)p[1] << 8);
}

static uint32_t readLe32(const uint8_t* p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static bool readExact(WiFiClient* stream, uint8_t* out, size_t len, uint32_t timeoutMs = 15000) {
  size_t got = 0;
  uint32_t lastProgress = millis();

  while (got < len) {
    size_t n = stream->readBytes(out + got, len - got);
    if (n > 0) {
      got += n;
      lastProgress = millis();
      continue;
    }

    if ((millis() - lastProgress) > timeoutMs) {
      return false;
    }
    delay(1);
  }

  return true;
}

static bool skipExact(WiFiClient* stream, size_t len, uint32_t timeoutMs = 15000) {
  uint8_t scratch[64];
  size_t remaining = len;
  while (remaining > 0) {
    size_t chunk = remaining > sizeof(scratch) ? sizeof(scratch) : remaining;
    if (!readExact(stream, scratch, chunk, timeoutMs)) {
      return false;
    }
    remaining -= chunk;
  }
  return true;
}

static inline uint32_t dist2(uint8_t r1, uint8_t g1, uint8_t b1, uint8_t r2, uint8_t g2, uint8_t b2) {
  int dr = (int)r1 - (int)r2;
  int dg = (int)g1 - (int)g2;
  int db = (int)b1 - (int)b2;
  return (uint32_t)(dr * dr + dg * dg + db * db);
}

static inline uint8_t absDiffU8(uint8_t a, uint8_t b) {
  return (a > b) ? (uint8_t)(a - b) : (uint8_t)(b - a);
}

static inline bool nearRgb(uint8_t r, uint8_t g, uint8_t b, uint8_t rr, uint8_t gg, uint8_t bb, uint8_t tol) {
  return absDiffU8(r, rr) <= tol && absDiffU8(g, gg) <= tol && absDiffU8(b, bb) <= tol;
}

static UBYTE mapRgbToEpdColor(uint8_t r, uint8_t g, uint8_t b) {
  struct PaletteEntry {
    uint8_t r;
    uint8_t g;
    uint8_t b;
    UBYTE epd;
  };

  // The server pipeline ends with replaceColors() into device colors.
  // Prefer exact/near-exact matches to those device colors to avoid introducing
  // structured artifacts by re-quantizing an already-dithered image.
  const uint8_t tol = 6;
  if (nearRgb(r, g, b, 0x00, 0x00, 0x00, tol)) return EPD_7IN3E_BLACK;
  if (nearRgb(r, g, b, 0xFF, 0xFF, 0xFF, tol)) return EPD_7IN3E_WHITE;
  if (nearRgb(r, g, b, 0xFF, 0x00, 0x00, tol)) return EPD_7IN3E_RED;
  if (nearRgb(r, g, b, 0x00, 0xFF, 0x00, tol)) return EPD_7IN3E_GREEN;
  if (nearRgb(r, g, b, 0x00, 0x00, 0xFF, tol)) return EPD_7IN3E_BLUE;
  if (nearRgb(r, g, b, 0xFF, 0xFF, 0x00, tol)) return EPD_7IN3E_YELLOW;

  // Fallback: match both the "device" colors (pure primaries) and the "palette" colors
  // used by the server-side dithering (slightly off primaries).
  static const PaletteEntry kPalette[] = {
      {0x00, 0x00, 0x00, EPD_7IN3E_BLACK},
      {0x19, 0x1E, 0x21, EPD_7IN3E_BLACK},

      {0xFF, 0xFF, 0xFF, EPD_7IN3E_WHITE},
      {0xE8, 0xE8, 0xE8, EPD_7IN3E_WHITE},

      {0xFF, 0x00, 0x00, EPD_7IN3E_RED},
      {0xB2, 0x13, 0x18, EPD_7IN3E_RED},

      {0x00, 0x00, 0xFF, EPD_7IN3E_BLUE},
      {0x21, 0x57, 0xBA, EPD_7IN3E_BLUE},

      {0x00, 0xFF, 0x00, EPD_7IN3E_GREEN},
      {0x12, 0x5F, 0x20, EPD_7IN3E_GREEN},

      {0xFF, 0xFF, 0x00, EPD_7IN3E_YELLOW},
      {0xEF, 0xDE, 0x44, EPD_7IN3E_YELLOW},
  };

  uint32_t best = 0xFFFFFFFFu;
  UBYTE bestColor = EPD_7IN3E_WHITE;

  for (size_t i = 0; i < sizeof(kPalette) / sizeof(kPalette[0]); i++) {
    uint32_t d = dist2(r, g, b, kPalette[i].r, kPalette[i].g, kPalette[i].b);
    if (d < best) {
      best = d;
      bestColor = kPalette[i].epd;
    }
  }

  return bestColor;
}

/**
 * Parse BMP header to verify format
 * Returns the offset to pixel data, or 0 if invalid
 */
uint32_t parseBmpHeader(uint8_t* header, uint32_t headerSize) {
  if (headerSize < 54) {
    Serial.println("BMP header too small");
    return 0;
  }

  // Check BMP signature
  if (header[0] != 'B' || header[1] != 'M') {
    Serial.println("Invalid BMP signature");
    return 0;
  }

  // Get pixel data offset from header (at offset 10)
  uint32_t pixelDataOffset = readLe32(header + 10);

  // Get width and height (at offset 18 and 22)
  int32_t width = (int32_t)readLe32(header + 18);
  int32_t height = (int32_t)readLe32(header + 22);

  // Get bits per pixel (at offset 28)
  uint16_t bitsPerPixel = readLe16(header + 28);

  Serial.printf("BMP: %d x %d, %d bits/pixel, pixel data at offset %d\n", 
                width, height, bitsPerPixel, pixelDataOffset);

  // Verify it's 24-bit BMP
  if (bitsPerPixel != 24) {
    Serial.println("Only 24-bit BMP is supported");
    return 0;
  }

  // Verify dimensions match display
  if (width != EPD_7IN3E_WIDTH || abs(height) != EPD_7IN3E_HEIGHT) {
    Serial.printf("BMP dimensions mismatch: expected %d x %d\n", 
                  EPD_7IN3E_WIDTH, EPD_7IN3E_HEIGHT);
    return 0;
  }

  return pixelDataOffset;
}

/**
 * Process BMP pixel data (BGR format) to e-paper color format
 * BMP stores data bottom-up, so we read in reverse
 */
void processBmpPixel(uint8_t b, uint8_t g, uint8_t r, 
                     UBYTE* imageBuffer, uint32_t pixelIndex) {
  UBYTE color = mapRgbToEpdColor(r, g, b);

  // 7in3e framebuffer is 4bpp packed: 2 pixels per byte
  uint32_t byteIndex = pixelIndex / 2;
  uint32_t pixelInByte = pixelIndex % 2;

  if (pixelInByte == 0) {
    imageBuffer[byteIndex] = (imageBuffer[byteIndex] & 0x0F) | ((color & 0x0F) << 4);
  } else {
    imageBuffer[byteIndex] = (imageBuffer[byteIndex] & 0xF0) | (color & 0x0F);
  }
}

/**
 * Download and display image from server
 */
bool downloadAndDisplayImage(const char* serverUrl) {
  bool displayInitialized = false;
  
  if (!serverUrl || strlen(serverUrl) == 0) {
    Serial.println("Invalid server URL");
    return false;
  }

  // Build the image endpoint URL
  char imageUrl[256];
  snprintf(imageUrl, sizeof(imageUrl), "%s/esp32/frame", serverUrl);

  Serial.printf("Downloading packed frame from: %s\n", imageUrl);

  HTTPClient http;
  http.setTimeout(30000);

  if (!http.begin(imageUrl)) {
    Serial.println("Failed to begin HTTP request");
    return false;
  }

  http.addHeader("Connection", "close");

  int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    Serial.printf("HTTP request failed with code: %d\n", httpCode);
    if (httpCode > 0) {
      Serial.println(http.getString());
    } else {
      Serial.println("Connection failed - check server URL and network");
    }
    http.end();
    return false;
  }

  const String fmt = http.header("X-Image-Format");
  Serial.printf("X-Image-Format: %s\n", fmt.c_str());

  const int totalSize = http.getSize();
  Serial.printf("Frame size (Content-Length): %d bytes\n", totalSize);

  const uint32_t expectedLen = (uint32_t)(EPD_7IN3E_WIDTH / 2) * (uint32_t)EPD_7IN3E_HEIGHT; // 192000
  if (totalSize > 0 && (uint32_t)totalSize != expectedLen) {
    Serial.printf("Unexpected frame size: got %d, expected %u\n", totalSize, expectedLen);
    http.end();
    return false;
  }

  if (DEV_Module_Init() != 0) {
    Serial.println("Failed to initialize display module");
    http.end();
    return false;
  }

  Serial.println("Initializing e-Paper display...");
  EPD_7IN3E_Init();
  displayInitialized = true;

  // Optional clear before drawing
  EPD_7IN3E_Clear(EPD_7IN3E_WHITE);
  delay(500);

  WiFiClient* stream = http.getStreamPtr();

  Serial.println("Streaming frame to e-Paper...");
  const uint32_t lenToRead = (totalSize > 0) ? (uint32_t)totalSize : expectedLen;
  const bool ok = EPD_7IN3E_DisplayStream(*stream, lenToRead);

  http.end();

  if (!ok) {
    Serial.println("Failed while streaming frame to display");
    if (displayInitialized) {
      EPD_7IN3E_Sleep();
    }
    return false;
  }

  delay(2000);
  EPD_7IN3E_Sleep();
  delay(500);

  Serial.println("Image display complete");
  return true;
}

/**
 * Cleanup and deinitialize display after error
 */
void cleanupDisplay() {
  Serial.println("Cleaning up display...");
  
  // Just put the display to sleep, don't fully exit the module
  // This allows us to reinitialize more easily
  EPD_7IN3E_Sleep();
  delay(2000); // Longer delay to ensure display is fully asleep
  
  Serial.println("Display cleanup complete");
}
