'use client';

import { useEffect, useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import { shipPassOn } from '@/lib/fly/ship-pass';
import { buildDeepLink, shareBase } from '@/lib/fly/deep-link.mjs';
import { track } from '@/lib/fly/analytics';
import './copy-link.css';

/**
 * SHIP PASS RL-4 (DEEP_LINKS) — "Copy link" for a place: an airport card, a
 * journey card, the Atlas destination card and Pause (where you are). Copies
 * an entry link (lib/fly/deep-link.mjs buildDeepLink, so only links the parser
 * accepts) and reports `link_copied{kind}`. Renders nothing with DEEP_LINKS
 * off, so every surface it sits on is byte-identical then.
 *
 * `link` is a deep-link descriptor ({kind:'watch', airportId} …) or a function
 * returning one at click time (Pause's current place moves).
 */
export function CopyLink({ link, testid, label = 'Copy link', compact = false, className = '' }) {
  const [state, setState] = useState('idle'); // 'idle' | 'copied' | 'failed'
  useEffect(() => {
    if (state === 'idle') return undefined;
    const t = setTimeout(() => setState('idle'), 2200);
    return () => clearTimeout(t);
  }, [state]);
  if (!shipPassOn('DEEP_LINKS')) return null;
  const copy = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      const desc = typeof link === 'function' ? link() : link;
      const url = buildDeepLink(desc, shareBase());
      await navigator.clipboard.writeText(url);
      track('link_copied', { kind: desc.kind });
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  const text = state === 'copied' ? 'Link copied' : state === 'failed' ? 'Copy failed' : label;
  return (
    <button
      type="button"
      className={`copy-link${compact ? ' copy-link-compact' : ''}${className ? ` ${className}` : ''}`}
      data-testid={testid}
      data-state={state}
      aria-label={text}
      title={text}
      onClick={copy}
    >
      {state === 'copied' ? <Check size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
      {!compact && <span>{text}</span>}
      {compact && <span className="copy-link-vh" aria-live="polite">{state === 'idle' ? '' : text}</span>}
    </button>
  );
}

/** A featured airport card with a compact Copy link in its corner (the card itself unchanged). */
export function CardWithLink({ children, link, testid }) {
  if (!shipPassOn('DEEP_LINKS')) return children;
  return (
    <div className="copy-link-card">
      {children}
      <CopyLink link={link} testid={testid} compact className="copy-link-corner" />
    </div>
  );
}
