/**
 * INK CODEX card theme — the inspect card's single styling source. The card
 * matches the world's INK+ICE direction (lib/fly/toy-world/toy-palette.js):
 * near-black ink-navy glass, silver/ice lines and text, and exactly TWO
 * saturated voices — the aircraft-class hero color (track.meta.color,
 * injected per-card as the CSS var --hero) and the rarity tier color
 * (lib/rarity.js). Everything else stays neutral so those two pop.
 *
 * Swap point: if the art direction ever moves again, retint HERE — the
 * card components only reference these tokens (and --hero).
 */

export const CARD_THEME = {
  // Round 7 "holo codex": the card went TRANSPARENT — the live world stays
  // visible behind it (the sky IS the backdrop). Text sits on gradient-
  // local panels, not an opaque body. Pre-round-7 values: bgTop .94,
  // bgBottom .97, scrim .55.
  bgTop: 'rgba(16, 19, 34, 0.30)',
  bgBottom: 'rgba(7, 10, 20, 0.38)',
  scrim: 'rgba(4, 6, 13, 0.12)', // whisper of a backdrop (PALETTE.voidFloor)
  edge: 'rgba(207, 238, 248, 0.30)', // card border (PALETTE.waterFoam @30%)
  edgeSoft: 'rgba(207, 238, 248, 0.14)', // inner hairlines / dividers
  textPanel: 'rgba(4, 6, 13, 0.42)', // gradient-local scrim behind data rows

  // Round 8.5 (§B): action-failure voice (card-level flash + notice) and
  // the hero-photo legibility scrim (docked panel, photo leads the card)
  danger: '#f87171',
  dangerFlash: 'rgba(248, 113, 113, 0.20)',
  heroScrim: 'linear-gradient(180deg, rgba(4, 6, 13, 0.35), transparent 30%, transparent 60%, rgba(4, 6, 13, 0.72))',

  // Ink+Ice text ramp
  ice: '#eef5ff', // primary text (PALETTE.roadMotorway)
  iceDim: '#8fa0bf', // muted labels
  iceFaint: '#5a6884', // ghost text (empty states)

  // Structure
  grid: '#3d4a75', // pedestal rings / meter tracks (PALETTE.voidGrid)
  panel: 'rgba(207, 238, 248, 0.07)', // chip / meter-track fills
  panelHover: 'rgba(207, 238, 248, 0.12)',
  shine: 'rgba(207, 238, 248, 0.13)', // holo sweep bar

  // Buttons: WARP is ice (neutral hero), CHASE wears the aircraft's hero
  // color (set inline via --hero + color-mix for the bevel edge)
  warpBg: '#eef5ff',
  warpEdge: '#8fa8c8', // border-b bevel
  warpText: '#101322',

  // Type faces
  fontDisplay: "'Archivo Black', ui-sans-serif, system-ui",
  fontMono: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
};
