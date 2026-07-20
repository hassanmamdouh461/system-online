import { useState, useEffect, TouchEvent } from 'react';

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';

interface SwipeHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
}

interface SwipeConfig {
  minSwipeDistance?: number; // Minimum distance for a swipe (in pixels)
  maxSwipeTime?: number;     // Maximum time for a swipe (in ms)
}

export function useSwipe(handlers: SwipeHandlers, config: SwipeConfig = {}) {
  // Reduced thresholds for better mobile responsiveness
  const { minSwipeDistance = 30, maxSwipeTime = 300 } = config;
  const [touchStart, setTouchStart] = useState<{ x: number; y: number; time: number } | null>(null);

  const onTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    setTouchStart({
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    });
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!touchStart) return;

    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStart.x);
    const deltaY = Math.abs(touch.clientY - touchStart.y);


  };

  const onTouchEnd = (e: TouchEvent) => {
    if (!touchStart) return;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;
    const deltaTime = Date.now() - touchStart.time;

    // Check if swipe is within time limit
    if (deltaTime > maxSwipeTime) {
      setTouchStart(null);
      return;
    }

    // Determine the dominant direction
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Check if swipe distance is sufficient
    if (absX < minSwipeDistance && absY < minSwipeDistance) {
      setTouchStart(null);
      return;
    }

    // Horizontal swipe
    if (absX > absY) {
      if (deltaX > 0) {
        handlers.onSwipeRight?.();
      } else {
        handlers.onSwipeLeft?.();
      }
    }
    // Vertical swipe
    else {
      if (deltaY > 0) {
        handlers.onSwipeDown?.();
      } else {
        handlers.onSwipeUp?.();
      }
    }

    setTouchStart(null);
  };

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
}
