# SkyTracker — Fly Mode

A keyless, real-time 3D flight tracker. Boot straight into **Fly Mode** and pilot
through a stylized mini-globe of live [ADS-B](https://en.wikipedia.org/wiki/Automatic_Dependent_Surveillance%E2%80%93Broadcast)
air traffic — real aircraft, real positions, rendered as a warped toy planet or a
satellite world you can fly across.

> **No API keys, no tokens, no `.env` required.** Every data source is a public,
> community-run endpoint. Clone, install, run.

## Features

- **Live traffic** — real aircraft streamed from community ADS-B networks
  (adsb.lol → adsb.fi → airplanes.live failover), rendered as a 3D fleet with
  contrails, nav lights, and altitude-aware behavior.
- **Two worlds** — a neon "Toy World" mini-planet and a satellite-imagery globe,
  both with real terrain elevation, curvature that scales with your altitude, and
  a streaming tile pipeline.
- **Fly it like a game** — free-flight controls, chase/cinema cameras, an Atlas
  fast-travel map, POI markers for ~1,700 world cities plus landmarks, military
  bases and spotting hotspots, contracts/scoring, and aircraft inspection cards.
- **Rich aircraft data** — photos (planespotters), route lookups, and type
  classification, all fetched on demand.

## Tech stack

Next.js 16 · React 19 · Three.js / React Three Fiber · Zustand · Web Workers ·
vector + raster map tiles. Rendering runs entirely client-side; the Next API
routes are thin, cache-friendly proxies to the public data sources.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app boots directly into
Fly Mode behind a loading screen.

```bash
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint
```

## Data sources & attribution

This project uses only tokenless, community/public data and openly-licensed
assets. Flight data is provided by [adsb.lol](https://adsb.lol) (ODbL) and peers;
map imagery © Esri/Maxar/Earthstar; 3D models, fonts, HDRIs and textures are
CC-BY / CC0 / OFL / public domain. **Full attribution is in
[CREDITS.md](CREDITS.md)** — please preserve it in any redistribution.

## Project notes

The `CLAUDE.md` and `FLY_*.md` files are the internal design/build record for the
Fly Mode reworks — kept as documentation of how the renderer evolved. They are
notes, not user docs.

## License

[MIT](LICENSE) © nullvaluez

Third-party assets bundled or fetched by this project retain their own licenses;
see [CREDITS.md](CREDITS.md).
