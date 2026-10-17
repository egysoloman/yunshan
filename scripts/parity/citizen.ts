// Citizen appearance cases for the C# parity test (CitizenAppearance.cs).
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describeCitizen } from '../../src/rendering/citizen-appearance';
import { canonical } from './world';
import type { Citizen } from '../../src/types';

const roles = ['商人', '工人', '警察', '老师', '学生', 'soldier', 'official', '官员', '医生', '驾驶员', '卫士', 'merchant'];
const ages = [1, 4, 8, 15, 30, 70];
const cases = Array.from({ length: 240 }, (_, i) => {
  const id = i % 17 === 0 ? `玩家-${i}` : `citizen-${i}`, role = roles[i % roles.length], age = ages[i % ages.length];
  const pose = { yaw: 0, phase: i * .37, walking: i % 2 === 0, seated: i % 5 === 0, dead: i % 7 === 0 }, near = i % 3 !== 0;
  const parts = describeCitizen({ id, role } as Citizen, { age, alive: !pose.dead }, pose, near ? 'near' : 'far').parts;
  return { id, role, age, pose, near, parts: parts.map(p => ({ name: p.name, position: p.position, size: p.size, color: p.color, pivot: p.pivot, rotationX: p.rotationX ?? 0, face: !!p.face, garment: p.garment ?? 0 })) };
});
writeFileSync(process.argv[2], gzipSync(JSON.stringify(canonical(cases)), { level: 9 }));
console.log(cases.length, 'cases');
