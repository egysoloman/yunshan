# Empty-support early return: static candidate

Base: `6785ca7dcca09e8e97afd610cfd52176c7a1cfb1`. Shared `/workspace/yunshan` is unchanged by this work.

The candidate adds one positive-radius empty-choice branch after `choices.sort` in `floorPlanSupport`. Once no base/stair/restored-fixture support candidate exists, obstacle tests cannot create a candidate. The branch preserves the original public descriptor cache priming: each nearby floor's `wallPanels` first, followed by each upper floor's `getFloorPlanSlabRegions`. Nullish or sparse members of wall panels or neighboring fixtures delegate to the original `localSolids` implementation and retain its exception. Nonpositive/NaN radii and every nonempty-choice query retain their original code path.

No route, world/local conversion, boundary construction, actor, permission, callback, voxel, road, simulation order, frequency or RNG code changes. No new persistent cache or geometry revision contract. Private `localSolidCache` refresh is omitted only for a result that will be null; a later positive-body support or movement query still performs its existing full membership, rect identity and height validation.

The equivalence boundary is plain data descriptors, including valid in-place/replacement geometry mutations and the nullish/sparse members explicitly guarded here. Arbitrary getters/proxies with side effects do not have an equal-read-count promise. The cache priming regression uses observational getters solely to check the retained cold wall/slab call order.

Static artifacts:

- `architecture-empty-support.patch`: single source patch, 13 added lines.
- `regression-tests.patch`: four meaningful regression tests, including malformed member behavior.
- `geometry-equivalence.test.ts`: independent dynamic imports of frozen before and candidate source; actual building types/floors/routes with exact numeric comparisons and live mutation sequences.
- `before/architecture-floor-plan.ts`: exact frozen before source, SHA256 `b4d0c35fb868deedfb10e14128c2f3255a1f3a5f3b54f2f853afb0d2656a4d42`.
- Candidate source SHA256 `27431000d8f47ad5c5ece0e8c9319362c0610efda53559854a317995f1fc5f08`.
- Regression file SHA256 `73014d9041182bffbedd094db03a9713db3a8a6818a36e0a1907a4492448ecc8`.
- `frozen-input-sha256.json`: archived source, tests, scripts and configuration hashes.

Execution status at handoff: no Node, build, tests, benchmark, UI or browser process has been run by this agent. Parent owns the exclusive before/after 32-tick full-save and phase timing run. Performance improvement is not established by this static patch.

After the parent releases its CPU slot, run from this candidate root:

```sh
node --import tsx --test --test-isolation=none tests/floor-plan-empty-support.test.ts tests/floor-plan-derived-cache.test.ts tests/architecture-floor-plan.test.ts evidence/geometry-equivalence.test.ts
./node_modules/.bin/tsc --noEmit
```

The earlier eleven-line priming-only version remains preserved in `/tmp/yunshan-geometry-performance-codeprep-6785-20261003-01`. It has a known malformed-member throw-to-null difference and is static evidence, not the final executable candidate.
