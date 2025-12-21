'use client';

import { useRef, useCallback, useState } from 'react';

/**
 * Configuration for gesture detection
 */
const GESTURE_CONFIG = {
  doubleTapDelay: 300, // Max ms between taps for double-tap
  longPressDelay: 500, // Ms to hold for long-press
  swipeThreshold: 50, // Min pixels for swipe detection
  tapMoveThreshold: 10, // Max movement to still count as tap
};

/**
 * Hook for detecting touch gestures
 * Supports: double-tap, long-press, swipe directions
 * 
 * @param {Object} callbacks - Gesture callbacks
 * @param {Function} callbacks.onDoubleTap - Called on double-tap with { x, y }
 * @param {Function} callbacks.onLongPress - Called on long-press with { x, y }
 * @param {Function} callbacks.onSwipeLeft - Called on swipe left
 * @param {Function} callbacks.onSwipeRight - Called on swipe right
 * @param {Function} callbacks.onSwipeUp - Called on swipe up
 * @param {Function} callbacks.onSwipeDown - Called on swipe down
 * @param {Function} callbacks.onTap - Called on single tap with { x, y }
 * @returns {Object} - Touch event handlers to spread on element
 */
export function useGestures(callbacks = {}) {
  const lastTapRef = useRef(0);
  const longPressTimerRef = useRef(null);
  const touchStartRef = useRef(null);
  const [isLongPressing, setIsLongPressing] = useState(false);

  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0];
    if (!touch) return;

    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };

    // Start long-press timer
    longPressTimerRef.current = setTimeout(() => {
      if (callbacks.onLongPress && touchStartRef.current) {
        setIsLongPressing(true);
        callbacks.onLongPress({
          x: touchStartRef.current.x,
          y: touchStartRef.current.y,
        });
        // Haptic feedback if available
        if (navigator.vibrate) {
          navigator.vibrate(10);
        }
      }
    }, GESTURE_CONFIG.longPressDelay);
  }, [callbacks]);

  const handleTouchMove = useCallback((e) => {
    if (!touchStartRef.current) return;

    const touch = e.touches[0];
    if (!touch) return;

    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Cancel long-press if moved too much
    if (distance > GESTURE_CONFIG.tapMoveThreshold) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  }, []);

  const handleTouchEnd = useCallback((e) => {
    // Clear long-press timer
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (!touchStartRef.current) return;

    const touch = e.changedTouches[0];
    if (!touch) return;

    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const duration = Date.now() - touchStartRef.current.time;

    // Check for swipe
    if (distance > GESTURE_CONFIG.swipeThreshold && duration < 500) {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDx > absDy) {
        // Horizontal swipe
        if (dx > 0 && callbacks.onSwipeRight) {
          callbacks.onSwipeRight();
        } else if (dx < 0 && callbacks.onSwipeLeft) {
          callbacks.onSwipeLeft();
        }
      } else {
        // Vertical swipe
        if (dy > 0 && callbacks.onSwipeDown) {
          callbacks.onSwipeDown();
        } else if (dy < 0 && callbacks.onSwipeUp) {
          callbacks.onSwipeUp();
        }
      }
    } else if (distance < GESTURE_CONFIG.tapMoveThreshold && !isLongPressing) {
      // It's a tap - check for double-tap
      const now = Date.now();
      const timeSinceLastTap = now - lastTapRef.current;

      if (timeSinceLastTap < GESTURE_CONFIG.doubleTapDelay && callbacks.onDoubleTap) {
        // Double-tap detected
        callbacks.onDoubleTap({
          x: touch.clientX,
          y: touch.clientY,
        });
        lastTapRef.current = 0; // Reset to prevent triple-tap
      } else {
        // Single tap - delay to check for double-tap
        lastTapRef.current = now;
        
        if (callbacks.onTap) {
          // Fire tap immediately (don't wait for double-tap check)
          callbacks.onTap({
            x: touch.clientX,
            y: touch.clientY,
          });
        }
      }
    }

    setIsLongPressing(false);
    touchStartRef.current = null;
  }, [callbacks, isLongPressing]);

  const handleTouchCancel = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    setIsLongPressing(false);
    touchStartRef.current = null;
  }, []);

  return {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
    onTouchCancel: handleTouchCancel,
    isLongPressing,
  };
}

/**
 * Hook for detecting double-click on desktop
 * @param {Function} onDoubleClick - Callback for double-click
 * @param {number} delay - Max ms between clicks (default 300)
 * @returns {Function} - Click handler
 */
export function useDoubleClick(onDoubleClick, onSingleClick, delay = 300) {
  const lastClickRef = useRef(0);
  const clickTimerRef = useRef(null);

  return useCallback((e) => {
    const now = Date.now();
    const timeSinceLastClick = now - lastClickRef.current;

    if (timeSinceLastClick < delay) {
      // Double-click
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      if (onDoubleClick) {
        onDoubleClick(e);
      }
      lastClickRef.current = 0;
    } else {
      // Potential single click - wait to see if double
      lastClickRef.current = now;
      
      if (onSingleClick) {
        clickTimerRef.current = setTimeout(() => {
          onSingleClick(e);
        }, delay);
      }
    }
  }, [onDoubleClick, onSingleClick, delay]);
}

