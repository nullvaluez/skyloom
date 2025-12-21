'use client';

import { memo, useState } from 'react';
import Image from 'next/image';
import { Plane, Building2, Globe } from 'lucide-react';

/**
 * AirlineInfo Component
 * Displays airline information including logo, name, and flight number
 */
export const AirlineInfo = memo(function AirlineInfo({ 
  airline,
  flightNumber,
}) {
  const [logoError, setLogoError] = useState(false);

  // No airline data
  if (!airline) {
    return null;
  }

  return (
    <div className="glass-panel-light p-4 rounded-lg">
      <h3 className="mb-3 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
        Airline
      </h3>
      
      <div className="flex items-center gap-4">
        {/* Airline Logo */}
        <div className="shrink-0 w-12 h-12 rounded-lg bg-background/50 flex items-center justify-center overflow-hidden">
          {airline.logo && !logoError ? (
            <Image
              src={airline.logo}
              alt={`${airline.name} logo`}
              width={48}
              height={48}
              className="object-contain"
              onError={() => setLogoError(true)}
              unoptimized // External CDN
            />
          ) : (
            <Plane className="h-6 w-6 text-muted-foreground" />
          )}
        </div>
        
        {/* Airline Details */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white truncate">
              {airline.name}
            </span>
            {airline.flag && (
              <span className="text-base shrink-0" title={airline.country}>
                {airline.flag}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            {/* Airline codes */}
            <div className="flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              <span className="font-mono">
                {airline.iata && airline.icao 
                  ? `${airline.iata} / ${airline.icao}`
                  : airline.iata || airline.icao
                }
              </span>
            </div>
            
            {/* Country */}
            {airline.country && (
              <div className="flex items-center gap-1">
                <Globe className="h-3 w-3" />
                <span>{airline.country}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Flight Number */}
      {flightNumber && (
        <div className="mt-3 pt-3 border-t border-border/30">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Flight</span>
            <span className="text-lg font-bold font-mono tracking-wide text-primary">
              {flightNumber}
            </span>
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * Compact Airline Badge
 * For use in headers or smaller spaces
 */
export const AirlineBadge = memo(function AirlineBadge({ airline, flightNumber }) {
  const [logoError, setLogoError] = useState(false);

  if (!airline) return null;

  return (
    <div className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-background/50">
      {/* Mini logo */}
      <div className="w-5 h-5 rounded flex items-center justify-center overflow-hidden bg-background/30">
        {airline.logo && !logoError ? (
          <Image
            src={airline.logo}
            alt=""
            width={20}
            height={20}
            className="object-contain"
            onError={() => setLogoError(true)}
            unoptimized
          />
        ) : (
          <Plane className="h-3 w-3 text-muted-foreground" />
        )}
      </div>
      
      {/* Flight number or airline name */}
      <span className="text-xs font-medium">
        {flightNumber || airline.name}
      </span>
      
      {/* Country flag */}
      {airline.flag && (
        <span className="text-xs">{airline.flag}</span>
      )}
    </div>
  );
});

