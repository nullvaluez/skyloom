# Shared Open Sky — multiplayer

Other Free Flight pilots appear in your sky next to the real ADS-B traffic. The
world is one shared Earth with no accounts, no rooms and no saved data. You see
pilots within about 150 km. You can lock them, inspect them, fly in formation
with **Escort**, warp to them, and send a few preset signals. There is no chat.

- **Status:** built behind the TRUE EARTH flag `MULTIPLAYER` (`enabled:false`)
  on branch `claude/practical-newton-uhxjoc`. With the flag off, or with no
  relay URL, nothing loads, no socket opens and nothing renders. The existing
  harness fleet pins it off.
- **Plan:** the approved plan lives with the session. This file is the record.

---

## For players

| What | How |
|---|---|
| See other pilots | Fly in **Free Flight**. Pilots show as aircraft with their real hangar airframe, a callsign label (for example `HERON 27`), a ringed minimap dot and a colour of their own. |
| Inspect / Escort / Warp | Lock a pilot (as with any aircraft), then **Inspect**: the dossier shows their callsign and aircraft. **Escort** flies alongside them. **G** in the dossier warps you behind them. |
| Signals | **4** wave · **5** follow me · **6** nice · **7** smoke on/off. On touch, use the Signals buttons. Nearby pilots (within 60 km) see a bubble and a toast. A wave also rocks your wings on their screen. |
| Find people | The chip (top-left) shows `● N online · M in range`. When no one is near, open the **Atlas** (M): purple dots are pilot clusters, and **Fly there** takes you to one. |
| Go invisible | Settings → **Fly with others: Off**, or **Turn off** on the "You're visible…" banner. This is never saved, so a reload turns it back on. |

**Where multiplayer is active.** Only Free Flight joins the shared sky.
The title screen, the hangar, Takeoff & Landing and Adventures leave it at
once. While you are paused, or in a menu, the Atlas or the inspect card, other
pilots see you as *paused*.

**What scoring and saves ignore.** Spotting another pilot never counts toward
the passport, contracts, SPICY, near-miss, encounters or Atlas visits. Nothing
about multiplayer is ever written to storage.

## What others see about you

- Your aircraft type and its in-game position, heading and attitude.
- A random callsign, new on every page load.
- Whether you are paused, crashed, boosting or smoking.

They never see an account, a name or your real location. The app has no
geolocation. The relay sees your IP address only as an in-memory rate-limit key
and never logs or stores it.

---

## Try it on your own computer

```bash
npm install
npm run mp                                        # terminal 1: the relay on 127.0.0.1:8787
NEXT_PUBLIC_MP_URL=ws://localhost:8787/mp npm run dev   # terminal 2: the app
```

Open `http://localhost:3000/?flags=MULTIPLAYER` in **two** browser windows and
start Free Flight in both. With no configuration the relay accepts localhost
pages. One machine can hold at most 6 connections, the per-IP limit.

---

## Deploy

There are two ways to deploy, neither needing Docker. **A** is the
recommended one when the game already runs on Netlify.

### A. Game on Netlify, multiplayer relay on CloudPanel (recommended)

Netlify keeps building and serving the game exactly as today. Your CloudPanel
server runs **only the relay**: one small Node process (~35 MB) and no site
build, so the server needs almost no memory. The game page connects to the
relay over a secure WebSocket on a subdomain, e.g. `wss://mp.your-domain.com/mp`.

**On CloudPanel (the relay)**

1. **DNS.** Point a subdomain such as `mp.your-domain.com` at your CloudPanel
   server with an A record.
2. **Create the site.** Add a site and choose **Create a Node.js Site** with
   domain `mp.your-domain.com`, **Node.js 22** and **App Port 8787**. Then
   issue a Let's Encrypt certificate under the site's **SSL/TLS** tab. A
   Netlify page is HTTPS, so the relay must be too.
3. **Add the WebSocket route.** In the site's **Vhost** tab, paste the block
   from [`deploy/cloudpanel-nginx.conf`](deploy/cloudpanel-nginx.conf) just
   above the existing `location / {` line, and save.
4. **Get the code.** SSH in as the **site user**:

   ```bash
   cd ~/htdocs/mp.your-domain.com
   # the folder must be empty first (remove CloudPanel's placeholder files)
   git clone https://github.com/nullvaluez/skyloom.git .
   git checkout claude/practical-newton-uhxjoc   # until this work is merged
   npm install -g pm2                            # once per site user
   cp deploy/relay.env.example deploy/relay.env
   nano deploy/relay.env    # set MP_ORIGINS to your game's address(es)
   ```

   `MP_ORIGINS` lists the pages allowed to connect. Use your Netlify address,
   e.g. `https://your-site.netlify.app`. Add `https://*--your-site.netlify.app`
   to also allow deploy previews and branch deploys. If the game has its own
   domain on Netlify, list that address too. `deploy/relay.env` stays on the
   server only; git ignores it.
5. **Start it.**

   ```bash
   bash deploy/relay-update.sh
   ```

   This pulls, installs the relay's single package (`ws`) into `server/`, starts
   or reloads `skyloom-relay` under PM2 and saves the list. It ends with
   `Multiplayer relay: OK`. Run the same command for every update.
6. **Survive reboots.** Run `which pm2` and note the path. Then run
   `crontab -e` and add `@reboot /full/path/to/pm2 resurrect`.
7. **Check it.** `https://mp.your-domain.com/mp/healthz` should answer
   `{"ok":true,…}`.

**On Netlify (the game)**

1. Go to **Site configuration → Environment variables** and add
   `NEXT_PUBLIC_MP_URL` = `wss://mp.your-domain.com/mp`.
2. Redeploy. `NEXT_PUBLIC_…` values are baked in when the site builds, so a
   rebuild is required after adding or changing the variable.
3. Netlify must build code that contains multiplayer. Either merge this branch
   into the branch Netlify publishes, or turn on **branch deploys** and test at
   `https://claude-practical-newton-uhxjoc--your-site.netlify.app` first.
4. Open the game with `?flags=MULTIPLAYER` on two devices and fly Free Flight
   in both.

If the chip says *Offline — retrying*:
- the relay's address in `NEXT_PUBLIC_MP_URL` is wrong;
- the certificate is missing; or
- your game's address is not in `MP_ORIGINS`. `pm2 logs skyloom-relay`
  counts refused origins as `reject{origin=N}`.

### B. Everything on CloudPanel

CloudPanel already provides nginx, free HTTPS certificates and per-site Node.js.
Skyloom runs as two small processes kept alive by **PM2**:

- `skyloom-app` — the website (`next start`) on `127.0.0.1:3000`.
- `skyloom-relay` — the multiplayer relay on `127.0.0.1:8787`.

Both listen on localhost only. CloudPanel's nginx is the public door, and it
forwards `/mp` on your domain to the relay.

1. **Create the site.** In CloudPanel, add a site and choose **Create a Node.js
   Site**. Enter your domain, pick **Node.js 22** (20 also works), and set
   **App Port 3000**. Then issue a Let's Encrypt certificate under the site's
   **SSL/TLS** tab.
2. **Add the multiplayer route.** Open the site's **Vhost** tab. Paste the block
   from [`deploy/cloudpanel-nginx.conf`](deploy/cloudpanel-nginx.conf) inside the
   `server { … }` block, just above the existing `location / {` line, and save.
3. **Get the code.** SSH in as the **site user** CloudPanel created, then:

   ```bash
   cd ~/htdocs/<your-domain>
   # the folder must be empty first (remove CloudPanel's placeholder files)
   git clone https://github.com/nullvaluez/skyloom.git .
   git checkout claude/practical-newton-uhxjoc   # until this work is merged
   npm install -g pm2                            # once per site user
   ```

4. **Build and start.**

   ```bash
   bash deploy/update.sh
   ```

   The script pulls, installs, builds with multiplayer pointed at `/mp`, starts
   or reloads both processes and saves the PM2 list. It ends with
   `Multiplayer relay: OK` when the relay answers. Run the same command for
   every future update.
5. **Survive reboots.** Run `which pm2` and note the path. Then run `crontab -e`
   and add:

   ```
   @reboot /full/path/to/pm2 resurrect
   ```

6. **Check it.** `https://<your-domain>/mp/healthz` should answer
   `{"ok":true,…}`. Open `https://<your-domain>/?flags=MULTIPLAYER` on two
   devices and fly Free Flight in both.

**Notes**
- **Memory.** `next build` needs memory. On a VPS with 2 GB of RAM or less, add
  swap before building.
- **Origins.** No relay configuration is needed. Unless `MP_ORIGINS` is set, the
  relay accepts pages from its own domain (the browser's Origin equals the
  site's Host) and localhost. Every other site gets 403.
- **Cloudflare.** If your domain sits behind Cloudflare's proxy (orange
  cloud), WebSockets work. However, nginx then sees Cloudflare's addresses, so
  the per-IP limit would group players. Enable CloudPanel's Cloudflare real-IP
  option if it has one, or set `MP_CLIENT_IP_HEADER=cf-connecting-ip` for
  `skyloom-relay`.
- **Logs and restarts.** Logs are in `pm2 logs skyloom-relay`, with one
  aggregate line a minute and no addresses or callsigns. `pm2 restart
  skyloom-relay` is safe: everyone reconnects within seconds.

## Turning it on for everyone

Until you have checked it on your own machines, multiplayer is reached with
`?flags=MULTIPLAYER`. To make it the default, set `enabled: true` in the
`MULTIPLAYER` block at the end of `lib/fly/fly-constants.js` and redeploy the
game: let Netlify rebuild for option A, or run `bash deploy/update.sh` for
option B. Players who don't want to be seen can still turn it
off in Settings.

---

## How it works

```
Browser (Free Flight)                          Relay  server/mp-relay.mjs (ws, memory only)
FlightModel.step (-50)                         upgrade checks: path · Origin · per-IP · cap
TrafficEngine.update (-45)                     mp-world.mjs: 1° grid · nearest 48 within 150 km
 ├ remote step (lib/fly/mp/session.js) ── STATE 29 B ─▶   tiers: ≤3 km & 8 nearest at 10 Hz, rest 1 Hz
 │   own pose → 10 Hz near / 1 Hz far / held           one binary BATCH per viewer per 100 ms tick
 │   pilots dead-reckoned to the present ◀─ BATCH 8+29k ─ JSON: welcome/pong/enter/exit/where/err/bye
 └ ADS-B loop (unchanged)
Every traffic consumer then works on pilots: TrafficLayer (+ remote fleet), labels,
minimap, targeting, Escort, inspect dossier, tracers/contrails (smoke).
```

- **Engine.** `TrafficEngine` gains a remote source that runs *before* the
  ADS-B loop, so pilots show even with no live feed and lead every cap. ADS-B
  tracks are bit-identical to before (`verify-mp-engine` holds a frozen trace
  digest).
- **Motion.** Pilots are dead-reckoned to the **present** on a clock synced
  over the ping/pong (`lib/fly/mp/motion.mjs`). Both screens therefore agree in
  formation instead of each seeing the other ~200 ms late. Prediction errors
  decay over 0.25 s; warps, crash respawns and >400 m errors snap.
- **Render.** Each pilot draws as their real hangar airframe: the
  `player-*-mobile` GLB, instanced per type on the traffic hull material, so
  there is no new shader. That costs +1 draw per aircraft type in view (at most
  10), and 0 with the flag off. A look-alike traffic archetype stands in while
  the GLB loads.
- **Wire.** [`lib/fly/mp/protocol.mjs`](lib/fly/mp/protocol.mjs) defines
  `PROTOCOL 1`:
  - **STATE** (29 B): aircraft · flags (held, crashed, boost, smoke, assisted,
    emote) · warpSeq · ts in relay ms · lat/lon ×1e7 · alt 0.5 m · heading ·
    pitch · bank · speed 0.05 m/s · vUp 0.1 m/s.
  - **BATCH** records carry the same 20-byte pose, which the relay copies
    without re-quantizing.
  - **Versioning:** a layout change bumps `PROTOCOL`. Ship a relay accepting
    `[v−1, v]` first, then the app.
- **Bandwidth per player.**

  | Situation | Bandwidth |
  |---|---|
  | Alone | ≈0.1 KB/s |
  | In a busy cluster | ≈3.5 KB/s |
  | Hard ceiling | ≈4.3 KB/s |

  One small VPS covers the default cap of 500 concurrent pilots.

### Relay settings (environment variables; none are secrets)

| Variable | Default | Meaning |
|---|---|---|
| `MP_HOST` / `MP_PORT` / `MP_PATH` | `127.0.0.1` / `8787` / `/mp` | where it listens |
| `MP_ORIGINS` | *unset* = own site + localhost | comma list: exact origins, `https://*.example.com`, or `same` |
| `MP_TRUST_PROXY` | `loopback` | whose `X-Forwarded-For` to believe: `loopback`, a CIDR list, or `all` |
| `MP_CLIENT_IP_HEADER` | `x-forwarded-for` | or `cf-connecting-ip`, `x-real-ip`, `fly-client-ip` |
| `MP_MAX_PLAYERS` | `500` | global cap (`Sky is full` beyond it) |
| `MP_MAX_PER_IP` / `MP_CONNECT_PER_MIN` | `6` / `20` | per-address limits (IPv6 by /56) |
| `MP_TICK_HZ` / `MP_RADIUS_KM` | `10` / `150` | update rate and visibility radius |

**Abuse limits:**
- 20 messages/s per socket;
- frames are at most 512 B, and a binary frame must be exactly one STATE;
- teleports are accepted only with a warp sequence bump (3 tokens, refilled 1
  per 5 s);
- a held socket is closed after 10 minutes.

### Files

| Area | Files |
|---|---|
| Relay | `server/mp-relay.mjs` (I/O), `server/mp-world.mjs` (pure world) |
| Shared | `lib/fly/mp/protocol.mjs`, `lib/fly/mp/remote-meta.js`, `lib/fly/mp/mp-flag.js` |
| Client | `lib/fly/mp/session.js`, `lib/fly/mp/motion.mjs`, `hooks/use-fly-multiplayer.js`, `stores/mp-store.js` (not persisted) |
| Engine/render | `lib/fly/traffic-engine.js`, `components/fly/TrafficLayer.jsx`, `TrafficTracers.jsx`, `TrafficContrails.jsx`, `Contrail.jsx`, `hud/LabelCanvas.jsx`, `hud/Minimap.jsx`, `lib/fly/detailed-traffic.js`, `lib/fly/aircraft-effects.js` |
| Gates on scoring/persistence | `FlyScene.jsx`, `hud/InspectModal.jsx`, `hud/InfoCard.jsx`, `hud/Contracts.jsx`, `hud/SpotToast.jsx`, `lib/fly/juice.js`, `lib/fly/encounters.mjs`, `lib/fly/encounter-runtime.js`, `lib/fly/escort.js` |
| UI | `hud/MpStatusChip.jsx`, `hud/mp.css`, `hud/SettingsRows.jsx`, `hud/TouchActionPanel.jsx`, `PauseMenu.jsx`, `hud/Atlas.jsx`, `hud/atlas/*` |
| Deploy | `deploy/ecosystem.config.cjs` (PM2), `deploy/cloudpanel-nginx.conf` (Vhost block), `deploy/relay-update.sh` + `deploy/relay.env.example` (relay only, option A), `deploy/update.sh` (whole site, option B) |
| Flag | `MULTIPLAYER` block at the end of `lib/fly/fly-constants.js`; listed in `lib/fly/device-report.js`; pinned off in `scripts/_boot.js` and `scripts/_mobile-boot.js` |

---

## Verification

Node gates are all in `scripts/r24-smoke.sh` (`SMOKE_NODE_ONLY=1`):

| Gate | What it proves |
|---|---|
| `verify-mp-protocol` | Codec round-trips at the extremes. The aircraft table matches the hangar. No storage API anywhere in the multiplayer files, and `BACKUP_KEYS` unchanged. |
| `verify-mp-relay` | An in-process relay on ephemeral ports (38 rows), covering welcome, callsigns, interest, tiers, teleports, floods, caps, proxy/IP keys, the same-site origin rule, the PM2 launch shape, a log that holds no addresses, and the grid against brute force. |
| `verify-mp-engine` | Remote pilots with no ADS-B, a frozen ADS-B trace and every consumer gate. |
| `verify-mp-motion` | Clock sync and dead-reckoning error bounds (straight, turning, stalls, antimeridian, wave). |
| `verify-mp-session` | Real sessions in worker threads through a real relay: see each other, signals, smoke, leave/return, where, disclosure, teardown. |
| `verify-mp-smoke` / `verify-mp-ui` | Smoke stations. Flag-off contrail buffers and settings/touch/help markup unchanged. |
| `verify-mp-browser` | One Fly page in Chromium with bot pilots through a live relay (offline fixture). |

**Verified here, outside the gates:**
- PM2 starts the relay from `deploy/ecosystem.config.cjs`.
- An nginx vhost shaped like CloudPanel's Node.js template, with the pasted
  block, serves `/mp/healthz`, upgrades a same-site page, refuses a foreign
  Origin (403) and still serves the site.
- A remote client spoofing a fresh `X-Forwarded-For` per connection still hits
  the per-IP cap.
- The option A relay-only install from a fresh checkout behaves as intended:
  - `ws` installs into `server/` and PM2 starts `skyloom-relay` with its
    settings from `deploy/relay.env`;
  - the Netlify site, its deploy previews and branch deploys connect;
  - `evil.netlify.app`, `shadowads.netlify.app.evil.com` and the relay's own
    domain get 403.

**Only the owner can verify** (this container has no GPU and its tile and
ADS-B hosts are blocked):
- formation feel over the real internet;
- wave and smoke readability;
- fps with 30+ pilots on the RTX 5080 and an iPhone;
- the flag-on Owens draw count (headroom is about 3–7 draws against a remote
  fleet of up to +10);
- iOS backgrounding and reconnect;
- the chip's placement on phones;
- the real CloudPanel + Netlify install.

## Open owner decisions

- **Default visibility:** ON with a disclosure (current) or opt-in
  (`defaultOn:false`).
- **Smoke at night:** smoke uses the shared contrail colour, so it is not
  bright white at night. A dedicated white smoke draw would cost +1 draw.
- **Hangar round trip:** smoke turns off when you leave the shared sky,
  including a quick hangar round trip.
- **Formation contract:** formation with a pilot never counts toward the
  persisted formation contract.
- **Far-tier pilots in hard turns:** pilots beyond 3 km update once a second,
  so a hard turn is drawn tens of metres off until the next update. Close
  pilots update 10 times a second.
