# Provider-only performance prototype

This is a `/tmp` prototype, not a production edit or a completed game/platform benchmark. The parent authorized a sole-CPU measurement window; the baseline and candidate ran sequentially. The window was released after both 12-tick runs. No GL or full `npm test` ran.

The complete current runtime combination was copied before testing: baseline provider `ec3fd0fdc4e9f0b4614a905a58be7ee6bbf0d85d3c92c978c0b80967ca6f895e`, controller `9491986a2f037ed85f6b4f4f529786027e014984583b3dab3df864f0154d0ca6`, and the same core/banking/culture/world inputs in both copies. All 80 copied inputs stayed unchanged in their respective copies. The candidate changes only `src/architecture-floor-plan.ts`. At the final shared-tree check, all runtime sources still matched; only the independently authorized `tests/world-layout.test.ts` had changed. Full input hashes are in `baseline-source.json` and `source-end.json`.

The reviewable patch is `provider-perf.patch` (SHA256 `8f13a493eb4ce2806cb30da727ea209e5910494c9c29b37671c872adb043d2c7`). Candidate provider SHA256 is `9e3b35a9e3b667466e0360c287bd5b828b35e1fd2f1cd2a00228f2bb5f74a724`.

It makes two narrow changes:

1. The cached body compares copied primitive values and the original three array references instead of allocating/stringifying a 13-field cache key on every call. Width, depth, height, floors, normalized basements, rotation, all position coordinates, kind, public-floor count, required permission, facility, footprint/use/permission references and the original marker/core/pavilion guards remain checked.
2. A radius-zero support query avoids constructing unused local-solid arrays. It still primes the existing wall/slab caches. This matters because the public FloorPlan objects are mutable: simply skipping all work changed the existing warmed-panel lifetime after a caller replaced a plan and then appended a source wall. The naive variant actually fails `cold-cache-naive.log` with exit 1; the final candidate passes `cold-cache.log` with exit 0. Public returned-panel and fixture/stair-array mutations are still observed as before. No new descriptor cache or object freezing was added.

## Actual results

- Strict TypeScript: exit 0. Harness syntax: exit 0.
- Original architecture/provider 3 plus banking/culture 27: **30/30**, exit 0, 15,231.6773 ms (functional timing after the sole-CPU window was released).
- World JSON, all 605 generated body/roof descriptions and fingerprint `80cd31e2`: byte identical.
- All six generated programme families: 35 real floor routes and 323 sampled positions, support with radii 0 and .35, movement barriers and standing support: byte identical. Ground doors to actual programme points on every fixture floor all returned a route.
- Sixteen cache-invalidating primitive/reference mutations, original guards, undefined/zero basement normalization, publicly mutable fixture/stair/panel results: byte identical. The extra cold-cache lifetime case also matches.
- Twelve ordinary `.25` ticks at **1×**: all 12 exported saves byte identical. Actual bank deposit 20 and creation fee 60 leave the player wallet 520, actual bank cash 20 and deposit claims 20 in both runs. The complete state/save comparison includes every NPC account and the treasury; no baseline-to-candidate coin difference exists.
- The actual work sequence is four ticks at the school work point, four in another legal room, then four back at the point. Credited minutes are `[.25,.5,.75,1,1,1,1,1,1.25,1.5,1.75,2]`; no time, movement, needs, identity or balance was increased by the optimization.

The measured 12-tick sequence took **67,497.038264 ms → 59,653.413947 ms**, an **11.6207%** reduction in this one sequential pair after identical geometry/cache warm-up. The three-trial microbenchmark medians were 881.054592 → 353.622374 ms for 2,000,000 cached-body queries and 285.587457 → 38.374984 ms for 12,000 radius-zero support queries. These microbenchmarks are separate from the 12-tick profile.

Inspector sampled self time in that sequence was `getBuildingBody` 7,357.030 → 1,176.121 ms, `localSolids` 9,137.783 → 8,638.305 ms, `floorPlanSupport` 1,903.696 → 1,506.337 ms, and `blocksFloorPlanMovement` 18,034.087 → 17,215.409 ms. These are sampled attribution, not instrumented per-call durations. `cpu-comparison.json` contains self/inclusive values; each raw `services-12ticks.cpuprofile` is preserved. Collision work is still a substantial remaining hotspot. No dynamic boundary/roof, support/path algorithm or NPC speed/clock rewrite was attempted.

## Originals and reproduction

`results/baseline/` and `results/prototype/` contain original world/body/geometry/mutation JSON, every original tick save, result JSON and raw CPU profile. `baseline.log`, `prototype.log`, `targeted-tests.log`, `prototype-strict.log`, `cold-cache.log`, `cold-cache-naive.log` and both cold-cache harnesses preserve actual results. `comparison.json` is the compact machine-readable review entry. `checksums.json` covers all proof originals and the patch; dependency symlinks are excluded.

From each baseline/prototype directory, the tested runtime command is:

```sh
node --import tsx ../run.mjs baseline . ../results/baseline
node --import tsx ../run.mjs prototype . ../results/prototype
```

Use a new output directory if repeating; the existing original results must not be overwritten. These are controlled CPU fixtures using real generated geometry and original new-game qualifications/needs, not evidence that an ordinary player walked to these facilities. Full-suite, GL and macOS verification remain unrun for this candidate. Production promotion belongs to the parent/provider owner after review.
