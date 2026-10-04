import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const projectDir = fileURLToPath(new URL('..', import.meta.url));
const out = new URL('../output/family-fee-education/', import.meta.url);
const results = [], errors = [];
let browser, server, page, failure;
try {
  await mkdir(out, { recursive: true });
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><body><div id="app"></div><script type="module">
import '/src/style.css';
import {Simulation} from '/src/simulation.ts';
import {CityUI} from '/src/ui.ts';
import {familyEducationHeldCash} from '/src/simulation/family-education.ts';
import {getBuildingBody} from '/src/architecture-floor-plan.ts';
const world=await (await fetch('/output/family-fee-education/ui-world.json')).json();
const saved=await (await fetch('/output/family-fee-education/ui-opening.save.json')).text();
const controls=await (await fetch('/output/family-fee-education/ui-controls.json')).json();
const sim=new Simulation(world), loaded=sim.importSave(saved);
if(!loaded.ok||sim.exportSave()!==saved)throw Error('Original UI fixture save did not import exactly: '+loaded.message);
const runtime=Reflect.get(sim,'runtime'), pins=new Map(controls.entries), original=Reflect.get(sim,'setDestination');
Reflect.set(sim,'setDestination',(person,destination,rebuild=false)=>{const value=pins.get(person.id);if(value?.siteId===destination.id){person.destinationId=destination.id;person.route=[{...value.position}];person.routeIndex=1;return;}return original.call(sim,person,destination,rebuild);});
sim.onPhase('traffic',()=>{for(const [id,value]of pins){const person=sim.state.citizens.find(p=>p.id===id);person.position={...value.position};person.destinationId=value.siteId;person.route=[{...value.position}];person.routeIndex=1;person.needs={hunger:100,fatigue:100,social:100,fun:100};runtime.activities[id]=id===controls.childId&&value.siteId===controls.siteId?'study':value.activity;runtime.decisionAt[id]=sim.state.day*1440+sim.state.hour*60+10;}sim.state.player.needs.hunger=sim.state.player.needs.fatigue=100;});
const site=world.buildings.find(b=>b.id===controls.siteId),home=world.buildings.find(b=>b.id===controls.homeId),child=sim.state.citizens.find(p=>p.id===controls.childId);
const classroom={...child.position};sim.setFocus(classroom,'walk');
const view={mode:'walk',quality:'balanced',fps:60,drawCalls:0,triangles:0,position:{...classroom},nearbyBuilding:site,nearbyCitizen:null,nearbyVehicle:null,targetDistrict:null,inside:!!getBuildingBody(site),renderDistance:3600,fpsCap:60,dynamicResolution:true,simulationDetail:1};
let ui;const calls=[];
const actions={command(command){const result=sim.command(command);calls.push({command,result});ui.notify(result.message,result.ok);ui.update(sim.state,view)},isAtBuildingFunctionPoint(id,purpose){const b=world.buildings.find(b=>b.id===id);return !!b&&sim.isAtBuildingFunctionPoint(b,sim.state.player.position,purpose)},setMode(mode){view.mode=mode;ui.update(sim.state,view)},setQuality(q){view.quality=q;ui.update(sim.state,view)},interact(){},save(){},load(){},exportSave(){},importSave(){},setSetting(){},resetView(){}};
ui=new CityUI(document.getElementById('app'),world,actions);ui.update(sim.state,view);
window.fee={sim,world,site,home,child,pins,runtime,ui,view,calls,controls,classroom,familyEducationHeldCash,
refresh(){view.position={...sim.state.player.position};ui.update(sim.state,view)},
advance(ticks){for(let i=0;i<ticks;i++)sim.step(.25);this.refresh()},
placeChild(where){const b=where==='home'?home:site,pos=where==='home'?home.door:classroom;const value=pins.get(child.id);value.siteId=b.id;value.position={...pos};value.activity='social';child.position={...pos};child.destinationId=b.id;child.route=[{...pos}];child.routeIndex=1;runtime.decisionAt[child.id]=sim.state.day*1440+sim.state.hour*60+10;this.refresh()},
cash(){const s=sim.state,e=s.extension;return s.treasury+runtime.taxes+s.player.money+s.banking.cash+s.banking.legacyInvestmentCash+s.citizens.reduce((sum,p)=>sum+p.money,0)+s.shops.filter(shop=>!e.companies.some(c=>c.buildingId===shop.buildingId)).reduce((sum,p)=>sum+(p.cash??0),0)+e.companies.reduce((sum,c)=>sum+c.capital,0)+e.organizations.reduce((sum,o)=>sum+o.funds,0)+(s.playerLabor?.job?.escrow??0)+(s.education?.course?.escrow??0)+s.clinical.orders.reduce((sum,o)=>sum+o.escrow,0)+s.family.pregnancies.reduce((sum,p)=>sum+p.escrow,0)+s.family.households.reduce((sum,h)=>sum+h.balance,0)+familyEducationHeldCash(s)}
};setInterval(()=>window.fee.refresh(),100);window.ready=true;
</script></body></html>`;
  server = await createServer({ root: projectDir, server: { host: '127.0.0.1', port: 4187, strictPort: true, watch: null }, plugins: [{ name: 'family-fee-ui-fixture', configureServer(vite) { vite.middlewares.use(async (request, response, next) => { if (request.url !== '/family-fee-ui.html') return next(); try { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(await vite.transformIndexHtml(request.url, html)); } catch (error) { next(error); } }); } }] });
  await server.listen();
  browser = await chromium.launch({ executablePath: process.env.YUNSHAN_CHROMIUM ?? '/usr/bin/chromium', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:4187/family-fee-ui.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.ready);
  const card = '[data-ref="context-body"] [data-family-education-child="resident-1"]';
  const enroll = `${card} [data-command="enrollFamilyCourse"]`;
  assert.equal(await page.locator(enroll).isEnabled(), true);
  assert.match(await page.locator(card).innerText(), /480分钟|共同|监护/);
  await page.evaluate(() => { const f=window.fee;f.beforeCash=f.cash();f.beforeWallet=f.sim.state.player.money;f.placeChild('home'); });
  assert.equal(await page.locator(enroll).isDisabled(), true);
  assert.match(await page.locator(card).innerText(), /共同走到原书院同一公共课堂/);
  await page.evaluate(() => window.fee.placeChild('school'));
  await page.locator(enroll).click();
  assert.equal(await page.evaluate(() => window.fee.calls.at(-1).result.ok), true);
  assert.equal(await page.evaluate(() => window.fee.sim.state.player.money), await page.evaluate(() => window.fee.beforeWallet-40));
  assert.equal(await page.evaluate(() => window.fee.familyEducationHeldCash(window.fee.sim.state)),40);
  assert.ok(Math.abs(await page.evaluate(() => window.fee.cash()-window.fee.beforeCash))<=1e-6);
  results.push('School native UI rejects absent child and signs a true 40-cash guardian escrow only when both are physically present.');
  await page.evaluate(() => window.fee.advance(32));
  const actual = await page.evaluate(() => window.fee.sim.state.familyEducation.active[0]);
  assert.ok(actual.workedMinutes>0&&actual.workedMinutes<60);
  assert.equal(actual.receivedUnits,1);
  assert.ok(actual.receipt.gross>0&&actual.staffMinutes[await page.evaluate(() => window.fee.controls.teacherId)]>0);
  assert.equal(await page.evaluate(() => window.fee.child.education),0);
  assert.ok(Math.abs(await page.evaluate(() => window.fee.cash()-window.fee.beforeCash))<=1e-6);
  assert.match(await page.locator(card).innerText(), /真实教材来源/);
  assert.match(await page.locator(card).innerText(), /实际授课教师/);
  await page.screenshot({ path: fileURLToPath(new URL('family-fee-school-native-ui.png',out)), fullPage: true });
  results.push('Actual UI reports one real supplier receipt, a paid native teacher, earned minutes, original payer and escrow; partial study grants no qualification.');
  await page.evaluate(() => { const f=window.fee;f.pauseMinutes=f.sim.state.familyEducation.active[0].workedMinutes;f.placeChild('home');f.advance(8); });
  assert.equal(await page.evaluate(() => window.fee.sim.state.familyEducation.active[0].status),'paused');
  assert.equal(await page.evaluate(() => window.fee.sim.state.familyEducation.active[0].workedMinutes),actual.workedMinutes);
  assert.equal(await page.locator(`${card} [data-command="resumeFamilyCourse"]`).isDisabled(),true);
  await page.evaluate(() => { const f=window.fee;f.placeChild('school');f.resumeWallet=f.sim.state.player.money; });
  await page.locator(`${card} [data-command="resumeFamilyCourse"]`).click();
  assert.equal(await page.evaluate(() => window.fee.calls.at(-1).result.ok),true);
  assert.equal(await page.evaluate(() => window.fee.sim.state.player.money),await page.evaluate(() => window.fee.resumeWallet));
  assert.equal(await page.evaluate(() => window.fee.sim.state.familyEducation.active[0].workedMinutes),actual.workedMinutes);
  results.push('Physical departure pauses teaching, and original guardian physically resumes the same course with no catchup or second charge.');
  await page.evaluate(() => { const f=window.fee;f.refund=f.sim.state.familyEducation.active[0].escrow;f.refundWallet=f.sim.state.player.money; });
  await page.locator(`${card} [data-command="cancelFamilyCourse"]`).click();
  assert.equal(await page.evaluate(() => window.fee.calls.at(-1).result.ok),true);
  assert.equal(await page.evaluate(() => window.fee.sim.state.familyEducation.active.length),0);
  assert.ok(Math.abs(await page.evaluate(() => window.fee.sim.state.player.money-window.fee.refundWallet-window.fee.refund))<=1e-6);
  assert.equal(await page.evaluate(() => window.fee.sim.state.familyEducation.stock[window.fee.site.id].availableUnits),1);
  assert.equal(await page.evaluate(() => window.fee.child.education),0);
  assert.ok(Math.abs(await page.evaluate(() => window.fee.cash()-window.fee.beforeCash))<=1e-6);
  results.push('Cancel native UI returns only actual unearned escrow to original wallet, keeps the paid unused textbook at school and retains all partial history.');
  await page.locator('[data-action="panel"]').click();
  const familyCard = '[data-ref="family-life"] [data-family-education-child="resident-1"]';
  assert.equal(await page.locator(`${familyCard} [data-command="enrollFamilyCourse"]`).isEnabled(),true);
  assert.match(await page.locator(familyCard).innerText(),/已取消并保留历史/);
  await page.screenshot({ path: fileURLToPath(new URL('family-fee-household-native-ui.png',out)), fullPage: true });
  results.push('Existing life/family pane exposes the same causal native school contract and preserved original canceled history.');
  const saveCheck = await page.evaluate(() => { const f=window.fee,saved=f.sim.exportSave();const next=new (f.sim.constructor)(f.world),r=next.importSave(saved);return{ok:r.ok,message:r.message,exact:next.exportSave()===saved}; });
  assert.equal(saveCheck.ok,true,saveCheck.message);assert.equal(saveCheck.exact,true);
  await page.evaluate(() => { const f=window.fee;Object.assign(f.sim.state.extension.actorProfiles[f.child.id],{alive:false,health:0});f.advance(1); });
  await page.waitForFunction(() => document.querySelector('[data-ref="family-life"]').textContent.includes('我原先实付的子女课程'));
  assert.match(await page.locator('[data-ref="family-life"]').innerText(),/我原先实付的子女课程/);
  assert.equal(await page.locator(`${familyCard} [data-command="enrollFamilyCourse"]`).isDisabled(),true);
  assert.match(await page.locator(familyCard).innerText(),/已取消并保留历史/);
  assert.equal(await page.evaluate(() => window.fee.sim.state.familyEducation.pages[0][0].refunded>0),true);
  assert.equal(await page.evaluate(() => window.fee.child.education),0);
  results.push('After a controlled child death, original payer retains visible canceled tuition rights in the family pane while new dependent signing is disabled.');
  assert.deepEqual(errors,[]);
  results.push('Real resulting canceled course save imports byte exactly; browser has no console or page errors.');
} catch (error) {
  failure=error;
  if(page)await page.screenshot({path:fileURLToPath(new URL('family-fee-ui-failure.png',out)),fullPage:true}).catch(()=>{});
} finally {
  await browser?.close();await server?.close();
  const report={status:failure?'FAIL':'PASS',passed:results.length,results,errors,scope:'Native DOM with actual saved Simulation and controlled physical classroom fixture. No WebGL/GPU, natural commute, age growth or 14-day claim.',failure:failure?{message:failure.message,stack:failure.stack}:null};
  await writeFile(new URL('family-fee-ui-results.json',out),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
if(failure)throw failure;
