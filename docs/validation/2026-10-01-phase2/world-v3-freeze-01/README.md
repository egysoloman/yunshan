# Current-v3 world geometry freeze

This archive captures the authoritative CPU world and physical height samples for seeds `20261001`, `7`, and `2024`. Both passes use only `/tmp/yunshan-r5-native-proof-01`, the coherent02 source copy whose 81 file hashes match its input source manifest. No production source, existing test, existing fixture, browser profile, or root development memo was changed by this proof task.

The checked-in outputs are the three new `tests/fixtures/world-layout/current-v3-{seed}.json.gz` fixtures. The first pass generates each world and writes each fixture with exclusive creation (`wx`). The second pass starts a new Node process, imports fresh modules, generates new worlds and fresh module-local spatial caches, and compares both the full world object and the canonical JSON records with `assert.deepEqual`, exact JSON text, and deterministic gzip hashes. This is independent regeneration using the same authoritative implementation and capture algorithm; it is not a second independent geometry algorithm.

| Seed | Saved-world fingerprint | Road/bridge vertices | Every segment midpoint | Total deck samples | Grades |
| --- | --- | ---: | ---: | ---: | ---: |
| 20261001 | `3ae62474` | 10539 | 9864 | 20403 | 9864 |
| 7 | `683b390f` | 10411 | 9736 | 20147 | 9736 |
| 2024 | `652f4767` | 10417 | 9742 | 20159 | 9742 |

Each world contains 612 buildings, 674 nodes, and 691 edges. Samples cover all 675 road/bridge edges, all their vertices, and each segment midpoint for both modes. Each seed also has 841 grid samples, 1224 entrance samples, 64 core-floor samples, 9 river points, and 4 waterfall-path points. Every numeric physical sample is checked to be finite. A grade with zero horizontal length fails explicitly rather than serializing an invalid number as `null`.

The full world JSON, actual `savedWorldFingerprint`, code-owned terrain descriptor, descriptor SHA, world SHA, and counts are stored in each fixture. JSON and gzip hashes and byte counts are in `capture-results.json`, `verify-results.json`, and `manifest.json`. The current-v3 fingerprint is distinct from current-v2 for all three seeds, and all three current-v3 fingerprints are distinct. The descriptor is exactly the terrain object built by the frozen fingerprint helper; the seed is already part of that helper's surrounding geometry object.

The frozen recipe is `yunshan-geology-v3-terraced-cellular-1`. The physical descriptor SHA is `74e14a9a0e4e84904e1d8af40cf6079953802cd2dd1cd7fcc3f9dd0bb3415b1a` for all three seeds. Code hashes are recorded separately, including the world implementation, shared floor access helper, types, and saved-world fingerprint helper. Their unchanged minimal source copies are in `frozen-source/`. `input-source-manifest.json` preserves the original 81-file snapshot manifest; this proof did not open the native-export file named by that input manifest.

The sample arrays retain these column definitions:

- `grid`: `[x,z,natural,terrain,terrainWithoutBasements,defaultWalk,walkAtTerrainReference]`, on all 29×29 coordinates from -2100 to 2100 at 150-unit spacing.
- `doors`: `[buildingId,outsideDistance,x,doorY,z,terrain,terrainWithoutBasements,walkAtDoorReference,defaultWalk,natural]`. The outside point extends 2.2 units along the generated center-to-door outward vector; the other point is the exact generated door.
- `decks`: `[edgeIndex,pointIndex,x,deckY,z,terrain,defaultWalk,walkAtDeckReference,terrainWithoutBasements,natural]`. Integer indices are actual vertices; half indices are the midpoint of the preceding segment.
- `grades`: `[edgeIndex,segmentEndIndex,absoluteRiseOverHorizontalDistance]`.
- `floors`: `[floor,x,floorY,z,walkAtFloorReference,terrain,terrainWithoutBasements,defaultWalk]`, for core floors -2 through 29 at center x and center x+50. The x+50 point can be outside an upper stepped footprint; its recorded fallback surface is intentional. `floorDetails` preserves each actual footprint and shared stair position.
- `water`: `[x,waterY,z,terrain,defaultWalk,walkAtWaterReference,terrainWithoutBasements,natural]`, for the complete river plus `getWaterfallPath`. The complete river and waterfall paths are also stored separately.

The two executed commands were:

```sh
cd /tmp/yunshan-r5-native-proof-01
/workspace/yunshan/node_modules/.bin/tsx /workspace/yunshan/docs/validation/2026-10-01-phase2/world-v3-freeze-01/capture-v3.mts capture
/workspace/yunshan/node_modules/.bin/tsx /workspace/yunshan/docs/validation/2026-10-01-phase2/world-v3-freeze-01/capture-v3.mts verify
```

Their raw outputs are `capture.log` and `verify.log`. `verify-first-serialization-failure.log` and `capture-v3-first.mts` preserve the first failed comparison: optional `undefined` basement entries in fingerprint descriptor tuples canonically become `null` under JSON encoding. The correction compares the canonical JSON record and additionally compares the complete generated world directly; exact JSON/gzip checks and all physical finite-value guards remain unchanged. No fixture was overwritten. The capture command intentionally refuses to overwrite existing fixtures or result files. The archived script records its original frozen input location; a later replay needs that verified source snapshot restored at the same location. The four archived source files are the complete runtime dependency closure for world generation and fingerprinting under TypeScript type erasure; the full 81-file hash table identifies the original snapshot context.

These are CPU authority and deterministic regeneration proofs. They do not establish a normal walking journey, GPU appearance, collision behavior driven by browser input, simulation continuation, or a performance benchmark. Native r5 import and continuation, storage partitions, and screenshots are separate evidence owned by the integration and persistence tasks.
