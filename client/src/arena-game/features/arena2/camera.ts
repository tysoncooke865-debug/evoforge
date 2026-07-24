/**
 * Arena 2.0 — follow-camera (Redesign P1, pure).
 *
 * The landscape battlefield renders a lane WIDER than the viewport so the push
 * has depth; the camera is a single horizontal translate on the content
 * container (not per-unit work) that keeps the action in frame. All math is
 * pure so it is unit-testable and never touches sim state — the P1 "render is a
 * pure function of sim state" guarantee that keeps digests identical.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Pixels-per-engine-unit so the lane content is `zoom`× the viewport width
 * (>1 gives scroll room / depth). Floored at a minimum so a tiny viewport still
 * renders combatants at a sane size.
 */
export function pixelsPerUnit(viewportW: number, laneLength: number, zoom = 1.35, minPPU = 4): number {
  if (laneLength <= 0) return minPPU;
  return Math.max(minPPU, (viewportW * zoom) / laneLength);
}

/**
 * Horizontal translate for the content container so `targetContentX` (px, in
 * content space) sits at the viewport centre — clamped so the camera never
 * reveals past either end of the content. If the content is narrower than the
 * viewport it is centred (no scroll).
 */
export function cameraTranslateX(targetContentX: number, viewportW: number, contentW: number): number {
  if (!Number.isFinite(targetContentX)) return 0;
  if (contentW <= viewportW) return (viewportW - contentW) / 2;
  return clamp(viewportW / 2 - targetContentX, viewportW - contentW, 0);
}

/**
 * The "action centre" to point the camera at, in ENGINE-x, from living units.
 * Prefers the player champion (the star); otherwise the midpoint of the living
 * front-most combatants on each side; falls back to lane centre. Pure over the
 * passed positions — never reads global state.
 */
export function actionCenterX(
  positions: readonly { x: number; team: 'player' | 'opponent'; isChampion: boolean }[],
  laneLength: number
): number {
  const champ = positions.find((p) => p.isChampion && p.team === 'player');
  if (champ) return champ.x;
  const players = positions.filter((p) => p.team === 'player');
  const opponents = positions.filter((p) => p.team === 'opponent');
  if (players.length && opponents.length) {
    const front = Math.max(...players.map((p) => p.x)); // furthest-advanced player
    const enemyFront = Math.min(...opponents.map((p) => p.x)); // furthest-advanced opponent
    return (front + enemyFront) / 2;
  }
  if (players.length) return Math.max(...players.map((p) => p.x));
  if (opponents.length) return Math.min(...opponents.map((p) => p.x));
  return laneLength / 2;
}

/** Ease the camera toward a target (frame-rate-independent-ish exponential
 *  smoothing) so it glides instead of snapping. `factor` in (0,1]; 1 = snap. */
export function easeCamera(current: number, target: number, factor: number): number {
  return current + (target - current) * clamp(factor, 0, 1);
}
