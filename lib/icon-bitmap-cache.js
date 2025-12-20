import { getAircraftIconDefinition, ICON_COLORS } from './aircraft-icons';

const ROTATION_STEP = 5; // 5 degree increments
const MAX_CACHE_SIZE = 1000; // LRU cache limit
const iconCache = new Map();
const cacheAccessOrder = new Map(); // Track access order for LRU

// Pre-warming state
let isPreWarming = false;
let preWarmProgress = 0;

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
 * @param {Object} params - Icon parameters
 * @returns {Promise<ImageBitmap|null>} Cached bitmap
 */
export async function getIconBitmap({ type, color, size, rotation, emergency, selected, aircraft = null }) {
  // Normalize rotation to buckets
  const normalizedRotation = Math.round(rotation / ROTATION_STEP) * ROTATION_STEP % 360;
  
  const cacheKey = `${type}-${color}-${size}-${normalizedRotation}-${emergency}-${selected}`;
  
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

  const svgString = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="${iconDef.viewBox}" width="${size}" height="${size}">
      <g transform="rotate(${normalizedRotation} ${centerX} ${centerY})">
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
 * Pre-warm the cache with common icon types and rotations
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
  
  const tasks = [];
  for (const type of commonTypes) {
    for (const size of commonSizes) {
      for (const rotation of commonRotations) {
        for (const color of commonColors) {
          tasks.push({ type, size, rotation, color, emergency: false, selected: false });
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
