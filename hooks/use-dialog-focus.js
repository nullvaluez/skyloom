'use client';

import { useEffect } from 'react';

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]';

/** A menu owns Tab until it closes, then hands focus back to its opener. */
export function useDialogFocus(ref, open) {
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement;
    const items = () => [...dialog.querySelectorAll(FOCUSABLE)].filter(el =>
      el.tabIndex >= 0 && !el.disabled && !el.closest('[inert]') &&
      el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    (items()[0] ?? dialog).focus({ preventScroll: true });
    const onKey = event => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const nested = document.activeElement?.closest?.('[role="dialog"], [role="alertdialog"]');
      if (nested && nested !== dialog && dialog.contains(nested)) return;
      const list = items(), first = list[0], last = list.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (!dialog.contains(document.activeElement) ||
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (previous?.isConnected && (!document.activeElement ||
          document.activeElement === document.body || dialog.contains(document.activeElement))) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [ref, open]);
}
