# World comparison viewer

Run `node scripts/serve-world-comparison.cjs` from the repository, then open
<http://localhost:3100>. The server binds to loopback and only serves the review
page, capture manifest, explicit PNG files and asset credits. It does not run a
second renderer or change the game, graphics defaults or user saves.

- **Whole pass:** preserved pre-change production build versus the current
  lounge production build, with the three Living Airports review flags enabled.
- **Materials only:** the optional `airportArt` flag off versus on, in the same
  settled current-build scene. Airport discovery and scenery stay enabled.
- Four locations: Columbus, Manhattan, Innsbruck and Sydney. Drag the image or
  use the keyboard-accessible range control, endpoint buttons and full screen.
- Original PNGs and the capture manifest are accessible from the viewer. The
  manifest records build IDs, GPU, viewport, effective quality, camera pose,
  solar conditions and streaming census. Live provider tiles can introduce
  streaming differences between separately loaded builds.

Capture generation: `node scripts/capture-world-comparison.cjs`. It expects the
archived baseline on port 3098 and the current lounge build on port 3097. It uses
isolated browser storage, no live traffic requests, identical camera/lens pins,
and a frozen animation clock **after** scenery settles. No capture pin is added
to application source. The viewer refuses to publish an incomplete manifest or
one whose camera matching check failed. Images are unedited PNG screenshots,
not an approval of visual quality or a performance certification.

Artifact files are in `.graphics-review/world-comparison/`, outside production
assets. Reproduce the functional review with
`node scripts/verify-world-comparison.cjs` while the viewer is running. The game
can continue running independently on port 3097.

Verified on 2026-10-12T22:44:03.915Z: 12 captures; all four camera-match
checks pass (maximum pose/lens delta below 1e-9). Viewer checks: 27/27,
including both modes at each location, keyboard, pointer, full screen,
ultrawide/narrow layout and byte-identical original PNG serving.
Before build: TMOqTz2wQGZT_4YA_f1EW.
After build: mCp5rT2TKqQRM7cwAc2ow.
