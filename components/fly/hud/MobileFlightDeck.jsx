"use client";
import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  X,
  Navigation,
  CircleParking,
  RotateCcw,
} from "lucide-react";
import { useFlyStore } from "@/stores/fly-store";
import {
  OPERATIONS_AIRPORTS,
  airportEligible,
} from "@/lib/fly/operations-airports";
import "./mobile-flight.css";

/** Compact flight controls: the runway stays visible and power never lives in a scroller. */
export function MobileFlightDeck({
  runtime,
  titles,
  BrakeButton,
  ApproachCue,
}) {
  const o = runtime.operations,
    f = runtime.flight,
    p = o.profile;
  const [settings, setSettings] = useState(false),
    trigger = useRef(null);
  useEffect(() => {
    const release = () => runtime.input?.setBrake(false);
    window.addEventListener("blur", release);
    const hide = () => {
      if (document.hidden) release();
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      release();
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [runtime]);
  const close = () => {
    setSettings(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const approach = o.phase === "approach",
    departure = ["parked", "taxiOut", "takeoffRoll"].includes(o.phase);
  const status = departure ? o.takeoffStatus(f) : null,
    stopped = ["crashed", "completed"].includes(o.phase);
  let cue = "Explore the world. Return when you are ready.";
  if (departure)
    cue =
      o.phase === "takeoffRoll"
        ? status.ready
          ? "Rotate · pull the stick down"
          : "Build speed · hold the centreline"
        : status.aligned
          ? "Runway aligned · ready when you are"
          : "Follow the gold taxi path";
  if (o.phase === "landingRoll") cue = "Idle power · hold brakes";
  if (o.phase === "taxiIn") cue = "Taxi to the stand · set parking brake";
  const primary = approach
    ? { label: "Go around", run: () => o.goAround(f) }
    : departure
      ? status.aligned || o.phase === "takeoffRoll"
        ? {
            label:
              o.phase === "takeoffRoll" ? "Takeoff power" : "Begin takeoff",
            run: () =>
              o.phase === "takeoffRoll"
                ? o.setPowerPreset(2)
                : o.startTakeoff(f),
          }
        : { label: "Taxi", run: () => o.startTaxi() }
      : o.phase === "landingRoll"
        ? { label: "Idle power", run: () => o.setPowerPreset(0) }
        : o.phase === "taxiIn"
          ? { label: "Taxi to stand", run: () => o.startTaxi() }
          : {
              label: "Guide approach",
              run: () => o.guideApproach(f, runtime.weather?.wx),
            };
  return (
    <section
      className="mobile-flight-deck"
      data-testid="mobile-flight-deck"
      data-phase={o.phase}
      aria-label="Flight operations"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape" && settings) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        if ([" ", "Enter"].includes(e.key) || e.target.matches("input,select"))
          e.stopPropagation();
      }}
    >
      <header className="mfd-strip">
        <button
          ref={trigger}
          className="mfd-flight"
          aria-label="Flight setup"
          aria-expanded={settings}
          aria-controls="mobile-flight-setup"
          onClick={() => setSettings((v) => !v)}
        >
          <span>
            {o.airport.id} <span className="mfd-muted">/ {o.runwayName}</span>
          </span>
          <strong>
            {departure && status.aligned && o.phase !== "takeoffRoll"
              ? "Ready for takeoff"
              : titles[o.phase]}{" "}
            <ChevronDown size={13} />
          </strong>
        </button>
        <output aria-label="Airspeed">
          <strong>{Math.round(f.speed * 1.94384)}</strong>
          <span>kt</span>
        </output>
        <output aria-label="Height above ground">
          <strong>
            {Math.max(0, Math.round((f.agl - p.clearance) * 3.28084))}
          </strong>
          <span>ft AGL</span>
        </output>
      </header>
      <div
        className="mfd-guidance"
        data-rotate={!!status?.ready && o.phase === "takeoffRoll"}
      >
        {approach ? (
          <ApproachCue path={o.approachGuidance(f)} flight={f} operations={o} />
        ) : (
          <>
            <Navigation size={14} />
            <span role="status">
              {stopped
                ? o.phase === "crashed"
                  ? o.reason
                  : "Flight complete"
                : cue}
            </span>
            {departure && (
              <span className="mfd-target">
                {Math.round(p.rotate * 1.94384)} kt
              </span>
            )}
          </>
        )}
      </div>
      {!stopped && (
        <div className="mfd-power" data-testid="mobile-flight-power">
          {o.lowSpeed && (
            <>
              <div className="mfd-power-title">
                <label htmlFor="mobile-flight-throttle">
                  Power <strong>{Math.round(o.throttle * 100)}%</strong>
                </label>
                <button onClick={() => o.setPowerPreset(0)}>Idle</button>
              </div>
              <input
                id="mobile-flight-throttle"
                aria-label="Throttle"
                type="range"
                min="0"
                max="100"
                value={Math.round(o.throttle * 100)}
                onChange={(e) => o.setThrottle(Number(e.target.value) / 100)}
              />
            </>
          )}
          <button className="mfd-primary" onClick={primary.run}>
            {primary.label}
          </button>
          {o.grounded && (
            <div className="mfd-brakes">
              <button
                aria-label="Parking brake"
                aria-pressed={o.parkingBrake}
                onClick={() => o.toggleBrake()}
              >
                <CircleParking size={17} />
                <span>{o.parkingBrake ? "Set" : "Off"}</span>
              </button>
              <BrakeButton runtime={runtime} />
            </div>
          )}
          {approach && (
            <button onClick={() => o.setApproachPower(f)}>
              Approach power
            </button>
          )}
        </div>
      )}
      {stopped && (
        <div className="mfd-result">
          <strong>
            {o.phase === "completed"
              ? "Parked. Nicely done."
              : "Ready for another try?"}
          </strong>
          {o.phase === "crashed" ? (
            <button
              className="mfd-primary"
              onClick={() => runtime.retryApproach()}
            >
              <RotateCcw size={16} />
              Retry approach
            </button>
          ) : (
            <button
              className="mfd-primary"
              onClick={() => useFlyStore.getState().setHangarOpen(true)}
            >
              Choose next flight
            </button>
          )}
        </div>
      )}
      {settings && (
        <section
          id="mobile-flight-setup"
          className="mfd-settings"
          aria-label="Flight setup"
        >
          <header>
            <strong>Flight setup</strong>
            <button aria-label="Close flight setup" onClick={close}>
              <X size={18} />
            </button>
          </header>
          <label htmlFor="mobile-arrival">Destination</label>
          <select
            id="mobile-arrival"
            value={o.destination}
            onChange={(e) => o.selectDestination(e.target.value)}
          >
            {OPERATIONS_AIRPORTS.filter((a) => airportEligible(a, p.id)).map(
              (a) => (
                <option key={a.id} value={a.id}>
                  {a.id} · {a.name}
                </option>
              ),
            )}
          </select>
          {approach && (
            <>
              <label htmlFor="mobile-runway">Runway</label>
              <select
                id="mobile-runway"
                value={o.reverse ? "reverse" : "forward"}
                onChange={(e) =>
                  o.setApproachRunway(e.target.value === "reverse")
                }
              >
                <option value="forward">{o.airport.runway}</option>
                <option value="reverse">{o.airport.reciprocal}</option>
              </select>
            </>
          )}
          <button aria-pressed={o.guidance} onClick={() => o.toggleGuidance()}>
            Guidance {o.guidance ? "on" : "off"}
          </button>
          {departure && (
            <button
              onClick={() => {
                runtime.lineUpRunway();
                close();
              }}
            >
              Line up on runway <small>Assisted</small>
            </button>
          )}
          {!o.grounded && (
            <button
              onClick={() => {
                runtime.retryApproach();
                close();
              }}
            >
              Practice landing <small>Assisted</small>
            </button>
          )}
          {o.routeWarning && <p role="status">{o.routeWarning}</p>}
          <button onClick={() => useFlyStore.getState().setHangarOpen(true)}>
            Return to hangar…
          </button>
        </section>
      )}
    </section>
  );
}
