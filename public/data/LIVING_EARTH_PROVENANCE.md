# Living Earth provenance

`living-regions.json` is derived from Natural Earth's 1:50m Admin 0 Countries, downloaded September 16, 2026 from the Natural Earth project's `nvkelso/natural-earth-vector` repository. Retained fields: ADM0_A3, SUBREGION, geometry. Natural Earth releases its map data into the [public domain](https://www.naturalearthdata.com/about/terms-of-use/).

This data supplies coarse architectural context. It does not supply or replace building footprints, heights, street locations, borders shown to players, or landmark geometry.

The 19 aircraft family meshes, forest representations, pavement shaders and architectural additions are original procedural artwork authored in this repository. They contain no downloaded aircraft models or airline liveries. An aircraft family represents a visual category; it does not certify an exact aircraft variant, airline paint scheme, or configuration. Observed positions and aircraft metadata remain the live provider's data.

Settlement gap filling combines existing OpenFreeMap/OpenStreetMap data with the already configured ESA WorldCover 2021 built-up category. See `worldcover-provenance.json` for the existing dataset attribution. Inferred roadside homes are scenery, not mapped addresses. Runway/taxiway/road widths use mapped width where present and a documented class default otherwise. Airports contain no synthesized aircraft, gate occupancy, arrivals, departures, or service vehicles.
