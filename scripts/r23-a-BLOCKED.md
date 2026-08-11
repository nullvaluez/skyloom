# R23 A — the environment blocker (why no pixel evidence exists in this worktree)

**Date:** 2026-08-11 · **Agent:** A NIGHT-TRUTH · **Status:** unresolved, reported, not routed around.

## What is blocked

This session's egress policy returns **403 to CONNECT** for both of the game's
tile hosts. Every other host tried through the same proxy works.

| Host | Serves | Result |
|---|---|---|
| `server.arcgisonline.com` | Esri World_Imagery **and** the Terrain3D DEM | **403 CONNECT** |
| `tiles.openfreemap.org` | OpenFreeMap vector tiles (buildings, roads, landuse, aeroway) | **403 CONNECT** |
| `services.arcgisonline.com` | (alternate Esri host) | **403 CONNECT** |
| `registry.npmjs.org` | — | 200 |
| `api.github.com` | — | 200 |
| Google Fonts (troika text fallback) | POI letter fallback fonts | blocked → one benign `TypeError: Failed to fetch` from `getFontsForString` |

Reproduce:

```
curl -sS http://127.0.0.1:38989/__agentproxy/status | grep -A3 recentRelayFailures
curl -s -o /dev/null -w "%{http_code}\n" https://server.arcgisonline.com/...   # 000 (exit 56)
curl -s -o /dev/null -w "%{http_code}\n" https://registry.npmjs.org/            # 200
```

Per `/root/.ccr/README.md`, a 403 from the proxy is an organization policy
denial: *"Do not retry or route around it — report the blocked host."* TLS
verification was never disabled and `HTTPS_PROXY` was never unset.

## Why this is fatal to the pixel half of the round

The R22 world **is** the terrain stack. With both tile hosts blocked there is no
imagery, no DEM, and no vector data, so nothing downstream can exist: buildings,
roads, skyline, parcel homes, house lights and every drape that depends on a DEM
sample. Measured at P-MAN, 45 s dwell, fully un-pinned:

```
tier=high dpr=1 draws=94 tris=58305 sunFrac=0
bldg chunks=13 ready=0        <- 13 chunks requested, none ever finalized
roads ready=0
terra {camTileZ 12, targetZ 17, downloading 8, sharp false}
```

Evidence: `r23-a-smoke2.json`, and `r23-a-man-L1.png` — a near-black empty frame
with the HUD floating over nothing.

**Therefore:** lit-pixel fraction, warm-lit share, white-glow area and luma
percentiles — the whole §3 metric set — are unmeasurable here, at every pose.
The bisection harness `r23-a-probe.js` is committed and correct; it needs a
machine with egress and nothing else.

## What was measured instead

Three instruments survive the blockade, and every claim A makes rests on one:

1. **Tile-independent state probes.** Which contributors are armed, what their
   materials and uniforms hold, per tier, per clock — none of which needs a tile
   to have arrived. `r23-a-tiernight.js`, `r23-a-hazeramp.js`.
2. **Paired user-vs-fleet legs.** The same probe with `__flyAerialOverride`
   released and held. This is what converts "this looks wrong" into "no gate in
   the repo can see it". `r23-a-tiernight.json`.
3. **Cited source proof**, for chains a state probe cannot reach.

Anything needing pixels is marked UNRESOLVED in `R23_A_ROOTCAUSE.md` §1/§6
rather than guessed at.

## Consequence for certification

**This worktree cannot certify anything pixel-based, including A's own fix.**
The F1 night term is proven by the uniform it controls (0.55 → 0 at night,
0.55 → 0.55 at noon, 14-sample monotone dusk ramp) — not by a photograph of a
city. A re-run on a machine with egress is required before the round calls it
proven, and C's `verify-night-alive` red calibration is impossible here for the
same reason.
