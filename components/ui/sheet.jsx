"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Sheet({
  ...props
}) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({
  ...props
}) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
  ...props
}) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({
  ...props
}) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-[1099] bg-black/60",
        className
      )}
      {...props} />
  );
}

/**
 * Hook to handle swipe-to-close gesture for bottom sheets
 */
function useSwipeToClose(onClose, { enabled = true, threshold = 100 } = {}) {
  const [dragState, setDragState] = React.useState({
    isDragging: false,
    startY: 0,
    currentY: 0,
  });
  
  const dragOffset = dragState.isDragging 
    ? Math.max(0, dragState.currentY - dragState.startY) 
    : 0;

  const handleTouchStart = React.useCallback((e) => {
    if (!enabled) return;
    const touch = e.touches[0];
    setDragState({
      isDragging: true,
      startY: touch.clientY,
      currentY: touch.clientY,
    });
  }, [enabled]);

  const handleTouchMove = React.useCallback((e) => {
    if (!dragState.isDragging) return;
    const touch = e.touches[0];
    setDragState((prev) => ({
      ...prev,
      currentY: touch.clientY,
    }));
  }, [dragState.isDragging]);

  const handleTouchEnd = React.useCallback(() => {
    if (!dragState.isDragging) return;
    
    const dragDistance = dragState.currentY - dragState.startY;
    
    if (dragDistance > threshold) {
      onClose?.();
    }
    
    setDragState({
      isDragging: false,
      startY: 0,
      currentY: 0,
    });
  }, [dragState, threshold, onClose]);

  return {
    dragOffset,
    isDragging: dragState.isDragging,
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
    },
  };
}

function SheetContent({
  className,
  children,
  side = "right",
  showClose = true,
  onSwipeClose,
  ...props
}) {
  const isBottomSheet = side === "bottom";
  const { dragOffset, isDragging, handlers } = useSwipeToClose(onSwipeClose, {
    enabled: isBottomSheet && !!onSwipeClose,
    threshold: 100,
  });

  return (
    <SheetPortal>
      <SheetOverlay 
        style={isBottomSheet && isDragging ? { 
          opacity: Math.max(0, 1 - dragOffset / 300) 
        } : undefined}
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "bg-zinc-950 text-zinc-100 data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-[1100] flex flex-col shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
          side === "right" &&
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l border-zinc-800 sm:max-w-sm",
          side === "left" &&
            "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r border-zinc-800 sm:max-w-sm",
          side === "top" &&
            "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b border-zinc-800",
          side === "bottom" &&
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t border-zinc-800",
          // Disable transition during drag for responsive feel
          isDragging && "transition-none",
          className
        )}
        style={isBottomSheet && dragOffset > 0 ? {
          transform: `translateY(${dragOffset}px)`,
        } : undefined}
        {...props}>
        {/* Swipe handle for bottom sheets */}
        {isBottomSheet && onSwipeClose && (
          <div
            className="flex justify-center py-3 cursor-grab active:cursor-grabbing touch-none"
            {...handlers}
          >
            <div className="h-1.5 w-12 rounded-full bg-zinc-600 transition-colors hover:bg-zinc-500" />
          </div>
        )}
        {children}
        {showClose && (
          <SheetPrimitive.Close
            className="ring-offset-zinc-950 focus:ring-zinc-400 data-[state=open]:bg-zinc-800 absolute top-4 right-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none text-zinc-400 hover:text-zinc-100">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({
  className,
  ...props
}) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props} />
  );
}

function SheetFooter({
  className,
  ...props
}) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props} />
  );
}

function SheetTitle({
  className,
  ...props
}) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-foreground font-semibold", className)}
      {...props} />
  );
}

function SheetDescription({
  className,
  ...props
}) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props} />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
