import { NextResponse } from 'next/server';
import { PACKS } from '@/lib/fly/content-access.mjs';
import { grantsFromList } from '@/lib/fly/entitlements';

/**
 * SHIP PASS RL-7 — the server side of the entitlement seam.
 *
 * Returns `{ grants: [] }`: there are no accounts or checkout yet (D3), and
 * grants must only ever come from a trusted server. A deployment can configure
 * `SKYLOOM_GRANTS` (server-only, comma-separated pack ids, validated against
 * PACKS) to exercise the seam end to end before a real provider exists; any id
 * that is not a known pack is dropped. No client reads this route yet
 * (lib/fly/entitlements.js currentGrants() is still []), and it never caches.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ grants: grantsFromList(process.env.SKYLOOM_GRANTS, PACKS) }, { headers: { 'cache-control': 'no-store' } });
}
