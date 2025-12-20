'use client';

import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAircraftStore } from '@/stores/aircraft-store';

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
            retry: 1,
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
