/**
 * Glicko-2 (Glickman, "Example of the Glicko-2 system") — PROGRESSION P7.
 *
 * THE MASTER COPY. It exists in three places and must be BYTE-IDENTICAL:
 *   contracts/rival/glicko2.ts                       (edit THIS one)
 *   client/src/domain/progression/glicko2.ts         (display previews)
 *   supabase/functions/_shared/rival/glicko2.ts      (authoritative settles)
 * client/scripts/verify-glicko.mjs pins them (--write propagates) — the
 * battle-engine doctrine: preview maths that drifts from settle maths is
 * a lie on screen.
 *
 * Deliberately self-contained: zero imports, so the same bytes load under
 * Metro and Deno. Pinned by test to the paper's worked example:
 * r=1500 RD=200 σ=0.06 τ=0.5 vs (1400,30,1)(1550,100,0)(1700,300,0)
 * → r'≈1464.06, RD'≈151.52, σ'≈0.05999.
 */

export interface GlickoRating {
  rating: number;
  rd: number;
  volatility: number;
}

export interface GlickoGame {
  opponentRating: number;
  opponentRd: number;
  /** 1 win · 0.5 draw · 0 loss, from THIS player's side. */
  score: number;
}

export const GLICKO_DEFAULT: GlickoRating = { rating: 1500, rd: 350, volatility: 0.06 };
export const GLICKO_TAU = 0.5;
const SCALE = 173.7178;
const EPS = 0.000001;

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expectation(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

/**
 * One rating period. No games → RD drifts upward by the volatility (the
 * inactivity-uncertainty rule) and rating/volatility hold.
 */
export function glicko2Update(
  player: GlickoRating,
  games: GlickoGame[],
  tau: number = GLICKO_TAU
): GlickoRating {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.volatility;

  if (games.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return { rating: player.rating, rd: Math.min(phiStar * SCALE, 350), volatility: sigma };
  }

  let vInv = 0;
  let deltaSum = 0;
  for (const game of games) {
    const muJ = (game.opponentRating - 1500) / SCALE;
    const phiJ = game.opponentRd / SCALE;
    const gJ = g(phiJ);
    const eJ = expectation(mu, muJ, phiJ);
    vInv += gJ * gJ * eJ * (1 - eJ);
    deltaSum += gJ * (game.score - eJ);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;

  // New volatility: the paper's iterative Illinois algorithm.
  const a = Math.log(sigma * sigma);
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * Math.pow(phi * phi + v + ex, 2);
    return num / den - (x - a) / (tau * tau);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k += 1;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > EPS) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  const sigmaPrime = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * deltaSum;

  return {
    rating: muPrime * SCALE + 1500,
    rd: phiPrime * SCALE,
    volatility: sigmaPrime,
  };
}

/** Win probability preview for matchmaking displays. */
export function glickoWinProbability(player: GlickoRating, opponent: GlickoRating): number {
  const mu = (player.rating - 1500) / SCALE;
  const muJ = (opponent.rating - 1500) / SCALE;
  const phiJ = opponent.rd / SCALE;
  return expectation(mu, muJ, phiJ);
}
