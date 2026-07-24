/**
 * Arena 2.0 — champion AnimationController (Redesign P0, pure).
 *
 * Deterministic clip playback: given a clip's metadata, when it started, and the
 * frame clock, it returns which frame to draw. No per-unit React state, no
 * Animated values — the same frame-driven discipline Arena 1.0 enforces, scaled
 * from 4-frame walks to full clip sets. At P2 this is fed by sim state (which
 * clip) and the battle tick clock (deterministic start times); at P0 the Anim
 * Lab drives it directly. Kept pure so it is unit-testable and replay-safe.
 */
import type { ClipMeta } from './champion-anim';

/** Frame index to draw for a clip. Looping clips wrap; one-shots clamp to the
 *  final frame (so a finished attack holds its recovery pose until replaced). */
export function clipFrameIndex(clip: ClipMeta, startMs: number, nowMs: number): number {
  const frameMs = 1000 / clip.fps;
  const raw = Math.floor(Math.max(0, nowMs - startMs) / frameMs);
  return clip.loop ? ((raw % clip.count) + clip.count) % clip.count : Math.min(clip.count - 1, raw);
}

/** True once a one-shot clip has played fully (looping clips never finish). */
export function clipFinished(clip: ClipMeta, startMs: number, nowMs: number): boolean {
  if (clip.loop) return false;
  return nowMs - startMs >= (clip.count / clip.fps) * 1000;
}

/** Whether the clip is currently within its invulnerability window (dash). */
export function inIFrames(clip: ClipMeta, startMs: number, nowMs: number): boolean {
  if (!clip.iFrames) return false;
  const f = clipFrameIndex(clip, startMs, nowMs);
  return f >= clip.iFrames[0] && f <= clip.iFrames[1];
}
