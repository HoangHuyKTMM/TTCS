import { useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';

/**
 * Hook to prevent multiple rapid navigation calls
 * Debounces navigation to prevent lag and multiple taps
 */
export function useDebouncedNavigation() {
  const router = useRouter();
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isNavigating = useRef(false);

  const navigate = useCallback((path: string, params?: any) => {
    // Prevent multiple calls
    if (isNavigating.current) {
      return;
    }

    // Clear any pending navigation
    if (navigationTimer.current) {
      clearTimeout(navigationTimer.current);
    }

    isNavigating.current = true;

    // Execute navigation immediately but prevent subsequent calls
    try {
      if (params) {
        router.push({ pathname: path, params } as any);
      } else {
        router.push(path as any);
      }
    } catch (e) {
      console.error('Navigation error:', e);
    }

    // Reset flag after delay
    navigationTimer.current = setTimeout(() => {
      isNavigating.current = false;
    }, 500); // 500ms cooldown
  }, [router]);

  const replace = useCallback((path: string, params?: any) => {
    if (isNavigating.current) {
      return;
    }

    if (navigationTimer.current) {
      clearTimeout(navigationTimer.current);
    }

    isNavigating.current = true;

    try {
      if (params) {
        router.replace({ pathname: path, params } as any);
      } else {
        router.replace(path as any);
      }
    } catch (e) {
      console.error('Navigation error:', e);
    }

    navigationTimer.current = setTimeout(() => {
      isNavigating.current = false;
    }, 500);
  }, [router]);

  const goBack = useCallback(() => {
    if (isNavigating.current) {
      return;
    }

    isNavigating.current = true;
    router.back();

    setTimeout(() => {
      isNavigating.current = false;
    }, 500);
  }, [router]);

  return { navigate, replace, goBack };
}

/**
 * Throttle function for button presses
 */
export function useThrottledPress(callback: () => void, delay: number = 300) {
  const lastCall = useRef<number>(0);

  return useCallback(() => {
    const now = Date.now();
    if (now - lastCall.current >= delay) {
      lastCall.current = now;
      callback();
    }
  }, [callback, delay]);
}
