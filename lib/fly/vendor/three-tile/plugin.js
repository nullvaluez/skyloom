import { EventDispatcher as _i, Scene as mi, Color as ke, FogExp2 as Pt, WebGLRenderer as gi, PerspectiveCamera as ri, AmbientLight as wi, DirectionalLight as yi, Controls as Tt, Vector3 as ce, MOUSE as Pe, TOUCH as Le, Quaternion as st, Spherical as jt, Vector2 as Ee, Ray as xi, Plane as bi, MathUtils as Be, Box3 as Dt, Sphere as Mi, Euler as Si, ShaderMaterial as kt, Mesh as yt, PlaneGeometry as Ei, Raycaster as Pi, SphereGeometry as Ti, MeshLambertMaterial as Di, MeshNormalMaterial as ki, MeshBasicMaterial as ni, ImageLoader as Li, Texture as Fi, SRGBColorSpace as Ci, FileLoader as Lt, CanvasTexture as Ft, UniformsUtils as si, UniformsLib as Ke, Cache as me, Box3Helper as Ai, Group as Ii } from "three";
import { Timer as Oi, TileSource as pe, TileCanvasLoader as oi, version as Ie, TileMaterialLoader as He, LoaderFactory as at, TileMaterial as Ui, TileGeometry as Ri, VectorTileRender as ai, VectorFeatureTypes as Ae } from "./index.js";
var ze = Object.freeze({
  Linear: Object.freeze({
    None: function(t) {
      return t;
    },
    In: function(t) {
      return this.None(t);
    },
    Out: function(t) {
      return this.None(t);
    },
    InOut: function(t) {
      return this.None(t);
    }
  }),
  Quadratic: Object.freeze({
    In: function(t) {
      return t * t;
    },
    Out: function(t) {
      return t * (2 - t);
    },
    InOut: function(t) {
      return (t *= 2) < 1 ? 0.5 * t * t : -0.5 * (--t * (t - 2) - 1);
    }
  }),
  Cubic: Object.freeze({
    In: function(t) {
      return t * t * t;
    },
    Out: function(t) {
      return --t * t * t + 1;
    },
    InOut: function(t) {
      return (t *= 2) < 1 ? 0.5 * t * t * t : 0.5 * ((t -= 2) * t * t + 2);
    }
  }),
  Quartic: Object.freeze({
    In: function(t) {
      return t * t * t * t;
    },
    Out: function(t) {
      return 1 - --t * t * t * t;
    },
    InOut: function(t) {
      return (t *= 2) < 1 ? 0.5 * t * t * t * t : -0.5 * ((t -= 2) * t * t * t - 2);
    }
  }),
  Quintic: Object.freeze({
    In: function(t) {
      return t * t * t * t * t;
    },
    Out: function(t) {
      return --t * t * t * t * t + 1;
    },
    InOut: function(t) {
      return (t *= 2) < 1 ? 0.5 * t * t * t * t * t : 0.5 * ((t -= 2) * t * t * t * t + 2);
    }
  }),
  Sinusoidal: Object.freeze({
    In: function(t) {
      return 1 - Math.sin((1 - t) * Math.PI / 2);
    },
    Out: function(t) {
      return Math.sin(t * Math.PI / 2);
    },
    InOut: function(t) {
      return 0.5 * (1 - Math.sin(Math.PI * (0.5 - t)));
    }
  }),
  Exponential: Object.freeze({
    In: function(t) {
      return t === 0 ? 0 : Math.pow(1024, t - 1);
    },
    Out: function(t) {
      return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    },
    InOut: function(t) {
      return t === 0 ? 0 : t === 1 ? 1 : (t *= 2) < 1 ? 0.5 * Math.pow(1024, t - 1) : 0.5 * (-Math.pow(2, -10 * (t - 1)) + 2);
    }
  }),
  Circular: Object.freeze({
    In: function(t) {
      return 1 - Math.sqrt(1 - t * t);
    },
    Out: function(t) {
      return Math.sqrt(1 - --t * t);
    },
    InOut: function(t) {
      return (t *= 2) < 1 ? -0.5 * (Math.sqrt(1 - t * t) - 1) : 0.5 * (Math.sqrt(1 - (t -= 2) * t) + 1);
    }
  }),
  Elastic: Object.freeze({
    In: function(t) {
      return t === 0 ? 0 : t === 1 ? 1 : -Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI);
    },
    Out: function(t) {
      return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1;
    },
    InOut: function(t) {
      return t === 0 ? 0 : t === 1 ? 1 : (t *= 2, t < 1 ? -0.5 * Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI) : 0.5 * Math.pow(2, -10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI) + 1);
    }
  }),
  Back: Object.freeze({
    In: function(t) {
      var e = 1.70158;
      return t === 1 ? 1 : t * t * ((e + 1) * t - e);
    },
    Out: function(t) {
      var e = 1.70158;
      return t === 0 ? 0 : --t * t * ((e + 1) * t + e) + 1;
    },
    InOut: function(t) {
      var e = 2.5949095;
      return (t *= 2) < 1 ? 0.5 * (t * t * ((e + 1) * t - e)) : 0.5 * ((t -= 2) * t * ((e + 1) * t + e) + 2);
    }
  }),
  Bounce: Object.freeze({
    In: function(t) {
      return 1 - ze.Bounce.Out(1 - t);
    },
    Out: function(t) {
      return t < 1 / 2.75 ? 7.5625 * t * t : t < 2 / 2.75 ? 7.5625 * (t -= 1.5 / 2.75) * t + 0.75 : t < 2.5 / 2.75 ? 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375 : 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
    },
    InOut: function(t) {
      return t < 0.5 ? ze.Bounce.In(t * 2) * 0.5 : ze.Bounce.Out(t * 2 - 1) * 0.5 + 0.5;
    }
  }),
  generatePow: function(t) {
    return t === void 0 && (t = 4), t = t < Number.EPSILON ? Number.EPSILON : t, t = t > 1e4 ? 1e4 : t, {
      In: function(e) {
        return Math.pow(e, t);
      },
      Out: function(e) {
        return 1 - Math.pow(1 - e, t);
      },
      InOut: function(e) {
        return e < 0.5 ? Math.pow(e * 2, t) / 2 : (1 - Math.pow(2 - e * 2, t)) / 2 + 0.5;
      }
    };
  }
}), Je = function() {
  return performance.now();
}, Bi = (
  /** @class */
  (function() {
    function t() {
      this._tweens = {}, this._tweensAddedDuringUpdate = {};
    }
    return t.prototype.getAll = function() {
      var e = this;
      return Object.keys(this._tweens).map(function(i) {
        return e._tweens[i];
      });
    }, t.prototype.removeAll = function() {
      this._tweens = {};
    }, t.prototype.add = function(e) {
      this._tweens[e.getId()] = e, this._tweensAddedDuringUpdate[e.getId()] = e;
    }, t.prototype.remove = function(e) {
      delete this._tweens[e.getId()], delete this._tweensAddedDuringUpdate[e.getId()];
    }, t.prototype.update = function(e, i) {
      e === void 0 && (e = Je()), i === void 0 && (i = !1);
      var r = Object.keys(this._tweens);
      if (r.length === 0)
        return !1;
      for (; r.length > 0; ) {
        this._tweensAddedDuringUpdate = {};
        for (var n = 0; n < r.length; n++) {
          var o = this._tweens[r[n]], s = !i;
          o && o.update(e, s) === !1 && !i && delete this._tweens[r[n]];
        }
        r = Object.keys(this._tweensAddedDuringUpdate);
      }
      return !0;
    }, t;
  })()
), xt = {
  Linear: function(t, e) {
    var i = t.length - 1, r = i * e, n = Math.floor(r), o = xt.Utils.Linear;
    return e < 0 ? o(t[0], t[1], r) : e > 1 ? o(t[i], t[i - 1], i - r) : o(t[n], t[n + 1 > i ? i : n + 1], r - n);
  },
  Utils: {
    Linear: function(t, e, i) {
      return (e - t) * i + t;
    }
  }
}, hi = (
  /** @class */
  (function() {
    function t() {
    }
    return t.nextId = function() {
      return t._nextId++;
    }, t._nextId = 0, t;
  })()
), bt = new Bi(), dt = (
  /** @class */
  (function() {
    function t(e, i) {
      i === void 0 && (i = bt), this._object = e, this._group = i, this._isPaused = !1, this._pauseStart = 0, this._valuesStart = {}, this._valuesEnd = {}, this._valuesStartRepeat = {}, this._duration = 1e3, this._isDynamic = !1, this._initialRepeat = 0, this._repeat = 0, this._yoyo = !1, this._isPlaying = !1, this._reversed = !1, this._delayTime = 0, this._startTime = 0, this._easingFunction = ze.Linear.None, this._interpolationFunction = xt.Linear, this._chainedTweens = [], this._onStartCallbackFired = !1, this._onEveryStartCallbackFired = !1, this._id = hi.nextId(), this._isChainStopped = !1, this._propertiesAreSetUp = !1, this._goToEnd = !1;
    }
    return t.prototype.getId = function() {
      return this._id;
    }, t.prototype.isPlaying = function() {
      return this._isPlaying;
    }, t.prototype.isPaused = function() {
      return this._isPaused;
    }, t.prototype.getDuration = function() {
      return this._duration;
    }, t.prototype.to = function(e, i) {
      if (i === void 0 && (i = 1e3), this._isPlaying)
        throw new Error("Can not call Tween.to() while Tween is already started or paused. Stop the Tween first.");
      return this._valuesEnd = e, this._propertiesAreSetUp = !1, this._duration = i < 0 ? 0 : i, this;
    }, t.prototype.duration = function(e) {
      return e === void 0 && (e = 1e3), this._duration = e < 0 ? 0 : e, this;
    }, t.prototype.dynamic = function(e) {
      return e === void 0 && (e = !1), this._isDynamic = e, this;
    }, t.prototype.start = function(e, i) {
      if (e === void 0 && (e = Je()), i === void 0 && (i = !1), this._isPlaying)
        return this;
      if (this._group && this._group.add(this), this._repeat = this._initialRepeat, this._reversed) {
        this._reversed = !1;
        for (var r in this._valuesStartRepeat)
          this._swapEndStartRepeatValues(r), this._valuesStart[r] = this._valuesStartRepeat[r];
      }
      if (this._isPlaying = !0, this._isPaused = !1, this._onStartCallbackFired = !1, this._onEveryStartCallbackFired = !1, this._isChainStopped = !1, this._startTime = e, this._startTime += this._delayTime, !this._propertiesAreSetUp || i) {
        if (this._propertiesAreSetUp = !0, !this._isDynamic) {
          var n = {};
          for (var o in this._valuesEnd)
            n[o] = this._valuesEnd[o];
          this._valuesEnd = n;
        }
        this._setupProperties(this._object, this._valuesStart, this._valuesEnd, this._valuesStartRepeat, i);
      }
      return this;
    }, t.prototype.startFromCurrentValues = function(e) {
      return this.start(e, !0);
    }, t.prototype._setupProperties = function(e, i, r, n, o) {
      for (var s in r) {
        var a = e[s], h = Array.isArray(a), l = h ? "array" : typeof a, w = !h && Array.isArray(r[s]);
        if (!(l === "undefined" || l === "function")) {
          if (w) {
            var d = r[s];
            if (d.length === 0)
              continue;
            for (var u = [a], y = 0, C = d.length; y < C; y += 1) {
              var m = this._handleRelativeValue(a, d[y]);
              if (isNaN(m)) {
                w = !1, console.warn("Found invalid interpolation list. Skipping.");
                break;
              }
              u.push(m);
            }
            w && (r[s] = u);
          }
          if ((l === "object" || h) && a && !w) {
            i[s] = h ? [] : {};
            var c = a;
            for (var f in c)
              i[s][f] = c[f];
            n[s] = h ? [] : {};
            var d = r[s];
            if (!this._isDynamic) {
              var _ = {};
              for (var f in d)
                _[f] = d[f];
              r[s] = d = _;
            }
            this._setupProperties(c, i[s], d, n[s], o);
          } else
            (typeof i[s] > "u" || o) && (i[s] = a), h || (i[s] *= 1), w ? n[s] = r[s].slice().reverse() : n[s] = i[s] || 0;
        }
      }
    }, t.prototype.stop = function() {
      return this._isChainStopped || (this._isChainStopped = !0, this.stopChainedTweens()), this._isPlaying ? (this._group && this._group.remove(this), this._isPlaying = !1, this._isPaused = !1, this._onStopCallback && this._onStopCallback(this._object), this) : this;
    }, t.prototype.end = function() {
      return this._goToEnd = !0, this.update(1 / 0), this;
    }, t.prototype.pause = function(e) {
      return e === void 0 && (e = Je()), this._isPaused || !this._isPlaying ? this : (this._isPaused = !0, this._pauseStart = e, this._group && this._group.remove(this), this);
    }, t.prototype.resume = function(e) {
      return e === void 0 && (e = Je()), !this._isPaused || !this._isPlaying ? this : (this._isPaused = !1, this._startTime += e - this._pauseStart, this._pauseStart = 0, this._group && this._group.add(this), this);
    }, t.prototype.stopChainedTweens = function() {
      for (var e = 0, i = this._chainedTweens.length; e < i; e++)
        this._chainedTweens[e].stop();
      return this;
    }, t.prototype.group = function(e) {
      return e === void 0 && (e = bt), this._group = e, this;
    }, t.prototype.delay = function(e) {
      return e === void 0 && (e = 0), this._delayTime = e, this;
    }, t.prototype.repeat = function(e) {
      return e === void 0 && (e = 0), this._initialRepeat = e, this._repeat = e, this;
    }, t.prototype.repeatDelay = function(e) {
      return this._repeatDelayTime = e, this;
    }, t.prototype.yoyo = function(e) {
      return e === void 0 && (e = !1), this._yoyo = e, this;
    }, t.prototype.easing = function(e) {
      return e === void 0 && (e = ze.Linear.None), this._easingFunction = e, this;
    }, t.prototype.interpolation = function(e) {
      return e === void 0 && (e = xt.Linear), this._interpolationFunction = e, this;
    }, t.prototype.chain = function() {
      for (var e = [], i = 0; i < arguments.length; i++)
        e[i] = arguments[i];
      return this._chainedTweens = e, this;
    }, t.prototype.onStart = function(e) {
      return this._onStartCallback = e, this;
    }, t.prototype.onEveryStart = function(e) {
      return this._onEveryStartCallback = e, this;
    }, t.prototype.onUpdate = function(e) {
      return this._onUpdateCallback = e, this;
    }, t.prototype.onRepeat = function(e) {
      return this._onRepeatCallback = e, this;
    }, t.prototype.onComplete = function(e) {
      return this._onCompleteCallback = e, this;
    }, t.prototype.onStop = function(e) {
      return this._onStopCallback = e, this;
    }, t.prototype.update = function(e, i) {
      var r = this, n;
      if (e === void 0 && (e = Je()), i === void 0 && (i = !0), this._isPaused)
        return !0;
      var o, s = this._startTime + this._duration;
      if (!this._goToEnd && !this._isPlaying) {
        if (e > s)
          return !1;
        i && this.start(e, !0);
      }
      if (this._goToEnd = !1, e < this._startTime)
        return !0;
      this._onStartCallbackFired === !1 && (this._onStartCallback && this._onStartCallback(this._object), this._onStartCallbackFired = !0), this._onEveryStartCallbackFired === !1 && (this._onEveryStartCallback && this._onEveryStartCallback(this._object), this._onEveryStartCallbackFired = !0);
      var a = e - this._startTime, h = this._duration + ((n = this._repeatDelayTime) !== null && n !== void 0 ? n : this._delayTime), l = this._duration + this._repeat * h, w = function() {
        if (r._duration === 0 || a > l)
          return 1;
        var c = Math.trunc(a / h), f = a - c * h, _ = Math.min(f / r._duration, 1);
        return _ === 0 && a === r._duration ? 1 : _;
      }, d = w(), u = this._easingFunction(d);
      if (this._updateProperties(this._object, this._valuesStart, this._valuesEnd, u), this._onUpdateCallback && this._onUpdateCallback(this._object, d), this._duration === 0 || a >= this._duration)
        if (this._repeat > 0) {
          var y = Math.min(Math.trunc((a - this._duration) / h) + 1, this._repeat);
          isFinite(this._repeat) && (this._repeat -= y);
          for (o in this._valuesStartRepeat)
            !this._yoyo && typeof this._valuesEnd[o] == "string" && (this._valuesStartRepeat[o] = // eslint-disable-next-line
            // @ts-ignore FIXME?
            this._valuesStartRepeat[o] + parseFloat(this._valuesEnd[o])), this._yoyo && this._swapEndStartRepeatValues(o), this._valuesStart[o] = this._valuesStartRepeat[o];
          return this._yoyo && (this._reversed = !this._reversed), this._startTime += h * y, this._onRepeatCallback && this._onRepeatCallback(this._object), this._onEveryStartCallbackFired = !1, !0;
        } else {
          this._onCompleteCallback && this._onCompleteCallback(this._object);
          for (var C = 0, m = this._chainedTweens.length; C < m; C++)
            this._chainedTweens[C].start(this._startTime + this._duration, !1);
          return this._isPlaying = !1, !1;
        }
      return !0;
    }, t.prototype._updateProperties = function(e, i, r, n) {
      for (var o in r)
        if (i[o] !== void 0) {
          var s = i[o] || 0, a = r[o], h = Array.isArray(e[o]), l = Array.isArray(a), w = !h && l;
          w ? e[o] = this._interpolationFunction(a, n) : typeof a == "object" && a ? this._updateProperties(e[o], s, a, n) : (a = this._handleRelativeValue(s, a), typeof a == "number" && (e[o] = s + (a - s) * n));
        }
    }, t.prototype._handleRelativeValue = function(e, i) {
      return typeof i != "string" ? i : i.charAt(0) === "+" || i.charAt(0) === "-" ? e + parseFloat(i) : parseFloat(i);
    }, t.prototype._swapEndStartRepeatValues = function(e) {
      var i = this._valuesStartRepeat[e], r = this._valuesEnd[e];
      typeof r == "string" ? this._valuesStartRepeat[e] = this._valuesStartRepeat[e] + parseFloat(r) : this._valuesStartRepeat[e] = this._valuesEnd[e], this._valuesEnd[e] = i;
    }, t;
  })()
);
hi.nextId;
var Fe = bt;
Fe.getAll.bind(Fe);
Fe.removeAll.bind(Fe);
Fe.add.bind(Fe);
Fe.remove.bind(Fe);
var ji = Fe.update.bind(Fe);
class Ct extends _i {
  /**
   * 构造函数
   * @param container 容器元素或 CSS 选择器
   * @param options 视图选项
   */
  constructor(e, i = {}) {
    super(), this.topScenes = [], this.timer = new Oi();
    const { antialias: r = !1, stencil: n = !0, logarithmicDepthBuffer: o = !0 } = i;
    this.renderer = this.createRenderer(r, n, o), this.scene = this.createScene(), this.camera = this.createCamera(), e && this.addTo(e), this.ambLight = this.createAmbLight(), this.dirLight = this.createDirLight(), this.scene.add(this.ambLight), this.scene.add(this.dirLight), this.renderer.setAnimationLoop(this.animate.bind(this));
  }
  /** 容器宽度 */
  get width() {
    return this.container?.clientWidth || 0;
  }
  /** 容器高度 */
  get height() {
    return this.container?.clientHeight || 0;
  }
  /**
   * 将渲染器添加到容器中
   * @param container 容器元素或 CSS 选择器
   * @returns this
   */
  addTo(e) {
    const i = typeof e == "string" ? document.querySelector(e) : e;
    if (i instanceof HTMLElement)
      this.container = i, i.appendChild(this.renderer.domElement), this._resizeObserver = new ResizeObserver(this.resize.bind(this)), this._resizeObserver.observe(i);
    else
      throw new Error(`${e} not found!`);
    return this;
  }
  /**
   * 创建主场景
   * @returns 场景
   */
  createScene() {
    const e = new mi(), i = 14414079;
    return e.background = new ke(i), e.fog = new Pt(i, 0), e;
  }
  /**
   * 创建 WebGL 渲染器
   * @param antialias 是否抗锯齿
   * @param stencil 是否使用模板缓冲
   * @param logarithmicDepthBuffer 是否使用对数深度缓冲
   * @returns 渲染器
   */
  createRenderer(e, i, r) {
    const n = new gi({
      antialias: e,
      logarithmicDepthBuffer: r,
      stencil: i,
      alpha: !0,
      // 透明背景，用于覆盖场景叠加
      precision: "highp"
    });
    return n.setPixelRatio(window.devicePixelRatio), n.domElement.tabIndex = 0, n.domElement.style.outline = "none", n;
  }
  /**
   * 创建透视相机
   * @returns 相机
   */
  createCamera() {
    const e = new ri(70, 1, 0.1, 5e7);
    return e.position.set(0, 28e6, 0), e;
  }
  /**
   * 创建环境光
   * @returns 环境光
   */
  createAmbLight() {
    return new wi(16777215, 1);
  }
  /**
   * 创建平行光
   * @returns 平行光
   */
  createDirLight() {
    const e = new yi(16777215, 1);
    return e.position.set(0, 2e3, 1e3), e.target.position.set(0, 0, 0), e;
  }
  /**
   * 容器大小变化处理
   * @returns this
   */
  resize() {
    const e = this.width, i = this.height;
    return e === 0 || i === 0 ? this : (this.renderer.setSize(e, i), this.camera.aspect = e / i, this.camera.updateProjectionMatrix(), this.update(), this.dispatchEvent({ type: "resize", size: { width: e, height: i } }), this);
  }
  /**
   * 清理资源
   */
  dispose() {
    this._resizeObserver?.disconnect(), this.renderer.setAnimationLoop(null), this.renderer.dispose(), this.container?.contains(this.renderer.domElement) && this.container.removeChild(this.renderer.domElement);
  }
  /**
   * 渲染一帧（主场景 + 覆盖场景）
   */
  update() {
    this.renderer.autoClear = !1, this.renderer.render(this.scene, this.camera), this.topScenes.forEach((e) => {
      this.renderer.clearDepth(), this.renderer.render(e, this.camera);
    }), this.renderer.autoClear = !0;
  }
  /**
   * Three.js 动画循环回调
   */
  animate() {
    this.timer.update(), this.update(), this.dispatchEvent({ type: "update", delta: this.timer.getDelta() }), ji();
  }
}
const zt = { type: "change" }, At = { type: "start" }, li = { type: "end" }, et = new xi(), Ht = new bi(), zi = Math.cos(70 * Be.DEG2RAD), _e = new ce(), xe = 2 * Math.PI, oe = {
  NONE: -1,
  ROTATE: 0,
  DOLLY: 1,
  PAN: 2,
  TOUCH_ROTATE: 3,
  TOUCH_PAN: 4,
  TOUCH_DOLLY_PAN: 5,
  TOUCH_DOLLY_ROTATE: 6
}, ft = 1e-6;
class Hi extends Tt {
  /**
   * Constructs a new controls instance.
   *
   * @param {Object3D} object - The object that is managed by the controls.
   * @param {?HTMLElement} domElement - The HTML element used for event listeners.
   */
  constructor(e, i = null) {
    super(e, i), this.state = oe.NONE, this.target = new ce(), this.cursor = new ce(), this.minDistance = 0, this.maxDistance = 1 / 0, this.minZoom = 0, this.maxZoom = 1 / 0, this.minTargetRadius = 0, this.maxTargetRadius = 1 / 0, this.minPolarAngle = 0, this.maxPolarAngle = Math.PI, this.minAzimuthAngle = -1 / 0, this.maxAzimuthAngle = 1 / 0, this.enableDamping = !1, this.dampingFactor = 0.05, this.enableZoom = !0, this.zoomSpeed = 1, this.enableRotate = !0, this.rotateSpeed = 1, this.keyRotateSpeed = 1, this.enablePan = !0, this.panSpeed = 1, this.screenSpacePanning = !0, this.keyPanSpeed = 7, this.zoomToCursor = !1, this.autoRotate = !1, this.autoRotateSpeed = 2, this.keys = { LEFT: "ArrowLeft", UP: "ArrowUp", RIGHT: "ArrowRight", BOTTOM: "ArrowDown" }, this.mouseButtons = { LEFT: Pe.ROTATE, MIDDLE: Pe.DOLLY, RIGHT: Pe.PAN }, this.touches = { ONE: Le.ROTATE, TWO: Le.DOLLY_PAN }, this.target0 = this.target.clone(), this.position0 = this.object.position.clone(), this.zoom0 = this.object.zoom, this._cursorStyle = "auto", this._domElementKeyEvents = null, this._lastPosition = new ce(), this._lastQuaternion = new st(), this._lastTargetPosition = new ce(), this._quat = new st().setFromUnitVectors(e.up, new ce(0, 1, 0)), this._quatInverse = this._quat.clone().invert(), this._spherical = new jt(), this._sphericalDelta = new jt(), this._scale = 1, this._panOffset = new ce(), this._rotateStart = new Ee(), this._rotateEnd = new Ee(), this._rotateDelta = new Ee(), this._panStart = new Ee(), this._panEnd = new Ee(), this._panDelta = new Ee(), this._dollyStart = new Ee(), this._dollyEnd = new Ee(), this._dollyDelta = new Ee(), this._dollyDirection = new ce(), this._mouse = new Ee(), this._performCursorZoom = !1, this._pointers = [], this._pointerPositions = {}, this._controlActive = !1, this._onPointerMove = Vi.bind(this), this._onPointerDown = Ni.bind(this), this._onPointerUp = Gi.bind(this), this._onContextMenu = $i.bind(this), this._onMouseWheel = qi.bind(this), this._onKeyDown = Xi.bind(this), this._onTouchStart = Wi.bind(this), this._onTouchMove = Ji.bind(this), this._onMouseDown = Ki.bind(this), this._onMouseMove = Yi.bind(this), this._interceptControlDown = Zi.bind(this), this._interceptControlUp = Qi.bind(this), this.domElement !== null && this.connect(this.domElement), this.update();
  }
  /**
   * Defines the visual representation of the cursor.
   *
   * @type {('auto'|'grab')}
   * @default 'auto'
   */
  set cursorStyle(e) {
    this._cursorStyle = e, e === "grab" ? this.domElement.style.cursor = "grab" : this.domElement.style.cursor = "auto";
  }
  get cursorStyle() {
    return this._cursorStyle;
  }
  connect(e) {
    super.connect(e), this.domElement.addEventListener("pointerdown", this._onPointerDown), this.domElement.addEventListener("pointercancel", this._onPointerUp), this.domElement.addEventListener("contextmenu", this._onContextMenu), this.domElement.addEventListener("wheel", this._onMouseWheel, { passive: !1 }), this.domElement.getRootNode().addEventListener("keydown", this._interceptControlDown, { passive: !0, capture: !0 }), this.domElement.style.touchAction = "none";
  }
  disconnect() {
    this.domElement.removeEventListener("pointerdown", this._onPointerDown), this.domElement.ownerDocument.removeEventListener("pointermove", this._onPointerMove), this.domElement.ownerDocument.removeEventListener("pointerup", this._onPointerUp), this.domElement.removeEventListener("pointercancel", this._onPointerUp), this.domElement.removeEventListener("wheel", this._onMouseWheel), this.domElement.removeEventListener("contextmenu", this._onContextMenu), this.stopListenToKeyEvents(), this.domElement.getRootNode().removeEventListener("keydown", this._interceptControlDown, { capture: !0 }), this.domElement.style.touchAction = "auto";
  }
  dispose() {
    this.disconnect();
  }
  /**
   * Get the current vertical rotation, in radians.
   *
   * @return {number} The current vertical rotation, in radians.
   */
  getPolarAngle() {
    return this._spherical.phi;
  }
  /**
   * Get the current horizontal rotation, in radians.
   *
   * @return {number} The current horizontal rotation, in radians.
   */
  getAzimuthalAngle() {
    return this._spherical.theta;
  }
  /**
   * Returns the distance from the camera to the target.
   *
   * @return {number} The distance from the camera to the target.
   */
  getDistance() {
    return this.object.position.distanceTo(this.target);
  }
  /**
   * Adds key event listeners to the given DOM element.
   * `window` is a recommended argument for using this method.
   *
   * @param {HTMLElement} domElement - The DOM element
   */
  listenToKeyEvents(e) {
    e.addEventListener("keydown", this._onKeyDown), this._domElementKeyEvents = e;
  }
  /**
   * Removes the key event listener previously defined with `listenToKeyEvents()`.
   */
  stopListenToKeyEvents() {
    this._domElementKeyEvents !== null && (this._domElementKeyEvents.removeEventListener("keydown", this._onKeyDown), this._domElementKeyEvents = null);
  }
  /**
   * Save the current state of the controls. This can later be recovered with `reset()`.
   */
  saveState() {
    this.target0.copy(this.target), this.position0.copy(this.object.position), this.zoom0 = this.object.zoom;
  }
  /**
   * Reset the controls to their state from either the last time the `saveState()`
   * was called, or the initial state.
   */
  reset() {
    this.target.copy(this.target0), this.object.position.copy(this.position0), this.object.zoom = this.zoom0, this.object.updateProjectionMatrix(), this.dispatchEvent(zt), this.update(), this.state = oe.NONE;
  }
  /**
   * Programmatically pan the camera.
   *
   * @param {number} deltaX - The horizontal pan amount in pixels.
   * @param {number} deltaY - The vertical pan amount in pixels.
   */
  pan(e, i) {
    this._pan(e, i), this.update();
  }
  /**
   * Programmatically dolly in (zoom in for perspective camera).
   *
   * @param {number} dollyScale - The dolly scale factor.
   */
  dollyIn(e) {
    this._dollyIn(e), this.update();
  }
  /**
   * Programmatically dolly out (zoom out for perspective camera).
   *
   * @param {number} dollyScale - The dolly scale factor.
   */
  dollyOut(e) {
    this._dollyOut(e), this.update();
  }
  /**
   * Programmatically rotate the camera left (around the vertical axis).
   *
   * @param {number} angle - The rotation angle in radians.
   */
  rotateLeft(e) {
    this._rotateLeft(e), this.update();
  }
  /**
   * Programmatically rotate the camera up (around the horizontal axis).
   *
   * @param {number} angle - The rotation angle in radians.
   */
  rotateUp(e) {
    this._rotateUp(e), this.update();
  }
  update(e = null) {
    const i = this.object.position;
    _e.copy(i).sub(this.target), _e.applyQuaternion(this._quat), this._spherical.setFromVector3(_e), this.autoRotate && this.state === oe.NONE && this._rotateLeft(this._getAutoRotationAngle(e)), this.enableDamping ? (this._spherical.theta += this._sphericalDelta.theta * this.dampingFactor, this._spherical.phi += this._sphericalDelta.phi * this.dampingFactor) : (this._spherical.theta += this._sphericalDelta.theta, this._spherical.phi += this._sphericalDelta.phi);
    let r = this.minAzimuthAngle, n = this.maxAzimuthAngle;
    isFinite(r) && isFinite(n) && (r < -Math.PI ? r += xe : r > Math.PI && (r -= xe), n < -Math.PI ? n += xe : n > Math.PI && (n -= xe), r <= n ? this._spherical.theta = Math.max(r, Math.min(n, this._spherical.theta)) : this._spherical.theta = this._spherical.theta > (r + n) / 2 ? Math.max(r, this._spherical.theta) : Math.min(n, this._spherical.theta)), this._spherical.phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this._spherical.phi)), this._spherical.makeSafe(), this.enableDamping === !0 ? this.target.addScaledVector(this._panOffset, this.dampingFactor) : this.target.add(this._panOffset), this.target.sub(this.cursor), this.target.clampLength(this.minTargetRadius, this.maxTargetRadius), this.target.add(this.cursor);
    let o = !1;
    if (this.zoomToCursor && this._performCursorZoom || this.object.isOrthographicCamera)
      this._spherical.radius = this._clampDistance(this._spherical.radius);
    else {
      const s = this._spherical.radius;
      this._spherical.radius = this._clampDistance(this._spherical.radius * this._scale), o = s != this._spherical.radius;
    }
    if (_e.setFromSpherical(this._spherical), _e.applyQuaternion(this._quatInverse), i.copy(this.target).add(_e), this.object.lookAt(this.target), this.enableDamping === !0 ? (this._sphericalDelta.theta *= 1 - this.dampingFactor, this._sphericalDelta.phi *= 1 - this.dampingFactor, this._panOffset.multiplyScalar(1 - this.dampingFactor)) : (this._sphericalDelta.set(0, 0, 0), this._panOffset.set(0, 0, 0)), this.zoomToCursor && this._performCursorZoom) {
      let s = null;
      if (this.object.isPerspectiveCamera) {
        const a = _e.length();
        s = this._clampDistance(a * this._scale);
        const h = a - s;
        this.object.position.addScaledVector(this._dollyDirection, h), this.object.updateMatrixWorld(), o = !!h;
      } else if (this.object.isOrthographicCamera) {
        const a = new ce(this._mouse.x, this._mouse.y, 0);
        a.unproject(this.object);
        const h = this.object.zoom;
        this.object.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.object.zoom / this._scale)), this.object.updateProjectionMatrix(), o = h !== this.object.zoom;
        const l = new ce(this._mouse.x, this._mouse.y, 0);
        l.unproject(this.object), this.object.position.sub(l).add(a), this.object.updateMatrixWorld(), s = _e.length();
      } else
        console.warn("WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled."), this.zoomToCursor = !1;
      s !== null && (this.screenSpacePanning ? this.target.set(0, 0, -1).transformDirection(this.object.matrix).multiplyScalar(s).add(this.object.position) : (et.origin.copy(this.object.position), et.direction.set(0, 0, -1).transformDirection(this.object.matrix), Math.abs(this.object.up.dot(et.direction)) < zi ? this.object.lookAt(this.target) : (Ht.setFromNormalAndCoplanarPoint(this.object.up, this.target), et.intersectPlane(Ht, this.target))));
    } else if (this.object.isOrthographicCamera) {
      const s = this.object.zoom;
      this.object.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.object.zoom / this._scale)), s !== this.object.zoom && (this.object.updateProjectionMatrix(), o = !0);
    }
    return this._scale = 1, this._performCursorZoom = !1, o || this._lastPosition.distanceToSquared(this.object.position) > ft || 8 * (1 - this._lastQuaternion.dot(this.object.quaternion)) > ft || this._lastTargetPosition.distanceToSquared(this.target) > ft ? (this.dispatchEvent(zt), this._lastPosition.copy(this.object.position), this._lastQuaternion.copy(this.object.quaternion), this._lastTargetPosition.copy(this.target), !0) : !1;
  }
  _getAutoRotationAngle(e) {
    return e !== null ? xe / 60 * this.autoRotateSpeed * e : xe / 60 / 60 * this.autoRotateSpeed;
  }
  _getZoomScale(e) {
    const i = Math.abs(e * 0.01);
    return Math.pow(0.95, this.zoomSpeed * i);
  }
  _rotateLeft(e) {
    this._sphericalDelta.theta -= e;
  }
  _rotateUp(e) {
    this._sphericalDelta.phi -= e;
  }
  _panLeft(e, i) {
    _e.setFromMatrixColumn(i, 0), _e.multiplyScalar(-e), this._panOffset.add(_e);
  }
  _panUp(e, i) {
    this.screenSpacePanning === !0 ? _e.setFromMatrixColumn(i, 1) : (_e.setFromMatrixColumn(i, 0), _e.crossVectors(this.object.up, _e)), _e.multiplyScalar(e), this._panOffset.add(_e);
  }
  // deltaX and deltaY are in pixels; right and down are positive
  _pan(e, i) {
    const r = this.domElement;
    if (this.object.isPerspectiveCamera) {
      const n = this.object.position;
      _e.copy(n).sub(this.target);
      let o = _e.length();
      o *= Math.tan(this.object.fov / 2 * Math.PI / 180), this._panLeft(2 * e * o / r.clientHeight, this.object.matrix), this._panUp(2 * i * o / r.clientHeight, this.object.matrix);
    } else this.object.isOrthographicCamera ? (this._panLeft(e * (this.object.right - this.object.left) / this.object.zoom / r.clientWidth, this.object.matrix), this._panUp(i * (this.object.top - this.object.bottom) / this.object.zoom / r.clientHeight, this.object.matrix)) : (console.warn("WARNING: OrbitControls.js encountered an unknown camera type - pan disabled."), this.enablePan = !1);
  }
  _dollyOut(e) {
    this.object.isPerspectiveCamera || this.object.isOrthographicCamera ? this._scale /= e : (console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."), this.enableZoom = !1);
  }
  _dollyIn(e) {
    this.object.isPerspectiveCamera || this.object.isOrthographicCamera ? this._scale *= e : (console.warn("WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled."), this.enableZoom = !1);
  }
  _updateZoomParameters(e, i) {
    if (!this.zoomToCursor)
      return;
    this._performCursorZoom = !0;
    const r = this.domElement.getBoundingClientRect(), n = e - r.left, o = i - r.top, s = r.width, a = r.height;
    this._mouse.x = n / s * 2 - 1, this._mouse.y = -(o / a) * 2 + 1, this._dollyDirection.set(this._mouse.x, this._mouse.y, 1).unproject(this.object).sub(this.object.position).normalize();
  }
  _clampDistance(e) {
    return Math.max(this.minDistance, Math.min(this.maxDistance, e));
  }
  //
  // event callbacks - update the object state
  //
  _handleMouseDownRotate(e) {
    this._rotateStart.set(e.clientX, e.clientY);
  }
  _handleMouseDownDolly(e) {
    this._updateZoomParameters(e.clientX, e.clientX), this._dollyStart.set(e.clientX, e.clientY);
  }
  _handleMouseDownPan(e) {
    this._panStart.set(e.clientX, e.clientY);
  }
  _handleMouseMoveRotate(e) {
    this._rotateEnd.set(e.clientX, e.clientY), this._rotateDelta.subVectors(this._rotateEnd, this._rotateStart).multiplyScalar(this.rotateSpeed);
    const i = this.domElement;
    this._rotateLeft(xe * this._rotateDelta.x / i.clientHeight), this._rotateUp(xe * this._rotateDelta.y / i.clientHeight), this._rotateStart.copy(this._rotateEnd), this.update();
  }
  _handleMouseMoveDolly(e) {
    this._dollyEnd.set(e.clientX, e.clientY), this._dollyDelta.subVectors(this._dollyEnd, this._dollyStart), this._dollyDelta.y > 0 ? this._dollyOut(this._getZoomScale(this._dollyDelta.y)) : this._dollyDelta.y < 0 && this._dollyIn(this._getZoomScale(this._dollyDelta.y)), this._dollyStart.copy(this._dollyEnd), this.update();
  }
  _handleMouseMovePan(e) {
    this._panEnd.set(e.clientX, e.clientY), this._panDelta.subVectors(this._panEnd, this._panStart).multiplyScalar(this.panSpeed), this._pan(this._panDelta.x, this._panDelta.y), this._panStart.copy(this._panEnd), this.update();
  }
  _handleMouseWheel(e) {
    this._updateZoomParameters(e.clientX, e.clientY), e.deltaY < 0 ? this._dollyIn(this._getZoomScale(e.deltaY)) : e.deltaY > 0 && this._dollyOut(this._getZoomScale(e.deltaY)), this.update();
  }
  _handleKeyDown(e) {
    let i = !1;
    switch (e.code) {
      case this.keys.UP:
        e.ctrlKey || e.metaKey || e.shiftKey ? this.enableRotate && this._rotateUp(xe * this.keyRotateSpeed / this.domElement.clientHeight) : this.enablePan && this._pan(0, this.keyPanSpeed), i = !0;
        break;
      case this.keys.BOTTOM:
        e.ctrlKey || e.metaKey || e.shiftKey ? this.enableRotate && this._rotateUp(-xe * this.keyRotateSpeed / this.domElement.clientHeight) : this.enablePan && this._pan(0, -this.keyPanSpeed), i = !0;
        break;
      case this.keys.LEFT:
        e.ctrlKey || e.metaKey || e.shiftKey ? this.enableRotate && this._rotateLeft(xe * this.keyRotateSpeed / this.domElement.clientHeight) : this.enablePan && this._pan(this.keyPanSpeed, 0), i = !0;
        break;
      case this.keys.RIGHT:
        e.ctrlKey || e.metaKey || e.shiftKey ? this.enableRotate && this._rotateLeft(-xe * this.keyRotateSpeed / this.domElement.clientHeight) : this.enablePan && this._pan(-this.keyPanSpeed, 0), i = !0;
        break;
    }
    i && (e.preventDefault(), this.update());
  }
  _handleTouchStartRotate(e) {
    if (this._pointers.length === 1)
      this._rotateStart.set(e.pageX, e.pageY);
    else {
      const i = this._getSecondPointerPosition(e), r = 0.5 * (e.pageX + i.x), n = 0.5 * (e.pageY + i.y);
      this._rotateStart.set(r, n);
    }
  }
  _handleTouchStartPan(e) {
    if (this._pointers.length === 1)
      this._panStart.set(e.pageX, e.pageY);
    else {
      const i = this._getSecondPointerPosition(e), r = 0.5 * (e.pageX + i.x), n = 0.5 * (e.pageY + i.y);
      this._panStart.set(r, n);
    }
  }
  _handleTouchStartDolly(e) {
    const i = this._getSecondPointerPosition(e), r = e.pageX - i.x, n = e.pageY - i.y, o = Math.sqrt(r * r + n * n);
    this._dollyStart.set(0, o);
  }
  _handleTouchStartDollyPan(e) {
    this.enableZoom && this._handleTouchStartDolly(e), this.enablePan && this._handleTouchStartPan(e);
  }
  _handleTouchStartDollyRotate(e) {
    this.enableZoom && this._handleTouchStartDolly(e), this.enableRotate && this._handleTouchStartRotate(e);
  }
  _handleTouchMoveRotate(e) {
    if (this._pointers.length == 1)
      this._rotateEnd.set(e.pageX, e.pageY);
    else {
      const r = this._getSecondPointerPosition(e), n = 0.5 * (e.pageX + r.x), o = 0.5 * (e.pageY + r.y);
      this._rotateEnd.set(n, o);
    }
    this._rotateDelta.subVectors(this._rotateEnd, this._rotateStart).multiplyScalar(this.rotateSpeed);
    const i = this.domElement;
    this._rotateLeft(xe * this._rotateDelta.x / i.clientHeight), this._rotateUp(xe * this._rotateDelta.y / i.clientHeight), this._rotateStart.copy(this._rotateEnd);
  }
  _handleTouchMovePan(e) {
    if (this._pointers.length === 1)
      this._panEnd.set(e.pageX, e.pageY);
    else {
      const i = this._getSecondPointerPosition(e), r = 0.5 * (e.pageX + i.x), n = 0.5 * (e.pageY + i.y);
      this._panEnd.set(r, n);
    }
    this._panDelta.subVectors(this._panEnd, this._panStart).multiplyScalar(this.panSpeed), this._pan(this._panDelta.x, this._panDelta.y), this._panStart.copy(this._panEnd);
  }
  _handleTouchMoveDolly(e) {
    const i = this._getSecondPointerPosition(e), r = e.pageX - i.x, n = e.pageY - i.y, o = Math.sqrt(r * r + n * n);
    this._dollyEnd.set(0, o), this._dollyDelta.set(0, Math.pow(this._dollyEnd.y / this._dollyStart.y, this.zoomSpeed)), this._dollyOut(this._dollyDelta.y), this._dollyStart.copy(this._dollyEnd);
    const s = (e.pageX + i.x) * 0.5, a = (e.pageY + i.y) * 0.5;
    this._updateZoomParameters(s, a);
  }
  _handleTouchMoveDollyPan(e) {
    this.enableZoom && this._handleTouchMoveDolly(e), this.enablePan && this._handleTouchMovePan(e);
  }
  _handleTouchMoveDollyRotate(e) {
    this.enableZoom && this._handleTouchMoveDolly(e), this.enableRotate && this._handleTouchMoveRotate(e);
  }
  // pointers
  _addPointer(e) {
    this._pointers.push(e.pointerId);
  }
  _removePointer(e) {
    delete this._pointerPositions[e.pointerId];
    for (let i = 0; i < this._pointers.length; i++)
      if (this._pointers[i] == e.pointerId) {
        this._pointers.splice(i, 1);
        return;
      }
  }
  _isTrackingPointer(e) {
    for (let i = 0; i < this._pointers.length; i++)
      if (this._pointers[i] == e.pointerId) return !0;
    return !1;
  }
  _trackPointer(e) {
    let i = this._pointerPositions[e.pointerId];
    i === void 0 && (i = new Ee(), this._pointerPositions[e.pointerId] = i), i.set(e.pageX, e.pageY);
  }
  _getSecondPointerPosition(e) {
    const i = e.pointerId === this._pointers[0] ? this._pointers[1] : this._pointers[0];
    return this._pointerPositions[i];
  }
  //
  _customWheelEvent(e) {
    const i = e.deltaMode, r = {
      clientX: e.clientX,
      clientY: e.clientY,
      deltaY: e.deltaY
    };
    switch (i) {
      case 1:
        r.deltaY *= 16;
        break;
      case 2:
        r.deltaY *= 100;
        break;
    }
    return e.ctrlKey && !this._controlActive && (r.deltaY *= 10), r;
  }
}
function Ni(t) {
  this.enabled !== !1 && (this._pointers.length === 0 && (this.domElement.setPointerCapture(t.pointerId), this.domElement.ownerDocument.addEventListener("pointermove", this._onPointerMove), this.domElement.ownerDocument.addEventListener("pointerup", this._onPointerUp)), !this._isTrackingPointer(t) && (this._addPointer(t), t.pointerType === "touch" ? this._onTouchStart(t) : this._onMouseDown(t), this._cursorStyle === "grab" && (this.domElement.style.cursor = "grabbing")));
}
function Vi(t) {
  this.enabled !== !1 && (t.pointerType === "touch" ? this._onTouchMove(t) : this._onMouseMove(t));
}
function Gi(t) {
  switch (this._removePointer(t), this._pointers.length) {
    case 0:
      this.domElement.releasePointerCapture(t.pointerId), this.domElement.ownerDocument.removeEventListener("pointermove", this._onPointerMove), this.domElement.ownerDocument.removeEventListener("pointerup", this._onPointerUp), this.dispatchEvent(li), this.state = oe.NONE, this._cursorStyle === "grab" && (this.domElement.style.cursor = "grab");
      break;
    case 1:
      const e = this._pointers[0], i = this._pointerPositions[e];
      this._onTouchStart({ pointerId: e, pageX: i.x, pageY: i.y });
      break;
  }
}
function Ki(t) {
  let e;
  switch (t.button) {
    case 0:
      e = this.mouseButtons.LEFT;
      break;
    case 1:
      e = this.mouseButtons.MIDDLE;
      break;
    case 2:
      e = this.mouseButtons.RIGHT;
      break;
    default:
      e = -1;
  }
  switch (e) {
    case Pe.DOLLY:
      if (this.enableZoom === !1) return;
      this._handleMouseDownDolly(t), this.state = oe.DOLLY;
      break;
    case Pe.ROTATE:
      if (t.ctrlKey || t.metaKey || t.shiftKey) {
        if (this.enablePan === !1) return;
        this._handleMouseDownPan(t), this.state = oe.PAN;
      } else {
        if (this.enableRotate === !1) return;
        this._handleMouseDownRotate(t), this.state = oe.ROTATE;
      }
      break;
    case Pe.PAN:
      if (t.ctrlKey || t.metaKey || t.shiftKey) {
        if (this.enableRotate === !1) return;
        this._handleMouseDownRotate(t), this.state = oe.ROTATE;
      } else {
        if (this.enablePan === !1) return;
        this._handleMouseDownPan(t), this.state = oe.PAN;
      }
      break;
    default:
      this.state = oe.NONE;
  }
  this.state !== oe.NONE && this.dispatchEvent(At);
}
function Yi(t) {
  switch (this.state) {
    case oe.ROTATE:
      if (this.enableRotate === !1) return;
      this._handleMouseMoveRotate(t);
      break;
    case oe.DOLLY:
      if (this.enableZoom === !1) return;
      this._handleMouseMoveDolly(t);
      break;
    case oe.PAN:
      if (this.enablePan === !1) return;
      this._handleMouseMovePan(t);
      break;
  }
}
function qi(t) {
  this.enabled === !1 || this.enableZoom === !1 || this.state !== oe.NONE || (t.preventDefault(), this.dispatchEvent(At), this._handleMouseWheel(this._customWheelEvent(t)), this.dispatchEvent(li));
}
function Xi(t) {
  this.enabled !== !1 && this._handleKeyDown(t);
}
function Wi(t) {
  switch (this._trackPointer(t), this._pointers.length) {
    case 1:
      switch (this.touches.ONE) {
        case Le.ROTATE:
          if (this.enableRotate === !1) return;
          this._handleTouchStartRotate(t), this.state = oe.TOUCH_ROTATE;
          break;
        case Le.PAN:
          if (this.enablePan === !1) return;
          this._handleTouchStartPan(t), this.state = oe.TOUCH_PAN;
          break;
        default:
          this.state = oe.NONE;
      }
      break;
    case 2:
      switch (this.touches.TWO) {
        case Le.DOLLY_PAN:
          if (this.enableZoom === !1 && this.enablePan === !1) return;
          this._handleTouchStartDollyPan(t), this.state = oe.TOUCH_DOLLY_PAN;
          break;
        case Le.DOLLY_ROTATE:
          if (this.enableZoom === !1 && this.enableRotate === !1) return;
          this._handleTouchStartDollyRotate(t), this.state = oe.TOUCH_DOLLY_ROTATE;
          break;
        default:
          this.state = oe.NONE;
      }
      break;
    default:
      this.state = oe.NONE;
  }
  this.state !== oe.NONE && this.dispatchEvent(At);
}
function Ji(t) {
  switch (this._trackPointer(t), this.state) {
    case oe.TOUCH_ROTATE:
      if (this.enableRotate === !1) return;
      this._handleTouchMoveRotate(t), this.update();
      break;
    case oe.TOUCH_PAN:
      if (this.enablePan === !1) return;
      this._handleTouchMovePan(t), this.update();
      break;
    case oe.TOUCH_DOLLY_PAN:
      if (this.enableZoom === !1 && this.enablePan === !1) return;
      this._handleTouchMoveDollyPan(t), this.update();
      break;
    case oe.TOUCH_DOLLY_ROTATE:
      if (this.enableZoom === !1 && this.enableRotate === !1) return;
      this._handleTouchMoveDollyRotate(t), this.update();
      break;
    default:
      this.state = oe.NONE;
  }
}
function $i(t) {
  this.enabled !== !1 && t.preventDefault();
}
function Zi(t) {
  t.key === "Control" && (this._controlActive = !0, this.domElement.getRootNode().addEventListener("keyup", this._interceptControlUp, { passive: !0, capture: !0 }));
}
function Qi(t) {
  t.key === "Control" && (this._controlActive = !1, this.domElement.getRootNode().removeEventListener("keyup", this._interceptControlUp, { passive: !0, capture: !0 }));
}
class er extends Hi {
  /**
   * 瓦片地图轨道控制器
   * @param camera 透视相机
   * @param domElement 绑定的 DOM 元素
   */
  constructor(e, i) {
    super(e, i), this.mapMaxPolarAngle = Math.PI / 2.1, this.restAzimuthDist = 8e6, this.dynamicZoomSpeed = !0, this.dynamicMaxPolarAngle = !0, this._controlsMode = "MAP", this.controlsMode = "MAP", this.screenSpacePanning = !1, this.minDistance = 10, this.maxDistance = 3e7, this.maxPolarAngle = 1.2, this.enableDamping = !0, this.dampingFactor = 0.1, this.keyPanSpeed = 5, this.listenToKeyEvents(i), this.addEventListener("change", this.onChange.bind(this));
  }
  get controlsMode() {
    return this._controlsMode;
  }
  set controlsMode(e) {
    this._controlsMode = e, this.controlsMode.toUpperCase() === "MAP" ? (this.mouseButtons = { LEFT: Pe.PAN, MIDDLE: Pe.DOLLY, RIGHT: Pe.ROTATE }, this.touches = { ONE: Le.PAN, TWO: Le.DOLLY_ROTATE }) : (this.mouseButtons = { LEFT: Pe.ROTATE, MIDDLE: Pe.DOLLY, RIGHT: Pe.PAN }, this.touches = { ONE: Le.ROTATE, TWO: Le.DOLLY_PAN });
  }
  // 控制器变化时调整相机 near/far 和方位角/极角
  onChange() {
    const e = Math.max(this.getPolarAngle(), 0.01), i = Math.max(this.getDistance(), 1);
    this.dynamicZoomSpeed && (this.zoomSpeed = Math.max(Math.log(i / 1e3), 1));
    const r = i > this.restAzimuthDist;
    this.minAzimuthAngle = r ? 0 : -1 / 0, this.maxAzimuthAngle = r ? 0 : 1 / 0, this.dynamicMaxPolarAngle && (this.maxPolarAngle = Math.min(Math.pow(1e7 / i, 2), this.mapMaxPolarAngle));
    const n = this.object;
    n instanceof ri && (n.far = Be.clamp(i / (e / 1.5) * 7, 2e4, this.maxDistance * 2), n.near = Math.max(n.far / 5e4, this.minDistance), n.updateProjectionMatrix());
  }
}
class Fn extends Ct {
  constructor() {
    super(...arguments), this.controls = this._createControls(), this._fogFactor = 1, this._flying = !1;
  }
  /** 是否正在飞行 */
  get flying() {
    return this._flying;
  }
  /** 获取雾密度系数 */
  get fogFactor() {
    return this._fogFactor;
  }
  /** 设置雾密度系数，默认值 1 */
  set fogFactor(e) {
    this._fogFactor = e, this._changeFogFactor();
  }
  /** 获取当前控制器模式：MAP（地图模式）或 ORBIT（轨道模式） */
  get controlsMode() {
    return this.controls.controlsMode;
  }
  /** 设置控制器模式 */
  set controlsMode(e) {
    this.controls.controlsMode = e;
  }
  /**
   * 根据距离和极角动态更新雾密度
   */
  _changeFogFactor() {
    if (this.scene.fog instanceof Pt) {
      const e = this.controls.getPolarAngle(), i = this.controls.getDistance();
      this.scene.fog.density = e / (i + 1) * this.fogFactor * 0.2;
    }
  }
  /**
   * 创建地图控制器
   * @returns 地图控制器
   */
  _createControls() {
    const e = new er(this.camera, this.container || this.renderer.domElement);
    return e.addEventListener("change", this._changeFogFactor.bind(this)), e;
  }
  /**
   * 清理资源
   */
  dispose() {
    this.controls.dispose(), super.dispose();
  }
  /**
   * Three.js 动画循环
   */
  animate() {
    super.animate(), this.controls.update();
  }
  /**
   * 飞行到指定位置
   * @param centerPosition 地图中心目标位置（世界坐标）
   * @param cameraPosition 相机目标位置（世界坐标）
   * @param animate 是否使用动画
   */
  flyTo(e, i, r = !0) {
    if (this.controls.target.copy(e), r) {
      const n = this.camera.position;
      return this._flying = !0, new Promise((o) => {
        new dt(n).to({ y: 1e7, z: 0 }, 500).chain(
          new dt(n).to(i, 2e3).easing(ze.Quintic.Out).onComplete(() => {
            this._flying = !1, o();
          })
        ).start();
      });
    } else
      return this.camera.position.copy(i), Promise.resolve();
  }
  /**
   * 飞行到指定对象的位置
   * @param object - 目标对象，相机将飞向该对象
   * @param offset - 相机位置的偏移参数
   * @param offset.azimuthDeg - 方位角，单位为度，默认值为 0
   * @param offset.pitchDeg - 俯仰角，单位为度，默认值为 30
   * @param offset.distanceMultiplier - 距离乘数，用于调整相机与对象的距离，默认值为 1.2
   * @param offset.animate - 是否使用动画效果飞行，默认值为 true
   * @returns 一个 Promise，在飞行完成时 resolve
   */
  flyToObject(e, i = { azimuthDeg: 0, pitchDeg: 30, distanceMultiplier: 1.2, animate: !0 }) {
    const r = (u) => {
      const y = new Dt().setFromObject(u), C = y.getBoundingSphere(new Mi());
      return C.center.setY(y.min.y), C;
    }, { center: n, radius: o } = r(e), s = o / Math.sin(Be.degToRad(this.camera.fov / 2)), { azimuthDeg: a = 0, pitchDeg: h = 30, distanceMultiplier: l = 1.5, animate: w = !0 } = i, d = new ce().setFromSphericalCoords(
      s * l,
      Be.degToRad(90 - h),
      Be.degToRad(a)
    ).add(n.clone().setY(0));
    if (this.controls.target.copy(n), w) {
      const u = this.camera.position;
      return this._flying = !0, new Promise((y) => {
        new dt(u).to(d, 2e3).easing(ze.Quintic.Out).onUpdate(() => {
          const C = r(e);
          this.controls.target.copy(C.center);
        }).start().onComplete(() => {
          this._flying = !1, y();
        });
      });
    } else
      return this.camera.position.copy(d), Promise.resolve();
  }
  /**
   * 获取当前场景状态
   * @returns 中心位置和相机位置
   */
  getState() {
    return {
      centerPosition: this.controls.target,
      cameraPosition: this.camera.position
    };
  }
}
const Ne = new Si(0, 0, 0, "YXZ"), Ve = new ce(), tr = { type: "change" }, ir = { type: "lock" }, rr = { type: "unlock" }, Nt = 2e-3, Vt = Math.PI / 2;
class nr extends Tt {
  /**
   * Constructs a new controls instance.
   *
   * @param {Camera} camera - The camera that is managed by the controls.
   * @param {?HTMLElement} domElement - The HTML element used for event listeners.
   */
  constructor(e, i = null) {
    super(e, i), this.isLocked = !1, this.minPolarAngle = 0, this.maxPolarAngle = Math.PI, this.pointerSpeed = 1, this._onMouseMove = sr.bind(this), this._onPointerlockChange = or.bind(this), this._onPointerlockError = ar.bind(this), this.domElement !== null && this.connect(this.domElement);
  }
  connect(e) {
    super.connect(e), this.domElement.ownerDocument.addEventListener("mousemove", this._onMouseMove), this.domElement.ownerDocument.addEventListener("pointerlockchange", this._onPointerlockChange), this.domElement.ownerDocument.addEventListener("pointerlockerror", this._onPointerlockError);
  }
  disconnect() {
    this.domElement.ownerDocument.removeEventListener("mousemove", this._onMouseMove), this.domElement.ownerDocument.removeEventListener("pointerlockchange", this._onPointerlockChange), this.domElement.ownerDocument.removeEventListener("pointerlockerror", this._onPointerlockError);
  }
  dispose() {
    this.disconnect();
  }
  /**
   * Returns the look direction of the camera.
   *
   * @param {Vector3} v - The target vector that is used to store the method's result.
   * @return {Vector3} The normalized direction vector.
   */
  getDirection(e) {
    return e.set(0, 0, -1).applyQuaternion(this.object.quaternion);
  }
  /**
   * Moves the camera forward parallel to the xz-plane. Assumes camera.up is y-up.
   *
   * @param {number} distance - The signed distance.
   */
  moveForward(e) {
    if (this.enabled === !1) return;
    const i = this.object;
    Ve.setFromMatrixColumn(i.matrix, 0), Ve.crossVectors(i.up, Ve), i.position.addScaledVector(Ve, e);
  }
  /**
   * Moves the camera sidewards parallel to the xz-plane.
   *
   * @param {number} distance - The signed distance.
   */
  moveRight(e) {
    if (this.enabled === !1) return;
    const i = this.object;
    Ve.setFromMatrixColumn(i.matrix, 0), i.position.addScaledVector(Ve, e);
  }
  /**
   * Activates the pointer lock.
   *
   * @param {boolean} [unadjustedMovement=false] - Disables OS-level adjustment for mouse acceleration, and accesses raw mouse input instead.
   * Setting it to true will disable mouse acceleration.
   */
  lock(e = !1) {
    this.domElement.requestPointerLock({
      unadjustedMovement: e
    });
  }
  /**
   * Exits the pointer lock.
   */
  unlock() {
    this.domElement.ownerDocument.exitPointerLock();
  }
}
function sr(t) {
  if (this.enabled === !1 || this.isLocked === !1) return;
  const e = this.object;
  Ne.setFromQuaternion(e.quaternion), Ne.y -= t.movementX * Nt * this.pointerSpeed, Ne.x -= t.movementY * Nt * this.pointerSpeed, Ne.x = Math.max(Vt - this.maxPolarAngle, Math.min(Vt - this.minPolarAngle, Ne.x)), e.quaternion.setFromEuler(Ne), this.dispatchEvent(tr);
}
function or() {
  this.domElement.ownerDocument.pointerLockElement === this.domElement ? (this.dispatchEvent(ir), this.isLocked = !0) : (this.dispatchEvent(rr), this.isLocked = !1);
}
function ar() {
  console.error("THREE.PointerLockControls: Unable to use Pointer Lock API");
}
class Cn extends Ct {
  /**
   * 构造函数
   * @param container 容器元素或 CSS 选择器
   * @param options 视图选项
   */
  constructor(e, i = {}) {
    super(e, i), this.cameraHeight = 8e3, this._autoForward = !1, this._moveForward = !1, this._moveBackward = !1, this._moveLeft = !1, this._moveRight = !1, this._canJump = !1, this._prevTime = performance.now(), this._velocity = new ce(), this._direction = new ce(), this._onKeyDown = (r) => {
      switch (r.code) {
        case "ArrowUp":
        case "KeyW":
          this._moveForward = !0;
          break;
        case "ArrowLeft":
        case "KeyA":
          this._moveLeft = !0;
          break;
        case "ArrowDown":
        case "KeyS":
          this._moveBackward = !0;
          break;
        case "ArrowRight":
        case "KeyD":
          this._moveRight = !0;
          break;
        case "Space":
          this._canJump && (this._velocity.y += 5e3), this._canJump = !1;
          break;
      }
    }, this._onKeyUp = (r) => {
      switch (r.code) {
        case "ArrowUp":
        case "KeyW":
          this._moveForward = !1;
          break;
        case "ArrowLeft":
        case "KeyA":
          this._moveLeft = !1;
          break;
        case "ArrowDown":
        case "KeyS":
          this._moveBackward = !1;
          break;
        case "ArrowRight":
        case "KeyD":
          this._moveRight = !1;
          break;
      }
    }, this.controls = this.createControls(this.camera, this.renderer.domElement);
  }
  /** 获取是否自动前进 */
  get autoForward() {
    return this._autoForward;
  }
  /** 设置是否自动前进 */
  set autoForward(e) {
    this._moveForward = e, this._autoForward = e;
  }
  /**
   * 创建指针锁定控制器并注册键盘事件
   */
  createControls(e, i) {
    const r = new nr(e, i);
    return r.maxPolarAngle = Math.PI - 0.5, document.addEventListener("keydown", this._onKeyDown), document.addEventListener("keyup", this._onKeyUp), r;
  }
  /** 清理资源，移除键盘事件监听 */
  dispose() {
    document.removeEventListener("keydown", this._onKeyDown), document.removeEventListener("keyup", this._onKeyUp), this.controls.dispose();
  }
  /**
   * 更新控制器状态，处理键盘输入和物理运动
   */
  update() {
    const e = performance.now(), i = this.controls;
    if (i.isLocked) {
      this._moveForward || (this._moveForward = this.autoForward);
      const r = (e - this._prevTime) / 500;
      this._velocity.x -= this._velocity.x * 10 * r, this._velocity.z -= this._velocity.z * 10 * r, this._velocity.y -= 9.8 * 1e3 * r, this._direction.z = Number(this._moveForward) - Number(this._moveBackward), this._direction.x = Number(this._moveRight) - Number(this._moveLeft), this._direction.normalize(), (this._moveForward || this._moveBackward) && (this._velocity.z -= this._direction.z * this.cameraHeight * 5 * r), (this._moveLeft || this._moveRight) && (this._velocity.x -= this._direction.x * this.cameraHeight * 5 * r), i.moveRight(-this._velocity.x * r), i.moveForward(-this._velocity.z * r), i.object.position.y += this._velocity.y * r, i.object.position.y < this.cameraHeight && (this._velocity.y = 0, i.object.position.y = this.cameraHeight, this._canJump = !0);
    }
    this._prevTime = e, super.update();
  }
}
const hr = { type: "change" }, Gt = 1e-6, Kt = new st();
class lr extends Tt {
  /**
   * Constructs a new controls instance.
   *
   * @param {Object3D} object - The object that is managed by the controls.
   * @param {?HTMLElement} domElement - The HTML element used for event listeners.
   */
  constructor(e, i = null) {
    super(e, i), this.movementSpeed = 1, this.rollSpeed = 5e-3, this.dragToLook = !1, this.autoForward = !1, this._moveState = { up: 0, down: 0, left: 0, right: 0, forward: 0, back: 0, pitchUp: 0, pitchDown: 0, yawLeft: 0, yawRight: 0, rollLeft: 0, rollRight: 0 }, this._moveVector = new ce(0, 0, 0), this._rotationVector = new ce(0, 0, 0), this._lastQuaternion = new st(), this._lastPosition = new ce(), this._status = 0, this._onKeyDown = cr.bind(this), this._onKeyUp = ur.bind(this), this._onPointerMove = fr.bind(this), this._onPointerDown = dr.bind(this), this._onPointerUp = pr.bind(this), this._onPointerCancel = vr.bind(this), this._onContextMenu = _r.bind(this), i !== null && this.connect(i);
  }
  connect(e) {
    super.connect(e), window.addEventListener("keydown", this._onKeyDown), window.addEventListener("keyup", this._onKeyUp), this.domElement.addEventListener("pointermove", this._onPointerMove), this.domElement.addEventListener("pointerdown", this._onPointerDown), this.domElement.addEventListener("pointerup", this._onPointerUp), this.domElement.addEventListener("pointercancel", this._onPointerCancel), this.domElement.addEventListener("contextmenu", this._onContextMenu);
  }
  disconnect() {
    window.removeEventListener("keydown", this._onKeyDown), window.removeEventListener("keyup", this._onKeyUp), this.domElement.removeEventListener("pointermove", this._onPointerMove), this.domElement.removeEventListener("pointerdown", this._onPointerDown), this.domElement.removeEventListener("pointerup", this._onPointerUp), this.domElement.removeEventListener("pointercancel", this._onPointerCancel), this.domElement.removeEventListener("contextmenu", this._onContextMenu);
  }
  dispose() {
    this.disconnect();
  }
  update(e) {
    if (this.enabled === !1) return;
    const i = this.object, r = e * this.movementSpeed, n = e * this.rollSpeed;
    i.translateX(this._moveVector.x * r), i.translateY(this._moveVector.y * r), i.translateZ(this._moveVector.z * r), Kt.set(this._rotationVector.x * n, this._rotationVector.y * n, this._rotationVector.z * n, 1).normalize(), i.quaternion.multiply(Kt), (this._lastPosition.distanceToSquared(i.position) > Gt || 8 * (1 - this._lastQuaternion.dot(i.quaternion)) > Gt) && (this.dispatchEvent(hr), this._lastQuaternion.copy(i.quaternion), this._lastPosition.copy(i.position));
  }
  // private
  _updateMovementVector() {
    const e = this._moveState.forward || this.autoForward && !this._moveState.back ? 1 : 0;
    this._moveVector.x = -this._moveState.left + this._moveState.right, this._moveVector.y = -this._moveState.down + this._moveState.up, this._moveVector.z = -e + this._moveState.back;
  }
  _updateRotationVector() {
    this._rotationVector.x = -this._moveState.pitchDown + this._moveState.pitchUp, this._rotationVector.y = -this._moveState.yawRight + this._moveState.yawLeft, this._rotationVector.z = -this._moveState.rollRight + this._moveState.rollLeft;
  }
  _getContainerDimensions() {
    return this.domElement != document ? {
      size: [this.domElement.offsetWidth, this.domElement.offsetHeight],
      offset: [this.domElement.offsetLeft, this.domElement.offsetTop]
    } : {
      size: [window.innerWidth, window.innerHeight],
      offset: [0, 0]
    };
  }
}
function cr(t) {
  if (!(t.altKey || this.enabled === !1)) {
    switch (t.code) {
      case "ShiftLeft":
      case "ShiftRight":
        this.movementSpeedMultiplier = 0.1;
        break;
      case "KeyW":
        this._moveState.forward = 1;
        break;
      case "KeyS":
        this._moveState.back = 1;
        break;
      case "KeyA":
        this._moveState.left = 1;
        break;
      case "KeyD":
        this._moveState.right = 1;
        break;
      case "KeyR":
        this._moveState.up = 1;
        break;
      case "KeyF":
        this._moveState.down = 1;
        break;
      case "ArrowUp":
        this._moveState.pitchUp = 1;
        break;
      case "ArrowDown":
        this._moveState.pitchDown = 1;
        break;
      case "ArrowLeft":
        this._moveState.yawLeft = 1;
        break;
      case "ArrowRight":
        this._moveState.yawRight = 1;
        break;
      case "KeyQ":
        this._moveState.rollLeft = 1;
        break;
      case "KeyE":
        this._moveState.rollRight = 1;
        break;
    }
    this._updateMovementVector(), this._updateRotationVector();
  }
}
function ur(t) {
  if (this.enabled !== !1) {
    switch (t.code) {
      case "ShiftLeft":
      case "ShiftRight":
        this.movementSpeedMultiplier = 1;
        break;
      case "KeyW":
        this._moveState.forward = 0;
        break;
      case "KeyS":
        this._moveState.back = 0;
        break;
      case "KeyA":
        this._moveState.left = 0;
        break;
      case "KeyD":
        this._moveState.right = 0;
        break;
      case "KeyR":
        this._moveState.up = 0;
        break;
      case "KeyF":
        this._moveState.down = 0;
        break;
      case "ArrowUp":
        this._moveState.pitchUp = 0;
        break;
      case "ArrowDown":
        this._moveState.pitchDown = 0;
        break;
      case "ArrowLeft":
        this._moveState.yawLeft = 0;
        break;
      case "ArrowRight":
        this._moveState.yawRight = 0;
        break;
      case "KeyQ":
        this._moveState.rollLeft = 0;
        break;
      case "KeyE":
        this._moveState.rollRight = 0;
        break;
    }
    this._updateMovementVector(), this._updateRotationVector();
  }
}
function dr(t) {
  if (this.enabled !== !1)
    if (this.dragToLook)
      this._status++;
    else {
      switch (t.button) {
        case 0:
          this._moveState.forward = 1;
          break;
        case 2:
          this._moveState.back = 1;
          break;
      }
      this._updateMovementVector();
    }
}
function fr(t) {
  if (this.enabled !== !1 && (!this.dragToLook || this._status > 0)) {
    const e = this._getContainerDimensions(), i = e.size[0] / 2, r = e.size[1] / 2;
    this._moveState.yawLeft = -(t.pageX - e.offset[0] - i) / i, this._moveState.pitchDown = (t.pageY - e.offset[1] - r) / r, this._updateRotationVector();
  }
}
function pr(t) {
  if (this.enabled !== !1) {
    if (this.dragToLook)
      this._status--, this._moveState.yawLeft = this._moveState.pitchDown = 0;
    else {
      switch (t.button) {
        case 0:
          this._moveState.forward = 0;
          break;
        case 2:
          this._moveState.back = 0;
          break;
      }
      this._updateMovementVector();
    }
    this._updateRotationVector();
  }
}
function vr() {
  this.enabled !== !1 && (this.dragToLook ? (this._status = 0, this._moveState.yawLeft = this._moveState.pitchDown = 0) : (this._moveState.forward = 0, this._moveState.back = 0, this._updateMovementVector()), this._updateRotationVector());
}
function _r(t) {
  this.enabled !== !1 && t.preventDefault();
}
class An extends Ct {
  /** 获取是否自动前进 */
  get autoForward() {
    return this.controls.autoForward;
  }
  /** 设置是否自动前进 */
  set autoForward(e) {
    this.controls.autoForward = e;
  }
  /**
   * 构造函数
   * @param container 容器元素或 CSS 选择器
   * @param options 视图选项
   */
  constructor(e, i = {}) {
    super(e, i), this.controls = this._createControls();
  }
  /**
   * 创建飞行控制器
   * @returns 飞行控制器
   */
  _createControls() {
    const e = new lr(this.camera, this.renderer.domElement);
    return e.autoForward = !1, e.movementSpeed = 2e3, e.rollSpeed = 0.05, e;
  }
  /**
   * 清理资源
   */
  dispose() {
    this.controls.dispose(), super.dispose();
  }
  /**
   * Three.js 动画循环
   */
  animate() {
    super.animate(), this.controls.update(this.timer.getDelta());
  }
}
const mr = `<style>
	#tt-compass {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		border: 1px solid #fffc;
		filter: drop-shadow(0px 0px 2px black);
		background-color: #0005;
		cursor: pointer;
	}
	#tt-compass > .tt-circle {
		width: 60%;
		height: 60%;
		text-align: center;
		border-radius: 50%;
		border: 1px solid #fffc;
		background-color: #fff4;
		display: flex;
		justify-content: center;
	}

	#tt-compass:hover > .tt-circle {
		background-color: #0f05;
	}

	#tt-compass:active .tt-circle {
		background-color: #000;
	}

	#tt-compass > #tt-compass-text {
		position: absolute;
		top: 0px;
		left: 0px;
		width: 100%;
		height: 100%;
		display: grid;
		align-items: center;
		justify-items: center;
		grid-template-columns: 18% auto 18%;
		grid-template-rows: 18% auto 18%;
		text-shadow: 0px 0px 2px black;
		font-size: 10px;
	}

	#tt-compass > .tt-circle > #tt-compass-plane {
		height: 90%;
		width: 90%;
		fill: #fffc;
		filter: drop-shadow(5px 5px 5px black);
	}
</style>

<div id="tt-compass">
	<div class="tt-circle">
		<svg
			id="tt-compass-plane"
			viewBox="0 0 1024 1024"
			version="1.1"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M479.075523 711.254681c0 70.2291 0.083871 114.20878 0.218064 140.734974l-148.360914 106.16768 0 65.842665c0 0 137.164181-31.552144 156.372659-56.247861 19.212672-24.685233 1.369189 45.264997 24.691523 45.264997 23.324432 0 5.476754-69.95023 24.695717-45.264997 19.206382 24.695717 156.372659 56.247861 156.372659 56.247861l0-65.842665-148.375592-106.16768c0.14258-26.526194 0.226451-70.505874 0.226451-140.734974 0-283.942036 460.894459 0 460.894459 0l0-79.555518-115.225712-85.227272 0-65.662343c0-9.083193-13.343823-16.461715-24.685233-16.461715-11.351894 0-24.695717 7.378522-24.695717 16.461715l0 29.119895-85.724206-63.422996c0-178.315322-28.115543-160.490709-28.115543-160.490709s-21.938469 15.094623-24.685233 100.128992c-1.645962 51.108686-52.339488 15.51817-92.547084-21.017988l-22.569596-104.490267-26.182325-14.138497c0-35.590516 0-81.312609 0-129.18179C561.379902 13.064953 511.307019 0 511.307019 0s-48.693211 13.054469-48.693211 117.311994c0 47.240151 0 92.396117 0 127.766473l-28.803283 14.329303-23.194432 106.176067 0.016774 0c3.310794-1.945799 6.558686-4.151598 9.735287-6.470622-3.159827 2.966925-6.407719 5.938043-9.735287 8.919645-39.630985 35.456323-87.693069 67.884915-89.311773 18.12445-2.748861-85.051143-24.691523-100.128992-24.691523-100.128992s-28.115543-17.824613-28.115543 160.490709l-85.724206 63.406222 0-29.119895c0-9.083193-13.335436-16.461715-24.691523-16.461715s-24.691523 7.378522-24.691523 16.461715l0 65.662343L18.187353 631.697066l0 79.555518C18.187353 711.254681 479.075523 427.310549 479.075523 711.254681z"
			></path>
		</svg>
	</div>
	<div id="tt-compass-text">
		<span></span> <span>N</span><span></span> <span>W</span><span></span><span>E</span> <span></span><span>S</span
		><span></span>
	</div>
</div>
`;
class gr {
  /**
   * 构造函数
   * @param controls 地图控制器
   */
  constructor(e) {
    this.dom = document.createElement("div"), this.controls = e, this.dom.innerHTML = mr, this.dom.style.width = "100%", this.dom.style.height = "100%", this.plane = this.dom.querySelector("#tt-compass-plane"), this.text = this.dom.querySelector("#tt-compass-text"), this._onChange = () => {
      this.plane && this.text && (this.plane.style.transform = `rotateX(${e.getPolarAngle()}rad)`, this.text.style.transform = `rotate(${e.getAzimuthalAngle()}rad)`);
    }, e.addEventListener("change", this._onChange), this.dom.onclick = () => open("https://github.com/sxguojf/three-tile");
  }
  /**
   * 释放资源，移除控制器事件监听
   */
  dispose() {
    this.controls.removeEventListener("change", this._onChange);
  }
}
function In(t) {
  return new gr(t);
}
class On extends pe {
  constructor(e) {
    super(e), this.token = "", this.format = "webp", this.style = "mapbox.satellite", this.attribution = "MapBox © MapBox, © OpenStreetMap contributors", this.maxLevel = 19, this.url = "https://api.mapbox.com/v4/{style}/{z}/{x}/{y}.{format}?access_token={token}", Object.assign(this, e);
  }
}
class Un extends pe {
  constructor(e) {
    super(e), this.attribution = "ArcGIS © Esri", this.style = "World_Imagery", this.url = "https://server.arcgisonline.com/arcgis/rest/services/{style}/MapServer/tile/{z}/{y}/{x}", Object.assign(this, e);
  }
}
class Rn extends pe {
  constructor(e) {
    super(e), this.dataType = "lerc", this.attribution = "ArcGIS © Esri", this.minLevel = 5, this.maxLevel = 13, this.url = "https://server.arcgisonline.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer/tile/{z}/{y}/{x}", Object.assign(this, e);
  }
}
class wr extends pe {
  constructor(e) {
    super(e), this.attribution = "Bing Maps © Microsoft [GS(2024)0999号]", this.style = "A", this.mkt = "zh-CN", this.subdomains = "1", this.url = "https://t{s}.dynamic.tiles.ditu.live.com/comp/ch/{key}?mkt={mkt}&ur=CN&it={style}&n=z&og=804&cstl=vb", this.maxLevel = 19, Object.assign(this, e);
  }
  /** 将瓦片坐标转为 Bing 的 QuadKey 编码后请求 URL */
  getUrl(e, i, r) {
    const n = yr(r, e, i);
    return super.getUrl(e, i, r, { key: n });
  }
}
class Bn extends wr {
  constructor() {
    super(...arguments), this.mkt = "zh-CN", this.attribution = "VirtualEarth © Microsoft", this.subdomains = "123", this.url = "https://ecn.t{s}.tiles.virtualearth.net/tiles/a{key}.jpeg?n=z&g=15384", this.maxLevel = 19;
  }
}
function yr(t, e, i) {
  let r = "";
  for (let n = t; n > 0; n--) {
    const o = 1 << n - 1;
    let s = 0;
    (e & o) !== 0 && s++, (i & o) !== 0 && (s += 2), r += s;
  }
  return r;
}
class jn extends pe {
  constructor(e) {
    super(e), this.attribution = "AMap © AutoNavi [GS(2025)5996号]", this.style = "8", this.scl = "2", this.subdomains = "1", this.maxLevel = 18, this.url = "https://webst0{s}.is.autonavi.com/appmaptile?style={style}&x={x}&y={y}&z={z}&scl={scl}", Object.assign(this, e);
  }
  /** 在标准模板基础上，当设了 ltype 时追加到 URL */
  getUrl(e, i, r) {
    const n = {};
    return this.ltype && (n.ltype = this.ltype), super.getUrl(e, i, r, n);
  }
}
class zn extends pe {
  constructor(e) {
    super(e), this.maxLevel = 16, this.attribution = "GeoQ © GeoQ [GS(2019)758号]", this.style = "ChinaOnlineStreetPurplishBlue", this.url = "https://map.geoq.cn/ArcGIS/rest/services/{style}/MapServer/tile/{z}/{y}/{x}", Object.assign(this, e);
  }
}
class Hn extends pe {
  constructor(e) {
    super(e), this.attribution = "Google Maps © Google", this.maxLevel = 21, this.style = "s", this.subdomains = "1", this.url = "https://gac-geo.googlecnapps.club/maps/vt?lyrs={style}&x={x}&y={y}&z={z}", Object.assign(this, e);
  }
}
class Nn extends pe {
  constructor(e) {
    super(e), this.attribution = "MapTiler © MapTiler, © OpenStreetMap contributors", this.token = "get_your_own_key_QmavnBrQwNGsQ8YvPzZg", this.format = "jpg", this.style = "satellite-v2", this.url = "https://api.maptiler.com/tiles/{style}/{z}/{x}/{y}.{format}?key={token}", Object.assign(this, e);
  }
}
class Vn extends pe {
  constructor(e) {
    super(e), this.attribution = "Stadia Maps © Stadia Maps, © OpenStreetMap contributors", this.url = "https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}.jpg", Object.assign(this, e);
  }
}
class Gn extends pe {
  constructor(e) {
    super(e), this.attribution = "Tianditu © NGCC [GS(2023)336号]", this.token = "", this.style = "img_w", this.subdomains = "0", this.url = "https://t{s}.tianditu.gov.cn/DataServer?T={style}&x={x}&y={y}&l={z}&tk={token}", Object.assign(this, e);
  }
}
class Kn extends pe {
  constructor(e) {
    super(e), this.dataType = "quantized-mesh", this.attribution = "Tianditu © NGCC [GS(2023)336号]", this.token = "", this.subdomains = "0", this.url = "https://t{s}.tianditu.gov.cn/mapservice/swdx?T=elv_c&tk={token}&x={x}&y={y}&l={z}", Object.assign(this, e);
  }
}
class Yn extends pe {
  constructor(e) {
    super(e), this.style = "sateTiles", this.attribution = "Tencent Map © Tencent [GS(2024)4454号]", this.subdomains = "0", this.maxLevel = 18, this.isTMS = !0, this.url = "https://p{s}.map.gtimg.com/{style}/{z}/{sx}/{sy}/{x}_{y}.jpg", Object.assign(this, e);
  }
  /**
   * 腾讯瓦片使用特有的目录结构：z/sx/sy/x_y.jpg
   * 其中 sx = floor(x / 16)，sy = floor((2^z - y) / 16)
   * @see https://blog.csdn.net/mygisforum/article/details/22997879
   */
  getUrl(e, i, r) {
    const n = e >> 4, o = (1 << r) - i >> 4;
    return super.getUrl(e, i, r, { sx: n, sy: o });
  }
}
class qn extends pe {
  constructor(e) {
    super(e), this.attribution = "GEOVIS © GEOVIS [GS(2022)3995号]", this.token = "", this.style = "img", this.format = "webp", this.subdomains = "1", this.url = "https://tiles{s}.geovisearth.com/base/v1/{style}/{z}/{x}/{y}?format={format}&tmsIds=w&token={token}", Object.assign(this, e);
  }
}
class Xn extends pe {
  constructor(e) {
    super(e), this.dataType = "quantized-mesh", this.attribution = "GEOVIS © GEOVIS [GS(2022)3995号]", this.token = "", this.subdomains = "1", this.url = "https://tiles{s}.geovisearth.com/base/v1/terrain/{z}/{x}/{y}.terrain&token={token}", Object.assign(this, e);
  }
}
class Wn extends pe {
  /**
   * 计算瓦片投影边界框并传入 URL 模板
   * WMS 服务需要通过 {bbox} 参数指定地理范围
   */
  getUrl(e, i, r) {
    const n = this.getBBox(e, i, r);
    return super.getUrl(e, i, r, { bbox: n });
  }
}
class Jn extends pe {
  constructor(e) {
    super(e), this.attribution = "Baidu Map © Baidu [GS(2021)6026号]", this.style = "pl", this.minLevel = 3, this.maxLevel = 18, this.subdomains = "0123", this.url = "http://online{s}.map.bdimg.com/onlinelabel/?qt=tile&x={baiduX}&y={baiduY}&z={z}&styles={style}&scaler=1&p=1", Object.assign(this, e);
  }
  /**
   * 将谷歌 XYZ 瓦片坐标转换为百度瓦片坐标
   * 百度瓦片坐标系以地图中心为原点，X 向右为正，Y 向上为正
   * 负数坐标使用 M 前缀（如 -1 → M1）
   * 转换公式：
   *   baiduX = x - 2^(z-1)
   *   baiduY = 2^(z-1) - y - 1
   */
  getUrl(e, i, r) {
    const n = Math.pow(2, r - 1), o = e - n, s = n - i - 1, a = o < 0 ? "M" + -o : String(o), h = s < 0 ? "M" + -s : String(s);
    return super.getUrl(e, i, r, { baiduX: a, baiduY: h });
  }
}
class xr extends kt {
  /**
   * @param parameters.bkColor 背景颜色
   * @param parameters.airColor 大气颜色
   */
  constructor(e) {
    super({
      uniforms: {
        bkColor: {
          value: e.bkColor
        },
        airColor: {
          value: e.airColor
        }
      },
      transparent: !0,
      depthTest: !1,
      lights: !1,
      vertexShader: (
        /* glsl */
        `
                varying vec2 vUv;

                void main() {  
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);  
                }  
            `
      ),
      fragmentShader: (
        /* glsl */
        `
                varying vec2 vUv;
                uniform vec3 bkColor;
                uniform vec3 airColor;
            
                void main() {   
                    // 计算当前 uv 到中心 (0.5, 0.5) 的距离，平方放大以产生锐利边缘
                    float d = distance(vUv, vec2(0.5));
                    d = d * d * 100.0;

                    if (d < 0.86) {
                        // 球体内部：从透明到不透明的渐变遮罩
                        float a = smoothstep(0.0, 1.0, d);
                        gl_FragColor = vec4(vec3(0.0), a);
                    } else if (d <= 0.98) {
                        // 内发光：球体边缘向内的大气辉光
                        float c = (d - 0.86) / (0.98 - 0.86);
                        gl_FragColor = vec4(mix(vec3(0.0), airColor, pow(c, 8.0)), 1.0);
                    } else if (d <= 1.0) {
                        // 白边：大气层外缘的高亮边界
                        float c = (d - 0.98) / (1.0 - 0.98);
                        gl_FragColor = vec4(mix(airColor, vec3(0.6), pow(c, 2.0)), 1.0);
                    } else if (d <= 1.5) {
                        // 外泛光：向外扩散的大气辉光，逐渐融入背景
                        float c = (d - 1.0) / (1.5 - 1.0);
                        gl_FragColor = vec4(mix(airColor, bkColor, pow(c, 0.04)), 1.0);
                    } else {
                        // 背景色
                        gl_FragColor = vec4(bkColor, 1.0);
                    }
            
                    #include <colorspace_fragment>
                    
                }  
            `
      )
    });
  }
}
class br extends yt {
  /**
   * 背景颜色
   */
  get bkColor() {
    return this.material.uniforms.bkColor.value;
  }
  set bkColor(e) {
    this.material.uniforms.bkColor.value.set(e);
  }
  /**
   * @param bkColor 背景色
   * @param airColor 大气颜色，默认 0x6699cc
   */
  constructor(e, i = new ke(6724044)) {
    super(new Ei(5, 5), new xr({ bkColor: e, airColor: i })), this.renderOrder = 999;
  }
}
function $n(t, e = 14414079, i = 6724044) {
  return Mr(t, e, i);
}
function Mr(t, e = 14414079, i = 6724044) {
  const r = new br(new ke(e), new ke(i));
  return r.name = "fakeearth", r.applyMatrix4(t.rootTile.matrix), r;
}
class Sr extends Pt {
  constructor(e, i) {
    super(i), this._factor = 1, this._controls = e, e.addEventListener("change", this.onChange.bind(this));
  }
  get factor() {
    return this._factor;
  }
  set factor(e) {
    this._factor = e, this.onChange();
  }
  onChange() {
    const e = this._controls, i = Math.max(e.getPolarAngle(), 0.1), r = Math.max(e.getDistance(), 0.1);
    this.density = i / (r + 5) * this.factor * 0.25;
  }
}
function Zn(t, e = 14414079) {
  return new Sr(t, e);
}
const Er = new ce(), Xe = new ce(), Yt = new Pi();
function Qn(t, e, i = 10) {
  if (e.updateMatrixWorld(), e.position.y > 1e4)
    return !1;
  let r = !1;
  const n = 2 * e.near * Math.tan(Be.degToRad(e.fov) / 2);
  Xe.set(0, -n / 2, -e.near - n / 10), Xe.applyMatrix4(e.matrixWorld);
  const o = t.getLocalInfoFromWorld(Xe);
  if (o) {
    const s = i - (Xe.y - o.point.y);
    s > 0 && (e.position.y += s + 0.01, r = !0);
  }
  if (t.debug > 0) {
    let s = t.getObjectByName("checkPoint");
    s || (s = new yt(
      new Ti(1),
      new Di({ color: 65280 })
    ), s.name = "checkPoint", t.add(s)), s.position.copy(t.worldToLocal(Xe)), s.scale.setScalar(n / 50), s instanceof yt && s.material.color.set(r ? 15732480 : 65280);
  }
  return r;
}
function es(t, e, i, r = {
  factor: 1,
  minSpeed: 0.1,
  maxSpeed: 10
}) {
  const { factor: n = 1, minSpeed: o = 0.1, maxSpeed: s = 10 } = r;
  Yt.set(e.position, e.getWorldDirection(Er));
  const a = Yt.intersectObject(t, !0);
  if (a.length > 0) {
    const h = Math.log(a[0].distance / 1e3 + 1) / 2 * n;
    i.zoomSpeed = Be.clamp(h, o, s);
  }
}
class ts extends oi {
  constructor() {
    super(...arguments), this.info = {
      version: Ie,
      description: "Tile debug image loader. It will draw a rectangle and coordinate on the tile."
    }, this.dataType = "debug";
  }
  /**
   * 在瓦片 canvas 上绘制调试信息
   *
   * 绘制内容包括：
   * - 边框矩形
   * - 层级（z）和瓦片坐标（x, y）
   * - 瓦片范围（bounds）
   * - 经纬度范围（lonLatBounds，如有）
   *
   * @param ctx - 瓦片 canvas 上下文
   * @param params - 瓦片加载参数
   */
  drawTile(e, i) {
    const { x: r, y: n, z: o, bounds: s, lonLatBounds: a } = i, h = e.canvas.width, l = e.canvas.height, w = h / 2;
    e.strokeStyle = "#ccc", e.lineWidth = 4, e.strokeRect(5, 5, h - 10, l - 10), e.fillStyle = "white", e.shadowColor = "black", e.shadowBlur = 5, e.shadowOffsetX = 1, e.shadowOffsetY = 1, e.font = "bold 20px arial", e.textAlign = "center", e.fillText(`Level: ${o}`, w, 50), e.fillText(`[${r}, ${n}]`, w, 80), e.font = "14px arial", e.shadowBlur = 0, e.fillText(`[${s[0].toFixed(3)}, ${s[1].toFixed(3)}]`, w, l - 50), e.fillText(`[${s[2].toFixed(3)}, ${s[3].toFixed(3)}]`, w, l - 30), a && (e.fillText(`[${a[0].toFixed(3)}, ${a[1].toFixed(3)}]`, w, l - 120), e.fillText(`[${a[2].toFixed(3)}, ${a[3].toFixed(3)}]`, w, l - 100));
  }
}
class is extends oi {
  constructor() {
    super(...arguments), this.info = {
      version: Ie,
      description: "Tile logo loader that renders attribution text on each tile."
    }, this.dataType = "logo";
  }
  /**
   * 在瓦片 Canvas 上绘制 attribution 文字
   * @param ctx 瓦片 Canvas 上下文
   * @param params 瓦片加载参数（包含 source.attribution）
   */
  drawTile(e, i) {
    e.fillStyle = "white", e.shadowColor = "black", e.shadowBlur = 5, e.shadowOffsetX = 1, e.shadowOffsetY = 1, e.font = "bold 14px arial, sans-serif", e.textAlign = "center", e.translate(e.canvas.width / 2, e.canvas.height / 2), e.rotate(-Math.PI / 4), e.fillText(i.source.attribution || "", 0, 0);
  }
}
class rs extends He {
  constructor() {
    super(), this.dataType = "normal", this.info = {
      version: Ie,
      description: "Tile normal loader that renders tiles with MeshNormalMaterial for debugging geometry."
    }, this.material = new ki();
  }
}
class ns extends He {
  constructor(e) {
    super(), this.info = {
      version: Ie,
      description: "Tile wireframe material loader. Render tiles with wireframe for debugging geometry."
    }, this.dataType = "wireframe", this.material = new ni({
      wireframe: !0,
      color: e,
      // 关闭深度测试，确保线框始终可见
      depthTest: !1
    });
  }
}
class ss {
  constructor() {
    this.info = {
      version: Ie,
      description: "Single image loader. Load a single image, crop to tile bounds, and stick to the ground."
    }, this.dataType = "single-image", this._imageLoader = new Li(at.manager);
  }
  /**
   * 加载材质
   * @param params 加载参数（数据源、瓦片边界、缩放级别）
   * @returns 材质
   */
  async load(e) {
    const { source: i, bounds: r, z: n } = e, o = new Ui({
      transparent: !0,
      opacity: i.opacity
    }), s = (h) => {
      h.target.map?.dispose(), o.removeEventListener("dispose", s);
    };
    o.addEventListener("dispose", s);
    const a = i.getUrl(0, 0, 0);
    if (n < i.minLevel || n > i.maxLevel || !a)
      return o;
    if (i.image?.complete)
      return this._setTexture(o, i.image, i, r), o;
    i._loadingPromise || (i._loadingPromise = this._imageLoader.loadAsync(a));
    try {
      i.image = await i._loadingPromise;
    } catch (h) {
      throw i._loadingPromise = void 0, h;
    }
    return this._setTexture(o, i.image, i, r), o;
  }
  /**
   * 设置材质纹理
   * @param material 瓦片材质
   * @param image 源图片
   * @param source 数据源（用于获取投影范围）
   * @param tileBounds 当前瓦片投影范围
   */
  _setTexture(e, i, r, n) {
    const o = this._getTileTexture(i, r._projectionBounds, n);
    e.map = o, o.needsUpdate = !0;
  }
  /**
   * 从源图片中裁剪出瓦片对应区域的纹理
   * @param image 源图片
   * @param mapBounds 整张图片覆盖的投影范围
   * @param tileBounds 当前瓦片投影范围
   * @returns 裁剪后的纹理
   */
  _getTileTexture(e, i, r) {
    const o = new OffscreenCanvas(256, 256);
    if (e) {
      const a = o.getContext("2d"), h = e.width, l = e.height, w = (i[2] - i[0]) / h, d = (i[3] - i[1]) / l, u = (r[0] - i[0]) / w, y = (i[3] - r[3]) / d, C = (r[2] - r[0]) / w, m = (r[3] - r[1]) / d;
      a.drawImage(e, u, y, C, m, 0, 0, 256, 256);
    }
    const s = new Fi(o);
    return s.colorSpace = Ci, s;
  }
}
class os extends pe {
  constructor() {
    super(...arguments), this.dataType = "single-image";
  }
}
function Pr(t, e, i, r = 64, n = 64) {
  const [o, s, a, h] = e, [l, w, d, u] = i, y = t.width / (a - o), C = t.height / (h - s), m = (l - o) * y, c = (h - u) * C, f = (d - o + 1) * y, _ = (h - w + 1) * C;
  return Tr(t.dem, t.width, t.height, [m, c, f, _], r, n, 0);
}
function Tr(t, e, i, r, n, o, s = 0) {
  if (t.length !== e * i)
    throw new Error("Buffer size does not match width and height");
  const [a, h, l, w] = r, d = Math.min(a, l), u = Math.max(a, l), y = Math.min(h, w), C = Math.max(h, w), m = new Float32Array(n * o), c = (u - d) / n, f = (C - y) / o;
  for (let _ = 0; _ < o; _++)
    for (let D = 0; D < n; D++) {
      const M = d + D * c, v = y + _ * f, p = _ * n + D;
      if (M < 0 || M >= e || v < 0 || v >= i) {
        m[p] = s;
        continue;
      }
      const g = Math.floor(M), b = Math.floor(v), x = Math.min(g + 1, e - 1), T = Math.min(b + 1, i - 1);
      if (!(M >= d && M <= u && v >= y && v <= C)) {
        m[p] = t[b * e + g];
        continue;
      }
      const U = M - g, P = v - b, k = t[b * e + g], A = t[T * e + g], z = t[b * e + x], N = t[T * e + x], H = k * (1 - U) * (1 - P) + z * U * (1 - P) + A * (1 - U) * P + N * U * P;
      console.assert(!isNaN(H)), m[p] = H;
    }
  return m;
}
var F = {};
(function() {
  var t = (function() {
    function n(o) {
      this.message = "JPEG error: " + o;
    }
    return n.prototype = new Error(), n.prototype.name = "JpegError", n.constructor = n, n;
  })(), e = (function() {
    var n = new Uint8Array([0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63]), o = 4017, s = 799, a = 3406, h = 2276, l = 1567, w = 3784, d = 5793, u = 2896;
    function y(M) {
      M == null && (M = {}), M.w == null && (M.w = -1), this.V = M.n, this.N = M.w;
    }
    function C(M, v) {
      for (var p = 0, g = [], b, x, T = 16, U; T > 0 && !M[T - 1]; )
        T--;
      g.push({ children: [], index: 0 });
      var P = g[0];
      for (b = 0; b < T; b++) {
        for (x = 0; x < M[b]; x++) {
          for (P = g.pop(), P.children[P.index] = v[p]; P.index > 0; )
            P = g.pop();
          for (P.index++, g.push(P); g.length <= b; )
            g.push(U = { children: [], index: 0 }), P.children[P.index] = U.children, P = U;
          p++;
        }
        b + 1 < T && (g.push(U = { children: [], index: 0 }), P.children[P.index] = U.children, P = U);
      }
      return g[0].children;
    }
    function m(M, v, p) {
      return 64 * ((M.P + 1) * v + p);
    }
    function c(M, v, p, g, b, x, T, U, P, k) {
      k == null && (k = !1);
      var A = p.m, z = p.Z, N = v, H = 0, S = 0, L = 0, E = 0, I, O = 0, V, G, j, B, R, K, ie = 0, Y, Q, te, Z;
      function $() {
        if (S > 0)
          return S--, H >> S & 1;
        if (H = M[v++], H === 255) {
          var W = M[v++];
          if (W) {
            if (W === 220 && k) {
              v += 2;
              var re = i(M, v);
              if (v += 2, re > 0 && re !== p.s)
                throw new DNLMarkerError("Found DNL marker (0xFFDC) while parsing scan data", re);
            } else if (W === 217) {
              if (k) {
                var se = O * 8;
                if (se > 0 && se < p.s / 10)
                  throw new DNLMarkerError("Found EOI marker (0xFFD9) while parsing scan data, possibly caused by incorrect `scanLines` parameter", se);
              }
              throw new EOIMarkerError("Found EOI marker (0xFFD9) while parsing scan data");
            }
            throw new t("unexpected marker");
          }
        }
        return S = 7, H >>> 7;
      }
      function J(W) {
        for (var re = W; ; ) {
          switch (re = re[$()], typeof re) {
            case "number":
              return re;
            case "object":
              continue;
          }
          throw new t("invalid huffman sequence");
        }
      }
      function q(W) {
        for (var re = 0; W > 0; )
          re = re << 1 | $(), W--;
        return re;
      }
      function X(W) {
        if (W === 1)
          return $() === 1 ? 1 : -1;
        var re = q(W);
        return re >= 1 << W - 1 ? re : re + (-1 << W) + 1;
      }
      function ae(W, re) {
        var se = J(W.J), ge = se === 0 ? 0 : X(se), he = 1;
        for (W.D[re] = W.Q += ge; he < 64; ) {
          var le = J(W.i), ue = le & 15, ee = le >> 4;
          if (ue === 0) {
            if (ee < 15)
              break;
            he += 16;
            continue;
          }
          he += ee;
          var we = n[he];
          W.D[re + we] = X(ue), he++;
        }
      }
      function de(W, re) {
        var se = J(W.J), ge = se === 0 ? 0 : X(se) << P;
        W.D[re] = W.Q += ge;
      }
      function ve(W, re) {
        W.D[re] |= $() << P;
      }
      function Me(W, re) {
        if (L > 0) {
          L--;
          return;
        }
        for (var se = x, ge = T; se <= ge; ) {
          var he = J(W.i), le = he & 15, ue = he >> 4;
          if (le === 0) {
            if (ue < 15) {
              L = q(ue) + (1 << ue) - 1;
              break;
            }
            se += 16;
            continue;
          }
          se += ue;
          var ee = n[se];
          W.D[re + ee] = X(le) * (1 << P), se++;
        }
      }
      function ne(W, re) {
        for (var se = x, ge = T, he = 0, le, ue; se <= ge; ) {
          var ee = re + n[se], we = W.D[ee] < 0 ? -1 : 1;
          switch (E) {
            case 0:
              if (ue = J(W.i), le = ue & 15, he = ue >> 4, le === 0)
                he < 15 ? (L = q(he) + (1 << he), E = 4) : (he = 16, E = 1);
              else {
                if (le !== 1)
                  throw new t("invalid ACn encoding");
                I = X(le), E = he ? 2 : 3;
              }
              continue;
            case 1:
            case 2:
              W.D[ee] ? W.D[ee] += we * ($() << P) : (he--, he === 0 && (E = E === 2 ? 3 : 0));
              break;
            case 3:
              W.D[ee] ? W.D[ee] += we * ($() << P) : (W.D[ee] = I << P, E = 0);
              break;
            case 4:
              W.D[ee] && (W.D[ee] += we * ($() << P));
              break;
          }
          se++;
        }
        E === 4 && (L--, L === 0 && (E = 0));
      }
      function fe(W, re, se, ge, he) {
        var le = se / A | 0, ue = se % A;
        O = le * W.A + ge;
        var ee = ue * W.h + he, we = m(W, O, ee);
        re(W, we);
      }
      function Te(W, re, se) {
        O = se / W.P | 0;
        var ge = se % W.P, he = m(W, O, ge);
        re(W, he);
      }
      var ye = g.length;
      for (z ? x === 0 ? K = U === 0 ? de : ve : K = U === 0 ? Me : ne : K = ae, ye === 1 ? Q = g[0].P * g[0].c : Q = A * p.R; ie <= Q; ) {
        var je = b ? Math.min(Q - ie, b) : Q;
        if (je > 0) {
          for (G = 0; G < ye; G++)
            g[G].Q = 0;
          if (L = 0, ye === 1)
            for (V = g[0], R = 0; R < je; R++)
              Te(V, K, ie), ie++;
          else
            for (R = 0; R < je; R++) {
              for (G = 0; G < ye; G++)
                for (V = g[G], te = V.h, Z = V.A, j = 0; j < Z; j++)
                  for (B = 0; B < te; B++)
                    fe(V, K, ie, j, B);
              ie++;
            }
        }
        if (S = 0, Y = D(M, v), !Y)
          break;
        if (Y.u && (v = Y.offset), Y.M >= 65488 && Y.M <= 65495)
          v += 2;
        else
          break;
      }
      return v - N;
    }
    function f(M, v, p) {
      var g = M.$, b = M.D, x, T, U, P, k, A, z, N, H, S, L, E, I, O, V, G, j;
      if (!g)
        throw new t("missing required Quantization Table.");
      for (var B = 0; B < 64; B += 8) {
        if (H = b[v + B], S = b[v + B + 1], L = b[v + B + 2], E = b[v + B + 3], I = b[v + B + 4], O = b[v + B + 5], V = b[v + B + 6], G = b[v + B + 7], H *= g[B], (S | L | E | I | O | V | G) === 0) {
          j = d * H + 512 >> 10, p[B] = j, p[B + 1] = j, p[B + 2] = j, p[B + 3] = j, p[B + 4] = j, p[B + 5] = j, p[B + 6] = j, p[B + 7] = j;
          continue;
        }
        S *= g[B + 1], L *= g[B + 2], E *= g[B + 3], I *= g[B + 4], O *= g[B + 5], V *= g[B + 6], G *= g[B + 7], x = d * H + 128 >> 8, T = d * I + 128 >> 8, U = L, P = V, k = u * (S - G) + 128 >> 8, N = u * (S + G) + 128 >> 8, A = E << 4, z = O << 4, x = x + T + 1 >> 1, T = x - T, j = U * w + P * l + 128 >> 8, U = U * l - P * w + 128 >> 8, P = j, k = k + z + 1 >> 1, z = k - z, N = N + A + 1 >> 1, A = N - A, x = x + P + 1 >> 1, P = x - P, T = T + U + 1 >> 1, U = T - U, j = k * h + N * a + 2048 >> 12, k = k * a - N * h + 2048 >> 12, N = j, j = A * s + z * o + 2048 >> 12, A = A * o - z * s + 2048 >> 12, z = j, p[B] = x + N, p[B + 7] = x - N, p[B + 1] = T + z, p[B + 6] = T - z, p[B + 2] = U + A, p[B + 5] = U - A, p[B + 3] = P + k, p[B + 4] = P - k;
      }
      for (var R = 0; R < 8; ++R) {
        if (H = p[R], S = p[R + 8], L = p[R + 16], E = p[R + 24], I = p[R + 32], O = p[R + 40], V = p[R + 48], G = p[R + 56], (S | L | E | I | O | V | G) === 0) {
          j = d * H + 8192 >> 14, j < -2040 ? j = 0 : j >= 2024 ? j = 255 : j = j + 2056 >> 4, b[v + R] = j, b[v + R + 8] = j, b[v + R + 16] = j, b[v + R + 24] = j, b[v + R + 32] = j, b[v + R + 40] = j, b[v + R + 48] = j, b[v + R + 56] = j;
          continue;
        }
        x = d * H + 2048 >> 12, T = d * I + 2048 >> 12, U = L, P = V, k = u * (S - G) + 2048 >> 12, N = u * (S + G) + 2048 >> 12, A = E, z = O, x = (x + T + 1 >> 1) + 4112, T = x - T, j = U * w + P * l + 2048 >> 12, U = U * l - P * w + 2048 >> 12, P = j, k = k + z + 1 >> 1, z = k - z, N = N + A + 1 >> 1, A = N - A, x = x + P + 1 >> 1, P = x - P, T = T + U + 1 >> 1, U = T - U, j = k * h + N * a + 2048 >> 12, k = k * a - N * h + 2048 >> 12, N = j, j = A * s + z * o + 2048 >> 12, A = A * o - z * s + 2048 >> 12, z = j, H = x + N, G = x - N, S = T + z, V = T - z, L = U + A, O = U - A, E = P + k, I = P - k, H < 16 ? H = 0 : H >= 4080 ? H = 255 : H >>= 4, S < 16 ? S = 0 : S >= 4080 ? S = 255 : S >>= 4, L < 16 ? L = 0 : L >= 4080 ? L = 255 : L >>= 4, E < 16 ? E = 0 : E >= 4080 ? E = 255 : E >>= 4, I < 16 ? I = 0 : I >= 4080 ? I = 255 : I >>= 4, O < 16 ? O = 0 : O >= 4080 ? O = 255 : O >>= 4, V < 16 ? V = 0 : V >= 4080 ? V = 255 : V >>= 4, G < 16 ? G = 0 : G >= 4080 ? G = 255 : G >>= 4, b[v + R] = H, b[v + R + 8] = S, b[v + R + 16] = L, b[v + R + 24] = E, b[v + R + 32] = I, b[v + R + 40] = O, b[v + R + 48] = V, b[v + R + 56] = G;
      }
    }
    function _(M, v) {
      for (var p = v.P, g = v.c, b = new Int16Array(64), x = 0; x < g; x++)
        for (var T = 0; T < p; T++) {
          var U = m(v, x, T);
          f(v, U, b);
        }
      return v.D;
    }
    function D(M, v, p) {
      p == null && (p = v);
      var g = M.length - 1, b = p < v ? p : v;
      if (v >= g)
        return null;
      var x = i(M, v);
      if (x >= 65472 && x <= 65534)
        return { u: null, M: x, offset: v };
      for (var T = i(M, b); !(T >= 65472 && T <= 65534); ) {
        if (++b >= g)
          return null;
        T = i(M, b);
      }
      return { u: x.toString(16), M: T, offset: b };
    }
    return y.prototype = { parse(M, v) {
      v == null && (v = {});
      var p = v.F, g = 0, b = null, x = null, T, U, P = 0;
      function k() {
        var ee = i(M, g);
        g += 2;
        var we = g + ee - 2, Oe = D(M, we, g);
        Oe && Oe.u && (we = Oe.offset);
        var De = M.subarray(g, we);
        return g += De.length, De;
      }
      function A(ee) {
        for (var we = Math.ceil(ee.o / 8 / ee.X), Oe = Math.ceil(ee.s / 8 / ee.B), De = 0; De < ee.W.length; De++) {
          ne = ee.W[De];
          var Ze = Math.ceil(Math.ceil(ee.o / 8) * ne.h / ee.X), ht = Math.ceil(Math.ceil(ee.s / 8) * ne.A / ee.B), lt = we * ne.h, ct = Oe * ne.A, ut = 64 * ct * (lt + 1);
          ne.D = new Int16Array(ut), ne.P = Ze, ne.c = ht;
        }
        ee.m = we, ee.R = Oe;
      }
      var z = [], N = [], H = [], S = i(M, g);
      if (g += 2, S !== 65496)
        throw new t("SOI not found");
      S = i(M, g), g += 2;
      e: for (; S !== 65497; ) {
        var L, E, I;
        switch (S) {
          case 65504:
          case 65505:
          case 65506:
          case 65507:
          case 65508:
          case 65509:
          case 65510:
          case 65511:
          case 65512:
          case 65513:
          case 65514:
          case 65515:
          case 65516:
          case 65517:
          case 65518:
          case 65519:
          case 65534:
            var O = k();
            S === 65504 && O[0] === 74 && O[1] === 70 && O[2] === 73 && O[3] === 70 && O[4] === 0 && (b = { version: { d: O[5], T: O[6] }, K: O[7], j: O[8] << 8 | O[9], H: O[10] << 8 | O[11], S: O[12], I: O[13], C: O.subarray(14, 14 + 3 * O[12] * O[13]) }), S === 65518 && O[0] === 65 && O[1] === 100 && O[2] === 111 && O[3] === 98 && O[4] === 101 && (x = { version: O[5] << 8 | O[6], k: O[7] << 8 | O[8], q: O[9] << 8 | O[10], a: O[11] });
            break;
          case 65499:
            var V = i(M, g), G;
            g += 2;
            for (var j = V + g - 2; g < j; ) {
              var B = M[g++], R = new Uint16Array(64);
              if (B >> 4 === 0)
                for (E = 0; E < 64; E++)
                  G = n[E], R[G] = M[g++];
              else if (B >> 4 === 1)
                for (E = 0; E < 64; E++)
                  G = n[E], R[G] = i(M, g), g += 2;
              else
                throw new t("DQT - invalid table spec");
              z[B & 15] = R;
            }
            break;
          case 65472:
          case 65473:
          case 65474:
            if (T)
              throw new t("Only single frame JPEGs supported");
            g += 2, T = {}, T.G = S === 65473, T.Z = S === 65474, T.precision = M[g++];
            var K = i(M, g), ie, Y = 0, Q = 0;
            g += 2, T.s = p || K, T.o = i(M, g), g += 2, T.W = [], T._ = {};
            var te = M[g++];
            for (L = 0; L < te; L++) {
              ie = M[g];
              var Z = M[g + 1] >> 4, $ = M[g + 1] & 15;
              Y < Z && (Y = Z), Q < $ && (Q = $);
              var J = M[g + 2];
              I = T.W.push({ h: Z, A: $, L: J, $: null }), T._[ie] = I - 1, g += 3;
            }
            T.X = Y, T.B = Q, A(T);
            break;
          case 65476:
            var q = i(M, g);
            for (g += 2, L = 2; L < q; ) {
              var X = M[g++], ae = new Uint8Array(16), de = 0;
              for (E = 0; E < 16; E++, g++)
                de += ae[E] = M[g];
              var ve = new Uint8Array(de);
              for (E = 0; E < de; E++, g++)
                ve[E] = M[g];
              L += 17 + de, (X >> 4 === 0 ? H : N)[X & 15] = C(ae, ve);
            }
            break;
          case 65501:
            g += 2, U = i(M, g), g += 2;
            break;
          case 65498:
            var Me = ++P === 1 && !p, ne;
            g += 2;
            var fe = M[g++], Te = [];
            for (L = 0; L < fe; L++) {
              var ye = M[g++], je = T._[ye];
              ne = T.W[je], ne.index = ye;
              var W = M[g++];
              ne.J = H[W >> 4], ne.i = N[W & 15], Te.push(ne);
            }
            var re = M[g++], se = M[g++], ge = M[g++];
            try {
              var he = c(M, g, T, Te, U, re, se, ge >> 4, ge & 15, Me);
              g += he;
            } catch (ee) {
              if (ee instanceof DNLMarkerError)
                return this.parse(M, { F: ee.s });
              if (ee instanceof EOIMarkerError)
                break e;
              throw ee;
            }
            break;
          case 65500:
            g += 4;
            break;
          case 65535:
            M[g] !== 255 && g--;
            break;
          default:
            var le = D(M, g - 2, g - 3);
            if (le && le.u) {
              g = le.offset;
              break;
            }
            if (g >= M.length - 1)
              break e;
            throw new t("JpegImage.parse - unknown marker: " + S.toString(16));
        }
        S = i(M, g), g += 2;
      }
      for (this.width = T.o, this.height = T.s, this.g = b, this.b = x, this.W = [], L = 0; L < T.W.length; L++) {
        ne = T.W[L];
        var ue = z[ne.L];
        ue && (ne.$ = ue), this.W.push({ index: ne.index, e: _(T, ne), l: ne.h / T.X, t: ne.A / T.B, P: ne.P, c: ne.c });
      }
      this.p = this.W.length;
    }, Y(M, v, p) {
      p == null && (p = !1);
      var g = this.width / M, b = this.height / v, x, T, U, P, k, A, z, N, H, S, L = 0, E, I = this.W.length, O = M * v * I, V = new Uint8ClampedArray(O), G = new Uint32Array(M), j = 4294967288, B;
      for (z = 0; z < I; z++) {
        if (x = this.W[z], T = x.l * g, U = x.t * b, L = z, E = x.e, P = x.P + 1 << 3, T !== B) {
          for (k = 0; k < M; k++)
            N = 0 | k * T, G[k] = (N & j) << 3 | N & 7;
          B = T;
        }
        for (A = 0; A < v; A++)
          for (N = 0 | A * U, S = P * (N & j) | (N & 7) << 3, k = 0; k < M; k++)
            V[L] = E[S + G[k]], L += I;
      }
      var R = this.V;
      if (!p && I === 4 && !R && (R = new Int32Array([-256, 255, -256, 255, -256, 255, -256, 255])), R)
        for (z = 0; z < O; )
          for (N = 0, H = 0; N < I; N++, z++, H += 2)
            V[z] = (V[z] * R[H] >> 8) + R[H + 1];
      return V;
    }, get f() {
      return this.b ? !!this.b.a : this.p === 3 ? this.N === 0 ? !1 : !(this.W[0].index === 82 && this.W[1].index === 71 && this.W[2].index === 66) : this.N === 1;
    }, z: function(v) {
      for (var p, g, b, x = 0, T = v.length; x < T; x += 3)
        p = v[x], g = v[x + 1], b = v[x + 2], v[x] = p - 179.456 + 1.402 * b, v[x + 1] = p + 135.459 - 0.344 * g - 0.714 * b, v[x + 2] = p - 226.816 + 1.772 * g;
      return v;
    }, O: function(v) {
      for (var p, g, b, x, T = 0, U = 0, P = v.length; U < P; U += 4)
        p = v[U], g = v[U + 1], b = v[U + 2], x = v[U + 3], v[T++] = -122.67195406894 + g * (-660635669420364e-19 * g + 437130475926232e-18 * b - 54080610064599e-18 * p + 48449797120281e-17 * x - 0.154362151871126) + b * (-957964378445773e-18 * b + 817076911346625e-18 * p - 0.00477271405408747 * x + 1.53380253221734) + p * (961250184130688e-18 * p - 0.00266257332283933 * x + 0.48357088451265) + x * (-336197177618394e-18 * x + 0.484791561490776), v[T++] = 107.268039397724 + g * (219927104525741e-19 * g - 640992018297945e-18 * b + 659397001245577e-18 * p + 426105652938837e-18 * x - 0.176491792462875) + b * (-778269941513683e-18 * b + 0.00130872261408275 * p + 770482631801132e-18 * x - 0.151051492775562) + p * (0.00126935368114843 * p - 0.00265090189010898 * x + 0.25802910206845) + x * (-318913117588328e-18 * x - 0.213742400323665), v[T++] = -20.810012546947 + g * (-570115196973677e-18 * g - 263409051004589e-19 * b + 0.0020741088115012 * p - 0.00288260236853442 * x + 0.814272968359295) + b * (-153496057440975e-19 * b - 132689043961446e-18 * p + 560833691242812e-18 * x - 0.195152027534049) + p * (0.00174418132927582 * p - 0.00255243321439347 * x + 0.116935020465145) + x * (-343531996510555e-18 * x + 0.24165260232407);
      return v.subarray(0, T);
    }, r: function(v) {
      for (var p, g, b, x = 0, T = v.length; x < T; x += 4)
        p = v[x], g = v[x + 1], b = v[x + 2], v[x] = 434.456 - p - 1.402 * b, v[x + 1] = 119.541 - p + 0.344 * g + 0.714 * b, v[x + 2] = 481.816 - p - 1.772 * g;
      return v;
    }, U: function(v) {
      for (var p, g, b, x, T = 0, U = 0, P = v.length; U < P; U += 4)
        p = v[U], g = v[U + 1], b = v[U + 2], x = v[U + 3], v[T++] = 255 + p * (-6747147073602441e-20 * p + 8379262121013727e-19 * g + 2894718188643294e-19 * b + 0.003264231057537806 * x - 1.1185611867203937) + g * (26374107616089405e-21 * g - 8626949158638572e-20 * b - 2748769067499491e-19 * x - 0.02155688794978967) + b * (-3878099212869363e-20 * b - 3267808279485286e-19 * x + 0.0686742238595345) - x * (3361971776183937e-19 * x + 0.7430659151342254), v[T++] = 255 + p * (13596372813588848e-20 * p + 924537132573585e-18 * g + 10567359618683593e-20 * b + 4791864687436512e-19 * x - 0.3109689587515875) + g * (-23545346108370344e-20 * g + 2702845253534714e-19 * b + 0.0020200308977307156 * x - 0.7488052167015494) + b * (6834815998235662e-20 * b + 15168452363460973e-20 * x - 0.09751927774728933) - x * (3189131175883281e-19 * x + 0.7364883807733168), v[T++] = 255 + p * (13598650411385307e-21 * p + 12423956175490851e-20 * g + 4751985097583589e-19 * b - 36729317476630422e-22 * x - 0.05562186980264034) + g * (16141380598724676e-20 * g + 9692239130725186e-19 * b + 7782692450036253e-19 * x - 0.44015232367526463) + b * (5068882914068769e-22 * b + 0.0017778369011375071 * x - 0.7591454649749609) - x * (3435319965105553e-19 * x + 0.7063770186160144);
      return v.subarray(0, T);
    }, getData: function(M) {
      var v = M.width, p = M.height, g = M.forceRGB, b = M.isSourcePDF;
      if (this.p > 4)
        throw new t("Unsupported color mode");
      var x = this.Y(v, p, b);
      if (this.p === 1 && g) {
        for (var T = x.length, U = new Uint8ClampedArray(T * 3), P = 0, k = 0; k < T; k++) {
          var A = x[k];
          U[P++] = A, U[P++] = A, U[P++] = A;
        }
        return U;
      } else {
        if (this.p === 3 && this.f)
          return this.z(x);
        if (this.p === 4) {
          if (this.f)
            return g ? this.O(x) : this.r(x);
          if (g)
            return this.U(x);
        }
      }
      return x;
    } }, y;
  })();
  function i(r, n) {
    return r[n] << 8 | r[n + 1];
  }
  F.JpegDecoder = e;
})();
F.encodeImage = function(t, e, i, r) {
  var n = {
    t256: [e],
    t257: [i],
    t258: [8, 8, 8, 8],
    t259: [1],
    t262: [2],
    t273: [1e3],
    // strips offset
    t277: [4],
    t278: [i],
    /* rows per strip */
    t279: [e * i * 4],
    // strip byte counts
    t282: [[72, 1]],
    t283: [[72, 1]],
    t284: [1],
    t286: [[0, 1]],
    t287: [[0, 1]],
    t296: [1],
    t305: ["Photopea (UTIF.js)"],
    t338: [1]
  };
  if (r) for (var o in r) n[o] = r[o];
  for (var s = new Uint8Array(F.encode([n])), a = new Uint8Array(t), h = new Uint8Array(1e3 + e * i * 4), o = 0; o < s.length; o++) h[o] = s[o];
  for (var o = 0; o < a.length; o++) h[1e3 + o] = a[o];
  return h.buffer;
};
F.encode = function(t) {
  var e = new Uint8Array(2e4), i = 4, r = F._binBE;
  e[0] = e[1] = 77, r.writeUshort(e, 2, 42);
  var n = 8;
  r.writeUint(e, i, n), i += 4;
  for (var o = 0; o < t.length; o++) {
    var s = F._writeIFD(r, F._types.basic, e, n, t[o]);
    n = s[1], o < t.length - 1 && ((n & 3) != 0 && (n += 4 - (n & 3)), r.writeUint(e, s[0], n));
  }
  return e.slice(0, n).buffer;
};
F.decode = function(t, e) {
  e == null && (e = { parseMN: !0, debug: !1 });
  var i = new Uint8Array(t), r = 0, n = F._binBE.readASCII(i, r, 2);
  r += 2;
  var o = n == "II" ? F._binLE : F._binBE;
  o.readUshort(i, r), r += 2;
  var s = o.readUint(i, r);
  r += 4;
  for (var a = []; ; ) {
    var h = o.readUshort(i, s), l = o.readUshort(i, s + 4);
    if (h != 0 && (l < 1 || 13 < l)) {
      log("error in TIFF");
      break;
    }
    if (F._readIFD(o, i, s, a, 0, e), s = o.readUint(i, s + 2 + h * 12), s == 0) break;
  }
  return a;
};
F.decodeImage = function(t, e, i) {
  if (!e.data) {
    var r = new Uint8Array(t), n = F._binBE.readASCII(r, 0, 2);
    if (e.t256 != null) {
      e.isLE = n == "II", e.width = e.t256[0], e.height = e.t257[0];
      var o = e.t259 ? e.t259[0] : 1, s = e.t266 ? e.t266[0] : 1;
      e.t284 && e.t284[0] == 2 && log("PlanarConfiguration 2 should not be used!"), o == 7 && e.t258 && e.t258.length > 3 && (e.t258 = e.t258.slice(0, 3));
      var a = e.t277 ? e.t277[0] : 1, h = e.t258 ? e.t258[0] : 1, l = h * a;
      o == 1 && e.t279 != null && e.t278 && e.t262[0] == 32803 && (l = Math.round(e.t279[0] * 8 / (e.width * e.t278[0]))), e.t50885 && e.t50885[0] == 4 && (l = e.t258[0] * 3);
      var w = Math.ceil(e.width * l / 8) * 8, d = e.t273;
      (d == null || e.t322) && (d = e.t324);
      var u = e.t279;
      o == 1 && d.length == 1 && (u = [e.height * (w >>> 3)]), (u == null || e.t322) && (u = e.t325);
      var y = new Uint8Array(e.height * (w >>> 3)), C = 0;
      if (e.t322 != null) {
        var m = e.t322[0], c = e.t323[0], f = Math.floor((e.width + m - 1) / m), _ = Math.floor((e.height + c - 1) / c), D = new Uint8Array(Math.ceil(m * c * l / 8) | 0);
        console.log("====", f, _);
        for (var M = 0; M < _; M++)
          for (var v = 0; v < f; v++) {
            var p = M * f + v;
            D.fill(0), F.decode._decompress(e, i, r, d[p], u[p], o, D, 0, s, m, c), o == 6 ? y = D : F._copyTile(D, Math.ceil(m * l / 8) | 0, c, y, Math.ceil(e.width * l / 8) | 0, e.height, Math.ceil(v * m * l / 8) | 0, M * c);
          }
        C = y.length * 8;
      } else {
        if (d == null) return;
        var g = e.t278 ? e.t278[0] : e.height;
        g = Math.min(g, e.height);
        for (var p = 0; p < d.length; p++)
          F.decode._decompress(e, i, r, d[p], u[p], o, y, Math.ceil(C / 8) | 0, s, e.width, g), C += w * g;
        C = Math.min(C, y.length * 8);
      }
      e.data = new Uint8Array(y.buffer, 0, Math.ceil(C / 8) | 0);
    }
  }
};
F.decode._decompress = function(t, e, i, r, n, o, s, a, h, l, w) {
  if (t.t271 && t.t271[0] == "Panasonic" && t.t45 && t.t45[0] == 6 && (o = 34316), o == 1) for (var d = 0; d < n; d++) s[a + d] = i[r + d];
  else if (o == 2) F.decode._decodeG2(i, r, n, s, a, l, h);
  else if (o == 3) F.decode._decodeG3(i, r, n, s, a, l, h, t.t292 ? (t.t292[0] & 1) == 1 : !1);
  else if (o == 4) F.decode._decodeG4(i, r, n, s, a, l, h);
  else if (o == 5) F.decode._decodeLZW(i, r, n, s, a, 8);
  else if (o == 6) F.decode._decodeOldJPEG(t, i, r, n, s, a);
  else if (o == 7 || o == 34892) F.decode._decodeNewJPEG(t, i, r, n, s, a);
  else if (o == 8 || o == 32946) {
    var u = new Uint8Array(i.buffer, r + 2, n - 6), y = F._inflateRaw(u);
    a + y.length <= s.length && s.set(y, a);
  } else o == 9 ? F.decode._decodeVC5(i, r, n, s, a, t.t33422) : o == 32767 ? F.decode._decodeARW(t, i, r, n, s, a) : o == 32773 ? F.decode._decodePackBits(i, r, n, s, a) : o == 32809 ? F.decode._decodeThunder(i, r, n, s, a) : o == 34316 ? F.decode._decodePanasonic(t, i, r, n, s, a) : o == 34713 ? F.decode._decodeNikon(t, e, i, r, n, s, a) : o == 34676 ? F.decode._decodeLogLuv32(t, i, r, n, s, a) : log("Unknown compression", o);
  var C = t.t258 ? Math.min(32, t.t258[0]) : 1, m = t.t277 ? t.t277[0] : 1, c = C * m >>> 3, f = Math.ceil(C * m * l / 8);
  if (C == 16 && !t.isLE && t.t33422 == null)
    for (var _ = 0; _ < w; _++)
      for (var D = a + _ * f, M = 1; M < f; M += 2) {
        var v = s[D + M];
        s[D + M] = s[D + M - 1], s[D + M - 1] = v;
      }
  if (t.t317 && t.t317[0] == 2)
    for (var _ = 0; _ < w; _++) {
      var p = a + _ * f;
      if (C == 16) for (var d = c; d < f; d += 2) {
        var g = (s[p + d + 1] << 8 | s[p + d]) + (s[p + d - c + 1] << 8 | s[p + d - c]);
        s[p + d] = g & 255, s[p + d + 1] = g >>> 8 & 255;
      }
      else if (m == 3) for (var d = 3; d < f; d += 3)
        s[p + d] = s[p + d] + s[p + d - 3] & 255, s[p + d + 1] = s[p + d + 1] + s[p + d - 2] & 255, s[p + d + 2] = s[p + d + 2] + s[p + d - 1] & 255;
      else for (var d = c; d < f; d++) s[p + d] = s[p + d] + s[p + d - c] & 255;
    }
};
F.decode._decodePanasonic = function(t, e, i, r, n, o) {
  var s = e.buffer, a = t.t2[0], h = t.t3[0], l = t.t10[0], w = t.t45[0], d = 0, u = 0, y = 0, C = 0, m = w == 6 ? new Uint32Array(18) : new Uint8Array(16), c, f, _, D = [0, 0], M = [0, 0], v, p = 0, g, b, x, T, U = new Uint8Array(16384), P = new Uint16Array(n.buffer);
  function k($) {
    if (y == 0) {
      var J = new Uint8Array(s, i + u + 8184, 8200), q = new Uint8Array(s, i + u, 8184);
      U.set(J), U.set(q, J.length), u += 16384;
    }
    if (w == 5)
      for (c = 0; c < 16; c++)
        m[c] = U[y++], y &= 16383;
    else
      return y = y - $ & 131071, C = y >> 3 ^ 16368, (U[C] | U[C + 1] << 8) >> (y & 7) & ~(-1 << $);
  }
  function A($) {
    return U[y + 15 - $];
  }
  function z() {
    m[0] = A(0) << 6 | A(1) >> 2, m[1] = ((A(1) & 3) << 12 | A(2) << 4 | A(3) >> 4) & 16383, m[2] = A(3) >> 2 & 3, m[3] = (A(3) & 3) << 8 | A(4), m[4] = A(5) << 2 | A(6) >> 6, m[5] = (A(6) & 63) << 4 | A(7) >> 4, m[6] = A(7) >> 2 & 3, m[7] = (A(7) & 3) << 8 | A(8), m[8] = A(9) << 2 & 1020 | A(10) >> 6, m[9] = (A(10) << 4 | A(11) >> 4) & 1023, m[10] = A(11) >> 2 & 3, m[11] = (A(11) & 3) << 8 | A(12), m[12] = (A(13) << 2 & 1020 | A(14) >> 6) & 1023, m[13] = (A(14) << 4 | A(15) >> 4) & 1023, y += 16, C = 0;
  }
  function N() {
    m[0] = A(0) << 4 | A(1) >> 4, m[1] = ((A(1) & 15) << 8 | A(2)) & 4095, m[2] = A(3) >> 6 & 3, m[3] = (A(3) & 63) << 2 | A(4) >> 6, m[4] = (A(4) & 63) << 2 | A(5) >> 6, m[5] = (A(5) & 63) << 2 | A(6) >> 6, m[6] = A(6) >> 4 & 3, m[7] = (A(6) & 15) << 4 | A(7) >> 4, m[8] = (A(7) & 15) << 4 | A(8) >> 4, m[9] = (A(8) & 15) << 4 | A(9) >> 4, m[10] = A(9) >> 2 & 3, m[11] = (A(9) & 3) << 6 | A(10) >> 2, m[12] = (A(10) & 3) << 6 | A(11) >> 2, m[13] = (A(11) & 3) << 6 | A(12) >> 2, m[14] = A(12) & 3, m[15] = A(13), m[16] = A(14), m[17] = A(15), y += 16, C = 0;
  }
  function H() {
    D[0] = 0, D[1] = 0, M[0] = 0, M[1] = 0;
  }
  if (w == 7)
    throw w;
  if (w == 6) {
    var S = l == 12, L = S ? N : z, E = S ? 14 : 11, I = S ? 128 : 512, O = S ? 2048 : 8192, V = S ? 16383 : 65535, G = S ? 4095 : 16383, j = a / E, B = j * 16, R = S ? 18 : 14;
    for (b = 0; b < h - 15; b += 16) {
      var K = Math.min(16, h - b), ie = B * K;
      for (U = new Uint8Array(s, i + d, ie), y = 0, d += ie, T = 0, x = 0; T < K; T++, x = 0) {
        p = (b + T) * a;
        for (var Y = 0; Y < j; Y++)
          for (L(), H(), _ = 0, g = 0, c = 0; c < E; c++) {
            if (v = c & 1, c % 3 == 2) {
              var Q = C < R ? m[C++] : 0;
              Q == 3 && (Q = 4), g = I << Q, _ = 1 << Q;
            }
            var te = C < R ? m[C++] : 0;
            D[v] ? (te *= _, g < O && M[v] > g && (te += M[v] - g), M[v] = te) : (D[v] = te, te ? M[v] = te : te = M[v]), P[p + x++] = te - 15 <= V ? te - 15 & V : te + 2147483633 >> 31 & G;
          }
      }
    }
  } else if (w == 5) {
    var Z = l == 12 ? 10 : 9;
    for (b = 0; b < h; b++)
      for (x = 0; x < a; x += Z)
        k(0), l == 12 ? (P[p++] = ((m[1] & 15) << 8) + m[0], P[p++] = 16 * m[2] + (m[1] >> 4), P[p++] = ((m[4] & 15) << 8) + m[3], P[p++] = 16 * m[5] + (m[4] >> 4), P[p++] = ((m[7] & 15) << 8) + m[6], P[p++] = 16 * m[8] + (m[7] >> 4), P[p++] = ((m[10] & 15) << 8) + m[9], P[p++] = 16 * m[11] + (m[10] >> 4), P[p++] = ((m[13] & 15) << 8) + m[12], P[p++] = 16 * m[14] + (m[13] >> 4)) : l == 14 && (P[p++] = m[0] + ((m[1] & 63) << 8), P[p++] = (m[1] >> 6) + 4 * m[2] + ((m[3] & 15) << 10), P[p++] = (m[3] >> 4) + 16 * m[4] + ((m[5] & 3) << 12), P[p++] = ((m[5] & 252) >> 2) + (m[6] << 6), P[p++] = m[7] + ((m[8] & 63) << 8), P[p++] = (m[8] >> 6) + 4 * m[9] + ((m[10] & 15) << 10), P[p++] = (m[10] >> 4) + 16 * m[11] + ((m[12] & 3) << 12), P[p++] = ((m[12] & 252) >> 2) + (m[13] << 6), P[p++] = m[14] + ((m[15] & 63) << 8));
  } else if (w == 4)
    for (b = 0; b < h; b++)
      for (x = 0; x < a; x++)
        c = x % 14, v = c & 1, c == 0 && H(), c % 3 == 2 && (_ = 4 >> 3 - k(2)), M[v] ? (f = k(8), f != 0 && (D[v] -= 128 << _, (D[v] < 0 || _ == 4) && (D[v] &= ~(-1 << _)), D[v] += f << _)) : (M[v] = k(8), (M[v] || c > 11) && (D[v] = M[v] << 4 | k(4))), P[p++] = D[x & 1];
  else throw w;
};
F.decode._decodeVC5 = (function() {
  var t = [1, 0, 1, 0, 2, 2, 1, 1, 3, 7, 1, 2, 5, 25, 1, 3, 6, 48, 1, 4, 6, 54, 1, 5, 7, 111, 1, 8, 7, 99, 1, 6, 7, 105, 12, 0, 7, 107, 1, 7, 8, 209, 20, 0, 8, 212, 1, 9, 8, 220, 1, 10, 9, 393, 1, 11, 9, 394, 32, 0, 9, 416, 1, 12, 9, 427, 1, 13, 10, 887, 1, 18, 10, 784, 1, 14, 10, 790, 1, 15, 10, 835, 60, 0, 10, 852, 1, 16, 10, 885, 1, 17, 11, 1571, 1, 19, 11, 1668, 1, 20, 11, 1669, 100, 0, 11, 1707, 1, 21, 11, 1772, 1, 22, 12, 3547, 1, 29, 12, 3164, 1, 24, 12, 3166, 1, 25, 12, 3140, 1, 23, 12, 3413, 1, 26, 12, 3537, 1, 27, 12, 3539, 1, 28, 13, 7093, 1, 35, 13, 6283, 1, 30, 13, 6331, 1, 31, 13, 6335, 180, 0, 13, 6824, 1, 32, 13, 7072, 1, 33, 13, 7077, 320, 0, 13, 7076, 1, 34, 14, 12565, 1, 36, 14, 12661, 1, 37, 14, 12669, 1, 38, 14, 13651, 1, 39, 14, 14184, 1, 40, 15, 28295, 1, 46, 15, 28371, 1, 47, 15, 25320, 1, 42, 15, 25336, 1, 43, 15, 25128, 1, 41, 15, 27300, 1, 44, 15, 28293, 1, 45, 16, 50259, 1, 48, 16, 50643, 1, 49, 16, 50675, 1, 50, 16, 56740, 1, 53, 16, 56584, 1, 51, 16, 56588, 1, 52, 17, 113483, 1, 61, 17, 113482, 1, 60, 17, 101285, 1, 55, 17, 101349, 1, 56, 17, 109205, 1, 57, 17, 109207, 1, 58, 17, 100516, 1, 54, 17, 113171, 1, 59, 18, 202568, 1, 62, 18, 202696, 1, 63, 18, 218408, 1, 64, 18, 218412, 1, 65, 18, 226340, 1, 66, 18, 226356, 1, 67, 18, 226358, 1, 68, 19, 402068, 1, 69, 19, 405138, 1, 70, 19, 405394, 1, 71, 19, 436818, 1, 72, 19, 436826, 1, 73, 19, 452714, 1, 75, 19, 452718, 1, 76, 19, 452682, 1, 74, 20, 804138, 1, 77, 20, 810279, 1, 78, 20, 810790, 1, 79, 20, 873638, 1, 80, 20, 873654, 1, 81, 20, 905366, 1, 82, 20, 905430, 1, 83, 20, 905438, 1, 84, 21, 1608278, 1, 85, 21, 1620557, 1, 86, 21, 1621582, 1, 87, 21, 1621583, 1, 88, 21, 1747310, 1, 89, 21, 1810734, 1, 90, 21, 1810735, 1, 91, 21, 1810863, 1, 92, 21, 1810879, 1, 93, 22, 3621725, 1, 99, 22, 3621757, 1, 100, 22, 3241112, 1, 94, 22, 3494556, 1, 95, 22, 3494557, 1, 96, 22, 3494622, 1, 97, 22, 3494623, 1, 98, 23, 6482227, 1, 102, 23, 6433117, 1, 101, 23, 6989117, 1, 103, 23, 6989119, 1, 105, 23, 6989118, 1, 104, 23, 7243449, 1, 106, 23, 7243512, 1, 107, 24, 13978233, 1, 111, 24, 12964453, 1, 109, 24, 12866232, 1, 108, 24, 14486897, 1, 113, 24, 13978232, 1, 110, 24, 14486896, 1, 112, 24, 14487026, 1, 114, 24, 14487027, 1, 115, 25, 25732598, 1, 225, 25, 25732597, 1, 189, 25, 25732596, 1, 188, 25, 25732595, 1, 203, 25, 25732594, 1, 202, 25, 25732593, 1, 197, 25, 25732592, 1, 207, 25, 25732591, 1, 169, 25, 25732590, 1, 223, 25, 25732589, 1, 159, 25, 25732522, 1, 235, 25, 25732579, 1, 152, 25, 25732575, 1, 192, 25, 25732489, 1, 179, 25, 25732573, 1, 201, 25, 25732472, 1, 172, 25, 25732576, 1, 149, 25, 25732488, 1, 178, 25, 25732566, 1, 120, 25, 25732571, 1, 219, 25, 25732577, 1, 150, 25, 25732487, 1, 127, 25, 25732506, 1, 211, 25, 25732548, 1, 125, 25, 25732588, 1, 158, 25, 25732486, 1, 247, 25, 25732467, 1, 238, 25, 25732508, 1, 163, 25, 25732552, 1, 228, 25, 25732603, 1, 183, 25, 25732513, 1, 217, 25, 25732587, 1, 168, 25, 25732520, 1, 122, 25, 25732484, 1, 128, 25, 25732562, 1, 249, 25, 25732505, 1, 187, 25, 25732504, 1, 186, 25, 25732483, 1, 136, 25, 25928905, 1, 181, 25, 25732560, 1, 255, 25, 25732500, 1, 230, 25, 25732482, 1, 135, 25, 25732555, 1, 233, 25, 25732568, 1, 222, 25, 25732583, 1, 145, 25, 25732481, 1, 134, 25, 25732586, 1, 167, 25, 25732521, 1, 248, 25, 25732518, 1, 209, 25, 25732480, 1, 243, 25, 25732512, 1, 216, 25, 25732509, 1, 164, 25, 25732547, 1, 140, 25, 25732479, 1, 157, 25, 25732544, 1, 239, 25, 25732574, 1, 191, 25, 25732564, 1, 251, 25, 25732478, 1, 156, 25, 25732546, 1, 139, 25, 25732498, 1, 242, 25, 25732557, 1, 133, 25, 25732477, 1, 162, 25, 25732515, 1, 213, 25, 25732584, 1, 165, 25, 25732514, 1, 212, 25, 25732476, 1, 227, 25, 25732494, 1, 198, 25, 25732531, 1, 236, 25, 25732530, 1, 234, 25, 25732529, 1, 117, 25, 25732528, 1, 215, 25, 25732527, 1, 124, 25, 25732526, 1, 123, 25, 25732525, 1, 254, 25, 25732524, 1, 253, 25, 25732523, 1, 148, 25, 25732570, 1, 218, 25, 25732580, 1, 146, 25, 25732581, 1, 147, 25, 25732569, 1, 224, 25, 25732533, 1, 143, 25, 25732540, 1, 184, 25, 25732541, 1, 185, 25, 25732585, 1, 166, 25, 25732556, 1, 132, 25, 25732485, 1, 129, 25, 25732563, 1, 250, 25, 25732578, 1, 151, 25, 25732501, 1, 119, 25, 25732502, 1, 193, 25, 25732536, 1, 176, 25, 25732496, 1, 245, 25, 25732553, 1, 229, 25, 25732516, 1, 206, 25, 25732582, 1, 144, 25, 25732517, 1, 208, 25, 25732558, 1, 137, 25, 25732543, 1, 241, 25, 25732466, 1, 237, 25, 25732507, 1, 190, 25, 25732542, 1, 240, 25, 25732551, 1, 131, 25, 25732554, 1, 232, 25, 25732565, 1, 252, 25, 25732475, 1, 171, 25, 25732493, 1, 205, 25, 25732492, 1, 204, 25, 25732491, 1, 118, 25, 25732490, 1, 214, 25, 25928904, 1, 180, 25, 25732549, 1, 126, 25, 25732602, 1, 182, 25, 25732539, 1, 175, 25, 25732545, 1, 141, 25, 25732559, 1, 138, 25, 25732537, 1, 177, 25, 25732534, 1, 153, 25, 25732503, 1, 194, 25, 25732606, 1, 160, 25, 25732567, 1, 121, 25, 25732538, 1, 174, 25, 25732497, 1, 246, 25, 25732550, 1, 130, 25, 25732572, 1, 200, 25, 25732474, 1, 170, 25, 25732511, 1, 221, 25, 25732601, 1, 196, 25, 25732532, 1, 142, 25, 25732519, 1, 210, 25, 25732495, 1, 199, 25, 25732605, 1, 155, 25, 25732535, 1, 154, 25, 25732499, 1, 244, 25, 25732510, 1, 220, 25, 25732600, 1, 195, 25, 25732607, 1, 161, 25, 25732604, 1, 231, 25, 25732473, 1, 173, 25, 25732599, 1, 226, 26, 51465122, 1, 116, 26, 51465123, 0, 1], e, i, r, n = [3, 3, 3, 3, 2, 2, 2, 1, 1, 1], o = 24576, s = 16384, a = 8192, h = s | a;
  function l(_) {
    var D = _[1], M = _[0][D >>> 3] >>> 7 - (D & 7) & 1;
    return _[1]++, M;
  }
  function w(_, D) {
    if (e == null) {
      e = {};
      for (var M = 0; M < t.length; M += 4) e[t[M + 1]] = t.slice(M, M + 4);
    }
    for (var v = l(_), p = e[v]; p == null; )
      v = v << 1 | l(_), p = e[v];
    var g = p[3];
    g != 0 && (g = l(_) == 0 ? g : -g), D[0] = p[2], D[1] = g;
  }
  function d(_, D) {
    for (var M = 0; M < D; M++)
      (_ & 1) == 1 && _++, _ = _ >>> 1;
    return _;
  }
  function u(_, D) {
    return _ >> D;
  }
  function y(_, D, M, v, p, g) {
    D[M] = u(u(11 * _[p] - 4 * _[p + g] + _[p + g + g] + 4, 3) + _[v], 1), D[M + g] = u(u(5 * _[p] + 4 * _[p + g] - _[p + g + g] + 4, 3) - _[v], 1);
  }
  function C(_, D, M, v, p, g) {
    var b = _[p - g] - _[p + g], x = _[p], T = _[v];
    D[M] = u(u(b + 4, 3) + x + T, 1), D[M + g] = u(u(-b + 4, 3) + x - T, 1);
  }
  function m(_, D, M, v, p, g) {
    D[M] = u(u(5 * _[p] + 4 * _[p - g] - _[p - g - g] + 4, 3) + _[v], 1), D[M + g] = u(u(11 * _[p] - 4 * _[p - g] + _[p - g - g] + 4, 3) - _[v], 1);
  }
  function c(_) {
    return _ = _ < 0 ? 0 : _ > 4095 ? 4095 : _, _ = r[_] >>> 2, _;
  }
  function f(_, D, M, v, p, g) {
    v = new Uint16Array(v.buffer);
    var b = Date.now(), x = F._binBE, T = D + M, U, P, k, A, z, N, H, S, L, E;
    D += 4;
    for (var I = g[0] == 1; D < T; ) {
      var O = x.readShort(_, D), V = x.readUshort(_, D + 2);
      if (D += 4, O == 12) U = V;
      else if (O == 20) P = V;
      else if (O == 21) k = V;
      else if (O == 48) A = V;
      else if (O == 53) z = V;
      else if (O != 35) {
        if (O == 62) N = V;
        else if (O != 101) {
          if (O == 109) H = V;
          else if (O != 84) {
            if (O != 106) {
              if (O != 107) {
                if (O != 108) {
                  if (O != 102) {
                    if (O == 104) S = V;
                    else if (O != 105) {
                      var G = O < 0 ? -O : O, j = G & 65280, B = 0;
                      if (G & h && (G & a ? (B = V & 65535, B += (G & 255) << 16) : B = V & 65535), (G & o) == o) {
                        if (L == null) {
                          L = [];
                          for (var R = 0; R < 4; R++) L[R] = new Int16Array((P >>> 1) * (k >>> 1));
                          E = new Int16Array((P >>> 1) * (k >>> 1)), i = new Int16Array(1024);
                          for (var R = 0; R < 1024; R++) {
                            var K = R - 512, ie = Math.abs(K), U = Math.floor(768 * ie * ie * ie / (65025 * 255)) + ie;
                            i[R] = Math.sign(K) * U;
                          }
                          r = new Uint16Array(4096);
                          for (var Y = 65535, R = 0; R < 4096; R++) {
                            var Q = R, te = Y * (Math.pow(113, Q / 4095) - 1) / 112;
                            r[R] = Math.min(te, Y);
                          }
                        }
                        var Z = L[N], $ = d(P, 1 + n[A]), J = d(k, 1 + n[A]);
                        if (A == 0)
                          for (var q = 0; q < J; q++) for (var X = 0; X < $; X++) {
                            var ae = D + (q * $ + X) * 2;
                            Z[q * (P >>> 1) + X] = _[ae] << 8 | _[ae + 1];
                          }
                        else {
                          for (var de = [_, D * 8], ve = [], Me = 0, ne = $ * J, fe = [0, 0], Te = 0, V = 0; Me < ne; )
                            for (w(de, fe), Te = fe[0], V = fe[1]; Te > 0; )
                              ve[Me++] = V, Te--;
                          for (var ye = (A - 1) % 3, je = ye != 1 ? $ : 0, W = ye != 0 ? J : 0, q = 0; q < J; q++)
                            for (var re = (q + W) * (P >>> 1) + je, se = q * $, X = 0; X < $; X++) Z[re + X] = i[ve[se + X] + 512] * z;
                          if (ye == 2) {
                            for (var S = P >>> 1, ge = $ * 2, he = J * 2, q = 0; q < J; q++)
                              for (var X = 0; X < ge; X++) {
                                var R = q * 2 * S + X, le = q * S + X, ue = J * S + le;
                                q == 0 ? y(Z, E, R, ue, le, S) : q == J - 1 ? m(Z, E, R, ue, le, S) : C(Z, E, R, ue, le, S);
                              }
                            var ee = Z;
                            Z = E, E = ee;
                            for (var q = 0; q < he; q++)
                              for (var X = 0; X < $; X++) {
                                var R = q * S + 2 * X, le = q * S + X, ue = $ + le;
                                X == 0 ? y(Z, E, R, ue, le, 1) : X == $ - 1 ? m(Z, E, R, ue, le, 1) : C(Z, E, R, ue, le, 1);
                              }
                            var ee = Z;
                            Z = E, E = ee;
                            for (var we = [], Oe = 2 - ~~((A - 1) / 3), De = 0; De < 3; De++) we[De] = H >> 14 - De * 2 & 3;
                            var Ze = we[Oe];
                            if (Ze != 0) for (var q = 0; q < he; q++) for (var X = 0; X < ge; X++) {
                              var R = q * S + X;
                              Z[R] = Z[R] << Ze;
                            }
                          }
                        }
                        if (A == 9 && N == 3)
                          for (var ht = L[0], lt = L[1], ct = L[2], ut = L[3], q = 0; q < k; q += 2) for (var X = 0; X < P; X += 2) {
                            var Ue = q * P + X, ae = (q >>> 1) * (P >>> 1) + (X >>> 1), Qe = ht[ae], pi = lt[ae] - 2048, vi = ct[ae] - 2048, It = ut[ae] - 2048, Ot = (pi << 1) + Qe, Ut = (vi << 1) + Qe, Rt = Qe + It, Bt = Qe - It;
                            I ? (v[Ue] = c(Rt), v[Ue + 1] = c(Ut), v[Ue + P] = c(Ot), v[Ue + P + 1] = c(Bt)) : (v[Ue] = c(Ot), v[Ue + 1] = c(Rt), v[Ue + P] = c(Bt), v[Ue + P + 1] = c(Ut));
                          }
                        D += B * 4;
                      } else if (G == 16388)
                        D += B * 4;
                      else if (!(j == 8192 || j == 8448 || j == 9216)) throw G.toString(16);
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    console.log(Date.now() - b);
  }
  return f;
})();
F.decode._decodeLogLuv32 = function(t, e, i, r, n, o) {
  for (var s = t.width, a = s * 4, h = 0, l = new Uint8Array(a); h < r; ) {
    for (var w = 0; w < a; ) {
      var d = e[i + h];
      if (h++, d < 128) {
        for (var u = 0; u < d; u++) l[w + u] = e[i + h + u];
        w += d, h += d;
      } else {
        d = d - 126;
        for (var u = 0; u < d; u++) l[w + u] = e[i + h];
        w += d, h++;
      }
    }
    for (var y = 0; y < s; y++)
      n[o + 0] = l[y], n[o + 1] = l[y + s], n[o + 2] = l[y + s * 2], n[o + 4] = l[y + s * 3], o += 6;
  }
};
F.decode._ljpeg_diff = function(t, e, i) {
  var r = F.decode._getbithuff, n, o;
  return n = r(t, e, i[0], i), o = r(t, e, n, 0), (o & 1 << n - 1) == 0 && (o -= (1 << n) - 1), o;
};
F.decode._decodeARW = function(t, e, i, r, n, o) {
  var s = t.t256[0], a = t.t257[0], h = t.t258[0], l = t.isLE ? F._binLE : F._binBE, w = s * a == r || s * a * 1.5 == r;
  if (!w) {
    a += 8;
    var d = [i, 0, 0, 0], u = new Uint16Array(32770), y = [
      3857,
      3856,
      3599,
      3342,
      3085,
      2828,
      2571,
      2314,
      2057,
      1800,
      1543,
      1286,
      1029,
      772,
      771,
      768,
      514,
      513
    ], H, C, m, x, b, c = 0, f = F.decode._ljpeg_diff;
    for (u[0] = 15, m = H = 0; H < 18; H++)
      for (var _ = 32768 >>> (y[H] >>> 8), C = 0; C < _; C++) u[++m] = y[H];
    for (x = s; x--; )
      for (b = 0; b < a + 1; b += 2)
        if (b == a && (b = 1), c += f(e, d, u), b < a) {
          var D = c & 4095;
          F.decode._putsF(n, (b * s + x) * h, D << 16 - h);
        }
    return;
  }
  if (s * a * 1.5 == r) {
    for (var H = 0; H < r; H += 3) {
      var M = e[i + H + 0], v = e[i + H + 1], p = e[i + H + 2];
      n[o + H] = v << 4 | M >>> 4, n[o + H + 1] = M << 4 | p >>> 4, n[o + H + 2] = p << 4 | v >>> 4;
    }
    return;
  }
  var g = new Uint16Array(16), b, x, T, U, P, k, A, z, N, H, S, L = new Uint8Array(s + 1);
  for (b = 0; b < a; b++) {
    for (var E = 0; E < s; E++) L[E] = e[i++];
    for (S = 0, x = 0; x < s - 30; S += 16) {
      for (U = 2047 & (T = l.readUint(L, S)), P = 2047 & T >>> 11, k = 15 & T >>> 22, A = 15 & T >>> 26, z = 0; z < 4 && 128 << z <= U - P; z++) ;
      for (N = 30, H = 0; H < 16; H++)
        H == k ? g[H] = U : H == A ? g[H] = P : (g[H] = ((l.readUshort(L, S + (N >> 3)) >>> (N & 7) & 127) << z) + P, g[H] > 2047 && (g[H] = 2047), N += 7);
      for (H = 0; H < 16; H++, x += 2) {
        var D = g[H] << 1;
        F.decode._putsF(n, (b * s + x) * h, D << 16 - h);
      }
      x -= x & 1 ? 1 : 31;
    }
  }
};
F.decode._decodeNikon = function(t, e, i, r, n, o, s) {
  var a = [
    [
      0,
      0,
      1,
      5,
      1,
      1,
      1,
      1,
      1,
      1,
      2,
      0,
      0,
      0,
      0,
      0,
      0,
      /* 12-bit lossy */
      5,
      4,
      3,
      6,
      2,
      7,
      1,
      0,
      8,
      9,
      11,
      10,
      12
    ],
    [
      0,
      0,
      1,
      5,
      1,
      1,
      1,
      1,
      1,
      1,
      2,
      0,
      0,
      0,
      0,
      0,
      0,
      /* 12-bit lossy after split */
      57,
      90,
      56,
      39,
      22,
      5,
      4,
      3,
      2,
      1,
      0,
      11,
      12,
      12
    ],
    [
      0,
      0,
      1,
      4,
      2,
      3,
      1,
      2,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      /* 12-bit lossless */
      5,
      4,
      6,
      3,
      7,
      2,
      8,
      1,
      9,
      0,
      10,
      11,
      12
    ],
    [
      0,
      0,
      1,
      4,
      3,
      1,
      1,
      1,
      1,
      1,
      2,
      0,
      0,
      0,
      0,
      0,
      0,
      /* 14-bit lossy */
      5,
      6,
      4,
      7,
      8,
      3,
      9,
      2,
      1,
      0,
      10,
      11,
      12,
      13,
      14
    ],
    [
      0,
      0,
      1,
      5,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      2,
      0,
      0,
      0,
      0,
      0,
      /* 14-bit lossy after split */
      8,
      92,
      75,
      58,
      41,
      7,
      6,
      5,
      4,
      3,
      2,
      1,
      0,
      13,
      14
    ],
    [
      0,
      0,
      1,
      4,
      2,
      2,
      3,
      1,
      2,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      /* 14-bit lossless */
      7,
      6,
      8,
      5,
      9,
      4,
      10,
      3,
      11,
      12,
      2,
      0,
      1,
      13,
      14
    ]
  ], h = t.t256[0], l = t.t257[0], w = t.t258[0], d = 0, u = 0, y = F.decode._make_decoder, C = F.decode._getbithuff, m = e[0].exifIFD.makerNote, c = m.t150 ? m.t150 : m.t140, f = 0, _ = c[f++], D = c[f++];
  (_ == 73 || D == 88) && (f += 2110), _ == 70 && (d = 2), w == 14 && (d += 3);
  for (var M = [[0, 0], [0, 0]], v = t.isLE ? F._binLE : F._binBE, T = 0; T < 2; T++) for (var p = 0; p < 2; p++)
    M[T][p] = v.readShort(c, f), f += 2;
  var g = 1 << w & 32767, b = 0, x = v.readShort(c, f);
  f += 2, x > 1 && (b = Math.floor(g / (x - 1))), _ == 68 && D == 32 && b > 0 && (u = v.readShort(c, 562));
  var T, U, P, k, A, z, N = [0, 0], H = y(a[d]), S = [r, 0, 0, 0];
  for (U = 0; U < l; U++)
    for (u && U == u && (H = y(a[d + 1])), P = 0; P < h; P++) {
      T = C(i, S, H[0], H), k = T & 15, A = T >>> 4, z = (C(i, S, k - A, 0) << 1) + 1 << A >>> 1, (z & 1 << k - 1) == 0 && (z -= (1 << k) - (A == 0 ? 1 : 0)), P < 2 ? N[P] = M[U & 1][P] += z : N[P & 1] += z;
      var L = Math.min(Math.max(N[P & 1], 0), (1 << w) - 1), E = (U * h + P) * w;
      F.decode._putsF(o, E, L << 16 - w);
    }
};
F.decode._putsF = function(t, e, i) {
  i = i << 8 - (e & 7);
  var r = e >>> 3;
  t[r] |= i >>> 16, t[r + 1] |= i >>> 8, t[r + 2] |= i;
};
F.decode._getbithuff = function(t, e, i, r) {
  var n = 0;
  F.decode._get_byte;
  var o, s = e[0], a = e[1], h = e[2], l = e[3];
  if (i == 0 || h < 0) return 0;
  for (; !l && h < i && (o = t[s++]) != -1 && !(l = n); )
    a = (a << 8) + o, h += 8;
  if (o = a << 32 - h >>> 32 - i, r ? (h -= r[o + 1] >>> 8, o = r[o + 1] & 255) : h -= i, h < 0) throw "e";
  return e[0] = s, e[1] = a, e[2] = h, e[3] = l, o;
};
F.decode._make_decoder = function(t) {
  var e, i, r, n, o, s = [];
  for (e = 16; e != 0 && !t[e]; e--) ;
  var a = 17;
  for (s[0] = e, r = i = 1; i <= e; i++)
    for (n = 0; n < t[i]; n++, ++a)
      for (o = 0; o < 1 << e - i; o++)
        r <= 1 << e && (s[r++] = i << 8 | t[a]);
  return s;
};
F.decode._decodeNewJPEG = function(t, e, i, r, n, o) {
  r = Math.min(r, e.length - i);
  var s = t.t347, a = s ? s.length : 0, h = new Uint8Array(a + r);
  if (s) {
    for (var l = 216, w = 217, d = 0, u = 0; u < a - 1 && !(s[u] == 255 && s[u + 1] == w); u++)
      h[d++] = s[u];
    var y = e[i], C = e[i + 1];
    (y != 255 || C != l) && (h[d++] = y, h[d++] = C);
    for (var u = 2; u < r; u++) h[d++] = e[i + u];
  } else for (var u = 0; u < r; u++) h[u] = e[i + u];
  if (t.t262[0] == 32803 || t.t259[0] == 7 && t.t262[0] == 34892) {
    var m = t.t258[0], c = F.LosslessJpegDecode(h), f = c.length;
    if (m == 16)
      if (t.isLE) for (var u = 0; u < f; u++)
        n[o + (u << 1)] = c[u] & 255, n[o + (u << 1) + 1] = c[u] >>> 8;
      else for (var u = 0; u < f; u++)
        n[o + (u << 1)] = c[u] >>> 8, n[o + (u << 1) + 1] = c[u] & 255;
    else if (m == 14 || m == 12 || m == 10)
      for (var _ = 16 - m, u = 0; u < f; u++) F.decode._putsF(n, u * m, c[u] << _);
    else if (m == 8)
      for (var u = 0; u < f; u++) n[o + u] = c[u];
    else throw new Error("unsupported bit depth " + m);
  } else {
    var D = new F.JpegDecoder();
    D.parse(h);
    for (var M = D.getData({ width: D.width, height: D.height, forceRGB: !0, isSourcePDF: !1 }), u = 0; u < M.length; u++) n[o + u] = M[u];
  }
  t.t262[0] == 6 && (t.t262[0] = 2);
};
F.decode._decodeOldJPEGInit = function(t, e, i, r) {
  var n = 216, o = 219, s = 196, a = 221, h = 192, l = 218, w = 0, d = 0, u, y, C = !1, m, c, f, _ = t.t513, D = _ ? _[0] : 0, M = t.t514, v = M ? M[0] : 0, p = t.t324 || t.t273 || _, g = t.t530, b = 0, x = 0, T = t.t277 ? t.t277[0] : 1, U = t.t515;
  if (p && (d = p[0], C = p.length > 1), !C) {
    if (e[i] == 255 && e[i + 1] == n) return { jpegOffset: i };
    if (_ != null && (e[i + D] == 255 && e[i + D + 1] == n ? w = i + D : log("JPEGInterchangeFormat does not point to SOI"), M == null ? log("JPEGInterchangeFormatLength field is missing") : (D >= d || D + v <= d) && log("JPEGInterchangeFormatLength field value is invalid"), w != null))
      return { jpegOffset: w };
  }
  if (g != null && (b = g[0], x = g[1]), _ != null && M != null)
    if (v >= 2 && D + v <= d) {
      for (e[i + D + v - 2] == 255 && e[i + D + v - 1] == n ? u = new Uint8Array(v - 2) : u = new Uint8Array(v), m = 0; m < u.length; m++) u[m] = e[i + D + m];
      log("Incorrect JPEG interchange format: using JPEGInterchangeFormat offset to derive tables");
    } else log("JPEGInterchangeFormat+JPEGInterchangeFormatLength > offset to first strip or tile");
  if (u == null) {
    var P = 0, k = [];
    k[P++] = 255, k[P++] = n;
    var A = t.t519;
    if (A == null) throw new Error("JPEGQTables tag is missing");
    for (m = 0; m < A.length; m++)
      for (k[P++] = 255, k[P++] = o, k[P++] = 0, k[P++] = 67, k[P++] = m, c = 0; c < 64; c++) k[P++] = e[i + A[m] + c];
    for (f = 0; f < 2; f++) {
      var z = t[f == 0 ? "t520" : "t521"];
      if (z == null) throw new Error((f == 0 ? "JPEGDCTables" : "JPEGACTables") + " tag is missing");
      for (m = 0; m < z.length; m++) {
        k[P++] = 255, k[P++] = s;
        var N = 19;
        for (c = 0; c < 16; c++) N += e[i + z[m] + c];
        for (k[P++] = N >>> 8, k[P++] = N & 255, k[P++] = m | f << 4, c = 0; c < 16; c++) k[P++] = e[i + z[m] + c];
        for (c = 0; c < N; c++) k[P++] = e[i + z[m] + 16 + c];
      }
    }
    if (k[P++] = 255, k[P++] = h, k[P++] = 0, k[P++] = 8 + 3 * T, k[P++] = 8, k[P++] = t.height >>> 8 & 255, k[P++] = t.height & 255, k[P++] = t.width >>> 8 & 255, k[P++] = t.width & 255, k[P++] = T, T == 1)
      k[P++] = 1, k[P++] = 17, k[P++] = 0;
    else for (m = 0; m < 3; m++)
      k[P++] = m + 1, k[P++] = m != 0 ? 17 : (b & 15) << 4 | x & 15, k[P++] = m;
    U != null && U[0] != 0 && (k[P++] = 255, k[P++] = a, k[P++] = 0, k[P++] = 4, k[P++] = U[0] >>> 8 & 255, k[P++] = U[0] & 255), u = new Uint8Array(k);
  }
  var H = -1;
  for (m = 0; m < u.length - 1; ) {
    if (u[m] == 255 && u[m + 1] == h) {
      H = m;
      break;
    }
    m++;
  }
  if (H == -1) {
    var S = new Uint8Array(u.length + 10 + 3 * T);
    S.set(u);
    var L = u.length;
    if (H = u.length, u = S, u[L++] = 255, u[L++] = h, u[L++] = 0, u[L++] = 8 + 3 * T, u[L++] = 8, u[L++] = t.height >>> 8 & 255, u[L++] = t.height & 255, u[L++] = t.width >>> 8 & 255, u[L++] = t.width & 255, u[L++] = T, T == 1)
      u[L++] = 1, u[L++] = 17, u[L++] = 0;
    else for (m = 0; m < 3; m++)
      u[L++] = m + 1, u[L++] = m != 0 ? 17 : (b & 15) << 4 | x & 15, u[L++] = m;
  }
  if (e[d] == 255 && e[d + 1] == l) {
    var E = e[d + 2] << 8 | e[d + 3];
    for (y = new Uint8Array(E + 2), y[0] = e[d], y[1] = e[d + 1], y[2] = e[d + 2], y[3] = e[d + 3], m = 0; m < E - 2; m++) y[m + 4] = e[d + m + 4];
  } else {
    y = new Uint8Array(8 + 2 * T);
    var I = 0;
    if (y[I++] = 255, y[I++] = l, y[I++] = 0, y[I++] = 6 + 2 * T, y[I++] = T, T == 1)
      y[I++] = 1, y[I++] = 0;
    else for (m = 0; m < 3; m++)
      y[I++] = m + 1, y[I++] = m << 4 | m;
    y[I++] = 0, y[I++] = 63, y[I++] = 0;
  }
  return { jpegOffset: i, tables: u, sosMarker: y, sofPosition: H };
};
F.decode._decodeOldJPEG = function(t, e, i, r, n, o) {
  var s, a, h, l, w, d = F.decode._decodeOldJPEGInit(t, e, i, r);
  if (d.jpegOffset != null)
    for (a = i + r - d.jpegOffset, l = new Uint8Array(a), s = 0; s < a; s++) l[s] = e[d.jpegOffset + s];
  else {
    for (h = d.tables.length, l = new Uint8Array(h + d.sosMarker.length + r + 2), l.set(d.tables), w = h, l[d.sofPosition + 5] = t.height >>> 8 & 255, l[d.sofPosition + 6] = t.height & 255, l[d.sofPosition + 7] = t.width >>> 8 & 255, l[d.sofPosition + 8] = t.width & 255, (e[i] != 255 || e[i + 1] != SOS) && (l.set(d.sosMarker, w), w += sosMarker.length), s = 0; s < r; s++) l[w++] = e[i + s];
    l[w++] = 255, l[w++] = EOI;
  }
  var u = new F.JpegDecoder();
  u.parse(l);
  for (var y = u.getData({ width: u.width, height: u.height, forceRGB: !0, isSourcePDF: !1 }), s = 0; s < y.length; s++) n[o + s] = y[s];
  t.t262 && t.t262[0] == 6 && (t.t262[0] = 2);
};
F.decode._decodePackBits = function(t, e, i, r, n) {
  for (var o = new Int8Array(t.buffer), s = new Int8Array(r.buffer), a = e + i; e < a; ) {
    var h = o[e];
    if (e++, h >= 0 && h < 128) for (var l = 0; l < h + 1; l++)
      s[n] = o[e], n++, e++;
    if (h >= -127 && h < 0) {
      for (var l = 0; l < -h + 1; l++)
        s[n] = o[e], n++;
      e++;
    }
  }
  return n;
};
F.decode._decodeThunder = function(t, e, i, r, n) {
  for (var o = [0, 1, 0, -1], s = [0, 1, 2, 3, 0, -3, -2, -1], a = e + i, h = n * 2, l = 0; e < a; ) {
    var w = t[e], d = w >>> 6, u = w & 63;
    if (e++, d == 3 && (l = u & 15, r[h >>> 1] |= l << 4 * (1 - h & 1), h++), d == 0) for (var y = 0; y < u; y++)
      r[h >>> 1] |= l << 4 * (1 - h & 1), h++;
    if (d == 2) for (var y = 0; y < 2; y++) {
      var C = u >>> 3 * (1 - y) & 7;
      C != 4 && (l += s[C], r[h >>> 1] |= l << 4 * (1 - h & 1), h++);
    }
    if (d == 1) for (var y = 0; y < 3; y++) {
      var C = u >>> 2 * (2 - y) & 3;
      C != 2 && (l += o[C], r[h >>> 1] |= l << 4 * (1 - h & 1), h++);
    }
  }
};
F.decode._dmap = { 1: 0, "011": 1, "000011": 2, "0000011": 3, "010": -1, "000010": -2, "0000010": -3 };
F.decode._lens = (function() {
  var t = function(h, l, w, d) {
    for (var u = 0; u < l.length; u++) h[l[u]] = w + u * d;
  }, e = "00110101,000111,0111,1000,1011,1100,1110,1111,10011,10100,00111,01000,001000,000011,110100,110101,101010,101011,0100111,0001100,0001000,0010111,0000011,0000100,0101000,0101011,0010011,0100100,0011000,00000010,00000011,00011010,00011011,00010010,00010011,00010100,00010101,00010110,00010111,00101000,00101001,00101010,00101011,00101100,00101101,00000100,00000101,00001010,00001011,01010010,01010011,01010100,01010101,00100100,00100101,01011000,01011001,01011010,01011011,01001010,01001011,00110010,00110011,00110100", i = "0000110111,010,11,10,011,0011,0010,00011,000101,000100,0000100,0000101,0000111,00000100,00000111,000011000,0000010111,0000011000,0000001000,00001100111,00001101000,00001101100,00000110111,00000101000,00000010111,00000011000,000011001010,000011001011,000011001100,000011001101,000001101000,000001101001,000001101010,000001101011,000011010010,000011010011,000011010100,000011010101,000011010110,000011010111,000001101100,000001101101,000011011010,000011011011,000001010100,000001010101,000001010110,000001010111,000001100100,000001100101,000001010010,000001010011,000000100100,000000110111,000000111000,000000100111,000000101000,000001011000,000001011001,000000101011,000000101100,000001011010,000001100110,000001100111", r = "11011,10010,010111,0110111,00110110,00110111,01100100,01100101,01101000,01100111,011001100,011001101,011010010,011010011,011010100,011010101,011010110,011010111,011011000,011011001,011011010,011011011,010011000,010011001,010011010,011000,010011011", n = "0000001111,000011001000,000011001001,000001011011,000000110011,000000110100,000000110101,0000001101100,0000001101101,0000001001010,0000001001011,0000001001100,0000001001101,0000001110010,0000001110011,0000001110100,0000001110101,0000001110110,0000001110111,0000001010010,0000001010011,0000001010100,0000001010101,0000001011010,0000001011011,0000001100100,0000001100101", o = "00000001000,00000001100,00000001101,000000010010,000000010011,000000010100,000000010101,000000010110,000000010111,000000011100,000000011101,000000011110,000000011111";
  e = e.split(","), i = i.split(","), r = r.split(","), n = n.split(","), o = o.split(",");
  var s = {}, a = {};
  return t(s, e, 0, 1), t(s, r, 64, 64), t(s, o, 1792, 64), t(a, i, 0, 1), t(a, n, 64, 64), t(a, o, 1792, 64), [s, a];
})();
F.decode._decodeG4 = function(t, e, i, r, n, o, s) {
  for (var a = F.decode, h = e << 3, l = 0, w = "", d = [], u = [], y = 0; y < o; y++) u.push(0);
  u = a._makeDiff(u);
  for (var C = 0, m = 0, c = 0, f = 0, _ = 0, D = 0, M = "", v = 0, p = Math.ceil(o / 8) * 8; h >>> 3 < e + i; ) {
    c = a._findDiff(u, C + (C == 0 ? 0 : 1), 1 - _), f = a._findDiff(u, c, _);
    var g = 0;
    if (s == 1 && (g = t[h >>> 3] >>> 7 - (h & 7) & 1), s == 2 && (g = t[h >>> 3] >>> (h & 7) & 1), h++, w += g, M == "H") {
      if (a._lens[_][w] != null) {
        var b = a._lens[_][w];
        w = "", l += b, b < 64 && (a._addNtimes(d, l, _), C += l, _ = 1 - _, l = 0, v--, v == 0 && (M = ""));
      }
    } else
      w == "0001" && (w = "", a._addNtimes(d, f - C, _), C = f), w == "001" && (w = "", M = "H", v = 2), a._dmap[w] != null && (m = c + a._dmap[w], a._addNtimes(d, m - C, _), C = m, w = "", _ = 1 - _);
    d.length == o && M == "" && (a._writeBits(d, r, n * 8 + D * p), _ = 0, D++, C = 0, u = a._makeDiff(d), d = []);
  }
};
F.decode._findDiff = function(t, e, i) {
  for (var r = 0; r < t.length; r += 2) if (t[r] >= e && t[r + 1] == i) return t[r];
};
F.decode._makeDiff = function(t) {
  var e = [];
  t[0] == 1 && e.push(0, 1);
  for (var i = 1; i < t.length; i++) t[i - 1] != t[i] && e.push(i, t[i]);
  return e.push(t.length, 0, t.length, 1), e;
};
F.decode._decodeG2 = function(t, e, i, r, n, o, s) {
  for (var a = F.decode, h = e << 3, l = 0, w = "", d = [], u = 0, y = 0, C = Math.ceil(o / 8) * 8; h >>> 3 < e + i; ) {
    var m = 0;
    s == 1 && (m = t[h >>> 3] >>> 7 - (h & 7) & 1), s == 2 && (m = t[h >>> 3] >>> (h & 7) & 1), h++, w += m, l = a._lens[u][w], l != null && (a._addNtimes(d, l, u), w = "", l < 64 && (u = 1 - u), d.length == o && (a._writeBits(d, r, n * 8 + y * C), d = [], y++, u = 0, (h & 7) != 0 && (h += 8 - (h & 7)), l >= 64 && (h += 8)));
  }
};
F.decode._decodeG3 = function(t, e, i, r, n, o, s, a) {
  for (var h = F.decode, l = e << 3, w = 0, d = "", u = [], y = [], C = 0; C < o; C++) u.push(0);
  for (var m = 0, c = 0, f = 0, _ = 0, D = 0, M = -1, v = "", p = 0, g = !0, b = Math.ceil(o / 8) * 8; l >>> 3 < e + i; ) {
    f = h._findDiff(y, m + (m == 0 ? 0 : 1), 1 - D), _ = h._findDiff(y, f, D);
    var x = 0;
    if (s == 1 && (x = t[l >>> 3] >>> 7 - (l & 7) & 1), s == 2 && (x = t[l >>> 3] >>> (l & 7) & 1), l++, d += x, g) {
      if (h._lens[D][d] != null) {
        var T = h._lens[D][d];
        d = "", w += T, T < 64 && (h._addNtimes(u, w, D), D = 1 - D, w = 0);
      }
    } else if (v == "H") {
      if (h._lens[D][d] != null) {
        var T = h._lens[D][d];
        d = "", w += T, T < 64 && (h._addNtimes(u, w, D), m += w, D = 1 - D, w = 0, p--, p == 0 && (v = ""));
      }
    } else
      d == "0001" && (d = "", h._addNtimes(u, _ - m, D), m = _), d == "001" && (d = "", v = "H", p = 2), h._dmap[d] != null && (c = f + h._dmap[d], h._addNtimes(u, c - m, D), m = c, d = "", D = 1 - D);
    d.endsWith("000000000001") && (M >= 0 && h._writeBits(u, r, n * 8 + M * b), a && (s == 1 && (g = (t[l >>> 3] >>> 7 - (l & 7) & 1) == 1), s == 2 && (g = (t[l >>> 3] >>> (l & 7) & 1) == 1), l++), d = "", D = 0, M++, m = 0, y = h._makeDiff(u), u = []);
  }
  u.length == o && h._writeBits(u, r, n * 8 + M * b);
};
F.decode._addNtimes = function(t, e, i) {
  for (var r = 0; r < e; r++) t.push(i);
};
F.decode._writeBits = function(t, e, i) {
  for (var r = 0; r < t.length; r++) e[i + r >>> 3] |= t[r] << 7 - (i + r & 7);
};
F.decode._decodeLZW = F.decode._decodeLZW = (function() {
  var t, e, i, r, n = 0, o = 0, s = 0, a = 0, h = function() {
    var c = t >>> 3, f = e[c] << 16 | e[c + 1] << 8 | e[c + 2], _ = f >>> 24 - (t & 7) - o & (1 << o) - 1;
    return t += o, _;
  }, l = new Uint32Array(4096 * 4), w = 0, d = function(c) {
    if (c != w) {
      w = c, s = 1 << c, a = s + 1;
      for (var f = 0; f < a + 1; f++)
        l[4 * f] = l[4 * f + 3] = f, l[4 * f + 1] = 65535, l[4 * f + 2] = 1;
    }
  }, u = function(c) {
    o = c + 1, n = a + 1;
  }, y = function(c) {
    for (var f = c << 2, _ = l[f + 2], D = r + _ - 1; f != 65535; )
      i[D--] = l[f], f = l[f + 1];
    r += _;
  }, C = function(c, f) {
    var _ = n << 2, D = c << 2;
    l[_] = l[(f << 2) + 3], l[_ + 1] = D, l[_ + 2] = l[D + 2] + 1, l[_ + 3] = l[D + 3], n++, n + 1 == 1 << o && o != 12 && o++;
  }, m = function(c, f, _, D, M, v) {
    t = f << 3, e = c, i = D, r = M;
    var p = f + _ << 3, g = 0, b = 0;
    for (d(v), u(v); t < p && (g = h()) != a; ) {
      if (g == s) {
        if (u(v), g = h(), g == a) break;
        y(g);
      } else
        g < n ? (y(g), C(b, g)) : (C(b, b), y(n - 1));
      b = g;
    }
    return r;
  };
  return m;
})();
F.tags = {};
F._types = (function() {
  var t = new Array(250);
  t.fill(0), t = t.concat([0, 0, 0, 0, 4, 3, 3, 3, 3, 3, 0, 0, 3, 0, 0, 0, 3, 0, 0, 2, 2, 2, 2, 4, 3, 0, 0, 3, 4, 4, 3, 3, 5, 5, 3, 2, 5, 5, 0, 0, 0, 0, 4, 4, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 3, 5, 5, 3, 0, 3, 3, 4, 4, 4, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  var e = { 33432: 2, 33434: 5, 33437: 5, 34665: 4, 34850: 3, 34853: 4, 34855: 3, 34864: 3, 34866: 4, 36864: 7, 36867: 2, 36868: 2, 37121: 7, 37377: 10, 37378: 5, 37380: 10, 37381: 5, 37383: 3, 37384: 3, 37385: 3, 37386: 5, 37510: 7, 37520: 2, 37521: 2, 37522: 2, 40960: 7, 40961: 3, 40962: 4, 40963: 4, 40965: 4, 41486: 5, 41487: 5, 41488: 3, 41985: 3, 41986: 3, 41987: 3, 41988: 5, 41989: 3, 41990: 3, 41993: 3, 41994: 3, 41995: 7, 41996: 3, 42032: 2, 42033: 2, 42034: 5, 42036: 2, 42037: 2, 59932: 7 };
  return {
    basic: {
      main: t,
      rest: e
    },
    gps: {
      main: [1, 2, 5, 2, 5, 1, 5, 5, 0, 9],
      rest: { 18: 2, 29: 2 }
    }
  };
})();
F._readIFD = function(t, e, i, r, n, o) {
  var s = t.readUshort(e, i);
  i += 2;
  var a = {};
  o.debug && log("   ".repeat(n), r.length - 1, ">>>----------------");
  for (var h = 0; h < s; h++) {
    var l = t.readUshort(e, i);
    i += 2;
    var w = t.readUshort(e, i);
    i += 2;
    var d = t.readUint(e, i);
    i += 4;
    var u = t.readUint(e, i);
    i += 4;
    var y = [];
    if (w == 1 || w == 7) {
      var C = d < 5 ? i - 4 : u;
      C + d > e.buffer.byteLength && (d = e.buffer.byteLength - C), y = new Uint8Array(e.buffer, C, d);
    }
    if (w == 2) {
      var m = d < 5 ? i - 4 : u, c = e[m], f = Math.max(0, Math.min(d - 1, e.length - m));
      c < 128 || f == 0 ? y.push(t.readASCII(e, m, f)) : y = new Uint8Array(e.buffer, m, f);
    }
    if (w == 3)
      for (var _ = 0; _ < d; _++) y.push(t.readUshort(e, (d < 3 ? i - 4 : u) + 2 * _));
    if (w == 4 || w == 13)
      for (var _ = 0; _ < d; _++) y.push(t.readUint(e, (d < 2 ? i - 4 : u) + 4 * _));
    if (w == 5 || w == 10)
      for (var D = w == 5 ? t.readUint : t.readInt, _ = 0; _ < d; _++) y.push([D(e, u + _ * 8), D(e, u + _ * 8 + 4)]);
    if (w == 8)
      for (var _ = 0; _ < d; _++) y.push(t.readShort(e, (d < 3 ? i - 4 : u) + 2 * _));
    if (w == 9)
      for (var _ = 0; _ < d; _++) y.push(t.readInt(e, (d < 2 ? i - 4 : u) + 4 * _));
    if (w == 11)
      for (var _ = 0; _ < d; _++) y.push(t.readFloat(e, u + _ * 4));
    if (w == 12)
      for (var _ = 0; _ < d; _++) y.push(t.readDouble(e, u + _ * 8));
    if (d != 0 && y.length == 0) {
      if (log(l, "unknown TIFF tag type: ", w, "num:", d), h == 0) return;
      continue;
    }
    if (o.debug && log("   ".repeat(n), l, w, F.tags[l], y), a["t" + l] = y, !(l == 330 && a.t272 && a.t272[0] == "DSLR-A100")) {
      if (l == 330 || l == 34665 || l == 34853 || l == 50740 && t.readUshort(e, t.readUint(y, 0)) < 300 || l == 61440) {
        for (var M = l == 50740 ? [t.readUint(y, 0)] : y, v = [], _ = 0; _ < M.length; _++) F._readIFD(t, e, M[_], v, n + 1, o);
        l == 330 && (a.subIFD = v), l == 34665 && (a.exifIFD = v[0]), l == 34853 && (a.gpsiIFD = v[0]), l == 50740 && (a.dngPrvt = v[0]), l == 61440 && (a.fujiIFD = v[0]);
      }
    }
    if (l == 37500 && o.parseMN) {
      var p = y;
      if (t.readASCII(p, 0, 5) == "Nikon") a.makerNote = F.decode(p.slice(10).buffer)[0];
      else if (t.readASCII(p, 0, 5) == "OLYMP" || t.readASCII(p, 0, 9) == "OM SYSTEM") {
        var g = [8208, 8224, 8240, 8256, 8272], b = [];
        F._readIFD(t, p, p[1] == 77 ? 16 : p[5] == 85 ? 12 : 8, b, n + 1, o);
        for (var x = a.makerNote = b.pop(), _ = 0; _ < g.length; _++) {
          var T = "t" + g[_];
          x[T] != null && (F._readIFD(t, p, x[T][0], b, n + 1, o), x[T] = b.pop());
        }
        x.t12288 && (F._readIFD(t, x.t12288, 0, b, n + 1, o), x.t12288 = b.pop());
      } else if (t.readUshort(e, u) < 300 && t.readUshort(e, u + 4) <= 12) {
        var b = [];
        F._readIFD(t, e, u, b, n + 1, o), a.makerNote = b[0];
      }
    }
  }
  return r.push(a), o.debug && log("   ".repeat(n), "<<<---------------"), i;
};
F._writeIFD = function(t, e, i, r, n) {
  var o = Object.keys(n), s = o.length;
  n.exifIFD && s--, n.gpsiIFD && s--, t.writeUshort(i, r, s), r += 2;
  for (var a = r + s * 12 + 4, h = 0; h < o.length; h++) {
    var l = o[h];
    if (!(l == "t34665" || l == "t34853")) {
      l == "exifIFD" && (l = "t34665"), l == "gpsiIFD" && (l = "t34853");
      var w = parseInt(l.slice(1)), d = e.main[w];
      if (d == null && (d = e.rest[w]), d == null || d == 0) throw new Error("unknown type of tag: " + w);
      var u = n[l];
      if (w == 34665) {
        var y = F._writeIFD(t, e, i, a, n.exifIFD);
        u = [a], a = y[1];
      }
      if (w == 34853) {
        var y = F._writeIFD(t, F._types.gps, i, a, n.gpsiIFD);
        u = [a], a = y[1];
      }
      d == 2 && (u = u[0] + "\0");
      var C = u.length;
      t.writeUshort(i, r, w), r += 2, t.writeUshort(i, r, d), r += 2, t.writeUint(i, r, C), r += 4;
      var m = [-1, 1, 1, 2, 4, 8, 0, 1, 0, 4, 8, 0, 8][d] * C, c = r;
      if (m > 4 && (t.writeUint(i, r, a), c = a), d == 1 || d == 7)
        for (var f = 0; f < C; f++) i[c + f] = u[f];
      else if (d == 2)
        t.writeASCII(i, c, u);
      else if (d == 3)
        for (var f = 0; f < C; f++) t.writeUshort(i, c + 2 * f, u[f]);
      else if (d == 4)
        for (var f = 0; f < C; f++) t.writeUint(i, c + 4 * f, u[f]);
      else if (d == 5 || d == 10)
        for (var _ = d == 5 ? t.writeUint : t.writeInt, f = 0; f < C; f++) {
          var D = u[f], M = D[0], v = D[1];
          if (M == null) throw "e";
          _(i, c + 8 * f, M), _(i, c + 8 * f + 4, v);
        }
      else if (d == 9)
        for (var f = 0; f < C; f++) t.writeInt(i, c + 4 * f, u[f]);
      else if (d == 12)
        for (var f = 0; f < C; f++) t.writeDouble(i, c + 8 * f, u[f]);
      else throw d;
      m > 4 && (m += m & 1, a += m), r += 4;
    }
  }
  return [r, a];
};
F.toRGBA8 = function(t, e) {
  function i(ve) {
    return ve < 31308e-7 ? 12.92 * ve : 1.055 * Math.pow(ve, 1 / 2.4) - 0.055;
  }
  var r = t.width, n = t.height, o = r * n, s = t.data, a = new Uint8Array(o * 4), h = t.t262 ? t.t262[0] : 2, l = t.t258 ? Math.min(32, t.t258[0]) : 1;
  t.t262 == null && l == 1 && (h = 0);
  var w = t.t277 ? t.t277[0] : t.t258 ? t.t258.length : [1, 1, 3, 1, 1, 4, 3][h], d = t.t339 ? t.t339[0] : null;
  if (h == 1 && l == 32 && d != 3) throw "e";
  var u = Math.ceil(w * l * r / 8);
  if (h == 0) {
    e = 1 / 256;
    for (var y = 0; y < n; y++) {
      var C = y * u, m = y * r;
      if (l == 1) for (var c = 0; c < r; c++) {
        var f = m + c << 2, _ = s[C + (c >> 3)] >> 7 - (c & 7) & 1;
        a[f] = a[f + 1] = a[f + 2] = (1 - _) * 255, a[f + 3] = 255;
      }
      if (l == 4) for (var c = 0; c < r; c++) {
        var f = m + c << 2, _ = s[C + (c >> 1)] >> 4 - 4 * (c & 1) & 15;
        a[f] = a[f + 1] = a[f + 2] = (15 - _) * 17, a[f + 3] = 255;
      }
      if (l == 8) for (var c = 0; c < r; c++) {
        var f = m + c << 2, _ = s[C + c];
        a[f] = a[f + 1] = a[f + 2] = 255 - _, a[f + 3] = 255;
      }
      if (l == 16) for (var c = 0; c < r; c++) {
        var f = m + c << 2, D = C + 2 * c, _ = s[D + 1] << 8 | s[D];
        a[f] = a[f + 1] = a[f + 2] = Math.min(255, 255 - ~~(_ * e)), a[f + 3] = 255;
      }
    }
  } else if (h == 1) {
    e == null && (e = 1 / 256);
    for (var M = (s.length & 3) == 0 ? new Float32Array(s.buffer) : null, y = 0; y < n; y++) {
      var C = y * u, m = y * r;
      if (l == 1) for (var c = 0; c < r; c++) {
        var f = m + c << 2, _ = s[C + (c >> 3)] >> 7 - (c & 7) & 1;
        a[f] = a[f + 1] = a[f + 2] = _ * 255, a[f + 3] = 255;
      }
      if (l == 2) for (var c = 0; c < r; c++) {
        var f = m + c << 2, _ = s[C + (c >> 2)] >> 6 - 2 * (c & 3) & 3;
        a[f] = a[f + 1] = a[f + 2] = _ * 85, a[f + 3] = 255;
      }
      if (l == 8) for (var c = 0; c < r; c++) {
        var f = m + c << 2, _ = s[C + c * w];
        a[f] = a[f + 1] = a[f + 2] = _, a[f + 3] = 255;
      }
      if (l == 16) for (var c = 0; c < r; c++) {
        var f = m + c << 2, D = C + 2 * c, _ = s[D + 1] << 8 | s[D];
        a[f] = a[f + 1] = a[f + 2] = Math.min(255, ~~(_ * e)), a[f + 3] = 255;
      }
      if (l == 32) for (var c = 0; c < r; c++) {
        var f = m + c << 2, D = (C >>> 2) + c, _ = M[D];
        a[f] = a[f + 1] = a[f + 2] = ~~(0.5 + 255 * _), a[f + 3] = 255;
      }
    }
  } else if (h == 2)
    if (l == 8) {
      if (w == 1) for (var c = 0; c < o; c++)
        a[4 * c] = a[4 * c + 1] = a[4 * c + 2] = s[c], a[4 * c + 3] = 255;
      if (w == 3) for (var c = 0; c < o; c++) {
        var f = c << 2, v = c * 3;
        a[f] = s[v], a[f + 1] = s[v + 1], a[f + 2] = s[v + 2], a[f + 3] = 255;
      }
      if (w >= 4) for (var c = 0; c < o; c++) {
        var f = c << 2, v = c * w;
        a[f] = s[v], a[f + 1] = s[v + 1], a[f + 2] = s[v + 2], a[f + 3] = s[v + 3];
      }
    } else if (l == 16) {
      if (w == 4) for (var c = 0; c < o; c++) {
        var f = c << 2, v = c * 8 + 1;
        a[f] = s[v], a[f + 1] = s[v + 2], a[f + 2] = s[v + 4], a[f + 3] = s[v + 6];
      }
      if (w == 3) for (var c = 0; c < o; c++) {
        var f = c << 2, v = c * 6 + 1;
        a[f] = s[v], a[f + 1] = s[v + 2], a[f + 2] = s[v + 4], a[f + 3] = 255;
      }
    } else if (l == 32) {
      for (var p = new Float32Array(s.buffer), g = 0, c = 0; c < p.length; c++) g = Math.min(g, p[c]);
      if (g < 0) for (var c = 0; c < s.length; c += 4) {
        var b = s[c];
        s[c] = s[c + 3], s[c + 3] = b, b = s[c + 1], s[c + 1] = s[c + 2], s[c + 2] = b;
      }
      for (var x = [], c = 0; c < 65536; c++) x.push(i(c / 65535));
      for (var c = 0; c < p.length; c++) {
        var T = Math.max(0, Math.min(1, p[c]));
        p[c] = x[~~(0.5 + T * 65535)];
      }
      if (w == 3) for (var c = 0; c < o; c++) {
        var f = c << 2, v = c * 3;
        a[f] = ~~(0.5 + p[v] * 255), a[f + 1] = ~~(0.5 + p[v + 1] * 255), a[f + 2] = ~~(0.5 + p[v + 2] * 255), a[f + 3] = 255;
      }
      else if (w == 4) for (var c = 0; c < o; c++) {
        var f = c << 2, v = c * 4;
        a[f] = ~~(0.5 + p[v] * 255), a[f + 1] = ~~(0.5 + p[v + 1] * 255), a[f + 2] = ~~(0.5 + p[v + 2] * 255), a[f + 3] = ~~(0.5 + p[v + 3] * 255);
      }
      else throw w;
    } else throw l;
  else if (h == 3)
    for (var U = t.t320, P = 1 << l, k = l == 8 && w > 1 && t.t338 && t.t338[0] != 0, y = 0; y < n; y++)
      for (var A = 0; A < r; A++) {
        var c = y * r + A, f = c << 2, z = 0, N = y * u;
        if (l == 1) z = s[N + (A >>> 3)] >>> 7 - (A & 7) & 1;
        else if (l == 2) z = s[N + (A >>> 2)] >>> 6 - 2 * (A & 3) & 3;
        else if (l == 4) z = s[N + (A >>> 1)] >>> 4 - 4 * (A & 1) & 15;
        else if (l == 8) z = s[N + A * w];
        else throw l;
        a[f] = U[z] >> 8, a[f + 1] = U[P + z] >> 8, a[f + 2] = U[P + P + z] >> 8, a[f + 3] = k ? s[N + A * w + 1] : 255;
      }
  else if (h == 5)
    for (var H = w > 4 ? 1 : 0, c = 0; c < o; c++) {
      var f = c << 2, S = c * w;
      if (window.UDOC) {
        var L = s[S], E = s[S + 1], I = s[S + 2], O = s[S + 3], V = UDOC.C.cmykToRgb([L * (1 / 255), E * (1 / 255), I * (1 / 255), O * (1 / 255)]);
        a[f] = ~~(0.5 + 255 * V[0]), a[f + 1] = ~~(0.5 + 255 * V[1]), a[f + 2] = ~~(0.5 + 255 * V[2]);
      } else {
        var L = 255 - s[S], E = 255 - s[S + 1], I = 255 - s[S + 2], O = (255 - s[S + 3]) * (1 / 255);
        a[f] = ~~(L * O + 0.5), a[f + 1] = ~~(E * O + 0.5), a[f + 2] = ~~(I * O + 0.5);
      }
      a[f + 3] = 255 * (1 - H) + s[S + 4] * H;
    }
  else if (h == 6 && t.t278)
    for (var G = t.t278[0], y = 0; y < n; y += G)
      for (var c = y * r, j = G * r, B = 0; B < j; B++) {
        var f = 4 * (c + B), S = 3 * c + 4 * (B >>> 1), I = s[S + (B & 1)], R = s[S + 2] - 128, K = s[S + 3] - 128, ie = I + ((K >> 2) + (K >> 3) + (K >> 5)), Y = I - ((R >> 2) + (R >> 4) + (R >> 5)) - ((K >> 1) + (K >> 3) + (K >> 4) + (K >> 5)), Q = I + (R + (R >> 1) + (R >> 2) + (R >> 6));
        a[f] = Math.max(0, Math.min(255, ie)), a[f + 1] = Math.max(0, Math.min(255, Y)), a[f + 2] = Math.max(0, Math.min(255, Q)), a[f + 3] = 255;
      }
  else if (h == 32845)
    for (var y = 0; y < n; y++)
      for (var A = 0; A < r; A++) {
        var S = (y * r + A) * 6, f = (y * r + A) * 4, te = s[S + 1] << 8 | s[S], te = Math.pow(2, (te + 0.5) / 256 - 64), Z = (s[S + 3] + 0.5) / 410, $ = (s[S + 5] + 0.5) / 410, J = 9 * Z / (6 * Z - 16 * $ + 12), q = 4 * $ / (6 * Z - 16 * $ + 12), X = te, ae = J * X / q, I = X, de = (1 - J - q) * X / q, ie = 2.69 * ae - 1.276 * I - 0.414 * de, Y = -1.022 * ae + 1.978 * I + 0.044 * de, Q = 0.061 * ae - 0.224 * I + 1.163 * de;
        a[f] = i(Math.min(ie, 1)) * 255, a[f + 1] = i(Math.min(Y, 1)) * 255, a[f + 2] = i(Math.min(Q, 1)) * 255, a[f + 3] = 255;
      }
  else log("Unknown Photometric interpretation: " + h);
  return a;
};
F.replaceIMG = function(t) {
  t == null && (t = document.getElementsByTagName("img"));
  for (var e = ["tif", "tiff", "dng", "cr2", "nef"], i = 0; i < t.length; i++) {
    var r = t[i], n = r.getAttribute("src");
    if (n != null) {
      var o = n.split(".").pop().toLowerCase();
      if (e.indexOf(o) != -1) {
        var s = new XMLHttpRequest();
        F._xhrs.push(s), F._imgs.push(r), s.open("GET", n), s.responseType = "arraybuffer", s.onload = F._imgLoaded, s.send();
      }
    }
  }
};
F._xhrs = [];
F._imgs = [];
F._imgLoaded = function(t) {
  var e = F._xhrs.indexOf(t.target), i = F._imgs[e];
  F._xhrs.splice(e, 1), F._imgs.splice(e, 1), i.setAttribute("src", F.bufferToURI(t.target.response));
};
F.bufferToURI = function(t) {
  var e = F.decode(t), i = e, r = 0, n = i[0];
  e[0].subIFD && (i = i.concat(e[0].subIFD));
  for (var o = 0; o < i.length; o++) {
    var s = i[o];
    if (!(s.t258 == null || s.t258.length < 3)) {
      var a = s.t256 * s.t257;
      a > r && (r = a, n = s);
    }
  }
  F.decodeImage(t, n, e);
  var h = F.toRGBA8(n), l = n.width, w = n.height, d = document.createElement("canvas");
  d.width = l, d.height = w;
  var u = d.getContext("2d"), y = new ImageData(new Uint8ClampedArray(h.buffer), l, w);
  return u.putImageData(y, 0, 0), d.toDataURL();
};
F._binBE = {
  nextZero: function(t, e) {
    for (; t[e] != 0; ) e++;
    return e;
  },
  readUshort: function(t, e) {
    return t[e] << 8 | t[e + 1];
  },
  readShort: function(t, e) {
    var i = F._binBE.ui8;
    return i[0] = t[e + 1], i[1] = t[e + 0], F._binBE.i16[0];
  },
  readInt: function(t, e) {
    var i = F._binBE.ui8;
    return i[0] = t[e + 3], i[1] = t[e + 2], i[2] = t[e + 1], i[3] = t[e + 0], F._binBE.i32[0];
  },
  readUint: function(t, e) {
    var i = F._binBE.ui8;
    return i[0] = t[e + 3], i[1] = t[e + 2], i[2] = t[e + 1], i[3] = t[e + 0], F._binBE.ui32[0];
  },
  readASCII: function(t, e, i) {
    for (var r = "", n = 0; n < i; n++) r += String.fromCharCode(t[e + n]);
    return r;
  },
  readFloat: function(t, e) {
    for (var i = F._binBE.ui8, r = 0; r < 4; r++) i[r] = t[e + 3 - r];
    return F._binBE.fl32[0];
  },
  readDouble: function(t, e) {
    for (var i = F._binBE.ui8, r = 0; r < 8; r++) i[r] = t[e + 7 - r];
    return F._binBE.fl64[0];
  },
  writeUshort: function(t, e, i) {
    t[e] = i >> 8 & 255, t[e + 1] = i & 255;
  },
  writeInt: function(t, e, i) {
    var r = F._binBE.ui8;
    F._binBE.i32[0] = i, t[e + 3] = r[0], t[e + 2] = r[1], t[e + 1] = r[2], t[e + 0] = r[3];
  },
  writeUint: function(t, e, i) {
    t[e] = i >> 24 & 255, t[e + 1] = i >> 16 & 255, t[e + 2] = i >> 8 & 255, t[e + 3] = i >> 0 & 255;
  },
  writeASCII: function(t, e, i) {
    for (var r = 0; r < i.length; r++) t[e + r] = i.charCodeAt(r);
  },
  writeDouble: function(t, e, i) {
    F._binBE.fl64[0] = i;
    for (var r = 0; r < 8; r++) t[e + r] = F._binBE.ui8[7 - r];
  }
};
F._binBE.ui8 = new Uint8Array(8);
F._binBE.i16 = new Int16Array(F._binBE.ui8.buffer);
F._binBE.i32 = new Int32Array(F._binBE.ui8.buffer);
F._binBE.ui32 = new Uint32Array(F._binBE.ui8.buffer);
F._binBE.fl32 = new Float32Array(F._binBE.ui8.buffer);
F._binBE.fl64 = new Float64Array(F._binBE.ui8.buffer);
F._binLE = {
  nextZero: F._binBE.nextZero,
  readUshort: function(t, e) {
    return t[e + 1] << 8 | t[e];
  },
  readShort: function(t, e) {
    var i = F._binBE.ui8;
    return i[0] = t[e + 0], i[1] = t[e + 1], F._binBE.i16[0];
  },
  readInt: function(t, e) {
    var i = F._binBE.ui8;
    return i[0] = t[e + 0], i[1] = t[e + 1], i[2] = t[e + 2], i[3] = t[e + 3], F._binBE.i32[0];
  },
  readUint: function(t, e) {
    var i = F._binBE.ui8;
    return i[0] = t[e + 0], i[1] = t[e + 1], i[2] = t[e + 2], i[3] = t[e + 3], F._binBE.ui32[0];
  },
  readASCII: F._binBE.readASCII,
  readFloat: function(t, e) {
    for (var i = F._binBE.ui8, r = 0; r < 4; r++) i[r] = t[e + r];
    return F._binBE.fl32[0];
  },
  readDouble: function(t, e) {
    for (var i = F._binBE.ui8, r = 0; r < 8; r++) i[r] = t[e + r];
    return F._binBE.fl64[0];
  },
  writeUshort: function(t, e, i) {
    t[e] = i & 255, t[e + 1] = i >> 8 & 255;
  },
  writeInt: function(t, e, i) {
    var r = F._binBE.ui8;
    F._binBE.i32[0] = i, t[e + 0] = r[0], t[e + 1] = r[1], t[e + 2] = r[2], t[e + 3] = r[3];
  },
  writeUint: function(t, e, i) {
    t[e] = i >>> 0 & 255, t[e + 1] = i >>> 8 & 255, t[e + 2] = i >>> 16 & 255, t[e + 3] = i >>> 24 & 255;
  },
  writeASCII: F._binBE.writeASCII
};
F._copyTile = function(t, e, i, r, n, o, s, a) {
  for (var h = Math.min(e, n - s), l = Math.min(i, o - a), w = 0; w < l; w++)
    for (var d = (a + w) * n + s, u = w * e, y = 0; y < h; y++) r[d + y] = t[u + y];
};
F._inflateRaw = (function() {
  var t = {};
  return t.H = {}, t.H.N = function(e, i) {
    var r = Uint8Array, n = 0, o = 0, s = 0, a = 0, h = 0, l = 0, w = 0, d = 0, u = 0, y, C;
    if (e[0] == 3 && e[1] == 0) return i || new r(0);
    var m = t.H, c = m.b, f = m.e, _ = m.R, D = m.n, M = m.A, v = m.Z, p = m.m, g = i == null;
    for (g && (i = new r(e.length >>> 2 << 5)); n == 0; ) {
      if (n = c(e, u, 1), o = c(e, u + 1, 2), u += 3, o == 0) {
        (u & 7) != 0 && (u += 8 - (u & 7));
        var b = (u >>> 3) + 4, x = e[b - 4] | e[b - 3] << 8;
        g && (i = t.H.W(i, d + x)), i.set(new r(e.buffer, e.byteOffset + b, x), d), u = b + x << 3, d += x;
        continue;
      }
      if (g && (i = t.H.W(i, d + (1 << 17))), o == 1 && (y = p.J, C = p.h, l = 511, w = 31), o == 2) {
        s = f(e, u, 5) + 257, a = f(e, u + 5, 5) + 1, h = f(e, u + 10, 4) + 4, u += 14;
        for (var T = 1, U = 0; U < 38; U += 2)
          p.Q[U] = 0, p.Q[U + 1] = 0;
        for (var U = 0; U < h; U++) {
          var P = f(e, u + U * 3, 3);
          p.Q[(p.X[U] << 1) + 1] = P, P > T && (T = P);
        }
        u += 3 * h, D(p.Q, T), M(p.Q, T, p.u), y = p.w, C = p.d, u = _(p.u, (1 << T) - 1, s + a, e, u, p.v);
        var k = m.V(p.v, 0, s, p.C);
        l = (1 << k) - 1;
        var A = m.V(p.v, s, a, p.D);
        w = (1 << A) - 1, D(p.C, k), M(p.C, k, y), D(p.D, A), M(p.D, A, C);
      }
      for (; ; ) {
        var z = y[v(e, u) & l];
        u += z & 15;
        var N = z >>> 4;
        if (!(N >>> 8))
          i[d++] = N;
        else {
          if (N == 256)
            break;
          var H = d + N - 254;
          if (N > 264) {
            var S = p.q[N - 257];
            H = d + (S >>> 3) + f(e, u, S & 7), u += S & 7;
          }
          var L = C[v(e, u) & w];
          u += L & 15;
          var E = L >>> 4, I = p.c[E], O = (I >>> 4) + c(e, u, I & 15);
          for (u += I & 15; d < H; )
            i[d] = i[d++ - O], i[d] = i[d++ - O], i[d] = i[d++ - O], i[d] = i[d++ - O];
          d = H;
        }
      }
    }
    return i.length == d ? i : i.slice(0, d);
  }, t.H.W = function(e, i) {
    var r = e.length;
    if (i <= r) return e;
    var n = new Uint8Array(r << 1);
    return n.set(e, 0), n;
  }, t.H.R = function(e, i, r, n, o, s) {
    for (var a = t.H.e, h = t.H.Z, l = 0; l < r; ) {
      var w = e[h(n, o) & i];
      o += w & 15;
      var d = w >>> 4;
      if (d <= 15)
        s[l] = d, l++;
      else {
        var u = 0, y = 0;
        d == 16 ? (y = 3 + a(n, o, 2), o += 2, u = s[l - 1]) : d == 17 ? (y = 3 + a(n, o, 3), o += 3) : d == 18 && (y = 11 + a(n, o, 7), o += 7);
        for (var C = l + y; l < C; )
          s[l] = u, l++;
      }
    }
    return o;
  }, t.H.V = function(e, i, r, n) {
    for (var o = 0, s = 0, a = n.length >>> 1; s < r; ) {
      var h = e[s + i];
      n[s << 1] = 0, n[(s << 1) + 1] = h, h > o && (o = h), s++;
    }
    for (; s < a; )
      n[s << 1] = 0, n[(s << 1) + 1] = 0, s++;
    return o;
  }, t.H.n = function(e, i) {
    for (var r = t.H.m, n = e.length, o, s, a, h, l, w = r.j, h = 0; h <= i; h++) w[h] = 0;
    for (h = 1; h < n; h += 2) w[e[h]]++;
    var d = r.K;
    for (o = 0, w[0] = 0, s = 1; s <= i; s++)
      o = o + w[s - 1] << 1, d[s] = o;
    for (a = 0; a < n; a += 2)
      l = e[a + 1], l != 0 && (e[a] = d[l], d[l]++);
  }, t.H.A = function(e, i, r) {
    for (var n = e.length, o = t.H.m, s = o.r, a = 0; a < n; a += 2) if (e[a + 1] != 0)
      for (var h = a >> 1, l = e[a + 1], w = h << 4 | l, d = i - l, u = e[a] << d, y = u + (1 << d); u != y; ) {
        var C = s[u] >>> 15 - i;
        r[C] = w, u++;
      }
  }, t.H.l = function(e, i) {
    for (var r = t.H.m.r, n = 15 - i, o = 0; o < e.length; o += 2) {
      var s = e[o] << i - e[o + 1];
      e[o] = r[s] >>> n;
    }
  }, t.H.M = function(e, i, r) {
    r = r << (i & 7);
    var n = i >>> 3;
    e[n] |= r, e[n + 1] |= r >>> 8;
  }, t.H.I = function(e, i, r) {
    r = r << (i & 7);
    var n = i >>> 3;
    e[n] |= r, e[n + 1] |= r >>> 8, e[n + 2] |= r >>> 16;
  }, t.H.e = function(e, i, r) {
    return (e[i >>> 3] | e[(i >>> 3) + 1] << 8) >>> (i & 7) & (1 << r) - 1;
  }, t.H.b = function(e, i, r) {
    return (e[i >>> 3] | e[(i >>> 3) + 1] << 8 | e[(i >>> 3) + 2] << 16) >>> (i & 7) & (1 << r) - 1;
  }, t.H.Z = function(e, i) {
    return (e[i >>> 3] | e[(i >>> 3) + 1] << 8 | e[(i >>> 3) + 2] << 16) >>> (i & 7);
  }, t.H.i = function(e, i) {
    return (e[i >>> 3] | e[(i >>> 3) + 1] << 8 | e[(i >>> 3) + 2] << 16 | e[(i >>> 3) + 3] << 24) >>> (i & 7);
  }, t.H.m = (function() {
    var e = Uint16Array, i = Uint32Array;
    return { K: new e(16), j: new e(16), X: [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15], S: [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 999, 999, 999], T: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0, 0], q: new e(32), p: [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577, 65535, 65535], z: [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 0, 0], c: new i(32), J: new e(512), _: [], h: new e(32), $: [], w: new e(32768), C: [], v: [], d: new e(32768), D: [], u: new e(512), Q: [], r: new e(32768), s: new i(286), Y: new i(30), a: new i(19), t: new i(15e3), k: new e(65536), g: new e(32768) };
  })(), (function() {
    for (var e = t.H.m, i = 32768, r = 0; r < i; r++) {
      var n = r;
      n = (n & 2863311530) >>> 1 | (n & 1431655765) << 1, n = (n & 3435973836) >>> 2 | (n & 858993459) << 2, n = (n & 4042322160) >>> 4 | (n & 252645135) << 4, n = (n & 4278255360) >>> 8 | (n & 16711935) << 8, e.r[r] = (n >>> 16 | n << 16) >>> 17;
    }
    function o(s, a, h) {
      for (; a-- != 0; ) s.push(0, h);
    }
    for (var r = 0; r < 32; r++)
      e.q[r] = e.S[r] << 3 | e.T[r], e.c[r] = e.p[r] << 4 | e.z[r];
    o(e._, 144, 8), o(e._, 112, 9), o(e._, 24, 7), o(e._, 8, 8), t.H.n(e._, 9), t.H.A(e._, 9, e.J), t.H.l(e._, 9), o(e.$, 32, 5), t.H.n(e.$, 5), t.H.A(e.$, 5, e.h), t.H.l(e.$, 5), o(e.Q, 19, 0), o(e.C, 286, 0), o(e.D, 30, 0), o(e.v, 320, 0);
  })(), t.H.N;
})();
F.LosslessJpegDecode = /* @__PURE__ */ (function() {
  var t, e;
  function i() {
    return t[e++];
  }
  function r() {
    return t[e++] << 8 | t[e++];
  }
  function n(c) {
    for (var f = i(), _ = [0, 0, 0, 255], D = [], M = 8, v = 0; v < 16; v++) D[v] = i();
    for (var v = 0; v < 16; v++)
      for (var p = 0; p < D[v]; p++) {
        var g = o(_, 0, v + 1, 1);
        _[g + 3] = i();
      }
    var b = new Uint8Array(1 << M);
    c[f] = [new Uint8Array(_), b];
    for (var v = 0; v < 1 << M; v++) {
      for (var x = M, T = v, U = 0, P = 0; _[U + 3] == 255 && x != 0; )
        P = T >> --x & 1, U = _[U + P];
      b[v] = U;
    }
  }
  function o(c, f, _, D) {
    if (c[f + 3] != 255) return 0;
    if (_ == 0) return f;
    for (var M = 0; M < 2; M++) {
      c[f + M] == 0 && (c[f + M] = c.length, c.push(0, 0, D, 255));
      var v = o(c, c[f + M], _ - 1, D + 1);
      if (v != 0) return v;
    }
    return 0;
  }
  function s(c) {
    for (var f = c.b, _ = c.f; f < 25 && c.a < c.d; ) {
      var D = c.data[c.a++];
      D == 255 && !c.c && c.a++, _ = _ << 8 | D, f += 8;
    }
    if (f < 0) throw "e";
    c.b = f, c.f = _;
  }
  function a(c, f) {
    return f.b < c && s(f), f.f >> (f.b -= c) & 65535 >> 16 - c;
  }
  function h(c, f) {
    var _ = c[0], D = 0, M = 255, v = 0;
    f.b < 16 && s(f);
    var p = f.f >> f.b - 8 & 255;
    for (D = c[1][p], M = _[D + 3], f.b -= _[D + 2]; M == 255; )
      v = f.f >> --f.b & 1, D = _[D + v], M = _[D + 3];
    return M;
  }
  function l(c, f) {
    return c < 32768 >> 16 - f && (c += -(1 << f) + 1), c;
  }
  function w(c, f) {
    var _ = h(c, f);
    if (_ == 0) return 0;
    if (_ == 16) return -32768;
    var D = a(_, f);
    return l(D, _);
  }
  function d(c, f, _, D, M, v) {
    for (var p = 0, g = 0; g < v; g++) {
      for (var b = g * f, x = 0; x < f; x += M) {
        p++;
        for (var T = 0; T < M; T++) c[b + x + T] = w(D[T], _);
      }
      if (_.e != 0 && p % _.e == 0 && g != 0) {
        for (var U = _.a, P = _.data; P[U] != 255 || !(208 <= P[U + 1] && P[U + 1] <= 215); ) U--;
        _.a = U + 2, _.f = 0, _.b = 0;
      }
    }
  }
  function u(c, f) {
    return l(a(c, f), c);
  }
  function y(c, f, _, D, M) {
    for (var v = t.length - e, p = 0; p < v; p += 4) {
      var g = t[e + p];
      t[e + p] = t[e + p + 3], t[e + p + 3] = g;
      var g = t[e + p + 1];
      t[e + p + 1] = t[e + p + 2], t[e + p + 2] = g;
    }
    for (var b = 0; b < M; b++)
      for (var x = 32768, T = 32768, U = 0; U < f; U += 2) {
        var P = h(D, _), k = h(D, _);
        P != 0 && (x += u(P, _)), k != 0 && (T += u(k, _)), c[b * f + U] = x & 65535, c[b * f + U + 1] = T & 65535;
      }
  }
  function C(c) {
    if (t = c, e = 0, r() != 65496) throw "e";
    for (var f = [], _ = 0, D = 0, M = 0, v = [], p = [], g = [], b = 0, x = 0, T = 0; ; ) {
      var U = r();
      if (U == 65535) {
        e--;
        continue;
      }
      var P = r();
      if (U == 65475) {
        D = i(), x = r(), T = r(), b = i();
        for (var k = 0; k < b; k++) {
          var A = i(), z = i(), N = i();
          if (N != 0) throw "e";
          f[A] = [k, z >> 4, z & 15];
        }
      } else if (U == 65476)
        for (var H = e + P - 2; e < H; ) n(p);
      else if (U == 65498) {
        e++;
        for (var k = 0; k < b; k++) {
          var S = i(), L = f[S];
          g[L[0]] = p[i() >>> 4], v[L[0]] = L.slice(1);
        }
        _ = i(), e += 2;
        break;
      } else U == 65501 ? M = r() : e += P - 2;
    }
    var E = D > 8 ? Uint16Array : Uint8Array, I = new E(x * T * b), O = { b: 0, f: 0, c: _ == 8, a: e, data: t, d: t.length, e: M };
    if (O.c) y(I, T * b, O, g[0], x);
    else {
      for (var V = [], G = 0, j = 0, k = 0; k < b; k++) {
        var B = v[k], R = B[0], K = B[1];
        R > G && (G = R), K > j && (j = K), V.push(R * K);
      }
      if (G != 1 || j != 1) {
        if (b != 3 || V[1] != 1 || V[2] != 1 || G != 2 || j != 1 && j != 2) throw "e";
        for (var ie = [], Y = 0, k = 0; k < b; k++) {
          for (var Q = 0; Q < V[k]; Q++) ie.push(g[k]);
          Y += V[k];
        }
        var te = T / G, Z = x / j, $ = te * Z;
        d(I, te * Y, O, ie, Y, Z), m(I, _, te, Z, Y - 2, Y, Y, D);
        var J = new Uint16Array($ * V[0]);
        if (G == 2 && j == 2) {
          for (var k = 0; k < $; k++)
            J[4 * k] = I[6 * k], J[4 * k + 1] = I[6 * k + 1], J[4 * k + 2] = I[6 * k + 2], J[4 * k + 3] = I[6 * k + 3];
          m(J, _, te * 4, Z, 0, 1, 1, D);
          for (var k = 0; k < $; k++)
            I[6 * k] = J[4 * k], I[6 * k + 1] = J[4 * k + 1], I[6 * k + 2] = J[4 * k + 2], I[6 * k + 3] = J[4 * k + 3];
        }
        if (G == 2 && j == 1) {
          for (var k = 0; k < $; k++)
            J[2 * k] = I[4 * k], J[2 * k + 1] = I[4 * k + 1];
          m(J, _, te * 2, Z, 0, 1, 1, D);
          for (var k = 0; k < $; k++)
            I[4 * k] = J[2 * k], I[4 * k + 1] = J[2 * k + 1];
        }
        for (var q = I.slice(0), K = 0; K < x; K++)
          if (j == 2) for (var R = 0; R < T; R++) {
            var X = (K * T + R) * b, ae = ((K >>> 1) * te + (R >>> 1)) * Y, de = (K & 1) * 2 + (R & 1);
            I[X] = q[ae + de], I[X + 1] = q[ae + 4], I[X + 2] = q[ae + 5];
          }
          else for (var R = 0; R < T; R++) {
            var X = (K * T + R) * b, ae = (K * te + (R >>> 1)) * Y, de = R & 1;
            I[X] = q[ae + de], I[X + 1] = q[ae + 2], I[X + 2] = q[ae + 3];
          }
      } else if (d(I, T * b, O, g, b, x), M == 0) m(I, _, T, x, 0, b, b, D);
      else
        for (var ve = Math.floor(M / T), K = 0; K < x; K += ve) {
          var Me = I.slice(K * T * b, (K + ve) * T * b);
          m(Me, _, T, ve, 0, b, b, D), I.set(Me, K * T * b);
        }
    }
    return I;
  }
  function m(c, f, _, D, M, v, p, g) {
    for (var b = _ * p, x = M; x < v; x++) c[x] += 1 << g - 1;
    for (var T = p; T < b; T += p) for (var x = M; x < v; x++) c[T + x] += c[T + x - p];
    for (var U = 1; U < D; U++) {
      for (var P = U * b, x = M; x < v; x++) c[P + x] += c[P + x - b];
      for (var T = p; T < b; T += p)
        for (var x = M; x < v; x++) {
          var k = P + T + x, A = k - b, z = c[k - p], N = 0;
          if (f == 0) N = 0;
          else if (f == 1) N = z;
          else if (f == 2) N = c[A];
          else if (f == 3) N = c[A - p];
          else if (f == 4) N = z + (c[A] - c[A - p]);
          else if (f == 5) N = z + (c[A] - c[A - p] >>> 1);
          else if (f == 6) N = c[A] + (z - c[A - p] >>> 1);
          else if (f == 7) N = z + c[A] >>> 1;
          else throw f;
          c[k] += N;
        }
    }
  }
  return C;
})();
(function() {
  var t = 0, e = 1, i = 2, r = 3, n = 4, o = 5, s = 6, a = 7, h = 8, l = 9, w = 10, d = 11, u = 12, y = 13, C = 14, m = 15, c = 16, f = 17, _ = 18;
  function D(S) {
    var L = F._binBE.readUshort, E = { b: L(S, 0), i: S[2], C: S[3], u: S[4], q: L(S, 5), k: L(S, 7), e: L(S, 9), l: L(S, 11), s: S[13], d: L(S, 14) };
    if (E.b != 18771 || E.i > 1 || E.q < 6 || E.q % 6 || E.e < 768 || E.e % 24 || E.l != 768 || E.k < E.l || E.k % E.l || E.k - E.e >= E.l || E.s > 16 || E.s != E.k / E.l || E.s != Math.ceil(E.e / E.l) || E.d != E.q / 6 || E.u != 12 && E.u != 14 && E.u != 16 || E.C != 16 && E.C != 0)
      throw "Invalid data";
    if (E.i == 0)
      throw "Not implemented. We need this file!";
    return E.h = E.C == 16, E.m = (E.h ? E.l * 2 / 3 : E.l >>> 1) | 0, E.A = E.m + 2, E.f = 64, E.g = (1 << E.u) - 1, E.n = 4 * E.u, E;
  }
  function M(S, L) {
    var E = new Array(L.s), I = 4 * L.s, O = 16 + I;
    I & 12 && (O += 16 - (I & 12));
    for (var V = 0, G = 16; V < L.s; G += 4) {
      var j = F._binBE.readUint(S, G);
      E[V] = S.slice(O, O + j), E[V].j = 0, E[V].a = 0, O += j, V++;
    }
    if (O != S.length) throw "Invalid data";
    return E;
  }
  function v(S, L) {
    for (var E = -L[4], I = 0; E <= L[4]; I++, E++)
      S[I] = E <= -276 ? -4 : E <= -67 ? -3 : E <= -18 ? -2 : E < -0 ? -1 : E <= L[0] ? 0 : E < L[1] ? 1 : E < L[2] ? 2 : E < L[3] ? 3 : 4;
  }
  function p(S, L, E) {
    var I = [L, 3 * L + 18, 5 * L + 67, 7 * L + 276, E];
    S.o = L, S.w = (I[4] + 2 * L) / (2 * L + 1) + 1 | 0, S.v = Math.ceil(Math.log2(S.w)), S.t = 9, v(S.c, I);
  }
  function g(S) {
    var L = { c: new Int8Array(2 << S.u) };
    return p(L, 0, S.g), L;
  }
  function b(S) {
    for (var L = [[], [], []], E = Math.max(2, S.w + 32 >>> 6), I = 0; I < 3; I++)
      for (var O = 0; O < 41; O++)
        L[I][O] = [E, 1];
    return L;
  }
  function x(S) {
    for (var L = -1, E = 0; !E; L++)
      E = S[S.j] >>> 7 - S.a & 1, S.a++, S.a &= 7, S.a || S.j++;
    return L;
  }
  function T(S, L) {
    var E = 0, I = 8 - S.a;
    if (S.j, S.a, L) {
      if (L >= I)
        do
          E <<= I, L -= I, E |= S[S.j] & (1 << I) - 1, S.j++, I = 8;
        while (L >= 8);
      L && (E <<= L, I -= L, E |= S[S.j] >>> I & (1 << L) - 1), S.a = 8 - I;
    }
    return E;
  }
  function U(S, L) {
    var E = 0;
    if (L < S)
      for (; E <= 14 && L << ++E < S; ) ;
    return E;
  }
  function P(S, L, E, I, O, V, G, j) {
    j == null && (j = 0);
    var B = V + 1, R = B % 2, K = 0, ie, Y, Q = I[O], te = I[O - 1], Z = I[O - 2][B], $ = te[B - 1], J = te[B], q = te[B + 1], X = Q[B - 1], ae = Q[B + 1], de = Math.abs, ve, Me, ne, fe;
    if (R && (ve = de(q - J), Me = de(Z - J), ne = de($ - J)), R) {
      if (fe = ve > ne && Me < ve ? Z + $ : ve < ne && Me < ne ? Z + q : q + $, fe = fe + 2 * J >>> 2, j) {
        Q[B] = fe;
        return;
      }
      ie = L.t * L.c[S.g + J - Z] + L.c[S.g + $ - J];
    } else
      fe = J > $ && J > q || J < $ && J < q ? ae + X + 2 * J >>> 2 : X + ae >>> 1, ie = L.t * L.c[S.g + J - $] + L.c[S.g + $ - X];
    Y = de(ie);
    var Te = x(E);
    if (Te < S.n - L.v - 1) {
      var ye = U(G[Y][0], G[Y][1]);
      K = T(E, ye) + (Te << ye);
    } else
      K = T(E, L.v) + 1;
    K = K & 1 ? -1 - (K >>> 1) : K >>> 1, G[Y][0] += de(K), G[Y][1] == S.f && (G[Y][0] >>>= 1, G[Y][1] >>>= 1), G[Y][1]++, fe = ie < 0 ? fe - K : fe + K, S.i && (fe < 0 ? fe += L.w : fe > S.g && (fe -= L.w)), Q[B] = fe >= 0 ? Math.min(fe, S.g) : 0;
  }
  function k(S, L, E) {
    for (var I = S[0].length, O = L; O <= E; O++)
      S[O][0] = S[O - 1][1], S[O][I - 1] = S[O - 1][I - 2];
  }
  function A(S) {
    k(S, a, u), k(S, i, n), k(S, m, f);
  }
  function z(S, L, E, I, O, V, G, j, B, R, K, ie, Y) {
    for (var Q = 0, te = 1, Z = O < y && O > n; te < S.m; )
      Q < S.m && (P(S, L, E, I, O, Q, G[B], S.h && (Z && R || !Z && (K || (Q & ie) == Y))), P(S, L, E, I, V, Q, G[B], S.h && (!Z && R || Z && (K || (Q & ie) == Y))), Q += 2), Q > 8 && (P(S, L, E, I, O, te, j[B]), P(S, L, E, I, V, te, j[B]), te += 2);
    A(I);
  }
  function N(S, L, E, I, O, V) {
    z(S, L, E, I, i, a, O, V, 0, 0, 1, 0, 8), z(S, L, E, I, h, m, O, V, 1, 0, 1, 0, 8), z(S, L, E, I, r, l, O, V, 2, 1, 0, 3, 0), z(S, L, E, I, w, c, O, V, 0, 0, 0, 3, 2), z(S, L, E, I, n, d, O, V, 1, 0, 0, 3, 2), z(S, L, E, I, u, f, O, V, 2, 1, 0, 3, 0);
  }
  function H(S, L, E, I, O, V) {
    var G = V.length, j = S.l;
    O + 1 == S.s && (j = S.e - O * S.l);
    for (var B = 6 * S.e * I + O * S.l, R = 0; R < 6; R++) {
      for (var K = 0; K < j; K++) {
        var ie = V[R % G][K % G], Y;
        ie == 0 ? Y = i + (R >>> 1) : ie == 2 ? Y = m + (R >>> 1) : Y = a + R;
        var Q = S.h ? (K * 2 / 3 & 2147483646 | K % 3 & 1) + (K % 3 >>> 1) : K >>> 1;
        L[B + K] = E[Y][Q + 1];
      }
      B += S.e;
    }
  }
  F._decompressRAF = function(S, L) {
    var E = D(S), I = M(S, E), O = g(E), V = new Int16Array(E.e * E.q);
    L == null && (L = E.h ? [[1, 1, 0, 1, 1, 2], [1, 1, 2, 1, 1, 0], [2, 0, 1, 0, 2, 1], [1, 1, 2, 1, 1, 0], [1, 1, 0, 1, 1, 2], [0, 2, 1, 2, 0, 1]] : [[0, 1], [3, 2]]);
    for (var G = [[t, r], [e, n], [o, d], [s, u], [y, c], [C, f]], j = [], B = 0; B < _; B++)
      j[B] = new Uint16Array(E.A);
    for (var R = 0; R < E.s; R++) {
      for (var K = b(O), ie = b(O), B = 0; B < _; B++)
        for (var Y = 0; Y < E.A; Y++)
          j[B][Y] = 0;
      for (var Q = 0; Q < E.d; Q++) {
        N(E, O, I[R], j, K, ie);
        for (var B = 0; B < 6; B++)
          for (var Y = 0; Y < E.A; Y++)
            j[G[B][0]][Y] = j[G[B][1]][Y];
        H(E, V, j, Q, R, L);
        for (var B = i; B < _; B++)
          if ([o, s, y, C].indexOf(B) == -1)
            for (var Y = 0; Y < E.A; Y++)
              j[B][Y] = 0;
        A(j);
      }
    }
    return V;
  };
})();
class as {
  constructor() {
    this.info = {
      author: "chaoxl",
      version: Ie,
      description: "TIF DEM terrain loader."
    }, this.dataType = "single-tif", this._loader = new Lt(at.manager), this._loader.setResponseType("arraybuffer");
  }
  /**
   * 加载瓦片几何体
   * @param params 加载参数（数据源、瓦片边界、缩放级别）
   * @returns 瓦片几何体
   */
  async load(e) {
    const { source: i, z: r, bounds: n } = e, o = new Ri(), s = i.getUrl(0, 0, 0);
    if (r < i.minLevel || !s)
      return o;
    const a = Be.clamp((e.z + 2) * 3, 2, 256);
    if (!i.data) {
      i._loadingPromise || (i._loadingPromise = this._loader.loadAsync(s));
      try {
        const l = await i._loadingPromise;
        i.data = this.getTIFFRaster(l);
      } catch (l) {
        throw i._loadingPromise = void 0, l;
      }
    }
    const h = Pr(i.data, i._projectionBounds, n, a, a);
    return o.setData(h, r);
  }
  /**
   * 从 ArrayBuffer 解析 TIFF 栅格数据
   * @param buffer TIFF 文件数据
   * @returns 栅格数据（高程、宽、高）
   */
  getTIFFRaster(e) {
    const i = F.decode(e)[0];
    return F.decodeImage(e, i), {
      dem: new Float32Array(i.data.buffer),
      width: i.width,
      height: i.height
    };
  }
}
class hs extends pe {
  constructor() {
    super(...arguments), this.dataType = "single-tif";
  }
}
function Mt(t, e, i, r) {
  let n = r;
  const o = e + (i - e >> 1);
  let s = i - e, a;
  const h = t[e], l = t[e + 1], w = t[i], d = t[i + 1];
  for (let u = e + 3; u < i; u += 3) {
    const y = Dr(t[u], t[u + 1], h, l, w, d);
    if (y > n)
      a = u, n = y;
    else if (y === n) {
      const C = Math.abs(u - o);
      C < s && (a = u, s = C);
    }
  }
  n > r && (a - e > 3 && Mt(t, e, a, r), t[a + 2] = n, i - a > 3 && Mt(t, a, i, r));
}
function Dr(t, e, i, r, n, o) {
  let s = n - i, a = o - r;
  if (s !== 0 || a !== 0) {
    const h = ((t - i) * s + (e - r) * a) / (s * s + a * a);
    h > 1 ? (i = n, r = o) : h > 0 && (i += s * h, r += a * h);
  }
  return s = t - i, a = e - r, s * s + a * a;
}
function $e(t, e, i, r) {
  const n = {
    id: t ?? null,
    type: e,
    geometry: i,
    tags: r,
    minX: 1 / 0,
    minY: 1 / 0,
    maxX: -1 / 0,
    maxY: -1 / 0
  };
  if (e === "Point" || e === "MultiPoint" || e === "LineString")
    tt(n, i);
  else if (e === "Polygon")
    tt(n, i[0]);
  else if (e === "MultiLineString")
    for (const o of i)
      tt(n, o);
  else if (e === "MultiPolygon")
    for (const o of i)
      tt(n, o[0]);
  return n;
}
function tt(t, e) {
  for (let i = 0; i < e.length; i += 3)
    t.minX = Math.min(t.minX, e[i]), t.minY = Math.min(t.minY, e[i + 1]), t.maxX = Math.max(t.maxX, e[i]), t.maxY = Math.max(t.maxY, e[i + 1]);
}
function kr(t, e) {
  const i = [];
  if (t.type === "FeatureCollection")
    for (let r = 0; r < t.features.length; r++)
      nt(i, t.features[r], e, r);
  else t.type === "Feature" ? nt(i, t, e) : nt(i, { geometry: t }, e);
  return i;
}
function nt(t, e, i, r) {
  if (!e.geometry) return;
  const n = e.geometry.coordinates;
  if (n && n.length === 0) return;
  const o = e.geometry.type, s = Math.pow(i.tolerance / ((1 << i.maxZoom) * i.extent), 2);
  let a = [], h = e.id;
  if (i.promoteId ? h = e.properties[i.promoteId] : i.generateId && (h = r || 0), o === "Point")
    qt(n, a);
  else if (o === "MultiPoint")
    for (const l of n)
      qt(l, a);
  else if (o === "LineString")
    St(n, a, s, !1);
  else if (o === "MultiLineString")
    if (i.lineMetrics) {
      for (const l of n)
        a = [], St(l, a, s, !1), t.push($e(h, "LineString", a, e.properties));
      return;
    } else
      pt(n, a, s, !1);
  else if (o === "Polygon")
    pt(n, a, s, !0);
  else if (o === "MultiPolygon")
    for (const l of n) {
      const w = [];
      pt(l, w, s, !0), a.push(w);
    }
  else if (o === "GeometryCollection") {
    for (const l of e.geometry.geometries)
      nt(t, {
        id: h,
        geometry: l,
        properties: e.properties
      }, i, r);
    return;
  } else
    throw new Error("Input data is not a valid GeoJSON object.");
  t.push($e(h, o, a, e.properties));
}
function qt(t, e) {
  e.push(ci(t[0]), ui(t[1]), 0);
}
function St(t, e, i, r) {
  let n, o, s = 0;
  for (let h = 0; h < t.length; h++) {
    const l = ci(t[h][0]), w = ui(t[h][1]);
    e.push(l, w, 0), h > 0 && (r ? s += (n * w - l * o) / 2 : s += Math.sqrt(Math.pow(l - n, 2) + Math.pow(w - o, 2))), n = l, o = w;
  }
  const a = e.length - 3;
  e[2] = 1, Mt(e, 0, a, i), e[a + 2] = 1, e.size = Math.abs(s), e.start = 0, e.end = e.size;
}
function pt(t, e, i, r) {
  for (let n = 0; n < t.length; n++) {
    const o = [];
    St(t[n], o, i, r), e.push(o);
  }
}
function ci(t) {
  return t / 360 + 0.5;
}
function ui(t) {
  const e = Math.sin(t * Math.PI / 180), i = 0.5 - 0.25 * Math.log((1 + e) / (1 - e)) / Math.PI;
  return i < 0 ? 0 : i > 1 ? 1 : i;
}
function Ce(t, e, i, r, n, o, s, a) {
  if (i /= e, r /= e, o >= i && s < r) return t;
  if (s < i || o >= r) return null;
  const h = [];
  for (const l of t) {
    const w = l.geometry;
    let d = l.type;
    const u = n === 0 ? l.minX : l.minY, y = n === 0 ? l.maxX : l.maxY;
    if (u >= i && y < r) {
      h.push(l);
      continue;
    } else if (y < i || u >= r)
      continue;
    let C = [];
    if (d === "Point" || d === "MultiPoint")
      Lr(w, C, i, r, n);
    else if (d === "LineString")
      di(w, C, i, r, n, !1, a.lineMetrics);
    else if (d === "MultiLineString")
      vt(w, C, i, r, n, !1);
    else if (d === "Polygon")
      vt(w, C, i, r, n, !0);
    else if (d === "MultiPolygon")
      for (const m of w) {
        const c = [];
        vt(m, c, i, r, n, !0), c.length && C.push(c);
      }
    if (C.length) {
      if (a.lineMetrics && d === "LineString") {
        for (const m of C)
          h.push($e(l.id, d, m, l.tags));
        continue;
      }
      (d === "LineString" || d === "MultiLineString") && (C.length === 1 ? (d = "LineString", C = C[0]) : d = "MultiLineString"), (d === "Point" || d === "MultiPoint") && (d = C.length === 3 ? "Point" : "MultiPoint"), h.push($e(l.id, d, C, l.tags));
    }
  }
  return h.length ? h : null;
}
function Lr(t, e, i, r, n) {
  for (let o = 0; o < t.length; o += 3) {
    const s = t[o + n];
    s >= i && s <= r && Ye(e, t[o], t[o + 1], t[o + 2]);
  }
}
function di(t, e, i, r, n, o, s) {
  let a = Xt(t);
  const h = n === 0 ? Fr : Cr;
  let l = t.start, w, d;
  for (let f = 0; f < t.length - 3; f += 3) {
    const _ = t[f], D = t[f + 1], M = t[f + 2], v = t[f + 3], p = t[f + 4], g = n === 0 ? _ : D, b = n === 0 ? v : p;
    let x = !1;
    s && (w = Math.sqrt(Math.pow(_ - v, 2) + Math.pow(D - p, 2))), g < i ? b > i && (d = h(a, _, D, v, p, i), s && (a.start = l + w * d)) : g > r ? b < r && (d = h(a, _, D, v, p, r), s && (a.start = l + w * d)) : Ye(a, _, D, M), b < i && g >= i && (d = h(a, _, D, v, p, i), x = !0), b > r && g <= r && (d = h(a, _, D, v, p, r), x = !0), !o && x && (s && (a.end = l + w * d), e.push(a), a = Xt(t)), s && (l += w);
  }
  let u = t.length - 3;
  const y = t[u], C = t[u + 1], m = t[u + 2], c = n === 0 ? y : C;
  c >= i && c <= r && Ye(a, y, C, m), u = a.length - 3, o && u >= 3 && (a[u] !== a[0] || a[u + 1] !== a[1]) && Ye(a, a[0], a[1], a[2]), a.length && e.push(a);
}
function Xt(t) {
  const e = [];
  return e.size = t.size, e.start = t.start, e.end = t.end, e;
}
function vt(t, e, i, r, n, o) {
  for (const s of t)
    di(s, e, i, r, n, o, !1);
}
function Ye(t, e, i, r) {
  t.push(e, i, r);
}
function Fr(t, e, i, r, n, o) {
  const s = (o - e) / (r - e);
  return Ye(t, o, i + (n - i) * s, 1), s;
}
function Cr(t, e, i, r, n, o) {
  const s = (o - i) / (n - i);
  return Ye(t, e + (r - e) * s, o, 1), s;
}
function Ar(t, e) {
  const i = e.buffer / e.extent;
  let r = t;
  const n = Ce(t, 1, -1 - i, i, 0, -1, 2, e), o = Ce(t, 1, 1 - i, 2 + i, 0, -1, 2, e);
  return (n || o) && (r = Ce(t, 1, -i, 1 + i, 0, -1, 2, e) || [], n && (r = Wt(n, 1).concat(r)), o && (r = r.concat(Wt(o, -1)))), r;
}
function Wt(t, e) {
  const i = [];
  for (let r = 0; r < t.length; r++) {
    const n = t[r], o = n.type;
    let s;
    if (o === "Point" || o === "MultiPoint" || o === "LineString")
      s = _t(n.geometry, e);
    else if (o === "MultiLineString" || o === "Polygon") {
      s = [];
      for (const a of n.geometry)
        s.push(_t(a, e));
    } else if (o === "MultiPolygon") {
      s = [];
      for (const a of n.geometry) {
        const h = [];
        for (const l of a)
          h.push(_t(l, e));
        s.push(h);
      }
    }
    i.push($e(n.id, o, s, n.tags));
  }
  return i;
}
function _t(t, e) {
  const i = [];
  i.size = t.size, t.start !== void 0 && (i.start = t.start, i.end = t.end);
  for (let r = 0; r < t.length; r += 3)
    i.push(t[r] + e, t[r + 1], t[r + 2]);
  return i;
}
function Jt(t, e) {
  if (t.transformed) return t;
  const i = 1 << t.z, r = t.x, n = t.y;
  for (const o of t.features) {
    const s = o.geometry, a = o.type;
    if (o.geometry = [], a === 1)
      for (let h = 0; h < s.length; h += 2)
        o.geometry.push($t(s[h], s[h + 1], e, i, r, n));
    else
      for (let h = 0; h < s.length; h++) {
        const l = [];
        for (let w = 0; w < s[h].length; w += 2)
          l.push($t(s[h][w], s[h][w + 1], e, i, r, n));
        o.geometry.push(l);
      }
  }
  return t.transformed = !0, t;
}
function $t(t, e, i, r, n, o) {
  return [
    Math.round(i * (t * r - n)),
    Math.round(i * (e * r - o))
  ];
}
function Ir(t, e, i, r, n) {
  const o = e === n.maxZoom ? 0 : n.tolerance / ((1 << e) * n.extent), s = {
    features: [],
    numPoints: 0,
    numSimplified: 0,
    numFeatures: t.length,
    source: null,
    x: i,
    y: r,
    z: e,
    transformed: !1,
    minX: 2,
    minY: 1,
    maxX: -1,
    maxY: 0
  };
  for (const a of t)
    Or(s, a, o, n);
  return s;
}
function Or(t, e, i, r) {
  const n = e.geometry, o = e.type, s = [];
  if (t.minX = Math.min(t.minX, e.minX), t.minY = Math.min(t.minY, e.minY), t.maxX = Math.max(t.maxX, e.maxX), t.maxY = Math.max(t.maxY, e.maxY), o === "Point" || o === "MultiPoint")
    for (let a = 0; a < n.length; a += 3)
      s.push(n[a], n[a + 1]), t.numPoints++, t.numSimplified++;
  else if (o === "LineString")
    mt(s, n, t, i, !1, !1);
  else if (o === "MultiLineString" || o === "Polygon")
    for (let a = 0; a < n.length; a++)
      mt(s, n[a], t, i, o === "Polygon", a === 0);
  else if (o === "MultiPolygon")
    for (let a = 0; a < n.length; a++) {
      const h = n[a];
      for (let l = 0; l < h.length; l++)
        mt(s, h[l], t, i, !0, l === 0);
    }
  if (s.length) {
    let a = e.tags || null;
    if (o === "LineString" && r.lineMetrics) {
      a = {};
      for (const l in e.tags) a[l] = e.tags[l];
      a.mapbox_clip_start = n.start / n.size, a.mapbox_clip_end = n.end / n.size;
    }
    const h = {
      geometry: s,
      type: o === "Polygon" || o === "MultiPolygon" ? 3 : o === "LineString" || o === "MultiLineString" ? 2 : 1,
      tags: a
    };
    e.id !== null && (h.id = e.id), t.features.push(h);
  }
}
function mt(t, e, i, r, n, o) {
  const s = r * r;
  if (r > 0 && e.size < (n ? s : r)) {
    i.numPoints += e.length / 3;
    return;
  }
  const a = [];
  for (let h = 0; h < e.length; h += 3)
    (r === 0 || e[h + 2] > s) && (i.numSimplified++, a.push(e[h], e[h + 1])), i.numPoints++;
  n && Ur(a, o), t.push(a);
}
function Ur(t, e) {
  let i = 0;
  for (let r = 0, n = t.length, o = n - 2; r < n; o = r, r += 2)
    i += (t[r] - t[o]) * (t[r + 1] + t[o + 1]);
  if (i > 0 === e)
    for (let r = 0, n = t.length; r < n / 2; r += 2) {
      const o = t[r], s = t[r + 1];
      t[r] = t[n - 2 - r], t[r + 1] = t[n - 1 - r], t[n - 2 - r] = o, t[n - 1 - r] = s;
    }
}
const Rr = {
  maxZoom: 14,
  // max zoom to preserve detail on
  indexMaxZoom: 5,
  // max zoom in the tile index
  indexMaxPoints: 1e5,
  // max number of points per tile in the tile index
  tolerance: 3,
  // simplification tolerance (higher means simpler)
  extent: 4096,
  // tile extent
  buffer: 64,
  // tile buffer on each side
  lineMetrics: !1,
  // whether to calculate line metrics
  promoteId: null,
  // name of a feature property to be promoted to feature.id
  generateId: !1,
  // whether to generate feature ids. Cannot be used with promoteId
  debug: 0
  // logging level (0, 1 or 2)
};
class Br {
  constructor(e, i) {
    i = this.options = jr(Object.create(Rr), i);
    const r = i.debug;
    if (r && console.time("preprocess data"), i.maxZoom < 0 || i.maxZoom > 24) throw new Error("maxZoom should be in the 0-24 range");
    if (i.promoteId && i.generateId) throw new Error("promoteId and generateId cannot be used together.");
    let n = kr(e, i);
    this.tiles = {}, this.tileCoords = [], r && (console.timeEnd("preprocess data"), console.log("index: maxZoom: %d, maxPoints: %d", i.indexMaxZoom, i.indexMaxPoints), console.time("generate tiles"), this.stats = {}, this.total = 0), n = Ar(n, i), n.length && this.splitTile(n, 0, 0, 0), r && (n.length && console.log("features: %d, points: %d", this.tiles[0].numFeatures, this.tiles[0].numPoints), console.timeEnd("generate tiles"), console.log("tiles generated:", this.total, JSON.stringify(this.stats)));
  }
  // splits features from a parent tile to sub-tiles.
  // z, x, and y are the coordinates of the parent tile
  // cz, cx, and cy are the coordinates of the target tile
  //
  // If no target tile is specified, splitting stops when we reach the maximum
  // zoom or the number of points is low as specified in the options.
  splitTile(e, i, r, n, o, s, a) {
    const h = [e, i, r, n], l = this.options, w = l.debug;
    for (; h.length; ) {
      n = h.pop(), r = h.pop(), i = h.pop(), e = h.pop();
      const d = 1 << i, u = gt(i, r, n);
      let y = this.tiles[u];
      if (!y && (w > 1 && console.time("creation"), y = this.tiles[u] = Ir(e, i, r, n, l), this.tileCoords.push({ z: i, x: r, y: n }), w)) {
        w > 1 && (console.log(
          "tile z%d-%d-%d (features: %d, points: %d, simplified: %d)",
          i,
          r,
          n,
          y.numFeatures,
          y.numPoints,
          y.numSimplified
        ), console.timeEnd("creation"));
        const b = `z${i}`;
        this.stats[b] = (this.stats[b] || 0) + 1, this.total++;
      }
      if (y.source = e, o == null) {
        if (i === l.indexMaxZoom || y.numPoints <= l.indexMaxPoints) continue;
      } else {
        if (i === l.maxZoom || i === o)
          continue;
        if (o != null) {
          const b = o - i;
          if (r !== s >> b || n !== a >> b) continue;
        }
      }
      if (y.source = null, e.length === 0) continue;
      w > 1 && console.time("clipping");
      const C = 0.5 * l.buffer / l.extent, m = 0.5 - C, c = 0.5 + C, f = 1 + C;
      let _ = null, D = null, M = null, v = null, p = Ce(e, d, r - C, r + c, 0, y.minX, y.maxX, l), g = Ce(e, d, r + m, r + f, 0, y.minX, y.maxX, l);
      e = null, p && (_ = Ce(p, d, n - C, n + c, 1, y.minY, y.maxY, l), D = Ce(p, d, n + m, n + f, 1, y.minY, y.maxY, l), p = null), g && (M = Ce(g, d, n - C, n + c, 1, y.minY, y.maxY, l), v = Ce(g, d, n + m, n + f, 1, y.minY, y.maxY, l), g = null), w > 1 && console.timeEnd("clipping"), h.push(_ || [], i + 1, r * 2, n * 2), h.push(D || [], i + 1, r * 2, n * 2 + 1), h.push(M || [], i + 1, r * 2 + 1, n * 2), h.push(v || [], i + 1, r * 2 + 1, n * 2 + 1);
    }
  }
  getTile(e, i, r) {
    e = +e, i = +i, r = +r;
    const n = this.options, { extent: o, debug: s } = n;
    if (e < 0 || e > 24) return null;
    const a = 1 << e;
    i = i + a & a - 1;
    const h = gt(e, i, r);
    if (this.tiles[h]) return Jt(this.tiles[h], o);
    s > 1 && console.log("drilling down to z%d-%d-%d", e, i, r);
    let l = e, w = i, d = r, u;
    for (; !u && l > 0; )
      l--, w = w >> 1, d = d >> 1, u = this.tiles[gt(l, w, d)];
    return !u || !u.source ? null : (s > 1 && (console.log("found parent tile z%d-%d-%d", l, w, d), console.time("drilling down")), this.splitTile(u.source, l, w, d, e, i, r), s > 1 && console.timeEnd("drilling down"), this.tiles[h] ? Jt(this.tiles[h], o) : null);
  }
}
function gt(t, e, i) {
  return ((1 << t) * i + e) * 32 + t;
}
function jr(t, e) {
  for (const i in e) t[i] = e[i];
  return t;
}
function zr(t, e) {
  return new Br(t, e);
}
const Hr = new Ft(new OffscreenCanvas(1, 1));
class ls extends He {
  /**
   * 构造函数
   */
  constructor() {
    super(), this.info = {
      version: Ie,
      author: "GuoJF",
      description: "GeoJSON 加载器"
    }, this.dataType = "geojson", this._loader = new Lt(at.manager), this._render = new ai(), this._loader.setResponseType("json");
  }
  /**
   * 异步加载瓦片纹理，瓦片创建后被调用。
   * 多个瓦片共享同一数据源时，仅首次触发网络请求，其余等待加载完成。
   *
   * @param url GeoJSON 文件 URL
   * @param params 加载参数，包含数据源、瓦片坐标等
   * @returns 瓦片纹理
   */
  async doLoad(e, i) {
    const { x: r, y: n, z: o, source: s } = i;
    if (s.gv)
      return this._getTileTexture(s.gv, r, n, o, s.style);
    if (s.loadPromise || (s.loadPromise = this.loadJSON(e).then((a) => {
      s.gv = a;
    }).catch((a) => {
      throw s.loadPromise = null, a;
    })), await s.loadPromise, !s.gv) throw new Error("GeoJSON 数据加载失败");
    return this._getTileTexture(s.gv, r, n, o, s.style);
  }
  /**
   * 加载 GeoJSON 文件并创建 geojson-vt 切片索引实例。
   *
   * @param url GeoJSON 文件 URL
   * @returns geojson-vt 实例
   */
  async loadJSON(e) {
    const i = await this._loader.loadAsync(e);
    return zr(i, {
      tolerance: 2,
      extent: 256,
      maxZoom: 20,
      indexMaxZoom: 4
    });
  }
  /**
   * 在 Canvas 上绘制瓦片内的所有矢量要素。
   *
   * @param tile  geojson-vt 瓦片数据，null 时返回空白画布
   * @param style 矢量样式
   * @returns 256x256 离屏画布
   */
  drawTile(e, i) {
    const o = new OffscreenCanvas(256, 256), s = o.getContext("2d");
    if (s && e) {
      s.save();
      const a = e.features;
      for (let h = 0; h < a.length; h++)
        this._renderFeature(s, a[h], i);
      s.restore();
    }
    return o;
  }
  /**
   * 将 geojson-vt 要素转换为 VectorFeature 并在 Canvas 上渲染。
   * 处理点、线、面三种几何类型的坐标格式差异。
   *
   * @param ctx     Canvas 渲染上下文
   * @param feature geojson-vt 瓦片要素
   * @param style   矢量样式
   */
  _renderFeature(e, i, r = {}) {
    const n = [Ae.Unknown, Ae.Point, Ae.Linestring, Ae.Polygon][i.type] ?? Ae.Unknown, o = {
      geometry: [],
      properties: {}
    }, s = i.geometry;
    if (i.type === 2 && s.length > 0 && !Array.isArray(s[0][0]))
      o.geometry.push(s.map((a) => ({ x: a[0], y: a[1] })));
    else
      for (let a = 0; a < s.length; a++) {
        let h;
        Array.isArray(s[a][0]) ? h = s[a].map((l) => ({
          x: l[0],
          y: l[1]
        })) : h = [{ x: s[a][0], y: s[a][1] }], o.geometry.push(h);
      }
    o.properties = i.tags ?? {}, this._render.render(e, n, o, r);
  }
  /**
   * 获取指定坐标的瓦片纹理。
   *
   * @param gv    geojson-vt 实例
   * @param x     瓦片 x 坐标
   * @param y     瓦片 y 坐标
   * @param z     瓦片层级
   * @param style 矢量样式
   * @returns Canvas 纹理，瓦片无数据时返回空纹理
   */
  _getTileTexture(e, i, r, n, o) {
    const s = e.getTile(n, i, r);
    return s ? new Ft(this.drawTile(s, o)) : Hr;
  }
}
class cs extends pe {
  constructor(e) {
    super(e), this.dataType = "geojson", this.loadPromise = null, this.style = {}, Object.assign(this, e);
  }
}
function Re(t, e) {
  this.x = t, this.y = e;
}
Re.prototype = {
  /**
   * Clone this point, returning a new point that can be modified
   * without affecting the old one.
   * @return {Point} the clone
   */
  clone() {
    return new Re(this.x, this.y);
  },
  /**
   * Add this point's x & y coordinates to another point,
   * yielding a new point.
   * @param {Point} p the other point
   * @return {Point} output point
   */
  add(t) {
    return this.clone()._add(t);
  },
  /**
   * Subtract this point's x & y coordinates to from point,
   * yielding a new point.
   * @param {Point} p the other point
   * @return {Point} output point
   */
  sub(t) {
    return this.clone()._sub(t);
  },
  /**
   * Multiply this point's x & y coordinates by point,
   * yielding a new point.
   * @param {Point} p the other point
   * @return {Point} output point
   */
  multByPoint(t) {
    return this.clone()._multByPoint(t);
  },
  /**
   * Divide this point's x & y coordinates by point,
   * yielding a new point.
   * @param {Point} p the other point
   * @return {Point} output point
   */
  divByPoint(t) {
    return this.clone()._divByPoint(t);
  },
  /**
   * Multiply this point's x & y coordinates by a factor,
   * yielding a new point.
   * @param {number} k factor
   * @return {Point} output point
   */
  mult(t) {
    return this.clone()._mult(t);
  },
  /**
   * Divide this point's x & y coordinates by a factor,
   * yielding a new point.
   * @param {number} k factor
   * @return {Point} output point
   */
  div(t) {
    return this.clone()._div(t);
  },
  /**
   * Rotate this point around the 0, 0 origin by an angle a,
   * given in radians
   * @param {number} a angle to rotate around, in radians
   * @return {Point} output point
   */
  rotate(t) {
    return this.clone()._rotate(t);
  },
  /**
   * Rotate this point around p point by an angle a,
   * given in radians
   * @param {number} a angle to rotate around, in radians
   * @param {Point} p Point to rotate around
   * @return {Point} output point
   */
  rotateAround(t, e) {
    return this.clone()._rotateAround(t, e);
  },
  /**
   * Multiply this point by a 4x1 transformation matrix
   * @param {[number, number, number, number]} m transformation matrix
   * @return {Point} output point
   */
  matMult(t) {
    return this.clone()._matMult(t);
  },
  /**
   * Calculate this point but as a unit vector from 0, 0, meaning
   * that the distance from the resulting point to the 0, 0
   * coordinate will be equal to 1 and the angle from the resulting
   * point to the 0, 0 coordinate will be the same as before.
   * @return {Point} unit vector point
   */
  unit() {
    return this.clone()._unit();
  },
  /**
   * Compute a perpendicular point, where the new y coordinate
   * is the old x coordinate and the new x coordinate is the old y
   * coordinate multiplied by -1
   * @return {Point} perpendicular point
   */
  perp() {
    return this.clone()._perp();
  },
  /**
   * Return a version of this point with the x & y coordinates
   * rounded to integers.
   * @return {Point} rounded point
   */
  round() {
    return this.clone()._round();
  },
  /**
   * Return the magnitude of this point: this is the Euclidean
   * distance from the 0, 0 coordinate to this point's x and y
   * coordinates.
   * @return {number} magnitude
   */
  mag() {
    return Math.sqrt(this.x * this.x + this.y * this.y);
  },
  /**
   * Judge whether this point is equal to another point, returning
   * true or false.
   * @param {Point} other the other point
   * @return {boolean} whether the points are equal
   */
  equals(t) {
    return this.x === t.x && this.y === t.y;
  },
  /**
   * Calculate the distance from this point to another point
   * @param {Point} p the other point
   * @return {number} distance
   */
  dist(t) {
    return Math.sqrt(this.distSqr(t));
  },
  /**
   * Calculate the distance from this point to another point,
   * without the square root step. Useful if you're comparing
   * relative distances.
   * @param {Point} p the other point
   * @return {number} distance
   */
  distSqr(t) {
    const e = t.x - this.x, i = t.y - this.y;
    return e * e + i * i;
  },
  /**
   * Get the angle from the 0, 0 coordinate to this point, in radians
   * coordinates.
   * @return {number} angle
   */
  angle() {
    return Math.atan2(this.y, this.x);
  },
  /**
   * Get the angle from this point to another point, in radians
   * @param {Point} b the other point
   * @return {number} angle
   */
  angleTo(t) {
    return Math.atan2(this.y - t.y, this.x - t.x);
  },
  /**
   * Get the angle between this point and another point, in radians
   * @param {Point} b the other point
   * @return {number} angle
   */
  angleWith(t) {
    return this.angleWithSep(t.x, t.y);
  },
  /**
   * Find the angle of the two vectors, solving the formula for
   * the cross product a x b = |a||b|sin(θ) for θ.
   * @param {number} x the x-coordinate
   * @param {number} y the y-coordinate
   * @return {number} the angle in radians
   */
  angleWithSep(t, e) {
    return Math.atan2(
      this.x * e - this.y * t,
      this.x * t + this.y * e
    );
  },
  /** @param {[number, number, number, number]} m */
  _matMult(t) {
    const e = t[0] * this.x + t[1] * this.y, i = t[2] * this.x + t[3] * this.y;
    return this.x = e, this.y = i, this;
  },
  /** @param {Point} p */
  _add(t) {
    return this.x += t.x, this.y += t.y, this;
  },
  /** @param {Point} p */
  _sub(t) {
    return this.x -= t.x, this.y -= t.y, this;
  },
  /** @param {number} k */
  _mult(t) {
    return this.x *= t, this.y *= t, this;
  },
  /** @param {number} k */
  _div(t) {
    return this.x /= t, this.y /= t, this;
  },
  /** @param {Point} p */
  _multByPoint(t) {
    return this.x *= t.x, this.y *= t.y, this;
  },
  /** @param {Point} p */
  _divByPoint(t) {
    return this.x /= t.x, this.y /= t.y, this;
  },
  _unit() {
    return this._div(this.mag()), this;
  },
  _perp() {
    const t = this.y;
    return this.y = this.x, this.x = -t, this;
  },
  /** @param {number} angle */
  _rotate(t) {
    const e = Math.cos(t), i = Math.sin(t), r = e * this.x - i * this.y, n = i * this.x + e * this.y;
    return this.x = r, this.y = n, this;
  },
  /**
   * @param {number} angle
   * @param {Point} p
   */
  _rotateAround(t, e) {
    const i = Math.cos(t), r = Math.sin(t), n = e.x + i * (this.x - e.x) - r * (this.y - e.y), o = e.y + r * (this.x - e.x) + i * (this.y - e.y);
    return this.x = n, this.y = o, this;
  },
  _round() {
    return this.x = Math.round(this.x), this.y = Math.round(this.y), this;
  },
  constructor: Re
};
Re.convert = function(t) {
  if (t instanceof Re)
    return (
      /** @type {Point} */
      t
    );
  if (Array.isArray(t))
    return new Re(+t[0], +t[1]);
  if (t.x !== void 0 && t.y !== void 0)
    return new Re(+t.x, +t.y);
  throw new Error("Expected [x, y] or {x, y} point format");
};
class fi {
  /**
   * @param {Pbf} pbf
   * @param {number} end
   * @param {number} extent
   * @param {string[]} keys
   * @param {(number | string | boolean)[]} values
   */
  constructor(e, i, r, n, o) {
    this.properties = {}, this.extent = r, this.type = 0, this.id = void 0, this._pbf = e, this._geometry = -1, this._keys = n, this._values = o, e.readFields(Nr, this, i);
  }
  loadGeometry() {
    const e = this._pbf;
    e.pos = this._geometry;
    const i = e.readVarint() + e.pos, r = [];
    let n, o = 1, s = 0, a = 0, h = 0;
    for (; e.pos < i; ) {
      if (s <= 0) {
        const l = e.readVarint();
        o = l & 7, s = l >> 3;
      }
      if (s--, o === 1 || o === 2)
        a += e.readSVarint(), h += e.readSVarint(), o === 1 && (n && r.push(n), n = []), n && n.push(new Re(a, h));
      else if (o === 7)
        n && n.push(n[0].clone());
      else
        throw new Error(`unknown command ${o}`);
    }
    return n && r.push(n), r;
  }
  bbox() {
    const e = this._pbf;
    e.pos = this._geometry;
    const i = e.readVarint() + e.pos;
    let r = 1, n = 0, o = 0, s = 0, a = 1 / 0, h = -1 / 0, l = 1 / 0, w = -1 / 0;
    for (; e.pos < i; ) {
      if (n <= 0) {
        const d = e.readVarint();
        r = d & 7, n = d >> 3;
      }
      if (n--, r === 1 || r === 2)
        o += e.readSVarint(), s += e.readSVarint(), o < a && (a = o), o > h && (h = o), s < l && (l = s), s > w && (w = s);
      else if (r !== 7)
        throw new Error(`unknown command ${r}`);
    }
    return [a, l, h, w];
  }
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @return {Feature}
   */
  toGeoJSON(e, i, r) {
    const n = this.extent * Math.pow(2, r), o = this.extent * e, s = this.extent * i, a = this.loadGeometry();
    function h(u) {
      return [
        (u.x + o) * 360 / n - 180,
        360 / Math.PI * Math.atan(Math.exp((1 - (u.y + s) * 2 / n) * Math.PI)) - 90
      ];
    }
    function l(u) {
      return u.map(h);
    }
    let w;
    if (this.type === 1) {
      const u = [];
      for (const C of a)
        u.push(C[0]);
      const y = l(u);
      w = u.length === 1 ? { type: "Point", coordinates: y[0] } : { type: "MultiPoint", coordinates: y };
    } else if (this.type === 2) {
      const u = a.map(l);
      w = u.length === 1 ? { type: "LineString", coordinates: u[0] } : { type: "MultiLineString", coordinates: u };
    } else if (this.type === 3) {
      const u = Gr(a), y = [];
      for (const C of u)
        y.push(C.map(l));
      w = y.length === 1 ? { type: "Polygon", coordinates: y[0] } : { type: "MultiPolygon", coordinates: y };
    } else
      throw new Error("unknown feature type");
    const d = {
      type: "Feature",
      geometry: w,
      properties: this.properties
    };
    return this.id != null && (d.id = this.id), d;
  }
}
fi.types = ["Unknown", "Point", "LineString", "Polygon"];
function Nr(t, e, i) {
  t === 1 ? e.id = i.readVarint() : t === 2 ? Vr(i, e) : t === 3 ? e.type = /** @type {0 | 1 | 2 | 3} */
  i.readVarint() : t === 4 && (e._geometry = i.pos);
}
function Vr(t, e) {
  const i = t.readVarint() + t.pos;
  for (; t.pos < i; ) {
    const r = e._keys[t.readVarint()], n = e._values[t.readVarint()];
    e.properties[r] = n;
  }
}
function Gr(t) {
  const e = t.length;
  if (e <= 1) return [t];
  const i = [];
  let r, n;
  for (let o = 0; o < e; o++) {
    const s = Kr(t[o]);
    s !== 0 && (n === void 0 && (n = s < 0), n === s < 0 ? (r && i.push(r), r = [t[o]]) : r && r.push(t[o]));
  }
  return r && i.push(r), i;
}
function Kr(t) {
  let e = 0;
  for (let i = 0, r = t.length, n = r - 1, o, s; i < r; n = i++)
    o = t[i], s = t[n], e += (s.x - o.x) * (o.y + s.y);
  return e;
}
class Yr {
  /**
   * @param {Pbf} pbf
   * @param {number} [end]
   */
  constructor(e, i) {
    this.version = 1, this.name = "", this.extent = 4096, this.length = 0, this._pbf = e, this._keys = [], this._values = [], this._features = [], e.readFields(qr, this, i), this.length = this._features.length;
  }
  /** return feature `i` from this layer as a `VectorTileFeature`
   * @param {number} i
   */
  feature(e) {
    if (e < 0 || e >= this._features.length) throw new Error("feature index out of bounds");
    this._pbf.pos = this._features[e];
    const i = this._pbf.readVarint() + this._pbf.pos;
    return new fi(this._pbf, i, this.extent, this._keys, this._values);
  }
}
function qr(t, e, i) {
  t === 15 ? e.version = i.readVarint() : t === 1 ? e.name = i.readString() : t === 5 ? e.extent = i.readVarint() : t === 2 ? e._features.push(i.pos) : t === 3 ? e._keys.push(i.readString()) : t === 4 && e._values.push(Xr(i));
}
function Xr(t) {
  let e = null;
  const i = t.readVarint() + t.pos;
  for (; t.pos < i; ) {
    const r = t.readVarint() >> 3;
    e = r === 1 ? t.readString() : r === 2 ? t.readFloat() : r === 3 ? t.readDouble() : r === 4 ? t.readVarint64() : r === 5 ? t.readVarint() : r === 6 ? t.readSVarint() : r === 7 ? t.readBoolean() : null;
  }
  if (e == null)
    throw new Error("unknown feature value");
  return e;
}
class Wr {
  /**
   * @param {Pbf} pbf
   * @param {number} [end]
   */
  constructor(e, i) {
    this.layers = e.readFields(Jr, {}, i);
  }
}
function Jr(t, e, i) {
  if (t === 3) {
    const r = new Yr(i, i.readVarint() + i.pos);
    r.length && (e[r.name] = r);
  }
}
const Et = 65536 * 65536, Zt = 1 / Et, $r = 12, Qt = typeof TextDecoder > "u" ? null : new TextDecoder("utf-8"), wt = 0, it = 1, We = 2, rt = 5;
class Zr {
  /**
   * @param {Uint8Array | ArrayBuffer} [buf]
   */
  constructor(e = new Uint8Array(16)) {
    this.buf = ArrayBuffer.isView(e) ? e : new Uint8Array(e), this.dataView = new DataView(this.buf.buffer), this.pos = 0, this.type = 0, this.length = this.buf.length;
  }
  // === READING =================================================================
  /**
   * @template T
   * @param {(tag: number, result: T, pbf: Pbf) => void} readField
   * @param {T} result
   * @param {number} [end]
   */
  readFields(e, i, r = this.length) {
    for (; this.pos < r; ) {
      const n = this.readVarint(), o = n >> 3, s = this.pos;
      this.type = n & 7, e(o, i, this), this.pos === s && this.skip(n);
    }
    return i;
  }
  /**
   * @template T
   * @param {(tag: number, result: T, pbf: Pbf) => void} readField
   * @param {T} result
   */
  readMessage(e, i) {
    return this.readFields(e, i, this.readVarint() + this.pos);
  }
  readFixed32() {
    const e = this.dataView.getUint32(this.pos, !0);
    return this.pos += 4, e;
  }
  readSFixed32() {
    const e = this.dataView.getInt32(this.pos, !0);
    return this.pos += 4, e;
  }
  // 64-bit int handling is based on github.com/dpw/node-buffer-more-ints (MIT-licensed)
  readFixed64() {
    const e = this.dataView.getUint32(this.pos, !0) + this.dataView.getUint32(this.pos + 4, !0) * Et;
    return this.pos += 8, e;
  }
  readSFixed64() {
    const e = this.dataView.getUint32(this.pos, !0) + this.dataView.getInt32(this.pos + 4, !0) * Et;
    return this.pos += 8, e;
  }
  readFloat() {
    const e = this.dataView.getFloat32(this.pos, !0);
    return this.pos += 4, e;
  }
  readDouble() {
    const e = this.dataView.getFloat64(this.pos, !0);
    return this.pos += 8, e;
  }
  /**
   * @param {boolean} [isSigned]
   */
  readVarint(e) {
    const i = this.buf;
    let r, n;
    return n = i[this.pos++], r = n & 127, n < 128 || (n = i[this.pos++], r |= (n & 127) << 7, n < 128) || (n = i[this.pos++], r |= (n & 127) << 14, n < 128) || (n = i[this.pos++], r |= (n & 127) << 21, n < 128) ? r : (n = i[this.pos], r |= (n & 15) << 28, Qr(r, e, this));
  }
  readVarint64() {
    return this.readVarint(!0);
  }
  readSVarint() {
    const e = this.readVarint();
    return e % 2 === 1 ? (e + 1) / -2 : e / 2;
  }
  readBoolean() {
    return !!this.readVarint();
  }
  readString() {
    const e = this.readVarint() + this.pos, i = this.pos;
    return this.pos = e, e - i >= $r && Qt ? Qt.decode(this.buf.subarray(i, e)) : fn(this.buf, i, e);
  }
  readBytes() {
    const e = this.readVarint() + this.pos, i = this.buf.subarray(this.pos, e);
    return this.pos = e, i;
  }
  // verbose for performance reasons; doesn't affect gzipped size
  /**
   * @param {number[]} [arr]
   * @param {boolean} [isSigned]
   */
  readPackedVarint(e = [], i) {
    const r = this.readPackedEnd();
    for (; this.pos < r; ) e.push(this.readVarint(i));
    return e;
  }
  /** @param {number[]} [arr] */
  readPackedSVarint(e = []) {
    const i = this.readPackedEnd();
    for (; this.pos < i; ) e.push(this.readSVarint());
    return e;
  }
  /** @param {boolean[]} [arr] */
  readPackedBoolean(e = []) {
    const i = this.readPackedEnd();
    for (; this.pos < i; ) e.push(this.readBoolean());
    return e;
  }
  /** @param {number[]} [arr] */
  readPackedFloat(e = []) {
    const i = this.readPackedEnd();
    for (; this.pos < i; ) e.push(this.readFloat());
    return e;
  }
  /** @param {number[]} [arr] */
  readPackedDouble(e = []) {
    const i = this.readPackedEnd();
    for (; this.pos < i; ) e.push(this.readDouble());
    return e;
  }
  /** @param {number[]} [arr] */
  readPackedFixed32(e = []) {
    const i = this.readPackedEnd();
    for (; this.pos < i; ) e.push(this.readFixed32());
    return e;
  }
  /** @param {number[]} [arr] */
  readPackedSFixed32(e = []) {
    const i = this.readPackedEnd();
    for (; this.pos < i; ) e.push(this.readSFixed32());
    return e;
  }
  /** @param {number[]} [arr] */
  readPackedFixed64(e = []) {
    const i = this.readPackedEnd();
    for (; this.pos < i; ) e.push(this.readFixed64());
    return e;
  }
  /** @param {number[]} [arr] */
  readPackedSFixed64(e = []) {
    const i = this.readPackedEnd();
    for (; this.pos < i; ) e.push(this.readSFixed64());
    return e;
  }
  readPackedEnd() {
    return this.type === We ? this.readVarint() + this.pos : this.pos + 1;
  }
  /** @param {number} val */
  skip(e) {
    const i = e & 7;
    if (i === wt) for (; this.buf[this.pos++] > 127; )
      ;
    else if (i === We) this.pos = this.readVarint() + this.pos;
    else if (i === rt) this.pos += 4;
    else if (i === it) this.pos += 8;
    else throw new Error(`Unimplemented type: ${i}`);
  }
  // === WRITING =================================================================
  /**
   * @param {number} tag
   * @param {number} type
   */
  writeTag(e, i) {
    this.writeVarint(e << 3 | i);
  }
  /** @param {number} min */
  realloc(e) {
    let i = this.length || 16;
    for (; i < this.pos + e; ) i *= 2;
    if (i !== this.length) {
      const r = new Uint8Array(i);
      r.set(this.buf), this.buf = r, this.dataView = new DataView(r.buffer), this.length = i;
    }
  }
  finish() {
    return this.length = this.pos, this.pos = 0, this.buf.subarray(0, this.length);
  }
  /** @param {number} val */
  writeFixed32(e) {
    this.realloc(4), this.dataView.setInt32(this.pos, e, !0), this.pos += 4;
  }
  /** @param {number} val */
  writeSFixed32(e) {
    this.realloc(4), this.dataView.setInt32(this.pos, e, !0), this.pos += 4;
  }
  /** @param {number} val */
  writeFixed64(e) {
    this.realloc(8), this.dataView.setInt32(this.pos, e & -1, !0), this.dataView.setInt32(this.pos + 4, Math.floor(e * Zt), !0), this.pos += 8;
  }
  /** @param {number} val */
  writeSFixed64(e) {
    this.realloc(8), this.dataView.setInt32(this.pos, e & -1, !0), this.dataView.setInt32(this.pos + 4, Math.floor(e * Zt), !0), this.pos += 8;
  }
  /** @param {number} val */
  writeVarint(e) {
    if (e = +e || 0, e > 268435455 || e < 0) {
      en(e, this);
      return;
    }
    this.realloc(4), this.buf[this.pos++] = e & 127 | (e > 127 ? 128 : 0), !(e <= 127) && (this.buf[this.pos++] = (e >>>= 7) & 127 | (e > 127 ? 128 : 0), !(e <= 127) && (this.buf[this.pos++] = (e >>>= 7) & 127 | (e > 127 ? 128 : 0), !(e <= 127) && (this.buf[this.pos++] = e >>> 7 & 127)));
  }
  /** @param {number} val */
  writeSVarint(e) {
    this.writeVarint(e < 0 ? -e * 2 - 1 : e * 2);
  }
  /** @param {boolean} val */
  writeBoolean(e) {
    this.writeVarint(+e);
  }
  /** @param {string} str */
  writeString(e) {
    e = String(e), this.realloc(e.length * 4), this.pos++;
    const i = this.pos;
    this.pos = pn(this.buf, e, this.pos);
    const r = this.pos - i;
    r >= 128 && ei(i, r, this), this.pos = i - 1, this.writeVarint(r), this.pos += r;
  }
  /** @param {number} val */
  writeFloat(e) {
    this.realloc(4), this.dataView.setFloat32(this.pos, e, !0), this.pos += 4;
  }
  /** @param {number} val */
  writeDouble(e) {
    this.realloc(8), this.dataView.setFloat64(this.pos, e, !0), this.pos += 8;
  }
  /** @param {Uint8Array} buffer */
  writeBytes(e) {
    const i = e.length;
    this.writeVarint(i), this.realloc(i);
    for (let r = 0; r < i; r++) this.buf[this.pos++] = e[r];
  }
  /**
   * @template T
   * @param {(obj: T, pbf: Pbf) => void} fn
   * @param {T} obj
   */
  writeRawMessage(e, i) {
    this.pos++;
    const r = this.pos;
    e(i, this);
    const n = this.pos - r;
    n >= 128 && ei(r, n, this), this.pos = r - 1, this.writeVarint(n), this.pos += n;
  }
  /**
   * @template T
   * @param {number} tag
   * @param {(obj: T, pbf: Pbf) => void} fn
   * @param {T} obj
   */
  writeMessage(e, i, r) {
    this.writeTag(e, We), this.writeRawMessage(i, r);
  }
  /**
   * @param {number} tag
   * @param {number[]} arr
   */
  writePackedVarint(e, i) {
    i.length && this.writeMessage(e, nn, i);
  }
  /**
   * @param {number} tag
   * @param {number[]} arr
   */
  writePackedSVarint(e, i) {
    i.length && this.writeMessage(e, sn, i);
  }
  /**
   * @param {number} tag
   * @param {boolean[]} arr
   */
  writePackedBoolean(e, i) {
    i.length && this.writeMessage(e, hn, i);
  }
  /**
   * @param {number} tag
   * @param {number[]} arr
   */
  writePackedFloat(e, i) {
    i.length && this.writeMessage(e, on, i);
  }
  /**
   * @param {number} tag
   * @param {number[]} arr
   */
  writePackedDouble(e, i) {
    i.length && this.writeMessage(e, an, i);
  }
  /**
   * @param {number} tag
   * @param {number[]} arr
   */
  writePackedFixed32(e, i) {
    i.length && this.writeMessage(e, ln, i);
  }
  /**
   * @param {number} tag
   * @param {number[]} arr
   */
  writePackedSFixed32(e, i) {
    i.length && this.writeMessage(e, cn, i);
  }
  /**
   * @param {number} tag
   * @param {number[]} arr
   */
  writePackedFixed64(e, i) {
    i.length && this.writeMessage(e, un, i);
  }
  /**
   * @param {number} tag
   * @param {number[]} arr
   */
  writePackedSFixed64(e, i) {
    i.length && this.writeMessage(e, dn, i);
  }
  /**
   * @param {number} tag
   * @param {Uint8Array} buffer
   */
  writeBytesField(e, i) {
    this.writeTag(e, We), this.writeBytes(i);
  }
  /**
   * @param {number} tag
   * @param {number} val
   */
  writeFixed32Field(e, i) {
    this.writeTag(e, rt), this.writeFixed32(i);
  }
  /**
   * @param {number} tag
   * @param {number} val
   */
  writeSFixed32Field(e, i) {
    this.writeTag(e, rt), this.writeSFixed32(i);
  }
  /**
   * @param {number} tag
   * @param {number} val
   */
  writeFixed64Field(e, i) {
    this.writeTag(e, it), this.writeFixed64(i);
  }
  /**
   * @param {number} tag
   * @param {number} val
   */
  writeSFixed64Field(e, i) {
    this.writeTag(e, it), this.writeSFixed64(i);
  }
  /**
   * @param {number} tag
   * @param {number} val
   */
  writeVarintField(e, i) {
    this.writeTag(e, wt), this.writeVarint(i);
  }
  /**
   * @param {number} tag
   * @param {number} val
   */
  writeSVarintField(e, i) {
    this.writeTag(e, wt), this.writeSVarint(i);
  }
  /**
   * @param {number} tag
   * @param {string} str
   */
  writeStringField(e, i) {
    this.writeTag(e, We), this.writeString(i);
  }
  /**
   * @param {number} tag
   * @param {number} val
   */
  writeFloatField(e, i) {
    this.writeTag(e, rt), this.writeFloat(i);
  }
  /**
   * @param {number} tag
   * @param {number} val
   */
  writeDoubleField(e, i) {
    this.writeTag(e, it), this.writeDouble(i);
  }
  /**
   * @param {number} tag
   * @param {boolean} val
   */
  writeBooleanField(e, i) {
    this.writeVarintField(e, +i);
  }
}
function Qr(t, e, i) {
  const r = i.buf;
  let n, o;
  if (o = r[i.pos++], n = (o & 112) >> 4, o < 128 || (o = r[i.pos++], n |= (o & 127) << 3, o < 128) || (o = r[i.pos++], n |= (o & 127) << 10, o < 128) || (o = r[i.pos++], n |= (o & 127) << 17, o < 128) || (o = r[i.pos++], n |= (o & 127) << 24, o < 128) || (o = r[i.pos++], n |= (o & 1) << 31, o < 128)) return Ge(t, n, e);
  throw new Error("Expected varint not more than 10 bytes");
}
function Ge(t, e, i) {
  return i ? e * 4294967296 + (t >>> 0) : (e >>> 0) * 4294967296 + (t >>> 0);
}
function en(t, e) {
  let i, r;
  if (t >= 0 ? (i = t % 4294967296 | 0, r = t / 4294967296 | 0) : (i = ~(-t % 4294967296), r = ~(-t / 4294967296), i ^ 4294967295 ? i = i + 1 | 0 : (i = 0, r = r + 1 | 0)), t >= 18446744073709552e3 || t < -18446744073709552e3)
    throw new Error("Given varint doesn't fit into 10 bytes");
  e.realloc(10), tn(i, r, e), rn(r, e);
}
function tn(t, e, i) {
  i.buf[i.pos++] = t & 127 | 128, t >>>= 7, i.buf[i.pos++] = t & 127 | 128, t >>>= 7, i.buf[i.pos++] = t & 127 | 128, t >>>= 7, i.buf[i.pos++] = t & 127 | 128, t >>>= 7, i.buf[i.pos] = t & 127;
}
function rn(t, e) {
  const i = (t & 7) << 4;
  e.buf[e.pos++] |= i | ((t >>>= 3) ? 128 : 0), t && (e.buf[e.pos++] = t & 127 | ((t >>>= 7) ? 128 : 0), t && (e.buf[e.pos++] = t & 127 | ((t >>>= 7) ? 128 : 0), t && (e.buf[e.pos++] = t & 127 | ((t >>>= 7) ? 128 : 0), t && (e.buf[e.pos++] = t & 127 | ((t >>>= 7) ? 128 : 0), t && (e.buf[e.pos++] = t & 127)))));
}
function ei(t, e, i) {
  const r = e <= 16383 ? 1 : e <= 2097151 ? 2 : e <= 268435455 ? 3 : Math.floor(Math.log(e) / (Math.LN2 * 7));
  i.realloc(r);
  for (let n = i.pos - 1; n >= t; n--) i.buf[n + r] = i.buf[n];
}
function nn(t, e) {
  for (let i = 0; i < t.length; i++) e.writeVarint(t[i]);
}
function sn(t, e) {
  for (let i = 0; i < t.length; i++) e.writeSVarint(t[i]);
}
function on(t, e) {
  for (let i = 0; i < t.length; i++) e.writeFloat(t[i]);
}
function an(t, e) {
  for (let i = 0; i < t.length; i++) e.writeDouble(t[i]);
}
function hn(t, e) {
  for (let i = 0; i < t.length; i++) e.writeBoolean(t[i]);
}
function ln(t, e) {
  for (let i = 0; i < t.length; i++) e.writeFixed32(t[i]);
}
function cn(t, e) {
  for (let i = 0; i < t.length; i++) e.writeSFixed32(t[i]);
}
function un(t, e) {
  for (let i = 0; i < t.length; i++) e.writeFixed64(t[i]);
}
function dn(t, e) {
  for (let i = 0; i < t.length; i++) e.writeSFixed64(t[i]);
}
function fn(t, e, i) {
  let r = "", n = e;
  for (; n < i; ) {
    const o = t[n];
    let s = null, a = o > 239 ? 4 : o > 223 ? 3 : o > 191 ? 2 : 1;
    if (n + a > i) break;
    let h, l, w;
    a === 1 ? o < 128 && (s = o) : a === 2 ? (h = t[n + 1], (h & 192) === 128 && (s = (o & 31) << 6 | h & 63, s <= 127 && (s = null))) : a === 3 ? (h = t[n + 1], l = t[n + 2], (h & 192) === 128 && (l & 192) === 128 && (s = (o & 15) << 12 | (h & 63) << 6 | l & 63, (s <= 2047 || s >= 55296 && s <= 57343) && (s = null))) : a === 4 && (h = t[n + 1], l = t[n + 2], w = t[n + 3], (h & 192) === 128 && (l & 192) === 128 && (w & 192) === 128 && (s = (o & 15) << 18 | (h & 63) << 12 | (l & 63) << 6 | w & 63, (s <= 65535 || s >= 1114112) && (s = null))), s === null ? (s = 65533, a = 1) : s > 65535 && (s -= 65536, r += String.fromCharCode(s >>> 10 & 1023 | 55296), s = 56320 | s & 1023), r += String.fromCharCode(s), n += a;
  }
  return r;
}
function pn(t, e, i) {
  for (let r = 0, n, o; r < e.length; r++) {
    if (n = e.charCodeAt(r), n > 55295 && n < 57344)
      if (o)
        if (n < 56320) {
          t[i++] = 239, t[i++] = 191, t[i++] = 189, o = n;
          continue;
        } else
          n = o - 55296 << 10 | n - 56320 | 65536, o = null;
      else {
        n > 56319 || r + 1 === e.length ? (t[i++] = 239, t[i++] = 191, t[i++] = 189) : o = n;
        continue;
      }
    else o && (t[i++] = 239, t[i++] = 191, t[i++] = 189, o = null);
    n < 128 ? t[i++] = n : (n < 2048 ? t[i++] = n >> 6 | 192 : (n < 65536 ? t[i++] = n >> 12 | 224 : (t[i++] = n >> 18 | 240, t[i++] = n >> 12 & 63 | 128), t[i++] = n >> 6 & 63 | 128), t[i++] = n & 63 | 128);
  }
  return i;
}
class us extends He {
  constructor() {
    super(), this.dataType = "mvt", this.info = {
      version: Ie,
      author: "GuoJF",
      description: "MVT vector tile loader that parses and renders Mapbox Vector Tiles on canvas."
    }, this._loader = new Lt(at.manager), this._render = new ai(), this._loader.setResponseType("arraybuffer");
  }
  /**
   * 加载并解析 MVT 瓦片，返回 Canvas 纹理
   * @param url 瓦片 URL
   * @param params 加载参数（含 source.style）
   * @returns Canvas 纹理
   */
  async doLoad(e, i) {
    const r = await this._loader.loadAsync(e), n = new Wr(new Zr(r)), o = this.drawTile(n, i.source.style, i.z);
    return new Ft(o);
  }
  /**
   * 在 OffscreenCanvas 上绘制矢量瓦片
   * @param vectorTile 矢量瓦片
   * @param style 样式集合（按图层名索引）
   * @param z 瓦片层级，用于层级过滤
   * @returns 绘制完成的 canvas
   */
  drawTile(e, i, r) {
    const a = new OffscreenCanvas(256, 256).getContext("2d");
    if (a) {
      if (i)
        for (const h in i.layer) {
          const l = i.layer[h];
          if (r < (l.minLevel ?? 1) || r > (l.maxLevel ?? 20))
            continue;
          const w = e.layers[h];
          if (w) {
            const d = 256 / w.extent;
            this._renderLayer(a, w, l, d);
          }
        }
      else
        for (const h in e.layers) {
          const l = e.layers[h], w = 256 / l.extent;
          this._renderLayer(a, l, void 0, w);
        }
      return a.canvas;
    } else
      throw new Error("Canvas context is not available");
  }
  /**
   * 渲染矢量瓦片的一个图层
   * @param ctx Canvas 上下文
   * @param layer 图层数据
   * @param style 图层样式
   * @param scale 坐标缩放比例
   */
  _renderLayer(e, i, r, n = 1) {
    e.save();
    for (let o = 0; o < i.length; o++) {
      const s = i.feature(o);
      this._renderFeature(e, s, r, n);
    }
    return e.restore(), this;
  }
  /**
   * 渲染单个矢量要素
   * @param ctx Canvas 上下文
   * @param feature 矢量要素
   * @param style 渲染样式
   * @param scale 坐标缩放比例
   */
  _renderFeature(e, i, r = {}, n = 1) {
    const o = [
      Ae.Unknown,
      Ae.Point,
      Ae.Linestring,
      Ae.Polygon
    ][i.type], s = {
      geometry: i.loadGeometry(),
      properties: i.properties
    };
    this._render.render(e, o, s, r, n);
  }
}
class ds extends pe {
  constructor(e) {
    super(e), this.dataType = "mvt", this.style = { layer: {} }, Object.assign(this, e);
  }
}
class vn extends kt {
  /** 获取最小高度 */
  get minHeight() {
    return this.uniforms.uMinHeight.value;
  }
  /** 获取最大高度 */
  get maxHeight() {
    return this.uniforms.uMaxHeight.value;
  }
  /** 设置最小高度 */
  set minHeight(e) {
    this.uniforms.uMinHeight.value = e;
  }
  /** 设置最大高度 */
  set maxHeight(e) {
    this.uniforms.uMaxHeight.value = e;
  }
  constructor(e, i) {
    super({
      name: "EleatorShader",
      uniforms: si.merge([
        {
          uMinHeight: { value: e },
          uMaxHeight: { value: i },
          uWaterColor: { value: new ke(0.1, 0.3, 0.7) },
          uSandColor: { value: new ke(0.76, 0.7, 0.5) },
          uGrassColor: { value: new ke(0.3, 0.6, 0.2) },
          uRockColor: { value: new ke(0.5, 0.4, 0.3) },
          uSnowColor: { value: new ke(0.95, 0.95, 1) }
        },
        Ke.common,
        Ke.lights,
        Ke.fog,
        {
          // 可以添加自定义uniforms
        }
      ]),
      vertexShader: (
        /* glsl */
        `
                precision highp float;

                #include <common>
                #include <fog_pars_vertex>
                #include <logdepthbuf_pars_vertex>

                varying vec3 vNormal;
                varying vec3 vViewPosition;
                varying float vHeight;

                void main() {
                    #include <begin_vertex>
                    #include <project_vertex>
                    #include <logdepthbuf_vertex>

                    vHeight = position.z;
                    vNormal = normalize(normalMatrix * normal);
                    vViewPosition = -mvPosition.xyz;

                    #include <fog_vertex>
                    #include <logdepthbuf_vertex>

                }

            `
      ),
      fragmentShader: (
        /* glsl */
        `
                precision highp float;

                #include <common>
                #include <fog_pars_fragment>
                #include <logdepthbuf_pars_fragment>

                varying float vHeight;

                varying vec3 vNormal;
                varying vec3 vViewPosition;

                uniform float uMinHeight;
                uniform float uMaxHeight;
                uniform vec3 uWaterColor;
                uniform vec3 uSandColor;
                uniform vec3 uGrassColor;
                uniform vec3 uRockColor;
                uniform vec3 uSnowColor;

                // 平滑过渡函数
                float smoothBlend(float edge0, float edge1, float x) {
                    float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
                    return t * t * (3.0 - 2.0 * t);
                }

                void main() {
                    #include <logdepthbuf_fragment>

                    // 归一化高度 (0到1之间)
                    float normalizedHeight = (vHeight - uMinHeight) / (uMaxHeight - uMinHeight);

                    // 定义各高度段的阈值
                    float waterLevel = 0.2;
                    float sandLevel = 0.3;
                    float grassLevel = 0.6;
                    float rockLevel = 0.85;

                    // 根据高度混合颜色
                    vec3 color;

                    if(normalizedHeight < waterLevel) {
                        // 水区域 - 深蓝色到浅蓝色
                        float t = smoothBlend(0.0, waterLevel, normalizedHeight);
                        color = mix(uWaterColor * 0.5, uWaterColor, t);
                    } else if(normalizedHeight < sandLevel) {
                        // 沙滩区域 - 浅蓝色到沙色
                        float t = smoothBlend(waterLevel, sandLevel, normalizedHeight);
                        color = mix(uWaterColor, uSandColor, t);
                    } else if(normalizedHeight < grassLevel) {
                        // 草地区域 - 沙色到绿色
                        float t = smoothBlend(sandLevel, grassLevel, normalizedHeight);
                        color = mix(uSandColor, uGrassColor, t);
                    } else if(normalizedHeight < rockLevel) {
                        // 岩石区域 - 绿色到棕色
                        float t = smoothBlend(grassLevel, rockLevel, normalizedHeight);
                        color = mix(uGrassColor, uRockColor, t);
                    } else {
                        // 雪地区域 - 棕色到白色
                        float t = smoothBlend(rockLevel, 1.0, normalizedHeight);
                        color = mix(uRockColor, uSnowColor, t);
                    }

                    // 添加简单光照效果（基于法线）
                    vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));
                    float diffuse = dot(vNormal, lightDir) * 0.5 + 0.5;
                    color *= diffuse;

                    gl_FragColor = vec4(color, 1.0);

                    #include <fog_fragment>
                }
            `
      ),
      transparent: !1,
      fog: !0
    });
  }
  copy(e) {
    return this.uniforms = e.uniforms, this;
  }
}
class fs extends He {
  constructor(e = 0, i = 3e3) {
    super(), this.dataType = "elevation", this.material = new vn(e, i);
  }
  get maxHeight() {
    return this.material.maxHeight;
  }
  set maxHeight(e) {
    this.material.maxHeight = e;
  }
  get minHeight() {
    return this.material.minHeight;
  }
  set minHeight(e) {
    this.material.minHeight = e;
  }
}
class _n extends kt {
  constructor(e) {
    super({
      name: "EleatorShader",
      uniforms: si.merge([
        {
          // 等高线颜色
          contourColor: { value: new ke(e?.color) },
          // 等高线间距
          contourInterval: { value: e?.interval },
          // 等高线宽度
          contourWidth: { value: e?.width }
        },
        Ke.common,
        Ke.lights,
        Ke.fog
      ]),
      vertexShader: (
        /* glsl */
        `
                precision highp float;

                #include <common>
                #include <fog_pars_vertex>
                #include <logdepthbuf_pars_vertex>

                varying float vHeight;

                void main() {
                    #include <begin_vertex>
                    #include <project_vertex>
                    #include <logdepthbuf_vertex>

                    vHeight = position.z;

                    #include <fog_vertex>
                    #include <logdepthbuf_vertex>

                }

            `
      ),
      fragmentShader: (
        /* glsl */
        `
                precision highp float;

                #include <common>
                #include <fog_pars_fragment>
                #include <logdepthbuf_pars_fragment>

                uniform vec3 contourColor;
                uniform float contourInterval;
                uniform float contourWidth;
                
                varying float vHeight;

                void main() {
                    #include <logdepthbuf_fragment>

                    float contourPos = mod(vHeight, contourInterval) / contourInterval;
                    float pixelWidth = contourWidth * fwidth(contourPos);                    
                    float distToEdge = min(contourPos, 1.0 - contourPos); 
                    float edgeFactor = smoothstep(0.0, pixelWidth, distToEdge/2.0); 
                    float alpha = smoothstep(0.0, 1.0, 1.0 - edgeFactor);
                    gl_FragColor = vec4(contourColor, alpha);
                    
                    #include <fog_fragment>
                }
            `
      ),
      transparent: !1,
      fog: !0
    });
  }
  copy(e) {
    return this.uniforms = e.uniforms, this;
  }
}
class ps extends He {
  constructor(e = new ke(16711680), i = 100, r = 1) {
    super(), this.dataType = "contour", this.material = new _n({ interval: i, width: r, color: e });
  }
}
class vs extends He {
  constructor() {
    super(...arguments), this.info = {
      version: Ie,
      description: "Map background material loader"
    }, this.dataType = "background";
  }
  createMaterial(e) {
    return new ni({ color: e.source.color });
  }
}
class _s extends pe {
  constructor(e) {
    super(e), this.dataType = "background", this.color = 1122867, this.color = e.color;
  }
}
const mn = "three_cache", Se = "files";
let be = null, ot = !1;
const qe = /* @__PURE__ */ new Set(), gn = me.add, wn = me.get, yn = me.remove, xn = me.clear;
async function ms() {
  if (ot) return;
  be = await new Promise((e, i) => {
    const r = indexedDB.open(mn, 2);
    r.onupgradeneeded = (n) => {
      const o = n.target.result;
      o.objectStoreNames.contains(Se) && o.deleteObjectStore(Se), o.createObjectStore(Se);
    }, r.onsuccess = () => e(r.result), r.onerror = () => i(r.error);
  }), await bn(), me.enabled = !0, ot = !0;
}
function gs() {
  ot && (be && (be.close(), be = null), qe.clear(), me.enabled = !1, me.add = gn, me.get = wn, me.remove = yn, me.clear = xn, ot = !1);
}
function bn() {
  if (!be) return Promise.resolve();
  const t = be;
  return new Promise((e) => {
    const n = t.transaction(Se, "readonly").objectStore(Se).getAllKeys();
    n.onsuccess = () => {
      for (const o of n.result)
        qe.add(o);
      e();
    }, n.onerror = () => e();
  });
}
function Mn(t) {
  const e = be;
  return new Promise((i, r) => {
    const s = e.transaction(Se, "readonly").objectStore(Se).get(t);
    s.onsuccess = () => {
      const a = s.result;
      if (a && typeof a == "object" && a.__type === "HTMLImageElement") {
        const h = new Image();
        h.onload = () => i(h), h.onerror = r, h.src = a.dataURL;
      } else
        i(a);
    }, s.onerror = () => r(s.error);
  });
}
function Sn(t) {
  if (t instanceof HTMLImageElement) {
    const e = document.createElement("canvas");
    return e.width = t.naturalWidth, e.height = t.naturalHeight, e.getContext("2d").drawImage(t, 0, 0), {
      __type: "HTMLImageElement",
      dataURL: e.toDataURL()
    };
  }
  return t;
}
me.add = async function(t, e) {
  if (!me.enabled || be === null || !t.startsWith("http")) return;
  const i = Sn(e), n = be.transaction(Se, "readwrite").objectStore(Se);
  return new Promise((o, s) => {
    const a = n.put(i, t);
    a.onsuccess = () => {
      qe.add(t), o();
    }, a.onerror = () => s(a.error);
  });
};
me.get = function(t) {
  if (!(!me.enabled || be === null || !t.startsWith("http")) && qe.has(t))
    return Mn(t);
};
me.remove = function(t) {
  if (qe.delete(t), !me.enabled || be === null) return;
  be.transaction(Se, "readwrite").objectStore(Se).delete(t);
};
me.clear = function() {
  if (qe.clear(), !me.enabled || be === null) return;
  be.transaction(Se, "readwrite").objectStore(Se).clear();
};
const ti = new Ee();
function ws(t, e, i) {
  const { currentTarget: r, offsetX: n, offsetY: o } = t;
  if (!(r instanceof HTMLElement))
    return;
  const s = r.clientWidth, a = r.clientHeight;
  return ti.set(n / s * 2 - 1, -(o / a) * 2 + 1), e.getLocalInfoFromScreen(i, ti)?.location;
}
function ys(t) {
  const e = /* @__PURE__ */ new Set();
  if ((Array.isArray(t.imgSource) ? t.imgSource : [t.imgSource]).forEach((r) => {
    const n = r.attribution;
    n && e.add(n);
  }), t.demSource) {
    const r = t.demSource.attribution;
    r && e.add(r);
  }
  return Array.from(e);
}
function xs(t, e, i) {
  if (i.userData._panLimited) return;
  i.userData._panLimited = !0;
  const r = i.geo2world(new ce(i.bounds[0], i.bounds[3])), n = i.geo2world(new ce(i.bounds[2], i.bounds[1])), o = new Dt(r, n);
  if (i.debug > 0) {
    let a = i.getObjectByName("panBoundary");
    a ? a.box.copy(o) : (a = new Ai(o), a.name = "panBoundary", i.add(a));
  }
  const s = new ce();
  e.addEventListener("change", function() {
    s.copy(e.target), e.target.clamp(r, n), s.sub(e.target), t.position.sub(s);
  });
}
const En = new ce(), Pn = new ce(), Tn = new ce(), ii = new Dt();
class bs extends Ii {
  /**
   * 创建贴地模型组。
   *
   * @param map 瓦片地图实例
   * @param params 贴地更新参数
   */
  constructor(e, i = {}) {
    super(), this._disposed = !1, this._onTileLoaded = () => {
      this._tileLoadedTimer = setTimeout(() => {
        !this._disposed && this.updateEveryTiles && this.update();
      }, 10);
    }, this._onLoadingComplete = () => {
      this._loadingCompleteTimer = setTimeout(() => {
        this._disposed || this.update();
      }, 10);
    }, this.updateEveryTiles = !1;
    const { updateEveryTile: r = !1 } = i;
    this.map = e, this.updateEveryTiles = r, e.addEventListener("tile-loaded", this._onTileLoaded), e.addEventListener("loading-complete", this._onLoadingComplete);
  }
  /**
   * 添加模型并立即执行一次贴地更新。
   *
   * @param object 要加入贴地组的模型对象
   * @returns 当前贴地组实例
   */
  add(...e) {
    return super.add(...e), e.forEach((i) => i.updateMatrixWorld()), this.update(...e), this;
  }
  /**
   * 更新模型贴地高度。
   *
   * 不传入对象时会更新当前组内全部子对象；传入对象时只更新指定对象。
   *
   * @param object 指定要更新的模型对象
   * @returns 当前贴地组实例
   */
  update(...e) {
    const i = e.length > 0 ? e : this.children;
    for (const r of i)
      Dn(this.map, r);
    return this;
  }
  /**
   * 释放事件监听、清理延迟更新任务，并从父对象移除。
   *
   * @returns 当前贴地组实例
   */
  dispose() {
    return this._disposed = !0, this.map.removeEventListener("tile-loaded", this._onTileLoaded), this.map.removeEventListener("loading-complete", this._onLoadingComplete), clearTimeout(this._tileLoadedTimer), clearTimeout(this._loadingCompleteTimer), this.removeFromParent(), this;
  }
}
function Dn(t, e) {
  if (!e.visible || !e.parent)
    return;
  const i = e.getWorldPosition(En), r = t.getLocalInfoFromWorld(i);
  if (!r)
    return;
  const n = ii.setFromObject(e).getSize(Pn), s = ii.getCenter(Tn).y - n.y / 2, a = r.point.y - s;
  i.y += a, e.position.copy(e.parent.worldToLocal(i));
}
export {
  Rn as ArcGisDemSource,
  Un as ArcGisSource,
  vs as BackgroundLoader,
  _s as BackgroundSource,
  Jn as BaiduSource,
  Ct as BaseViewer,
  wr as BingSource,
  gr as Compass,
  ps as ContourLoader,
  _n as ContourShader,
  xr as EarthMaskMaterial,
  fs as ElevationLoader,
  vn as ElevationShader,
  An as FLViewer,
  br as FakeEarth,
  jn as GDSource,
  Fn as GLViewer,
  ls as GeoJSONLoader,
  cs as GeoJSONSource,
  zn as GeoqSource,
  Hn as GoogleSource,
  bs as GroundGroup,
  gs as IndexDBCacheDisable,
  ms as IndexDBCacheEnable,
  us as MVTLoader,
  ds as MVTSource,
  On as MapBoxSource,
  Sr as MapFog,
  Nn as MapTilerSource,
  Cn as PLViewer,
  ss as SingleImageLoader,
  os as SingleImageSource,
  as as SingleTifDEMLoader,
  hs as SingleTifDEMSource,
  Vn as StadiaSource,
  Kn as TDTQMSource,
  Gn as TDTSource,
  Yn as TXSource,
  er as TileMapControls,
  ts as TileMaterialDebugLoader,
  is as TileMaterialLogoLoader,
  rs as TileMaterialNormalLoader,
  ns as TileMaterialWireLoader,
  Bn as VirtualEarthSource,
  Wn as WmsSource,
  Xn as ZKXTQMSource,
  qn as ZKXTSource,
  es as adjustZoomSpeedFromDist,
  Dn as clampToGround,
  In as createCompass,
  Mr as createFakeEarth,
  Zn as createFog,
  $n as createFrakEarth,
  ys as getAttributions,
  ws as getLocalFromMouse,
  Qn as limitCameraHeight,
  xs as limitPan
};
