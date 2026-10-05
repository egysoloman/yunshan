import { Simulation } from '/tmp/yunshan-empty-freight-production14-20261001/src/simulation.ts';
import { locatedFreightWorld } from '/tmp/yunshan-located-freight-prototype-20261002/tests/helpers/located-freight-world.ts';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const sim = new Simulation(locatedFreightWorld());
const runtime = Reflect.get(sim, 'runtime');
for (const v of sim.state.vehicles) { v.nextDeparture = 1e6; if (v.id === 'vehicle-food-road-1') { v.progress = .999; v.direction = 1; v.nextDeparture = 480; } }
runtime.signalOverrides['market-door'] = 1;
sim.command({type:'speed',value:8}); sim.step(.25);
const saved = sim.exportSave();
if (JSON.parse(saved).runtime.freight.customers !== 28) throw new Error('missing native legacy unload');
writeFileSync('/tmp/yunshan-located-freight-prototype-20261002/tests/fixtures/located-freight-legacy.json.gz', gzipSync(saved));
writeFileSync('/tmp/yunshan-located-freight-prototype-20261002/artifacts/legacy-fixture-capture.json',JSON.stringify({source:'/tmp/yunshan-empty-freight-production14-20261001',tick:sim.state.tick,freight:JSON.parse(saved).runtime.freight,bytes:saved.length},null,2));
