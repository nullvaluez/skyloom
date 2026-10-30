# Live operator liveries

2026-10-30. Built with a second agent for the operator catalogue, matching rules,
and integration review. Lands on `main` behind `OPERATOR_LIVERIES`, **off by
default** under the True Earth device-certification rule.

Preview with `/?flags=OPERATOR_LIVERIES`; use `/?flags=-OPERATOR_LIVERIES` for
the previous paint. The device report records the effective flag.

## What the models looked like

The live fleet has 29 procedural airframe families at hero, mid and far detail.
They already have clearcoat, panel/door/window detail, moving gear/flaps,
registration lettering, cabin lighting and tail floodlights. Paint came from
256 seeded neutral palettes, consistent within an operator but unrelated to
its real colors. Military fighters use older baked-color GLBs and primitive
fallbacks. The player hangar uses a separate, fictional customization catalogue.

## What changes

Live commercial contacts use the ICAO callsign prefix to select representative
operator colors, fuselage titles and tail markings. Delta (`DAL`), Southwest
(`SWA`) and United (`UAL`) have individual vector tail designs. Coverage is
**58 airline schemes / 59 airline prefixes**, **four service schemes** and one
unmarked military scheme: **63 schemes total**. The complete append-only list,
with source references, is in `lib/fly/operator-liveries.mjs`.

| Coverage | Operators |
| --- | --- |
| North America | Delta, Southwest, United, American, JetBlue, Alaska, Hawaiian, Spirit, Frontier, Allegiant, Air Canada, WestJet, Aeromexico |
| Central/South America | Copa, Avianca, LATAM (`LAN`, `TAM`) |
| Europe | British Airways, Virgin Atlantic, easyJet, Ryanair, Lufthansa, Air France, KLM, Iberia, Vueling, Aer Lingus, Finnair, SAS, Swiss, Austrian, TAP, Turkish, LOT, Wizz |
| Middle East, Asia, Oceania, Africa | Emirates, Etihad, Qatar, Saudia, Cathay Pacific, Singapore, ANA, Japan Airlines, Korean Air, Air China, China Eastern, China Southern, EVA, China Airlines, Thai, Air India, IndiGo, Qantas, Air New Zealand, Ethiopian |
| Cargo | FedEx, UPS, Atlas Air, Cargolux |
| Military | `RCH`: U.S. Air Force; `CNV`: U.S. Navy; `RRR`: Royal Air Force; `CFC`: Canadian Armed Forces |

These are stylized, representative operator schemes, not serial-specific paint
reconstructions. Callsigns do not establish special liveries or leased-aircraft
paint. Unknown civil operators remain neutral. Regional operators serving
multiple brands, such as `SKW`/`RPA`, and military contractor `CMB` are not guessed.
Unidentified military contacts receive plain low-visibility gray without an
invented nationality, unit, serial number or insignia. Registrations are never
treated as airline evidence. Matching accepts padded/lowercase ICAO callsigns
and rejects malformed, partial, IATA and telephony-name matches.

The player hangar's saved paint selections and static parked scenery remain
their existing designs. This change paints tracked aircraft in the satellite
flight and lounge views, including legacy military GLBs; distant radar/glint
indicators retain their existing behavior.

## Rendering and lifecycle

- A per-instance float selects paint without splitting draws by airline.
  Family geometry, variant bits, fuselage plugs, registrations and LOD budgets
  remain intact. Metadata updates, including changes on the same object, refresh
  the cached match; disappearing callsigns return to neutral paint.
- One shared 2048 × 1024 RGBA atlas (8 MiB, no mipmaps) stores titles and vector
  marks. An extended palette preserves all 256 original neutral rows byte for
  byte. Resources are shared between the detailed fleet and the older models,
  released when the last owner leaves, and rebound safely on React effect replay.
- Fin emblems are projected in model metres, so circles and lettering do not
  stretch with taper. Existing windows, doors, glazing, lighting, aircraft bend
  and stale-contact tinting remain part of the material chain.
- Legacy GLBs measure the actual fuselage/fin offsets before placing text,
  retain their canopy and emissive lenses, and keep the livery attribute when
  asynchronous GLB loading replaces the initial primitive.
- Flag off does not acquire operator textures or change the old material
  shader source. No downloaded logo assets or new runtime requests.

## Verification

Commands:

```text
node scripts/verify-operator-liveries.mjs
node scripts/verify-operator-render.mjs
node scripts/verify-fleet-airframes.mjs
node scripts/verify-true-earth-flags.mjs
node scripts/review-operator-liveries.cjs --channel chrome
```

The GPU script bundles the real production geometry and materials into a local
studio. It uses synthetic callsigns, serves local GLBs, captures both sides and
night paint, and compares flag-on against flag-off. It does not need the ADS-B,
imagery or terrain providers. `--software` selects SwiftShader; `--channel chrome`
uses installed Chrome. Reports and full captures are in the ignored
`.graphics-review/operator-liveries/` directory. Selected evidence is committed
under `docs/reviews/operator-liveries/`.

Measured here: operator matching **8/8**; rendering/lifecycle **9/9**; existing
airframes **13/13**; True Earth flags **8/8**. A 232-contact mixed fleet stays
inside the existing **30 draw / 900,000 triangle** ceilings, including binocular
FOV. The node tests cover shared-material batching, all LODs, unchanged packing,
feed refresh, military fallback, geometry replacement and setup/cleanup/rebind.

The automated Chrome studio used **ANGLE / NVIDIA GeForce RTX 5080 / D3D11**:
**89 model/material cases on + 89 off**, no shader or browser errors. Eight
mapped example cards changed pixels; the unknown `ZZZ123` card was pixel
identical between arms. These are rendering correctness checks, not frame-rate
measurements or owner acceptance. `npm run verify:source` passes **5/5**, changed
JavaScript passes ESLint, and the Next.js **16.4.3** production build passes with
`FLY_BUILD_DIR=.next-liveries` and `next build --webpack`. The build retains the
existing metadataBase warning when no deployment origin is configured locally.

## Owner review before enabling by default

On desktop and iPhone, open the preview flag and inspect a `DAL`, `SWA` and `UAL`
contact in flight and through lounge binoculars, on both sides and at night.
Check a military transport/fighter when one is available, then compare the
flag-off page. Confirm readability, canopy/lights, LOD transitions and busy-airport
smoothness. The automated desktop studio is complete; owner acceptance and a
physical iPhone run remain open. Enable the constant in a separate commit after
that review.
