// Live station boards for the C# StationBoards parity test: a host frame
// after a few real steps, and the web describeStationBoard for every station.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { SimHost, type HostFrame } from '../../src/native-host/sim-host';
import { describeStationBoard, stationWallBoards } from '../../src/rendering/station-wayfinding';
import type { Simulation } from '../../src/simulation';
import type { WorldDefinition } from '../../src/types';

const host = new SimHost();
await host.handle({ id: 1, op: 'open' });
let frame: HostFrame | null = null;
for (let i = 0; i < 6; i++) frame = (await host.handle({ id: 2 + i, op: 'step', seconds: .25, mode: 'walk' })).result as HostFrame;
const { sim, world } = host as unknown as { sim: Simulation; world: WorldDefinition };
const stations = world.nodes.filter(node => node.station).map(node => {
  const { signature: _signature, ...view } = describeStationBoard(world, sim.state, node);
  return { id: node.id, view, boards: stationWallBoards(node).map(({ host: _host, ...board }) => board) };
});
const out = { frame: { closedEdges: frame!.closedEdges, signals: frame!.signals, vehicles: frame!.vehicles }, stations };
writeFileSync(process.argv[2] ?? 'dotnet/Yunshan.Core.Tests/Parity/stations-v6.json.gz', gzipSync(JSON.stringify(out)));
console.log(stations.length, 'stations', frame!.vehicles.length, 'vehicles');
