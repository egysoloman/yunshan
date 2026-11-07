/**
 * Writes docs/art-contract/studio-catalog.json: every effective master of the
 * voxel-studio repository (stars2022/voxel-studio-yunshan), with its size,
 * triangle count, export path, automatic checks against the game art
 * contract, a work family and its game status (placed / rejected /
 * unassigned).
 *
 * It reads only the studio's index, reference sheet and file tree, so a
 * blobless partial clone downloads no model. The GLBs of assets actually
 * placed in the game are fetched and verified by scripts/import-studio-assets.ts.
 *
 *   npx tsx scripts/studio-catalog.ts --repo <checkout>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

type Vec3 = [number, number, number];
interface IndexEntry { id: string; kind?: string; sheet?: string; file?: string; assetId?: string; revision?: number; triangles?: number; cellSizeM?: number; boundsM?: { min: Vec3; max: Vec3 }; note?: string; representation?: string; parentCatalogId?: string }

const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const repo = option('repo'); if (!repo) throw new Error('usage: --repo <voxel-studio checkout>');
const out = option('out') ?? 'docs/art-contract/studio-catalog.json';
const git = (...command: string[]) => execFileSync('git', ['-C', repo, ...command], { maxBuffer: 256 * 1024 * 1024 }).toString();
const commit = git('rev-parse', 'HEAD').trim();
const index = JSON.parse(git('show', `${commit}:projects/atlas-production-index.json`)) as { run: string; entries: IndexEntry[] };
const names = new Map<string, { name: string; theme: string }>();
for (const line of git('show', `${commit}:projects/reference-atlas/source.csv`).replace(/^﻿/, '').split(/\r?\n/).slice(1)) {
  const cells = line.split(','); if (cells.length >= 6) names.set(cells[4], { name: cells[5], theme: cells[1] });
}
const tree = new Set(git('ls-tree', '-r', '--name-only', commit).split('\n'));
const manifest = JSON.parse(readFileSync('src/rendering/studio-assets.json', 'utf8')) as { assets: { id: string }[] };
const contract = JSON.parse(readFileSync('docs/art-contract/game-art-contract.json', 'utf8')) as { conventions: { worldVoxelM: number }; rejectedStudioAssets: { id: string; reason: string }[]; entranceLantern: { rejected: { id: string; reason: string }[] } };

/** Work families, by the studio's own Chinese asset name. First match wins. */
const families: [string, RegExp][] = [
  ['sky', /天空|太阳|月亮|星点/], ['tree', /乔木|树冠|松类|柏类|竹|阔叶|林冠|盆景|根脚/], ['plant', /灌木|草叶|地被|芦苇|荷叶|垂藤|落叶|花/],
  ['water', /瀑|河|水面|潭|支流|跌水|来水|岸/], ['rock', /岩|崖|山|碎石|独石|土层/], ['terrain-edge', /挡土|挡墙|地形|台基|田埂|边沟|地坪|肩坡|基础/],
  ['road', /道路|路面|路缘|中心.*线|横缝|护栏|路口/], ['rail', /轨|高架|墩/], ['bridge', /桥|悬索|吊杆|锚块/], ['cable-lift', /缆车|升降机|井架/],
  ['airport', /跑道|滑行道|泊位|机位|航站|登机/], ['starport', /星港|能量环|能量塔/], ['station', /站台|候车|信号杆/], ['waterfront', /渡口|码头|栈台|系船|渡船|接岸/],
  ['vehicle', /载具|列车|轮|车厢|渡船|客机|飞机|旋翼|操纵台/], ['stair', /楼梯|踏步|台阶|坡道|扶手|梯井/],
  ['facade', /墙|窗|门|檐|柱|阳台|玻璃|屋|瓦|斗拱|压边|护板|牌|灯笼|烟囱|木架|标识|光带|遮阳|连廊|栏|楼板|开洞|基台|石台/],
  ['furniture', /桌|椅|柜|床|架|台|凳|灯|镜|箱|炉|盆|器|具/],
];
const family = (id: string, name: string) => id.startsWith('CHAR-') ? 'character' : families.find(([, pattern]) => pattern.test(name))?.[0] ?? (id.startsWith('LIFE-') ? 'prop' : 'other');
const placed = new Set(manifest.assets.map(a => a.id));
/** Why an unplaced entry is not in the game yet, by work family (the measured
 * fit studies are recorded in 开发备忘录.md STUDIO07–10). Each names the
 * decision or authoring that would place it. */
const gaps: Record<string, string> = {
  character: 'not used: the procedural-box masters CHAR-002…015 are superseded by the fine masters worn on the studio skeleton (CHAR-073/074, user decision 2026-10-08), and the animal skeleton masters CHAR-324…327 are reference rigs (the studio animals ship as rigid single-joint models and are placed as such)',
  furniture: 'no floor-plan fixture solid of this size within the 0.9–1 uniform scale (fixtures are tables 2.4×0.8×1.2, beds 2.4×0.6×1.2, counters 3.2×1.0×1.2)',
  prop: 'no game slot: a new fixture or use point would have to be added to the shared floor plan first',
  facade: 'not placed as facade décor (user decision 2026-10-09: original-size parts on free exterior wall spans only): it would cross a door or window, needs a wall taller than a storey, or replaces a door, window, stair or slab of the program walls',
  stair: 'program stairs are generated from the shared floor plan; fixed stair modules do not match its treads and landings',
  road: 'fixed 2–10m module; road decks follow variable-length, sloped segments and the contract forbids stretching (the 2m surface BUILT-131, centre line BUILT-132 and kerbs BUILT-134 are tiled along every road and drawn near the camera)',
  rail: 'fixed module; elevated decks and piers vary with terrain and the contract forbids stretching (the 8m rail bed BUILT-140 and the side strips BUILT-142 are tiled along every rail path; pier caps BUILT-138 sit on every elevated support)',
  bridge: 'fixed module; bridge towers, cables and abutments vary with deck height and terrain (the 8m deck BUILT-146 is tiled along every bridge path)',
  'cable-lift': 'fixed module; lift shafts and cable spans vary with the network',
  airport: 'no matching game part at the same fixed size (the runway slab BUILT-158 and side lights BUILT-160 are placed)',
  starport: 'size differs: the game starport ring has a 78m radius, BUILT-094 is 88m across',
  station: 'station signal and junction poles carry their own lamps where the game has live or no signals (contract rejection)',
  waterfront: 'dock parts have no fixed-size game counterpart',
  vehicle: 'complete vehicle masters are author-sized and cannot be fitted by uniform scale to the game vehicle boxes',
  tree: 'only the five species models and one shrub are used; others have no woodland species slot (ENV-064 ferns are placed as understorey)',
  plant: 'ground cover is generated per terrain tile at the 0.2m grid; no model slot (understorey ENV-061/062/069 and bank plants ENV-065/066 are placed by groundDressing)',
  rock: 'the terrain is one continuous generated shell; rock masters have no anchor in it (boulder ENV-015, scree ENV-011 and rubble ENV-016 are placed at the mountain feet by groundDressing)',
  water: 'river, waterfall and pool surfaces are generated from the world; no model slot',
  'terrain-edge': 'terrain edges are generated with the shell; no model slot',
  sky: 'the renderer draws a procedural sky',
  other: 'no game slot identified',
};
const rejected = new Map([...contract.rejectedStudioAssets, ...contract.entranceLantern.rejected].map(r => [r.id, r.reason]));
const voxel = contract.conventions.worldVoxelM, round = (v: number) => Math.round(v * 1e4) / 1e4;
const onGrid = (v: number) => Math.abs(v / voxel - Math.round(v / voxel)) < 1e-6;

const entries = index.entries.map(entry => {
  const run = /^(.*?-\d{14})-/.exec(entry.file ?? '')?.[1];
  const source = run ? [`artifacts/atlas/${run}/exports/${entry.id}/visual.glb`, `projects/production/${run}/exports/${entry.id}/visual.glb`].find(path => tree.has(path)) : undefined;
  const bounds = entry.boundsM ?? { min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 }, size = [0, 1, 2].map(k => round(bounds.max[k] - bounds.min[k])) as Vec3;
  const checks = {
    exported: !!source,
    groundedAtY0: Math.abs(bounds.min[1]) < 1e-6,
    sizeOnWorldVoxels: size.every(onGrid),
    triangles: entry.triangles ?? null,
  };
  const label = names.get(entry.id);
  return {
    id: entry.id, kind: entry.kind ?? 'master', ...(entry.parentCatalogId ? { parent: entry.parentCatalogId } : {}), name: label?.name ?? entry.id, category: entry.id.split('-')[0], family: family(entry.id, label?.name ?? ''), sheet: entry.sheet ?? null, theme: label?.theme ?? null,
    revision: entry.revision ?? null, representation: entry.representation ?? null, sizeM: size, boundsM: { min: bounds.min.map(round), max: bounds.max.map(round) },
    source: source ?? null, checks,
    status: placed.has(entry.id) ? 'placed' : rejected.has(entry.id) ? 'rejected' : 'unassigned', ...(rejected.has(entry.id) ? { reason: rejected.get(entry.id) } : !placed.has(entry.id) ? { gap: entry.kind === 'variant' || entry.kind === 'assembly' ? 'whole studio composition with its own collision; game buildings and networks keep their authoritative geometry (user decision 2026-10-09: not placed)' : gaps[family(entry.id, label?.name ?? '')] ?? gaps.other } : {}),
    studioNote: entry.note ?? null,
  };
});
const count = <T extends string>(key: (e: typeof entries[number]) => T) => entries.reduce<Record<string, number>>((m, e) => (m[key(e)] = (m[key(e)] ?? 0) + 1, m), {});
const catalog = {
  format: 'yunshan.studio-catalog', version: 1, sourceRepository: 'https://github.com/stars2022/voxel-studio-yunshan', sourceCommit: commit, sourceIndexRun: index.run,
  scope: 'Every effective index entry: masters, assemblies (whole studio compositions) and variants (parametric forms; some ship only in zip packages and have no single GLB). Sizes and triangles are the studio index values; placed GLBs are re-measured by import-studio-assets.ts.',
  counts: { masters: entries.filter(e => e.kind === 'master').length, assemblies: entries.filter(e => e.kind === 'assembly').length, variants: entries.filter(e => e.kind === 'variant').length, exportedGlb: entries.filter(e => e.checks.exported).length,
    byCategory: count(e => e.category), byStatus: count(e => e.status), byFamily: count(e => e.family),
    notExported: entries.filter(e => !e.checks.exported).length, notGrounded: entries.filter(e => !e.checks.groundedAtY0).length, offVoxelGrid: entries.filter(e => !e.checks.sizeOnWorldVoxels).length },
  entries,
};
writeFileSync(out, JSON.stringify(catalog, null, 1) + '\n');
console.log(JSON.stringify(catalog.counts));
