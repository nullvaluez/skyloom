'use client';

import { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Camera, AlertTriangle, Plane, Navigation, MapPin, Clock, ArrowUp, Volume2, VolumeX, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAircraftStore } from '@/stores/aircraft-store';
import { useMapStore } from '@/stores/map-store';
import { useUIStore } from '@/stores/ui-store';
import { usePassportStore } from '@/stores/passport-store';
import { formatAltitude, formatCallsign } from '@/lib/format';
import { getRarityColor } from '@/lib/rarity';
import { getAirlineFromCallsign } from '@/lib/airlines';
import { calculateDistance, calculateETA } from '@/lib/api';

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
 * Calculate distance from user to aircraft in nautical miles
 */
function calculateDistanceToAircraft(userLat, userLon, acLat, acLon) {
  const R = 3440.065; // Earth radius in nautical miles
  const dLat = (acLat - userLat) * Math.PI / 180;
  const dLon = (acLon - userLon) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(userLat * Math.PI / 180) * Math.cos(acLat * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Format distance for display
 */
function formatDistanceDisplay(distanceNm) {
  if (distanceNm < 1) {
    return `${Math.round(distanceNm * 10) / 10} nm`;
  }
  return `${Math.round(distanceNm)} nm`;
}

/**
 * AR Label for an aircraft - Enhanced with route info and distance
 */
const ARLabel = memo(function ARLabel({ aircraft, orientation, userLocation, onTap }) {
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
  
  // Calculate distance to aircraft
  const distanceNm = useMemo(() => {
    return calculateDistanceToAircraft(
      userLocation[0], userLocation[1],
      aircraft.lat, aircraft.lon
    );
  }, [userLocation, aircraft.lat, aircraft.lon]);
  
  // Get airline info from callsign
  const airline = useMemo(() => {
    return getAirlineFromCallsign(aircraft.flight);
  }, [aircraft.flight]);
  
  // Determine if aircraft is climbing, descending, or level
  const verticalTrend = useMemo(() => {
    const rate = aircraft.baro_rate || 0;
    if (rate > 300) return 'climbing';
    if (rate < -300) return 'descending';
    return 'level';
  }, [aircraft.baro_rate]);
  
  // Handle tap on AR label
  const handleTap = useCallback(() => {
    if (onTap) {
      onTap(aircraft);
    }
  }, [aircraft, onTap]);
  
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      className="absolute"
      style={{
        left: `${clampedX}%`,
        top: `${clampedY}%`,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <div 
        className="glass-panel p-2.5 flex flex-col items-center gap-1.5 min-w-[100px] cursor-pointer active:scale-95 transition-transform"
        onClick={handleTap}
      >
        {/* Aircraft icon with heading indicator */}
        <div className="relative">
          <Plane 
            className="h-7 w-7" 
            style={{ 
              color: rarityColor,
              transform: `rotate(${aircraft.track || 0}deg)`,
            }} 
          />
          {/* Vertical trend indicator */}
          {verticalTrend !== 'level' && (
            <ArrowUp 
              className={`absolute -right-1 -top-1 h-3 w-3 ${
                verticalTrend === 'climbing' ? 'text-green-400' : 'text-red-400 rotate-180'
              }`}
            />
          )}
        </div>
        
        {/* Flight callsign / airline */}
        <div className="text-xs font-bold text-white text-center">
          {formatCallsign(aircraft.flight) || aircraft.hex}
        </div>
        
        {/* Airline name if available */}
        {airline && (
          <div className="text-[9px] text-muted-foreground truncate max-w-[90px]">
            {airline.name}
          </div>
        )}
        
        {/* Altitude with trend indicator */}
        <div className="flex items-center gap-1 text-[10px]">
          <span className={`font-mono ${
            verticalTrend === 'climbing' ? 'text-green-400' : 
            verticalTrend === 'descending' ? 'text-amber-400' : 
            'text-muted-foreground'
          }`}>
            {formatAltitude(aircraft.alt_baro)}
          </span>
        </div>
        
        {/* Distance from user */}
        <div className="flex items-center gap-1 text-[10px] text-cyan-400">
          <MapPin className="h-3 w-3" />
          <span className="font-mono">{formatDistanceDisplay(distanceNm)}</span>
        </div>
        
        {/* Ground speed */}
        {aircraft.gs && (
          <div className="text-[9px] text-muted-foreground font-mono">
            {Math.round(aircraft.gs)} kts
          </div>
        )}
        
        {/* Rarity bar */}
        <div className="h-1 w-full rounded bg-background/50 overflow-hidden mt-1">
          <div 
            className="h-full rounded transition-all duration-300"
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
  const canvasRef = useRef(null);
  const loggedRef = useRef(new Set()); // Track logged aircraft per session
  const previousAircraftCountRef = useRef(0); // For sound notification
  const [hasPermissions, setHasPermissions] = useState(false);
  const [error, setError] = useState(null);
  const [orientation, setOrientation] = useState({ alpha: 0, beta: 0, gamma: 0 });
  const [isCalibrating, setIsCalibrating] = useState(true);
  const [hasOrientation, setHasOrientation] = useState(false);
  const [needsOrientationPermission, setNeedsOrientationPermission] = useState(false);
  const [selectedAircraft, setSelectedAircraft] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [captureMessage, setCaptureMessage] = useState(null);
  const orientationHandlerRef = useRef(null);
  
  // Select primitive/stable values from stores to avoid infinite loops
  const userLocation = useMapStore((s) => s.userLocation);
  const aircraftMap = useAircraftStore((s) => s.aircraft);
  const selectAircraftStore = useAircraftStore((s) => s.selectAircraft);
  const openDetailPanel = useUIStore((s) => s.openDetailPanel);
  
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
  
  // Setup orientation handler function (shared between auto-init and manual request)
  const setupOrientationListener = useCallback(() => {
    // Remove any existing handler first
    if (orientationHandlerRef.current) {
      window.removeEventListener('deviceorientation', orientationHandlerRef.current, true);
    }

    orientationHandlerRef.current = (event) => {
      // Check if we have actual orientation data (not all nulls)
      if (event.alpha !== null || event.beta !== null) {
        setOrientation({
          alpha: event.alpha || 0, // Compass heading
          beta: event.beta || 0,   // Front-to-back tilt
          gamma: event.gamma || 0, // Left-to-right tilt
        });
        setHasOrientation(true);
        setIsCalibrating(false);
        setNeedsOrientationPermission(false);
      }
    };

    window.addEventListener('deviceorientation', orientationHandlerRef.current, true);

    // Fallback: end calibration after 3 seconds even if no orientation events
    setTimeout(() => {
      setIsCalibrating(false);
    }, 3000);
  }, []);

  // Handle iOS permission request - MUST be called from user gesture (button tap)
  const requestOrientationPermission = useCallback(async () => {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission === 'granted') {
          setupOrientationListener();
        } else {
          console.log('Orientation permission denied');
          setIsCalibrating(false);
          setNeedsOrientationPermission(false);
        }
      } catch (err) {
        console.error('Orientation permission error:', err);
        setIsCalibrating(false);
        setNeedsOrientationPermission(false);
      }
    }
  }, [setupOrientationListener]);

  // Check if we need permission and auto-setup for non-iOS devices
  useEffect(() => {
    let mounted = true;

    const checkOrientationSupport = () => {
      // Check if iOS requires permission (iOS 13+)
      if (typeof DeviceOrientationEvent !== 'undefined' &&
          typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iOS - need user gesture to request permission
        if (mounted) {
          setNeedsOrientationPermission(true);
          setIsCalibrating(false); // Stop calibration spinner, show button instead
        }
        return;
      }

      // Non-iOS: try to listen directly
      // First check if deviceorientation events are even available
      if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
        setupOrientationListener();
      } else {
        // No orientation support at all
        if (mounted) {
          setIsCalibrating(false);
        }
      }
    };

    checkOrientationSupport();

    return () => {
      mounted = false;
      if (orientationHandlerRef.current) {
        window.removeEventListener('deviceorientation', orientationHandlerRef.current, true);
      }
    };
  }, [setupOrientationListener]);
  
  // Get user location if not available (run once on mount)
  useEffect(() => {
    const currentUserLocation = useMapStore.getState().userLocation;
    if (!currentUserLocation) {
      useMapStore.getState().geolocate();
    }
  }, []);
  
  // Filter aircraft that are in field of view (or show all nearby if no orientation)
  const visibleAircraft = useMemo(() => {
    if (!userLocation) return [];
    if (isCalibrating) return [];
    
    // If we don't have orientation data, show all nearby aircraft sorted by distance
    if (!hasOrientation) {
      return aircraftArray
        .filter(ac => ac.lat && ac.lon)
        .map(ac => {
          // Calculate distance for sorting
          const dLat = ac.lat - userLocation[0];
          const dLon = ac.lon - userLocation[1];
          const dist = Math.sqrt(dLat * dLat + dLon * dLon);
          return { ...ac, _dist: dist };
        })
        .sort((a, b) => a._dist - b._dist)
        .slice(0, 10);
    }
    
    // With orientation, filter to aircraft in field of view (use wider FOV)
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
      
      // Use wider FOV for better detection (120° horizontal, 90° vertical)
      return isInFOV(bearing, elevation, orientation, 120, 90);
    }).slice(0, 10); // Limit to 10 aircraft for performance
  }, [aircraftArray, userLocation, orientation, isCalibrating, hasOrientation]);
  
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

  // Play sound when new aircraft enters view
  useEffect(() => {
    if (!soundEnabled || isCalibrating) return;
    
    const currentCount = visibleAircraft.length;
    const previousCount = previousAircraftCountRef.current;
    
    // Only play sound when aircraft count increases
    if (currentCount > previousCount && previousCount > 0) {
      playAircraftDetectedSound();
    }
    
    previousAircraftCountRef.current = currentCount;
  }, [visibleAircraft.length, soundEnabled, isCalibrating]);

  // Play a subtle sound when aircraft is detected
  const playAircraftDetectedSound = useCallback(() => {
    try {
      // Create a subtle beep using Web Audio API
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 880; // A5 note
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.15);
    } catch (e) {
      // Audio not supported, silently fail
    }
  }, []);

  // Handle tap on AR label - open detail panel
  const handleAircraftTap = useCallback((aircraft) => {
    setSelectedAircraft(aircraft);
    selectAircraftStore(aircraft.hex);
    openDetailPanel();
    // Play haptic feedback if available
    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  }, [selectAircraftStore, openDetailPanel]);

  // Capture photo with AR overlay
  const capturePhoto = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      
      // Set canvas size to match video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      // Draw video frame
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Draw AR overlay info
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, canvas.height - 60, canvas.width, 60);
      
      ctx.fillStyle = 'white';
      ctx.font = '16px sans-serif';
      ctx.fillText(`ShadowADSB AR - ${visibleAircraft.length} aircraft visible`, 10, canvas.height - 35);
      ctx.fillText(new Date().toLocaleString(), 10, canvas.height - 15);
      
      // Add aircraft labels
      visibleAircraft.forEach((ac, index) => {
        const y = 30 + index * 20;
        if (y < canvas.height - 80) {
          ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
          ctx.fillRect(10, y - 15, 200, 18);
          ctx.fillStyle = 'white';
          ctx.font = '12px monospace';
          ctx.fillText(
            `${formatCallsign(ac.flight) || ac.hex} - ${formatAltitude(ac.alt_baro)}`,
            15, y
          );
        }
      });
      
      // Convert to blob and download
      canvas.toBlob(async (blob) => {
        if (blob) {
          // Try native share first (mobile)
          if (navigator.share && navigator.canShare) {
            const file = new File([blob], `shadowadsb-ar-${Date.now()}.png`, { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
              try {
                await navigator.share({
                  files: [file],
                  title: 'ShadowADSB AR Capture',
                });
                setCaptureMessage('Photo shared!');
              } catch (e) {
                if (e.name !== 'AbortError') {
                  downloadBlob(blob);
                }
              }
            } else {
              downloadBlob(blob);
            }
          } else {
            downloadBlob(blob);
          }
        }
      }, 'image/png', 0.95);
      
      // Visual feedback
      setCaptureMessage('Photo captured!');
      setTimeout(() => setCaptureMessage(null), 2000);
      
      // Haptic feedback
      if (navigator.vibrate) {
        navigator.vibrate([10, 50, 10]);
      }
    } catch (e) {
      console.error('Photo capture error:', e);
      setCaptureMessage('Capture failed');
      setTimeout(() => setCaptureMessage(null), 2000);
    }
  }, [visibleAircraft]);

  // Helper function to download blob
  const downloadBlob = useCallback((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shadowadsb-ar-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setCaptureMessage('Photo saved!');
  }, []);
  
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
      {/* Hidden canvas for photo capture */}
      <canvas ref={canvasRef} className="hidden" />
      
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
        {/* Enhanced Calibration overlay */}
        <AnimatePresence>
          {isCalibrating && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center bg-black/70"
            >
              <div className="glass-panel p-8 text-center max-w-xs">
                {/* Animated compass icon */}
                <div className="relative w-24 h-24 mx-auto mb-6">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                    className="absolute inset-0"
                  >
                    <svg viewBox="0 0 100 100" className="w-full h-full">
                      <circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke="rgba(59, 130, 246, 0.3)"
                        strokeWidth="2"
                      />
                      <circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke="#3b82f6"
                        strokeWidth="3"
                        strokeDasharray="70 213"
                        strokeLinecap="round"
                      />
                    </svg>
                  </motion.div>
                  <Navigation className="absolute inset-0 m-auto h-10 w-10 text-blue-400" />
                </div>
                
                <p className="text-xl font-semibold mb-2">Calibrating Compass</p>
                
                {/* Figure-8 animation hint */}
                <div className="relative h-12 mb-4">
                  <motion.div
                    animate={{
                      x: [0, 20, 0, -20, 0],
                      y: [0, -10, 0, 10, 0],
                    }}
                    transition={{
                      duration: 2,
                      repeat: Infinity,
                      ease: 'easeInOut',
                    }}
                    className="absolute left-1/2 -translate-x-1/2"
                  >
                    <div className="w-3 h-3 rounded-full bg-blue-400 shadow-lg shadow-blue-500/50" />
                  </motion.div>
                  <svg viewBox="0 0 100 40" className="w-full h-full opacity-30">
                    <path
                      d="M10,20 Q25,0 50,20 Q75,40 90,20 Q75,0 50,20 Q25,40 10,20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                </div>
                
                <p className="text-sm text-muted-foreground">
                  Move your device in a figure-8 pattern
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  This helps calibrate the compass for accurate AR positioning
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* iOS Gyroscope Permission Request - must be triggered by user tap */}
        <AnimatePresence>
          {needsOrientationPermission && !hasOrientation && !isCalibrating && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center bg-black/70"
            >
              <div className="glass-panel p-6 text-center max-w-xs">
                <Navigation className="h-12 w-12 mx-auto mb-4 text-blue-400" />
                <p className="text-lg font-semibold mb-2">Enable Gyroscope</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Tap the button below to enable motion tracking for AR mode. This allows us to track where you're pointing your device.
                </p>
                <Button
                  onClick={requestOrientationPermission}
                  className="w-full"
                  size="lg"
                >
                  Enable Motion Tracking
                </Button>
                <button
                  onClick={() => setNeedsOrientationPermission(false)}
                  className="mt-3 text-sm text-muted-foreground hover:text-white transition-colors"
                >
                  Skip (show all nearby aircraft)
                </button>
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
              onTap={handleAircraftTap}
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
          
          <div className="flex items-center gap-2">
            {/* Sound toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="glass-panel"
              title={soundEnabled ? 'Mute sounds' : 'Enable sounds'}
            >
              {soundEnabled ? (
                <Volume2 className="h-5 w-5 text-green-400" />
              ) : (
                <VolumeX className="h-5 w-5 text-muted-foreground" />
              )}
            </Button>
            
            {/* Close button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="glass-panel"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Capture message toast */}
        <AnimatePresence>
          {captureMessage && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="absolute top-20 left-1/2 -translate-x-1/2 glass-panel px-4 py-2"
            >
              <span className="text-sm font-medium text-green-400">{captureMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Bottom info and capture button */}
        <div className="absolute bottom-0 left-0 right-0 p-4 space-y-3">
          {/* Capture button - large and prominent */}
          <div className="flex justify-center">
            <Button
              onClick={capturePhoto}
              className="h-16 w-16 rounded-full bg-white/20 backdrop-blur-md border-4 border-white/50 hover:bg-white/30 active:scale-95 transition-transform"
              aria-label="Capture photo"
            >
              <Camera className="h-8 w-8 text-white" />
            </Button>
          </div>
          
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
            {!hasOrientation && !isCalibrating && (
              <div className="text-xs text-amber-400 text-center">
                No gyroscope detected - showing all nearby aircraft
              </div>
            )}
            {!userLocation && !isCalibrating && (
              <div className="text-xs text-amber-400 text-center">
                Waiting for location...
              </div>
            )}
          </div>
        </div>
        
        {/* North indicator - shows direction to north at top of screen */}
        {hasOrientation && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 pointer-events-none">
            <motion.div
              animate={{ 
                x: (() => {
                  const heading = (360 - orientation.alpha) % 360;
                  // Calculate where north is relative to current heading
                  // If heading is 0 (facing north), indicator is centered
                  // If heading is 90 (facing east), north is to the left
                  const northOffset = -heading;
                  // Normalize to -180 to 180
                  const normalizedOffset = ((northOffset + 180) % 360) - 180;
                  // Scale to screen percentage and clamp
                  return Math.max(-150, Math.min(150, normalizedOffset * 2));
                })()
              }}
              transition={{ type: 'spring', stiffness: 100, damping: 15 }}
              className="flex flex-col items-center"
            >
              <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-b-[12px] border-b-red-500 drop-shadow-lg" />
              <span className="text-[10px] font-bold text-red-500 mt-0.5">N</span>
            </motion.div>
          </div>
        )}

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
