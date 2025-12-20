'use client';

import { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, AlertTriangle, Plane, Navigation, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAircraftStore } from '@/stores/aircraft-store';
import { useMapStore } from '@/stores/map-store';
import { usePassportStore } from '@/stores/passport-store';
import { formatAltitude, formatCallsign } from '@/lib/format';
import { getRarityColor } from '@/lib/rarity';

/**
 * Calculate bearing between two points
 */
function calculateBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  
  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);
  
  let bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

/**
 * Calculate elevation angle to aircraft
 */
function calculateElevation(userLat, userLon, acLat, acLon, acAlt) {
  const R = 6371000;
  const dLat = (acLat - userLat) * Math.PI / 180;
  const dLon = (acLon - userLon) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + 
            Math.cos(userLat * Math.PI / 180) * Math.cos(acLat * Math.PI / 180) * 
            Math.sin(dLon/2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  
  const altMeters = (acAlt || 0) * 0.3048;
  
  return Math.atan2(altMeters, distance) * 180 / Math.PI;
}

/**
 * Check if aircraft is within camera's field of view
 */
function isInFOV(bearing, elevation, orientation, fovH = 70, fovV = 50) {
  const { alpha, beta } = orientation;
  
  const deviceHeading = (360 - alpha) % 360;
  
  let bearingDiff = bearing - deviceHeading;
  if (bearingDiff > 180) bearingDiff -= 360;
  if (bearingDiff < -180) bearingDiff += 360;
  
  const devicePitch = beta - 90;
  const elevationDiff = elevation - devicePitch;
  
  return Math.abs(bearingDiff) < fovH / 2 && Math.abs(elevationDiff) < fovV / 2;
}

/**
 * AR Label for an aircraft
 */
const ARLabel = memo(function ARLabel({ aircraft, orientation, userLocation }) {
  const bearing = calculateBearing(
    userLocation[0], userLocation[1],
    aircraft.lat, aircraft.lon
  );
  const elevation = calculateElevation(
    userLocation[0], userLocation[1],
    aircraft.lat, aircraft.lon,
    aircraft.alt_baro
  );
  
  const { alpha, beta } = orientation;
  const deviceHeading = (360 - alpha) % 360;
  const devicePitch = beta - 90;
  
  let bearingDiff = bearing - deviceHeading;
  if (bearingDiff > 180) bearingDiff -= 360;
  if (bearingDiff < -180) bearingDiff += 360;
  
  const elevationDiff = elevation - devicePitch;
  
  const x = 50 + (bearingDiff / 70) * 100;
  const y = 50 - (elevationDiff / 50) * 100;
  
  const clampedX = Math.max(5, Math.min(95, x));
  const clampedY = Math.max(5, Math.min(95, y));
  
  const rarityColor = getRarityColor(aircraft._rarity || 0);
  
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      className="absolute pointer-events-none"
      style={{
        left: `${clampedX}%`,
        top: `${clampedY}%`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div className="glass-panel p-2 flex flex-col items-center gap-1 min-w-[80px]">
        <Plane 
          className="h-6 w-6" 
          style={{ 
            color: rarityColor,
            transform: `rotate(${aircraft.track || 0}deg)`,
          }} 
        />
        <div className="text-xs font-bold text-white">
          {formatCallsign(aircraft.flight) || aircraft.hex}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {formatAltitude(aircraft.alt_baro)}
        </div>
        <div className="h-1 w-full rounded bg-background/50 overflow-hidden">
          <div 
            className="h-full rounded"
            style={{ 
              width: `${Math.min(100, (aircraft._rarity || 0))}%`,
              backgroundColor: rarityColor,
            }}
          />
        </div>
      </div>
    </motion.div>
  );
});

/**
 * AR Spotter Mode - Point your phone at the sky
 */
export const ARSpotter = memo(function ARSpotter({ onClose }) {
  const videoRef = useRef(null);
  const loggedRef = useRef(new Set());
  const orientationHandlerRef = useRef(null);
  const [hasPermissions, setHasPermissions] = useState(false);
  const [error, setError] = useState(null);
  const [orientation, setOrientation] = useState({ alpha: 0, beta: 0, gamma: 0 });
  const [isCalibrating, setIsCalibrating] = useState(true);
  const [hasOrientation, setHasOrientation] = useState(false);
  const [needsIOSPermission, setNeedsIOSPermission] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  
  const userLocation = useMapStore((s) => s.userLocation);
  const aircraftMap = useAircraftStore((s) => s.aircraft);
  
  const aircraftArray = useMemo(() => {
    return Array.from(aircraftMap.values());
  }, [aircraftMap]);
  
  // Setup the orientation event listener
  const setupOrientationListener = useCallback(() => {
    // Remove any existing listener
    if (orientationHandlerRef.current) {
      window.removeEventListener('deviceorientation', orientationHandlerRef.current, true);
    }
    
    const handler = (event) => {
      // Check if we have actual orientation data
      if (event.alpha !== null && event.beta !== null && event.gamma !== null) {
        setOrientation({
          alpha: event.alpha,
          beta: event.beta,
          gamma: event.gamma,
        });
        setHasOrientation(true);
        setIsCalibrating(false);
      }
    };
    
    orientationHandlerRef.current = handler;
    window.addEventListener('deviceorientation', handler, true);
    
    // Also try the absolute version for better compass accuracy
    window.addEventListener('deviceorientationabsolute', handler, true);
    
    // Fallback timeout
    setTimeout(() => {
      setIsCalibrating(false);
    }, 3000);
  }, []);
  
  // iOS permission request - MUST be called from a user gesture (button click)
  const requestIOSPermission = useCallback(async () => {
    try {
      // This MUST be triggered by user gesture on iOS
      const permission = await DeviceOrientationEvent.requestPermission();
      
      if (permission === 'granted') {
        setNeedsIOSPermission(false);
        setIsCalibrating(true);
        setupOrientationListener();
      } else {
        setNeedsIOSPermission(false);
        setPermissionDenied(true);
        setIsCalibrating(false);
      }
    } catch (err) {
      console.error('iOS orientation permission error:', err);
      setNeedsIOSPermission(false);
      setPermissionDenied(true);
      setIsCalibrating(false);
    }
  }, [setupOrientationListener]);
  
  // Request camera permission
  useEffect(() => {
    let mounted = true;
    const videoElement = videoRef.current;
    
    async function initCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        
        if (mounted && videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        if (mounted) setHasPermissions(true);
      } catch (err) {
        console.error('Camera error:', err);
        if (mounted) setError('Camera access denied. Please enable camera permissions.');
      }
    }
    
    initCamera();
    
    return () => {
      mounted = false;
      if (videoElement?.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
      }
    };
  }, []);
  
  // Initialize device orientation
  useEffect(() => {
    let mounted = true;
    
    // Check if DeviceOrientationEvent exists
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
      // No device orientation support at all
      setIsCalibrating(false);
      return;
    }
    
    // Check if this is iOS 13+ which requires permission
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+ - we need user gesture to request permission
      // Show the permission button instead of auto-requesting
      if (mounted) {
        setNeedsIOSPermission(true);
        setIsCalibrating(false);
      }
    } else {
      // Non-iOS or older iOS - just add listener directly
      setupOrientationListener();
    }
    
    return () => {
      mounted = false;
      if (orientationHandlerRef.current) {
        window.removeEventListener('deviceorientation', orientationHandlerRef.current, true);
        window.removeEventListener('deviceorientationabsolute', orientationHandlerRef.current, true);
      }
    };
  }, [setupOrientationListener]);
  
  // Get user location if not available
  useEffect(() => {
    const currentUserLocation = useMapStore.getState().userLocation;
    if (!currentUserLocation) {
      useMapStore.getState().geolocate();
    }
  }, []);
  
  // Filter aircraft that are in field of view
  const visibleAircraft = useMemo(() => {
    if (!userLocation) return [];
    if (isCalibrating) return [];
    
    if (!hasOrientation) {
      return aircraftArray
        .filter(ac => ac.lat && ac.lon)
        .map(ac => {
          const dLat = ac.lat - userLocation[0];
          const dLon = ac.lon - userLocation[1];
          const dist = Math.sqrt(dLat * dLat + dLon * dLon);
          return { ...ac, _dist: dist };
        })
        .sort((a, b) => a._dist - b._dist)
        .slice(0, 10);
    }
    
    return aircraftArray.filter(ac => {
      if (!ac.lat || !ac.lon) return false;
      
      const bearing = calculateBearing(
        userLocation[0], userLocation[1],
        ac.lat, ac.lon
      );
      const elevation = calculateElevation(
        userLocation[0], userLocation[1],
        ac.lat, ac.lon,
        ac.alt_baro
      );
      
      return isInFOV(bearing, elevation, orientation, 120, 90);
    }).slice(0, 10);
  }, [aircraftArray, userLocation, orientation, isCalibrating, hasOrientation]);
  
  // Auto-log spotted aircraft
  useEffect(() => {
    const logged = loggedRef.current;
    const logSpotFn = usePassportStore.getState().logSpot;
    
    visibleAircraft.forEach(ac => {
      if (!logged.has(ac.hex)) {
        logged.add(ac.hex);
        setTimeout(() => logSpotFn(ac), 0);
      }
    });
  }, [visibleAircraft]);
  
  if (error) {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center p-4">
        <AlertTriangle className="h-12 w-12 text-amber-500 mb-4" />
        <p className="text-center text-lg mb-4">{error}</p>
        <Button onClick={onClose}>Close</Button>
      </div>
    );
  }
  
  return (
    <div className="fixed inset-0 z-50 bg-black">
      {/* Camera feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />
      
      {/* AR Overlay */}
      <div className="absolute inset-0">
        {/* iOS Permission Request Overlay - requires user gesture */}
        <AnimatePresence>
          {needsIOSPermission && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center bg-black/70 z-20"
            >
              <div className="glass-panel p-6 text-center max-w-xs mx-4">
                <Compass className="h-16 w-16 mx-auto mb-4 text-primary" />
                <p className="text-xl font-semibold mb-2">Enable Motion Sensors</p>
                <p className="text-sm text-muted-foreground mb-6">
                  iOS requires permission to access motion sensors for AR tracking. Tap the button below to enable.
                </p>
                <Button 
                  onClick={requestIOSPermission} 
                  className="w-full text-lg py-6"
                  size="lg"
                >
                  Enable AR Tracking
                </Button>
                <button 
                  onClick={() => {
                    setNeedsIOSPermission(false);
                    setIsCalibrating(false);
                  }}
                  className="mt-4 text-sm text-muted-foreground underline"
                >
                  Skip (limited functionality)
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Calibration overlay */}
        <AnimatePresence>
          {isCalibrating && !needsIOSPermission && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center bg-black/50"
            >
              <div className="glass-panel p-6 text-center">
                <Navigation className="h-12 w-12 mx-auto mb-4 animate-spin" />
                <p className="text-lg font-semibold">Calibrating...</p>
                <p className="text-sm text-muted-foreground">
                  Move your device in a figure-8 pattern
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Aircraft labels */}
        <AnimatePresence>
          {userLocation && !needsIOSPermission && visibleAircraft.map(ac => (
            <ARLabel
              key={ac.hex}
              aircraft={ac}
              orientation={orientation}
              userLocation={userLocation}
            />
          ))}
        </AnimatePresence>
        
        {/* HUD overlay */}
        <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-start">
          <div className="glass-panel-light p-2">
            <div className="text-xs text-muted-foreground">Heading</div>
            <div className="text-lg font-bold">
              {hasOrientation ? `${Math.round((360 - orientation.alpha) % 360)}°` : '--'}
            </div>
          </div>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="glass-panel"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        
        {/* Bottom info */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <div className="glass-panel p-3 flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-green-400" />
                <span className="text-sm">AR Mode Active</span>
              </div>
              <div className="text-sm">
                <span className="font-bold">{visibleAircraft.length}</span>
                <span className="text-muted-foreground"> aircraft nearby</span>
              </div>
            </div>
            {!hasOrientation && !isCalibrating && !needsIOSPermission && (
              <div className="text-xs text-amber-400 text-center">
                {permissionDenied 
                  ? 'Motion permission denied - showing all nearby aircraft'
                  : 'No gyroscope detected - showing all nearby aircraft'
                }
              </div>
            )}
            {!userLocation && !isCalibrating && (
              <div className="text-xs text-amber-400 text-center">
                Waiting for location...
              </div>
            )}
          </div>
        </div>
        
        {/* Crosshair */}
        {!needsIOSPermission && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-8 h-8 border-2 border-white/30 rounded-full" />
            <div className="absolute w-12 h-0.5 bg-white/20" />
            <div className="absolute w-0.5 h-12 bg-white/20" />
          </div>
        )}
      </div>
    </div>
  );
});

export default ARSpotter;
