# Landmark hero-model shortlist: licence-checked (2026-10-06)

## Read first: evidence level

This container's egress blocks every model host: sketchfab.com, api.sketchfab.com, poly.pizza, icosa.gallery, commons.wikimedia.org, en.wikipedia.org, 3d.si.edu, science.nasa.gov, data.nasa.gov, cgtrader.com, openheritage3d.org and trepaning.com. Plain curl gets a CONNECT 403 and WebFetch returns EGRESS_BLOCKED. Only github.com was readable. Each licence below therefore carries one of three statuses:

- **INDEX**: the text the search engine indexed from the asset's own page. I could not open the page.
- **PAGE**: I read the page directly.
- **UNVERIFIED**: the evidence is missing or conflicting.

**No candidate is cleared to ship until the owner re-reads its page.** Sketchfab downloads need a login (LANDMARK_UPGRADES.md recorded HTTP 401 without authentication). After downloading, read the GLB's `asset.extras` (author, licence, source) before crediting anyone. That is R20 lesson 2.

**Licence mapping.** Sketchfab's "CC Attribution" is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (per the index of [sketchfab.com/licenses](https://sketchfab.com/licenses)). The manifest string is therefore `CC-BY 4.0`, which passes the verify-icons A6 allowlist `^(CC0|CC-BY [0-9.]+|Public Domain|MIT)$`. Excluded licences:

- Sketchfab **"Free Standard"** and Store **"Royalty Free"** are marketplace licences. This removes PeeJaa's One WTC, Tower Bridge and Space Needle, plus every Zhang Shangbin store item.
- **CC BY-SA**: no candidate needed it.

**Pipeline fit.** Every Sketchfab row downloads as glTF/GLB (auto-converted). `r20-monument-bake.mjs` bakes textures into COLOR_0. The budgets are: far under 1 MiB, medium under 20k triangles, high under 60k triangles and 4 MiB. Lattice structures do not decimate (the R20 Eiffel lesson).

## Candidates

| Landmark | Candidate | Author (as credited) | Licence (quoted) | Source URL | Tris / verts; textured | Notes / risks |
|---|---|---|---|---|---|---|
| **One World Trade** (Manhattan route) | One World Trade Center | NanoRay | "CC Attribution" (INDEX) | https://sketchfab.com/3d-models/one-world-trade-center-44e60b2d0d764fdab74d33703847d38e | 34.6k / 30.9k; textures unknown | Published 2021-06-26. This is the author's own page, so it clears the R20 rejection (author was only inferred from a re-host). Fits the high tier. |
| **Statue of Liberty** (route; upgrade) | Statue Of Liberty | Gravity Jack (@gravityjack) | "CC Attribution" (INDEX) | https://sketchfab.com/3d-models/statue-of-liberty-84094e8d5e724b5c882cf576ca12e44e | 56.9k / 29.1k; PBR-textured | Published 2018-02-08. Fits the high tier. Keep Anna M's 2,458-tri model for far/medium. |
| **Sydney Harbour Bridge** (route) | none acceptable | | | | | See the "no acceptable model" list. |
| **Golden Gate Bridge** | Golden Gate bridge | Steren (Steren Giannini on Poly Pizza) | "CC Attribution" (INDEX) | https://sketchfab.com/3d-models/golden-gate-bridge-17432e0f095b46dd98034acbf93abe72 | 2.2k / 2.3k; Google Blocks, flat colours | Bridges were excluded from R20 v1 (span math). High-tier alternative: JuanG3D, 93.1k tris, "CC Attribution", sketchfab …/golden-gate-bridge-a0ee5a9c285849c0819af5f366be3835. damongraphics' version is CC0 but 3.7M tris. |
| **Petronas Towers** | Petronas Twin Towers | NanoRay | "CC Attribution" (INDEX) | https://sketchfab.com/3d-models/petronas-twin-towers-4111f3de53f24ab0a9547205723665b1 | 48.0k / 37.9k; textures unknown | Fits the high tier. Same author as One WTC. |
| **Burj Khalifa** | Burj Khalifa | NanoRay | "CC Attribution" (INDEX) | https://sketchfab.com/3d-models/burj-khalifa-5c82941a56cc49a9918effce9d20ca82 | 8.2k / 5.1k | Optional: the shipped first-party model already has three LODs. Alternative: ManySince910, 16.7k tris, "CC Attribution" (the listing evaluated earlier). |
| **Sagrada Família** | Barcelona Sagrada Familia | Roberto Domínguez (@vmmaniac) | "CC Attribution" (INDEX) | https://sketchfab.com/3d-models/barcelona-sagrada-familia-da32af2e358844eb92a0b2b97c793b46 | 4k / 2k | Medium tier. Alternative: MaaB, 47k tris, "CC Attribution". |
| **St Basil's** (POI "Red Square") | Saint Basil's Cathedral | Polskaball (@augustgamer1808) | "CC Attribution" (INDEX) | https://sketchfab.com/3d-models/saint-basils-cathedral-a0b09745ecfe4cfea590eefcaac1e457 | 44.4k / 44.1k; textures unknown | Fits the high tier. The dome colours must survive the bake. |
| **Brandenburg Gate** | Brandenburg gate (no horses or chariot) | DylanF (@dylanf538) | "CC Attribution" (INDEX) | https://sketchfab.com/3d-models/brandenburg-gate-no-horses-or-chariot-839c285f5b2b41af9acbadde6b2c80cc | 14k / 7.1k | Has no quadriga, and it is the author's first model, so check how it reads. |
| **Christ the Redeemer** | Cristo redentor - Christ the Redeemer | Walter Araujo (@walteraraujo) | "CC Attribution" (INDEX) | https://sketchfab.com/3d-models/cristo-redentor-christ-the-redeemer-27c2c6a36001409b9f6879051e6217e1 | 14.8k / 7.4k | The statue is under copyright (see IP caveats). |
| **Tower Bridge** | Tower Bridge | Ishan.bs2015 (2) (@tarit.bs) | "CC Attribution" (INDEX) | https://sketchfab.com/3d-models/tower-bridge-c6f6a570788d48a88383eb554eeb02ef | 89.2k / 53.6k | Over the high budget, so it needs decimation and the bridge path. |
| **Westminster + Leaning Tower of Pisa** (+ Berlin TV Tower) | Monuments (three-model pack) | Ankitimation | "CC Attribution" (INDEX) | https://sketchfab.com/3d-models/monuments-ef21e4b038b54bc0a0dc09f7ec05282e | 170k / 91.4k in total; textured | Split and decimate. The Palace would complete the Big Ben POI. |
| **Kennedy Space Center / Space Center Houston** (Saturn V archetype) | Saturn V | NASA (index credits Michael Carbajal) | **UNVERIFIED.** The repo README reads "These assets are free and without copyright." (PAGE). The repo meta.json reads "NASA Open Source Agreement Version 1.3" (PAGE). | https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Saturn%20V | GLB 905 KB; 34,814 polygons (INDEX) | The asset's own page (science.nasa.gov) is blocked. The README and NOSA statements conflict. The depiction is symbolic: the real Saturn Vs at both sites lie horizontal indoors. |
| **Giza Pyramids** | Giza Pyramid Low-poly | Lucas Patez (@lukpatez) | "CC Attribution" (INDEX) | https://sketchfab.com/3d-models/giza-pyramid-low-poly-56b9466947ea4ded9bc8a2fa625fd335 | 12 tris | Not worth an attribution. Build it first-party instead. |
| **Sydney Opera House, ESB, Eiffel, Big Ben, Taj, Colosseum, Willis, Space Needle, Gateway Arch** | keep the shipped models | | | | | I did not re-scout these, and no compelling upgrade surfaced in passing. |

## Ranked recommendation (14)

1. **One World Trade, NanoRay.** It sits on the Manhattan route and is still procedural, and the direct author page resolves R20's provenance rejection.
2. **Statue of Liberty high tier, Gravity Jack.** It is the route's opening hero; 56.9k fits the high budget, and the current model stays as far/medium.
3. **Golden Gate, Steren.** A 2.2k-tri Blocks model is the closest style match to the untextured bake. It needs the bridge path, and the POI already carries span 2000 m and heading 17°.
4. **Sydney Harbour Bridge, first-party builder.** It is a route landmark with no acceptable model. Build a parametric arch with a 503 m span and 134 m apex, and add a new POI (it is absent from landmarks.js).
5. **Petronas, NanoRay.** It fits the high tier and keeps one credit family with pick 1.
6. **Sagrada Família, Roberto Domínguez (4k).** This is the cheapest new silhouette in the set.
7. **St Basil's, Polskaball.** The onion domes are unmistakable; confirm the colour bake.
8. **Brandenburg Gate, DylanF.** It fits the medium tier; add a first-party quadriga block if the gate reads bare.
9. **Giza, first-party.** Build three pyramids at their real dimensions; a 12-tri CC-BY model is not worth a credit line.
10. **Tower Bridge, Ishan.bs2015.** Strong identity, but it needs decimation plus the bridge path.
11. **Westminster and Pisa, Ankitimation pack.** It gives Big Ben its Palace and gives Pisa a model, but it is heavy and textured.
12. **Burj Khalifa, NanoRay (optional).** Use it only if real massing beats the shipped first-party LODs.
13. **Christ the Redeemer, Walter Araujo (conditional).** Use it only with the Archdiocese's permission; otherwise keep the procedural statue.
14. **Saturn V, NASA (conditional).** Resolve the README-versus-NOSA conflict on the asset's own page first.

## No acceptable model found

- **Sydney Harbour Bridge.** The only models are view-only (HazelnutAUS "Past Folio", 121.3k tris; stuart.grover's STL) or a paid store item (Giimann). Thingiverse and Printables had nothing usable.
- **Tokyo Tower and Tokyo Skytree** (neither is a POI). Void's models are "CC Attribution" but lattice-heavy: the Tower is 205.7k tris and the night Skytree 871.8k. SomeAB's Tower describes itself as "based on Google Maps Data", so it is rejected.
- **Leaning Tower of Pisa (standalone).** The index labelled the candidate set "CC Attribution (or CC Attribution-NonCommercial)" without saying which applies to which model, so they are UNVERIFIED. Use the Ankitimation pack instead.
- **CN Tower.** zayshaa's model (86.6k tris, "CC Attribution") is self-described as work in progress and is no better than the shipped first-party model.
- **Brian Trepanier (@CMBC) catalogue.** It covers Christ, Liberty, Eiffel, Colosseum, Pisa, Opera House, Brooklyn Bridge and more, all "CC Attribution". The ones I checked are heavy: Eiffel 1.4M tris, Colosseum 1.5M, Christ 1.5M, Pisa 1.4M, Liberty 417k. **I rejected it on provenance, but this is not confirmed.** Whole-site models titled "Disneyland, Anaheim" and "Vatican City State", plus single monuments at 1.4–1.5M tris, look like Google Earth captures, and a CC tag cannot license Google's data. Ask the author before using any of them.
- **Terrain routes** (Grand Canyon, Lauterbrunnen/Swiss Alps, Yosemite's El Capitan and Half Dome, Nāpali). Here the DEM is the landmark, so no mesh applies. The man-made structures nearby are only tens of metres tall and would be specks at route altitudes of 1.7–4.5 km.
- **Not reachable from here:** Smithsonian 3D, OpenHeritage3D, Icosa and Wikimedia Commons. CyArk's Brandenburg Gate on Sketchfab is view-only.

## IP / trademark caveats (not legal advice)

- **Sydney Opera House.** NSW memo M2025-05 says government agencies need the Trust's agreement to use its image, including a stylised representation, and that the Trust holds registered trademarks. The model is already shipped (FLY_ROUND20 §5b.5). https://arp.nsw.gov.au/m2025-05-sydney-opera-house-use-of-sydney-opera-house-site-image-or-brand
- **Eiffel Tower at night.** The Paris Court of Appeal ruled on 11 June 1990 that the lighting is an original work, and SETE requires authorisation for night images. Keep the accent bands generic and do not recreate the sparkle. https://www.dreyfus.fr/en/2015/12/11/nighttime-photos-of-the-eiffel-tower-is-the-lighting-protected-by-copyright/
- **Christ the Redeemer.** The Archdiocese of Rio claims the copyright and refused Columbia's request for *2012*. Brazil's freedom of panorama covers photos, drawings and audiovisual works; whether it covers 3D copies is unclear. https://www.technollama.co.uk/copyright-in-landmarks
- **Skyscraper likeness.** The TTAB held the Empire State Building's image to be a famous mark (*ESRT v. Liang*). One WTC, Petronas and the Burj are in the same class. https://www.duetsblog.com/2016/06/articles/trademarks/a-favorite-new-york-landmark-deemed-a-famous-trademark/
- **Golden Gate Bridge.** The District's registered mark (Reg. 4105990) is a logo, not the structure, so the risk is low. https://trademark.justia.com/778/36/golden-gate-bridge-highway-transportation-77836693.html
