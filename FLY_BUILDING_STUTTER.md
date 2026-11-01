# Building surface stability and streaming — 2026-11-01

The owner reported entire tan facades rapidly turning dark during Manhattan
flight, plus a long period of loading hitches. This investigation used local
production builds, live OpenFreeMap/terrain, and Chrome on the RTX 5080
(ANGLE/D3D11). Earlier cloud-fixture limitations do not describe this venue.

## Findings and changes

**Competing wall surfaces.** Different mapped building parts emit overlapping
vertical rectangles with different inferred paint, heights and bend/drape
anchors. The previous guard compared identical triangles AND anchors, so these
surfaces survived. Vertical anchor translations leave them on the same wall
plane: the depth buffer cannot consistently resolve their paint during motion.
The first live census also found coincident procedural facade trim.

`resolveArchitectureWalls` now assigns shared wall spans a deterministic owner
in the vector worker. It subtracts covered vertical intervals and retains upper
storeys and elevated portions, interpolating attributes at each new boundary.
It covers body and trim indices while preserving the body/detail draw boundary.
It does not blanket-offset buildings, change heights, remove whole building
parts, or merge nearby parallel facades. Roofs and nonrectangular surfaces retain
the existing exact-triangle guard. Different horizontal wall spans are outside
this repair's matching rule; this is not a proof against every possible source
geometry overlap.

**Shared loading allowance.** The previous `mayFinalize(done)` gave each engine
its own free first chunk. The regression test inadvertently tested the second
engine with `done=1`, concealing the actual runtime case (`done=0` in every
engine). Building, skyline, road, vegetation and toy producers now reserve work
only after a candidate is ready. They share the 3 ms allowance and a two-commit
frame cap. A fair waiting queue admits one producer even if no spare time
remains, and drops cancelled producers from the queue. Existing spike refusal
and starvation limits remain. This cannot preempt one expensive atomic build;
it prevents multiple such builds from piling into that frame.

**Worker normals.** Enhanced near/far buildings now calculate and transfer
normals in the worker. Rigid building drape preserves those normals; Three.js
comparisons cover the repaired geometry and drape. Older/Classic bundles retain
the renderer-side fallback. The payload addition is optional and compatible
with protocol 24. This moves work off the rendering thread; it does not remove
its CPU cost and it adds a normal buffer to worker transfer.

## Distance preview

`?flags=DISTANCE_SOFTEN&diag=1` smoothly averages small facade detail from 1.8 to
3.6 km true distance, skips resolved material texture work as it fades, and uses
the existing aerial perspective. There is no new fullscreen blur pass. Distant
city budgets decrease independently of the detailed near-city ring:

| Tier | Groups before → preview | Triangles per source tile | Maximum far triangles before → preview |
| --- | --- | --- | --- |
| High | 24 → 18 | 1536 → 1024 | 589,824 → 294,912 |
| Medium | 10 → 8 | 768 → 512 | 122,880 → 65,536 |
| Low | 5 → 4 | 384 → 256 | 30,720 → 16,384 |

These are geometry ceilings, not measured frame-rate gains. The existing
residency-aware radial fade handles the smaller ring. The mapped skyline's
largest bodies remain prioritized. The approach reduces submitted work as
recommended in the [Three.js optimization guide](https://threejs.org/manual/pages/optimize-lots-of-objects.html).
The flag ships **off** under AGENTS.md's True Earth device-review rule. The
surface correction, shared budget and worker normals apply normally.

## Evidence

- Live source `planet/20261025_080012_pt/14/4825/6157.pbf`: conflicting body-wall
  interval pairs with >5 m overlap and >0.05 RGB difference **3,666 → 0**;
  worst original overlap **429 m**. Near geometry **155,162 → 151,158 triangles**
  including trim repair. These counts are for this tile, not every building in
  the world. Raw capture data stays in ignored `.graphics-review/building-stutter/`.
- Worker cost on this dense tile increased in the isolated diagnostic
  (approximately 0.30 → 0.55 s in one run), including repair and worker normals.
  This is a correctness/main-thread scheduling tradeoff, not a tessellation
  speedup claim.
- Building-surface regression: 6/6. Covers different anchors, different
  triangulation, partial/elevated overlaps, parallel walls, idempotence,
  attribute alignment and Three.js normal parity.
- Finalize regression: 25/25, including the real five-producer `done=0` case,
  zero-spare-time fairness, cancellation and steady-slow/spike behavior.
- Building handoff: 4/4; city-horizon coverage/concurrency, 360-degree movement,
  return flight, quality contraction and rollback checks pass.
- Distance preview tests pass on/off for both materials and all tier budgets.
  True Earth flag/device-report tests: 8/8. Source import-integrity, targeted
  ESLint and the production build pass.
- Initial corrected production capture: settled Manhattan plus 30 seconds of
  flight with zero runtime/shader errors. The readiness poll completed in
  24.4 s versus 54.4 s in the prior capture, but provider/cache conditions were
  not controlled. Recent p95 frame samples were 18.1 versus 17.7 ms: **no
  sustained frame-rate improvement is established**. Cold-start multi-second
  stalls still occurred; this pass does not certify hitch-free startup.
- Final wall/trim repair with the preview enabled also completed settled
  Manhattan and 30 seconds of flight, zero runtime/shader errors and no source
  drift. Far triangles were **239,778**, versus **478,067** in the corrected
  default capture. The sampled whole scene was 2.37M triangles/310 draws versus
  2.81M/322; recent p95 was 16.4 ms versus 18.1 ms. These sequential captures
  have different streaming/cache histories, so they demonstrate reduced work,
  not a controlled performance guarantee. The 2.2M scene budget is still open.

## Review on devices

Revisit the reported Manhattan approach in normal flight, turn around the
formerly flashing facades, and repeat with the distance preview URL. Check
building silhouettes and the horizon while moving, and compare cold and warm
starts separately. Physical iPhone/Safari and owner approval of the new
distance treatment remain open. No existing performance ceiling was raised.
