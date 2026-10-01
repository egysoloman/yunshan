import { writeFileSync } from 'node:fs';
import { Simulation } from './src/simulation';
import type { Building, BuildingKind, WorldDefinition } from './src/types';
function fixture(): WorldDefinition {
  const kinds: BuildingKind[] = ['home', 'market', 'workshop', 'school', 'farm', 'clinic', 'bank', 'hall', 'station'];
  const buildings: Building[] = kinds.map((kind, index) => ({ id: `clinical-${kind}`, name: `诊疗测试${kind}`, kind, districtId: 'clinical-district', position: { x: index * 30, y: 0, z: 0 }, door: { x: index * 30, y: 0, z: 5 }, width: 12, depth: 12, height: 12, floors: 2, rotation: 0, capacity: 100, seed: index }));
  const nodes = buildings.map(site => ({ id: `${site.id}-door`, name: site.name, districtId: site.districtId, position: { ...site.door }, station: true }));
  return { seed: 20261001, voxelSize: .2, size: 1000, buildings, nodes, edges: nodes.slice(1).map((node, index) => ({ id: `clinical-road-${index}`, mode: 'road', from: nodes[index].id, to: node.id, length: 30, capacity: 20, points: [nodes[index].position, node.position] })), mountains: [], river: [], waterfall: { top: { x: 300, y: 60, z: 100 }, bottom: { x: 300, y: 0, z: 100 }, width: 10 }, districts: [{ id: 'clinical-district', name: '诊疗测试街坊', kind: 'school', center: { x: 120, y: 0, z: 0 }, radius: 500, color: '#aac', population: 384 }], spawn: { ...buildings[0].door } };
}

const simulation = new Simulation(fixture());
const site = simulation.worldDefinition.buildings.find(site => site.kind === 'clinic')!;
simulation.setFocus({...site.door}, 'walk');
simulation.state.extension!.actorProfiles.player.health = 50;
const moneyBefore = simulation.state.player.money;
const result = simulation.command({type:'heal'});
if (!result.ok) throw new Error(result.message);
const save = JSON.parse(simulation.exportSave());
if (simulation.state.player.money !== moneyBefore - 30 || simulation.state.extension!.actorProfiles.player.health <= 50) throw new Error('old actual paid care was not exercised');
writeFileSync('/workspace/yunshan/tests/fixtures/clinical-legacy-heal-ee3e7a1.json', JSON.stringify(save));
writeFileSync('/tmp/yunshan-clinical-legacy-evidence/generation.json', JSON.stringify({sourceCommit:'ee3e7a1',result,moneyBefore,moneyAfter:simulation.state.player.money,healthAfter:simulation.state.extension!.actorProfiles.player.health,deadline:Reflect.get(simulation.state.extension!,'runtime').cooldowns['heal:player'],hasClinical:!!save.state.clinical,hasManifest:!!save.runtime.persistedModules},null,2));
