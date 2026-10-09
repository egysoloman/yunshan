// Studio character looks, skeleton rest poses, body skin joints, mounts and poses (C# StudioCharacterLook parity test).
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { STUDIO_ASSETS } from '../../src/rendering/studio-prop-layout';
import { garmentJoint, portMap, studioBodyJoint, studioCharacterLook, studioCharacterPose, studioCharacterRest, studioMountOffset, type CharacterMount } from '../../src/rendering/studio-character-look';
import { canonical } from './world';

type Asset = (typeof STUDIO_ASSETS)[number] & { ports?: { id: string; position: number[] }[]; joints?: string[] };
const byId = new Map((STUDIO_ASSETS as Asset[]).map(a => [a.id, a]));
const roles = ['学生', '农民', '钱庄职员', '商人', '医生', '官员', '驾驶员', '老师', '警察', '工人', '搬运工', '科研员', '游客'];
const states = ['moving', 'working', 'responding', 'shopping', 'eating', 'socializing', 'atHome', 'studying', 'riding'];
const looks = [];
for (let i = 0; i < 300; i++) {
  const context = { age: [1, 4, 8, 15, 30, 45, 70][i % 7], role: roles[i % roles.length], state: states[(i >> 1) % states.length], hour: (i * 7) % 24, weather: i % 5 ? '晴' : '小雨',
    health: i % 11 ? 80 : 20, pregnant: i % 13 === 0, ceremony: (i % 17 === 0 ? 'wedding' : i % 19 === 0 ? 'funeral' : null) as 'wedding' | 'funeral' | null, infantNearby: i % 23 === 0 };
  looks.push({ id: `citizen-${i * 37}`, context, look: studioCharacterLook(`citizen-${i * 37}`, context) });
}
const bodies = ['CHAR-059', 'CHAR-060', 'CHAR-061', 'CHAR-062', 'CHAR-063', 'CHAR-064', 'CHAR-065'].map(id => {
  const ports = portMap(byId.get(id)!.ports), rest = studioCharacterRest(ports), b = byId.get(id)!.boundsM, joints: string[] = [];
  for (let iy = 0; iy <= 30; iy++) for (let ix = 0; ix <= 12; ix++) joints.push(studioBodyJoint(b.min[0] + (b.max[0] - b.min[0]) * ix / 12, b.min[1] + (b.max[1] - b.min[1]) * iy / 30, ports));
  const mounts = [];
  for (const mount of ['neck', 'wrist-left', 'wrist-right', 'ankle-left', 'grip-right', 'grip-left', 'back', 'satchel', 'waist', 'badge', 'belly'] as Exclude<CharacterMount, 'skin'>[])
    for (const part of ['CHAR-180', 'CHAR-178', 'CHAR-142', 'CHAR-147', 'CHAR-148', 'CHAR-149', 'CHAR-150', 'CHAR-189']) { const a = byId.get(part)!; mounts.push({ mount, part, ...studioMountOffset(mount, rest, ports, { ports: portMap(a.ports), min: a.boundsM.min, max: a.boundsM.max }) }); }
  return { id, rest, joints, mounts };
});
const poses = [0, .7, 1.6, 2.9, 4.4, 6].flatMap(phase => [{ phase, walking: true, seated: false, dead: false }, { phase, walking: false, seated: true, dead: false }, { phase, walking: false, seated: false, dead: true }, { phase, walking: false, seated: false, dead: false }].map(p => ({ ...p, joints: studioCharacterPose(p) })));
const garments = ['root', 'pelvis', 'chest', 'head', 'shoulder-1', 'elbow1', 'wrist-1', 'hip1', 'knee-1', 'ankle1', 'lid', 'wrist'].map(name => ({ name, joint: garmentJoint(name) }));
const json = JSON.stringify(canonical({ looks, bodies, poses, garments }));
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/characters-v6.json.gz', gzipSync(json, { level: 9 }));
console.log(`${looks.length} looks, ${json.length} bytes`);
