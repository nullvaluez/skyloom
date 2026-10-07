'use client';

import { useSyncExternalStore } from 'react';
import { useFlyStore } from '@/stores/fly-store';
import { WEATHER_PRESETS, formatHour, getShownConditions, subscribeConditions } from '@/lib/fly/player-conditions';

const SERVER_SNAPSHOT = { hour: null, curated: false };

/**
 * TRUE EARTH (CONDITIONS): time of day and weather, Live by default. One
 * implementation for the pause card, the title's Settings sheet and the photo
 * bar (`compact`). A pick lasts for the session; a time change glides. While a
 * curated Adventure is flying, its authored conditions win and the controls
 * say so. Rendered only when conditionsOn() (callers gate it).
 */
export function ConditionsPanel({ compact = false }) {
  const hour = useFlyStore((s) => s.conditionsHour);
  const weather = useFlyStore((s) => s.conditionsWeather);
  const shown = useSyncExternalStore(subscribeConditions, getShownConditions, () => SERVER_SNAPSHOT);
  const curated = shown.curated;
  const sliderHour = hour ?? shown.hour ?? 12;
  const chip = (pressed) =>
    `rounded py-1 text-xs phone:min-h-11 disabled:opacity-40 ${
      pressed ? 'bg-zinc-100 font-medium text-zinc-900' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
    }`;

  return (
    <div className="rounded-md border border-zinc-700/60 p-2" data-testid="conditions-panel">
      <div className="mb-1.5 text-center text-[10px] uppercase tracking-widest text-zinc-400">Time &amp; weather</div>
      {curated && (
        <p className="mb-2 text-center text-xs text-zinc-400" data-testid="conditions-curated">
          This adventure sets its own time and weather.
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="conditions-time-live"
          aria-pressed={hour == null}
          disabled={curated}
          onClick={() => useFlyStore.getState().setConditionsHour(null)}
          className={`w-14 shrink-0 ${chip(hour == null)}`}
        >
          Live
        </button>
        <input
          type="range"
          min={0}
          max={24}
          step={0.25}
          value={sliderHour}
          disabled={curated}
          aria-label="Time of day"
          aria-valuetext={formatHour(sliderHour)}
          data-testid="conditions-time"
          onChange={(e) => useFlyStore.getState().setConditionsHour(Number(e.target.value))}
          className="h-6 min-w-0 flex-1 accent-zinc-100 disabled:opacity-40 phone:h-11"
        />
        <span className="w-11 shrink-0 text-right font-mono text-xs text-zinc-300" data-testid="conditions-time-label">
          {formatHour(hour ?? shown.hour)}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1">
        <button
          type="button"
          data-testid="conditions-weather-live"
          aria-pressed={weather == null}
          disabled={curated}
          onClick={() => useFlyStore.getState().setConditionsWeather(null)}
          className={chip(weather == null)}
        >
          Live
        </button>
        {WEATHER_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            data-testid={`conditions-weather-${p.id}`}
            aria-pressed={weather === p.id}
            disabled={curated}
            onClick={() => useFlyStore.getState().setConditionsWeather(p.id)}
            className={chip(weather === p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>
      {!compact && (
        <p className="mt-2 text-center text-[10px] text-zinc-500">Local sun time. Your pick lasts until you close the game.</p>
      )}
    </div>
  );
}
