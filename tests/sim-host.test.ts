import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { SimHost, type HostFrame } from '../src/native-host/sim-host';
import { ContextRules, type ContextAction, type ContextModelResult } from '../src/native-host/context-model';
import type { Simulation } from '../src/simulation';
import type { WorldDefinition } from '../src/types';
import type { PanesModel } from '../src/native-host/panes-model';

test('native host drives the authoritative simulation through requests', async () => {
  const host = new SimHost();
  const closed = await host.handle({ id: 1, op: 'step', seconds: .25 });
  assert.equal(closed.ok, false, 'steps before open are refused');
  const opened = await host.handle({ id: 2, op: 'open' });
  assert.equal(opened.ok, true, opened.error);
  const info = opened.result as { layout: string; seed: number; fingerprint: string; buildings: number; citizens: number };
  assert.equal(info.layout, 'current-v6'); assert.equal(info.seed, 20261001); assert.match(info.fingerprint, /^[0-9a-f]{1,8}$/);
  assert(info.buildings > 500 && info.citizens > 300);

  const stepped = await host.handle({ id: 3, op: 'step', seconds: .25, mode: 'walk', sinceEventId: 0 });
  assert.equal(stepped.ok, true, stepped.error);
  const frame = stepped.result as HostFrame;
  assert.equal(frame.ticks, 1); assert.equal(frame.tick, 1);
  assert(frame.vehicles.length > 100 && frame.vehicles.every(v => v.length === 9));
  assert(frame.events.some(e => e.type === 'arrival'), 'first frame carries the arrival notice');
  assert(Object.values(frame.signals).every(p => p === 0 || p === 1));
  assert.equal(frame.player.alive, true);
  assert(Object.values(frame.marketUnits).every(units => Number.isInteger(units) && units >= 1 && units <= 8), 'market samples follow the 8-unit display rule');
  assert(Array.isArray(frame.closedEdges));

  const bad = await host.handle({ id: 4, op: 'step', seconds: 99 });
  assert.equal(bad.ok, false, 'out-of-range real time is refused, not clamped silently');

  const paused = await host.handle({ id: 5, op: 'command', command: { type: 'pause', value: 1 } });
  assert.equal(paused.ok, true);
  assert.equal((paused.result as { result: { ok: boolean } }).result.ok, true);
  const still = (await host.handle({ id: 6, op: 'step', seconds: 1 })).result as HostFrame;
  assert.equal(still.ticks, 0); assert.equal(still.paused, true);

  const saved = (await host.handle({ id: 7, op: 'save' })).result as { save: string };
  const data = JSON.parse(saved.save);
  assert.equal(data.format, 'yunshan-save');
  const loaded = await host.handle({ id: 8, op: 'load', save: saved.save });
  assert.equal((loaded.result as { result: { ok: boolean } }).result.ok, true);

  const context = (await host.handle({ id: 9, op: 'context', view: { mode: 'walk' } })).result as ContextModelResult;
  assert(Array.isArray(context.sections));
  for (const section of context.sections) for (const action of section.actions) assert(action.client === 'interact' || typeof action.command?.type === 'string');

  const panes = (await host.handle({ id: 11, op: 'panes', view: { mode: 'walk' } })).result as PanesModel;
  assert.deepEqual(panes.panes.map(p => p.id), ['life', 'city', 'industry', 'transit', 'relations']);
  const titles = (id: string) => panes.panes.find(p => p.id === id)!.sections.map(s => s.title);
  assert(titles('life').includes('烹饪'));
  for (const title of ['选举与议案', '居民补选与地方议会', '道路与现场工程', '水能设施', '公共服务', '审计与司法', '公共账目']) assert(titles('city').includes(title), title);
  for (const title of ['当前乘坐', '路口调度', '航空器与停机位']) assert(titles('transit').includes(title), title);
  assert(titles('relations').includes('家庭与下一代'));
  for (const title of ['作品与见闻', '公共信息与请愿', '公共服务订单']) assert(titles('relations').includes(title), title);
  const forms = panes.panes.flatMap(p => p.sections).flatMap(s => s.forms ?? []);
  assert.deepEqual(forms.map(f => f.id), ['createWork', 'publishReport', 'filePetition']);
  const petition = forms.find(f => f.id === 'filePetition')!;
  assert.equal(petition.disabled, true, 'petitions are filed in the hall');
  const filed = (await host.handle({ id: 13, op: 'command', command: { ...petition.command, targetId: 'education', title: '书院加课', text: '希望书院在傍晚增加一节公开课，方便下工后的居民学习。' } })).result as { result: { ok: boolean; message: string } };
  assert.equal(filed.result.ok, false, 'the simulation still decides');
  const signal = panes.panes.find(p => p.id === 'transit')!.sections.find(s => s.title === '路口调度')!;
  assert(signal.actions.every(a => a.disabled), 'only police or the mayor dispatch junctions');
  assert.deepEqual(titles('industry'), ['产业版图', '并购', '交易所', '科技与未来']);
  const industry = panes.panes.find(p => p.id === 'industry')!;
  assert.equal(industry.sections[3].entries.length, 7, 'seven research sectors');
  assert(industry.sections[1].entries.length > 0, 'the city has companies to acquire');
  // A traveller at the spawn cannot found, research, trade shares or audit.
  for (const action of panes.panes.flatMap(p => p.sections).flatMap(s => [...s.actions, ...s.entries.flatMap(e => e.actions)]))
    if (['foundCompany', 'research', 'buyShares', 'sellShares', 'audit', 'expandCompany', 'listCompany', 'acquireCompany', 'cook'].includes(action.command?.type ?? '')) assert.equal(action.disabled, true, action.label);
  const transit = panes.panes.find(p => p.id === 'transit')!;
  const travel = transit.sections.flatMap(s => s.entries).flatMap(e => e.actions).find(a => a.command?.type === 'planJourney');
  assert(travel?.command?.targetId, 'transit pane offers real journey targets');
  const planned = (await host.handle({ id: 12, op: 'command', command: travel!.command })).result as { result: { ok: boolean; message: string }; frame: HostFrame };
  assert.equal(planned.result.ok, true, planned.result.message);
  assert(planned.frame.navigation?.destination, 'the frame carries the planned navigation line');

  // Mayor scheme buttons: one step from the proposed scheme, sent as the
  // simulation's own 'policy' command (which still checks the hall point).
  const { sim, world } = host as unknown as { sim: Simulation; world: WorldDefinition };
  const hall = world.buildings.find(b => b.kind === 'hall')!;
  const rules = () => new ContextRules(sim, world, { mode: 'walk' });
  const visitor: ContextAction[] = [], visitorNotes: string[] = [];
  rules().policyActions(hall, visitor, visitorNotes);
  assert.equal(visitor.length, 0); assert.match(visitorNotes.join(''), /参选成为市长/);
  sim.state.player.identities = [...(sim.state.player.identities ?? [sim.state.player.role]), 'mayor'];
  const mayor: ContextAction[] = [], mayorNotes: string[] = [];
  rules().policyActions(hall, mayor, mayorNotes);
  const tax = Math.round(sim.state.taxRate * 100), police = Math.round(sim.state.policeBudget * 100);
  const schemes = mayor.filter(a => a.command?.type === 'policy');
  assert.deepEqual(schemes.map(a => [a.command?.taxRate, a.command?.policeBudget]), [[(tax - 1) / 100, police / 100], [(tax + 1) / 100, police / 100], [tax / 100, (police - 5) / 100], [tax / 100, (police + 5) / 100]]);
  assert(schemes.every(a => a.command?.targetId === hall.id && !a.disabled));
  // A new city declares foreign trade: the mayor may close it, through the simulation's own command.
  const trade = mayor.filter(a => a.command?.type === 'foreignTrade');
  assert.deepEqual(trade.map(a => [a.label, a.command?.value]), [['关闭对外贸易', 0]]); assert.match(mayorNotes.join(''), /对外贸易：开放/);
  assert.equal(sim.command(trade[0].command!).ok, true);
  const reopened: ContextAction[] = []; rules().policyActions(hall, reopened, []);
  assert.deepEqual(reopened.filter(a => a.command?.type === 'foreignTrade').map(a => a.command?.value), [1]);
  assert.equal(sim.command({ type: 'foreignTrade', value: 1 }).ok, true);
  const away = sim.command(schemes[1].command!);
  assert.equal(away.ok, false); assert.match(away.message, /议事/);
  sim.state.policyPending = { taxRate: .2, policeBudget: .5, applyAt: sim.state.tick + 120 };
  const pending: ContextAction[] = [], pendingNotes: string[] = [];
  rules().policyActions(hall, pending, pendingNotes);
  assert.equal(pending[1].command?.taxRate, .21, 'the next step starts from the pending scheme');
  assert.match(pendingNotes[0], /待生效/);
  delete sim.state.policyPending;

  const unknown = await host.handle({ id: 10, op: 'teleport' });
  assert.equal(unknown.ok, false);
});

test('native host answers one JSON line per request over stdio', async () => {
  const entry = fileURLToPath(new URL('../src/native-host/sim-host.ts', import.meta.url));
  const child = spawn(process.execPath, ['--import', 'tsx', entry], { stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = new Promise(resolve => child.once('exit', resolve));
  const lines = createInterface({ input: child.stdout! });
  const replies: Record<string, unknown>[] = [], waiting: ((reply: Record<string, unknown>) => void)[] = [];
  lines.on('line', line => { const reply = JSON.parse(line); const waiter = waiting.shift(); if (waiter) waiter(reply); else replies.push(reply); });
  const next = () => new Promise<Record<string, unknown>>(resolve => { const reply = replies.shift(); if (reply) resolve(reply); else waiting.push(resolve); });
  child.stdin!.write('{"id":1,"op":"hello"}\nnot json\n{"id":2,"op":"quit"}\n');
  const hello = await next();
  assert.equal(hello.id, 1); assert.equal(hello.ok, true);
  const broken = await next();
  assert.equal(broken.ok, false);
  const quit = await next();
  assert.equal(quit.id, 2);
  const code = await exited;
  assert.equal(code, 0);
});
