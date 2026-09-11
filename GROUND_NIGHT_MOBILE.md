# Ground immersion, night lighting, and mobile controls

Base: GitHub `main`, fetched September 11, 2026, `f0cd81e5fe79979488a1e9a0cf062923d66a8450`.
Implementation branch: `codex/ground-night-mobile`. The original checkout's
uncommitted R25 work is preserved and is reference material only.

## Accepted direction

Cinematic Satellite flight at 50–500 ft above terrain, with material detail,
ground-contact shading, source-coherent local night illumination, and restrained
camera/audio proximity cues. Existing global lighting, clouds, weather, flight
physics, and desktop controls retain their behavior. No additional DoF or blur.

Touch controls use one labeled disclosure panel alongside the joystick. Speed
and held Boost live inside it; passive HUD readouts and attribution remain.
iPhone/Safari is the target, with smooth flight taking priority over fine detail.

## Integration and evidence

Ground, lighting, and mobile have distinct owners. Shared scene/effect wiring,
shader composition, prewarming, and final validation are integrated centrally.
The baseline is built and served from a separate clean worktree. Browser GPU
runs are sequential. Every final report must name the served build and source.

Validation results will be recorded here after integration. Missing data or
hardware is BLOCKED/unverified, never a pass. Chrome touch emulation does not
certify physical iPhone Safari.
