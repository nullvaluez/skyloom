'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { motion, useSpring, useTransform, animate } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * Animated odometer-style number display
 * Numbers roll like a mechanical counter
 */
export const Odometer = memo(function Odometer({
  value,
  format = (v) => Math.round(v).toLocaleString(),
  className,
  duration = 0.8,
}) {
  const spring = useSpring(0, {
    stiffness: 100,
    damping: 30,
    mass: 1,
  });

  const display = useTransform(spring, (current) => format(current));
  const [displayValue, setDisplayValue] = useState(format(0));

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  useEffect(() => {
    const unsubscribe = display.on('change', (v) => {
      setDisplayValue(v);
    });
    return unsubscribe;
  }, [display]);

  return (
    <span className={cn('font-mono tabular-nums', className)}>
      {displayValue}
    </span>
  );
});

/**
 * Individual digit with roll animation
 */
const RollingDigit = memo(function RollingDigit({ digit, className }) {
  const prevDigit = useRef(digit);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (prevDigit.current !== digit) {
      setIsAnimating(true);
      const timeout = setTimeout(() => setIsAnimating(false), 300);
      prevDigit.current = digit;
      return () => clearTimeout(timeout);
    }
  }, [digit]);

  return (
    <span className={cn('inline-block relative overflow-hidden', className)}>
      <motion.span
        key={digit}
        initial={{ y: isAnimating ? '-100%' : 0 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="inline-block"
      >
        {digit}
      </motion.span>
    </span>
  );
});

/**
 * Rolling odometer with individual digit animations
 * Better for small numbers where you want each digit to roll
 */
export const RollingOdometer = memo(function RollingOdometer({
  value,
  padLength = 0,
  className,
  digitClassName,
}) {
  const stringValue = padLength > 0 
    ? String(Math.round(value)).padStart(padLength, '0')
    : String(Math.round(value));

  return (
    <span className={cn('font-mono tabular-nums inline-flex', className)}>
      {stringValue.split('').map((digit, index) => (
        <RollingDigit
          key={`${index}-${stringValue.length}`}
          digit={digit}
          className={digitClassName}
        />
      ))}
    </span>
  );
});

/**
 * Flight data display with animated value
 */
export const FlightDataValue = memo(function FlightDataValue({
  value,
  unit,
  label,
  format = (v) => v?.toLocaleString() ?? '--',
  className,
  valueClassName,
  labelClassName,
  unitClassName,
}) {
  const numericValue = typeof value === 'number' ? value : 0;
  const hasValue = value !== null && value !== undefined;

  return (
    <div className={cn('flex flex-col', className)}>
      {label && (
        <span className={cn('text-xs text-muted-foreground uppercase tracking-wider', labelClassName)}>
          {label}
        </span>
      )}
      <div className="flex items-baseline gap-1">
        {hasValue ? (
          <>
            <Odometer
              value={numericValue}
              format={format}
              className={cn('text-lg font-semibold', valueClassName)}
            />
            {unit && (
              <span className={cn('text-xs text-muted-foreground', unitClassName)}>
                {unit}
              </span>
            )}
          </>
        ) : (
          <span className={cn('text-lg font-semibold text-muted-foreground', valueClassName)}>
            --
          </span>
        )}
      </div>
    </div>
  );
});

/**
 * HUD-style data readout with glow effect
 */
export const HUDReadout = memo(function HUDReadout({
  value,
  unit,
  label,
  format = (v) => v?.toLocaleString() ?? '--',
  variant = 'default', // default, success, warning, danger
  className,
}) {
  const numericValue = typeof value === 'number' ? value : 0;
  const hasValue = value !== null && value !== undefined;

  const variantClasses = {
    default: 'text-foreground',
    success: 'text-green-400 glow-success',
    warning: 'text-amber-400 glow-warning',
    danger: 'text-red-400 glow-danger',
    info: 'text-cyan-400',
  };

  return (
    <div className={cn('flex flex-col gap-0.5', className)}>
      {label && (
        <span className="text-[10px] text-muted-foreground uppercase tracking-widest hud-text">
          {label}
        </span>
      )}
      <div className="flex items-baseline gap-1">
        {hasValue ? (
          <>
            <Odometer
              value={numericValue}
              format={format}
              className={cn('text-xl font-bold hud-value', variantClasses[variant])}
            />
            {unit && (
              <span className="text-xs text-muted-foreground/70 hud-text">
                {unit}
              </span>
            )}
          </>
        ) : (
          <span className="text-xl font-bold text-muted-foreground/50 hud-value">
            ---
          </span>
        )}
      </div>
    </div>
  );
});

export default Odometer;
