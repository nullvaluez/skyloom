/**
 * SHIP PASS (FLY_SHIP_PASS.md RL-6, section 6) — the one product-analytics
 * entry point. RELEASE owns this file.
 *
 * FROZEN API (W0; a change is a contract change recorded in section 6):
 *   track(event, props?) → void   never throws, never blocks; the sanitizer
 *                                 (RL-6) drops unknown events and fields, and
 *                                 nothing leaves the device without consent.
 *
 * W0 STUB: a no-op, so any stream may call track() from day one.
 */
export function track(event, props) {}
