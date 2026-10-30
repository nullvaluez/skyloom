/**
 * SHIP PASS (FLY_SHIP_PASS.md RL-6, D3, section 6) — the one product-analytics
 * entry point. RELEASE owns this file.
 *
 * FROZEN API (W0; a change is a contract change recorded in section 6):
 *   track(event, props?) → void   never throws, never blocks; the sanitizer
 *                                 drops unknown events and fields, and
 *                                 nothing leaves the device without consent.
 *
 * ANALYTICS_V2 (lib/fly/ship-pass.js). With the flag OFF, track() is the W0
 * no-op and lib/fly/adventure-analytics.js keeps its pre-pass path exactly.
 * With it ON:
 *   - EXPLICIT SCHEMA: SCHEMA below names every event and, per field, the only
 *     values it may carry — enums, booleans, bounded numbers, or a short token
 *     pattern. No free text, no location, no aircraft identity, no screenshots.
 *     Unknown events are dropped; unknown or invalid fields are dropped.
 *   - CONSENT: one choice, `fly-analytics-consent` ('yes' / 'no'; absent =
 *     never asked), the key the adventure checkbox already used. Error
 *     telemetry (`client_error`) rides the same consent. Without 'yes', track()
 *     returns before any import or request: posthog-js is never even loaded
 *     (scripts/verify-ship-release.mjs proves the order; the browser check
 *     intercepts every request).
 *   - TRANSPORT: the existing posthog-js integration (no new provider), keyed by
 *     NEXT_PUBLIC_POSTHOG_KEY / NEXT_PUBLIC_POSTHOG_HOST, with autocapture,
 *     page views, session recording, surveys, feature flags, person profiles
 *     and GeoIP off, and `before_send` re-sanitizing every outgoing event.
 */
import { shipPassOn } from './ship-pass';

export const CONSENT_KEY = 'fly-analytics-consent';

const MODES = ['title', 'hangar', 'free', 'journey', 'watch', 'ops'];
const PRESETS = ['low', 'medium', 'high', 'ultra'];
const DEVICE_CLASSES = ['phone', 'tablet', 'igpu', 'dgpu', 'software'];
const LINK_KINDS = ['watch', 'fly', 'at', 'journey'];
const TOKEN = /^[a-z0-9._<>=+-]{1,24}$/i;

const oneOf = (list) => (v) => (list.includes(v) ? v : undefined);
const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const num = (min, max, step = 1) => (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Number((Math.round(v / step) * step).toFixed(3)) : undefined;
const token = (v) => (typeof v === 'string' && TOKEN.test(v) ? v : typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined);
const idLike = (v) => (typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,47}$/.test(v) ? v : undefined);
const minutesByMode = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = {};
  for (const m of MODES) {
    const n = num(0, 1440, 0.1)(v[m]);
    if (n !== undefined && n > 0) out[m] = n;
  }
  return out;
};

/**
 * Every event Skyloom may send, and per field the only values it may carry.
 * The adventure events keep their pre-pass names and fields
 * (lib/fly/adventure-analytics.js forwards them here with the flag on).
 */
export const SCHEMA = Object.freeze({
  session_start: { device_class: oneOf(DEVICE_CLASSES) },
  mode_entered: { mode: oneOf(MODES) },
  session_end: { minutes_by_mode: minutesByMode, preset: oneOf(PRESETS), device_class: oneOf(DEVICE_CLASSES) },
  lounge_movement_watched: { movement: oneOf(['arrival', 'departure']) },
  photo_taken: { hires: bool },
  deep_link_opened: { kind: oneOf([...LINK_KINDS, 'invalid']) },
  link_copied: { kind: oneOf(LINK_KINDS) },
  challenge_toggled: { on: bool },
  perf_summary: { p95_bucket: token, stalls_per_min: num(0, 600, 0.1), rung: token },
  client_error: { kind: oneOf(['context_lost', 'boundary', 'shader_link']) },
  // Pre-pass adventure events (adventure-analytics.js ALLOWED / FIELDS).
  adventure_started: { adventureId: idLike },
  adventure_checkpoint: { adventureId: idLike, checkpoint: num(0, 64) },
  adventure_completed: { adventureId: idLike, medal: num(1, 3) },
  adventure_retried: { adventureId: idLike },
  reward_claimed: { rewardId: idLike },
  return_visit: { day: (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined) },
  pack_interest: { packId: idLike, answer: oneOf(['yes', 'maybe', 'no']) },
});

/** The PostHog identity / bookkeeping keys the SDK adds and before_send keeps. */
const SDK_KEYS = ['token', 'distinct_id', '$device_id', '$session_id', '$lib', '$lib_version', '$process_person_profile', '$is_identified', '$geoip_disable'];

/** Sanitize one event: `{event, properties}` with only schema fields, or null. */
export function sanitizeEvent(event, props) {
  if (typeof event !== 'string' || !Object.prototype.hasOwnProperty.call(SCHEMA, event)) return null;
  const spec = SCHEMA[event];
  const properties = {};
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    for (const [k, check] of Object.entries(spec)) {
      if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
      const v = check(props[k]);
      if (v !== undefined) properties[k] = v;
    }
  }
  return { event, properties };
}

/** PostHog `before_send`: the schema again, plus the SDK's own identity keys. */
export function sanitizeWire(e) {
  const clean = sanitizeEvent(e?.event, e?.properties);
  if (!clean) return null;
  const props = e?.properties ?? {};
  for (const k of SDK_KEYS) if (['string', 'number', 'boolean'].includes(typeof props[k])) clean.properties[k] = props[k];
  clean.properties.$geoip_disable = true;
  return { event: clean.event, properties: clean.properties, timestamp: e.timestamp, uuid: e.uuid };
}

export function analyticsV2On() {
  return shipPassOn('ANALYTICS_V2');
}

/** 'yes' | 'no' | null (never asked). */
export function analyticsConsent() {
  try {
    const v = globalThis.window?.localStorage?.getItem(CONSENT_KEY);
    return v === 'yes' || v === 'no' ? v : null;
  } catch {
    return null;
  }
}

let client = null;
let loading = null;
let generation = 0;
const queue = [];

async function connect() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (!key || !host || client) return;
  const token = generation;
  try {
    loading ??= import('posthog-js');
    const { default: posthog } = await loading;
    if (token !== generation || analyticsConsent() !== 'yes') return;
    posthog.init(key, {
      api_host: host,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      capture_exceptions: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_feature_flags: true,
      person_profiles: 'never',
      ip: false,
      persistence: 'localStorage',
      opt_out_capturing_by_default: true,
      before_send: sanitizeWire,
    });
    posthog.opt_in_capturing({ captureEventName: false });
    client = posthog;
    for (const e of queue.splice(0)) client.capture(e.event, { ...e.properties, $process_person_profile: false });
  } catch {
    // Telemetry must never stop flight.
  }
}

/**
 * Record the player's choice (the consent prompt and the Settings row are the
 * only callers). 'no' stops capture at once.
 */
export function setConsent(value) {
  const yes = value === true || value === 'yes';
  generation++;
  try {
    globalThis.window?.localStorage?.setItem(CONSENT_KEY, yes ? 'yes' : 'no');
  } catch {
    // storage blocked: the choice applies to this page
  }
  if (!yes) {
    queue.length = 0;
    try {
      client?.opt_out_capturing();
    } catch {
      // optional
    }
    client = null;
    return Promise.resolve();
  }
  return connect();
}

/** Diagnostics for the node gate and harnesses: what the module has done so far. */
export function analyticsState() {
  return { client: !!client, loading: !!loading, queued: queue.length, consent: analyticsConsent(), on: analyticsV2On() };
}

/** The frozen entry point. */
export function track(event, props) {
  try {
    if (!analyticsV2On() || analyticsConsent() !== 'yes') return;
    const clean = sanitizeEvent(event, props);
    if (!clean) return;
    if (client) {
      client.capture(clean.event, { ...clean.properties, $process_person_profile: false });
      return;
    }
    if (queue.length < 32) queue.push(clean);
    connect();
  } catch {
    // never throws
  }
}
