import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
// DOM integration tests use the real generated world and Simulation, with an
// isolated view fixture so renderer speed cannot hide interaction regressions.
const projectDir = fileURLToPath(new URL('..', import.meta.url));
const artifactsDir = new URL('../artifacts/', import.meta.url);
const port = Number(process.env.YUNSHAN_UI_PORT ?? 4181);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('YUNSHAN_UI_PORT must be an integer from 1024 to 65535.');
let server;
const results=[];
const errors=[];
let browser;
let failure;
try {
  await mkdir(artifactsDir, { recursive: true });
  const fixtureHTML = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><body><div id="app"></div><script type="module">
import '/src/style.css';
import {createWorld} from '/src/world.ts';
import {Simulation} from '/src/simulation.ts';
import {CityUI} from '/src/ui.ts';
import {PlayerController} from '/src/controller.ts';
import {activeAircraft,setAircraftControls} from '/src/aviation.ts';
import {planWalkingJourney,planTransitJourney} from '/src/journey.ts';
import {quoteConsignmentSale} from '/src/simulation/trade.ts';
import {getBuildingBody,getBuildingUsePoints,floorPlanSupport} from '/src/architecture-floor-plan.ts';
import {canAccessFloor} from '/src/access.ts';
import {clinicalAtPosition} from '/src/simulation/clinical.ts';
import {PerspectiveCamera} from 'three';
const world=createWorld();const simulation=new Simulation(world);
const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','Keyboard controller fixture');document.getElementById('app').append(canvas);
const controller=new PlayerController(new PerspectiveCamera(),canvas,world,()=>{});
const view={mode:'drone',quality:'balanced',fps:60,drawCalls:120,triangles:40000,position:{...world.spawn},nearbyBuilding:null,nearbyCitizen:null,nearbyVehicle:null,targetDistrict:null,inside:false,renderDistance:3600,fpsCap:60,dynamicResolution:true,simulationDetail:1};
let ui;const commands=[];const commandResults=[];
const actions={isAtBuildingFunctionPoint(id,purpose){const site=world.buildings.find(site=>site.id===id);return !!site&&simulation.isAtBuildingFunctionPoint(site,simulation.state.player.position,purpose)},command(command){commands.push(command);const r=simulation.command(command);commandResults.push({command,result:r});if(r.ok&&['boardAircraft','leaveAircraft'].includes(command.type)){const craft=activeAircraft(simulation.state);view.mode=craft?.kind??'walk';view.position={...simulation.state.player.position};controller.setMode(view.mode,view.position,craft)}ui.notify(r.message,r.ok);ui.update(simulation.state,view)},setMode(mode){view.mode=mode;ui.update(simulation.state,view)},setQuality(quality){view.quality=quality;ui.update(simulation.state,view)},navigateTarget(id,preference='walk'){this.travel(id,preference)},travel(id,preference='walk'){simulation.command({type:'planJourney',targetId:id,value:preference==='transit'?1:0});view.transitJourney=preference==='transit'?planTransitJourney(world,simulation.state,simulation.state.player.position,id):null;view.journey=view.transitJourney?.approach??planWalkingJourney(world,simulation.state.player.position,id);view.targetDistrict=view.transitJourney?.destination.districtId??view.journey?.destination.districtId??id;ui.update(simulation.state,view)},interact(){},save(){},load(){},exportSave(){},importSave(){},setSetting(key,value){view[key]=value;ui.update(simulation.state,view)},resetView(){}};
ui=new CityUI(document.getElementById('app'),world,actions);ui.update(simulation.state,view);
// Controlled positioning only: never enter by granting a role, sending a
// purchase/work command, editing cash/stock, or crediting elapsed minutes.
function fixturePoint(site,purpose,person=simulation.state.player){
  if(!getBuildingBody(site))return {...site.door};
  const point=getBuildingUsePoints(site,0).find(point=>point.purpose===purpose&&canAccessFloor(site,point.floor,person)&&simulation.isAtBuildingFunctionPoint(site,point.position,purpose,person));
  if(!point)throw Error('No actual public ground-floor fixture point: '+JSON.stringify({siteId:site.id,purpose}));
  const support=floorPlanSupport(site,point.floor,point.position);
  if(!support||!['room','stairs'].includes(support.kind))throw Error('Fixture point lacks shared room support: '+point.id);
  return {...point.position};
}
window.fixture={world,simulation,view,ui,controller,commands,commandResults,quoteConsignmentSale,setAircraftControls,fixturePoint,clinicalAtPosition,canAccessFloor,atPoint(kind,purpose){const b=typeof kind==='string'?world.buildings.find(b=>b.kind===kind&&!b.facility):kind;if(!b)throw Error('No actual fixture building: '+kind);const position=fixturePoint(b,purpose),before=commands.length;view.mode='walk';view.inside=!!getBuildingBody(b);view.nearbyBuilding=b;view.nearbyCitizen=null;view.nearbyVehicle=null;simulation.state.player.position={...position};view.position={...position};ui.update(simulation.state,view);if(commands.length!==before)throw Error('Fixture positioning issued a command');return b.id},at(kind){const b=world.buildings.find(b=>b.kind===kind&&!b.facility);view.mode='walk';view.inside=false;view.nearbyBuilding=b;view.nearbyCitizen=null;view.nearbyVehicle=null;simulation.state.player.position={...b.door};view.position={...b.door};ui.update(simulation.state,view);return b.id},atShop(kind,quantity=1){const b=world.buildings.find(b=>{const shop=simulation.state.shops.find(shop=>shop.buildingId===b.id);return b.kind===kind&&shop?.open&&shop.inventory>=quantity&&simulation.state.player.money>=shop.price*quantity});if(!b)throw Error('No actual available shop: '+JSON.stringify({kind,quantity,cash:simulation.state.player.money,hour:simulation.state.hour,shops:simulation.state.shops.filter(shop=>world.buildings.find(b=>b.id===shop.buildingId)?.kind===kind).map(shop=>({id:shop.id,open:shop.open,inventory:shop.inventory,price:shop.price}))}));return this.atPoint(b,'sale')}};
setInterval(()=>ui.update(simulation.state,view),200);window.ready=true;
</script></body></html>`;
  server = await createServer({
    root: projectDir,
    server: { host: '127.0.0.1', port, strictPort: true, watch: null },
    plugins: [{
      name: 'yunshan-ui-test-fixture',
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (request.url?.split('?')[0] !== '/ui-verify.html' || request.url.includes('html-proxy')) return next();
          try {
            const html = await vite.transformIndexHtml(request.url, fixtureHTML);
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.end(html);
          } catch (error) { next(error); }
        });
      },
    }],
  });
  await server.listen();
  browser=await chromium.launch({executablePath:process.env.YUNSHAN_CHROMIUM ?? '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{ if (message.type()==='error') errors.push(message.text()); });
 await page.goto(`http://127.0.0.1:${port}/ui-verify.html`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.ready);
 await page.getByTestId('panel-toggle').focus();
 await page.keyboard.press('Space');
 assert.equal(await page.getByTestId('panel-toggle').getAttribute('aria-expanded'),'true');results.push('Native Space activation opens panel');
 await page.getByRole('tab',{name:'交通',exact:true}).click();
 await page.locator('[data-destination="river"]').first().click();
 assert.equal(await page.evaluate(()=>window.fixture.view.targetDistrict),'river');results.push('District navigation uses real district IDs');
 await page.waitForTimeout(950); // Cross the 700 ms DOM refresh, rather than testing the same button node.
 assert.equal(await page.evaluate(()=>document.activeElement?.dataset.destination),'river');results.push('Dynamic refresh preserves keyboard focus');
 await page.evaluate(()=>{const f=window.fixture;f.navigationButton=document.querySelector('[data-ref="destination-targets"] [data-navigation]');f.navigationPosition={...f.simulation.state.player.position};f.navigationCash=f.simulation.state.player.money;});
 await page.waitForTimeout(950);
 assert.equal(await page.evaluate(()=>window.fixture.navigationButton===document.querySelector('[data-ref="destination-targets"] [data-navigation]')),true);
 await page.locator('[data-ref="destination-targets"] [data-navigation]').first().click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.journey.targetId),await page.evaluate(()=>window.fixture.navigationButton.dataset.navigation));
 assert.deepEqual(await page.evaluate(()=>window.fixture.simulation.state.player.position),await page.evaluate(()=>window.fixture.navigationPosition));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.money),await page.evaluate(()=>window.fixture.navigationCash));
 assert.equal(await page.locator('[data-ref="walking-guide"] [data-waypoint]').count()>0,true);results.push('Specific real-door navigation keeps native button identity and exposes walk waypoints without moving or paying');
 await page.locator('[data-ref="journey-preference"]').selectOption('transit');
 await page.locator('[data-ref="destination-targets"] [data-navigation]').first().click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.journey.preference),'transit');
 await page.waitForFunction(()=>document.querySelector('[data-ref="transit-route"]')?.textContent.includes('公共交通目的地'));
 assert.match(await page.locator('[data-ref="transit-route"]').innerText(),/公共交通目的地/);results.push('Public journey choice records a route and actual transfer stops without buying tickets');

 await page.getByRole('button',{name:'收起城市手册'}).click();
 assert.equal(await page.evaluate(()=>document.activeElement?.dataset.testid),'panel-toggle');results.push('Closing panel returns focus to toggle');
 await page.evaluate(()=>{const f=window.fixture;f.atPoint('bank','service');f.simulation.state.bankBalance=3100;f.simulation.state.loan=2200;f.ui.update(f.simulation.state,f.view)});
 assert.match(await page.locator('[data-ref="context-body"]').innerText(),/3,100.*云币/);assert.match(await page.locator('[data-ref="context-body"]').innerText(),/2,200.*云币/);results.push('Bank state cache refreshes independently of player cash');
 await page.evaluate(()=>{const f=window.fixture;f.bankCashBefore=f.simulation.state.player.money;f.bankPoolBefore=f.simulation.state.banking.cash;});
 await page.locator('[data-ref="context-body"] [data-bank="deposit"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.money),await page.evaluate(()=>window.fixture.bankCashBefore-100));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.banking.cash),await page.evaluate(()=>window.fixture.bankPoolBefore+100));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.banking.accounts.player.deposits),100);
 assert.match(await page.locator('[data-ref="context-body"]').innerText(),/实际资产 \/ 负债 \/ 净值/);results.push('Bank native deposit transfers wallet cash into the real pool and displays separate assets, claims and equity');
 await page.evaluate(()=>{const f=window.fixture;f.placeTab=document.querySelector('[data-context="building"]');f.view.nearbyCitizen={...f.simulation.state.citizens[0],position:{...f.view.position},state:'atHome'};f.ui.update(f.simulation.state,f.view);});
 await page.waitForTimeout(950);
 await page.evaluate(()=>{const f=window.fixture;f.view.nearbyCitizen.state='moving';f.ui.update(f.simulation.state,f.view);});
 assert.equal(await page.evaluate(()=>window.fixture.placeTab===document.querySelector('[data-context="building"]')),true);
 await page.locator('[data-context="citizen"]').click();
 await page.locator('[data-context="building"]').click();
 assert.equal(await page.locator('[data-context="building"]').getAttribute('aria-pressed'),'true');
 assert.equal(await page.evaluate(()=>window.fixture.placeTab===document.querySelector('[data-context="building"]')),true);
 await page.evaluate(()=>{const f=window.fixture;f.view.nearbyCitizen=null;f.ui.update(f.simulation.state,f.view);});results.push('Native place tabs keep the same DOM nodes across nearby actor updates and live selection changes');

 await page.evaluate(()=>{const f=window.fixture;f.atPoint('market','work');f.laborCash=f.simulation.state.player.money;f.laborWorkButton=document.querySelector('[data-ref="context-body"] [data-command="work"]');f.laborPurchaseButton=document.querySelector('[data-ref="context-body"] [data-command="purchase"]');});
 await page.locator('[data-ref="context-body"] [data-command="work"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.commandResults.at(-1).result.ok),true);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.playerLabor.job.workedMinutes),0);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.money),await page.evaluate(()=>window.fixture.laborCash));
 assert.equal(await page.evaluate(()=>window.fixture.laborWorkButton===document.querySelector('[data-ref="context-body"] [data-command="work"]')),true);
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="work"]').isDisabled(),true);
 await page.evaluate(()=>{const f=window.fixture;for(let i=0;i<40;i++){f.simulation.step(.25);f.ui.update(f.simulation.state,f.view);}f.laborEarned=f.simulation.state.playerLabor.job.workedMinutes;f.laborNet=f.simulation.state.playerLabor.job.paidNet;});
 assert.equal(await page.evaluate(()=>window.fixture.laborEarned),10);
 assert.equal(await page.evaluate(()=>window.fixture.laborWorkButton===document.querySelector('[data-ref="context-body"] [data-command="work"]')),true);
 assert.equal(await page.evaluate(()=>window.fixture.laborPurchaseButton===document.querySelector('[data-ref="context-body"] [data-command="purchase"]')),true);
 assert(Math.abs(await page.evaluate(()=>window.fixture.simulation.state.player.money-window.fixture.laborCash-window.fixture.laborNet))<1e-7);
 await page.evaluate(()=>{const f=window.fixture;f.at('home');for(let i=0;i<20;i++)f.simulation.step(.25);f.ui.update(f.simulation.state,f.view);});
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.playerLabor.job.workedMinutes),10);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.playerLabor.job.status),'paused');
 await page.getByTestId('panel-toggle').click();await page.getByRole('tab',{name:'生活',exact:true}).click();
 assert.match(await page.locator('[data-ref="player-labor"]').innerText(),/離開|离开原工作场所/);
 assert.match(await page.locator('[data-ref="player-labor"]').innerText(),/已实际到手净薪 \/ 已实际缴税/);
 await page.locator('[data-ref="player-labor"] [data-command="cancelWork"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.playerLabor.job),null);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.playerLabor.history.at(-1).status),'cancelled');
 assert(await page.evaluate(()=>window.fixture.simulation.state.playerLabor.history.at(-1).refundedGross)>0);
 results.push('Native work and purchase controls stay connected while actual wages accrue; leaving pauses work and cancel returns unearned escrow');
 await page.evaluate(()=>{const f=window.fixture;f.atPoint('market','work');f.laborCompletedCash=f.simulation.state.player.money;f.laborCompletedWorkButton=document.querySelector('[data-ref="context-body"] [data-command="work"]');});
 await page.locator('[data-ref="context-body"] [data-command="work"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.commandResults.at(-1).result.ok),true);
 await page.evaluate(()=>{const f=window.fixture;for(let i=0;i<240;i++){f.simulation.step(.25);if(i%10===0)f.ui.update(f.simulation.state,f.view);}f.ui.update(f.simulation.state,f.view);});
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.playerLabor.job),null);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.playerLabor.history.at(-1).workedMinutes),60);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.playerLabor.history.at(-1).status),'completed');
 assert.equal(await page.evaluate(()=>window.fixture.laborCompletedWorkButton===document.querySelector('[data-ref="context-body"] [data-command="work"]')),true);
 assert(Math.abs(await page.evaluate(()=>window.fixture.simulation.state.player.money-window.fixture.laborCompletedCash-window.fixture.simulation.state.playerLabor.history.at(-1).paidNet))<1e-7);
 await page.waitForFunction(()=>document.querySelector('[data-ref="player-labor"]')?.textContent.includes('工班已完成'));
 assert.match(await page.locator('[data-ref="player-labor"]').innerText(),/工班已完成/);
 await page.getByRole('button',{name:'收起城市手册'}).click();
 results.push('A native new shift pays only after 60 actual Simulation minutes and displays the completed net-wage receipt');

 // Controlled injury and an existing physician's on-site availability exercise
 // native clinical controls. Funds, purchases, attendance and progress are real
 // Simulation effects; this DOM fixture is not an ordinary player journey.
 await page.evaluate(()=>{
   const f=window.fixture,s=f.simulation.state;
   f.atPoint('clinic','service');s.extension.actorProfiles.player.health=60;f.ui.update(s,f.view);
   if(!document.querySelector('[data-ref="context-body"] [data-command="heal"]').disabled)throw Error('Unstaffed actual first clinic must not promise a treatment');
   const site=f.world.buildings.find(site=>site.kind==='clinic'&&s.citizens.some(doctor=>doctor.workId===site.id&&['医生','doctor'].includes(doctor.role)&&s.extension.actorProfiles[doctor.id].alive&&s.extension.actorProfiles[doctor.id].age>=18));
   if(!site)throw Error('No genuinely staffed clinic in generated city');
   f.clinicalSiteId=site.id;
   f.atClinical=()=>{f.atPoint(site,'service');f.simulation.setFocus(s.player.position,'walk');f.ui.update(s,f.view);};
   f.atClinical();f.clinicalCash=s.player.money;f.clinicalHealth=s.extension.actorProfiles.player.health;f.clinicalContextButton=document.querySelector('[data-ref="context-body"] [data-command="heal"]');
 });
 await page.locator('[data-ref="context-body"] [data-command="heal"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.commandResults.at(-1).result.ok),true);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.money),await page.evaluate(()=>window.fixture.clinicalCash-30));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.extension.actorProfiles.player.health),await page.evaluate(()=>window.fixture.clinicalHealth));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.clinical.orders.at(-1).workedMinutes),0);
 assert.equal(await page.evaluate(()=>window.fixture.clinicalContextButton===document.querySelector('[data-ref="context-body"] [data-command="heal"]')),true);
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="heal"]').isDisabled(),true);
 await page.getByTestId('panel-toggle').click();await page.getByRole('tab',{name:'生活',exact:true}).click();
 await page.evaluate(()=>{const f=window.fixture;for(let i=0;i<8;i++)f.simulation.step(.25);f.ui.update(f.simulation.state,f.view);f.clinicalPurchase=f.simulation.state.clinical.orders.at(-1).purchasePaid;f.clinicalBeforeCancelCash=f.simulation.state.player.money;});
 assert(await page.evaluate(()=>window.fixture.clinicalPurchase)>0);
 await page.waitForFunction(()=>document.querySelector('[data-ref="clinical-orders"]')?.textContent.includes('实际采购回执'));
 assert.match(await page.locator('[data-ref="clinical-orders"]').innerText(),/剩余托管款 \/ 已实付材料/);
 assert.match(await page.locator('[data-ref="clinical-orders"]').innerText(),/实际采购回执/);
 await page.screenshot({path:fileURLToPath(new URL('ui-clinical-purchase.png',artifactsDir))});
 await page.locator('[data-ref="clinical-orders"] [data-command="cancelTreatment"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.clinical.orders.at(-1).state),'cancelled');
 assert(Math.abs(await page.evaluate(()=>window.fixture.simulation.state.player.money-window.fixture.clinicalBeforeCancelCash-(30-window.fixture.clinicalPurchase)))<1e-7);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.clinical.stock[window.fixture.view.nearbyBuilding.id].availableUnits),1);
 await page.waitForFunction(()=>document.querySelector('[data-ref="clinical-orders"]')?.textContent.includes('诊疗已取消'));
 assert.match(await page.locator('[data-ref="clinical-orders"]').innerText(),/诊疗已取消/);
 results.push('Native clinical registration escrows real coins without healing; purchased material receipt stays visible and cancellation refunds only unused funds');

 await page.evaluate(()=>{
   const f=window.fixture,s=f.simulation.state,site=f.view.nearbyBuilding;
   const doctor=s.citizens.find(c=>c.workId===site.id&&['医生','doctor'].includes(c.role)&&s.extension.actorProfiles[c.id].alive&&s.extension.actorProfiles[c.id].age>=18);
   if(!doctor)throw Error('Real clinic has no employed adult physician fixture');
   f.clinicalDoctorId=doctor.id;f.clinicalPinActive=true;
   const runtime=Reflect.get(f.simulation,'runtime');
   const doctorPermission={role:'traveler',identities:['traveler']}; // The clinical model normalizes the existing 医生 role this way on public floors.
   // A controlled physician position follows his already planned real work
   // point. Repeatedly pinning ground while clearing routes prevents arrival
   // when the v4 planner has selected another lawful public clinical floor.
   const plannedWorkPosition=doctor.route?.at(-1);
   const plannedWorkPoint=site.floorPlanProfile==='v4-program-bodies-02'&&plannedWorkPosition?site.functionPoints?.find(point=>point.purpose==='work'&&Math.hypot(point.position.x-plannedWorkPosition.x,point.position.y-plannedWorkPosition.y,point.position.z-plannedWorkPosition.z)<1e-8):null;
   if(site.floorPlanProfile==='v4-program-bodies-02'&&(!plannedWorkPoint||!f.canAccessFloor(site,plannedWorkPoint.floor,doctorPermission)||!f.simulation.isAtBuildingFunctionPoint(site,plannedWorkPosition,'work',doctorPermission)))throw Error('Existing physician route lacks an accessible actual work point');
   const doctorWorkPosition=plannedWorkPoint?{...plannedWorkPosition}:f.fixturePoint(site,'work',doctorPermission);
   if(plannedWorkPoint)console.log('CLINICAL_EXISTING_WORK_TARGET',JSON.stringify({doctorId:doctor.id,siteId:site.id,pointId:plannedWorkPoint.id,floor:plannedWorkPoint.floor,position:doctorWorkPosition,canAccess:f.canAccessFloor(site,plannedWorkPoint.floor,doctorPermission),clinicalAtPosition:f.clinicalAtPosition(site,doctorWorkPosition,doctorPermission),patientClinicalAtPosition:f.clinicalAtPosition(site,s.player.position,s.player)}));
   if(!f.clinicalAtPosition(site,doctorWorkPosition,doctorPermission))throw Error('Actual doctor work point is outside the public clinical service area');
   const place=()=>{if(!f.clinicalPinActive)return;doctor.position={...doctorWorkPosition};doctor.destinationId=site.id;doctor.route=[];doctor.routeIndex=0;runtime.activities[doctor.id]='work';runtime.decisionAt[doctor.id]=s.day*1440+s.hour*60+10;};
   doctor.needs={hunger:100,fatigue:100,social:100,fun:100};place();f.simulation.onPhase('traffic',place);
   for(let i=0;i<16;i++)f.simulation.step(.25);
   if(!f.simulation.isOnDuty(doctor.id,site.id))throw Error('Doctor has not accrued actual attendance');
   f.ui.update(s,f.view);f.clinicalHealButton=document.querySelector('[data-ref="health-actions"] [data-command="heal"]');
 });
 await page.locator('[data-ref="health-actions"] [data-command="heal"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.commandResults.at(-1).result.ok),true);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.clinical.orders.at(-1).reusedUnits),1);
 await page.evaluate(()=>{const f=window.fixture;for(let i=0;i<24;i++)f.simulation.step(.25);f.clinicalMinutes=f.simulation.state.clinical.orders.at(-1).workedMinutes;f.ui.update(f.simulation.state,f.view);});
 assert(await page.evaluate(()=>window.fixture.clinicalMinutes)>0);assert(await page.evaluate(()=>window.fixture.clinicalMinutes)<20);
 await page.waitForFunction(()=>document.querySelector('[data-ref="health-actions"] [data-command="heal"]')?.disabled && document.querySelector('[data-ref="clinical-orders"]')?.textContent.includes('真实出勤医生'));
 assert.equal(await page.evaluate(()=>window.fixture.clinicalHealButton===document.querySelector('[data-ref="health-actions"] [data-command="heal"]')),true);
 assert.equal(await page.locator('[data-ref="health-actions"] [data-command="heal"]').isDisabled(),true);
 assert.match(await page.locator('[data-ref="clinical-orders"]').innerText(),/真实出勤医生/);
 await page.evaluate(()=>{const f=window.fixture;f.at('home');f.simulation.setFocus(f.simulation.state.player.position,'walk');for(let i=0;i<16;i++)f.simulation.step(.25);f.ui.update(f.simulation.state,f.view);});
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.clinical.orders.at(-1).workedMinutes),await page.evaluate(()=>window.fixture.clinicalMinutes));
 await page.waitForFunction(()=>document.querySelector('[data-ref="clinical-orders"]')?.textContent.includes('患者在场'));
 assert.match(await page.locator('[data-ref="clinical-orders"]').innerText(),/患者在场/);
 await page.evaluate(()=>{const f=window.fixture;f.atClinical();const order=f.simulation.state.clinical.orders.at(-1);for(let i=0;i<100&&order.state!=='completed';i++){f.clinicalHealthBeforeCompletion=f.simulation.state.extension.actorProfiles.player.health;f.simulation.step(.25);}f.ui.update(f.simulation.state,f.view);f.clinicalPinActive=false;});
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.clinical.orders.at(-1).state),'completed');
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.clinical.orders.at(-1).workedMinutes),20);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.clinical.orders.at(-1).consumedUnits),1);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.clinical.orders.at(-1).escrow),0);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.clinical.orders.at(-1).purchasePaid),0);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.clinical.orders.at(-1).serviceFee),30);
 assert(await page.evaluate(()=>window.fixture.simulation.state.extension.actorProfiles.player.health-window.fixture.clinicalHealthBeforeCompletion)>24.8);
 await page.waitForFunction(()=>document.querySelector('[data-ref="clinical-orders"]')?.textContent.includes('诊疗已完成'));
 assert.match(await page.locator('[data-ref="clinical-orders"]').innerText(),/诊疗已完成/);
 assert.equal(await page.locator('[data-ref="health-actions"] [data-command="heal"]').isDisabled(),true);
 await page.screenshot({path:fileURLToPath(new URL('ui-clinical-completed.png',artifactsDir))});
 await page.getByRole('button',{name:'收起城市手册'}).click();
 results.push('Native reused-material care records actual doctor attendance, pauses away, completes after twenty on-site minutes, and retains the same heal DOM control');

 await page.evaluate(()=>{const f=window.fixture;f.atShop('workshop');const s=f.simulation.state,shop=s.shops.find(shop=>shop.buildingId===f.view.nearbyBuilding.id);f.materialBefore={cash:s.player.money,food:s.player.inventory.food,material:s.player.inventory.material??0,hunger:s.player.needs.hunger,stock:shop.inventory,price:shop.price};});
 assert.match(await page.locator('[data-ref="context-body"] [data-command="purchase"]').innerText(),/工业物料/);
 await page.locator('[data-ref="context-body"] [data-command="purchase"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.commandResults.at(-1).result.ok),true);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.inventory.material),await page.evaluate(()=>window.fixture.materialBefore.material+1));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.inventory.food),await page.evaluate(()=>window.fixture.materialBefore.food));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.needs.hunger),await page.evaluate(()=>window.fixture.materialBefore.hunger));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.shops.find(shop=>shop.buildingId===window.fixture.view.nearbyBuilding.id).inventory),await page.evaluate(()=>window.fixture.materialBefore.stock-1));
 assert(Math.abs(await page.evaluate(()=>window.fixture.simulation.state.player.money-window.fixture.materialBefore.cash+window.fixture.materialBefore.price))<1e-7);
 results.push('Native workshop purchase transfers one real industrial material and its quoted cash without creating food or feeding the player');

 await page.evaluate(()=>{const f=window.fixture;f.atShop('market',2);const s=f.simulation.state,shop=s.shops.find(shop=>shop.buildingId===f.view.nearbyBuilding.id);f.carriedMealBefore={cash:s.player.money,food:s.player.inventory.food??0,stock:shop.inventory,price:shop.price};});
 await page.locator('[data-ref="context-body"] [data-action="purchase-carry"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.commandResults.at(-1).result.ok),true);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.inventory.food),await page.evaluate(()=>window.fixture.carriedMealBefore.food+1));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.shops.find(shop=>shop.buildingId===window.fixture.view.nearbyBuilding.id).inventory),await page.evaluate(()=>window.fixture.carriedMealBefore.stock-2));
 assert(Math.abs(await page.evaluate(()=>window.fixture.simulation.state.player.money-window.fixture.carriedMealBefore.cash+2*window.fixture.carriedMealBefore.price))<1e-7);
 await page.evaluate(()=>{const f=window.fixture;f.at('home');f.carriedMealCash=f.simulation.state.player.money;f.carriedMealHunger=f.simulation.state.player.needs.hunger;});
 await page.getByTestId('panel-toggle').click();await page.getByRole('tab',{name:'生活',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('[data-ref="cooking-actions"] [data-command="eat"][data-target="food"]')?.disabled);
 await page.evaluate(()=>window.fixture.carriedMealButton=document.querySelector('[data-ref="cooking-actions"] [data-command="eat"][data-target="food"]'));
 await page.locator('[data-ref="cooking-actions"] [data-command="eat"][data-target="food"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.commandResults.at(-1).result.ok),true);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.inventory.food),await page.evaluate(()=>window.fixture.carriedMealBefore.food));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.money),await page.evaluate(()=>window.fixture.carriedMealCash));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.needs.hunger),await page.evaluate(()=>Math.min(100,window.fixture.carriedMealHunger+52)));
 await page.waitForFunction(()=>{const f=window.fixture,button=document.querySelector('[data-ref="cooking-actions"] [data-command="eat"][data-target="food"]');return button?.disabled===((f.simulation.state.player.inventory.food??0)<1)});
 assert.equal(await page.evaluate(()=>window.fixture.carriedMealButton===document.querySelector('[data-ref="cooking-actions"] [data-command="eat"][data-target="food"]')),true);
 await page.getByRole('button',{name:'收起城市手册'}).click();
 results.push('Native carried-food purchase pays for two real portions, eats one at the shop, then consumes the retained portion away without charging again or replacing its DOM control');


 await page.evaluate(()=>{const f=window.fixture;f.view.nearbyBuilding=null;f.view.nearbyVehicle={...f.simulation.state.vehicles[0],state:'waiting',passengers:1,cargo:5,speed:2};f.ui.update(f.simulation.state,f.view)});
 await page.evaluate(()=>{const f=window.fixture;f.view.nearbyVehicle.state='moving';f.view.nearbyVehicle.passengers=9;f.view.nearbyVehicle.cargo=60;f.view.nearbyVehicle.speed=30;f.ui.update(f.simulation.state,f.view)});
 const vehicle=await page.locator('[data-ref="context-body"]').innerText();assert.match(vehicle,/行进中/);assert.match(vehicle,/9 位乘客/);assert.match(vehicle,/货物 60/);assert.match(vehicle,/30 m/);results.push('Vehicle state, passengers, cargo, speed stay live');
 await page.evaluate(()=>{const f=window.fixture;f.atPoint('market','work');f.simulation.state.player.identities=['traveler','merchant'];f.simulation.state.player.role='traveler';f.simulation.state.player.money=3000;f.ui.update(f.simulation.state,f.view)});
 await page.getByTestId('panel-toggle').click();
 await page.getByRole('tab',{name:'产业',exact:true}).click();
 assert.equal(await page.locator('[data-ref="found-company"]').isEnabled(),true);
 await page.locator('[data-ref="found-company"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.extension.companies.filter(c=>c.ownerId==='player').length),1);results.push('Merchant identity stack enables company founding with real cash/ownership changes');
 await page.getByRole('tab',{name:'生活',exact:true}).click();
 await page.evaluate(()=>{const f=window.fixture;f.simulation.state.player.education=3;f.simulation.state.player.identities.push('scientist');f.atPoint('school','work');f.ui.update(f.simulation.state,f.view)});
 await page.locator('[data-ref="career"]').selectOption('7');
 assert.match(await page.locator('[data-ref="career-note"]').innerText(),/教育至少 3/);results.push('Scientist qualification displays the correct requirement');
 await page.evaluate(()=>{const f=window.fixture;f.atPoint('market','work');const s=f.simulation.state.shops.find(s=>s.buildingId===f.view.nearbyBuilding.id);f.simulation.state.player.inventory['ingredient:grain']=2;f.simulation.state.player.inventory['ingredient:vegetable']=1;f.ui.update(f.simulation.state,f.view)});
 await page.locator('[data-ref="cook-button"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.extension.cooking.recipeId),'rice');assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.inventory['ingredient:grain']),0);results.push('Cooking command consumes actual ingredients and starts a persistent job');
 // Controlled relationship starting states exercise the DOM/command contract;
 // the simulation suite independently verifies naturally elapsed stage timing.
 await page.evaluate(()=>{
   const f=window.fixture,s=f.simulation.state,c=s.citizens.find(c=>!c.partnerId&&s.extension.actorProfiles[c.id].alive);
   f.romanceNpcId=c.id;s.player.partnerId=null;s.player.position={...c.position};f.view.position={...c.position};
   f.view.nearbyBuilding=null;f.view.nearbyVehicle=null;f.view.nearbyCitizen=c;
   s.relationships.push({npcId:c.id,type:'closeFriend',affection:90,trust:90,encounters:8,memories:[],tags:[],romanceStage:'single',hostilityStage:'none',romanceSince:s.extension.lastUpdate,hostilitySince:s.extension.lastUpdate,conflicts:0,reconciliations:0,consent:false});
   f.ui.update(s,f.view);
 });
 await page.locator('[data-ref="context-body"] summary').first().click();
 await page.locator('[data-ref="context-body"] [data-command="court"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.relationships.find(r=>r.npcId===window.fixture.romanceNpcId).romanceStage),'pursuit');
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="court"]').innerText(),'确认交往');
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="court"]').isDisabled(),true);
 assert.match(await page.locator('[data-ref="context-body"]').innerText(),/还需 60 分钟/);
 results.push('Actual court command starts pursuit and UI prevents immediate dating');
 await page.evaluate(()=>{
   const f=window.fixture,s=f.simulation.state,r=s.relationships.find(r=>r.npcId===f.romanceNpcId),c=f.view.nearbyCitizen;
   r.type='lover';r.romanceStage='engaged';r.romanceSince=s.extension.lastUpdate-60;r.encounters=10;r.consent=true;
   s.player.homeId=f.world.buildings.find(b=>b.kind==='home').id;s.player.partnerId=c.id;c.partnerId='player';f.marriagePriorHome=c.homeId;f.marriagePriorPosition={...c.position};f.ui.update(s,f.view);
 });
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="propose"]').innerText(),'办理婚姻');
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="propose"]').isDisabled(),true);
 await page.evaluate(()=>{const f=window.fixture;f.simulation.state.relationships.find(r=>r.npcId===f.romanceNpcId).romanceSince=f.simulation.state.extension.lastUpdate-120;f.ui.update(f.simulation.state,f.view)});
 await page.locator('[data-ref="context-body"] [data-command="propose"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.relationships.find(r=>r.npcId===window.fixture.romanceNpcId).romanceStage),'married');
 assert.equal(await page.evaluate(()=>window.fixture.view.nearbyCitizen.homeId),await page.evaluate(()=>window.fixture.marriagePriorHome));
 assert.deepEqual(await page.evaluate(()=>window.fixture.view.nearbyCitizen.position),await page.evaluate(()=>window.fixture.marriagePriorPosition));
 results.push('Engagement UI enforces waiting and registers marriage while actual position and residence await a separate household agreement');
 await page.evaluate(()=>{
   const f=window.fixture,s=f.simulation.state,r=s.relationships.find(r=>r.npcId===f.romanceNpcId);
   r.type='enemy';r.romanceStage='single';r.hostilityStage='mortalEnemy';r.hostilitySince=s.extension.lastUpdate-200;r.affection=-95;r.trust=-85;r.conflicts=6;r.reconciliations=0;
   s.player.partnerId=null;f.view.nearbyCitizen.partnerId=null;f.beforeReconcile=s.player.money;f.ui.update(s,f.view);
 });
 assert.match(await page.locator('[data-ref="context-body"]').innerText(),/死敌/);
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="socialize"]').isDisabled(),true);
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="reconcile"]').innerText(),'诚意调解 · 65');
 await page.locator('[data-ref="context-body"] [data-command="reconcile"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.beforeReconcile-window.fixture.simulation.state.player.money),65);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.relationships.find(r=>r.npcId===window.fixture.romanceNpcId).hostilityStage),'mortalEnemy');
 results.push('Severe hostility blocks small talk and pays real 65-coin compensation without instant repair');
 await page.evaluate(()=>window.fixture.at('market'));
 await page.evaluate(()=>{const f=window.fixture;const b={...f.view.nearbyBuilding,name:'<img src=x onerror=alert(1)>'};f.view.nearbyBuilding=b;f.ui.update(f.simulation.state,f.view)});
 assert.equal(await page.locator('[data-ref="context-body"] img').count(),0);assert.match(await page.locator('[data-ref="context-body"]').innerText(),/<img/);results.push('Imported entity strings remain text, never DOM markup');
 await page.evaluate(()=>{const f=window.fixture;f.atPoint('school','work');f.beforeCultureCash=f.simulation.state.player.money});
 await page.getByRole('tab',{name:'生活',exact:true}).click();
 await page.locator('[data-ref="work-title"]').fill('清溪行记');
 await page.locator('[data-ref="work-text"]').fill('从清溪沿石阶走进书院，城中的人们在灯火和晨雾之间开始各自的生活。');
 await page.locator('[data-ref="create-work"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.beforeCultureCash-window.fixture.simulation.state.player.money),60);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.culture.project.title),'清溪行记');
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.culture.project.workedMinutes),0);
 results.push('Culture form creates a paid persistent project and requires actual time on site');
 await page.evaluate(()=>window.fixture.atPoint('hall','service'));
 await page.getByRole('tab',{name:'城市',exact:true}).click();
 await page.locator('[data-ref="report-text"]').fill('今日沿清溪走到公共大厅，记录水质的现场观测，供城中居民查阅并共同核验。');
 await page.locator('[data-ref="publish-report"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.culture.reports[0].status),'unchecked');
 await page.locator('[data-ref="culture-reports"] [data-command="verifyReport"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.culture.reports[0].status),'verified');
 await page.locator('[data-ref="petition-title"]').fill('书院公共开放时间');
 await page.locator('[data-ref="petition-text"]').fill('希望公共书院在晚间保留阅读空间，便于白天工作的居民到场学习与交流。');
 await page.locator('[data-ref="file-petition"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.culture.petitions[0].status),'open');
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.culture.petitions[0].replyAt-window.fixture.simulation.state.culture.lastUpdate),1440);
 results.push('Public information UI records evidence, verifies it and files a genuinely delayed civic reply');
 await page.evaluate(()=>{const f=window.fixture;f.atShop('market',4);const s=f.simulation.state,shop=s.shops.find(shop=>shop.buildingId===f.view.nearbyBuilding.id);f.ceremonyRetailBefore={cash:s.player.money,food:s.player.inventory.food,hunger:s.player.needs.hunger,stock:shop.inventory,price:shop.price};});
 await page.locator('[data-ref="context-body"] [data-action="purchase-carry"]').click();
 await page.locator('[data-ref="context-body"] [data-action="purchase-carry"]').click();
 console.log('CEREMONY_PURCHASES',JSON.stringify(await page.evaluate(()=>({last:window.fixture.commandResults.slice(-2),food:window.fixture.simulation.state.player.inventory.food,quote:(()=>{const f=window.fixture,shop=f.simulation.state.shops.find(s=>s.buildingId===f.view.nearbyBuilding.id);try{return f.quoteConsignmentSale(f.simulation,shop.id,1,shop.inventory)}catch(e){return {error:e.message,inventory:shop.inventory,lots:f.simulation.state.trade.lots[shop.id]}}})()}))));
 assert.equal(await page.evaluate(()=>window.fixture.commandResults.slice(-2).every(row=>row.command.type==='purchase'&&row.result.ok)),true);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.inventory.food),await page.evaluate(()=>window.fixture.ceremonyRetailBefore.food+2));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.shops.find(shop=>shop.buildingId===window.fixture.view.nearbyBuilding.id).inventory),await page.evaluate(()=>window.fixture.ceremonyRetailBefore.stock-4));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.needs.hunger),await page.evaluate(()=>Math.min(100,window.fixture.ceremonyRetailBefore.hunger+104)));
 assert(Math.abs(await page.evaluate(()=>window.fixture.simulation.state.player.money-window.fixture.ceremonyRetailBefore.cash+4*window.fixture.ceremonyRetailBefore.price))<1e-7);
 await page.evaluate(()=>{const f=window.fixture,s=f.simulation.state,b=f.world.buildings.find(b=>b.kind==='pavilion'),spouse=s.citizens.find(c=>c.id===f.romanceNpcId);s.player.partnerId=spouse.id;spouse.partnerId='player';const rel=s.relationships.find(r=>r.npcId===spouse.id);rel.consent=true;rel.romanceStage='married';rel.type='spouse';s.player.position={...b.door};spouse.position={...b.door};f.view.position={...b.door};f.view.nearbyBuilding=b;f.view.nearbyCitizen=null;f.view.inside=false;f.ceremonyCash=s.player.money;f.ceremonyFood=s.player.inventory.food;f.ui.update(s,f.view);});
 await page.getByRole('tab',{name:'生活',exact:true}).click();
 console.log('CEREMONY_PRECONDITIONS',JSON.stringify(await page.evaluate(()=>{const f=window.fixture,s=f.simulation.state;return {food:s.player.inventory.food,money:s.player.money,mode:f.view.mode,aircraft:s.aviation.activeAircraftId,alive:s.extension.actorProfiles.player.alive,building:f.view.nearbyBuilding,position:s.player.position,partner:s.player.partnerId};})));
 assert.equal(await page.locator('[data-ref="family-life"] [data-command="holdCeremony"][data-target="wedding"]').isEnabled(),true);
 await page.locator('[data-ref="family-life"] [data-command="holdCeremony"][data-target="wedding"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.money),await page.evaluate(()=>window.fixture.ceremonyCash-30));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.inventory.food),await page.evaluate(()=>window.fixture.ceremonyFood-2));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.family.ceremonies.find(c=>c.organizerId==='player').workedMinutes),0);
 await page.waitForFunction(()=>document.querySelector('[data-ref="family-life"]')?.textContent.includes('0 / 30 分钟现场筹办'));
 assert.match(await page.locator('[data-ref="family-life"]').innerText(),/0 \/ 30 分钟现场筹办/);results.push('Family ceremony native UI pays actual cash and food while preserving the unfinished 30-minute attendance job');

 await page.evaluate(()=>{const f=window.fixture,c=f.simulation.state.aviation.aircraft.find(c=>c.kind==='drone');f.aircraftId=c.id;f.beforeAircraftCash=f.simulation.state.player.money;f.simulation.state.player.position={...c.position,x:c.position.x+2,y:c.position.y-.6};f.view.position={...f.simulation.state.player.position};f.view.nearbyAircraft=c;f.view.nearbyBuilding=null;f.view.nearbyCitizen=null;f.view.nearbyVehicle=null;f.view.mode='walk';f.ui.update(f.simulation.state,f.view)});
 assert.match(await page.locator('[data-ref="context-body"]').innerText(),/旅行者现场租用/);
 await page.locator('[data-ref="context-body"] [data-command="rentAircraft"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.beforeAircraftCash-window.fixture.simulation.state.player.money),24);
 await page.locator('[data-ref="context-body"] [data-command="boardAircraft"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.aviation.activeAircraftId),await page.evaluate(()=>window.fixture.aircraftId));
 results.push('Actual city drone UI rents with cash and boards the nearby aircraft');
 await page.evaluate(()=>{const f=window.fixture;f.setAircraftControls(f.simulation.state,{forward:0,strafe:0,climb:1,yaw:0,pitch:0,speed:85,boost:false});f.simulation.step(.25);f.view.position={...f.simulation.state.player.position};f.ui.update(f.simulation.state,f.view)});
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="leaveAircraft"]').isDisabled(),true);
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="landAircraft"]').isEnabled(),true);
 await page.locator('[data-ref="context-body"] [data-command="landAircraft"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.aviation.aircraft.find(c=>c.id===window.fixture.aircraftId).status),'landing');
 results.push('Airborne UI prevents exit and requests a real approach through the simulation');
 await page.getByRole('button',{name:'收起城市手册'}).click();
 await page.setViewportSize({width:600,height:360});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const context=await page.locator('[data-ref="context"]').boundingBox();assert.ok(context.height>120);results.push('600x360 landscape keeps context usable without horizontal overflow');
 await page.screenshot({path:fileURLToPath(new URL('ui-landscape.png',artifactsDir))});
 await page.setViewportSize({width:390,height:844});await page.getByTestId('panel-toggle').click();await page.getByRole('tab',{name:'设置',exact:true}).click();await page.screenshot({path:fileURLToPath(new URL('ui-mobile.png',artifactsDir))});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);results.push('390x844 portrait panel has no horizontal overflow');
 assert.deepEqual(errors,[]);
 console.log(`${results.length} UI integration checks passed, no browser errors.`);
} catch (error) {
 failure = error instanceof Error ? error.stack ?? error.message : String(error);
 console.error(failure);
 process.exitCode = 1;
} finally {
 await writeFile(new URL('ui-results.json', artifactsDir), JSON.stringify({ status: failure ? 'failed' : 'passed', browser: 'Chromium', scope: 'DOM with the real generated world and Simulation; no renderer or macOS performance claim.', checks: results.length, results, errors, ...(failure ? { failure } : {}) }, null, 2)).catch(error => { console.error(error); process.exitCode = 1; });
 try { await browser?.close(); } finally { await server?.close(); }
}
