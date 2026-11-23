import { Matrix4, Vector3, DoubleSide, BackSide } from 'three';
import { airportRegistryRevision } from './operations-airports';

/**
 * Vertical contact queries on the existing rendered triangle mesh. A geographic
 * terrain tile is a heightfield: reject triangles in XY before interpolating Z.
 * This avoids generic Raycaster's vertex/UV/normal work for every triangle.
 * No cached heights, resampling, geometry changes, GPU storage or worker work.
 * The ordinary raycast remains the fallback for unsupported mesh transforms.
 */
// Per-geometry triangle buckets: a regular XY grid over the geometry's own
// bounds listing, in index order, the non-degenerate triangles that overlap
// each cell. A query tests only its cell's triangles with the same arithmetic
// and in the same order as the full scan, so every answer is identical; a
// 2601-vertex tile goes from ~5k triangle tests per query to a handful.
// Built lazily for the meshes actually queried, rebuilt whenever the position
// or index buffer changes, and released with the geometry (WeakMap).
const BUCKETS = new WeakMap();
function triangleBuckets(g, pos, ids, count) {
  const p = g.attributes.position, index = g.index;
  const cached = BUCKETS.get(g);
  if (cached && cached.pos === pos && cached.ids === ids && cached.pv === p.version && cached.iv === index.version && cached.count === count) return cached;
  const bounds = g.boundingBox, tris = Math.floor(count / 3);
  const n = Math.max(1, Math.min(96, Math.round(Math.sqrt(tris / 4))));
  const minX = bounds.min.x, minY = bounds.min.y;
  const kx = n / Math.max(1e-12, bounds.max.x - minX), ky = n / Math.max(1e-12, bounds.max.y - minY);
  const cell = (v, min, k) => Math.min(n - 1, Math.max(0, Math.floor((v - min) * k)));
  const starts = new Uint32Array(n * n + 1);
  const each = (visit) => {
    for (let i = 0; i + 2 < count; i += 3) {
      const a = ids[i] * 3, b = ids[i + 1] * 3, c = ids[i + 2] * 3;
      const ax = pos[a], ay = pos[a + 1], bx = pos[b], by = pos[b + 1], cx = pos[c], cy = pos[c + 1];
      // Exactly the full scan's rejection: zero-area (skirt) faces never hit.
      if ((by - cy) * (ax - cx) + (cx - bx) * (ay - cy) === 0) continue;
      const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx), y0 = Math.min(ay, by, cy), y1 = Math.max(ay, by, cy);
      if (!(x0 <= x1 && y0 <= y1)) continue; // NaN vertices can never be selected
      const cx0 = cell(x0, minX, kx), cx1 = cell(x1, minX, kx), cy0 = cell(y0, minY, ky), cy1 = cell(y1, minY, ky);
      for (let yy = cy0; yy <= cy1; yy++) for (let xx = cx0; xx <= cx1; xx++) visit(yy * n + xx, i);
    }
  };
  each((k) => { starts[k + 1]++; });
  for (let k = 0; k < n * n; k++) starts[k + 1] += starts[k];
  const items = tris <= 65535 ? new Uint16Array(starts[n * n]) : new Uint32Array(starts[n * n]);
  const fill = starts.slice(0, n * n);
  each((k, i) => { items[fill[k]++] = i / 3; });
  const buckets = { pos, ids, pv: p.version, iv: index.version, count, n, minX, minY, kx, ky, starts, items,
    cellOf(x, y) { return cell(y, minY, ky) * n + cell(x, minX, kx); } };
  BUCKETS.set(g, buckets);
  return buckets;
}

// ---------------------------------------------------------------------------
// WORLD PASS B (ARRIVAL, fastQuery): the same answer, without the cost.
//
// `sampleReference` below is the shipped query, verbatim. It costs 17 to 21 us
// a call (FLY_WORLD_PASS.md, Budget) for about 11 triangle tests: a recursive
// closure walk from the root tile, a Matrix4.invert per visited mesh, two
// closures and an Object.keys array per call, and two ancestor matrix updates.
// While the stream is armed (`armFastGroundQuery(true)`, called once per page
// by the building engine when WORLD_ARRIVAL.fastQuery is on) EVERY query takes
// the exact memoised path below (r2: batched or not); while not armed every
// call runs the reference path.
//
//   r2: THE MEMO OUTLIVES THE BATCH. The walk for a point depends only on the
//      tree's topology and its tiles' world matrices (tile boxes are tested in
//      X and Z only, and a tile box's X/Z come from its scale and matrixWorld);
//      the triangle test depends on each reached mesh's geometry, index,
//      draw range, groups, materials, bounding box and matrixWorld. So:
//      - a module generation counter GEN, bumped by hooks installed on the
//        tile class (add, remove: every child-list change of the tree goes
//        through them) and on the tile-mesh class (setGeometry, syncGroups,
//        syncMaterials, setMaterial), and on the tree's tile-loaded /
//        tile-unload events; an added subtree's matrices are brought current
//        in the add itself, so a tile never enters the memo with the stale
//        matrix it has before the next render;
//      - per query, the root tile's matrixWorld, the root object and the
//        projection are compared with the memo's snapshot (a rebase moves the
//        root's matrix), and the map's own world matrix is brought current
//        exactly as the reference's geo2world does;
//      - per use, each mesh record re-checks its own inputs (geometry, the
//        position / index attributes, their arrays and versions, draw range,
//        groups, materials and their sides, bounding box, matrixWorld) and is
//        rebuilt on any difference.
//      Inside a batch none of that can change, so the checks run once per
//      batch. The proof is the same as before plus a live one: every query
//      the page makes during real arrivals with tiles streaming is re-asked of
//      the reference in the same synchronous call
//      (scripts/wp-arrival-r2-livediff.cjs), and a node gate drives churn
//      (scripts/wp-arrival-ground-churn.mjs).
//
//   BATCHED (`_sampleBatched`), between `beginGroundBatch()` and
//      `endGroundBatch()`. A batch is a synchronous loop that only queries
//      (the drape, the heal, the contact repair). JavaScript runs it to the end
//      before any other code can touch the terrain tree, so within one batch
//      the tree, every tile box, every matrix and every buffer is constant, and
//      the walk for a point is a pure function of which tile boxes contain it.
//      The batch memoises one walk per "safe rectangle": the intersection of
//      every accepted tile box with the far side of every rejected one, each
//      bound kept with the reference test's own strictness, so any point inside
//      takes exactly the same branches and reaches the same meshes in the same
//      order. Only the per-mesh triangle test runs per point. The memo dies
//      with the batch.
//
// It returns the reference's shape with bit-identical numbers and the same
// `tile`. Proof: scripts/wp-arrival-ground-diff.cjs (a million points, the
// reference against the batched path, on the live tree). One telemetry
// difference: when a reached mesh is unsupported the batched path stops
// counting triangles at that mesh (the answer, `undefined`, is the same).
//
// (An unbatched exact variant, the same live walk without closures and with
// memoised inverses, measured no faster than the reference on this tree: the
// walk's tile-box tests are the cost and only the batch may memoise them. It
// was removed rather than shipped.)
// ---------------------------------------------------------------------------

let ARMED = false; // set once per page by the building engine (WORLD_ARRIVAL.fastQuery)
let BATCH_DEPTH = 0;
let BATCH_ID = 0;
let GEN = 0; // r2: bumped on every change that can move a walk (see the header)

// ---------------------------------------------------------------------------
// THIRD ROUND (G IDLE LOOPS, FLY_HORIZON_FILL.md "Third round"): WHERE the
// ground changed. The streaming engines re-query the ground in loops that run
// on a time allowance whether or not anything changed; with this they can ask
// "has the ground under this area changed since epoch E" and sleep until it has.
//
// The log is fed by EXACTLY the events that already invalidate this module's
// own memo (GEN above), each with the region it can affect:
//   - a tile's child list (add / remove: `this` is the parent tile),
//     the tree's tile-loaded / tile-unload events (the event's tile), and a
//     terrain mesh's setGeometry / syncGroups / syncMaterials / setMaterial
//     (its nearest tile ancestor): the region is that tile's footprint. The
//     walk reaches a tile's meshes only for points inside the tile's box, so
//     no point outside it can change its answer (the box is in X/Z only and
//     the footprint is the tile's own x/y/z bounds, padded);
//   - a record the memo found stale on use (an in-place edit of a mesh that
//     announced nothing): that mesh's tile;
//   - and, EVERYWHERE at once (a global change): a new query instance or a
//     different instance answering (a new map), the root tile, its world
//     matrix, the map's world matrix or the projection changing (a rebase
//     moves every answer's arithmetic), the airport registry's revision
//     moving (airport surfaces override the terrain and operations-terrain
//     re-flattens on it), and noteGroundChanged() with no area (the seam for
//     sources outside this module, e.g. a ground provider).
// The log is LIVE only while the fast query is armed and the answering
// query's tree is hooked; otherwise `live()` is false and a caller must not
// skip anything (no signal is not "no change"). Regions are kept in a ring;
// asking about an epoch older than the ring answers "changed".
// No allocation per query: changedSince is a scan of typed arrays.
// ---------------------------------------------------------------------------
const CH_N = 512;
const CH_EPOCH = new Float64Array(CH_N); // epoch each entry was written at
const CH_BOX = new Float64Array(CH_N * 4); // lon/lat box per entry: west, south, east, north
let CH_COUNT = 0; // entries written so far (ring index = CH_COUNT % CH_N)
let EPOCH = 1; // the current epoch: bumped by every change
let GLOBAL_AT = 1; // epoch of the last change that touched everything
let CH_Q = null; // the query instance whose tree the log describes
let CH_REV = null; // the airport registry revision last seen
const CH_STATS = { regions: 0, globals: 0, why: {} };
const airportRevision = airportRegistryRevision; // airport surfaces answer before the terrain

/** A change everywhere. */
function changeGlobal(why) {
  EPOCH += 1;
  GLOBAL_AT = EPOCH;
  CH_STATS.globals += 1;
  CH_STATS.why[why] = (CH_STATS.why[why] ?? 0) + 1;
}
/** A change inside a lon/lat box. */
function changeBox(w, s, e, n) {
  if (!(w <= e && s <= n)) return changeGlobal('box');
  EPOCH += 1;
  const i = CH_COUNT % CH_N;
  CH_EPOCH[i] = EPOCH;
  CH_BOX[i * 4] = w;
  CH_BOX[i * 4 + 1] = s;
  CH_BOX[i * 4 + 2] = e;
  CH_BOX[i * 4 + 3] = n;
  CH_COUNT += 1;
  CH_STATS.regions += 1;
}
/** A change over a terrain tile's footprint (padded by 1 % of its size). */
function changeTile(tile) {
  if (!tile?.isTile) return;
  const map = CH_Q?.map;
  // A tile of another tree than the answering one cannot move an answer; a new
  // tree announces itself globally when its query first answers.
  if (!map || tile._root !== map.rootTile) return;
  const proj = map.projection;
  let b = null;
  try {
    b = proj?.getLonLatBoundsFromXYZ?.(tile.x, tile.y, tile.z);
  } catch {
    b = null;
  }
  if (!b || tile.z <= 1 || !(Number.isFinite(b[0]) && Number.isFinite(b[1]) && Number.isFinite(b[2]) && Number.isFinite(b[3])) || b[0] > b[2]) {
    return changeGlobal('tile'); // the root, a wrapped tile or an unknown projection
  }
  const pw = (b[2] - b[0]) * 0.01 + 1e-7, ph = (b[3] - b[1]) * 0.01 + 1e-7;
  changeBox(b[0] - pw, b[1] - ph, b[2] + pw, b[3] + ph);
}
/** The nearest tile at or above an object (a mesh's change is its tile's). */
function tileOf(o) {
  while (o && !o.isTile) o = o.parent;
  return o;
}
function noteTileEvent(e) {
  changeTile(e?.tile);
}

/**
 * THIRD ROUND: the ground-change log, for loops that re-query the ground.
 *   live()                    false: nothing may be skipped (no signal)
 *   epoch()                   the current epoch (also polls the global terms)
 *   changedSince(E, w, s, e, n)  has the ground in that lon/lat box changed since E?
 */
export const groundChanges = {
  live() {
    return ARMED && !!CH_Q && !!CH_Q._hooked;
  },
  epoch() {
    pollGlobal();
    return EPOCH;
  },
  changedSince(e, w, s, east, n) {
    if (!(e < EPOCH)) return false;
    if (e < GLOBAL_AT) return true;
    const first = Math.max(0, CH_COUNT - CH_N);
    if (CH_COUNT > CH_N && CH_EPOCH[first % CH_N] > e + 1) return true; // older than the ring
    for (let k = CH_COUNT - 1; k >= first; k--) {
      const i = k % CH_N;
      if (CH_EPOCH[i] <= e) break; // the ring is in epoch order
      const j = i * 4;
      if (CH_BOX[j] <= east && CH_BOX[j + 2] >= w && CH_BOX[j + 1] <= n && CH_BOX[j + 3] >= s) return true;
    }
    return false;
  },
  stats() {
    return { epoch: EPOCH, globalAt: GLOBAL_AT, live: groundChanges.live(), ...CH_STATS, why: { ...CH_STATS.why } };
  },
};

/**
 * THIRD ROUND: an absolute Mercator world box (6,378,137 m sphere, +z south,
 * the streaming engines' frame) as the lon/lat box [west, south, east, north]
 * their queries fall in, padded by a hair for rounding.
 */
export function worldBoxLonLat(x0, z0, x1, z1, out = new Float64Array(4)) {
  const R = 6378137, D = 180 / Math.PI, pad = 1e-9;
  out[0] = (x0 / R) * D - pad;
  out[2] = (x1 / R) * D + pad;
  out[1] = (2 * Math.atan(Math.exp(-z1 / R)) - Math.PI / 2) * D - pad;
  out[3] = (2 * Math.atan(Math.exp(-z0 / R)) - Math.PI / 2) * D + pad;
  return out;
}
/** changedSince over a box from worldBoxLonLat. */
export function boxChangedSince(changes, e, b) {
  return changes.changedSince(e, b[0], b[1], b[2], b[3]);
}

/**
 * THIRD ROUND: tell the log about a change it cannot see (a ground provider
 * registered over the terrain, for one). With no box: everywhere.
 */
export function noteGroundChanged(w, s, e, n) {
  if (w === undefined) changeGlobal('noted');
  else changeBox(w, s, e, n);
}

/** The global terms that need no event: a rebase, the projection, the airport registry. */
function pollGlobal() {
  const rev = airportRevision();
  if (rev !== CH_REV) {
    if (CH_REV !== null) changeGlobal('airports');
    CH_REV = rev;
  }
  const q = CH_Q;
  if (!q || !q._hooked) return;
  const map = q.map, root = map?.rootTile;
  if (!root) return changeGlobal('no root');
  map.updateWorldMatrix(true, false); // as a query does: a moved parent is a rebase
  const me = map.matrixWorld.elements, re = root.matrixWorld.elements;
  const k = q._chKey;
  if (!k || k.root !== root || k.proj !== map.projection || !sameElements(k.mw, me) || !sameElements(k.rw, re)) {
    if (k) changeGlobal('rebase');
    q._chKey = { root, proj: map.projection, mw: me.slice(), rw: re.slice() };
  }
}

// r2: the change hooks. Installed once per class, only while armed, so the
// shipped page never runs them.
const HOOKED = new WeakSet();
const bump = (e) => { GEN++; noteTileEvent(e); };
function hookMeshClass(proto) {
  if (!proto || HOOKED.has(proto)) return;
  HOOKED.add(proto);
  for (const k of ['setGeometry', 'syncGroups', 'syncMaterials', 'setMaterial']) {
    const f = proto[k];
    if (typeof f !== 'function') continue;
    proto[k] = function (...a) { GEN++; try { return f.apply(this, a); } finally { GEN++; changeTile(tileOf(this)); } };
  }
}
function hookObject(o) {
  if (o?.isMesh && typeof o.setGeometry === 'function') hookMeshClass(Object.getPrototypeOf(o));
}
/** Install the tree hooks for this map's tile classes. False when there is no tree to hook. */
function hookTree(map) {
  const root = map?.rootTile;
  if (!root?.isTile) return false;
  const proto = Object.getPrototypeOf(root);
  if (!HOOKED.has(proto)) {
    HOOKED.add(proto);
    const add = proto.add, remove = proto.remove;
    proto.add = function (...o) {
      GEN++;
      const r = add.apply(this, o);
      // Bring the added subtree's world matrices current now: a box read before
      // the next render must not be the pre-render (identity) one.
      for (const c of o) { hookObject(c); c?.traverse?.(hookObject); c?.updateMatrixWorld?.(true); }
      GEN++;
      changeTile(this);
      return r;
    };
    proto.remove = function (...o) { GEN++; try { return remove.apply(this, o); } finally { GEN++; changeTile(this); } };
  }
  if (!root.__wpGroundHooked) {
    root.__wpGroundHooked = true;
    root.addEventListener('tile-loaded', bump);
    root.addEventListener('tile-unload', bump);
    root.traverse(hookObject);
  }
  return true;
}

/** WORLD PASS B: route every TerrainGroundQuery through the exact fast paths. */
export function armFastGroundQuery(on) {
  ARMED = !!on;
}
/** True while armed (diagnostics and the differential probe). */
export function fastGroundQueryArmed() {
  return ARMED;
}
/**
 * Open a query batch. The caller MUST close it with endGroundBatch() in a
 * `finally` and MUST NOT await or yield in between: the memo is exact only
 * because nothing else can run while the batch is open. Nested batches share
 * the outer one. Not armed, a batch changes nothing.
 */
export function beginGroundBatch() {
  if (BATCH_DEPTH++ === 0) BATCH_ID++;
}
export function endGroundBatch() {
  if (BATCH_DEPTH > 0) BATCH_DEPTH--;
}

const MESH_INV = new WeakMap(); // mesh -> { m: number[16] snapshot, inv: number[16] }
const _m4 = new Matrix4();
function sameElements(a, b) {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
}
/** Matrix4.copy(matrixWorld).invert() elements, memoised against the exact input. */
function inverseOf(object) {
  const e = object.matrixWorld.elements;
  let rec = MESH_INV.get(object);
  if (rec && sameElements(rec.m, e)) return rec.inv;
  _m4.copy(object.matrixWorld).invert();
  if (!rec) {
    rec = { m: new Array(16), inv: new Array(16) };
    MESH_INV.set(object, rec);
  }
  for (let i = 0; i < 16; i++) {
    rec.m[i] = e[i];
    rec.inv[i] = _m4.elements[i];
  }
  return rec.inv;
}
function hasMorph(g) {
  for (const k in g.morphAttributes) return true; // same truth value as Object.keys(...).length
  return false;
}

const CELL = 128; // memo grid (world units)
const CELL_K = 1048576;
const MAX_CELLS_PER_ENTRY = 256;
const MAX_MEMO_CELLS = 65536; // r2: a memo that lives across frames is capped (cleared, never evicted piecemeal)

export class TerrainGroundQuery {
  constructor(map) {
    this.map=map;this.inverse=new Matrix4();this.local=new Vector3();
    this.point=new Vector3();this.world=new Vector3();this.geo=new Vector3();
    this.stats={queries:0,triangles:0,candidates:0,fallbacks:0};
    // WORLD PASS B: fast-path state (untouched while not armed).
    this._stack=[];this._reached=[];this._mapInv=null;this._mapInvKey=null;
    this._batchId=0;this._memo=new Map();this._kids=new Map();this._recs=new Map();this._rootNode=null;this._last=null;this._batchMw=null;this._batchInv=null;
    this._wx=0;this._wz=0;this._bestY=-Infinity;this._bestTile=null;
    this.fastStats={batched:0,memoHits:0,walks:0,reference:0};
    changeGlobal('new query'); // THIRD ROUND: a new map answers from here on
  }
  sample(lon,lat) {
    if(!ARMED)return this.sampleReference(lon,lat);
    return this._sampleFast(lon,lat); // r2: batched or not
  }
  /** The shipped query, verbatim (and the differential test's reference). */
  sampleReference(lon,lat) {
    const map=this.map;
    this.world.copy(map.geo2world(this.geo.set(lon,lat,0)));
    const originY=map.rootTile.scale.z*10000;
    let bestY=-Infinity,bestTile=null,unsupported=false;
    const visit=(object)=>{
      if(object.isTile){
        const b=object.BBox;
        // Ignore height bounds: a refined child's peak can exceed its former
        // coarse parent's peak. The shader's world curvature changes only Y.
        if(this.world.x<b.min.x-1e-6||this.world.x>b.max.x+1e-6||
          this.world.z<b.min.z-1e-6||this.world.z>b.max.z+1e-6)return;
      }
      if(object.isMesh){
        const g=object.geometry,p=g?.attributes?.position,index=g?.index;
        if(!p||!index||p.itemSize!==3||p.isInterleavedBufferAttribute||p.normalized||object.isSkinnedMesh||Object.keys(g.morphAttributes).length){unsupported=true;return;}
        this.inverse.copy(object.matrixWorld).invert();
        const inv=this.inverse.elements;
        // World-down must be local -Z, as in the geographic terrain renderer.
        if(Math.abs(inv[4])>1e-10||Math.abs(inv[5])>1e-10||inv[6]<=0){unsupported=true;return;}
        this.local.copy(this.world).applyMatrix4(this.inverse);
        const x=this.local.x,y=this.local.y;
        if(!g.boundingBox)g.computeBoundingBox();
        const bounds=g.boundingBox;
        if(x<bounds.min.x-1e-10||x>bounds.max.x+1e-10||y<bounds.min.y-1e-10||y>bounds.max.y+1e-10)return;
        const pos=p.array,ids=index.array,range=g.drawRange;
        const grid=index.count>=192?triangleBuckets(g,pos,ids,index.count):null;
        const cellAt=grid?grid.cellOf(x,y):0;
        const inspect=(start,count,material)=>{
          if(!material)return;
          const from=Math.max(start,range.start),end=Math.min(start+count,range.start+range.count,index.count);
          // Bucketed path: the same triangles the scan below would test and
          // could hit, in the same order. Ranges that are not triangle-aligned
          // keep the full scan.
          const bucketed=grid&&from%3===0;
          const first=bucketed?grid.starts[cellAt]:from,last=bucketed?grid.starts[cellAt+1]:end;
          for(let k=first;k<last;k+=bucketed?1:3){
            const i=bucketed?grid.items[k]*3:k;
            if(bucketed&&(i<from||i>=end))continue;
            this.stats.triangles++;
            const a=ids[i]*3,b=ids[i+1]*3,c=ids[i+2]*3;
            const ax=pos[a],ay=pos[a+1],bx=pos[b],by=pos[b+1],cx=pos[c],cy=pos[c+1];
            if(x<Math.min(ax,bx,cx)||x>Math.max(ax,bx,cx)||y<Math.min(ay,by,cy)||y>Math.max(ay,by,cy))continue;
            const determinant=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
            if(determinant===0)continue; // vertical skirts and degenerate faces
            if(material.side!==DoubleSide&&(material.side===BackSide?determinant>0:determinant<0))continue;
            const u=((by-cy)*(x-cx)+(cx-bx)*(y-cy))/determinant;
            const v=((cy-ay)*(x-cx)+(ax-cx)*(y-cy))/determinant;
            if(u<0||v<0||u+v>1)continue;
            this.stats.candidates++;
            const z=u*pos[a+2]+v*pos[b+2]+(1-u-v)*pos[c+2];
            this.point.set(x,y,z).applyMatrix4(object.matrixWorld);
            if(this.point.y<=originY&&this.point.y>bestY){
              bestY=this.point.y;bestTile=object.parent;
              while(bestTile&&!bestTile.isTile)bestTile=bestTile.parent;
            }
          }
        };
        if(Array.isArray(object.material))for(const group of g.groups)inspect(group.start,group.count,object.material[group.materialIndex]);
        else inspect(0,index.count,object.material);
      }
      for(const child of object.children)visit(child);
    };
    this.stats.queries++;visit(map.rootTile);
    if(unsupported){this.stats.fallbacks++;return undefined;}
    if(!bestTile)return null;
    this.point.set(this.world.x,bestY,this.world.z);map.worldToLocal(this.point);
    return {elev:this.point.z,tileZ:bestTile.z,tile:bestTile};
  }

  // --- WORLD PASS B: the exact batched path -----------------------------------
  // (_projectWorld, the unbatched _walk and _recordsOf serve only the walk
  // census in scripts/wp-arrival-ground-diff.cjs --profile.)

  /** geo2world: map local (projected x, y, 0) to world, Vector3.applyMatrix4's arithmetic. */
  _projectWorld(lon, lat, e) {
    const t = this.map.projection.project(lon, lat);
    const x = t.x, y = t.y, z = 0;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    this._wx = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this._wz = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
  }

  /** map.worldToLocal(point(wx, y, wz)).z with a memoised inverse. */
  _elevOf(wx, y, wz, inv) {
    const w = 1 / (inv[3] * wx + inv[7] * y + inv[11] * wz + inv[15]);
    return (inv[2] * wx + inv[6] * y + inv[10] * wz + inv[14]) * w;
  }

  _mapInverse() {
    const e = this.map.matrixWorld.elements;
    if (this._mapInvKey && sameElements(this._mapInvKey, e)) return this._mapInv;
    _m4.copy(this.map.matrixWorld).invert();
    this._mapInvKey = e.slice();
    this._mapInv = _m4.elements.slice();
    return this._mapInv;
  }

  /**
   * The reference's pre-order walk, tile tests only: fills `out` with the
   * meshes it reaches, in visit order. Returns 1 when a reached mesh has
   * children (its own bounds test would then gate them, which this does not
   * model: the caller falls back to the reference), else 0. With `rect`,
   * narrows the safe rectangle (see the header) around (wx, wz).
   * rect = [x >= a, x <= b, x < c, x > d, z >= e, z <= f, z < g, z > h].
   */
  _walk(wx, wz, out, rect) {
    const stack = this._stack;
    stack.length = 0;
    stack.push(this.map.rootTile);
    out.length = 0;
    while (stack.length) {
      const object = stack.pop();
      if (object.isTile) {
        const b = object.BBox;
        const lx = b.min.x - 1e-6, hx = b.max.x + 1e-6, lz = b.min.z - 1e-6, hz = b.max.z + 1e-6;
        if (wx < lx || wx > hx || wz < lz || wz > hz) {
          if (rect) {
            // Keep the far side of the first failed test, strict as tested.
            if (wx < lx) { if (lx < rect[2]) rect[2] = lx; }
            else if (wx > hx) { if (hx > rect[3]) rect[3] = hx; }
            else if (wz < lz) { if (lz < rect[6]) rect[6] = lz; }
            else if (hz > rect[7]) rect[7] = hz;
          }
          continue;
        }
        if (rect) {
          if (lx > rect[0]) rect[0] = lx;
          if (hx < rect[1]) rect[1] = hx;
          if (lz > rect[4]) rect[4] = lz;
          if (hz < rect[5]) rect[5] = hz;
        }
      }
      if (object.isMesh) {
        out.push(object);
        if (object.children.length) return 1;
        continue;
      }
      const ch = object.children;
      for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
    }
    return 0;
  }

  /**
   * Batch-scoped node cache: each expanded node's children with their tile
   * bounds read once per batch (the BBox getter dominates the walk: ~57 box
   * tests a query at Midtown, ~0.2 us each). Same tests, same order as _walk.
   */
  _kidsOf(object) {
    let k = this._kids.get(object);
    if (k) return k;
    const ch = object.children;
    k = new Array(ch.length);
    for (let i = 0; i < ch.length; i++) k[i] = this._nodeOf(ch[i]);
    // r2: only a tile's child list is hooked (GEN); any other node's is read live.
    if (object.isTile) this._kids.set(object, k);
    return k;
  }
  _nodeOf(o) {
    if (!o.isTile) return { o, t: false, m: !!o.isMesh, lx: 0, hx: 0, lz: 0, hz: 0 };
    const b = o.BBox;
    return { o, t: true, m: !!o.isMesh, lx: b.min.x - 1e-6, hx: b.max.x + 1e-6, lz: b.min.z - 1e-6, hz: b.max.z + 1e-6 };
  }
  _walkBatched(wx, wz, out, rect) {
    const stack = this._stack;
    stack.length = 0;
    stack.push(this._rootNode ??= this._nodeOf(this.map.rootTile));
    out.length = 0;
    while (stack.length) {
      const n = stack.pop();
      if (n.t) {
        const lx = n.lx, hx = n.hx, lz = n.lz, hz = n.hz;
        if (wx < lx || wx > hx || wz < lz || wz > hz) {
          if (wx < lx) { if (lx < rect[2]) rect[2] = lx; }
          else if (wx > hx) { if (hx > rect[3]) rect[3] = hx; }
          else if (wz < lz) { if (lz < rect[6]) rect[6] = lz; }
          else if (hz > rect[7]) rect[7] = hz;
          continue;
        }
        if (lx > rect[0]) rect[0] = lx;
        if (hx < rect[1]) rect[1] = hx;
        if (lz > rect[4]) rect[4] = lz;
        if (hz < rect[5]) rect[5] = hz;
      }
      if (n.m) {
        out.push(n.o);
        if (n.o.children.length) return 1;
        continue;
      }
      const kids = this._kidsOf(n.o);
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
    }
    return 0;
  }

  /** Per-mesh record for the triangle test; null = unsupported (reference: undefined). */
  _record(object) {
    const g = object.geometry, p = g?.attributes?.position, index = g?.index;
    if (!p || !index || p.itemSize !== 3 || p.isInterleavedBufferAttribute || p.normalized || object.isSkinnedMesh || hasMorph(g)) return null;
    const inv = inverseOf(object);
    if (Math.abs(inv[4]) > 1e-10 || Math.abs(inv[5]) > 1e-10 || inv[6] <= 0) return null;
    if (!g.boundingBox) g.computeBoundingBox();
    const ids = index.array;
    let tile = object.parent;
    while (tile && !tile.isTile) tile = tile.parent;
    const grid = index.count >= 192 ? triangleBuckets(g, p.array, ids, index.count) : null;
    // The reference resolves (group, material) per query; within a record they
    // are fixed. A range identical to an earlier one (same span, same culling
    // side) can only re-find the same heights, which never win a strict ">",
    // so it is tested once. Only the triangle counter sees the difference.
    const range = g.drawRange, count = index.count, ranges = [];
    const addRange = (start, cnt, material) => {
      if (!material) return;
      const from = Math.max(start, range.start), end = Math.min(start + cnt, range.start + range.count, count);
      const bucketed = !!grid && from % 3 === 0, side = material.side;
      for (const q of ranges) if (q.from === from && q.end === end && q.bucketed === bucketed && q.side === side) { (q.also ??= []).push(material); return; }
      ranges.push({ from, end, bucketed, side, mat: material });
    };
    if (Array.isArray(object.material)) for (const group of g.groups) addRange(group.start, group.count, object.material[group.materialIndex]);
    else addRange(0, count, object.material);
    const b = g.boundingBox;
    const mat = object.material, groups = g.groups;
    return {
      // r2: what the record was built from, re-checked on every use (_validRecord).
      o: object, g, p, pv: p.version, index, iv: index.version, drs: range.start, drc: range.count, bb: b,
      bbx0: b.min.x, bbx1: b.max.x, bby0: b.min.y, bby1: b.max.y, mat, mats: Array.isArray(mat) ? mat.slice() : null,
      groups, gsnap: groups.map((q) => [q.start, q.count, q.materialIndex]), msnap: object.matrixWorld.elements.slice(), parent: object.parent,
      inv, pos: p.array, ids, grid, ranges, tile, mw: object.matrixWorld.elements,
      bx0: b.min.x - 1e-10, bx1: b.max.x + 1e-10, by0: b.min.y - 1e-10, by1: b.max.y + 1e-10,
      gn: grid ? grid.n : 0, gminX: grid ? grid.minX : 0, gminY: grid ? grid.minY : 0, gkx: grid ? grid.kx : 0, gky: grid ? grid.ky : 0,
    };
  }

  /** The reference's mesh branch for one record at one world point. */
  _inspectRecord(r, wx, wz, originY) {
    const inv = r.inv;
    // this.local.copy(world).applyMatrix4(inverse); world y is 0 there.
    const X = wx, Y = 0, Z = wz;
    const w0 = 1 / (inv[3] * X + inv[7] * Y + inv[11] * Z + inv[15]);
    const x = (inv[0] * X + inv[4] * Y + inv[8] * Z + inv[12]) * w0;
    const y = (inv[1] * X + inv[5] * Y + inv[9] * Z + inv[13]) * w0;
    if (x < r.bx0 || x > r.bx1 || y < r.by0 || y > r.by1) return;
    let cellAt = 0;
    if (r.grid) {
      // grid.cellOf(x, y), inlined with the same arithmetic.
      const n = r.gn;
      cellAt = Math.min(n - 1, Math.max(0, Math.floor((y - r.gminY) * r.gky))) * n + Math.min(n - 1, Math.max(0, Math.floor((x - r.gminX) * r.gkx)));
    }
    const ranges = r.ranges;
    for (let q = 0; q < ranges.length; q++) this._inspectRange(r, ranges[q], x, y, cellAt, originY);
  }

  _inspectRange(r, q, x, y, cellAt, originY) {
    const grid = r.grid, pos = r.pos, ids = r.ids, e = r.mw, stats = this.stats;
    const from = q.from, end = q.end, bucketed = q.bucketed, side = q.side;
    const items = bucketed ? grid.items : null;
    const first = bucketed ? grid.starts[cellAt] : from, last = bucketed ? grid.starts[cellAt + 1] : end;
    for (let k = first; k < last; k += bucketed ? 1 : 3) {
      const i = bucketed ? items[k] * 3 : k;
      if (bucketed && (i < from || i >= end)) continue;
      stats.triangles++;
      const a = ids[i] * 3, b = ids[i + 1] * 3, c = ids[i + 2] * 3;
      const ax = pos[a], ay = pos[a + 1], bx = pos[b], by = pos[b + 1], cx = pos[c], cy = pos[c + 1];
      if (x < Math.min(ax, bx, cx) || x > Math.max(ax, bx, cx) || y < Math.min(ay, by, cy) || y > Math.max(ay, by, cy)) continue;
      const determinant = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (determinant === 0) continue;
      if (side !== DoubleSide && (side === BackSide ? determinant > 0 : determinant < 0)) continue;
      const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / determinant;
      const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / determinant;
      if (u < 0 || v < 0 || u + v > 1) continue;
      stats.candidates++;
      const z = u * pos[a + 2] + v * pos[b + 2] + (1 - u - v) * pos[c + 2];
      // this.point.set(x, y, z).applyMatrix4(object.matrixWorld).y
      const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
      const py = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
      if (py <= originY && py > this._bestY) {
        this._bestY = py;
        this._bestTile = r.tile;
      }
    }
  }

  /** Records for the reached meshes, or null when one is unsupported. */
  _recordsOf(reached, into) {
    into.length = 0;
    for (let i = 0; i < reached.length; i++) {
      const r = this._record(reached[i]);
      if (!r) return null;
      into.push(r);
    }
    return into;
  }

  /** _recordsOf with one record per mesh per batch. */
  _recordsBatched(reached) {
    const into = [];
    for (let i = 0; i < reached.length; i++) {
      const o = reached[i];
      let r = this._recs.get(o);
      if (r === undefined) { r = this._record(o); this._recs.set(o, r); }
      if (!r) return null;
      into.push(r);
    }
    return into;
  }

  _finish(records, wx, wz, inv, originY = this.map.rootTile.scale.z * 10000) {
    this._bestY = -Infinity;
    this._bestTile = null;
    for (let i = 0; i < records.length; i++) this._inspectRecord(records[i], wx, wz, originY);
    const tile = this._bestTile;
    if (!tile) return null;
    return { elev: this._elevOf(wx, this._bestY, wz, inv), tileZ: tile.z, tile };
  }

  /** r2: is a mesh record still what the mesh is? (every input of the triangle test) */
  _validRecord(r) {
    const o = r.o, g = o.geometry;
    if (g !== r.g || o.parent !== r.parent) return false;
    const p = g.attributes.position, index = g.index;
    if (p !== r.p || p.version !== r.pv || p.array !== r.pos || index !== r.index || index.version !== r.iv || index.array !== r.ids) return false;
    const range = g.drawRange;
    if (range.start !== r.drs || range.count !== r.drc) return false;
    const b = g.boundingBox;
    if (b !== r.bb || b.min.x !== r.bbx0 || b.max.x !== r.bbx1 || b.min.y !== r.bby0 || b.max.y !== r.bby1) return false;
    const mat = o.material;
    if (mat !== r.mat) return false;
    if (r.mats) {
      if (mat.length !== r.mats.length) return false;
      for (let i = 0; i < mat.length; i++) if (mat[i] !== r.mats[i]) return false;
      const gs = g.groups;
      if (gs !== r.groups || gs.length !== r.gsnap.length) return false;
      for (let i = 0; i < gs.length; i++) { const q = gs[i], w = r.gsnap[i]; if (q.start !== w[0] || q.count !== w[1] || q.materialIndex !== w[2]) return false; }
    }
    for (const q of r.ranges) {
      if (q.mat.side !== q.side) return false;
      if (q.also) for (const m of q.also) if (m.side !== q.side) return false;
    }
    const e = o.matrixWorld.elements, m = r.msnap;
    for (let i = 0; i < 16; i++) if (e[i] !== m[i]) return false;
    return true;
  }

  _resetMemo() {
    this._memo.clear();
    this._kids = new Map();
    this._recs = new Map();
    this._rootNode = null;
    this._last = null;
  }

  /**
   * Exact, memoised: one walk per safe rectangle (see the header), kept until
   * the tree changes (r2). Inside a batch the per-query checks run once.
   */
  _sampleFast(lon, lat) {
    const map = this.map, F = this.fastStats;
    F.batched++;
    if (!(BATCH_DEPTH > 0 && this._batchId === BATCH_ID)) {
      if (BATCH_DEPTH > 0) this._batchId = BATCH_ID;
      if (CH_Q !== this) { CH_Q = this; changeGlobal('query'); } // THIRD ROUND: the answering map
      if (!this._hooked) { this._hooked = hookTree(map); if (this._hooked) changeGlobal('hooked'); }
      if (!this._hooked) { F.reference++; return this.sampleReference(lon, lat); }
      // The reference's geo2world brings the map's world matrix current first.
      map.updateWorldMatrix(true, false);
      const me = map.matrixWorld.elements;
      if (!this._batchMw || !sameElements(this._batchMw, me)) {
        this._batchMw = me.slice();
        this._batchInv = this._mapInverse().slice();
      }
      const root = map.rootTile, re = root.matrixWorld.elements;
      if (GEN !== this._gen || root !== this._rootObj || map.projection !== this._batchProj || !this._rootMw || !sameElements(this._rootMw, re) || this._memo.size > MAX_MEMO_CELLS) {
        // THIRD ROUND: a new root, projection or root matrix moves every answer
        if (this._rootMw && (root !== this._rootObj || map.projection !== this._batchProj || !sameElements(this._rootMw, re))) changeGlobal('root');
        this._resetMemo();
        this._gen = GEN;
        this._rootObj = root;
        this._rootMw = re.slice();
        this._batchProj = map.projection;
        F.resets = (F.resets ?? 0) + 1;
      }
      this._batchOriginY = root.scale.z * 10000;
      this._validate = true;
    }
    // geo2world with the current (validated) projection and matrix.
    const t = this._batchProj.project(lon, lat), e = this._batchMw;
    const x = t.x, y = t.y, z = 0;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    const wx = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    const wz = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    if (!Number.isFinite(wx) || !Number.isFinite(wz)) { F.reference++; return this.sampleReference(lon, lat); }
    let entry = this._last, r = entry?.rect;
    if (!(r && wx >= r[0] && wx <= r[1] && wx < r[2] && wx > r[3] && wz >= r[4] && wz <= r[5] && wz < r[6] && wz > r[7])) {
      entry = null;
      const key = Math.floor(wx / CELL) * CELL_K + Math.floor(wz / CELL);
      const list = this._memo.get(key);
      if (list) {
        for (let i = 0; i < list.length; i++) {
          r = list[i].rect;
          if (wx >= r[0] && wx <= r[1] && wx < r[2] && wx > r[3] && wz >= r[4] && wz <= r[5] && wz < r[6] && wz > r[7]) { entry = list[i]; break; }
        }
      }
      if (!entry) {
        F.walks++;
        const rect = [-Infinity, Infinity, Infinity, -Infinity, -Infinity, Infinity, Infinity, -Infinity];
        const reached = [];
        if (this._walkBatched(wx, wz, reached, rect)) { F.reference++; return this.sampleReference(lon, lat); }
        entry = { rect, meshes: reached, records: this._recordsBatched(reached), seen: -1 };
        // File the entry under every memo cell its rectangle covers (bounded).
        const i0 = Math.floor(Math.max(rect[0], rect[3]) / CELL), i1 = Math.floor(Math.min(rect[1], rect[2]) / CELL);
        const j0 = Math.floor(Math.max(rect[4], rect[7]) / CELL), j1 = Math.floor(Math.min(rect[5], rect[6]) / CELL);
        const memo = this._memo;
        const add = (k) => { const l = memo.get(k); if (l) l.push(entry); else memo.set(k, [entry]); };
        if (Number.isFinite(i0 + i1 + j0 + j1) && (i1 - i0 + 1) * (j1 - j0 + 1) <= MAX_CELLS_PER_ENTRY) {
          for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) add(i * CELL_K + j);
        } else add(key);
      } else F.memoHits++;
      this._last = entry;
    } else F.memoHits++;
    // r2: the reached meshes' records, re-checked once per query outside a batch
    // (once per batch inside one), rebuilt when a mesh changed under them.
    if (entry.records && (this._validate || entry.seen !== this._batchId)) {
      const recs = entry.records;
      for (let i = 0; i < recs.length; i++) {
        if (this._validRecord(recs[i])) continue;
        F.recordRebuilds = (F.recordRebuilds ?? 0) + 1;
        const o = recs[i].o, nr = this._record(o);
        changeTile(tileOf(o)); // THIRD ROUND: an edit nothing announced, found on use
        this._recs.set(o, nr);
        if (!nr) { entry.records = null; break; }
        recs[i] = nr;
      }
      entry.seen = BATCH_DEPTH > 0 ? this._batchId : -1;
    } else if (!entry.records && entry.meshes) {
      // A mesh that was unsupported may have become supported (a new geometry).
      const recs = this._recordsFresh(entry.meshes);
      if (recs) { entry.records = recs; for (const o of entry.meshes) changeTile(tileOf(o)); } // THIRD ROUND
    }
    this._validate = BATCH_DEPTH === 0;
    this.stats.queries++;
    if (!entry.records) { this.stats.fallbacks++; return undefined; }
    return this._finish(entry.records, wx, wz, this._batchInv, this._batchOriginY);
  }

  /** Fresh records for the meshes (r2: an entry whose mesh was unsupported). */
  _recordsFresh(reached) {
    const into = [];
    for (let i = 0; i < reached.length; i++) {
      const o = reached[i], r = this._record(o);
      this._recs.set(o, r);
      if (!r) return null;
      into.push(r);
    }
    return into;
  }
}
TerrainGroundQuery.prototype._sampleBatched = TerrainGroundQuery.prototype._sampleFast; // the r1 probes' name
// WORLD PASS B: reachable from a live page through any query instance
// (`runtime.engine._groundQuery.constructor`), for the differential probe.
TerrainGroundQuery.beginBatch = beginGroundBatch;
TerrainGroundQuery.endBatch = endGroundBatch;
TerrainGroundQuery.armed = fastGroundQueryArmed;
TerrainGroundQuery.generation = () => GEN; // r2 (diagnostics)
TerrainGroundQuery.inBatch = () => BATCH_DEPTH > 0; // r2 (diagnostics)
TerrainGroundQuery.batchSerial = () => BATCH_ID; // r2 (diagnostics)
