'use client';

import { memo } from 'react';
import {
  formatRegistration,
  formatAircraftType,
  formatHex,
} from '@/lib/format';

export const AircraftInfo = memo(function AircraftInfo({ aircraft, country }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
        Aircraft
      </h3>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Type</span>
          <span className="font-medium">{formatAircraftType(aircraft.t)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Registration</span>
          <span className="font-medium">{formatRegistration(aircraft.r)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">ICAO</span>
          <span className="font-mono text-xs">{formatHex(aircraft.hex)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Country</span>
          <span>{country?.flag} {country?.name}</span>
        </div>
      </div>
    </div>
  );
});
