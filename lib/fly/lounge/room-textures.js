// Observation lounge — procedural surface textures, baked on the GPU once per
// mount (first-party: no image assets, no CPU pixel loops).
//
// Each map is an albedo MODULATION (RGB, ~0.8-1.05, sRGB-encoded; the vertex
// colour carries the hue: one oak map serves light oak and smoked oak) with a
// height field in alpha (0.5 = flat) that room-shading.js turns into a
// derivative bump. Every pattern is periodic over the texture so it tiles
// without a seam, and the floor additionally re-samples it per stone tile.
//
// Sizes (with mips): travertine 1024^2 (5.6 MB), oak 1024^2 (5.6 MB),
// leather / weave / limewash / foliage 512^2 (1.4 MB each) - 16.8 MB of the room's 24.
import {
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  WebGLRenderTarget,
} from 'three';

const NOISE = /* glsl */ `
float h12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
vec2 h22( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.xx + p3.yz ) * p3.zy ); }
// Value noise periodic over 'per' lattice cells.
float vn( vec2 p, vec2 per ) {
  vec2 i = floor( p ), f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  float a = h12( mod( i, per ) ), b = h12( mod( i + vec2( 1.0, 0.0 ), per ) );
  float c = h12( mod( i + vec2( 0.0, 1.0 ), per ) ), d = h12( mod( i + vec2( 1.0, 1.0 ), per ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
// fBm over uv in [0,1): base lattice 'per', octaves double it (still periodic).
float fbm( vec2 uv, vec2 per, int oct ) {
  float s = 0.0, a = 0.5, n = 0.0;
  for ( int i = 0; i < 8; i ++ ) {
    if ( i >= oct ) break;
    s += a * vn( uv * per, per );
    n += a;
    per *= 2.0;
    a *= 0.5;
  }
  return s / n;
}
// Worley F1, F2 periodic over 'per' cells.
vec2 worley( vec2 uv, vec2 per, float jitter ) {
  vec2 p = uv * per, i = floor( p ), f = fract( p );
  float d1 = 8.0, d2 = 8.0;
  for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
    vec2 g = vec2( float( x ), float( y ) );
    vec2 r = g + 0.5 + ( h22( mod( i + g, per ) ) - 0.5 ) * jitter - f;
    float d = dot( r, r );
    if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) d2 = d;
  }
  return sqrt( vec2( d1, d2 ) );
}
`;

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';

const PATTERNS = {
  // Honed cross-cut travertine: soft cloudy fleuri in warm creams, a faint
  // sedimentary drift, scattered pores (most filled with a paler cement).
  stone: /* glsl */ `
  vec2 uv = vUv;
  vec2 q = vec2( fbm( uv, vec2( 3.0, 3.0 ), 5 ), fbm( uv + 0.37, vec2( 3.0, 3.0 ), 5 ) );
  float cloud = fbm( uv + q * 0.08, vec2( 4.0, 4.0 ), 6 );
  float flower = fbm( uv + q * 0.12 + 0.61, vec2( 6.0, 6.0 ), 5 );
  float drift = 0.5 + 0.5 * sin( ( uv.y * 4.0 + q.x * 1.6 + q.y * 0.8 ) * 6.2831853 );
  vec3 col = vec3( 1.01, 0.995, 0.97 ) * ( 0.955 + 0.06 * ( cloud - 0.5 ) + 0.025 * ( fbm( uv, vec2( 48.0, 48.0 ), 3 ) - 0.5 ) );
  float warm = smoothstep( 0.52, 0.8, flower ) * 0.45 + drift * 0.08;
  col = mix( col, vec3( 0.93, 0.865, 0.77 ), warm * 0.55 );
  col = mix( col, vec3( 1.04, 1.03, 1.0 ), smoothstep( 0.62, 0.82, cloud ) * 0.25 );
  vec2 w = worley( uv, vec2( 28.0, 44.0 ), 0.95 );
  float poreMask = smoothstep( 0.4, 0.7, fbm( uv + 0.21, vec2( 5.0, 5.0 ), 4 ) );
  float pore = ( 1.0 - smoothstep( 0.04, 0.12, w.x ) ) * poreMask;
  float filled = step( 0.35, h12( floor( uv * vec2( 28.0, 44.0 ) ) ) );
  col = mix( col, mix( vec3( 0.7, 0.63, 0.55 ), vec3( 1.05, 1.03, 0.99 ), filled ), pore * 0.8 );
  float h = 0.5 + ( cloud - 0.5 ) * 0.04 - pore * ( 1.0 - filled ) * 0.5;
  gl_FragColor = vec4( col, h );`,

  // Oak: grain lines across v (growth rings wandering along u), open pores
  // as fine dashes along the grain, faint ray flecks, long colour streaks.
  wood: /* glsl */ `
  vec2 uv = vUv;
  float w1 = fbm( vec2( uv.x, uv.y ), vec2( 2.0, 6.0 ), 4 );
  float w2 = fbm( vec2( uv.x, uv.y ), vec2( 1.0, 2.0 ), 3 );
  float ring = uv.y * 64.0 + w1 * 9.0 + w2 * 16.0;
  float rf = fract( ring );
  float late = smoothstep( 0.62, 0.9, rf ) * ( 1.0 - smoothstep( 0.9, 1.0, rf ) );
  float streak = fbm( vec2( uv.x, uv.y ), vec2( 2.0, 24.0 ), 4 );
  float pores = step( 0.8, vn( uv * vec2( 48.0, 520.0 ), vec2( 48.0, 520.0 ) ) ) * ( 0.4 + 0.6 * late );
  vec2 fleck = worley( uv, vec2( 64.0, 10.0 ), 1.0 );
  float ray = ( 1.0 - smoothstep( 0.02, 0.09, fleck.x ) ) * step( 0.7, h12( floor( uv * vec2( 64.0, 10.0 ) ) ) );
  vec3 col = vec3( 1.0, 0.985, 0.96 ) * ( 0.93 + 0.12 * ( streak - 0.5 ) );
  col = mix( col, vec3( 0.74, 0.64, 0.55 ), late * 0.5 );
  col = mix( col, vec3( 0.55, 0.47, 0.4 ), pores * 0.5 );
  col = mix( col, vec3( 1.06, 1.03, 0.98 ), ray * 0.35 );
  float h = 0.5 - late * 0.12 - pores * 0.3 + ray * 0.05;
  gl_FragColor = vec4( col, h );`,

  // Pebble-grain leather with a few creases and a soft patina.
  leather: /* glsl */ `
  vec2 uv = vUv;
  vec2 w = worley( uv, vec2( 150.0, 150.0 ), 1.0 );
  float pebble = smoothstep( 0.0, 0.42, w.y - w.x );
  vec2 w2 = worley( uv + 0.5, vec2( 70.0, 70.0 ), 1.0 );
  float coarse = smoothstep( 0.0, 0.5, w2.y - w2.x );
  float crease = 1.0 - smoothstep( 0.0, 0.018, abs( fbm( uv, vec2( 6.0, 6.0 ), 5 ) - 0.5 ) );
  float patina = fbm( uv, vec2( 4.0, 4.0 ), 5 );
  vec3 col = vec3( 1.0 ) * ( 0.84 + 0.1 * pebble + 0.05 * coarse ) * ( 0.94 + 0.14 * ( patina - 0.5 ) );
  col *= 1.0 - crease * 0.18;
  float h = 0.5 + ( pebble - 0.5 ) * 0.6 + ( coarse - 0.5 ) * 0.25 - crease * 0.3;
  gl_FragColor = vec4( col, h );`,

  // Woven wool: an over-under basket weave with slubs and fuzz.
  fabric: /* glsl */ `
  vec2 uv = vUv;
  float N = 96.0;
  vec2 p = uv * N;
  vec2 cell = floor( p ), f = fract( p );
  float over = mod( floor( cell.x * 0.5 ) + floor( cell.y * 0.5 ), 2.0 );
  float warp = sin( 3.14159 * f.x ), weft = sin( 3.14159 * f.y );
  float thread = mix( warp * ( 0.75 + 0.25 * weft ), weft * ( 0.75 + 0.25 * warp ), over );
  float slub = fbm( vec2( uv.x, uv.y ), vec2( 4.0, 48.0 ), 3 ) * ( 1.0 - over ) + fbm( vec2( uv.x, uv.y ), vec2( 48.0, 4.0 ), 3 ) * over;
  float fuzz = fbm( uv, vec2( 128.0, 128.0 ), 2 );
  vec3 col = vec3( 1.0 ) * ( 0.74 + 0.22 * thread ) * ( 0.94 + 0.12 * ( slub - 0.5 ) ) * ( 0.96 + 0.08 * ( fuzz - 0.5 ) );
  float h = 0.5 + ( thread - 0.5 ) * 0.7 + ( fuzz - 0.5 ) * 0.1;
  gl_FragColor = vec4( col, h );`,

  // An olive sprig for the foliage cards: a slender stem with alternate,
  // narrow, slightly curved leaves (dark sage tops, a few silvery undersides),
  // a pale midrib. Alpha is the leaf mask; transparent texels carry the mean
  // leaf colour so mipmaps never fringe dark.
  foliage: /* glsl */ `
  vec2 p = vUv;
  float stemX = 0.5 + 0.025 * sin( p.y * 3.4 );
  float alpha = ( 1.0 - smoothstep( 0.0035, 0.0065, abs( p.x - stemX ) ) ) * step( p.y, 0.93 );
  vec3 col = vec3( 0.36, 0.33, 0.24 );
  for ( int i = 0; i < 15; i ++ ) {
    float fi = float( i );
    float y0 = 0.05 + fi * 0.058;
    float side = mod( fi, 2.0 ) * 2.0 - 1.0;
    float ang = side * ( 0.55 + 0.3 * h12( vec2( fi, 3.0 ) ) ) * ( 1.0 - fi * 0.025 );
    float L = 0.2 + 0.09 * h12( vec2( fi, 5.0 ) ) - fi * 0.005;
    float W = 0.03 + 0.012 * h12( vec2( fi, 7.0 ) );
    vec2 base = vec2( 0.5 + 0.025 * sin( y0 * 3.4 ), y0 );
    vec2 dir = vec2( sin( ang ), cos( ang ) );
    vec2 q = p - base;
    float u = dot( q, dir ), v = dot( q, vec2( dir.y, -dir.x ) ) + u * u * 0.9 * side;
    if ( u <= 0.0 || u >= L ) continue;
    float t = u / L;
    float hw = W * pow( sin( 3.14159 * t ), 0.7 );
    float inside = 1.0 - smoothstep( hw - 0.003, hw + 0.0015, abs( v ) );
    if ( inside <= 0.0 ) continue;
    float silver = step( 0.72, h12( vec2( fi, 11.0 ) ) );
    vec3 leafCol = mix( vec3( 0.25, 0.31, 0.17 ), vec3( 0.47, 0.52, 0.42 ), silver );
    leafCol *= 0.85 + 0.3 * h12( vec2( fi, 13.0 ) );
    leafCol *= 0.82 + 0.25 * t;                                    // lighter toward the tip
    leafCol = mix( leafCol, leafCol * 1.35 + 0.03, ( 1.0 - smoothstep( 0.0, 0.0035, abs( v ) ) ) * 0.6 ); // midrib
    leafCol *= 1.0 - 0.25 * smoothstep( 0.4, 1.0, abs( v ) / max( hw, 1e-4 ) );                     // edges
    col = mix( col, leafCol, inside );
    alpha = max( alpha, inside );
  }
  if ( alpha < 0.01 ) col = vec3( 0.3, 0.35, 0.22 );
  gl_FragColor = vec4( col, alpha );`,

  // Limewash plaster: mottled clouds, trowel sweeps, fine sand.
  plaster: /* glsl */ `
  vec2 uv = vUv;
  float cloud = fbm( uv, vec2( 3.0, 3.0 ), 6 );
  float sweep = fbm( vec2( uv.x + uv.y * 0.6, uv.y - uv.x * 0.3 ), vec2( 5.0, 5.0 ), 4 );
  float sand = h12( floor( uv * 512.0 ) );
  vec3 col = vec3( 1.0 ) * ( 0.93 + 0.1 * ( cloud - 0.5 ) + 0.04 * ( sweep - 0.5 ) + 0.025 * ( sand - 0.5 ) );
  col *= mix( vec3( 1.0, 0.99, 0.975 ), vec3( 0.985, 0.99, 1.0 ), smoothstep( 0.4, 0.7, cloud ) );
  float h = 0.5 + ( sweep - 0.5 ) * 0.3 + ( sand - 0.5 ) * 0.15;
  gl_FragColor = vec4( col, h );`,
};

const SIZES = { stone: 1024, wood: 1024, leather: 512, fabric: 512, plaster: 512, foliage: 512 };

/**
 * Bake every map with `renderer`. Returns { maps: {name: Texture}, bytes,
 * dispose() }. Restores the renderer's target. Safe to call before the room
 * is ever drawn.
 */
export function bakeRoomTextures(renderer) {
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  scene.add(quad);
  const maps = {}, targets = [];
  const prevTarget = renderer.getRenderTarget();
  const prevAuto = renderer.autoClear;
  const prevXr = renderer.xr.enabled;
  const prevShadow = renderer.shadowMap.autoUpdate;
  let bytes = 0;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() ?? 1);
  try {
    renderer.autoClear = true;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    for (const [name, size] of Object.entries(SIZES)) {
      const target = new WebGLRenderTarget(size, size, {
        format: RGBAFormat,
        type: UnsignedByteType,
        colorSpace: SRGBColorSpace,
        generateMipmaps: true,
        minFilter: LinearMipmapLinearFilter,
        magFilter: LinearFilter,
        wrapS: RepeatWrapping,
        wrapT: RepeatWrapping,
        depthBuffer: false,
        anisotropy: aniso,
      });
      target.texture.name = `lounge-${name}`;
      const material = new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: `varying vec2 vUv;\n${NOISE}\nvoid main() {\n${PATTERNS[name]}\n}`,
        depthTest: false,
        depthWrite: false,
      });
      quad.material = material;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      material.dispose();
      targets.push(target);
      maps[name] = target.texture;
      bytes += size * size * 4 * (4 / 3);
    }
  } finally {
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    renderer.xr.enabled = prevXr;
    renderer.shadowMap.autoUpdate = prevShadow;
    quad.geometry.dispose();
  }
  return {
    maps,
    bytes,
    dispose() {
      for (const t of targets) t.dispose();
      targets.length = 0;
    },
  };
}
