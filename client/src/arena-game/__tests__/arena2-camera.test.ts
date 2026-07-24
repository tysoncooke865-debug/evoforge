/**
 * Arena 2.0 — follow-camera (P1). Pure math; pins the landscape camera contract
 * (centre the action, clamp to content bounds, centre when content fits).
 */
import { describe, expect, it } from 'vitest';
import {
  actionCenterX,
  cameraTranslateX,
  easeCamera,
  pixelsPerUnit,
} from '../features/arena2/camera';

describe('pixelsPerUnit', () => {
  it('scales content to zoom× the viewport width', () => {
    expect(pixelsPerUnit(1000, 100, 1.5)).toBeCloseTo(15);
  });
  it('floors at a minimum for tiny viewports', () => {
    expect(pixelsPerUnit(10, 100, 1, 4)).toBe(4);
  });
  it('handles a zero laneLength without dividing by zero', () => {
    expect(pixelsPerUnit(1000, 0)).toBe(4);
  });
});

describe('cameraTranslateX', () => {
  it('centres content narrower than the viewport (no scroll)', () => {
    expect(cameraTranslateX(50, 1000, 400)).toBe(300); // (1000-400)/2
  });
  it('centres the target when there is room to scroll', () => {
    // viewport 1000, content 2000, target at 800 → 500-800 = -300, in-bounds
    expect(cameraTranslateX(800, 1000, 2000)).toBe(-300);
  });
  it('clamps at the left edge (never reveals before content start)', () => {
    expect(cameraTranslateX(100, 1000, 2000)).toBe(0);
  });
  it('clamps at the right edge (never reveals past content end)', () => {
    // min scroll = viewport - content = -1000
    expect(cameraTranslateX(1900, 1000, 2000)).toBe(-1000);
  });
  it('returns 0 for a non-finite target', () => {
    expect(cameraTranslateX(Number.NaN, 1000, 2000)).toBe(0);
  });
});

describe('actionCenterX', () => {
  const P = (x: number, team: 'player' | 'opponent', isChampion = false) => ({ x, team, isChampion });
  it('follows the player champion when present', () => {
    expect(actionCenterX([P(20, 'player'), P(55, 'player', true), P(90, 'opponent')], 100)).toBe(55);
  });
  it('uses the midpoint of the two front lines otherwise', () => {
    // furthest player = 40, furthest-advanced opponent = 60 → 50
    expect(actionCenterX([P(30, 'player'), P(40, 'player'), P(60, 'opponent'), P(80, 'opponent')], 100)).toBe(50);
  });
  it('falls back to lane centre when a side is empty', () => {
    expect(actionCenterX([], 100)).toBe(50);
    expect(actionCenterX([P(30, 'player')], 100)).toBe(30);
  });
});

describe('easeCamera', () => {
  it('moves a fraction of the way toward the target', () => {
    expect(easeCamera(0, 100, 0.25)).toBe(25);
  });
  it('snaps with factor 1', () => {
    expect(easeCamera(0, 100, 1)).toBe(100);
  });
});
