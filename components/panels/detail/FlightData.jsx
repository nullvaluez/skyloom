'use client';

import { memo } from 'react';
import {
  ArrowUpRight,
  Gauge,
  Navigation,
  Radio,
} from 'lucide-react';
import {
  formatAltitude,
  formatSpeed,
  formatVerticalRate,
  formatHeading,
  formatSquawk,
} from '@/lib/format';

export const FlightData = memo(function FlightData({ aircraft }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Flight Data
      </h3>
      <div className="space-y-3">
        {/* Altitude */}
        <div className="flex items-center gap-3">
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">Altitude</div>
            <div className="font-medium">{formatAltitude(aircraft.alt_baro)}</div>
          </div>
        </div>

        {/* Speed */}
        <div className="flex items-center gap-3">
          <Gauge className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">Ground Speed</div>
            <div className="font-medium">{formatSpeed(aircraft.gs)}</div>
          </div>
        </div>

        {/* Heading */}
        <div className="flex items-center gap-3">
          <Navigation className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">Heading</div>
            <div className="font-medium">{formatHeading(aircraft.track)}</div>
          </div>
        </div>

        {/* Vertical Rate */}
        {aircraft.baro_rate !== undefined && (
          <div className="flex items-center gap-3">
            <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1">
              <div className="text-xs text-muted-foreground">Vertical Rate</div>
              <div className="font-medium">{formatVerticalRate(aircraft.baro_rate)}</div>
            </div>
          </div>
        )}

        {/* Squawk */}
        <div className="flex items-center gap-3">
          <Radio className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">Squawk</div>
            <div className="font-medium">{formatSquawk(aircraft.squawk)}</div>
          </div>
        </div>
      </div>
    </div>
  );
});
