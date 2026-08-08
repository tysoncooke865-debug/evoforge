import type { ForgeChipValue } from '@/domain/forge-duel';
import { audioContext, soundEnabled } from '@/ui/core/sound';

import type { ChipImpact } from './chip-world';

/**
 * THE CHIP SOUND ENGINE — clay-and-plastic casino chips, synthesised.
 *
 * WHY SYNTHESIS AND NOT SAMPLES. Three reasons, and the first is the one that
 * decided it: EvoForge's audio deliberately uses oscillator and buffer nodes
 * and ships ZERO audio files, because an <audio> element claims the platform
 * MEDIA SESSION — on iOS that pauses the athlete's music for a 40ms clack
 * (ui/core/sound.ts's own hard-won note). Second, a chip impact is almost the
 * ideal synthesis target: a filtered noise transient plus two decaying
 * partials IS the sound, and it gives continuous control over energy, weight
 * and pitch that a fixed set of samples cannot. Third, there is nothing to
 * license, nothing to normalise, nothing added to the bundle, and no first-
 * impact download to lag — the "preload" this feature needs is a single
 * cached noise buffer, built on the first tap.
 *
 * THE VOICES, by energy rather than by name:
 *   tick    — a small chip nudging another. Short, quiet, high.
 *   clack   — the ordinary chip-on-chip impact. The signature sound.
 *   heavy   — a hard landing or a big denomination. Lower, with a body thump.
 *   rim     — a wall hit. Same family, drier and duller: a rim is not a chip.
 *   rattle  — replaces a BURST. When five impacts land inside 90ms, five
 *             clacks is noise; one rattle is a pile settling.
 *
 * NOTHING PLAYS PER COLLISION. A settling stack reports dozens of contacts a
 * frame. Between the world's energy floor and this file's three gates
 * (per-chip cooldown, global spacing, voice cap) an entire pile collapse costs
 * a handful of voices.
 */

// ── the gates ─────────────────────────────────────────────────────────────
const MIN_INTENSITY = 0.05;
/** The same chip cannot speak again this soon, however many contacts it has. */
const CHIP_COOLDOWN_MS = 70;
/** Nothing at all may start within this of the last voice. */
const GLOBAL_SPACING_MS = 16;
/** Hard ceiling on simultaneous voices. Beyond this the mix is mud anyway. */
const MAX_VOICES = 7;
/** N impacts inside this window collapse into one rattle. */
const BURST_WINDOW_MS = 95;
const BURST_COUNT = 4;
const RATTLE_COOLDOWN_MS = 320;

/** Weight per denomination: pitch multiplier and how much low body it carries.
 *  A 250 is not a different object, it is the same object with more mass. */
const WEIGHT: Readonly<Record<ForgeChipValue, { pitch: number; body: number }>> = {
  5: { pitch: 1.16, body: 0.55 },
  10: { pitch: 1.11, body: 0.62 },
  25: { pitch: 1.05, body: 0.72 },
  50: { pitch: 1.0, body: 0.8 },
  100: { pitch: 0.95, body: 0.9 },
  250: { pitch: 0.9, body: 1.0 },
  500: { pitch: 0.85, body: 1.12 },
};

let noise: AudioBuffer | null = null;
let bus: GainNode | null = null;
let live = 0;
let lastVoiceAt = 0;
let lastRattleAt = 0;
const recent: number[] = [];
const chipLastAt = new Map<string, number>();

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/**
 * Build the shared graph. Called on the first chip interaction, which is by
 * definition a user gesture — so the context unlocks there and no athlete
 * ever sees an "enable audio" dialog.
 */
function graph(): { ctx: AudioContext; bus: GainNode; noise: AudioBuffer } | null {
  const ctx = audioContext();
  if (!ctx) return null;
  if (!bus || bus.context !== ctx) {
    bus = ctx.createGain();
    // Headroom. Seven voices at full tilt must not clip the master.
    bus.gain.value = 0.62;
    bus.connect(ctx.destination);
    noise = null;
  }
  if (!noise) {
    // 400ms of white noise, reused by every voice — the whole "asset preload"
    // this engine needs. Building it per impact would allocate 17k floats a
    // collision.
    const len = Math.floor(ctx.sampleRate * 0.4);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return { ctx, bus, noise };
}

/** Warm the graph up front so the FIRST clack is not the one that stutters. */
export function primeChipAudio(): void {
  graph();
}

/** Stereo placement from table x (0..1). Subtle on purpose — a chip landing
 *  on the left should lean left, not appear in another room. */
function panner(ctx: AudioContext, x: number): AudioNode | null {
  if (typeof ctx.createStereoPanner !== 'function') return null;
  const p = ctx.createStereoPanner();
  p.pan.value = (x - 0.5) * 1.1;
  return p;
}

function connect(ctx: AudioContext, node: AudioNode, x: number, out: GainNode) {
  const pan = panner(ctx, x);
  if (pan) {
    node.connect(pan);
    pan.connect(out);
  } else {
    node.connect(out);
  }
}

/**
 * ONE IMPACT. `intensity` 0..1 selects the voice and scales everything.
 *
 * The clack itself is three layers: a bandpass noise crack (the strike), a
 * pair of detuned partials (the ceramic ring), and — only when it is hard
 * enough to deserve one — a short sine thump (the table).
 */
function strike(intensity: number, value: ForgeChipValue, x: number, wall: boolean) {
  const g = graph();
  if (!g) return;
  const { ctx, bus: out, noise: buf } = g;
  const w = WEIGHT[value] ?? WEIGHT[50];
  // ±4% so a run of impacts never machine-guns on one exact pitch.
  const detune = rand(0.96, 1.04) * w.pitch;
  const t0 = ctx.currentTime;
  const vol = 0.1 + intensity * 0.55;
  live += 1;

  try {
    // 1. THE STRIKE — a very short band of noise. Higher and tighter for a
    //    light tick, lower and broader as the hit gets harder.
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = detune;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    // A rim is duller than a chip: less high content, so it reads as the
    // table rather than another chip.
    const centre = (wall ? 1250 : 2350) * detune - intensity * 420;
    bp.frequency.setValueAtTime(Math.max(320, centre), t0);
    bp.Q.value = wall ? 1.5 : 3.2;
    const ng = ctx.createGain();
    const crack = 0.012 + intensity * 0.03;
    ng.gain.setValueAtTime(vol * (wall ? 0.7 : 1), t0);
    ng.gain.exponentialRampToValueAtTime(0.0008, t0 + crack);
    src.connect(bp);
    bp.connect(ng);
    connect(ctx, ng, x, out);
    src.start(t0);
    src.stop(t0 + crack + 0.02);

    // 2. THE RING — two partials, the clay body. Skipped on a wall hit, which
    //    is what makes the rim sound like a rim.
    if (!wall) {
      for (const [mult, amp] of [[1, 0.5], [1.48, 0.26]] as const) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        const f = (940 + intensity * 260) * detune * mult;
        o.frequency.setValueAtTime(f, t0);
        o.frequency.exponentialRampToValueAtTime(f * 0.86, t0 + 0.05);
        const og = ctx.createGain();
        const decay = 0.035 + intensity * 0.055;
        og.gain.setValueAtTime(vol * amp * 0.5, t0);
        og.gain.exponentialRampToValueAtTime(0.0008, t0 + decay);
        o.connect(og);
        connect(ctx, og, x, out);
        o.start(t0);
        o.stop(t0 + decay + 0.02);
      }
    }

    // 3. THE THUMP — only for real impacts, and scaled by the chip's weight.
    //    This is what separates "a 500 hit the pile" from "a 5 touched it".
    if (intensity > 0.42) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f = 128 * w.body;
      o.frequency.setValueAtTime(f, t0);
      o.frequency.exponentialRampToValueAtTime(f * 0.6, t0 + 0.09);
      const og = ctx.createGain();
      og.gain.setValueAtTime(vol * 0.42 * w.body, t0);
      og.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.1);
      o.connect(og);
      connect(ctx, og, x, out);
      o.start(t0);
      o.stop(t0 + 0.12);
    }
  } catch {
    /* an unsupported browser simply stays quiet */
  }

  // Voices are short; free the slot on a timer rather than tracking node ends.
  setTimeout(() => {
    live = Math.max(0, live - 1);
  }, 160);
}

/**
 * A PILE SETTLING, as one sound. Six quiet ticks over ~280ms at random
 * offsets — the shape of a stack finding its level, at the cost of one voice
 * instead of the twenty the collisions would have asked for.
 */
function rattle(intensity: number, x: number) {
  const g = graph();
  if (!g) return;
  const { ctx, bus: out, noise: buf } = g;
  const t0 = ctx.currentTime;
  live += 1;
  try {
    for (let i = 0; i < 6; i++) {
      const at = t0 + rand(0, 0.26);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rand(0.95, 1.2);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(rand(1700, 2900), at);
      bp.Q.value = 3.4;
      const ng = ctx.createGain();
      const dur = rand(0.012, 0.026);
      ng.gain.setValueAtTime((0.06 + intensity * 0.16) * rand(0.6, 1), at);
      ng.gain.exponentialRampToValueAtTime(0.0007, at + dur);
      src.connect(bp);
      bp.connect(ng);
      connect(ctx, ng, x + rand(-0.12, 0.12), out);
      src.start(at);
      src.stop(at + dur + 0.02);
    }
  } catch {
    /* quiet */
  }
  setTimeout(() => {
    live = Math.max(0, live - 1);
  }, 400);
}

/**
 * THE ONE ENTRY POINT the physics world calls.
 *
 * `chipKey` scopes the cooldown to a chip, so one chip grinding against
 * another cannot hold the whole engine's budget while a THIRD chip lands
 * silently.
 */
export function playChipImpact(impact: ChipImpact, chipKey: string): void {
  if (!soundEnabled()) return;
  if (impact.intensity < MIN_INTENSITY) return;
  const t = now();

  // Burst detection first: a flurry becomes ONE rattle and the individual
  // clacks inside it are dropped.
  while (recent.length > 0 && t - recent[0] > BURST_WINDOW_MS) recent.shift();
  recent.push(t);
  if (recent.length >= BURST_COUNT) {
    if (t - lastRattleAt > RATTLE_COOLDOWN_MS) {
      lastRattleAt = t;
      lastVoiceAt = t;
      rattle(Math.min(1, impact.intensity + recent.length * 0.06), impact.x);
    }
    return;
  }

  if (t - lastVoiceAt < GLOBAL_SPACING_MS) return;
  const last = chipLastAt.get(chipKey) ?? 0;
  if (t - last < CHIP_COOLDOWN_MS) return;
  if (live >= MAX_VOICES) return;

  chipLastAt.set(chipKey, t);
  lastVoiceAt = t;
  strike(impact.intensity, impact.value, impact.x, impact.againstWall);
}

// ── the named moments ─────────────────────────────────────────────────────

/** Chips coming back to the tray: a soft scoop rather than an impact. */
export function playChipReturn(): void {
  if (!soundEnabled()) return;
  const g = graph();
  if (!g) return;
  const { ctx, bus: out, noise: buf } = g;
  const t0 = ctx.currentTime;
  try {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.8;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1500, t0);
    bp.frequency.exponentialRampToValueAtTime(600, t0 + 0.22);
    bp.Q.value = 1.1;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.16, t0);
    ng.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.24);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    src.start(t0);
    src.stop(t0 + 0.26);
  } catch {
    /* quiet */
  }
}

/**
 * THE POT LOCKS. Deliberately not a jingle: a low, short, final THUD with a
 * bright edge — the sound of something being put beyond reach. EvoForge's
 * tone is competitive and dark, and a slot-machine flourish would undo every
 * other decision in this feature.
 */
export function playPotLock(): void {
  if (!soundEnabled()) return;
  const g = graph();
  if (!g) return;
  const { ctx, bus: out, noise: buf } = g;
  const t0 = ctx.currentTime;
  try {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t0);
    o.frequency.exponentialRampToValueAtTime(52, t0 + 0.3);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.34, t0);
    og.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.34);
    o.connect(og);
    og.connect(out);
    o.start(t0);
    o.stop(t0 + 0.36);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2600, t0);
    bp.Q.value = 2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.2, t0);
    ng.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.06);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    src.start(t0);
    src.stop(t0 + 0.08);
  } catch {
    /* quiet */
  }
}

/** ALL IN — the same family, bigger: a low swell under a hard strike. Held
 *  for the moment the brief reserves it for, never for an ordinary raise. */
export function playAllInSlam(): void {
  if (!soundEnabled()) return;
  const g = graph();
  if (!g) return;
  const { ctx, bus: out } = g;
  const t0 = ctx.currentTime;
  try {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(60, t0);
    o.frequency.exponentialRampToValueAtTime(140, t0 + 0.42);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(300, t0);
    f.frequency.exponentialRampToValueAtTime(1800, t0 + 0.42);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0008, t0);
    og.gain.exponentialRampToValueAtTime(0.3, t0 + 0.4);
    og.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.62);
    o.connect(f);
    f.connect(og);
    og.connect(out);
    o.start(t0);
    o.stop(t0 + 0.64);
  } catch {
    /* quiet */
  }
  setTimeout(() => playPotLock(), 420);
}

/** Sign-out / unmount hygiene: drop the graph so a new context is picked up. */
export function resetChipAudio(): void {
  try {
    bus?.disconnect();
  } catch {
    /* already gone */
  }
  bus = null;
  noise = null;
  live = 0;
  recent.length = 0;
  chipLastAt.clear();
}
