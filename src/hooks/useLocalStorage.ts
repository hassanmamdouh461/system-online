import { useState, useCallback } from 'react';

/**
 * Custom Hook for localStorage persistence with Lazy Initialization
 * Prevents initial state from overwriting localStorage data
 * Uses synchronous localStorage reads on mount to avoid race conditions
 */
export function useLocalStorage<T>(key: string, initialValue: T) {
  // LAZY STATE INITIALIZATION: Read from localStorage BEFORE first render
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      
      if (item !== null) {
        // localStorage has data - ALWAYS use it (never overwrite)
        return JSON.parse(item);
      } else {
        // localStorage is empty - initialize with default value
        window.localStorage.setItem(key, JSON.stringify(initialValue));
        return initialValue;
      }
    } catch (error) {
      console.error(`[useLocalStorage] Error reading [${key}]:`, error);
      return initialValue;
    }
  });

  // Wrapped setter to sync with localStorage — uses functional updater
  // to avoid stale closure issues when called multiple times in one cycle
  const setValue = useCallback((value: T | ((prev: T) => T)) => {
    try {
      setStoredValue(prev => {
        const valueToStore = value instanceof Function ? value(prev) : value;

        // Save to localStorage
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
        }

        return valueToStore;
      });
    } catch (error) {
      console.error(`[useLocalStorage] Error saving [${key}]:`, error);
    }
  }, [key]);

  return [storedValue, setValue] as const;
}
