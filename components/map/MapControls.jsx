'use client';

import { memo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, Minus, Crosshair, Maximize2, Home, Box, RotateCcw } from 'lucide-react';
import { useMapStore } from '@/stores/map-store';

/**
 * Custom map controls component for MapLibre/Deck.gl
 */
export const MapControls = memo(function MapControls() {
  const zoom = useMapStore((s) => s.zoom);
  const pitch = useMapStore((s) => s.pitch);
  const geolocating = useMapStore((s) => s.geolocating);
  const geolocate = useMapStore((s) => s.geolocate);
  const resetView = useMapStore((s) => s.resetView);
  const setZoom = useMapStore((s) => s.setZoom);
  const setPitch = useMapStore((s) => s.setPitch);
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
    } else {
      setPitch(60);
    }
  }, [pitch, setPitch, disable3D]);

  return (
    <div className="absolute left-4 bottom-24 z-[1000] flex flex-col gap-2 md:left-auto md:right-4 md:top-20 md:bottom-auto">
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
          <TooltipContent side="left">{pitch > 0 ? 'Disable 3D' : 'Enable 3D view'}</TooltipContent>
        </Tooltip>

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
    </div>
  );
});
