import { createCanvas, loadImage } from 'canvas';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Import the built TypeScript modules directly
import { getDefaultPalettes, getDeviceColors, ditherImage as ditherImageTS, replaceColors as replaceColorsTS } from '../dist/index.es.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
 * Process an image file for e-paper display using the exact same methods as the client-side code
 */
export async function processImage(imageInput, deviceType = 'spectra6', processingOptions = {}) {
  let sourceCanvas;
  const toCanvas = (input) => {
    const canvas = createCanvas(input.width, input.height);
    const ctx = canvas.getContext('2d');
    configureContext(ctx);
    ctx.drawImage(input, 0, 0);
    return canvas;
  };

  if (typeof imageInput === 'string') {
    const image = await loadImage(imageInput);
    sourceCanvas = toCanvas(image);
  } else if (imageInput && typeof imageInput.getContext === 'function') {
    sourceCanvas = toCanvas(imageInput);
  } else {
    throw new Error('processImage expects a file path or a canvas-like object');
  }
  
  // Get palette and device colors using the imported functions
  const palette = getDefaultPalettes(deviceType);
  const deviceColorSet = getDeviceColors(deviceType);
  
  // Step 1: Dither the image using the TypeScript implementation
  // Create output canvas for dithering
  const ditheredCanvas = createCanvas(sourceCanvas.width, sourceCanvas.height);
  
  // Use default options matching the client-side (errorDiffusion with floydSteinberg)
  // Allow callers to override (e.g., enable serpentine for ESP32 to reduce streaking).
  const options = {
    ditheringType: "errorDiffusion",
    errorDiffusionMatrix: "floydSteinberg",
    palette: palette,
    calibrate: true,
    ...(processingOptions?.ditherOptions || {}),
  };
  
  await ditherImageTS(sourceCanvas, ditheredCanvas, options);
  
  // Step 2: Replace colors with device-specific colors using the TypeScript implementation
  const deviceColorsCanvas = createCanvas(sourceCanvas.width, sourceCanvas.height);
  replaceColorsTS(ditheredCanvas, deviceColorsCanvas, {
    originalColors: palette,
    replaceColors: deviceColorSet,
  });
  
  return deviceColorsCanvas;
}