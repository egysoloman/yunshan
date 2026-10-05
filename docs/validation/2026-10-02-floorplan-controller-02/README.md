# Ground-courtyard edge repair / CPU release 02

This supersedes the Controller hash in [release 01](../2026-10-02-floorplan-controller-01/README.md). The pure provider remains **ec3fd0fdc4e9f0b4614a905a58be7ee6bbf0d85d3c92c978c0b80967ca6f895e**; its floor, roof, furniture, opening and route contracts are unchanged. The new Controller is **9491986a2f037ed85f6b4f4f529786027e014984583b3dab3df864f0154d0ca6**.

The additional real motor probe found that walking from external ground onto an open .6 m courtyard stopped before the edge, despite no wall and a supported courtyard target. `exterior-court-first.json` preserves the failure (z16.064); `exterior-court-probe.json` preserves the same probe after repair (z14.12, y.6, `crossed:true`). The initial placement and commanded movement are identical. Neither uses E or relocates feet mid-walk.

The repair is limited to **actual courtyard/gallery support on floor zero at the external stone boundary**. It audits the exterior .2 m terrain cells touched by the .35 m body circle: corner/centre walk heights must be finite and within the original 2.6 m terrain step threshold of the stone plane. It then checks the complete projected body disk against the union of actual stone/slab regions and that audited exterior terrain. The merged exterior strips do not fill any interior hole. Real wall, glass, fixture and capsule sweep checks still run. Indoor room floors, stair rises, permissions and upper-floor voids retain their existing checks; this is not a whitelist for a building's bounding box.

The added test actually walks from external ground across the stone edge and back, remaining outside an indoor facility. Its negative case uses a genuine 3.4 m elevated bridge deck beside the .6 m stone slab: the >2.6 m height difference stops the full body before the unsupported transition. Existing actual motor tests also retain cabinet, shaft hole, permission and both stair-flight assertions.

`edge-target-first.log` preserves the first positive repair run. `edge-target-second.log` preserves an invalid attempted river fixture rejected by its actual-height prerequisite: the world's foundation logic fills terrain within two metres, so placing a river descriptor did not create the requested cliff. The negative fixture was corrected to the explicit real elevated deck, with no reduction of the physics assertions; `edge-target-third.log` passes all five affected targets.

Final fixed-source verification:

- **25 / 25**, exit 0: the four access/Controller/provider test files; raw `rules.log`.
- Full **TypeScript strict pass**, exit 0; raw `strict.log`.
- Complete generated `current-v4` world: the same seven actual bodies and 3,240 keyboard W/normal-motor ticks all pass after the Controller change, including actual support each tick and unchanged movement speed; raw `actual-sites-motor.*`.
- The exact exterior courtyard probe now crosses successfully; raw `exterior-court-probe.*`.
- All **83 copied inputs** matched the workspace before/after capture and remained byte-identical after the checks. The five owned workspace files still matched. `source-manifest.json`, `result.json` and `frozen-inputs.zip` preserve that source.

These are CPU correctness checks. Runs overlapped other CPU diagnostics, so durations are not hardware performance comparisons. They are not normal unaided journeys, GPU screenshots, or final visual acceptance. First-storey stair motor probes are not a claim that every floor of every building has been walked continuously. World/save/old-recipe equality and whole-scene GL remain the parent and other owners' separately documented checks. The pure provider remains frozen for the ongoing world owner scope; only Controller and its added test changed in this release.
