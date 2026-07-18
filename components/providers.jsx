'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * Custom retry function with exponential backoff
 * @param {number} failureCount - Number of times the query has failed
 * @param {Error} error - The error that caused the failure
 * @returns {boolean} Whether to retry the query
 */
function shouldRetry(failureCount, error) {
  const status = error?.status ?? error?.response?.status;
  // Never hammer a rate-limited or client-error upstream
  if (status === 429 || (status >= 400 && status < 500)) {
    return false;
  }
  // Proxy outages / cooldown windows — soft-fail path usually avoids this,
  // but if a throw slips through, don't multiply load with retries.
  if (status === 502 || status === 503 || status === 504) {
    return false;
  }
  // Retry up to 3 times for other server/network errors
  return failureCount < 3;
}

/**
 * Calculate retry delay with exponential backoff
 * @param {number} attemptIndex - The current retry attempt (0-indexed)
 * @returns {number} Delay in milliseconds
 */
function getRetryDelay(attemptIndex, error) {
  // Respect Retry-After-style long pause when rate limited (if we ever retry)
  if (error?.status === 429) return 30_000;
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

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        {children}
      </TooltipProvider>
    </QueryClientProvider>
  );
}
