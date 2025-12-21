'use client';

import { memo } from 'react';
import {
  Plane,
  MapPin,
  Clock,
  ArrowRight,
  TrendingUp,
  Loader2,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Airport Card Component
 * Displays airport information with flag, code, and city
 */
const AirportCard = memo(function AirportCard({ 
  airport, 
  label, 
  time, 
  isOrigin = false,
}) {
  if (!airport) {
    return (
      <div className="flex-1 glass-panel-light p-3 rounded-lg opacity-50">
        <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">
          {label}
        </div>
        <div className="text-lg font-bold text-muted-foreground">---</div>
        <div className="text-xs text-muted-foreground">Unknown</div>
      </div>
    );
  }

  return (
    <div className="flex-1 glass-panel-light p-3 rounded-lg">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest">
          {label}
        </span>
        {airport.flag && (
          <span className="text-base" title={airport.country}>
            {airport.flag}
          </span>
        )}
      </div>
      
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-bold text-white">
          {airport.iata || airport.icao}
        </span>
        {airport.iata && airport.icao && airport.icao !== airport.iata && (
          <span className="text-xs text-muted-foreground font-mono">
            {airport.icao}
          </span>
        )}
      </div>
      
      <div className="text-xs text-muted-foreground truncate mt-0.5" title={airport.name}>
        {airport.city || airport.name}
      </div>
      
      {time && (
        <div className="flex items-center gap-1 mt-2 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          <span>{time}</span>
        </div>
      )}
    </div>
  );
});

/**
 * Progress Bar Component
 * Shows flight progress with percentage
 */
const FlightProgress = memo(function FlightProgress({ 
  progress, 
  distanceRemaining, 
  timeRemaining,
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {progress !== null ? `${progress}% complete` : 'Progress unknown'}
        </span>
        {distanceRemaining !== null && (
          <span className="text-muted-foreground">
            {distanceRemaining} nm remaining
          </span>
        )}
      </div>
      
      <div className="relative h-2 bg-background/50 rounded-full overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-r from-green-500/20 via-blue-500/20 to-amber-500/20" />
        
        {/* Progress fill */}
        <div
          className="absolute h-full bg-gradient-to-r from-green-500 to-blue-500 rounded-full transition-all duration-500"
          style={{ width: `${progress || 0}%` }}
        />
        
        {/* Aircraft indicator */}
        {progress !== null && progress > 0 && progress < 100 && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-all duration-500"
            style={{ left: `${progress}%` }}
          >
            <Plane 
              className="h-4 w-4 text-white drop-shadow-lg" 
              style={{ transform: 'rotate(90deg)' }}
            />
          </div>
        )}
      </div>
      
      {timeRemaining && (
        <div className="flex items-center justify-center gap-1 text-xs text-primary">
          <Clock className="h-3 w-3" />
          <span className="font-medium">{timeRemaining} remaining</span>
        </div>
      )}
    </div>
  );
});

/**
 * RouteInfo Component
 * Displays flight route information including origin, destination, and progress
 */
export const RouteInfo = memo(function RouteInfo({ 
  route, 
  isLoading = false,
}) {
  // Loading state
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading route...</span>
        </div>
        <div className="flex gap-3">
          <Skeleton className="flex-1 h-24" />
          <Skeleton className="flex-1 h-24" />
        </div>
        <Skeleton className="h-8" />
      </div>
    );
  }

  // No route data
  if (!route || (!route.origin && !route.destination)) {
    return (
      <div className="glass-panel-light p-4 rounded-lg text-center">
        <MapPin className="h-8 w-8 mx-auto text-muted-foreground mb-2 opacity-50" />
        <p className="text-sm text-muted-foreground">
          Route information unavailable
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          This flight's route data could not be determined
        </p>
      </div>
    );
  }

  // Format times
  const departureTime = route.departureTime
    ? new Date(route.departureTime).toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    : null;
    
  const arrivalTime = route.eta
    ? route.eta.toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    : route.scheduledArrival
      ? new Date(route.scheduledArrival).toLocaleTimeString([], { 
          hour: '2-digit', 
          minute: '2-digit' 
        })
      : null;

  return (
    <div className="space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          Route
        </h3>
        {route.totalDistanceNm && (
          <span className="text-xs text-muted-foreground">
            {route.totalDistanceNm.toLocaleString()} nm total
          </span>
        )}
      </div>

      {/* Origin → Destination */}
      <div className="flex items-stretch gap-3">
        <AirportCard
          airport={route.origin}
          label="Origin"
          time={departureTime}
          isOrigin
        />
        
        {/* Arrow divider */}
        <div className="flex flex-col items-center justify-center px-1">
          <ArrowRight className="h-5 w-5 text-muted-foreground" />
        </div>
        
        <AirportCard
          airport={route.destination}
          label="Destination"
          time={arrivalTime ? `ETA ${arrivalTime}` : null}
        />
      </div>

      {/* Flight Progress */}
      {(route.progressPercent !== null || route.distanceRemainingNm !== null) && (
        <FlightProgress
          progress={route.progressPercent}
          distanceRemaining={route.distanceRemainingNm}
          timeRemaining={route.timeRemaining}
        />
      )}

      {/* Distance stats row */}
      {route.distanceFlownNm !== null && route.distanceRemainingNm !== null && (
        <div className="flex justify-between text-xs text-muted-foreground border-t border-border/30 pt-3">
          <div className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            <span>{route.distanceFlownNm.toLocaleString()} nm flown</span>
          </div>
          <div>
            {route.distanceRemainingNm.toLocaleString()} nm to go
          </div>
        </div>
      )}
    </div>
  );
});

