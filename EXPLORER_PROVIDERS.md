# Explorer beta providers and hosting

Reviewed 2026-10-07. This records configuration and outstanding release work; it
does not authorize deployment or purchase a service. The release decision lives
in [EXPLORER_BETA.md](EXPLORER_BETA.md).

| Data | Current adapter / attribution | Production arrangement |
| --- | --- | --- |
| Runways | Checked-in OurAirports snapshot, manifest digests, locally searched regional JSON; credited in assets | Public-domain data with no accuracy guarantee. Refresh deliberately and review filtering. [Data terms](https://ourairports.com/data/) |
| Weather | `/api/weather`: Open-Meteo, then nearest AviationWeather METAR; source and observation/retrieval timestamps retained | Open-Meteo's free endpoint is non-commercial, 10,000 calls/day, no uptime guarantee. A commercial deployment needs an appropriate arrangement; no subscription was purchased. [Pricing and terms](https://open-meteo.com/en/pricing) |
| Traffic | `/api/aircraft`: adsb.lol → adsb.fi → airplanes.live with short timeouts, cooldown and bounded stale fallback; credits follow the active source | Validate each provider's intended production use and expected volume before launch. adsb.lol documents dynamic limits, not a guaranteed capacity. [API documentation](https://github.com/adsblol/api/blob/main/README.md), [adsb.fi](https://opendata.adsb.fi/), [Airplanes.live documentation](https://airplanes.live/api-docs/) |
| Vector tiles | OpenFreeMap / OpenMapTiles / OpenStreetMap; credits on-screen and exported photos | Review current hosting terms and capacity expectations; self-hosting remains an option. [OpenFreeMap terms](https://openfreemap.org/tos/) |
| Imagery/elevation | Esri World Imagery / Terrain3D through `lib/fly/tile-sources.js`; imagery contributors credited | Confirm public game distribution, caching and export rights/access arrangements before deployment. A reachable keyless URL is not a production agreement. [Esri attribution](https://www.esri.com/en-us/legal/terms/data-attributions) |
| Land cover | ESA WorldCover / Terrascope WMTS through existing world-cover adapter | Retain ESA/Copernicus credits; review service availability and production request volume. [Data access](https://esa-worldcover.org/en/data-access) |
| Aircraft / landmarks / coastlines | Existing local files and procedural fallbacks; `lib/fly/assets.js` and generated `CREDITS.md` | Preserve each source's recorded license, author and derivative notes. No new paid or unverified model was added. |

## Server configuration

These variables are optional and **server-only**. Do not prefix credentials with
`NEXT_PUBLIC_`. Defaults retain current providers. Custom endpoints must return
the same payload schema; changing the underlying provider also requires updating
source labels and credits in the adapter/attribution registry.

| Variable | Value |
| --- | --- |
| `SKYLOOM_WEATHER_URL` | Open-Meteo-compatible forecast endpoint, no query string; e.g. the contracted customer endpoint |
| `SKYLOOM_WEATHER_KEY` | Optional API key appended server-side; never returned to the browser |
| `SKYLOOM_METAR_URL` | AviationWeather-compatible METAR endpoint, no query string |
| `SKYLOOM_ADSB_LOL_URL` | HTTPS URL template with `{lat}`, `{lon}`, `{dist}` |
| `SKYLOOM_ADSB_FI_URL` | Same template contract for this failover source |
| `SKYLOOM_AIRPLANES_URL` | Same template contract for this failover source |

For imagery/elevation and vector/land-cover replacement, the existing TileSource
and worker adapters remain the configuration boundary; update their attribution
alongside URLs, decoder format, zoom bounds and cache identity. No provider
credentials belong in committed data, local screenshots or exported photos.

## Serving the candidate

Use a Node-capable Next.js host for the API routes, not static export alone.
Serve `.next-explorer` with the same `FLY_BUILD_DIR` used by `build:beta` and deploy
`public/` with its models, runway regions, textures and data. Keep worker chunk
URLs available at `/_next/static/`; workers need their webpack bootstrap and
dependent chunks. HTTPS is required on public hosts for browser capabilities.

Allow CORS for imagery/DEM/vector resources used by workers and WebGL. If a
Content-Security-Policy is introduced, test worker scripts, WebAssembly decoders,
local blob photo previews/downloads and the selected provider hosts explicitly.
Do not accidentally cache unavailable API responses indefinitely at the CDN.

Traffic requests use 3.5-second upstream attempts, cooldown and up to 90 seconds
of stale fallback. Client metadata distinguishes empty live airspace from failed
or stale data; over 15 seconds old reads delayed. Weather is cached by position
cell, preserves its source observation time and reads delayed beyond 90 minutes
or when the observation timestamp is unknown. Weather fallback remains playable.
Shared in-memory cooldown/cache state is per server instance, so horizontally
scaled hosting still requires provider-volume planning and monitoring.

Before public release record the actual host, provider contacts/agreements,
allowed volume, cache/export permissions, attribution review and who responds to
outages. These are pending acceptance work, not completed commitments.
