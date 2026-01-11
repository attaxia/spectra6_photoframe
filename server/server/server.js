import express from 'express';
import { processImage } from './imageProcessor.js';
import { createCanvas, loadImage } from 'canvas';
import { readFileSync, copyFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import exifReader from 'exif-reader';
import multer from 'multer';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const TARGET_WIDTH = 480;
const TARGET_HEIGHT = 800;

// Images directory
const IMAGES_DIR = process.env.IMAGES_DIR || join(__dirname, 'images');
if (!existsSync(IMAGES_DIR)) {
  mkdirSync(IMAGES_DIR, { recursive: true });
}

// Initialize with example image if directory is empty
const exampleImagePath = join(__dirname, 'example.png');
if (existsSync(exampleImagePath)) {
  const existingImages = getImageFiles();
  if (existingImages.length === 0) {
    copyFileSync(exampleImagePath, join(IMAGES_DIR, 'example.png'));
  }
}

// Configure multer for file uploads
const upload = multer({
  dest: join(__dirname, 'temp'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only image files are allowed.'));
    }
  }
});

const DEVICE_TYPE = process.env.DEVICE_TYPE || 'spectra6';

/**
 * Get all image files from the images directory
 */
function getImageFiles() {
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
  return readdirSync(IMAGES_DIR)
    .filter(file => allowedExtensions.includes(extname(file).toLowerCase()))
    .map(file => join(IMAGES_DIR, file));
}

/**
 * Get a random image from the images directory
 */
function getRandomImage() {
  const images = getImageFiles();
  if (images.length === 0) {
    throw new Error('No images available');
  }
  return images[Math.floor(Math.random() * images.length)];
}

function configureContext(ctx) {
  if (!ctx) {
    return;
  }
  ctx.imageSmoothingEnabled = false;
  if (typeof ctx.patternQuality !== 'undefined') {
    ctx.patternQuality = 'nearest';
  }
  if (typeof ctx.quality !== 'undefined') {
    ctx.quality = 'nearest';
  }
  if (typeof ctx.antialias !== 'undefined') {
    ctx.antialias = 'none';
  }
  if (typeof ctx.filter !== 'undefined') {
    ctx.filter = 'nearest';
  }
}

/**
 * Get EXIF orientation from image file
 */
function getImageOrientation(imagePath) {
  try {
    const buffer = readFileSync(imagePath);
    // Look for EXIF marker in JPEG (0xFFE1)
    const exifMarker = buffer.indexOf(Buffer.from([0xFF, 0xE1]));
    if (exifMarker === -1) return 1; // No EXIF, default orientation
    
    const exifLength = buffer.readUInt16BE(exifMarker + 2);
    const exifBuffer = buffer.subarray(exifMarker + 4, exifMarker + 2 + exifLength);
    
    // Check for EXIF header
    if (!exifBuffer.toString('ascii', 0, 4).includes('Exif')) return 1;
    
    const exifData = exifReader(exifBuffer.subarray(6)); // Skip 'Exif\0\0'
    return exifData?.image?.Orientation || 1;
  } catch (err) {
    console.warn('Could not read EXIF orientation:', err.message);
    return 1; // Default orientation
  }
}

/**
 * Resize and crop image to target dimensions
 */
async function resizeAndCropImage(imagePath, targetWidth, targetHeight, opts = {}) {
  // Load the source image
  const image = await loadImage(imagePath);
  
  // Get EXIF orientation
  let orientation = getImageOrientation(imagePath);
  console.log(`Image loaded: ${image.width}x${image.height}, EXIF orientation: ${orientation}`);
  
  const enableAspectAutoRotate = opts?.enableAspectAutoRotate ?? true;
  const aspectAutoRotateOrientation = opts?.aspectAutoRotateOrientation ?? 6;

  // Auto-rotate: If source and target aspect ratios are inverted, apply 90° rotation
  // This handles cases where EXIF is missing or incorrect.
  // NOTE: This is a heuristic; some callers (e.g., ESP32) may prefer it disabled.
  const sourceIsLandscape = image.width > image.height;
  const targetIsPortrait = targetHeight > targetWidth;
  const sourceIsPortrait = image.height > image.width;
  const targetIsLandscape = targetWidth > targetHeight;
  
  const shouldAutoRotate = (sourceIsLandscape && targetIsPortrait) || (sourceIsPortrait && targetIsLandscape);
  
  if (enableAspectAutoRotate && shouldAutoRotate && orientation === 1) {
    // Apply a 90° rotation when aspect ratios are mismatched.
    // Default is 90° CW (6), but some consumers want 90° CCW (8).
    orientation = aspectAutoRotateOrientation;
    console.log(
      `Auto-rotating (orientation ${orientation}): source ${image.width}x${image.height} vs target ${targetWidth}x${targetHeight}`
    );
  }

  // If the image already matches the target dimensions and no orientation is needed, skip re-encoding.
  if (orientation === 1 && image.width === targetWidth && image.height === targetHeight) {
    console.log('Image already at target size with no orientation change; skipping resize.');
    return imagePath;
  }
  
  // Step 1: Apply EXIF orientation to source image
  let orientedWidth = image.width;
  let orientedHeight = image.height;
  
  // Orientations 5-8 swap dimensions
  if (orientation >= 5 && orientation <= 8) {
    [orientedWidth, orientedHeight] = [orientedHeight, orientedWidth];
  }
  
  // Create canvas for properly oriented image
  const orientedCanvas = createCanvas(orientedWidth, orientedHeight);
  const octx = orientedCanvas.getContext('2d');
  configureContext(octx);
  
  // Apply orientation transform
  switch (orientation) {
    case 1: // Normal
      octx.drawImage(image, 0, 0);
      break;
    case 2: // Flip horizontal
      octx.translate(orientedWidth, 0);
      octx.scale(-1, 1);
      octx.drawImage(image, 0, 0);
      break;
    case 3: // Rotate 180°
      octx.translate(orientedWidth, orientedHeight);
      octx.rotate(Math.PI);
      octx.drawImage(image, 0, 0);
      break;
    case 4: // Flip vertical
      octx.translate(0, orientedHeight);
      octx.scale(1, -1);
      octx.drawImage(image, 0, 0);
      break;
    case 5: // Rotate 90° CW + flip horizontal
      octx.rotate(Math.PI / 2);
      octx.scale(1, -1);
      octx.drawImage(image, 0, -orientedWidth);
      break;
    case 6: // Rotate 90° CW
      octx.rotate(Math.PI / 2);
      octx.translate(0, -orientedWidth);
      octx.drawImage(image, 0, 0);
      break;
    case 7: // Rotate 90° CCW + flip horizontal
      octx.rotate(-Math.PI / 2);
      octx.scale(1, -1);
      octx.translate(-orientedHeight, 0);
      octx.drawImage(image, 0, 0);
      break;
    case 8: // Rotate 90° CCW
      octx.rotate(-Math.PI / 2);
      octx.translate(-orientedHeight, 0);
      octx.drawImage(image, 0, 0);
      break;
  }
  
  console.log(`Oriented image: ${orientedWidth}x${orientedHeight}`);
  
  // Step 2: Crop and resize from oriented image
  const sourceAspect = orientedWidth / orientedHeight;
  const targetAspect = targetWidth / targetHeight;
  
  let drawWidth, drawHeight, offsetX = 0, offsetY = 0;
  
  if (sourceAspect > targetAspect) {
    // Source is wider - crop width
    drawHeight = orientedHeight;
    drawWidth = orientedHeight * targetAspect;
    offsetX = (orientedWidth - drawWidth) / 2;
  } else {
    // Source is taller - crop height
    drawWidth = orientedWidth;
    drawHeight = orientedWidth / targetAspect;
    offsetY = (orientedHeight - drawHeight) / 2;
  }
  
  console.log(`Crop region: ${drawWidth.toFixed(0)}x${drawHeight.toFixed(0)} at (${offsetX.toFixed(0)}, ${offsetY.toFixed(0)})`);
  
  // If no cropping is necessary and dimensions already match, return the oriented canvas
  const epsilon = 0.01;
  const dimensionsMatch =
    Math.abs(drawWidth - targetWidth) < epsilon &&
    Math.abs(drawHeight - targetHeight) < epsilon &&
    Math.abs(offsetX) < epsilon &&
    Math.abs(offsetY) < epsilon;

  if (dimensionsMatch) {
    console.log('Dimensions already match target after orientation; skipping further resize.');
    return orientedCanvas;
  }

  // Create target canvas and draw cropped/resized region
  const canvas = createCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext('2d');
  configureContext(ctx);

  ctx.drawImage(
    orientedCanvas,
    offsetX, offsetY, drawWidth, drawHeight,  // Source crop from oriented image
    0, 0, targetWidth, targetHeight           // Destination
  );

  return canvas;
}

/**
 * Encode canvas pixels into a 24-bit BMP Buffer (BGR, bottom-up rows)
 */
function encodeBmp24(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, width, height).data; // RGBA

  const bytesPerPixel = 3; // 24-bit BGR
  const rowSize = width * bytesPerPixel;
  const padding = (4 - (rowSize % 4)) % 4; // rows padded to 4-byte boundary
  const pixelArraySize = (rowSize + padding) * height;

  const fileHeaderSize = 14;
  const dibHeaderSize = 40; // BITMAPINFOHEADER
  const pixelDataOffset = fileHeaderSize + dibHeaderSize;
  const fileSize = pixelDataOffset + pixelArraySize;

  const buf = Buffer.alloc(fileSize);
  let pos = 0;

  // BMP file header
  buf.write('BM', pos, 2, 'ascii'); pos += 2;                 // Signature
  buf.writeUInt32LE(fileSize, pos); pos += 4;                  // File size
  buf.writeUInt16LE(0, pos); pos += 2;                         // Reserved1
  buf.writeUInt16LE(0, pos); pos += 2;                         // Reserved2
  buf.writeUInt32LE(pixelDataOffset, pos); pos += 4;           // Pixel data offset

  // DIB header (BITMAPINFOHEADER)
  buf.writeUInt32LE(dibHeaderSize, pos); pos += 4;             // Header size
  buf.writeInt32LE(width, pos); pos += 4;                      // Width
  buf.writeInt32LE(height, pos); pos += 4;                     // Height (positive => bottom-up)
  buf.writeUInt16LE(1, pos); pos += 2;                         // Color planes
  buf.writeUInt16LE(24, pos); pos += 2;                        // Bits per pixel
  buf.writeUInt32LE(0, pos); pos += 4;                         // Compression (BI_RGB)
  buf.writeUInt32LE(pixelArraySize, pos); pos += 4;            // Image size
  buf.writeInt32LE(2835, pos); pos += 4;                       // X pixels per meter (~72 DPI)
  buf.writeInt32LE(2835, pos); pos += 4;                       // Y pixels per meter
  buf.writeUInt32LE(0, pos); pos += 4;                         // Colors in color table
  buf.writeUInt32LE(0, pos); pos += 4;                         // Important color count

  // Pixel array: write rows bottom-up, each pixel as B, G, R; pad each row
  let dataPos = pixelDataOffset;
  for (let y = height - 1; y >= 0; y--) {
    const rowStart = y * width * 4; // RGBA stride
    for (let x = 0; x < width; x++) {
      const i = rowStart + x * 4;
      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];
      // Write BGR
      buf[dataPos++] = b;
      buf[dataPos++] = g;
      buf[dataPos++] = r;
    }
    // Row padding
    for (let p = 0; p < padding; p++) {
      buf[dataPos++] = 0;
    }
  }

  return buf;
}

function mapRgbTo7In3eIndex(r, g, b) {
  // Waveshare 7.3" (F) 7-color indices as used by the ESP32 driver:
  // BLACK=0x0, WHITE=0x1, YELLOW=0x2, RED=0x3, BLUE=0x5, GREEN=0x6
  const colors = [
    { r: 0x00, g: 0x00, b: 0x00, i: 0x0 }, // black
    { r: 0xff, g: 0xff, b: 0xff, i: 0x1 }, // white
    { r: 0xff, g: 0xff, b: 0x00, i: 0x2 }, // yellow
    { r: 0xff, g: 0x00, b: 0x00, i: 0x3 }, // red
    { r: 0x00, g: 0x00, b: 0xff, i: 0x5 }, // blue
    { r: 0x00, g: 0xff, b: 0x00, i: 0x6 }, // green
  ];

  // Fast path for exact matches (replaceColors() should already output these)
  for (const c of colors) {
    if (r === c.r && g === c.g && b === c.b) {
      return c.i;
    }
  }

  // Fallback: nearest color
  let best = Infinity;
  let bestIndex = 0x1;
  for (const c of colors) {
    const dr = r - c.r;
    const dg = g - c.g;
    const db = b - c.b;
    const d = dr * dr + dg * dg + db * db;
    if (d < best) {
      best = d;
      bestIndex = c.i;
    }
  }
  return bestIndex;
}

/**
 * Encode canvas pixels into Waveshare 7.3" (F) native packed 4bpp framebuffer.
 * Layout: row-major, top-down; 2 pixels per byte (high nibble = left pixel).
 * Size: (width/2)*height bytes.
 */
function encode7In3ePacked4bpp(canvas) {
  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, width, height).data; // RGBA

  const bytesPerRow = Math.floor(width / 2);
  const out = Buffer.alloc(bytesPerRow * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const r = imageData[p];
      const g = imageData[p + 1];
      const b = imageData[p + 2];
      const idx = mapRgbTo7In3eIndex(r, g, b) & 0x0f;

      const byteIndex = y * bytesPerRow + (x >> 1);
      if ((x & 1) === 0) {
        out[byteIndex] = (idx << 4) | (out[byteIndex] & 0x0f);
      } else {
        out[byteIndex] = (out[byteIndex] & 0xf0) | idx;
      }
    }
  }

  return out;
}

app.get('/bmp', async (req, res) => {
  try {
    const imagePath = getRandomImage();
    console.log(`Processing image: ${imagePath} for device: ${DEVICE_TYPE}`);
    
    // Resize and crop the image first
    const preparedCanvas = await resizeAndCropImage(imagePath, TARGET_WIDTH, TARGET_HEIGHT);
    console.log(`Image prepared for processing: ${preparedCanvas.width}x${preparedCanvas.height}`);
    
    // Process the prepared image
    const canvas = await processImage(preparedCanvas, DEVICE_TYPE);
    console.log(`Processed canvas dimensions: ${canvas.width}x${canvas.height}`);
    
    // Convert canvas to BMP buffer (24-bit BGR, bottom-up)
    const buffer = encodeBmp24(canvas);

    // Set appropriate headers for BMP
    res.set({
      'Content-Type': 'image/bmp',
      'Content-Length': buffer.length,
      'Cache-Control': 'public, max-age=3600'
    });

    // Send the image
    res.send(buffer);
    
  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).json({ 
      error: 'Failed to process image',
      message: error.message 
    });
  }
});

/**
 * ESP32 endpoint: Returns raw image data for e-paper display
 * Returns binary data optimized for ESP32's memory constraints
 */
app.get('/esp32/image', async (req, res) => {
  try {
    const imagePath = getRandomImage();
    console.log(`Processing image for ESP32: ${imagePath} for device: ${DEVICE_TYPE}`);

    // ESP32 7in3e panel native resolution is landscape 800x480.
    // Keep /png and /bmp defaults (TARGET_WIDTH/HEIGHT) unchanged.
    const ESP32_TARGET_WIDTH = 800;
    const ESP32_TARGET_HEIGHT = 480;

    // Resize and crop the image first
    // ESP32 target is landscape. Keep the aspect-ratio heuristic, but rotate the other
    // direction than the default to match the panel's expected orientation.
    const preparedCanvas = await resizeAndCropImage(
      imagePath,
      ESP32_TARGET_WIDTH,
      ESP32_TARGET_HEIGHT,
      { enableAspectAutoRotate: true, aspectAutoRotateOrientation: 8 }
    );
    console.log(`Image prepared for ESP32 processing: ${preparedCanvas.width}x${preparedCanvas.height}`);
    
    // Process the prepared image. Serpentine error diffusion reduces visible streaking
    // (directional artifacts) that can be more noticeable at 800x480.
    const canvas = await processImage(preparedCanvas, DEVICE_TYPE, { ditherOptions: { serpentine: true } });
    console.log(`Processed canvas dimensions for ESP32: ${canvas.width}x${canvas.height}`);
    
    // Convert canvas to BMP buffer (24-bit BGR, bottom-up)
    // This is the most efficient format for ESP32 to directly display
    const buffer = encodeBmp24(canvas);

    // Set appropriate headers for binary data
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': buffer.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Image-Width': canvas.width,
      'X-Image-Height': canvas.height,
      'X-Image-Format': 'bmp24'
    });

    // Send the image
    res.send(buffer);
    
  } catch (error) {
    console.error('Error processing image for ESP32:', error);
    res.status(500).json({ 
      error: 'Failed to process image for ESP32',
      message: error.message 
    });
  }
});

/**
 * ESP32 packed framebuffer endpoint (recommended for ESP32-WROOM-32 without PSRAM)
 * Returns the display-native packed 4bpp bytes for Waveshare 7.3" (F) 800x480.
 */
app.get('/esp32/frame', async (req, res) => {
  try {
    const imagePath = getRandomImage();
    console.log(`Processing packed frame for ESP32: ${imagePath} for device: ${DEVICE_TYPE}`);

    const ESP32_TARGET_WIDTH = 800;
    const ESP32_TARGET_HEIGHT = 480;

    const preparedCanvas = await resizeAndCropImage(
      imagePath,
      ESP32_TARGET_WIDTH,
      ESP32_TARGET_HEIGHT,
      { enableAspectAutoRotate: true, aspectAutoRotateOrientation: 8 }
    );
    console.log(`Image prepared for ESP32 frame: ${preparedCanvas.width}x${preparedCanvas.height}`);

    const canvas = await processImage(preparedCanvas, DEVICE_TYPE, { ditherOptions: { serpentine: true } });
    console.log(`Processed canvas dimensions for ESP32 frame: ${canvas.width}x${canvas.height}`);

    if (canvas.width !== ESP32_TARGET_WIDTH || canvas.height !== ESP32_TARGET_HEIGHT) {
      throw new Error(`Unexpected canvas size for ESP32 frame: ${canvas.width}x${canvas.height}`);
    }

    const buffer = encode7In3ePacked4bpp(canvas);
    const bytesPerRow = ESP32_TARGET_WIDTH / 2;

    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': buffer.length,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'X-Image-Width': canvas.width,
      'X-Image-Height': canvas.height,
      'X-Image-Format': 'epd7in3e_packed4bpp',
      'X-Bytes-Per-Row': bytesPerRow,
      'X-Byte-Order': 'row-major-top-down',
      'X-Nibble-Order': 'hi=left,lo=right'
    });

    res.send(buffer);
  } catch (error) {
    console.error('Error processing packed frame for ESP32:', error);
    res.status(500).json({
      error: 'Failed to process packed frame for ESP32',
      message: error.message
    });
  }
});

app.get('/png', async (req, res) => {
  try {
    const imagePath = getRandomImage();
    console.log(`Processing image as PNG: ${imagePath} for device: ${DEVICE_TYPE}`);
    
    // Resize and crop the image first
    const preparedCanvas = await resizeAndCropImage(imagePath, TARGET_WIDTH, TARGET_HEIGHT);
    console.log(`Image prepared for processing: ${preparedCanvas.width}x${preparedCanvas.height}`);
    
    // Process the prepared image
    const canvas = await processImage(preparedCanvas, DEVICE_TYPE);
    console.log(`Processed canvas dimensions: ${canvas.width}x${canvas.height}`);
    
    // Convert canvas to PNG buffer without gamma correction
    // Use compressionLevel 6 (default) and avoid gamma metadata
    const buffer = canvas.toBuffer('image/png', { compressionLevel: 6 });
    
    // Strip PNG gamma chunk (gAMA) to prevent browser gamma correction
    // PNG chunks are: length(4) + type(4) + data(length) + crc(4)
    const strippedBuffer = stripPngGamma(buffer);

    // Set appropriate headers for PNG
    res.set({
      'Content-Type': 'image/png',
      'Content-Length': strippedBuffer.length,
      'Cache-Control': 'public, max-age=3600'
    });

    // Send the image
    res.send(strippedBuffer);
    
  } catch (error) {
    console.error('Error processing image:', error);
    res.status(500).json({ 
      error: 'Failed to process image',
      message: error.message 
    });
  }
});

/**
 * Strip gAMA chunk from PNG buffer to prevent gamma correction
 */
function stripPngGamma(buffer) {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const GAMA_TYPE = Buffer.from('gAMA');
  
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return buffer; // Not a valid PNG
  }
  
  const chunks = [];
  let pos = 8; // Skip PNG signature
  
  while (pos < buffer.length) {
    if (pos + 12 > buffer.length) break; // Need at least length + type + crc
    
    const length = buffer.readUInt32BE(pos);
    const type = buffer.subarray(pos + 4, pos + 8);
    const chunkSize = 12 + length; // length(4) + type(4) + data + crc(4)
    
    if (pos + chunkSize > buffer.length) break;
    
    // Skip gAMA chunks
    if (!type.equals(GAMA_TYPE)) {
      chunks.push(buffer.subarray(pos, pos + chunkSize));
    }
    
    pos += chunkSize;
  }
  
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'E-paper optimizer server is running' });
});

/**
 * API endpoint: List all images
 */
app.get('/api/images', (req, res) => {
  try {
    const images = getImageFiles();
    const imageList = images.map(path => ({
      id: Buffer.from(path).toString('base64'),
      name: path.split('/').pop(),
      path: path
    }));
    res.json({ images: imageList });
  } catch (error) {
    console.error('Error listing images:', error);
    res.status(500).json({ error: 'Failed to list images', message: error.message });
  }
});

/**
 * API endpoint: Get thumbnail of an image
 */
app.get('/api/images/:id/thumbnail', async (req, res) => {
  try {
    const imagePath = Buffer.from(req.params.id, 'base64').toString();
    
    if (!existsSync(imagePath) || !imagePath.startsWith(IMAGES_DIR)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Create a small thumbnail
    const image = await loadImage(imagePath);
    const maxSize = 200;
    const scale = Math.min(maxSize / image.width, maxSize / image.height);
    const thumbWidth = Math.floor(image.width * scale);
    const thumbHeight = Math.floor(image.height * scale);
    
    const canvas = createCanvas(thumbWidth, thumbHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, thumbWidth, thumbHeight);
    
    const buffer = canvas.toBuffer('image/png');
    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch (error) {
    console.error('Error generating thumbnail:', error);
    res.status(500).json({ error: 'Failed to generate thumbnail', message: error.message });
  }
});

/**
 * API endpoint: Delete an image
 */
app.delete('/api/images/:id', (req, res) => {
  try {
    const images = getImageFiles();
    
    if (images.length <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last image' });
    }
    
    const imagePath = Buffer.from(req.params.id, 'base64').toString();
    
    if (!existsSync(imagePath) || !imagePath.startsWith(IMAGES_DIR)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    unlinkSync(imagePath);
    console.log(`Image deleted: ${imagePath}`);
    res.json({ success: true, message: 'Image deleted successfully' });
  } catch (error) {
    console.error('Error deleting image:', error);
    res.status(500).json({ error: 'Failed to delete image', message: error.message });
  }
});

app.get('/upload', (req, res) => {
  const imageCount = getImageFiles().length;
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Manage Images - E-Paper Optimizer</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    .header {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      padding: 30px;
      margin-bottom: 20px;
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
      font-size: 28px;
    }
    .subtitle {
      color: #666;
      margin-bottom: 20px;
      font-size: 14px;
    }
    .info {
      background: #f0f4ff;
      border-left: 4px solid #667eea;
      padding: 15px;
      margin-bottom: 20px;
      border-radius: 4px;
    }
    .info p {
      color: #555;
      font-size: 14px;
      line-height: 1.6;
      margin: 5px 0;
    }
    .info strong {
      color: #333;
    }
    .upload-section {
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      padding: 30px;
      margin-bottom: 20px;
    }
    .upload-area {
      border: 2px dashed #ddd;
      border-radius: 8px;
      padding: 40px 20px;
      text-align: center;
      margin-bottom: 20px;
      transition: all 0.3s;
      cursor: pointer;
    }
    .upload-area:hover {
      border-color: #667eea;
      background: #f9f9ff;
    }
    .upload-area.dragover {
      border-color: #667eea;
      background: #f0f4ff;
    }
    .upload-icon {
      font-size: 48px;
      color: #667eea;
      margin-bottom: 15px;
    }
    .upload-text {
      color: #666;
      margin-bottom: 10px;
    }
    .file-input {
      display: none;
    }
    .file-name {
      margin-top: 15px;
      padding: 10px;
      background: #f9f9f9;
      border-radius: 6px;
      color: #333;
      font-size: 14px;
      word-break: break-all;
    }
    .btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 14px 32px;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .btn:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px rgba(102, 126, 234, 0.4);
    }
    .btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .btn-small {
      padding: 8px 16px;
      font-size: 14px;
      width: auto;
      margin: 5px;
    }
    .btn-danger {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    }
    .message {
      margin-top: 20px;
      padding: 12px;
      border-radius: 6px;
      text-align: center;
      font-size: 14px;
      display: none;
    }
    .message.success {
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
    }
    .message.error {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }
    .images-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px;
      margin-top: 20px;
    }
    .image-card {
      background: white;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
      overflow: hidden;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .image-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 15px 40px rgba(0, 0, 0, 0.3);
    }
    .image-preview {
      width: 100%;
      height: 200px;
      object-fit: contain;
      background: #f5f5f5;
      padding: 10px;
    }
    .image-info {
      padding: 15px;
    }
    .image-name {
      font-weight: 600;
      color: #333;
      margin-bottom: 10px;
      word-break: break-all;
      font-size: 14px;
    }
    .image-actions {
      display: flex;
      gap: 5px;
      justify-content: center;
    }
    .links {
      text-align: center;
      margin-top: 20px;
    }
    .links a {
      color: white;
      text-decoration: none;
      margin: 0 10px;
      font-size: 14px;
      background: rgba(255, 255, 255, 0.2);
      padding: 8px 16px;
      border-radius: 6px;
      display: inline-block;
    }
    .links a:hover {
      background: rgba(255, 255, 255, 0.3);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📷 Manage Images</h1>
      <p class="subtitle">Upload and manage e-paper display images</p>
      
      <div class="info">
        <p><strong>Current images:</strong> <span id="imageCount">${imageCount}</span></p>
        <p><strong>Device:</strong> ${DEVICE_TYPE}</p>
        <p><strong>Display size:</strong> ${TARGET_WIDTH}×${TARGET_HEIGHT}px</p>
      </div>
    </div>

    <div class="upload-section">
      <h2 style="margin-bottom: 20px;">Upload New Image</h2>
      <form id="uploadForm" enctype="multipart/form-data">
        <div class="upload-area" id="uploadArea">
          <div class="upload-icon">📁</div>
          <div class="upload-text">
            <strong>Click to browse</strong> or drag and drop
          </div>
          <div style="color: #999; font-size: 12px; margin-top: 5px;">
            Supported: JPG, PNG, GIF, WebP, BMP (max 10MB)
          </div>
          <input type="file" id="fileInput" name="image" accept="image/*" class="file-input" required>
          <div id="fileName" class="file-name" style="display: none;"></div>
        </div>
        <button type="submit" class="btn" id="submitBtn">Upload Image</button>
      </form>
      <div id="uploadMessage" class="message"></div>
    </div>

    <div id="imagesContainer"></div>

    <div class="links">
      <a href="/png" target="_blank">View Random Image (PNG)</a>
      <a href="/">API Info</a>
    </div>
  </div>

  <script>
    const form = document.getElementById('uploadForm');
    const fileInput = document.getElementById('fileInput');
    const uploadArea = document.getElementById('uploadArea');
    const fileName = document.getElementById('fileName');
    const submitBtn = document.getElementById('submitBtn');
    const uploadMessage = document.getElementById('uploadMessage');
    const imagesContainer = document.getElementById('imagesContainer');
    const imageCount = document.getElementById('imageCount');

    // Load images on page load
    loadImages();

    // Click to upload
    uploadArea.addEventListener('click', (e) => {
      if (e.target !== fileInput) {
        fileInput.click();
      }
    });

    // File selected
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        fileName.textContent = '📄 ' + e.target.files[0].name;
        fileName.style.display = 'block';
      }
    });

    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        fileInput.files = e.dataTransfer.files;
        fileName.textContent = '📄 ' + e.dataTransfer.files[0].name;
        fileName.style.display = 'block';
      }
    });

    // Form submission
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (!fileInput.files.length) {
        showMessage('Please select a file', 'error', uploadMessage);
        return;
      }

      const formData = new FormData();
      formData.append('image', fileInput.files[0]);

      submitBtn.disabled = true;
      submitBtn.textContent = 'Uploading...';
      uploadMessage.style.display = 'none';

      try {
        const response = await fetch('/upload', {
          method: 'POST',
          body: formData
        });

        const result = await response.json();

        if (response.ok) {
          showMessage('✅ ' + result.message, 'success', uploadMessage);
          fileName.style.display = 'none';
          fileInput.value = '';
          loadImages(); // Reload image list
        } else {
          showMessage('❌ ' + (result.error || 'Upload failed'), 'error', uploadMessage);
        }
      } catch (error) {
        showMessage('❌ Network error: ' + error.message, 'error', uploadMessage);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Upload Image';
      }
    });

    async function loadImages() {
      try {
        const response = await fetch('/api/images');
        const data = await response.json();
        
        imageCount.textContent = data.images.length;
        
        if (data.images.length === 0) {
          imagesContainer.innerHTML = '<p style="text-align: center; color: white;">No images available</p>';
          return;
        }

        const grid = document.createElement('div');
        grid.className = 'images-grid';

        for (const image of data.images) {
          const card = document.createElement('div');
          card.className = 'image-card';
          
          const canDelete = data.images.length > 1;
          
          card.innerHTML = \`
            <img src="/api/images/\${image.id}/thumbnail" alt="\${image.name}" class="image-preview">
            <div class="image-info">
              <div class="image-name">\${image.name}</div>
              <div class="image-actions">
                <button class="btn btn-small btn-danger" onclick="deleteImage('\${image.id}')" \${!canDelete ? 'disabled' : ''}>🗑️ Delete</button>
              </div>
            </div>
          \`;
          
          grid.appendChild(card);
        }

        imagesContainer.innerHTML = '';
        imagesContainer.appendChild(grid);
      } catch (error) {
        console.error('Error loading images:', error);
        imagesContainer.innerHTML = '<p style="text-align: center; color: white;">Failed to load images</p>';
      }
    }

    async function deleteImage(id) {
      if (!confirm('Are you sure you want to delete this image?')) {
        return;
      }

      try {
        const response = await fetch(\`/api/images/\${id}\`, { method: 'DELETE' });
        const result = await response.json();
        
        if (response.ok) {
          loadImages(); // Reload to update list
        } else {
          alert('Failed to delete image: ' + result.error);
        }
      } catch (error) {
        alert('Error deleting image: ' + error.message);
      }
    }

    function showMessage(text, type, element) {
      element.textContent = text;
      element.className = 'message ' + type;
      element.style.display = 'block';
    }
  </script>
</body>
</html>
  `;
  res.send(html);
});

app.post('/upload', upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Generate unique filename
    const ext = extname(req.file.originalname);
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    const newFilename = `image_${timestamp}_${random}${ext}`;
    const newPath = join(IMAGES_DIR, newFilename);

    // Copy uploaded file with new name
    copyFileSync(req.file.path, newPath);
    console.log(`Image uploaded: ${newPath} (${req.file.originalname})`);

    res.json({ 
      success: true,
      message: 'Image uploaded successfully! The display may show this image on next refresh.',
      filename: req.file.originalname,
      path: newPath
    });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ 
      error: 'Failed to upload image',
      message: error.message 
    });
  }
});

app.get('/', (req, res) => {
  const imageCount = getImageFiles().length;
  res.json({
    name: 'E-Paper Image Optimizer API',
    version: '1.0.0',
    endpoints: {
      '/bmp': 'GET - Returns random optimized image for e-paper display as BMP',
      '/png': 'GET - Returns random optimized image for e-paper display as PNG',
      '/esp32/image': 'GET - Returns random optimized image for ESP32 as BMP',
      '/esp32/frame': 'GET - Returns random optimized image for ESP32 as packed 4bpp',
      '/upload': 'GET - Upload page to manage images',
      '/upload': 'POST - Upload new image file',
      '/api/images': 'GET - List all images',
      '/api/images/:id/thumbnail': 'GET - Get image thumbnail',
      '/api/images/:id': 'DELETE - Delete an image',
      '/health': 'GET - Health check endpoint'
    },
    config: {
      imagesDirectory: IMAGES_DIR,
      imageCount: imageCount,
      deviceType: DEVICE_TYPE
    }
  });
});

app.listen(PORT, () => {
  const imageCount = getImageFiles().length;
  console.log(`E-Paper Optimizer Server running on port ${PORT}`);
  console.log(`Images directory: ${IMAGES_DIR}`);
  console.log(`Available images: ${imageCount}`);
  console.log(`Device type: ${DEVICE_TYPE}`);
  console.log(`\nEndpoints:`);
  console.log(`  GET http://localhost:${PORT}/bmp - Get random optimized BMP image`);
  console.log(`  GET http://localhost:${PORT}/png - Get random optimized PNG image`);
  console.log(`  GET http://localhost:${PORT}/esp32/image - Get random optimized ESP32 BMP`);
  console.log(`  GET http://localhost:${PORT}/esp32/frame - Get random optimized ESP32 frame`);
  console.log(`  GET http://localhost:${PORT}/upload - Manage images`);
  console.log(`  GET http://localhost:${PORT}/health - Health check`);
});
