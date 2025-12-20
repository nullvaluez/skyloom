'use client';

import { useCallback } from 'react';

/**
 * Haptic feedback patterns
 */
const HAPTIC_PATTERNS = {
  // Light tap for selections
  light: [5],
  
  // Medium tap for confirmations
  medium: [10],
  
  // Heavy tap for important actions
  heavy: [20],
  
  // Success pattern - quick double tap
  success: [10, 50, 10],
  
  // Error pattern - longer buzz
  error: [50, 30, 50],
  
  // Warning pattern
  warning: [30, 20, 30],
  
  // Selection snap
  select: [8],
  
  // Follow mode engaged
  follow: [5, 30, 10, 30, 5],
  
  // Emergency alert
  emergency: [100, 50, 100, 50, 100],
  
  // Badge unlock celebration
  badge: [10, 30, 10, 30, 20, 50, 30],
  
  // AR mode tap
  ar: [15, 20, 15],
};

/**
 * Hook for haptic feedback on mobile devices
 * Uses the Vibration API
 */
export function useHaptics() {
  /**
   * Check if haptics are supported
   */
  const isSupported = typeof navigator !== 'undefined' && 'vibrate' in navigator;

  /**
   * Trigger haptic feedback
   * @param {string|number[]} pattern - Pattern name or custom array of durations
   */
  const trigger = useCallback((pattern = 'light') => {
    if (!isSupported) return;

    try {
      const vibrationPattern = typeof pattern === 'string' 
        ? HAPTIC_PATTERNS[pattern] || HAPTIC_PATTERNS.light
        : pattern;
      
      navigator.vibrate(vibrationPattern);
    } catch (err) {
      // Silently fail if vibration is not available
      console.debug('Haptic feedback not available:', err);
    }
  }, [isSupported]);

  /**
   * Stop any ongoing vibration
   */
  const stop = useCallback(() => {
    if (!isSupported) return;
    
    try {
      navigator.vibrate(0);
    } catch (err) {
      // Silently fail
    }
  }, [isSupported]);

  /**
   * Pre-defined haptic triggers for common actions
   */
  const onSelect = useCallback(() => trigger('select'), [trigger]);
  const onSuccess = useCallback(() => trigger('success'), [trigger]);
  const onError = useCallback(() => trigger('error'), [trigger]);
  const onWarning = useCallback(() => trigger('warning'), [trigger]);
  const onFollow = useCallback(() => trigger('follow'), [trigger]);
  const onEmergency = useCallback(() => trigger('emergency'), [trigger]);
  const onBadgeUnlock = useCallback(() => trigger('badge'), [trigger]);
  const onARTap = useCallback(() => trigger('ar'), [trigger]);

  return {
    isSupported,
    trigger,
    stop,
    // Pre-defined actions
    onSelect,
    onSuccess,
    onError,
    onWarning,
    onFollow,
    onEmergency,
    onBadgeUnlock,
    onARTap,
  };
}

export default useHaptics;
