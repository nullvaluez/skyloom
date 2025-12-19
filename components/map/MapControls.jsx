'use client';

import { memo } from 'react';
import { useMap } from 'react-leaflet';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Plus, Minus, Crosshair, Maximize2, Home } from 'lucide-react';
import { useMapStore } from '@/stores/map-store';
import { MAP_CONFIG } from '@/lib/constants';

/**
 * Custom map controls component
 */
export const MapControls = memo(function MapControls() {
  const map = useMap();
  const { geolocate, geolocating, resetView } = useMapStore();

  const handleZoomIn = () => {
    map.zoomIn();
  };

  const handleZoomOut = () => {
    map.zoomOut();
  };

  const handleGeolocate = () => {
    geolocate();
  };

  const handleFullscreen = () => {
    const container = map.getContainer();
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  };

  const handleReset = () => {
    map.flyTo(MAP_CONFIG.defaultCenter, MAP_CONFIG.defaultZoom, {
      duration: 1.5,
    });
  };

  return (
    <div className="absolute right-4 top-4 z-[1000] flex flex-col gap-2">
      <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg">
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

      <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-lg">
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
