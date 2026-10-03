import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { settleDeceasedAccount } from '../src/simulation/banking.ts';
import { setupRoadworks,request,cash,exact24 } from './roadworks-fixture.ts';
import { core } from './power-fixture.ts';

// Same test bytes run against original root23 and the later narrow bank guard.
// Original residents fund this loan, and a real charity receives the spend.
// Only one initial depositor position/visit intent and the explicit mortality
// boundary are controlled. No wallet/education/skill/role/needs is fabricated.
test('road repair payer death retains a real loan until its actual100 escrow refunds',t=>{
  const context=setupRoadworks(), {sim,closure}=context, bankSite=sim.worldDefinition.buildings.find(b=>b.kind==='bank')!;
  const depositor=sim.state.citizens.find(c=>c.money>400&&c.needs.hunger>=65&&c.needs.fatigue>=60&&sim.state.extension!.actorProfiles[c.id].age>=18&&sim.state.extension!.actorProfiles[c.id].alive)!;
  assert.ok(depositor,'original constructor must supply a willing funded adult, not seeded bank money');
  const original={money:depositor.money,skills:structuredClone(depositor.skills),education:depositor.education,role:depositor.role,homeId:depositor.homeId,workId:depositor.workId,needs:structuredClone(depositor.needs)};
  depositor.position={...bankSite.door};depositor.destinationId=bankSite.id;depositor.route=[{...bankSite.door}];depositor.routeIndex=1;
  core(sim).activities[depositor.id]='social';core(sim).decisionAt[depositor.id]=sim.state.day*1440+sim.state.hour*60+60;
  const beforeFunding=cash(sim);sim.step(.25);
  assert.ok(sim.state.banking!.cash>=100,'native resident banking observer supplies real cash');assert.ok(Math.abs(cash(sim)-beforeFunding)<1e-6);
  assert.equal(depositor.money,original.money-100);assert.deepEqual({skills:depositor.skills,education:depositor.education,role:depositor.role,homeId:depositor.homeId,workId:depositor.workId},{skills:original.skills,education:original.education,role:original.role,homeId:original.homeId,workId:original.workId});
  assert.ok(sim.state.banking!.receipts.some(r=>r.kind==='deposit'&&r.actorId===depositor.id&&r.amount===100));
  sim.setFocus(bankSite.door,'walk');const loan=sim.command({type:'loan',targetId:bankSite.id,value:20});assert.equal(loan.ok,true,loan.message);assert.equal(sim.state.loan,20);
  const civic=sim.worldDefinition.buildings.find(b=>b.kind==='hall')!;sim.setFocus(civic.door,'walk');
  const charity=sim.state.extension!.organizations.find(o=>o.kind==='charity')!,oldCharity=charity.funds,spend=sim.state.player.money-100;
  assert.ok(Number.isInteger(spend)&&spend>=10&&spend<=10000);const donate=sim.command({type:'donate',targetId:charity.id,value:spend});assert.equal(donate.ok,true,donate.message);assert.equal(charity.funds,oldCharity+spend);assert.equal(sim.state.player.money,100);
  sim.setFocus(closure.worksite,'walk');const job=request(context);assert.equal(job.escrow,100);assert.equal(sim.state.player.money,0);assert.equal(job.purchasePaid,0);assert.equal(job.paidGross,0);
  const account=sim.state.banking!.accounts.player,losses=sim.state.banking!.stats.losses,beforeDeath=cash(sim);
  assert.equal(account.loanPrincipal,20);assert.equal(account.deposits,0);assert.equal(sim.state.banking!.legacyInvestmentPrincipal,0);assert.ok(sim.state.shops.every(s=>s.ownerId!=='player'));assert.ok(sim.state.extension!.companies.every(c=>(c.shareholders.player??0)===0));
  const profile=sim.state.extension!.actorProfiles.player;profile.health=0;profile.alive=false;
  const bankHash=createHash('sha256').update(readFileSync(resolve('src/simulation/banking.ts'))).digest('hex'),artifact=resolve('artifacts','road-estate-'+bankHash);mkdirSync(artifact,{recursive:true});writeFileSync(resolve(artifact,'before-settlement.json'),sim.exportSave());
  const pending=settleDeceasedAccount(sim,'player',[]);
  writeFileSync(resolve(artifact,'after-first-settlement.json'),sim.exportSave());writeFileSync(resolve(artifact,'diagnostic.json'),JSON.stringify({bankHash,pending,loan:sim.state.loan,escrow:job.escrow,lossesBefore:losses,lossesAfter:sim.state.banking!.stats.losses,totalCashBefore:beforeDeath,totalCashAfter:cash(sim),depositor:depositor.id,loanReceipt:sim.state.banking!.receipts.find(r=>r.kind==='loan'&&r.actorId==='player'),charity:{id:charity.id,received:spend}},null,2)+'\n');
  t.diagnostic('ROAD_ESTATE_AUTHENTIC_ARTIFACT '+artifact);
  assert.equal(pending.closed,false,'real unrefunded road escrow is an estate asset, not unpaid loss');assert.equal(pending.unpaidLoss,0);assert.equal(account.loanPrincipal,20);assert.equal(sim.state.banking!.stats.losses,losses);assert.equal(job.escrow,100);assert.ok(Math.abs(cash(sim)-beforeDeath)<1e-6);
  sim.step(.25);assert.equal(job.escrow,0);assert.equal(job.refunded,100);assert.equal(job.cancelledAt!==null,true);
  const complete=settleDeceasedAccount(sim,'player',[]);assert.equal(complete.unpaidLoss,0);assert.equal(account.loanPrincipal,0);assert.equal(account.closed,true);assert.equal(sim.state.banking!.stats.losses,losses);assert.ok(sim.state.banking!.stats.repaid>=20);assert.ok(Math.abs(cash(sim)-beforeDeath)<1e-6);exact24(sim);
});
