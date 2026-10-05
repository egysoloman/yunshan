import { mkdir, writeFile } from 'node:fs/promises';
import { familyFeeFixture, advance } from '../tests/family-fee-education-fixture';

// The same declared birth/age and physical controls as the rule regressions.
// Original commands pay birth and admission; this never grants tuition,
// money, textbooks, teacher wages, formal minutes, or qualifications.
const context = familyFeeFixture();
advance(context.sim, 4);
const out = new URL('../output/family-fee-education/', import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(new URL('ui-world.json', out), JSON.stringify(context.sim.worldDefinition));
await writeFile(new URL('ui-opening.save.json', out), context.sim.exportSave());
await writeFile(new URL('ui-controls.json', out), JSON.stringify({
  entries: [...context.controls], childId: context.child.id,
  siteId: context.site.id, homeId: context.home.id, teacherId: context.teacher.id,
  openingPlayer: context.openingPlayer, openingSpouse: context.openingSpouse,
  scope: 'Controlled physical classroom DOM integration; no autonomous commute, natural six-year growth, rendered 3D, or full city claim.',
}, null, 2));
console.log(JSON.stringify({ status: 'GENERATED', childId: context.child.id, cash: context.sim.state.player.money, teacherId: context.teacher.id, familyCourse: context.sim.state.familyEducation ?? null }));
