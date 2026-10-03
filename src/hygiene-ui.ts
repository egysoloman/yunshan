import type { Command, SimState, WorldDefinition } from './types';

function element(tag: 'div' | 'article' | 'strong' | 'p' | 'button', text = '', className = ''): HTMLElement { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; }
function button(text: string, type: Command['type'], target: string, disabled: boolean): HTMLButtonElement { const node = element('button', text, 'action-button') as HTMLButtonElement; node.type = 'button'; node.dataset.command = type; node.dataset.target = target; node.disabled = disabled; return node; }
export function hygieneSignature(state: SimState, siteId?: string): string { return JSON.stringify([state.pathology?.episodes.player?.phase, state.pathology?.episodes.player?.severity, state.hygiene?.batches.filter(batch => !siteId || batch.siteId === siteId).map(batch => [batch.id, batch.contaminatedUnits, batch.reservedUnits, batch.sealedUnits, batch.cleaningResidualUnits, batch.containedUnits]), state.hygiene?.jobs.filter(job => !siteId || job.siteId === siteId).map(job => [job.id, job.state, Math.floor(job.workedMinutes * 10), job.escrow, job.purchasePaid, job.refunded, job.reason])]); }
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
  if (!batches.length) return body;
  body.append(element('strong', '诊疗用品用后保管'), element('p', '密封处理后，原用品与清洁材料仍需保管。每站点可安全收集8份；未收集的废物会继续留在原站点。', 'note'));
  for (const batch of batches) {
    const job = h.jobs.find(job => job.batchId === batch.id && !['completed', 'cancelled'].includes(job.state)), card = element('article', '', 'company-card'), total = batch.generatedUnits + batch.cleaningResidualUnits, unsafe = total - batch.containedUnits;
    card.dataset.wasteBatch = batch.id;
    card.append(element('strong', `${world.buildings.find(site => site.id === batch.siteId)?.name ?? batch.siteId} · ${batch.id}`), element('p', `待处理 ${batch.contaminatedUnits} · 已封存原用品 ${batch.sealedUnits} · 清洁残留 ${batch.cleaningResidualUnits} · 保管合计 ${total} 份`, 'note'), element('p', `安全入容器 ${batch.containedUnits}/8 · 未安全收集 ${unsafe} 份`, unsafe ? 'note warning' : 'note'));
    if (batch.hazard === 'YV1') card.append(element('p', '污染用品：处理时需要防护，避免接触传播。', 'note'));
    if (job) {
      card.append(element('p', `实际劳动 ${Math.floor(job.workedMinutes * 10) / 10}/10 分钟 · 托管 ${job.escrow.toFixed(2)} · 采购实付 ${job.purchasePaid.toFixed(2)} · 退款 ${job.refunded.toFixed(2)} 云币`, 'note'), element('p', job.reason, 'note'));
      if (job.completedAt === null && job.cancelledAt === null) card.append(button('取消处理，保留废物与已购物料', 'cancelDisinfection', job.id, !canAct));
    } else if (batch.contaminatedUnits > 0) card.append(button('现场提交材料采购 · 20 云币托管上限', 'disinfectWaste', batch.id, !canAct || state.player.money < 20), element('p', '一份独立实购物料与10个真实在场计薪分钟才封存；未花采购款退回。须在原公共站点提交。', 'note'));
    body.append(card);
  }
  return body;
}
