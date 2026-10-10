/** Road-network metrics for docs/设计/路网重做方案.md §2 targets.
 *   npx tsx scripts/roads/road-metrics.ts [v6|streets] [out-dir]
 * Prints a JSON summary; with out-dir also writes an SVG plan and zoom crops. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createStreetWorld, createWorld } from '../../src/world';
import type { NetworkEdge, Vec3, WorldDefinition } from '../../src/types';

const which = process.argv[2] ?? 'v6', out = process.argv[3];
const t0 = performance.now();
const world: WorldDefinition = which === 'streets' ? createStreetWorld() : createWorld(20261001, 'current-v6');
const generationMs = Math.round(performance.now() - t0);
const h = (a: Vec3, b: Vec3) => Math.hypot(b.x - a.x, b.z - a.z);
const roads = world.edges.filter(e => e.mode === 'road' && !e.id.includes('runway'));
const isDoor = (e: NetworkEdge) => e.from.endsWith('-door') || e.to.endsWith('-door');

let length = 0, straight = 0, axis = 0, right = 0, sharp = 0, maxGrade = 0, points = 0;
for (const e of roads) {
  points += e.points.length;
  const runs: { dx: number; dz: number; len: number }[] = [];
  for (let i = 1; i < e.points.length; i++) {
    const a = e.points[i - 1], b = e.points[i], len = h(a, b); if (len < 1e-6) continue;
    length += len; if (Math.abs(b.x - a.x) < 1e-6 || Math.abs(b.z - a.z) < 1e-6) axis += len;
    maxGrade = Math.max(maxGrade, Math.abs(b.y - a.y) / len);
    const last = runs.at(-1), dx = b.x - a.x, dz = b.z - a.z;
    if (last && Math.abs(last.dx * dz - last.dz * dx) < 1e-6 * last.len * len + 1e-9 && last.dx * dx + last.dz * dz > 0) { last.dx += dx; last.dz += dz; last.len += len; } else runs.push({ dx, dz, len });
  }
  straight += h(e.points[0], e.points.at(-1)!);
  for (let i = 1; i < runs.length; i++) {
    const a = runs[i - 1], b = runs[i], deg = Math.acos(Math.max(-1, Math.min(1, (a.dx * b.dx + a.dz * b.dz) / (a.len * b.len)))) * 180 / Math.PI;
    if (Math.abs(deg - 90) <= 5) right++;
    if (deg > 60 && Math.min(a.len, b.len) < 20) sharp++;
  }
}
// Shared 4 m cells: fraction of road cells covered by two or more edges.
const owners = new Map<string, Set<string>>();
for (const e of roads) for (let i = 1; i < e.points.length; i++) {
  const a = e.points[i - 1], b = e.points[i], n = Math.max(1, Math.ceil(h(a, b)));
  for (let s = 0; s <= n; s++) { const k = `${Math.floor((a.x + (b.x - a.x) * s / n) / 4)},${Math.floor((a.z + (b.z - a.z) * s / n) / 4)}`; (owners.get(k) ?? owners.set(k, new Set()).get(k)!).add(e.id); }
}
const shared = [...owners.values()].filter(s => s.size > 1).length;
const result = {
  recipe: which, generationMs, buildings: world.buildings.length, roadEdges: roads.length, doorEdges: roads.filter(isDoor).length,
  nodes: world.nodes.length, junctions: world.nodes.filter(n => n.id.startsWith('junction-')).length,
  totalKm: +(length / 1000).toFixed(1), doorKm: +(roads.filter(isDoor).reduce((s, e) => s + e.length, 0) / 1000).toFixed(1),
  pathRatio: +(length / straight).toFixed(3), rightAnglesPerKm: +(right / (length / 1000)).toFixed(2),
  sharpTurnsPerKm: +(sharp / (length / 1000)).toFixed(2), axisShare: +(axis / length).toFixed(3),
  sharedCellShare: +(shared / owners.size).toFixed(3), maxGrade: +maxGrade.toFixed(3), roadPoints: points,
};
console.log(JSON.stringify(result, null, 1));

if (out) {
  mkdirSync(out, { recursive: true });
  const S = world.size / 2, scale = 2400 / world.size, X = (x: number) => ((x + S) * scale).toFixed(1), Z = (z: number) => ((z + S) * scale).toFixed(1);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="2400" viewBox="0 0 2400 2400"><rect width="2400" height="2400" fill="#e9ecdf"/>`;
  svg += `<polyline fill="none" stroke="#4d8fc7" stroke-width="${(30 * scale).toFixed(1)}" points="${world.river.map(p => `${X(p.x)},${Z(p.z)}`).join(' ')}"/>`;
  for (const e of world.edges) if (e.mode === 'road' || e.mode === 'bridge') svg += `<polyline fill="none" stroke="${e.mode === 'bridge' ? '#2c7a7b' : isDoor(e) ? '#555' : '#c0392b'}" stroke-width="${isDoor(e) ? 1.4 : 2.6}" stroke-linejoin="round" points="${e.points.map(p => `${X(p.x)},${Z(p.z)}`).join(' ')}"/>`;
  for (const b of world.buildings) svg += `<rect x="${X(b.position.x - b.width / 2)}" y="${Z(b.position.z - b.depth / 2)}" width="${(b.width * scale).toFixed(1)}" height="${(b.depth * scale).toFixed(1)}" fill="#f5e6c8" stroke="#6b5a3a" stroke-width=".6"/>`;
  for (const n of world.nodes) if (n.station) svg += `<circle cx="${X(n.position.x)}" cy="${Z(n.position.z)}" r="4" fill="#fff" stroke="#000"/>`;
  svg += '</svg>';
  writeFileSync(`${out}/${which}-roads.svg`, svg);
  const crop = (cx: number, cz: number, half: number) => svg.replace('viewBox="0 0 2400 2400"', `viewBox="${X(cx - half)} ${Z(cz - half)} ${(2 * half * scale).toFixed(1)} ${(2 * half * scale).toFixed(1)}"`);
  writeFileSync(`${out}/${which}-market-zoom.svg`, crop(-330, 460, 450));
  writeFileSync(`${out}/${which}-west-zoom.svg`, crop(-1080, -550, 450));
}
