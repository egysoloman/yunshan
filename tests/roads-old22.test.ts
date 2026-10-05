import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Simulation} from '../src/simulation.ts';
import {createWorld} from '../src/world.ts';

test('real previous22 native cold save stays byte exact and follows all24 original continuation hashes',()=>{
  const initial=readFileSync(new URL('./fixtures/roads-old22/cold.json',import.meta.url),'utf8');
  const expected=JSON.parse(readFileSync(new URL('./fixtures/roads-old22/continuation-sha.json',import.meta.url),'utf8'));
  const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
  assert.equal(sha(initial),expected.initialSHA);
  const sim=new Simulation(createWorld(JSON.parse(initial).worldSeed, 'current-v4'));const result=sim.importSave(initial);assert.equal(result.ok,true,result.message);
  assert.equal(sim.exportSave(),initial);
  assert.equal(sim.state.roadNetwork,undefined);assert.equal(sim.state.roadworks,undefined);
  for(const row of expected.rows){sim.step(.25);assert.equal(sim.state.tick,row.tick);assert.equal(sim.state.extension!.lastUpdate,row.clock);assert.equal(sha(sim.exportSave()),row.sha256,`actual old22 continuation tick ${row.tick}`);}
});
