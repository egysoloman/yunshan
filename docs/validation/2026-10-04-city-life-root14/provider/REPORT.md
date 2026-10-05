# Civic history archive candidate: verified short phase

This isolated candidate archives closed civic history while preserving complete source records. It implements envelope4 / civic body2 / history1 with a trusted exact-current-v3-SHA migration. Existing civic-local-v1 legal rules, motion1|2, cash sources, occupations, eligibility and live limits are preserved. Existing createProductCity remains envelope3/default-v6; the new createArchivedProductCity is an explicit source factory awaiting parent integration.

Final candidate: 304 inputs /71 src/ files;9new,8modified,0removed. Graph SHA256 `b46bd775acae960939b3f9db63efd1f01b8d6f1948928c82b97966c59ef95b03`. FINAL-INPUTS.json specifies the digest convention and all hashes; SOURCE-DELTA.json records ROOT13-before/final-after hashes. ROOT13-READONLY-CHECK.json confirms its frozen295 assembly inputs remain exact. No shared repo, CLOSED group, root final assembly, Git, Library or deployment change occurred.

## Implemented contract

History retains original complete raw JSON for proof/application/poll/term rows, with Unicode-safe fragments, exact record SHA/bytes, dense indexes, descriptors, chained page identity, seal clock/tick and origin. The unified hot/cold resolver rejects duplicates; original civic semantic validators inspect complete fees, canceled activities, paid windows, election census and term chains. Closed-source seal guards and fee ledger crosschecks reject correctly re-sealed semantic forgeries.

Only exact-current-v3-SHA trusted host migration enables loaded3→4. Generic events and gameplay commands expose no migration capability. Original snapshot validation is read-only; SHA wait detects a changed city; legal enablement/original source and independent motion remain intact. One full production import commits the prepared document. Old1/2/3 imports never infer archive enablement.

Live archive commit prepares both replacement fields, validates supplemental request state, request/runtime budget crossreferences and full budget authority, then commits once. Complete import validates both actual budget copies and full hot/cold signature sources. Captured paid sources prove source resolution; an actual funded V2 two-copy positive is absent and remains unexercised.

Pages are <=256KiB. Full history including metadata/index is <=16MiB, <=256pages, <=256fragments per record and <=100,000records. The nonhistory projection retains the original8M-character guard. Limit refusal preserves prior history. Each transaction appends sealed pages, so256pages can exhaust before16MiB. Complete materialization remains required; this is finite archival capacity.

Live callback catches storage/validation refusal before civic/history field replacement and appends `civic-history-storage` notice once per blocked interval; success/load resets its private notice latch. Current live sources remain retained and existing active bounds can then stop further admissions until storage is available. Codec tests proved lossless large Unicode transport and atomic oversized-quota refusal using an explicitly invalid-business `transportOnly` field. Those records prove storage behavior only. A realistic Simulation filling the archive quota and exercising that live notice branch was not run.

Stable `chunk:civic-history:<historyId>:<pageId>` parts use existing generation/lease transport. Global layout declares the exact page set; assembly rejects absent/duplicate/orphan/changed-chain pages and restores identical full JSON. SaveSession evidence uses an emulated leased generation. Real IndexedDB previous-generation recovery and generated browser bundle4 were not run.

## Actual original and continuation

Original SHA256 `3640274b3e2234b793925a574f825615a89d9c168539d10960510f39f1e1c2c3`,3,015,592bytes,tick1467/clock6348. Actual contents are128proofs,64applications (19paid+45unpaidcancelled),19polls (13closed+6open),13active terms. Its old CLOSED filename mentions two terms, but this is the full actual app64 four-day snapshot; exact counts/tick are directly asserted. The controlled compact world has616residents/198original officials; it is not the default-v6 audit.

Migration yields hot70proof/6app/6poll/13term,cold58proof/58app/13poll/0term. Seven cold pages retain1,522,690UTF8 bytes of original record fragments. Entire nonhistory projection, full civic raw records, RNG, money, occupations, ledger and motion remain exact. Fee2280/form63minutes/vote1064minutes are retained;63 is not an application count.

After24 actual migration ticks,nextApplication84 reflects19new actual applications65..83 with one-minute windows/proofs, rather than a counter assignment. That continuation has no new payment and fee remains2280. Four original open polls close into terms. Whole/partition/leased-session replicas match every future byte; old native3 loaded into explicit4 disables history and matches the original24 oracle.

Separate canonical-pair original raw SHA256 `55aff072ee15acc3afca29a24d906f6d1fed64554554ce423a30fb2a02ff5535` is explicitly ACTUAL_SOURCE_PAIR_NOT_FUNDED_BUDGET. Its two actual paid V2 authority signatures validate with hot terms and cold election/proof chains. Forged term/proof/actor/wages/employment revision reject. It has zero runtime funded V2 budgets and no culture supplemental requests. No funded request/signature was manufactured.

Declared adverse tests isolate death and changed-employer authority loss. Death input sets only health0 while alive remains true; this predecessor passes the formal reader and is retained. One real tick invokes the existing people terminal branch. Employer input changes workId to the ordinary farm and the next tick detects profession change. These are declared inputs, not autonomous naturally discovered events. Both terminate original term1 at6352/tick1468, archive it, retain historical signature validity and match whole/partition replicas for24 additional real ticks without reactivating authority.

Both finish1492/6448 with full176proof/87app/20poll/17term,hot114/25/3/16,cold62/62/17/1. Original2280 fees remain. Real new app86/citizen352 pays120 at6428/tick1487,wallet362.37793411871866→242.37793411871866,matching public ledger/two actual paid official witnesses/poll20. Totalfee2400/form86/vote1064 is genuine subsequent activity, without injected cash.

## Scope provenance and failures

All scopes ran sequentially. Receipts retain command/cap,PID/startticks/ancestry,raw SHA,before/after full map and owned-active-process end state. All source maps stay exact during each scope; all ownedActiveAtEnd are empty. Complete source-as-run is retained per graph. The first wrapper had no pre-copy: typecheck01 source snapshot was recovered afterward and SHA-matched against its original before/after maps. Its codec SHA `907989d4fc047f574bba10af07e70880618bf11af7d85b04f4299018d0c7ab18` was recovered by reversing one known static type fix. Later snapshots were automatic pre-run complete copies.

| Scope | Inputs/src | Actual result | Cap |
|---|---:|---|---:|
|typecheck01|301/71|FAIL generic unknown/string narrowing|120s|
|typecheck02|302/71|FAIL generic iteration/string narrowing|120s|
|typecheck03|302/71|PASS|120s|
|codec01|302/71|PASS4/4 pure codec/Unicode/raw/integrity/quota|120s|
|typecheck04|303/71|PASS|120s|
|migration01|303/71|PASS5/5 prior graph|300s|
|typecheck05|304/71|PASS|120s|
|paid-source01|304/71|FAIL1pass/1fail invalid declared alivefalse/nonzerohealth fixture|120s|
|typecheck06|304/71|PASS two-copy guard/death-fixture correction|120s|
|typecheck07|304/71|PASS exact final graph with legal predecessor assertion|120s|
|migration02|304/71|PASS5/5 exact final graph,76.6s wall|300s|
|paid-source02|304/71|PASS2/2 exact final graph,74.7s wall|120s|
|legacy-ruleset01|304/71|TIMED_OUT_PARTIAL: first7 completed PASS; legacy1 test8 unfinished,default-world test9 not reached|120s|

Legacy-ruleset01 keeps the unchanged original nine-test file and final source graph. It ran15:43:25.570→15:45:31.080; after120seconds the wrapper sent TERM then KILL after5seconds, leaving no owned process. Raw SHA `bb28485d971894b0e6e4cd7f912eca0dfe7029471bb34df05b7677aeb0ce7ca6`. Completed results include original native2 exact24 oracle, native3 custom full/partition24, host native2 exact migration/restored24, malformed contracts and business-clock checks. The actual legacy1 host cutover file exists, but its test has no completion marker and future24 is not proved; default-world ninth test was not reached. No time limit was increased and no rerun was made. This suite is not PASS overall.

Original FAIL logs remain. Reader correctly rejected the invalid dead-health fixture; correction uses the actual terminal branch, not a weaker validator, reader bypass or higher timeout. Codec01 belongs to an earlier graph; its codec SHA is unchanged at `65e6f3b27215ba38073a3e71a63744f74a8fb89af51c10bb3e8ce854e037b01d`, but it is not described as an entire final-graph run. FINAL-VERIFICATION.json gives each graph/log hash.

Final migration02 raw SHA `b60dfc74036e26bdc1f0daf42bbc61897c692d0c5c30921b05edcdd1689aef13`;paid-source02 `7117bbce8a0bb0d60d82ce09095d3a82ee10a3daafcdcd256d11a06f8177233a`. Atomic negative cases cover envelope/manifest/body/motion mismatch,missing/duplicate/changed pages,wrong totals,hot/cold duplicate,fee ledger removal/change and validly re-sealed fee/payer/vote time/census/wages/summary-only proof/canceled labor. Rejected imports preserve every original byte.

## Remaining boundary

Actual fundedV2 request→authorization(two copies)→procurement→service remains NOT_EXERCISED. No actual snapshot contains the needed funded sources. NATURAL-BUDGET-PILOT-PLAN.md is a static conditional constructor plan, entirely NOT_RUN; endogenous price trigger remains unresolved. Parent deferred funded exploration and14-day natural expiry/renewal.

Final-graph legacy1 compatibility remains incomplete because its unchanged test timed out; completed native2 and native3 checks are described above. Default-v6 new4 execution,archive4 factory old1/2 import-specific cases,direct old-reader4rejection,build/generated bridge4,UI/browser/real IndexedDB recovery/GPU/macOS/performance were not run. Earlier root295 results are separate graphs. Source bridge changes have no regenerated bundle. Other independent budget/request limits remain unchanged. This is source/migration/paid-source short closure, not complete economy/game validation.
