/**
 * SHIP PASS SKY (FLY_SHIP_PASS.md 3.2 "Prewarm") — what the SKY block of
 * lib/fly/prewarm-registry.js hands the prewarm consumer.
 *
 * SKY's flag-on variants (REAL_MOON's composite, SKY_LITE's aerial lookup in
 * the cloud march / composite and the merged aerial EffectPass) are not new
 * programs beside the default ones: each REPLACES its default text for the
 * page load. They are built by the live cloud pass and the live composer, so
 * the registry entries hand out CLONES of those live materials (same shader
 * text, defines and therefore program key; the consumer may compile and
 * dispose the clone without touching the live one). This module is the slot
 * they are published through: tiny, three-only, so the registry imports no
 * render module and no cycle can form.
 */
import { Group, Mesh, PlaneGeometry } from 'three';

const providers = {};

/** The live owners publish their materials: provideSkyPrewarm('cloud-r25', () => [ShaderMaterial…]). */
export function provideSkyPrewarm(kind, fn) {
  if (typeof fn === 'function') providers[kind] = fn;
  else delete providers[kind];
}

/** A group of full-screen meshes carrying clones of the live `kind` materials (empty when none is live). */
export function skyPrewarmObject(kind) {
  const group = new Group();
  group.name = `sky-prewarm-${kind}`;
  let mats = [];
  try {
    mats = providers[kind]?.() ?? [];
  } catch {
    mats = [];
  }
  for (const m of mats) {
    if (!m?.clone) continue;
    const mesh = new Mesh(new PlaneGeometry(2, 2), m.clone());
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}
