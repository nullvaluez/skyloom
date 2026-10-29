/**
 * LOUNGE MOBILE haptics (FLY_LOUNGE_MOBILE.md; the TOUCH stream owns this
 * file). haptic(kind) with kind one of 'tick' | 'select' | 'lock' | 'raise' |
 * 'lower' | 'detent'. Callable from anywhere (the GLASS stream's buttons
 * included); it must stay a silent no-op where navigator.vibrate is missing
 * (iOS Safari), on desktop, and under reduced motion.
 *
 * W0 stub: does nothing until the TOUCH stream implements it.
 */
export function haptic(kind) {}
