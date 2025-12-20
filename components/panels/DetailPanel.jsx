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
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
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
 * Detail panel content - shared between mobile and desktop views
 */
const DetailPanelContent = memo(function DetailPanelContent({
  aircraft,
  photo,
  photoLoading,
  type,
  emergency,
  dataSource,
  country,
  coords,
  isFollowing,
  onFollow,
  onCopy,
}) {
  return (
    <>
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

      {/* Actions */}
      <div className="border-t border-border p-4 sticky bottom-0 bg-card">
        <div className="flex gap-2">
          <Button
            variant={isFollowing ? 'default' : 'outline'}
            size="default"
            className="flex-1 h-11"
            onClick={onFollow}
          >
            <Crosshair className="h-4 w-4 mr-2" />
            {isFollowing ? 'Following' : 'Follow'}
          </Button>
          <Button
            variant="outline"
            size="default"
            className="h-11 w-11"
            onClick={onCopy}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="default"
            className="h-11 w-11"
          >
            <Share2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  );
});

/**
 * Aircraft detail panel component
 * Uses Sheet on mobile for better touch UX, slide panel on desktop
 */
export const DetailPanel = memo(function DetailPanel() {
  const { detailPanelOpen, closeDetailPanel } = useUIStore();
  const { getSelectedAircraft, followAircraft, followedAircraftId, unfollowAircraft, selectAircraft } = useAircraftStore();
  const { centerOnAircraft } = useMapStore();
  const isMobile = useIsMobile();

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

  // No aircraft selected
  if (!aircraft) {
    return null;
  }

  // Mobile: Use Sheet for better touch experience
  if (isMobile) {
    return (
      <Sheet open={detailPanelOpen} onOpenChange={(open) => !open && handleClose()}>
        <SheetContent side="bottom" className="h-[80dvh] max-h-[80dvh] p-0 rounded-t-xl flex flex-col">
          {/* Drag indicator */}
          <div className="flex justify-center py-2 shrink-0">
            <div className="h-1 w-12 rounded-full bg-muted-foreground/30" />
          </div>
          
          <SheetHeader className="border-b border-border px-4 pb-3 shrink-0">
            <SheetTitle className="flex items-center gap-2 text-left">
              <div
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: AIRCRAFT_COLORS[type] || AIRCRAFT_COLORS.unknown }}
              />
              <span className="truncate">
                {formatCallsign(aircraft.flight) || formatHex(aircraft.hex)}
              </span>
              {emergency && (
                <Badge variant="destructive" className="animate-pulse shrink-0">
                  EMERGENCY
                </Badge>
              )}
              {type === 'military' && !emergency && (
                <Badge variant="destructive" className="shrink-0">MILITARY</Badge>
              )}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <ScrollArea className="flex-1 min-h-0">
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
                  <h3 className="mb-2 text-sm font-semibold text-muted-foreground">AIRCRAFT</h3>
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
                  <h3 className="mb-2 text-sm font-semibold text-muted-foreground">FLIGHT DATA</h3>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="text-xs text-muted-foreground">Altitude</div>
                        <div className="font-medium">{formatAltitude(aircraft.alt_baro)}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Gauge className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="text-xs text-muted-foreground">Ground Speed</div>
                        <div className="font-medium">{formatSpeed(aircraft.gs)}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Navigation className="h-4 w-4 text-muted-foreground" />
                      <div className="flex-1">
                        <div className="text-xs text-muted-foreground">Heading</div>
                        <div className="font-medium">{formatHeading(aircraft.track)}</div>
                      </div>
                    </div>
                    {aircraft.baro_rate !== undefined && (
                      <div className="flex items-center gap-3">
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                        <div className="flex-1">
                          <div className="text-xs text-muted-foreground">Vertical Rate</div>
                          <div className="font-medium">{formatVerticalRate(aircraft.baro_rate)}</div>
                        </div>
                      </div>
                    )}
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
                  <h3 className="mb-2 text-sm font-semibold text-muted-foreground">POSITION</h3>
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
                <div className="pb-4">
                  <h3 className="mb-2 text-sm font-semibold text-muted-foreground">DATA SOURCE</h3>
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
            
            {/* Actions - fixed at bottom */}
            <div className="border-t border-border p-4 shrink-0 bg-card">
              <div className="flex gap-2">
                <Button
                  variant={isFollowing ? 'default' : 'outline'}
                  size="default"
                  className="flex-1 h-11"
                  onClick={handleFollow}
                >
                  <Crosshair className="h-4 w-4 mr-2" />
                  {isFollowing ? 'Following' : 'Follow'}
                </Button>
                <Button
                  variant="outline"
                  size="default"
                  className="h-11 w-11"
                  onClick={handleCopy}
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="default"
                  className="h-11 w-11"
                >
                  <Share2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: Use slide panel
  return (
    <AnimatePresence mode="wait">
      {detailPanelOpen && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="absolute right-0 top-0 z-1001 h-full w-96 border-l border-border bg-card shadow-xl"
        >
          <div className="flex h-full flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border p-4">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ backgroundColor: AIRCRAFT_COLORS[type] || AIRCRAFT_COLORS.unknown }}
                />
                <span className="font-semibold truncate">
                  {formatCallsign(aircraft.flight) || formatHex(aircraft.hex)}
                </span>
                {emergency && (
                  <Badge variant="destructive" className="animate-pulse shrink-0">
                    EMERGENCY
                  </Badge>
                )}
                {type === 'military' && !emergency && (
                  <Badge variant="destructive" className="shrink-0">MILITARY</Badge>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClose}
                aria-label="Close panel"
                className="shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <ScrollArea className="flex-1">
              <DetailPanelContent
                aircraft={aircraft}
                photo={photo}
                photoLoading={photoLoading}
                type={type}
                emergency={emergency}
                dataSource={dataSource}
                country={country}
                coords={coords}
                isFollowing={isFollowing}
                onFollow={handleFollow}
                onCopy={handleCopy}
              />
            </ScrollArea>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
