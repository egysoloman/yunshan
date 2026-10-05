import type * as THREE from 'three';

/** Material responses for existing detail instances. One opaque draw batch
 * still carries wood, stone and tile; no texture, vertex displacement, baked
 * light, new inventory or world geometry is introduced. */
export function installDetailSurfaceFinishes(material: THREE.MeshStandardMaterial): void {
  material.metalness = 0;
  material.customProgramCacheKey = () => 'yunshan-detail-wood-stone-tile-v1';
  material.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float instanceDetailSurface;varying vec3 vDetailMetric;varying vec3 vDetailSize;varying vec3 vDetailFace;varying float vDetailSurface;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 detailSize=vec3(1.0);
      #ifdef USE_INSTANCING
      detailSize=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
      #endif
      vDetailMetric=(position+.5)*detailSize;vDetailSize=detailSize;vDetailFace=normal;vDetailSurface=instanceDetailSurface;`);
    shader.fragmentShader = 'varying vec3 vDetailMetric;varying vec3 vDetailSize;varying vec3 vDetailFace;varying float vDetailSurface;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec2 detailMetric=abs(vDetailFace.y)>.5?vDetailMetric.xz:abs(vDetailFace.z)>.5?vDetailMetric.xy:vDetailMetric.zy;
      vec2 detailPixel=max(fwidth(detailMetric),vec2(.001));
      float detailVisibility=1.0-smoothstep(.035,.12,max(detailPixel.x,detailPixel.y));
      float detailRelief=0.0,detailRoughness=.8;
      if(vDetailSurface<1.5){
        bool timberY=vDetailSize.y>=max(vDetailSize.x,vDetailSize.z);
        bool timberX=!timberY&&vDetailSize.x>=vDetailSize.z;
        float timberAlong=timberY?vDetailMetric.y:timberX?vDetailMetric.x:vDetailMetric.z;
        float timberAcross=timberY?detailMetric.x:abs(vDetailFace.y)>.5?(timberX?vDetailMetric.z:vDetailMetric.x):vDetailMetric.y;
        float timberGrain=sin(timberAcross*66.0+sin(timberAlong*1.7)*1.5);
        float timberFilter=1.0-smoothstep(.012,.045,max(detailPixel.x,detailPixel.y));
        diffuseColor.rgb*=1.0+timberGrain*.07*timberFilter;
        detailRelief=timberGrain*.0008*timberFilter;
        detailRoughness=.68-timberGrain*.035*timberFilter;
      }else if(vDetailSurface<2.5){
        vec2 blockUv=detailMetric/vec2(.8,.4);
        blockUv.x+=mod(floor(blockUv.y),2.0)*.5;
        vec2 edge=min(fract(blockUv),1.0-fract(blockUv))*vec2(.8,.4);
        float seam=(1.0-smoothstep(.01,.022+max(detailPixel.x,detailPixel.y),min(edge.x,edge.y)))*detailVisibility;
        float blockTone=fract(sin(dot(floor(blockUv),vec2(23.13,91.7)))*18317.4);
        diffuseColor.rgb*=mix(1.0,.94+blockTone*.10,detailVisibility)*(1.0-seam*.13);
        detailRelief=-seam*.003;detailRoughness=.91;
      }else{
        float tileGlaze=.5+.5*sin(detailMetric.x*31.4159);
        diffuseColor.rgb*=1.0+(tileGlaze-.5)*.07*detailVisibility;
        detailRelief=tileGlaze*.002*detailVisibility;detailRoughness=.55+tileGlaze*.08;
      }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=detailRoughness;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec3 detailDx=dFdx(-vViewPosition),detailDy=dFdy(-vViewPosition);
      vec3 detailR1=cross(detailDy,normal),detailR2=cross(normal,detailDx);
      float detailDet=dot(detailDx,detailR1)*faceDirection;
      vec3 detailGrad=dFdx(detailRelief)*detailR1+dFdy(detailRelief)*detailR2;
      if(abs(detailDet)>1e-10)normal=normalize(abs(detailDet)*normal-sign(detailDet)*detailGrad);`);
  };
}
