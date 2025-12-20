import { getAircraftIconDefinition, ICON_COLORS } from './aircraft-icons';

const ROTATION_STEP = 5; // 5 degree increments
const MAX_CACHE_SIZE = 1500; // Increased for pitch variants (LRU cache limit)
const iconCache = new Map();
const cacheAccessOrder = new Map(); // Track access order for LRU

// Pre-warming state
let isPreWarming = false;
let preWarmProgress = 0;

/**
 * Pitch brackets for 3D icon foreshortening
 * Icons compress vertically as camera tilts to create depth perception
 */
const PITCH_BRACKETS = [
  { name: 'flat', min: 0, max: 15, yScale: 1.0 },      // Normal 2D view
  { name: 'low', min: 15, max: 35, yScale: 0.85 },     // Slight foreshortening
  { name: 'medium', min: 35, max: 50, yScale: 0.70 },  // Moderate foreshortening
  { name: 'high', min: 50, max: 70, yScale: 0.55 },    // Strong foreshortening
  { name: 'steep', min: 70, max: 90, yScale: 0.40 },   // Maximum foreshortening
];

/**
 * Get the pitch bracket for a given pitch angle
 * @param {number} pitch - Camera pitch in degrees (0-85)
 * @returns {Object} Pitch bracket with name and yScale
 */
export function getPitchBracket(pitch) {
  const p = Math.abs(pitch || 0);
  return PITCH_BRACKETS.find(b => p >= b.min && p < b.max) || PITCH_BRACKETS[0];
}

/**
 * LRU cache eviction - remove least recently used items when cache is full
 */
function evictLRU() {
  if (iconCache.size < MAX_CACHE_SIZE) return;
  
  // Find least recently accessed item
  let oldestKey = null;
  let oldestTime = Infinity;
  
  for (const [key, time] of cacheAccessOrder.entries()) {
    if (time < oldestTime) {
      oldestTime = time;
      oldestKey = key;
    }
  }
  
  if (oldestKey) {
    iconCache.delete(oldestKey);
    cacheAccessOrder.delete(oldestKey);
  }
}

/**
 * Get a cached bitmap for an aircraft icon with LRU caching
 * Supports pitch-based foreshortening for 3D depth perception
 * @param {Object} params - Icon parameters
 * @param {string} params.type - Aircraft icon type
 * @param {string} params.color - Icon color (hex)
 * @param {number} params.size - Icon size in pixels
 * @param {number} params.rotation - Aircraft heading rotation
 * @param {number} params.pitch - Camera pitch for foreshortening (0-85)
 * @param {boolean} params.isDepthLayer - Whether this is for the depth/shadow layer
 * @param {boolean} params.emergency - Emergency state
 * @param {boolean} params.selected - Selected state
 * @param {Object} params.aircraft - Aircraft data for silhouette lookup
 * @returns {Promise<ImageBitmap|null>} Cached bitmap
 */
export async function getIconBitmap({ type, color, size, rotation, pitch = 0, isDepthLayer = false, emergency, selected, aircraft = null }) {
  // Normalize rotation to buckets
  const normalizedRotation = Math.round(rotation / ROTATION_STEP) * ROTATION_STEP % 360;

  // Get pitch bracket for foreshortening
  const pitchBracket = getPitchBracket(pitch);

  // Extended cache key includes pitch bracket and depth layer flag
  const cacheKey = `${type}-${color}-${size}-${normalizedRotation}-${pitchBracket.name}-${isDepthLayer}-${emergency}-${selected}`;

  // Check cache and update access time
  if (iconCache.has(cacheKey)) {
    cacheAccessOrder.set(cacheKey, Date.now());
    return iconCache.get(cacheKey);
  }

  // Evict if needed
  evictLRU();

  // Try using OffscreenCanvas for better performance (if available)
  let canvas;
  let ctx;

  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(size, size);
    ctx = canvas.getContext('2d');
  } else {
    canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    ctx = canvas.getContext('2d');
  }

  const iconDef = getAircraftIconDefinition(aircraft, type);
  const iconColor = selected ? ICON_COLORS.selected : (emergency ? ICON_COLORS.emergency : color);

  // Build SVG with filled paths
  const paths = iconDef.paths.map(path => {
    if (path.stroke && !path.fill) {
      return `<path d="${path.d}" fill="none" stroke="${iconColor}" stroke-width="${path.strokeWidth || 1.5}" stroke-linecap="round" stroke-linejoin="round" opacity="${path.opacity || 1}" />`;
    }
    return `<path d="${path.d}" fill="${path.fill ? iconColor : 'none'}" stroke="${path.stroke ? iconColor : 'none'}" stroke-width="${path.strokeWidth || 0}" opacity="${path.opacity || 1}" />`;
  }).join('');

  const [, , vbWidth, vbHeight] = iconDef.viewBox.split(' ').map(Number);
  const centerX = vbWidth / 2;
  const centerY = vbHeight / 2;

  // Calculate foreshortening transform for 3D depth perception
  const yScale = pitchBracket.yScale;
  // Slight upward shift to compensate for vertical compression
  const yOffset = centerY * (1 - yScale) * 0.3;

  // Build transform: first rotate, then apply foreshortening
  // Transform order: translate to center -> scale Y -> translate back with offset -> rotate
  const transform = yScale < 1
    ? `translate(${centerX}, ${centerY}) scale(1, ${yScale}) translate(${-centerX}, ${-centerY + yOffset}) rotate(${normalizedRotation} ${centerX} ${centerY})`
    : `rotate(${normalizedRotation} ${centerX} ${centerY})`;

  // Add depth gradient shading for depth layer icons (creates subtle top-to-bottom shading)
  const pitchIntensity = (1 - yScale) / 0.6; // 0 at flat, 1 at steep
  const depthGradient = isDepthLayer && pitchIntensity > 0 ? `
    <defs>
      <linearGradient id="depth-shade" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="white" stop-opacity="${0.05 + pitchIntensity * 0.1}"/>
        <stop offset="100%" stop-color="black" stop-opacity="${pitchIntensity * 0.15}"/>
      </linearGradient>
      <mask id="depth-mask">
        <rect width="100%" height="100%" fill="url(#depth-shade)"/>
      </mask>
    </defs>
  ` : '';

  const svgString = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="${iconDef.viewBox}" width="${size}" height="${size}">
      ${depthGradient}
      <g transform="${transform}">
        ${paths}
      </g>
    </svg>
  `;

  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      try {
        const bitmap = await createImageBitmap(img);
        iconCache.set(cacheKey, bitmap);
        cacheAccessOrder.set(cacheKey, Date.now());
        resolve(bitmap);
      } catch (e) {
        console.error('Failed to create ImageBitmap', e);
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Pre-warm the cache with common icon types, rotations, and pitch variants
 * Uses requestIdleCallback to avoid blocking main thread
 */
export function preWarmCache() {
  if (isPreWarming) return;

  isPreWarming = true;
  preWarmProgress = 0;

  const commonTypes = ['a320-family', 'b737-family', 'citation', 'helicopter', 'c172'];
  const commonSizes = [24, 32, 40];
  const commonRotations = [0, 45, 90, 135, 180, 225, 270, 315]; // 8 directions
  const commonColors = Object.values(ICON_COLORS).slice(0, 5); // Top 5 colors
  // Pre-warm flat and medium pitch (most common states)
  const commonPitches = [0, 45]; // Flat (2D) and medium (common 3D angle)

  const tasks = [];
  for (const type of commonTypes) {
    for (const size of commonSizes) {
      for (const rotation of commonRotations) {
        for (const color of commonColors) {
          for (const pitch of commonPitches) {
            // Pre-warm both regular and depth layer variants for 3D
            tasks.push({ type, size, rotation, color, pitch, isDepthLayer: false, emergency: false, selected: false });
            if (pitch > 0) {
              tasks.push({ type, size, rotation, color, pitch, isDepthLayer: true, emergency: false, selected: false });
            }
          }
        }
      }
    }
  }
  
  let taskIndex = 0;
  const totalTasks = tasks.length;
  
  const processNextBatch = (deadline) => {
    while ((deadline.timeRemaining() > 0 || deadline.didTimeout) && taskIndex < tasks.length) {
      const task = tasks[taskIndex];
      getIconBitmap(task).catch(err => {
        console.warn('Pre-warm cache error:', err);
      });
      taskIndex++;
      preWarmProgress = (taskIndex / totalTasks) * 100;
    }
    
    if (taskIndex < tasks.length) {
      requestIdleCallback(processNextBatch, { timeout: 1000 });
    } else {
      isPreWarming = false;
      console.log(`Icon cache pre-warmed: ${iconCache.size} bitmaps cached`);
    }
  };
  
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(processNextBatch, { timeout: 1000 });
  } else {
    // Fallback for browsers without requestIdleCallback
    setTimeout(() => {
      tasks.forEach(task => getIconBitmap(task));
      isPreWarming = false;
    }, 100);
  }
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    size: iconCache.size,
    maxSize: MAX_CACHE_SIZE,
    isPreWarming,
    preWarmProgress,
  };
}

/**
 * Clear the icon cache
 */
export function clearIconCache() {
  iconCache.clear();
  cacheAccessOrder.clear();
}
