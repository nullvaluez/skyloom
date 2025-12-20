'use client';

import { memo, useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Slider } from '@/components/ui/slider';
import { Plus, Minus, Crosshair, Maximize2, Home, Box, RotateCcw, RotateCw, ChevronDown, ChevronUp, Compass } from 'lucide-react';
import { useMapStore } from '@/stores/map-store';

/**
 * Custom map controls component for MapLibre/Deck.gl
 */
export const MapControls = memo(function MapControls() {
  const [showRotationControls, setShowRotationControls] = useState(false);
  
  const zoom = useMapStore((s) => s.zoom);
  const pitch = useMapStore((s) => s.pitch);
  const bearing = useMapStore((s) => s.bearing);
  const geolocating = useMapStore((s) => s.geolocating);
  const geolocate = useMapStore((s) => s.geolocate);
  const resetView = useMapStore((s) => s.resetView);
  const setZoom = useMapStore((s) => s.setZoom);
  const setPitch = useMapStore((s) => s.setPitch);
  const setBearing = useMapStore((s) => s.setBearing);
  const adjustPitch = useMapStore((s) => s.adjustPitch);
  const adjustBearing = useMapStore((s) => s.adjustBearing);
  const resetBearing = useMapStore((s) => s.resetBearing);
  const setPresetView = useMapStore((s) => s.setPresetView);
  const disable3D = useMapStore((s) => s.disable3D);

  const handleZoomIn = useCallback(() => {
    setZoom(Math.min(zoom + 1, 18));
  }, [zoom, setZoom]);

  const handleZoomOut = useCallback(() => {
    setZoom(Math.max(zoom - 1, 2));
  }, [zoom, setZoom]);

  const handleGeolocate = useCallback(() => {
    geolocate();
  }, [geolocate]);

  const handleFullscreen = useCallback(() => {
    const container = document.querySelector('.maplibregl-map')?.parentElement;
    if (!container) return;
    
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  }, []);

  const handleReset = useCallback(() => {
    resetView();
  }, [resetView]);

  const handleToggle3D = useCallback(() => {
    if (pitch > 0) {
      disable3D();
      setShowRotationControls(false);
    } else {
      // Start with a high pitch (75°) for dramatic 3D effect
      // This tilts the view to almost horizontal, showing altitude clearly
      setPitch(75);
      setShowRotationControls(true);
    }
  }, [pitch, setPitch, disable3D]);

  const handlePitchChange = useCallback((values) => {
    setPitch(values[0]);
  }, [setPitch]);

  const handleRotateLeft = useCallback(() => {
    adjustBearing(-15);
  }, [adjustBearing]);

  const handleRotateRight = useCallback(() => {
    adjustBearing(15);
  }, [adjustBearing]);

  const handleResetBearing = useCallback(() => {
    resetBearing();
  }, [resetBearing]);

  const handlePresetView = useCallback((preset) => {
    setPresetView(preset);
    setShowRotationControls(true);
  }, [setPresetView]);

  return (
    <div className="absolute left-4 bottom-24 z-1000 flex flex-col gap-2 md:left-auto md:right-4 md:top-20 md:bottom-auto">
      {/* Zoom controls */}
      <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card/90 backdrop-blur-sm shadow-lg">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-none border-b border-border hover:bg-accent"
              onClick={handleZoomIn}
              aria-label="Zoom in"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Zoom in</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-none hover:bg-accent"
              onClick={handleZoomOut}
              aria-label="Zoom out"
            >
              <Minus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Zoom out</TooltipContent>
        </Tooltip>
      </div>

      {/* Navigation controls */}
      <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card/90 backdrop-blur-sm shadow-lg">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-none border-b border-border hover:bg-accent"
              onClick={handleGeolocate}
              disabled={geolocating}
              aria-label="Center on my location"
            >
              <Crosshair className={`h-4 w-4 ${geolocating ? 'animate-pulse' : ''}`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">My location</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`h-9 w-9 rounded-none border-b border-border hover:bg-accent ${pitch > 0 ? 'bg-accent' : ''}`}
              onClick={handleToggle3D}
              aria-label="Toggle 3D view"
            >
              <Box className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <div className="text-center">
              <div>{pitch > 0 ? 'Disable 3D' : 'Enable 3D view'}</div>
              {pitch > 0 && (
                <div className="text-xs text-muted-foreground mt-1">
                  Shift+Scroll to adjust pitch
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>

        {pitch > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-9 w-9 rounded-none border-b border-border hover:bg-accent ${showRotationControls ? 'bg-accent' : ''}`}
                onClick={() => setShowRotationControls(!showRotationControls)}
                aria-label="Toggle rotation controls"
              >
                {showRotationControls ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronUp className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Rotation controls</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-none border-b border-border hover:bg-accent"
              onClick={handleFullscreen}
              aria-label="Toggle fullscreen"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Fullscreen</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-none hover:bg-accent"
              onClick={handleReset}
              aria-label="Reset view"
            >
              <Home className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Reset view</TooltipContent>
        </Tooltip>
      </div>

      {/* 3D Rotation Controls Panel */}
      {pitch > 0 && showRotationControls && (
        <div className="flex flex-col gap-3 overflow-hidden rounded-lg border border-border bg-card/90 backdrop-blur-sm shadow-lg p-3 min-w-[200px]">
          {/* Pitch Control */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Pitch</span>
              <span className="font-mono">{Math.round(pitch)}°</span>
            </div>
            <Slider
              value={[pitch]}
              onValueChange={handlePitchChange}
              min={0}
              max={85}
              step={1}
              className="w-full"
            />
            <div className="flex gap-1 justify-center">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => adjustPitch(-5)}
                aria-label="Decrease pitch"
              >
                <Minus className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => adjustPitch(5)}
                aria-label="Increase pitch"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Bearing Control */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Bearing</span>
              <span className="font-mono">{Math.round(bearing)}°</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleRotateLeft}
                aria-label="Rotate left"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <div className="flex-1 flex items-center justify-center">
                <Compass className="h-5 w-5 text-muted-foreground" style={{ transform: `rotate(${bearing}deg)` }} />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleRotateRight}
                aria-label="Rotate right"
              >
                <RotateCw className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleResetBearing}
                aria-label="Reset bearing to North"
              >
                <Compass className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Preset Views */}
          <div className="space-y-2 border-t border-border pt-2">
            <div className="text-xs text-muted-foreground mb-1">Preset Views</div>
            <div className="grid grid-cols-2 gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handlePresetView('topDown')}
              >
                Top
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handlePresetView('isometric')}
              >
                ISO
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handlePresetView('northEast')}
              >
                NE
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handlePresetView('southEast')}
              >
                SE
              </Button>
            </div>
          </div>

          {/* Controls Help */}
          <div className="space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
            <div className="font-medium text-foreground/70">Controls</div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              <span>Shift + Scroll</span>
              <span>Pitch</span>
              <span>Right-drag</span>
              <span>Bearing</span>
              <span>W/S keys</span>
              <span>Pitch</span>
              <span>Q/E keys</span>
              <span>Bearing</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
