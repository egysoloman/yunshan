import type { SimState, WorldDefinition } from '../types';

const clampSupply = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/** A read-only lighting selector, without a runtime simulation dependency.
 * Explicit networks use the same current-phase building meter as productive
 * work. Missing/stale dispatch and missing/null feeders cannot borrow the
 * city average. Worlds without any grid declaration retain legacy lighting. */
export function buildingLightSupplyRatio(world: Pick<WorldDefinition, 'powerGrid'>,
  state: Pick<SimState, 'powerGrid' | 'energy' | 'tick' | 'day' | 'hour' | 'extension'>, buildingId: string): number {
  if (world.powerGrid === undefined && state.powerGrid === undefined) return clampSupply(state.energy / 100);
  if (!world.powerGrid || !state.powerGrid) return 0;
  const dispatch = state.powerGrid.dispatch, meter = dispatch?.buildings[buildingId];
  const now = state.extension?.lastUpdate ?? state.day * 1440 + state.hour * 60;
  if (!dispatch || dispatch.tick !== state.tick || !Number.isFinite(now) || !Number.isFinite(dispatch.at) || Math.abs(dispatch.at - now) > 1e-8
    || !meter || typeof meter.nodeId !== 'string' || !Number.isFinite(meter.demandP) || !Number.isFinite(meter.servedP) || meter.demandP <= 1e-8 || meter.servedP < 0) return 0;
  return clampSupply(meter.servedP / meter.demandP);
}
