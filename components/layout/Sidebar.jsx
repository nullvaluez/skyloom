'use client';

import { memo, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useUIStore } from '@/stores/ui-store';
import { FilterPanel } from '@/components/panels/FilterPanel';

/**
 * Sidebar component for desktop filter panel
 * Hidden on mobile - uses MobileNav sheet instead
 */
export const Sidebar = memo(function Sidebar() {
  const { sidebarOpen, closeSidebar } = useUIStore();
  const [isDesktop, setIsDesktop] = useState(false);

  // Check viewport on mount and close sidebar if mobile
  useEffect(() => {
    const checkDesktop = () => {
      const desktop = window.matchMedia('(min-width: 768px)').matches;
      setIsDesktop(desktop);
      
      // Close sidebar on mobile to prevent it from showing
      if (!desktop) {
        closeSidebar();
      }
    };

    // Check on mount
    checkDesktop();

    // Listen for resize
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    mediaQuery.addEventListener('change', checkDesktop);

    return () => {
      mediaQuery.removeEventListener('change', checkDesktop);
    };
  }, [closeSidebar]);

  // Don't render on mobile - use MobileNav instead
  if (!isDesktop) {
    return null;
  }

  return (
    <AnimatePresence mode="wait">
      {sidebarOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 288, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="h-full border-r border-zinc-800 bg-zinc-950 overflow-hidden shrink-0"
        >
          <div className="flex h-full w-72 flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <h2 className="text-sm font-semibold">Filters</h2>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={closeSidebar}
                aria-label="Close sidebar"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Filter Content */}
            <ScrollArea className="flex-1">
              <div className="p-4">
                <FilterPanel />
              </div>
            </ScrollArea>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
});
