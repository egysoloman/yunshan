import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {requireRootReady,verifyFixedSource} from './fixed-source-gate.mjs';
import {installResidency,sceneSubmission,controlledWalk} from './body-capture-observers.mjs';
await requireRootReady();const sourceStart=await verifyFixedSource();
const root='/tmp/yunshan-v4-root-coherent-04',port=4198,output=path.resolve(process.argv[2]);
assert(output.startsWith('/workspace/yunshan/artifacts/'));await mkdir(output,{recursive:true});
const f=JSON.parse(await readFile(new URL('./pilot-market-b24-fixture.json',import.meta.url),'utf8'));
const {chromium}=await import(root+'/node_modules/playwright-core/index.mjs');
const server=spawn(process.execPath,[root+'/node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore','pipe','pipe']});
let startup='',browser,page,initial;const captures=[],routes=[],commands=[],npcSnapshots=[],failures=[],errors=[],warnings=[];
server.stdout.on('data',d=>startup+=d);server.stderr.on('data',d=>startup+=d);
const dump=async(name,data)=>writeFile(path.join(output,name+'.json'),JSON.stringify(data,null,2));
async function npcRead(stage){const value=await page.evaluate(({id,stage})=>{const d=window.__YUNSHAN__;
 return {at:new Date().toISOString(),stage,seed:d.world.seed,layout:d.world.layoutVersion,tick:d.simulation.state.tick,hour:d.simulation.state.hour,day:d.simulation.state.day,
  scope:'Read-only actual current-v4 fresh runtime citizen homeId/state/position/routes. No NPC placement, home assignment, clock steps or saved-profile claim.',
  residents:d.simulation.state.citizens.filter(c=>c.homeId===id).map(c=>({id:c.id,homeId:c.homeId,workId:c.workId,state:c.state,tier:c.tier,position:{...c.position},destinationId:c.destinationId,routeIndex:c.routeIndex,routeLength:c.route?.length??0,routeFirst:c.route?.[0]??null,routeLast:c.route?.at(-1)??null}))};
 },{id:f.id,stage});npcSnapshots.push(value);await dump('npc-'+stage,value);return value;}
async function capture(name,aim=null,probes=[]){if(aim)await page.evaluate(target=>{const c=window.__YUNSHAN__.controller,p=c.position;c.yaw=Math.atan2(-(target.x-p.x),-(target.z-p.z));c.pitch=Math.atan2(target.y-p.y-1.72,Math.hypot(target.x-p.x,target.z-p.z));c.orient();},aim);
 const data=await sceneSubmission(page,f.id,probes);data.name=name;data.cameraAim=aim;
 data.scope='Single existing home controlled body; actual live natural clock, no clock/speed/identity writes; distinct from native ordinary URL journey and reference art pass';
 await page.screenshot({path:path.join(output,name+'.png'),timeout:120_000});await dump(name,data);captures.push(data);
 if(data.glErrors.length||data.shaderPrograms.some(p=>p.diagnostics?.runnable===false)||data.residency.hiddenFarMismatch||data.optics.speed!==1)failures.push({stage:name,error:'GL/shader/residency or normal speed failed'});
 console.log('CAPTURE '+name+' '+JSON.stringify(data.actualBody));return data;}
async function walk(points,name){const data=await controlledWalk(page,points,name);routes.push(data);await dump(name+'-route',data);if(data.status!=='passed')throw Error(data.failure);await page.waitForTimeout(150);return data;}
async function command(type){const value=await page.evaluate(({id,type})=>{const d=window.__YUNSHAN__,state=()=>({money:d.simulation.state.player.money,homeId:d.simulation.state.player.homeId,role:d.simulation.state.player.role,identities:[...d.simulation.state.player.identities],needs:{...d.simulation.state.player.needs},position:d.controller.position,hour:d.simulation.state.hour,speed:d.simulation.state.speed});
 const before=state();const returned=d.actions.command({type,targetId:id});return {type,before,after:state(),returned:returned??null,toast:document.querySelector('[data-ref="toast"]')?.textContent??'',scope:'Actual production UI action command at reached service point; no direct economic, identity, clock or body state assignment'};
 },{id:f.id,type});commands.push(value);await dump('actual-'+type,value);
 if(type==='rent')assert(value.after.homeId===f.id&&Math.abs(value.before.money-value.after.money-80)<1e-8,'Real rent debits80 and assigns actual home');
 if(type==='rest')assert(value.after.needs.fatigue>=value.before.needs.fatigue&&value.after.money===value.before.money,'Real owned-home rest restores needs without extra debit');
 assert(value.before.role===value.after.role&&JSON.stringify(value.before.identities)===JSON.stringify(value.after.identities));return value;}
try{
 for(let i=0;i<150;i++){if(server.exitCode!==null)throw Error(startup);if(startup.includes(`http://127.0.0.1:${port}`))break;if(i===149)throw Error('Owned preview did not start');await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});page.setDefaultTimeout(120_000);
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
 await page.goto(`http://127.0.0.1:${port}/?debug=1`,{waitUntil:'networkidle',timeout:120_000});await page.waitForFunction(()=>window.__YUNSHAN__?.simulation.state.tick>=1,null,{timeout:120_000});
 initial=await page.evaluate(f=>{const d=window.__YUNSHAN__,b=d.world.buildings.find(b=>b.id===f.id);if(d.world.layoutVersion!=='current-v4'||b.floors!==3||JSON.stringify(b.door)!==JSON.stringify(f.building.door))throw Error('Pilot world mismatch');
  if(d.simulation.state.player.money!==600||d.simulation.state.speed!==1)throw Error('Original traveler initial wallet/speed mismatch');
  d.actions.setQuality('balanced');d.city.setDynamicResolution(false);d.city.renderer.setPixelRatio(1);d.city.camera.fov=48;d.city.camera.updateProjectionMatrix();
  // Exactly one declared initial physical outside placement. Clock, speed,
  // wallet, identity, stock and all dimensions remain original at setup.
  d.simulation.state.player.position={...f.outside};d.controller.setMode('walk',f.outside);d.controller.yaw=b.rotation;d.controller.pitch=-.05;d.controller.orient();
  return {position:d.controller.position,money:d.simulation.state.player.money,role:d.simulation.state.player.role,identities:[...d.simulation.state.player.identities],hour:d.simulation.state.hour,speed:d.simulation.state.speed,building:b,fixtureScope:'Initial outside position only; graphics fixed for observation; clock natural and live'};
 },f);await dump('initial-declared-fixture',initial);await installResidency(page);await npcRead('outside-start');
 await capture('home-door',{...f.building.door,y:f.building.door.y+1.3});await capture('home-eave-from-outside',f.roofAim);
 await walk([f.outside,f.inside],'door-crossing');await capture('home-inside',{...f.service.position,y:f.service.position.y+1.2});
 await walk(f.serviceRoute,'service-point');await capture('home-service-table',{...f.service.position,y:f.service.position.y+.8});
 await command('rent');await command('rest');await capture('home-after-legal-rent-rest');await npcRead('after-rent-rest');
 await walk(f.bedView.route,'to-real-bed');await capture('home-bed-close',f.bedCenter,[{...f.bedCenter,minY:f.bedCenter.y-.4,maxY:f.bedCenter.y+.4}]);
 await capture('home-window-by-bed',f.windows[0].point);await walk([...f.bedView.route].reverse(),'return-from-bed');await walk([...f.serviceRoute].reverse(),'return-to-inside');
 const court=f.courts[0];if(court){await walk(court.route,'to-courtyard');await capture('home-courtyard-toward-house',{...f.building.position,y:f.building.position.y+2.3});await walk([...court.route].reverse(),'return-from-courtyard');}
 await walk(f.stairApproach,'stairs-approach');
 const turn=f.body.floorPlans[0].stairLandings.find(t=>t.id==='half-turn');const turnWorldY=f.building.position.y+.6+turn.top;
 const mid=f.stairs01.findIndex((p,i)=>i>0&&Math.abs(p.y-turnWorldY)<.01);assert(mid>0);
 await walk(f.stairs01.slice(0,mid+1),'stairs-01-first-flight');await capture('home-stair-half-turn',f.stairs01[0]);
 await walk(f.stairs01.slice(mid),'stairs-01-second-flight');await capture('home-stair-upper1',f.stairs01[mid]);await capture('home-upper-hole',f.holeTarget,[{...f.holeTarget,minY:f.holeTarget.y-.25,maxY:f.holeTarget.y+.25}]);
 await walk(f.upperRoute,'upper1-to-next-stairs');await walk(f.stairs12,'stairs-12-up');await capture('home-stair-upper2',f.stairs12[0]);
 await walk([...f.stairs12].reverse(),'stairs-21-down');await walk([...f.upperRoute].reverse(),'upper1-return');await walk([...f.stairs01].reverse(),'stairs-10-down');await capture('home-stair-lower',f.stairs01.at(-1));
 await npcRead('after-stairs');
 // Bounded live natural observation. Never call simulation.step/setTime or
 // assign NPC state, identities, routes or homes to make an entry happen.
 for(let i=0;i<5;i++){await page.waitForTimeout(4000);await npcRead('natural-observation-'+i);}
 await dump('npc-natural-observation',{status:'READ_ONLY_SNAPSHOTS_RECORDED_DOOR_CROSSING_NOT_VERIFIED',snapshots:npcSnapshots,scope:'Current runtime home residence/query evidence only; no claim that controlled player walking proves NPC daily schedule, entry, bed use, cooking or bathing'});
}catch(error){failures.push({stage:'pilot',error:error.stack??String(error)});if(page&&!page.isClosed())await capture('pilot-failure').catch(e=>errors.push(String(e)));}
finally{
 if(page&&!page.isClosed()){const disposal=await page.evaluate(()=>{const d=window.__YUNSHAN__,before=window.__BODY_RESIDENCY__();d.dispose();return {before,after:window.__BODY_RESIDENCY__()};}).catch(e=>({error:String(e)}));await dump('actual-disposal',disposal);}
 await browser?.close();server.kill('SIGTERM');const sourceEnd=await verifyFixedSource();
 await dump('pilot-results',{status:failures.length||errors.length?'failed':'passed',id:f.id,scope:'Single existing three-floor home controlled-body functional/GL evidence; no ordinary-player or art-completion claim',sourceStart,sourceEnd,runnerSHA256:createHash('sha256').update(await readFile(import.meta.filename)).digest('hex'),initial,captures,routes,commands,npcSnapshots,failures,errors,warnings,
  bedServiceDistanceMetres:f.bedToServiceMetres,missingFixtureKinds:f.declaredMissingFixtureKinds,naturalNPCDoorEntry:'NOT_VERIFIED',naturalNPCBedUse:'NOT_RUN',kitchenBathUse:'NOT_IMPLEMENTED_IN_THIS_BODY',tripoIntegratedModels:0});
}
if(failures.length||errors.length)process.exitCode=1;
