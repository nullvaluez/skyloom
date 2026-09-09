/**
 * ROUND 23 (C "NIGHT-CERT") — FLEET PREFLIGHT. Ten seconds, no browser.
 *
 * WHY. A full satellite sweep is ninety minutes. In this session every browser
 * harness in the fleet is guaranteed to fail — satellite AND toy — because the
 * egress policy answers 403 to CONNECT for the two hosts the world is built
 * from, and there is no way to learn that from a harness's output except by
 * reading a failure that looks exactly like a product regression. This file
 * answers "is a sweep worth starting at all" before anyone spends the ninety
 * minutes, and names the blocked host if not.
 *
 * It checks the three upstreams the fleet depends on:
 *   • server.arcgisonline.com  — Esri World_Imagery + Terrain3D DEM (satellite
 *                                ground, and the DEM every drape reads)
 *   • tiles.openfreemap.org    — the vector planet: every building, road,
 *                                parcel and landuse polygon, in BOTH styles
 *                                (the toy world streams from here too, which is
 *                                why a blockade is not satellite-only)
 *   • the dev server's own /api/aircraft — live ADS-B, which several harnesses
 *                                need candidates from (verify-fly-models,
 *                                verify-fly-formation, verify-spicy)
 *
 * Exit 0 = GO. Exit 2 = NO-GO, with the reason. Deliberately the same "2 means
 * not-runnable" convention verify-night-alive uses, so a sweep script can treat
 * both identically.
 *
 * Run:  NODE_USE_ENV_PROXY=1 FLY_URL=http://localhost:3023 node scripts/r23-c-preflight.js
 *
 * `NODE_USE_ENV_PROXY=1` matters and is not decoration: Node's built-in `fetch`
 * does NOT read `HTTPS_PROXY` on its own (Node >= 22.21 gates it behind that
 * flag). Without it the two Esri/OFM probes fail for the wrong reason — they
 * bypass the proxy entirely and time out — which would make this file report
 * NO-GO on a perfectly healthy session. The browser reads the environment's
 * proxy settings itself, so the harnesses need no equivalent.
 */
const TIMEOUT_MS = +(process.env.R23_PREFLIGHT_TIMEOUT ?? 20000);
const FLY_URL = (process.env.FLY_URL || 'http://localhost:3000').replace(/\/$/, '');

/* Real tile URLs from `lib/fly/tile-sources.js`'s own templates — a HEAD of a
 * host root proves less than nothing (a CDN edge answers those happily while
 * the tile path is denied), so each probe fetches an actual tile. */
const PROBES = [
  {
    name: 'Esri imagery',
    host: 'server.arcgisonline.com',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/12/9',
    needed: 'satellite ground at every pose',
  },
  {
    name: 'Esri DEM',
    host: 'server.arcgisonline.com',
    url: 'https://server.arcgisonline.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer/tile/5/12/9',
    needed: 'terrain height + every drape (buildings, roads, clutter)',
  },
  {
    name: 'OpenFreeMap vector',
    host: 'tiles.openfreemap.org',
    url: 'https://tiles.openfreemap.org/planet',
    needed: 'ALL buildings/roads/parcels, in BOTH styles',
  },
  {
    name: 'live ADS-B (via the dev server)',
    host: new URL(FLY_URL).host,
    url: `${FLY_URL}/api/aircraft?lat=40.7&lon=-74&dist=100`,
    needed: 'traffic candidates for fly-models / fly-formation / spicy',
    soft: true, // a quiet sky is not a blocked sky; reported, never NO-GO
  },
];

const probe = async (p) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(p.url, { signal: ctl.signal, redirect: 'follow' });
    const body = p.url.includes('/api/aircraft') ? await r.text() : null;
    // The app's own honest all-sources-empty path (R19 d5076d0) is a 200 with
    // an error field — a 200 is not enough to call ADS-B healthy.
    const dead = body ? /all upstream sources unavailable/.test(body) : false;
    return { ...p, ok: r.ok && !dead, status: r.status, note: dead ? 'all upstream sources unavailable' : '' };
  } catch (e) {
    return { ...p, ok: false, status: 0, note: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(t);
  }
};

(async () => {
  console.log(`PREFLIGHT (timeout ${TIMEOUT_MS} ms, dev server ${FLY_URL})`);
  const rows = [];
  for (const p of PROBES) rows.push(await probe(p));
  for (const r of rows)
    console.log(
      `${r.ok ? 'GO  ' : r.soft ? 'WARN' : 'STOP'} ${r.name.padEnd(28)} http=${String(r.status).padEnd(4)} ${r.note} — needs: ${r.needed}`
    );
  const hard = rows.filter((r) => !r.ok && !r.soft);
  if (hard.length) {
    const hosts = [...new Set(hard.map((r) => r.host))];
    console.log(
      `\nNO-GO — ${hosts.join(', ')} unreachable. Every BROWSER harness in the fleet will fail, ` +
        `satellite and toy alike, and the failures will look like product regressions.\n` +
        `Diagnose: curl -sS http://127.0.0.1:38989/__agentproxy/status  (a 403 to CONNECT is an ` +
        `egress policy denial — report the blocked host, do not route around it).\n` +
        `Node gates are unaffected and can still be run: verify-classify.mjs / verify-warbirds.mjs / verify-daily.mjs`
    );
    process.exit(2);
  }
  const soft = rows.filter((r) => !r.ok);
  console.log(
    `\nGO — the world is reachable.${soft.length ? ` (${soft.map((r) => r.name).join(', ')} degraded: traffic-dependent harnesses may SKIP)` : ''}`
  );
  process.exit(0);
})().catch((e) => {
  console.error('PREFLIGHT FAILED:', e.message);
  process.exit(2);
});
