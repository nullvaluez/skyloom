'use client';

import { useDevStore } from '@/stores/dev-store';
import { memo } from 'react';

export const PerformanceHUD = memo(function PerformanceHUD() {
  const { metrics, showHUD } = useDevStore();

  if (!showHUD) return null;

  return (
    <div className="fixed bottom-12 right-4 z-[9999] rounded-md border border-border bg-background/80 p-2 text-[10px] font-mono shadow-lg backdrop-blur-sm pointer-events-none">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <span className="text-muted-foreground">Aircraft:</span>
        <span className="text-right">{metrics.aircraftCount}</span>
        
        <span className="text-muted-foreground">Filtered:</span>
        <span className="text-right">{metrics.filteredCount}</span>
        
        <div className="col-span-2 my-1 h-px bg-border" />
        
        <span className="text-muted-foreground">Filter:</span>
        <span className={`text-right ${metrics.filterTimeMs > 16 ? 'text-red-500' : 'text-green-500'}`}>
          {metrics.filterTimeMs.toFixed(1)}ms
        </span>
        
        <span className="text-muted-foreground">Poll Latency:</span>
        <span className="text-right text-blue-500">
          {metrics.pollLatencyMs.toFixed(0)}ms
        </span>
        
        <span className="text-muted-foreground">Last Poll:</span>
        <span className="text-right">
          {metrics.lastPollMs > 0 ? ((Date.now() - metrics.lastPollMs) / 1000).toFixed(0) + 's ago' : 'never'}
        </span>
      </div>
    </div>
  );
});
