import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Get adaptive polling interval based on zoom and aircraft count
 * @param {number} zoom - Current map zoom level
 * @param {number} aircraftCount - Current total aircraft count
 * @param {boolean} isFollowing - Whether an aircraft is being followed
 * @returns {number} Interval in milliseconds
 */
export function getPollingInterval(zoom, aircraftCount, isFollowing = false) {
  if (isFollowing) return 2000; // Fast updates when following
  if (zoom > 12 && aircraftCount < 100) return 3000; // Focused view
  if (zoom < 6) return 10000; // Wide view, less urgent
  if (aircraftCount > 3000) return 8000; // Heavy load
  return 5000; // Default
}
