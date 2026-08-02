/**
 * CHAPTER I — twelve weeks, one template, five origins.
 *
 * THIS FILE MIRRORS `migrations/130_origin_evolution_path.sql` PART G. The
 * database is the authority (it decides what actually unlocks); this is the
 * display metadata beside it. `__tests__/reward-parity.test.ts` parses the
 * migration and fails if the two ever disagree — the repo's rule that a
 * guard which cannot fail is not a guard.
 *
 * The rhythm is the brief's: something to read, then something to look at,
 * then something that changes how the game feels, and a character
 * transformation at the end of the chapter.
 */

import type { ChapterId, OriginId, OriginReward, RewardKind } from './types';

interface WeekTemplate {
  week: number;
  kind: RewardKind;
  /** `{ORIGIN}` is replaced with the origin's display name. */
  label: string;
  description: string;
}

export const CHAPTER_ONE_TEMPLATE: readonly WeekTemplate[] = [
  { week: 1, kind: 'title', label: '{ORIGIN} Initiate', description: 'A title, earned by showing up for a full week.' },
  { week: 2, kind: 'portrait', label: '{ORIGIN} Portrait', description: "A profile portrait in your Origin's line." },
  { week: 3, kind: 'visual_effect', label: '{ORIGIN} Impact Effect', description: 'A visual effect on your lifts and victories.' },
  { week: 4, kind: 'nameplate', label: '{ORIGIN} Nameplate', description: 'A nameplate for your profile and the board.' },
  { week: 5, kind: 'share_theme', label: '{ORIGIN} Share Card', description: 'A share-card theme for your workout summaries.' },
  { week: 6, kind: 'background', label: '{ORIGIN} Background', description: 'A background for your profile and battles.' },
  { week: 7, kind: 'sound_theme', label: '{ORIGIN} Sound Theme', description: "Feedback and sound in your Origin's key." },
  { week: 8, kind: 'frame', label: '{ORIGIN} Profile Frame', description: 'A frame around your champion portrait.' },
  { week: 9, kind: 'entrance', label: '{ORIGIN} Entrance', description: 'An entrance effect when your champion appears.' },
  { week: 10, kind: 'badge', label: '{ORIGIN} Chapter I Badge', description: 'Proof of a completed chapter.' },
  { week: 11, kind: 'evolution_preview', label: '{ORIGIN} Evolution Preview', description: 'A first look at your Level 2 form.' },
  { week: 12, kind: 'level_transformation', label: '{ORIGIN} Level 2 Form', description: 'Your champion evolves. Chapter I complete.' },
] as const;

/** The reward id contract, shared with the migration's seed. */
export function rewardIdFor(originId: OriginId, chapter: ChapterId, week: number): string {
  return `${originId}_c${chapter}_w${week}`;
}

export function chapterOneRewards(originId: OriginId, displayName: string): OriginReward[] {
  return CHAPTER_ONE_TEMPLATE.map((t) => ({
    rewardId: rewardIdFor(originId, 1, t.week),
    weekIndex: t.week,
    chapter: 1 as ChapterId,
    kind: t.kind,
    label: t.label.replace('{ORIGIN}', displayName),
    description: t.description,
    claimMode: 'automatic' as const,
  }));
}

/** Human wording for a reward kind — used by the Path page and the
 *  post-workout screen so one vocabulary describes every unlock. */
export const REWARD_KIND_LABEL: Record<RewardKind, string> = {
  title: 'TITLE',
  portrait: 'PORTRAIT',
  visual_effect: 'EFFECT',
  nameplate: 'NAMEPLATE',
  share_theme: 'SHARE CARD',
  background: 'BACKGROUND',
  sound_theme: 'SOUND',
  frame: 'FRAME',
  entrance: 'ENTRANCE',
  badge: 'BADGE',
  evolution_preview: 'PREVIEW',
  level_transformation: 'EVOLUTION',
};
