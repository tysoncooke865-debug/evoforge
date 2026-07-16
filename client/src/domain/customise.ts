import type { Branch } from './avatar-stats';
import { getBranchStage } from './avatar-stats';
import type { BranchContext, BranchV2, ScoresV2 } from './branches-v2';
import {
  avatarStageRowsV2,
  branchDisplayNameV2,
  branchPathsV2,
  evolutionNameV2,
  isShredder,
  shredderName,
  shredderRows,
  shredderStage,
} from './branches-v2';
import type { EvolutionRequirement } from './next-evolution';

/**
 * CUSTOMISE (Tyson, 2026-07-16) — the pure model behind the full-screen
 * character customiser. Everything here derives from REAL progression
 * state: roster locks are the live branch gates (branchPathsV2), stage
 * locks are the live evolution ladders, and cosmetic gates evaluate
 * against the real Forge Level. No parallel stat source, no fake unlocks.
 *
 * PREVIEW ≠ EQUIPPED: the screen holds a local Selection; only EQUIP
 * writes the Loadout (state/loadout-store). Display resolution
 * (resolveDisplay) re-validates the persisted loadout against CURRENT
 * state on every read, so a loadout equipped yesterday can never show a
 * form whose gates have since closed.
 */

// ---------------------------------------------------------------- skins

/** Palette-swap skins (classic alternate costumes): luminance duotones of
 *  every delivered art set, generated 2026-07-16. 'standard' = base art. */
export type SkinId = 'standard' | 'red' | 'green' | 'yellow' | 'orange' | 'white' | 'black';

export interface SkinItem {
  id: SkinId;
  name: string;
  /** Swatch colour for the item card (standard = null → shows the sprite). */
  swatch: string | null;
}

export const SKINS: SkinItem[] = [
  { id: 'standard', name: 'Standard Issue', swatch: null },
  { id: 'red', name: 'Crimson Ops', swatch: '#d63939' },
  { id: 'green', name: 'Jade Protocol', swatch: '#2f9e44' },
  { id: 'yellow', name: 'Volt Squad', swatch: '#e6b117' },
  { id: 'orange', name: 'Ember Unit', swatch: '#e8590c' },
  { id: 'white', name: 'Ghost Frame', swatch: '#b8bcc8' },
  { id: 'black', name: 'Void Ops', swatch: '#2b2b33' },
];

// ---------------------------------------------------------------- auras

export type AuraId = 'rarity' | 'cyan' | 'epic' | 'gold' | 'crimson' | 'emerald';

export type CosmeticUnlock =
  | { kind: 'free' }
  | { kind: 'forge'; level: number }
  | { kind: 'incoming'; source: string };

export interface AuraItem {
  id: AuraId;
  name: string;
  /** null = follow the player's rarity colour (the pre-customiser default). */
  colour: string | null;
  unlock: CosmeticUnlock;
}

/** Colour literals mirror theme/tokens (domain stays import-pure; the
 *  customise vitest pins these against tokens so they cannot drift). */
export const AURAS: AuraItem[] = [
  { id: 'rarity', name: 'Rarity Sync', colour: null, unlock: { kind: 'free' } },
  { id: 'cyan', name: 'Neon Surge', colour: '#22d3ee', unlock: { kind: 'free' } },
  { id: 'epic', name: 'Epic Bloom', colour: '#a855f7', unlock: { kind: 'forge', level: 5 } },
  { id: 'gold', name: 'Gilded Field', colour: '#fbbf24', unlock: { kind: 'forge', level: 10 } },
  { id: 'crimson', name: 'Blood Halo', colour: '#ef4444', unlock: { kind: 'forge', level: 15 } },
  { id: 'emerald', name: 'Verdant Pulse', colour: '#34d399', unlock: { kind: 'forge', level: 20 } },
];

// ---------------------------------------------------------------- emotes

/** Emotes ARE the real companion animations. The equipped emote drives the
 *  header companion everywhere (home-header reads the loadout). */
export type EmoteId = 'idle' | 'run' | 'punch' | 'victory';

export interface EmoteItem {
  id: EmoteId;
  name: string;
  unlock: CosmeticUnlock;
}

export const EMOTES: EmoteItem[] = [
  { id: 'victory', name: 'Victory Flex', unlock: { kind: 'free' } },
  { id: 'idle', name: 'Battle Ready', unlock: { kind: 'free' } },
  { id: 'run', name: 'Roadwork', unlock: { kind: 'forge', level: 3 } },
  { id: 'punch', name: 'Lead Jab', unlock: { kind: 'forge', level: 5 } },
];

// ---------------------------------------------------------------- effects

export type EffectId = 'podium';

export interface EffectItem {
  id: EffectId | string;
  name: string;
  unlock: CosmeticUnlock;
}

/** One real platform today; future entries are HONESTLY marked incoming
 *  (art not yet delivered) — previewable never, equipable never. */
export const EFFECTS: EffectItem[] = [
  { id: 'podium', name: 'Forge Podium', unlock: { kind: 'free' } },
  { id: 'holo-rings', name: 'Holo Rings', unlock: { kind: 'incoming', source: 'Future update' } },
  { id: 'ember-vent', name: 'Ember Vent', unlock: { kind: 'incoming', source: 'Seasonal event' } },
];

export function cosmeticUnlocked(unlock: CosmeticUnlock, forgeLevel: number): boolean {
  if (unlock.kind === 'free') return true;
  if (unlock.kind === 'forge') return forgeLevel >= unlock.level;
  return false;
}

export function unlockLabel(unlock: CosmeticUnlock): string {
  if (unlock.kind === 'free') return '';
  if (unlock.kind === 'forge') return `FORGE LEVEL ${unlock.level}`;
  return unlock.source.toUpperCase();
}

// ---------------------------------------------------------------- roster

export interface RosterEntry {
  id: BranchV2;
  /** Display name without the emoji ("Mass Monster"). */
  name: string;
  /** The branch emoji — the card's archetype icon. */
  icon: string;
  unlocked: boolean;
  /** The class the athlete's real stats resolve to right now. */
  current: boolean;
  /** Live gate rows (empty when unlocked). */
  requirements: EvolutionRequirement[];
  note?: string;
}

/** Placeholder future slots — honest "coming soon", never unlockable. */
export const COMING_SOON_SLOTS = 4;

const ROSTER_ORDER: BranchV2[] = ['aesthetic', 'mass', 'hybrid', 'shredder', 'titan', 'cardio'];

function splitDisplayName(branch: BranchV2): { icon: string; name: string } {
  const display = branchDisplayNameV2(branch);
  const [icon, ...rest] = display.split(' ');
  return { icon, name: rest.join(' ') };
}

export function buildRoster(current: BranchV2, s: ScoresV2, ctx?: BranchContext): RosterEntry[] {
  const paths = branchPathsV2(current, s, ctx);
  return ROSTER_ORDER.map((branch) => {
    const { icon, name } = splitDisplayName(branch);
    if (branch === current) {
      return { id: branch, name, icon, unlocked: true, current: true, requirements: [] };
    }
    const path = paths.find((p) => p.branch === branch);
    // Branches without a switch path (e.g. aesthetic — the fall-through
    // class) are open to preview but locked to equip unless derived.
    const requirements = path?.requirements ?? [];
    const gatesMet =
      branch === 'shredder'
        ? isShredder(ctx)
        : requirements.length > 0 && requirements.every((r) => r.met);
    return {
      id: branch,
      name,
      icon,
      unlocked: gatesMet,
      current: false,
      requirements: gatesMet ? [] : requirements,
      note: path?.note,
    };
  });
}

export type RosterFilter = 'all' | 'owned' | 'locked';

export function filterRoster(
  entries: RosterEntry[],
  filter: RosterFilter,
  search: string
): RosterEntry[] {
  const q = search.trim().toLowerCase();
  return entries.filter((e) => {
    if (filter === 'owned' && !e.unlocked) return false;
    if (filter === 'locked' && e.unlocked) return false;
    if (q && !e.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

// ---------------------------------------------------------------- stages

export interface StageOption {
  /** Stable selection key persisted in the loadout ("L25", "S3"). */
  key: string;
  /** Which ART stage this row renders (1–4). */
  stage: number;
  name: string;
  unlocked: boolean;
  current: boolean;
  /** Human unlock requirement for locked rows. */
  requirement: string;
}

export function stageOptions(branch: BranchV2, level: number, bfMid: number | null): StageOption[] {
  if (branch === 'shredder') {
    return shredderRows(bfMid).map((row) => ({
      key: `S${row.stage}`,
      stage: row.stage,
      name: row.name,
      unlocked: row.unlocked,
      current: row.current,
      requirement: row.bfTarget === null ? '' : `UNDER ${row.bfTarget}% BODY FAT`,
    }));
  }
  return avatarStageRowsV2(branch, level).map((row) => ({
    key: `L${row.level}`,
    stage: row.stage,
    name: row.name,
    unlocked: row.unlocked,
    current: row.current,
    requirement: `REACH LEVEL ${row.level}`,
  }));
}

// ---------------------------------------------------------------- loadout

/** What EQUIP persists. null branch/stageKey = automatic (derived). */
export interface Loadout {
  branch: BranchV2 | null;
  stageKey: string | null;
  skinId: SkinId;
  auraId: AuraId;
  emoteId: EmoteId;
  effectId: string;
}

export const DEFAULT_LOADOUT: Loadout = {
  branch: null,
  stageKey: null,
  skinId: 'standard',
  auraId: 'rarity',
  emoteId: 'victory',
  effectId: 'podium',
};

/** The shape donor for stage math + silhouettes (mirrors avatar-art's
 *  private shapeDonor — pinned equal by the customise vitest). */
export function displayDonor(branch: BranchV2): Branch {
  if (branch === 'titan' || branch === 'mass') return 'mass';
  if (branch === 'cardio' || branch === 'hybrid') return 'hybrid';
  return 'aesthetic';
}

export function currentStageFor(branch: BranchV2, level: number, bfMid: number | null): number {
  return branch === 'shredder' ? shredderStage(bfMid) : getBranchStage(displayDonor(branch), level);
}

export interface DerivedIdentity {
  branch: BranchV2;
  level: number;
  bfMid: number | null;
  scores: ScoresV2;
  ctx?: BranchContext;
  forgeLevel: number;
}

export interface ResolvedDisplay {
  branch: BranchV2;
  donor: Branch;
  stage: number;
  formName: string;
  skinId: SkinId;
  /** null = keep the rarity colour (the pre-customiser behaviour). */
  auraColour: string | null;
  emoteId: EmoteId;
}

/**
 * Re-validate a persisted loadout against live state. Anything no longer
 * unlocked falls back to derived/current — silently and safely: gates
 * that closed since equip (a branch lost, a level ladder re-based) must
 * never keep rendering.
 */
export function resolveDisplay(derived: DerivedIdentity, loadout: Loadout): ResolvedDisplay {
  const roster = buildRoster(derived.branch, derived.scores, derived.ctx);

  let branch = derived.branch;
  if (loadout.branch !== null && loadout.branch !== derived.branch) {
    const entry = roster.find((e) => e.id === loadout.branch);
    if (entry?.unlocked) branch = loadout.branch;
  }

  let stage = currentStageFor(branch, derived.level, derived.bfMid);
  let formName =
    branch === 'shredder'
      ? shredderName(derived.bfMid)
      : evolutionNameV2(branch, derived.level);
  if (loadout.stageKey !== null && loadout.branch === branch) {
    const option = stageOptions(branch, derived.level, derived.bfMid).find(
      (o) => o.key === loadout.stageKey
    );
    if (option?.unlocked) {
      stage = option.stage;
      formName = option.name;
    }
  }

  const skin = SKINS.find((s) => s.id === loadout.skinId);
  const aura = AURAS.find((a) => a.id === loadout.auraId);
  const auraUnlocked = aura !== undefined && cosmeticUnlocked(aura.unlock, derived.forgeLevel);
  const emote = EMOTES.find((e) => e.id === loadout.emoteId);
  const emoteUnlocked = emote !== undefined && cosmeticUnlocked(emote.unlock, derived.forgeLevel);

  return {
    branch,
    donor: displayDonor(branch),
    stage,
    formName,
    skinId: skin ? skin.id : 'standard',
    auraColour: auraUnlocked ? (aura?.colour ?? null) : null,
    emoteId: emoteUnlocked && emote ? emote.id : 'victory',
  };
}

/** The screen's live selection (preview state — NOT persisted). */
export interface Selection {
  branch: BranchV2;
  stageKey: string | null;
  skinId: SkinId;
  auraId: AuraId;
  emoteId: EmoteId;
  effectId: string;
}

export function selectionFromLoadout(derivedBranch: BranchV2, loadout: Loadout): Selection {
  return {
    branch: loadout.branch ?? derivedBranch,
    stageKey: loadout.stageKey,
    skinId: loadout.skinId,
    auraId: loadout.auraId,
    emoteId: loadout.emoteId,
    effectId: loadout.effectId,
  };
}

export function loadoutFromSelection(derivedBranch: BranchV2, sel: Selection): Loadout {
  return {
    // Selecting your derived class stores null → follows future evolutions.
    branch: sel.branch === derivedBranch ? null : sel.branch,
    stageKey: sel.stageKey,
    skinId: sel.skinId,
    auraId: sel.auraId,
    emoteId: sel.emoteId,
    effectId: sel.effectId,
  };
}

export function sameLoadout(a: Loadout, b: Loadout): boolean {
  return (
    a.branch === b.branch &&
    a.stageKey === b.stageKey &&
    a.skinId === b.skinId &&
    a.auraId === b.auraId &&
    a.emoteId === b.emoteId &&
    a.effectId === b.effectId
  );
}

export type EquipState =
  | { kind: 'equip' }
  | { kind: 'equipped' }
  | { kind: 'locked-character' }
  | { kind: 'locked-stage'; requirement: string }
  | { kind: 'locked-cosmetic'; requirement: string };

/** Which state the primary button is in for the current selection. */
export function equipState(
  derived: DerivedIdentity,
  sel: Selection,
  equipped: Loadout
): EquipState {
  const roster = buildRoster(derived.branch, derived.scores, derived.ctx);
  const entry = roster.find((e) => e.id === sel.branch);
  if (!entry?.unlocked) return { kind: 'locked-character' };

  if (sel.stageKey !== null) {
    const option = stageOptions(sel.branch, derived.level, derived.bfMid).find(
      (o) => o.key === sel.stageKey
    );
    if (option && !option.unlocked) {
      return { kind: 'locked-stage', requirement: option.requirement };
    }
  }

  const aura = AURAS.find((a) => a.id === sel.auraId);
  if (aura && !cosmeticUnlocked(aura.unlock, derived.forgeLevel)) {
    return { kind: 'locked-cosmetic', requirement: unlockLabel(aura.unlock) };
  }
  const emote = EMOTES.find((e) => e.id === sel.emoteId);
  if (emote && !cosmeticUnlocked(emote.unlock, derived.forgeLevel)) {
    return { kind: 'locked-cosmetic', requirement: unlockLabel(emote.unlock) };
  }

  return sameLoadout(loadoutFromSelection(derived.branch, sel), equipped)
    ? { kind: 'equipped' }
    : { kind: 'equip' };
}
