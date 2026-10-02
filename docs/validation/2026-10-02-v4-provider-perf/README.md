# V4 provider performance evidence archive

This task archives evidence only. It ran no game tests, GL, profiling or performance measurements and made no production, memo or frozen-candidate edits. All originals under `/tmp/yunshan-v4-provider-perf-01` were read without modification.

The parent reviewed and integrated the narrow provider patch. A read-only source check at archive completion confirmed production provider SHA **9e3b35a9e3b667466e0360c287bd5b828b35e1fd2f1cd2a00228f2bb5f74a724** and Controller SHA **9491986a2f037ed85f6b4f4f529786027e014984583b3dab3df864f0154d0ca6**. The baseline provider is **ec3fd0fdc4e9f0b4614a905a58be7ee6bbf0d85d3c92c978c0b80967ca6f895e**. Original prototype documents retain their original pre-promotion wording; they have not been rewritten to claim later results.

The patch removes per-query cache-key string allocation and skips unused radius-zero local-solid allocation while retaining existing wall/slab lazy priming, all primitive/reference invalidation inputs and mutable cache lifetime. The actual naive cold-cache failure is preserved alongside the successful final candidate. Review the [original patch](provider-perf.patch), [original author report](ORIGINAL-README.md), [comparison summary](comparison.json), and [CPU comparison](cpu-comparison.json).

## Archive verification

All **55 original proof files**, totaling **95,874,558 bytes**, first matched every size and SHA in the original [checksums.json](checksums.json). The checksum manifest itself is copied unchanged and separately hashed in [index.json](index.json); it is not one of its own 55 listed proof files. `originals.zip` contains exactly those 55 members, including original README, patch, baseline/candidate/naive provider files, raw profiles, all original tick saves and complete comparison data.

All **80 baseline input files**, totaling **7,951,561 bytes**, matched the original [baseline-source.json](baseline-source.json). `baseline-source.zip` contains exactly those input bytes from the immutable baseline copy, not the changed production tree. Every original file was checked again after archiving and remained unchanged.

Both ZIPs were actually decompressed to check **CRC** and every member's **SHA-256**, member count and stored byte lengths. Exact membership, per-file sizes and hashes are indexed in [index.json](index.json).

| Archive | Members | ZIP bytes | SHA-256 |
| --- | ---: | ---: | --- |
| [originals.zip](originals.zip) | 55 | 10,994,947 | `60ab8f263ce06c46d418eeff08fd0ff68769ef47aba211348b8bbf66d3f682d9` |
| [baseline-source.zip](baseline-source.zip) | 80 | 5,941,850 | `f9bd498812fdd19817650090513fe43d39a20046fca2bfbb382679e056871118` |

Large raw JSON, saves and profiles remain in the single proof ZIP instead of being expanded into Git as many separate large files. Small review entry documents, the exact patch and original logs are copied separately without reformatting.

## What the preserved evidence establishes

- Candidate targeted checks: **30 / 30**, exit 0; [raw targeted log](targeted-tests.log). The scope is the original three provider tests plus 27 banking/culture tests, not a complete test suite.
- Strict TypeScript: exit 0; the original [strict log](prototype-strict.log) is empty because the successful compiler emitted no output.
- World JSON, 605 body/roof descriptions, six-family geometry, 16 cache-invalidating changes and **all 12 actual exported tick saves** match baseline/candidate byte for byte. See [comparison.json](comparison.json), [baseline run log](baseline.log) and [candidate run log](prototype.log), with complete raw data in `originals.zip`.
- The successful [cold-cache result](cold-cache-result.json) / [log](cold-cache.log) preserves existing mutable cache behaviour; [naive failure log](cold-cache-naive.log) retains the rejected simpler implementation.
- The single sequential sole-CPU 12-tick pair measured **67,497.038264 → 59,653.413947 ms**, an **11.6207%** reduction. This is one controlled CPU sample, not repeat-run benchmark confidence, macOS hardware evidence, complete-game performance, full-suite acceptance or GL/visual acceptance. The separate microbenchmarks and sampled attribution have their own limited scopes, recorded in the original report and profiles.

The earlier `ec3` provider / `949` Controller keyboard evidence remains in [Controller release 02](../2026-10-02-floorplan-controller-02/README.md); it has not been relabelled as a keyboard run of the optimized provider. Later parent full-suite and GL results are separate evidence and are not claimed by this archive. These artifacts are local repository files; no Library upload or external publication occurred in this task.
