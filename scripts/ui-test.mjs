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
import {PerspectiveCamera} from 'three';
const world=createWorld();const simulation=new Simulation(world);
const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','Keyboard controller fixture');document.getElementById('app').append(canvas);
const controller=new PlayerController(new PerspectiveCamera(),canvas,world,()=>{});
const view={mode:'drone',quality:'balanced',fps:60,drawCalls:120,triangles:40000,position:{...world.spawn},nearbyBuilding:null,nearbyCitizen:null,nearbyVehicle:null,targetDistrict:null,inside:false,renderDistance:3600,fpsCap:60,dynamicResolution:true,simulationDetail:1};
let ui;const commands=[];
const actions={command(command){commands.push(command);const r=simulation.command(command);if(r.ok&&['boardAircraft','leaveAircraft'].includes(command.type)){const craft=activeAircraft(simulation.state);view.mode=craft?.kind??'walk';view.position={...simulation.state.player.position};controller.setMode(view.mode,view.position,craft)}ui.notify(r.message,r.ok);ui.update(simulation.state,view)},setMode(mode){view.mode=mode;ui.update(simulation.state,view)},setQuality(quality){view.quality=quality;ui.update(simulation.state,view)},travel(id){view.targetDistrict=id;ui.update(simulation.state,view)},interact(){},save(){},load(){},exportSave(){},importSave(){},setSetting(key,value){view[key]=value;ui.update(simulation.state,view)},resetView(){}};
ui=new CityUI(document.getElementById('app'),world,actions);ui.update(simulation.state,view);
window.fixture={world,simulation,view,ui,controller,commands,setAircraftControls,at(kind){const b=world.buildings.find(b=>b.kind===kind&&!b.facility);view.mode='walk';view.inside=false;view.nearbyBuilding=b;view.nearbyCitizen=null;view.nearbyVehicle=null;simulation.state.player.position={...b.door};view.position={...b.door};ui.update(simulation.state,view);return b.id}};
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
  browser=await chromium.launch({executablePath:process.env.YUNSHAN_CHROMIUM ?? '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
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
 await page.getByRole('button',{name:'收起城市手册'}).click();
 assert.equal(await page.evaluate(()=>document.activeElement?.dataset.testid),'panel-toggle');results.push('Closing panel returns focus to toggle');
 await page.evaluate(()=>{const f=window.fixture;f.at('bank');f.simulation.state.bankBalance=3100;f.simulation.state.loan=2200;f.ui.update(f.simulation.state,f.view)});
 assert.match(await page.locator('[data-ref="context-body"]').innerText(),/3,100.*云币/);assert.match(await page.locator('[data-ref="context-body"]').innerText(),/2,200.*云币/);results.push('Bank state cache refreshes independently of player cash');
 await page.evaluate(()=>{const f=window.fixture;f.view.nearbyBuilding=null;f.view.nearbyVehicle={...f.simulation.state.vehicles[0],state:'waiting',passengers:1,cargo:5,speed:2};f.ui.update(f.simulation.state,f.view)});
 await page.evaluate(()=>{const f=window.fixture;f.view.nearbyVehicle.state='moving';f.view.nearbyVehicle.passengers=9;f.view.nearbyVehicle.cargo=60;f.view.nearbyVehicle.speed=30;f.ui.update(f.simulation.state,f.view)});
 const vehicle=await page.locator('[data-ref="context-body"]').innerText();assert.match(vehicle,/行进中/);assert.match(vehicle,/9 位乘客/);assert.match(vehicle,/货物 60/);assert.match(vehicle,/30 m/);results.push('Vehicle state, passengers, cargo, speed stay live');
 await page.evaluate(()=>{const f=window.fixture;f.at('market');f.simulation.state.player.identities=['traveler','merchant'];f.simulation.state.player.role='traveler';f.simulation.state.player.money=3000;f.ui.update(f.simulation.state,f.view)});
 await page.getByTestId('panel-toggle').click();
 await page.getByRole('tab',{name:'产业',exact:true}).click();
 assert.equal(await page.locator('[data-ref="found-company"]').isEnabled(),true);
 await page.locator('[data-ref="found-company"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.extension.companies.filter(c=>c.ownerId==='player').length),1);results.push('Merchant identity stack enables company founding with real cash/ownership changes');
 await page.getByRole('tab',{name:'生活',exact:true}).click();
 await page.evaluate(()=>{const f=window.fixture;f.simulation.state.player.education=3;f.simulation.state.player.identities.push('scientist');f.at('school');f.ui.update(f.simulation.state,f.view)});
 await page.locator('[data-ref="career"]').selectOption('7');
 assert.match(await page.locator('[data-ref="career-note"]').innerText(),/教育至少 3/);results.push('Scientist qualification displays the correct requirement');
 await page.evaluate(()=>{const f=window.fixture;f.at('market');const s=f.simulation.state.shops.find(s=>s.buildingId===f.view.nearbyBuilding.id);s.open=true;s.inventory=100;f.simulation.state.player.inventory['ingredient:grain']=2;f.simulation.state.player.inventory['ingredient:vegetable']=1;f.ui.update(f.simulation.state,f.view)});
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
   s.player.homeId=f.world.buildings.find(b=>b.kind==='home').id;s.player.partnerId=c.id;c.partnerId='player';f.ui.update(s,f.view);
 });
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="propose"]').innerText(),'办理婚姻');
 assert.equal(await page.locator('[data-ref="context-body"] [data-command="propose"]').isDisabled(),true);
 await page.evaluate(()=>{const f=window.fixture;f.simulation.state.relationships.find(r=>r.npcId===f.romanceNpcId).romanceSince=f.simulation.state.extension.lastUpdate-120;f.ui.update(f.simulation.state,f.view)});
 await page.locator('[data-ref="context-body"] [data-command="propose"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.relationships.find(r=>r.npcId===window.fixture.romanceNpcId).romanceStage),'married');
 assert.equal(await page.evaluate(()=>window.fixture.view.nearbyCitizen.homeId===window.fixture.simulation.state.player.homeId),true);
 results.push('Engagement UI shows waiting and dispatches actual marriage/shared-home changes');
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
 await page.evaluate(()=>{const f=window.fixture;f.at('school');f.beforeCultureCash=f.simulation.state.player.money});
 await page.getByRole('tab',{name:'生活',exact:true}).click();
 await page.locator('[data-ref="work-title"]').fill('清溪行记');
 await page.locator('[data-ref="work-text"]').fill('从清溪沿石阶走进书院，城中的人们在灯火和晨雾之间开始各自的生活。');
 await page.locator('[data-ref="create-work"]').click();
 assert.equal(await page.evaluate(()=>window.fixture.beforeCultureCash-window.fixture.simulation.state.player.money),60);
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.culture.project.title),'清溪行记');
 assert.equal(await page.evaluate(()=>window.fixture.simulation.state.culture.project.workedMinutes),0);
 results.push('Culture form creates a paid persistent project and requires actual time on site');
 await page.evaluate(()=>window.fixture.at('hall'));
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
