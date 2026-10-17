/** Studio characters (user decision 2026-10-08: animate the studio models on
 * the studio skeletons CHAR-073/074). Display only: position, route, needs,
 * collision and every rule stay the simulation's; this file only chooses
 * which studio masters dress a resident and how the shared skeleton is posed.
 * The same choices are ported to C# (Core/StudioCharacterLook.cs, parity-tested).
 *
 * Every part is shown at its original size. The skeleton's rest pose is the
 * body master's own joint ports, so bodies of every age carry their parts. */

export type CharacterRig = 'CHAR-073' | 'CHAR-074';
/** Where a part is worn: `skin` binds the part's own skin joints to the
 * skeleton by name; the rest are rigid on that joint (origin = joint). */
export type CharacterMount = 'skin' | 'neck' | 'wrist-left' | 'wrist-right' | 'ankle-left' | 'ankle-right' | 'grip-right' | 'grip-left' | 'back' | 'satchel' | 'waist' | 'badge' | 'belly';
export interface CharacterPart { asset: string; mount: CharacterMount }
export interface CharacterLook { rig: CharacterRig; body: string; parts: CharacterPart[] }
export interface CharacterContext { age: number; role: string; state: string; hour: number; weather: string; health?: number; pregnant?: boolean; ceremony?: 'wedding' | 'funeral' | null; /** A parent whose own child under two is beside them (within 2m). */ infantNearby?: boolean }

/** The same FNV-1a hash as describeCitizen, so studio looks follow the same seed. */
export function characterSeed(id: string): number { let value = 2166136261; for (const char of id) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return value >>> 0; }

const SHORT_HAIR = ['CHAR-085', 'CHAR-086', 'CHAR-087', 'CHAR-088'] as const;
const LONG_HAIR = ['CHAR-089', 'CHAR-090', 'CHAR-091', 'CHAR-092', 'CHAR-093'] as const;

/** Role → work outfit, head wear and work tool (held while working or responding). */
const ROLE_OUTFIT: Record<string, { top: string[]; hat?: string; tool?: string[]; extra?: string[] }> = {
  警察: { top: ['CHAR-127'], hat: 'CHAR-101', tool: ['CHAR-198', 'CHAR-197', 'CHAR-196'], extra: ['CHAR-150'] },
  医生: { top: ['CHAR-132', 'CHAR-133'], hat: 'CHAR-106', tool: ['CHAR-193', 'CHAR-195', 'CHAR-194'], extra: ['CHAR-111'] },
  老师: { top: ['CHAR-116'], tool: ['CHAR-189', 'CHAR-190'] },
  学生: { top: ['CHAR-113'], tool: ['CHAR-189'], extra: ['CHAR-147'] },
  农民: { top: ['CHAR-131'], hat: 'CHAR-104', tool: ['CHAR-201', 'CHAR-202'] },
  钱庄职员: { top: ['CHAR-135'], tool: ['CHAR-192', 'CHAR-191'], extra: ['CHAR-150'] },
  商人: { top: ['CHAR-135', 'CHAR-136'], hat: 'CHAR-105', tool: ['CHAR-185', 'CHAR-181', 'CHAR-191'] },
  官员: { top: ['CHAR-137'], hat: 'CHAR-100', tool: ['CHAR-192'], extra: ['CHAR-150'] },
  驾驶员: { top: ['CHAR-129', 'CHAR-144'], tool: ['CHAR-197'], extra: ['CHAR-143'] },
  工人: { top: ['CHAR-130'], hat: 'CHAR-103', tool: ['CHAR-199', 'CHAR-200'], extra: ['CHAR-149', 'CHAR-142', 'CHAR-112'] },
  搬运工: { top: ['CHAR-117', 'CHAR-128'], hat: 'CHAR-102', tool: ['CHAR-203'] },
  科研员: { top: ['CHAR-134'], tool: ['CHAR-191'], extra: ['CHAR-109'] },
};
/** Parts that are skinned to the 16-joint garment skeleton and must be worn with `skin`. */
const WORN_TOOLS = new Set(['CHAR-147', 'CHAR-148', 'CHAR-149', 'CHAR-142', 'CHAR-143', 'CHAR-150']);
const WORN_MOUNT: Record<string, CharacterMount> = { 'CHAR-147': 'back', 'CHAR-148': 'satchel', 'CHAR-149': 'waist', 'CHAR-150': 'badge', 'CHAR-142': 'wrist-right', 'CHAR-143': 'skin' };

export function studioCharacterLook(id: string, context: CharacterContext): CharacterLook {
  const seed = characterSeed(id), age = context.age, pick = <T,>(list: readonly T[], shift = 0) => list[(seed >>> shift) % list.length];
  const parts: CharacterPart[] = [], add = (asset: string, mount: CharacterMount) => parts.push({ asset, mount });
  const night = context.hour >= 22 || context.hour < 6, rain = /雨/.test(context.weather), working = context.state === 'working' || context.state === 'responding';
  // Infants: body, head, baby wrap and bare feet on the child skeleton.
  if (age < 2) {
    add('CHAR-067', 'neck'); add('CHAR-125', 'skin'); for (const side of ['left', 'right'] as const) add('CHAR-071', `ankle-${side}`);
    return { rig: 'CHAR-074', body: 'CHAR-061', parts };
  }
  if (age < 12) {
    add('CHAR-068', 'neck'); add('CHAR-094', 'neck'); add('CHAR-123', 'skin');
    if (age >= 6) { add('CHAR-126', 'skin'); if (context.state === 'studying') add('CHAR-189', 'grip-right'); }
    for (const side of ['left', 'right'] as const) add('CHAR-070', `wrist-${side}`);
    return { rig: 'CHAR-074', body: age < 6 ? 'CHAR-062' : 'CHAR-063', parts };
  }
  const elder = age >= 62, body = age < 18 ? 'CHAR-064' : elder ? 'CHAR-065' : seed % 2 ? 'CHAR-060' : 'CHAR-059';
  add(elder ? 'CHAR-069' : 'CHAR-066', 'neck'); add('CHAR-098', 'neck');
  for (const side of ['left', 'right'] as const) add('CHAR-070', `wrist-${side}`);
  const outfit = ROLE_OUTFIT[context.role], robe = seed % 3 === 0, long = seed % 5 === 0;
  // Head: a work hat while working replaces long hair; otherwise the seed's hair.
  const hat = working && outfit?.hat ? outfit.hat : rain ? 'CHAR-099' : undefined;
  add(elder ? 'CHAR-095' : long && !hat ? pick(LONG_HAIR, 3) : pick(SHORT_HAIR, 3), 'neck');
  if (hat) add(hat, 'neck'); else if (long && !elder && seed % 2) add('CHAR-107', 'neck');
  if (!elder && age >= 30 && seed % 7 === 0) add('CHAR-096', 'neck'); else if (elder && seed % 3 === 0) add('CHAR-097', 'neck');
  if (seed % 6 === 0 && context.role !== '科研员') add('CHAR-108', 'neck');
  if (seed % 8 === 1) add('CHAR-110', 'neck');
  if (context.pregnant) add('CHAR-072', 'belly');
  // Clothes: ceremony and sleep first, then the work outfit while working, else everyday clothes.
  if (context.ceremony === 'wedding') { add('CHAR-138', 'skin'); add('CHAR-204', 'grip-right'); }
  else if (context.ceremony === 'funeral') { add('CHAR-139', 'skin'); add('CHAR-205', 'grip-right'); }
  else if (context.state === 'atHome' && night) add('CHAR-124', 'skin');
  else if (working && outfit) {
    add(pick(outfit.top, 5), 'skin');
    for (const extra of outfit.extra ?? []) if (WORN_TOOLS.has(extra) || seed % 2 === 0) {
      add(extra, WORN_MOUNT[extra] ?? 'neck');
      // Gloves are worn on both hands, over the hand models.
      if (extra === 'CHAR-142') add(extra, 'wrist-left');
    }
    if (outfit.tool) add(pick(outfit.tool, 7), 'grip-right');
  } else {
    if (robe) { add('CHAR-114', 'skin'); add('CHAR-115', 'skin'); } else { add('CHAR-113', 'skin'); if (seed % 4 === 2) add('CHAR-117', 'skin'); }
    if (seed % 6 === 3) add('CHAR-120', 'skin');
    if (elder && seed % 2) add('CHAR-116', 'skin');
    if (seed % 9 === 4) add('CHAR-141', 'skin');
    if (seed % 3 === 1) add(seed % 2 ? 'CHAR-148' : 'CHAR-147', seed % 2 ? 'satchel' : 'back');
  }
  if (!robe && context.ceremony == null && !(context.state === 'atHome' && night)) add(seed % 4 === 1 ? 'CHAR-119' : 'CHAR-118', 'skin');
  add(seed % 3 === 2 ? 'CHAR-121' : 'CHAR-122', 'skin');
  if (rain) add('CHAR-140', 'skin');
  if (context.infantNearby) add('CHAR-206', 'back');
  // Injury: low health shows a bandage, a brace and a crutch (display of the real health value).
  if ((context.health ?? 100) < 35) { add('CHAR-145', 'skin'); add('CHAR-146', 'skin'); add('CHAR-179', 'grip-left'); }
  else if (elder && seed % 4 === 0) add('CHAR-178', 'grip-left');
  // What the right hand carries off work.
  if (!working && !context.ceremony) {
    const held = context.state === 'shopping' ? (seed % 2 ? 'CHAR-180' : 'CHAR-181')
      : context.state === 'eating' ? 'CHAR-182' : context.state === 'socializing' ? (seed % 2 ? 'CHAR-184' : 'CHAR-207')
      : context.state === 'atHome' && !night ? pick(['CHAR-186', 'CHAR-187', 'CHAR-188', 'CHAR-208'], 9) : rain ? 'CHAR-177' : undefined;
    if (held) add(held, 'grip-right');
    if (context.state === 'eating') add('CHAR-183', 'grip-left');
  }
  return { rig: 'CHAR-073', body, parts };
}

/** Every studio master a resident can wear (for loading and the catalogue). */
export const STUDIO_CHARACTER_ASSETS = [
  'CHAR-073', 'CHAR-074', 'CHAR-059', 'CHAR-060', 'CHAR-061', 'CHAR-062', 'CHAR-063', 'CHAR-064', 'CHAR-065', 'CHAR-066', 'CHAR-067', 'CHAR-068', 'CHAR-069', 'CHAR-070', 'CHAR-071', 'CHAR-072',
  ...SHORT_HAIR, ...LONG_HAIR, 'CHAR-094', 'CHAR-095', 'CHAR-096', 'CHAR-097', 'CHAR-098', 'CHAR-099', 'CHAR-100', 'CHAR-101', 'CHAR-102', 'CHAR-103', 'CHAR-104', 'CHAR-105', 'CHAR-106', 'CHAR-107', 'CHAR-108', 'CHAR-109', 'CHAR-110', 'CHAR-111', 'CHAR-112',
  ...Array.from({ length: 38 }, (_, i) => `CHAR-${113 + i}`),
  ...Array.from({ length: 32 }, (_, i) => `CHAR-${177 + i}`),
] as const;

/** Joint rotations (radians about each joint's own X, Z) for the simulation's
 * pose. Walking uses the resident's displacement-driven phase (no own clock);
 * the swing amplitude is the box residents' (0.58). The studio models face
 * −Z, so a positive X turn swings a limb forward. */
export interface CharacterPose { phase: number; walking: boolean; seated: boolean; dead: boolean }
export function studioCharacterPose(pose: CharacterPose): Record<string, { x: number; z: number }> {
  const out: Record<string, { x: number; z: number }> = {}, set = (joint: string, x: number, z = 0) => { out[joint] = { x, z }; };
  if (pose.dead) { set('root', -Math.PI / 2); return out; }
  if (pose.seated) {
    for (const side of ['left', 'right']) { set(`hip-${side}`, Math.PI / 2); set(`knee-${side}`, -Math.PI / 2); set(`shoulder-${side}`, .7); set(`elbow-${side}`, .5); }
    return out;
  }
  const swing = pose.walking ? Math.sin(pose.phase) * .58 : 0;
  for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
    const leg = swing * sign;
    set(`hip-${side}`, leg);
    // The knee bends only on the trailing leg's recovery; the arms swing opposite to the legs.
    set(`knee-${side}`, pose.walking ? -Math.max(0, -leg) * 1.1 : 0);
    set(`shoulder-${side}`, -leg * .8, side === 'left' ? -.06 : .06);
    set(`elbow-${side}`, pose.walking ? .25 + Math.max(0, -leg) * .3 : .1);
  }
  set('spine', pose.walking ? Math.abs(swing) * .05 : 0);
  return out;
}

/** Rigid skin of an unskinned body master: each vertex follows one joint,
 * chosen from the body's own joint ports. Ports are body-model positions. */
export function studioBodyJoint(x: number, y: number, ports: Readonly<Record<string, readonly number[]>>): string {
  const port = (name: string) => ports[name] ?? [0, 0, 0];
  const shoulderY = port('shoulder--1')[1], hipY = port('hip--1')[1], shoulderX = Math.abs(port('shoulder--1')[0]);
  const side = x < 0 ? 'left' : 'right', key = x < 0 ? '-1' : '1';
  // Arms hang outside the torso, below the shoulder line.
  if (Math.abs(x) > shoulderX * .78 && y < shoulderY + .02 && y > port(`wrist-${key}`)[1] - .2) {
    if (y > port(`elbow-${key}`)[1]) return `shoulder-${side}`;
    if (y > port(`wrist-${key}`)[1]) return `elbow-${side}`;
    return `wrist-${side}`;
  }
  if (y < hipY - .02) {
    if (y > port(`knee-${key}`)[1]) return `hip-${side}`;
    if (y > port(`ankle-${key}`)[1]) return `knee-${side}`;
    return `ankle-${side}`;
  }
  if (y > shoulderY - .06) return 'chest';
  return y > (hipY + shoulderY) / 2 ? 'spine' : 'pelvis';
}

/** The skeleton's rest pose from a body master's joint ports (body-model
 * metres; the model faces −Z). Joints the body has no port for are placed
 * proportionally, from the rig's own proportions. */
export const CHARACTER_JOINTS = ['root', 'pelvis', 'spine', 'chest', 'neck', 'head', 'shoulder-left', 'elbow-left', 'wrist-left', 'hand-left', 'hip-left', 'knee-left', 'ankle-left', 'toe-left',
  'shoulder-right', 'elbow-right', 'wrist-right', 'hand-right', 'hip-right', 'knee-right', 'ankle-right', 'toe-right'] as const;
export const CHARACTER_PARENT: Record<string, string | null> = { root: null, pelvis: 'root', spine: 'pelvis', chest: 'spine', neck: 'chest', head: 'neck',
  'shoulder-left': 'chest', 'elbow-left': 'shoulder-left', 'wrist-left': 'elbow-left', 'hand-left': 'wrist-left', 'hip-left': 'pelvis', 'knee-left': 'hip-left', 'ankle-left': 'knee-left', 'toe-left': 'ankle-left',
  'shoulder-right': 'chest', 'elbow-right': 'shoulder-right', 'wrist-right': 'elbow-right', 'hand-right': 'wrist-right', 'hip-right': 'pelvis', 'knee-right': 'hip-right', 'ankle-right': 'knee-right', 'toe-right': 'ankle-right' };
export type Ports = Readonly<Record<string, readonly number[]>>;
export function portMap(ports: readonly { id: string; position: readonly number[] }[] | undefined): Ports { const out: Record<string, readonly number[]> = {}; for (const p of ports ?? []) out[p.id] = p.position; return out; }
export function studioCharacterRest(body: Ports): Record<string, [number, number, number]> {
  const at = (id: string): [number, number, number] => { const p = body[id] ?? [0, 0, 0]; return [p[0], p[1], p[2]]; };
  const hipY = at('hip--1')[1], chestY = at('shoulder--1')[1], neck = at('neck'), k = (chestY - hipY) / .51;
  const out: Record<string, [number, number, number]> = { root: [0, 0, 0], pelvis: [0, hipY, 0], spine: [0, hipY + (chestY - hipY) * .45, 0], chest: [0, chestY, 0], neck, head: [neck[0], neck[1] + .12 * k, neck[2]] };
  for (const [side, key] of [['left', '-1'], ['right', '1']] as const) {
    const wrist = at(`wrist-${key}`), ankle = at(`ankle-${key}`);
    out[`shoulder-${side}`] = at(`shoulder-${key}`); out[`elbow-${side}`] = at(`elbow-${key}`); out[`wrist-${side}`] = wrist; out[`hand-${side}`] = [wrist[0], wrist[1] - .1275 * k, wrist[2]];
    out[`hip-${side}`] = at(`hip-${key}`); out[`knee-${side}`] = at(`knee-${key}`); out[`ankle-${side}`] = ankle; out[`toe-${side}`] = [ankle[0], ankle[1] * .26, ankle[2] - .153 * k];
  }
  return out;
}
/** A grip on the studio hand (CHAR-070 'grip', wrist space). */
export const HAND_GRIP: readonly number[] = [0, -.058, -.042];
/** Rigid mount: the joint a part follows, and the part origin's position
 * relative to that joint's rest position (body-model metres). */
export function studioMountOffset(mount: Exclude<CharacterMount, 'skin'>, rest: Record<string, readonly number[]>, body: Ports, part: { ports?: Ports; min: readonly number[]; max: readonly number[] }): { joint: string; offset: [number, number, number] } {
  const rel = (joint: string, x: number, y: number, z: number): { joint: string; offset: [number, number, number] } => ({ joint, offset: [x - rest[joint][0], y - rest[joint][1], z - rest[joint][2]] });
  const chest = rest.chest, pelvis = rest.pelvis;
  switch (mount) {
    case 'neck': return { joint: 'neck', offset: [0, 0, 0] };
    case 'wrist-left': case 'wrist-right': { const w = part.ports?.wrist; return { joint: mount, offset: [0, -(w?.[1] ?? 0), 0] }; }
    case 'ankle-left': case 'ankle-right': return { joint: mount, offset: [0, 0, 0] };
    case 'grip-left': case 'grip-right': {
      // The part's grip (or, without one, its top centre) meets the hand's grip.
      const joint = mount === 'grip-left' ? 'wrist-left' : 'wrist-right', g = part.ports?.grip ?? [(part.min[0] + part.max[0]) / 2, part.max[1], (part.min[2] + part.max[2]) / 2];
      return { joint, offset: [HAND_GRIP[0] - g[0], HAND_GRIP[1] - g[1], HAND_GRIP[2] - g[2]] };
    }
    // Backpack bottom just under the waist, on the back (+Z); satchel strap top at the body's bag-shoulder port.
    case 'back': return rel('chest', 0, pelvis[1] - .1 - part.min[1], -part.min[2] + .12);
    case 'satchel': { const s = body['bag-shoulder'] ?? [0, chest[1], 0]; return rel('chest', 0, s[1] - part.max[1], 0); }
    case 'waist': { const w = part.ports?.waist ?? [0, 0, 0]; return rel('pelvis', 0, pelvis[1] + .02 - w[1], 0); }
    // A badge clipped on the left breast, on the front (−Z) surface.
    case 'badge': { const c = part.ports?.clip ?? [0, 0, 0]; return rel('chest', -.1 - c[0], chest[1] - .16 - c[1], -.15 - c[2]); }
    case 'belly': return rel('pelvis', 0, pelvis[1] + .04, 0);
  }
}
/** Garment skin joints (16-joint garment skeleton) → skeleton joints. The
 * garment's 'head' sits where the skeleton's neck is. */
export function garmentJoint(name: string): string {
  if (name === 'head') return 'neck';
  const m = /^(shoulder|elbow|wrist|hip|knee|ankle)(-?)1$/.exec(name); if (m) return `${m[1]}-${m[2] ? 'left' : 'right'}`;
  return name;
}
