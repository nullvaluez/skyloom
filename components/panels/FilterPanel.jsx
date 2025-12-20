'use client';

import { memo, useState, useEffect } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { FilterSection } from './FilterSection';
import { useFilterStore } from '@/stores/filter-store';
import { AIRCRAFT_COLORS, DEFAULT_FILTERS } from '@/lib/constants';
import {
  Plane,
  Package,
  Shield,
  Helicopter,
  Building,
  Star,
  CircleHelp,
  RotateCcw,
} from 'lucide-react';

const AIRCRAFT_TYPES = [
  { key: 'commercial', label: 'Commercial', icon: Plane, color: AIRCRAFT_COLORS.commercial },
  { key: 'cargo', label: 'Cargo', icon: Package, color: AIRCRAFT_COLORS.cargo },
  { key: 'military', label: 'Military', icon: Shield, color: AIRCRAFT_COLORS.military },
  { key: 'private', label: 'Private', icon: Plane, color: AIRCRAFT_COLORS.private },
  { key: 'helicopter', label: 'Helicopter', icon: Helicopter, color: AIRCRAFT_COLORS.helicopter },
  { key: 'government', label: 'Government', icon: Building, color: AIRCRAFT_COLORS.government },
  { key: 'special', label: 'Special', icon: Star, color: AIRCRAFT_COLORS.special },
  { key: 'unknown', label: 'Unknown', icon: CircleHelp, color: AIRCRAFT_COLORS.unknown },
];

/**
 * Filter panel component
 */
export const FilterPanel = memo(function FilterPanel() {
  const [mounted, setMounted] = useState(false);
  const {
    filters,
    toggleType,
    setAltitudeRange,
    toggleAltitudeFilter,
    setSpeedRange,
    toggleSpeedFilter,
    toggleStatus,
    toggleDataSource,
    toggleSpecial,
    resetFilters,
    selectAllTypes,
    deselectAllTypes,
    getActiveFilterCount,
  } = useFilterStore();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Use default filters for initial render to avoid hydration mismatch
  const displayFilters = mounted ? filters : DEFAULT_FILTERS;
  const activeCount = mounted ? getActiveFilterCount() : 0;

  return (
    <div className="space-y-4">
      {/* Aircraft Types */}
      <FilterSection title="Aircraft Type">
        <div className="flex gap-2 mb-3">
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={selectAllTypes}
          >
            All
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={deselectAllTypes}
          >
            None
          </Button>
        </div>
        <div className="space-y-2">
          {AIRCRAFT_TYPES.map(({ key, label, icon: Icon, color }) => (
            <label
              key={key}
              className="flex items-center gap-3 cursor-pointer group"
            >
              <Checkbox
                checked={displayFilters.types[key]}
                onCheckedChange={() => toggleType(key)}
              />
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: color }}
              />
              <Icon className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
      </FilterSection>

      {/* Altitude Range */}
      <FilterSection title="Altitude">
        <label className="flex items-center gap-3 cursor-pointer mb-3">
          <Checkbox
            checked={displayFilters.altitude.enabled}
            onCheckedChange={toggleAltitudeFilter}
          />
          <span className="text-sm">Enable altitude filter</span>
        </label>
        {displayFilters.altitude.enabled && (
          <div className="space-y-3">
            <Slider
              value={[displayFilters.altitude.min, displayFilters.altitude.max]}
              min={0}
              max={60000}
              step={1000}
              onValueChange={([min, max]) => setAltitudeRange(min, max)}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{displayFilters.altitude.min.toLocaleString()} ft</span>
              <span>{displayFilters.altitude.max.toLocaleString()} ft</span>
            </div>
          </div>
        )}
      </FilterSection>

      {/* Speed Range */}
      <FilterSection title="Speed">
        <label className="flex items-center gap-3 cursor-pointer mb-3">
          <Checkbox
            checked={displayFilters.speed.enabled}
            onCheckedChange={toggleSpeedFilter}
          />
          <span className="text-sm">Enable speed filter</span>
        </label>
        {displayFilters.speed.enabled && (
          <div className="space-y-3">
            <Slider
              value={[displayFilters.speed.min, displayFilters.speed.max]}
              min={0}
              max={700}
              step={50}
              onValueChange={([min, max]) => setSpeedRange(min, max)}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{displayFilters.speed.min} kts</span>
              <span>{displayFilters.speed.max} kts</span>
            </div>
          </div>
        )}
      </FilterSection>

      {/* Status */}
      <FilterSection title="Status">
        <div className="space-y-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox
              checked={displayFilters.status.airborne}
              onCheckedChange={() => toggleStatus('airborne')}
            />
            <span className="text-sm">Airborne</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox
              checked={displayFilters.status.onGround}
              onCheckedChange={() => toggleStatus('onGround')}
            />
            <span className="text-sm">On Ground</span>
          </label>
        </div>
      </FilterSection>

      {/* Data Source */}
      <FilterSection title="Data Source">
        <div className="space-y-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox
              checked={displayFilters.dataSource.adsb}
              onCheckedChange={() => toggleDataSource('adsb')}
            />
            <span className="text-sm">ADS-B</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox
              checked={displayFilters.dataSource.mlat}
              onCheckedChange={() => toggleDataSource('mlat')}
            />
            <span className="text-sm">MLAT</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox
              checked={displayFilters.dataSource.tisb}
              onCheckedChange={() => toggleDataSource('tisb')}
            />
            <span className="text-sm">TIS-B</span>
          </label>
        </div>
      </FilterSection>

      {/* Special Filters */}
      <FilterSection title="Special">
        <div className="space-y-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox
              checked={displayFilters.special.military}
              onCheckedChange={() => toggleSpecial('military')}
            />
            <span className="text-sm">Military Only</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <Checkbox
              checked={displayFilters.special.interesting}
              onCheckedChange={() => toggleSpecial('interesting')}
            />
            <span className="text-sm">Interesting</span>
          </label>
        </div>
      </FilterSection>

      <Separator />

      {/* Reset Button */}
      <div className="flex items-center justify-between">
        {activeCount > 0 && (
          <Badge variant="secondary">
            {activeCount} active filter{activeCount !== 1 ? 's' : ''}
          </Badge>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={resetFilters}
          className="ml-auto"
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset
        </Button>
      </div>
    </div>
  );
});
