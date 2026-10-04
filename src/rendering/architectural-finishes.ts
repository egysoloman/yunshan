import type * as THREE from 'three';

/** Original procedural artwork on existing solids. No textures, new openings,
 * displaced vertices or world state are created. Transport instances carry a
 * zero flag, because these materials are also used by roads and vehicles. */
export function installArchitecturalFinishes(materials: Pick<Record<string, THREE.MeshStandardMaterial>, 'wall' | 'wood' | 'stone' | 'fabric'>): void {
  for (const key of ['wall', 'wood', 'stone', 'fabric'] as const) {
    const material = materials[key], previousCompile = material.onBeforeCompile, previousKey = material.customProgramCacheKey.bind(material);
    const inheritedKey = previousKey();
    material.customProgramCacheKey = () => `${inheritedKey}:street-life-finish-${key}-v1`;
    material.onBeforeCompile = (shader, renderer) => {
      previousCompile.call(material, shader, renderer);
      shader.vertexShader = 'attribute float instanceBuildingFinish;varying vec3 vFinishMetric;varying vec3 vFinishSize;varying vec3 vFinishNormal;varying vec2 vFinishState;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 finishSize=vec3(1.0),finishOrigin=vec3(0.0);
        #ifdef USE_INSTANCING
        finishSize=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
        finishOrigin=instanceMatrix[3].xyz;
        #endif
        vFinishMetric=(position+.5)*finishSize;vFinishSize=finishSize;vFinishNormal=normal;
        vFinishState=vec2(instanceBuildingFinish,fract(sin(dot(finishOrigin,vec3(12.9898,78.233,39.425)))*43758.5453));`);
      shader.fragmentShader = 'varying vec3 vFinishMetric;varying vec3 vFinishSize;varying vec3 vFinishNormal;varying vec2 vFinishState;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        if(vFinishState.x>.5){
          vec2 finishMetric=abs(vFinishNormal.y)>.5?vFinishMetric.xz:abs(vFinishNormal.z)>.5?vFinishMetric.xy:vFinishMetric.zy;
          vec2 finishSize=abs(vFinishNormal.y)>.5?vFinishSize.xz:abs(vFinishNormal.z)>.5?vFinishSize.xy:vFinishSize.zy;
          vec2 finishPixel=max(fwidth(finishMetric),vec2(.001));
          float finishDetail=1.0-smoothstep(.035,.16,max(finishPixel.x,finishPixel.y));
          ${key === 'wall' ? `
            // Lime plaster has sparse trowel marks and worn lower edges. These
            // stains are decoration, not evidence of sanitation or damage.
            float plaster=sin(finishMetric.x*17.0+sin(finishMetric.y*7.0))*sin(finishMetric.y*23.0);
            float lowerWear=(1.0-smoothstep(.0,.34,vFinishMetric.y))*(.045+.04*vFinishState.y);
            vec2 edge=min(finishMetric,finishSize-finishMetric);
            float cornerWear=(1.0-smoothstep(.008,.055,min(edge.x,edge.y)))*.08;
            diffuseColor.rgb*=1.0+plaster*.022*finishDetail;
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.30,.32,.25),(lowerWear+cornerWear)*finishDetail);` : key === 'wood' ? `
            // Grain follows the longest actual timber axis, including beams
            // and furniture, rather than vertical stripes on every object.
            bool grainY=vFinishSize.y>=max(vFinishSize.x,vFinishSize.z);
            bool grainX=!grainY&&vFinishSize.x>=vFinishSize.z;
            float along=grainY?vFinishMetric.y:grainX?vFinishMetric.x:vFinishMetric.z;
            float across=grainY?finishMetric.x:abs(vFinishNormal.y)>.5?(grainX?vFinishMetric.z:vFinishMetric.x):vFinishMetric.y;
            float grain=sin(across*67.0+sin(along*1.7+vFinishState.y*6.28)*1.8);
            float fineGrain=sin(across*133.0+sin(along*2.3)*2.1);
            vec2 edge=min(finishMetric,finishSize-finishMetric);
            float rubbedEdge=1.0-smoothstep(.012,.04+max(finishPixel.x,finishPixel.y),min(edge.x,edge.y));
            diffuseColor.rgb*=1.0+(grain*.055+fineGrain*.022)*finishDetail;
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.46,.31,.18),rubbedEdge*finishDetail*.24);
            if(vCabinet.w>1.5&&vFinishNormal.y>.5){
              // A geometric inlay on the real tabletop, never an invented
              // monitor, document or item that claims a usable function.
              vec2 tabletopEdge=min(vFinishMetric.xz,vFinishSize.xz-vFinishMetric.xz);
              float border=1.0-smoothstep(.014,.024+max(finishPixel.x,finishPixel.y),abs(min(tabletopEdge.x,tabletopEdge.y)-.12));
              diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.65,.48,.25),border*.65*finishDetail);
            }` : key === 'stone' ? `
            // A restrained mineral variation makes each existing stone course
            // legible. No extra paving, platform or collision is introduced.
            float mineral=sin(finishMetric.x*9.0+sin(finishMetric.y*13.0))*sin(finishMetric.y*7.0);
            float lowerPatina=(1.0-smoothstep(0.0,.18,vFinishMetric.y))*float(abs(vFinishNormal.y)<.5);
            diffuseColor.rgb*=1.0+mineral*.035*finishDetail;
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.23,.29,.23),lowerPatina*finishDetail*.14);` : `
            // Woven linen and quilt stitching belong only to real bedding.
            // They change albedo, not bed height, inventory or sleep rules.
            vec2 weave=sin(finishMetric*vec2(470.0,390.0));
            vec2 clothCell=finishMetric/vec2(.2,.2);
            vec2 clothEdge=min(fract(clothCell),1.0-fract(clothCell))*.2;
            float stitch=1.0-smoothstep(.003,.006+max(finishPixel.x,finishPixel.y),min(clothEdge.x,clothEdge.y));
            diffuseColor.rgb*=1.0+(weave.x+weave.y)*.035*finishDetail;
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.76,.72,.58),stitch*.18*finishDetail);`}
        }`);
    };
  }
}
