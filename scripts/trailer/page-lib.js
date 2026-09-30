/*
 * Trailer rig — page-side library (injected with page.addScriptTag after boot).
 *
 * Exposes window.TR. A shot script defines window.__shot = { flight?, camera?, traffic?, frame? }
 * where every function receives shot time t in seconds (negative during run-in, 0 at
 * the first recorded frame). Time comes from the (fake, stepped) performance.now(),
 * so every consumer sees one consistent clock.
 *
 * Coordinates: the engine's world is absolute mercator. Horizontal world units are
 * metres * k (k = 1/cos(lat)); Y is true metres above mean sea level.
 */
(function () {
  if (window.TR) return;
  const rt = window.__fly;
  const cam = rt.camera;
  const V3 = cam.position.constructor;
  const M4 = cam.matrix.constructor;
  const D2R = Math.PI / 180;

  const TR = {
    t0: null,
    t() { return TR.t0 == null ? -1e9 : (performance.now() - TR.t0) / 1000; },
    V3,
    D2R,
    k(latDeg) { return 1 / Math.cos(latDeg * D2R); },
    geo(lat, lon, altM = 0) { return rt.engine.geoToWorld(lon, lat, altM); },
    toGeo(v) { const g = rt.engine.worldToGeo(v); return { lon: g.x, lat: g.y, alt: g.z }; },
    ground(lat, lon) { return rt.engine.getElevationAt(lon, lat); },
    clamp: (x, a, b) => Math.min(b, Math.max(a, x)),
    lerp: (a, b, u) => a + (b - a) * u,
    smooth: (u) => { u = Math.min(1, Math.max(0, u)); return u * u * (3 - 2 * u); },
    smoother: (u) => { u = Math.min(1, Math.max(0, u)); return u * u * u * (u * (u * 6 - 15) + 10); },
    easeInOut: (u) => { u = Math.min(1, Math.max(0, u)); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; },
  };

  /*
   * A time-parameterised path through geographic keys [{t, lat, lon, alt}].
   * Positions are interpolated in absolute world space with a centripetal-free
   * cubic Hermite (Catmull-Rom tangents scaled for non-uniform key times).
   * Returns at(t) -> {pos, vel} (world units/s; horizontal scaled by k).
   */
  TR.path = function (keys) {
    const P = keys.map((kf) => ({ t: kf.t, p: TR.geo(kf.lat, kf.lon, kf.alt) }));
    const n = P.length;
    const tan = P.map((_, i) => {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
      const dt = b.t - a.t || 1;
      return new V3().subVectors(b.p, a.p).multiplyScalar(1 / dt);
    });
    const out = { pos: new V3(), vel: new V3() };
    function at(t) {
      let i = 0;
      if (t <= P[0].t) {
        out.vel.copy(tan[0]);
        out.pos.copy(P[0].p).addScaledVector(tan[0], t - P[0].t);
        return out;
      }
      if (t >= P[n - 1].t) {
        out.vel.copy(tan[n - 1]);
        out.pos.copy(P[n - 1].p).addScaledVector(tan[n - 1], t - P[n - 1].t);
        return out;
      }
      while (i < n - 2 && t > P[i + 1].t) i++;
      const a = P[i], b = P[i + 1], h = b.t - a.t, u = (t - a.t) / h;
      const u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      const d00 = 6 * u2 - 6 * u, d10 = 3 * u2 - 4 * u + 1, d01 = -6 * u2 + 6 * u, d11 = 3 * u2 - 2 * u;
      const m0 = tan[i], m1 = tan[i + 1];
      for (const c of ['x', 'y', 'z']) {
        out.pos[c] = h00 * a.p[c] + h10 * h * m0[c] + h01 * b.p[c] + h11 * h * m1[c];
        out.vel[c] = (d00 * a.p[c] + d10 * h * m0[c] + d01 * b.p[c] + d11 * h * m1[c]) / h;
      }
      return out;
    }
    return { at, keys: P };
  };

  /* Attitude from a world-space velocity (see FlightModel: heading 0 = north (-Z), clockwise). */
  TR.attitude = function (vel, latDeg) {
    const k = TR.k(latDeg);
    const hs = Math.hypot(vel.x, vel.z) / k;
    return {
      heading: Math.atan2(vel.x, -vel.z),
      pitch: Math.atan2(vel.y, Math.max(1e-6, hs)),
      speed: Math.hypot(hs, vel.y),
    };
  };

  /*
   * Flight pose from a path, with coordinated-turn bank derived from the
   * heading rate (bank = atan(v * psiDot / g)), smoothed, clamped.
   */
  TR.flyPath = function (path, { bankGain = 1, bankMax = 70 * D2R, bankOffset = null, latDeg = null } = {}) {
    const lat0 = latDeg ?? TR.toGeo(path.keys[0].p).lat;
    const tmp = new V3();
    return function (t) {
      const a = path.at(t);
      const pos = a.pos.clone(), vel = a.vel.clone();
      const att = TR.attitude(vel, lat0);
      const e = 0.05;
      const h1 = TR.attitude(path.at(t + e).vel.clone(), lat0).heading;
      const h0 = TR.attitude(path.at(t - e).vel.clone(), lat0).heading;
      let dh = h1 - h0; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      const psiDot = dh / (2 * e);
      let bank = Math.atan((att.speed * psiDot) / 9.81) * bankGain;
      bank = TR.clamp(bank, -bankMax, bankMax);
      if (bankOffset) bank += bankOffset(t);
      tmp.copy(pos);
      return { pos, heading: att.heading, pitch: att.pitch, bank, speed: att.speed, latDeg: lat0 };
    };
  };

  /* Local frame of a flight pose: fwd (horizontal heading), right, up — true-metre unit vectors in world axes. */
  TR.frame = function (heading) {
    const fwd = new V3(Math.sin(heading), 0, -Math.cos(heading));
    const right = new V3(Math.cos(heading), 0, Math.sin(heading));
    const up = new V3(0, 1, 0);
    return { fwd, right, up };
  };

  /* World point at an offset (metres: right, up, fwd) from a world position with a heading. */
  TR.offset = function (pos, heading, latDeg, right, up, fwd) {
    const k = TR.k(latDeg), f = TR.frame(heading);
    return pos.clone()
      .addScaledVector(f.right, right * k)
      .addScaledVector(f.fwd, fwd * k)
      .add(new V3(0, up, 0));
  };

  // ------------------------------------------------------------------ overrides
  const flight = rt.flight;
  const origStep = flight.step.bind(flight);
  flight.step = function (dt, cmd) {
    const S = window.__shot;
    if (!S || !S.flight) return origStep(dt, cmd);
    const p = S.flight(TR.t(), flight);
    if (!p) return origStep(dt, cmd);
    flight.pos.copy(p.pos);
    flight.heading = p.heading;
    flight.pitch = p.pitch ?? 0;
    flight.bank = p.bank ?? 0;
    flight.speed = p.speed ?? flight.speed;
    flight.turnRate = 0;
    flight.pitchRate = 0;
    if (p.latDeg != null) flight.latDeg = p.latDeg;
    flight.agl = flight.pos.y - flight.groundElev;
    flight.floorContact = null;
    flight._trimT = 0;
    flight.boosting = !!p.boosting;
    flight.boostBlocked = false;
  };

  const chase = rt.chaseRig;
  const origChase = chase.update.bind(chase);
  const eye = new V3(), tgt = new V3(), up = new V3(), m = new M4();
  TR.lastCam = null;
  chase.update = function (dt, fl, camera, freeLook, k, gi) {
    const S = window.__shot;
    const pose = S && S.camera ? S.camera(TR.t(), fl, k) : null;
    if (!pose) { TR.lastCam = null; return origChase(dt, fl, camera, freeLook, k, gi); }
    eye.copy(pose.eye); tgt.copy(pose.target);
    up.set(0, 1, 0);
    if (pose.roll) {
      // roll the up vector around the view axis
      const f = new V3().subVectors(tgt, eye).normalize();
      const r = new V3().crossVectors(f, up).normalize();
      up.multiplyScalar(Math.cos(pose.roll)).addScaledVector(r, Math.sin(pose.roll));
    }
    m.lookAt(eye, tgt, up);
    camera.position.copy(eye);
    camera.quaternion.setFromRotationMatrix(m);
    const fov = pose.fov ?? 54;
    if (Math.abs(camera.fov - fov) > 1e-4) { camera.fov = fov; camera.updateProjectionMatrix(); }
    TR.lastCam = pose;
  };

  /*
   * PUPPET TRAFFIC (traffic report R4): exact, deterministic aircraft driven
   * every frame on the engine's own clock. A puppet is
   *   { hex, meta: {hex, flight, r, t, squawk, category, iconType, color}, arch, pose(t) }
   * where pose(t) -> { pos: world V3 (absolute), heading: rad (0=N, cw), speed: m/s, vs?: m/s }.
   * fix1 is written at age 0 (so the drawn position IS pose(t)), fix0 one second
   * earlier so the engine derives turn rate -> bank. Contrails, spotter trails,
   * living airframes, inspect/intercept all read these tracks.
   */
  TR.puppets = [];
  TR.puppetScale = {};
  const traffic = rt.traffic;
  function fixOf(p, t) {
    const g = TR.toGeo(p.pos);
    return {
      t, x: p.pos.x, y: p.pos.y, z: p.pos.z,
      vE: p.speed * Math.sin(p.heading), vN: p.speed * Math.cos(p.heading), vUp: p.vs || 0,
      latRad: g.lat * D2R,
    };
  }
  if (traffic && traffic.update) {
    const origTU = traffic.update.bind(traffic);
    traffic.update = function (clientSec, playerPos) {
      const S = window.__shot;
      if (TR.puppets.length) {
        if (this._skewSec == null) this._skewSec = 0;
        const now = this.serverNow(clientSec);
        const t = TR.t();
        for (const a of TR.puppets) {
          let k = this.tracks.get(a.hex);
          if (!k) { k = this._createTrack(a.hex); this.tracks.set(a.hex, k); }
          k.meta = a.meta; k.archetype = a.arch; k.flags = 0;
          const p1 = a.pose(t), p0 = a.pose(t - 1);
          k.fix1 = fixOf(p1, now); k.fix0 = fixOf(p0, now - 1);
          k.blendFix1 = k.blendFix0 = null; k.altBlendStart = null; k.snapDipUntil = null; k.lastPollServer = now;
        }
      }
      const items = origTU(clientSec, playerPos);
      for (const it of items) if (TR.puppetScale[it.hex]) it.scaleK = TR.puppetScale[it.hex];
      if (S && S.traffic) S.traffic(TR.t(), traffic, playerPos);
      return items;
    };
  }
  TR.puppet = function (p) { TR.puppets.push(p); return p; };
  /* A pose function that follows a flight-pose function with a fixed offset (metres right/up/fwd in its heading frame). */
  TR.follow = function (poseFn, right, up, fwd) {
    return (t) => {
      const f = poseFn(t);
      return { pos: TR.offset(f.pos, f.heading, f.latDeg, right, up, fwd), heading: f.heading, speed: f.speed, vs: 0 };
    };
  };
  /* A pose along a TR.path (world). */
  TR.along = function (path, latDeg) {
    return (t) => {
      const a = path.at(t); const att = TR.attitude(a.vel, latDeg);
      return { pos: a.pos.clone(), heading: att.heading, speed: att.speed, vs: a.vel.y };
    };
  };
  /* Straight constant-velocity track from a geo start. */
  TR.straight = function (lat, lon, altM, hdgDeg, speed, t0 = 0) {
    const p0 = TR.geo(lat, lon, altM), h = hdgDeg * D2R, k = TR.k(lat);
    return (t) => ({ pos: p0.clone().add(new V3(Math.sin(h) * speed * (t - t0) * k, 0, -Math.cos(h) * speed * (t - t0) * k)), heading: h, speed, vs: 0 });
  };

  // ------------------------------------------------------------ cinematography
  // Every param may be a number or a function of t. Offsets are true metres in
  // the aircraft's heading frame (right, up, fwd); the world conversion (k) is
  // applied here. Camera functions return {eye, target, fov, roll}.
  const val = (v, t) => (typeof v === 'function' ? v(t) : v);
  TR.val = val;
  TR.cam = {
    /* Camera rigidly offset from the aircraft (e.g. a tracking vehicle). */
    relative(o) {
      return (t, fl) => {
        const lat = fl.latDeg, h = fl.heading + (val(o.yawOffset, t) || 0) * D2R;
        const eye = TR.offset(fl.pos, h, lat, val(o.right, t) || 0, val(o.up, t) || 0, val(o.fwd, t) || 0);
        const target = TR.offset(fl.pos, fl.heading, lat, val(o.lookRight, t) || 0, val(o.lookUp, t) || 0, val(o.lookFwd, t) || 0);
        return { eye, target, fov: val(o.fov, t) ?? 50, roll: (val(o.roll, t) || 0) * D2R + (val(o.bankShare, t) || 0) * fl.bank };
      };
    },
    /* Orbit around the aircraft: az 0 = directly behind, 90 = right side, 180 = ahead; el up from horizontal (deg). */
    orbit(o) {
      return (t, fl) => {
        const az = (val(o.az, t) || 0) * D2R, el = (val(o.el, t) || 0) * D2R, d = val(o.dist, t) ?? 40;
        const back = -Math.cos(az) * Math.cos(el) * d, right = Math.sin(az) * Math.cos(el) * d, up = Math.sin(el) * d;
        const eye = TR.offset(fl.pos, fl.heading, fl.latDeg, right, up, back);
        const target = TR.offset(fl.pos, fl.heading, fl.latDeg, val(o.lookRight, t) || 0, val(o.lookUp, t) || 0, val(o.lookFwd, t) || 0);
        return { eye, target, fov: val(o.fov, t) ?? 45, roll: (val(o.roll, t) || 0) * D2R + (val(o.bankShare, t) || 0) * fl.bank };
      };
    },
    /* Tripod at a geographic point, tracking the aircraft (or a fixed geo target). */
    tripod(o) {
      const eye0 = TR.geo(o.lat, o.lon, o.alt);
      return (t, fl) => {
        let target;
        if (o.target) target = TR.geo(o.target.lat, o.target.lon, o.target.alt);
        else target = TR.offset(fl.pos, fl.heading, fl.latDeg, 0, val(o.lookUp, t) || 0, val(o.lookFwd, t) || 0);
        const lead = val(o.lead, t) || 0; // blend target toward a fixed point (0..1)
        if (lead && o.leadTarget) target.lerp(TR.geo(o.leadTarget.lat, o.leadTarget.lon, o.leadTarget.alt), lead);
        const eye = o.drift ? eye0.clone().add(o.drift(t)) : eye0;
        return { eye, target, fov: val(o.fov, t) ?? 40, roll: (val(o.roll, t) || 0) * D2R };
      };
    },
    /* Blend two camera functions: w(t) 0 -> a, 1 -> b (position lerp, target lerp, fov lerp). */
    blend(a, b, w) {
      return (t, fl, k) => {
        const u = val(w, t);
        if (u <= 0) return a(t, fl, k);
        if (u >= 1) return b(t, fl, k);
        const A = a(t, fl, k), B = b(t, fl, k);
        return { eye: A.eye.clone().lerp(B.eye, u), target: A.target.clone().lerp(B.target, u), fov: A.fov + (B.fov - A.fov) * u, roll: (A.roll || 0) + ((B.roll || 0) - (A.roll || 0)) * u };
      };
    },
    /* Add deterministic handheld/aerial shake (metres, degrees) to a camera function. */
    shake(fn, amp = 0.3, freq = 1.3, seed = 1) {
      const n = (x) => Math.sin(x * 1.7 + seed) * 0.5 + Math.sin(x * 3.1 + seed * 2.3) * 0.3 + Math.sin(x * 7.3 + seed * 5.1) * 0.2;
      return (t, fl, k) => {
        const p = fn(t, fl, k); const kk = TR.k(fl.latDeg); const a = val(amp, t);
        p.eye = p.eye.clone().add(new V3(n(t * freq) * a * kk, n(t * freq + 11) * a, n(t * freq + 23) * a * kk));
        p.roll = (p.roll || 0) + n(t * freq + 37) * a * 0.004;
        return p;
      };
    },
  };

  // --------------------------------------------------------- ambient traffic
  // A deterministic sky of airliners (straight tracks), for a living sky with
  // spotter trails and — above ~9 km — contrails. Fictional carrier prefixes
  // (no real airline names reach the inspect card).
  TR.rng = function (seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; };
  TR.AIRLINER_TYPES = ['B738', 'A320', 'A21N', 'B789', 'B77W', 'A359', 'B38M', 'A333', 'E175', 'B744', 'A388', 'B788'];
  TR.ambientFleet = function ({ lat, lon, n = 20, radiusKm = 30, altMin = 9000, altMax = 11800, seed = 7, prefix = ['NVA', 'AUR', 'LUM', 'ORB', 'VRA', 'KST'], speed = [215, 250], lowShare = 0, lowAlt = [1200, 3500] } = {}) {
    const r = TR.rng(seed); const out = [];
    for (let i = 0; i < n; i++) {
      const low = r() < lowShare;
      const ang = r() * Math.PI * 2, dist = Math.sqrt(r()) * radiusKm * 1000;
      const dLat = (Math.cos(ang) * dist) / 111320, dLon = (Math.sin(ang) * dist) / (111320 * Math.cos(lat * D2R));
      const alt = low ? lowAlt[0] + r() * (lowAlt[1] - lowAlt[0]) : altMin + r() * (altMax - altMin);
      const hdg = r() * 360, spd = low ? 120 + r() * 60 : speed[0] + r() * (speed[1] - speed[0]);
      const typ = TR.AIRLINER_TYPES[Math.floor(r() * TR.AIRLINER_TYPES.length)];
      const hex = (0xa00000 + Math.floor(r() * 0x0fffff)).toString(16);
      const call = prefix[Math.floor(r() * prefix.length)] + (100 + Math.floor(r() * 899));
      const p = TR.puppet({
        hex, arch: typ === 'B744' ? 5 : 0,
        meta: { hex, flight: call, r: 'N' + (100 + i) + 'SK', t: typ, squawk: null, category: 'A3', iconType: 'airliner', color: '#4ade80' },
        pose: TR.straight(lat + dLat, lon + dLon, alt, hdg, spd, 0),
      });
      out.push(p);
    }
    return out;
  };

  // Scene root + r3f store (production-safe path, see control report §2.1).
  let s = rt.engine.object; while (s.parent) s = s.parent;
  TR.scene = s;
  TR.r3f = s.__r3f && s.__r3f.root;

  TR.find = function (pred) { const out = []; TR.scene.traverse((o) => { if (pred(o)) out.push(o); }); return out; };
  TR.player = function () { const g = TR.scene.getObjectByName('player-landing-gear'); return g ? g.parent : null; };

  // Per-frame hooks: a pre-render subscriber (priority 0.5, after PoiLetters) and the capture (101).
  const st = TR.r3f.getState();
  const src = st.gl.domElement;
  const out = document.createElement('canvas');
  out.width = src.width; out.height = src.height;
  const ctx = out.getContext('2d');
  TR.cap = { want: false, got: false, out, ctx };
  st.internal.subscribe({ current: () => {
    const S = window.__shot;
    if (S && S.frame) S.frame(TR.t());
    if (TR.hideLetters) {
      for (const c of TR.scene.children) {
        if (c.children && c.children[0] && c.children[0].isTroikaText) c.visible = false;
      }
    }
    if (TR.hidePlayer != null) { const p = TR.player(); if (p) p.visible = !TR.hidePlayer; }
  } }, 0.5, TR.r3f);
  // MEASURED on ANGLE-Vulkan/lavapipe headless: drawImage(webglCanvas) reads an
  // empty front buffer (mean luma 0) while gl.readPixels of the back buffer in
  // the same frame returns the graded image. So grab with readPixels after the
  // composer (priority 1) and flip rows into a 2D canvas.
  const gl = st.gl.getContext();
  let pix = null, img = null;
  st.internal.subscribe({ current: () => {
    if (!TR.cap.want) return;
    TR.cap.want = false;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (out.width !== w || out.height !== h) { out.width = w; out.height = h; img = null; }
    if (!pix || pix.length !== w * h * 4) pix = new Uint8Array(w * h * 4);
    if (!img) img = ctx.createImageData(w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pix);
    const row = w * 4, dst = img.data;
    for (let y = 0; y < h; y++) dst.set(pix.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    ctx.putImageData(img, 0, 0);
    TR.cap.got = true;
  } }, 101, TR.r3f);

  /*
   * Manual frameloop (control report recipe B): r3f stops scheduling frames and
   * each TR.step renders exactly one with delta === dt. Canvas reconfigures
   * (which would flip back to 'always') are swallowed; elapsedTime is kept
   * continuous because chunk engines key fades/retries on it.
   */
  TR.armNever = function () {
    const r3f = TR.r3f, st = r3f.getState(), keep = st.clock.elapsedTime;
    TR._origSetFrameloop = st.setFrameloop;
    st.setFrameloop('never');
    // r3f's update() calls clock.getDelta() BEFORE the 'never' branch; with
    // autoStart a stopped THREE.Clock restarts there and zeroes elapsedTime, so
    // the first advance() would see delta = TR.el (hundreds of seconds) — a NaN
    // camera at step 0 (measured). Keep it stopped: getDelta() then returns 0
    // and delta = timestamp - elapsedTime exactly.
    st.clock.autoStart = false;
    st.clock.running = false;
    st.clock.elapsedTime = keep;
    TR.el = keep;
    r3f.setState({ setFrameloop: () => {} });
  };
  TR.disarmNever = function () {
    if (!TR._origSetFrameloop) return;
    TR.r3f.setState({ setFrameloop: TR._origSetFrameloop });
    TR._origSetFrameloop('always');
    TR._origSetFrameloop = null;
  };

  /*
   * LOOP mode (UI beats): r3f's own rAF loop, driven by the fake clock one
   * frame per fastForward — the canvas is presented normally, so a page
   * screenshot composites GL + DOM (backdrop blur included). Entered from
   * 'never' AFTER the clock is installed+patched, restoring elapsedTime.
   */
  TR.toLoop = function () {
    const st = TR.r3f.getState(), keep = TR.el;
    TR.disarmNever();
    const c = TR.r3f.getState().clock;
    c.autoStart = true;
    c.start();
    c.elapsedTime = keep;
    TR.mode = 'loop';
  };
  TR.stepLoop = async function (ms) {
    const f0 = rt.framesRendered;
    await window.__pwClock.controller.fastForward(ms);
    return { n: rt.framesRendered - f0 };
  };

  /*
   * One deterministic frame: run the paused fake clock's timers/rAF consumers
   * for ms (performance.now, Date, intervals, springs), then render exactly one
   * r3f frame with delta = dt (default ms/1000; pass dt for slow motion / bullet
   * time) and copy the graded frame (priority 101, after the composer).
   */
  TR.step = async function (ms, grab, fmt = 'image/jpeg', q = 0.95, dt = null) {
    const f0 = rt.framesRendered;
    TR.cap.want = !!grab; TR.cap.got = false;
    await window.__pwClock.controller.runFor(ms);
    TR.el += dt != null ? dt : ms / 1000;
    TR.r3f.getState().advance(TR.el, true);
    const n = rt.framesRendered - f0;
    if (!grab) return { n };
    if (!TR.cap.got) return { n, miss: true };
    return { n, data: out.toDataURL(fmt, q) };
  };

  window.TR = TR;
})();
