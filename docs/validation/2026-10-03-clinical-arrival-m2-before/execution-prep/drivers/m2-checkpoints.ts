import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Simulation } from '../../source/src/simulation.ts';

// Passive completed-tick snapshots only. Never register a phase hook, perform
// a command/step, assert product state, or edit the Simulation. The caller uses
// this immediately after the real step returns, before its first assertion.
interface SnapshotContext {
  doctorId: string; patientId: string; orderId: string;
  wages: readonly unknown[]; meters?: number; speed?: number;
}
export function captureM2Checkpoint(sim: Simulation, label: string, context: SnapshotContext): void {
  const configured = process.env.YUNSHAN_M2_CAPTURE_DIR;
  if (!configured) return;
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error('invalid checkpoint label');
  const output = resolve(configured); mkdirSync(output, { recursive: true });
  const worldFile = join(output, 'world.json');
  if (!existsSync(worldFile)) writeFileSync(worldFile, JSON.stringify(sim.worldDefinition), { flag: 'wx' });
  writeFileSync(join(output, `${label}.save.json`), sim.exportSave(), { flag: 'wx' });
  const runtime = Reflect.get(sim, 'runtime') as {
    attendance: Record<string, number>; activities: Record<string, string>;
    peopleElapsed?: Record<string, number>; publicLabor?: unknown;
    wageAccruals?: unknown; wageArrears?: unknown;
  };
  const actors = [context.doctorId, context.patientId].map(id => ({
    citizen: sim.state.citizens.find(person => person.id === id),
    profile: sim.state.extension!.actorProfiles[id],
    activity: runtime.activities[id], attendance: runtime.attendance[id],
    peopleElapsed: runtime.peopleElapsed?.[id] ?? 0,
  }));
  writeFileSync(join(output, `${label}.facts.json`), JSON.stringify({
    schemaVersion: 1, label, timing: label.endsWith('after-step') ? 'outside phase callbacks; actual step completed' : 'outside phase callbacks; before next actual step, including disclosed controlled initial setup',
    tick: sim.state.tick, clock: sim.state.extension!.lastUpdate,
    day: sim.state.day, hour: sim.state.hour, speed: sim.state.speed,
    weather: sim.state.weather, actors, ...context,
    order: sim.state.clinical!.orders.find(order => order.id === context.orderId),
    clinicalStock: sim.state.clinical!.stock,
    playerMoney: sim.state.player.money, publicLabor: runtime.publicLabor ?? null,
    wageAccruals: runtime.wageAccruals ?? [], wageArrears: runtime.wageArrears ?? [],
  }, null, 2) + '\n', { flag: 'wx' });
}
