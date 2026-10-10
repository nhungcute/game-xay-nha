import { GRID, Surface, cellIndex, type CommandType } from '@xay-nha/contracts';
import type { SimState } from '@xay-nha/sim';

/**
 * Sound effects (docs/13 §4.8 "Hiệu ứng"), synthesized with WebAudio: no audio files, nothing to license or download.
 * Ambience (wind, running water near the camera, occasional birds) is synthesized too; music needs real recordings. The AudioContext is created lazily on the
 * first sound, which always follows a user gesture (a command), so browsers allow it. Mute is remembered per browser.
 */
export type Sound = 'chop' | 'dig' | 'build' | 'complete' | 'coin' | 'harvest' | 'levelUp' | 'error';

const BY_COMMAND: Partial<Record<CommandType, Sound>> = {
  CLEAR_ENV: 'chop', TERRAFORM: 'dig', TILL: 'dig', UNTILL: 'dig', EMBANK: 'dig', BUILD_ROAD: 'dig', REMOVE_ROAD: 'dig',
  PLACE_BUILDING: 'build', BUILD_BRIDGE: 'build', SPEED_UP: 'build', REMOVE_EMBANK: 'dig', UNLOCK_ZONE: 'build', DEMOLISH: 'chop', REMOVE_BRIDGE: 'chop',
  COLLECT: 'coin', SELL: 'coin', CLAIM_QUEST: 'coin', BUY_MATERIAL: 'coin', COLLECT_PRODUCTION: 'harvest', HARVEST: 'harvest', PLANT: 'dig',
};
const active = (s: SimState) => new Set([...s.snapshot.buildings, ...s.snapshot.bridges].filter(b => b.status === 'ACTIVE').map(b => b.id));

/** Sounds for one command result (pure; unit-tested). */
export function commandSounds(type: CommandType, accepted: boolean, before: SimState, after: SimState): Sound[] {
  if (!accepted) return ['error'];
  const sounds: Sound[] = [];
  const sound = BY_COMMAND[type]; if (sound) sounds.push(sound);
  sounds.push(...tickSounds(before, after));
  return sounds;
}
/** Sounds caused by time passing or instant completion: construction finished, level gained. */
export function tickSounds(before: SimState, after: SimState): Sound[] {
  const sounds: Sound[] = [], was = active(before);
  if ([...active(after)].some(id => !was.has(id) && [...before.snapshot.buildings, ...before.snapshot.bridges].some(b => b.id === id))) sounds.push('complete');
  if (after.snapshot.progress.level > before.snapshot.progress.level) sounds.push('levelUp');
  return sounds;
}

/** 0..1: how close the nearest water cell is to (x, z) within `radius` cells (1 = on the shore). */
export function waterNearby(surface: Uint8Array, x: number, z: number, radius = 12): number {
  let best = Infinity;
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
    const cx = x + dx, cz = z + dz;
    if (cx < 0 || cz < 0 || cx >= GRID || cz >= GRID || surface[cellIndex(cx, cz)] !== Surface.WATER) continue;
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best === Infinity ? 0 : Math.max(0, 1 - best / radius);
}

const KEY = 'xay-nha.sound';
type Voice = { wave: OscillatorType | 'noise'; from: number; to?: number; at: number; length: number; gain: number; filter?: number };
const NOTES: Record<Sound, Voice[]> = {
  chop: [{ wave: 'noise', from: 1400, at: 0, length: .07, gain: .5, filter: 1400 }, { wave: 'noise', from: 900, at: .09, length: .08, gain: .4, filter: 900 }],
  dig: [{ wave: 'noise', from: 320, at: 0, length: .14, gain: .55, filter: 320 }],
  build: [{ wave: 'sine', from: 150, to: 90, at: 0, length: .12, gain: .6 }, { wave: 'sine', from: 140, to: 85, at: .13, length: .12, gain: .5 }],
  complete: [523, 659, 784].map((f, i) => ({ wave: 'triangle' as const, from: f, at: i * .09, length: .16, gain: .35 })),
  coin: [{ wave: 'square', from: 988, at: 0, length: .06, gain: .18 }, { wave: 'square', from: 1319, at: .06, length: .12, gain: .18 }],
  harvest: [{ wave: 'sine', from: 440, to: 880, at: 0, length: .16, gain: .4 }],
  levelUp: [523, 659, 784, 1047, 1319].map((f, i) => ({ wave: 'triangle' as const, from: f, at: i * .08, length: .22, gain: .32 })),
  error: [{ wave: 'square', from: 170, to: 110, at: 0, length: .16, gain: .16 }],
};

export class SoundEffects {
  private context?: AudioContext;
  private noise?: AudioBuffer;
  private ambience?: { master: GainNode; wind: GainNode; water: GainNode };
  muted: boolean;
  constructor() {
    let stored: string | null = null;
    try { stored = localStorage.getItem(KEY); } catch { /* storage blocked */ }
    this.muted = stored === 'off';
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ambience && this.context) this.ambience.master.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, .3);
    try { localStorage.setItem(KEY, muted ? 'off' : 'on'); } catch { /* storage blocked */ }
  }
  /** Creates the AudioContext inside a user gesture (browsers block audio until then). */
  unlock(): void {
    if (this.muted || typeof AudioContext === 'undefined') return;
    try { this.context ??= new AudioContext(); if (this.context.state === 'suspended') void this.context.resume(); } catch { /* no audio */ }
  }
  /** Called about once a second: `water` 0..1 from waterNearby, `zoom` 0..1 (1 = close to the ground). */
  ambient(water: number, zoom: number): void {
    const ctx = this.context;
    if (!ctx || this.muted) return;
    try {
      if (!this.ambience) {
        const master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
        const loop = (type: BiquadFilterType, frequency: number, q: number) => {
          const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer(ctx); src.loop = true;
          const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = frequency; filter.Q.value = q;
          const gain = ctx.createGain(); gain.gain.value = 0;
          src.connect(filter); filter.connect(gain); gain.connect(master); src.start();
          return gain;
        };
        this.ambience = { master, wind: loop('lowpass', 420, .4), water: loop('bandpass', 1300, .6) };
      }
      const now = ctx.currentTime, gust = .75 + .25 * Math.sin(now / 7);
      this.ambience.wind.gain.setTargetAtTime(.035 * gust * (.6 + .4 * (1 - zoom)), now, 1.5);
      this.ambience.water.gain.setTargetAtTime(.09 * water * zoom, now, 1);
      if (zoom > .3 && Math.random() < .12 * zoom) this.chirp(ctx, this.ambience.master, now);
    } catch { /* audio unavailable */ }
  }
  private chirp(ctx: AudioContext, out: AudioNode, now: number): void {
    const base = 2400 + Math.random() * 1400, notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) this.voice(ctx, out, { wave: 'sine', from: base, to: base * 1.35, at: i * .11, length: .07, gain: .045 }, now + .05);
  }
  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = this.noise.getChannelData(0); let seed = 1;
      for (let i = 0; i < data.length; i++) { seed = (seed * 16807) % 2147483647; data[i] = seed / 1073741823.5 - 1; }
    }
    return this.noise;
  }
  play(sounds: readonly Sound[]): void {
    if (this.muted || !sounds.length || typeof AudioContext === 'undefined') return;
    try {
      this.context ??= new AudioContext();
      const ctx = this.context;
      if (ctx.state === 'suspended') void ctx.resume();
      const master = ctx.createGain(); master.gain.value = .35; master.connect(ctx.destination);
      // Several sounds from one action are staggered slightly instead of stacked.
      sounds.forEach((sound, index) => { for (const voice of NOTES[sound]) this.voice(ctx, master, voice, ctx.currentTime + index * .12); });
    } catch { /* audio unavailable: the game works silently */ }
  }
  private voice(ctx: AudioContext, out: AudioNode, v: Voice, start: number): void {
    const t = start + v.at, env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(v.gain, t + .01); env.gain.exponentialRampToValueAtTime(0.0001, t + v.length);
    let source: AudioScheduledSourceNode;
    if (v.wave === 'noise') {
      const node = ctx.createBufferSource(); node.buffer = this.noiseBuffer(ctx); source = node;
      const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = v.filter ?? v.from; filter.Q.value = 1.2;
      node.connect(filter); filter.connect(env);
    } else {
      const osc = ctx.createOscillator(); osc.type = v.wave; osc.frequency.setValueAtTime(v.from, t);
      if (v.to) osc.frequency.exponentialRampToValueAtTime(v.to, t + v.length);
      osc.connect(env); source = osc;
    }
    env.connect(out); source.start(t); source.stop(t + v.length + .02);
  }
  dispose(): void { void this.context?.close(); this.context = undefined; this.ambience = undefined; }
}
