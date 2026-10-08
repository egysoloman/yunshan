import type { NetworkEdge, Vec3, WorldDefinition } from '../types';
import { samplePolyline, terrainHeight } from '../world';
import { deckWidth, GUARDRAIL_THICKNESS, guardrailOffset, guardrailSpans, hasGuardrailAt } from '../transport-geometry';

/** Material keys the network uses (renderer palette). */
export type NetworkMaterial = 'stone' | 'wood' | 'cyan' | 'amber' | 'roof';
/** Receives the network's display boxes. The web renderer's BoxBatch is one
 * sink; the Unity client builds the same boxes from the C# port
 * (Core/NetworkStructures.cs, parity-tested). Display only: decks, rails,
 * guardrail collision and walking come from the world and transport geometry. */
export interface NetworkSink {
  box(key: NetworkMaterial, x: number, y: number, z: number, sx: number, sy: number, sz: number, color?: string, rotation?: number, tag?: { roof?: boolean }): void;
  segment(key: NetworkMaterial, a: Vec3, b: Vec3, width: number, height: number, lift?: number, color?: string): void;
}
export interface NetworkStructureOptions { dressesStations: boolean; dressesRunway: boolean; dressesRailDeck?: boolean; dressesBridgeDeck?: boolean; dressesRoadDeck?: boolean }

/** Roads, rails, bridges, lifts, cables, supports, guardrails, station
 * platforms and junction poles, as the renderer has always drawn them. */
export function emitNetworkStructures(world: WorldDefinition, sink: NetworkSink, options: NetworkStructureOptions): void {
    for (const edge of world.edges) {
      if (edge.mode === 'flight') continue;
      let supportRemainder = 0;
      for (let i = 1; i < edge.points.length; i++) {
        const a = edge.points[i - 1], b = edge.points[i];
        if (edge.mode === 'ferry') continue;
        if (edge.mode === 'cable') { sink.segment('wood', a, b, .45, .45, 9); sink.segment('cyan', a, b, .15, .15, 8.5); continue; }
        if (edge.mode === 'lift') {
          // An open four-post lift cage preserves the real central travel axis
          // while allowing the adjacent waterfall to remain visible through it.
          for (const x of [-2.5, 2.5]) for (const z of [-2.5, 2.5]) sink.segment('stone', { ...a, x: a.x + x, z: a.z + z }, { ...b, x: b.x + x, z: b.z + z }, .6, .6, 0, '#a4b0a2');
          for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y += 12) { for (const x of [-2.5, 2.5]) sink.box('wood', a.x + x, y, a.z, .6, .6, 5.6, '#698780'); for (const z of [-2.5, 2.5]) sink.box('wood', a.x, y, a.z + z, 5.6, .6, .6, '#698780'); }
          sink.segment('cyan', { ...a, x: a.x + 3.2 }, { ...b, x: b.x + 3.2 }, .3, .3); continue;
        }
        const rail = edge.mode === 'maglev' || edge.mode === 'lightRail';
        const width = deckWidth(edge);
        // The studio runway slab (BUILT-158) replaces the strip's own deck box at the same extent.
        const dressedDeck = edge.id === 'road-airport-runway-strip' && options.dressesRunway || rail && !!options.dressesRailDeck || edge.mode === 'bridge' && !!options.dressesBridgeDeck;
        // Near the camera the studio road modules (BUILT-131/132/134) are drawn at the exact extents
        // of the deck, centre line and kerbs; those boxes shrink slightly so the two never z-fight, and the far deck takes
        // the module's own slate concrete (#555f61, its top-face texel) so there is no colour seam.
        const roadTiled = edge.mode === 'road' && !edge.id.includes('runway') && !!options.dressesRoadDeck;
        if (!dressedDeck) sink.segment('stone', a, b, roadTiled ? width - .04 : width, rail ? 1.4 : .5, rail ? -.9 : roadTiled ? -.28 : -.25, rail ? '#84948e' : edge.mode === 'bridge' ? '#b8b3a0' : roadTiled ? '#555f61' : '#969987');
        if (rail) { sink.segment('cyan', { ...a, x: a.x - 1.8 }, { ...b, x: b.x - 1.8 }, .28, .24, .16); sink.segment('cyan', { ...a, x: a.x + 1.8 }, { ...b, x: b.x + 1.8 }, .28, .24, .16); }
        else if (edge.mode !== 'bridge') sink.segment('stone', a, b, roadTiled ? .12 : .16, roadTiled ? .06 : .08, roadTiled ? .06 : .07, '#d1c6a1');
        // Curbs, paving seams and separate shoulders make the travelled deck
        // legible at body height without widening the shared collision surface.
        const dx = b.x - a.x, dz = b.z - a.z, horizontal = Math.hypot(dx, dz) || 1, nx = -dz / horizontal, nz = dx / horizontal;
        for (const side of [-1, 1]) {
          const offset = guardrailOffset(edge), aa = { x: a.x + nx * offset * side, y: a.y, z: a.z + nz * offset * side }, bb = { x: b.x + nx * offset * side, y: b.y, z: b.z + nz * offset * side };
          sink.segment('stone', aa, bb, rail ? .35 : roadTiled ? .36 : .4, rail ? .5 : roadTiled ? .18 : .2, rail ? -.1 : roadTiled ? .11 : .12, '#c0c2ac');
          const elevated = (a.y + b.y) / 2 - terrainHeight(world, (a.x + b.x) / 2, (a.z + b.z) / 2) > 4;
          if (edge.mode === 'bridge' || rail || elevated && edge.mode === 'road') for (const span of guardrailSpans(world, edge, i)) sink.segment('wood', { x: span.a.x + nx * offset * side, y: span.a.y, z: span.a.z + nz * offset * side }, { x: span.b.x + nx * offset * side, y: span.b.y, z: span.b.z + nz * offset * side }, GUARDRAIL_THICKNESS, .2, 1.1, '#6b7771');
        }
        if (edge.mode === 'road' && !edge.id.includes('runway')) { const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + .04, z: (a.z + b.z) / 2 }; sink.segment('stone', { ...middle, x: middle.x - nx * 3.5, z: middle.z - nz * 3.5 }, { ...middle, x: middle.x + nx * 3.5, z: middle.z + nz * 3.5 }, .08, .04, 0, '#757e73'); }
        const length = Math.hypot(b.x - a.x, b.z - a.z), interval = rail ? 80 : 70;
        // Spacing spans all samples of the same edge, including the world's 4m rails.
        for (let along = interval - supportRemainder; along <= length; along += interval) { const t = along / Math.max(.01, length), x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t, ground = terrainHeight(world, x, z); if (y - ground > 5 && edge.mode !== 'bridge') { const tall = y - ground; sink.box('stone', x, ground + 1, z, rail ? 7 : 8, 2, rail ? 7 : 8, '#939e91'); sink.box('stone', x, ground + tall / 2, z, rail ? 3 : 4, tall, rail ? 3 : 4, '#a0aaa0'); sink.box('stone', x, y - 1.3, z, width + 1, 1.8, 4, '#929d92'); if (tall > 25) for (let tie = ground + 12; tie < y - 5; tie += 16) sink.box('wood', x, tie, z, rail ? 4 : 5, .6, rail ? 4 : 5); } }
        supportRemainder = (supportRemainder + length) % interval;
      }
      if (edge.mode === 'bridge') emitBridge(world, edge, sink);
    }
    for (const node of world.nodes) {
      const p = node.position;
      // The studio pool draws platform and shelter at the same platform extent.
      if (node.station) { if (!options.dressesStations) { sink.box('stone', p.x, p.y - .6, p.z, 22, 1, 18); sink.box('cyan', p.x, p.y + .1, p.z + 8, 20, .2, .35); for (const x of [-8, 8]) { sink.box('wood', p.x + x, p.y + 3, p.z, .8, 6, .8); sink.box('amber', p.x + x, p.y + 5.7, p.z, 1.5, .35, 1.5); } sink.box('roof', p.x, p.y + 6.4, p.z, 23, .65, 11, undefined, 0, { roof: true }); } sink.box('wood', p.x + 12, p.y + 1.8, p.z + 11, .35, 3.6, .35); sink.box('wood', p.x + 12, p.y + 3.5, p.z + 11, 1, 1.6, .65); }
      else if (node.id.includes('junction') || node.id.includes('road')) { sink.box('wood', p.x + 4, p.y + 2.2, p.z + 4, .4, 4.4, .4); }
    }
}

/** The renderer's simple hip roof (no profile geometry), used for suspension tower caps. */
function simpleRoof(box: (key: NetworkMaterial, x: number, y: number, z: number, sx: number, sy: number, sz: number) => void, w: number, d: number, y: number, magnitude: number) {
  const overhang = Math.max(2, Math.min(12, w * .14)), rise = Math.max(2.8, Math.min(14, w * .18)) * magnitude;
  box('wood', 0, y + .12, 0, w + overhang * 1.3, .2, d + overhang * 1.3);
  const levels = 3;
  for (let step = 0; step < levels; step++) { const fraction = step / levels; box('roof', 0, y + .4 + fraction * rise, 0, (w + overhang * 2) * (1 - fraction * .78), rise / levels + .2, (d + overhang * 2) * (1 - fraction * .76)); }
  box('roof', 0, y + rise + .8, 0, Math.max(1.2, w * .48), .4, Math.max(.6, d * .035));
  box('amber', 0, y + .2, d / 2 + overhang * .8, w + overhang, .12, .16);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (let i = 2; i < 3; i++) box('roof', sx * (w / 2 + overhang * (.45 + i * .2)), y + .7 + i * .43, sz * (d / 2 + overhang * (.45 + i * .2)), overhang * .55, .58, overhang * .55);
}

function emitBridge(world: WorldDefinition, edge: NetworkEdge, sink: NetworkSink) {
    if (edge.points.length < 2) return;
    const length = edge.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - edge.points[i].x, p.z - edge.points[i].z), 0);
    const arcLength = edge.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - edge.points[i].x, p.y - edge.points[i].y, p.z - edge.points[i].z), 0);
    const samples = Math.max(8, Math.ceil(length / 8));
    const point = (t: number, side: number, lift: number) => { const p = samplePolyline(edge.points, t), a = samplePolyline(edge.points, Math.max(0, t - .01)), b = samplePolyline(edge.points, Math.min(1, t + .01)), dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return { x: p.x - dz / l * side * 4.1, y: p.y + lift, z: p.z + dx / l * side * 4.1 }; };
    const suspension = length > 140;
    for (const side of [-1, 1]) {
      for (let i = 0; i <= samples; i++) {
        const t = i / samples, deck = point(t, side, 0);
        const guarded = hasGuardrailAt(world, edge, t * arcLength);
        if (guarded) sink.box('wood', deck.x, deck.y + .55, deck.z, .4, 1.1, .4, '#6c7871');
        if (suspension) {
          const lift = t < .16 ? 3 + t / .16 * 27 : t > .84 ? 3 + (1 - t) / .16 * 27 : 30 - 21 * Math.sin((t - .16) / .68 * Math.PI);
          const cable = point(t, side, lift);
          if (i) { const previousT = (i - 1) / samples, previousLift = previousT < .16 ? 3 + previousT / .16 * 27 : previousT > .84 ? 3 + (1 - previousT) / .16 * 27 : 30 - 21 * Math.sin((previousT - .16) / .68 * Math.PI); sink.segment('wood', point(previousT, side, previousLift), cable, .5, .5, 0, '#627d7c'); }
          if (guarded) sink.segment('stone', { ...deck, y: deck.y + 1.1 }, cable, .2, .2, 0, '#9eb1a7');
        }
      }
      for (const t of suspension ? [.16, .84] : [0, 1]) {
        if (suspension && !hasGuardrailAt(world, edge, t * arcLength)) continue;
        const offset = suspension ? 6 : 6.5, deck = point(t, side * offset / 4.1, 0), ground = Math.min(terrainHeight(world, deck.x, deck.z), deck.y - 2.6), height = deck.y - ground + (suspension ? 32 : 2.4);
        sink.box('stone', deck.x, ground + .8, deck.z, 9, 1.6, 9, '#a4aa9b');
        sink.box('stone', deck.x, ground + height / 2, deck.z, 2, height, 2, '#8c9b95');
        if (suspension) { const across = point(t, -side * offset / 4.1, 28); sink.segment('stone', { ...deck, y: deck.y + 28 }, across, 1.6, 1.6, 0, '#8b9b95'); simpleRoof((key, x, y, z, sx, sy, sz) => sink.box(key, deck.x + x, deck.y + y, deck.z + z, sx, sy, sz), 5, 5, 32, .35); }
      }
    }
    for (const t of [0, 1]) { const p = samplePolyline(edge.points, t), ground = terrainHeight(world, p.x, p.z); sink.box('stone', p.x, (p.y + ground) / 2, p.z, 12, Math.max(1, p.y - ground), 10, '#a2a88f'); }
}
