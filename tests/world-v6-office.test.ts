import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld} from '../src/world.ts';
import {Simulation} from '../src/simulation.ts';
import {getBuildingUsePoints} from '../src/architecture-floor-plan.ts';
import {selectSavedWorld,savedWorldFingerprint} from '../src/persistence/world-layout.ts';
import {partitionSave,assembleSave} from '../src/persistence/partition.ts';

test('qualified official uses the actual top office with real62 escrow; traveler and inherited v5 bank remain refused',()=>{
  const world=createWorld(20261001,'current-v6'),sim=new Simulation(world),site=world.buildings.find(b=>b.id==='market-b6')!;
  const point=getBuildingUsePoints(site,39).find(p=>p.purpose==='work'&&p.id.includes('office-east'))!;
  // Controlled initial position and qualification only. This does not assert
  // an earned official career, natural arrival, default city or browser UI.
  sim.setFocus(point.position,'walk');const unqualified=sim.exportSave();
  assert.equal(sim.command({type:'work',targetId:site.id}).ok,false);assert.equal(sim.exportSave(),unqualified);
  sim.state.player.role='official';sim.state.player.identities=['traveler','official'];
  const wallet=sim.state.player.money,treasury=sim.state.treasury,budget=sim.publicBudgetSnapshot().available;
  assert.equal(sim.command({type:'work',targetId:site.id}).ok,true);assert.equal(sim.state.player.money,wallet);
  assert.equal(sim.state.treasury,treasury-62);assert.equal(sim.state.playerLabor!.job!.escrow,62);assert.equal(sim.state.playerLabor!.job!.workedMinutes,0);
  assert.equal(sim.state.playerLabor!.job!.employer.siteId,site.id);assert.equal(sim.state.playerLabor!.job!.employer.kind,'public');
  assert.ok(budget>=62);
  sim.step(.25);assert.equal(sim.state.playerLabor!.job!.workedMinutes,.25);assert.ok(sim.state.player.money>wallet);
  const earned=sim.state.playerLabor!.job!.paidNet;assert.ok(Math.abs(earned-62/60*.25*(1-sim.state.taxRate))<1e-7);
  sim.setFocus(site.door,'walk');sim.step(.25);assert.equal(sim.state.playerLabor!.job!.workedMinutes,.25,'leaving actual upper office pauses rather than paying from a bank facade');
  sim.setFocus(point.position,'walk');sim.step(.25);assert.equal(sim.state.playerLabor!.job!.workedMinutes,.5);
  assert.equal(sim.command({type:'cancelWork'}).ok,true);assert.equal(sim.state.playerLabor!.job,null);
  assert.ok(Math.abs(sim.state.playerLabor!.history[0].refundedGross-(62-62/60*.5))<1e-7);
  const beforeDeposit=sim.state.player.money,bankCash=sim.state.banking!.cash;
  assert.equal(sim.command({type:'deposit',targetId:site.id,value:50}).ok,true);
  assert.equal(sim.state.player.money,beforeDeposit-50);assert.equal(sim.state.banking!.cash,bankCash+50);assert.equal(sim.state.bankBalance,50);
  const original=new Simulation(createWorld(20261001,'current-v5')),bank=original.worldDefinition.buildings.find(b=>b.id===site.id)!;
  original.state.player.role='official';original.state.player.identities=['traveler','official'];original.setFocus(getBuildingUsePoints(bank,0).find(p=>p.purpose==='work')!.position,'walk');
  const bytes=original.exportSave();assert.equal(original.command({type:'work',targetId:bank.id}).ok,false);assert.equal(original.exportSave(),bytes);
});

test('new complete and partitioned saves bind actual v6 geometry, preserve24ordinary future ticks, and cannot relabel an old world into towers',()=>{
  const world=createWorld(20261001,'current-v6'),live=new Simulation(world),reader=new Simulation(world);
  const original=live.exportSave();assert.equal(reader.importSave(original).ok,true);assert.equal(reader.exportSave(),original);
  assert.equal(assembleSave(partitionSave(original,world)),original);
  const envelope=JSON.parse(original);envelope.layoutVersion='current-v5';envelope.world=createWorld(world.seed,'current-v5');
  assert.equal(selectSavedWorld(JSON.stringify(envelope)).layout,'current-v6');
  const before=reader.exportSave();envelope.worldFingerprint=savedWorldFingerprint(envelope.world);
  assert.equal(reader.importSave(JSON.stringify(envelope)).ok,false);assert.equal(reader.exportSave(),before);
  assert.equal(selectSavedWorld(JSON.stringify(envelope)).layout,'current-v5');
  for(let tick=0;tick<24;tick++){live.step(.25);reader.step(.25);assert.equal(reader.exportSave(),live.exportSave(),`complete tick ${tick+1}`);}
});
