import * as THREE from 'three';
import type { Citizen, LifeProfile, Quality, SimState, Vec3 } from '../types';

export interface CitizenPose { yaw: number; phase: number; walking: boolean; seated: boolean; dead: boolean }
export interface CitizenPart { name: string; position: Vec3; size: Vec3; color: string; pivot?: Vec3; rotationX?: number; face?: boolean; garment?: number }
export interface CitizenAppearance { height: number; clothing: 'robe' | 'jacket'; hair: 'short' | 'long'; hat: boolean; bag: boolean; parts: CitizenPart[] }
type Detail = 'near' | 'far';
const hash = (text: string) => { let value=2166136261;for(const char of text)value=Math.imul(value^char.charCodeAt(0),16777619);return value>>>0; };
const q = (n:number) => Math.max(.2,Math.round(n/.2)*.2);
const p = (x:number,y:number,z:number):Vec3 => ({x,y,z});
const skins=['#d6b391','#c89e7d','#b98b69','#e4c3a3','#b77d5b'];
const coats=['#365d5b','#688478','#47617e','#8b6956','#a98563','#b49a72','#6e7680','#78617e'];
const pants=['#3c4844','#4b505c','#61574e','#40434f'];
const faceDistance = (quality:Quality) => quality==='low'?40:quality==='high'?140:85;
export function citizenBodyHeight(age:number):number { return age<2?.6:age<6?1:age<12?1.2:age<18?1.6:1.8; }

/** Clothes and hair are a stable visual presentation, not biological identity.
 * Every solid limb/garment dimension uses the same 0.2m quantum as the world. */
export function describeCitizen(citizen:Citizen,profile?:Pick<LifeProfile,'age'|'alive'>,pose:CitizenPose={yaw:0,phase:0,walking:false,seated:false,dead:false},detail:Detail='near'):CitizenAppearance {
  const seed=hash(citizen.id),age=profile?.age??30,height=citizenBodyHeight(age),clothing=seed%3===0?'robe':'jacket',hair=seed%5===0?'long':'short',hat=age>=12&&(seed%4===0||/警|police|卫|soldier|官|official/.test(citizen.role)),bag=age>=6&&seed%3===1;
  const skin=skins[seed%skins.length],hairColor=age>=62?'#92938d':seed%4===0?'#5b4538':'#2e302c';
  const coat=/警|police/.test(citizen.role)?'#546d85':/卫|soldier/.test(citizen.role)?'#69785c':/师|teacher/.test(citizen.role)?'#7b977d':/商|merchant/.test(citizen.role)?'#a87d50':coats[seed%coats.length],trouser=pants[(seed>>>3)%pants.length];
  const parts:CitizenPart[]=[],add=(name:string,position:Vec3,size:Vec3,color:string,extra:Partial<CitizenPart>={})=>parts.push({name,position,size,color,...extra});
  const headBase=height-.2,hip=Math.max(.2,Math.min(q(height*.45),headBase-.2)),leg=Math.max(.2,hip-.2),torso=Math.max(.2,headBase-hip);
  add('torso',p(0,hip+torso/2,0),p(.4,torso,.2),coat,{garment:clothing==='robe'?2:1});
  add('head',p(0,height-.1,0),p(.2,.2,.2),skin,{face:detail==='near'});
  if(height<=.6){add('feet',p(0,.1,.1),p(.4,.2,.2),'#41423d');return {height,clothing,hair,hat:false,bag:false,parts};}
  const swing=pose.walking&&!pose.dead&&!pose.seated?Math.sin(pose.phase)*.58:0;
  for(const side of [-1,1]){
    const angle=pose.seated?-Math.PI/2:swing*side;
    if(detail==='near'){
      const upper=q(leg/2),lower=Math.max(.2,leg-upper);
      add(`thigh-${side}`,p(side*.1,hip-upper/2,0),p(.2,upper,.2),trouser,{pivot:p(side*.1,hip,0),rotationX:angle});
      // Lower leg follows the same actual stride around the hip; a seated calf
      // remains vertical below the real seat, rather than walking through it.
      if(pose.seated)add(`calf-${side}`,p(side*.1,hip-.1,upper),p(.2,lower,.2),trouser);
      else add(`calf-${side}`,p(side*.1,hip-upper-lower/2,0),p(.2,lower,.2),trouser,{pivot:p(side*.1,hip,0),rotationX:angle});
      add(`shoe-${side}`,pose.seated?p(side*.1,hip-lower,upper+.1):p(side*.1,.1,.1),p(.2,.2,.4),'#3e413c',pose.seated?{}:{pivot:p(side*.1,hip,0),rotationX:angle});
    }else add(`leg-${side}`,p(side*.1,hip-leg/2,0),p(.2,leg,.2),trouser,{pivot:p(side*.1,hip,0),rotationX:angle});
    const arm=Math.max(.2,q(torso*.75)),armAngle=pose.seated?-.7:-swing*side;
    add(`sleeve-${side}`,p(side*.3,headBase-arm/2,0),p(.2,arm,.2),coat,{pivot:p(side*.3,headBase,0),rotationX:armAngle});
    if(detail==='near')add(`hand-${side}`,p(side*.3,headBase-arm-.1,0),p(.2,.2,.2),skin,{pivot:p(side*.3,headBase,0),rotationX:armAngle});
  }
  if(detail==='near'){
    add('hair-back',p(0,height-.1,-.2),p(.2,.2,.2),hairColor);
    if(hair==='long')add('long-hair',p(0,height-.3,-.2),p(.2,.4,.2),hairColor);
    if(clothing==='robe'&&!pose.seated)add('robe',p(0,hip+.1,0),p(.4,.4,.4),coat);
    if(hat)add('hat',p(0,height+.1,0),p(.4,.2,.4),/警|police/.test(citizen.role)?'#3f536c':hairColor);
    if(bag)add('satchel',p(.4,hip+.1,-.1),p(.2,.4,.2),'#806142');
  }
  return {height,clothing,hair,hat,bag,parts};
}

/** Shared face ink has no extra eye/mouth triangles and needs no DOM canvas. */
export function createCitizenFaceTexture():THREE.DataTexture {
  const width=32*6,height=16,data=new Uint8Array(width*height*4);data.fill(255);
  const pixel=(style:number,x:number,y:number,r:number,g:number,b:number,a=255)=>{const offset=(y*width+style*32+x)*4;data[offset]=r;data[offset+1]=g;data[offset+2]=b;data[offset+3]=a;};
  for(let style=0;style<6;style++){
    const elder=style%3===1,child=style%3===2,tense=style>=3,hair=elder?[212,215,203]:child?[73,53,41]:[61,49,40];
    for(const x of [21,26])for(let dx=0;dx<2;dx++)for(let dy=0;dy<(elder?1:2);dy++)pixel(style,x+dx,9+dy,38,40,38);
    for(let x=23;x<26;x++)pixel(style,x,tense?3:4,133,76,61);
    if(tense){pixel(style,22,4,133,76,61);pixel(style,26,4,133,76,61);}
    else if(child){pixel(style,22,5,133,76,61);pixel(style,26,5,133,76,61);}
    for(let y=elder?6:11;y<16;y++)for(let x=16;x<32;x++)if(y>=14||x<(elder?19:18)||x>=(elder?29:30))pixel(style,x,y,hair[0],hair[1],hair[2],192);
    for(const x of [21,26])for(let dx=0;dx<3;dx++)pixel(style,x+dx,tense?12-(dx%2):12,elder?176:59,elder?180:49,elder?168:42,192);
    if(elder){for(const y of [6,7]){pixel(style,20,y,133,117,99);pixel(style,28,y,133,117,99);}for(let x=22;x<28;x++)pixel(style,x,13,171,151,128);}
  }
  const texture=new THREE.DataTexture(data,width,height);texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;texture.colorSpace=THREE.SRGBColorSpace;texture.needsUpdate=true;return texture;
}
export function citizenFaceStyle(age:number,mood=60,stress=20):number{return (age>=62?1:age<18?2:0)+(mood<35||stress>70?3:0);}
interface Motion { position:Vec3; yaw:number; phase:number }

/** Two shared instanced draws replace a draw per resident. The state is read
 * only: a pose follows physical displacement, with no independent walk clock. */
export class CitizenAppearancePool {
  readonly group=new THREE.Group();
  private readonly geometry=new THREE.BoxGeometry(1,1,1);
  private readonly headGeometry=new THREE.BoxGeometry(1,1,1);
  private readonly texture=createCitizenFaceTexture();
  private readonly material=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.96});
  private readonly faceMaterial=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.96,map:this.texture});
  private readonly body:THREE.InstancedMesh;
  private readonly faces:THREE.InstancedMesh;
  private readonly faceStyles:THREE.InstancedBufferAttribute;
  private readonly garments:THREE.InstancedBufferAttribute;
  private readonly motion=new Map<string,Motion>();
  private stateRef:SimState|null=null;
  private readonly dummy=new THREE.Object3D();
  private readonly color=new THREE.Color();
  private readonly yawRotation=new THREE.Quaternion();
  private readonly upAxis=new THREE.Vector3(0,1,0);
  private disposed=false;
  constructor(parent:THREE.Group|THREE.Scene,readonly capacity=1024){
    if(!Number.isSafeInteger(capacity)||capacity<1||capacity>2048)throw Error('居民实例容量须为1至2048。');
    const uv=this.headGeometry.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setX(i,(i>=16&&i<20?.5:0)+uv.getX(i)*.5);uv.needsUpdate=true;
    this.faceStyles=new THREE.InstancedBufferAttribute(new Float32Array(capacity),1);this.faceStyles.setUsage(THREE.DynamicDrawUsage);this.headGeometry.setAttribute('instanceFaceStyle',this.faceStyles);
    this.garments=new THREE.InstancedBufferAttribute(new Float32Array(capacity*24),1);this.garments.setUsage(THREE.DynamicDrawUsage);this.geometry.setAttribute('instanceGarment',this.garments);
    this.faceMaterial.customProgramCacheKey=()=> 'yunshan-citizen-age-face-v1';
    this.faceMaterial.onBeforeCompile=shader=>{
      shader.vertexShader='attribute float instanceFaceStyle;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nvMapUv.x=(vMapUv.x+instanceFaceStyle)/6.0;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nvec4 faceInk=texture2D(map,vMapUv);if(faceInk.a<.88)diffuseColor.rgb=faceInk.rgb;diffuseColor.a=1.0;');
    };
    this.material.customProgramCacheKey=()=> 'yunshan-citizen-clothes-v1';
    this.material.onBeforeCompile=shader=>{
      shader.vertexShader='attribute float instanceGarment;varying float vGarment;varying vec3 vClothesPosition;varying vec3 vClothesNormal;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGarment=instanceGarment;vClothesPosition=position;vClothesNormal=normal;');
      shader.fragmentShader='varying float vGarment;varying vec3 vClothesPosition;varying vec3 vClothesNormal;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        if(vGarment>.5){vec2 cloth=vClothesPosition.xy+.5;diffuseColor.rgb*=.98+sin(cloth.x*92.0)*sin(cloth.y*64.0)*.025;
          if(vClothesNormal.z>.5){float collar=step(.73,cloth.y)*(1.0-smoothstep(.024,.055,abs(abs(cloth.x-.5)-(1.0-cloth.y)*.65)));float lapel=1.0-smoothstep(.016,.038,abs(cloth.x-(.5+(cloth.y-.5)*(vGarment>1.5?.32:.12))));float belt=1.0-smoothstep(.025,.048,abs(cloth.y-.19));float fastener=(1.0-smoothstep(.02,.045,abs(cloth.x-.53)))*(1.0-smoothstep(.025,.05,abs(fract(cloth.y*5.0)-.5)));diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*.52,max(lapel,belt)*.8);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.55,.47,.32),max(collar,fastener));}
        }`);
    };
    this.body=new THREE.InstancedMesh(this.geometry,this.material,capacity*24);this.faces=new THREE.InstancedMesh(this.headGeometry,this.faceMaterial,capacity);
    this.body.name='居民 · 0.2m人体与衣饰合批';this.faces.name='居民 · 近景面孔彩绘合批';this.group.name='真实居民 · 衣饰步态与生命状态';
    for(const mesh of [this.body,this.faces]){mesh.count=0;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;this.group.add(mesh);}parent.add(this.group);
  }
  update(state:SimState,cameraPosition:Vec3,_elapsed:number,renderDistance:number,quality:Quality='balanced'):void {
    if(this.disposed)return;
    if(this.stateRef!==state){this.motion.clear();this.stateRef=state;}
    const visibleDistance=Math.min(renderDistance,quality==='low'?1000:1900),faceRange=faceDistance(quality),fullRange=quality==='low'?65:quality==='high'?180:110;
    const buried=new Set((state.family?.ceremonies??[]).filter(c=>c.kind==='funeral'&&c.completedAt!==null).map(c=>c.subjectId));
    let bodyCount=0,faceCount=0,residents=0,corpses=0;
    for(const citizen of state.citizens){
      const profile=state.extension?.actorProfiles[citizen.id],dead=profile?.alive===false||citizen.state==='dead';
      const range=Math.hypot(citizen.position.x-cameraPosition.x,citizen.position.y-cameraPosition.y,citizen.position.z-cameraPosition.z);
      const previous=this.motion.get(citizen.id),dx=previous?citizen.position.x-previous.position.x:0,dz=previous?citizen.position.z-previous.position.z:0,travel=Math.hypot(dx,dz);
      const seated=citizen.state==='riding',walking=citizen.state==='moving'&&!seated&&!dead;
      const routePoint=citizen.route?.[citizen.routeIndex??0],initialYaw=routePoint?Math.atan2(routePoint.x-citizen.position.x,routePoint.z-citizen.position.z):hash(citizen.id)%628/100;
      const yaw=travel>.001&&travel<50?Math.atan2(dx,dz):previous?.yaw??initialYaw;
      const phase=(previous?.phase??0)+(walking&&!state.paused&&travel<50?travel*Math.PI/1.1:0);
      this.motion.set(citizen.id,{position:{...citizen.position},yaw,phase});
      if(residents>=this.capacity||buried.has(citizen.id)||range>(dead?faceRange:visibleDistance)||!dead&&citizen.tier==='statistical')continue;
      const pose={yaw,phase,walking,seated,dead},detail=!dead&&range<=fullRange?'near':'far',appearance=describeCitizen(citizen,profile,pose,detail);
      this.yawRotation.setFromAxisAngle(this.upAxis,yaw);
      for(const part of appearance.parts){
        const face=part.face&&range<=faceRange,mesh=face?this.faces:this.body,index=face?faceCount++:bodyCount++;
        if(face)this.faceStyles.setX(index,citizenFaceStyle(profile?.age??30,profile?.mood??60,profile?.stress??20));else this.garments.setX(index,part.garment??0);
        let {x,y,z}=part.position;
        if(part.pivot&&part.rotationX){const dy=y-part.pivot.y,dz=z-part.pivot.z,c=Math.cos(part.rotationX),s=Math.sin(part.rotationX);y=part.pivot.y+dy*c-dz*s;z=part.pivot.z+dy*s+dz*c;}
        if(dead){const priorY=y;y=.1-z;z=priorY;}
        const c=Math.cos(yaw),s=Math.sin(yaw);this.dummy.position.set(citizen.position.x+x*c+z*s,citizen.position.y+y,citizen.position.z+z*c-x*s);
        this.dummy.rotation.set((part.rotationX??0)+(dead?Math.PI/2:0),0,0);this.dummy.quaternion.premultiply(this.yawRotation);
        this.dummy.scale.set(part.size.x,part.size.y,part.size.z);this.dummy.updateMatrix();mesh.setMatrixAt(index,this.dummy.matrix);mesh.setColorAt(index,this.color.set(part.color));
      }
      residents++;if(dead)corpses++;
    }
    const ids=new Set(state.citizens.map(c=>c.id));for(const id of this.motion.keys())if(!ids.has(id))this.motion.delete(id);
    for(const [mesh,count]of [[this.body,bodyCount],[this.faces,faceCount]]as const){mesh.count=count;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.visible=count>0;}
    this.faceStyles.needsUpdate=true;this.garments.needsUpdate=true;
    this.group.userData.budget={residents,corpses,bodyInstances:bodyCount,faceInstances:faceCount,drawCalls:Number(bodyCount>0)+Number(faceCount>0),triangles:(bodyCount+faceCount)*12};
  }
  dispose():void{if(this.disposed)return;this.disposed=true;this.group.removeFromParent();this.group.clear();this.geometry.dispose();this.headGeometry.dispose();this.material.dispose();this.faceMaterial.dispose();this.texture.dispose();this.motion.clear();}
}
