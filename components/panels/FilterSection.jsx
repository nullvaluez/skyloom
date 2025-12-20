'use client';

import { memo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Collapsible filter section component
 */
export const FilterSection = memo(function FilterSection({
  title,
  children,
  defaultOpen = true,
  className,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={cn('border-b border-border pb-4', className)}>
      <Button
        variant="ghost"
        className="w-full justify-between px-0 hover:bg-transparent"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="text-sm font-medium">{title}</span>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform',
            isOpen && 'rotate-180'
          )}
        />
      </Button>
      {isOpen && <div className="mt-3 space-y-2">{children}</div>}
    </div>
  );
});
