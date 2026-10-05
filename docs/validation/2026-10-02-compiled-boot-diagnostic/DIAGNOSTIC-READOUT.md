# Actual diagnostic readout; original browser11 is still 0/11

This was the single root-approved independent boot observation, not a rerun of browser11 or native-home validation. The original script and its 90s/60s assertions were untouched. Probe SHA256 `99e5208051dc6cf1b4baaeeadea30a666e30d604f7c984e3bf5d07da4041a12f`; PTY session66929; probe PID160490; own preview PID160504; own Chromium PID160524.

The probe started **2026-10-02 15:29:34.297 UTC**, navigation at15:29:39.041. The observation window ended at+90002ms, a 2ms timer overshoot; cleanup was outside the90s window. It exited1 with `DIAGNOSTIC_INCOMPLETE`, because `browser.close()` did not resolve within its separate10s cleanup deadline. `failure:null` in the manifest means the probe caught no top-level exception; it does not mean formal validation passed. Both actual screenshot attempts timed out, so there is **no PNG** and no synthetic blank replacement.

## What was actually observed

- HTML used `/assets/index-IZpNJKPR.js`. Both the independent HTTP GET and the actual browser response body were200,647004B,SHA256 `fe863519166c8abc0c7db84fc53517089532434948903fb777e1e28f0afd247b`. CSS and Three JS responses were also recorded. No console event, pageerror or requestfailed event arrived during this observation.
- At page performance time257.2ms, `debug=false`, readyStateinteractive, hiddenfalse, no stage/canvas/UI. The stage subsequently appeared at408.3ms; DOMContentLoaded/load completed around425ms, with no canvas/UI/debug yet. These lifecycle events **do not** prove the async main initialization completed.
- A completed long task was reported at performance687ms, duration28857ms. The first subsequent DOM observation at29544.5ms had **debug=true, two canvases and the UI, tick0, pausedfalse**. Static startup order means initialization had completed by this observation, but no constructor-specific start/end hooks were installed; the28.857s cannot be attributed separately to world, Simulation or renderer construction.
- Probe rAF observations at29558.4ms and44722.6ms still had tick0. Another completed long task started44720.6ms and lasted34999ms. At79720.1ms, tick4 and all ten phase names were observed; at84593.9ms, tick8. This establishes slow progress after debug publication in this separate run. It does not identify whether pathfinding, scene updates, rendering, driver waits or a combination consumed a particular long task.
- The+88.045s explicit read returned: `readyState=complete`, `hidden=false`, `paused=false`, tick8, speed1, accumulator0, 616 citizens, all ten phase names; renderer frame3,709 calls,902140 triangles;11 near resident chunks,0 residency failures. These are captured counters with diagnostic overhead, **not an FPS/Mac/performance acceptance**.

The page execution requests at intermediate checkpoints did not return within3s. The corresponding CDP metrics did return. This proves those bounded evaluations were unavailable on demand; it does not by itself distinguish a busy JS task from a native renderer/driver wait.

## Debugger scope

The last-phase diagnostic attempted `Debugger.enable` once. It exceeded its1s bound. Consequently the following `Debugger.pause` call was **never sent**, no `Debugger.paused` event arrived, no callframes were captured, and no resume was performed. The raw field/event named `pauseRequested` describes the attempted diagnostic sequence, not a successful pause or even a transmitted `Debugger.pause`. No blocking function is confirmed.

## Cleanup and source boundaries

The original cleanup recorded Chromium still present while `browser.close()` was pending, and the preview was TERM-closed with exit143. The raw manifest remains unchanged. Under a subsequent narrowly authorized cleanup check at**15:34:50.754–15:34:50.803 UTC**, the exact Chromium PID160524 was already absent; **no signal was sent**. In that execution context, non-Z Chromium count was0. Ports4187/4173 were independently connection-refused. The later check therefore establishes release without rewriting the earlier close timeout.

All103 frozen inputs,98 shared executable inputs, observer and entry bytes matched throughout the actual diagnostic. Between the completed diagnostic and the later cleanup receipt, root explicitly integrated public-rest-v2 and began freezing11. The cleanup saw shared `src/simulation.ts` SHA `ba289751a2990ae405538801561d6032c982148f15887c1c8745da2264a06f49` rather than old10 `607d7e55a7bf8042b7abed1e2cfa03cc22216b2429f0f8261c4356ecb5f31213`; start/end of that cleanup were equal, and immutable10 remained exact. Thus its `sharedExecutable98Stable:false` compares current11 against old10 and **does not invalidate or extend** the actual probe's earlier98 equality.

The original0/11 run lacked this timeline and cannot be assigned the same timings or a confirmed cause retroactively. Its immutable numeric source contracts are103/98; only its final prose retained the erroneous old102/97 string, separately explained in `original-failure-explanation.json`. Prepared10 native-home remains **NOT_RUN** and is not current11 validation.

Canonical raw: `probe-evidence/{events.json,snapshots.json,observed-responses.json,run-start.json,run-manifest.json,server.log}`. Later independent cleanup: `cleanup-receipt.json`. The archive includes these bytes, preserved original0/11 evidence, observer source/contract, and four selected frozen source files plus the exact dist entry for review; it is **not** a complete103-file source distribution.
