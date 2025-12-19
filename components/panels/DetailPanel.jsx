'use client';

import { memo } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Crosshair,
  Copy,
  Share2,
  Plane,
  Navigation,
  Gauge,
  ArrowUpRight,
  Radio,
  Clock,
  MapPin,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { useAircraftStore } from '@/stores/aircraft-store';
import { useMapStore } from '@/stores/map-store';
import { useUIStore } from '@/stores/ui-store';
import { useAircraftPhoto } from '@/hooks/use-aircraft';
import { classifyAircraft, isEmergency, getDataSource } from '@/lib/classify';
import {
  formatAltitude,
  formatSpeed,
  formatVerticalRate,
  formatHeading,
  formatCoordinates,
  formatTimeSince,
  formatSquawk,
  formatCallsign,
  formatRegistration,
  formatAircraftType,
  formatHex,
  getCountryFromHex,
} from '@/lib/format';
import { AIRCRAFT_COLORS } from '@/lib/constants';

/**
 * Aircraft detail panel component
 */
export const DetailPanel = memo(function DetailPanel() {
  const { detailPanelOpen, closeDetailPanel } = useUIStore();
  const { getSelectedAircraft, followAircraft, followedAircraftId, unfollowAircraft, selectAircraft } = useAircraftStore();
  const { centerOnAircraft } = useMapStore();

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
      } else {
        followAircraft(aircraft.hex);
        centerOnAircraft(aircraft);
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

  return (
    <AnimatePresence mode="wait">
      {detailPanelOpen && aircraft && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="absolute right-0 top-0 z-[1001] h-full w-full max-w-md border-l border-border bg-card shadow-xl md:w-96"
        >
          <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border p-4">
              <div className="flex items-center gap-2">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: AIRCRAFT_COLORS[type] || AIRCRAFT_COLORS.unknown }}
                />
                <span className="font-semibold">
                  {formatCallsign(aircraft.flight) || formatHex(aircraft.hex)}
                </span>
                {emergency && (
                  <Badge variant="destructive" className="animate-pulse">
                    EMERGENCY
                  </Badge>
                )}
                {type === 'military' && !emergency && (
                  <Badge variant="destructive">MILITARY</Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClose}
                aria-label="Close panel"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <ScrollArea className="flex-1">
              <div className="p-4 space-y-4">
                {/* Aircraft Photo */}
                <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-secondary">
                  {photoLoading ? (
                    <Skeleton className="h-full w-full" />
                  ) : photo ? (
                    <>
                      <Image
                        src={photo.thumbnail_large?.src || photo.thumbnail?.src}
                        alt={`${aircraft.r || aircraft.hex}`}
                        fill
                        className="object-cover"
                        unoptimized
                      />
                      {photo.photographer && (
                        <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
                          Photo by: {photo.photographer}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <Plane className="h-12 w-12" />
                    </div>
                  )}
                </div>

                {/* Aircraft Info */}
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                    AIRCRAFT
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Type</span>
                      <span>{formatAircraftType(aircraft.t)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Registration</span>
                      <span>{formatRegistration(aircraft.r)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ICAO</span>
                      <span className="font-mono">{formatHex(aircraft.hex)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Country</span>
                      <span>{country?.flag} {country?.name}</span>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Flight Data */}
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                    FLIGHT DATA
                  </h3>
                  <div className="space-y-3">
                    {/* Altitude */}
                    <div className="flex items-center gap-3">
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="text-xs text-muted-foreground">Altitude</div>
                        <div className="font-medium">{formatAltitude(aircraft.alt_baro)}</div>
                      </div>
                    </div>

                    {/* Speed */}
                    <div className="flex items-center gap-3">
                      <Gauge className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="text-xs text-muted-foreground">Ground Speed</div>
                        <div className="font-medium">{formatSpeed(aircraft.gs)}</div>
                      </div>
                    </div>

                    {/* Heading */}
                    <div className="flex items-center gap-3">
                      <Navigation className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="text-xs text-muted-foreground">Heading</div>
                        <div className="font-medium">{formatHeading(aircraft.track)}</div>
                      </div>
                    </div>

                    {/* Vertical Rate */}
                    {aircraft.baro_rate !== undefined && (
                      <div className="flex items-center gap-3">
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                        <div className="flex-1">
                          <div className="text-xs text-muted-foreground">Vertical Rate</div>
                          <div className="font-medium">{formatVerticalRate(aircraft.baro_rate)}</div>
                        </div>
                      </div>
                    )}

                    {/* Squawk */}
                    <div className="flex items-center gap-3">
                      <Radio className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="text-xs text-muted-foreground">Squawk</div>
                        <div className="font-medium">{formatSquawk(aircraft.squawk)}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Position */}
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                    POSITION
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-3">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="font-mono text-xs">{coords?.lat}</div>
                        <div className="font-mono text-xs">{coords?.lon}</div>
                      </div>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Data Source */}
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                    DATA SOURCE
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Source</span>
                      <Badge variant="outline">{dataSource?.toUpperCase()}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Messages</span>
                      <span>{aircraft.messages?.toLocaleString() || 'N/A'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Last Seen</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTimeSince(aircraft.seen)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </ScrollArea>

            {/* Actions */}
            <div className="border-t border-border p-4">
              <div className="flex gap-2">
                <Button
                  variant={isFollowing ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={handleFollow}
                >
                  <Crosshair className="h-4 w-4 mr-2" />
                  {isFollowing ? 'Following' : 'Follow'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                >
                  <Share2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
