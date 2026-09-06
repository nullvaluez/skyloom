import { Mesh as G, Texture as C, Vector3 as I, Frustum as Me, Matrix4 as be, Object3D as oe, Box3 as ke, MeshStandardMaterial as Te, FrontSide as Le, PlaneGeometry as Ie, BufferAttribute as z, LoadingManager as _e, MeshBasicMaterial as Se, CanvasTexture as Ue, ImageLoader as Y, SRGBColorSpace as De, FileLoader as Ae, MathUtils as Ve, Raycaster as Be } from "three";
const U = "0.12.1", wt = { name: "GuoJF", email: "hz_gjf@163.com" };

// R24 A PATCH 0 (R24_SWITCHBOARD) — the vendored-patch switchboard.
// -----------------------------------------------------------------------
// Every patch in this file reads ONE field of this object and, when the
// field is falsy, executes the upstream statements verbatim. The bundle
// deliberately does NOT import app code: its import list stays `three`
// alone (scripts/verify-vendor-three-tile.mjs gates that), so the app pokes
// this object once at import time — lib/fly/terrain-engine.js does
//   Object.assign(R24_SWITCHES, resolveTerraPace())
// and a node fixture can flip the same fields directly. See VENDOR.md for
// the patch ledger and the rules a patch must satisfy.
export const R24_SWITCHES = {
  // TERRA_PACE.* — see lib/fly/fly-constants.js
  skirtFast: false,
  skirtWorker: false,
  timerFix: false,
  mergeHysteresis: false,
  keepResident: false,
  parallelLoad: false,
  imageBitmap: false,
  preUpload: false,
  // knobs (only read when the switch above them is on)
  mergeHysteresisK: 1.6,
};

// R24 D PATCH 5 (LOD_CROSSFADE) — the crossfade hook holder.
// The app installs an object with { onRefine, onMerge } via setLodFadeHook();
// lib/fly/lod-crossfade.js owns every policy decision (the flag, the boot and
// warp suppression windows, the concurrency bound, the clock and the parent-
// texture lifetime). With NO hook installed this is null and patches 1 and 2
// are a single short-circuited `&&` in front of statements that are byte-
// verbatim upstream — which is the off-state for all three patches.
let ir = null;
function Xr(e) {
  ir = e;
}
class Z extends G {
  constructor(e, t) {
    super(e, t ?? []);
  }
  /** 计算并返回几何体最高点 */
  get maxHeight() {
    return this.geometry.computeBoundingBox(), this.geometry.boundingBox?.max.z ?? 0;
  }
  /** 根据材质数量同步 geometry 组 */
  syncGroups() {
    this.geometry.clearGroups(), this.material.forEach((e, t) => this.geometry.addGroup(0, 1 / 0, t));
  }
  /** 释放自身及子节点所有 geometry/material/texture 资源 */
  dispose() {
    this.traverse((e) => {
      e instanceof G && ((Array.isArray(e.material) ? e.material : [e.material]).forEach((r) => {
        for (const n in r) {
          const s = r[n];
          s instanceof C && (s.dispose(), s.source?.data instanceof ImageBitmap && s.source.data.close());
        }
        r.dispose();
      }), e.geometry?.dispose());
    });
  }
  /** 替换几何体，自动释放旧的 */
  setGeometry(e) {
    e !== this.geometry && this.geometry.dispose(), this.geometry = e;
  }
  /** 从根节点同步阴影设置 */
  syncShadow(e) {
    this.castShadow = e.castShadow, this.receiveShadow = e.receiveShadow;
  }
  /** 释放指定索引处的材质及其所有纹理资源 */
  disposeMaterial(e) {
    const t = this.material[e];
    if (t) {
      for (const r in t) {
        const n = t[r];
        n instanceof C && (n.dispose(), n.source?.data instanceof ImageBitmap && n.source.data.close());
      }
      t.dispose();
    }
  }
  /**
   * 替换指定索引处的材质，自动释放被替换的旧材质及其所有纹理资源
   * @param index - 材质数组索引
   * @param material - 新材质
   */
  setMaterial(e, t) {
    const r = this.material[e];
    r !== t && (r && this.disposeMaterial(e), this.material[e] = t);
  }
  /**
   * 同步材质池：释放不在 kept 中的旧材质，替换为 kept
   * @param kept - 需要保留的新材质列表
   */
  syncMaterials(e) {
    for (let t = 0; t < this.material.length; t++)
      e.includes(this.material[t]) || this.disposeMaterial(t);
    this.material.length = 0, this.material.push(...e);
  }
}
const N = new I(), q = new Me(), ze = new be(), P = new I(), J = new I();
class T extends oe {
  /**
   * 构造函数
   * @param x - 瓦片X坐标，默认：0
   * @param y - 瓦片Y坐标，默认：0
   * @param z - 瓦片层级，默认：0
   */
  constructor(e = 0, t = 0, r = 0) {
    super(), this.isTile = !0, this._root = this, this._sizeInWorld = -1, this._maxZ = 0, this._loadState = "empty", this._inFrustum = !1, this._epoch = 0, this._loadedEpoch = -1, this.x = e, this.y = t, this.z = r, this.name = `Tile ${r}-${e}-${t}`, this.up.set(0, 0, 1);
  }
  /** 瓦片数据加载状态 */
  get loadState() {
    return this._loadState;
  }
  /** 瓦片模型 */
  get model() {
    return this._model;
  }
  /** 子瓦片 */
  get subTiles() {
    return this._subTiles;
  }
  /** 瓦片是否在视锥体内 */
  get inFrustum() {
    return this._inFrustum;
  }
  /** 是否为叶子瓦片 */
  get isLeaf() {
    return this.children.length <= 1;
  }
  /**
   * 计算瓦片包围盒（世界坐标）
   * @returns 瓦片包围盒
   */
  get BBox() {
    const { x: e, y: t } = this.scale;
    return new ke(new I(-e, -t, 0), new I(e, t, this._maxZ)).applyMatrix4(this.matrixWorld);
  }
  /** 是否需要更新 */
  get _needVersionUpdate() {
    return this._loadedEpoch < this._root._epoch && this._loadState !== "empty";
  }
  /** 标记整个瓦片树数据过期 */
  markTreeNeedUpdate() {
    this._root._epoch++;
  }
  /**
   * 重载添加模型方式，其中增加设置根瓦片功能
   * @param object 要添加的子对象
   * @returns this
   */
  add(...e) {
    if (this.children.length === 5)
      throw new Error("Can't add more than 5 objects to a tile.");
    return super.add(...e), e.forEach((t) => {
      t instanceof T && (t._root = this._root);
    }), this;
  }
  /**
   * 瓦片树更新，该函数在每帧渲染中被调用
   * @param params 瓦片更新参数，包括相机、加载器、最小层级、最大层级和LOD阈值
   */
  update(e) {
    if (!this.parent) return;
    const { camera: t } = e;
    return t.getWorldPosition(N), q.setFromProjectionMatrix(ze.multiplyMatrices(t.projectionMatrix, t.matrixWorldInverse)), this._update(e), this;
  }
  /**
   * 重新加载瓦片数据
   * @param dispose - 是否销毁瓦片树
   * @returns this
   */
  reload(e = !0) {
    return e ? (this.unloadSubTiles(), this.unloadModel()) : this._root._epoch++, this;
  }
  /**
   * 卸载瓦片 (包括瓦片模型和其子瓦片)，释放资源
   * @returns this
   */
  unload() {
    return this.removeFromParent(), this.unloadSubTiles(), this.unloadModel(), this;
  }
  /**
   * 卸载瓦片模型(仅卸载当前瓦片内的模型)，释放几何体、纹理等 GPU 资源
   * @returns this
   */
  unloadModel() {
    if (this.model)
      return this.model.removeFromParent(), this.model.dispose(), this._loadState = "empty", this._model = void 0, this._loadedEpoch = -1, this._root.dispatchEvent({ type: "tile-unload", tile: this }), this;
  }
  /**
   * 递归卸载所有子瓦片模型(仅卸载子瓦片,不卸载当前瓦片)
   * @returns 返回自身，支持链式调用
   */
  unloadSubTiles() {
    const e = this.subTiles || this.children;
    this._subTiles = void 0;
    for (let t = e.length - 1; t >= 0; t--) {
      const r = e[t];
      r instanceof T && (r.removeFromParent(), r.unloadModel(), r.unloadSubTiles());
    }
    return this;
  }
  /**
   * LOD (Level of Detail) 层级评估与调度。
   * 根据当前瓦片的层级、视锥体可见性和距离比例，决定细化（create）、合并（remove）或不操作（none）。
   * @returns LODAction 细化或合并或无操作
   */
  LOD(e) {
    const { minLevel: t, maxLevel: r, LODThreshold: n } = e;
    this._getTileSize();
    const s = this._LODEvaluate(t, r, n);
    return s === 1 ? this.inFrustum && !this.subTiles && this._loadSubTiles(e) : s === 2 && this.subTiles && this._removeSubTiles(e), s;
  }
  /**
   * 瓦片树更新递归部分，逐帧遍历子瓦片执行视锥裁剪、LOD评估和阴影更新。
   * @param params 瓦片更新参数
   */
  _update(e) {
    const { loader: t } = e;
    if (!(t.downloadingThreads + 4 >= t.maxThreads || this.loadState === "loading")) {
      if (this._updateShadow(), this._needVersionUpdate) {
        console.assert(!!this.model), this._updateModel(t);
        return;
      }
      this._inFrustum = q.intersectsBox(this.BBox), !(!this._inFrustum && this._model && this.isLeaf) && (this.LOD(e), this.children.forEach((r) => r instanceof T && r._update(e)));
    }
  }
  /**
   * 瓦片阴影保持和跟瓦片阴影一致
   */
  _updateShadow() {
    this.model?.syncShadow(this._root);
  }
  /**
   * 计算瓦片大小
   * @returns 瓦片对角线长度
   */
  _getTileSize() {
    return this._sizeInWorld < 0 && (P.set(-this.scale.x, -this.scale.y, 0).applyMatrix4(this.matrixWorld), J.set(this.scale.x, this.scale.y, 0).applyMatrix4(this.matrixWorld), this._sizeInWorld = P.distanceTo(J)), this._sizeInWorld;
  }
  /**
   * 根据摄像机到瓦片的距离比例，评估瓦片是否需要细化或合并
   * @param minLevel 地图最小层级
   * @param maxLevel 地图最大层级
   * @param threshold 瓦片LOD距离比例阈值
   * @returns LODAction 细化或合并或无操作
   */
  _LODEvaluate(e, t, r) {
    const n = this._getDistRatio();
    // R24 A PATCH 2 (TERRA_PACE.mergeHysteresis / TERRA_PACE.keepResident) —
    // recon T1. Upstream uses ONE threshold for both directions with zero
    // hysteresis, and _getDistRatio multiplies the ratio by 5 (vs 0.8) the
    // instant a tile leaves the frustum — a 6.25x jump that satisfies the
    // merge rule immediately. So every yaw collapses the field behind the
    // camera one level per traversal; _removeSubTiles then DOWNLOADS a new
    // parent (a different capture at a coarser zoom, arriving a second later)
    // and disposes the children. That is the "terrain tiles swapping for
    // other ones" the user reports, and turning back re-refines from whatever
    // survived. Two independent switches:
    //   mergeHysteresis — merge only past threshold x K, so a tile sitting at
    //     the threshold cannot flip refine<->merge (four discarded downloads
    //     per cycle).
    //   keepResident — judge the merge with the IN-FRUSTUM formula, so
    //     leaving the frustum ALONE can never trigger it. Residency is then
    //     bounded by distance (the same rule in every direction) and by the
    //     byte LRU in lib/fly/tile-residency.js, which sets _r24Collapse (a
    //     deadline in performance.now() ms) on the subtrees it elects.
    // REFINE is byte-identical to upstream in both arms.
    if (R24_SWITCHES.mergeHysteresis || R24_SWITCHES.keepResident) {
      if (this.isLeaf && this.z < t && n <= r) return 1;
      if (this.isLeaf || this.z < e) return 0;
      // The LRU mark is honoured ONLY while the tile is out of view: a marked
      // tile that has come back on screen is spared by construction, so a
      // stale mark can never take the world out from under the player.
      if (!this.inFrustum && this._r24Collapse > 0 && this._r24Collapse > performance.now()) return 2;
      const k = R24_SWITCHES.mergeHysteresis ? R24_SWITCHES.mergeHysteresisK : 1;
      const m = R24_SWITCHES.keepResident ? this._getDistRatio(!0) : n;
      return m > r * k ? 2 : 0;
    }
    return this.isLeaf && this.z < t && n <= r ? 1 : !this.isLeaf && this.z >= e && n > r ? 2 : 0;
  }
  /**
   * 计算瓦片到相机的距离比例，用于 LOD 评估，值越小瓦片越密集。
   * @returns 距离比例值
   */
  _getDistRatio(r24AsInFrustum) {
    console.assert(this._sizeInWorld > 10), P.set(this.matrixWorld.elements[12], this._maxZ, this.matrixWorld.elements[14]);
    const t = N.distanceTo(P) / this._sizeInWorld;
    // R24 A PATCH 3 (TERRA_PACE.keepResident) — recon T1. The ONE caller that
    // passes true is PATCH 2's merge test; it wants the same distance law in
    // every direction, so the identical `t * 0.8` expression is returned
    // rather than a re-scaling of the x5 result (which would not be the same
    // float). Every upstream call site passes nothing and falls through to
    // the unchanged line below.
    if (r24AsInFrustum === !0) return t * 0.8;
    return this.inFrustum ? t * 0.8 : t * 5;
  }
  /**
   * 创建子瓦片并设置位置和缩放
   */
  static _createTile(e, t, r, n, s, o, a, l) {
    const h = new T(e, t, r);
    return h.position.set(n, s, 0), h.scale.set(o, a, l), h;
  }
  /**
   * 创建子瓦片
   * @param loader 瓦片加载器
   * @returns 子瓦片数组
   */
  _createChildren(e) {
    const { x: t, y: r, z: n } = this, s = [], o = t * 2, a = n + 1, l = 0.25, h = 0.5, c = 1;
    if (n === 0 && e.projectionID === "4326") {
      const u = r, d = 1, g = T._createTile(o, u, a, -l, 0, h, d, c), f = T._createTile(o + 1, u, a, l, 0, h, d, c);
      s.push(g, f);
    } else {
      const u = r * 2, d = 0.5, g = T._createTile(o, u, a, -l, l, h, d, c), f = T._createTile(o + 1, u, a, l, l, h, d, c), m = T._createTile(o, u + 1, a, -l, -l, h, d, c), w = T._createTile(o + 1, u + 1, a, l, -l, h, d, c);
      s.push(g, f, m, w);
    }
    return s;
  }
  /**
   * 加载子瓦片。
   * 创建子瓦片并异步下载其模型数据，下载完成后重新评估 LOD，
   * 下载完成后若仍需细化则用子瓦片替换当前瓦片模型，否则释放创建的子瓦片。
   * @param params 瓦片更新参数
   * @returns 是否成功创建子瓦片
   */
  async _loadSubTiles(e) {
    const { loader: t, minLevel: r, maxLevel: n, LODThreshold: s } = e, o = this._createChildren(t);
    if (this._subTiles = o, this.z < r - 1)
      return this.add(...o), o.forEach((c) => {
        c.updateMatrixWorld(), c.updateMatrix();
      }), !0;
    const a = o.map((c) => {
      const u = new Z();
      return c._model = u, c.add(u), c._loadState = "loading", t.update(c, u);
    });
    await Promise.all(a), o.forEach((c) => c._loadState = "loaded");
    const h = this._LODEvaluate(r, n, s) !== 1;
    // R24 D PATCH 6 (LOD_CROSSFADE) — parent-retained crossfade on REFINE.
    // The four children start sampling the PARENT texture through a clip-UV
    // transform and cross-dissolve to their own map over <=300 ms, so the
    // atomic swap below no longer changes texture sharpness and Martini relief
    // on the same frame (recon T4; the user's "terrain tiles swapping").
    // This MUST run before the expression below: `unloadModel()` disposes the
    // parent texture, and the hook detaches it from the parent material first
    // so the children can keep sampling it. Zero extra draws; one extra
    // sampler on the tile program. Off-state: `ir` is null, this line is a
    // short-circuited `&&`, and the statements after it are upstream verbatim.
    ir && ir.onRefine(this, o, h);
    return h ? this.unloadSubTiles() : (this.add(...o), o.forEach((c) => {
      c._loadedEpoch = this._root._epoch, c._updateShadow(), c._maxZ = c.model?.maxHeight ?? 0, this._root.dispatchEvent({ type: "tile-loaded", tile: c });
    }), this.unloadModel()), !h;
  }
  /**
   * 移除子瓦片（合并操作）。
   * 异步下载当前瓦片的高层级模型后重新评估 LOD，
   * 若仍需合并则替换子瓦片为当前瓦片模型，否则释放刚下载的模型。
   * @param params 瓦片更新参数
   * @returns 是否成功合并子瓦片
   */
  async _removeSubTiles(e) {
    const { loader: t, minLevel: r, maxLevel: n, LODThreshold: s } = e;
    this._subTiles = void 0;
    const o = new Z();
    this._model = o, this._loadState = "loading", await t.update(this, o), this._loadState = "loaded";
    const l = this._LODEvaluate(r, n, s) !== 2;
    // R24 D PATCH 7 (LOD_CROSSFADE) — the SAME crossfade run backwards on a
    // MERGE: the leaf children dissolve INTO the freshly loaded parent imagery
    // (mix 0 -> 1) and only then does the geometry swap below, so the swap
    // happens under a surface that already matches on both sides.
    // `_loadState` is held at "loading" across the await on purpose: _update()
    // skips a loading tile AND its children, which freezes this subtree for the
    // blend window instead of letting _LODEvaluate re-refine a parent whose
    // model is loaded but not yet added. The hook caps its own promise, so a
    // tile unloaded mid-blend can never leave this awaiting forever.
    // Off-state: `ir` is null and nothing is awaited.
    if (!l && ir) {
      const _w = ir.onMerge(this, o);
      if (_w) {
        this._loadState = "loading";
        await _w;
        this._loadState = "loaded";
      }
    }
    return l ? this.unloadModel() : (this._loadedEpoch = this._root._epoch, this._updateShadow(), this._maxZ = o.maxHeight, this.add(o), this.unloadSubTiles(), this._root.dispatchEvent({ type: "tile-loaded", tile: this })), l;
  }
  /**
   * 更新瓦片模型数据（用于脏瓦片重新加载）。
   * 异步重新下载当前瓦片的数据并更新到已有模型中。
   * @param loader 瓦片加载器
   */
  async _updateModel(e) {
    if (!this.model) return;
    const t = this._root._epoch;
    this._loadState = "loading";
    const r = await e.update(this, this.model);
    this._loadState = "loaded", r && (this.parent ? (this._loadedEpoch = t, this._maxZ = this.model.maxHeight, this._root.dispatchEvent({ type: "tile-loaded", tile: this })) : this.unloadModel());
  }
}
class ae extends Te {
  constructor(e = {}) {
    super({ transparent: !1, side: Le, ...e });
  }
}
var B = /* @__PURE__ */ ((i) => (i[i.Unknown = 0] = "Unknown", i[i.Point = 1] = "Point", i[i.Linestring = 2] = "Linestring", i[i.Polygon = 3] = "Polygon", i))(B || {});
class Pe {
  constructor() {
    this._debug = 0;
  }
  /** 当前 debug 级别（0-4） */
  get debug() {
    return this._debug;
  }
  set debug(e) {
    this._debug = e;
  }
  /**
   * 输出普通日志（debug >= 4）
   * @param args 日志内容
   */
  log(...e) {
    this._debug >= 4 && console.log(...e);
  }
  /**
   * 输出信息日志（debug >= 3）
   * @param args 日志内容
   */
  info(...e) {
    this._debug >= 3 && console.info(...e);
  }
  /**
   * 输出警告日志（debug >= 2）
   * @param args 日志内容
   */
  warn(...e) {
    this._debug >= 2 && console.warn(...e);
  }
  /**
   * 输出错误日志（debug >= 1）
   * @param args 日志内容
   */
  error(...e) {
    this._debug >= 1 && console.error(...e);
  }
}
const F = new Pe();
class xt {
  /**
   * 渲染矢量数据
   * @param ctx 渲染上下文
   * @param type 元素类型
   * @param feature 元素
   * @param style 样式
   * @param scale 拉伸倍数
   */
  render(e, t, r, n, s = 1) {
    switch (e.lineCap = "round", e.lineJoin = "round", (n.shadowBlur ?? 0) > 0 && (e.shadowBlur = n.shadowBlur ?? 2, e.shadowColor = n.shadowColor ?? "black", e.shadowOffsetX = n.shadowOffset ? n.shadowOffset[0] : 0, e.shadowOffsetY = n.shadowOffset ? n.shadowOffset[1] : 0), t) {
      case B.Point:
        e.textAlign = "center", e.textBaseline = "middle", e.font = n.font ?? "14px Arial", e.fillStyle = n.fontColor ?? "white", this._renderPointText(e, r, s, n.textField ?? "name", n.fontOffset ?? [0, -8]);
        break;
      case B.Linestring:
        this._renderLineString(e, r, s);
        break;
      case B.Polygon:
        this._renderPolygon(e, r, s);
        break;
      default:
        F.warn(`Unknown feature type: ${t}`);
    }
    (n.fill || t === B.Point) && (e.globalAlpha = n.fillOpacity || 0.5, e.fillStyle = n.fillColor || n.color || "#3388ff", e.fill(n.fillRule || "evenodd")), (n.stroke ?? !0) && (n.weight ?? 1) > 0 && (e.globalAlpha = n.opacity || 1, e.lineWidth = n.weight || 1, e.strokeStyle = n.color || "#3388ff", e.setLineDash(n.dashArray || []), e.stroke());
  }
  /**
   * 渲染点要素文本
   * @param ctx Canvas 渲染上下文
   * @param feature 矢量要素
   * @param scale 缩放倍数
   * @param textField 属性字段名，用于标注文本
   * @param fontOffset 文本偏移量
   */
  _renderPointText(e, t, r = 1, n = "name", s = [0, 0]) {
    const o = t.geometry;
    e.beginPath();
    for (const l of o)
      for (let h = 0; h < l.length; h++) {
        const c = l[h];
        e.arc(c.x * r, c.y * r, 2, 0, 2 * Math.PI);
      }
    const a = t.properties;
    a && a[n] && e.fillText(
      a[n],
      o[0][0].x * r + s[0],
      o[0][0].y * r + s[1]
    );
  }
  /**
   * 渲染线要素
   * @param ctx Canvas 渲染上下文
   * @param feature 矢量要素
   * @param scale 缩放倍数
   */
  _renderLineString(e, t, r) {
    const n = t.geometry;
    e.beginPath();
    for (const s of n)
      for (let o = 0; o < s.length; o++) {
        const { x: a, y: l } = s[o];
        o === 0 ? e.moveTo(a * r, l * r) : e.lineTo(a * r, l * r);
      }
  }
  /**
   * 渲染面要素
   * @param ctx Canvas 渲染上下文
   * @param feature 矢量要素
   * @param scale 缩放倍数
   */
  _renderPolygon(e, t, r) {
    const n = t.geometry;
    e.beginPath();
    for (let s = 0; s < n.length; s++) {
      const o = n[s];
      for (let a = 0; a < o.length; a++) {
        const { x: l, y: h } = o[a];
        a === 0 ? e.moveTo(l * r, h * r) : e.lineTo(l * r, h * r);
      }
      e.closePath();
    }
  }
}
function Ee(i) {
  const e = [];
  for (let t = 0; t < i; t++)
    if (t >= 17)
      e.push(0);
    else {
      const r = 1 - t / 17;
      e.push(Math.round(7e3 * r * r * r));
    }
  return e;
}
const le = Ee(21);
function Ce(i) {
  if (i.length < 4)
    throw new Error(`DEM array length must be greater than 4, current length is ${i.length}`);
  const e = Math.floor(Math.sqrt(i.length)), t = e, r = e, n = je(r, t);
  return { attributes: Fe(i, r, t, n), indices: n };
}
function Fe(i, e, t, r) {
  const n = t * e, s = 1 / (t - 1), o = 1 / (e - 1), a = new Float32Array(n * 3), l = new Float32Array(n * 2), h = t;
  let c = 0;
  for (let u = 0; u < e; u++) {
    const d = u * o, g = (e - u - 1) * h;
    for (let f = 0; f < t; f++) {
      const m = f * s;
      l[c * 2] = m, l[c * 2 + 1] = d, a[c * 3] = m - 0.5, a[c * 3 + 1] = d - 0.5, a[c * 3 + 2] = i[g + f], c++;
    }
  }
  return {
    position: { value: a, size: 3 },
    texcoord: { value: l, size: 2 },
    normal: { value: ce(a, r), size: 3 }
  };
}
function je(i, e) {
  const t = 6 * (e - 1) * (i - 1), r = new Uint32Array(t);
  let n = 0;
  for (let s = 0; s < i - 1; s++)
    for (let o = 0; o < e - 1; o++) {
      const a = s * e + o, l = a + 1, h = a + e, c = h + 1, u = n * 6;
      r[u] = a, r[u + 1] = l, r[u + 2] = h, r[u + 3] = h, r[u + 4] = l, r[u + 5] = c, n++;
    }
  return r;
}
function ce(i, e) {
  const t = new Float32Array(i.length);
  for (let r = 0; r < e.length; r += 3) {
    const n = e[r] * 3, s = e[r + 1] * 3, o = e[r + 2] * 3, a = i[s] - i[n], l = i[s + 1] - i[n + 1], h = i[s + 2] - i[n + 2], c = i[o] - i[n], u = i[o + 1] - i[n + 1], d = i[o + 2] - i[n + 2], g = l * d - h * u, f = h * c - a * d, m = a * u - l * c, w = 1 / Math.hypot(g, f, m);
    t[n] = t[s] = t[o] = g * w, t[n + 1] = t[s + 1] = t[o + 1] = f * w, t[n + 2] = t[s + 2] = t[o + 2] = m * w;
  }
  return t;
}
function yt(i, e) {
  const t = (o, a, l) => {
    const h = Math.floor(o[0] * a), c = Math.floor(o[1] * l), u = Math.floor((o[2] - o[0]) * a) + 1, d = Math.floor((o[3] - o[1]) * l) + 1;
    return { x: h, y: c, w: u, h: d };
  }, r = (o, a, l, h, c, u) => {
    const d = new Float32Array(c * u);
    for (let g = 0; g < u; g++)
      for (let f = 0; f < c; f++) {
        const m = (g + h) * a + (f + l), w = g * c + f;
        d[w] = o[m];
      }
    return d;
  }, n = t(e, i.width, i.height);
  return { dem: r(i.dem, i.width, n.x, n.y, n.w, n.h), width: n.w, height: n.h };
}
function vt(i, e) {
  return new he(i.width).createTile(i.dem).getGeometryData(le[e] || 0);
}
class he {
  /**
   * @param gridSize - 网格尺寸，必须为 2^n+1，默认 257
   */
  constructor(e = 257) {
    this.gridSize = e;
    const t = e - 1;
    if (t & t - 1)
      throw new Error(`Grid size must be 2^n+1, current size is ${e}`);
    this.numTriangles = t * t * 2 - 2, this.numParentTriangles = this.numTriangles - t * t, this.indices = new Uint32Array(this.gridSize * this.gridSize), this.coords = new Uint16Array(this.numTriangles * 4);
    for (let r = 0; r < this.numTriangles; r++) {
      let n = r + 2, s = 0, o = 0, a = 0, l = 0, h = 0, c = 0;
      for (n & 1 ? a = l = h = t : s = o = c = t; (n >>= 1) > 1; ) {
        const d = s + a >> 1, g = o + l >> 1;
        n & 1 ? (a = s, l = o, s = h, o = c) : (s = a, o = l, a = h, l = c), h = d, c = g;
      }
      const u = r * 4;
      this.coords[u + 0] = s, this.coords[u + 1] = o, this.coords[u + 2] = a, this.coords[u + 3] = l;
    }
  }
  /** 根据地形数据创建 MartiniTile 实例 */
  createTile(e) {
    return new Oe(e, this);
  }
}
class Oe {
  constructor(e, t) {
    const r = t.gridSize;
    if (e.length !== r * r)
      throw new Error(`Terrain data length expected ${r * r} (${r} x ${r}), but got ${e.length}`);
    this.terrain = e, this.martini = t, this.errors = new Float32Array(e.length), this.update();
  }
  /** 自底向上遍历所有三角形，计算每个顶点的最大误差 */
  update() {
    const { numTriangles: e, numParentTriangles: t, coords: r, gridSize: n } = this.martini, { terrain: s, errors: o } = this;
    for (let a = e - 1; a >= 0; a--) {
      const l = a * 4, h = r[l + 0], c = r[l + 1], u = r[l + 2], d = r[l + 3], g = h + u >> 1, f = c + d >> 1, m = g + f - c, w = f + h - g, L = (s[c * n + h] + s[d * n + u]) / 2, p = f * n + g, x = Math.abs(L - s[p]);
      if (o[p] = Math.max(o[p], x), a < t) {
        const b = (c + w >> 1) * n + (h + m >> 1), M = (d + w >> 1) * n + (u + m >> 1);
        o[p] = Math.max(o[p], o[b], o[M]);
      }
    }
  }
  /**
   * 根据最大误差阈值提取简化后的几何体数据
   * @param maxError - 最大允许误差，误差低于此值的三角形将被合并
   */
  getGeometryData(e = 0) {
    const { gridSize: t, indices: r } = this.martini, { errors: n } = this;
    let s = 0, o = 0;
    const a = t - 1;
    let l, h, c = 0;
    r.fill(0);
    function u(p, x, b, M, k, y) {
      const _ = p + b >> 1, S = x + M >> 1;
      Math.abs(p - k) + Math.abs(x - y) > 1 && n[S * t + _] > e ? (u(k, y, p, x, _, S), u(b, M, k, y, _, S)) : (l = x * t + p, h = M * t + b, c = y * t + k, r[l] === 0 && (r[l] = ++s), r[h] === 0 && (r[h] = ++s), r[c] === 0 && (r[c] = ++s), o++);
    }
    u(0, 0, a, a, a, 0), u(a, a, 0, 0, 0, a);
    const d = s * 2, g = o * 3, f = new Uint16Array(d), m = new Uint32Array(g);
    let w = 0;
    function L(p, x, b, M, k, y) {
      const _ = p + b >> 1, S = x + M >> 1;
      if (Math.abs(p - k) + Math.abs(x - y) > 1 && n[S * t + _] > e)
        L(k, y, p, x, _, S), L(b, M, k, y, _, S);
      else {
        const O = r[x * t + p] - 1, R = r[M * t + b] - 1, W = r[y * t + k] - 1;
        f[2 * O] = p, f[2 * O + 1] = x, f[2 * R] = b, f[2 * R + 1] = M, f[2 * W] = k, f[2 * W + 1] = y, m[w++] = O, m[w++] = R, m[w++] = W;
      }
    }
    return L(0, 0, a, a, a, 0), L(a, a, 0, 0, 0, a), {
      attributes: this._getMeshAttributes(this.terrain, f, m),
      indices: m
    };
  }
  /**
   * 从简化后的顶点和三角形数据生成 Three.js 几何体属性
   * @param terrain - 地形高程数据
   * @param vertices - 顶点网格坐标
   * @param indices - 三角形索引
   */
  _getMeshAttributes(e, t, r) {
    const n = Math.floor(Math.sqrt(e.length)), s = n - 1, o = t.length / 2, a = new Float32Array(o * 3), l = new Float32Array(o * 2);
    for (let c = 0; c < o; c++) {
      const u = t[c * 2], d = t[c * 2 + 1], g = d * n + u;
      a[3 * c + 0] = u / s - 0.5, a[3 * c + 1] = 0.5 - d / s, a[3 * c + 2] = e[g], l[2 * c + 0] = u / s, l[2 * c + 1] = 1 - d / s;
    }
    const h = ce(a, r);
    return {
      position: { value: a, size: 3 },
      texcoord: { value: l, size: 2 },
      normal: { value: h, size: 3 }
    };
  }
}
function E(...i) {
  if (i.length < 1)
    throw new Error("concatenateTypedArrays: at least one typed array is required");
  const e = i[0].constructor, t = i.reduce((s, o) => s + o.length, 0), r = new e(t);
  let n = 0;
  for (const s of i)
    r.set(s, n), n += s.length;
  return r;
}
function Re(i, e, t, r) {
  const n = We(e), s = n.length, o = new Float32Array(s * 6), a = new Float32Array(s * 4), l = new e.constructor(s * 6), h = new Float32Array(s * 6);
  for (let u = 0; u < s; u++)
    Xe({
      edge: n[u],
      edgeIndex: u,
      attributes: i,
      skirtHeight: t,
      newPosition: o,
      newTexcoord0: a,
      newTriangles: l,
      newNormals: h
    });
  i.position.value = E(i.position.value, o), i.texcoord.value = E(i.texcoord.value, a), i.normal.value = E(i.normal.value, h);
  const c = E(e, l);
  return {
    attributes: i,
    indices: c
  };
}
function We(i) {
  const e = [], t = Array.isArray(i) ? i : Array.from(i);
  for (let n = 0; n < t.length; n += 3)
    e.push([t[n], t[n + 1]], [t[n + 1], t[n + 2]], [t[n + 2], t[n]]);
  e.sort(([n, s], [o, a]) => {
    const l = Math.min(n, s), h = Math.min(o, a);
    return l !== h ? l - h : Math.max(n, s) - Math.max(o, a);
  });
  const r = [];
  for (let n = 0; n < e.length; n++)
    n + 1 < e.length && e[n][0] === e[n + 1][1] && e[n][1] === e[n + 1][0] ? n++ : r.push(e[n]);
  return r;
}
function Xe({
  edge: i,
  edgeIndex: e,
  attributes: t,
  skirtHeight: r,
  newPosition: n,
  newTexcoord0: s,
  newTriangles: o,
  newNormals: a
}) {
  const h = t.position.value.length / 3, c = e * 2, u = c + 1;
  n.set(t.position.value.subarray(i[0] * 3, i[0] * 3 + 3), c * 3), n[c * 3 + 2] -= r, n.set(t.position.value.subarray(i[1] * 3, i[1] * 3 + 3), u * 3), n[u * 3 + 2] -= r, s.set(t.texcoord.value.subarray(i[0] * 2, i[0] * 2 + 2), c * 2), s.set(t.texcoord.value.subarray(i[1] * 2, i[1] * 2 + 2), u * 2);
  const d = e * 6;
  o[d] = i[0], o[d + 1] = h + u, o[d + 2] = i[1], o[d + 3] = h + u, o[d + 4] = i[0], o[d + 5] = h + c, a[d] = 0, a[d + 1] = 0, a[d + 2] = 1, a[d + 3] = 0, a[d + 4] = 0, a[d + 5] = 1;
}
class A extends Ie {
  constructor() {
    super(1, 1, 1, 1), this.type = "TileGeometry";
  }
  /**
   * 根据几何体数据构建几何体
   * @param geometryData 几何体数据（顶点、UV、法线、索引）
   * @param z 瓦片层级，用于计算裙边高度，0 表示不生成裙边
   */
  setAttributes(e, t = 0) {
    const r = t === 0 ? 0 : 2e5 / t / t;
    r > 0 && (e = Re(e.attributes, e.indices, r));
    const { attributes: n, indices: s } = e;
    return this.setIndex(new z(s, 1)), this.setAttribute("position", new z(n.position.value, n.position.size)), this.setAttribute("uv", new z(n.texcoord.value, n.texcoord.size)), this.setAttribute("normal", new z(n.normal.value, n.normal.size)), this;
  }
  /**
   * 根据 DEM 数据构建几何体
   * @param data DEM 高程数据（数组）
   * @param z 瓦片层级
   * @param useMartini 是否使用 Martini 三角网简化
   */
  setData(e, t, r = !1) {
    if (r) {
      const n = Math.floor(Math.sqrt(e.length)), a = new he(n).createTile(e).getGeometryData(le[t] || 0);
      this.setAttributes(a, t);
    } else {
      const n = Ce(e);
      this.setAttributes(n, t);
    }
    return this;
  }
}
class Q extends _e {
  constructor() {
    super(...arguments), this.onParseEnd = void 0;
  }
  /**
   * 通知解析完成
   * @param geometry 解析完成的几何体
   */
  parseEnd(e) {
    this.onParseEnd && this.onParseEnd(e);
  }
}
const K = { name: "GuoJF" }, v = {
  manager: new Q(),
  // 地形加载器字典
  demLoaderMap: /* @__PURE__ */ new Map(),
  // 影像加载器字典
  imgLoaderMap: /* @__PURE__ */ new Map(),
  /**
   * 注册材质加载器
   * @param loader 材质加载器
   * @returns 工厂实例，支持链式调用
   */
  registerMaterialLoader(i) {
    return this.imgLoaderMap.set(i.dataType, i), i.info.author = i.info.author ?? K.name, this;
  },
  /**
   * 注册几何体加载器
   * @param loader 几何体加载器
   * @returns 工厂实例，支持链式调用
   */
  registerGeometryLoader(i) {
    return this.demLoaderMap.set(i.dataType, i), i.info.author = i.info.author ?? K.name, this;
  },
  /**
   * 根据数据源获取材质加载器
   * @param source 数据源或数据类型字符串
   * @returns 材质加载器
   */
  getMaterialLoader(i) {
    const e = typeof i == "string" ? i : i.dataType, t = this.imgLoaderMap.get(e);
    if (t)
      return t;
    throw new Error(`Image source type "${e}" is not supported!`);
  },
  /**
   * 根据数据源获取几何体加载器
   * @param source 数据源或数据类型字符串
   * @returns 几何体加载器
   */
  getGeometryLoader(i) {
    const e = typeof i == "string" ? i : i.dataType, t = this.demLoaderMap.get(e);
    if (t)
      return t;
    throw new Error(`DEM source type "${e}" is not supported!`);
  },
  /**
   * 获取所有已注册的加载器
   * @returns 包含影像加载器和地形加载器的对象
   */
  getLoaders() {
    return {
      imgLoaders: Array.from(this.imgLoaderMap.values()),
      demLoaders: Array.from(this.demLoaderMap.values())
    };
  },
  /**
   * 重置工厂状态，清空所有已注册的加载器
   * 用于测试隔离或重新初始化场景
   */
  reset() {
    this.demLoaderMap.clear(), this.imgLoaderMap.clear(), this.manager = new Q();
  }
};
function ue(i, e) {
  const t = Math.floor(i[0] * e), r = Math.floor(i[1] * e), n = Math.floor((i[2] - i[0]) * e), s = Math.floor((i[3] - i[1]) * e);
  return { sx: t, sy: r, sw: n, sh: s };
}
function de(i, e, t, r) {
  if (r < i.minLevel)
    return {
      url: void 0,
      clipBounds: [0, 0, 1, 1]
    };
  if (r <= i.maxLevel)
    return {
      url: i.getUrl(e, t, r),
      clipBounds: [0, 0, 1, 1]
    };
  const n = He(e, t, r, i.maxLevel), s = n.coord;
  return {
    url: i.getUrl(s.x, s.y, s.z),
    clipBounds: n.bounds
  };
}
function Ye(i, e) {
  const t = i.width, r = new OffscreenCanvas(t, t), n = r.getContext("2d"), { sx: s, sy: o, sw: a, sh: l } = ue(e, i.width);
  return n.drawImage(i, s, o, a, l, 0, 0, t, t), r;
}
function He(i, e, t, r) {
  const s = 2 ** (t - r), o = Math.floor(i / s), a = Math.floor(e / s), l = i / s - o, h = e / s - a, c = (i + 1) / s - o, u = (e + 1) / s - a;
  return {
    coord: { x: o, y: a, z: r },
    bounds: [l, h, c, u]
  };
}
function $e(i, e, t) {
  if (e[0] <= t[0] && e[1] <= t[1] && e[2] >= t[2] && e[3] >= t[3])
    return i;
  const [r, n, s, o] = e, [a, l, h, c] = t, u = Math.max(a, r), d = Math.min(h, s), g = Math.max(l, n), f = Math.min(c, o);
  if (u >= d || g >= f)
    return i;
  const m = new OffscreenCanvas(i.width, i.height), w = m.getContext("2d");
  w.drawImage(i, 0, 0);
  const L = h - a, p = c - l, x = (u - a) / L * m.width, b = (d - a) / L * m.width, M = m.height - (f - l) / p * m.height, k = m.height - (g - l) / p * m.height, y = { x, y: M, w: b - x, h: k - M };
  return w.globalCompositeOperation = "destination-in", w.fillRect(y.x, y.y, y.w, y.h), m;
}
class Ge {
  constructor() {
    this._bounds = [-180, -85, 180, 85], this._maxThreads = 5, this._downloadingCount = 0, this._imgSource = [], this.debug = 0, this._errorMaterial = new Se({
      color: 0,
      transparent: !0,
      opacity: 0.2,
      name: "error-material"
    });
  }
  get bounds() {
    return this._bounds;
  }
  set bounds(e) {
    this._bounds = e;
  }
  /** 获取最大下载线程数 */
  get maxThreads() {
    return this._maxThreads;
  }
  /** 设置最大下载线程数 */
  set maxThreads(e) {
    this._maxThreads = e;
  }
  /** 获取瓦片下载并发数量 */
  get downloadingThreads() {
    return this._downloadingCount;
  }
  /** 获取影像数据源 */
  get imgSource() {
    return this._imgSource;
  }
  /** 设置影像数据源 */
  set imgSource(e) {
    this._imgSource = e;
  }
  /** 获取地形数据源 */
  get demSource() {
    return this._demSource;
  }
  /** 设置地形数据源 */
  set demSource(e) {
    this._demSource = e;
  }
  /** 获取地图投影ID */
  get projectionID() {
    return this.imgSource[0]?.projectionID ?? "3857";
  }
  /** 加载管理器 */
  get manager() {
    return v.manager;
  }
  /** 日志方法，debug > 0 时输出 */
  log(...e) {
    F.error(...e);
  }
  /**
   * 更新瓦片数据（材质和几何体）
   * @param params 加载参数（瓦片坐标、范围等）
   * @param tileMesh 待更新的瓦片网格
   * @returns 内容是否发生变化
   */
  async update(e, t) {
    this._downloadingCount++;
    let r = !1;
    try {
      const n = await this.updateMaterial(e, t), s = await this.updateGeometry(e, t);
      r = n || s, r && t.syncGroups();
    } finally {
      this._downloadingCount--;
    }
    return r;
  }
  /**
   * 更新几何体
   * @param params 加载参数
   * @param tileMesh 瓦片网格
   * @returns 几何体是否重新加载
   */
  async updateGeometry(e, t) {
    const r = this.demSource;
    if (!r || !this._checkBounds(r, e))
      return t.setGeometry(new A()), !0;
    if (t.geometry.userData.source === r)
      return !1;
    const s = await v.getGeometryLoader(r).load({ source: r, ...e }).then((o) => (o.userData.source = r, o)).catch((o) => (this.log("Failed to load geometry:", o), new A()));
    return t.setGeometry(s), !0;
  }
  /**
   * 更新材质
   * @param params 加载参数
   * @param tileMesh 瓦片网格
   * @returns 材质是否发生变化
   */
  async updateMaterial(e, t) {
    const r = t.material, n = this.imgSource.filter((l) => this._checkBounds(l, e)), s = [];
    let o = r.length !== n.length;
    const a = async (l) => await v.getMaterialLoader(l).load({ source: l, ...e }).then((c) => (c.userData.source = l, c)).catch((c) => (this.log("Failed to load material:", c), this._errorMaterial.clone()));
    for (const l of n) {
      const h = r.find((c) => c?.userData?.source === l);
      if (h)
        s.push(h);
      else {
        o = !0;
        const c = await a(l);
        this._materialClip(c, l, e), s.push(c);
      }
    }
    return t.syncMaterials(s), o;
  }
  /** 将材质纹理裁剪到地图范围 */
  _materialClip(e, t, r) {
    if ("map" in e && e.map instanceof C) {
      const n = e.map;
      n.image && (n.image = $e(n.image, t._projectionBounds, r.bounds)), n.needsUpdate = !0;
    }
    return this;
  }
  /** 检查瓦片是否在数据源范围内 */
  _checkBounds(e, t) {
    const r = e._projectionBounds, n = t.bounds;
    return t.z >= e.minLevel && n[2] >= r[0] && n[3] >= r[1] && n[0] <= r[2] && n[1] <= r[3];
  }
}
class H {
  constructor() {
    this.info = {
      version: U,
      description: "Base class for terrain loaders"
    }, this.dataType = "";
  }
  /**
   * 从数据源加载瓦片几何体数据
   * @param params 瓦片加载参数（数据源、坐标、范围等）
   * @returns 瓦片几何体
   */
  async load(e) {
    const { source: t, x: r, y: n, z: s } = e, { url: o, clipBounds: a } = de(t, r, n, s);
    if (o) {
      const l = await this.doLoad(o, { ...e, clipBounds: a });
      return v.manager.parseEnd(l), l;
    } else
      return new A();
  }
}
class Ze {
  constructor() {
    this.info = {
      version: U,
      description: "Base class for image loaders"
    }, this.dataType = "", this._material = new ae();
  }
  /** 获取默认材质 */
  get material() {
    return this._material;
  }
  /** 设置默认材质（自动释放旧材质） */
  set material(e) {
    this._material !== e && (this._material.dispose(), this._material = e);
  }
  /**
   * 从数据源加载瓦片材质
   * @param params 瓦片加载参数（数据源、坐标、范围等）
   * @returns 瓦片材质
   */
  async load(e) {
    const { source: t, x: r, y: n, z: s } = e, o = this.createMaterial(e);
    o.transparent = e.source.transparent, o.opacity = e.source.opacity;
    const { url: a, clipBounds: l } = de(t, r, n, s);
    if (a) {
      const c = await this.doLoad(a, { ...e, clipBounds: l });
      c && (o.map = c, o.addEventListener("dispose", h));
    }
    return o;
    function h(c) {
      const u = c.target.map;
      u && (u.image instanceof ImageBitmap && u.image.close(), u.dispose()), c.target.removeEventListener("dispose", h);
    }
  }
  /**
   * 创建瓦片材质实例
   * @param _params 瓦片加载参数
   * @returns 瓦片材质
   */
  createMaterial(e) {
    return this.material.clone();
  }
  /**
   * 下载影像数据，由子类实现
   * @param _url 数据URL
   * @param _params 加载参数（包含裁剪边界）
   * @returns 纹理对象
   */
  async doLoad(e, t) {
    return Promise.resolve(void 0);
  }
}
class Mt {
  constructor() {
    this.info = {
      version: U,
      description: "Abstract canvas tile loader"
    }, this.dataType = "";
  }
  /**
   * 异步加载瓦片材质，通过Canvas绘制生成纹理
   * @param params 瓦片加载参数
   * @returns 瓦片材质
   */
  async load(e) {
    const t = this._createCanvasContext(256, 256);
    this.drawTile(t, e);
    const r = new ae({
      transparent: e.source.transparent,
      map: new Ue(t.canvas),
      opacity: e.source.opacity
    }), n = (s) => {
      s.target.map?.dispose(), r.removeEventListener("dispose", n);
    };
    return r.addEventListener("dispose", n), r;
  }
  _createCanvasContext(e, t) {
    const n = new OffscreenCanvas(e, t).getContext("2d");
    if (!n)
      throw new Error("Failed to create Canvas context");
    return n;
  }
}
class Ne extends Ze {
  constructor() {
    super(...arguments), this.info = {
      version: U,
      description: "XYZ tile image loader for loading standard XYZ tile images"
    }, this.dataType = "image", this.loader = new Y(v.manager);
  }
  /**
   * 加载瓦片图像并转换为纹理
   *
   * 当请求级别超过数据源最大级别时，从最大级别的父瓦片中裁剪出对应区域，
   * 以保证纹理内容正确。
   *
   * @param url 图像资源URL
   * @param params 加载参数，包含瓦片坐标和裁剪边界
   * @returns 带 sRGB 色彩空间的纹理对象
   */
  async doLoad(e, t) {
    let r = await this.loader.loadAsync(e);
    const n = t.clipBounds;
    n[2] - n[0] < 1 && (r = Ye(r, n));
    const s = new C(r);
    return s.colorSpace = De, s;
  }
}
class $ {
  /**
   * Constructs a new Worker pool.
   *
   * @param {number} [pool=4] - The size of the pool.
   */
  constructor(e = 4) {
    this.pool = e, this.queue = [], this.workers = [], this.workersResolve = [], this.workerStatus = 0, this.workerCreator = null;
  }
  _initWorker(e) {
    if (!this.workers[e]) {
      const t = this.workerCreator();
      t.addEventListener("message", this._onMessage.bind(this, e)), this.workers[e] = t;
    }
  }
  _getIdleWorker() {
    for (let e = 0; e < this.pool; e++)
      if (!(this.workerStatus & 1 << e)) return e;
    return -1;
  }
  _onMessage(e, t) {
    const r = this.workersResolve[e];
    if (r && r(t), this.queue.length) {
      const { resolve: n, msg: s, transfer: o } = this.queue.shift();
      this.workersResolve[e] = n, this.workers[e].postMessage(s, o);
    } else
      this.workerStatus ^= 1 << e;
  }
  /**
   * Sets a function that is responsible for creating Workers.
   *
   * @param {Function} workerCreator - The worker creator function.
   */
  setWorkerCreator(e) {
    this.workerCreator = e;
  }
  /**
   * Sets the Worker limit
   *
   * @param {number} pool - The size of the pool.
   */
  setWorkerLimit(e) {
    this.pool = e;
  }
  /**
   * Post a message to an idle Worker. If no Worker is available,
   * the message is pushed into a message queue for later processing.
   *
   * @param {Object} msg - The message.
   * @param {Array<ArrayBuffer>} transfer - An array with array buffers for data transfer.
   * @return {Promise} A Promise that resolves when the message has been processed.
   */
  postMessage(e, t) {
    return new Promise((r) => {
      const n = this._getIdleWorker();
      n !== -1 ? (this._initWorker(n), this.workerStatus |= 1 << n, this.workersResolve[n] = r, this.workers[n].postMessage(e, t)) : this.queue.push({ resolve: r, msg: e, transfer: t });
    });
  }
  /**
   * Terminates all Workers of this pool. Call this  method whenever this
   * Worker pool is no longer used in your app.
   */
  dispose() {
    this.workers.forEach((e) => e.terminate()), this.workersResolve.length = 0, this.workers.length = 0, this.queue.length = 0, this.workerStatus = 0;
  }
}
const fe = '(function(){"use strict";class J{constructor(d=257){this.gridSize=d;const k=d-1;if(k&k-1)throw new Error(`Grid size must be 2^n+1, current size is ${d}`);this.numTriangles=k*k*2-2,this.numParentTriangles=this.numTriangles-k*k,this.indices=new Uint32Array(this.gridSize*this.gridSize),this.coords=new Uint16Array(this.numTriangles*4);for(let V=0;V<this.numTriangles;V++){let a=V+2,r=0,e=0,s=0,t=0,i=0,u=0;for(a&1?s=t=i=k:r=e=u=k;(a>>=1)>1;){const f=r+s>>1,h=e+t>>1;a&1?(s=r,t=e,r=i,e=u):(r=s,e=t,s=i,t=u),i=f,u=h}const n=V*4;this.coords[n+0]=r,this.coords[n+1]=e,this.coords[n+2]=s,this.coords[n+3]=t}}createTile(d){return new K(d,this)}}class K{constructor(d,k){const V=k.gridSize;if(d.length!==V*V)throw new Error(`Terrain data length expected ${V*V} (${V} x ${V}), but got ${d.length}`);this.terrain=d,this.martini=k,this.errors=new Float32Array(d.length),this.update()}update(){const{numTriangles:d,numParentTriangles:k,coords:V,gridSize:a}=this.martini,{terrain:r,errors:e}=this;for(let s=d-1;s>=0;s--){const t=s*4,i=V[t+0],u=V[t+1],n=V[t+2],f=V[t+3],h=i+n>>1,o=u+f>>1,c=h+o-u,v=o+i-h,m=(r[u*a+i]+r[f*a+n])/2,l=o*a+h,g=Math.abs(m-r[l]);if(e[l]=Math.max(e[l],g),s<k){const x=(u+v>>1)*a+(i+c>>1),D=(f+v>>1)*a+(n+c>>1);e[l]=Math.max(e[l],e[x],e[D])}}}getGeometryData(d=0){const{gridSize:k,indices:V}=this.martini,{errors:a}=this;let r=0,e=0;const s=k-1;let t,i,u=0;V.fill(0);function n(l,g,x,D,p,U){const M=l+x>>1,z=g+D>>1;Math.abs(l-p)+Math.abs(g-U)>1&&a[z*k+M]>d?(n(p,U,l,g,M,z),n(x,D,p,U,M,z)):(t=g*k+l,i=D*k+x,u=U*k+p,V[t]===0&&(V[t]=++r),V[i]===0&&(V[i]=++r),V[u]===0&&(V[u]=++r),e++)}n(0,0,s,s,s,0),n(s,s,0,0,0,s);const f=r*2,h=e*3,o=new Uint16Array(f),c=new Uint32Array(h);let v=0;function m(l,g,x,D,p,U){const M=l+x>>1,z=g+D>>1;if(Math.abs(l-p)+Math.abs(g-U)>1&&a[z*k+M]>d)m(p,U,l,g,M,z),m(x,D,p,U,M,z);else{const I=V[g*k+l]-1,w=V[D*k+x]-1,T=V[U*k+p]-1;o[2*I]=l,o[2*I+1]=g,o[2*w]=x,o[2*w+1]=D,o[2*T]=p,o[2*T+1]=U,c[v++]=I,c[v++]=w,c[v++]=T}}return m(0,0,s,s,s,0),m(s,s,0,0,0,s),{attributes:this._getMeshAttributes(this.terrain,o,c),indices:c}}_getMeshAttributes(d,k,V){const a=Math.floor(Math.sqrt(d.length)),r=a-1,e=k.length/2,s=new Float32Array(e*3),t=new Float32Array(e*2);for(let u=0;u<e;u++){const n=k[u*2],f=k[u*2+1],h=f*a+n;s[3*u+0]=n/r-.5,s[3*u+1]=.5-f/r,s[3*u+2]=d[h],t[2*u+0]=n/r,t[2*u+1]=1-f/r}const i=ee(s,V);return{position:{value:s,size:3},texcoord:{value:t,size:2},normal:{value:i,size:3}}}}function W(y){const d=[];for(let k=0;k<y;k++)if(k>=17)d.push(0);else{const V=1-k/17;d.push(Math.round(7e3*V*V*V))}return d}const P=W(21);function ee(y,d){const k=new Float32Array(y.length);for(let V=0;V<d.length;V+=3){const a=d[V]*3,r=d[V+1]*3,e=d[V+2]*3,s=y[r]-y[a],t=y[r+1]-y[a+1],i=y[r+2]-y[a+2],u=y[e]-y[a],n=y[e+1]-y[a+1],f=y[e+2]-y[a+2],h=t*f-i*n,o=i*u-s*f,c=s*n-t*u,v=1/Math.hypot(h,o,c);k[a]=k[r]=k[e]=h*v,k[a+1]=k[r+1]=k[e+1]=o*v,k[a+2]=k[r+2]=k[e+2]=c*v}return k}function re(y,d){const k=(e,s,t)=>{const i=Math.floor(e[0]*s),u=Math.floor(e[1]*t),n=Math.floor((e[2]-e[0])*s)+1,f=Math.floor((e[3]-e[1])*t)+1;return{x:i,y:u,w:n,h:f}},V=(e,s,t,i,u,n)=>{const f=new Float32Array(u*n);for(let h=0;h<n;h++)for(let o=0;o<u;o++){const c=(h+i)*s+(o+t),v=h*u+o;f[v]=e[c]}return f},a=k(d,y.width,y.height);return{dem:V(y.dem,y.width,a.x,a.y,a.w,a.h),width:a.w,height:a.h}}function ie(y,d){return new J(y.width).createTile(y.dem).getGeometryData(P[d]||0)}/* Copyright 2015-2021 Esri. Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0 @preserve */const ne=(function(){var y={};y.defaultNoDataValue=-34027999387901484e22,y.decode=function(e,s){s=s||{};var t=s.encodedMaskData||s.encodedMaskData===null,i=a(e,s.inputOffset||0,t),u=s.noDataValue!==null?s.noDataValue:y.defaultNoDataValue,n=d(i,s.pixelType||Float32Array,s.encodedMaskData,u,s.returnMask),f={width:i.width,height:i.height,pixelData:n.resultPixels,minValue:n.minValue,maxValue:i.pixels.maxValue,noDataValue:u};return n.resultMask&&(f.maskData=n.resultMask),s.returnEncodedMask&&i.mask&&(f.encodedMaskData=i.mask.bitset?i.mask.bitset:null),s.returnFileInfo&&(f.fileInfo=k(i),s.computeUsedBitDepths&&(f.fileInfo.bitDepths=V(i))),f};var d=function(e,s,t,i,u){var n=0,f=e.pixels.numBlocksX,h=e.pixels.numBlocksY,o=Math.floor(e.width/f),c=Math.floor(e.height/h),v=2*e.maxZError,m=Number.MAX_VALUE,l;t=t||(e.mask?e.mask.bitset:null);var g,x;g=new s(e.width*e.height),u&&t&&(x=new Uint8Array(e.width*e.height));for(var D=new Float32Array(o*c),p,U,M=0;M<=h;M++){var z=M!==h?c:e.height%h;if(z!==0)for(var I=0;I<=f;I++){var w=I!==f?o:e.width%f;if(w!==0){var T=M*e.width*c+I*o,A=e.width-w,S=e.pixels.blocks[n],b,L,F;S.encoding<2?(S.encoding===0?b=S.rawData:(r(S.stuffedData,S.bitsPerPixel,S.numValidPixels,S.offset,v,D,e.pixels.maxValue),b=D),L=0):S.encoding===2?F=0:F=S.offset;var B;if(t)for(U=0;U<z;U++){for(T&7&&(B=t[T>>3],B<<=T&7),p=0;p<w;p++)T&7||(B=t[T>>3]),B&128?(x&&(x[T]=1),l=S.encoding<2?b[L++]:F,m=m>l?l:m,g[T++]=l):(x&&(x[T]=0),g[T++]=i),B<<=1;T+=A}else if(S.encoding<2)for(U=0;U<z;U++){for(p=0;p<w;p++)l=b[L++],m=m>l?l:m,g[T++]=l;T+=A}else for(m=m>F?F:m,U=0;U<z;U++){for(p=0;p<w;p++)g[T++]=F;T+=A}if(S.encoding===1&&L!==S.numValidPixels)throw"Block and Mask do not match";n++}}}return{resultPixels:g,resultMask:x,minValue:m}},k=function(e){return{fileIdentifierString:e.fileIdentifierString,fileVersion:e.fileVersion,imageType:e.imageType,height:e.height,width:e.width,maxZError:e.maxZError,eofOffset:e.eofOffset,mask:e.mask?{numBlocksX:e.mask.numBlocksX,numBlocksY:e.mask.numBlocksY,numBytes:e.mask.numBytes,maxValue:e.mask.maxValue}:null,pixels:{numBlocksX:e.pixels.numBlocksX,numBlocksY:e.pixels.numBlocksY,numBytes:e.pixels.numBytes,maxValue:e.pixels.maxValue,noDataValue:e.noDataValue}}},V=function(e){for(var s=e.pixels.numBlocksX*e.pixels.numBlocksY,t={},i=0;i<s;i++){var u=e.pixels.blocks[i];u.encoding===0?t.float32=!0:u.encoding===1?t[u.bitsPerPixel]=!0:t[0]=!0}return Object.keys(t)},a=function(e,s,t){var i={},u=new Uint8Array(e,s,10);if(i.fileIdentifierString=String.fromCharCode.apply(null,u),i.fileIdentifierString.trim()!=="CntZImage")throw"Unexpected file identifier string: "+i.fileIdentifierString;s+=10;var n=new DataView(e,s,24);if(i.fileVersion=n.getInt32(0,!0),i.imageType=n.getInt32(4,!0),i.height=n.getUint32(8,!0),i.width=n.getUint32(12,!0),i.maxZError=n.getFloat64(16,!0),s+=24,!t)if(n=new DataView(e,s,16),i.mask={},i.mask.numBlocksY=n.getUint32(0,!0),i.mask.numBlocksX=n.getUint32(4,!0),i.mask.numBytes=n.getUint32(8,!0),i.mask.maxValue=n.getFloat32(12,!0),s+=16,i.mask.numBytes>0){var f=new Uint8Array(Math.ceil(i.width*i.height/8));n=new DataView(e,s,i.mask.numBytes);var h=n.getInt16(0,!0),o=2,c=0;do{if(h>0)for(;h--;)f[c++]=n.getUint8(o++);else{var v=n.getUint8(o++);for(h=-h;h--;)f[c++]=v}h=n.getInt16(o,!0),o+=2}while(o<i.mask.numBytes);if(h!==-32768||c<f.length)throw"Unexpected end of mask RLE encoding";i.mask.bitset=f,s+=i.mask.numBytes}else(i.mask.numBytes|i.mask.numBlocksY|i.mask.maxValue)===0&&(i.mask.bitset=new Uint8Array(Math.ceil(i.width*i.height/8)));n=new DataView(e,s,16),i.pixels={},i.pixels.numBlocksY=n.getUint32(0,!0),i.pixels.numBlocksX=n.getUint32(4,!0),i.pixels.numBytes=n.getUint32(8,!0),i.pixels.maxValue=n.getFloat32(12,!0),s+=16;var m=i.pixels.numBlocksX,l=i.pixels.numBlocksY,g=m+(i.width%m>0?1:0),x=l+(i.height%l>0?1:0);i.pixels.blocks=new Array(g*x);for(var D=0,p=0;p<x;p++)for(var U=0;U<g;U++){var M=0,z=e.byteLength-s;n=new DataView(e,s,Math.min(10,z));var I={};i.pixels.blocks[D++]=I;var w=n.getUint8(0);if(M++,I.encoding=w&63,I.encoding>3)throw"Invalid block encoding ("+I.encoding+")";if(I.encoding===2){s++;continue}if(w!==0&&w!==2){if(w>>=6,I.offsetType=w,w===2)I.offset=n.getInt8(1),M++;else if(w===1)I.offset=n.getInt16(1,!0),M+=2;else if(w===0)I.offset=n.getFloat32(1,!0),M+=4;else throw"Invalid block offset type";if(I.encoding===1)if(w=n.getUint8(M),M++,I.bitsPerPixel=w&63,w>>=6,I.numValidPixelsType=w,w===2)I.numValidPixels=n.getUint8(M),M++;else if(w===1)I.numValidPixels=n.getUint16(M,!0),M+=2;else if(w===0)I.numValidPixels=n.getUint32(M,!0),M+=4;else throw"Invalid valid pixel count type"}if(s+=M,I.encoding!==3){var T,A;if(I.encoding===0){var S=(i.pixels.numBytes-1)/4;if(S!==Math.floor(S))throw"uncompressed block has invalid length";T=new ArrayBuffer(S*4),A=new Uint8Array(T),A.set(new Uint8Array(e,s,S*4));var b=new Float32Array(T);I.rawData=b,s+=S*4}else if(I.encoding===1){var L=Math.ceil(I.numValidPixels*I.bitsPerPixel/8),F=Math.ceil(L/4);T=new ArrayBuffer(F*4),A=new Uint8Array(T),A.set(new Uint8Array(e,s,L)),I.stuffedData=new Uint32Array(T),s+=L}}}return i.eofOffset=s,i},r=function(e,s,t,i,u,n,f){var h=(1<<s)-1,o=0,c,v=0,m,l,g=Math.ceil((f-i)/u),x=e.length*4-Math.ceil(s*t/8);for(e[e.length-1]<<=8*x,c=0;c<t;c++){if(v===0&&(l=e[o++],v=32),v>=s)m=l>>>v-s&h,v-=s;else{var D=s-v;m=(l&h)<<D&h,l=e[o++],v=32-D,m+=l>>>v}n[c]=m<g?i+m*u:f}return n};return y})(),te=(function(){var y={unstuff:function(a,r,e,s,t,i,u,n){var f=(1<<e)-1,h=0,o,c=0,v,m,l,g,x=a.length*4-Math.ceil(e*s/8);if(a[a.length-1]<<=8*x,t)for(o=0;o<s;o++)c===0&&(m=a[h++],c=32),c>=e?(v=m>>>c-e&f,c-=e):(l=e-c,v=(m&f)<<l&f,m=a[h++],c=32-l,v+=m>>>c),r[o]=t[v];else for(g=Math.ceil((n-i)/u),o=0;o<s;o++)c===0&&(m=a[h++],c=32),c>=e?(v=m>>>c-e&f,c-=e):(l=e-c,v=(m&f)<<l&f,m=a[h++],c=32-l,v+=m>>>c),r[o]=v<g?i+v*u:n},unstuffLUT:function(a,r,e,s,t,i){var u=(1<<r)-1,n=0,f=0,h=0,o=0,c=0,v,m=[],l=a.length*4-Math.ceil(r*e/8);a[a.length-1]<<=8*l;var g=Math.ceil((i-s)/t);for(f=0;f<e;f++)o===0&&(v=a[n++],o=32),o>=r?(c=v>>>o-r&u,o-=r):(h=r-o,c=(v&u)<<h&u,v=a[n++],o=32-h,c+=v>>>o),m[f]=c<g?s+c*t:i;return m.unshift(s),m},unstuff2:function(a,r,e,s,t,i,u,n){var f=(1<<e)-1,h=0,o,c=0,v=0,m,l,g;if(t)for(o=0;o<s;o++)c===0&&(l=a[h++],c=32,v=0),c>=e?(m=l>>>v&f,c-=e,v+=e):(g=e-c,m=l>>>v&f,l=a[h++],c=32-g,m|=(l&(1<<g)-1)<<e-g,v=g),r[o]=t[m];else{var x=Math.ceil((n-i)/u);for(o=0;o<s;o++)c===0&&(l=a[h++],c=32,v=0),c>=e?(m=l>>>v&f,c-=e,v+=e):(g=e-c,m=l>>>v&f,l=a[h++],c=32-g,m|=(l&(1<<g)-1)<<e-g,v=g),r[o]=m<x?i+m*u:n}return r},unstuffLUT2:function(a,r,e,s,t,i){var u=(1<<r)-1,n=0,f=0,h=0,o=0,c=0,v=0,m,l=[],g=Math.ceil((i-s)/t);for(f=0;f<e;f++)o===0&&(m=a[n++],o=32,v=0),o>=r?(c=m>>>v&u,o-=r,v+=r):(h=r-o,c=m>>>v&u,m=a[n++],o=32-h,c|=(m&(1<<h)-1)<<r-h,v=h),l[f]=c<g?s+c*t:i;return l.unshift(s),l},originalUnstuff:function(a,r,e,s){var t=(1<<e)-1,i=0,u,n=0,f,h,o,c=a.length*4-Math.ceil(e*s/8);for(a[a.length-1]<<=8*c,u=0;u<s;u++)n===0&&(h=a[i++],n=32),n>=e?(f=h>>>n-e&t,n-=e):(o=e-n,f=(h&t)<<o&t,h=a[i++],n=32-o,f+=h>>>n),r[u]=f;return r},originalUnstuff2:function(a,r,e,s){var t=(1<<e)-1,i=0,u,n=0,f=0,h,o,c;for(u=0;u<s;u++)n===0&&(o=a[i++],n=32,f=0),n>=e?(h=o>>>f&t,n-=e,f+=e):(c=e-n,h=o>>>f&t,o=a[i++],n=32-c,h|=(o&(1<<c)-1)<<e-c,f=c),r[u]=h;return r}},d={HUFFMAN_LUT_BITS_MAX:12,computeChecksumFletcher32:function(a){for(var r=65535,e=65535,s=a.length,t=Math.floor(s/2),i=0;t;){var u=t>=359?359:t;t-=u;do r+=a[i++]<<8,e+=r+=a[i++];while(--u);r=(r&65535)+(r>>>16),e=(e&65535)+(e>>>16)}return s&1&&(e+=r+=a[i]<<8),r=(r&65535)+(r>>>16),e=(e&65535)+(e>>>16),(e<<16|r)>>>0},readHeaderInfo:function(a,r){var e=r.ptr,s=new Uint8Array(a,e,6),t={};if(t.fileIdentifierString=String.fromCharCode.apply(null,s),t.fileIdentifierString.lastIndexOf("Lerc2",0)!==0)throw"Unexpected file identifier string (expect Lerc2 ): "+t.fileIdentifierString;e+=6;var i=new DataView(a,e,8),u=i.getInt32(0,!0);t.fileVersion=u,e+=4,u>=3&&(t.checksum=i.getUint32(4,!0),e+=4),i=new DataView(a,e,12),t.height=i.getUint32(0,!0),t.width=i.getUint32(4,!0),e+=8,u>=4?(t.numDims=i.getUint32(8,!0),e+=4):t.numDims=1,i=new DataView(a,e,40),t.numValidPixel=i.getUint32(0,!0),t.microBlockSize=i.getInt32(4,!0),t.blobSize=i.getInt32(8,!0),t.imageType=i.getInt32(12,!0),t.maxZError=i.getFloat64(16,!0),t.zMin=i.getFloat64(24,!0),t.zMax=i.getFloat64(32,!0),e+=40,r.headerInfo=t,r.ptr=e;var n,f;if(u>=3&&(f=u>=4?52:48,n=this.computeChecksumFletcher32(new Uint8Array(a,e-f,t.blobSize-14)),n!==t.checksum))throw"Checksum failed.";return!0},checkMinMaxRanges:function(a,r){var e=r.headerInfo,s=this.getDataTypeArray(e.imageType),t=e.numDims*this.getDataTypeSize(e.imageType),i=this.readSubArray(a,r.ptr,s,t),u=this.readSubArray(a,r.ptr+t,s,t);r.ptr+=2*t;var n,f=!0;for(n=0;n<e.numDims;n++)if(i[n]!==u[n]){f=!1;break}return e.minValues=i,e.maxValues=u,f},readSubArray:function(a,r,e,s){var t;if(e===Uint8Array)t=new Uint8Array(a,r,s);else{var i=new ArrayBuffer(s),u=new Uint8Array(i);u.set(new Uint8Array(a,r,s)),t=new e(i)}return t},readMask:function(a,r){var e=r.ptr,s=r.headerInfo,t=s.width*s.height,i=s.numValidPixel,u=new DataView(a,e,4),n={};if(n.numBytes=u.getUint32(0,!0),e+=4,(i===0||t===i)&&n.numBytes!==0)throw"invalid mask";var f,h;if(i===0)f=new Uint8Array(Math.ceil(t/8)),n.bitset=f,h=new Uint8Array(t),r.pixels.resultMask=h,e+=n.numBytes;else if(n.numBytes>0){f=new Uint8Array(Math.ceil(t/8)),u=new DataView(a,e,n.numBytes);var o=u.getInt16(0,!0),c=2,v=0,m=0;do{if(o>0)for(;o--;)f[v++]=u.getUint8(c++);else for(m=u.getUint8(c++),o=-o;o--;)f[v++]=m;o=u.getInt16(c,!0),c+=2}while(c<n.numBytes);if(o!==-32768||v<f.length)throw"Unexpected end of mask RLE encoding";h=new Uint8Array(t);var l=0,g=0;for(g=0;g<t;g++)g&7?(l=f[g>>3],l<<=g&7):l=f[g>>3],l&128&&(h[g]=1);r.pixels.resultMask=h,n.bitset=f,e+=n.numBytes}return r.ptr=e,r.mask=n,!0},readDataOneSweep:function(a,r,e,s){var t=r.ptr,i=r.headerInfo,u=i.numDims,n=i.width*i.height,f=i.imageType,h=i.numValidPixel*d.getDataTypeSize(f)*u,o,c=r.pixels.resultMask;if(e===Uint8Array)o=new Uint8Array(a,t,h);else{var v=new ArrayBuffer(h),m=new Uint8Array(v);m.set(new Uint8Array(a,t,h)),o=new e(v)}if(o.length===n*u)s?r.pixels.resultPixels=d.swapDimensionOrder(o,n,u,e,!0):r.pixels.resultPixels=o;else{r.pixels.resultPixels=new e(n*u);var l=0,g=0,x=0,D=0;if(u>1){if(s){for(g=0;g<n;g++)if(c[g])for(D=g,x=0;x<u;x++,D+=n)r.pixels.resultPixels[D]=o[l++]}else for(g=0;g<n;g++)if(c[g])for(D=g*u,x=0;x<u;x++)r.pixels.resultPixels[D+x]=o[l++]}else for(g=0;g<n;g++)c[g]&&(r.pixels.resultPixels[g]=o[l++])}return t+=h,r.ptr=t,!0},readHuffmanTree:function(a,r){var e=this.HUFFMAN_LUT_BITS_MAX,s=new DataView(a,r.ptr,16);r.ptr+=16;var t=s.getInt32(0,!0);if(t<2)throw"unsupported Huffman version";var i=s.getInt32(4,!0),u=s.getInt32(8,!0),n=s.getInt32(12,!0);if(u>=n)return!1;var f=new Uint32Array(n-u);d.decodeBits(a,r,f);var h=[],o,c,v,m;for(o=u;o<n;o++)c=o-(o<i?0:i),h[c]={first:f[o-u],second:null};var l=a.byteLength-r.ptr,g=Math.ceil(l/4),x=new ArrayBuffer(g*4),D=new Uint8Array(x);D.set(new Uint8Array(a,r.ptr,l));var p=new Uint32Array(x),U=0,M,z=0;for(M=p[0],o=u;o<n;o++)c=o-(o<i?0:i),m=h[c].first,m>0&&(h[c].second=M<<U>>>32-m,32-U>=m?(U+=m,U===32&&(U=0,z++,M=p[z])):(U+=m-32,z++,M=p[z],h[c].second|=M>>>32-U));var I=0,w=0,T=new k;for(o=0;o<h.length;o++)h[o]!==void 0&&(I=Math.max(I,h[o].first));I>=e?w=e:w=I;var A=[],S,b,L,F,B,C;for(o=u;o<n;o++)if(c=o-(o<i?0:i),m=h[c].first,m>0)if(S=[m,c],m<=w)for(b=h[c].second<<w-m,L=1<<w-m,v=0;v<L;v++)A[b|v]=S;else for(b=h[c].second,C=T,F=m-1;F>=0;F--)B=b>>>F&1,B?(C.right||(C.right=new k),C=C.right):(C.left||(C.left=new k),C=C.left),F===0&&!C.val&&(C.val=S[1]);return{decodeLut:A,numBitsLUTQick:w,numBitsLUT:I,tree:T,stuffedData:p,srcPtr:z,bitPos:U}},readHuffman:function(a,r,e,s){var t=r.headerInfo,i=t.numDims,u=r.headerInfo.height,n=r.headerInfo.width,f=n*u,h=this.readHuffmanTree(a,r),o=h.decodeLut,c=h.tree,v=h.stuffedData,m=h.srcPtr,l=h.bitPos,g=h.numBitsLUTQick,x=h.numBitsLUT,D=r.headerInfo.imageType===0?128:0,p,U,M,z=r.pixels.resultMask,I,w,T,A,S,b,L,F=0;l>0&&(m++,l=0);var B=v[m],C=r.encodeMode===1,_=new e(f*i),O=_,X;if(i<2||C){for(X=0;X<i;X++)if(i>1&&(O=new e(_.buffer,f*X,f),F=0),r.headerInfo.numValidPixel===n*u)for(b=0,A=0;A<u;A++)for(S=0;S<n;S++,b++){if(U=0,I=B<<l>>>32-g,w=I,32-l<g&&(I|=v[m+1]>>>64-l-g,w=I),o[w])U=o[w][1],l+=o[w][0];else for(I=B<<l>>>32-x,w=I,32-l<x&&(I|=v[m+1]>>>64-l-x,w=I),p=c,L=0;L<x;L++)if(T=I>>>x-L-1&1,p=T?p.right:p.left,!(p.left||p.right)){U=p.val,l=l+L+1;break}l>=32&&(l-=32,m++,B=v[m]),M=U-D,C?(S>0?M+=F:A>0?M+=O[b-n]:M+=F,M&=255,O[b]=M,F=M):O[b]=M}else for(b=0,A=0;A<u;A++)for(S=0;S<n;S++,b++)if(z[b]){if(U=0,I=B<<l>>>32-g,w=I,32-l<g&&(I|=v[m+1]>>>64-l-g,w=I),o[w])U=o[w][1],l+=o[w][0];else for(I=B<<l>>>32-x,w=I,32-l<x&&(I|=v[m+1]>>>64-l-x,w=I),p=c,L=0;L<x;L++)if(T=I>>>x-L-1&1,p=T?p.right:p.left,!(p.left||p.right)){U=p.val,l=l+L+1;break}l>=32&&(l-=32,m++,B=v[m]),M=U-D,C?(S>0&&z[b-1]?M+=F:A>0&&z[b-n]?M+=O[b-n]:M+=F,M&=255,O[b]=M,F=M):O[b]=M}}else for(b=0,A=0;A<u;A++)for(S=0;S<n;S++)if(b=A*n+S,!z||z[b])for(X=0;X<i;X++,b+=f){if(U=0,I=B<<l>>>32-g,w=I,32-l<g&&(I|=v[m+1]>>>64-l-g,w=I),o[w])U=o[w][1],l+=o[w][0];else for(I=B<<l>>>32-x,w=I,32-l<x&&(I|=v[m+1]>>>64-l-x,w=I),p=c,L=0;L<x;L++)if(T=I>>>x-L-1&1,p=T?p.right:p.left,!(p.left||p.right)){U=p.val,l=l+L+1;break}l>=32&&(l-=32,m++,B=v[m]),M=U-D,O[b]=M}r.ptr=r.ptr+(m+1)*4+(l>0?4:0),r.pixels.resultPixels=_,i>1&&!s&&(r.pixels.resultPixels=d.swapDimensionOrder(_,f,i,e))},decodeBits:function(a,r,e,s,t){{var i=r.headerInfo,u=i.fileVersion,n=0,f=a.byteLength-r.ptr>=5?5:a.byteLength-r.ptr,h=new DataView(a,r.ptr,f),o=h.getUint8(0);n++;var c=o>>6,v=c===0?4:3-c,m=(o&32)>0,l=o&31,g=0;if(v===1)g=h.getUint8(n),n++;else if(v===2)g=h.getUint16(n,!0),n+=2;else if(v===4)g=h.getUint32(n,!0),n+=4;else throw"Invalid valid pixel count type";var x=2*i.maxZError,D,p,U,M,z,I,w,T,A,S=i.numDims>1?i.maxValues[t]:i.zMax;if(m){for(r.counter.lut++,T=h.getUint8(n),n++,M=Math.ceil((T-1)*l/8),z=Math.ceil(M/4),p=new ArrayBuffer(z*4),U=new Uint8Array(p),r.ptr+=n,U.set(new Uint8Array(a,r.ptr,M)),w=new Uint32Array(p),r.ptr+=M,A=0;T-1>>>A;)A++;M=Math.ceil(g*A/8),z=Math.ceil(M/4),p=new ArrayBuffer(z*4),U=new Uint8Array(p),U.set(new Uint8Array(a,r.ptr,M)),D=new Uint32Array(p),r.ptr+=M,u>=3?I=y.unstuffLUT2(w,l,T-1,s,x,S):I=y.unstuffLUT(w,l,T-1,s,x,S),u>=3?y.unstuff2(D,e,A,g,I):y.unstuff(D,e,A,g,I)}else r.counter.bitstuffer++,A=l,r.ptr+=n,A>0&&(M=Math.ceil(g*A/8),z=Math.ceil(M/4),p=new ArrayBuffer(z*4),U=new Uint8Array(p),U.set(new Uint8Array(a,r.ptr,M)),D=new Uint32Array(p),r.ptr+=M,u>=3?s==null?y.originalUnstuff2(D,e,A,g):y.unstuff2(D,e,A,g,!1,s,x,S):s==null?y.originalUnstuff(D,e,A,g):y.unstuff(D,e,A,g,!1,s,x,S))}},readTiles:function(a,r,e,s){var t=r.headerInfo,i=t.width,u=t.height,n=i*u,f=t.microBlockSize,h=t.imageType,o=d.getDataTypeSize(h),c=Math.ceil(i/f),v=Math.ceil(u/f);r.pixels.numBlocksY=v,r.pixels.numBlocksX=c,r.pixels.ptr=0;var m=0,l=0,g=0,x=0,D=0,p=0,U=0,M=0,z=0,I=0,w=0,T=0,A=0,S=0,b=0,L=0,F,B,C,_,O,X,R=new e(f*f),oe=u%f||f,ue=i%f||f,G,j,$=t.numDims,H,E=r.pixels.resultMask,Y=r.pixels.resultPixels,he=t.fileVersion,Q=he>=5?14:15,Z,q=t.zMax,N;for(g=0;g<v;g++)for(D=g!==v-1?f:oe,x=0;x<c;x++)for(p=x!==c-1?f:ue,w=g*i*f+x*f,T=i-p,H=0;H<$;H++){if($>1?(N=Y,w=g*i*f+x*f,Y=new e(r.pixels.resultPixels.buffer,n*H*o,n),q=t.maxValues[H]):N=null,U=a.byteLength-r.ptr,F=new DataView(a,r.ptr,Math.min(10,U)),B={},L=0,M=F.getUint8(0),L++,Z=t.fileVersion>=5?M&4:0,z=M>>6&255,I=M>>2&Q,I!==(x*f>>3&Q)||Z&&H===0)throw"integrity issue";if(X=M&3,X>3)throw r.ptr+=L,"Invalid block encoding ("+X+")";if(X===2){if(Z)if(E)for(m=0;m<D;m++)for(l=0;l<p;l++)E[w]&&(Y[w]=N[w]),w++;else for(m=0;m<D;m++)for(l=0;l<p;l++)Y[w]=N[w],w++;r.counter.constant++,r.ptr+=L;continue}else if(X===0){if(Z)throw"integrity issue";if(r.counter.uncompressed++,r.ptr+=L,A=D*p*o,S=a.byteLength-r.ptr,A=A<S?A:S,C=new ArrayBuffer(A%o===0?A:A+o-A%o),_=new Uint8Array(C),_.set(new Uint8Array(a,r.ptr,A)),O=new e(C),b=0,E)for(m=0;m<D;m++){for(l=0;l<p;l++)E[w]&&(Y[w]=O[b++]),w++;w+=T}else for(m=0;m<D;m++){for(l=0;l<p;l++)Y[w++]=O[b++];w+=T}r.ptr+=b*o}else if(G=d.getDataTypeUsed(Z&&h<6?4:h,z),j=d.getOnePixel(B,L,G,F),L+=d.getDataTypeSize(G),X===3)if(r.ptr+=L,r.counter.constantoffset++,E)for(m=0;m<D;m++){for(l=0;l<p;l++)E[w]&&(Y[w]=Z?Math.min(q,N[w]+j):j),w++;w+=T}else for(m=0;m<D;m++){for(l=0;l<p;l++)Y[w]=Z?Math.min(q,N[w]+j):j,w++;w+=T}else if(r.ptr+=L,d.decodeBits(a,r,R,j,H),L=0,Z)if(E)for(m=0;m<D;m++){for(l=0;l<p;l++)E[w]&&(Y[w]=R[L++]+N[w]),w++;w+=T}else for(m=0;m<D;m++){for(l=0;l<p;l++)Y[w]=R[L++]+N[w],w++;w+=T}else if(E)for(m=0;m<D;m++){for(l=0;l<p;l++)E[w]&&(Y[w]=R[L++]),w++;w+=T}else for(m=0;m<D;m++){for(l=0;l<p;l++)Y[w++]=R[L++];w+=T}}$>1&&!s&&(r.pixels.resultPixels=d.swapDimensionOrder(r.pixels.resultPixels,n,$,e))},formatFileInfo:function(a){return{fileIdentifierString:a.headerInfo.fileIdentifierString,fileVersion:a.headerInfo.fileVersion,imageType:a.headerInfo.imageType,height:a.headerInfo.height,width:a.headerInfo.width,numValidPixel:a.headerInfo.numValidPixel,microBlockSize:a.headerInfo.microBlockSize,blobSize:a.headerInfo.blobSize,maxZError:a.headerInfo.maxZError,pixelType:d.getPixelType(a.headerInfo.imageType),eofOffset:a.eofOffset,mask:a.mask?{numBytes:a.mask.numBytes}:null,pixels:{numBlocksX:a.pixels.numBlocksX,numBlocksY:a.pixels.numBlocksY,maxValue:a.headerInfo.zMax,minValue:a.headerInfo.zMin,noDataValue:a.noDataValue}}},constructConstantSurface:function(a,r){var e=a.headerInfo.zMax,s=a.headerInfo.zMin,t=a.headerInfo.maxValues,i=a.headerInfo.numDims,u=a.headerInfo.height*a.headerInfo.width,n=0,f=0,h=0,o=a.pixels.resultMask,c=a.pixels.resultPixels;if(o)if(i>1){if(r)for(n=0;n<i;n++)for(h=n*u,e=t[n],f=0;f<u;f++)o[f]&&(c[h+f]=e);else for(f=0;f<u;f++)if(o[f])for(h=f*i,n=0;n<i;n++)c[h+i]=t[n]}else for(f=0;f<u;f++)o[f]&&(c[f]=e);else if(i>1&&s!==e)if(r)for(n=0;n<i;n++)for(h=n*u,e=t[n],f=0;f<u;f++)c[h+f]=e;else for(f=0;f<u;f++)for(h=f*i,n=0;n<i;n++)c[h+n]=t[n];else for(f=0;f<u*i;f++)c[f]=e},getDataTypeArray:function(a){var r;switch(a){case 0:r=Int8Array;break;case 1:r=Uint8Array;break;case 2:r=Int16Array;break;case 3:r=Uint16Array;break;case 4:r=Int32Array;break;case 5:r=Uint32Array;break;case 6:r=Float32Array;break;case 7:r=Float64Array;break;default:r=Float32Array}return r},getPixelType:function(a){var r;switch(a){case 0:r="S8";break;case 1:r="U8";break;case 2:r="S16";break;case 3:r="U16";break;case 4:r="S32";break;case 5:r="U32";break;case 6:r="F32";break;case 7:r="F64";break;default:r="F32"}return r},isValidPixelValue:function(a,r){if(r==null)return!1;var e;switch(a){case 0:e=r>=-128&&r<=127;break;case 1:e=r>=0&&r<=255;break;case 2:e=r>=-32768&&r<=32767;break;case 3:e=r>=0&&r<=65536;break;case 4:e=r>=-2147483648&&r<=2147483647;break;case 5:e=r>=0&&r<=4294967296;break;case 6:e=r>=-34027999387901484e22&&r<=34027999387901484e22;break;case 7:e=r>=-17976931348623157e292&&r<=17976931348623157e292;break;default:e=!1}return e},getDataTypeSize:function(a){var r=0;switch(a){case 0:case 1:r=1;break;case 2:case 3:r=2;break;case 4:case 5:case 6:r=4;break;case 7:r=8;break;default:r=a}return r},getDataTypeUsed:function(a,r){var e=a;switch(a){case 2:case 4:e=a-r;break;case 3:case 5:e=a-2*r;break;case 6:r===0?e=a:r===1?e=2:e=1;break;case 7:r===0?e=a:e=a-2*r+1;break;default:e=a;break}return e},getOnePixel:function(a,r,e,s){var t=0;switch(e){case 0:t=s.getInt8(r);break;case 1:t=s.getUint8(r);break;case 2:t=s.getInt16(r,!0);break;case 3:t=s.getUint16(r,!0);break;case 4:t=s.getInt32(r,!0);break;case 5:t=s.getUInt32(r,!0);break;case 6:t=s.getFloat32(r,!0);break;case 7:t=s.getFloat64(r,!0);break;default:throw"the decoder does not understand this pixel type"}return t},swapDimensionOrder:function(a,r,e,s,t){var i=0,u=0,n=0,f=0,h=a;if(e>1)if(h=new s(r*e),t)for(i=0;i<r;i++)for(f=i,n=0;n<e;n++,f+=r)h[f]=a[u++];else for(i=0;i<r;i++)for(f=i,n=0;n<e;n++,f+=r)h[u++]=a[f];return h}},k=function(a,r,e){this.val=a,this.left=r,this.right=e},V={decode:function(a,r){r=r||{};var e=r.noDataValue,s=0,t={};if(t.ptr=r.inputOffset||0,t.pixels={},!!d.readHeaderInfo(a,t)){var i=t.headerInfo,u=i.fileVersion,n=d.getDataTypeArray(i.imageType);if(u>5)throw"unsupported lerc version 2."+u;d.readMask(a,t),i.numValidPixel!==i.width*i.height&&!t.pixels.resultMask&&(t.pixels.resultMask=r.maskData);var f=i.width*i.height;t.pixels.resultPixels=new n(f*i.numDims),t.counter={onesweep:0,uncompressed:0,lut:0,bitstuffer:0,constant:0,constantoffset:0};var h=!r.returnPixelInterleavedDims;if(i.numValidPixel!==0)if(i.zMax===i.zMin)d.constructConstantSurface(t,h);else if(u>=4&&d.checkMinMaxRanges(a,t))d.constructConstantSurface(t,h);else{var o=new DataView(a,t.ptr,2),c=o.getUint8(0);if(t.ptr++,c)d.readDataOneSweep(a,t,n,h);else if(u>1&&i.imageType<=1&&Math.abs(i.maxZError-.5)<1e-5){var v=o.getUint8(1);if(t.ptr++,t.encodeMode=v,v>2||u<4&&v>1)throw"Invalid Huffman flag "+v;v?d.readHuffman(a,t,n,h):d.readTiles(a,t,n,h)}else d.readTiles(a,t,n,h)}t.eofOffset=t.ptr;var m;r.inputOffset?(m=t.headerInfo.blobSize+r.inputOffset-t.ptr,Math.abs(m)>=1&&(t.eofOffset=r.inputOffset+t.headerInfo.blobSize)):(m=t.headerInfo.blobSize-t.ptr,Math.abs(m)>=1&&(t.eofOffset=t.headerInfo.blobSize));var l={width:i.width,height:i.height,pixelData:t.pixels.resultPixels,minValue:i.zMin,maxValue:i.zMax,validPixelCount:i.numValidPixel,dimCount:i.numDims,dimStats:{minValues:i.minValues,maxValues:i.maxValues},maskData:t.pixels.resultMask};if(t.pixels.resultMask&&d.isValidPixelValue(i.imageType,e)){var g=t.pixels.resultMask;for(s=0;s<f;s++)g[s]||(l.pixelData[s]=e);l.noDataValue=e}return t.noDataValue=e,r.returnFileInfo&&(l.fileInfo=d.formatFileInfo(t)),l}},getBandCount:function(a){var r=0,e=0,s={};for(s.ptr=0,s.pixels={};e<a.byteLength-58;)d.readHeaderInfo(a,s),e+=s.headerInfo.blobSize,r++,s.ptr=e;return r}};return V})();var ae=(function(){var y=new ArrayBuffer(4),d=new Uint8Array(y),k=new Uint32Array(y);return k[0]=1,d[0]===1})(),se={decode:function(y,d){if(!ae)throw"Big endian system is not supported.";d=d||{};var k=d.inputOffset||0,V=new Uint8Array(y,k,10),a=String.fromCharCode.apply(null,V),r,e;if(a.trim()==="CntZImage")r=ne,e=1;else if(a.substring(0,5)==="Lerc2")r=te,e=2;else throw"Unexpected file identifier string: "+a;for(var s=0,t=y.byteLength-10,i,u=[],n,f,h={width:0,height:0,pixels:[],pixelType:d.pixelType,mask:null,statistics:[]},o=0;k<t;){var c=r.decode(y,{inputOffset:k,encodedMaskData:i,maskData:f,returnMask:s===0,returnEncodedMask:s===0,returnFileInfo:!0,returnPixelInterleavedDims:d.returnPixelInterleavedDims,pixelType:d.pixelType||null,noDataValue:d.noDataValue||null});k=c.fileInfo.eofOffset,f=c.maskData,s===0&&(i=c.encodedMaskData,h.width=c.width,h.height=c.height,h.dimCount=c.dimCount||1,h.pixelType=c.pixelType||c.fileInfo.pixelType,h.mask=f),e>1&&(f&&u.push(f),c.fileInfo.mask&&c.fileInfo.mask.numBytes>0&&o++),s++,h.pixels.push(c.pixelData),h.statistics.push({minValue:c.minValue,maxValue:c.maxValue,noDataValue:c.noDataValue,dimStats:c.dimStats})}var v,m,l;if(e>1&&o>1){for(l=h.width*h.height,h.bandMasks=u,f=new Uint8Array(l),f.set(u[0]),v=1;v<u.length;v++)for(n=u[v],m=0;m<l;m++)f[m]=f[m]&n[m];h.maskData=f}return h}};function fe(y){const d=se.decode(y,{});return{dem:d.pixels[0],width:d.width,height:d.height}}function le(y,d,k){let V=fe(y);return k[2]-k[0]<1&&(V=re(V,k)),ie(V,d)}self.onmessage=y=>{const d=y.data,k=le(d.demData,d.z,d.clipBounds);self.postMessage(k)}})();\n', ee = typeof self < "u" && self.Blob && new Blob([fe], { type: "text/javascript;charset=utf-8" });
function qe(i) {
  let e;
  try {
    if (e = ee && (self.URL || self.webkitURL).createObjectURL(ee), !e) throw "";
    const t = new Worker(e, {
      name: i?.name
    });
    return t.addEventListener("error", () => {
      (self.URL || self.webkitURL).revokeObjectURL(e);
    }), t;
  } catch {
    return new Worker(
      "data:text/javascript;charset=utf-8," + encodeURIComponent(fe),
      {
        name: i?.name
      }
    );
  } finally {
    e && (self.URL || self.webkitURL).revokeObjectURL(e);
  }
}
const Je = 5;
class Qe extends H {
  constructor() {
    super(), this.info = {
      version: U,
      description: "Tile LERC terrain loader. It can load ArcGis-lerc format terrain data."
    }, this.dataType = "lerc", this.fileLoader = new Ae(v.manager), this.fileLoader.setResponseType("arraybuffer");
    const e = new $(Je);
    e.setWorkerCreator(() => new qe()), this._workerPool = e;
  }
  /**
   * 异步加载并解析 Lerc 数据，返回 TileGeometry 对象
   *
   * @param url - 数据文件 URL
   * @param params - 加载参数，包含瓦片坐标和裁剪边界
   * @returns 解析后的 TileGeometry 对象
   */
  async doLoad(e, t) {
    const { z: r, clipBounds: n } = t, o = {
      demData: await this.fileLoader.loadAsync(e),
      z: r,
      clipBounds: n
    }, a = (await this._workerPool.postMessage(o)).data;
    return new A().setAttributes(a, r);
  }
}
const me = `(function(){"use strict";function c(t){return a(t.data)}function a(t){function n(e,u){const r=u*4,[i,f,g,l]=e.slice(r,r+4);return l===0?0:-1e4+(i<<16|f<<8|g)*.1}const o=t.length>>>2,s=new Float32Array(o);for(let e=0;e<o;e++)s[e]=n(t,e);return s}self.onmessage=t=>{const n=c(t.data.imgData);self.postMessage(n)}})();
`, te = typeof self < "u" && self.Blob && new Blob([me], { type: "text/javascript;charset=utf-8" });
function Ke(i) {
  let e;
  try {
    if (e = te && (self.URL || self.webkitURL).createObjectURL(te), !e) throw "";
    const t = new Worker(e, {
      name: i?.name
    });
    return t.addEventListener("error", () => {
      (self.URL || self.webkitURL).revokeObjectURL(e);
    }), t;
  } catch {
    return new Worker(
      "data:text/javascript;charset=utf-8," + encodeURIComponent(me),
      {
        name: i?.name
      }
    );
  } finally {
    e && (self.URL || self.webkitURL).revokeObjectURL(e);
  }
}
const et = 10;
class tt extends H {
  constructor() {
    super(), this.info = {
      version: U,
      description: "Mapbox-RGB terrain loader for loading Mapbox-RGB terrain data"
    }, this.dataType = "terrain-rgb", this.imageLoader = new Y(v.manager);
    const e = new $(et);
    e.setWorkerCreator(() => new Ke()), this._workerPool = e;
  }
  /**
   * 异步加载RGB图像并解析为TileGeometry对象
   *
   * 根据瓦片层级动态计算抽稀尺寸，将图像裁剪缩放后交由 Worker 解析高度图，
   * 最终生成带裙边和 SSE 误差计算的瓦片几何体。
   *
   * @param url 图像URL地址
   * @param params 加载参数，包含瓦片坐标和裁剪边界
   * @returns 解析后的TileGeometry对象
   */
  async doLoad(e, t) {
    const r = await this.imageLoader.loadAsync(e), { clipBounds: n, z: s } = t, o = Ve.clamp((s + 2) * 3, 2, 64), a = rt(r, n, o), l = (await this._workerPool.postMessage({ imgData: a }, [a.data.buffer])).data, h = new A();
    return h.setData(l, s), h;
  }
}
function rt(i, e, t) {
  const r = ue(e, i.width), n = Math.min(t, r.sw), o = new OffscreenCanvas(n, n).getContext("2d");
  return o.imageSmoothingEnabled = !1, o.drawImage(i, r.sx, r.sy, r.sw, r.sh, 0, 0, n, n), o.getImageData(0, 0, n, n);
}
const ge = '(function(){"use strict";class C{constructor(o=257){this.gridSize=o;const t=o-1;if(t&t-1)throw new Error(`Grid size must be 2^n+1, current size is ${o}`);this.numTriangles=t*t*2-2,this.numParentTriangles=this.numTriangles-t*t,this.indices=new Uint32Array(this.gridSize*this.gridSize),this.coords=new Uint16Array(this.numTriangles*4);for(let n=0;n<this.numTriangles;n++){let s=n+2,a=0,r=0,e=0,l=0,d=0,c=0;for(s&1?e=l=d=t:a=r=c=t;(s>>=1)>1;){const g=a+e>>1,m=r+l>>1;s&1?(e=a,l=r,a=d,r=c):(a=e,r=l,e=d,l=c),d=g,c=m}const h=n*4;this.coords[h+0]=a,this.coords[h+1]=r,this.coords[h+2]=e,this.coords[h+3]=l}}createTile(o){return new $(o,this)}}class ${constructor(o,t){const n=t.gridSize;if(o.length!==n*n)throw new Error(`Terrain data length expected ${n*n} (${n} x ${n}), but got ${o.length}`);this.terrain=o,this.martini=t,this.errors=new Float32Array(o.length),this.update()}update(){const{numTriangles:o,numParentTriangles:t,coords:n,gridSize:s}=this.martini,{terrain:a,errors:r}=this;for(let e=o-1;e>=0;e--){const l=e*4,d=n[l+0],c=n[l+1],h=n[l+2],g=n[l+3],m=d+h>>1,u=c+g>>1,w=m+u-c,M=u+d-m,S=(a[c*s+d]+a[g*s+h])/2,f=u*s+m,z=Math.abs(S-a[f]);if(r[f]=Math.max(r[f],z),e<t){const x=(c+M>>1)*s+(d+w>>1),T=(g+M>>1)*s+(h+w>>1);r[f]=Math.max(r[f],r[x],r[T])}}}getGeometryData(o=0){const{gridSize:t,indices:n}=this.martini,{errors:s}=this;let a=0,r=0;const e=t-1;let l,d,c=0;n.fill(0);function h(f,z,x,T,p,A){const y=f+x>>1,I=z+T>>1;Math.abs(f-p)+Math.abs(z-A)>1&&s[I*t+y]>o?(h(p,A,f,z,y,I),h(x,T,p,A,y,I)):(l=z*t+f,d=T*t+x,c=A*t+p,n[l]===0&&(n[l]=++a),n[d]===0&&(n[d]=++a),n[c]===0&&(n[c]=++a),r++)}h(0,0,e,e,e,0),h(e,e,0,0,0,e);const g=a*2,m=r*3,u=new Uint16Array(g),w=new Uint32Array(m);let M=0;function S(f,z,x,T,p,A){const y=f+x>>1,I=z+T>>1;if(Math.abs(f-p)+Math.abs(z-A)>1&&s[I*t+y]>o)S(p,A,f,z,y,I),S(x,T,p,A,y,I);else{const b=n[z*t+f]-1,E=n[T*t+x]-1,F=n[A*t+p]-1;u[2*b]=f,u[2*b+1]=z,u[2*E]=x,u[2*E+1]=T,u[2*F]=p,u[2*F+1]=A,w[M++]=b,w[M++]=E,w[M++]=F}}return S(0,0,e,e,e,0),S(e,e,0,0,0,e),{attributes:this._getMeshAttributes(this.terrain,u,w),indices:w}}_getMeshAttributes(o,t,n){const s=Math.floor(Math.sqrt(o.length)),a=s-1,r=t.length/2,e=new Float32Array(r*3),l=new Float32Array(r*2);for(let c=0;c<r;c++){const h=t[c*2],g=t[c*2+1],m=g*s+h;e[3*c+0]=h/a-.5,e[3*c+1]=.5-g/a,e[3*c+2]=o[m],l[2*c+0]=h/a,l[2*c+1]=1-g/a}const d=V(e,n);return{position:{value:e,size:3},texcoord:{value:l,size:2},normal:{value:d,size:3}}}}function G(i){const o=[];for(let t=0;t<i;t++)if(t>=17)o.push(0);else{const n=1-t/17;o.push(Math.round(7e3*n*n*n))}return o}const U=G(21);function V(i,o){const t=new Float32Array(i.length);for(let n=0;n<o.length;n+=3){const s=o[n]*3,a=o[n+1]*3,r=o[n+2]*3,e=i[a]-i[s],l=i[a+1]-i[s+1],d=i[a+2]-i[s+2],c=i[r]-i[s],h=i[r+1]-i[s+1],g=i[r+2]-i[s+2],m=l*g-d*h,u=d*c-e*g,w=e*h-l*c,M=1/Math.hypot(m,u,w);t[s]=t[a]=t[r]=m*M,t[s+1]=t[a+1]=t[r+1]=u*M,t[s+2]=t[a+2]=t[r+2]=w*M}return t}function k(i,o){const t=(r,e,l)=>{const d=Math.floor(r[0]*e),c=Math.floor(r[1]*l),h=Math.floor((r[2]-r[0])*e)+1,g=Math.floor((r[3]-r[1])*l)+1;return{x:d,y:c,w:h,h:g}},n=(r,e,l,d,c,h)=>{const g=new Float32Array(c*h);for(let m=0;m<h;m++)for(let u=0;u<c;u++){const w=(m+d)*e+(u+l),M=m*c+u;g[M]=r[w]}return g},s=t(o,i.width,i.height);return{dem:n(i.dem,i.width,s.x,s.y,s.w,s.h),width:s.w,height:s.h}}function D(i,o){return new C(i.width).createTile(i.dem).getGeometryData(U[o]||0)}function P(i){function o(s,a){const r=a*4,[e,l,d,c]=s.slice(r,r+4);return c===0?0:-1e4+(e<<16|l<<8|d)*.1}const t=i.data.length>>>2,n=new Float32Array(t);for(let s=0;s<t;s++)n[s]=o(i.data,s);return{dem:n,width:i.width,height:i.height}}function Z(i,o,t){let n=P(i);return t[2]-t[0]<1&&(n=k(n,t)),D(n,o)}self.onmessage=i=>{const o=i.data,t=Z(o.demData,o.z,o.clipBounds);self.postMessage(t)}})();\n', re = typeof self < "u" && self.Blob && new Blob([ge], { type: "text/javascript;charset=utf-8" });
function nt(i) {
  let e;
  try {
    if (e = re && (self.URL || self.webkitURL).createObjectURL(re), !e) throw "";
    const t = new Worker(e, {
      name: i?.name
    });
    return t.addEventListener("error", () => {
      (self.URL || self.webkitURL).revokeObjectURL(e);
    }), t;
  } catch {
    return new Worker(
      "data:text/javascript;charset=utf-8," + encodeURIComponent(ge),
      {
        name: i?.name
      }
    );
  } finally {
    e && (self.URL || self.webkitURL).revokeObjectURL(e);
  }
}
const it = 10;
class st extends H {
  constructor() {
    super(), this.info = {
      version: U,
      description: "Mapbox-DEM terrain loader for loading Mapbox-DEM terrain data"
    }, this.dataType = "terrain-dem", this.imageLoader = new Y(v.manager);
    const e = new $(it);
    e.setWorkerCreator(() => new nt()), this._workerPool = e;
  }
  /**
   * 异步加载并解析DEM图像，返回TileGeometry对象
   *
   * @param url 图像URL地址
   * @param params 加载参数，包含瓦片坐标和裁剪边界
   * @returns 解析后的TileGeometry对象
   */
  async doLoad(e, t) {
    const { z: r, clipBounds: n } = t, s = await this.imageLoader.loadAsync(e), a = {
      demData: ot(s),
      z: r,
      clipBounds: n
    }, l = (await this._workerPool.postMessage(a)).data;
    return new A().setAttributes(l, r);
  }
}
function ot(i) {
  const t = new OffscreenCanvas(i.width, i.height).getContext("2d");
  return t.drawImage(i, 0, 0), t.getImageData(0, 0, i.width, i.height);
}
class at {
  constructor() {
    this._previousTime = 0, this._currentTime = 0, this._startTime = performance.now(), this._delta = 0, this._elapsed = 0, this._timescale = 1, this._document = null, this._pageVisibilityHandler = null;
  }
  /**
   * Handle the visibility change event to reset the timer when the page becomes visible again.
   */
  _handleVisibilityChange() {
    this._document.hidden === !1 && this.reset();
  }
  /**
   * Connect the timer to the given document.Calling this method is not mandatory to
   * use the timer but enables the usage of the Page Visibility API to avoid large time
   * delta values.
   *
   * @param document - The document.
   */
  connect(e) {
    this._document = e, e.hidden !== void 0 && (this._pageVisibilityHandler = this._handleVisibilityChange.bind(this), e.addEventListener("visibilitychange", this._pageVisibilityHandler, !1));
  }
  /**
   * Disconnects the timer from the DOM and also disables the usage of the Page Visibility API.
   */
  disconnect() {
    this._pageVisibilityHandler !== null && (this._document.removeEventListener("visibilitychange", this._pageVisibilityHandler), this._pageVisibilityHandler = null), this._document = null;
  }
  /**
   * Returns the time delta in seconds.
   *
   * @returns The time delta in second.
   */
  getDelta() {
    return this._delta / 1e3;
  }
  /**
   * Returns the elapsed time in seconds.
   *
   * @returns The elapsed time in second.
   */
  getElapsed() {
    return this._elapsed / 1e3;
  }
  /**
   * Returns the timescale.
   *
   * @returns The timescale.
   */
  getTimescale() {
    return this._timescale;
  }
  /**
   * Sets the given timescale which scale the time delta computation
   * in `update()`.
   *
   * @param timescale - The timescale to set.
   * @returns A reference to this timer.
   */
  setTimescale(e) {
    return this._timescale = e, this;
  }
  /**
   * Resets the time computation for the current simulation step.
   *
   * @returns A reference to this timer.
   */
  reset() {
    // R24 A PATCH 1 (TERRA_PACE.timerFix) — recon T3. Upstream reset() zeroes
    // only _currentTime; update() accumulates into _elapsed and NOTHING ever
    // zeroes it, so TileMap.update's `getElapsed() > updateInterval / 1e3`
    // guard is permanently true after 50 ms of uptime and the FULL quadtree
    // walk (frustum AABB alloc + LOD ratio + shadow sync per tile) runs on
    // EVERY frame instead of at the intended 20 Hz. Blast radius is the map
    // timer alone: it is the only Timer instance in bundle+plugin that calls
    // reset()/getElapsed() (plugin.js:381's `this.timer = new Timer()` calls
    // neither). Off => the two upstream statements below, unchanged.
    if (R24_SWITCHES.timerFix) this._elapsed = 0;
    return this._currentTime = performance.now() - this._startTime, this;
  }
  /**
   * Can be used to free all internal resources. Usually called when
   * the timer instance isn't required anymore.
   */
  dispose() {
    this.disconnect();
  }
  /**
   * Updates the internal state of the timer. This method should be called
   * once per simulation step and before you perform queries against the timer
   * (e.g. via `getDelta()`).
   *
   * @param timestamp - The current time in milliseconds. Can be obtained
   * from the `requestAnimationFrame` callback argument. If not provided, the current
   * time will be determined with `performance.now`.
   * @returns A reference to this timer.
   */
  update(e) {
    return this._pageVisibilityHandler !== null && this._document.hidden === !0 ? this._delta = 0 : (this._previousTime = this._currentTime, this._currentTime = (e ?? performance.now()) - this._startTime, this._delta = (this._currentTime - this._previousTime) * this._timescale, this._elapsed += this._delta), this;
  }
}
function lt(i, e) {
  const t = /\{ *([\w_-]+) *\}/g;
  return i.replace(t, (r, n) => {
    const s = e[n];
    if (s == null)
      throw new Error(`source url template error, No value provided for variable: ${r}`);
    return typeof s == "function" ? s(e) : String(s);
  });
}
function bt(i, e = 100) {
  return new Promise((t) => {
    const r = () => {
      i() ? t() : setTimeout(r, e);
    };
    r();
  });
}
function ct(i) {
  return v.registerMaterialLoader(i);
}
function X(i) {
  return v.registerGeometryLoader(i);
}
function kt(i) {
  return v.getMaterialLoader(i);
}
function Tt(i) {
  return v.getGeometryLoader(i);
}
function Lt() {
  return v.getLoaders();
}
function It() {
  v.reset();
}
class pe {
  /**
   * 构造函数
   * @param options 数据源配置项
   */
  constructor(e) {
    this.dataType = "image", this.attribution = "ThreeTile", this.minLevel = 0, this.maxLevel = 18, this.projectionID = "3857", this.url = "", this.subdomains = [], this.opacity = 1, this.transparent = !0, this.isTMS = !1, this._projectionBounds = [-1 / 0, -1 / 0, 1 / 0, 1 / 0], Object.assign(this, e);
  }
  /**
   * 根据投影类型计算瓦片的边界框
   * - EPSG:3857 返回 Web Mercator 米单位
   * - EPSG:4326 返回经纬度
   * @param x 瓦片 x 坐标
   * @param y 瓦片 y 坐标
   * @param z 瓦片 z 坐标
   * @returns 边界框字符串 "minX,minY,maxX,maxY"
   */
  getBBox(e, t, r) {
    const n = Math.pow(2, r);
    if (this.projectionID === "4326") {
      const s = 360 / n, o = 180 / n, a = -180 + e * s, l = 90 - (t + 1) * o, h = -180 + (e + 1) * s, c = 90 - t * o;
      return `${a},${l},${h},${c}`;
    } else {
      const s = Math.PI * 6378137, o = 2 * s / n, a = -s + e * o, l = s - (t + 1) * o, h = -s + (e + 1) * o, c = s - t * o;
      return `${a},${l},${h},${c}`;
    }
  }
  /**
   * 根据瓦片坐标获取 URL
   * 可重写此方法自定义 URL 生成逻辑
   * @param x 瓦片 x 坐标
   * @param y 瓦片 y 坐标
   * @param z 瓦片 z 坐标
   * @param obj 额外参数，会合并到模板替换数据中
   * @returns 瓦片 URL
   */
  getUrl(e, t, r, n) {
    if (r < this.minLevel || r > this.maxLevel)
      return;
    this.isTMS && (t = Math.pow(2, r) - 1 - t);
    const s = this.subdomains.length;
    let o;
    if (s > 0) {
      const h = (e * 7 + t * 13 + r * 31 >>> 0) % s;
      o = this.subdomains[h];
    }
    const a = n?.bbox ?? (this.url.includes("{bbox}") ? this.getBBox(e, t, r) : void 0), l = { ...this, x: e, y: t, z: r, s: o, bbox: a, ...n };
    return lt(this.url, l);
  }
  /**
   * 工厂方法：创建数据源实例
   * @param options 数据源配置项
   * @param extra 附加属性，会合并到 options 中（同名覆盖 options）
   * @returns 数据源实例
   */
  static create(e, t) {
    return new pe({ ...e, ...t });
  }
}
class we {
  /**
   * @param centerLon 中央经线，默认 0
   */
  constructor(e = 0) {
    this._lon0 = 0, this._lon0 = e;
  }
  /** 中央经线（度） */
  get lon0() {
    return this._lon0;
  }
  /**
   * 根据中央经线偏移量计算瓦片 X 坐标
   *
   * @param x 原始瓦片 X 坐标
   * @param z 缩放层级
   * @returns 偏移后的瓦片 X 坐标
   */
  getTileXWithCenterLon(e, t) {
    const r = Math.pow(2, t);
    return ((e + Math.round(r / 360 * this._lon0)) % r + r) % r;
  }
  /**
   * 根据经纬度范围计算投影坐标边界
   *
   * @param bounds 经纬度范围 [minLon, minLat, maxLon, maxLat]
   * @returns 投影坐标范围 [minX, minY, maxX, maxY]
   */
  getProjBoundsFromLonLat(e) {
    const t = e[2] - e[0] > 180, r = this.project(e[0] + (t ? this._lon0 : 0), e[1]), n = this.project(e[2] + (t ? this._lon0 : 0), e[3]);
    return [Math.min(r.x, n.x), Math.min(r.y, n.y), Math.max(r.x, n.x), Math.max(r.y, n.y)];
  }
  /**
   * 根据瓦片坐标计算经纬度边界
   *
   * @param x 瓦片 X 坐标
   * @param y 瓦片 Y 坐标
   * @param z 瓦片缩放层级
   * @returns 经纬度范围 [minLon, minLat, maxLon, maxLat]
   */
  getLonLatBoundsFromXYZ(e, t, r) {
    const n = this.getProjBoundsFromXYZ(e, t, r), s = this.unProject(n[0], n[1]), o = this.unProject(n[2], n[3]);
    return [s.lon, s.lat, o.lon, o.lat];
  }
}
const V = 6378137, D = 100 * 1e3;
class xe extends we {
  constructor() {
    super(...arguments), this.ID = "3857", this.mapWidth = 2 * Math.PI * V, this.mapHeight = this.mapWidth, this.mapDepth = 1;
  }
  /**
   * 经纬度转墨卡托投影坐标
   *
   * @param lon 经度
   * @param lat 纬度
   * @returns 投影坐标 {x, y}
   */
  project(e, t) {
    const r = (e - this.lon0) * (Math.PI / 180), n = t * (Math.PI / 180), s = V * r, o = V * Math.log(Math.tan(Math.PI / 4 + n / 2));
    return { x: s, y: o };
  }
  /**
   * 墨卡托投影坐标转经纬度
   *
   * @param x 投影 X 坐标
   * @param y 投影 Y 坐标
   * @returns 经纬度 {lon, lat}
   */
  unProject(e, t) {
    let r = e / V * (180 / Math.PI) + this.lon0;
    return r = (r % 360 + 540) % 360 - 180, { lat: (2 * Math.atan(Math.exp(t / V)) - Math.PI / 2) * (180 / Math.PI), lon: r };
  }
  /**
   * 根据瓦片坐标计算投影坐标边界
   *
   * @param x 瓦片 X 坐标
   * @param y 瓦片 Y 坐标
   * @param z 瓦片缩放层级
   * @returns 投影坐标范围 [minX, minY, maxX, maxY]
   */
  getProjBoundsFromXYZ(e, t, r) {
    const n = this.mapWidth / Math.pow(2, r), s = -this.mapWidth / 2 + e * n, o = this.mapHeight / 2 - (t + 1) * n, a = -this.mapWidth / 2 + (e + 1) * n, l = this.mapHeight / 2 - t * n;
    return [s, o, a, l];
  }
}
class ht extends we {
  constructor() {
    super(...arguments), this.ID = "4326", this.mapWidth = 360 * D, this.mapHeight = 180 * D, this.mapDepth = 1;
  }
  /**
   * 根据瓦片坐标计算投影坐标边界
   *
   * @param x 瓦片 X 坐标
   * @param y 瓦片 Y 坐标
   * @param z 瓦片缩放层级
   * @returns 投影坐标范围 [minX, minY, maxX, maxY]
   */
  getProjBoundsFromXYZ(e, t, r) {
    const n = this.mapWidth / Math.pow(2, r), s = this.mapHeight / Math.pow(2, r), o = -this.mapWidth / 2 + e * n, a = this.mapHeight / 2 - (t + 1) * s, l = -this.mapWidth / 2 + (e + 1) * n, h = this.mapHeight / 2 - t * s;
    return [o, a, l, h];
  }
  /**
   * 经纬度转投影坐标（线性映射）
   *
   * @param lon 经度
   * @param lat 纬度
   * @returns 投影坐标 {x, y}
   */
  project(e, t) {
    return { x: (e - this.lon0) * D, y: t * D };
  }
  /**
   * 投影坐标转经纬度（线性映射）
   *
   * @param x 投影 X 坐标
   * @param y 投影 Y 坐标
   * @returns 经纬度 {lon, lat}
   */
  unProject(e, t) {
    return { lon: e / D + this.lon0, lat: t / D };
  }
}
const ne = {
  /**
   * 根据投影标识创建投影对象
   *
   * @param id 投影标识，默认 "3857"
   * @param lon0 中央经线
   * @returns 投影实例
   */
  createFromID: (i = "3857", e = 0) => {
    let t;
    switch (i) {
      case "3857":
        t = new xe(e);
        break;
      case "4326":
        t = new ht(e);
        break;
      default:
        throw new Error(`Projection ID: ${i} is not supported.`);
    }
    return t;
  }
};
class ut extends Ge {
  constructor() {
    super(...arguments), this._projection = new xe(0);
  }
  /** 投影 */
  get projection() {
    return this._projection;
  }
  /** 变更投影时自动重算所有数据源的投影范围 */
  set projection(e) {
    this._projection = e, this._updateImgProjBounds(), this._updateDemPrjBounds();
  }
  /** 投影 ID */
  get projectionID() {
    return this._projection.ID;
  }
  /** 影像数据源 */
  get imgSource() {
    return super.imgSource;
  }
  /** 变更后自动更新影像层的投影范围 */
  set imgSource(e) {
    super.imgSource = e, this._updateImgProjBounds();
  }
  /** 高程数据源 */
  get demSource() {
    return super.demSource;
  }
  /** 变更后自动更新高程层的投影范围 */
  set demSource(e) {
    super.demSource = e, this._updateDemPrjBounds();
  }
  /** 地图边界范围 */
  get bounds() {
    return super.bounds;
  }
  /** 变更时重新计算所有数据源的投影范围 */
  set bounds(e) {
    super.bounds = e, this._updateImgProjBounds(), this._updateDemPrjBounds();
  }
  /**
   * 更新所有影像数据源的投影范围
   */
  _updateImgProjBounds() {
    this.imgSource.forEach(
      (e) => e._projectionBounds = this.projection.getProjBoundsFromLonLat(e.bounds || this.bounds)
    );
  }
  /**
   * 更新高程数据源的投影范围
   */
  _updateDemPrjBounds() {
    this.demSource && (this.demSource._projectionBounds = this.projection.getProjBoundsFromLonLat(this.demSource.bounds || this.bounds));
  }
  /**
   * 更新瓦片
   * @param coord 瓦片坐标
   * @param tileMesh 瓦片网格
   */
  async update(e, t) {
    return super.update(this._getTileCoords(e), t);
  }
  /**
   * 对瓦片坐标进行投影预处理
   * @param params 原始瓦片坐标
   * @returns 投影转换后的坐标及边界信息
   */
  _getTileCoords(e) {
    const { x: t, y: r, z: n } = e, s = this._projection.getTileXWithCenterLon(t, n), o = this._projection.getProjBoundsFromXYZ(t, r, n), a = this._projection.getLonLatBoundsFromXYZ(t, r, n);
    return { x: s, y: r, z: n, bounds: o, lonLatBounds: a };
  }
}
const j = new Be(), dt = new I(0, -1, 0), ie = new I();
function ye(i, e) {
  const t = e.intersectObject(i.rootTile, !0);
  if (t.length > 0) {
    const r = t[0];
    console.assert(r.object.visible);
    const n = i.worldToLocal(r.point.clone()), s = i.map2geo(n);
    return Object.assign(r, {
      location: s
    });
  }
}
function se(i, e) {
  return ie.set(e.x, i.rootTile.scale.z * 1e4, e.z), j.set(ie, dt), ye(i, j);
}
function ft(i, e, t) {
  return j.setFromCamera(t, i), ye(e, j);
}
function mt(i) {
  const e = i.loader.manager;
  e.onStart = (t, r, n) => {
    i.dispatchEvent({ type: "loading-start", url: t, itemsLoaded: r, itemsTotal: n });
  }, e.onError = (t) => {
    i.dispatchEvent({ type: "loading-error", url: t });
  }, e.onLoad = () => {
    i.dispatchEvent({ type: "loading-complete" });
  }, e.onProgress = (t, r, n) => {
    i.dispatchEvent({ type: "loading-progress", url: t, itemsLoaded: r, itemsTotal: n });
  }, e.onParseEnd = (t) => {
    i.dispatchEvent({ type: "parsing-end", geometry: t });
  }, i.rootTile.addEventListener("tile-loaded", (t) => {
    i.dispatchEvent({ type: "tile-loaded", tile: t.tile });
  }), i.rootTile.addEventListener("tile-unload", (t) => {
    i.dispatchEvent({ type: "tile-unload", tile: t.tile });
  });
}
class ve extends oe {
  /**
   * 地图模型构造函数
   * @param params 地图参数 {@link MapParams}
   */
  constructor(e) {
    super(), this.name = "map", this.isLOD = !0, this.debug = 0, this.autoUpdate = !0, this.updateInterval = 50, this._minLevel = 2, this._maxLevel = 0, this._LODThreshold = 1, this._mapTimer = new at(), this.up.set(0, 0, 1);
    const {
      loader: t = new ut(),
      rootTile: r = new T(),
      minLevel: n = 2,
      imgSource: s,
      demSource: o,
      bounds: a,
      lon0: l = 0,
      debug: h = 0
    } = e;
    this.minLevel = n, this.loader = t, this.rootTile = r, a && (this.loader.bounds = a), this.debug = this.loader.debug = h, this.lon0 = l, this.imgSource = s, this.demSource = o, this.add(r), this._resize(), mt(this), this._mapTimer.reset();
    const c = () => {
      this.dispatchEvent({ type: "ready" }), this.removeEventListener("loading-complete", c);
    };
    this.addEventListener("loading-complete", c);
  }
  /**
   * 快速创建地图实例
   * @param params 地图参数 {@link MapParams}
   * @returns 地图模型实例
   */
  static create(e) {
    return new ve(e);
  }
  /** 最小缩放级别，小于该级别不再加载瓦片数据 */
  get minLevel() {
    return this._minLevel;
  }
  set minLevel(e) {
    this._minLevel = e;
  }
  /** 最大缩放级别，大于该级别不再细化，由数据源自动计算 */
  get maxLevel() {
    return this._maxLevel;
  }
  /** LOD 阈值 */
  get LODThreshold() {
    return this._LODThreshold;
  }
  /** 值越大瓦片越细化但资源消耗越高，建议 1~2，默认 1 */
  set LODThreshold(e) {
    this._LODThreshold = e;
  }
  /** 中央子午线经度，影响地图投影中心，可设置为 -90、0、90，默认为 0 */
  get lon0() {
    return this.projection.lon0;
  }
  set lon0(e) {
    this.projection.lon0 !== e && (e !== 0 && this.minLevel < 1 && F.warn(`Map centralMeridian is ${this.lon0}, minLevel must > 0`), this.projection = ne.createFromID(this.projection.ID, e), this._updateSource());
  }
  /** 地图投影对象 */
  get projection() {
    return this.loader.projection;
  }
  set projection(e) {
    (e.ID !== this.projection.ID || e.lon0 !== this.lon0) && (this.loader.projection = e, this._resize(), this.reload(), this._log("Map Projection Changed:", e.ID, e.lon0), this.dispatchEvent({
      type: "projection-changed",
      projection: e
    }));
  }
  /** 影像数据源 */
  get imgSource() {
    return this.loader.imgSource;
  }
  set imgSource(e) {
    const t = Array.isArray(e) ? e : [e];
    if (t.length === 0)
      throw new Error("imgSource can not be empty");
    this.loader.imgSource = t, this.projection = ne.createFromID(t[0].projectionID, this.projection.lon0), this._log("Img Source Changed:", t), this._updateSource(), this.dispatchEvent({ type: "source-changed", source: e });
  }
  /** 高程数据源 */
  get demSource() {
    return this.loader.demSource;
  }
  set demSource(e) {
    this.loader.demSource !== e && (this.loader.demSource = e, this._log("DEM Source Changed:", this.demSource), this._updateSource(), this.dispatchEvent({ type: "source-changed", source: e }));
  }
  /** 地图经纬度范围 */
  get bounds() {
    return this.loader.bounds;
  }
  set bounds(e) {
    this.loader.bounds = e;
  }
  /** 最大并发下载线程数 */
  get maxThreads() {
    return this.loader.maxThreads;
  }
  set maxThreads(e) {
    this.loader.maxThreads = e;
  }
  /** 当前正在下载的瓦片数量 */
  get downloading() {
    return this.loader.downloadingThreads;
  }
  /**
   * 模型更新回调，每帧由渲染循环自动调用，驱动瓦片树更新和数据加载
   * @param camera 摄像机
   */
  update(e) {
    this._mapTimer.update(), this._mapTimer.getElapsed() > this.updateInterval / 1e3 && (this.rootTile.update({
      camera: e,
      loader: this.loader,
      minLevel: this.minLevel,
      maxLevel: this.maxLevel,
      LODThreshold: this.LODThreshold
    }), this.rootTile.castShadow = this.castShadow, this.rootTile.receiveShadow = this.receiveShadow, this.dispatchEvent({ type: "update", delta: this._mapTimer.getDelta() }), this._mapTimer.reset());
  }
  /**
   * 销毁全部瓦片并重新加载
   * @param dispose - true 销毁后重建，false 仅标记脏瓦片等待下次更新重载
   */
  reload(e = !0) {
    this.rootTile.reload(e);
  }
  /**
   * 释放地图资源并从场景中移除
   */
  dispose() {
    this.removeFromParent(), this.reload();
  }
  /**
   * 地理坐标 → 模型坐标
   * @param geo 地理坐标（经度 x, 纬度 y, 高度 z）
   */
  geo2map(e) {
    const t = this.projection.project(e.x, e.y);
    return new I(t.x, t.y, e.z);
  }
  /**
   * 地理坐标 → 世界坐标
   * @param geo 地理坐标（经度 x, 纬度 y, 高度 z）
   */
  geo2world(e) {
    return this.localToWorld(this.geo2map(e));
  }
  /**
   * 模型坐标 → 地理坐标
   * @param pos 模型坐标（x, y, z）
   */
  map2geo(e) {
    const t = this.projection.unProject(e.x, e.y);
    return new I(t.lon, t.lat, e.z);
  }
  /**
   * 世界坐标 → 地理坐标
   * @param world 世界坐标
   */
  world2geo(e) {
    return this.map2geo(this.worldToLocal(e.clone()));
  }
  /**
   * @deprecated 使用 geo2map() 代替
   */
  geo2pos(e) {
    return this.geo2map(e);
  }
  /**
   * @deprecated 使用 map2geo() 代替
   */
  pos2geo(e) {
    return this.map2geo(e);
  }
  /**
   * 通过经纬度获取地面信息（高程、法向量等）
   * @param geo 地理坐标
   * @returns 地面信息，未命中时返回 undefined
   */
  getLocalInfoFromGeo(e) {
    const t = this.geo2world(e);
    return se(this, t);
  }
  /**
   * 通过世界坐标获取地面信息
   * @param pos 世界坐标
   * @returns 地面信息，未命中时返回 undefined
   */
  getLocalInfoFromWorld(e) {
    return se(this, e);
  }
  /**
   * 通过屏幕坐标获取地面信息
   * @param camera 摄像机
   * @param pointer 屏幕坐标（范围 -0.5~0.5）
   * @returns 地面信息，未命中时返回 undefined
   */
  getLocalInfoFromScreen(e, t) {
    return ft(e, this, t);
  }
  /**
   * @deprecated 已废弃，无替代
   */
  getTileCount() {
  }
  /**
   * 调试日志输出，debug > 0 时打印
   */
  _log(...e) {
    F.log(...e);
  }
  /**
   * 使根瓦片尺寸与投影范围一致
   */
  _resize() {
    this.rootTile.scale.set(this.projection.mapWidth, this.projection.mapHeight, this.projection.mapDepth), this.rootTile.updateMatrix(), this.rootTile.updateMatrixWorld();
  }
  /**
   * 取各数据源中最高的 maxLevel
   */
  _getMaxLevel() {
    let e = 0;
    return this.imgSource.forEach((t) => e = Math.max(e, t.maxLevel)), this.demSource && (e = Math.max(e, this.demSource.maxLevel)), this._log("Max Level:", e), e;
  }
  /**
   * 数据源变更时更新最大级别并重载瓦片
   */
  _updateSource() {
    this._maxLevel = this._getMaxLevel(), this.rootTile.reload(!1);
  }
}
function gt() {
  ct(new Ne()), X(new tt()), X(new Qe()), X(new st());
}
gt();
export {
  V as EARTH_RADIUS,
  v as LoaderFactory,
  Pe as Logger,
  xe as ProjMCT,
  ht as ProjWGS,
  ne as ProjectFactory,
  we as Projection,
  D as SCALE,
  st as TerrainDEMLoader,
  Qe as TerrainLercLoader,
  tt as TerrainRGBLoader,
  T as Tile,
  Mt as TileCanvasLoader,
  A as TileGeometry,
  H as TileGeometryLoader,
  Ne as TileImageLoader,
  Ge as TileLoader,
  Q as TileLoadingManager,
  ve as TileMap,
  ut as TileMapLoader,
  ae as TileMaterial,
  Ze as TileMaterialLoader,
  Z as TileMesh,
  pe as TileSource,
  at as Timer,
  B as VectorFeatureTypes,
  xt as VectorTileRender,
  mt as attachEvent,
  wt as author,
  vt as demToGeometry,
  ue as getBoundsCoord,
  Tt as getDEMLoader,
  kt as getImgLoader,
  ye as getLocalInfoFromRay,
  ft as getLocalInfoFromScreen,
  se as getLocalInfoFromWorld,
  de as getSafeUrlAndBounds,
  yt as getSubDEM,
  Ye as getSubImage,
  Lt as getTileLoaders,
  F as logger,
  X as registerDEMLoader,
  ct as registerImgLoader,
  It as resetLoaderFactory,
  lt as strTemplate,
  $e as tileBoundsClip,
  // R24 D PATCH 5 (LOD_CROSSFADE) — the hook installer (lib/fly/terrain-engine.js
  // is its only caller; see VENDOR.md row D5).
  Xr as setLodFadeHook,
  U as version,
  bt as waitFor
};
