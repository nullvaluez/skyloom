/**
 * ROUND 23 (B "CITY-LIGHT") — THE FLAG-OFF BYTE-IDENTITY GATE (node, no browser).
 *
 * NIGHT_CITY_R23 ships `enabled: false`, and the revert contract this round
 * signs is stronger than "the uniforms are at identity": with the block
 * disarmed, `applyBendRoadSat` and `applyBendAnchorSat` must generate the
 * SAME SHADER TEXT they generated on base, under the SAME program cache key —
 * so the shipped tree compiles the certified R19 programs and no frozen gate
 * can move for a reason this round created.
 *
 * That is a claim about generated strings, and generated strings can be
 * compared exactly. world-bend.js imports NOTHING (the module is deliberately
 * constants-free), so both the current and the BASE copy can be imported into
 * node, driven through a stand-in `onBeforeCompile`, and diffed byte for byte.
 * No GPU, no network, no browser — which is why this gate is also the one piece
 * of certification that survived this session's egress denial (Esri +
 * OpenFreeMap CONNECT 403: nothing streams, so no pixel A/B at a city pose is
 * possible here).
 *
 * Gates:
 *   (1) ROAD, disarmed  — vertex + fragment text identical to BASE, byte for byte
 *   (2) ROAD, disarmed  — cache key still 'world-bend-road-satnight-r19'
 *   (3) BLDG, disarmed  — vertex + fragment text identical to BASE, byte for byte
 *   (4) BLDG, disarmed  — cache key still 'world-bend-anchor-satbldg-r19'
 *   (5) ROAD, armed     — key is the NEW 'world-bend-road-satnight-r23'…
 *   (6) BLDG, armed     — …and 'world-bend-anchor-satbldg-r23'
 *   (7) ROAD, armed     — the traffic term is behind `if ( uTrafBoost > 0.0 )`
 *                         and uTrafBoost defaults to 0 (identity even armed)
 *   (8) BLDG, armed     — the whole-CELL uv phase is a `step()` SWITCH, never a
 *                         fractional ramp (the R15 roof invariant)
 *   (9) ROOF INVARIANT (arithmetic) — neutralUV × cols is integral and stays
 *                         integral under every whole-cell offset, for all cols
 *                         and rows the atlas can be painted with
 *  (10) the armed road program declares aRoadSide, and the ENGINE builds it
 *                         only when armed (source check — no worker payload)
 *
 * Run: node scripts/verify-night-city-identity.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const BASE_PATH = process.env.R23_BASE_WORLDBEND;

const fails = [];
const gate = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

/* The three include markers each patch replaces, plus the ones three's own
 * chunks would supply. A stand-in shader is enough: the patch only ever does
 * string replacement, so identical inputs + identical patches ⇒ identical
 * outputs, and any difference is a difference in the patch. */
const stubVertex = `#include <common>
void main() {
  #include <begin_vertex>
  #include <project_vertex>
}`;
const stubFragment = `#include <common>
void main() {
  #include <clipping_planes_fragment>
  #include <color_fragment>
  #include <emissivemap_fragment>
  #include <fog_fragment>
}`;

function generate(applyFn, args) {
  const material = { userData: {}, needsUpdate: false };
  applyFn(material, ...args);
  const shader = { uniforms: {}, vertexShader: stubVertex, fragmentShader: stubFragment };
  material.onBeforeCompile(shader, null);
  // SNAPSHOT the uniform VALUES. world-bend's uniform objects are module-level
  // and shared by every material it patches, so a later generate() would
  // retro-write what an earlier one appears to have measured — an instrument
  // that reports a number mutated after the fact (the R19 §7 "an instrument can
  // indict what it merely failed to exclude" trap, in its arithmetic form).
  const snap = {};
  for (const [k, u] of Object.entries(shader.uniforms)) {
    const v = u?.value;
    snap[k] =
      v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  }
  return {
    v: shader.vertexShader,
    f: shader.fragmentShader,
    key: material.customProgramCacheKey(),
    uniformNames: Object.keys(shader.uniforms),
    u: snap,
  };
}

const [{ applyBendRoadSat, applyBendAnchorSat }, constants] = await Promise.all([
  import(path.join(ROOT, 'lib/fly/toy-world/world-bend.js')),
  import(path.join(ROOT, 'lib/fly/fly-constants.js')),
]);
const { SAT_ROADS, SUBURB_NIGHT, SAT_BUILDINGS, NIGHT_CITY_R23 } = constants;

const cur = {
  roadOff: generate(applyBendRoadSat, [SAT_ROADS, SUBURB_NIGHT, null]),
  roadOn: generate(applyBendRoadSat, [SAT_ROADS, SUBURB_NIGHT, NIGHT_CITY_R23.roads]),
  bldgOff: generate(applyBendAnchorSat, []),
  bldgOn: generate(applyBendAnchorSat, [NIGHT_CITY_R23.windows]),
};

if (BASE_PATH) {
  const base = await import(BASE_PATH);
  const baseRoad = generate(base.applyBendRoadSat, [SAT_ROADS, SUBURB_NIGHT]);
  const baseBldg = generate(base.applyBendAnchorSat, []);
  const same = (a, b) => a.v === b.v && a.f === b.f;
  gate(
    '(1) ROAD disarmed — generated GLSL byte-identical to base',
    same(cur.roadOff, baseRoad),
    `v ${cur.roadOff.v.length}=${baseRoad.v.length} · f ${cur.roadOff.f.length}=${baseRoad.f.length}`
  );
  gate(
    '(3) BLDG disarmed — generated GLSL byte-identical to base',
    same(cur.bldgOff, baseBldg),
    `v ${cur.bldgOff.v.length}=${baseBldg.v.length} · f ${cur.bldgOff.f.length}=${baseBldg.f.length}`
  );
  gate(
    '(1b) ROAD disarmed — uniform NAME SET identical to base (nothing new bound)',
    cur.roadOff.uniformNames.slice().sort().join(',') ===
      baseRoad.uniformNames.slice().sort().join(','),
    `${cur.roadOff.uniformNames.length} vs ${baseRoad.uniformNames.length}`
  );
  gate(
    '(3b) BLDG disarmed — uniform NAME SET identical to base',
    cur.bldgOff.uniformNames.slice().sort().join(',') ===
      baseBldg.uniformNames.slice().sort().join(','),
    `${cur.bldgOff.uniformNames.length} vs ${baseBldg.uniformNames.length}`
  );
} else {
  console.log(
    'WARN gates (1)/(3) skipped — set R23_BASE_WORLDBEND=<abs path to the BASE world-bend.js> to diff against it'
  );
}

gate(
  "(2) ROAD disarmed — key still 'world-bend-road-satnight-r19'",
  cur.roadOff.key === 'world-bend-road-satnight-r19',
  cur.roadOff.key
);
gate(
  "(4) BLDG disarmed — key still 'world-bend-anchor-satbldg-r19'",
  cur.bldgOff.key === 'world-bend-anchor-satbldg-r19',
  cur.bldgOff.key
);
gate(
  "(5) ROAD armed — new key 'world-bend-road-satnight-r23'",
  cur.roadOn.key === 'world-bend-road-satnight-r23',
  cur.roadOn.key
);
gate(
  "(6) BLDG armed — new key 'world-bend-anchor-satbldg-r23'",
  cur.bldgOn.key === 'world-bend-anchor-satbldg-r23',
  cur.bldgOn.key
);
/* (7) The armed program must still have an OFF state reachable by a knob — that
 * is what makes the A/B control leg (`__flyNightCity.swept()`) an honest
 * baseline rather than a different-looking guess. Assert the branch guard AND
 * that a boost-0 cfg actually lands 0 on the uniform. */
{
  const zeroed = generate(applyBendRoadSat, [
    SAT_ROADS,
    SUBURB_NIGHT,
    {
      ...NIGHT_CITY_R23.roads,
      traffic: { ...NIGHT_CITY_R23.roads.traffic, boost: 0 },
    },
  ]);
  gate(
    '(7) ROAD armed — the traffic colour term is 0-gated on uTrafBoost, and boost 0 reaches the uniform',
    /if \( uTrafBoost > 0\.0 \)/.test(cur.roadOn.f) && zeroed.u.uTrafBoost === 0,
    `shipped ${cur.roadOn.u.uTrafBoost} · control leg ${zeroed.u.uTrafBoost}`
  );
}
gate(
  '(8) BLDG armed — the uv phase is a step() SWITCH, not a fractional ramp',
  /step\( 0\.5, uNCPhase \) \* floor\(/.test(cur.bldgOn.f) &&
    (cur.bldgOn.f.match(/uNCPhase/g) || []).length === 2, // the declaration + the one step()
  `${(cur.bldgOn.f.match(/uNCPhase/g) || []).length} references`
);

/* (9) THE ROOF INVARIANT, arithmetically. Roof + roof-detail verts all carry the
 * constant uv (neutralUV, neutralUV). The de-repeat adds k/cols (k integral), so
 * the sampled u stays at neutralUV·cols + k CELLS — a cell BOUNDARY, which is
 * solid background in both atlas paintings, at mip 0. If neutralUV·cols were NOT
 * integral the offset would walk the roof texel into a lit pane and every roof in
 * the city would grow windows at night. */
{
  const F = SAT_BUILDINGS.facade;
  const uInt = Number.isInteger(F.neutralUV * F.cols);
  const vInt = Number.isInteger(F.neutralUV * F.rows);
  let walks = false;
  for (let k = 0; k < F.cols; k++) {
    if (!Number.isInteger(F.neutralUV * F.cols + k)) walks = true;
  }
  for (let k = 0; k < F.rows; k++) {
    if (!Number.isInteger(F.neutralUV * F.rows + k)) walks = true;
  }
  gate(
    '(9) ROOF INVARIANT — neutralUV lands on a cell boundary under every whole-cell offset',
    uInt && vInt && !walks,
    `neutralUV ${F.neutralUV} × cols ${F.cols} = ${F.neutralUV * F.cols}, × rows ${F.rows} = ${F.neutralUV * F.rows}`
  );
}

/* (10) The ribbon SIDE is derived CLIENT-SIDE. Two source facts, asserted so a
 * later edit cannot quietly move it into the worker (which would be a protocol
 * bump at six pin sites): the armed program declares the attribute, and the
 * engine writes it only under its own arm — while the worker never mentions it. */
{
  const engine = readFileSync(path.join(ROOT, 'lib/fly/toy-world/sat-road-engine.js'), 'utf8');
  const worker = readFileSync(path.join(ROOT, 'lib/fly/toy-world/vector-tile.worker.js'), 'utf8');
  gate(
    '(10) aRoadSide — declared by the armed program, built by the engine under its arm, ABSENT from the worker',
    /attribute float aRoadSide/.test(cur.roadOn.v) &&
      !/aRoadSide/.test(cur.roadOff.v) &&
      /if \(this\.r23\)[\s\S]{0,400}aRoadSide/.test(engine) &&
      !/aRoadSide/.test(worker),
    'no worker payload change ⇒ WORKER_PROTOCOL stays 18'
  );
}

console.log(
  `\n${fails.length ? 'VERIFY FAIL' : 'VERIFY PASS'} — ${fails.length} failing gate(s)${fails.length ? ': ' + fails.join(' | ') : ''}`
);
process.exit(fails.length ? 1 : 0);
