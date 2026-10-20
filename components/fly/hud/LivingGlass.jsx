'use client';

import { useEffect, useState } from 'react';
import { livingWorldBlock, livingWorldOn } from '@/lib/fly/living-world';
import { readReducedMotion } from '@/lib/fly/immersive';
import './living-glass.css';

/**
 * LIVING GLASS (Living World, MENU_GLASS) — the menu language's React side:
 * the flag, the timings, and the few primitives Pause, Settings and Credits
 * share. The look is all in living-glass.css; nothing here renders while the
 * flag is off (every consumer branches on GLASS_ON first).
 */
export const GLASS_ON = livingWorldOn('MENU_GLASS');
const BLOCK = livingWorldBlock('MENU_GLASS') ?? {};
export const GLASS_ENTER_MS = Number.isFinite(BLOCK.enterMs) ? BLOCK.enterMs : 260;
export const GLASS_EXIT_MS = Number.isFinite(BLOCK.exitMs) ? BLOCK.exitMs : 150;
const BLUR_PX = Number.isFinite(BLOCK.blurPx) ? BLOCK.blurPx : 22;

/** The root attributes every glass layer carries: tokens, timings, stillness. */
export function glassRootProps(still) {
  return {
    'data-still': still ? '' : undefined,
    style: { '--lg-in': `${GLASS_ENTER_MS}ms`, '--lg-out': `${GLASS_EXIT_MS}ms`, '--lg-blur': `${BLUR_PX}px` },
  };
}

/** The player's reduced-motion choice (saved pick, else the OS). */
export function stillMotion() {
  return readReducedMotion();
}

/**
 * Keep a layer mounted for its exit animation. `open` false starts the exit;
 * the layer unmounts `ms` later. While closing the caller renders it inert
 * with pointer-events off, so a click aimed at what lies beneath lands there.
 */
export function usePresence(open, ms = GLASS_EXIT_MS) {
  const [shown, setShown] = useState(open);
  if (open && !shown) setShown(true);
  useEffect(() => {
    if (open || !shown) return undefined;
    const id = setTimeout(() => setShown(false), Math.max(0, ms));
    return () => clearTimeout(id);
  }, [open, shown, ms]);
  return { mounted: open || shown, closing: !open && shown };
}

/** Props for a layer that is leaving: no hits, no focus, no announcements. */
export function closingProps(closing) {
  return closing ? { 'data-state': 'closing', inert: true, 'aria-hidden': true } : { 'data-state': 'open' };
}

/**
 * A two-state row: label left, value and a switch right. `name` is the
 * row's accessible name, kept identical to the pre-glass button text
 * ("Sound: On") because harnesses and assistive tech address it by that.
 */
export function GlassToggle({ label, value, on, onClick, testid, tone, name }) {
  return (
    <button
      type="button"
      className="lg-toggle"
      data-testid={testid}
      data-tone={tone}
      aria-pressed={on}
      aria-label={name}
      onClick={onClick}
    >
      <span className="lg-toggle-label">{label}</span>
      <span className="lg-vh">: </span>
      <span className="lg-toggle-value">{value}</span>
      <span className="lg-switch" aria-hidden="true" />
    </button>
  );
}

/** A labelled field: the label on the left, its control on the right. */
export function GlassField({ label, children, note, testid, labelId }) {
  return (
    <div className="lg-field" data-testid={testid}>
      <p className="lg-label" id={labelId}>
        {label}
      </p>
      {children}
      {note ? <p className="lg-note">{note}</p> : null}
    </div>
  );
}

/**
 * A pause destination. The visible label and note are separate lines; the
 * accessible name stays the original single string (`name`).
 */
export function GlassNavItem({ icon: Icon, label, sep = ' — ', note, meta, kbd, name, testid, tone, disabled, onClick }) {
  return (
    <button
      type="button"
      className="lg-nav-item"
      data-testid={testid}
      data-tone={tone}
      aria-label={name}
      disabled={disabled}
      onClick={onClick}
    >
      {Icon ? <Icon size={18} strokeWidth={1.75} aria-hidden="true" /> : null}
      <span className="lg-nav-text">
        <span className="lg-nav-label">{label}</span>
        {note || meta ? <span className="lg-vh">{sep}</span> : null}
        {note ? <span className="lg-nav-note">{note}</span> : null}
      </span>
      {meta ? <span className="lg-nav-meta">{meta}</span> : null}
      {kbd ? (
        <span className="lg-kbd lg-kbd-hint" aria-hidden="true">
          {kbd}
        </span>
      ) : null}
    </button>
  );
}

const NOT_KEYS = new Set(['Mouse', 'Click a plane', 'Hard stick input']);

/** The controls reference as keycaps ("WASD / arrows" -> two keys). */
export function GlassKeys({ rows, keycaps = true }) {
  return (
    <dl className="lg-keys">
      {rows.map(([key, what]) => (
        <div key={key}>
          <dt>{keycaps ? <KeyParts text={key} /> : key}</dt>
          <dd>{what}</dd>
        </div>
      ))}
    </dl>
  );
}

function KeyParts({ text }) {
  if (NOT_KEYS.has(text)) return text;
  const hold = /\s*\(hold\)$/.exec(text);
  const body = hold ? text.slice(0, hold.index) : text;
  const parts = body.split(' / ');
  return (
    <>
      {parts.map((p, i) => (
        <span key={p} className="lg-key-group">
          {i > 0 ? <span className="lg-key-or"> / </span> : null}
          <kbd className="lg-kbd">{p}</kbd>
        </span>
      ))}
      {hold ? <span className="lg-key-hold"> (hold)</span> : null}
    </>
  );
}
