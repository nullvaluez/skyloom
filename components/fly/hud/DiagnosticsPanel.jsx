'use client';
/**
 * TRUE EARTH — the diagnostics overlay (`?diag=1`).
 *
 * The owner certifies this pass on an RTX 5080 and an iPhone. The iPhone has
 * no console and Playwright cannot drive iOS Safari, so the device measures
 * itself here:
 *  - a live readout (frame percentiles, long frames, draws, triangles,
 *    programs, tier, GPU class);
 *  - BENCHMARK: a fixed 60 s straight flight up Manhattan under a pinned sun
 *    and baseline weather (lib/fly/diag.js DIAG_BENCH), graded against the
 *    pass's tier budgets (lib/fly/tier-budgets.js);
 *  - SEND REPORT: POSTs the JSON to the dev server, which saves it under
 *    .graphics-review/device-reports/ on the owner's PC (no HTTPS needed);
 *    scripts/verify-device-report.mjs grades the saved file.
 * Nothing mounts without `?diag=1`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFlyStore } from '@/stores/fly-store';
import { callRuntimeAction } from '@/lib/fly/runtime-bus';
import { DIAG_BENCH } from '@/lib/fly/diag';
import { collectDeviceReport, resolvedFlags } from '@/lib/fly/device-report';
import { getDiagRenderer } from '@/lib/fly/diag-handles';
import { gpuClass, isMobileGraphicsClass, readGpuInfo } from '@/lib/fly/device-class';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fmt = (v, digits = 1) => (Number.isFinite(v) ? v.toFixed(digits) : '—');
const big = (v) => (Number.isFinite(v) ? (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v)) : '—');

function Button({ children, onClick, disabled, primary }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-9 rounded px-2 text-xs phone:min-h-11 disabled:opacity-40 ${
        primary ? 'bg-sky-300 font-medium text-zinc-950 hover:bg-sky-200' : 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
      }`}
    >
      {children}
    </button>
  );
}

export function DiagnosticsPanel({ runtime }) {
  const [open, setOpen] = useState(true);
  const [live, setLive] = useState(null);
  const [bench, setBench] = useState({ phase: 'idle', note: null, remainingS: null });
  const [report, setReport] = useState(null);
  const [delivery, setDelivery] = useState(null);
  const busy = useRef(false);
  const textRef = useRef(null);

  const gpu = useMemo(() => {
    const info = readGpuInfo(getDiagRenderer()?.getContext?.());
    return { ...info, ...gpuClass(info.renderer, { coarse: isMobileGraphicsClass() }) };
    // The renderer exists by the time a player can open the panel; re-read on open.
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = setInterval(() => {
      const s = window.__flyStats ?? {};
      const f = s.frame ?? {};
      setLive({
        p50: f.p50,
        p95: f.p95,
        p99: f.p99,
        long100: f.long100PerMin,
        calls: s.diag?.calls,
        tris: s.diag?.triangles,
        programs: getDiagRenderer()?.info?.programs?.length,
        tier: useFlyStore.getState().qualityTier,
        scanMs: runtime?.cinemaShadows?.scanMs,
      });
    }, 500);
    return () => clearInterval(id);
  }, [runtime]);

  const runBenchmark = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setReport(null);
    setDelivery(null);
    const prevSun = window.__flySunOverride;
    const prevWeather = window.__flyWeatherOverride;
    const restore = () => {
      if (prevSun === undefined) delete window.__flySunOverride;
      else window.__flySunOverride = prevSun;
      if (prevWeather === undefined) delete window.__flyWeatherOverride;
      else window.__flyWeatherOverride = prevWeather;
    };
    try {
      setBench({ phase: 'warping', note: 'Warping to the benchmark start…', remainingS: null });
      window.__flySunOverride = DIAG_BENCH.sunUtcMs;
      window.__flyWeatherOverride = 'baseline';
      const ok = callRuntimeAction('warpToGeo', DIAG_BENCH.lat, DIAG_BENCH.lon, {
        altM: DIAG_BENCH.altM,
        headingRad: DIAG_BENCH.headingRad,
        name: 'Benchmark',
      });
      if (ok !== true) {
        setBench({ phase: 'failed', note: 'Start a Free Flight (airborne, no menu open), then run the benchmark.', remainingS: null });
        return;
      }
      const t0 = performance.now();
      await sleep(500);
      while (runtime?.worldLoading && performance.now() - t0 < DIAG_BENCH.revealTimeoutMs) await sleep(250);
      const revealMs = Math.round(performance.now() - t0);
      setBench({ phase: 'settling', note: 'Hands off the controls…', remainingS: null });
      await sleep(DIAG_BENCH.settleMs);
      const s = (window.__flyStats ??= {});
      s.frame?.reset?.();
      if (s.diag) {
        s.diag.callsPeak = 0;
        s.diag.trianglesPeak = 0;
      }
      const start = performance.now();
      while (performance.now() - start < DIAG_BENCH.captureMs) {
        const left = Math.ceil((DIAG_BENCH.captureMs - (performance.now() - start)) / 1000);
        setBench({ phase: 'capturing', note: 'Measuring — hands off', remainingS: left });
        await sleep(1000);
      }
      const r = collectDeviceReport({
        runtime,
        gl: getDiagRenderer(),
        benchmark: {
          id: DIAG_BENCH.id,
          captureS: DIAG_BENCH.captureMs / 1000,
          revealMs,
          arrivalReason: runtime?.arrivalStats?.reason ?? null,
          sunUtcMs: DIAG_BENCH.sunUtcMs,
          weather: 'baseline',
        },
      });
      setReport(r);
      setBench({ phase: 'done', note: r.grade.pass ? 'Within the tier budget' : 'Over budget — see the rows below', remainingS: null });
    } catch (error) {
      setBench({ phase: 'failed', note: String(error?.message ?? error), remainingS: null });
    } finally {
      restore();
      busy.current = false;
    }
  }, [runtime]);

  const snapshot = useCallback(() => {
    setDelivery(null);
    setReport(collectDeviceReport({ runtime, gl: getDiagRenderer(), benchmark: null }));
  }, [runtime]);

  const send = useCallback(async () => {
    if (!report) return;
    setDelivery({ state: 'sending' });
    try {
      const res = await fetch('/api/dev/device-report', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) });
      const body = await res.json().catch(() => ({}));
      setDelivery(res.ok && body.ok ? { state: 'sent', file: body.file } : { state: 'error', message: body.error || `HTTP ${res.status}` });
    } catch (error) {
      setDelivery({ state: 'error', message: String(error?.message ?? error) });
    }
  }, [report]);

  const copy = useCallback(async () => {
    if (!report) return;
    const text = JSON.stringify(report, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setDelivery({ state: 'copied' });
    } catch {
      // No clipboard on a plain-HTTP LAN page: select the text for a manual copy.
      textRef.current?.focus();
      textRef.current?.select();
      setDelivery({ state: 'select' });
    }
  }, [report]);

  if (!open) {
    return (
      <button
        type="button"
        data-testid="diag-open"
        onClick={() => setOpen(true)}
        className="pointer-events-auto fixed right-2 top-[max(env(safe-area-inset-top),0.5rem)] z-[90] rounded-full bg-zinc-900/85 px-3 py-1 text-xs text-zinc-100 shadow"
      >
        Diag {fmt(live?.p95)} ms
      </button>
    );
  }

  const running = bench.phase === 'warping' || bench.phase === 'settling' || bench.phase === 'capturing';
  const flags = resolvedFlags();
  return (
    <div
      data-testid="diag-panel"
      className="pointer-events-auto fixed right-2 top-[max(env(safe-area-inset-top),0.5rem)] z-[90] max-h-[85svh] w-72 overflow-y-auto rounded-lg border border-zinc-700/60 bg-zinc-950/90 p-3 text-zinc-100 shadow-2xl"
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Diagnostics</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-zinc-400 hover:text-zinc-100">
          Hide
        </button>
      </div>
      <p className="mb-2 text-[11px] leading-4 text-zinc-400">
        {gpu.renderer || 'GPU unknown'} · <span className="text-zinc-200">{gpu.cls}</span>
      </p>
      <dl className="mb-3 grid grid-cols-3 gap-x-2 gap-y-1 text-[11px]">
        <dt className="text-zinc-500">p50</dt>
        <dt className="text-zinc-500">p95</dt>
        <dt className="text-zinc-500">p99 ms</dt>
        <dd>{fmt(live?.p50)}</dd>
        <dd>{fmt(live?.p95)}</dd>
        <dd>{fmt(live?.p99)}</dd>
        <dt className="text-zinc-500">draws</dt>
        <dt className="text-zinc-500">tris</dt>
        <dt className="text-zinc-500">&gt;100ms/min</dt>
        <dd>{big(live?.calls)}</dd>
        <dd>{big(live?.tris)}</dd>
        <dd>{fmt(live?.long100, 1)}</dd>
        <dt className="text-zinc-500">tier</dt>
        <dt className="text-zinc-500">programs</dt>
        <dt className="text-zinc-500">scene walk</dt>
        <dd>{live?.tier ?? '—'}</dd>
        <dd>{live?.programs ?? '—'}</dd>
        <dd>{fmt(live?.scanMs, 2)} ms</dd>
      </dl>
      <div className="mb-2 grid grid-cols-2 gap-1">
        <Button primary onClick={runBenchmark} disabled={running}>
          {running ? `${bench.phase}${bench.remainingS != null ? ` ${bench.remainingS}s` : ''}` : 'Benchmark 60 s'}
        </Button>
        <Button onClick={snapshot} disabled={running}>
          Report now
        </Button>
      </div>
      {bench.note && <p className="mb-2 text-[11px] text-zinc-300">{bench.note}</p>}
      {report && (
        <div className="space-y-2">
          <p className="text-[11px] text-zinc-400">
            Budget: <span className="text-zinc-200">{report.grade.label}</span>
          </p>
          <ul className="space-y-0.5 text-[11px]">
            {report.grade.rows.map((r) => (
              <li key={r.name} className="flex justify-between gap-2">
                <span className="text-zinc-400">{r.name}</span>
                <span className={r.pass === true ? 'text-emerald-300' : r.pass === false ? 'text-rose-300' : 'text-zinc-500'}>
                  {r.value == null ? 'unmeasured' : big(Math.round(r.value * 10) / 10)} / {r.limit == null ? '—' : big(r.limit)}
                </span>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-1">
            <Button primary onClick={send}>
              Send report
            </Button>
            <Button onClick={copy}>Copy</Button>
          </div>
          {delivery && (
            <p className="text-[11px] text-zinc-300">
              {delivery.state === 'sending' && 'Sending…'}
              {delivery.state === 'sent' && `Saved on the server: ${delivery.file}`}
              {delivery.state === 'error' && `Not sent: ${delivery.message}. Use Copy instead.`}
              {delivery.state === 'copied' && 'Copied to the clipboard.'}
              {delivery.state === 'select' && 'Selected below: copy it manually.'}
            </p>
          )}
          <textarea
            ref={textRef}
            readOnly
            value={JSON.stringify(report, null, 2)}
            className="h-24 w-full rounded bg-zinc-900 p-1 font-mono text-[10px] text-zinc-300"
          />
        </div>
      )}
      <p className="mt-2 text-[10px] leading-4 text-zinc-500">
        Flags: {Object.entries(flags).map(([k, v]) => `${k} ${v ? 'on' : 'off'}`).join(' · ')}
      </p>
    </div>
  );
}
