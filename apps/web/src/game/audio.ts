import type { CommandType } from '@xay-nha/contracts';
import type { SimState } from '@xay-nha/sim';

/**
 * Sound effects (docs/13 §4.8 "Hiệu ứng"), synthesized with WebAudio: no audio files, nothing to license or download.
 * Music and ambience need real recordings and are not part of this module. The AudioContext is created lazily on the
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
  muted: boolean;
  constructor() {
    let stored: string | null = null;
    try { stored = localStorage.getItem(KEY); } catch { /* storage blocked */ }
    this.muted = stored === 'off';
  }
  setMuted(muted: boolean): void {
    this.muted = muted;
    try { localStorage.setItem(KEY, muted ? 'off' : 'on'); } catch { /* storage blocked */ }
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
      if (!this.noise) {
        this.noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
        const data = this.noise.getChannelData(0); let seed = 1;
        for (let i = 0; i < data.length; i++) { seed = (seed * 16807) % 2147483647; data[i] = seed / 1073741823.5 - 1; }
      }
      const node = ctx.createBufferSource(); node.buffer = this.noise; source = node;
      const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = v.filter ?? v.from; filter.Q.value = 1.2;
      node.connect(filter); filter.connect(env);
    } else {
      const osc = ctx.createOscillator(); osc.type = v.wave; osc.frequency.setValueAtTime(v.from, t);
      if (v.to) osc.frequency.exponentialRampToValueAtTime(v.to, t + v.length);
      osc.connect(env); source = osc;
    }
    env.connect(out); source.start(t); source.stop(t + v.length + .02);
  }
  dispose(): void { void this.context?.close(); this.context = undefined; }
}
