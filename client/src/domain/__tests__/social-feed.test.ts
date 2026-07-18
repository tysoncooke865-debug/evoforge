import { describe, expect, it } from 'vitest';

import {
  applyReaction,
  relativeTime,
  toPost,
  toPosts,
  workoutPostPayload,
  type PostBase,
  type RawPostRow,
} from '../social-feed';

const baseRow = (over: Partial<RawPostRow> = {}): RawPostRow => ({
  id: 'p1',
  author_id: 'u1',
  author_name: 'Jack',
  author_stage: 3,
  post_type: 'pr',
  visibility: 'friends',
  caption: 'new best',
  created_at: '2026-07-18T08:00:00Z',
  reaction_count: 4,
  comment_count: 1,
  my_reaction: 'hype',
  reactions_by_kind: { hype: 3, respect: 1 },
  payload: { exercise: 'Barbell Bench Press', new_value: 110, prev_value: 105, unit: 'kg' },
  ...over,
});

describe('toPost — narrowing the envelope', () => {
  it('narrows a PR post with its payload', () => {
    const p = toPost(baseRow());
    expect(p?.type).toBe('pr');
    if (p?.type === 'pr') {
      expect(p.exercise).toBe('Barbell Bench Press');
      expect(p.newValue).toBe(110);
      expect(p.prevValue).toBe(105);
      expect(p.unit).toBe('kg');
    }
    // Base fields + reaction fill.
    expect(p?.reactionsByKind).toEqual({ hype: 3, respect: 1, beast: 0, inspired: 0 });
    expect(p?.myReaction).toBe('hype');
  });

  it('narrows every post type', () => {
    const types = ['workout', 'level_up', 'evo_rating', 'evolution', 'rivalry', 'photo', 'status'] as const;
    for (const t of types) {
      const p = toPost(baseRow({ post_type: t, payload: {} }));
      expect(p?.type).toBe(t);
    }
  });

  it('a status post is just the caption (no body payload needed)', () => {
    const p = toPost(baseRow({ post_type: 'status', payload: {}, caption: 'back day done 💪' }));
    expect(p?.type).toBe('status');
    expect(p?.caption).toBe('back day done 💪');
  });

  it('reads workout stats and evo pillars', () => {
    const w = toPost(baseRow({ post_type: 'workout', payload: { workout_name: 'Push Day', minutes: 58, sets: 16, volume_kg: 5420, pr_count: 2, xp: 420, exercises: ['Bench', 'OHP', 'Dips', 'Flyes'] } }));
    expect(w?.type === 'workout' && w.exercises).toHaveLength(4);
    const e = toPost(baseRow({ post_type: 'evo_rating', payload: { prev_rating: 72, new_rating: 74, pillars: [{ label: 'STRENGTH', delta: 2 }, { label: 'BAD' }] } }));
    expect(e?.type === 'evo_rating' && e.pillars).toEqual([{ label: 'STRENGTH', delta: 2 }, { label: 'BAD', delta: 0 }]);
  });

  it('drops an unknown type or a row with no id', () => {
    expect(toPost(baseRow({ post_type: 'nonsense' }))).toBeNull();
    expect(toPost(baseRow({ id: '' }))).toBeNull();
  });

  it('defaults a bad visibility to friends and a bad reaction to null', () => {
    const p = toPost(baseRow({ visibility: 'everyone', my_reaction: 'love' }));
    expect(p?.visibility).toBe('friends');
    expect(p?.myReaction).toBeNull();
  });

  it('tolerates a garbage payload without throwing', () => {
    const p = toPost(baseRow({ payload: null }));
    expect(p?.type).toBe('pr');
    if (p?.type === 'pr') expect(p.newValue).toBe(0);
  });
});

describe('toPosts — drops bad rows, keeps good', () => {
  it('filters unusable rows', () => {
    const posts = toPosts([baseRow(), baseRow({ post_type: 'nope' }), baseRow({ id: 'p2' })]);
    expect(posts.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('applyReaction — optimistic toggle', () => {
  const post: PostBase = {
    id: 'p', authorId: 'u', authorName: 'A', authorStage: 1, visibility: 'friends',
    caption: null, createdAt: '', reactionCount: 5, commentCount: 0,
    myReaction: 'hype', reactionsByKind: { hype: 3, respect: 2, beast: 0, inspired: 0 },
  };

  it('removing my current reaction decrements count and clears it', () => {
    const next = applyReaction(post, 'hype');
    expect(next.myReaction).toBeNull();
    expect(next.reactionCount).toBe(4);
    expect(next.reactionsByKind.hype).toBe(2);
  });

  it('switching reactions keeps the count and moves the tally', () => {
    const next = applyReaction(post, 'beast');
    expect(next.myReaction).toBe('beast');
    expect(next.reactionCount).toBe(5); // switch, not add
    expect(next.reactionsByKind.hype).toBe(2);
    expect(next.reactionsByKind.beast).toBe(1);
  });

  it('a first reaction increments the count', () => {
    const next = applyReaction({ ...post, myReaction: null }, 'respect');
    expect(next.myReaction).toBe('respect');
    expect(next.reactionCount).toBe(6);
    expect(next.reactionsByKind.respect).toBe(3);
  });
});

describe('workoutPostPayload — real counts from the log', () => {
  const rows = [
    { date: '2026-07-18', workout: 'Push', exercise: 'Bench', weight: 100, reps: 5 },
    { date: '2026-07-18', workout: 'Push', exercise: 'Bench', weight: 100, reps: 5 },
    { date: '2026-07-18', workout: 'Push', exercise: 'OHP', weight: 60, reps: 8 },
    { date: '2026-07-18', workout: 'Pull', exercise: 'Row', weight: 80, reps: 8 }, // other workout
    { date: '2026-07-17', workout: 'Push', exercise: 'Bench', weight: 100, reps: 5 }, // other day
    { date: '2026-07-18', workout: 'Push', exercise: 'Warmup', weight: 0, reps: 10 }, // no load
  ];
  it('aggregates sets, volume, exercises and XP for one date+workout', () => {
    expect(workoutPostPayload(rows, '2026-07-18', 'Push')).toEqual({
      workout_name: 'Push',
      sets: 3,
      volume_kg: 100 * 5 + 100 * 5 + 60 * 8, // 1480
      xp: 30,
      exercises: ['Bench', 'OHP'],
    });
  });
  it('empty when nothing matches', () => {
    expect(workoutPostPayload(rows, '2026-07-18', 'Legs').sets).toBe(0);
  });
});

describe('relativeTime — no wall-clock in the domain', () => {
  const now = Date.parse('2026-07-18T12:00:00Z');
  it('buckets the recent past', () => {
    expect(relativeTime('2026-07-18T11:59:40Z', now)).toBe('now');
    expect(relativeTime('2026-07-18T11:30:00Z', now)).toBe('30m');
    expect(relativeTime('2026-07-18T09:00:00Z', now)).toBe('3h');
    expect(relativeTime('2026-07-16T12:00:00Z', now)).toBe('2d');
    expect(relativeTime('2026-07-04T12:00:00Z', now)).toBe('2w');
  });
  it('empty on a bad date', () => {
    expect(relativeTime('nonsense', now)).toBe('');
  });
});
