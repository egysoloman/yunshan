from pathlib import Path
import json, hashlib, datetime
base=Path(__file__).resolve().parent
old=Path('/workspace/yunshan-work/ROOT15-public-health-player-20261004-01')
s=(old/'public-health-policy-continuation.mts').read_text()
s=s.replace("import { upgradeReferenceCollision } from './source/src/host/upgrade-reference-collision.ts';\n",'').replace("import { upgradeMealRoute } from './source/src/host/upgrade-meal-route.ts';\n",'')
s=s.replace("import { canAccessFloor }", "import { canAccessFloor, getStairPosition }")
s=s.replace("import { createArchivedProductCity }", "import { giftContactReason } from './source/src/simulation/gift-contact.ts';\nimport { createArchivedProductCity }")
s=s.replace("const out = process.argv[2]; assert(out); mkdirSync(out, { recursive: true });", "const out = process.argv[2]; assert(out);\nassert(process.env.ROOT16_MEDICAL_RUN_COORDINATED === '1', 'Prepared candidate: root must grant the exclusive Simulation window before execution');\nmkdirSync(out, { recursive: true });")
s=s.replace("new URL('origins/", "new URL('inherited-originals/origins/")
s=s.replace("new URL('actual03/artifacts/", "new URL('inherited-originals/actual03/artifacts/")
s=s.replace("new URL('ROUTE-PREP04.json'", "new URL('inherited-originals/ROUTE-PREP04.json'")
s=s.replace("['frontier.save.json','trace-commands.json','trace-events.json','trace-wages.json','trace-frames.json','trace-care.json','trace-transitions.json','filing.save.json','FAIL-summary.json']", "['frontier.save.json','trace-events.json','trace-frames.json','FAIL-summary.json']")
a=s.index('const migrations: any[] = [];');b=s.index('const initial =',a)
s=s[:a]+"const migrations: any[] = []; // No policy cutover: original legacy reference/meal declarations remain literal.\n"+s[b:]
s=s.replace("const maxFrames = 512;", "const maxFrames = 512; // NEW finite supply scope; .25 <= regular delta <= 1, original main clamp and internal accumulator unchanged.\nconst maxMainTicks = 2048;")
s=s.replace("['sale', 'food-consumed', 'production',", "['sale', 'food-consumed', 'stored-meal', 'private-shift-authorized', 'public-shift-authorized', 'production',")
s=s.replace("const checkCash = () =>", """const stock = (kind: 'food' | 'materials') => city.state.shops.filter(s => city.shopCommodity(s) === kind).reduce((n, s) => n + s.inventory, 0);
const food = () => stock('food') + (city.state.player.inventory.food ?? 0) + city.state.citizens.reduce((n, c) => n + (c.food ?? 0), 0);
assert.equal(city.state.vehicles.length, 0, 'Inherited fixture has no carriers; no uncounted cargo food');
assert.equal(Object.values(Reflect.get(city, 'runtime').freight).reduce((n: number, q: any) => n + q, 0), 0);
const initialFood = food(), initialMaterials = stock('materials');
let giftsApplied = 0, maximumFoodResidual = 0, maximumMaterialResidual = 0;
const gifts: any[] = [], life: any[] = [], gates: any[] = [];
const physicalAccounts = () => {
  const producedFood = events.filter(r => r.event.type === 'production' && city.shopCommodity(city.state.shops.find(s => s.id === r.event.shopId)!) === 'food').reduce((n, r) => n + r.event.amount, 0);
  const npcRetailMeals = events.filter(r => r.event.type === 'sale' && r.event.citizenId && r.event.citizenId !== 'player' && city.shopCommodity(city.state.shops.find(s => s.id === r.event.shopId)!) === 'food').length;
  const meals = events.filter(r => ['stored-meal', 'food-consumed'].includes(r.event.type)).reduce((n, r) => n + (r.event.amount ?? 0), 0) + npcRetailMeals;
  const producedMaterials = events.filter(r => r.event.type === 'production' && city.shopCommodity(city.state.shops.find(s => s.id === r.event.shopId)!) === 'materials').reduce((n, r) => n + r.event.amount, 0);
  const procuredMaterials = events.filter(r => ['civic-procurement', 'public-procurement'].includes(r.event.type)).reduce((n, r) => n + (r.event.quantity ?? 0), 0);
  return { initialFood, producedFood, meals, giftsApplied, currentFood: food(), foodResidual: food() - initialFood - producedFood + meals + giftsApplied,
    initialMaterials, producedMaterials, procuredMaterials, currentMaterials: stock('materials'), materialResidual: stock('materials') - initialMaterials - producedMaterials + procuredMaterials };
};
const checkPhysical = () => {
  const a = physicalAccounts(); maximumFoodResidual = Math.max(maximumFoodResidual, Math.abs(a.foodResidual)); maximumMaterialResidual = Math.max(maximumMaterialResidual, Math.abs(a.materialResidual));
  assert(Math.abs(a.foodResidual) < 1e-6, `Finite physical food conservation ${JSON.stringify(a)}`);
  assert(Math.abs(a.materialResidual) < 1e-6, `Actual production/procurement material conservation ${JSON.stringify(a)}`);
};
const checkCash = () =>""")
s=s.replace("record('trace-transitions.json', transitions);", "record('trace-transitions.json', transitions); record('trace-gifts.json', gifts); record('trace-life.json', life); record('trace-gates.json', gates); record('physical-accounts.json', physicalAccounts());")
s=s.replace("commands.push({ command: c, before, result, after }); checkCash(); return", "commands.push({ command: c, before, result, after }); checkCash(); if (c.type !== 'gift') checkPhysical(); return")
s=s.replace("world, () => {}, (b, f)", "world, code => { if (code === 'KeyF') { const before = controller.position; assert(controller.inside?.id === 'civic-0-home'); assert(controller.useStairs(), 'Original physical F shaft and ACL accepted'); city.state.player.position = controller.walkingPosition; life.push({ kind: 'native-F-stair', clock: city.state.extension!.lastUpdate, before, after: controller.position, floor: controller.floor }); } }, (b, f)")
s=s.replace("assert(mainFrames < maxFrames, 'NEW fixed512 original quarter-second main-frame bound');", "assert(mainFrames < maxFrames, 'NEW fixed512 regular main-frame bound');")
s=s.replace("const actualTicks = city.state.tick - oldTick; assert.equal(actualTicks, 1, 'each NEW main .25 frame is exactly one original tick'); const accumulatorAfter", "const actualTicks = city.state.tick - oldTick; assert(actualTicks >= 0 && actualTicks <= 4, 'Original main delta<=1 retains at most four internal .25 ticks'); assert(city.state.tick - continuationTick <= maxMainTicks, 'NEW original internal tick maximum2048'); const accumulatorAfter")
s=s.replace("checkCash(); if (mainFrames % 16 === 0)", "checkCash(); checkPhysical(); life.push({ kind: 'ordinary-frame', frame: mainFrames, tick: city.state.tick, clock: city.state.extension!.lastUpdate, player: structuredClone(city.state.player), actors: ['citizen-11', 'citizen-55', 'citizen-44'].map(id => { const c = city.state.citizens.find(p => p.id === id)!; return { id, position: structuredClone(c.position), state: c.state, needs: structuredClone(c.needs), food: c.food, health: city.state.extension!.actorProfiles[id].health }; }), physical: physicalAccounts() }); if (mainFrames % 16 === 0)")
s=s.replace("scope: 'NEW actual-terminal-policy-public-health-player'", "scope: 'ROOT16 finite18-food13-gift medical continuation'")
pos=s.index('\ntry {\n  const petition',s.index('const frame ='))
s=s[:pos]+"""
// Reuses ROOT15 actual frame/walk functions. Only persisted origin restore and
// ordinary W/mouse/F inputs publish the Controller walking position.
const walk = (points: Vec3[]) => {
  input('keydown', { code: 'KeyW', repeat: false });
  try { for (const target of points.slice(1)) { let guard = 0; while (Math.hypot(controller.position.x - target.x, controller.position.z - target.z) > .015) {
    eatIfNeeded(); const before = controller.position, dx = target.x - before.x, dz = target.z - before.z;
    input('mousemove', { movementX: (controller.yaw - Math.atan2(-dx, -dz)) / .003, movementY: 0, clientX: 0, clientY: 0 });
    frame(Math.min(1, Math.hypot(dx, dz) / 4.8), target);
    assert(Math.hypot(controller.position.x - before.x, controller.position.z - before.z) > 1e-7, `Actual original W blocked ${JSON.stringify({ before, target })}`); assert(++guard < 100, 'Original finite waypoint guard');
  } } } finally { input('keyup', { code: 'KeyW', repeat: false }); }
};
const restAtClinic = () => {
  const r = command({ type: 'rest', targetId: clinic.id }); assert(r.result.ok, r.result.message);
  assert.equal(r.after.player.money, r.before.player.money - 15); assert.equal(r.after.treasury, r.before.treasury + 15);
  assert.equal(r.after.player.needs.fatigue, Math.min(100, r.before.player.needs.fatigue + 23));
};
const gift = (id: string) => {
  const person = city.state.citizens.find(c => c.id === id)!;
  const before = structuredClone(person), cooldown = Reflect.get(city, 'runtime').relationshipClock;
  const role = Reflect.get(city, 'citizenIdentity').call(city, person);
  assert.equal(giftContactReason(world, city.state.player, { position: person.position, role, identities: [role] }, city.state.voxels), null, 'Current integrated2m physical support/ACL/contact guard');
  assert.equal(controller.inside?.id, person.homeId); assert.equal(controller.floor, 1); assert(canAccessFloor(controller.inside!, controller.floor, city.state.player));
  assert(Math.hypot(controller.position.x - person.position.x, controller.position.y - person.position.y, controller.position.z - person.position.z) <= 2, 'Actual instantaneous same-floor supported contact');
  const r = command({ type: 'gift', targetId: id }); assert(r.result.ok, r.result.message); giftsApplied++;
  assert.equal(r.after.player.inventory.food, r.before.player.inventory.food! - 1); assert.equal(person.needs.hunger, Math.min(100, before.needs.hunger + 20));
  assert.deepEqual(person.position, before.position); assert.equal(person.food, before.food); assert.equal(person.money, before.money); assert.equal(r.after.player.money, r.before.player.money);
  gifts.push({ id, tick: city.state.tick, clock: city.state.extension!.lastUpdate, relationshipClock: cooldown, before, after: structuredClone(person), command: r }); checkPhysical();
};
const giftRoute = JSON.parse(readFileSync(new URL('inherited-originals/GIFT-ROUTE-PREPARED.json', base), 'utf8'));
assert.equal(giftRoute.status, 'PASS'); assert.equal(giftRoute.sourceTerminalSHA256, hash(raw));
const nativeF = () => { input('keydown', { code: 'KeyF', repeat: false }); input('keyup', { code: 'KeyF', repeat: false }); };
"""+s[pos:]
s=s.replace("record('scope-start-after-two-HOST.save.json', city.exportSave());\n  let lastRest = -Infinity;", """record('scope-start-literal-terminal.save.json', city.exportSave());
  // No rental, clock command, body destination setter, business ownership, job
  // appointment, inventory/needs/health write or policy migration is permitted.
  restAtClinic();
  walk([controller.position, ...giftRoute.routes[0].targets]);
  const remote = city.state.shops.find(shop => shop.buildingId === 'civic-1-market')!;
  while (!remote.open) { eatIfNeeded(); assert(city.state.hour < 6, 'Normal [6,22) remote opening did not occur; keep real FAIL'); frame(.25); }
  const quantity = 18, beforeShop = structuredClone(remote), quotedCost = quantity * remote.price;
  assert(city.shopCommodity(remote) === 'food' && Math.floor(remote.inventory) >= quantity && city.state.player.money >= quotedCost, 'Actual finite18 food at normal open sale and actual quote; no extra stock/cash');
  assert(city.state.player.money - quotedCost >= 30, 'Preserve actual two further clinic15 rests within finite wallet');
  const bought = command({ type: 'purchase', targetId: remote.id, value: quantity }); assert(bought.result.ok, bought.result.message);
  assert.equal(bought.after.player.money, bought.before.player.money - quotedCost); assert.equal(remote.inventory, beforeShop.inventory - quantity); assert.equal(remote.revenue, beforeShop.revenue + quotedCost);
  assert.equal(bought.after.player.inventory.food, (bought.before.player.inventory.food ?? 0) + quantity - 1); assert.equal(bought.after.player.needs.hunger, Math.min(100, bought.before.player.needs.hunger + 52));
  record('after-finite18-purchase.save.json', city.exportSave());
  walk([controller.position, ...giftRoute.routes[1].targets]); assert.equal(controller.floor, 0); nativeF(); assert.equal(controller.floor, 1);
  assert(city.state.hour >= 22 || city.state.hour < 6, 'New finite13-gift schedule requires actual night home arrival; no invented body target');
  walk([controller.position, city.state.citizens.find(c => c.id === 'citizen-11')!.position]);
  for (let round = 0; round < 5; round++) {
    if (round > 0) for (let tick = 0; tick < 3; tick++) frame(.25); // Original10min cooldown; three4min ticks=12.
    if (round < 4) { gift('citizen-11'); gift('citizen-55'); }
    gift('citizen-44');
  }
  assert.equal(giftsApplied, 13); assert.equal(gifts.filter(g => g.id === 'citizen-11').length, 4); assert.equal(gifts.filter(g => g.id === 'citizen-55').length, 4); assert.equal(gifts.filter(g => g.id === 'citizen-44').length, 5);
  record('after-real13-gifts.save.json', city.exportSave());
  walk([controller.position, getStairPosition(world.buildings.find(b => b.id === 'civic-0-home')!, 1)]); nativeF(); assert.equal(controller.floor, 0);
  walk([controller.position, ...giftRoute.routes[4].targets]);
  assert(Math.hypot(controller.position.x - clinicPoint.x, controller.position.y - clinicPoint.y, controller.position.z - clinicPoint.z) < .02);
  record('actual-return-arrival.save.json', city.exportSave());
  restAtClinic(); let lastRest = city.state.extension!.lastUpdate;""")
s=s.replace("frame(.25);\n  }\n  flush();", """const runtime = Reflect.get(city, 'runtime'), day = Math.floor(city.state.extension!.lastUpdate / 1440);
    const signed = runtime.publicLabor?.shifts.find((s: any) => s.day === day)?.assignments.find((a: any) => a.citizenId === 'citizen-44' && a.workId === clinic.id);
    const currentPrivate = ['shop-civic-0-farm', 'shop-civic-0-workshop'].map(id => { const p = runtime.privateLabor?.shifts[id]; return { id, day: p?.day, current: p?.day === day, reviews: p?.reviews, assignments: p?.assignments }; });
    gates.push({ tick: city.state.tick, clock: city.state.extension!.lastUpdate, day, hour: city.state.hour, order: structuredClone(order), clinicCurrentDayAssignment: structuredClone(signed), publicShifts: structuredClone(runtime.publicLabor?.shifts.map((s: any) => ({ day: s.day, approvedAt: s.approvedAt, approvedBy: s.approvedBy, siteId: s.siteId }))), currentPrivate, instantPair: clinicalPairAtServiceStation(city, clinic, 'citizen-44', 'player') });
    frame(1);
  }
  flush();""")
s=s.replace("checkCash(); future.push", "checkCash(); checkPhysical(); future.push")
s=s.replace("const result = { status: 'PASS', scope: 'NEW 512 original .25-step continuation of genuine old240-bound FAIL terminal, after two explicit exactSHA HOST declarations. ONE actual player public-health consumer, original target6 retained; no autonomous NPC healthcare/full municipal healthcare or terminal sanitation claim.'", """assert.equal(commands.filter(c => c.command.type === 'purchase' && c.result.ok).length, 1); assert.equal(giftsApplied, 13);
  const fundedDoctors = [...careDoctors].map(id => { const used = wages.filter(w => w.canonical && w.event.citizenId === id && w.event.siteId === clinic.id); assert(used.every(w => Math.floor(w.clock / 1440) >= 8), 'No expiredday7 wage source'); return { id, used }; });
  assert(events.some(r => r.event.type === 'private-shift-authorized' && r.event.shopId === 'shop-civic-0-workshop' && r.clock >= initialClock));
  assert(events.some(r => r.event.type === 'production' && r.event.shopId === 'shop-civic-0-workshop' && r.event.amount > 0));
  assert(events.some(r => r.event.type === 'production' && r.event.shopId === 'shop-civic-0-farm' && r.event.amount > 0));
  const result = { status: 'PASS', scope: 'ROOT16 NEW512 ordinary main delta<=1 continuation of genuine old240FAIL terminal/current322. Exact finite18 purchase/13 physical gifts, ordinaryW/F and finite paid rests. ONE actual patient, originaltarget6 retained; no terminal sanitation claim.'""")
s=s.replace("mainDelta: .25, migrations", "mainDelta: 'ordinary original main min(rawDelta,1); walkingfractional<=1, cooldown/openwait .25, clinicwait1', maxMainTicks, giftsApplied, physical: physicalAccounts(), maximumFoodResidual, maximumMaterialResidual, migrations")
s=s.replace("ordinaryAcceptedInputSeconds: now / 1000", "ordinaryAcceptedInputSeconds: frames.reduce((n, f) => n + f.delta, 0)")
s=s.replace("careDoctors: [...careDoctors], completeSHA256", "careDoctors: [...careDoctors], fundedDoctors, completeSHA256")
s=s.replace("scope: 'NEW policy continuation, original old240-bound FAIL unchanged; NEW512 quarter-second main-frame and external wall cap, no weakened target6 / altered business inputs'", "scope: 'ROOT16 NEW512 main delta<=1/cap900; literal old240FAIL retained; finite18food/13gifts real requirements, no weakened business assertions'")
s=s.replace("original failed", "original failed")
(base/'finite-food-medical-candidate.mts').write_text(s)
print(json.dumps({'driver':str(base/'finite-food-medical-candidate.mts'),'lines':len(s.splitlines()),'sha256':hashlib.sha256(s.encode()).hexdigest(),'status':'PREPARED_NOT_RUN'}))
