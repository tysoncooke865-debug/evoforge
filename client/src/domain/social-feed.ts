/**
 * SOCIAL FEED — the typed post model + pure presentation logic. No react, no
 * supabase, no wall-clock. A stored `social_posts` row is a thin envelope
 * (author, type, visibility, caption, timestamps, counts) plus a per-type
 * `payload` JSONB; `toPost` validates + narrows that envelope into a
 * discriminated union so every card renders from a known shape, never `any`.
 *
 * THE DOCTRINE (same as the rest of EvoForge): a post asserts only what the
 * backend recorded. The payload numbers come from the athlete's own confirmed
 * events (a PR row, a finished workout, an Evo snapshot) — the feed never
 * invents a stat, and until the feed backend (migration 049) is applied +
 * the flag flipped, the Social tab stays an honest COMING SOON.
 */

export type PostType =
  | 'pr'
  | 'workout'
  | 'level_up'
  | 'evo_rating'
  | 'evolution'
  | 'rivalry'
  | 'photo'
  | 'status';

export type Visibility = 'public' | 'friends' | 'private';

export type ReactionKind = 'hype' | 'respect' | 'beast' | 'inspired';

export const REACTIONS: readonly ReactionKind[] = ['hype', 'respect', 'beast', 'inspired'];

/** The fields every post shares — the outer shell reads only these. */
export interface PostBase {
  id: string;
  authorId: string;
  authorName: string;
  /** Champion sprite descriptor for the portrait, or null → silhouette. */
  authorStage: number | null;
  visibility: Visibility;
  caption: string | null;
  createdAt: string;
  reactionCount: number;
  commentCount: number;
  /** The viewer's current reaction, or null. */
  myReaction: ReactionKind | null;
  /** Reaction totals by kind (0-filled). */
  reactionsByKind: Record<ReactionKind, number>;
  /** Friends tagged in the post (id + name snapshot at tag time). */
  tagged: { id: string; name: string }[];
}

export interface PRPost extends PostBase {
  type: 'pr';
  exercise: string;
  newValue: number;
  prevValue: number | null;
  unit: 'kg' | 'lb';
  /** e.g. "Top 12% among friends", when ranking data exists. */
  standing: string | null;
}

export interface WorkoutPost extends PostBase {
  type: 'workout';
  workoutName: string;
  minutes: number;
  sets: number;
  volumeKg: number;
  prCount: number;
  xp: number;
  exercises: string[];
  photoUrls: string[];
}

export interface LevelUpPost extends PostBase {
  type: 'level_up';
  prevLevel: number;
  newLevel: number;
  streakDays: number | null;
  reward: string | null;
}

export interface EvoRatingPost extends PostBase {
  type: 'evo_rating';
  prevRating: number;
  newRating: number;
  /** Signed deltas per pillar; only non-zero pillars are shown. */
  pillars: { label: string; delta: number }[];
}

export interface EvolutionPost extends PostBase {
  type: 'evolution';
  path: string;
  prevStage: number;
  newStage: number;
}

export interface RivalryPost extends PostBase {
  type: 'rivalry';
  opponentName: string;
  /** Category → who leads ('me' | 'them' | 'even'). */
  categories: { label: string; lead: 'me' | 'them' | 'even'; detail: string | null }[];
  objective: string | null;
}

export interface PhotoPost extends PostBase {
  type: 'photo';
  photoUrls: string[];
  /** Optional linked workout summary shown over/under the carousel. */
  workoutName: string | null;
  minutes: number | null;
  sets: number | null;
}

/** A plain text update — the caption IS the content (the composer's general
 *  update). No payload body; the shell renders the caption large. */
export interface StatusPost extends PostBase {
  type: 'status';
}

export type SocialPost =
  | PRPost
  | WorkoutPost
  | LevelUpPost
  | EvoRatingPost
  | EvolutionPost
  | RivalryPost
  | PhotoPost
  | StatusPost;

/** The raw row shape the feed RPC returns (payload is per-type JSONB). */
export interface RawPostRow {
  id?: unknown;
  author_id?: unknown;
  author_name?: unknown;
  author_stage?: unknown;
  post_type?: unknown;
  visibility?: unknown;
  caption?: unknown;
  created_at?: unknown;
  reaction_count?: unknown;
  comment_count?: unknown;
  my_reaction?: unknown;
  reactions_by_kind?: unknown;
  payload?: unknown;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const numOr = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const isVisibility = (v: unknown): v is Visibility =>
  v === 'public' || v === 'friends' || v === 'private';
const isReaction = (v: unknown): v is ReactionKind =>
  v === 'hype' || v === 'respect' || v === 'beast' || v === 'inspired';
const isPostType = (v: unknown): v is PostType =>
  v === 'pr' || v === 'workout' || v === 'level_up' || v === 'evo_rating' ||
  v === 'evolution' || v === 'rivalry' || v === 'photo' || v === 'status';

function reactionsByKind(v: unknown): Record<ReactionKind, number> {
  const out: Record<ReactionKind, number> = { hype: 0, respect: 0, beast: 0, inspired: 0 };
  if (v && typeof v === 'object') {
    for (const k of REACTIONS) out[k] = Math.max(0, Math.trunc(numOr((v as Record<string, unknown>)[k], 0)));
  }
  return out;
}

/**
 * Narrow a raw row into a typed post, or null if the type/payload is
 * unusable. Defensive on every field — a malformed payload drops the post
 * rather than rendering a broken card or throwing in the list.
 */
export function toPost(row: RawPostRow): SocialPost | null {
  const type = row.post_type;
  if (!isPostType(type)) return null;
  const p = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, unknown>;

  const base: PostBase = {
    id: str(row.id),
    authorId: str(row.author_id),
    authorName: str(row.author_name, 'Athlete') || 'Athlete',
    authorStage: row.author_stage == null ? null : Math.max(1, Math.min(4, Math.trunc(numOr(row.author_stage, 1)))),
    visibility: isVisibility(row.visibility) ? row.visibility : 'friends',
    caption: typeof row.caption === 'string' && row.caption.trim() !== '' ? row.caption : null,
    createdAt: str(row.created_at),
    reactionCount: Math.max(0, Math.trunc(numOr(row.reaction_count, 0))),
    commentCount: Math.max(0, Math.trunc(numOr(row.comment_count, 0))),
    myReaction: isReaction(row.my_reaction) ? row.my_reaction : null,
    reactionsByKind: reactionsByKind(row.reactions_by_kind),
    tagged: Array.isArray(p.tagged)
      ? (p.tagged as Record<string, unknown>[])
          .map((x) => ({ id: str(x.id), name: str(x.name, 'Athlete') || 'Athlete' }))
          .filter((x) => x.id !== '')
          .slice(0, 20)
      : [],
  };
  if (base.id === '') return null;

  switch (type) {
    case 'pr':
      return {
        ...base,
        type,
        exercise: str(p.exercise, 'Lift'),
        newValue: numOr(p.new_value, 0),
        prevValue: p.prev_value == null ? null : numOr(p.prev_value, 0),
        unit: p.unit === 'lb' ? 'lb' : 'kg',
        standing: typeof p.standing === 'string' ? p.standing : null,
      };
    case 'workout':
      return {
        ...base,
        type,
        workoutName: str(p.workout_name, 'Workout'),
        minutes: Math.max(0, Math.trunc(numOr(p.minutes, 0))),
        sets: Math.max(0, Math.trunc(numOr(p.sets, 0))),
        volumeKg: Math.max(0, Math.round(numOr(p.volume_kg, 0))),
        prCount: Math.max(0, Math.trunc(numOr(p.pr_count, 0))),
        xp: Math.max(0, Math.trunc(numOr(p.xp, 0))),
        exercises: strArr(p.exercises),
        photoUrls: strArr(p.photo_urls),
      };
    case 'level_up':
      return {
        ...base,
        type,
        prevLevel: Math.max(0, Math.trunc(numOr(p.prev_level, 0))),
        newLevel: Math.max(0, Math.trunc(numOr(p.new_level, 1))),
        streakDays: p.streak_days == null ? null : Math.max(0, Math.trunc(numOr(p.streak_days, 0))),
        reward: typeof p.reward === 'string' ? p.reward : null,
      };
    case 'evo_rating': {
      const pillars = Array.isArray(p.pillars)
        ? (p.pillars as Record<string, unknown>[])
            .map((x) => ({ label: str(x.label), delta: Math.trunc(numOr(x.delta, 0)) }))
            .filter((x) => x.label !== '')
        : [];
      return { ...base, type, prevRating: Math.trunc(numOr(p.prev_rating, 0)), newRating: Math.trunc(numOr(p.new_rating, 0)), pillars };
    }
    case 'evolution':
      return {
        ...base,
        type,
        path: str(p.path, 'Champion'),
        prevStage: Math.max(1, Math.trunc(numOr(p.prev_stage, 1))),
        newStage: Math.max(1, Math.trunc(numOr(p.new_stage, 2))),
      };
    case 'rivalry': {
      const categories = Array.isArray(p.categories)
        ? (p.categories as Record<string, unknown>[])
            .map((x) => ({
              label: str(x.label),
              lead: (x.lead === 'me' ? 'me' : x.lead === 'them' ? 'them' : 'even') as 'me' | 'them' | 'even',
              detail: typeof x.detail === 'string' ? x.detail : null,
            }))
            .filter((x) => x.label !== '')
        : [];
      return { ...base, type, opponentName: str(p.opponent_name, 'Rival'), categories, objective: typeof p.objective === 'string' ? p.objective : null };
    }
    case 'photo':
      return {
        ...base,
        type,
        photoUrls: strArr(p.photo_urls),
        workoutName: typeof p.workout_name === 'string' ? p.workout_name : null,
        minutes: p.minutes == null ? null : Math.max(0, Math.trunc(numOr(p.minutes, 0))),
        sets: p.sets == null ? null : Math.max(0, Math.trunc(numOr(p.sets, 0))),
      };
    case 'status':
      return { ...base, type };
  }
}

/**
 * Build a WORKOUT post payload from the athlete's own confirmed workout_log
 * rows for one date + workout — real counts only (sets, volume, distinct
 * exercises); XP mirrors the ledger's flat 10/set. Pure; no wall-clock.
 */
export function workoutPostPayload(
  rows: readonly { date?: unknown; workout?: unknown; exercise?: unknown; weight?: unknown; reps?: unknown }[],
  date: string,
  workout: string
): { workout_name: string; sets: number; volume_kg: number; xp: number; exercises: string[] } {
  let sets = 0;
  let volume = 0;
  const seen: string[] = [];
  for (const r of rows) {
    if (String(r.date).slice(0, 10) !== date || String(r.workout) !== workout) continue;
    const w = Number(r.weight);
    const reps = Number(r.reps);
    if (!(Number.isFinite(w) && w >= 0 && r.weight != null && Number.isFinite(reps) && reps > 0)) continue;
    sets += 1;
    volume += w * reps;
    const ex = String(r.exercise ?? '');
    if (ex && !seen.includes(ex)) seen.push(ex);
  }
  return { workout_name: workout, sets, volume_kg: Math.round(volume), xp: sets * 10, exercises: seen };
}

/** Rows → posts, dropping any that fail validation (never throws on a bad row). */
export function toPosts(rows: readonly RawPostRow[]): SocialPost[] {
  const out: SocialPost[] = [];
  for (const r of rows) {
    const post = toPost(r);
    if (post) out.push(post);
  }
  return out;
}

/**
 * Apply a reaction toggle locally for an optimistic update: tapping your
 * current reaction removes it; a new one replaces the old. Returns the next
 * post so the mutation can roll back to the previous on failure.
 */
export function applyReaction(post: PostBase, kind: ReactionKind): PostBase {
  const prev = post.myReaction;
  const byKind = { ...post.reactionsByKind };
  let count = post.reactionCount;
  if (prev === kind) {
    byKind[kind] = Math.max(0, byKind[kind] - 1);
    count = Math.max(0, count - 1);
    return { ...post, myReaction: null, reactionsByKind: byKind, reactionCount: count };
  }
  if (prev) byKind[prev] = Math.max(0, byKind[prev] - 1);
  else count += 1;
  byKind[kind] += 1;
  return { ...post, myReaction: kind, reactionsByKind: byKind, reactionCount: count };
}

/**
 * ONE-LEVEL comment threads (058, 2026-07-19): parents in their original
 * (chronological) order, each carrying its replies in theirs. An orphaned
 * reply — parent soft-deleted between reads — surfaces as top-level rather
 * than vanishing: losing someone's words is worse than a flat row.
 */
export function groupCommentThreads<T extends { id: string; parent_id?: string | null }>(
  rows: readonly T[]
): { top: T; replies: T[] }[] {
  const byParent = new Map<string, T[]>();
  const tops: T[] = [];
  const topIds = new Set(rows.filter((r) => !r.parent_id).map((r) => r.id));
  for (const r of rows) {
    if (r.parent_id && topIds.has(r.parent_id)) {
      const list = byParent.get(r.parent_id) ?? [];
      list.push(r);
      byParent.set(r.parent_id, list);
    } else {
      tops.push(r);
    }
  }
  return tops.map((top) => ({ top, replies: byParent.get(top.id) ?? [] }));
}

/** A short relative time from an ISO string and a caller-supplied "now" ms
 *  (no wall-clock in the domain — the screen passes Date.now via a stamp). */
export function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.round(d / 7)}w`;
}
