'use client';

import { memo } from 'react';
import { Plane, Package, Shield, Helicopter, AlertTriangle } from 'lucide-react';
import { useAircraftStore } from '@/stores/aircraft-store';
import { useFilterStats } from '@/hooks/use-filters';
import { formatTimeSince } from '@/lib/format';

/**
 * Statistics bar component showing aircraft counts
 */
export const StatsBar = memo(function StatsBar() {
  const { getAircraftArray, lastUpdate } = useAircraftStore();
  const aircraft = getAircraftArray();
  const stats = useFilterStats(aircraft);

  const timeSinceUpdate = lastUpdate
    ? Math.floor((Date.now() - lastUpdate.getTime()) / 1000)
    : null;

  return (
    <footer className="flex h-10 items-center justify-between border-t border-border bg-card px-4 text-sm">
      <div className="flex items-center gap-4 overflow-x-auto">
        {/* Total Aircraft */}
        <div className="flex items-center gap-1.5 text-foreground">
          <Plane className="h-4 w-4" />
          <span className="font-medium">{stats.total.toLocaleString()}</span>
          <span className="hidden text-muted-foreground sm:inline">aircraft</span>
        </div>

        <div className="h-4 w-px bg-border" />

        {/* Commercial */}
        <div className="flex items-center gap-1.5 text-green-500">
          <Plane className="h-3.5 w-3.5" />
          <span className="font-medium">{stats.byType.commercial.toLocaleString()}</span>
          <span className="hidden text-muted-foreground lg:inline">commercial</span>
        </div>

        {/* Cargo */}
        <div className="flex items-center gap-1.5 text-amber-500">
          <Package className="h-3.5 w-3.5" />
          <span className="font-medium">{stats.byType.cargo.toLocaleString()}</span>
          <span className="hidden text-muted-foreground lg:inline">cargo</span>
        </div>

        {/* Military */}
        <div className="flex items-center gap-1.5 text-red-500">
          <Shield className="h-3.5 w-3.5" />
          <span className="font-medium">{stats.byType.military.toLocaleString()}</span>
          <span className="hidden text-muted-foreground lg:inline">military</span>
        </div>

        {/* Helicopter */}
        <div className="hidden items-center gap-1.5 text-cyan-500 md:flex">
          <Helicopter className="h-3.5 w-3.5" />
          <span className="font-medium">{stats.byType.helicopter.toLocaleString()}</span>
          <span className="hidden text-muted-foreground xl:inline">heli</span>
        </div>

        {/* Emergency */}
        {stats.inEmergency > 0 && (
          <>
            <div className="h-4 w-px bg-border" />
            <div className="flex items-center gap-1.5 text-red-500 animate-pulse">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="font-medium">{stats.inEmergency}</span>
              <span className="hidden text-muted-foreground sm:inline">emergency</span>
            </div>
          </>
        )}
      </div>

      {/* Last Update */}
      <div className="text-muted-foreground">
        {timeSinceUpdate !== null ? (
          <span>Updated: {formatTimeSince(timeSinceUpdate)}</span>
        ) : (
          <span>Loading...</span>
        )}
      </div>
    </footer>
  );
});
