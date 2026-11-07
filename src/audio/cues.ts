import type { Command } from '../types';

/** Short procedural action cues (no audio assets), shared with the native client
 * (unity Core/ActionCues.cs): what a command's result sounds like. Display only. */
export type Cue = 'ok' | 'coin' | 'board' | 'arrive' | 'fail';
export interface Tone { frequency: number; at: number; duration: number; gain: number; wave: 'sine' | 'triangle' }

export const CUE_TONES: Readonly<Record<Cue, readonly Tone[]>> = {
  ok: [{ frequency: 660, at: 0, duration: .09, gain: .05, wave: 'triangle' }, { frequency: 880, at: .08, duration: .12, gain: .05, wave: 'triangle' }],
  coin: [{ frequency: 1320, at: 0, duration: .08, gain: .04, wave: 'sine' }, { frequency: 1760, at: .06, duration: .16, gain: .04, wave: 'sine' }],
  board: [{ frequency: 523, at: 0, duration: .1, gain: .05, wave: 'triangle' }, { frequency: 659, at: .09, duration: .1, gain: .05, wave: 'triangle' }, { frequency: 784, at: .18, duration: .16, gain: .05, wave: 'triangle' }],
  arrive: [{ frequency: 784, at: 0, duration: .22, gain: .05, wave: 'sine' }, { frequency: 659, at: .2, duration: .32, gain: .05, wave: 'sine' }],
  fail: [{ frequency: 196, at: 0, duration: .18, gain: .06, wave: 'triangle' }],
};

const COIN: readonly Command['type'][] = ['purchase', 'deposit', 'withdraw', 'rent'];
const BOARD: readonly Command['type'][] = ['ride', 'leaveVehicle', 'drive', 'boardAircraft', 'leaveAircraft'];

/** The cue for a command's result; null for clock controls, which are not actions in the city. */
export function cueFor(type: Command['type'], ok: boolean): Cue | null {
  if (['setTime', 'pause', 'speed'].includes(type)) return null;
  if (!ok) return 'fail';
  return COIN.includes(type) ? 'coin' : BOARD.includes(type) ? 'board' : 'ok';
}
