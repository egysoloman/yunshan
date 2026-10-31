import assert from 'node:assert/strict';
import test from 'node:test';
import { STUDIO_ASSETS } from '../src/rendering/studio-prop-layout';
import { CHARACTER_JOINTS, garmentJoint, portMap, STUDIO_CHARACTER_ASSETS, studioBodyJoint, studioCharacterLook, studioCharacterPose, studioCharacterRest, studioMountOffset } from '../src/rendering/studio-character-look';

type Asset = (typeof STUDIO_ASSETS)[number] & { ports?: { id: string; position: number[] }[]; joints?: string[] };
const byId = new Map((STUDIO_ASSETS as Asset[]).map(a => [a.id, a]));
const roles = ['学生', '农民', '钱庄职员', '商人', '医生', '官员', '驾驶员', '老师', '警察', '工人', '搬运工', '科研员', '游客'];
const states = ['moving', 'working', 'responding', 'shopping', 'eating', 'socializing', 'atHome', 'studying', 'riding'];

test('studio character looks use only imported masters, every listed master is reachable, and garments map onto the skeleton', () => {
  const used = new Set<string>();
  for (let i = 0; i < 400; i++) for (const age of [1, 4, 8, 15, 30, 70]) for (const role of roles) {
    const state = states[i % states.length], look = studioCharacterLook(`citizen-${i}`, { age, role, state, hour: i % 24, weather: i % 5 ? '晴' : '小雨', health: i % 11 ? 80 : 20, pregnant: i % 13 === 0, ceremony: i % 17 === 0 ? 'wedding' : i % 19 === 0 ? 'funeral' : null, infantNearby: i % 23 === 0 });
    for (const id of [look.rig, look.body, ...look.parts.map(p => p.asset)]) { assert.ok(byId.has(id), `${id} imported`); used.add(id); }
    for (const part of look.parts) if (part.mount === 'skin') for (const joint of byId.get(part.asset)!.joints ?? []) assert.ok((CHARACTER_JOINTS as readonly string[]).includes(garmentJoint(joint)), `${part.asset} joint ${joint}`);
  }
  assert.deepEqual(STUDIO_CHARACTER_ASSETS.filter(id => !used.has(id)), []);
});

test('every body is skinned from its own joint ports and rigid mounts land on real joints', () => {
  for (const id of ['CHAR-059', 'CHAR-060', 'CHAR-061', 'CHAR-062', 'CHAR-063', 'CHAR-064', 'CHAR-065']) {
    const body = portMap(byId.get(id)!.ports), rest = studioCharacterRest(body);
    for (const joint of CHARACTER_JOINTS) assert.ok(rest[joint].every(Number.isFinite), `${id} ${joint}`);
    assert.equal(studioBodyJoint(0, rest.chest[1] + .01, body), 'chest'); assert.equal(studioBodyJoint(rest['knee-left'][0], rest['knee-left'][1] + .05, body), 'hip-left');
    assert.equal(studioBodyJoint(rest['wrist-right'][0], rest['wrist-right'][1] + .05, body), 'elbow-right');
    for (const mount of ['neck', 'grip-right', 'back', 'satchel', 'waist', 'badge', 'belly'] as const) {
      const part = byId.get('CHAR-180')!, { joint, offset } = studioMountOffset(mount, rest, body, { ports: portMap(part.ports), min: part.boundsM.min, max: part.boundsM.max });
      assert.ok((CHARACTER_JOINTS as readonly string[]).includes(joint) && offset.every(Number.isFinite), `${id} ${mount}`);
    }
  }
  const walk = studioCharacterPose({ phase: Math.PI / 2, walking: true, seated: false, dead: false });
  assert.ok(walk['hip-left'].x > 0 && walk['hip-right'].x < 0, 'legs swing opposite');
  assert.equal(studioCharacterPose({ phase: 0, walking: false, seated: false, dead: true }).root.x, -Math.PI / 2);
});
