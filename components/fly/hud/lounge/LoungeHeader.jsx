'use client';
import { Clock3, CloudRain, CloudSnow, Cloudy, Cloud, CloudSun, LocateFixed, Moon, Sun, Sunrise, Sunset, Wind, X } from 'lucide-react';

/*
 * LOUNGE HEADER — where you are and what it is like out there: the airport
 * code and name, the runway the window faces, the local time (offline zone
 * rules, lib/fly/airport-watch-sky.mjs), the sun, the live weather at the
 * field (runtime.weather — the cell the observer sits in) and the traffic
 * feed's state, which keeps its four distinct wordings (live / quiet /
 * delayed / unavailable).
 */

export function feedLabel(state, count) {
  if (state === 'live') return count ? `Live · ${count} aircraft` : 'Live · quiet skies';
  if (state === 'delayed') return 'Positions delayed';
  return 'Traffic connection unavailable';
}

/** Short, honest weather line from the /api/weather payload (null when there is none). */
export function weatherSummary(data) {
  if (!data || data.found === false || !Number.isFinite(data.cloudCoverPct)) return null;
  const c = data.cloudCoverPct;
  const sky = data.precip === 'snow' ? 'Snow' : data.precip === 'rain' ? 'Rain' : c < 12 ? 'Clear' : c < 35 ? 'Few clouds' : c < 60 ? 'Scattered clouds' : c < 88 ? 'Broken clouds' : 'Overcast';
  const kind = data.precip === 'snow' ? 'snow' : data.precip === 'rain' ? 'rain' : c < 12 ? 'clear' : c < 60 ? 'partly' : c < 88 ? 'cloudy' : 'overcast';
  const temp = Number.isFinite(data.tempC) ? `${Math.round(data.tempC)}°C` : null;
  const kt = Number.isFinite(data.windMps) ? data.windMps * 1.943844 : null;
  const wind = kt == null ? null : kt < 3 ? 'Calm' : Number.isFinite(data.windDirDeg) ? `${String(Math.round(data.windDirDeg / 10) * 10 || 360).padStart(3, '0')}° ${Math.round(kt)} kt` : `${Math.round(kt)} kt`;
  const vis = Number.isFinite(data.visM) && data.visM < 8000 ? `Vis ${(data.visM / 1000).toFixed(data.visM < 2000 ? 1 : 0)} km` : null;
  return { sky, kind, temp, wind, vis };
}

const SKY_ICON = { clear: Sun, partly: CloudSun, cloudy: Cloudy, overcast: Cloud, rain: CloudRain, snow: CloudSnow };

export function LoungeHeader({ code, name, runway, feed, count, clock, sun, weather, onAirports, onLeave }) {
  const SkyIcon = weather ? SKY_ICON[weather.kind] || Cloud : Cloud;
  const SunIcon = sun?.kind === 'night' ? Moon : sun?.kind === 'golden' || sun?.kind === 'twilight' ? (sun.rising ? Sunrise : Sunset) : Sun;
  return (
    <header className="lounge-header airport-watch-header" data-testid="lounge-header">
      <div className="lh-place lounge-panel">
        <span className="lh-code">{code}</span>
        <div className="lh-text">
          <h1 title={name}>{name}</h1>
          <p>
            Window lounge{runway ? <> <span aria-hidden="true">·</span> Runway {runway}</> : null}
          </p>
        </div>
      </div>
      <div className="lh-strip lounge-panel" role="group" aria-label="Conditions at the airport">
        <span className="lh-feed" data-state={feed === 'live' && !count ? 'quiet' : feed} data-testid="lounge-feed-status">
          <i aria-hidden="true" />
          {feedLabel(feed, count)}
        </span>
        {clock && (
          <span className="lh-item" data-testid="lounge-clock" title={clock.zone === 'solar' ? 'Mean solar time at the airport' : `Local time (${clock.zone})`}>
            <Clock3 size={14} aria-hidden="true" />
            <b>{clock.text}</b>
            <small>{clock.zone === 'solar' ? 'solar' : 'local'}</small>
          </span>
        )}
        {sun && (
          <span className="lh-item" data-sun={sun.kind} title={`Sun ${sun.elevationDeg.toFixed(1)}° above the horizon`}>
            <SunIcon size={14} aria-hidden="true" />
            {sun.label}
          </span>
        )}
        {weather && (
          <span className="lh-item" data-testid="lounge-weather" title="Current conditions at the field">
            <SkyIcon size={14} aria-hidden="true" />
            {[weather.sky, weather.temp].filter(Boolean).join(' · ')}
            {weather.wind && (
              <>
                <Wind size={13} aria-hidden="true" className="lh-wind" />
                {weather.wind}
              </>
            )}
            {weather.vis && <small>{weather.vis}</small>}
          </span>
        )}
      </div>
      <div className="lh-actions">
        <button type="button" className="lounge-btn" onClick={onAirports} data-testid="lounge-airports">
          <LocateFixed size={15} aria-hidden="true" />
          Airports
        </button>
        <button type="button" className="lounge-btn airport-exit" onClick={onLeave} data-testid="lounge-leave">
          <X size={15} aria-hidden="true" />
          Leave lounge
        </button>
      </div>
    </header>
  );
}
