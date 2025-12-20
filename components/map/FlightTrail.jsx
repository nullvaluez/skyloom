'use client';

import { useMemo, memo, useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useAircraftStore } from '@/stores/aircraft-store';
import { TRAIL_CONFIG } from '@/lib/constants';
import { ICON_COLORS } from '@/lib/aircraft-icons';

/**
 * Enhanced flight trail with gradient fade effect
 * Uses canvas for smooth gradient rendering from aircraft color to dim gray
 */
export const FlightTrail = memo(function FlightTrail() {
  const map = useMap();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  
  // Subscribe directly to state for reactive updates
  const selectedAircraftId = useAircraftStore((state) => state.selectedAircraftId);
  const trails = useAircraftStore((state) => state.trails);
  const aircraft = useAircraftStore((state) => state.aircraft);

  const trailData = useMemo(() => {
    if (!selectedAircraftId) {
      return null;
    }
    
    const trail = trails.get(selectedAircraftId);
    if (!trail || trail.length === 0) {
      return null;
    }

    const selectedAircraft = aircraft.get(selectedAircraftId);
    const aircraftColor = selectedAircraft?._color || ICON_COLORS.selected;

    return {
      positions: trail.map((pos) => [pos.lat, pos.lon]),
      color: aircraftColor,
      count: trail.length,
    };
  }, [selectedAircraftId, trails, aircraft]);

  // Initialize canvas layer
  useEffect(() => {
    if (!map) return;

    const pane = map.getPane('overlayPane');
    const container = L.DomUtil.create('div', 'leaflet-trail-canvas-layer', pane);
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.pointerEvents = 'none';
    
    const canvas = L.DomUtil.create('canvas', 'trail-canvas', container);
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

  // Redraw trail with gradient effect
  useEffect(() => {
    if (!canvasRef.current || !map || !trailData) {
      // Clear canvas if no trail
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const { positions, color, count } = trailData;

    // Position canvas
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(containerRef.current, topLeft);

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (positions.length < 2) {
      // Draw single point as circle
      const point = map.latLngToContainerPoint(positions[0]);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Draw trail with gradient fade
    const points = positions.map(pos => map.latLngToContainerPoint(pos));
    
    // Draw segments with varying opacity and width
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      
      // Calculate fade based on position in trail (oldest to newest)
      const progress = i / (points.length - 1);
      const opacity = 0.15 + progress * 0.85; // 15% to 100%
      const width = 1.5 + progress * 1.5; // 1.5px to 3px
      
      // Parse color components
      const colorMatch = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
      if (!colorMatch) continue;
      
      const r = parseInt(colorMatch[1], 16);
      const g = parseInt(colorMatch[2], 16);
      const b = parseInt(colorMatch[3], 16);
      
      // Gradient from dim gray at start to aircraft color at end
      const dimGray = { r: 100, g: 100, b: 100 };
      const currentR = Math.round(dimGray.r + (r - dimGray.r) * progress);
      const currentG = Math.round(dimGray.g + (g - dimGray.g) * progress);
      const currentB = Math.round(dimGray.b + (b - dimGray.b) * progress);
      
      ctx.strokeStyle = `rgba(${currentR}, ${currentG}, ${currentB}, ${opacity})`;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // Draw current position marker (brightest point)
    const lastPoint = points[points.length - 1];
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(lastPoint.x, lastPoint.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

  }, [map, trailData]);

  // Redraw on map move
  const isZooming = useRef(false);

  useEffect(() => {
    if (!map) return;

    const handleMove = (e) => {
      // Skip updates during zoom animation
      if (isZooming.current && e?.type !== 'zoomend') return;

      if (containerRef.current && canvasRef.current && trailData) {
        const topLeft = map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(containerRef.current, topLeft);
        
        // Trigger redraw
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const { positions, color } = trailData;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (positions.length < 2) {
          const point = map.latLngToContainerPoint(positions[0]);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
          ctx.fill();
          return;
        }

        const points = positions.map(pos => map.latLngToContainerPoint(pos));
        
        for (let i = 0; i < points.length - 1; i++) {
          const p1 = points[i];
          const p2 = points[i + 1];
          const progress = i / (points.length - 1);
          const opacity = 0.15 + progress * 0.85;
          const width = 1.5 + progress * 1.5;
          
          const colorMatch = color.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
          if (!colorMatch) continue;
          
          const r = parseInt(colorMatch[1], 16);
          const g = parseInt(colorMatch[2], 16);
          const b = parseInt(colorMatch[3], 16);
          
          const dimGray = { r: 100, g: 100, b: 100 };
          const currentR = Math.round(dimGray.r + (r - dimGray.r) * progress);
          const currentG = Math.round(dimGray.g + (g - dimGray.g) * progress);
          const currentB = Math.round(dimGray.b + (b - dimGray.b) * progress);
          
          ctx.strokeStyle = `rgba(${currentR}, ${currentG}, ${currentB}, ${opacity})`;
          ctx.lineWidth = width;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }

        const lastPoint = points[points.length - 1];
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(lastPoint.x, lastPoint.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    };

    const handleZoomStart = () => {
      isZooming.current = true;
    };

    const handleZoomEnd = () => {
      isZooming.current = false;
      handleMove({ type: 'zoomend' });
    };

    map.on('move', handleMove);
    map.on('zoomstart', handleZoomStart);
    map.on('zoomend', handleZoomEnd);

    return () => {
      map.off('move', handleMove);
      map.off('zoomstart', handleZoomStart);
      map.off('zoomend', handleZoomEnd);
    };
  }, [map, trailData]);

  return null;
});
