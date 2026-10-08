import { CURVED_ROOF_PROFILE_KNOTS, CURVED_ROOF_PROFILE_VERSION } from '../geometry/roof-profile';

/** The existing scalar reserves 0 for transport, 1 for station canopies and
 * 2 for other architecture. Only the exact current profile receives end-face
 * joinery; these values neither create a batch nor change a roof's geometry. */
export function architectureRoofSurface(templateKey?: string): 2 | 3 | 4 {
  if (templateKey === `program-${CURVED_ROOF_PROFILE_VERSION}-x`) return 3;
  if (templateKey === `program-${CURVED_ROOF_PROFILE_VERSION}-z`) return 4;
  return 2;
}

const glsl = (value: number): string => Number.isInteger(value) ? `${value}.0` : String(value);

/** Evaluate the authoritative polyline at vertices, not at every fragment.
 * Each existing cap triangle stays inside one profile interval, so linear
 * interpolation of the distance below its top remains exact on that face.
 * No knots, vertices, UVs, collision bounds or saved descriptors are changed. */
export const ROOF_END_VERTEX = `
  vRoofEndMetric=vec3(0.0);
  if(vRoofSurface>2.5){
    bool roofEndAlongX=vRoofSurface<3.5;
    float roofEndCross=roofEndAlongX?vRoofMetric.x:vRoofMetric.z;
    float roofEndSpan=roofEndAlongX?roofScale.x:roofScale.z;
    float roofEndU=clamp(roofEndCross/max(.001,roofEndSpan)+.5,0.0,1.0);
    float roofEndTop=${glsl(CURVED_ROOF_PROFILE_KNOTS[CURVED_ROOF_PROFILE_KNOTS.length - 1][1])};
    ${CURVED_ROOF_PROFILE_KNOTS.slice(1).map(([right, rightHeight], index) => {
      const [left, leftHeight] = CURVED_ROOF_PROFILE_KNOTS[index];
      return `${index ? 'else ' : ''}if(roofEndU<=${glsl(right)})roofEndTop=mix(${glsl(leftHeight)},${glsl(rightHeight)},clamp((roofEndU-${glsl(left)})/(${glsl(right)}-${glsl(left)}),0.0,1.0));`;
    }).join('\n    ')}
    float roofEndHeight=vRoofMetric.y+roofScale.y*.5;
    vRoofEndMetric=vec3(roofEndCross,roofEndHeight,roofEndTop*roofScale.y-roofEndHeight);
  }`;

/** Pigment and at most 3mm normal relief on the already-opaque roof ends.
 * Narrow bands follow the real curved top; the gable has timber-framed infill
 * while long eaves have boarded fascia. They are finishes, not extra rooms,
 * posts, inventory, openings, light sources or unsupported roof extensions. */
export const ROOF_END_FRAGMENT = `
  bool roofEndGable=(vRoofSurface<3.5?abs(vRoofNormal.z):abs(vRoofNormal.x))>.5;
  float roofEndAlong=roofEndGable?vRoofEndMetric.x:(vRoofSurface<3.5?vRoofMetric.z:vRoofMetric.x);
  vec2 roofEndMetric=vec2(roofEndAlong,vRoofEndMetric.y);
  vec2 roofEndPixel=max(fwidth(roofEndMetric),vec2(.002));
  float roofEndDetail=1.0-smoothstep(.07,.24,max(roofEndPixel.x,roofEndPixel.y));
  float roofEndDepth=max(0.0,vRoofEndMetric.z);
  float roofEndEdgePixel=max(fwidth(vRoofEndMetric.z),.002);
  float roofEndCeramic=1.0-smoothstep(.18-roofEndEdgePixel,.18+roofEndEdgePixel,roofEndDepth);
  float roofEndBarge=1.0-smoothstep(.38-roofEndEdgePixel,.38+roofEndEdgePixel,roofEndDepth);
  float roofEndBase=1.0-smoothstep(.20-roofEndPixel.y,.20+roofEndPixel.y,vRoofEndMetric.y);
  float roofEndPostDistance=abs(mod(roofEndAlong+1.2,2.4)-1.2);
  float roofEndPost=(1.0-smoothstep(.085,.085+roofEndPixel.x,roofEndPostDistance))*roofEndDetail;
  float roofEndGrain=sin(roofEndAlong*2.1+sin(vRoofEndMetric.y*48.0)*.8);
  float roofEndGrainFilter=1.0-smoothstep(.012,.045,max(roofEndPixel.x,roofEndPixel.y));
  vec3 roofEndTimber=vec3(.28,.145,.068)*(1.0+roofEndGrain*.045*roofEndGrainFilter);
  float roofEndPlaster=sin(roofEndAlong*6.7+sin(vRoofEndMetric.y*4.1))*sin(vRoofEndMetric.y*8.3);
  vec3 roofEndInfill=vec3(.58,.47,.30)*(1.0+roofEndPlaster*.025*roofEndDetail);
  float roofEndFrame=max(max(roofEndBarge,roofEndBase),roofEndPost);
  float roofEndBoardDistance=abs(mod(vRoofEndMetric.y+.2,.4)-.2);
  float roofEndBoard=(1.0-smoothstep(.008,.018+roofEndPixel.y,roofEndBoardDistance))*roofEndDetail;
  vec3 roofEndColor=roofEndGable?mix(roofEndInfill,roofEndTimber,roofEndFrame):roofEndTimber*(1.0-roofEndBoard*.17);
  float roofEndTileDistance=abs(mod(roofEndAlong+.2,.4)-.2);
  float roofEndTileJoint=(1.0-smoothstep(.008,.018+roofEndPixel.x,roofEndTileDistance))*roofEndDetail;
  vec3 roofEndJade=mix(diffuseColor.rgb,vec3(.10,.21,.16),.55)*(1.0-roofEndTileJoint*.20);
  diffuseColor.rgb=mix(roofEndColor,roofEndJade,roofEndCeramic);
  roofRoughness=mix(roofEndGable?mix(.9,.7,roofEndFrame):.7,.48,roofEndCeramic);
  roofRelief=-.003*roofEndTileJoint*roofEndCeramic-.002*roofEndBoard*(1.0-roofEndCeramic)*float(!roofEndGable);
`;
