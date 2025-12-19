'use client';

import { memo } from 'react';
import { cn } from '@/lib/utils';

/**
 * SVG Aircraft Icon component
 * Renders different aircraft shapes based on type
 */
export const AircraftIcon = memo(function AircraftIcon({
  type = 'unknown',
  color = '#6b7280',
  size = 32,
  rotation = 0,
  className,
}) {
  const iconStyles = {
    width: size,
    height: size,
    transform: `rotate(${rotation}deg)`,
    transition: 'transform 0.3s ease-out',
  };

  // Default airliner/jet icon
  const AirlinerIcon = () => (
    <svg
      viewBox="0 0 24 24"
      fill={color}
      style={iconStyles}
      className={cn('drop-shadow-md', className)}
    >
      <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
    </svg>
  );

  // Helicopter icon
  const HelicopterIcon = () => (
    <svg
      viewBox="0 0 24 24"
      fill={color}
      style={iconStyles}
      className={cn('drop-shadow-md', className)}
    >
      <path d="M4 11h1v1H4v-1zm16 0h1v1h-1v-1zm-8-6c-3.86 0-7 3.14-7 7h2c0-2.76 2.24-5 5-5s5 2.24 5 5h2c0-3.86-3.14-7-7-7zm0 3c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2h2c0-2.21-1.79-4-4-4zm0 5c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm0 2c-3.31 0-6 2.69-6 6h2c0-2.21 1.79-4 4-4s4 1.79 4 4h2c0-3.31-2.69-6-6-6z" />
      <path d="M3 7h18v2H3z" />
    </svg>
  );

  // Military jet icon
  const MilitaryIcon = () => (
    <svg
      viewBox="0 0 24 24"
      fill={color}
      style={iconStyles}
      className={cn('drop-shadow-md', className)}
    >
      <path d="M22 16v-2l-8.5-5V3.5c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5V9L2 14v2l8.5-2.5V19L8 20.5V22l4-1 4 1v-1.5L13.5 19v-5.5L22 16z" />
    </svg>
  );

  // Cargo plane icon
  const CargoIcon = () => (
    <svg
      viewBox="0 0 24 24"
      fill={color}
      style={iconStyles}
      className={cn('drop-shadow-md', className)}
    >
      <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
      <rect x="9" y="10" width="6" height="4" rx="1" />
    </svg>
  );

  // Small prop plane icon
  const PropIcon = () => (
    <svg
      viewBox="0 0 24 24"
      fill={color}
      style={iconStyles}
      className={cn('drop-shadow-md', className)}
    >
      <path d="M12 2c-.55 0-1 .45-1 1v6L4 13v2l7-2v4l-2 1.5V20l3-1 3 1v-1.5L13 17v-4l7 2v-2l-7-4V3c0-.55-.45-1-1-1z" />
    </svg>
  );

  // Business jet icon (sleeker, swept wings)
  const JetIcon = () => (
    <svg
      viewBox="0 0 24 24"
      fill={color}
      style={iconStyles}
      className={cn('drop-shadow-md', className)}
    >
      <path d="M21 15v-2l-7.5-4.5V3.5c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5V8.5L3 13v2l7.5-2v4.5L8.5 19v1.5l3.5-.75 3.5.75V19l-2-1.5V13l7.5 2z" />
    </svg>
  );

  // Glider icon (long thin wings, no engine)
  const GliderIcon = () => (
    <svg
      viewBox="0 0 24 24"
      fill={color}
      style={iconStyles}
      className={cn('drop-shadow-md', className)}
    >
      <path d="M12 4c-.3 0-.55.25-.55.55v5.9L2 13v1.5l9.45-2v5l-1.95 1.2v1.3l2.5-.6 2.5.6v-1.3L12.55 17.5v-5L22 14.5V13l-9.45-2.55V4.55c0-.3-.25-.55-.55-.55z" />
    </svg>
  );

  // Drone/UAV icon (quadcopter style)
  const DroneIcon = () => (
    <svg
      viewBox="0 0 24 24"
      fill={color}
      style={iconStyles}
      className={cn('drop-shadow-md', className)}
    >
      <circle cx="6" cy="6" r="3" fillOpacity="0.7" />
      <circle cx="18" cy="6" r="3" fillOpacity="0.7" />
      <circle cx="6" cy="18" r="3" fillOpacity="0.7" />
      <circle cx="18" cy="18" r="3" fillOpacity="0.7" />
      <rect x="10" y="10" width="4" height="4" rx="1" />
      <line x1="6" y1="6" x2="10" y2="10" stroke={color} strokeWidth="1.5" />
      <line x1="18" y1="6" x2="14" y2="10" stroke={color} strokeWidth="1.5" />
      <line x1="6" y1="18" x2="10" y2="14" stroke={color} strokeWidth="1.5" />
      <line x1="18" y1="18" x2="14" y2="14" stroke={color} strokeWidth="1.5" />
    </svg>
  );

  // Unknown/generic icon
  const UnknownIcon = () => (
    <svg
      viewBox="0 0 24 24"
      fill={color}
      style={iconStyles}
      className={cn('drop-shadow-md', className)}
    >
      <circle cx="12" cy="12" r="8" fillOpacity="0.8" />
      <path d="M12 6l4 8H8l4-8z" fill="white" fillOpacity="0.6" />
    </svg>
  );

  // Select icon based on type (now using physical aircraft shape types)
  switch (type) {
    case 'helicopter':
      return <HelicopterIcon />;
    case 'military':
      return <MilitaryIcon />;
    case 'cargo':
      return <CargoIcon />;
    case 'prop':
      return <PropIcon />;
    case 'jet':
      return <JetIcon />;
    case 'glider':
      return <GliderIcon />;
    case 'drone':
      return <DroneIcon />;
    case 'airliner':
      return <AirlinerIcon />;
    case 'unknown':
      return <UnknownIcon />;
    default:
      return <AirlinerIcon />;
  }
});
