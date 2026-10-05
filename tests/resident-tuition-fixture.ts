import assert from 'node:assert/strict';
import { Simulation } from '../src/simulation.ts';
import { createLearningCityLifeProductCity } from '../src/product-city.ts';
import { assembleSave, partitionSave } from '../src/persistence/partition.ts';
import { familyEducationHeldCash } from '../src/simulation/family-education.ts';
import { residentEducationCourses, residentEducationHeldCash } from '../src/simulation/resident-education.ts';
import type { Citizen } from '../src/types.ts';
import { at, attachControls, cash, close, fixture, pin, runtime, station, type Controls } from './education-fixture.ts';

/** Controlled physical classroom regression only. Original adult students,
 * cash, workId, teacher roles, real wages and industrial inventory are native.
 * Pins/needs isolate contract boundaries; natural audit must use neither. */
export async function residentTuitionFixture() {
  const sim=await createLearningCityLifeProductCity(fixture()),controls:Controls=new Map(),site=sim.worldDefinition.buildings.find(b=>b.kind==='school')!;
  const teacher=sim.state.citizens.find(p=>p.role==='老师' && p.workId===site.id && (p.education ?? 0)>=2)!;
  assert.ok(teacher);
  for(const p of sim.state.citizens){const home=sim.worldDefinition.buildings.find(b=>b.id===p.homeId)!;pin(sim,controls,p.id,home,home.door);}
  pin(sim,controls,teacher.id,site,station(site),'work');
  const hall=sim.worldDefinition.buildings.find(b=>b.kind==='hall')!,reviewers=sim.state.citizens.filter(p=>p.role==='官员' && p.workId===hall.id).slice(0,2);
  assert.equal(reviewers.length,2);for(const p of reviewers)pin(sim,controls,p.id,hall,hall.door,'work');
  attachControls(sim,controls);
  const students=new Set<string>();
  sim.onPhase('traffic',()=>{for(const id of students)if(controls.get(id)?.siteId===site.id)runtime(sim).activities[id]='study';});
  const study=(person:Citizen)=>{students.add(person.id);pin(sim,controls,person.id,site,station(site));};
  const student=sim.state.citizens.find(p=>p.role==='学生' && p.workId===site.id && p.education===2 && p.money>=140 && sim.state.extension!.actorProfiles[p.id].skill>=35)!;
  assert.ok(student,'unchanged constructor supplies an adult student with native education, money and skill');
  return {sim,controls,site,teacher,student,students,study};
}
export type ResidentTuitionContext=Awaited<ReturnType<typeof residentTuitionFixture>>;
export function residentTuitionCash(sim:Simulation):number {return cash(sim)+familyEducationHeldCash(sim.state)+residentEducationHeldCash(sim.state);}
export function residentCourse(sim:Simulation,actorId:string){const c=residentEducationCourses(sim.state).filter(c=>c.actorId===actorId).at(-1);assert.ok(c,'native accepted own course must exist');return c;}
export function stepUntil(sim:Simulation,condition:()=>boolean,cap=256):void {for(let i=0;!condition() && i<cap;i++)sim.step(.25);assert.ok(condition(),`controlled native boundary observed within ${cap} ordinary frames`);}
export function validateBalance(sim:Simulation,cashBefore:number):void {close(residentTuitionCash(sim),cashBefore,'all native wallets plus original tuition escrow conserve');}
export function continueResident24(context:ResidentTuitionContext):void {
  const {sim,controls,students}=context,raw=sim.exportSave(),assembled=assembleSave(partitionSave(raw,sim.worldDefinition));assert.equal(assembled,raw);
  const whole=new Simulation(sim.worldDefinition),parts=new Simulation(sim.worldDefinition);
  for(const [city,json] of [[whole,raw],[parts,assembled]] as const){const result=city.importSave(json);assert.equal(result.ok,true,result.message);assert.equal(city.exportSave(),raw);attachControls(city,controls);city.onPhase('traffic',()=>{for(const id of students)if(controls.get(id)?.siteId===context.site.id)runtime(city).activities[id]='study';});}
  for(let i=0;i<24;i++){sim.step(.25);whole.step(.25);parts.step(.25);assert.equal(whole.exportSave(),sim.exportSave());assert.equal(parts.exportSave(),sim.exportSave());}
}
export { at, close, fixture, pin, runtime, station, residentEducationCourses };
