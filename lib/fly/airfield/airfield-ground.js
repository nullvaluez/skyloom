// AIRFIELD GROUND — the observed airport's ground as one imperative set:
// data → model → height field → meshes + lights, then per-frame sampling,
// light placement, day/night and the hand-over from the older layers.
//
//   const set = new AirfieldGroundSet({ runtime, site, anisotropy });
//   parent.add(set.group);  set.overlays() -> unregister[]   (sky-overlay lights)
//   set.update(state, time)  every frame;  set.dispose()  on unmount
//
// The group sits at the lounge site's scene position with scale (k, 1, k), so
// every buffer is local metres (airfield-model.js) and the absolute
// elevation is the only large number (y). Mounted inside worldRoot: the
// -anchor rebase is the parent's.
//
// Draws (High, steady state): grass, pavement, runways, paint + two GlowPoints
// sets = 6. Textures: the height field (R32F), the designator atlas (RGBA8 +
// mips), the imagery colour (RGBA8 + mips) — a few MiB at most.
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  DataTexture,
  FloatType,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  UnsignedByteType,
  Mesh,
  NearestFilter,
  RedFormat,
  Sphere,
  SRGBColorSpace,
  Matrix4,
  Vector3,
} from 'three';
import { GlowPoints } from '../glow-points';
import { getR25Sky } from '../r25-sky';
import { AIRFIELD } from '../observation-config';
import { airportRunways, loadAirfieldFeatures } from './airfield-data';
import { buildAirfieldModel, runwayPoint } from './airfield-model';
import { buildGrassGeometry, buildPaintGeometry, buildPavementGeometry, buildRunwayGeometry, clipToFacets } from './airfield-geometry';
import { buildGrassField } from './airfield-grass';
import { AirfieldHeightField, airfieldGrid, drawnCells } from './airfield-height';
import { airfieldLightLevel, buildAirfieldLights, papiColor } from './airfield-lights';
import { createAirfieldUniforms, createGrassMaterial, createPaintMaterial, createPavementMaterial, createRunwayMaterial, patchAirfieldMaterial } from './airfield-materials';
import { createGlyphAtlas, designatorGlyphs } from './airfield-glyphs';
import { buildPavementInfo, grassTone, loadAirfieldPhoto, photoLumaSampler, photoRgbSampler } from './airfield-photo';
import { setAirfieldSuppression } from './airfield-suppression';
import { airportLayout } from '../airport-layout';
import { siteToWorld } from '../lounge-site';

const CFG = AIRFIELD.ground;
const R = 6378137;
// groundAt(): the lift of the highest layer drawn on a cell (drawnCells codes).
const GROUND_LIFT = [0, CFG.lift.grass, CFG.lift.pavement, CFG.lift.runway];
const nextFrame = () => new Promise((r) => setTimeout(r, 0));

function upNormals(count) {
  const n = new Float32Array(count * 3);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  return new BufferAttribute(n, 3);
}

export class AirfieldGroundSet {
  constructor({ runtime, site, anisotropy = 8 }) {
    this.runtime = runtime;
    this.site = site;
    this.anisotropy = anisotropy;
    this.group = new Group();
    this.group.name = 'airfield-ground';
    this.group.position.set(site.x, 0, site.z);
    this.group.scale.set(site.k, 1, site.k);
    this.abort = new AbortController();
    this.uniforms = createAirfieldUniforms();
    this.disposables = [];
    this.meshes = {};
    this.glows = [];
    this.overlayOff = [];
    this.lights = [];
    this.lightVersion = -1;
    this.lightCheckAt = 0;
    this.uploadAt = 0;
    this.uploadedVersion = -1;
    this.state = 'loading';
    this.disposed = false;
    this.wantOverlay = false;
    this.stats = { state: 'loading', ident: site.ident, draws: 0, triangles: 0, textureMiB: 0, lights: 0, buildMs: 0, data: null, height: null };
    this.ready = this._start().catch((e) => {
      if (this.disposed) return;
      this.state = 'error';
      this.stats.state = 'error';
      this.stats.error = String(e?.message ?? e);
      if (process.env.NODE_ENV === 'development') console.warn('[airfield-ground]', e);
    });
  }

  async _start() {
    const { site } = this;
    const ident = site.ident;
    let data = null;
    try {
      data = await loadAirfieldFeatures(site, { signal: this.abort.signal, padM: CFG.dataPadM });
    } catch (e) {
      if (this.disposed || e?.name === 'AbortError') return;
      this.stats.dataError = String(e?.message ?? e);
    }
    if (this.disposed) return;
    this.data = data;
    this.stats.data = data && {
      tiles: data.tiles,
      runwayLines: data.runwayLines.length,
      taxiwayLines: data.taxiwayLines.length,
      pavements: data.pavements.length,
      aerodromes: data.aerodromes.length,
      gates: data.gates.length,
      buildings: data.buildings.length,
      roads: data.roads.length,
      cover: data.cover.length,
    };
    const t0 = performance.now();
    const registry = airportRunways(ident);
    const model = buildAirfieldModel({ data, registry, origin: { x: site.x, z: site.z }, ident, k: site.k });
    this.model = model;
    this._addSetApron(model);
    // Geometry, every layer cut along the height field's facets
    // (clipToFacets: each layer is then exactly the field plus its lift).
    // The facets set the triangle count, so a big airport takes a coarser
    // grid until the layers fit the budget.
    let grid = null, layers = null;
    for (let stepM = CFG.grid.stepM, tries = 0; tries < 4; tries++, stepM = grid.step * 1.25) {
      grid = airfieldGrid(model.extent, { ...CFG.grid, stepM });
      layers = await this._buildLayers(model, grid, data);
      if (!layers) return; // disposed meanwhile
      if (layers.triangles <= CFG.budget.triangles) break;
    }
    const { pave, rwy, paint, field, grass } = layers;
    // Height field over everything drawn or lit.
    this.heights = new AirfieldHeightField(grid);
    const u = this.uniforms;
    const tex = new DataTexture(this.heights.data, grid.nx, grid.nz, RedFormat, FloatType);
    tex.minFilter = tex.magFilter = NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    tex.name = 'airfield-height';
    this.heightTexture = tex;
    this.disposables.push(tex);
    u.uAfHeight.value = tex;
    u.uAfGrid.value.set(grid.x0, grid.z0, 1 / grid.step, 0);
    u.uAfSize.value.set(grid.nx, grid.nz);
    await nextFrame();
    if (this.disposed) return;
    // Runway parameters for the marking shader, the airport grid direction
    // (longest runway) for concrete slabs and mowing stripes.
    const main = model.runways[0];
    const dirX = main ? main.ux : 1, dirZ = main ? main.uz : 0;
    u.uAfSlab.value.set(dirX, dirZ, 7.5, model.aClass);
    u.uAfMow.value.set(dirX, dirZ, 9, this._seasonDryness());
    for (const r of model.runways) {
      const ga = designatorGlyphs(r.desA, model.style);
      const gb = designatorGlyphs(r.desB, model.style);
      u.uAfRwyA.value[r.index].set(r.length, r.halfW, r.thrA, r.thrB);
      u.uAfRwyB.value[r.index].set(ga[0], ga[1], ga[2], model.style === 'icao' ? 1 : 0);
      u.uAfRwyC.value[r.index].set(gb[0], gb[1], gb[2], 0);
      // D.z = the runway's imagery reference luminance, set once the photo is measured.
      u.uAfRwyD.value[r.index].set(r.shoulder, r.cls === 0 ? 2 : r.cls === 1 ? 1 : 0, 0, r.lighted ? 1 : 0);
    }
    if (typeof document !== 'undefined') {
      const glyphs = createGlyphAtlas(this.anisotropy);
      this.disposables.push(glyphs);
      u.uAfGlyphs.value = glyphs;
    }
    const lift = CFG.lift;
    const groundY = registry.length ? (registry[0].a.elevation + registry[0].b.elevation) / 2 : 0;
    const sphere = new Sphere(new Vector3((grid.x0 * 2 + (grid.nx - 1) * grid.step) / 2, groundY, (grid.z0 * 2 + (grid.nz - 1) * grid.step) / 2), Math.hypot(grid.nx * grid.step, grid.nz * grid.step) / 2 + 200);
    const make = (name, g, attrs, material, renderOrder) => {
      if (!g.triangles) return null;
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(g.position, 3));
      geo.setAttribute('normal', upNormals(g.vertices));
      for (const [key, attr, size] of attrs) geo.setAttribute(attr, new BufferAttribute(g[key], size));
      geo.setIndex(new BufferAttribute(g.index, 1));
      geo.boundingSphere = sphere.clone();
      patchAirfieldMaterial(material, name);
      const mesh = new Mesh(geo, material);
      mesh.name = `airfield:${name}`;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.renderOrder = renderOrder;
      this.group.add(mesh);
      this.disposables.push(geo, material);
      this.meshes[name] = mesh;
      return mesh;
    };
    // Reverse-Z in three r185 reverses the sorted render lists, so among the
    // transparent layers the HIGHER renderOrder draws first: grass before paint.
    make('grass', grass, [['grass', 'aGrass', 2]], createGrassMaterial(u, lift.grass), -1);
    make('pavement', pave, [['surf', 'aSurf', 3]], createPavementMaterial(u, lift.pavement), 0);
    this.pave = pave;
    this.grassField = field;
    this.grid = grid;
    // The cells this set draws over (groundAt answers only there): 1 grass,
    // 2 pavement, 3 runway — the index into GROUND_LIFT.
    this.drawn = drawnCells(grid, [[grass, 1], [pave, 2], [rwy, 3]]);
    this._pavementInfo(null); // the surface classes now, the imagery once loaded
    make('runway', rwy, [['rwy', 'aRwy', 3]], createRunwayMaterial(u, lift.runway), 0);
    make('paint', paint, [['paint', 'aPaint', 4]], createPaintMaterial(u, lift.paint), -2);
    for (const m of Object.values(this.meshes)) m.visible = false; // until the field is known
    this.geometryStats = { grass: grass.triangles, pavement: pave.triangles, runway: rwy.triangles, paint: paint.triangles, gridStepM: +grid.step.toFixed(2), grassCellsKept: grass.cellsKept, grassCellsWanted: grass.cellsWanted, coverTiles: field.coverTiles };
    // Lights.
    const paved = (x, z) => {
      for (const r of model.runways) {
        const q = { s: (x - r.ax) * r.ux + (z - r.az) * r.uz, c: (x - r.ax) * r.uz - (z - r.az) * r.ux };
        if (Math.abs(q.c) < r.halfW + r.shoulder + 2 && q.s > -5 && q.s < r.length + 5) return true;
      }
      return false;
    };
    this.lights = buildAirfieldLights(model, { viewer: { x: 0, z: 0 }, paved });
    this._createGlows();
    this.stats.buildMs = Math.round(performance.now() - t0);
    this._startTerrain();
    this.state = 'sampling';
    this.stats.state = 'sampling';
    // Suppression disc: everything the model draws.
    const e = model.extent;
    const cx = (e.minX + e.maxX) / 2, cz = (e.minZ + e.maxZ) / 2;
    this.suppression = {
      ident,
      x: site.x + cx * site.k,
      z: site.z + cz * site.k,
      radius: (Math.hypot(e.maxX - e.minX, e.maxZ - e.minZ) / 2) * site.k,
      runwayIds: model.runways.map((r) => r.id),
    };
    // Imagery colour in the background.
    this._loadPhoto(grid);
  }

  /**
   * The airport set (lib/fly/airport-set) parks its stands on the apron
   * rectangle of airportLayout(site), wherever OSM says the apron is: pave
   * that rectangle with concrete so its markings sit on concrete, not on the
   * photographed aircraft of the imagery.
   */
  _addSetApron(model) {
    const set = CFG.setApron;
    if (!set?.enabled) return;
    let layout = null;
    try {
      layout = this.runtime.airportSet?.layout ?? airportLayout(this.site);
    } catch {
      layout = null;
    }
    const a = layout?.apron;
    if (!a || !(a.x1 > a.x0 && a.z1 > a.z0)) return;
    const { site } = this;
    this.setApronRect = { ...a };
    const ring = [];
    for (const [lx, lz] of [[a.x0, a.z0], [a.x1, a.z0], [a.x1, a.z1], [a.x0, a.z1]]) {
      const w = siteToWorld(site, lx, lz);
      ring.push((w.x - site.x) / site.k, (w.z - site.z) / site.k);
    }
    model.pavements.push({ id: 'airport-set-apron', cls: 'apron', ref: null, rings: [ring], concrete: 1 });
  }

  /** The four layers' buffers on one grid (yielding between them); null once disposed. */
  async _buildLayers(model, grid, data) {
    const pave = clipToFacets(buildPavementGeometry(model), [['surf', 3]], grid);
    await nextFrame();
    if (this.disposed) return null;
    const rwy = clipToFacets(buildRunwayGeometry(model), [['rwy', 3]], grid);
    const paint = clipToFacets(buildPaintGeometry(model), [['paint', 4]], grid);
    await nextFrame();
    if (this.disposed) return null;
    const field = buildGrassField(model, grid, data?.cover ?? []);
    const grass = clipToFacets(buildGrassGeometry(grid, field.field, field.dry, { maxCells: CFG.grass.maxCells, focus: { x: 0, z: 0 } }), [['grass', 2]], grid);
    await nextFrame();
    if (this.disposed) return null;
    return { pave, rwy, paint, field, grass, triangles: pave.triangles + rwy.triangles + paint.triangles + grass.triangles };
  }

  _seasonDryness() {
    // Mid-latitude grass is greenest early summer and driest late summer to
    // winter; the imagery tint (when loaded) carries the real thing.
    const lat = Math.atan(Math.sinh(-this.site.z / R)) * (180 / Math.PI);
    const now = new Date();
    const day = (now - new Date(now.getFullYear(), 0, 0)) / 864e5;
    const phase = lat >= 0 ? day - 172 : day - 355;
    return Math.abs(lat) < 15 ? 0.1 : 0.06 + 0.12 * (1 - Math.cos((phase / 365) * 2 * Math.PI)) / 2;
  }

  _createGlows() {
    const steady = this.lights.filter((l) => l.set === 'steady');
    const flash = this.lights.filter((l) => l.set !== 'steady');
    const sets = [
      // A high-intensity runway light is a hard bright point at 2 km, not a
      // fading speck: the sprites keep more energy as they shrink past minPx
      // (lower energyPow, a higher floor) and carry a wider halo.
      { name: 'airfield-lights', list: steady, opts: { energyPow: 0.6, energyFloor: 0.32, core: 9, halo: 0.85, cloudFloor: 0.3, pullM: 1.0 } },
      { name: 'airfield-flashers', list: flash, opts: { energyPow: 0.5, energyFloor: 0.42, core: 8, halo: 0.95, cloudFloor: 0.35, pullM: 1.2 } },
    ];
    const k = this.site.k;
    for (const { name, list, opts } of sets) {
      if (!list.length) continue;
      const glow = new GlowPoints({ capacity: list.length, name, ...opts });
      list.forEach((l, i) => {
        let beam = null;
        if (l.beam) {
          const bx = l.beam[0] * k, by = l.beam[1], bz = l.beam[2] * k;
          const n = Math.hypot(bx, by, bz) || 1;
          beam = [bx / n, by / n, bz / n];
        }
        // Parked far below until the height field knows the spot.
        const L = CFG.lights;
        glow.set(i, l.x, -1e4, l.z, l.r, l.g, l.b, 0, { size: l.size * L.sizeK, minPx: l.minPx * L.minPxK, maxPx: l.maxPx, hz: l.hz, phase: l.phase, duty: l.duty, mode: l.mode, beam, sharp: l.sharp });
      });
      glow.setCount(list.length);
      glow.mesh.visible = false;
      this.group.add(glow.mesh);
      this.glows.push({ glow, list, flash: name !== 'airfield-lights' });
    }
    if (this.wantOverlay) this._registerOverlays();
  }

  /** Register the light sets with the sky-overlay pass. Returns the unregister. */
  overlays() {
    this.wantOverlay = true;
    this._registerOverlays();
    return () => {
      this.wantOverlay = false;
      for (const off of this.overlayOff) off();
      this.overlayOff = [];
    };
  }

  _registerOverlays() {
    for (const { glow } of this.glows) {
      if (glow.__overlay) continue;
      glow.__overlay = true;
      this.overlayOff.push(glow.overlay());
    }
  }

  async _loadPhoto(grid) {
    try {
      const bounds = { minX: grid.x0, minZ: grid.z0, maxX: grid.x0 + (grid.nx - 1) * grid.step, maxZ: grid.z0 + (grid.nz - 1) * grid.step };
      const photo = await loadAirfieldPhoto(this.model.frame, bounds, { signal: this.abort.signal });
      if (!photo || this.disposed) return;
      const tex = new CanvasTexture(photo.canvas);
      tex.colorSpace = SRGBColorSpace;
      tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
      tex.minFilter = LinearMipmapLinearFilter;
      tex.magFilter = LinearFilter;
      tex.generateMipmaps = true;
      tex.name = 'airfield-photo';
      this.disposables.push(tex);
      const u = this.uniforms;
      u.uAfPhoto.value = tex;
      u.uAfPhotoBounds.value.set(bounds.minX, bounds.minZ, 1 / (bounds.maxX - bounds.minX), 1 / (bounds.maxZ - bounds.minZ));
      u.uAfPhotoOn.value = 1;
      this.photo = photo;
      this._classifyRunwaySurfaces(photo, bounds);
      // Measure the imagery once: which taxiways/aprons are concrete, their
      // tone, and the grass field's median brightness.
      await nextFrame();
      if (this.disposed) return;
      this._pavementInfo(photoLumaSampler(photo));
      const tone = this.grassField ? grassTone(this.grid, this.grassField.field, photoRgbSampler(photo)) : null;
      if (tone) u.uAfGrassTone.value.set(tone[0], tone[1], tone[2], 0.6);
      this.grassTone = tone;
    } catch {
      /* the palette stands */
    }
  }

  /**
   * The pavement appearance field (airfield-photo.js buildPavementInfo):
   * concrete weight and imagery level per height-grid node, as a linear
   * filtered RGBA8 texture the pavement shader reads by position.
   */
  _pavementInfo(lumaAt) {
    if (!this.pave || !this.grid) return;
    const { site } = this;
    const rect = this.setApronRect;
    const c = Math.cos(site.heading), s = Math.sin(site.heading);
    // Inside the airport set's apron rectangle (room frame): concrete.
    const forceConcrete = rect
      ? (x, z) => {
          const rx = x * c - z * s, rz = x * s + z * c;
          return rx >= rect.x0 && rx <= rect.x1 && rz >= rect.z0 && rz <= rect.z1;
        }
      : null;
    const t0 = performance.now();
    const info = buildPavementInfo(this.grid, this.pave, { lumaAt, aClass: this.model.aClass, forceConcrete });
    let tex = this.paveTexture;
    if (!tex) {
      tex = new DataTexture(info.data, this.grid.nx, this.grid.nz, RGBAFormat, UnsignedByteType);
      tex.minFilter = tex.magFilter = LinearFilter;
      tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.name = 'airfield-pavement-info';
      this.paveTexture = tex;
      this.disposables.push(tex);
    } else tex.image.data.set(info.data);
    tex.needsUpdate = true;
    this.uniforms.uAfPave.value = tex;
    this.uniforms.uAfPaveOn.value = 1;
    this.paveInfoStats = { paved: info.paved, photo: !!lumaAt, ms: Math.round(performance.now() - t0) };
  }

  /** Concrete or asphalt per runway, from the photo's brightness along it. */
  _classifyRunwaySurfaces(photo, bounds) {
    const ctx = photo.canvas.getContext('2d', { willReadFrequently: true });
    const W = photo.canvas.width, H = photo.canvas.height;
    for (const r of this.model.runways) {
      let sum = 0, n = 0;
      for (let s = r.length * 0.15; s < r.length * 0.85; s += r.length / 24) {
        for (const c of [-r.halfW * 0.5, r.halfW * 0.5]) {
          const [x, z] = runwayPoint(r, s, c);
          const px = Math.floor(((x - bounds.minX) / (bounds.maxX - bounds.minX)) * W);
          const pz = Math.floor(((z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * H);
          if (px < 0 || pz < 0 || px >= W || pz >= H) continue;
          const d = ctx.getImageData(px, pz, 1, 1).data;
          sum += (0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]) / 255;
          n++;
        }
      }
      const luma = n ? sum / n : 0;
      r.surfaceLuma = luma;
      this.uniforms.uAfRwyC.value[r.index].w = luma > 0.47 ? 1 : 0;
      // The runway's own imagery level: the shader follows its local tone.
      this.uniforms.uAfRwyD.value[r.index].z = luma > 0 ? (luma <= 0.04045 ? luma / 12.92 : ((luma + 0.055) / 1.055) ** 2.4) : 0;
    }
  }

  _sceneToLocal(x, z) {
    return [(x - this.site.x) / this.site.k, (z - this.site.z) / this.site.k];
  }

  /** Height of the drawn surface layer at a SCENE point, or null. */
  surfaceY(x, z, layer = 'pavement') {
    if (!this.heights) return null;
    const [lx, lz] = this._sceneToLocal(x, z);
    const h = this.heights.heightAt(lx, lz);
    return h == null ? null : h + (CFG.lift[layer] ?? CFG.lift.pavement);
  }

  /**
   * The terrain engine's ground provider while this set is mounted
   * (TerrainEngine.setGroundProvider; AirfieldGround.jsx registers it): where
   * this set draws grass, pavement or a runway the ground IS that layer's
   * surface — the field's envelope sits up to a few decimetres above the DEM
   * triangles — so the airport set's markings and vehicles, parked and
   * taxiing aircraft and the lounge floor stand on what is drawn. Elsewhere
   * (and before the field's first build) null: the engine answers as before.
   * `x, z` are ABSOLUTE scene metres.
   */
  groundAt(x, z) {
    const g = this.grid, drawn = this.drawn;
    if (!drawn || !this.heights?.ready) return null;
    const lx = (x - this.site.x) / this.site.k, lz = (z - this.site.z) / this.site.k;
    const i = Math.floor((lx - g.x0) / g.step), j = Math.floor((lz - g.z0) / g.step);
    if (!(i >= 0 && j >= 0 && i < g.nx - 1 && j < g.nz - 1)) return null;
    const code = drawn[j * (g.nx - 1) + i];
    if (!code) return null;
    const h = this.heights.heightAt(lx, lz);
    // The zoom of the terrain the field was built from there: callers gate on
    // it as on a DEM sample (the lounge floor waits for z12, the airport set
    // re-samples until z16), so a field still built on a coarse tile is not
    // taken for the refined ground.
    return h == null ? null : { elev: h + GROUND_LIFT[code], tileZ: this.heights.zoomAt(lx, lz) };
  }

  _placeLights() {
    const lift = CFG.lift;
    for (const { glow, list } of this.glows) {
      let moved = false;
      list.forEach((l, i) => {
        const h = this.heights.heightAt(l.x, l.z);
        if (h == null) {
          glow.move(i, l.x, -1e4, l.z);
          glow.dim(i, 0);
        } else {
          glow.move(i, l.x, h + (l.layer === 'grass' ? lift.grass : lift.runway) + l.h, l.z);
          glow.dim(i, l.i);
        }
        moved = true;
      });
      if (moved) glow.touch(true, false, true);
    }
  }

  /** Per frame. `state` is R3F's frame state. */
  update(state, time) {
    if (this.disposed || !this.heights) return;
    const rt = this.runtime;
    const engine = rt.engine;
    const now = performance.now();
    // 1. Keep the height field on the drawn terrain (airfield-height.js).
    this._pumpTerrain(now);
    const hv = this.heights.version;
    if (hv !== this.uploadedVersion && now - this.uploadAt > 1000 / CFG.terrain.uploadHz) {
      this.heightTexture.needsUpdate = true;
      this.uploadedVersion = hv;
      this.uploadAt = now;
    }
    if (this.heights.ready && this.state === 'sampling') {
      this.state = 'ready';
      this.stats.state = 'ready';
      for (const m of Object.values(this.meshes)) m.visible = true;
      for (const { glow } of this.glows) glow.mesh.visible = true;
      setAirfieldSuppression(this.suppression);
      this.suppressing = true;
    }
    // 2. Lights follow the field (at most twice a second).
    if (this.glows.length && hv !== this.lightVersion && now - this.lightCheckAt > 500) {
      this.lightVersion = hv;
      this.lightCheckAt = now;
      this._placeLights();
    }
    // 3. Day / night, haze, PAPI colours.
    const sinEl = rt.sun?.sinEl;
    const elev = Number.isFinite(sinEl) ? (Math.asin(Math.max(-1, Math.min(1, sinEl))) * 180) / Math.PI : -90;
    const level = airfieldLightLevel(elev);
    const sky = getR25Sky();
    const exposure = sky?.live && Number.isFinite(sky.exposure) ? sky.exposure : 1;
    const visM = rt.weather?.wx?.visM;
    const extinction = Number.isFinite(visM) && visM > 0 ? 3 / Math.max(800, visM) : 1 / 45000;
    this.uniforms.uAfTime.value = time;
    this.uniforms.uAfNight.value = level;
    const cam = state.camera;
    const heightPx = state.gl.domElement.height || state.size.height;
    for (const { glow, list, flash } of this.glows) {
      if (!this.heights.ready) {
        glow.mesh.visible = false;
        continue;
      }
      const gain = (flash ? Math.max(level, CFG.lights.flasherDayFloor) : Math.max(level, CFG.lights.dayFloor)) * CFG.lights.gain * exposure;
      glow.update(cam, heightPx, time, gain, extinction);
      if (flash && gain > 0) this._papi(glow, list, cam);
    }
    this._publish(level);
  }

  _papi(glow, list, cam) {
    const anchor = this.runtime.origin?.anchor ?? { x: 0, z: 0 };
    const [ex, ez] = this._sceneToLocal(cam.position.x + anchor.x, cam.position.z + anchor.z);
    const ey = cam.position.y;
    const col = [0, 0, 0];
    let dirty = false;
    list.forEach((l, i) => {
      if (!l.papi) return;
      const y = glow.center.getY(i);
      const dx = ex - l.x, dz = ez - l.z;
      // Elevation angle in the approach's vertical plane (distance along the
      // beam axis; off-axis the beam itself dims the unit).
      const d = Math.max(1, dx * l.papi.dirX + dz * l.papi.dirZ);
      const deg = (Math.atan2(ey - y, d) * 180) / Math.PI;
      papiColor(deg, l.papi.angle, col);
      if (Math.abs(glow.color.getX(i) - col[0]) + Math.abs(glow.color.getY(i) - col[1]) > 0.02) {
        glow.color.setXYZ(i, col[0], col[1], col[2]);
        dirty = true;
      }
    });
    if (dirty) glow.color.needsUpdate = true;
  }

  _publish(level) {
    const s = this.stats;
    let draws = 0, tris = 0;
    for (const m of Object.values(this.meshes)) if (m.visible) {
      draws++;
      tris += m.geometry.index.count / 3;
    }
    for (const { glow } of this.glows) if (glow.mesh.visible) {
      draws++;
      tris += glow.count * 2;
    }
    s.draws = draws;
    s.triangles = tris;
    s.lights = this.lights.length;
    s.level = +level.toFixed(3);
    s.height = { ...this.heights.stats, ...this.terrainStats, ready: this.heights.ready, nx: this.heights.nx, nz: this.heights.nz, step: +this.heights.step.toFixed(2) };
    s.geometry = this.geometryStats;
    s.runways = this.model.runways.map((r) => ({ id: r.id, des: `${r.desA?.text}/${r.desB?.text}`, len: Math.round(r.length), w: +r.width.toFixed(1), src: r.source, cls: r.cls, lit: r.lighted, als: r.alsA, luma: r.surfaceLuma != null ? +r.surfaceLuma.toFixed(2) : null }));
    s.taxiways = this.model.taxiways.length;
    s.holds = this.model.holds.length;
    s.fillets = this.model.fillets.length;
    s.photo = this.photo ? `${this.photo.tiles}/${this.photo.of}` : null;
    s.grassTone = this.grassTone ? this.grassTone.map((v) => +v.toFixed(4)) : null;
    s.pavementInfo = this.paveInfoStats ?? null;
    let bytes = this.heights.data.byteLength + (this.paveTexture ? this.paveTexture.image.data.byteLength : 0);
    if (this.uniforms.uAfGlyphs.value) bytes += 1024 * 512 * 4 * 1.34;
    if (this.photo) bytes += this.photo.canvas.width * this.photo.canvas.height * 4 * 1.34;
    s.textureMiB = +(bytes / 1048576).toFixed(2);
    s.suppressing = !!this.suppressing;
    s.setApron = this.setApronRect ?? null;
  }

  /**
   * Track the drawn terrain tiles over the airfield: any tile that loads or
   * unloads there, and any vertex-buffer edit of one in use (the operations
   * layer flattens runways into a tile after it loads), schedules a rebuild
   * of the height field from the tiles resident at that moment.
   */
  _startTerrain() {
    const engine = this.runtime.engine;
    this.terrainDirty = true;
    this.terrainSources = [];
    this.terrainPollAt = 0;
    this.terrainStats = { lastMs: 0, lastFrames: 0, pending: false };
    if (!engine?.forEachLoadedTile || !engine.onTileEvents || !engine.map) return;
    const touch = (tile) => {
      if (!this.disposed && this._overlaps(tile)) this.terrainDirty = true;
    };
    this.offTiles = engine.onTileEvents(touch, touch);
  }

  /** Does a terrain tile's footprint overlap the height grid? */
  _overlaps(tile) {
    if (!tile || !Number.isFinite(tile.z)) return false;
    const world = 40075016.68557849, span = world / 2 ** tile.z;
    const { site, heights: h } = this;
    const x0 = (-world / 2 + tile.x * span - site.x) / site.k, x1 = x0 + span / site.k;
    const z0 = (-world / 2 + tile.y * span - site.z) / site.k, z1 = z0 + span / site.k;
    const gx1 = h.x0 + (h.nx - 1) * h.step, gz1 = h.z0 + (h.nz - 1) * h.step;
    return !(x1 < h.x0 || x0 > gx1 || z1 < h.z0 || z0 > gz1);
  }

  /** Every resident tile mesh over the grid as a rebuild source (airfield-height.js). */
  _terrainSources() {
    const engine = this.runtime.engine;
    const anchor = this.runtime.origin?.anchor ?? { x: 0, z: 0 };
    const { site } = this;
    const k = site.k;
    const mapInv = (this._mapInv ??= new Matrix4()).copy(engine.map.matrixWorld).invert();
    const toMap = (this._toMap ??= new Matrix4());
    const sources = [];
    engine.forEachLoadedTile((tile) => {
      const mesh = tile.model;
      const g = mesh?.geometry;
      const attr = g?.attributes?.position;
      if (!attr || !g.index || attr.itemSize !== 3 || attr.isInterleavedBufferAttribute || !this._overlaps(tile)) return;
      mesh.updateWorldMatrix(true, false);
      const w = mesh.matrixWorld.elements;
      const e = toMap.multiplyMatrices(mapInv, mesh.matrixWorld).elements;
      const smz = g.userData?.surfaceMinZ;
      sources.push({
        tile,
        mesh,
        attr,
        version: attr.version,
        position: attr.array,
        index: g.index.array,
        skirtBelow: Number.isFinite(smz) ? smz - 1 : -Infinity,
        zoom: tile.z,
        // raw vertex -> (local x, local z, elevation); world + anchor = scene.
        m: [w[0] / k, w[4] / k, w[8] / k, (w[12] + anchor.x - site.x) / k, w[2] / k, w[6] / k, w[10] / k, (w[14] + anchor.z - site.z) / k, e[2], e[6], e[10], e[14]],
      });
    });
    return sources;
  }

  /** Run the rebuild for a slice of this frame; start one when the terrain changed. */
  _pumpTerrain(now) {
    const ts = this.terrainStats;
    if (!ts || !this.runtime.engine?.map) return;
    if (!this.terrainJob && now - this.terrainPollAt > CFG.terrain.pollMs) {
      this.terrainPollAt = now;
      for (const s of this.terrainSources)
        if (s.tile.model !== s.mesh || s.attr.version !== s.version) {
          this.terrainDirty = true;
          break;
        }
    }
    if (!this.terrainJob && this.terrainDirty) {
      this.terrainDirty = false;
      this.terrainSources = this._terrainSources();
      this.terrainJob = this.heights.rebuild(this.terrainSources, { eps: CFG.terrain.eps });
      this.terrainJobMs = 0;
      this.terrainJobFrames = 0;
    }
    ts.pending = !!this.terrainJob || this.terrainDirty;
    if (!this.terrainJob) return;
    const t0 = performance.now();
    const budget = this.heights.ready ? CFG.terrain.budgetMs : CFG.terrain.firstBudgetMs;
    let done = false;
    while (performance.now() - t0 < budget) {
      if (this.terrainJob.next().done) {
        done = true;
        break;
      }
    }
    this.terrainJobMs += performance.now() - t0;
    this.terrainJobFrames++;
    if (done) {
      this.terrainJob = null;
      ts.lastMs = +this.terrainJobMs.toFixed(1);
      ts.lastFrames = this.terrainJobFrames;
      ts.pending = this.terrainDirty;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.offTiles?.();
    this.abort.abort();
    if (this.suppressing) setAirfieldSuppression(null);
    for (const off of this.overlayOff) off();
    this.overlayOff = [];
    for (const { glow } of this.glows) glow.dispose();
    for (const d of this.disposables) d.dispose?.();
    this.group.removeFromParent();
  }
}
