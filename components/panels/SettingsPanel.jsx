'use client';

import { memo } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useDevStore } from '@/stores/dev-store';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export const SettingsPanel = memo(function SettingsPanel() {
  const { settingsOpen, closeSettings } = useUIStore();
  const { showHUD, toggleHUD } = useDevStore();

  return (
    <Sheet open={settingsOpen} onOpenChange={closeSettings}>
      <SheetContent side="right" className="w-80">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>Settings</SheetTitle>
        </SheetHeader>
        
        <div className="py-6 space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-medium">Map Display</h3>
            <div className="flex items-center justify-between">
              <Label htmlFor="show-labels" className="text-sm">Aircraft Labels</Label>
              <div className="text-xs text-muted-foreground italic">Adaptive</div>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h3 className="text-sm font-medium">Developer</h3>
            <div className="flex items-center justify-between">
              <Label htmlFor="show-hud" className="text-sm cursor-pointer">Performance HUD</Label>
              <Switch 
                id="show-hud"
                checked={showHUD} 
                onCheckedChange={toggleHUD}
              />
            </div>
          </div>

          <div className="pt-10 text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">SkyTracker 2026 v0.1.0</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
});
