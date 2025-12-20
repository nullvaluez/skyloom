'use client';

import { memo } from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
  Gauge,
  Navigation,
  Radio,
} from 'lucide-react';
import { HUDReadout } from '@/components/ui/odometer';
import { EMERGENCY_SQUAWKS } from '@/lib/constants';

export const FlightData = memo(function FlightData({ aircraft }) {
  const altitude = aircraft.alt_baro === 'ground' ? 0 : aircraft.alt_baro;
  const verticalRate = aircraft.baro_rate || 0;
  const isClimbing = verticalRate > 100;
  const isDescending = verticalRate < -100;
  const isEmergencySquawk = aircraft.squawk && EMERGENCY_SQUAWKS.includes(aircraft.squawk);

  return (
    <div className="glass-panel-light p-4 rounded-lg">
      <h3 className="mb-4 text-xs font-semibold text-muted-foreground uppercase tracking-widest hud-text">
        Flight Data
      </h3>
      
      {/* Primary flight instruments - grid layout */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Altitude */}
        <div className="flex items-start gap-2">
          <div className="p-1.5 rounded bg-background/50">
            <ArrowUpRight className="h-4 w-4 text-cyan-400" />
          </div>
          <HUDReadout
            value={altitude}
            unit="ft"
            label="Altitude"
            format={(v) => v?.toLocaleString() ?? '---'}
            variant="info"
          />
        </div>

        {/* Speed */}
        <div className="flex items-start gap-2">
          <div className="p-1.5 rounded bg-background/50">
            <Gauge className="h-4 w-4 text-green-400" />
          </div>
          <HUDReadout
            value={aircraft.gs}
            unit="kts"
            label="Ground Speed"
            format={(v) => Math.round(v || 0).toString()}
            variant="success"
          />
        </div>

        {/* Heading */}
        <div className="flex items-start gap-2">
          <div className="p-1.5 rounded bg-background/50">
            <Navigation className="h-4 w-4 text-amber-400" style={{ transform: `rotate(${aircraft.track || 0}deg)` }} />
          </div>
          <HUDReadout
            value={aircraft.track}
            unit="°"
            label="Heading"
            format={(v) => Math.round(v || 0).toString().padStart(3, '0')}
            variant="warning"
          />
        </div>

        {/* Vertical Rate */}
        <div className="flex items-start gap-2">
          <div className="p-1.5 rounded bg-background/50">
            {isClimbing ? (
              <ArrowUpRight className="h-4 w-4 text-green-400" />
            ) : isDescending ? (
              <ArrowDownRight className="h-4 w-4 text-red-400" />
            ) : (
              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
          <HUDReadout
            value={Math.abs(verticalRate)}
            unit="ft/m"
            label={isClimbing ? 'Climbing' : isDescending ? 'Descending' : 'V/S'}
            format={(v) => (v ? (isDescending ? '-' : '+') + Math.round(v).toLocaleString() : '0')}
            variant={isClimbing ? 'success' : isDescending ? 'danger' : 'default'}
          />
        </div>
      </div>

      {/* Squawk - full width */}
      <div className="flex items-center gap-3 pt-3 border-t border-border/50">
        <div className="p-1.5 rounded bg-background/50">
          <Radio className={`h-4 w-4 ${isEmergencySquawk ? 'text-red-400 animate-pulse' : 'text-muted-foreground'}`} />
        </div>
        <div className="flex-1">
          <span className="text-[10px] text-muted-foreground uppercase tracking-widest hud-text">
            Squawk
          </span>
          <div className={`text-lg font-bold font-mono tabular-nums ${isEmergencySquawk ? 'text-red-400 glow-danger' : ''}`}>
            {aircraft.squawk || '----'}
          </div>
        </div>
        {isEmergencySquawk && (
          <div className="px-2 py-1 bg-red-500/20 border border-red-500/50 rounded text-xs text-red-400 font-semibold animate-pulse">
            EMERGENCY
          </div>
        )}
      </div>
    </div>
  );
});
