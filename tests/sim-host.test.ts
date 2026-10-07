import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { SimHost, type HostFrame } from '../src/native-host/sim-host';
import type { ContextModelResult } from '../src/native-host/context-model';
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
  assert.deepEqual(panes.panes.map(p => p.id), ['life', 'city', 'transit', 'relations']);
  const transit = panes.panes.find(p => p.id === 'transit')!;
  const travel = transit.sections.flatMap(s => s.entries).flatMap(e => e.actions).find(a => a.command?.type === 'planJourney');
  assert(travel?.command?.targetId, 'transit pane offers real journey targets');
  const planned = (await host.handle({ id: 12, op: 'command', command: travel!.command })).result as { result: { ok: boolean; message: string }; frame: HostFrame };
  assert.equal(planned.result.ok, true, planned.result.message);
  assert(planned.frame.navigation?.destination, 'the frame carries the planned navigation line');

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
