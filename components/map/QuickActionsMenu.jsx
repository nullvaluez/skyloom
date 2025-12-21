'use client';

import { memo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Crosshair, 
  MapPin, 
  Share2, 
  Copy, 
  Star, 
  Navigation,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCallsign, formatAltitude } from '@/lib/format';

/**
 * Quick Actions Menu - appears on long-press of aircraft
 * Provides fast access to common actions
 */
export const QuickActionsMenu = memo(function QuickActionsMenu({
  aircraft,
  position,
  onClose,
  onFollow,
  onCenterMap,
  onShare,
  onCopy,
  onSpot,
}) {
  if (!aircraft || !position) return null;

  const handleAction = useCallback((action) => {
    action?.();
    onClose?.();
  }, [onClose]);

  const actions = [
    {
      icon: Crosshair,
      label: 'Follow',
      color: 'text-blue-400',
      action: onFollow,
    },
    {
      icon: MapPin,
      label: 'Center',
      color: 'text-green-400',
      action: onCenterMap,
    },
    {
      icon: Share2,
      label: 'Share',
      color: 'text-purple-400',
      action: onShare,
    },
    {
      icon: Copy,
      label: 'Copy',
      color: 'text-amber-400',
      action: onCopy,
    },
    {
      icon: Star,
      label: 'Spot',
      color: 'text-cyan-400',
      action: onSpot,
    },
  ];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className="fixed z-[2000]"
        style={{
          left: position.x,
          top: position.y,
          transform: 'translate(-50%, -100%)',
        }}
      >
        {/* Backdrop to catch outside clicks */}
        <div 
          className="fixed inset-0 z-[-1]" 
          onClick={onClose}
        />
        
        <div className="glass-panel-heavy p-3 min-w-[180px]">
          {/* Aircraft header */}
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-border/30">
            <div>
              <div className="font-semibold text-sm">
                {formatCallsign(aircraft.flight) || aircraft.hex}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatAltitude(aircraft.alt_baro)} • {Math.round(aircraft.gs || 0)} kts
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onClose}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          
          {/* Action buttons grid */}
          <div className="grid grid-cols-5 gap-1">
            {actions.map(({ icon: Icon, label, color, action }) => (
              <button
                key={label}
                onClick={() => handleAction(action)}
                className="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-background/50 active:scale-95 transition-transform"
              >
                <Icon className={`h-5 w-5 ${color}`} />
                <span className="text-[9px] text-muted-foreground">{label}</span>
              </button>
            ))}
          </div>
        </div>
        
        {/* Pointer arrow */}
        <div 
          className="absolute left-1/2 -translate-x-1/2 -bottom-2 w-0 h-0 
            border-l-[8px] border-l-transparent 
            border-r-[8px] border-r-transparent 
            border-t-[8px] border-t-zinc-900"
        />
      </motion.div>
    </AnimatePresence>
  );
});

