'use client';

import dynamic from 'next/dynamic';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { StatsBar } from '@/components/layout/StatsBar';
import { DetailPanel } from '@/components/panels/DetailPanel';
import { MobileNav } from '@/components/layout/MobileNav';
import { SettingsPanel } from '@/components/panels/SettingsPanel';
import { MapErrorBoundary } from '@/components/ErrorBoundary';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { PerformanceHUD } from '@/components/dev/PerformanceHUD';

// Dynamically import the map to avoid SSR issues with Leaflet
const FlightMap = dynamic(
  () => import('@/components/map/FlightMap').then((mod) => mod.FlightMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Loading map...</p>
        </div>
      </div>
    ),
  }
);

export default function Home() {
  // Initialize keyboard shortcuts
  useKeyboardShortcuts();

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <Header />

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar (Desktop) */}
        <Sidebar />

        {/* Map Area */}
        <main className="relative flex-1 overflow-hidden">
          <MapErrorBoundary>
            <FlightMap />
          </MapErrorBoundary>

          {/* Detail Panel */}
          <DetailPanel />
        </main>
      </div>

      {/* Stats Bar */}
      <StatsBar />

      {/* Mobile Navigation */}
      <MobileNav />

      {/* Settings Panel */}
      <SettingsPanel />

      {/* Performance HUD */}
      <PerformanceHUD />
    </div>
  );
}
