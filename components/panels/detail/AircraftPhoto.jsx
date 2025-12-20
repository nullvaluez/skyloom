'use client';

import { memo } from 'react';
import Image from 'next/image';
import { Plane } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export const AircraftPhoto = memo(function AircraftPhoto({ aircraft, photo, loading }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-secondary">
      {loading ? (
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
  );
});
