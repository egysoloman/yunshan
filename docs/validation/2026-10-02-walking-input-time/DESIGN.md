# Isolated walking input time candidate

The independent `before` copy contains the 106 original freeze12 inputs. `candidate` changes only `src/controller.ts`, `src/main.ts`, and the new formal input regression file (107 inputs). Frozen/shared sources, original native wrapper, timeouts, assertions and failure evidence are untouched.

The original native12 failure ran 100 W pulses toward the exterior point (-390.8, 76.46415094339623, 334.6). Its 17 nonzero movements each traversed 4.8 horizontal metres between the legal exterior stage z336.6 and the interior z331.8. There were no E inputs or completed business checks. The real door is z333.4; E from the exterior should enter z331.4, whereas E from the observed interior would exit. These records have no per-event occurrence timestamps, so the candidate does not claim an exact replay of their event order.

The old main frame applied current keys to every 1/30-second collision step in the entire capped delta. The candidate reads the complete interval between frames using normalized DOM occurrence timestamps. DOM initializes trusted-event timestamps from the occurrence time relative to the document's high-resolution origin: https://dom.spec.whatwg.org/#dom-event-timestamp . Legacy epoch values are translated using `performance.timeOrigin`; invalid, negative or incompatible future values fall back to the actual monotonic handler time. Future-to-rAF transitions remain queued. Backward timestamps are clamped to dispatch order.

The frame interval is `[max(now - rawSeconds*1000, lastConsumed, resetCutoff), now]`. Effective nonzero forward/strafe intervals consume movement budget; idle, modifier-only and opposing keys do not. If active time exceeds the original capped delta, the latest active second is selected and replayed in chronological order through unchanged <=1/30-second motor/collision steps. A completed 200ms pulse earlier in a five-second frame therefore retains 200ms; a five-second hold receives at most one second. Multiple pulses whose total exceeds that cap can lose their earlier portions. Simulation still receives the original `min(rawDelta, 1)`; speed, clock, phases, support, permissions, body radius and eye height are unchanged.

Walking has a separate continuous-key layer. Successful setMode, blur and visibility changes clear it and its queued history. Successful doors, stairs and passenger synchronization discard historical budget but preserve already accepted held walking keys. Old keydowns occurring before the reset cutoff cannot revive walking; old keyups still release held state. Vehicle/aircraft live keys and legacy `step` retain their old behavior. Production main uses only the new frame method; mixing legacy `step` and frame replay is not a shared accounting contract.

Already consumed frames are never rolled back when an old release arrives later. Yaw remains the current view yaw during replay, and vehicle/aircraft control history is outside this narrow fix. Invalid clocks cannot reconstruct occurrence time. These remain limits for subsequent native validation; Node regressions and build do not establish browser performance or macOS acceptance.

The formal regressions use actual EventTarget listeners, a controlled monotonic clock, explicit DOM occurrence timestamps and authoritative source-supported roads. Every fixture checks initial walking support and complete World JSON immutability. The external before probe keeps the same fixtures/assertions, changing only relative source imports and the frame bridge to the exact old main loop; actual negative displacements are checked, not just failure counts.

Preserved attempts:

- `attempt01-accepted-clock`: unrun handler-only/last-second draft, superseded by occurrence timestamps and full-frame active budgeting.
- `attempt02-reset-clipping`: unrun clip-only reset draft, superseded by strict old-press filtering.
- `run01` / `attempt03-tsc-fail`: actual strict tsc exit2 from assertion-induced TypeScript narrowing; same occupancy assertion retained through a read helper.
- `run02` / `attempt04-unsupported-fixture`: actual 1/13 candidate pass; the other 12 had an unsupported y0 starting point and the original cliff guard correctly stopped motion. Its three old failures do not reproduce excessive motion; this invalid attribution is preserved and explicitly corrected. Declared road support and an initial support assertion repair only the fixture.

This directory has not been uploaded to Library or committed/pushed. Integration and subsequent freeze13/native GPU verification remain root-controlled.
