import * as THREE from 'three';
import {writeFileSync} from 'node:fs';
import {createWorld,terrainHeight} from './src/world';
import {buildLandscape} from './src/rendering/terrain';
const world=createWorld(), landscape=buildLandscape(world), meshes=landscape.group.children.filter(o=>o.name.startsWith('山形合批代理')) as THREE.Mesh[];
const camera=new THREE.PerspectiveCamera(48,1440/900,.12,18000);camera.position.set(440,325,640);camera.lookAt(210,215,-45);camera.updateMatrixWorld();landscape.group.updateMatrixWorld(true);
const ray=new THREE.Raycaster(), results:any[]=[];
for(const [px,py]of [[960,832],[927,836],[1193,491],[1004,863],[1076,893],[1264,217]]){
 ray.setFromCamera(new THREE.Vector2((px+.5)/1440*2-1,1-(py+.5)/900*2),camera);
 const front=ray.intersectObjects(meshes,false)[0];for(const m of meshes)(m.material as THREE.Material).side=THREE.DoubleSide;
 const double=ray.intersectObjects(meshes,false)[0];for(const m of meshes)(m.material as THREE.Material).side=THREE.FrontSide;
 let ground:any=null;for(let t=1;t<7000;t+=2){const p=ray.ray.at(t,new THREE.Vector3());if(Math.abs(p.x)>2200||Math.abs(p.z)>2200)continue;if(p.y<=terrainHeight(world,p.x,p.z,false)){ground={distance:t,point:p.toArray(),height:terrainHeight(world,p.x,p.z,false)};break;}}
 results.push({pixel:[px,py],front:front?{distance:front.distance,point:front.point.toArray(),mesh:front.object.name,face:front.faceIndex}:null,double:double?{distance:double.distance,point:double.point.toArray(),mesh:double.object.name,face:double.faceIndex}:null,ground});
}
const edges=new Map<string,{count:number,a:number[],b:number[]}>();let triangles=0;
for(const m of meshes){const p=m.geometry.getAttribute('position'),ind=m.geometry.index!;triangles+=ind.count/3;for(let i=0;i<ind.count;i+=3){const ids=[ind.getX(i),ind.getX(i+1),ind.getX(i+2)];for(let j=0;j<3;j++){const a=ids[j],b=ids[(j+1)%3],pa=[p.getX(a),p.getY(a),p.getZ(a)],pb=[p.getX(b),p.getY(b),p.getZ(b)];const sa=pa.join(':'),sb=pb.join(':'),key=sa<sb?sa+'|'+sb:sb+'|'+sa,e=edges.get(key);if(e)e.count++;else edges.set(key,{count:1,a:pa,b:pb});}}}
const open=[...edges.values()].filter(e=>e.count===1&& !((Math.abs(e.a[0])===2208&&e.a[0]===e.b[0])||(Math.abs(e.a[2])===2208&&e.a[2]===e.b[2])));
const output={worldVersion:world.layoutVersion,triangles,unpairedInteriorEdges:open.length,rayResults:results,openExamples:open.slice(0,30)};writeFileSync('/tmp/yunshan-geology-seam-prototype/probe-results.json',JSON.stringify(output,null,2));console.log(JSON.stringify({...output,openExamples:output.openExamples.slice(0,3)},null,2));landscape.dispose();
