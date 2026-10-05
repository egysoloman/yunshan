import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {requireRootReady,verifyFixedSource} from './fixed-source-gate.mjs';
import {installResidency,sceneSubmission,controlledWalk} from './body-capture-observers.mjs';
await requireRootReady();const sourceStart=await verifyFixedSource();
const root='/tmp/yunshan-v4-upper-stair-coherent-05',port=4201,output=path.resolve(process.argv[2]);
assert(output.startsWith('/workspace/yunshan/artifacts/'));await mkdir(output,{recursive:true});
const f=JSON.parse(await readFile(new URL('./pilot-market-b24-fixture.json',import.meta.url),'utf8'));
const {chromium}=await import(root+'/node_modules/playwright-core/index.mjs');
const server=spawn(process.execPath,[root+'/node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:root,stdio:['ignore','pipe','pipe']});
let startup='',browser,page,initial;const captures=[],routes=[],commands=[],npcSnapshots=[],failures=[],errors=[],warnings=[],permissions=[],holeNegatives=[];
server.stdout.on('data',d=>startup+=d);server.stderr.on('data',d=>startup+=d);
const dump=async(name,data)=>writeFile(path.join(output,name+'.json'),JSON.stringify(data,null,2));
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
async function actualPermission(stage){
 const r=await page.evaluate(({id,stage})=>{const d=window.__YUNSHAN__,b=d.world.buildings.find(b=>b.id===id);return {stage,position:d.controller.position,actualFloor:d.controller.floor,inside:d.controller.inside?.id??null,blockedAccess:d.controller.blockedAccess,role:d.simulation.state.player.role,identities:[...d.simulation.state.player.identities],homeId:d.simulation.state.player.homeId,money:d.simulation.state.player.money,hour:d.simulation.state.hour,speed:d.simulation.state.speed,allowed:[0,1,2].map(floor=>({floor,allowed:d.canAccessBuilding(b,floor)}))};},{id:f.id,stage});
 permissions.push(r);await dump('permissions-'+stage,r);assert(r.allowed.every(q=>q.allowed),'Actual legal owner can access each actual target floor');assert.equal(r.speed,1);assert.equal(r.blockedAccess,null);return r;
}
async function actualSupportCapture(name,aim,expectedFloor,hole=null){
 const body=await page.evaluate(()=>window.__YUNSHAN__.controller.position);
 const probes=[{...body,minY:body.y-.025,maxY:body.y+.025},...(hole?[{...hole.target,minY:hole.target.y-.025,maxY:hole.target.y+.025}]:[])];
 const r=await capture(name,aim,probes);
 assert.equal(r.actualBody.floor,expectedFloor);assert.equal(r.actualBody.inside,f.id);
 assert(r.verticalHits[0]?.nearest&&Math.abs(r.verticalHits[0].nearest.y-body.y)<.025,'Actual visible resident support triangle matches real body feet');
 if(hole)assert.equal(r.verticalHits[1]?.nearest,null,'Actual visible upper-hole geometry does not invent slab at target height');
 assert.equal(r.optics.pixelRatio,1);assert.equal(r.optics.fov,48);assert.equal(r.optics.width,1440);assert.equal(r.optics.height,900);return r;
}
async function holeNegative(floor){
 const hole=f.holes.find(h=>h.floor===floor);assert(hole&&hole.expectedBodySupport===null&&hole.expectedRoofSupport===null);
 await actualPermission('before-hole-'+floor);
 const before=await page.evaluate(()=>window.__YUNSHAN__.controller.position);
 assert(Math.hypot(before.x-hole.approach.x,before.z-hole.approach.z)<.05,'Actual physical stair landing reached before negative');
 const result=await controlledWalk(page,[before,hole.target],'floor-'+floor+'-hole-negative');routes.push(result);
 await dump('floor-'+floor+'-hole-negative',{scope:'Same frozen provider target .35 disk support=null plus actual compiled motor/visible mesh negative; no movement fallback, no position writes',staticProvider:hole,actual:result});
 assert.equal(result.status,'failed','Motor must preserve expected unsupported-hole rejection');
 assert(Math.hypot(result.end.x-hole.target.x,result.end.z-hole.target.z)>.35,'Body cannot reach unsupported hole target');
 assert.equal(result.floor,floor);assert.equal(result.inside,f.id);assert(Math.abs(result.end.y-before.y)<.025);
 holeNegatives.push({floor,label:result.label,status:'EXPECTED_BLOCK_RECORDED',originalMotorStatus:result.status,end:result.end});
 await actualSupportCapture('floor-'+floor+'-hole',hole.target,floor,hole);
 await walk([result.end,before],'floor-'+floor+'-return-from-hole');
}
try{
 for(let i=0;i<150;i++){if(server.exitCode!==null)throw Error(startup);if(startup.includes(`http://127.0.0.1:${port}`))break;if(i===149)throw Error('Owned preview did not start');await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});page.setDefaultTimeout(120_000);
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());if(m.type()==='warning')warnings.push(m.text());});
 await page.goto(`http://127.0.0.1:${port}/?debug=1`,{waitUntil:'networkidle',timeout:120_000});await page.waitForFunction(()=>window.__YUNSHAN__?.simulation.state.tick>=1,null,{timeout:120_000});
 initial=await page.evaluate(f=>{const d=window.__YUNSHAN__,b=d.world.buildings.find(b=>b.id===f.id);if(d.world.layoutVersion!=='current-v4'||b.floors!==3||JSON.stringify(b.door)!==JSON.stringify(f.building.door))throw Error('Pilot world mismatch');
  if(d.simulation.state.player.money!==600||d.simulation.state.speed!==1)throw Error('Original traveler initial wallet/speed mismatch');
  d.actions.setQuality('balanced');d.city.setDynamicResolution(false);d.city.renderer.setPixelRatio(1);d.city.camera.fov=48;d.city.camera.updateProjectionMatrix();
  // One declared initial physical outside fixture only. Live natural clock,
  // unchanged default1x, original600/role; no further body/economic/clock writes.
  d.simulation.state.player.position={...f.outside};d.controller.setMode('walk',f.outside);d.controller.yaw=b.rotation;d.controller.pitch=-.05;d.controller.orient();
  return {position:d.controller.position,money:d.simulation.state.player.money,role:d.simulation.state.player.role,identities:[...d.simulation.state.player.identities],hour:d.simulation.state.hour,speed:d.simulation.state.speed,paused:d.simulation.state.paused,building:b,fixtureScope:'Initial outside position only; graphics fixed for observation; clock natural/live/default1x; no pause,setTime,speed command'};
 },f);await dump('initial-declared-fixture',initial);await installResidency(page);
 await capture('home-door',{...f.building.door,y:f.building.door.y+1.3});
 await walk([f.outside,f.inside],'door-crossing');await walk(f.serviceRoute,'service-point');await command('rent');await command('rest');
 await actualPermission('legal-rent-rest');await walk([...f.serviceRoute].reverse(),'return-to-inside');await walk(f.stairApproach,'stairs-approach');
 await walk(f.stairs01.slice(0,f.mid01+1),'stairs-01-first-flight');await walk(f.stairs01.slice(f.mid01),'stairs-01-second-flight');
 await actualPermission('reached-floor1');await holeNegative(1);await walk(f.upperRoute,'upper1-to-next-stairs');
 await walk(f.stairs12.slice(0,4),'stairs-12-old-failure-first-tread');
 const passage=await actualSupportCapture('old-failure-first-tread-passed',f.stairs12[0],1);
 assert(passage.actualBody.position.z>308.791474723644&&passage.actualBody.position.y>80.01,'Actual compiled motor passed the old .2m-riser failure without injected height');
 await walk(f.stairs12.slice(3,f.mid12+1),'stairs-12-first-flight-rest');await actualSupportCapture('stairs-12-half-turn',f.stairs12[0],1);
 await walk(f.stairs12.slice(f.mid12),'stairs-12-second-flight');await actualPermission('reached-floor2');
 await actualSupportCapture('home-stair-upper2',f.stairs12[f.mid12],2);await holeNegative(2);
 const down21=[...f.stairs12].reverse(),mid21=down21.findIndex((p,i)=>i>0&&Math.abs(p.y-f.stairs12[f.mid12].y)<.01);assert(mid21>0);
 await walk(down21.slice(0,mid21+1),'stairs-21-first-flight');await walk(down21.slice(mid21),'stairs-21-second-flight');
 await actualPermission('returned-floor1');await actualSupportCapture('home-returned-floor1',f.stairs12.at(-1),1);
 await walk([...f.upperRoute].reverse(),'upper1-return');
 const down10=[...f.stairs01].reverse(),mid10=down10.findIndex((p,i)=>i>0&&Math.abs(p.y-f.stairs01[f.mid01].y)<.01);assert(mid10>0);
 await walk(down10.slice(0,mid10+1),'stairs-10-first-flight');await walk(down10.slice(mid10),'stairs-10-second-flight');
 await actualPermission('returned-floor0');await actualSupportCapture('home-returned-ground',f.stairs01.at(-1),0);
 assert.equal(captures.length,8);assert.equal(holeNegatives.length,2);
}catch(error){failures.push({stage:'single-home-stair-roundtrip',error:error.stack??String(error)});if(page&&!page.isClosed())await capture('roundtrip-failure').catch(e=>errors.push(String(e)));}
finally{
 if(page&&!page.isClosed()){
  const finalState=await page.evaluate(()=>{const d=window.__YUNSHAN__;return {position:d.controller.position,floor:d.controller.floor,inside:d.controller.inside?.id??null,money:d.simulation.state.player.money,homeId:d.simulation.state.player.homeId,role:d.simulation.state.player.role,identities:[...d.simulation.state.player.identities],hour:d.simulation.state.hour,speed:d.simulation.state.speed};});await dump('final-actual-state',finalState);
  const disposal=await page.evaluate(()=>{const d=window.__YUNSHAN__,before=window.__BODY_RESIDENCY__();d.dispose();return {before,after:window.__BODY_RESIDENCY__()};}).catch(e=>({error:String(e)}));await dump('actual-disposal',disposal);
  if(disposal.error||disposal.after.actualSceneGroups!==0||disposal.after.ownedGeometryCount!==0||disposal.after.interiorBuildingRefs!==0)failures.push({stage:'owned-disposal',data:disposal});
 }
 await browser?.close();server.kill('SIGTERM');const sourceEnd=await verifyFixedSource();
 await dump('roundtrip-results',{status:failures.length||errors.length?'failed':'passed',id:f.id,scope:'New05 related26/strict-build only, full npm NOT_RUN. Single existing home controlled compiled-body roundtrip; no ordinary-player/reference-art/Mac claim',sourceStart,sourceEnd,runnerSHA256:createHash('sha256').update(await readFile(import.meta.filename)).digest('hex'),initial,captures,routes,commands,permissions,holeNegatives,failures,errors,warnings,old04Failure:'PRESERVED_UNCHANGED',newSourceFullRules:'NOT_RUN',naturalNPCDoorEntry:'NOT_RUN',naturalNPCBedUse:'NOT_RUN',referenceArt:'NOT_REASSESSED_AS_PASS'});
}
if(failures.length||errors.length)process.exitCode=1;
