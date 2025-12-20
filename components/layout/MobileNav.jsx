'use client';

import { memo } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useUIStore } from '@/stores/ui-store';
import { FilterPanel } from '@/components/panels/FilterPanel';

/**
 * Mobile navigation sheet for filters
 */
export const MobileNav = memo(function MobileNav() {
  const { mobileFiltersOpen, closeMobileFilters } = useUIStore();

  return (
    <Sheet open={mobileFiltersOpen} onOpenChange={closeMobileFilters}>
      <SheetContent side="left" className="w-80 p-0 bg-zinc-950">
        <SheetHeader className="border-b border-zinc-800 p-4 bg-zinc-950">
          <SheetTitle className="text-zinc-100">Filters</SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-60px)] bg-zinc-950">
          <div className="p-4">
            <FilterPanel />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
});
