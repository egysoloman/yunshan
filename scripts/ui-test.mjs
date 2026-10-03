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
// BEGIN readonly UI failure diagnostic reference
let diagnosticPage;
// END readonly UI failure diagnostic reference
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
// BEGIN home-rest derived fixture imports
import {homeRestPoints,homeRestPointAt} from '/src/simulation/home-rest.ts';
// END home-rest derived fixture imports
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
// Controlled existing business entitlement, adapted from
// tests/extensions.test.ts:declareExistingCorporateFixtureEntitlement.
// This is a corporate UI opening condition, not a natural market purchase.
window.fixture.declareExistingCorporateFixtureEntitlement=(shop,ownerId)=>{
  const sim=simulation,s=sim.state,e=s.extension,r=Reflect.get(sim,'runtime');
  const assert={ok(value,message){if(!value)throw Error(message)},equal(actual,expected,message){if(actual!==expected)throw Error(message)}};
  assert.equal(shop.lifecycleVersion,undefined,'managed shops keep their separate entity obligations');
  assert.ok(!s.shopLifecycle?.titles?.[shop.id],'opening shop must have no lifecycle title');
  assert.ok(!s.shopLifecycle?.leases.some(lease=>lease.shopId===shop.id),'opening shop must have no lease or residual deposit obligation');
  assert.ok(!e.companies.some(company=>company.buildingId===shop.buildingId),'opening shop must not already be incorporated');
  const priorId=shop.ownerId,prior=priorId==='player'?s.player:s.citizens.find(person=>person.id===priorId);
  assert.ok(prior,'the actual original holder receives only their unprotected opening capital');
  const cash=()=>s.treasury+r.taxes+s.player.money+s.citizens.reduce((sum,person)=>sum+person.money,0)
    +s.shops.filter(item=>!e.companies.some(company=>company.buildingId===item.buildingId)).reduce((sum,item)=>sum+(item.cash??0),0)
    +e.companies.reduce((sum,company)=>sum+company.capital,0)+e.organizations.reduce((sum,organization)=>sum+organization.funds,0)
    +(s.banking?s.banking.cash+s.banking.legacyInvestmentCash:s.bankBalance+r.investment)
    +(s.playerLabor?.job?.escrow??0)+(s.education?.course?.escrow??0)+(s.clinical?.orders.reduce((sum,order)=>sum+order.escrow,0)??0)
    +(s.power?.repairs.reduce((sum,job)=>sum+job.escrow,0)??0)+(s.shopLifecycle?.leases.reduce((sum,lease)=>sum+lease.depositEscrow,0)??0)
    +(s.hygiene?.jobs.reduce((sum,job)=>sum+job.escrow,0)??0)+(s.roadworks?.jobs.reduce((sum,job)=>sum+job.escrow,0)??0)
    +(s.family?.pregnancies.reduce((sum,pregnancy)=>sum+pregnancy.escrow,0)??0)+(s.family?.households.reduce((sum,household)=>sum+household.balance,0)??0);
  const books=()=>JSON.stringify({inventory:shop.inventory,employees:shop.employees,open:shop.open,profit:shop.profit,revenue:shop.revenue,trade:s.trade,
    wages:r.wages,wageArrears:r.wageArrears,wageAccruals:r.wageAccruals,privateLabor:r.privateLabor,publicLabor:r.publicLabor,publicBudgets:r.publicBudgets,publicLedger:e.publicLedger});
  const beforeCash=cash(),beforeBooks=books(),protectedCash=sim.shopProtectedFunds(shop),returned=Math.max(0,sim.shopFunds(shop)-protectedCash),priorCash=prior.money,playerCash=s.player.money,shopCash=sim.shopFunds(shop);
  assert.ok(prior.money+returned<=1e9,'opening capital must fit the original holder without clipping');
  sim.transferShopFunds(shop,-returned);prior.money+=returned;
  assert.equal(shop.ownerId,priorId,"return the original holder's real capital before declaring existing entitlement");
  assert.equal(sim.transferBusinessOwnership(shop.id,ownerId),true,'core authority must accept this unmarked opening entitlement');
  assert.ok(Math.abs(cash()-beforeCash)<1e-8,'opening fixture conserves all actual cash including escrows');
  assert.equal(books(),beforeBooks,'all original goods, purchase costs, profits, wages and promised shifts survive');
  assert.equal(sim.shopProtectedFunds(shop),protectedCash,'all earned and promised wage claims remain protected');
  assert.equal(s.player.money,playerCash,'existing entitlement does not fund the player wallet');
  return {kind:'controlled-existing-business-entitlement',naturalPurchase:false,shopId:shop.id,priorId,ownerId,returned,priorCashBefore:priorCash,priorCashAfter:prior.money,playerCashBefore:playerCash,playerCashAfter:s.player.money,shopCashBefore:shopCash,shopCashAfter:sim.shopFunds(shop),totalCashBefore:beforeCash,totalCashAfter:cash(),protectedCashBefore:protectedCash,protectedCashAfter:sim.shopProtectedFunds(shop),booksPreserved:books()===beforeBooks};
};
// BEGIN home-rest controlled positioning helpers
window.fixture.homeRestPoints=homeRestPoints;window.fixture.homeRestPointAt=homeRestPointAt;
window.fixture.placeHomeRest=(site,position)=>{const before=commands.length;view.mode='walk';view.inside=true;view.nearbyBuilding=site;view.nearbyCitizen=null;view.nearbyVehicle=null;simulation.state.player.position={...position};view.position={...position};ui.update(simulation.state,view);if(commands.length!==before)throw Error('Home rest fixture positioning issued a command');};
// END home-rest controlled positioning helpers
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
  // BEGIN readonly UI failure diagnostic page
  diagnosticPage=page;
  // END readonly UI failure diagnostic page
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
 // Preserve the real unowned-market refusal before declaring this controlled opening.
 assert.equal(await page.locator('[data-ref="found-company"]').isEnabled(),false);
 await page.evaluate(()=>{const f=window.fixture,s=f.simulation.state,shop=s.shops.find(shop=>shop.buildingId===f.view.nearbyBuilding.id);f.corporateRejected={cash:s.player.money,commands:f.commands.length,results:f.commandResults.length,save:f.simulation.exportSave(),shopId:shop.id,ownerId:shop.ownerId,lifecycleVersion:shop.lifecycleVersion,title:s.shopLifecycle?.titles?.[shop.id],leases:s.shopLifecycle?.leases.filter(lease=>lease.shopId===shop.id)??[]};document.querySelector('[data-ref="found-company"]').click();});
 assert.notEqual(await page.evaluate(()=>window.fixture.corporateRejected.ownerId),'player');
 assert.equal(await page.evaluate(()=>window.fixture.corporateRejected.lifecycleVersion),undefined);
 assert.equal(await page.evaluate(()=>window.fixture.corporateRejected.title),undefined);
 assert.deepEqual(await page.evaluate(()=>window.fixture.corporateRejected.leases),[]);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.money),await page.evaluate(()=>window.fixture.corporateRejected.cash));
 assert.equal(await page.evaluate(()=>window.fixture.commands.length),await page.evaluate(()=>window.fixture.corporateRejected.commands));
 assert.equal(await page.evaluate(()=>window.fixture.commandResults.length),await page.evaluate(()=>window.fixture.corporateRejected.results));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.exportSave()),await page.evaluate(()=>window.fixture.corporateRejected.save),'disabled native control cannot spend or call the company command');
 const corporateOpening=await page.evaluate(()=>{const f=window.fixture,shop=f.simulation.state.shops.find(shop=>shop.buildingId===f.view.nearbyBuilding.id);f.corporateOpening=f.declareExistingCorporateFixtureEntitlement(shop,'player');f.ui.update(f.simulation.state,f.view);return f.corporateOpening;});
 assert.equal(corporateOpening.kind,'controlled-existing-business-entitlement');assert.equal(corporateOpening.naturalPurchase,false);
 assert(Math.abs(corporateOpening.totalCashAfter-corporateOpening.totalCashBefore)<1e-8);assert(Math.abs(corporateOpening.priorCashAfter-corporateOpening.priorCashBefore-corporateOpening.returned)<1e-8);
 assert.equal(corporateOpening.playerCashAfter,corporateOpening.playerCashBefore);assert.equal(corporateOpening.protectedCashAfter,corporateOpening.protectedCashBefore);assert.equal(corporateOpening.booksPreserved,true);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.shops.find(shop=>shop.id===window.fixture.corporateOpening.shopId).ownerId),'player');
 assert.equal(await page.evaluate(()=>window.fixture.commands.length),await page.evaluate(()=>window.fixture.corporateRejected.commands));
 // update() intentionally refreshes an open panel at a 700ms cadence.
 // Wait for that real refresh; retain the original enabled assertion below.
 await page.waitForFunction(()=>!document.querySelector('[data-ref="found-company"]')?.disabled,null,{timeout:10000});
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

 // BEGIN fresh-game aviation positive prerequisites
 // Earlier work, care and culture checks advance real weather. A positive
 // boarding check starts a legitimate new game, retaining every flight
 // assertion below and never forcing the weather, money, needs or clock.
 await page.reload({waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.ready);
 await page.getByTestId('panel-toggle').click();
 const flightPrerequisites=await page.evaluate(()=>{const s=window.fixture.simulation.state;return {weather:s.weather,visibility:s.visibility,energy:s.energy,clock:s.extension.lastUpdate,cash:s.player.money,alive:s.extension.actorProfiles.player.alive,vehicleId:s.player.vehicleId,activeAircraftId:s.aviation.activeAircraftId,identities:s.player.identities};});
 assert.notEqual(flightPrerequisites.weather,'雨');
 assert(flightPrerequisites.visibility>=.35&&flightPrerequisites.energy>=15);
 assert.equal(flightPrerequisites.alive,true);
 assert.equal(flightPrerequisites.vehicleId,null);
 assert.equal(flightPrerequisites.activeAircraftId,null);
 await writeFile(new URL('ui-aircraft-positive-prerequisites.json',artifactsDir),JSON.stringify(flightPrerequisites,null,2)+'\n');
 // END fresh-game aviation positive prerequisites
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
 // BEGIN additive native home-rest lifecycle checks
 // Start a fresh normal game after all original 30 checks. This resets through
 // the real constructor, never by injecting cash, needs, food, roles or clocks.
 await page.setViewportSize({width:1440,height:900});
 await page.goto(`http://127.0.0.1:${port}/ui-verify.html`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.ready);
 await page.evaluate(()=>{
   const f=window.fixture,s=f.simulation.state;
   const home=f.world.buildings.find(b=>b.id==='market-b24'&&f.homeRestPoints(b,0).some(p=>f.canAccessFloor(b,p.floor,s.player)))
     ??f.world.buildings.find(b=>b.kind==='home'&&b.floorPlanProfile==='v4-program-bodies-02'&&f.homeRestPoints(b,0).some(p=>f.canAccessFloor(b,p.floor,s.player)));
   if(!home)throw Error('No actual accessible v4 home bed in generated world');
   f.restHome=home;f.restTable=f.fixturePoint(home,'service');
   f.restBed=f.homeRestPoints(home,0).find(p=>f.canAccessFloor(home,p.floor,s.player));
   if(!f.restBed||f.homeRestPointAt(home,f.restTable,s.player))throw Error('Fixture table and bed-side must be distinct real points');
   f.atPoint(home,'service');
   f.restEvidence={scope:'Additional native DOM controls with real generated current-v4 and Simulation; controlled table/bed-side positioning only, no Renderer, no ordinary walk/bed journey or hardware performance claim.',homeId:home.id,profile:home.floorPlanProfile,tablePoint:{...f.restTable},bedPoint:{...f.restBed},initial:{cash:s.player.money,fatigue:s.player.needs.fatigue,fun:s.player.needs.fun,hunger:s.player.needs.hunger,clock:s.extension.lastUpdate,actors:s.citizens.length,speed:s.speed},phases:[]};
   f.restInitialFatigue=s.player.needs.fatigue;f.restInitialCash=s.player.money;
 });
 assert.equal(await page.evaluate(()=>window.fixture.restInitialCash),600);
 assert(await page.evaluate(()=>window.fixture.restInitialFatigue)>=90);
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="rent"]').isEnabled(),true);
 await page.locator('[data-ref="context-body"] [data-command="rent"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.commandResults.at(-1).result.ok),true);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.homeId),await page.evaluate(()=>window.fixture.restHome.id));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.money),520);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.needs.fatigue),await page.evaluate(()=>window.fixture.restInitialFatigue));
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="rest"]').isDisabled(),true);
 await page.evaluate(()=>{const f=window.fixture;f.restTableBefore=f.simulation.exportSave();f.actionsRestAtTable=f.simulation.command({type:'rest',targetId:f.restHome.id});});
 assert.equal(await page.evaluate(()=>window.fixture.actionsRestAtTable.ok),false);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.exportSave()),await page.evaluate(()=>window.fixture.restTableBefore));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.session),null);
 await page.screenshot({path:fileURLToPath(new URL('ui-home-rest-table.png',artifactsDir))});
 results.push('Native v4 home rent spends 80 real coins; table-side rest is disabled and its command rejects atomically without instant recovery');

 await page.evaluate(()=>{const f=window.fixture;f.placeHomeRest(f.restHome,f.restBed.position);f.restStartFatigue=f.simulation.state.player.needs.fatigue;f.restStartFun=f.simulation.state.player.needs.fun;f.restStartClock=f.simulation.state.extension.lastUpdate;});
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="rest"]').isEnabled(),true);
 await page.locator('[data-ref="context-body"] [data-command="rest"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.commandResults.at(-1).result.ok),true);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.session.state),'active');
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.session.progressMinutes),0);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.needs.fatigue),await page.evaluate(()=>window.fixture.restStartFatigue));
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="rest"]').isDisabled(),true);
 await page.evaluate(()=>{const f=window.fixture;f.restSessionId=f.simulation.state.homeRest.session.id;for(let i=0;i<8;i++)f.simulation.step(.25);f.ui.update(f.simulation.state,f.view);f.restEvidence.phases.push({phase:'partial',session:{...f.simulation.state.homeRest.session},fatigue:f.simulation.state.player.needs.fatigue,fun:f.simulation.state.player.needs.fun,clock:f.simulation.state.extension.lastUpdate});});
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.session.progressMinutes),2);
 assert(Math.abs(await page.evaluate(()=>window.fixture.simulation.state.extension.lastUpdate-window.fixture.restStartClock)-2)<1e-7);
 assert(Math.abs(await page.evaluate(()=>window.fixture.simulation.state.player.needs.fatigue-window.fixture.restStartFatigue)-(38/20-.018)*2)<1e-7);
 assert(Math.abs(await page.evaluate(()=>window.fixture.simulation.state.player.needs.fun-window.fixture.restStartFun)-(12/20-.009)*2)<1e-7);
 assert.match(await page.locator('[data-ref="context-body"] .home-rest-card').innerText(),/休息中.*2.*20.*分钟/);
 await page.screenshot({path:fileURLToPath(new URL('ui-home-rest-active.png',artifactsDir))});
 results.push('Native bed-side rest starts at zero progress, disables duplicate activation and earns only two actual minutes of recovery minus ordinary need decay');

 await page.evaluate(()=>{const f=window.fixture;f.restBeforePauseFatigue=f.simulation.state.player.needs.fatigue;f.placeHomeRest(f.restHome,f.restTable);for(let i=0;i<4;i++)f.simulation.step(.25);f.ui.update(f.simulation.state,f.view);});
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.session.state),'paused');
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.session.progressMinutes),2);
 assert(Math.abs(await page.evaluate(()=>window.fixture.simulation.state.player.needs.fatigue-window.fixture.restBeforePauseFatigue)+.018)<1e-7);
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="rest"]').isDisabled(),true);
 assert.match(await page.locator('[data-ref="context-body"] .home-rest-card').innerText(),/已暂停/);
 await page.screenshot({path:fileURLToPath(new URL('ui-home-rest-paused.png',artifactsDir))});
 await page.evaluate(()=>{const f=window.fixture;f.placeHomeRest(f.restHome,f.restBed.position);for(let i=0;i<4;i++)f.simulation.step(.25);f.ui.update(f.simulation.state,f.view);f.restEvidence.phases.push({phase:'returned-but-paused',session:{...f.simulation.state.homeRest.session},clock:f.simulation.state.extension.lastUpdate});});
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.session.state),'paused');
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.session.progressMinutes),2);
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="rest"]').isEnabled(),true);
 assert.match(await page.locator('[data-ref="context-body"] [data-command="rest"]').innerText(),/继续床旁休息/);
 await page.locator('[data-ref="context-body"] [data-command="rest"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.session.id),await page.evaluate(()=>window.fixture.restSessionId));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.session.state),'active');
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.session.progressMinutes),2);
 await page.evaluate(()=>{const f=window.fixture;f.restSave=f.simulation.exportSave();f.restClone=new f.simulation.constructor(f.world);f.restLoaded=f.restClone.importSave(f.restSave);f.restSelfLoaded=f.simulation.importSave(f.restSave);f.ui.update(f.simulation.state,f.view);});
 assert.equal(await page.evaluate(()=>window.fixture.restLoaded.ok),true);
 assert.equal(await page.evaluate(()=>window.fixture.restSelfLoaded.ok),true);
 assert.equal(await page.evaluate(()=>window.fixture.restClone.exportSave()),await page.evaluate(()=>window.fixture.restSave));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.exportSave()),await page.evaluate(()=>window.fixture.restSave));
 results.push('Leaving the real bed pauses without recovery; returning remains paused until native explicit resume, and active save/load retains exact progress');

 await page.evaluate(()=>{const f=window.fixture;let expectedFatigue=f.simulation.state.player.needs.fatigue,expectedFun=f.simulation.state.player.needs.fun;for(let i=0;i<72;i++){expectedFatigue=Math.min(100,Math.max(0,expectedFatigue-.25*.018)+.25*38/20);expectedFun=Math.min(100,Math.max(0,expectedFun-.25*.009)+.25*12/20);f.simulation.step(.25);f.restClone.step(.25);}f.restExpectedFatigue=expectedFatigue;f.restExpectedFun=expectedFun;f.restContinuedExact=f.restClone.exportSave()===f.simulation.exportSave();f.ui.update(f.simulation.state,f.view);f.restEvidence.phases.push({phase:'completed',history:{...f.simulation.state.homeRest.history.at(-1)},fatigue:f.simulation.state.player.needs.fatigue,fun:f.simulation.state.player.needs.fun,expectedFatigue,expectedFun,continuedExact:f.restContinuedExact,clock:f.simulation.state.extension.lastUpdate});});
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.session),null);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.history.at(-1).state),'completed');
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.history.at(-1).progressMinutes),20);
 assert.equal(await page.evaluate(()=>window.fixture.restContinuedExact),true);
 assert(Math.abs(await page.evaluate(()=>window.fixture.simulation.state.player.needs.fatigue-window.fixture.restExpectedFatigue))<1e-7);
 assert(Math.abs(await page.evaluate(()=>window.fixture.simulation.state.player.needs.fun-window.fixture.restExpectedFun))<1e-7);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.money),520);
 assert.match(await page.locator('[data-ref="context-body"] .home-rest-card').innerText(),/已完成 20 分钟休息/);
 await page.screenshot({path:fileURLToPath(new URL('ui-home-rest-completed.png',artifactsDir))});
 results.push('A restored native bed session completes only after twenty actual on-site minutes, keeps wallet cash and clamps recovery with ordinary decay');

 await page.locator('[data-ref="context-body"] [data-command="rest"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.commandResults.at(-1).result.ok),true);
 await page.evaluate(()=>{const f=window.fixture;for(let i=0;i<4;i++)f.simulation.step(.25);f.restCancelFatigue=f.simulation.state.player.needs.fatigue;f.restCancelFun=f.simulation.state.player.needs.fun;f.ui.update(f.simulation.state,f.view);});
 assert(await page.evaluate(()=>window.fixture.restCancelFun)<100);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.session.progressMinutes),1);
 await page.locator('[data-ref="context-body"] [data-command="cancelRest"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.commandResults.at(-1).result.ok),true);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.session),null);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.history.at(-1).state),'cancelled');
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.homeRest.history.at(-1).progressMinutes),1);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.needs.fatigue),await page.evaluate(()=>window.fixture.restCancelFatigue));
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.needs.fun),await page.evaluate(()=>window.fixture.restCancelFun));
 await page.evaluate(()=>{const f=window.fixture;for(let i=0;i<4;i++)f.simulation.step(.25);f.ui.update(f.simulation.state,f.view);f.restEvidence.phases.push({phase:'cancelled',history:{...f.simulation.state.homeRest.history.at(-1)},fatigue:f.simulation.state.player.needs.fatigue,fun:f.simulation.state.player.needs.fun,funBeforeCancel:f.restCancelFun,clock:f.simulation.state.extension.lastUpdate});});
 assert(Math.abs(await page.evaluate(()=>window.fixture.simulation.state.player.needs.fatigue-window.fixture.restCancelFatigue)+.018)<1e-7);
 assert(Math.abs(await page.evaluate(()=>window.fixture.simulation.state.player.needs.fun-window.fixture.restCancelFun)+.009)<1e-7);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.player.money),520);
 assert.match(await page.locator('[data-ref="context-body"] .home-rest-card').innerText(),/上次休息已结束/);
 await page.screenshot({path:fileURLToPath(new URL('ui-home-rest-cancelled.png',artifactsDir))});
 await writeFile(new URL('ui-home-rest-evidence.json',artifactsDir),JSON.stringify(await page.evaluate(()=>window.fixture.restEvidence),null,2)+'\n');
 results.push('Native cancellation preserves the one-minute receipt without extra recovery; subsequent ticks only apply normal fatigue decay');
 // END additive native home-rest lifecycle checks
 assert.deepEqual(errors,[]);
 console.log(`${results.length} UI integration checks passed, no browser errors.`);
} catch (error) {
 failure = error instanceof Error ? error.stack ?? error.message : String(error);
 // BEGIN readonly UI failure diagnostic capture
 // Retain the original assertion and result. This observes the actual rejected
 // command and complete save without changing gameplay or its prerequisites.
 if(diagnosticPage&&!diagnosticPage.isClosed())try{
   const diagnostic=await diagnosticPage.evaluate(()=>{
     const f=window.fixture;if(!f)return {fixtureAvailable:false};
     const s=f.simulation.state;
     return {fixtureAvailable:true,clock:{tick:s.tick,day:s.day,hour:s.hour,speed:s.speed,paused:s.paused,at:s.extension?.lastUpdate},weather:s.weather,visibility:s.visibility,energy:s.energy,player:{position:{...s.player.position},money:s.player.money,vehicleId:s.player.vehicleId,identities:s.player.identities,alive:s.extension?.actorProfiles.player.alive,needs:{...s.player.needs}},view:{mode:f.view.mode,position:{...f.view.position},inside:f.view.inside,nearbyBuildingId:f.view.nearbyBuilding?.id??null,nearbyAircraftId:f.view.nearbyAircraft?.id??null},aircraft:s.aviation,commands:f.commandResults.slice(-10),corporateOpening:f.corporateOpening??null,homeRest:s.homeRest,save:f.simulation.exportSave()};
   });
   const {save,...summary}=diagnostic;
   await writeFile(new URL('ui-failure-diagnostic.json',artifactsDir),JSON.stringify(summary,null,2)+'\n');
   if(typeof save==='string')await writeFile(new URL('ui-failure-save.json',artifactsDir),save);
   await diagnosticPage.screenshot({path:fileURLToPath(new URL('ui-failure.png',artifactsDir))});
 }catch(diagnosticError){console.error('Read-only UI failure diagnostic could not complete:',diagnosticError);}
 // END readonly UI failure diagnostic capture
 console.error(failure);
 process.exitCode = 1;
} finally {
 await writeFile(new URL('ui-results.json', artifactsDir), JSON.stringify({ status: failure ? 'failed' : 'passed', browser: 'Chromium', scope: 'DOM with the real generated world and Simulation; no renderer or macOS performance claim.', checks: results.length, results, errors, ...(failure ? { failure } : {}) }, null, 2)).catch(error => { console.error(error); process.exitCode = 1; });
 try { await browser?.close(); } finally { await server?.close(); }
}
