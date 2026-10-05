import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { Simulation } from '../src/simulation';
import { foodCounterWorld } from '../tests/helpers/food-counter-world';
const out='/tmp/yunshan-food-counter-archive-receipts-20261002';mkdirSync(out,{recursive:true});
test('actual paid-period receipts reject changed payment, overpayment and contract totals atomically',()=>{
 const original=readFileSync('/tmp/yunshan-food-counter-archive-boundary-20261002/256-period-save.json','utf8'),world=foodCounterWorld(),valid=new Simulation(world),load=valid.importSave(original);assert.equal(load.ok,true,load.message);assert.equal(valid.exportSave(),original);const parsed=JSON.parse(original),first=parsed.state.foodDistribution.payroll.periods[0].claims.find((c:any)=>c.amount>0);assert.ok(first);assert.ok(Math.abs(first.amount-first.paidGross)<1e-7,'actual old finance already paid this claim; this is not an unpaid fixture');const records:any[]=[];
 const cases:[string,(claim:any)=>void][]=[['false unsettled receipt',c=>c.paidGross=0],['overpaid receipt',c=>c.paidGross=c.amount+.01],['rewritten contractual gross',c=>c.amount+=.01]];
 for(const[name,edit]of cases){const saved=JSON.parse(original),claim=saved.state.foodDistribution.payroll.periods[0].claims.find((c:any)=>c.citizenId===first.citizenId);edit(claim);const receiver=new Simulation(world),before=receiver.exportSave(),result=receiver.importSave(JSON.stringify(saved));records.push({name,result,atomic:receiver.exportSave()===before});assert.equal(result.ok,false,name);assert.equal(receiver.exportSave(),before,name);}
 writeFileSync(`${out}/proof.json`,JSON.stringify({scope:'single-field adversarial edits of actual fully-paid source records; unpaid paidGross-to-full forgery NOT_RUN without real unpaid fixture; no archive implemented',originalClaim:first,cases:records},null,2)+'\n');
});
