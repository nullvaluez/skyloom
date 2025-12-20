'use client';

import { memo, useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Plane, Search, SlidersHorizontal, Settings, X, ArrowLeft } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import { useFilterStore } from '@/stores/filter-store';
import { useIsMobile } from '@/hooks/use-media-query';
import { Badge } from '@/components/ui/badge';

/**
 * Application header component
 */
export const Header = memo(function Header() {
  const [mounted, setMounted] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const mobileSearchRef = useRef(null);
  const { toggleSidebar, toggleMobileFilters, toggleSettings, sidebarOpen } = useUIStore();
  const { filters, setSearch, clearSearch, getActiveFilterCount } = useFilterStore();
  const isMobile = useIsMobile();

  // Handle hydration mismatch by only showing dynamic content after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Focus mobile search input when opened
  useEffect(() => {
    if (mobileSearchOpen && mobileSearchRef.current) {
      mobileSearchRef.current.focus();
    }
  }, [mobileSearchOpen]);

  const activeFilterCount = mounted ? getActiveFilterCount() : 0;

  const handleSearchChange = (e) => {
    setSearch(e.target.value, filters.search.field);
  };

  const handleClearSearch = () => {
    clearSearch();
  };

  const handleFilterClick = () => {
    if (isMobile) {
      toggleMobileFilters();
    } else {
      toggleSidebar();
    }
  };

  const handleMobileSearchToggle = () => {
    setMobileSearchOpen(!mobileSearchOpen);
  };

  const handleMobileSearchClose = () => {
    setMobileSearchOpen(false);
  };

  // Mobile search expanded view
  if (mobileSearchOpen && mounted) {
    return (
      <header className="flex h-14 items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-4 md:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleMobileSearchClose}
          aria-label="Close search"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={mobileSearchRef}
            type="text"
            placeholder="Search callsign, registration, type..."
            value={filters.search.query}
            onChange={handleSearchChange}
            className="h-9 w-full pl-9 pr-9 bg-secondary border-border"
          />
          {filters.search.query && (
            <button
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>
    );
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4">
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <Plane className="h-5 w-5 text-primary-foreground" />
        </div>
        <span className="text-lg font-semibold tracking-tight">SkyTracker</span>
      </div>

      {/* Search Bar - Desktop */}
      <div className="mx-4 hidden flex-1 max-w-md md:flex">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search callsign, registration, type..."
            value={filters.search.query}
            onChange={handleSearchChange}
            className="h-9 w-full pl-9 pr-9 bg-secondary border-border"
          />
          {filters.search.query && (
            <button
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Mobile Search Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={filters.search.query ? 'secondary' : 'ghost'}
              size="icon"
              className="md:hidden relative"
              onClick={handleMobileSearchToggle}
              aria-label="Search"
            >
              <Search className="h-5 w-5" />
              {filters.search.query && (
                <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search</TooltipContent>
        </Tooltip>

        {/* Filter Toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={mounted && sidebarOpen && !isMobile ? 'secondary' : 'ghost'}
              size="icon"
              onClick={handleFilterClick}
              className="relative"
              aria-label="Toggle filters"
            >
              <SlidersHorizontal className="h-5 w-5" />
              {mounted && activeFilterCount > 0 && (
                <Badge
                  variant="destructive"
                  className="absolute -right-1 -top-1 h-5 w-5 p-0 text-xs flex items-center justify-center"
                >
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Filters</TooltipContent>
        </Tooltip>

        {/* Settings */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSettings}
              aria-label="Settings"
            >
              <Settings className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
});
