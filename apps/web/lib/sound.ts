/**
 * Sound, synthesised.
 *
 * Every effect is built from oscillators and filtered noise at the moment it
 * plays, so there are no audio files to ship, license or wait for. The context
 * is created lazily on the first sound — browsers refuse to start audio before
 * a user gesture, and the first sound always follows one (a click on Roll).
 *
 * Muting is a per-device preference kept in local storage.
 */

const muteKey = 'parkway:muted';

let context: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = readMuted();
const listeners = new Set<(muted: boolean) => void>();

function readMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(muteKey) === '1';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    window.localStorage.setItem(muteKey, next ? '1' : '0');
  } catch {
    // Private mode: the preference just will not persist.
  }
  if (master !== null && context !== null) {
    master.gain.setTargetAtTime(next ? 0 : 0.55, context.currentTime, 0.02);
  }
  listeners.forEach((listener) => listener(next));
}

export function onMuteChange(listener: (muted: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (typeof window === 'undefined' || muted) return null;
  if (context === null) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) return null;
    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.55;
    const compressor = context.createDynamicsCompressor();
    master.connect(compressor);
    compressor.connect(context.destination);
  }
  if (context.state === 'suspended') void context.resume();
  if (master === null) return null;
  return { ctx: context, out: master };
}

function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer === null) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

type ToneOptions = {
  readonly freq: number;
  readonly to?: number;
  readonly type?: OscillatorType;
  readonly start?: number;
  readonly duration: number;
  readonly gain?: number;
  readonly attack?: number;
};

function tone(ctx: AudioContext, out: AudioNode, options: ToneOptions): void {
  const t = ctx.currentTime + (options.start ?? 0);
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = options.type ?? 'sine';
  osc.frequency.setValueAtTime(options.freq, t);
  if (options.to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(options.to, t + options.duration);
  }
  const peak = options.gain ?? 0.3;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(peak, t + (options.attack ?? 0.005));
  env.gain.exponentialRampToValueAtTime(0.0001, t + options.duration);
  osc.connect(env);
  env.connect(out);
  osc.start(t);
  osc.stop(t + options.duration + 0.02);
}

type NoiseOptions = {
  readonly start?: number;
  readonly duration: number;
  readonly gain?: number;
  readonly filter?: BiquadFilterType;
  readonly freq: number;
  readonly to?: number;
  readonly q?: number;
};

function burst(ctx: AudioContext, out: AudioNode, options: NoiseOptions): void {
  const t = ctx.currentTime + (options.start ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = options.filter ?? 'bandpass';
  filter.frequency.setValueAtTime(options.freq, t);
  if (options.to !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(options.to, t + options.duration);
  }
  filter.Q.value = options.q ?? 1;
  const env = ctx.createGain();
  env.gain.setValueAtTime(options.gain ?? 0.4, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + options.duration);
  src.connect(filter);
  filter.connect(env);
  env.connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + options.duration + 0.02);
}

/** All the effects the game makes. Each is safe to call when muted. */
export const sfx = {
  /** Dice rattling in a cupped hand, then two landing on the table. */
  roll(): void {
    const a = audio();
    if (a === null) return;
    for (let i = 0; i < 9; i += 1) {
      burst(a.ctx, a.out, {
        start: i * 0.055 + Math.random() * 0.02,
        duration: 0.04,
        freq: 2200 + Math.random() * 1800,
        q: 4,
        gain: 0.35,
      });
    }
    for (const start of [0.62, 0.74, 0.83]) {
      burst(a.ctx, a.out, { start, duration: 0.07, freq: 900, q: 1.4, gain: 0.55 });
      tone(a.ctx, a.out, { start, freq: 180, to: 90, duration: 0.08, gain: 0.25 });
    }
  },

  /** A token stepping onto the next square. Rises gently along a walk. */
  hop(step: number): void {
    const a = audio();
    if (a === null) return;
    const freq = 520 + Math.min(step, 12) * 22;
    tone(a.ctx, a.out, { freq, to: freq * 1.25, duration: 0.07, type: 'triangle', gain: 0.12 });
  },

  /** Money in: a bright two-note register chime. */
  gain(): void {
    const a = audio();
    if (a === null) return;
    tone(a.ctx, a.out, { freq: 1318.5, duration: 0.14, type: 'triangle', gain: 0.22 });
    tone(a.ctx, a.out, { start: 0.08, freq: 1975.5, duration: 0.32, type: 'triangle', gain: 0.22 });
    burst(a.ctx, a.out, { start: 0.08, duration: 0.18, freq: 6000, q: 0.8, gain: 0.06 });
  },

  /** Money out: a falling, slightly sour pair. */
  pay(): void {
    const a = audio();
    if (a === null) return;
    tone(a.ctx, a.out, { freq: 660, to: 520, duration: 0.16, type: 'triangle', gain: 0.18 });
    tone(a.ctx, a.out, {
      start: 0.12,
      freq: 494,
      to: 370,
      duration: 0.3,
      type: 'triangle',
      gain: 0.18,
    });
  },

  /** A deed stamped as bought. */
  buy(): void {
    const a = audio();
    if (a === null) return;
    burst(a.ctx, a.out, { duration: 0.09, freq: 400, filter: 'lowpass', gain: 0.7 });
    tone(a.ctx, a.out, { freq: 140, to: 60, duration: 0.14, gain: 0.4 });
    tone(a.ctx, a.out, { start: 0.12, freq: 1046.5, duration: 0.18, type: 'triangle', gain: 0.18 });
    tone(a.ctx, a.out, { start: 0.2, freq: 1568, duration: 0.36, type: 'triangle', gain: 0.18 });
  },

  /** A card swept off the deck and flipped. */
  card(): void {
    const a = audio();
    if (a === null) return;
    burst(a.ctx, a.out, { duration: 0.22, freq: 1200, to: 5000, q: 0.7, gain: 0.25 });
    burst(a.ctx, a.out, { start: 0.2, duration: 0.05, freq: 2500, q: 2, gain: 0.2 });
  },

  /** The cell door. */
  jail(): void {
    const a = audio();
    if (a === null) return;
    for (const [freq, gain] of [
      [110, 0.35],
      [263, 0.14],
      [397, 0.1],
      [611, 0.06],
    ] as const) {
      tone(a.ctx, a.out, { freq, duration: 0.9, type: 'square', gain: gain * 0.5 });
    }
    burst(a.ctx, a.out, { duration: 0.12, freq: 300, filter: 'lowpass', gain: 0.6 });
  },

  /** An auctioneer's gavel. */
  gavel(): void {
    const a = audio();
    if (a === null) return;
    for (const start of [0, 0.16]) {
      burst(a.ctx, a.out, { start, duration: 0.06, freq: 700, q: 1.5, gain: 0.7 });
      tone(a.ctx, a.out, { start, freq: 220, to: 120, duration: 0.1, gain: 0.3 });
    }
  },

  /** A building set down. */
  build(): void {
    const a = audio();
    if (a === null) return;
    burst(a.ctx, a.out, { duration: 0.05, freq: 1800, q: 3, gain: 0.35 });
    tone(a.ctx, a.out, { freq: 880, to: 1320, duration: 0.12, type: 'triangle', gain: 0.14 });
  },

  /** Two-note chime: it is your move. */
  yourTurn(): void {
    const a = audio();
    if (a === null) return;
    tone(a.ctx, a.out, { freq: 784, duration: 0.25, gain: 0.18 });
    tone(a.ctx, a.out, { start: 0.12, freq: 1174.7, duration: 0.45, gain: 0.18 });
  },

  /** A soft UI tick. */
  click(): void {
    const a = audio();
    if (a === null) return;
    tone(a.ctx, a.out, { freq: 1500, to: 1100, duration: 0.04, type: 'triangle', gain: 0.08 });
  },

  /** A clock tick for the last seconds of an auction. */
  tick(): void {
    const a = audio();
    if (a === null) return;
    burst(a.ctx, a.out, { duration: 0.03, freq: 3200, q: 6, gain: 0.25 });
  },

  /** A bid going up. */
  bid(): void {
    const a = audio();
    if (a === null) return;
    tone(a.ctx, a.out, { freq: 990, to: 1250, duration: 0.09, type: 'triangle', gain: 0.14 });
  },

  /** Somebody went bust. */
  bust(): void {
    const a = audio();
    if (a === null) return;
    tone(a.ctx, a.out, { freq: 392, to: 98, duration: 1.1, type: 'sawtooth', gain: 0.12 });
    burst(a.ctx, a.out, { duration: 0.6, freq: 500, to: 80, filter: 'lowpass', gain: 0.3 });
  },

  /** The fanfare. */
  win(): void {
    const a = audio();
    if (a === null) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    notes.forEach((freq, index) => {
      const start = index * 0.13 + (index >= 4 ? 0.1 : 0);
      tone(a.ctx, a.out, {
        start,
        freq,
        duration: index === 5 ? 0.9 : 0.22,
        type: 'triangle',
        gain: 0.2,
      });
      tone(a.ctx, a.out, { start, freq: freq / 2, duration: index === 5 ? 0.9 : 0.22, gain: 0.1 });
    });
  },
};

/** A short buzz on phones that support it. Purely a nicety. */
export function haptic(pattern: number | number[] = 12): void {
  if (muted || typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  // Browsers refuse (noisily) to vibrate before the first tap on the page.
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
    .userActivation;
  if (activation !== undefined && !activation.hasBeenActive) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Ignore: some browsers throw without a user gesture.
  }
}
