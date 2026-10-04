import * as THREE from 'three';
import type { Building, CityRendererAPI, NetworkEdge, Quality, SimState, Vec3, WorldDefinition } from './types';
import { samplePolyline, terrainHeight } from './world';
import { RoadClosureOverlay } from './rendering/road-closures';
import { getFloorDimensions, getStairPosition } from './access';
import { buildLandscape } from './rendering/terrain';
import { createRoofGeometry, type RoofProfile } from './rendering/architecture-layout';
import { buildProgramArchitecture, type ArchitectureTemplate } from './rendering/architecture-bodies';
import { buildingWorldPosition, getBuildingFloorPlan } from './architecture-floor-plan';
import { ArchitectureDetailManager, architectureFacadeLayout } from './rendering/architecture-detail';
import { CitizenAppearancePool } from './rendering/citizen-appearance';
import { MarketGoodsPool } from './rendering/market-goods';
import { MarketShopfrontPool } from './rendering/market-shopfront';
import { marketCounters } from './site-fixtures';
import { createBuildingRenderChunks, disposeNearChunkGroup, NearChunkResidency } from './rendering/chunk-residency';
import { deckWidth, guardrailOffset, guardrailSpans, hasGuardrailAt, GUARDRAIL_THICKNESS } from './transport-geometry';

const PALETTE = { wall: '#d2c9b6', stone: '#a0ab9f', wood: '#73533b', roof: '#456760', glass: '#6c938c', amber: '#ffd39a', cyan: '#82d9d0', red: '#954c40', metal: '#a3b1bb' };
type MaterialKey = keyof typeof PALETTE;
interface Part { matrix: THREE.Matrix4; color: THREE.Color; building?: string; floor?: number; roof?: boolean; ceiling?: boolean; distanceDetail?: boolean; facade?: readonly [number, number, number, number]; profile?: { form: RoofProfile['form']; simple: boolean; innerHole?: RoofProfile['innerHole'] }; template?: ArchitectureTemplate }
interface InteriorRef { mesh: THREE.InstancedMesh; index: number; matrix: THREE.Matrix4; floor: number; roof: boolean; ceiling?: boolean }
type LocalBox = { (key: MaterialKey, x: number, y: number, z: number, sx: number, sy: number, sz: number, floor?: number, roof?: boolean, color?: string): void; profile?: (profile: RoofProfile) => void };

function offsetBox(box: LocalBox, x: number, z: number): LocalBox {
  const shifted: LocalBox = (key, xx, yy, zz, sx, sy, sz, floor, roof, color) => box(key, xx + x, yy, zz + z, sx, sy, sz, floor, roof, color);
  if (box.profile) shifted.profile = profile => box.profile!({ ...profile, x: profile.x + x, z: profile.z + z });
  return shifted;
}

/** Static geometry is grouped by material; long networks are also spatially split. */
class BoxBatch {
  private parts = new Map<MaterialKey, Part[]>();
  constructor(private materials: Record<MaterialKey, THREE.MeshStandardMaterial>) {}
  box(key: MaterialKey, x: number, y: number, z: number, sx: number, sy: number, sz: number, color?: string, rotation = 0, tag?: { building?: string; floor?: number; roof?: boolean; ceiling?: boolean }, profile?: { form: RoofProfile['form']; simple: boolean; innerHole?: RoofProfile['innerHole'] }, facade?: Part['facade'], template?: ArchitectureTemplate) {
    if (sx <= 0 || sy <= 0 || sz <= 0) return;
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation), new THREE.Vector3(sx, sy, sz));
    const list = this.parts.get(key) ?? [];
    list.push({ matrix, color: new THREE.Color(color ?? PALETTE[key]), ...tag, profile, facade, template }); this.parts.set(key, list);
  }
  segment(key: MaterialKey, a: Vec3, b: Vec3, width: number, height: number, lift = 0, color?: string) {
    const va = new THREE.Vector3(a.x, a.y + lift, a.z), vb = new THREE.Vector3(b.x, b.y + lift, b.z);
    const direction = vb.clone().sub(va), length = direction.length();
    if (length < .01) return;
    const matrix = new THREE.Matrix4().compose(va.add(vb).multiplyScalar(.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize()), new THREE.Vector3(width, height, length));
    const list = this.parts.get(key) ?? []; list.push({ matrix, color: new THREE.Color(color ?? PALETTE[key]), distanceDetail: width <= .4 && height <= .24 }); this.parts.set(key, list);
  }
  build(refs?: Map<string, InteriorRef[]>, cellSize = 0): THREE.Group {
    const group = new THREE.Group();
    for (const [key, allParts] of this.parts) {
      const cells = new Map<string, Part[]>();
      for (const part of allParts) {
        const cell = (cellSize ? `${Math.floor(part.matrix.elements[12] / cellSize)}:${Math.floor(part.matrix.elements[14] / cellSize)}` : 'all') + (part.distanceDetail ? ':detail' : '') + (part.template ? `:template:${part.template.key}` : part.profile ? `:${part.profile.form}:${part.profile.simple}:${part.profile.innerHole?.join(',') ?? 'solid'}` : ':box');
        const list = cells.get(cell) ?? []; list.push(part); cells.set(cell, list);
      }
      for (const [cell, parts] of cells) {
      const template = parts[0].template;
      const geometry = template ? new THREE.BufferGeometry() : parts[0].profile ? createRoofGeometry(parts[0].profile.form, parts[0].profile.simple, parts[0].profile.innerHole) : new THREE.BoxGeometry(1, 1, 1);
      if (template) {
        // Every batch matrix is centred. The shared roof template is converted
        // from its original minimum-corner anchor exactly once by its producer.
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(template.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(template.normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(template.uvs, 2));
        geometry.setIndex(template.indices);
      }
      const mesh = new THREE.InstancedMesh(geometry, this.materials[key], parts.length);
      if (key === 'wall' || key === 'wood') mesh.geometry.setAttribute('instanceFacade', new THREE.InstancedBufferAttribute(new Float32Array(parts.flatMap(part => [...part.facade ?? [0, 0, 0, 0]])), 4));
      // The same material also paints transport and old furniture. Only the
      // authoritative roof tag enables tile relief; the scalar shares the
      // resident geometry's lifetime and introduces no per-tile instances.
      if (key === 'roof') mesh.geometry.setAttribute('instanceRoofSurface', new THREE.InstancedBufferAttribute(new Float32Array(parts.map(part => part.roof ? 1 : 0)), 1));
      // Only existing building panes receive lattice/illumination. Transport
      // windscreens share the glass material but carry a zero surface flag.
      if (key === 'glass') mesh.geometry.setAttribute('instanceWindowSurface', new THREE.InstancedBufferAttribute(new Float32Array(parts.map(part => part.building ? 1 : 0)), 1));
      mesh.name = `batch-${key}-${cell}`;
      parts.forEach((part, index) => {
        mesh.setMatrixAt(index, part.matrix); mesh.setColorAt(index, part.color);
        if (part.building && refs) { const list = refs.get(part.building) ?? []; list.push({ mesh, index, matrix: part.matrix, floor: part.floor ?? -1, roof: part.roof ?? false, ...(part.ceiling ? { ceiling: true } : {}) }); refs.set(part.building, list); }
      });
      mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere(); mesh.receiveShadow = true; mesh.userData.distanceDetail = !!parts[0].distanceDetail; group.add(mesh);
      }
    }
    this.parts.clear(); return group;
  }
}

interface CityChunk { center: Vec3; radius: number; detail: THREE.Group; near: boolean; buildingIds: Set<string> }
interface NearCityResource { group: THREE.Group; refs: Map<string, InteriorRef[]> }
interface MovingPool { body: THREE.InstancedMesh; head: THREE.InstancedMesh; trim: THREE.InstancedMesh; capacity: number }

export class CityRenderer implements CityRendererAPI {
  readonly camera = new THREE.PerspectiveCamera(48, 1, .12, 18000);
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  private materials: Record<MaterialKey, THREE.MeshStandardMaterial>;
  private landscape: ReturnType<typeof buildLandscape>;
  private architectureDetail: ArchitectureDetailManager;
  private chunks: CityChunk[] = [];
  private nearChunks!: NearChunkResidency<NearCityResource>;
  private distanceDetails: THREE.InstancedMesh[] = [];
  private interiors = new Map<string, InteriorRef[]>();
  private distantRefs = new Map<string, InteriorRef[]>();
  private insideId: string | null = null;
  private insideFloor = 0;
  private quality: Quality = 'balanced';
  private distance = 6500;
  private dynamicResolution = true;
  private resolutionScale = 1;
  private lastRender = 0;
  private frameAverage = 20;
  private adaptAt = 0;
  private sun = new THREE.DirectionalLight('#ffeac4', 2.3);
  private moon = new THREE.DirectionalLight('#a5c6e7', .16);
  private fill = new THREE.HemisphereLight('#a3d5dc', '#475747', 1.7);
  private groundBounce = new THREE.DirectionalLight('#d3d5b2', .35);
  private interiorLights = [new THREE.PointLight('#ffe5b5', 1900, 160, 2), new THREE.PointLight('#ffe5b5', 1900, 160, 2)];
  private sunOrb: THREE.Mesh;
  private moonOrb: THREE.Mesh;
  private stars: THREE.Points;
  private mist: THREE.Points;
  private spray: THREE.Points;
  private shadowAt = -Infinity;
  private shadowPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  private facadeNight = { value: 0 };
  private sky: THREE.Mesh;
  private skyMaterial: THREE.ShaderMaterial;
  private citizens: CitizenAppearancePool;
  private marketGoods: MarketGoodsPool;
  private marketShopfront: MarketShopfrontPool;
  private roadClosures: RoadClosureOverlay;
  private signalRed: THREE.InstancedMesh;
  private signalGreen: THREE.InstancedMesh;
  private vehiclePools = new Map<string, MovingPool>();
  private matrix = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private scale = new THREE.Vector3();
  private rotation = new THREE.Quaternion();
  private axis = new THREE.Vector3(0, 1, 0);
  private edges = new Map<string, NetworkEdge>();
  private colors = new Map<string, THREE.Color>();
  private labels: { building: Building; sprite: THREE.Sprite; floor?: number }[] = [];

  constructor(private container: HTMLElement, private world: WorldDefinition) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor('#a9ccd1');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(512, 512);
    Object.assign(this.sun.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 10, far: 7000 });
    this.sun.shadow.bias = -.0003; this.sun.shadow.normalBias = .35;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.domElement.setAttribute('aria-label', '云山巨城实时三维世界');
    this.container.appendChild(this.renderer.domElement);
    this.materials = Object.fromEntries(Object.keys(PALETTE).filter(key => key !== 'metal' || this.world.buildings.some(site => site.commercialGeometryRevision === 1)).map(key => [key, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: key === 'glass' ? .25 : key === 'metal' ? .42 : .83, metalness: key === 'glass' ? .32 : key === 'metal' ? .72 : .05, emissive: key === 'cyan' ? '#66dccf' : key === 'amber' ? '#ffb05a' : '#000000', emissiveIntensity: key === 'cyan' ? .4 : key === 'amber' ? .7 : 0 })])) as Record<MaterialKey, THREE.MeshStandardMaterial>;
    for (const key of ['wall', 'wood', 'stone'] as const) { this.materials[key].customProgramCacheKey = () => `yunshan-architecture-${key}-v5`; this.materials[key].onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 vArchitecture;varying vec3 vArchitectureNormal;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 architecture=vec4(transformed,1.0);
        #ifdef USE_INSTANCING
        architecture=instanceMatrix*architecture;
        #endif
        vArchitecture=(modelMatrix*architecture).xyz;
        vec3 architectureNormal=normal;
        #ifdef USE_INSTANCING
        architectureNormal=mat3(instanceMatrix)*architectureNormal;
        #endif
        vArchitectureNormal=normalize(mat3(modelMatrix)*architectureNormal);`);
      shader.fragmentShader = 'varying vec3 vArchitecture;varying vec3 vArchitectureNormal;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec3 grainCell=floor(vArchitecture*5.0);
        float pigment=fract(sin(dot(grainCell,vec3(12.9898,78.233,39.425)))*43758.5453);
        float pigmentDetail=1.0-smoothstep(.2,1.0,length(fwidth(vArchitecture)));
        diffuseColor.rgb*=mix(1.0,.96+pigment*.08,pigmentDetail);
        ${key === 'wood' ? `
          float timberGrain=sin(vArchitecture.y*31.0+sin(vArchitecture.x*2.7)*1.4);
          diffuseColor.rgb*=mix(1.0,.96+timberGrain*.045,pigmentDetail);
          if(vArchitectureNormal.y<-.5)diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.26,.155,.085),.3);` : ''}`);
      if (key === 'stone') {
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          // The existing stone solids retain their dimensions. Metric joints
          // supply human-scale .8/.6m paving and 1.2/.4m masonry, with derivative
          // filtering; this is surface relief, not another floor or collision.
          bool paving=vArchitectureNormal.y>.55;
          vec2 stoneMetric=paving?vArchitecture.xz:abs(vArchitectureNormal.z)>.5?vArchitecture.xy:vArchitecture.zy;
          vec2 stoneSize=paving?vec2(.8,.6):vec2(1.2,.4);
          float course=floor(stoneMetric.y/stoneSize.y);
          vec2 stoneUv=vec2(stoneMetric.x+mod(course,2.0)*stoneSize.x*.5,stoneMetric.y)/stoneSize;
          vec2 stonePixel=max(fwidth(stoneUv),vec2(.001));
          vec2 stoneEdge=min(fract(stoneUv),1.0-fract(stoneUv))*stoneSize;
          float stoneDetail=1.0-smoothstep(.28,.85,max(stonePixel.x,stonePixel.y));
          float joint=(1.0-smoothstep(.009,.021+max(stonePixel.x*stoneSize.x,stonePixel.y*stoneSize.y),min(stoneEdge.x,stoneEdge.y)))*stoneDetail;
          float blockTone=fract(sin(dot(floor(stoneUv),vec2(23.13,91.7)))*18317.4);
          diffuseColor.rgb*=mix(1.0,.92+blockTone*.14,stoneDetail);
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.16,.19,.17),joint*.34);
          float stoneRelief=-joint*.004;`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec3 stoneDx=dFdx(-vViewPosition),stoneDy=dFdy(-vViewPosition);
          vec3 stoneR1=cross(stoneDy,normal),stoneR2=cross(normal,stoneDx);
          float stoneDet=dot(stoneDx,stoneR1)*faceDirection;
          vec3 stoneGrad=dFdx(stoneRelief)*stoneR1+dFdy(stoneRelief)*stoneR2;
          if(abs(stoneDet)>1e-10)normal=normalize(abs(stoneDet)*normal-sign(stoneDet)*stoneGrad);`);
      }
      if (key === 'wood') {
        shader.vertexShader = 'attribute vec4 instanceFacade;varying vec4 vCabinet;varying vec3 vCabinetPosition;varying vec3 vCabinetNormal;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCabinet=instanceFacade;vCabinetPosition=position;vCabinetNormal=normal;');
        shader.fragmentShader = 'varying vec4 vCabinet;varying vec3 vCabinetPosition;varying vec3 vCabinetNormal;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          float cabinetRelief=0.0;
          if(vCabinet.w>.5 && vCabinetNormal.z>.5 && vCabinet.y>.2){
            vec2 panel=(vCabinetPosition.xy+.5)*vCabinet.xy;
            vec2 pixel=max(fwidth(panel),vec2(.001));
            float rowHeight=(vCabinet.y-.2)/3.0;
            float row=(panel.y-.2)/rowHeight;
            float horizontal=min(fract(row),1.0-fract(row))*rowHeight;
            float vertical=min(panel.x-.2,vCabinet.x-.2-panel.x);
            float inset=smoothstep(0.0,pixel.x,vertical)*smoothstep(.2,.2+pixel.y,panel.y);
            float groove=(1.0-smoothstep(.012,.025+pixel.y,horizontal))*inset;
            vec2 pull=vec2(abs(panel.x-vCabinet.x*.5),abs(fract(row)-.5)*rowHeight);
            float handle=(1.0-smoothstep(.16,.18+pixel.x,pull.x))*(1.0-smoothstep(.025,.045+pixel.y,pull.y))*inset;
            float cabinetDetail=1.0-smoothstep(.04,.16,max(pixel.x,pixel.y));
            groove*=cabinetDetail;handle*=cabinetDetail;
            diffuseColor.rgb*=1.0-groove*.3;
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.55,.38,.17),handle*.85);
            cabinetRelief=-groove*.008+handle*.012;
          }`);
        // Unparametrized surface gradients, in view-space metres. The relief
        // changes lighting only; the cabinet's intact solid and depth stay put.
        shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          vec3 cabinetDx=dFdx(-vViewPosition),cabinetDy=dFdy(-vViewPosition);
          vec3 cabinetR1=cross(cabinetDy,normal),cabinetR2=cross(normal,cabinetDx);
          float cabinetDet=dot(cabinetDx,cabinetR1)*faceDirection;
          vec3 cabinetGrad=dFdx(cabinetRelief)*cabinetR1+dFdy(cabinetRelief)*cabinetR2;
          if(abs(cabinetDet)>1e-10)normal=normalize(abs(cabinetDet)*normal-sign(cabinetDet)*cabinetGrad);`);
      }
      if (key === 'wall') {
        shader.uniforms.facadeNight = this.facadeNight;
        shader.vertexShader = 'attribute vec4 instanceFacade;varying vec4 vFacade;varying vec3 vProxyPosition;varying vec3 vProxyNormal;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade=instanceFacade;vProxyPosition=position;vProxyNormal=normal;');
        shader.fragmentShader = 'uniform float facadeNight;varying vec4 vFacade;varying vec3 vProxyPosition;varying vec3 vProxyNormal;\n' + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          float proxyWindow=0.0;
          if(vFacade.y>0.0 && abs(vProxyNormal.y)<.5){
            bool front=vProxyNormal.z>.5;bool side=abs(vProxyNormal.x)>.5;
            vec2 uv=vec2(front?vProxyPosition.x:vProxyPosition.z,vProxyPosition.y)+.5;
            float rows=floor(vFacade.y+.001),windowHeight=fract(vFacade.y)*10.0;
            float row=fract(uv.y*rows);
            bool broad=vFacade.z>.2;
            float spacing=front?(broad?.46:.8/max(1.0,vFacade.x-1.0)):.3;
            float origin=front?(broad?.27:.1):.2;
            float n=clamp(floor((uv.x-origin)/spacing+.5),0.0,front?vFacade.x-1.0:2.0);
            float centre=origin+n*spacing;
            float ww=front?vFacade.z:vFacade.w;
            float xx=abs(uv.x-centre),yy=abs(row-(front&&broad?.52:.57));
            float permitted=(front||side)?1.0:0.0;
            if(front&&!broad&&abs(centre-.5)<.1)permitted=0.0;
            float frame=permitted*(1.0-smoothstep(ww*.5+.004,ww*.5+.011,xx))*(1.0-smoothstep(windowHeight*.5,windowHeight*.5+.035,yy));
            proxyWindow=permitted*(1.0-smoothstep(ww*.5-.007,ww*.5,xx))*(1.0-smoothstep(windowHeight*.5-.03,windowHeight*.5,yy));
            float lattice=1.0-smoothstep(.015,.035,abs(fract((uv.x-centre)*24.0)-.5));
            float crossbar=1.0-smoothstep(.02,.035,abs(row-.57));
            float beam=1.0-smoothstep(.045,.07,min(row,1.0-row));
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.14,.10,.063),max(frame,beam)*.9);
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.115,.245,.255),proxyWindow*(1.0-max(lattice,crossbar)*.6));
          }`);
        shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=proxyWindow*facadeNight*vec3(.40,.27,.13);');
      }
    }; }
    this.materials.glass.roughness = .42; this.materials.glass.metalness = .12;
    this.materials.glass.customProgramCacheKey = () => 'yunshan-window-lattice-v1';
    this.materials.glass.onBeforeCompile = shader => {
      shader.uniforms.facadeNight = this.facadeNight;
      shader.vertexShader = 'attribute float instanceWindowSurface;varying float vWindowSurface;varying vec3 vWindowMetric;varying vec3 vWindowExtent;varying vec3 vWindowNormal;varying float vWindowSeed;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 windowScale=vec3(1.0);vec3 windowOrigin=vec3(0.0);
        #ifdef USE_INSTANCING
        windowScale=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
        windowOrigin=instanceMatrix[3].xyz;
        #endif
        vWindowMetric=(position+.5)*windowScale;vWindowExtent=windowScale;vWindowNormal=normal;vWindowSurface=instanceWindowSurface;
        vWindowSeed=fract(sin(dot(windowOrigin,vec3(12.9898,78.233,39.425)))*43758.5453);`);
      shader.fragmentShader = 'uniform float facadeNight;varying float vWindowSurface;varying vec3 vWindowMetric;varying vec3 vWindowExtent;varying vec3 vWindowNormal;varying float vWindowSeed;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float windowPane=0.0,windowWarmth=0.0;
        if(vWindowSurface>.5 && abs(vWindowNormal.y)<.5 && min(vWindowExtent.x,vWindowExtent.z)<.5){
          bool windowFront=abs(vWindowNormal.z)>.5;
          vec2 paneMetric=windowFront?vWindowMetric.xy:vWindowMetric.zy;
          vec2 paneExtent=windowFront?vWindowExtent.xy:vWindowExtent.zy;
          vec2 panePixel=max(fwidth(paneMetric),vec2(.002));
          float paneDetail=1.0-smoothstep(.09,.32,max(panePixel.x,panePixel.y));
          vec2 paneEdge=min(paneMetric,paneExtent-paneMetric);
          float frame=1.0-smoothstep(.045,.07+max(panePixel.x,panePixel.y),min(paneEdge.x,paneEdge.y));
          vec2 latticeCell=paneMetric/vec2(.4,.6);
          vec2 latticeEdge=min(fract(latticeCell),1.0-fract(latticeCell))*vec2(.4,.6);
          float lattice=1.0-smoothstep(.015,.033+max(panePixel.x,panePixel.y),min(latticeEdge.x,latticeEdge.y));
          float timber=max(frame,lattice)*paneDetail;
          windowPane=1.0-timber;
          windowWarmth=mix(.24,1.0,step(.34,vWindowSeed));
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.18,.115,.063),timber*.92);
          diffuseColor.rgb*=1.0-(1.0-paneMetric.y/max(.2,paneExtent.y))*.18*windowPane;
          // Illumination follows existing night/energy state. Its static per
          // pane variation is decorative; it does not invent room occupancy.
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.46,.30,.13),facadeNight*windowWarmth*windowPane*.34);
        }`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=windowPane*windowWarmth*facadeNight*vec3(.48,.27,.095);');
    };
    this.materials.roof.customProgramCacheKey = () => 'yunshan-tiled-roof-v3';
    this.materials.roof.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float instanceRoofSurface;varying float vRoofSurface;varying vec3 vRoofMetric;varying vec3 vRoofNormal;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 roofScale=vec3(1.0);
        #ifdef USE_INSTANCING
        roofScale=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
        #endif
        vRoofMetric=position*roofScale;vRoofNormal=normalize(normal/max(roofScale,vec3(.001)));vRoofSurface=instanceRoofSurface;`);
      shader.fragmentShader = 'varying float vRoofSurface;varying vec3 vRoofMetric;varying vec3 vRoofNormal;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float roofRelief=0.0;
        if(vRoofSurface>.5 && vRoofNormal.y<-.18){
          // Roof undersides remain opaque and keep the same solid silhouette.
          // Timber albedo and shallow beam joints receive the real hemisphere
          // bounce instead of turning a near eave into a black screen block.
          vec2 soffitMetric=vRoofMetric.xz;
          vec2 soffitPixel=max(fwidth(soffitMetric),vec2(.002));
          vec2 soffitEdge=min(fract(soffitMetric/vec2(.6,1.2)),1.0-fract(soffitMetric/vec2(.6,1.2)))*vec2(.6,1.2);
          float soffitDetail=1.0-smoothstep(.12,.45,max(soffitPixel.x,soffitPixel.y));
          float beam=(1.0-smoothstep(.035,.06+max(soffitPixel.x,soffitPixel.y),min(soffitEdge.x,soffitEdge.y)))*soffitDetail;
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.29,.18,.10),.9)*(1.0-beam*.28);
          roofRelief=beam*.006;
        }else if(vRoofSurface>.5 && abs(vRoofNormal.y)>.18){
          // .4m tile barrels run down the actual slope, with .6m laps. The
          // opposite gable axis uses the other horizontal coordinate; metric
          // scaling retains the same pattern through instancing and rotation.
          bool slopeX=abs(vRoofNormal.x)>abs(vRoofNormal.z);
          vec2 metric=slopeX?vRoofMetric.zx:vRoofMetric.xz;
          metric.y/=max(.2,abs(vRoofNormal.y));
          vec2 tile=metric*vec2(2.5,1.0/.6);
          vec2 width=max(fwidth(tile),vec2(.005));
          vec2 edge=min(fract(tile),1.0-fract(tile));
          float detail=1.0-smoothstep(.3,.9,max(width.x,width.y));
          float barrel=.5-.5*cos(tile.x*6.283185);
          float across=1.0-smoothstep(.035,.035+width.x*1.2,edge.x);
          float lap=1.0-smoothstep(.035,.035+width.y*1.2,edge.y);
          float glaze=.92+barrel*.1-across*.16-lap*.10;
          diffuseColor.rgb*=mix(1.0,glaze,detail);
          roofRelief=(barrel*.012-lap*.004)*detail;
        }`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        vec3 roofDx=dFdx(-vViewPosition),roofDy=dFdy(-vViewPosition);
        vec3 roofR1=cross(roofDy,normal),roofR2=cross(normal,roofDx);
        float roofDet=dot(roofDx,roofR1)*faceDirection;
        vec3 roofGrad=dFdx(roofRelief)*roofR1+dFdy(roofRelief)*roofR2;
        if(abs(roofDet)>1e-10)normal=normalize(abs(roofDet)*normal-sign(roofDet)*roofGrad);`);
    };
    this.scene.add(this.sun, this.sun.target, this.moon, this.fill, this.groundBounce, this.groundBounce.target);
    for (const light of this.interiorLights) { light.visible = false; this.scene.add(light); }
    this.sun.position.set(-1100, 2200, 500); this.moon.position.set(1300, 1300, -900);
    this.scene.fog = new THREE.FogExp2('#a9ccd1', .00016);
    this.skyMaterial = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { top: { value: new THREE.Color('#6da7bd') }, horizon: { value: new THREE.Color('#c3d6ce') }, daylight: { value: 1 } }, vertexShader: 'varying vec3 vPos;void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}', fragmentShader: `uniform vec3 top;uniform vec3 horizon;uniform float daylight;varying vec3 vPos;
      float ink(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,39.425)))*43758.5453);}
      float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);float a=mix(mix(ink(i),ink(i+vec3(1,0,0)),f.x),mix(ink(i+vec3(0,1,0)),ink(i+vec3(1,1,0)),f.x),f.y);float b=mix(mix(ink(i+vec3(0,0,1)),ink(i+vec3(1,0,1)),f.x),mix(ink(i+vec3(0,1,1)),ink(i+vec3(1,1,1)),f.x),f.y);return mix(a,b,f.z);}
      void main(){vec3 ray=normalize(vPos);float h=pow(max(ray.y,0.0),.4);vec3 color=mix(horizon,top,h);vec3 cloud=ray*vec3(8.0,13.0,8.0);float n=noise(cloud)*.64+noise(cloud*2.07)*.24+noise(cloud*4.13)*.12;float cover=smoothstep(.55,.72,n)*smoothstep(.08,.3,ray.y);color=mix(color,mix(horizon,vec3(.96,.97,.94),.65),cover*daylight*.55);gl_FragColor=vec4(color,1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }` });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(14000, 24, 12), this.skyMaterial); this.sky.renderOrder = -10; this.sky.frustumCulled = false; this.scene.add(this.sky);
    this.sunOrb = new THREE.Mesh(new THREE.SphereGeometry(68, 12, 8), new THREE.MeshBasicMaterial({ color: '#fff0bb' }));
    this.moonOrb = new THREE.Mesh(new THREE.SphereGeometry(38, 12, 8), new THREE.MeshBasicMaterial({ color: '#d6e5e0' }));
    this.scene.add(this.sunOrb, this.moonOrb);
    this.stars = this.buildStars(); this.scene.add(this.stars);
    this.mist = this.buildMist(); this.scene.add(this.mist);
    this.spray = this.buildSpray(); this.scene.add(this.spray);
    this.landscape = buildLandscape(world); this.scene.add(this.landscape.group);
    this.roadClosures = new RoadClosureOverlay(world); this.scene.add(this.roadClosures.group);
    this.buildCity(); this.buildNetwork(); this.buildGateways(); this.buildCoreLabels();
    this.architectureDetail = new ArchitectureDetailManager(world.buildings); this.scene.add(this.architectureDetail.group);
    const signalCount = this.world.nodes.filter(node => node.station).length;
    this.signalRed = new THREE.InstancedMesh(new THREE.BoxGeometry(.7, .55, .35), new THREE.MeshBasicMaterial({ color: '#ffffff' }), signalCount);
    this.signalGreen = new THREE.InstancedMesh(new THREE.BoxGeometry(.7, .55, .35), new THREE.MeshBasicMaterial({ color: '#ffffff' }), signalCount);
    for (const signal of [this.signalRed, this.signalGreen]) { signal.instanceMatrix.setUsage(THREE.DynamicDrawUsage); signal.frustumCulled = false; this.scene.add(signal); }
    this.citizens = new CitizenAppearancePool(this.scene, 1024);
    this.marketGoods = new MarketGoodsPool(this.scene, world);
    this.marketShopfront = new MarketShopfrontPool(this.scene, world);
    for (const kind of ['road', 'maglev', 'lightRail', 'cable', 'lift', 'ferry', 'bridge', 'flight']) {
      const capacity = Math.max(32, this.world.edges.filter(edge => edge.mode === kind).length * 3);
      this.vehiclePools.set(kind, this.makePool(capacity, this.materials.roof, this.materials.glass, this.materials.cyan));
    }
    const arrivalShop = this.world.buildings.filter(b => b.kind === 'market' && b.districtId === 'market').sort((a, b) => Math.hypot(a.door.x - world.spawn.x, a.door.z - world.spawn.z) - Math.hypot(b.door.x - world.spawn.x, b.door.z - world.spawn.z))[0];
    this.camera.position.set(world.spawn.x, world.spawn.y + 1.72, world.spawn.z);
    this.camera.lookAt(arrivalShop?.door.x ?? world.spawn.x, world.spawn.y + 1.2, arrivalShop?.door.z ?? world.spawn.z - 60);
    this.resize();
  }

  private buildCity() {
    const chunks = createBuildingRenderChunks(this.world.buildings), far = new BoxBatch(this.materials);
    for (const building of this.world.buildings) this.buildHouse(building, far, true);
    const distant = far.build(this.distantRefs, 384); distant.name = '建筑远景 · 分区轮廓'; this.scene.add(distant);
    this.nearChunks = new NearChunkResidency(chunks, {
      create: chunk => {
        const batch = new BoxBatch(this.materials), refs = new Map<string, InteriorRef[]>();
        try {
          for (const building of chunk.buildings) this.buildHouse(building, batch, false);
          const group = batch.build(refs); group.name = `建筑近景 ${chunk.id}`; return { group, refs };
        } catch (error) {
          const meshes = new Set([...refs.values()].flatMap(list => list.map(ref => ref.mesh)));
          meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.dispose(); }); refs.clear(); throw error;
        }
      },
      activate: (chunk, resource, near) => {
        if (near) { this.scene.add(resource.group); for (const [id, refs] of resource.refs) this.interiors.set(id, refs); }
        else { this.scene.remove(resource.group); for (const id of chunk.buildingIds) this.interiors.delete(id); }
        for (const id of chunk.buildingIds) for (const ref of this.distantRefs.get(id) ?? []) { ref.mesh.setMatrixAt(ref.index, near ? new THREE.Matrix4().makeScale(0, 0, 0) : ref.matrix); ref.mesh.instanceMatrix.needsUpdate = true; }
        // Creation can follow an eviction while the same room remains selected.
        // Apply the cutaway to the newly published matrices without an id guard.
        if (near && this.insideId && chunk.buildingIds.has(this.insideId)) this.applyInteriorRefs(this.insideId, this.insideFloor);
      },
      release: (_chunk, resource) => { disposeNearChunkGroup(resource.group); resource.refs.clear(); },
    });
  }

  private buildHouse(b: Building, batch: BoxBatch, far: boolean) {
    const programParts = buildProgramArchitecture(b, far ? 'far' : 'near');
    if (programParts) {
      for (const part of programParts) {
        const position = buildingWorldPosition(b, part.position);
        batch.box(part.material, position.x, position.y, position.z, part.size.x, part.size.y, part.size.z,
          part.color, b.rotation, { building: b.id, floor: part.floor, roof: part.roof, ceiling: part.purpose === 'floor' || part.purpose === 'roof' }, undefined, part.facade, part.template);
      }
      return;
    }
    const w = b.width, d = b.depth, height = b.height, base = b.position.y + .6, floors = Math.max(1, b.floors), fh = height / floors, basements = Math.max(0, b.basements ?? 0);
    const wallColor = b.kind === 'workshop' ? '#a39681' : b.kind === 'bank' ? '#a7b9b6' : b.kind === 'police' ? '#8d9992' : b.kind === 'clinic' ? '#d5ded0' : b.kind === 'school' ? '#dbd4b8' : b.kind === 'hall' || b.kind === 'core' ? '#c6b78f' : b.kind === 'station' || b.kind === 'airport' || b.kind === 'starport' ? '#acbfbc' : ['#cfc6b0', '#c0bea7', '#e2d5ba', '#c8b7a0'][b.seed % 4];
    const emit = (key: MaterialKey, x: number, y: number, z: number, sx: number, sy: number, sz: number, floor: number, roof: boolean, color?: string) => {
      const c = Math.cos(b.rotation), s = Math.sin(b.rotation), material = far && key === 'wood' ? 'roof' : far && key === 'stone' ? 'wall' : key;
      batch.box(material, b.position.x + x * c + z * s, base + y, b.position.z + z * c - x * s, sx, far && key === 'amber' && sy < .5 ? .65 : sy, sz, color ?? PALETTE[key], b.rotation, { building: b.id, floor, roof });
    };
    const box: LocalBox = (key, x, y, z, sx, sy, sz, floor = -1, roof = false, color) => {
      if (!far && roof && floor >= 0 && floor < floors - 1 && y + sy / 2 > (floor + 1) * fh + .05) {
        const next = getFloorDimensions(b, floor + 1), ax = x - sx / 2, bx = x + sx / 2, az = z - sz / 2, bz = z + sz / 2, hw = next.width / 2, hd = next.depth / 2;
        if (ax < hw && bx > -hw && az < hd && bz > -hd) {
          const left = Math.min(bx, -hw), right = Math.max(ax, hw), rear = Math.min(bz, -hd), front = Math.max(az, hd), mx = Math.max(ax, -hw), nx = Math.min(bx, hw);
          if (left > ax) emit(key, (ax + left) / 2, y, z, left - ax, sy, sz, floor, roof, color);
          if (bx > right) emit(key, (right + bx) / 2, y, z, bx - right, sy, sz, floor, roof, color);
          if (rear > az && nx > mx) emit(key, (mx + nx) / 2, y, (az + rear) / 2, nx - mx, sy, rear - az, floor, roof, color);
          if (bz > front && nx > mx) emit(key, (mx + nx) / 2, y, (front + bz) / 2, nx - mx, sy, bz - front, floor, roof, color);
          return;
        }
      }
      emit(key, x, y, z, sx, sy, sz, floor, roof, color);
    };
    box.profile = profile => {
      const c = Math.cos(b.rotation), s = Math.sin(b.rotation), rw = profile.width + profile.overhang * 2, rd = profile.depth + profile.overhang * 2;
      let innerHole: RoofProfile['innerHole'];
      if (!far && profile.floor >= 0 && profile.floor < floors - 1 && profile.y + .4 + profile.rise > (profile.floor + 1) * fh + .05) {
        const next = getFloorDimensions(b, profile.floor + 1);
        const outward = (n: number, direction: number) => Math.max(-.5, Math.min(.5, direction < 0 ? Math.floor(n * 100) / 100 : Math.ceil(n * 100) / 100));
        innerHole = [outward((-next.width / 2 - profile.x) / rw, -1), outward((next.width / 2 - profile.x) / rw, 1), outward((-next.depth / 2 - profile.z) / rd, -1), outward((next.depth / 2 - profile.z) / rd, 1)];
      }
      batch.box('roof', b.position.x + profile.x * c + profile.z * s, base + profile.y + .4, b.position.z + profile.z * c - profile.x * s,
        rw, profile.rise, rd, profile.color, b.rotation,
        { building: b.id, floor: profile.floor, roof: true }, { form: profile.form, simple: profile.simple, innerHole });
    };
    box('stone', 0, -basements * fh - .5, 0, w + 3, 1.2, d + 3, -basements - 1);
    // South-facing doorway and stone apron always connect to the actual door node.
    box('stone', 0, -.35, d / 2 + 2.4, Math.min(7, w * .32), .7, 6, 0);
    if (b.kind === 'core') {
      box('stone', 0, -.18, d / 2 + 4, w * .68, .36, 12, 0);
      for (const x of [-w * .31, -w * .2, -w * .1, w * .1, w * .2, w * .31]) { box('wood', x, 2.75, d / 2 + 6, 1.2, 5.5, 1.2, 0); box('stone', x, .35, d / 2 + 6, 2, .7, 2, 0); }
      this.roof(offsetBox(box, 0, d / 2 + 4), w * .68, 8, 5.5, 0, .65);
    }
    if (b.kind === 'pavilion') {
      for (const x of [-w * .4, w * .4]) for (const z of [-d * .4, d * .4]) box('wood', x, height * .4, z, 1.15, height * .8, 1.15, 0);
      box('wood', 0, 1.1, -d * .3, w * .75, .4, 1.4, 0);
      box('wood', -w * .32, 1.1, 0, 1.4, .4, d * .7, 0);
      box('wood', w * .32, 1.1, 0, 1.4, .4, d * .7, 0);
      this.roof(box, w, d, height * .78, 0, 1.1);
      this.roof(box, w * .5, d * .5, height + 2.2, 0, .65);
      for (const x of [-w * .4, w * .4]) box('amber', x, height * .62, d * .4, .85, 1.3, .85, 0);
      return;
    }
    if (far) {
      for (let first = 0; first < floors;) {
        const dimension = getFloorDimensions(b, first); let end = first + 1;
        while (end < floors) { const next = getFloorDimensions(b, end); if (next.width !== dimension.width || next.depth !== dimension.depth) break; end++; }
        const bw = dimension.width, bd = dimension.depth, bottom = first * fh, bodyEnd = b.kind === 'core' && end === floors ? end - 1 : end, tall = (bodyEnd - first) * fh;
        const layout = architectureFacadeLayout(b, first), front = layout.windows.filter(window => window.face === 'front'), side = layout.windows.find(window => window.face === 'left');
        const count = b.kind === 'core' ? 2 : front.length > 1 ? Math.round(bw * .8 / (front[1].x - front[0].x)) + 1 : 2;
        batch.box('wall', b.position.x, base + bottom + tall / 2, b.position.z, bw, tall, bd, wallColor, b.rotation, { building: b.id, floor: -1 }, undefined, [count, bodyEnd - first + (front[0]?.height ?? 0) / fh * .1, (front[0]?.width ?? 0) / bw, (side?.width ?? 0) / bd]);
        if (bodyEnd !== end) { for (const x of [-bw * .44, bw * .44]) for (const z of [-bd * .44, bd * .44]) box('wood', x, bodyEnd * fh + fh / 2, z, 1.2, fh, 1.2); for (const x of [-bw * .48, bw * .48]) box('wood', x, bodyEnd * fh + 1.1, 0, .2, .2, bd); box('wood', 0, bodyEnd * fh + 1.1, bd / 2, bw, .2, .2); }
        this.programRoof(b, box, bw, bd, end * fh, -1, end === floors ? 1 : .65, true);
        if (b.kind === 'core' || b.kind === 'hall' || b.kind === 'home' && floors > 5) this.programRoof(b, box, bw * 1.035, bd * 1.035, bottom + tall * .5, -1, .55, true);
        for (const x of [-bw * .3, bw * .3]) box('wood', x, bottom + tall / 2, bd / 2 + .3, Math.max(.4, bw * .02), tall, .7);
        const litLevels = 1;
        for (let level = 0; level < litLevels; level++) for (const x of [-bw * .24, bw * .24]) box('amber', x, bottom + 2 + (level + .4) * tall / litLevels, bd / 2 + .75, Math.min(4, bw * .12), 1.6, .18);
        first = end;
      }
      this.programExterior(b, box, true);
      return;
    }
    for (let f = -basements; f < floors; f++) {
      const { width: w, depth: d } = getFloorDimensions(b, f);
      const stair = getStairPosition(b, f), hx = stair.x - b.position.x, hz = stair.z - b.position.z;
      const y = f * fh, observation = b.kind === 'core' && f === floors - 1, wallHeight = observation ? 1.1 : Math.max(2.4, fh - .5), doorway = Math.min(5, w * .22), doorH = Math.min(4.4, wallHeight * .72), wallThickness = .4;
      const program = f < 0 ? b.basementUses?.[-f - 1] ?? '' : b.floorUses?.[f] ?? '';
      // Real floors and perimeter walls. The stairwell is left open in upper slabs.
      if (f === -basements) box('stone', 0, y, 0, w, .35, d, f);
      else {
        const hw = Math.min(4, w * .22), hd = Math.min(5, d * .25);
        const left = hx - hw / 2 + w / 2, right = w / 2 - hx - hw / 2, rear = hz - hd / 2 + d / 2, front = d / 2 - hz - hd / 2;
        box('wood', -w / 2 + left / 2, y, 0, left, .32, d, f);
        box('wood', w / 2 - right / 2, y, 0, right, .32, d, f);
        box('wood', hx, y, -d / 2 + rear / 2, hw, .32, rear, f);
        box('wood', hx, y, d / 2 - front / 2, hw, .32, front, f);
      }
      box('wall', 0, y + wallHeight / 2, -d / 2, w, wallHeight, wallThickness, f, false, wallColor);
      const facade = architectureFacadeLayout(b, f), windows = f >= 0 ? facade.windows : [];
      const wall = (face: 'front' | 'left' | 'right', length: number) => {
        const openings = windows.filter(window => window.face === face).map(window => ({ x: window.x, bottom: window.y - y - window.height / 2, top: window.y - y + window.height / 2, width: window.width }));
        if (face === 'front' && f === 0) openings.push({ x: 0, bottom: 0, top: doorH, width: doorway });
        const cuts = [...new Set([-length / 2, length / 2, ...openings.flatMap(window => [Math.max(-length / 2, window.x - window.width / 2), Math.min(length / 2, window.x + window.width / 2)])])].sort((a, b) => a - b);
        const panel = (middle: number, low: number, high: number, span: number) => {
          if (high - low < .01) return;
          if (face === 'front') box('wall', middle, y + (low + high) / 2, d / 2, span, high - low, wallThickness, f, false, wallColor);
          else box('wall', (face === 'left' ? -1 : 1) * w / 2, y + (low + high) / 2, middle, wallThickness, high - low, span, f, false, wallColor);
        };
        for (let i = 1; i < cuts.length; i++) {
          const middle = (cuts[i - 1] + cuts[i]) / 2, span = cuts[i] - cuts[i - 1], opening = openings.find(window => Math.abs(middle - window.x) < window.width / 2 + .001);
          if (opening) { panel(middle, 0, Math.max(0, opening.bottom), span); panel(middle, Math.min(wallHeight, opening.top), wallHeight, span); }
          else panel(middle, 0, wallHeight, span);
        }
      };
      wall('front', w); wall('left', d); wall('right', d);
      if (f === 0) box('wood', 0, y + doorH + .3, d / 2, doorway + .7, .6, .8, f);
      if (f < 0) box('stone', 0, y + wallHeight / 2, d / 2, w, wallHeight, .6, f);
      for (const x of [-w / 2 + .25, w / 2 - .25]) for (const z of [-d / 2 + .25, d / 2 - .25]) box('wood', x, y + wallHeight / 2, z, .7, wallHeight + .2, .7, f);
      for (const window of windows) {
        const cy = window.y, ww = window.width, hh = window.height;
        if (window.face === 'front') {
          box('glass', window.x, cy, d / 2 + .1, ww, hh, .12, f);
          for (const edge of [-1, 1]) { box('wood', window.x + edge * ww / 2, cy, d / 2 + .25, .2, hh + .3, .3, f); box('wood', window.x, cy + edge * hh / 2, d / 2 + .25, ww + .4, .2, .3, f); }
          for (const level of [-.2, .2]) box('wood', window.x, cy + level * hh, d / 2 + .3, ww, .2, .2, f);
        } else {
          const side = window.face === 'left' ? -1 : 1;
          box('glass', side * (w / 2 + .1), cy, window.x, .12, hh, ww, f);
          for (const edge of [-1, 1]) { box('wood', side * (w / 2 + .25), cy, window.x + edge * ww / 2, .3, hh + .3, .2, f); box('wood', side * (w / 2 + .25), cy + edge * hh / 2, window.x, .3, .2, ww + .4, f); }
        }
      }
      box('wood', 0, y + wallHeight, d / 2 + .1, w + .8, .2, .4, f, false, '#806044');
      // Each floor has an actual usable room, a work/commerce table and shelving.
      const tableZ = b.kind === 'home' ? -d * .18 : -d * .12;
      box('wood', w * .14, y + .95, tableZ, Math.min(w * .28, 4.8), .25, Math.min(d * .22, 2.5), f);
      for (const x of [.04, .24]) box('wood', w * x, y + .45, tableZ, .35, .9, .35, f);
      box('wood', w * .35, y + 1.2, -d * .36, Math.min(3, w * .18), 2.4, .75, f);
      box(b.kind === 'home' ? 'roof' : 'amber', w * .14, y + 1.16, tableZ, Math.min(2.2, w * .15), .2, .9, f);
      if (b.kind === 'home') { box('wood', w * .3, y + .42, d * .17, Math.min(3, w * .2), .7, Math.min(4, d * .24), f); box('stone', w * .3, y + .9, d * .17, Math.min(3, w * .2), .3, Math.min(4, d * .24), f); }
      if (b.districtId === 'core' || b.kind === 'core') {
        if (f < 0) {
          for (let row = 0; row < 7; row++) for (let column = 0; column < 12; column++) {
            const x = (column - 5.5) * Math.min(6.5, w * .055), z = -d * .31 + row * Math.min(7, d * .08);
            if (Math.abs(x - hx) < 4 && Math.abs(z - hz) < 4) continue;
            box('wood', x, y + 1.7, z, 4.3, 3.4, 1.5, f);
            for (let shelf = 0; shelf < 4; shelf++) box(f === -2 ? 'amber' : 'stone', x, y + .55 + shelf * .73, z + .8, 3.8, .5, .14, f);
          }
          box('stone', w * .33, y + 2, -d * .37, 6, 4, 1, f); box(f === -2 ? 'amber' : 'cyan', w * .33, y + 2.1, -d * .37 + .55, 2.4, 2.4, .15, f);
          for (const x of [-w * .45, w * .45]) box('amber', x, y + fh * .7, -d * .43, .3, .2, d * .2, f);
        } else if (b.facility === 'data' || b.name.includes('数据') || /数据|科学|信息网络/.test(program)) {
          for (let row = 0; row < 3; row++) for (let column = 0; column < 4; column++) { const x = -w * .2 + column * w * .13, z = -d * .3 + row * d * .14; box('wood', x, y + fh * .31, z, 1.8, fh * .62, 1.6, f); box('cyan', x, y + fh * .31, z + .86, 1.15, fh * .45, .12, f); }
        } else if (b.facility === 'council' || b.name.includes('议会') || /议会|听证/.test(program)) {
          box('wood', 0, y + .7, -d * .31, Math.min(36, w * .47), 1.4, 3.5, f);
          const columns = Math.min(19, Math.floor(w / 4)), middle = Math.floor(columns / 2), rows = Math.min(7, Math.floor(d / 6));
          for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) { if (column === middle) continue; const x = (column - middle) * 3.5, z = -d * .08 + row * 3.8; box('wood', x, y + .6, z, 1.35, .3, 1.2, f); box('roof', x, y + 1.1, z + .5, 1.35, 1.1, .25, f); }
        } else if ((b.facility === 'energy' || b.name.includes('能源')) && b.kind !== 'core') {
          for (const x of [-w * .22, w * .22]) { box('stone', x, y + 1, -d * .18, 3.6, 2, 3.6, f); box('cyan', x, y + fh * .43, -d * .18, 1.6, fh * .75, 1.6, f); }
          box('cyan', 0, y + 1.35, -d * .32, w * .35, .4, .3, f);
        } else if (b.facility === 'emergency' || b.name.includes('应急') || b.name.includes('治安') || /调度|应急|治安|灾害|指挥|通讯/.test(program)) {
          box('wood', 0, y + fh * .45, -d * .43, w * .65, fh * .6, .45, f); box('cyan', 0, y + fh * .46, -d * .43 + .3, w * .58, fh * .48, .12, f);
          for (const x of [-w * .2, w * .2]) box('wood', x, y + 1, -d * .08, w * .22, .3, 2.5, f);
        } else if (b.facility === 'archives' || b.facility === 'treasury') {
          for (const x of [-w * .25, 0, w * .25]) for (const z of [-d * .3, d * .1]) { box('wood', x, y + 1.3, z, w * .16, 2.6, 1.3, f); box(b.facility === 'treasury' ? 'amber' : 'stone', x, y + 1.3, z + .7, w * .14, 1.8, .12, f); }
        } else if (/博物馆|展览|展廊/.test(program)) {
          for (const x of [-w * .23, w * .23]) for (const z of [-d * .25, 0, d * .25]) { box('stone', x, y + .55, z, 5, 1.1, 4, f); box('wall', x, y + 1.5, z, 2.7, .8, 2.4, f); box('roof', x, y + 2.1, z, 3.7, .25, 3.2, f); box('roof', x, y + 2.4, z, 2.6, .25, 2.2, f); }
        } else if (/市长|决策/.test(program)) {
          box('wood', 0, y + 1.1, -d * .18, 8, .35, 4, f); box('roof', 0, y + 1.3, -d * .18, 6.5, .16, 2.8, f); box('cyan', 0, y + 2.8, -d * .4, 15, 4.2, .3, f);
          for (const x of [-w * .2, w * .2]) box('wood', x, y + .65, 0, 2.3, .55, 7, f);
        } else if (b.kind === 'core' && f < 3 || b.facility === 'administration' || b.facility === 'embassy' || b.name.includes('行政') || b.name.includes('使节')) {
          for (const x of [-w * .24, w * .24]) { box('wood', x, y + .75, -d * .15, w * .26, 1.5, 2.2, f); box('amber', x, y + 1.55, -d * .15, w * .2, .1, 1.2, f); }
        } else if (observation) {
          box('wood', 0, y + 1, -d * .21, w * .25, .35, d * .2, f); box('glass', 0, y + 1.4, -d * .21, w * .17, .25, d * .12, f);
          for (const x of [-w * .43, w * .43]) box('wood', x, y + .65, 0, 1.5, .45, d * .6, f);
        }
      }
      if (floors > 1) for (let step = 0; step < 10; step++) box('stone', hx, y + (step + 1) * fh / 20, hz + (step - 5) * Math.min(.42, d * .035), Math.min(2.8, w * .15), (step + 1) * fh / 10, Math.min(.48, d * .04), f);
      const roofPeriod = b.kind === 'core' ? 6 : b.kind === 'home' ? 4 : b.kind === 'hall' || b.kind === 'school' ? 3 : floors;
      const nextWidth = f >= 0 && f < floors - 1 ? getFloorDimensions(b, f + 1).width : w;
      if (f >= 0 && (f === floors - 1 || (f + 1) % roofPeriod === 0 || nextWidth !== w)) this.programRoof(b, box, w * (f === floors - 1 ? 1 : 1.035), d * (f === floors - 1 ? 1 : 1.035), y + fh, f, f === floors - 1 ? 1 : .55, false);
      if (f === 0 || f === floors - 1) for (const x of [-w * .37, w * .37]) { box('amber', x, y + doorH - .4, d / 2 + 1.1, .8, 1.25, .8, f); box('red', x, y + doorH + .35, d / 2 + 1.1, 1, .16, 1, f); }
      for (const x of [-w * .22, w * .22]) { box('amber', x, y + fh * .72, 0, 2.2, .24, 2.2, f); box('wood', x, y + fh * .85, 0, .12, fh * .27, .12, f); }
    }
    this.programExterior(b, box, false);
    // Energy bands are part of the buildings, powered by the simulated core.
    box('cyan', 0, .75, -d / 2 - .35, w + 1, .17, .23, 0);
    if (b.kind === 'core' || b.kind === 'hall' || b.kind === 'starport') {
      for (let tier = 0; tier < 3; tier++) { const y = height * (.3 + tier * .28), floor = Math.floor(y / fh), dimension = getFloorDimensions(b, floor); box('amber', 0, y, dimension.depth / 2 + 1, dimension.width + 4, .3, .35, floor); }
      if (b.kind !== 'core') for (const x of [-w * .42, w * .42]) box('cyan', x, height * .55, d / 2 + .7, .25, height * .85, .25, 0);
    }
  }

  private roof(box: LocalBox, w: number, d: number, y: number, floor: number, magnitude: number, simple = false) {
    const overhang = Math.max(2, Math.min(12, w * .14)), rise = Math.max(2.8, Math.min(14, w * .18)) * magnitude;
    box('wood', 0, y + .12, 0, w + overhang * 1.3, .2, d + overhang * 1.3, floor, true, '#947450');
    const levels = simple ? 3 : Math.max(6, Math.ceil(rise / .4));
    if (box.profile) box.profile({ form: 'hip', x: 0, y, z: 0, width: w, depth: d, rise, overhang, floor, simple, color: '#41605b' });
    else for (let step = 0; step < levels; step++) { const fraction = step / levels; box('roof', 0, y + .4 + fraction * rise, 0, (w + overhang * 2) * (1 - fraction * .78), rise / levels + .2, (d + overhang * 2) * (1 - fraction * .76), floor, true, step % 3 ? '#395f5b' : '#416a61'); }
    box('roof', 0, y + rise + .8, 0, Math.max(1.2, w * .48), .4, Math.max(.6, d * .035), floor, true);
    box('amber', 0, y + .2, d / 2 + overhang * .8, w + overhang, .12, .16, floor, true);
    // Stepped rising corners create a readable flying-eave silhouette.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let i = simple ? 2 : 0; i < 3; i++) box('roof', sx * (w / 2 + overhang * (.45 + i * .2)), y + .7 + i * .43, sz * (d / 2 + overhang * (.45 + i * .2)), overhang * .55, .58, overhang * .55, floor, true);
    if (!simple) {
      for (const x of [-.4, -.2, 0, .2, .4]) for (const side of [-1, 1]) box('wood', x * w, y - .08, side * (d / 2 + overhang * .3), .25, .2, overhang * .9, floor, true, '#b19365');
      // Individual tiled ribs and paired bracket arms read at walking distance.
      for (let x = -w / 2; x <= w / 2; x += Math.max(2, w / 18)) box('roof', x, y + .7, d / 2 + overhang * .7, .2, .2, overhang * .8, floor, true, '#769080');
      for (const x of [-w * .4, -w * .2, 0, w * .2, w * .4]) for (const z of [-d / 2, d / 2]) { box('wood', x, y - .45, z, 1.2, .4, 1.8, floor, true); box('wood', x, y - .15, z, 2, .2, 2.4, floor, true); }
    }
  }

  /** Roof profiles are tied to the building's actual program. Structural slabs,
   * walls, entries, stairs and floor footprints remain the authoritative ones. */
  private programRoof(b: Building, box: LocalBox, w: number, d: number, y: number, floor: number, magnitude: number, far: boolean) {
    const shifted = (ox: number, oz: number) => offsetBox(box, ox, oz);
    const gable = (ox: number, width: number, depth: number, rise: number, color = '#53645b') => {
      const levels = far ? 3 : Math.max(6, Math.ceil(rise / .4));
      box('wood', ox, y + .13, 0, width + 2.4, .26, depth + 2.4, floor, true, '#92714e');
      if (box.profile) box.profile({ form: 'gable', x: ox, y, z: 0, width, depth, rise, overhang: 1.5, floor, simple: far, color });
      else for (let step = 0; step < levels; step++) box('roof', ox, y + .4 + step * rise / levels, 0, width + 3 - step / levels * width, rise / levels + .2, depth + 3, floor, true, color);
      box('wood', ox, y + rise + .5, 0, .6, .6, depth + 4, floor, true);
      for (const z of [-depth / 2 - 1.4, depth / 2 + 1.4]) box('roof', ox, y + rise + .8, z, .8, .4, 2, floor, true, color);
    };
    if (b.kind === 'workshop' && b.districtId !== 'core') {
      const bays = far ? 3 : Math.max(3, Math.round(w / 13));
      for (let bay = 0; bay < bays; bay++) { const width = w / bays, x = -w / 2 + width * (bay + .5); gable(x, width - 1, d, 3.4 * magnitude, '#5e6d64'); box('glass', x + width * .23, y + 1.5, 0, 1.4, .8, d * .7, floor, true); }
    } else if (b.kind === 'home' || b.kind === 'farm') {
      // Terraced family houses and tall apartment blocks share pitched tiles,
      // while the number of ridges changes with the real residential footprint.
      const bays = b.kind === 'farm' ? 1 : w > 35 ? 2 : 1;
      for (let bay = 0; bay < bays; bay++) gable((bay - (bays - 1) / 2) * w / bays, w / bays - .8, d, Math.min(7, w / bays * .21) * magnitude, b.seed % 3 === 0 ? '#605b51' : '#4f6660');
    } else if (b.kind === 'market') {
      gable(0, w * .66, d, 4.8 * magnitude, '#775a47');
      for (const side of [-1, 1]) box('roof', side * w * .4, y + .5, 0, w * .22, .6, d + 3, floor, true, '#766754');
    } else if (b.kind === 'bank' || b.kind === 'clinic') {
      box('stone', 0, y + .3, 0, w + 1.6, .6, d + 1.6, floor, true, b.kind === 'bank' ? '#859d99' : '#a6b8a7');
      for (const side of [-1, 1]) box('wood', side * w * .4, y + 1.8, 0, .6, 3, d * .78, floor, true);
      box('glass', 0, y + 1.8, 0, w * .64, .4, d * .65, floor, true);
      if (b.kind === 'bank') this.roof(shifted(0, -d * .15), w * .42, d * .4, y + 3, floor, .6, far);
      else for (const side of [-1, 1]) box('roof', side * w * .33, y + .8, d * .25, w * .22, .8, d * .25, floor, true, '#72906c');
    } else if (b.kind === 'station' || b.kind === 'airport') {
      for (let bay = 0; bay < 3; bay++) this.roof(shifted((bay - 1) * w * .32, 0), w * .3, d, y + Math.abs(bay - 1) * .6, floor, .45 * magnitude, far);
      box('glass', 0, y + 1.5, 0, w * .13, .8, d * .8, floor, true);
    } else if (b.kind === 'dock') {
      gable(0, w, d * .7, 2 * magnitude, '#526860');
    } else {
      this.roof(box, w, d, y, floor, magnitude, far);
    }
  }

  private programExterior(b: Building, box: LocalBox, far: boolean) {
    const w = b.width, d = b.depth, h = b.height, fh = h / b.floors;
    const top = b.floors - 1;
    if (b.kind === 'home') {
      for (let floor = far ? 2 : 1; floor < b.floors; floor += far ? b.floors : 2) {
        const y = floor * fh;
        for (const side of [-1, 1]) {
          box('wood', side * w * .28, y + .2, d / 2 + 1, w * .28, .4, 2.4, floor);
          box('wood', side * w * .28, y + 1.2, d / 2 + 2.1, w * .28, .2, .2, floor);
          if (!far) for (let rail = 0; rail < 5; rail++) box('wood', side * w * .28 + (rail - 2) * w * .05, y + .7, d / 2 + 2.1, .2, 1, .2, floor);
          box('roof', side * w * .4, y + .7, d / 2 + 1.8, 1.6, .8, .6, floor, false, '#75916b');
        }
      }
      if (!far) { box('stone', -w * .3, .3, d / 2 + 5, w * .22, .6, 7, 0); box('wood', -w * .41, 1.2, d / 2 + 5, .2, 1.6, 6, 0); box('wood', -w * .19, 1.2, d / 2 + 5, .2, 1.6, 6, 0); }
    } else if (b.kind === 'market') {
      // Public doorway stays clear between the two usable shopfront bays.
      for (const side of [-1, 1]) {
        box('roof', side * w * .3, 3.5, d / 2 + 2, w * .3, .4, 5.6, 0, false, '#987649');
        for (const xx of [-.12, .12]) box('wood', side * w * .3 + xx * w, 1.8, d / 2 + 4.4, .4, 3.6, .4, 0);
        box('amber', side * w * .3, 4.4, d / 2 + .6, w * .22, .8, .2, 0);
      }
      for (const counter of marketCounters(this.world, b)) {
        const p = counter.localPosition, size = counter.size;
        // Exterior fixtures use ground coordinates; the building emitter adds
        // its .6m floor base. Remove that lift so cabinet, collision and food
        // samples all use the same authoritative top and bottom.
        const y = p.y - .6;
        box('wood', p.x, y - .1, p.z, size.x, .8, size.z, 0);
        box('wood', p.x, y + .4, p.z, size.x, .2, size.z, 0, false, '#8b7358');
      }
    } else if (b.kind === 'workshop' && b.districtId !== 'core') {
      for (const side of [-1, 1]) { box('stone', side * w * .36, h + 3, -d * .25, 2.8, 8, 2.8, top, true, '#7b8580'); box('wood', side * w * .36, h + 7.2, -d * .25, 3.6, .8, 3.6, top, true); }
      for (let column = 0; column < 5; column++) { const x = (column - 2) * w * .19; if (Math.abs(x) > Math.min(5, w * .22) / 2 + .3) box('wood', x, h * .5, d / 2 + .4, .6, h, .8, 0); else box('wood', x, (h + Math.min(4.4, Math.max(2.4, fh - .5) * .72)) / 2, d / 2 + .4, .6, h - Math.min(4.4, Math.max(2.4, fh - .5) * .72), .8, 0); }
      if (!far) { box('stone', -w * .36, 1.8, d / 2 + 3, w * .2, 3.6, 4, 0); for (let crate = 0; crate < 4; crate++) box('wood', -w * .4 + crate * 1.4, .8, d / 2 + 6, 1.2, 1.6, 1.2, 0); }
    } else if (b.kind === 'bank') {
      for (const side of [-1, 1]) for (let column = 0; column < (far ? 2 : 4); column++) box('stone', side * (w * .22 + column * w * .065), h * .5, d / 2 + .7, .8, h, 1.2, 0, false, '#6c827d');
      box('glass', 0, h * .58, d / 2 + .4, w * .32, h * .7, .2, 0);
      box('cyan', 0, h * .65, d / 2 + .7, w * .25, .4, .2, 0);
      for (const side of [-1, 1]) box('stone', side * w * .32, 2.8, d / 2 + 2, 1.2, 5.6, 1.2, 0);
    } else if (b.kind === 'hall' || b.kind === 'school' || b.kind === 'police') {
      const ceremonial = b.kind === 'hall', columns = far ? 4 : ceremonial ? 8 : 6;
      for (let i = 0; i < columns; i++) { const x = -w * .42 + i * w * .84 / (columns - 1); box('wood', x, fh * .65, d / 2 + 2.6, ceremonial ? 1.2 : .8, fh * 1.3, ceremonial ? 1.2 : .8, 0); box('stone', x, .4, d / 2 + 2.6, 1.6, .8, 1.6, 0); }
      this.roof(offsetBox(box, 0, d / 2 + 1.8), w * .9, 5, fh * 1.3, 0, .35, far);
      if (!far) { for (const side of [-1, 1]) box('stone', side * w * .41, 1.4, d / 2 + 6.6, w * .16, 2.8, .6, 0); box('amber', 0, fh * .94, d / 2 + .5, w * .22, 1.2, .2, 0); }
      if (b.kind === 'school') for (const side of [-1, 1]) box('wood', side * w * .35, h * .5, d / 2 + .4, 1, h, 1, 0);
      if (b.kind === 'police') { box('stone', w * .36, h + 3, -d * .25, 4, 6, 4, top, true); box('cyan', w * .36, h + 6.4, -d * .25, 1.2, .8, 1.2, top, true); }
    } else if (b.kind === 'station' || b.kind === 'airport') {
      for (const side of [-1, 1]) { box('glass', side * w * .28, fh * .6, d / 2 + .3, w * .32, fh * .8, .2, 0); box('cyan', side * w * .28, 3.8, d / 2 + .7, w * .3, .4, .2, 0); }
      if (!far) { for (const side of [-1, 1]) box('wood', side * w * .33, .8, d / 2 + 3.4, w * .17, .4, .8, 0); }
    } else if (b.kind === 'dock') {
      box('wood', 0, -.3, 0, w + 3, .6, d + 3, 0);
      for (const side of [-1, 1]) for (const z of [-d * .4, 0, d * .4]) box('wood', side * w * .43, -3, z, .8, 6, .8, 0);
      for (const side of [-1, 1]) { box('wood', side * w * .48, 1.1, 0, .2, .2, d, 0); if (!far) for (let n = 0; n < 7; n++) box('wood', side * w * .48, .6, (n - 3) * d / 7, .2, 1.2, .2, 0); }
    } else if (b.kind === 'clinic') {
      for (let floor = 1; floor < b.floors; floor += far ? 3 : 1) { box('stone', 0, floor * fh + .1, d / 2 + .5, w, .6, 1, floor, false, '#d0d8c7'); box('glass', 0, floor * fh + fh * .55, d / 2 + .3, w * .78, .8, .2, floor); }
      box('red', w * .31, fh * .75, d / 2 + .7, 1.8, .6, .2, 0); box('red', w * .31, fh * .75, d / 2 + .7, .6, 1.8, .2, 0);
    } else if (b.kind === 'core') {
      // Five real six-storey volumes are expressed as stone podiums and open
      // flying-eave galleries, rather than thirty identical roof stripes.
      for (let first = 0; first < b.floors; first += 6) {
        const dimension = getFloorDimensions(b, first), yy = first * fh;
        for (const column of [-.42, -.28, -.14, .14, .28, .42]) { box('wood', column * dimension.width, yy + fh * 2.8, dimension.depth / 2 + 1.2, 2.4, fh * 5.6, 2.4, first, false, '#796043'); box('stone', column * dimension.width, yy + .7, dimension.depth / 2 + 1.2, 3.8, 1.4, 3.8, first, false, '#b4b39c'); }
        box('stone', 0, yy + .4, 0, dimension.width + 2, .8, dimension.depth + 2, first);
        box('amber', 0, yy + fh * 5.72, dimension.depth / 2 + 1.7, dimension.width + 3, .4, .4, first);

      }
    }
  }

  private buildNetwork() {
    const batch = new BoxBatch(this.materials);
    for (const edge of this.world.edges) {
      this.edges.set(edge.id, edge); if (edge.mode === 'flight') continue;
      let supportRemainder = 0;
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1], b = edge.points[i];
        if (edge.mode === 'ferry') continue;
        if (edge.mode === 'cable') { batch.segment('wood', a, b, .45, .45, 9); batch.segment('cyan', a, b, .15, .15, 8.5); continue; }
        if (edge.mode === 'lift') {
          // An open four-post lift cage preserves the real central travel axis
          // while allowing the adjacent waterfall to remain visible through it.
          for (const x of [-2.5, 2.5]) for (const z of [-2.5, 2.5]) batch.segment('stone', { ...a, x: a.x + x, z: a.z + z }, { ...b, x: b.x + x, z: b.z + z }, .6, .6, 0, '#a4b0a2');
          for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y += 12) { for (const x of [-2.5, 2.5]) batch.box('wood', a.x + x, y, a.z, .6, .6, 5.6, '#698780'); for (const z of [-2.5, 2.5]) batch.box('wood', a.x, y, a.z + z, 5.6, .6, .6, '#698780'); }
          batch.segment('cyan', { ...a, x: a.x + 3.2 }, { ...b, x: b.x + 3.2 }, .3, .3); continue;
        }
        const rail = edge.mode === 'maglev' || edge.mode === 'lightRail';
        const width = deckWidth(edge);
        batch.segment('stone', a, b, width, rail ? 1.4 : .5, rail ? -.9 : -.25, rail ? '#84948e' : edge.mode === 'bridge' ? '#b8b3a0' : '#969987');
        if (rail) { batch.segment('cyan', { ...a, x: a.x - 1.8 }, { ...b, x: b.x - 1.8 }, .28, .24, .16); batch.segment('cyan', { ...a, x: a.x + 1.8 }, { ...b, x: b.x + 1.8 }, .28, .24, .16); }
        else if (edge.mode !== 'bridge') batch.segment('stone', a, b, .16, .08, .07, '#d1c6a1');
        // Curbs, paving seams and separate shoulders make the travelled deck
        // legible at body height without widening the shared collision surface.
        const dx = b.x - a.x, dz = b.z - a.z, horizontal = Math.hypot(dx, dz) || 1, nx = -dz / horizontal, nz = dx / horizontal;
        for (const side of [-1, 1]) {
          const offset = guardrailOffset(edge), aa = { x: a.x + nx * offset * side, y: a.y, z: a.z + nz * offset * side }, bb = { x: b.x + nx * offset * side, y: b.y, z: b.z + nz * offset * side };
          batch.segment('stone', aa, bb, rail ? .35 : .4, rail ? .5 : .2, rail ? -.1 : .12, '#c0c2ac');
          const elevated = (a.y + b.y) / 2 - terrainHeight(this.world, (a.x + b.x) / 2, (a.z + b.z) / 2) > 4;
          if (edge.mode === 'bridge' || rail || elevated && edge.mode === 'road') for (const span of guardrailSpans(this.world, edge, i)) batch.segment('wood', { x: span.a.x + nx * offset * side, y: span.a.y, z: span.a.z + nz * offset * side }, { x: span.b.x + nx * offset * side, y: span.b.y, z: span.b.z + nz * offset * side }, GUARDRAIL_THICKNESS, .2, 1.1, '#6b7771');
        }
        if (edge.mode === 'road' && !edge.id.includes('runway')) { const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + .04, z: (a.z + b.z) / 2 }; batch.segment('stone', { ...middle, x: middle.x - nx * 3.5, z: middle.z - nz * 3.5 }, { ...middle, x: middle.x + nx * 3.5, z: middle.z + nz * 3.5 }, .08, .04, 0, '#757e73'); }
        const length = Math.hypot(b.x - a.x, b.z - a.z), interval = rail ? 80 : 70;
        // Spacing spans all samples of the same edge, including the world's 4m rails.
        for (let along = interval - supportRemainder; along <= length; along += interval) { const t = along / Math.max(.01, length), x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t, ground = terrainHeight(this.world, x, z); if (y - ground > 5 && edge.mode !== 'bridge') { const tall = y - ground; batch.box('stone', x, ground + 1, z, rail ? 7 : 8, 2, rail ? 7 : 8, '#939e91'); batch.box('stone', x, ground + tall / 2, z, rail ? 3 : 4, tall, rail ? 3 : 4, '#a0aaa0'); batch.box('stone', x, y - 1.3, z, width + 1, 1.8, 4, '#929d92'); if (tall > 25) for (let tie = ground + 12; tie < y - 5; tie += 16) batch.box('wood', x, tie, z, rail ? 4 : 5, .6, rail ? 4 : 5); } }
        supportRemainder = (supportRemainder + length) % interval;
      }
      if (edge.mode === 'bridge') this.buildBridge(edge, batch);
    }
    for (const node of this.world.nodes) {
      const p = node.position;
      if (node.station) { batch.box('stone', p.x, p.y - .6, p.z, 22, 1, 18); batch.box('cyan', p.x, p.y + .1, p.z + 8, 20, .2, .35); for (const x of [-8, 8]) { batch.box('wood', p.x + x, p.y + 3, p.z, .8, 6, .8); batch.box('amber', p.x + x, p.y + 5.7, p.z, 1.5, .35, 1.5); } batch.box('roof', p.x, p.y + 6.4, p.z, 23, .65, 11, undefined, 0, { roof: true }); batch.box('wood', p.x + 12, p.y + 1.8, p.z + 11, .35, 3.6, .35); batch.box('wood', p.x + 12, p.y + 3.5, p.z + 11, 1, 1.6, .65); }
      else if (node.id.includes('junction') || node.id.includes('road')) { batch.box('wood', p.x + 4, p.y + 2.2, p.z + 4, .4, 4.4, .4); }
    }
    const group = batch.build(undefined, 384);
    group.traverse(object => { if (object instanceof THREE.InstancedMesh && object.userData.distanceDetail) this.distanceDetails.push(object); });
    this.scene.add(group);
  }

  private buildBridge(edge: NetworkEdge, batch: BoxBatch) {
    if (edge.points.length < 2) return;
    const length = edge.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - edge.points[i].x, p.z - edge.points[i].z), 0);
    const arcLength = edge.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - edge.points[i].x, p.y - edge.points[i].y, p.z - edge.points[i].z), 0);
    const samples = Math.max(8, Math.ceil(length / 8));
    const point = (t: number, side: number, lift: number) => { const p = samplePolyline(edge.points, t), a = samplePolyline(edge.points, Math.max(0, t - .01)), b = samplePolyline(edge.points, Math.min(1, t + .01)), dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return { x: p.x - dz / l * side * 4.1, y: p.y + lift, z: p.z + dx / l * side * 4.1 }; };
    const suspension = length > 140;
    for (const side of [-1, 1]) {
      for (let i = 0; i <= samples; i++) {
        const t = i / samples, deck = point(t, side, 0);
        const guarded = hasGuardrailAt(this.world, edge, t * arcLength);
        if (guarded) batch.box('wood', deck.x, deck.y + .55, deck.z, .4, 1.1, .4, '#6c7871');
        if (suspension) {
          const lift = t < .16 ? 3 + t / .16 * 27 : t > .84 ? 3 + (1 - t) / .16 * 27 : 30 - 21 * Math.sin((t - .16) / .68 * Math.PI);
          const cable = point(t, side, lift);
          if (i) { const previousT = (i - 1) / samples, previousLift = previousT < .16 ? 3 + previousT / .16 * 27 : previousT > .84 ? 3 + (1 - previousT) / .16 * 27 : 30 - 21 * Math.sin((previousT - .16) / .68 * Math.PI); batch.segment('wood', point(previousT, side, previousLift), cable, .5, .5, 0, '#627d7c'); }
          if (guarded) batch.segment('stone', { ...deck, y: deck.y + 1.1 }, cable, .2, .2, 0, '#9eb1a7');
        }
      }
      for (const t of suspension ? [.16, .84] : [0, 1]) {
        if (suspension && !hasGuardrailAt(this.world, edge, t * arcLength)) continue;
        const offset = suspension ? 6 : 6.5, deck = point(t, side * offset / 4.1, 0), ground = Math.min(terrainHeight(this.world, deck.x, deck.z), deck.y - 2.6), height = deck.y - ground + (suspension ? 32 : 2.4);
        batch.box('stone', deck.x, ground + .8, deck.z, 9, 1.6, 9, '#a4aa9b');
        batch.box('stone', deck.x, ground + height / 2, deck.z, 2, height, 2, '#8c9b95');
        if (suspension) { const across = point(t, -side * offset / 4.1, 28); batch.segment('stone', { ...deck, y: deck.y + 28 }, across, 1.6, 1.6, 0, '#8b9b95'); this.roof((key, x, y, z, sx, sy, sz) => batch.box(key, deck.x + x, deck.y + y, deck.z + z, sx, sy, sz), 5, 5, 32, 0, .35, true); }
      }
    }
    for (const t of [0, 1]) { const p = samplePolyline(edge.points, t), ground = terrainHeight(this.world, p.x, p.z); batch.box('stone', p.x, (p.y + ground) / 2, p.z, 12, Math.max(1, p.y - ground), 10, '#a2a88f'); }
  }

  private buildGateways() {
    const batch = new BoxBatch(this.materials);
    const civic = this.world.buildings.find(b => b.kind === 'core');
    if (civic) {
      const x = civic.position.x, z = civic.door.z + 67, y = civic.position.y;
      batch.box('stone', x, y + .04, z, 96, .12, 84, '#82958a');
      for (const side of [-1, 1]) for (const offset of [-30, 0, 30]) {
        batch.box('wood', x + side * 39, y + 2, z + offset, .4, 4, .4);
        batch.box('amber', x + side * 39, y + 4.15, z + offset, 1.2, 1.4, 1.2);
        batch.box('red', x + side * 39, y + 4.9, z + offset, 1.5, .2, 1.5);
      }
      for (const side of [-1, 1]) { batch.box('wood', x + side * 44, y + 5, z - 37, .45, 10, .45); batch.box('red', x + side * 44 + 1.8, y + 7.4, z - 37, 3.6, 4.5, .2); }
      batch.box('cyan', x, y + .2, z, 1.2, .08, 80);
    }
    for (const b of this.world.buildings) {
      if (b.kind === 'airport') {
        const runway = this.world.edges.find(edge => edge.id === 'road-airport-runway-strip');
        if (runway && runway.points.length > 1) for (let i = 1; i < runway.points.length; i++) { const a = runway.points[i - 1], next = runway.points[i], center = { x: (a.x + next.x) / 2, y: (a.y + next.y) / 2 + .18, z: (a.z + next.z) / 2 }; batch.box('amber', center.x, center.y, center.z, 6, .07, 1); for (const side of [-1, 1]) batch.box('cyan', center.x, center.y + .12, center.z + side * 16.5, .9, .3, .9); }
      }
      if (b.kind === 'starport') {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(Math.max(42, b.width * .6), 2.2, 4, 32), this.materials.cyan); ring.rotation.x = Math.PI / 2; ring.position.set(b.position.x, b.position.y + b.height + 12, b.position.z); this.scene.add(ring);
        batch.box('cyan', b.position.x, b.position.y + b.height + 26, b.position.z, 2.5, 35, 2.5);
      }
    }
    const group = batch.build(undefined, 384);
    group.traverse(object => { if (object instanceof THREE.InstancedMesh && object.userData.distanceDetail) this.distanceDetails.push(object); });
    this.scene.add(group);
  }

  private buildStars() {
    const positions = new Float32Array(600 * 3); let seed = this.world.seed >>> 0;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 600; i++) { const a = random() * Math.PI * 2, y = .035 + random() * .93, r = Math.sqrt(1 - y * y) * 11000; positions[i * 3] = Math.cos(a) * r; positions[i * 3 + 1] = y * 11000; positions[i * 3 + 2] = Math.sin(a) * r; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ size: 26, color: '#d3e9e1', transparent: true, opacity: 0, depthWrite: false, fog: false }));
  }

  private buildMist() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d');
    if (context) { const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64); gradient.addColorStop(0, 'rgba(255,255,255,.8)'); gradient.addColorStop(.5, 'rgba(255,255,255,.25)'); gradient.addColorStop(1, 'rgba(255,255,255,0)'); context.fillStyle = gradient; context.fillRect(0, 0, 128, 128); }
    const texture = new THREE.CanvasTexture(canvas);
    const points: number[] = [];
    const bands = [{ x: -730, z: 500, y: 170 }, { x: 740, z: -90, y: 285 }, { x: -700, z: -980, y: 440 }, { x: 250, z: -1580, y: 510 }, { x: 1380, z: -870, y: 430 }, { x: 70, z: 75, y: 140 }];
    for (const band of bands) for (let i = 0; i < 14; i++) points.push(band.x + (i - 7) * 35, band.y + Math.sin(i * .8) * 9, band.z + Math.cos(i * .5) * 35);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.PointsMaterial({ map: texture, size: 190, color: '#cadad6', transparent: true, opacity: .1, depthWrite: false, fog: true });
    const mist = new THREE.Points(geometry, material); mist.name = '山腰轻云 · 瀑潭水雾'; return mist;
  }

  private buildSpray() {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d');
    if (context) { const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32); gradient.addColorStop(0, 'rgba(255,255,255,.75)'); gradient.addColorStop(.45, 'rgba(255,255,255,.22)'); gradient.addColorStop(1, 'rgba(255,255,255,0)'); context.fillStyle = gradient; context.fillRect(0, 0, 64, 64); }
    const points: number[] = [], bottom = this.world.waterfall.bottom;
    for (let i = 0; i < 96; i++) { const angle = i * 2.39996, r = 5 + (i % 11) * 3.1; points.push(bottom.x + Math.cos(angle) * r, bottom.y + 2 + i % 7 * 2.1, bottom.z + Math.sin(angle) * r); }
    for (let i = 0; i < 24; i++) points.push(bottom.x + Math.sin(i * 1.83) * this.world.waterfall.width * .44, bottom.y + 15 + i * 5, this.world.waterfall.top.z + 45 + Math.sin(i * .6) * 4);
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const material = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(canvas), size: 24, color: '#e4eee5', transparent: true, opacity: .2, depthWrite: false, fog: true });
    const spray = new THREE.Points(geometry, material); spray.name = '瀑潭飞沫 · 落水冲击雾'; return spray;
  }

  private buildCoreLabels() {
    const make = (text: string) => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 128;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.fillStyle = 'rgba(24,54,53,.92)'; context.fillRect(0, 0, 640, 128);
      context.strokeStyle = '#bdc7a6'; context.lineWidth = 3; context.strokeRect(7, 7, 626, 114);
      context.fillStyle = '#eed8a2'; context.font = '500 48px "Noto Sans CJK SC", sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(text, 320, 66, 595);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: true })); sprite.visible = false; this.scene.add(sprite); return sprite;
    };
    const signed = new Set<string>();
    for (const building of this.world.buildings.filter(b => { if (b.districtId === 'core') return true; if (b.kind === 'home' || b.kind === 'farm') return false; const key = `${b.districtId}:${b.kind}`; if (signed.has(key)) return false; signed.add(key); return true; })) {
      const sprite = make(building.name); if (sprite) { sprite.position.set(building.door.x, building.position.y + Math.min(5.2, building.height / building.floors * .8), building.door.z + .8); sprite.scale.set(Math.min(18, Math.max(8, building.width * .35)), 2.4, 1); this.labels.push({ building, sprite }); }
      if (building.kind === 'core') {
        const uses = building.floorUses;
        for (let floor = -(building.basements ?? 0); floor < building.floors; floor++) {
          const label = floor < 0 ? `B${-floor} · ${building.basementUses?.[-floor - 1] ?? (floor === -1 ? '地下档案室' : '城市储备金库')}` : uses?.[floor] ?? (floor === 0 ? '公厅 · 政务受理' : floor === 1 ? '市议会 · 议事厅' : floor === building.floors - 1 ? '观景与决策层' : floor === Math.floor(building.floors * .35) ? '城市数据控制室' : `政务办公 · 第${floor + 1}层`);
          const floorSprite = make(label); if (!floorSprite) continue; const stair = getStairPosition(building, floor); floorSprite.position.set(stair.x + 2, building.position.y + .6 + floor * building.height / building.floors + 2.5, stair.z - 2.8); floorSprite.scale.set(9, 1.8, 1); this.labels.push({ building, sprite: floorSprite, floor });
        }
      }
    }
  }

  private makePool(capacity: number, bodyMat: THREE.Material, headMat: THREE.Material, trimMat: THREE.Material): MovingPool {
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bodyMat, capacity), head = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), headMat, capacity), trim = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), trimMat, capacity);
    for (const mesh of [body, head, trim]) {
      if (mesh.material === this.materials.roof) mesh.geometry.setAttribute('instanceRoofSurface', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
      if (mesh.material === this.materials.glass) mesh.geometry.setAttribute('instanceWindowSurface', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
      mesh.count = 0; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false; this.scene.add(mesh);
    }
    return { body, head, trim, capacity };
  }

  private put(mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, angle: number, color?: string) {
    this.position.set(x, y, z); this.scale.set(sx, sy, sz); this.rotation.setFromAxisAngle(this.axis, angle); this.matrix.compose(this.position, this.rotation, this.scale); mesh.setMatrixAt(index, this.matrix);
    if (color) { let c = this.colors.get(color); if (!c) { c = new THREE.Color(color); this.colors.set(color, c); } mesh.setColorAt(index, c); }
  }

  update(state: SimState, elapsed: number) {
    this.roadClosures.update(state);
    const residents = this.nearChunks.update(this.camera.position, { quality: this.quality, insideBuildingId: this.insideId, renderDistance: this.distance });
    this.chunks = residents.map(({ chunk, resource }) => ({ center: { ...chunk.center }, radius: chunk.radius, detail: resource.group, near: true, buildingIds: new Set(chunk.buildingIds) }));
    this.scene.userData.buildingResidency = this.nearChunks.getStats();
    this.landscape.update(this.camera.position, this.quality);
    for (const mesh of this.distanceDetails) { const bounds = mesh.boundingSphere!; mesh.visible = bounds.center.distanceTo(this.camera.position) < bounds.radius + (this.quality === 'high' ? 300 : this.quality === 'low' ? 90 : 180); }
    this.architectureDetail.update(this.camera.position, { buildingId: this.insideId, floor: this.insideFloor }, this.quality);
    for (const material of this.landscape.water) if (material.uniforms.time) material.uniforms.time.value = elapsed;
    const angle = (state.hour - 6) / 24 * Math.PI * 2, altitude = Math.sin(angle), daylight = THREE.MathUtils.smoothstep(altitude, -.12, .28), twilight = Math.max(0, 1 - Math.abs(altitude) * 4);
    for (const material of this.landscape.water) if (material.uniforms.light) material.uniforms.light.value = daylight;
    this.sun.position.set(Math.cos(angle) * 2500, altitude * 2500, altitude * 1400); this.moon.position.copy(this.sun.position).multiplyScalar(-1);
    this.sun.intensity = daylight * 2.9; this.moon.intensity = (1 - daylight) * .72; this.fill.intensity = .68 + daylight * .45;
    this.fill.color.set('#89aec3').lerp(new THREE.Color('#bed5dd'), daylight); this.fill.groundColor.set('#405953').lerp(new THREE.Color('#7e8c7b'), daylight);
    // A shadow-free low-angle bounce approximation lights actual opaque soffits
    // and bridge undersides. It follows daylight, adds no hidden geometry, and
    // leaves sun shadows and the original road/roof solids intact.
    this.groundBounce.intensity = .035 + daylight * .35;
    this.groundBounce.color.set('#8296a0').lerp(new THREE.Color('#d3d5b2'), daylight);
    this.groundBounce.position.set(this.camera.position.x - 700, this.camera.position.y - 700, this.camera.position.z + 300);
    this.groundBounce.target.position.copy(this.camera.position);
    const horizon = new THREE.Color('#203b4c').lerp(new THREE.Color('#bdd7dd'), daylight).lerp(new THREE.Color('#e2af86'), twilight * .35);
    const top = new THREE.Color('#071822').lerp(new THREE.Color('#418daf'), daylight);
    this.skyMaterial.uniforms.top.value.copy(top); this.skyMaterial.uniforms.horizon.value.copy(horizon);
    this.skyMaterial.uniforms.daylight.value = daylight;
    const mistMaterial = this.mist.material as THREE.PointsMaterial; mistMaterial.color.copy(horizon).lerp(new THREE.Color('#e0e8df'), .25 + daylight * .35); mistMaterial.opacity = .13 + (1 - state.visibility) * .13; this.mist.position.x = Math.sin(elapsed * .015) * 24;
    const sprayMaterial = this.spray.material as THREE.PointsMaterial; sprayMaterial.color.copy(horizon).lerp(new THREE.Color('#eef6ed'), .8); sprayMaterial.opacity = .13 + daylight * .12; this.spray.position.x = Math.sin(elapsed * .24) * 2.8;
    this.scene.background = horizon; const fog = this.scene.fog as THREE.FogExp2; fog.color.copy(horizon); fog.density = (.00022 + (1 - state.visibility) * .0002) * (6500 / this.distance);
    this.sky.position.copy(this.camera.position); this.stars.position.copy(this.camera.position); (this.stars.material as THREE.PointsMaterial).opacity = (1 - daylight) * .8;
    this.sunOrb.position.copy(this.sun.position).multiplyScalar(3.6).add(this.camera.position); this.sunOrb.visible = altitude > -.08;
    this.moonOrb.position.copy(this.moon.position).multiplyScalar(3.6).add(this.camera.position); this.moonOrb.visible = altitude < .08;
    this.sun.target.position.copy(this.camera.position);
    this.sun.position.add(this.camera.position);
    this.sun.castShadow = daylight > .25 && this.quality !== 'low';
    if (elapsed - this.shadowAt > .65 || this.shadowPosition.distanceToSquared(this.camera.position) > 16) {
      this.renderer.shadowMap.needsUpdate = this.sun.castShadow;
      this.shadowAt = elapsed; this.shadowPosition.copy(this.camera.position);
    }
    // Shadow casters are restricted to the occupied neighbourhood. Distant
    // city and terrain proxies remain a single colour/depth pass.
    for (const chunk of this.chunks) { const casts = Math.hypot(chunk.center.x - this.camera.position.x, chunk.center.z - this.camera.position.z) < 140; chunk.detail.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = casts; }); }
    this.architectureDetail.group.traverse(object => { if (object instanceof THREE.Mesh) { object.castShadow = true; object.receiveShadow = true; } });
    const energy = Math.max(.18, state.energy / 100); this.materials.cyan.emissiveIntensity = (.22 + (1 - daylight) * 2) * energy; this.materials.amber.emissiveIntensity = .45 + (1 - daylight) * 3;
    this.facadeNight.value = (1 - daylight) * Math.max(0, state.energy / 100) * .8;
    this.architectureDetail.setLighting(daylight, state.energy / 100);
    const room = this.insideId ? this.world.buildings.find(b => b.id === this.insideId) : undefined;
    for (let i = 0; i < this.interiorLights.length; i++) {
      const light = this.interiorLights[i]; light.visible = !!room;
      if (room) {
        const dimension = getFloorDimensions(room, this.insideFloor), floorHeight = room.height / room.floors;
        const plan = getBuildingFloorPlan(room, this.insideFloor), point = plan?.usePoints[i % plan.usePoints.length];
        if (plan) light.visible = i < plan.usePoints.length;
        if (plan && point) {
          const position = buildingWorldPosition(room, { x: point.x, y: plan.y + floorHeight * .68, z: point.z });
          light.position.set(position.x, position.y, position.z);
        } else light.position.set(room.position.x + (i ? 1 : -1) * dimension.width * .22, room.position.y + .6 + this.insideFloor * floorHeight + floorHeight * .68, room.position.z);
        light.intensity = Math.max(90, dimension.width * 13) * energy * (1 - daylight * .3); light.distance = Math.max(dimension.width, dimension.depth) * 1.25;
      }
    }
    this.materials.glass.transparent = true; this.materials.glass.opacity = .88; this.materials.glass.depthWrite = false;
    this.materials.glass.emissive.set('#b49d6c'); this.materials.glass.emissiveIntensity = (1 - daylight) * .18;
    let signalIndex = 0;
    for (const node of this.world.nodes) if (node.station) {
      const p = node.position, phase = state.signals?.[node.id];
      this.put(this.signalRed, signalIndex, p.x + 12, p.y + 3.9, p.z + 11.4, 1, 1, 1, 0, phase === 0 ? '#ff6753' : '#210b0b');
      this.put(this.signalGreen, signalIndex, p.x + 12, p.y + 3.15, p.z + 11.4, 1, 1, 1, 0, phase === 1 ? '#7ff0bd' : '#0a2018'); signalIndex++;
    }
    for (const signal of [this.signalRed, this.signalGreen]) { signal.instanceMatrix.needsUpdate = true; if (signal.instanceColor) signal.instanceColor.needsUpdate = true; }
    const detailedSigns = new Set<string>(this.architectureDetail.group.userData.activeBuildingIds ?? []);
    for (const label of this.labels) label.sprite.visible = label.floor === undefined ? label.sprite.position.distanceTo(this.camera.position) < 450 && this.insideId !== label.building.id && !detailedSigns.has(label.building.id) : this.insideId === label.building.id && this.insideFloor === label.floor;
    this.citizens.update(state, this.camera.position, elapsed, this.distance, this.quality);
    this.marketGoods.update(state, this.camera.position, new Set(this.chunks.flatMap(chunk => [...chunk.buildingIds])), this.quality === 'low' ? 65 : 110);
    this.marketShopfront.update(state, this.camera.position, new Set(this.chunks.flatMap(chunk => [...chunk.buildingIds])), this.quality === 'low' ? 4 : 8);
    const counts = new Map<string, number>();
    for (const vehicle of state.vehicles) {
      const pool = this.vehiclePools.get(vehicle.kind); if (!pool) continue; const n = counts.get(vehicle.kind) ?? 0; if (n >= pool.capacity) continue;
      if (vehicle.id === state.player.vehicleId && Math.hypot(vehicle.position.x - this.camera.position.x, vehicle.position.y - this.camera.position.y, vehicle.position.z - this.camera.position.z) < 25) continue;
      if (Math.hypot(vehicle.position.x - this.camera.position.x, vehicle.position.z - this.camera.position.z) > this.distance + 600) continue;
      const edge = this.edges.get(vehicle.edgeId); let direction = 0;
      if (edge && edge.points.length > 1) { const t = Math.max(0, Math.min(.99999, vehicle.progress)), i = Math.min(edge.points.length - 2, Math.floor(t * (edge.points.length - 1))), a = edge.points[i], b = edge.points[i + 1]; direction = Math.atan2(b.x - a.x, b.z - a.z) + (vehicle.direction < 0 ? Math.PI : 0); }
      const p = vehicle.position, flight = vehicle.kind === 'flight', train = vehicle.kind === 'maglev' || vehicle.kind === 'lightRail', boat = vehicle.kind === 'ferry', length = flight ? 17 : train ? 16 : boat ? 11 : vehicle.kind === 'cable' ? 3.5 : 5.5, width = flight ? 14 : train ? 3.3 : boat ? 4.5 : 2.5, lift = vehicle.kind === 'cable' ? 2.5 : 0;
      this.put(pool.body, n, p.x, p.y + 1.1 + lift, p.z, width, flight ? .8 : 1.5, length, direction, flight ? '#d5c7aa' : train ? '#d0b985' : '#a77851');
      this.put(pool.head, n, p.x, p.y + 2.1 + lift, p.z, flight ? 3 : width * .85, flight ? 1.8 : .8, length * .68, direction, '#517f82');
      this.put(pool.trim, n, p.x, p.y + .6 + lift, p.z, width + .25, .2, length * .85, direction); counts.set(vehicle.kind, n + 1);
    }
    for (const [kind, pool] of this.vehiclePools) for (const mesh of [pool.body, pool.head, pool.trim]) { mesh.count = counts.get(kind) ?? 0; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
  }

  /** Program rooms retain their real overhead slab/roof. The shared holes and
   * exposed wings still determine the ceiling; no second room box is drawn. */
  private applyInteriorRefs(buildingId: string, currentFloor: number | null) {
    const building = this.world.buildings.find(site => site.id === buildingId), program = currentFloor !== null && building && getBuildingFloorPlan(building, currentFloor);
    for (const ref of this.interiors.get(buildingId) ?? []) {
      const retainedCeiling = currentFloor !== null && currentFloor < 0 ? currentFloor + 1 : currentFloor;
      const overhead = program && ref.ceiling && (ref.roof ? ref.floor === currentFloor : ref.floor === currentFloor! + 1);
      const hidden = currentFloor !== null && !overhead && (ref.floor > retainedCeiling! || ref.roof && ref.floor >= currentFloor);
      ref.mesh.setMatrixAt(ref.index, hidden ? new THREE.Matrix4().makeScale(0, 0, 0) : ref.matrix); ref.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  setInterior(id: string | null, floor = 0) {
    if (id === this.insideId && floor === this.insideFloor) return;
    if (this.insideId) this.applyInteriorRefs(this.insideId, null); this.insideId = id; this.insideFloor = floor; if (id) this.applyInteriorRefs(id, floor);
  }

  render() {
    const now = performance.now();
    if (this.lastRender) { const delta = Math.min(100, now - this.lastRender); this.frameAverage = this.frameAverage * .97 + delta * .03; }
    this.lastRender = now;
    if (this.dynamicResolution && now - this.adaptAt > 2500) { const previous = this.resolutionScale; if (this.frameAverage > 37) this.resolutionScale = Math.max(.65, this.resolutionScale - .08); else if (this.frameAverage < 21) this.resolutionScale = Math.min(1, this.resolutionScale + .04); if (previous !== this.resolutionScale) this.resize(); this.adaptAt = now; }
    this.renderer.render(this.scene, this.camera);
  }
  resize() { const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); const base = this.quality === 'high' ? 1.8 : this.quality === 'low' ? 1 : 1.35; this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, base) * this.resolutionScale); this.renderer.setSize(width, height); }
  setQuality(quality: Quality) { this.quality = quality; this.resolutionScale = 1; this.landscape.vegetation.visible = quality !== 'low'; this.resize(); }
  setRenderDistance(distance: number) { this.distance = THREE.MathUtils.clamp(distance, 800, 6000); this.camera.far = Math.max(15000, this.distance * 1.6); this.camera.updateProjectionMatrix(); }
  setDynamicResolution(enabled: boolean) { this.dynamicResolution = enabled; if (!enabled) { this.resolutionScale = 1; this.resize(); } }
  dispose() {
    this.nearChunks.dispose(); this.chunks = []; this.interiors.clear();
    this.citizens.dispose();
    this.marketGoods.dispose();
    this.marketShopfront.dispose();
    this.scene.remove(this.roadClosures.group); this.roadClosures.dispose();
    this.architectureDetail.dispose();
    this.scene.remove(this.landscape.group); this.landscape.dispose();
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.scene.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.Points) { geometries.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : [object.material]) { if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose(); materials.add(material); } if (object instanceof THREE.InstancedMesh) object.dispose(); } else if (object instanceof THREE.Sprite) { object.material.map?.dispose(); materials.add(object.material); } });
    geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); this.scene.clear(); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
