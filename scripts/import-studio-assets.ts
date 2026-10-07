/**
 * Copies selected visual GLBs from a checkout of the voxel-studio asset
 * repository (stars2022/voxel-studio-yunshan) into public/studio-assets and
 * writes src/rendering/studio-assets.json.
 *
 * The effective asset for each catalogue ID comes from the studio's own
 * projects/atlas-production-index.json, never from file-name ordering.
 * Blobs are read with `git show`, so a blobless partial clone works and only
 * the selected files are downloaded.
 *
 *   npx tsx scripts/import-studio-assets.ts --repo <checkout> --ids LIFE-064,LIFE-032
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Vec3 = [number, number, number];
interface IndexEntry { id: string; file?: string; assetId?: string; revision?: number; triangles?: number; cellSizeM?: number; kind?: string; note?: string }
interface GltfNode { mesh?: number; translation?: Vec3; rotation?: [number, number, number, number]; scale?: Vec3; matrix?: number[]; children?: number[] }

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const repo = option('repo'), ids = option('ids')?.split(',').map(id => id.trim()).filter(Boolean);
if (!repo || !ids?.length) throw new Error('usage: --repo <voxel-studio checkout> --ids LIFE-064,LIFE-032');

const git = (...command: string[]) => execFileSync('git', ['-C', repo, ...command], { maxBuffer: 256 * 1024 * 1024 });
const commit = git('rev-parse', 'HEAD').toString().trim();
const index = JSON.parse(git('show', `${commit}:projects/atlas-production-index.json`).toString()) as { run: string; entries: IndexEntry[] };
const names = new Map<string, string>();
for (const line of git('show', `${commit}:projects/reference-atlas/source.csv`).toString().replace(/^﻿/, '').split(/\r?\n/).slice(1)) {
  const cells = line.split(','); if (cells.length >= 6) names.set(cells[4], cells[5]);
}
const tree = new Set(git('ls-tree', '-r', '--name-only', commit).toString().split('\n'));

/** Axis-aligned bounds of every POSITION accessor after node transforms. */
export function glbBounds(glb: Buffer): { min: Vec3; max: Vec3; triangles: number } {
  if (glb.readUInt32LE(0) !== 0x46546c67 || glb.readUInt32LE(4) !== 2) throw new Error('not a glTF 2.0 binary');
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()) as { scenes?: { nodes: number[] }[]; scene?: number; nodes: GltfNode[]; meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[]; accessors: { min?: number[]; max?: number[]; count: number }[] };
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]; let triangles = 0;
  const visit = (nodeIndex: number, parent: number[]) => {
    const node = json.nodes[nodeIndex], matrix = multiply(parent, localMatrix(node));
    if (node.mesh !== undefined) for (const primitive of json.meshes[node.mesh].primitives) {
      const accessor = json.accessors[primitive.attributes.POSITION];
      if (!accessor.min || !accessor.max) throw new Error('POSITION accessor lacks min/max');
      triangles += (primitive.indices !== undefined ? json.accessors[primitive.indices].count : accessor.count) / 3;
      for (const x of [accessor.min[0], accessor.max[0]]) for (const y of [accessor.min[1], accessor.max[1]]) for (const z of [accessor.min[2], accessor.max[2]]) {
        const p = [0, 1, 2].map(r => matrix[r] * x + matrix[4 + r] * y + matrix[8 + r] * z + matrix[12 + r]);
        for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); }
      }
    }
    for (const child of node.children ?? []) visit(child, matrix);
  };
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? json.nodes.map((_, i) => i);
  for (const root of roots) visit(root, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  return { min, max, triangles };
}
function localMatrix(node: GltfNode): number[] {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = node.scale ?? [1, 1, 1], [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return out;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;
const assets = ids.map(id => {
  const entry = index.entries.find(e => e.id === id);
  if (!entry?.file) throw new Error(`${id}: not in the effective atlas index`);
  if (entry.kind) throw new Error(`${id}: ${entry.kind} entries are not single masters`);
  const run = /^(.*?-\d{14})-/.exec(entry.file)?.[1];
  const source = [`artifacts/atlas/${run}/exports/${id}/visual.glb`, `projects/production/${run}/exports/${id}/visual.glb`].find(path => tree.has(path));
  if (!source) throw new Error(`${id}: no export for run ${run}`);
  const glb = git('show', `${commit}:${source}`), bounds = glbBounds(glb);
  if (entry.triangles !== undefined && Math.abs(bounds.triangles - entry.triangles) > 0) throw new Error(`${id}: ${bounds.triangles} triangles, index says ${entry.triangles}`);
  mkdirSync(join('public', 'studio-assets'), { recursive: true });
  writeFileSync(join('public', 'studio-assets', `${id}.glb`), glb);
  return {
    id, name: names.get(id) ?? id, assetId: entry.assetId, revision: entry.revision,
    url: `studio-assets/${id}.glb`, source, sha256: createHash('sha256').update(glb).digest('hex'), bytes: glb.length,
    triangles: bounds.triangles, cellSizeM: entry.cellSizeM,
    boundsM: { min: bounds.min.map(round), max: bounds.max.map(round) },
    review: 'candidate: studio human art acceptance 0',
  };
});
const manifest = { format: 'yunshan.studio-assets', version: 1, sourceRepository: 'https://github.com/stars2022/voxel-studio-yunshan', sourceCommit: commit, sourceIndexRun: index.run, units: 'metres', upAxis: 'Y', front: '+Z', assets };
writeFileSync(join('src', 'rendering', 'studio-assets.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`imported ${assets.length} assets from ${commit}`);
