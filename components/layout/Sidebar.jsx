'use client';

import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useUIStore } from '@/stores/ui-store';
import { FilterPanel } from '@/components/panels/FilterPanel';

/**
 * Sidebar component for desktop filter panel
 */
export const Sidebar = memo(function Sidebar() {
  const { sidebarOpen, closeSidebar } = useUIStore();

  return (
    <AnimatePresence mode="wait">
      {sidebarOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 288, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="h-full border-r border-border bg-card overflow-hidden flex-shrink-0"
        >
          <div className="flex h-full w-72 flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
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
