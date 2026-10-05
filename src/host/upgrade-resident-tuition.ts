import type { Simulation } from '../simulation';
import type { CommandResult } from '../types';
import { RESIDENT_TUITION_POLICY } from '../simulation/resident-education';

/** Host-only exact-current-v4 cutover. Adds only the two policy declarations;
 * no pupil, cash, material, arrival, degree or profession is created. */
export async function upgradeResidentTuition(simulation:Simulation,expectedCurrentV4SHA256:string):Promise<CommandResult>{
  if(typeof expectedCurrentV4SHA256!=='string' || !/^[0-9a-f]{64}$/.test(expectedCurrentV4SHA256))return {ok:false,message:'成年自费课程升级需要当前v4原件精确SHA256。'};
  try{
    if(simulation.saveVersion!==4 || simulation.motionVersion!==2 || simulation.residentTuitionPolicyId!=='legacy' || simulation.state.residentEducation!==undefined)return {ok:false,message:'只有尚未启用本人自费课程的完整v4/motion2城市可切换。'};
    const snapshot=simulation.exportSave(),validated=simulation.validateSave(snapshot);if(!validated.ok)return {ok:false,message:`原件未通过生产校验：${validated.message}`};
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(snapshot)),actual=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    if(actual!==expectedCurrentV4SHA256 || simulation.exportSave()!==snapshot)return {ok:false,message:'原件SHA不符或等待期间城市已继续；原城市未改变。'};
    const candidate=JSON.parse(snapshot);candidate.residentTuitionPolicyId=RESIDENT_TUITION_POLICY;candidate.runtime.residentTuitionPolicyId=RESIDENT_TUITION_POLICY;return simulation.importSave(JSON.stringify(candidate));
  }catch(error){return {ok:false,message:`成年自费课程升级被拒：${error instanceof Error?error.message:'格式错误'}；原城市未改变。`};}
}
