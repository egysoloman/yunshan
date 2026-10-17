import type { Vec3 } from '../types';

/** Procedural ambience (no audio assets). Every level is read from the city's
 * own state: the crowd murmur follows the real residents near the player, the
 * water follows the real river and waterfall, birds and insects the clock. */
export interface AmbienceInput { hour: number; position: Vec3; ground: number; waterDistance: number; nearbyPeople: number; walkingSpeed: number; inside: boolean; weather: string; paused: boolean }
export interface AmbienceLevels { wind: number; water: number; crowd: number; birds: number; insects: number; steps: number }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** 0 at night, 1 by day, eased over dawn (5–7) and dusk (18–20). */
export function daylight(hour: number): number { const h = ((hour % 24) + 24) % 24; return h < 5 || h >= 20 ? 0 : h < 7 ? (h - 5) / 2 : h < 18 ? 1 : (20 - h) / 2; }

export function ambienceLevels(i: AmbienceInput): AmbienceLevels {
  const day = daylight(i.hour), indoor = i.inside ? 1 : 0, rain = i.weather === '雨';
  const crowd = clamp01(i.nearbyPeople / 12) * (indoor ? .5 : 1) * .7;
  return {
    wind: clamp01(.12 + Math.max(0, i.position.y - i.ground) / 150 * .5 + (rain ? .2 : 0)) * (indoor ? .25 : 1),
    water: clamp01(1 - i.waterDistance / 120) * (indoor ? .2 : 1) * .8,
    crowd,
    birds: indoor ? 0 : day * (1 - crowd) * .35 * (rain ? .2 : 1),
    insects: indoor ? 0 : (1 - day) * .3 * (rain ? .3 : 1),
    steps: i.paused || i.walkingSpeed < .5 ? 0 : clamp01(i.walkingSpeed / 6) * .5,
  };
}

type Channel = { gain: GainNode };
/** Web Audio graph for the levels above; starts only after a user gesture. */
export class Ambience {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private channels = new Map<keyof AmbienceLevels, Channel>();
  private levels: AmbienceLevels = { wind: 0, water: 0, crowd: 0, birds: 0, insects: 0, steps: 0 };
  private nextChirp = 0; private nextStep = 0;
  constructor(private volume = .6) {}
  get started(): boolean { return this.context !== null; }
  /** Last applied levels and the audio clock state (diagnostics). */
  get snapshot(): { levels: AmbienceLevels; state: string | null } { return { levels: { ...this.levels }, state: this.context?.state ?? null }; }
  setVolume(volume: number): void { this.volume = clamp01(volume); if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, .2); }
  start(): void {
    if (this.context) { void this.context.resume?.(); return; }
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      const context = new Ctor(), master = context.createGain(); master.gain.value = this.volume; master.connect(context.destination);
      const noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate), data = noise.getChannelData(0);
      for (let n = 0; n < data.length; n++) data[n] = Math.random() * 2 - 1;
      const bed = (type: BiquadFilterType, frequency: number, q: number) => {
        const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
        source.buffer = noise; source.loop = true; filter.type = type; filter.frequency.value = frequency; filter.Q.value = q; gain.gain.value = 0;
        source.connect(filter).connect(gain).connect(master); source.start(); return { gain };
      };
      this.channels.set('wind', bed('lowpass', 420, .4));
      this.channels.set('water', bed('bandpass', 1100, .6));
      this.channels.set('crowd', bed('bandpass', 520, 1.2));
      this.channels.set('insects', bed('bandpass', 5200, 8));
      for (const key of ['birds', 'steps'] as const) { const gain = context.createGain(); gain.gain.value = 1; gain.connect(master); this.channels.set(key, { gain }); }
      this.context = context; this.master = master;
    } catch { this.context = null; }
  }
  update(levels: AmbienceLevels): void {
    this.levels = levels; const context = this.context; if (!context) return;
    const t = context.currentTime, scale = { wind: .18, water: .22, crowd: .2, insects: .05 } as const;
    for (const key of ['wind', 'water', 'crowd', 'insects'] as const) this.channels.get(key)?.gain.gain.setTargetAtTime(levels[key] * scale[key] * (key === 'crowd' ? .8 + Math.random() * .4 : 1), t, .6);
    if (levels.birds > .05 && t >= this.nextChirp) { this.chirp(levels.birds); this.nextChirp = t + 1.5 + Math.random() * 5 / levels.birds; }
    if (levels.steps > 0 && t >= this.nextStep) { this.step(levels.steps); this.nextStep = t + .45; }
  }
  private chirp(level: number): void {
    const context = this.context!, out = this.channels.get('birds')!.gain, t = context.currentTime, f = 2400 + Math.random() * 1800;
    for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) {
      const osc = context.createOscillator(), gain = context.createGain(), at = t + k * .11;
      osc.type = 'sine'; osc.frequency.setValueAtTime(f, at); osc.frequency.exponentialRampToValueAtTime(f * 1.4, at + .07);
      gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.05 * level, at + .01); gain.gain.exponentialRampToValueAtTime(.0001, at + .09);
      osc.connect(gain).connect(out); osc.start(at); osc.stop(at + .1);
    }
  }
  private step(level: number): void {
    const context = this.context!, out = this.channels.get('steps')!.gain, t = context.currentTime;
    const length = Math.floor(context.sampleRate * .06), buffer = context.createBuffer(1, length, context.sampleRate), data = buffer.getChannelData(0);
    for (let n = 0; n < length; n++) data[n] = (Math.random() * 2 - 1) * Math.pow(1 - n / length, 3);
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    source.buffer = buffer; filter.type = 'lowpass'; filter.frequency.value = 900; gain.gain.value = .25 * level;
    source.connect(filter).connect(gain).connect(out); source.start(t);
  }
  dispose(): void { void this.context?.close(); this.context = null; this.channels.clear(); }
}
