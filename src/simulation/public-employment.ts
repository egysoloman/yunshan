import type { Building, Citizen, Role, SimState, Vec3, WorldDefinition } from '../types';

export const TRANSFER_LIMIT = 1024, TRANSFER_CONTRACT_LIMIT = 2048;
const EPS = 1e-7;
export interface PublicAssignment { citizenId: string; workId: string; ratePerMinute: number; minutesCap: number; workedMinutes: number }
export interface PublicShift { id: string; day: number; approvedAt: number; siteId: string; approvedBy: string[]; cap: number; assignments: PublicAssignment[]; employmentRevision?: number }
export interface EmploymentTransfer {
  revision: number; at: number; tick: number; actorId: string; appointedBy: 'player';
  priorPublicWorkId: string | null; fromWorkId: string; fromRole: string; toWorkId: string;
  toRole: 'official' | 'council' | 'scientist'; educationAtAppointment: number;
  playerPosition: Vec3; actorPosition: Vec3;
  trainingFee: 100; guildId: 'org-guild'; treasuryBefore: number; treasuryAfter: number; guildBefore: number; guildAfter: number;
}
export interface TransferContract {
  id: string; transferRevision: number; employmentRevision: number; day: number; approvedAt: number;
  siteId: string; signatures: { actorId: string; workId: string; role: Role; position: Vec3; actualWageMinutes: number; fundedShiftId: string; fundedWorkedMinutes: number }[];
  funding: { publicWagesDue: number; publicWagesEarned: number; authorizedRemaining: number; priorPromises: number; essentialOperations: number; standingForecast: number };
  cash: number; protectedCash: number; available: number; cap: number; assignment: PublicAssignment;
}
export interface PublicEmployment {
  version: 2; activatedAt: number; baseRoles: Record<string,string>; transfers: EmploymentTransfer[]; contracts: TransferContract[];
}
export interface PublicLabor {
  version: 1 | 2; standingUntilDay: number; nextReviewAt: number; jobs: Record<string, string>;
  shifts: PublicShift[]; stats: { approvedMinutes: number; unfundedMinutes: number; workedMinutes: number; privateMoves: number };
  employment?: PublicEmployment;
}
export function publicEmploymentRevision(labor: PublicLabor): number { return labor.employment?.transfers.length ?? 0; }
export function publicEmploymentTransfer(labor: PublicLabor, actorId: string, revision = publicEmploymentRevision(labor)): EmploymentTransfer | undefined {
  const transfers = labor.employment?.transfers ?? [];
  for (let index = Math.min(revision, transfers.length) - 1; index >= 0; index--) if (transfers[index].actorId === actorId) return transfers[index];
  return undefined;
}
export function publicEmploymentSite(labor: PublicLabor, actorId: string, revision = publicEmploymentRevision(labor)): string | undefined {
  return publicEmploymentTransfer(labor, actorId, revision)?.toWorkId ?? labor.jobs[actorId];
}
export function publicEmploymentRole(labor: PublicLabor, actorId: string, revision = publicEmploymentRevision(labor)): string | undefined {
  return publicEmploymentTransfer(labor,actorId,revision)?.toRole ?? labor.employment?.baseRoles[actorId];
}
export function publicEmploymentJobs(labor: PublicLabor, revision = publicEmploymentRevision(labor)): Record<string, string> {
  if (!labor.employment || revision === 0) return labor.jobs;
  const jobs = { ...labor.jobs };
  for (const transfer of labor.employment.transfers.slice(0, revision)) jobs[transfer.actorId] = transfer.toWorkId;
  return jobs;
}
export function publicTransferAssignment(labor: PublicLabor, actor: Citizen, day: number): PublicAssignment | undefined {
  const history=labor.employment?.transfers.filter(transfer=>transfer.actorId===actor.id) ?? [],transfer=history.at(-1);
  let first=history.length-1;
  // A title change at the same actual employer retains its signed wages. A
  // genuine departure, including a private job before returning, breaks it.
  while(first>0 && history[first].fromWorkId===actor.workId && history[first].toWorkId===actor.workId)first--;
  return labor.employment?.contracts.find(contract => contract.day === day && !!transfer && contract.transferRevision>=history[first].revision && contract.transferRevision<=transfer.revision
    && contract.assignment.citizenId === actor.id && contract.assignment.workId === actor.workId)?.assignment;
}
export function publicTransferReserved(labor: PublicLabor | undefined, day: number): number {
  return labor?.employment?.contracts.filter(contract => contract.day >= day).reduce((sum, contract) => sum
    + Math.max(0, contract.assignment.minutesCap - contract.assignment.workedMinutes) * contract.assignment.ratePerMinute, 0) ?? 0;
}
export function canRecordPublicTransfer(labor: PublicLabor | undefined, actor: Citizen, site: Building, privateSites: ReadonlySet<string>): boolean {
  if (!labor || labor.version===1 && actor.workId === site.id) return true;
  if (publicEmploymentRevision(labor) >= TRANSFER_LIMIT) return false;
  const prior = publicEmploymentSite(labor, actor.id);
  // A real private employer is an explicit entry/return boundary. An unknown
  // public career change has no historical contract proof to rewrite.
  return prior === actor.workId || privateSites.has(actor.workId);
}
export function recordPublicTransfer(labor: PublicLabor | undefined, receipt: Omit<EmploymentTransfer, 'revision'>, baseRoles: Record<string,string>): void {
  if (!labor || labor.version===1 && receipt.fromWorkId === receipt.toWorkId) return;
  if (!labor.employment) {
    labor.version = 2;
    labor.employment = { version: 2, activatedAt: receipt.at, baseRoles, transfers: [], contracts: [] };
  }
  labor.employment.transfers.push({ revision: labor.employment.transfers.length + 1, ...receipt });
}

/** Strict new contract checks. Original v1 jobs and historical shifts retain
 * their own original validator; an unused optional subsystem writes no bytes. */
export function validatePublicEmployment(labor: PublicLabor, state: SimState, world: WorldDefinition,
  physicalWorkPoint: (site: Building, position: Vec3, person: {role:Role;identities:Role[]}, workOnly?: boolean) => boolean,
  context: { identity:(role:string)=>Role; budgets:{approvedAt:number;cap:number;spent:number;closedAt:number|null}[];
    publicWagesDue:number;publicWagesEarned:number;essentialOperations:number; claims:{citizenId:string;workId?:string;shopId?:string|null;ratePerMinute:number}[] }): void {
  function need(condition: unknown, label: string): asserts condition { if (!condition) throw new Error(`public employment ${label}`); }
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  const number = (value: unknown, min: number, max: number, label: string, integer = false) => need(finite(value) && value >= min - EPS && value <= max + EPS && (!integer || Number.isInteger(value)), label);
  const shape = (value: unknown, keys: string[], label: string) => need(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(','), label);
  const now = state.extension!.lastUpdate, day = Math.floor(now / 1440), sites = new Map(world.buildings.map(site => [site.id, site]));
  const privateSites = new Set(state.shops.map(shop => shop.buildingId));
  const actors = new Map(state.citizens.map(actor => [actor.id, actor]));
  const position = (value: Vec3, label: string) => { shape(value, ['x','y','z'], label); for (const coordinate of [value.x,value.y,value.z]) number(coordinate,-1e8,1e8,label); };
  if (labor.version === 1) { need(labor.employment === undefined, 'v1 cannot hide new rights'); return; }
  need(labor.version === 2 && labor.employment, 'v2 contract marker');
  const employment = labor.employment!;
  shape(employment,['version','activatedAt','baseRoles','transfers','contracts'],'state shape');
  need(employment.baseRoles && typeof employment.baseRoles==='object' && !Array.isArray(employment.baseRoles)
    && Object.keys(employment.baseRoles).sort().join(',')===Object.keys(labor.jobs).sort().join(','),'original role registry');
  for(const role of Object.values(employment.baseRoles))need(typeof role==='string' && role.length>0 && role.length<=100,'original public role');
  need(employment.version === 2 && Array.isArray(employment.transfers) && employment.transfers.length > 0 && employment.transfers.length <= TRANSFER_LIMIT,'version and bounded transfer history');
  need(Array.isArray(employment.contracts) && employment.contracts.length <= TRANSFER_CONTRACT_LIMIT,'bounded supplementary contracts');
  number(employment.activatedAt,0,now,'activation');
  const jobs = { ...labor.jobs }, roles={...employment.baseRoles}, lastTransfer = new Map<string, EmploymentTransfer>();
  let previousAt = employment.activatedAt;
  for (const [index, transfer] of employment.transfers.entries()) {
    shape(transfer,['revision','at','tick','actorId','appointedBy','priorPublicWorkId','fromWorkId','fromRole','toWorkId','toRole','educationAtAppointment','playerPosition','actorPosition','trainingFee','guildId','treasuryBefore','treasuryAfter','guildBefore','guildAfter'],'transfer shape');
    need(transfer.revision === index + 1 && actors.has(transfer.actorId) && transfer.appointedBy === 'player','transfer identity');
    number(transfer.at,previousAt,now,'ordered appointment'); previousAt = transfer.at;
    number(transfer.tick,0,state.tick,'appointment tick',true);
    if (index === 0) need(transfer.at === employment.activatedAt,'first real activation');
    const former = lastTransfer.get(transfer.actorId);
    if (former) need(transfer.at >= former.at + 1440 - EPS,'original one-day appointment cooldown');
    need(transfer.priorPublicWorkId === (jobs[transfer.actorId] ?? null),'prior public contract');
    need(sites.has(transfer.fromWorkId) && sites.has(transfer.toWorkId) && (index>0 || transfer.fromWorkId!==transfer.toWorkId) && !privateSites.has(transfer.toWorkId),'real new public site');
    need(transfer.fromWorkId === transfer.priorPublicWorkId || privateSites.has(transfer.fromWorkId),'known actual source job');
    need(['official','council','scientist'].includes(transfer.toRole) && typeof transfer.fromRole === 'string' && transfer.fromRole.length > 0 && transfer.fromRole.length <= 100,'original appointment roles');
    if(transfer.fromWorkId===transfer.priorPublicWorkId)need(transfer.fromRole===roles[transfer.actorId],'actual preceding public role');
    number(transfer.educationAtAppointment,transfer.toRole === 'scientist' ? 3 : 2,20,'original qualification');
    need(transfer.trainingFee === 100 && transfer.guildId === 'org-guild','original training fee recipient');
    for (const value of [transfer.treasuryBefore,transfer.treasuryAfter]) number(value,0,1e12,'real treasury receipt');
    for (const value of [transfer.guildBefore,transfer.guildAfter]) number(value,0,1e9,'real guild receipt');
    need(Math.abs(transfer.treasuryBefore - transfer.treasuryAfter - 100) < EPS && Math.abs(transfer.guildAfter - transfer.guildBefore - 100) < EPS,'actual100 transfer conservation');
    position(transfer.playerPosition,'mayor position'); position(transfer.actorPosition,'appointee position');
    need(Math.hypot(transfer.playerPosition.x-transfer.actorPosition.x,transfer.playerPosition.y-transfer.actorPosition.y,transfer.playerPosition.z-transfer.actorPosition.z) <= 24 + EPS,'original nearby appointee');
    const target = sites.get(transfer.toWorkId)!;
    need(['hall','core'].includes(target.kind) || ['mayor','council','administration'].includes(target.facility ?? ''),'appointment government site');
    need(physicalWorkPoint(target,transfer.playerPosition,{role:'mayor',identities:['mayor']},false),'historical actual mayor venue');
    jobs[transfer.actorId] = transfer.toWorkId; roles[transfer.actorId]=transfer.toRole; lastTransfer.set(transfer.actorId,transfer);
  }
  const ids = new Set<string>();
  for (const [contractIndex,contract] of employment.contracts.entries()) {
    shape(contract,['id','transferRevision','employmentRevision','day','approvedAt','siteId','signatures','funding','cash','protectedCash','available','cap','assignment'],'supplement shape');
    number(contract.transferRevision,1,employment.transfers.length,'contract transfer',true);
    number(contract.employmentRevision,contract.transferRevision,employment.transfers.length,'approval history revision',true);
    const transfer = employment.transfers[contract.transferRevision - 1];
    number(contract.approvedAt,employment.transfers[contract.employmentRevision-1].at,now,'signed time');
    number(contract.day,Math.floor(contract.approvedAt / 1440),Math.min(day+1,Math.floor(contract.approvedAt / 1440)+1),'current or next signed day',true);
    need(contract.day >= labor.standingUntilDay,'supplement cannot double a standing work allowance');
    need(contract.id === `public-transfer-${contract.day}-${transfer.actorId}-${transfer.revision}` && !ids.has(contract.id),'unique supplement'); ids.add(contract.id);
    need(['hall','core','bank'].includes(sites.get(contract.siteId)?.kind ?? ''),'review government site');
    const approvalJobs = publicEmploymentJobs(labor,contract.employmentRevision);
    need(approvalJobs[transfer.actorId] === transfer.toWorkId && publicEmploymentTransfer(labor,transfer.actorId,contract.employmentRevision)?.revision === transfer.revision,'current job at approval');
    need(Array.isArray(contract.signatures) && contract.signatures.length === 2 && new Set(contract.signatures.map(signature=>signature.actorId)).size === 2,'two real public signers');
    for (const signature of contract.signatures) {
      shape(signature,['actorId','workId','role','position','actualWageMinutes','fundedShiftId','fundedWorkedMinutes'],'signature shape');
      need(actors.has(signature.actorId) && ['official','council','mayor'].includes(signature.role) && signature.workId === contract.siteId && approvalJobs[signature.actorId] === contract.siteId,'historical signer job/role');
      need(signature.role===context.identity(publicEmploymentRole(labor,signature.actorId,contract.employmentRevision) ?? ''),'actual role at signing revision');
      number(signature.actualWageMinutes,0,480,'actual funded signer work'); need(signature.actualWageMinutes > 0,'strictly positive funded signer work'); position(signature.position,'signer position');
      const sourceShift=labor.shifts.find(shift=>shift.id===signature.fundedShiftId && shift.day===Math.floor(contract.approvedAt/1440) && shift.approvedAt<=contract.approvedAt);
      const funded=sourceShift?.assignments.find(assignment=>assignment.citizenId===signature.actorId && assignment.workId===signature.workId);
      need(funded && finite(signature.fundedWorkedMinutes) && signature.fundedWorkedMinutes>0 && signature.fundedWorkedMinutes<funded.minutesCap
        && signature.fundedWorkedMinutes<=funded.workedMinutes+EPS && signature.fundedWorkedMinutes<=signature.actualWageMinutes+EPS,'prior actual funded same-day signer work');
      need(physicalWorkPoint(sites.get(contract.siteId)!,signature.position,{role:signature.role,identities:[signature.role]}),'actual historical signer work point');
    }
    for (const value of [contract.cash,contract.protectedCash,contract.available,contract.cap]) number(value,0,1e12,'funding proof');
    need(Math.abs(contract.available - Math.max(0,contract.cash-contract.protectedCash)) < 1e-6 && contract.cap <= contract.available + EPS,'old promises and actual funds protected');
    shape(contract.funding,['publicWagesDue','publicWagesEarned','authorizedRemaining','priorPromises','essentialOperations','standingForecast'],'funding components');
    for(const value of Object.values(contract.funding))number(value,0,1e12,'protected funding component');
    need(Math.abs(Object.values(contract.funding).reduce((sum,value)=>sum+value,0)-contract.protectedCash)<1e-6,'complete protected funding sum');
    const signedDay=Math.floor(contract.approvedAt/1440),unused=(assignment:PublicAssignment)=>Math.max(0,assignment.minutesCap-assignment.workedMinutes)*assignment.ratePerMinute;
    const minimumPromises=labor.shifts.filter(shift=>shift.day>=signedDay && shift.approvedAt<=contract.approvedAt).reduce((sum,shift)=>sum+shift.assignments.reduce((sum,assignment)=>sum+unused(assignment),0),0)
      +employment.contracts.slice(0,contractIndex).filter(source=>source.day>=signedDay && source.approvedAt<=contract.approvedAt).reduce((sum,source)=>sum+unused(source.assignment),0);
    const minimumAuthorized=context.budgets.filter(budget=>budget.approvedAt<contract.approvedAt && budget.closedAt===null).reduce((sum,budget)=>sum+budget.cap-budget.spent,0);
    need(contract.funding.priorPromises+1e-6>=minimumPromises && contract.funding.authorizedRemaining+1e-6>=minimumAuthorized,'actual surviving prior commitments cannot disappear');
    if(Math.abs(contract.approvedAt-now)<EPS){
      need(Math.abs(contract.funding.publicWagesDue-context.publicWagesDue)<1e-6 && Math.abs(contract.funding.publicWagesEarned-context.publicWagesEarned)<1e-6,'current actual unpaid wage debt protected');
      need(Math.abs(contract.funding.essentialOperations-context.essentialOperations)<1e-6,'current essential operations protected');
    }
    const assignment = contract.assignment;
    shape(assignment,['citizenId','workId','ratePerMinute','minutesCap','workedMinutes'],'new assignment shape');
    need(assignment.citizenId === transfer.actorId && assignment.workId === transfer.toWorkId,'assigned actual appointee');
    number(assignment.ratePerMinute,0,1,'new original wage formula rate'); need(assignment.ratePerMinute > 0 && contract.cap > 0,'strictly positive real wage promise'); number(assignment.minutesCap,1,480,'finite new minutes',true); number(assignment.workedMinutes,0,assignment.minutesCap,'actual new minutes');
    need(assignment.ratePerMinute>=32*.7/480-EPS && assignment.ratePerMinute<=32*1.7/480+EPS,'original public wage formula range');
    if(Math.abs(contract.approvedAt-now)<EPS){const claim=context.claims.find(claim=>claim.citizenId===assignment.citizenId && claim.workId===assignment.workId && claim.shopId===null);
      if(claim)need(Math.abs(claim.ratePerMinute-assignment.ratePerMinute)<1e-9,'current existing earned wage rate');}
    need(Math.abs(contract.cap-assignment.ratePerMinute*assignment.minutesCap) < 1e-6,'actual gross new wage cap');
    if (contract.day > day) need(assignment.workedMinutes === 0,'no future actual labor');
  }
  // Existing daily attendance is a single authority across every old and new
  // contract; each retained day's actually worked slices must also honor480.
  const actualByDay = new Map<string,number>();
  const add = (day:number,assignment:PublicAssignment) => { const key=`${day}:${assignment.citizenId}`;actualByDay.set(key,(actualByDay.get(key)??0)+assignment.workedMinutes); };
  for(const shift of labor.shifts)for(const assignment of shift.assignments)add(shift.day,assignment);
  for(const contract of employment.contracts)add(contract.day,contract.assignment);
  for(const value of actualByDay.values())need(value <= 480 + 1e-6,'real shared daily480 limit');
}
