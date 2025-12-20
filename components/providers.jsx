'use client';

import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAircraftStore } from '@/stores/aircraft-store';

/**
 * Custom retry function with exponential backoff
 * @param {number} failureCount - Number of times the query has failed
 * @param {Error} error - The error that caused the failure
 * @returns {boolean} Whether to retry the query
 */
function shouldRetry(failureCount, error) {
  // Don't retry on 4xx errors (client errors)
  if (error?.response?.status >= 400 && error?.response?.status < 500) {
    return false;
  }
  // Retry up to 3 times for server/network errors
  return failureCount < 3;
}

/**
 * Calculate retry delay with exponential backoff
 * @param {number} attemptIndex - The current retry attempt (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function getRetryDelay(attemptIndex) {
  // Exponential backoff: 1s, 2s, 4s (with jitter)
  const baseDelay = 1000;
  const maxDelay = 10000;
  const delay = Math.min(baseDelay * Math.pow(2, attemptIndex), maxDelay);
  // Add jitter (±25%)
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return delay + jitter;
}

/**
 * App providers wrapper
 */
export function Providers({ children }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2000,
            gcTime: 30000,
            refetchOnWindowFocus: false,
            retry: shouldRetry,
            retryDelay: getRetryDelay,
            // Network mode: always try to fetch, even if network seems offline
            networkMode: 'always',
          },
        },
      })
  );

  const startCleanupTimer = useAircraftStore((s) => s.startCleanupTimer);
  const stopCleanupTimer = useAircraftStore((s) => s.stopCleanupTimer);

  // Initialize stale data cleanup timer on mount
  useEffect(() => {
    startCleanupTimer();
    return () => stopCleanupTimer();
  }, [startCleanupTimer, stopCleanupTimer]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        {children}
      </TooltipProvider>
    </QueryClientProvider>
  );
}
