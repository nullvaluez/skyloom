'use client';

import { memo } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useDevStore } from '@/stores/dev-store';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Camera, Smartphone } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export const SettingsPanel = memo(function SettingsPanel() {
  const { settingsOpen, closeSettings, openARMode } = useUIStore();
  const { showHUD, toggleHUD } = useDevStore();

  const handleARMode = () => {
    closeSettings();
    openARMode();
  };

  return (
    <Sheet open={settingsOpen} onOpenChange={closeSettings}>
      <SheetContent side="right" className="w-80 bg-zinc-950 border-l border-zinc-800">
        <SheetHeader className="border-b border-zinc-800 pb-4">
          <SheetTitle className="text-zinc-100">Settings</SheetTitle>
        </SheetHeader>
        
        <div className="py-6 space-y-6">
          {/* AR Mode Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-zinc-100">Features</h3>
            <Button 
              variant="outline" 
              className="w-full justify-start gap-2 bg-zinc-900 border-zinc-700 text-zinc-100 hover:bg-zinc-800"
              onClick={handleARMode}
            >
              <Camera className="h-4 w-4" />
              <span>AR Spotter Mode</span>
              <Smartphone className="h-3 w-3 ml-auto text-zinc-500" />
            </Button>
            <p className="text-xs text-zinc-500">Point your phone at the sky to see aircraft labels overlaid on camera</p>
          </div>

          <Separator className="bg-zinc-800" />

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-zinc-100">Map Display</h3>
            <div className="flex items-center justify-between">
              <Label htmlFor="show-labels" className="text-sm text-zinc-300">Aircraft Labels</Label>
              <div className="text-xs text-zinc-500 italic">Adaptive</div>
            </div>
          </div>

          <Separator className="bg-zinc-800" />

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-zinc-100">Developer</h3>
            <div className="flex items-center justify-between">
              <Label htmlFor="show-hud" className="text-sm cursor-pointer text-zinc-300">Performance HUD</Label>
              <Switch 
                id="show-hud"
                checked={showHUD} 
                onCheckedChange={toggleHUD}
              />
            </div>
          </div>

          <div className="pt-10 text-center">
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest">SkyTracker 2026 v0.1.0</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
});
