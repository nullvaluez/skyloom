# Landmark fidelity assets

The 33 `public/models/landmark-*-v2.glb` files are generated offline by
`scripts/build-landmark-fidelity.mjs`. They are architectural interpretations
for flight scenery, not measured surveys or photogrammetric scans.

## Original Skyloom architecture — MIT

Empire State Building, Willis Tower, CN Tower, Space Needle, Burj Khalifa,
Taj Mahal, Big Ben / Elizabeth Tower, Gateway Arch and Colosseum are original
Skyloom geometry. Eiffel Tower's far and medium levels are based on Skyloom's
existing first-party lattice builder with new railings, pavilions and material
treatment. Materials, glazing masks and night-light colors are authored
approximations, not claims about current building illumination.

Architectural reference sources (no photographs or third-party textures copied):

- [UK Parliament: restored clock dial colors](https://www.parliament.uk/about/living-heritage/building/palace/big-ben/elizabeth-tower-and-big-ben-conservation-works-2017-/turning-big-bens-clock-dials-blue/)
- [Taj Mahal official site: exterior architecture](https://www.tajmahal.gov.in/the-taj-exteriors.aspx)
- [Space Needle: history and structure](https://www.spaceneedle.com/history)
- [National Park Service: Gateway Arch materials and triangular sections](https://www.nps.gov/jeff/planyourvisit/materials-and-techniques.htm)

## Eiffel Tower — high detail

Underlying structure: **Scott Marshall**, [Eiffel Tower](https://poly.pizza/m/aIpJchqtRTg),
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
The input is the repository's already-credited
`public/models/monument-eiffel-detail-v1.glb`, SHA-256
`c8dbd26591edaf826c2ae8dd3fa75a363fd2e237db050f37cc396172f663fddb`.

Modifications: added first-/second-floor railings and glazed pavilions;
separate iron/glass surface response and night masks; compacted vertex data;
normalized and exported as one mesh. New additions: Skyloom, MIT.

## Sydney Opera House — all three levels

Underlying model: **Nick Reinhardt (Nickardiamond)**,
[Sydney Opera House](https://sketchfab.com/3d-models/sydney-opera-house-317b2d540f0a4f7e8d87dd3b0372712d),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Obtained through [Icosa Gallery's asset API](https://api.icosa.gallery/v1/assets/1viSkN0IJ-6).
The archive uploader is Jaideep Prasad; the source glTF's embedded author,
license and original model URL identify Nick Reinhardt and CC BY 4.0. This
is the same attribution chain recorded for Skyloom's previous Opera House.

Source resources:

- [Scene JSON](https://s3.us-east-005.backblazeb2.com/icosa-gallery/poly/1viSkN0IJ-6/scene.gltf)
- [Geometry binary](https://s3.us-east-005.backblazeb2.com/icosa-gallery/poly/1viSkN0IJ-6/scene.bin)
- Canonical JSON (`JSON.stringify(JSON.parse(source))`) SHA-256:
  `0d3b533d3dfd0c90a024d0b59121259fd4846b0a879d90f8a07a61ece38594fb`
- Geometry binary SHA-256:
  `690fb7caffbe3e45e149a5aea82f267e97527ac234614b4f517437e722b74c9b`

Modifications: removed the water, backdrop and ground planes; retained the
original shells, glazing, podium, stair and light-post geometry; simplified
to three levels; replaced source textures with first-party ceramic, glass,
bronze and stone vertex colors, roughness, metalness and night masks; merged
and normalized. No source image/texture files are redistributed or loaded.

The downloaded Brian Trepanier Colosseum candidate was evaluated and rejected
for its surrounding-scene footprint. **None of its geometry or textures is
included in these assets.**

The creators have not endorsed Skyloom or these modifications.
