import { describe, expect, it } from 'vitest';

import { runGymBattle, type GymCombatMember } from '../gym-battle';

const m = (name: string, path: string | null, s: number): GymCombatMember => ({
  user_id: name,
  name,
  path,
  size: s,
  aes: s,
  str: s,
  cnd: s,
});

describe('runGymBattle', () => {
  const A = [m('A1', 'titan', 60), m('A2', 'aesthetic', 50)];
  const B = [m('B1', 'shredder', 55), m('B2', 'cardio', 45)];

  it('is DETERMINISTIC for the same rosters + seed', () => {
    const r1 = runGymBattle(A, B, 12345);
    const r2 = runGymBattle(A, B, 12345);
    expect(r1).toEqual(r2);
  });

  it('runs one duel per seat and the scores sum to the duel count', () => {
    const r = runGymBattle(A, B, 999);
    expect(r.duels).toHaveLength(2);
    expect(r.a_score + r.b_score).toBe(2);
    for (const d of r.duels) expect(d.winner === 'a' || d.winner === 'b').toBe(true);
  });

  it('a deeper roster takes the extra seat as a bye', () => {
    const r = runGymBattle([...A, m('A3', 'mass', 70)], B, 7);
    expect(r.duels).toHaveLength(3);
    // A3 has no opponent — it is an automatic point for A.
    expect(r.duels[2]).toMatchObject({ a_name: 'A3', b_name: '—', winner: 'a' });
    expect(r.a_score + r.b_score).toBe(3);
  });

  it('a null champion path still fields a fighter (defaults to aesthetic)', () => {
    const r = runGymBattle([m('X', null, 50)], [m('Y', null, 50)], 3);
    expect(r.duels).toHaveLength(1);
    expect(r.a_score + r.b_score).toBe(1);
  });
});
