'use client';
import { Clock3, CloudRain, CloudSnow, Cloudy, Cloud, CloudSun, Ellipsis, LocateFixed, Moon, Sun, Sunrise, Sunset, Wind, X } from 'lucide-react';

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

/**
 * `place` names where you are in the room ('Window lounge' seated with no
 * walking; the seat or 'Standing' with LOUNGE_WALK). `leaveLabel` is the exit
 * button's wording (LOUNGE_BRIDGE makes it origin-aware); test id lounge-leave.
 */
export function LoungeHeader({ code, name, runway, feed, count, clock, sun, weather, onAirports, onLeave, place = 'Window lounge', leaveLabel = 'Leave lounge' }) {
  const SkyIcon = weather ? SKY_ICON[weather.kind] || Cloud : Cloud;
  const SunIcon = sun?.kind === 'night' ? Moon : sun?.kind === 'golden' || sun?.kind === 'twilight' ? (sun.rising ? Sunrise : Sunset) : Sun;
  return (
    <header className="lounge-header airport-watch-header" data-testid="lounge-header">
      <div className="lh-place lounge-panel">
        <span className="lh-code">{code}</span>
        <div className="lh-text">
          <h1 title={name}>{name}</h1>
          <p data-testid="lounge-place">
            {place}{runway ? <> <span aria-hidden="true">·</span> Runway {runway}</> : null}
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
          {leaveLabel}
        </button>
      </div>
    </header>
  );
}

/*
 * LOUNGE MOBILE — GLASS: the phone header. One compact bar under the notch:
 * the airport code with the feed's live dot and count, the name over the
 * place and runway, the local clock, and the menu button (lounge-menu) that
 * opens the lounge menu sheet — Airports and Leave (lounge-airports,
 * lounge-leave) are two taps away there, and the conditions this bar has no
 * room for (sun, weather, wind) ride with them (LoungeConditions).
 */
export function LoungeHeaderPhone({ code, name, runway, feed, count, clock, place = 'Window lounge', menuOpen = false, onMenu }) {
  const state = feed === 'live' && !count ? 'quiet' : feed;
  return (
    <header className="lounge-header lph" data-testid="lounge-header" data-lounge-avoid="">
      <span className="lph-code">
        {code}
        <span className="lph-feed" data-state={state} data-testid="lounge-feed-status" title={feedLabel(feed, count)}>
          <i aria-hidden="true" />
          <span className="lph-sr">{feedLabel(feed, count)}</span>
          {feed === 'live' && count ? <b aria-hidden="true">{count}</b> : null}
        </span>
      </span>
      <span className="lph-text">
        <strong title={name}>{name}</strong>
        <small data-testid="lounge-place">
          {place}{runway ? <> <span aria-hidden="true">·</span> {runway}</> : null}
        </small>
      </span>
      {clock && (
        <span className="lph-clock" data-testid="lounge-clock" title={clock.zone === 'solar' ? 'Mean solar time at the airport' : `Local time (${clock.zone})`}>
          <b>{clock.text}</b>
          <small>{clock.zone === 'solar' ? 'solar' : 'local'}</small>
        </span>
      )}
      <button type="button" className="lph-menu" data-testid="lounge-menu" aria-label="Lounge menu" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={onMenu}>
        <Ellipsis size={20} aria-hidden="true" />
      </button>
    </header>
  );
}

/** The conditions at the field as one wrapping line (the phone's lounge menu). */
export function LoungeConditions({ feed, count, sun, weather }) {
  const SkyIcon = weather ? SKY_ICON[weather.kind] || Cloud : Cloud;
  const SunIcon = sun?.kind === 'night' ? Moon : sun?.kind === 'golden' || sun?.kind === 'twilight' ? (sun.rising ? Sunrise : Sunset) : Sun;
  return (
    <p className="lms-conditions" role="group" aria-label="Conditions at the airport">
      <span className="lh-feed" data-state={feed === 'live' && !count ? 'quiet' : feed}>
        <i aria-hidden="true" />
        {feedLabel(feed, count)}
      </span>
      {sun && (
        <span data-sun={sun.kind}>
          <SunIcon size={14} aria-hidden="true" />
          {sun.label}
        </span>
      )}
      {weather && (
        <span data-testid="lounge-weather">
          <SkyIcon size={14} aria-hidden="true" />
          {[weather.sky, weather.temp, weather.wind, weather.vis].filter(Boolean).join(' · ')}
        </span>
      )}
    </p>
  );
}
