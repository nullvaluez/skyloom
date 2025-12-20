'use client';

import { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, AlertTriangle, Plane, Navigation } from 'lucide-react';
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
  // Approximate distance in meters
  const R = 6371000; // Earth radius in meters
  const dLat = (acLat - userLat) * Math.PI / 180;
  const dLon = (acLon - userLon) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + 
            Math.cos(userLat * Math.PI / 180) * Math.cos(acLat * Math.PI / 180) * 
            Math.sin(dLon/2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  
  // Convert altitude from feet to meters
  const altMeters = (acAlt || 0) * 0.3048;
  
  // Calculate elevation angle
  return Math.atan2(altMeters, distance) * 180 / Math.PI;
}

/**
 * Check if aircraft is within camera's field of view
 */
function isInFOV(bearing, elevation, orientation, fovH = 70, fovV = 50) {
  const { alpha, beta, gamma } = orientation;
  
  // Convert device orientation to compass heading
  // alpha: rotation around z-axis (0-360)
  // beta: front-to-back tilt (-180 to 180)
  // gamma: left-to-right tilt (-90 to 90)
  
  // Device heading (where camera is pointing)
  const deviceHeading = (360 - alpha) % 360;
  
  // Calculate bearing difference
  let bearingDiff = bearing - deviceHeading;
  if (bearingDiff > 180) bearingDiff -= 360;
  if (bearingDiff < -180) bearingDiff += 360;
  
  // Device pitch (elevation)
  const devicePitch = beta - 90; // 0 = horizontal, positive = looking up
  const elevationDiff = elevation - devicePitch;
  
  // Check if within FOV
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
  
  // Calculate screen position based on bearing/elevation difference from device orientation
  const { alpha, beta } = orientation;
  const deviceHeading = (360 - alpha) % 360;
  const devicePitch = beta - 90;
  
  let bearingDiff = bearing - deviceHeading;
  if (bearingDiff > 180) bearingDiff -= 360;
  if (bearingDiff < -180) bearingDiff += 360;
  
  const elevationDiff = elevation - devicePitch;
  
  // Convert to screen coordinates (center = 50%)
  const x = 50 + (bearingDiff / 70) * 100; // Assuming 70° horizontal FOV
  const y = 50 - (elevationDiff / 50) * 100; // Assuming 50° vertical FOV
  
  // Clamp to screen
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
  const loggedRef = useRef(new Set()); // Track logged aircraft per session
  const [hasPermissions, setHasPermissions] = useState(false);
  const [error, setError] = useState(null);
  const [orientation, setOrientation] = useState({ alpha: 0, beta: 0, gamma: 0 });
  const [isCalibrating, setIsCalibrating] = useState(true);
  
  // Select primitive/stable values from stores to avoid infinite loops
  const userLocation = useMapStore((s) => s.userLocation);
  const aircraftMap = useAircraftStore((s) => s.aircraft);
  
  // Convert Map to array only when the Map reference changes
  const aircraftArray = useMemo(() => {
    return Array.from(aircraftMap.values());
  }, [aircraftMap]);
  
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
      // Stop camera on unmount using captured reference
      if (videoElement?.srcObject) {
        videoElement.srcObject.getTracks().forEach(track => track.stop());
      }
    };
  }, []);
  
  // Request device orientation
  useEffect(() => {
    let mounted = true;
    let orientationHandler = null;
    
    async function initOrientation() {
      // iOS requires permission request
      if (typeof DeviceOrientationEvent !== 'undefined' && 
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        try {
          const permission = await DeviceOrientationEvent.requestPermission();
          if (permission !== 'granted') {
            if (mounted) setError('Orientation permission denied');
            return;
          }
        } catch (err) {
          console.error('Orientation permission error:', err);
        }
      }
      
      orientationHandler = (event) => {
        if (!mounted) return;
        setOrientation({
          alpha: event.alpha || 0, // Compass heading
          beta: event.beta || 0,   // Front-to-back tilt
          gamma: event.gamma || 0, // Left-to-right tilt
        });
        setIsCalibrating(false);
      };
      
      window.addEventListener('deviceorientation', orientationHandler, true);
    }
    
    initOrientation();
    
    return () => {
      mounted = false;
      if (orientationHandler) {
        window.removeEventListener('deviceorientation', orientationHandler, true);
      }
    };
  }, []);
  
  // Get user location if not available (run once on mount)
  useEffect(() => {
    const currentUserLocation = useMapStore.getState().userLocation;
    if (!currentUserLocation) {
      useMapStore.getState().geolocate();
    }
  }, []);
  
  // Filter aircraft that are in field of view
  const visibleAircraft = useMemo(() => {
    if (!userLocation || isCalibrating) return [];
    
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
      
      return isInFOV(bearing, elevation, orientation);
    }).slice(0, 10); // Limit to 10 aircraft for performance
  }, [aircraftArray, userLocation, orientation, isCalibrating]);
  
  // Auto-log spotted aircraft (only once per session, don't cause re-renders)
  useEffect(() => {
    const logged = loggedRef.current;
    const logSpotFn = usePassportStore.getState().logSpot;
    
    visibleAircraft.forEach(ac => {
      if (!logged.has(ac.hex)) {
        logged.add(ac.hex);
        // Use setTimeout to break the synchronous update chain
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
        {/* Calibration overlay */}
        <AnimatePresence>
          {isCalibrating && (
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
          {userLocation && visibleAircraft.map(ac => (
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
              {Math.round((360 - orientation.alpha) % 360)}°
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
          <div className="glass-panel p-3 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-green-400" />
              <span className="text-sm">AR Mode Active</span>
            </div>
            <div className="text-sm">
              <span className="font-bold">{visibleAircraft.length}</span>
              <span className="text-muted-foreground"> aircraft in view</span>
            </div>
          </div>
        </div>
        
        {/* Crosshair */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-8 h-8 border-2 border-white/30 rounded-full" />
          <div className="absolute w-12 h-0.5 bg-white/20" />
          <div className="absolute w-0.5 h-12 bg-white/20" />
        </div>
      </div>
    </div>
  );
});

export default ARSpotter;
