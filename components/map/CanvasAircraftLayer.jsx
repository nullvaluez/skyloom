'use client';

import { useEffect, useRef, useMemo, useCallback } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useAircraftStore } from '@/stores/aircraft-store';
import { useMapStore } from '@/stores/map-store';
import { useUIStore } from '@/stores/ui-store';
import { getIconBitmap } from '@/lib/icon-bitmap-cache';
import { isEmergency } from '@/lib/classify';
import { ICON_COLORS } from '@/lib/aircraft-icons';
import { useDevStore } from '@/stores/dev-store';

export function CanvasAircraftLayer({ aircraft }) {
  const map = useMap();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const { selectedAircraftId, selectAircraft } = useAircraftStore();
  const { getIconSize } = useMapStore();
  const { openDetailPanel } = useUIStore();
  const setMetric = useDevStore(s => s.setMetric);

  // Initialize the canvas layer
  useEffect(() => {
    const pane = map.getPane('overlayPane');
    const container = L.DomUtil.create('div', 'leaflet-canvas-layer', pane);
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.pointerEvents = 'auto'; // We want to capture clicks for hit testing
    
    const canvas = L.DomUtil.create('canvas', 'aircraft-canvas', container);
    canvas.style.display = 'block';
    
    containerRef.current = container;
    canvasRef.current = canvas;

    const onResize = () => {
      const size = map.getSize();
      canvas.width = size.x;
      canvas.height = size.y;
      canvas.style.width = size.x + 'px';
      canvas.style.height = size.y + 'px';
    };

    map.on('resize', onResize);
    onResize();

    return () => {
      map.off('resize', onResize);
      L.DomUtil.remove(container);
    };
  }, [map]);

  // Redraw function - optimized with parallel bitmap fetching
  const redraw = useCallback(async () => {
    if (!canvasRef.current || !aircraft || aircraft.length === 0) return;

    const start = performance.now();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const bounds = map.getBounds();
    const iconSize = getIconSize();
    const zoom = map.getZoom();

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Filter aircraft that are in bounds and pre-compute render data
    const visibleAircraft = aircraft
      .filter(ac => ac.lat && ac.lon && bounds.contains([ac.lat, ac.lon]))
      .map(ac => ({
        ac,
        point: map.latLngToContainerPoint([ac.lat, ac.lon]),
        isSelected: selectedAircraftId === ac.hex,
        emergency: isEmergency(ac),
        callsign: ac.flight?.trim() || ac.hex,
      }));

    // Pre-fetch all bitmaps in parallel for better performance
    const bitmapPromises = visibleAircraft.map(({ ac, isSelected, emergency }) =>
      getIconBitmap({
        type: ac._iconType || 'airliner',
        color: ac._color || ICON_COLORS.unknown,
        size: iconSize,
        rotation: ac.track || 0,
        emergency,
        selected: isSelected,
        aircraft: ac,
      })
    );

    const bitmaps = await Promise.all(bitmapPromises);

    // Now draw all aircraft synchronously for consistent frame timing
    visibleAircraft.forEach(({ ac, point, isSelected, emergency, callsign }, index) => {
      const bitmap = bitmaps[index];
      if (!bitmap) return;

      const drawX = point.x - iconSize / 2;
      const drawY = point.y - iconSize / 2;

      // Selection glow effect
      if (isSelected) {
        ctx.shadowColor = ICON_COLORS.selected;
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // Draw selection ring
        ctx.strokeStyle = ICON_COLORS.selected;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(point.x, point.y, iconSize * 0.7, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Emergency pulsing glow
      else if (emergency) {
        const pulseIntensity = Math.abs(Math.sin(Date.now() / 250)) * 8 + 4;
        ctx.shadowColor = ICON_COLORS.emergency;
        ctx.shadowBlur = pulseIntensity;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }
      // Subtle shadow for all aircraft
      else {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;
      }

      // Draw the aircraft icon
      ctx.drawImage(bitmap, drawX, drawY, iconSize, iconSize);

      // Reset shadow for text rendering
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // Draw callsign with background pill if zoomed in or selected
      if (isSelected || zoom > 11) {
        const textColor = isSelected ? ICON_COLORS.selected : (emergency ? ICON_COLORS.emergency : ac._color);

        // Measure text for background pill
        ctx.font = 'bold 10px ui-monospace, monospace';
        const textMetrics = ctx.measureText(callsign);
        const textWidth = textMetrics.width;
        const paddingX = 4;
        const paddingY = 2;
        const pillY = point.y + iconSize / 2 + 6;

        // Draw background pill
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.beginPath();
        ctx.roundRect(
          point.x - textWidth / 2 - paddingX,
          pillY - paddingY,
          textWidth + paddingX * 2,
          12 + paddingY * 2,
          3
        );
        ctx.fill();

        // Draw text
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = textColor;
        ctx.fillText(callsign, point.x, pillY);
      }
    });

    const end = performance.now();
    setMetric('renderTimeMs', end - start);
  }, [map, aircraft, getIconSize, selectedAircraftId, setMetric]);

  // Redraw on map events and data changes
  const isZooming = useRef(false);

  useEffect(() => {
    const handleMove = () => {
      // Skip updates during zoom animation to prevent jitter/glitching
      // Leaflet handles CSS scaling of the pane during zoom
      if (isZooming.current) return;

      const container = containerRef.current;
      if (container) {
        const topLeft = map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(container, topLeft);
      }
      redraw();
    };

    const handleZoomStart = () => {
      isZooming.current = true;
    };

    const handleZoomEnd = () => {
      isZooming.current = false;
      // Force position update and redraw after zoom finishes
      const container = containerRef.current;
      if (container) {
        const topLeft = map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(container, topLeft);
      }
      redraw();
    };

    map.on('move', handleMove);
    map.on('zoomstart', handleZoomStart);
    map.on('zoomend', handleZoomEnd);
    
    // Initial redraw
    handleMove();

    return () => {
      map.off('move', handleMove);
      map.off('zoomstart', handleZoomStart);
      map.off('zoomend', handleZoomEnd);
    };
  }, [map, redraw]);

  // Hit testing for selection
  useEffect(() => {
    const handleClick = (e) => {
      if (!aircraft) return;
      
      const point = map.mouseEventToContainerPoint(e.originalEvent);
      const iconSize = getIconSize();
      const clickRadius = iconSize / 2 + 5;

      let found = null;
      let minDistance = clickRadius;

      for (const ac of aircraft) {
        if (!ac.lat || !ac.lon) continue;
        const acPoint = map.latLngToContainerPoint([ac.lat, ac.lon]);
        const dx = point.x - acPoint.x;
        const dy = point.y - acPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < clickRadius && distance < minDistance) {
          minDistance = distance;
          found = ac;
        }
      }

      if (found) {
        selectAircraft(found.hex);
        openDetailPanel();
        L.DomEvent.stopPropagation(e);
      }
    };

    map.on('click', handleClick);
    return () => map.off('click', handleClick);
  }, [map, aircraft, getIconSize, selectAircraft, openDetailPanel]);

  // Trigger redraw when aircraft data changes
  useEffect(() => {
    redraw();
  }, [aircraft, redraw]);

  return null;
}
