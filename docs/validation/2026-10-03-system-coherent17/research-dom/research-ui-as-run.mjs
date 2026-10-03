import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '/workspace/yunshan/node_modules/playwright-core/index.mjs';
import { createServer } from '/workspace/yunshan/node_modules/vite/dist/node/index.js';

const root = process.env.YUNSHAN_RESEARCH_UI_SOURCE;
const manifestPath = process.env.YUNSHAN_RESEARCH_UI_MANIFEST;
const out = process.env.YUNSHAN_RESEARCH_UI_OUT;
assert(root && manifestPath && out, 'Bind to an actual completed composite source and its manifest before running.');
const port = Number(process.env.YUNSHAN_RESEARCH_UI_PORT ?? 4197);
assert(Number.isInteger(port) && port >= 1024 && port <= 65535);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const names = Object.keys(manifest.copiedHashes).sort();
const sha = data => createHash('sha256').update(data).digest('hex');
const hashes = async () => Object.fromEntries(await Promise.all(names.map(async name => [name, sha(await readFile(path.join(root, name)))])));
await mkdir(out, { recursive: true });
const sourceStart = await hashes();
assert.deepEqual(sourceStart, manifest.copiedHashes);
const result = { startedAtUTC: new Date().toISOString(), pid: process.pid, sourceRoot: root, manifestPath,
  manifestSHA256: sha(await readFile(manifestPath)), sourceStart, results: [], errors: [],
  scope: 'Controlled default-world CityUI + real Simulation, native DOM buttons; qualification and positioning are explicit fixtures. No Renderer/GPU, ordinary journey, art, default autonomous research, hardware or whole suite claim.' };
let server, browser, page, failure;
try {
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="icon" href="data:,"><body><div id="app"></div><script type="module">
import '/src/style.css';
import {createWorld} from '/src/world.ts';
import {Simulation} from '/src/simulation.ts';
import {CityUI} from '/src/ui.ts';
import {getBuildingUsePoints, floorPlanSupport, blocksFloorPlanMovement} from '/src/architecture-floor-plan.ts';
import {researchProgressInfo} from '/src/simulation/extensions.ts';
const world=createWorld(), sim=new Simulation(world);
const lab=world.buildings.find(b=>b.kind==='school'&&b.floorPlanProfile==='v4-program-bodies-02');
if(!lab)throw Error('No actual marked school.');
const point=getBuildingUsePoints(lab,0).find(p=>p.purpose==='work'&&p.floor===0&&(()=>{const support=floorPlanSupport(lab,0,p.position,.35);return !!support&&support.floor===0&&support.kind==='room'&&Math.abs(support.y-p.position.y)<1e-7&&!blocksFloorPlanMovement(lab,0,p.position,p.position,.35,1.72)})());
if(!point)throw Error('No actual ground laboratory work point.');
// Explicit controlled qualification and position. Cash/material/time are untouched.
sim.state.player.role='scientist';sim.state.player.identities=['traveler','scientist'];sim.state.player.education=3;
sim.setFocus(point.position,'walk');
const view={mode:'walk',quality:'balanced',fps:0,drawCalls:0,triangles:0,position:{...point.position},nearbyBuilding:lab,nearbyCitizen:null,nearbyVehicle:null,targetDistrict:null,inside:true,renderDistance:3600,fpsCap:60,dynamicResolution:true,simulationDetail:1};
const commands=[];let ui;
const actions={isAtBuildingFunctionPoint(id,purpose){const b=world.buildings.find(b=>b.id===id);return !!b&&sim.isAtBuildingFunctionPoint(b,sim.state.player.position,purpose)},command(c){const r=sim.command(c);commands.push({command:c,result:r});ui.notify(r.message,r.ok);ui.update(sim.state,view)},setMode(){},setQuality(){},travel(){},interact(){},save(){},load(){},exportSave(){},importSave(){},setSetting(){},resetView(){}};
ui=new CityUI(document.getElementById('app'),world,actions);ui.update(sim.state,view);
window.fixture={world,sim,lab,point,view,ui,commands,info(){return researchProgressInfo(sim.state,'medicine')},refresh(){ui.update(sim.state,view)},away(){sim.setFocus(world.spawn,'walk');view.position={...world.spawn};view.nearbyBuilding=null;view.inside=false;ui.update(sim.state,view)}};setInterval(()=>ui.update(sim.state,view),200);window.ready=true;
</script></body></html>`;
  server = await createServer({ root, server: { host: '127.0.0.1', port, strictPort: true, watch: null },
    plugins: [{ name: 'controlled-research-dom', configureServer(vite) { vite.middlewares.use(async (request,response,next)=>{
      if(request.url?.split('?')[0]!=='/research-ui-verify.html'||request.url.includes('html-proxy'))return next();
      try{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(await vite.transformIndexHtml(request.url,html));}catch(error){next(error);}
    }); } }] });
  await server.listen();
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('console', message => { if(message.type()==='error')result.errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${port}/research-ui-verify.html`, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForFunction(()=>window.ready, null, {timeout:90000});
  await page.getByTestId('panel-toggle').click();
  await page.getByRole('tab',{name:'产业',exact:true}).click();
  const button=page.locator('[data-command="research"][data-target="medicine"]');
  assert.equal(await button.count(),1);
  assert.equal(await button.isEnabled(),true);
  const before=await page.evaluate(()=>({wallet:fixture.sim.state.player.money,treasury:fixture.sim.state.treasury,clock:fixture.sim.state.extension.lastUpdate}));
  await button.click();
  const started=await page.evaluate(()=>({info:fixture.info(),wallet:fixture.sim.state.player.money,treasury:fixture.sim.state.treasury,command:fixture.commands.at(-1)}));
  assert.equal(started.command.result.ok,true);assert.equal(started.wallet,before.wallet-200);assert.equal(started.treasury,before.treasury+200);assert.equal(started.info.workedMinutes,0);
  result.results.push('Native research button spends real200 and grants zero immediate labour/technology.');
  await page.evaluate(()=>{fixture.sim.step(.25);fixture.sim.step(.25);fixture.refresh();});
  const onsite=await page.evaluate(()=>fixture.info());assert.equal(onsite.workedMinutes,8);
  await page.waitForFunction(()=>document.querySelector('[data-ref="research-list"]')?.textContent.includes('8.0 / 120'));
  assert.match(await page.locator('[data-ref="research-list"]').innerText(),/8\.0 \/ 120/);
  await page.screenshot({path:path.join(out,'01-controlled-research-onsite-eight-minutes.png'),fullPage:true});
  result.results.push('UI reads actual eight onsite minutes and the120 threshold.');
  await page.evaluate(()=>{fixture.away();fixture.sim.step(.25);fixture.refresh();});
  const away=await page.evaluate(()=>fixture.info());assert.equal(away.workedMinutes,8);assert.equal(away.state,'paused');assert(away.pauseReason);
  await page.waitForFunction(()=>document.querySelector('[data-ref="research-list"]')?.textContent.includes('暂停'));
  assert.match(await page.locator('[data-ref="research-list"]').innerText(),/暂停/);
  await page.screenshot({path:path.join(out,'02-controlled-research-offsite-paused.png'),fullPage:true});
  result.results.push('Leaving the actual lab pauses with readable reason and preserves eight earned minutes.');
  const display=await page.evaluate(()=>{const before={clock:fixture.sim.state.extension.lastUpdate,minutes:fixture.info().workedMinutes};const r=fixture.sim.command({type:'setTime',value:23});fixture.refresh();return {before,result:r,after:{clock:fixture.sim.state.extension.lastUpdate,minutes:fixture.info().workedMinutes}};});
  assert(display.result.ok);assert.deepEqual(display.after,display.before);
  result.results.push('Changing displayed time preserves monotonic clock and earned labour.');
  assert.deepEqual(result.errors,[]);
  result.details={before,started,onsite,away,display};result.state='PASS_CONTROLLED_RESEARCH_DOM4';
}catch(error){failure=error;result.state='FAIL';result.failure=String(error.stack??error);if(page)await page.screenshot({path:path.join(out,'failure.png'),fullPage:true}).catch(()=>{});
}finally{
  if(browser){await browser.close();result.browserCloseResolved=true;}
  if(server){await server.close();result.serverCloseResolved=true;}
  result.sourceEnd=await hashes();result.sourceStable=JSON.stringify(result.sourceStart)===JSON.stringify(result.sourceEnd);
  result.endedAtUTC=new Date().toISOString();result.scriptSHA256=sha(await readFile(new URL(import.meta.url)));
  if(!result.sourceStable){result.state='FAIL_SOURCE_CHANGED';failure??=new Error('Source changed.');}
  await writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({state:result.state,checks:result.results.length,errors:result.errors,sourceStable:result.sourceStable,endedAtUTC:result.endedAtUTC}));
}
if(failure)throw failure;
