'use client';
import { Armchair } from 'lucide-react';

/*
 * The "Sit" prompt (LOUNGE_WALK): while you stand near a vantage seat and
 * face it (watch.sitPrompt: within WALK.sit.promptM and the yaw cone), Enter
 * — or a click on the prompt — sits you there. Test id lounge-sit-prompt.
 */
export function SitPrompt({ runtime, watch }) {
  if (!watch.walk || watch.posture !== 'standing' || !watch.prompt || watch.binocular) return null;
  const seat = runtime.airportWatch?.seats?.find((s) => s.id === watch.prompt);
  return (
    <button
      type="button"
      className="lounge-sit lounge-panel"
      data-testid="lounge-sit-prompt"
      onClick={() => runtime.airportWatch?.sit(watch.prompt)}
      aria-label={`Sit: ${seat?.label ?? 'seat'} (Enter)`}
    >
      <Armchair size={16} aria-hidden="true" />
      <span>Sit</span>
      <strong>{seat?.label ?? 'Seat'}</strong>
      <span className="tgt-kbd">Enter</span>
    </button>
  );
}
