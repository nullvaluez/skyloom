'use client';

import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { useAircraftStore } from '@/stores/aircraft-store';
import { useMapStore } from '@/stores/map-store';
import { useUIStore } from '@/stores/ui-store';
import { useAircraftPhoto } from '@/hooks/use-aircraft';
import { useIsMobile } from '@/hooks/use-media-query';
import { useShare } from '@/hooks/use-share';
import { useHaptics } from '@/hooks/use-haptics';
import { classifyAircraft, isEmergency, getDataSource } from '@/lib/classify';
import {
  formatAltitude,
  formatSpeed,
  formatHeading,
  formatCoordinates,
  formatCallsign,
  formatRegistration,
  formatAircraftType,
  formatHex,
  getCountryFromHex,
} from '@/lib/format';
import { AIRCRAFT_COLORS } from '@/lib/constants';

// Sub-components
import { AircraftPhoto } from './detail/AircraftPhoto';
import { AircraftInfo } from './detail/AircraftInfo';
import { FlightData } from './detail/FlightData';
import { DataSourceInfo } from './detail/DataSourceInfo';
import { ActionButtons } from './detail/ActionButtons';

/**
 * Detail panel content - shared between mobile and desktop views
 */
const DetailPanelContent = memo(function DetailPanelContent({
  aircraft,
  photo,
  photoLoading,
  country,
  coords,
  dataSource,
  isFollowing,
  onFollow,
  onCopy,
  onShare,
  showActions = true,
}) {
  return (
    <div className="flex flex-col">
      <div className="p-4 space-y-6">
        <AircraftPhoto 
          aircraft={aircraft} 
          photo={photo} 
          loading={photoLoading} 
        />

        <AircraftInfo 
          aircraft={aircraft} 
          country={country} 
        />

        <Separator />

        <FlightData aircraft={aircraft} />

        <Separator />

        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Position
          </h3>
          <div className="flex items-center gap-3 text-sm">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <div className="font-mono text-xs">
              {coords?.lat}, {coords?.lon}
            </div>
          </div>
        </div>

        <Separator />

        <DataSourceInfo 
          aircraft={aircraft} 
          dataSource={dataSource} 
        />
      </div>

      {showActions && (
        <div className="border-t border-zinc-800 p-4 mt-auto bg-zinc-950">
          <ActionButtons
            isFollowing={isFollowing}
            onFollow={onFollow}
            onCopy={onCopy}
            onShare={onShare}
          />
        </div>
      )}
    </div>
  );
});

export const DetailPanel = memo(function DetailPanel() {
  const detailPanelOpen = useUIStore((s) => s.detailPanelOpen);
  const closeDetailPanel = useUIStore((s) => s.closeDetailPanel);
  const getSelectedAircraft = useAircraftStore((s) => s.getSelectedAircraft);
  const followAircraft = useAircraftStore((s) => s.followAircraft);
  const followedAircraftId = useAircraftStore((s) => s.followedAircraftId);
  const unfollowAircraft = useAircraftStore((s) => s.unfollowAircraft);
  const selectAircraft = useAircraftStore((s) => s.selectAircraft);
  const enable3DFollow = useMapStore((s) => s.enable3DFollow);
  const isMobile = useIsMobile();
  const { shareNative } = useShare();
  const { onSelect, onFollow: hapticFollow } = useHaptics();

  const aircraft = getSelectedAircraft();
  const { data: photo, isLoading: photoLoading } = useAircraftPhoto(aircraft?.hex);

  const type = aircraft ? classifyAircraft(aircraft) : null;
  const emergency = aircraft ? isEmergency(aircraft) : false;
  const dataSource = aircraft ? getDataSource(aircraft) : null;
  const country = aircraft ? getCountryFromHex(aircraft.hex) : null;
  const coords = aircraft ? formatCoordinates(aircraft.lat, aircraft.lon) : null;
  const isFollowing = aircraft && followedAircraftId === aircraft.hex;

  const handleFollow = () => {
    if (aircraft) {
      if (isFollowing) {
        unfollowAircraft();
        // Stay in current 3D mode - just stop tracking the aircraft
        // User can still see 3D trails and manually control the view
        onSelect(); // Light haptic for unfollow
      } else {
        followAircraft(aircraft.hex);
        // Enable 3D follow mode with tilted camera
        enable3DFollow(aircraft);
        hapticFollow(); // Distinctive haptic pattern for follow
        // Close sheet on mobile so user can see the map while following
        if (isMobile) {
          closeDetailPanel();
        }
      }
    }
  };

  const handleCopy = () => {
    if (aircraft) {
      const info = [
        `Callsign: ${formatCallsign(aircraft.flight)}`,
        `Registration: ${formatRegistration(aircraft.r)}`,
        `Type: ${formatAircraftType(aircraft.t)}`,
        `ICAO: ${formatHex(aircraft.hex)}`,
        `Altitude: ${formatAltitude(aircraft.alt_baro)}`,
        `Speed: ${formatSpeed(aircraft.gs)}`,
        `Heading: ${formatHeading(aircraft.track)}`,
      ].join('\n');

      navigator.clipboard.writeText(info);
    }
  };

  const handleClose = () => {
    closeDetailPanel();
    selectAircraft(null);
  };

  if (!aircraft) return null;

  const headerTitle = (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className="h-3 w-3 rounded-full shrink-0"
        style={{ backgroundColor: AIRCRAFT_COLORS[type] || AIRCRAFT_COLORS.unknown }}
      />
      <span className="font-semibold truncate">
        {formatCallsign(aircraft.flight) || formatHex(aircraft.hex)}
      </span>
      {emergency && (
        <Badge variant="destructive" className="animate-pulse shrink-0 text-[10px] h-5">
          EMERGENCY
        </Badge>
      )}
      {type === 'military' && !emergency && (
        <Badge variant="destructive" className="shrink-0 text-[10px] h-5">MILITARY</Badge>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={detailPanelOpen} onOpenChange={(open) => !open && handleClose()}>
        <SheetContent 
          side="bottom" 
          showClose={false}
          onSwipeClose={handleClose}
          className="h-[80dvh] max-h-[80dvh] p-0 pt-0 rounded-t-xl flex flex-col overflow-hidden bg-zinc-950 border-t border-zinc-800"
        >
          <SheetHeader className="border-b border-zinc-800 px-4 pb-3 pt-0 shrink-0 bg-zinc-950">
            <SheetTitle className="text-left text-zinc-100">{headerTitle}</SheetTitle>
          </SheetHeader>

          <ScrollArea className="flex-1 min-h-0 bg-zinc-950">
            <DetailPanelContent
              aircraft={aircraft}
              photo={photo}
              photoLoading={photoLoading}
              country={country}
              coords={coords}
              dataSource={dataSource}
              isFollowing={isFollowing}
              onFollow={handleFollow}
              onCopy={handleCopy}
              onShare={shareNative}
              showActions={false}
            />
          </ScrollArea>
          
          {/* Fixed action buttons at bottom for mobile */}
          <div className="border-t border-zinc-800 p-4 shrink-0 bg-zinc-950">
            <ActionButtons
              isFollowing={isFollowing}
              onFollow={handleFollow}
              onCopy={handleCopy}
              onShare={shareNative}
            />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <AnimatePresence mode="wait">
      {detailPanelOpen && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="absolute right-0 top-0 z-[1001] h-full w-96 bg-zinc-950 border-l border-zinc-800 shadow-2xl"
        >
          <div className="flex h-full flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-zinc-800 p-4 shrink-0 bg-zinc-950">
              {headerTitle}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClose}
                aria-label="Close panel"
                className="shrink-0 h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <ScrollArea className="flex-1 bg-zinc-950">
              <DetailPanelContent
                aircraft={aircraft}
                photo={photo}
                photoLoading={photoLoading}
                country={country}
                coords={coords}
                dataSource={dataSource}
                isFollowing={isFollowing}
                onFollow={handleFollow}
                onCopy={handleCopy}
                onShare={shareNative}
              />
            </ScrollArea>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
