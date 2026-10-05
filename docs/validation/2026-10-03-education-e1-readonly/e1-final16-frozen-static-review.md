# E1 final from actual16: immutable read-only review

Reviewed 2026-10-03 UTC by native_home_diagnosis. This report binds only `/tmp/yunshan-education-course-prep-16-01/frozen/source` and its original patch `5e8268cee8ef32555e5901713da64041662f6c3c16b307e8b0aba7dc92878471`. It does not describe mutable prep15 or a later correction as this generation. No Node, TypeScript, Simulation, test, build, GPU, ZIP, Library or candidate/shared mutation was performed. All runtime outcomes in this report are **NOT_RUN**; conclusions below are source reasoning.

## Outcome

One concrete new save-contract blocker remains: the runtime common actor-minute budget has no corresponding combined education/research persisted time-capacity check. A genuine paid-course/research save can be altered in two research fields to claim eight player minutes inside four elapsed minutes while satisfying both existing validators. Parent and E1 were notified before this report was written. The original frozen patch must remain preserved as the before generation; a fix requires a new artifact and meaningful atomic import regression.

The earlier specific codeprep problems are repaired in this original freeze: whole-manifest omission for a new education body; numeric JSON overflow; event.tick incompatibility with S1; speculative locks from research/public-service intent; global course-intent command blocking; loss of current funded teacher slices when an allowance reaches zero; inherited S1 max-runtime/metadata/suffix contract. These statements describe the inspected source, not execution success.

## Immutable binding

- Actual16 base snapshot SHA256 `af930373394bafef704fb5c825a4b54419b407f3501044225d2a36dd353a4f41`; all 116 declared base inputs match their actual bytes.
- Final source manifest SHA256 `afd281fd8f243ed5dc75434ead9bb0a86860f5dadbcf9ce0558a920d35ab5961`; all 120 declared source inputs match.
- Changed manifest SHA256 `1b5378c4a0faee0cd3c37b696913f2bc968de4c42df427f3fe544415768633df`; exactly 16 paths differ from actual16, with every changed hash matching.
- Implementation review SHA256 `ae2650e1d9b2beca567628f73df1449281a0ac945f3668a87b0fb48eb9150dff`.
- All 16 patch file sections were reconstructed in memory from actual16 with exact context checks; every reconstructed file equals the frozen candidate. This is a read-only file-binding operation, not an application or program test.
- Both trees also contain seven inherited `dist` files, byte-identical to each other. They are outside the declared source counts: filesystem totals are 123 base and 127 final. The first receipt honestly records these extras; the separate addendum explains the source scope without modifying the first receipt. This inherited dist is not an E1 build receipt.
- Shared helper `src/simulation/activity-minutes.ts` remains exact SHA256 `5698aab3b0d74d6e34b6ef9d27b5c3d835e24e7c1bd2478080ba3afe71915ebd`.
- `extensions.ts` differs from actual16 solely by the approved public-service predicate `service.topic !== 'education'` at line66. S1 source intervals, phase latch guard, end observer and save suffix remain actual16.
- `tests/clinical.test.ts` equals actual16 and is absent from the E1 patch. Parent actual17's later `.6` fixture must be preserved on integration; do not overwrite root17 with this whole source tree.

Receipts: `first-readonly-binding-receipt.json`, `first-source-sha256.txt`, `static-patch-binding-addendum.json`, plus the final identity receipt produced after review. They contain only public paths, SHA256 and static scope, with no app credentials or personal identifiers.

## B1: combined player save capacity is absent

### Exact inspected paths

`education.ts:253–261` validates each course's original player/site identity, clock and funds/staff totals. Line256 checks only `course.workedMinutes <= course.lastObservedAt - course.startedAt + EPS`; line261 sums staff minutes against that course. Neither line compares its minutes with saved research jobs.

`extensions.ts:643–651` checks marked research actor/site, current lastObservedAt, its own elapsed bound and technology.progress consistency. Lines655–659 collect only `extension.runtime.researchJobs` and check each actor's later-start research suffix against elapsed time. Education course/current/history is never read by this capacity calculation. The final E1 modification of extensions is only the public-service predicate above.

`simulation.ts:1793–1794` executes validators separately and replaces live state/runtime only after they return. There is no core joint course/research capacity guard. `activity-minutes.ts` stores the real per-tick budget in a WeakMap; those transient claims do not appear in the export or validators. Valid runtime allocation therefore cannot authenticate a restored, coordinated labor claim.

### Concrete source-constructible input, no fake funding

The new tests already describe the legal admission path at `education-course.test.ts:104–109`: three actually completed sixty-minute courses, real scientist exam, new paid-course admission and same-school medicine research funded by its ordinary100 command. `extensions.ts:153,478–488` accepts school research; the new course is intentionally not an admission lock. `education.ts:194–198` funds a real40 escrow, and `education.ts:213–221` claims class minutes before research. The candidate test verifies course59.75/research unchanged, final.25/archive still research unchanged, following.25 research advance.

For the exact four-minute witness, prepare a genuine school textbook by admitting a course, letting finance procure its real one unit, then cancelling before teaching. `education.ts:143–150` returns the one reserved unit to the original school's available stock and refunds only the remaining escrow; it does not create stock. Admit a new course and research at the same extension clock S. `education.ts:196–198` reuses that available unit into the newly paid course. After four actual teaching minutes, the valid state is:

| Record | start | last observation | actual saved worked |
| --- | --- | --- | --- |
| current paid course | S | S+4 | 4 |
| player marked medicine research | S | S+4 | 0 |

Now retain the complete genuine export and change only these fields:

```text
state.extension.runtime.researchJobs.medicine.workedMinutes = 4
state.extension.technologies[medicine].progress = 4 / 120 * 100
```

Keep the research's original paused/active state, pauseReason, budget100/funding100, start/finish/site/floor/lastObserved, player identities and every course/staff/fund/material field untouched. Its research bound is4 <= (S+4)-S; technology.progress matches; the single player research suffix is4 <=4. The unchanged course bound is4 <=4 and all its genuine financial/material equations remain valid. No global funds or ledger change is needed. Both existing schemas admit these inequalities even though their combined8 >4. This is a concrete code-level constructibility argument; the actual original first import acceptance has **not been run** by this reviewer.

An even shorter protocol can use the existing test's procurement gap: after first.25 procurement plus4 taught minutes, the real course has4 and research can have.25; changing research to4.25/progress correspondingly still yields8.25 inside4.25. The reuse protocol gives the cleaner exact8/4 regression while keeping money and material causal.

### Minimum correction and meaningful regression

Add a necessary combined **player** time-capacity check over new marked player research and the E1 paid-course records. At minimum cover the current course plus pending marked jobs. Retained completed/cancelled course history has named start/worked values and can be included to prevent clearing an active pointer from erasing already consumed work. Preserve original funds,120,40,60,staff,TTL/clock, schemas and runtime phase rules.

For a narrow extension of the existing suffix model, build rows with start/worked, iterate distinct start cutoffs and sum only rows whose start is at or after the cutoff; require sum <= current extension clock - cutoff + EPS. This is a necessary feasibility bound, not a signed labor ledger. Do not charge every minute of a course that started earlier into a later research suffix: those minutes may legitimately have occurred before the new research began. Old grandfather research has no authenticated worked field and must not receive invented labor. Old public service histories and time-less archived aggregates likewise cannot be assigned made-up windows.

A broader exact interval/history authentication scheme is outside this review's authorized increment. The narrow guard cannot prove every historical minute, especially after records are bounded away; say so rather than claiming all past behavior is authenticated.

Meaningful tests should first export a legal, funded same-start course4/research0 after four real minutes; assert exact import and+24 continuation. Mutate only the two fields above; assert rejection and exact unchanged live export. Add a later-start positive and negative witness so a legitimately completed earlier course does not block later research while true impossible later suffixes reject. If retained history is included, use actual cancel/completion archive before the corrupted import and retain that first bad result as evidence. Do not regenerate a favorable fixture over an initial failure.

## Runtime composition checked statically

### Source-authenticated teacher labor and first flush

Actual16 core `registerAttendance` at `simulation.ts:213–225` determines unchanged credited quantity through arrival elapsed, daily480 cap and current employer allowance. It allocates the credited front window `[extension.lastUpdate-arrivedElapsed, +credited]`; `accrueWork:228–241` emits original earned wage quantity/amount and site/start/end. E1 does not change this producer.

`education.ts:156–168` refreshes phase state at the time hook after actual16's time/extension clock update. Its NPC wage handler checks current state/tick/clock, site binding to worker.workId, finite positive minutes, finite nonnegative amount, finite ordered bounds ending no later than current clock and width matching minutes within1e-7. No unsupported `event.tick` is required. Stored site binding is filtered again at line74, so a worker moved to another workId in the same tick cannot lend that site's earlier window.

`educationStaffMinutes:69–77` clips and unions those attested ranges against this classroom phase/open hours and the paid course's actual startedAt. It rechecks adult alive teacher role, health45, hunger40, fatigue35, working state and workId. It uses no lifetime `isOnDuty` fallback. A large backlog with only a funded old prefix does not cover the current lesson; a genuine two-minute current funded slice remains usable even if its allowance reaches zero at phase end. Exact first-flush/cap tests are prepared at education-course308–348 and public-only372–411, and a no-current-attestation guard at413–435. These tests are NOT_RUN here.

### Phase and slot ownership

Constructor order `simulation.ts:143–155` preserves the ten core stages. Player labor installs before culture; culture registers public classroom people callback at156–225, installs education at340; paid course people handler201–221 therefore follows public service; research observer is last at core155. `culture.ts:130–136` public learners claim common actor minutes and a shared teacher slot first. `education.ts:208,213–215` paid course only claims the remaining actual player budget, then research uses the remainder through the unchanged helper.

`education.ts:79–83` limits one actor to one classroom slot and each teacher to four parallel learners per phase. Four pupils taught for3 each legitimately consume the same3 teacher wall minutes, not12 teacher minutes. Public/paid share this allocator. Geometry pair50–55 requires teacher and learner to meet the same supported public service station on a marked body.

`education.ts:158–160` records actual player paid-work wage events in the common actor budget after checking current real job, finite wage/minutes, original rate, employer, amount identity and current phase. Player labor changes job.status toworking before pay at player-labor116–120 and archives after pay, so its last earned slice is observed while the job still exists. The education time latch156 uses the pure actual context query, remains limited to runtime eligibility125, and is not used by command admission178–192; this avoids reintroducing S1's same-completed-tick UI admission latch bug.

### Intent and physical availability

The global educationCommandConflict registration is absent. A course with no textbook, teacher away, closed classroom or paused-away intent does not independently reject other commands. Root-approved removal of the public-education predicate from S1 allows public classes to claim actual minutes rather than prediction-locking pending research. The strong causal cases at education-course57–117 obtain qualifications through real classes and verify waiting intentions leave research time, actual public teaching consumes it, and paid final archive does not free the same phase twice. The actual public approval/received-material assertions distinguish a waiting real service from an empty pointer.

Course signup/resume's `otherPlayerSession:98–121` checks actual work/bed/project/noneducation-service/clinic site and conditions. It no longer rejects every pending research job or all stale/paused pointers. Marked position checks35–55 keep .35 radius,1.72 full body, public floor ACL, physical support/clearance/voxels and2m service station pair. Original unmarked spatial behavior is retained. Teacher route830–845 prefers a reachable supported ground service work point for actual paid/public education, retains original hash fallback points if preferred points cannot route, and leaves M1 clinic preference unchanged.

Teacher `educationNeedsContinuousPeople:86–90` changes only processing frequency for registered adult teachers attached to a pending paid or active public class. Core949–950 ORs it with existing marked research task frequency. Tier labels, physical speed, pending needs/wages, all ordinary actor schedules and the research actor selection are preserved. This is not a default city natural commute proof.

UI550–558 reflects same geometry/fee/hours/adult registration and current on-site work/project restrictions; it no longer uses pending research or broad public-service pointers as a button lock. It remains a presentation predicate while runtime is authoritative. Native player-journey changes use production floor-planner waypoints plus real keyboard walking into/out of the ground classroom and wait for the actual60-minute completed-course panel. No simulation/actor cash/time/state mutation was introduced in that script. Its road3m/classroom.75m HUD tolerances and300s classroom timeout are new prepared behavior, not this review's native14 evidence or a native E1 PASS.

## Financial, material and save fixes retained

Admission194–198 moves exactly40 wallet to course escrow without immediate education/experience. Finance223–236 buys one real workshop material using the actual supply quote: source inventory decremented, escrow pays gross, supplier operating account receives net, original wholesale hook563 collects tax into its queue. Service215–216 moves only earned fee delta `(40-purchasePaid)*worked/60` to treasury and its extension observer cursor. Course finishes only at actual60, consumes the one reserved textbook once and raises education/experience once. Original role exams still charge80 and keep original qualification thresholds.

Cancellation/death143–150 refunds only unearned escrow within wallet capacity, retains refundPending when needed, returns the reserved material once and leaves earned service/purchase cost intact. Banking adds only the optional player-course escrow asset check at180–183 before final estate/debt clearance; it creates no new banking body or money. Bounded history64, archived money/stock counts and current/history equations remain explicit. These paths need actual tests; source inspection does not prove death/full-wallet or long history behavior.

`education.ts:245–246,264` requires finite num for receipt gross and finite values before approximate equations. The formerly permissive Infinity relative tolerance is removed. The original JSON numeric overflow test at254–256 substitutes an actual1e400 token and checks atomic refusal; the separate Infinity-object test237 actually serializes to null and tests another path. Neither is mislabeled as a run result.

Core1612 requires persistedModules when an education body or runtime marker is present, including removal of the whole manifest. Existing manifest validation1613–1615 checks exact body set;1666–1667 requires paired version/body. With no education body/marker, the historical whole-manifest omission route remains allowed. installEducation creates neither empty body nor marker on construction/load; state/marker are created only after a successful paid signup. Export1591 filters actual bodies, so the11th education manifest entry is lazy.

`partition.ts:44,75–84` preserves optional education key order, keeps course/history together in player values and stock under its school chunks, leaving clock/stats/archived in the existing global generation. Missing noeducation parents are skipped, not synthesized. Existing pinned generation assembly/load remains required before Simulation import. Child independently reviewed these paths and found no additional blocker in that narrower scope before the joint-capacity question arose.

The structural no-empty guarantee is separate from S1's one-time metadata migration. Unmarked older extension input, including empty research jobs, receives S1 metadata once and can change first-export bytes. New/already S1-migrated course-free saves may be tested byte-exact; never label this all old14 bytes exact. Public teaching physical/frequency rules intentionally change active public-education behavior, so do not infer universal behavioral equality of arbitrary old10-module public-service saves from the prepared ordinary course-free fixture.

## Remaining evidence required

The new joint-capacity blocker needs a corrected immutable revision and real first import counterexample/positive regressions. No later repair is incorporated by this report.

Beyond it, the existing prepared tests still require authorized execution for teacher backlog/current caps, public/paid/research claims, marker/whole-manifest/JSON overflow atomic refusal, and genuine actual16/S1-completed noeducation input with exact24 ticks. Newly partitioned education saves and full-wallet refundPending/death/bank debt/material reuse/64+archive need meaningful dedicated runtime coverage; no explicit education partition roundtrip or full-wallet/death test was observed in the frozen tests. These are validation gaps, not independently established failures.

Original final16 patch/source and every earlier mutable15 observation remain untouched. Root17 clinical `.6` and actual parent-owned DOM evidence must remain separate. No build, UI, natural commute, Mac hardware, long-term or full city dynamic verification is claimed.
