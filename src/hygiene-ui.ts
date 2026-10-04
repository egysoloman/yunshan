import type { Command, SimState, WorldDefinition } from './types';
import { transferredSourceUnits, transferStationOccupied } from './simulation/hygiene-transfer';

function element(tag: 'div' | 'article' | 'strong' | 'p' | 'button', text = '', className = ''): HTMLElement { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; }
function button(text: string, type: Command['type'], target: string, disabled: boolean): HTMLButtonElement { const node = element('button', text, 'action-button') as HTMLButtonElement; node.type = 'button'; node.dataset.command = type; node.dataset.target = target; node.disabled = disabled; return node; }
export function hygieneSignature(state: SimState, siteId?: string): string { const capacities = new Map<string, number>(); for (const batch of state.hygiene?.batches ?? []) { const key = `${batch.siteId}:${batch.floor}:${batch.pointId}`; capacities.set(key, (capacities.get(key) ?? 0) + batch.containedUnits); } return JSON.stringify([...capacities.entries(),state.pathology?.episodes.player?.phase, state.pathology?.episodes.player?.severity, state.hygiene?.batches.filter(batch => !siteId || batch.siteId === siteId).map(batch => [batch.id, batch.contaminatedUnits, batch.reservedUnits, batch.sealedUnits, batch.cleaningResidualUnits, batch.containedUnits]), state.hygiene?.transfers?.tasks.map(t => [t.id, t.state, t.collectionMinutes, t.intakeMinutes, Math.floor(t.traveledDistance), t.escrow, t.reason]), state.hygiene?.jobs.filter(job => !siteId || job.siteId === siteId).map(job => [job.id, job.state, Math.floor(job.workedMinutes * 10), job.escrow, job.purchasePaid, job.refunded, job.reason])]); }
/** Reads authority; it creates no infection, inventory, operation or money. */
export function hygieneContent(state: SimState, world: WorldDefinition, siteId: string | undefined, canAct: boolean): HTMLElement {
  const body = element('div', '', 'hygiene-content'); body.dataset.hygiene = siteId ?? 'personal';
  const episode = state.pathology?.episodes.player;
  if (episode) {
    const names = { incubating: '潜伏期', symptomatic: '出现症状', recovering: '恢复中', recovered: '恢复后', dead: '已故' };
    body.append(element('strong', '健康状况'), element('p', `${names[episode.phase]} · 症状 ${Math.round(episode.severity)}/40 · 尚未完成检验。`, 'note'));
  }
  const h = state.hygiene; if (!h) return body;
  const batches = h.batches.filter(batch => siteId ? batch.siteId === siteId : batch.patientId === 'player').slice(-8);
  if (!batches.length && !h.transfers?.tasks.length) return body;
  body.append(element('strong', '诊疗用品用后保管'), element('p', '密封处理后，原用品与清洁材料仍需保管。每站点可安全收集8份；未收集的废物会继续留在原站点。', 'note'));
  for (const batch of batches) {
    const job = h.jobs.find(job => job.batchId === batch.id && !['completed', 'cancelled'].includes(job.state)), card = element('article', '', 'company-card'), moved = transferredSourceUnits(state, batch.id), total = batch.generatedUnits + batch.cleaningResidualUnits - moved, unsafe = total - batch.containedUnits;
    card.dataset.wasteBatch = batch.id;
    const localContained = h.batches.filter(other => other.siteId === batch.siteId && other.floor === batch.floor && other.pointId === batch.pointId).reduce((n,other) => n + other.containedUnits, 0), localHeld = localContained + transferStationOccupied(state,batch.siteId,batch.floor,batch.pointId,false), localReserved = transferStationOccupied(state,batch.siteId,batch.floor,batch.pointId) - transferStationOccupied(state,batch.siteId,batch.floor,batch.pointId,false);
    card.append(element('strong', `${world.buildings.find(site => site.id === batch.siteId)?.name ?? batch.siteId} · ${batch.id}`), element('p', `待处理 ${batch.contaminatedUnits} · 累计封存 ${batch.sealedUnits} · 累计清洁残留 ${batch.cleaningResidualUnits} · 已搬出 ${moved} · 当前源地 ${total} 份`, 'note'), element('p', `本批安全入容器 ${batch.containedUnits} · 未安全收集 ${unsafe} 份`, unsafe ? 'note warning' : 'note'));
    card.append(element('p', `原站点实存 ${localHeld}/8 · 另预约 ${localReserved} 份，共用有限容量。已购未提货运输耗材也占用空间。`, 'note'));
    if (batch.hazard === 'YV1') card.append(element('p', '污染用品：处理时需要防护，避免接触传播。', 'note'));
    if (job) {
      card.append(element('p', `实际劳动 ${Math.floor(job.workedMinutes * 10) / 10}/10 分钟 · 托管 ${job.escrow.toFixed(2)} · 采购实付 ${job.purchasePaid.toFixed(2)} · 退款 ${job.refunded.toFixed(2)} 云币`, 'note'), element('p', job.reason, 'note'));
      if (job.completedAt === null && job.cancelledAt === null) card.append(button('取消处理，保留废物与已购物料', 'cancelDisinfection', job.id, !canAct));
    } else if (batch.contaminatedUnits > 0) card.append(button('现场提交材料采购 · 20 云币托管上限', 'disinfectWaste', batch.id, !canAct || state.player.money < 20), element('p', '一份独立实购物料与10个真实在场计薪分钟才封存；未花采购款退回。须在原公共站点提交。', 'note'));
    if (batch.contaminatedUnits === 0 && batch.sealedUnits * 2 - moved >= 2) {
      const destinations = world.buildings.filter(b => b.kind === 'clinic' && b.id !== batch.siteId && (b.functionPoints ?? []).some(p => p.floor === 0 && p.purpose === 'service' && h.batches.filter(other => other.siteId === b.id && other.floor === p.floor && other.pointId === p.id).reduce((n,other) => n + other.containedUnits, 0) + transferStationOccupied(state,b.id,p.floor,p.id) + 3 <= 8)).sort((a,b) => Math.hypot(a.position.x-batch.point.x,a.position.z-batch.point.z)-Math.hypot(b.position.x-batch.point.x,b.position.z-batch.point.z)).slice(0,3);
      card.append(element('p', '志愿转运：本人20云币采购托管，一份真实运输耗材；两站各需医生2个实薪分钟。本人携带三份，接收站仍限8份。尚无末端处理。', 'note'));
      for (const destination of destinations) card.append(button(`转运保管到${destination.name}`, 'transferWaste', JSON.stringify([batch.id,destination.id]), !canAct || state.player.money < 20));
    }
    body.append(card);
  }
  for (const task of h.transfers?.tasks ?? []) {
    const card = element('article', '', 'company-card'); card.dataset.wasteTransfer = task.id;
    card.append(element('strong', `转运与保管 · ${task.id}`), element('p', `目的 ${world.buildings.find(b => b.id === task.destinationSiteId)?.name ?? task.destinationSiteId} · 原站交接 ${task.collectionMinutes}/2 · 接收 ${task.intakeMinutes}/2 分钟 · 实际移动 ${Math.floor(task.traveledDistance)}米`, 'note'), element('p', `本人采购托管 ${task.escrow.toFixed(2)} · 实付 ${task.purchasePaid.toFixed(2)} · 已退 ${task.refunded.toFixed(2)} 云币`, 'note'), element('p', task.reason, 'note'));
    const destinationContained = h.batches.filter(b => b.siteId === task.destinationSiteId && b.floor === task.destinationFloor && b.pointId === task.destinationPointId).reduce((n,b) => n + b.containedUnits, 0), destinationHeld = destinationContained + transferStationOccupied(state,task.destinationSiteId,task.destinationFloor,task.destinationPointId,false), destinationReserved = transferStationOccupied(state,task.destinationSiteId,task.destinationFloor,task.destinationPointId) - transferStationOccupied(state,task.destinationSiteId,task.destinationFloor,task.destinationPointId,false);
    card.append(element('p', `目的站实存 ${destinationHeld}/8 · 预约 ${destinationReserved} 份；尚无末端处理。`, 'note'));
    if (task.state === 'readyForPickup') card.append(button('本人现场提取三份封存运输包', 'collectWasteTransfer', task.id, !canAct));
    if (task.state === 'carried' || task.state === 'awaitingIntake') card.append(button('目的诊所现场提交接收', 'deliverWasteTransfer', task.id, !canAct));
    if (task.pickedAt === null && task.state !== 'cancelled') card.append(button('提货前取消，保留已购物料', 'cancelWasteTransfer', task.id, !canAct));
    body.append(card);
  }
  return body;
}
