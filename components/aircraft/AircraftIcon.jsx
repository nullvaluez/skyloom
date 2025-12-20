'use client';

import { memo, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { getAircraftIconDefinition, ICON_COLORS } from '@/lib/aircraft-icons';

/**
 * Optimized SVG Aircraft Icon component
 * Uses CSS transforms for rotation to avoid re-renders
 * Renders different distinctive aircraft shapes based on type
 */
export const AircraftIcon = memo(function AircraftIcon({
  aircraft,
  type = 'unknown',
  classification = 'unknown',
  color,
  size = 32,
  rotation = 0,
  isEmergency = false,
  isSelected = false,
  className,
}) {
  const iconDef = getAircraftIconDefinition(aircraft, type);

  // Determine color - props override classification
  const iconColor = useMemo(() => {
    if (color) return color;
    if (isSelected) return ICON_COLORS.selected;
    if (isEmergency) return ICON_COLORS.emergency;
    return ICON_COLORS[classification] || ICON_COLORS.unknown;
  }, [color, classification, isSelected, isEmergency]);

  // Use CSS custom properties for dynamic values - rotation doesn't cause re-render
  const style = useMemo(() => ({
    width: size,
    height: size,
    '--aircraft-rotation': `${rotation}deg`,
    '--aircraft-color': iconColor,
  }), [size, rotation, iconColor]);

  // Generate unique filter ID to avoid conflicts
  const filterId = useMemo(() => `shadow-${type}-${Math.random().toString(36).substr(2, 9)}`, [type]);

  return (
    <svg
      viewBox={iconDef.viewBox}
      style={style}
      className={cn(
        'aircraft-icon-v2',
        isEmergency && 'aircraft-icon-v2--emergency',
        isSelected && 'aircraft-icon-v2--selected',
        iconDef.animate && `aircraft-icon-v2--${iconDef.animate}`,
        className
      )}
    >
      <defs>
        <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="1" stdDeviation="1" floodColor="#000" floodOpacity="0.5" />
        </filter>
        {isEmergency && (
          <filter id={`${filterId}-glow`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feFlood floodColor="#ff0000" floodOpacity="0.7" />
            <feComposite in2="blur" operator="in" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>

      <g
        className="aircraft-icon-v2__body"
        filter={isEmergency ? `url(#${filterId}-glow)` : `url(#${filterId})`}
      >
        {iconDef.paths.map((path, index) => {
          if (path.stroke && !path.fill) {
            return (
              <path
                key={index}
                d={path.d}
                fill="none"
                stroke="var(--aircraft-color)"
                strokeWidth={path.strokeWidth || 1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={path.opacity || 1}
                className={path.className}
              />
            );
          }
          return (
            <path
              key={index}
              d={path.d}
              fill={path.fill ? 'var(--aircraft-color)' : 'none'}
              stroke={path.stroke ? 'var(--aircraft-color)' : 'none'}
              strokeWidth={path.strokeWidth || 0}
              opacity={path.opacity || 1}
              className={path.className}
            />
          );
        })}
      </g>
    </svg>
  );
});

/**
 * Legacy export for backwards compatibility
 * Maps old prop format to new format
 */
export default AircraftIcon;
