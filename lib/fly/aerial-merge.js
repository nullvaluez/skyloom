/**
 * FRAME COST (AERIAL_MERGE): run the aerial-perspective Effect inside the cloud
 * composite instead of as its own full-screen EffectPass before it.
 *
 * The aerial text is a postprocessing `mainImage(inputColor, uv, depth, out)`
 * program that leans on four EffectMaterial globals (getViewZ, aspect,
 * cameraNear, cameraFar) and shares chunks (CINEMA_GLSL, the R25 sky, living
 * air, the physical sky) with the composite. Pasting it in verbatim would
 * redeclare those, so it is NAMESPACED first:
 *
 *  - a uniform the composite already declares on the SAME holder object keeps
 *    its name and loses its declaration here (one sampler unit, one value);
 *  - every other uniform, every global function / const / struct / #define,
 *    and any identifier that would hide one of the composite's functions is
 *    renamed `aer_<name>`, consistently across the whole aerial text;
 *  - the EffectMaterial globals become `aer_` uniforms fed by the cloud pass,
 *    and `depth` arrives exactly as EffectMaterial's readDepth hands it over:
 *    un-reversed under three's USE_REVERSED_DEPTH_BUFFER define. mainImage
 *    re-reverses it through uReverseDepth and feeds three's reversed-aware
 *    perspectiveDepthToViewZ, so the aerial arithmetic is unchanged. (Passing
 *    the raw value instead leaves the far field un-hazed: measured.)
 *
 * The call lands on the composite's scene read, so the composite sees the same
 * hazed colour it used to read from the aerial pass's output buffer.
 */

const TYPES = '(?:float|int|uint|bool|void|vec[234]|ivec[234]|uvec[234]|bvec[234]|mat[234](?:x[234])?)';
const PRECISION = '(?:(?:highp|mediump|lowp)\\s+)?';
const EFFECT_GLOBALS = ['mainImage', 'getViewZ', 'aspect', 'cameraNear', 'cameraFar'];
const ANCHOR = /\n(\s*)vec3 scene=texture2D\(inputBuffer,([^;]*?)\)\.rgb;/;

/** `uniform T a, b[3];` statements: [{ full, type, names: [{ name, decl }] }]. */
function uniformStatements(text) {
  const out = [];
  const re = /uniform\s+((?:(?:highp|mediump|lowp)\s+)?\w+)\s+([^;]+);/g;
  let m;
  while ((m = re.exec(text))) {
    const names = m[2].split(',').map((decl) => ({ decl: decl.trim(), name: decl.trim().match(/^\w+/)?.[0] })).filter((n) => n.name);
    out.push({ full: m[0], type: m[1], names });
  }
  return out;
}

const globalFunctions = (text) =>
  new Set([...text.matchAll(new RegExp(`(?:^|[\\n;}])\\s*${PRECISION}${TYPES}\\s+(\\w+)\\s*\\(`, 'g'))].map((m) => m[1]));

function globalNames(text) {
  const names = globalFunctions(text);
  for (const m of text.matchAll(/(?:^|\n)\s*#define\s+(\w+)/g)) names.add(m[1]);
  for (const m of text.matchAll(/\bstruct\s+(\w+)/g)) names.add(m[1]);
  for (const m of text.matchAll(new RegExp(`(?:^|\\n)\\s*const\\s+${PRECISION}${TYPES}\\s+(\\w+)`, 'g'))) names.add(m[1]);
  // Unindented non-const globals (`vec3 foo;`, `float bar = 1.;`).
  for (const m of text.matchAll(new RegExp(`\\n${PRECISION}${TYPES}\\s+(\\w+)\\s*(?:=|;|\\[)`, 'g'))) names.add(m[1]);
  return names;
}

/**
 * @param {string} composite   the composite's final fragment text
 * @param {object} uniforms    the composite's uniforms object (name -> holder)
 * @param {{ fragmentShader: string, uniforms: Map<string, object> }} effect
 * @returns {{ fragmentShader: string, uniforms: object, extra: object }}
 */
export function mergeAerialIntoComposite(composite, uniforms, effect) {
  const anchor = composite.match(ANCHOR);
  if (!anchor) throw new Error('aerial-merge: composite scene read not found');
  let aerial = effect.fragmentShader;
  if (!/void\s+mainImage\s*\(/.test(aerial)) throw new Error('aerial-merge: effect has no mainImage');

  const compositeDeclared = new Set(uniformStatements(composite).flatMap((s) => s.names.map((n) => n.name)));
  const merged = { ...uniforms };
  const rename = new Set(EFFECT_GLOBALS);

  // Shared holders keep their composite declaration; the rest are renamed.
  for (const stmt of uniformStatements(aerial)) {
    const keep = [];
    for (const n of stmt.names) {
      const holder = effect.uniforms.get(n.name);
      if (holder && uniforms[n.name] === holder && compositeDeclared.has(n.name)) continue;
      keep.push(n.decl);
      rename.add(n.name);
      if (holder) merged[`aer_${n.name}`] = holder;
    }
    aerial = aerial.replace(stmt.full, keep.length ? `uniform ${stmt.type} ${keep.join(', ')};` : '');
  }
  for (const name of globalNames(aerial)) rename.add(name);
  // A local that hides one of the composite's functions is rejected by strict
  // front ends (the LIVING_AIR_CLOUD_GLSL precedent in immersive-cloud-pass).
  const compositeFns = globalFunctions(composite);
  for (const word of new Set(aerial.match(/\b[A-Za-z_]\w*\b/g))) if (compositeFns.has(word)) rename.add(word);

  const list = [...rename].filter(Boolean).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(?<![.\\w])(${list.map((n) => n.replace(/[$]/g, '\\$&')).join('|')})\\b`, 'g');
  aerial = aerial.replace(re, 'aer_$1');

  const extra = {
    aer_cameraNear: { value: 0.3 },
    aer_cameraFar: { value: 1000 },
    aer_aspect: { value: 1 },
  };
  Object.assign(merged, extra);

  const packing = /#include\s*<packing>/.test(composite) ? '' : '#include <packing>\n';
  const chunk = `${packing}uniform float aer_cameraNear, aer_cameraFar, aer_aspect;
float aer_getViewZ(const in float d){return perspectiveDepthToViewZ(d,aer_cameraNear,aer_cameraFar);}
${aerial}
vec3 aerMerged(vec3 color,vec2 uv){
 // EffectMaterial's readDepth: un-reversed under the reversed-depth define.
 float raw=texture2D(sceneDepth,uv).r,depth=reverseDepth>.5?1.-raw:raw;
 vec4 hazed;aer_mainImage(vec4(color,1.),uv,depth,hazed);return hazed.rgb;
}
`;
  const main = composite.lastIndexOf('void main(');
  if (main < 0) throw new Error('aerial-merge: composite has no main');
  let out = composite.slice(0, main) + chunk + composite.slice(main);
  out = out.replace(ANCHOR, (whole, indent, uv) => `${whole}\n${indent}scene=aerMerged(scene,${uv});`);
  return { fragmentShader: out, uniforms: merged, extra };
}
