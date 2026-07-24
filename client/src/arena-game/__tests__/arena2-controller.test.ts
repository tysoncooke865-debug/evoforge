/**
 * Arena 2.0 — champion AnimationController (P0). Pure frame-clock math, no PNG
 * imports (so it runs headless in Vitest). Pins the deterministic clip-playback
 * contract the Anim Lab and (later) the sim-driven controller both rely on.
 */
import { describe, expect, it } from 'vitest';
import { clipFinished, clipFrameIndex, inIFrames } from '../features/arena2/champion-controller';
import type { ClipMeta } from '../features/arena2/champion-anim';

const loopClip: ClipMeta = {
  sheet: 'run.png', cols: 8, rows: 8, count: 64, cell: 128, fps: 20, loop: true, anchorYOffset: 0,
};
const oneShot: ClipMeta = {
  sheet: 'attack.png', cols: 5, rows: 5, count: 25, cell: 128, fps: 25, loop: false, anchorYOffset: 0, hitFrame: 12,
};
const dash: ClipMeta = {
  sheet: 'dash.png', cols: 5, rows: 5, count: 25, cell: 128, fps: 25, loop: false, anchorYOffset: 0, iFrames: [2, 17],
};

describe('clipFrameIndex', () => {
  it('advances one frame per 1000/fps ms', () => {
    // 20fps → 50ms/frame
    expect(clipFrameIndex(loopClip, 0, 0)).toBe(0);
    expect(clipFrameIndex(loopClip, 0, 49)).toBe(0);
    expect(clipFrameIndex(loopClip, 0, 50)).toBe(1);
    expect(clipFrameIndex(loopClip, 0, 150)).toBe(3);
  });

  it('loops a looping clip (wraps at count)', () => {
    // 64 frames @ 50ms = 3200ms/cycle; frame 64 wraps to 0
    expect(clipFrameIndex(loopClip, 0, 64 * 50)).toBe(0);
    expect(clipFrameIndex(loopClip, 0, 65 * 50)).toBe(1);
  });

  it('clamps a one-shot at the final frame instead of wrapping', () => {
    // 25 frames @ 40ms; well past the end holds frame 24
    expect(clipFrameIndex(oneShot, 0, 1000)).toBe(24);
    expect(clipFrameIndex(oneShot, 0, 10_000)).toBe(24);
  });

  it('never returns a negative or out-of-range index (clock skew safe)', () => {
    expect(clipFrameIndex(loopClip, 100, 0)).toBe(0); // now < start
    const f = clipFrameIndex(loopClip, 0, 12_345);
    expect(f).toBeGreaterThanOrEqual(0);
    expect(f).toBeLessThan(loopClip.count);
  });
});

describe('clipFinished', () => {
  it('is false for looping clips forever', () => {
    expect(clipFinished(loopClip, 0, 10_000_000)).toBe(false);
  });
  it('is true only after a one-shot has played fully', () => {
    // 25 frames @ 40ms = 1000ms
    expect(clipFinished(oneShot, 0, 999)).toBe(false);
    expect(clipFinished(oneShot, 0, 1000)).toBe(true);
  });
});

describe('inIFrames', () => {
  it('is true only within the dash invulnerability window', () => {
    // 25f @ 40ms. iFrames [2,17] → 80ms..680ms inclusive of those frames
    expect(inIFrames(dash, 0, 40)).toBe(false); // frame 1
    expect(inIFrames(dash, 0, 80)).toBe(true); // frame 2
    expect(inIFrames(dash, 0, 17 * 40)).toBe(true); // frame 17
    expect(inIFrames(dash, 0, 18 * 40)).toBe(false); // frame 18
  });
  it('is false when a clip has no iFrames', () => {
    expect(inIFrames(oneShot, 0, 200)).toBe(false);
  });
});
