// External diagnostic runner reuses the production visual-review preview/page
// setup and actual coherent05 submit/residency observers. No application rebuild.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { config,sha,requireRootReady,verifyFixedSource } from './fixed-source-gate.mjs';
import { installResidency,sceneSubmission,controlledWalk } from './body-capture-observers.mjs';
await requireRootReady();const sourceStart=await verifyFixedSource();
assert.equal(process.cwd(),config.snapshot);
const {chromium}=await import(path.join(config.snapshot,'node_modules/playwright-core/index.mjs'));
const output=path.resolve(process.argv[2]);await mkdir(output,{recursive:true});
const prepared=JSON.parse(await readFile(new URL('./body-fixtures.json',import.meta.url),'utf8'));
const extra=JSON.parse(await readFile(new URL('./body-extra.json',import.meta.url),'utf8'));
const port=4198,server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port',String(port),'--strictPort'],{stdio:['ignore','pipe','pipe']});
let startup='',browser,page;const captures=[],routes=[],failures=[],errors=[],warnings=[],fixtures=[];
server.stdout.on('data',d=>startup+=d);server.stderr.on('data',d=>startup+=d);
const url=`http://127.0.0.1:${port}/?debug=1`;
async function newFixture(site,position,reason){
  page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});page.setDefaultTimeout(120_000);
  page.on('pageerror',e=>errors.push({site:site.id,error:e.message}));
  page.on('console',m=>{if(m.type()==='error')errors.push({site:site.id,error:m.text()});if(m.type()==='warning')warnings.push({site:site.id,warning:m.text()});});
  await page.goto(url,{waitUntil:'networkidle',timeout:120_000});await page.waitForFunction(()=>window.__YUNSHAN__?.simulation?.state.tick>=1,null,{timeout:120_000});
  const initial=await page.evaluate(({site,position,reason})=>{
    const d=window.__YUNSHAN__,b=d.world.buildings.find(b=>b.id===site.id);
    if(d.world.seed!==20261001||d.world.layoutVersion!=='current-v4'||!b||b.floorPlanProfile!==site.profile||JSON.stringify(b.door)!==JSON.stringify(site.door))throw Error('Loaded body disagrees with frozen fixture');
    d.actions.command({type:'pause',value:1});d.actions.command({type:'speed',value:1});d.actions.command({type:'setTime',value:12});
    d.actions.setQuality('balanced');d.city.setDynamicResolution(false);d.city.renderer.setPixelRatio(1);d.city.camera.fov=48;d.city.camera.updateProjectionMatrix();
    // Exactly one declared initial body fixture placement; no subsequent body,
    // floor, identity, stock, cash or clock writes. Original traveler retained.
    d.simulation.state.player.position={...position};d.controller.setMode('walk',position);d.controller.yaw=site.rotation;d.controller.pitch=-.05;d.controller.orient();
    return {reason,requestedPosition:position,actualPosition:d.controller.position,inside:d.controller.inside?.id??null,floor:d.controller.floor,
      identities:[...d.simulation.state.player.identities],role:d.simulation.state.player.role,money:d.simulation.state.player.money,
      actualFloorPermissions:{ground:d.canAccessBuilding(b,0),upper:d.canAccessBuilding(b,1)},initialClock:d.simulation.state.hour,speed:d.simulation.state.speed};
  },{site,position,reason});fixtures.push({id:site.id,...initial});
  await installResidency(page);await page.waitForTimeout(150);
}
async function capture(site,name,probes=[],lookTarget=null){
  if(lookTarget)await page.evaluate(target=>{const c=window.__YUNSHAN__.controller,p=c.position;
    c.yaw=Math.atan2(-(target.x-p.x),-(target.z-p.z));c.pitch=Math.atan2(target.y-(p.y+1.72),Math.hypot(target.x-p.x,target.z-p.z));c.orient();},lookTarget);
  const data=await sceneSubmission(page,site.id,probes);data.name=name;data.buildingId=site.id;
  data.declaredDiagnosticCameraAim=lookTarget;
  data.scope='Actual WebGL fixed-source controlled body capture; not a normal player journey or Mac performance/reference-art pass.';
  await page.screenshot({path:path.join(output,name+'.png'),timeout:120_000});
  await writeFile(path.join(output,name+'.json'),JSON.stringify(data,null,2));captures.push(data);
  if(data.glErrors.length||data.shaderPrograms.some(p=>p.diagnostics?.runnable===false)||data.residency.hiddenFarMismatch||data.residency.stats.failures)failures.push({site:site.id,stage:name,failure:'Actual GL/program/residency errors'});
  if(data.optics.pixelRatio!==1||data.optics.fov!==48||data.optics.width!==1440||data.optics.height!==900||data.optics.speed!==1)failures.push({site:site.id,stage:name,failure:'Fixed optics or normal speed changed'});
  console.log('Captured '+name+' '+JSON.stringify({body:data.actualBody,submission:data.submission}));
  return data;
}
async function walk(site,points,label){const result=await controlledWalk(page,points,label);routes.push({buildingId:site.id,...result});
  await writeFile(path.join(output,label+'-route.json'),JSON.stringify(result,null,2));
  await page.waitForTimeout(150);if(result.status!=='passed')throw Error(result.failure);return result;}
async function closeFixture(site){if(!page||page.isClosed())return;
  const release=await page.evaluate(()=>{const d=window.__YUNSHAN__,before=window.__BODY_RESIDENCY__();d.dispose();return {before,after:window.__BODY_RESIDENCY__()};}).catch(e=>({failure:String(e)}));
  await writeFile(path.join(output,site.id+'-dispose-'+fixtures.length+'.json'),JSON.stringify(release,null,2));await page.close();page=null;
}
try{
  for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error(startup);if(startup.includes(`http://127.0.0.1:${port}`))break;if(i===99)throw Error('Own strictPort preview marker missing');await new Promise(r=>setTimeout(r,100));}
  const response=await fetch(`http://127.0.0.1:${port}/`);assert.equal(response.status,200);assert((await response.text()).includes(config.entry));
  browser=await chromium.launch({executablePath:process.env.YUNSHAN_CHROMIUM??'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  for(const site of prepared.sites){const prefix=`v4-${site.family}-${site.id}`;
    try{
      await newFixture(site,site.outside,'Fresh controlled traveler at actual outside entrance, one initial placement');await capture(site,prefix+'-door');
      await walk(site,[site.outside,site.inside],prefix+'-door-crossing');await capture(site,prefix+'-inside');
      const target=site.routes.find(r=>r.purpose===(site.kind==='market'?'sale':'work'))??site.routes[0];
      await walk(site,target.fromInside,prefix+'-use-point');await capture(site,prefix+'-counter-or-service');
      if(site.kind==='market'){
        const transaction=await page.evaluate(id=>{const d=window.__YUNSHAN__,shop=d.simulation.state.shops.find(s=>s.buildingId===id),before={money:d.simulation.state.player.money,stock:shop?.inventory};
          const result=d.simulation.command({type:'purchase',targetId:id,value:1});return {scope:'Real authoritative purchase at reached shared sale point; original stock/wallet/identity untouched by fixture',before,result,after:{money:d.simulation.state.player.money,stock:shop?.inventory},position:d.controller.position};},site.id);
        await writeFile(path.join(output,prefix+'-actual-purchase.json'),JSON.stringify(transaction,null,2));
        if(!transaction.result.ok||transaction.after.money>=transaction.before.money||transaction.after.stock>=transaction.before.stock)failures.push({site:site.id,stage:'actual-purchase',data:transaction});
      }
      // Return by the same physical path, then reach the real stair platform.
      await walk(site,[...target.fromInside].reverse(),prefix+'-return-to-door');
      const court=site.courts.find(c=>c.routeFromInside);if(court){await walk(site,court.routeFromInside,prefix+'-court');await capture(site,prefix+'-courtyard');await walk(site,[...court.routeFromInside].reverse(),prefix+'-return-from-court');}
      if(site.stairs){
        await walk(site,site.toStairs,prefix+'-stairs-approach');
        const permissions=await page.evaluate(id=>{const d=window.__YUNSHAN__,b=d.world.buildings.find(b=>b.id===id);return {ground:d.canAccessBuilding(b,0),upper:d.canAccessBuilding(b,1)};},site.id);
        await writeFile(path.join(output,prefix+'-stair-permissions.json'),JSON.stringify(permissions,null,2));
        if(permissions.upper){
          const turn=site.floor0.stairLandings.find(s=>s.id==='half-turn'),turnZ=(turn.rect.z0+turn.rect.z1)/2;
          const midIndex=site.stairs.findIndex((p,index)=>index>0&&Math.abs(p.y-site.position.y-.6-turn.top)<.01&&Math.abs((p.x-site.position.x)*Math.sin(site.rotation)+(p.z-site.position.z)*Math.cos(site.rotation)-turnZ)<.01);
          if(midIndex<1)throw Error('Actual provider half-turn waypoint absent');
          await walk(site,site.stairs.slice(0,midIndex+1),prefix+'-stairs-up-first-flight');await capture(site,prefix+'-stairs-half-turn',[],site.stairs[0]);
          await walk(site,site.stairs.slice(midIndex),prefix+'-stairs-up-second-flight');const top=await capture(site,prefix+'-stairs-upper',[{...site.stairs.at(-1),minY:site.stairs.at(-1).y-.4,maxY:site.stairs.at(-1).y+.4}],site.stairs[midIndex]);
          if(top.actualBody.floor!==1||Math.abs(top.actualBody.position.y-site.stairs.at(-1).y)>.025)throw Error('Actual two-flight motor did not reach upper floor');
          const hole=extra.extra.find(s=>s.id===site.id)?.upperVoid;
          if(hole){await walk(site,hole.route,prefix+'-upper-void-approach');
            const negative=await controlledWalk(page,[hole.approach,hole.target],prefix+'-upper-void-block');routes.push({buildingId:site.id,...negative});
            await writeFile(path.join(output,prefix+'-upper-void-negative.json'),JSON.stringify({staticProvider:hole,actual:negative},null,2));
            await capture(site,prefix+'-upper-void',[{...hole.target,minY:hole.target.y-.25,maxY:hole.target.y+.25}],hole.target);
            if(negative.status==='passed'&&Math.abs(negative.end.y-hole.target.y)<.05)failures.push({site:site.id,stage:'upper-void',failure:'Actual body walked unsupported upper void'});
            // Return using the same actual approach path; no relocation after a negative test.
            const current=await page.evaluate(()=>window.__YUNSHAN__.controller.position);
            await walk(site,[current,hole.approach,...[...hole.route].reverse().slice(1)],prefix+'-return-from-upper-void');
          }
          await walk(site,site.downStairs,prefix+'-stairs-down');const lower=await capture(site,prefix+'-stairs-lower');
          if(lower.actualBody.floor!==0||Math.abs(lower.actualBody.position.y-site.stairs[0].y)>.025)throw Error('Actual two-flight motor did not descend to original floor');
        }else failures.push({site:site.id,stage:'stairs-upper',status:'not-reached',reason:'Actual unchanged traveler lacks upper access; no identity injected'});
      }
    }catch(error){failures.push({site:site.id,stage:'controlled-body',failure:String(error)});if(page&&!page.isClosed())await capture(site,prefix+'-failure').catch(e=>errors.push({site:site.id,error:String(e)}));}
    finally{await closeFixture(site);}
  }
  // Separate roof-restoration fixture. It is not evidence of travel from ground
  // to the roof, and it never relocates a body midway through a previous route.
  const home=prepared.sites.find(s=>s.family==='home'),roof=home.roofs.find(r=>r.region.kind==='gable'&&r.support);
  if(roof){try{await newFixture(home,roof.point,'Separate declared restored-body roof fixture, one initial position; not rooftop travel');
    await capture(home,'v4-home-roof-restoration',[{...roof.point,minY:roof.point.y-.4,maxY:roof.point.y+.4}]);
    const axis=roof.region.gableAxis==='x'?'z':'x',target={...roof.point,[axis]:roof.point[axis]+.4};
    await walk(home,[roof.point,target],'v4-home-roof-actual-motor');await capture(home,'v4-home-roof-walk');
  }catch(error){failures.push({site:home.id,stage:'roof',failure:String(error)});}finally{await closeFixture(home);}}
}catch(error){failures.push({stage:'runner',failure:String(error)});}
finally{
  await browser?.close();server.kill('SIGTERM');const sourceEnd=await verifyFixedSource();
  await writeFile(path.join(output,'body-results.json'),JSON.stringify({status:errors.length||failures.length?'failed':'passed',scope:'Actual Linux SwiftShader controlled diagnostics using original production motor/DOM KeyW at normal speed. Distinct from native elapsed-frame ordinary URL journey; no reference-art or Mac performance claim.',
    sourceStart,sourceEnd,runnerSHA256:sha(await readFile(import.meta.filename)),fixtures,routes,captures,failures,errors,warnings},null,2));
}
if(errors.length||failures.length)process.exitCode=1;
