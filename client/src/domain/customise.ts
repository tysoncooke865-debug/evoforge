import type { Branch } from './avatar-stats';
import { getBranchStage, raritySlug } from './avatar-stats';
import type { BranchContext, BranchV2, ScoresV2 } from './branches-v2';
import {
  avatarStageRowsV2,
  branchDisplayNameV2,
  branchPathsV2,
  evolutionNameV2,
  isShredder,
  massArtStage,
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

// -------------------------------------------------- premium characters

/**
 * A PREMIUM CHARACTER (Tyson, 2026-07-16) — bought once with forge coins
 * and equipped as an avatar OVERLAY on top of any training class (the
 * player's real branch/stats are untouched). One purchase unlocks all its
 * stages and looks. Captain Gymerica is the first.
 */
export type SpecialCharacterId = 'gymerica';
export type GymericaSkin = 'standard' | 'usa';

export interface PremiumCharacter {
  id: SpecialCharacterId;
  name: string;
  icon: string;
  price: number;
  /** Stage names, index 0 = stage 1. */
  stageNames: string[];
  /** Selectable looks (all unlocked with the character). */
  looks: { id: GymericaSkin; name: string; swatch: string }[];
}

export const GYMERICA: PremiumCharacter = {
  id: 'gymerica',
  name: 'Captain Gymerica',
  icon: '🛡️', // shield
  price: 10000,
  stageNames: ['Captain Gymerica', 'Gymerica, Shielded'],
  looks: [
    { id: 'standard', name: 'Forge Standard', swatch: '#22d3ee' },
    { id: 'usa', name: 'United States of Aesthetics', swatch: '#c8102e' },
  ],
};

export const PREMIUM_CHARACTERS: PremiumCharacter[] = [GYMERICA];

/** Stage rows for a premium character — all unlocked once owned. */
export function characterStageOptions(char: PremiumCharacter, owned: boolean): StageOption[] {
  return char.stageNames.map((name, i) => ({
    key: `C${i + 1}`,
    stage: i + 1,
    name,
    unlocked: owned,
    current: owned && i === 0,
    requirement: owned ? '' : 'UNLOCK THIS CHARACTER FIRST',
  }));
}

// ---------------------------------------------------------------- skins

/** Palette-swap skins (classic alternate costumes): luminance duotones of
 *  every delivered art set, generated 2026-07-16. 'standard' = base art. */
export type SkinId = 'standard' | 'red' | 'green' | 'yellow' | 'orange' | 'white' | 'black' | 'adam';

export interface SkinItem {
  id: SkinId;
  name: string;
  /** Swatch colour for the item card (standard = null → shows the sprite). */
  swatch: string | null;
  unlock: CosmeticUnlock;
}

/** The colours are BOUGHT with forge coins, per line (Tyson, 2026-07-16:
 *  "locked by forge coins, price ascending, cheaper on aesthetics"). Prices
 *  are the server's (migration 030 skin_price) — this is the display twin,
 *  pinned equal by the customise vitest. 'standard' is free, 'adam' is the
 *  level-100 reward; neither is for sale. */
export const SKINS: SkinItem[] = [
  { id: 'standard', name: 'Standard Issue', swatch: null, unlock: { kind: 'free' } },
  { id: 'red', name: 'Crimson Ops', swatch: '#d63939', unlock: { kind: 'coins' } },
  { id: 'green', name: 'Jade Protocol', swatch: '#2f9e44', unlock: { kind: 'coins' } },
  { id: 'yellow', name: 'Volt Squad', swatch: '#e6b117', unlock: { kind: 'coins' } },
  { id: 'orange', name: 'Ember Unit', swatch: '#e8590c', unlock: { kind: 'coins' } },
  { id: 'white', name: 'Ghost Frame', swatch: '#b8bcc8', unlock: { kind: 'coins' } },
  { id: 'black', name: 'Void Ops', swatch: '#2b2b33', unlock: { kind: 'coins' } },
  { id: 'adam', name: 'True Adam', swatch: '#f5cf6a', unlock: { kind: 'tier', slug: 'mythic' } },
];

/** The lines with their own art — colours are owned PER LINE. */
export type SkinLine = 'aesthetic' | 'mass' | 'titan' | 'cardio' | 'shredder';

export function skinLineFor(branch: BranchV2): SkinLine {
  if (branch === 'mass' || branch === 'titan' || branch === 'cardio' || branch === 'shredder') {
    return branch;
  }
  return 'aesthetic'; // aesthetic (+ any donor-only branch) shares the aesthetic set
}

/** Server-mirrored prices. Aesthetic is the cheap line; every other line
 *  costs double. Ascending within a line. Pinned against skin_price(). */
const SKIN_PRICES: Record<'aesthetic' | 'other', Partial<Record<SkinId, number>>> = {
  aesthetic: { red: 50, green: 75, yellow: 100, orange: 150, white: 200, black: 250 },
  other: { red: 100, green: 150, yellow: 200, orange: 300, white: 400, black: 500 },
};

/** Coin price for a colour on a line, or null if it is not purchasable. */
export function skinPrice(line: SkinLine, skin: SkinId): number | null {
  const table = line === 'aesthetic' ? SKIN_PRICES.aesthetic : SKIN_PRICES.other;
  return table[skin] ?? null;
}

export function skinKey(line: SkinLine, skin: SkinId): string {
  return `${line}:${skin}`;
}

/**
 * Is a skin unlocked for a line? Free always; tier via the rarity tier
 * (Adam); coin skins iff the owned set carries this line's key. Ownership
 * is SERVER truth (user_skin_unlocks) — the client only reflects it.
 */
export function skinUnlocked(
  skin: SkinItem,
  line: SkinLine,
  ctx: { legacyLevel: number; ownedSkins: ReadonlySet<string> }
): boolean {
  if (skin.unlock.kind === 'free') return true;
  if (skin.unlock.kind === 'tier') {
    return TIER_ORDER.indexOf(raritySlug(ctx.legacyLevel) as (typeof TIER_ORDER)[number]) >= TIER_ORDER.indexOf(skin.unlock.slug);
  }
  if (skin.unlock.kind === 'coins') return ctx.ownedSkins.has(skinKey(line, skin.id));
  return false;
}

// ------------------------------------------------- palettes (app themes)

/** The purchasable whole-app colour palettes (migration 044). Colours live
 *  in theme/palettes.ts (PALETTE_COLOURS); the vitest pins the two id sets
 *  equal both ways so domain stays free of UI imports. */
export const PALETTE_IDS = ['emerald', 'crimson', 'synthwave', 'solar', 'arctic', 'void'] as const;

export type PurchasablePalette = (typeof PALETTE_IDS)[number];

/** 'standard' is the free default — never priced, never a DB row. */
export type PaletteId = PurchasablePalette | 'standard';

/** Server-mirrored prices (palette_price(), migration 044). Ascending; a
 *  whole-app reskin outranks a single sprite skin, sits under Gymerica. */
const PALETTE_PRICES: Record<PurchasablePalette, number> = {
  emerald: 500,
  crimson: 750,
  synthwave: 1000,
  solar: 1250,
  arctic: 1500,
  void: 2000,
};

/** Coin price for a palette, or null when it is not purchasable. */
export function palettePrice(id: string): number | null {
  return (PALETTE_PRICES as Record<string, number>)[id] ?? null;
}

export function isPaletteId(id: string | null | undefined): id is PaletteId {
  return id === 'standard' || (PALETTE_IDS as readonly string[]).includes(id ?? '');
}

/**
 * THE ONE DISPLAY VALIDATOR for the active palette — the resolveDisplay
 * doctrine applied to app chrome: re-validate on every read, fall back
 * silently.
 *
 * - `preview` (the CUSTOMISE screen cycling store cards) wins and does NOT
 *   require ownership — that is the try-before-you-buy feature. Anything
 *   invalid resolves standard.
 * - the equipped palette renders only while the server says it is owned;
 *   an unowned/unknown/retired id falls back to standard, never throws.
 */
export function resolveActivePalette(
  preview: string | null,
  equipped: string | null | undefined,
  ownedPalettes: ReadonlySet<string>
): PaletteId {
  if (preview !== null && isPaletteId(preview)) return preview;
  if (equipped != null && isPaletteId(equipped)) {
    if (equipped === 'standard' || ownedPalettes.has(equipped)) return equipped;
  }
  return 'standard';
}

// ---------------------------------------------------------------- auras

export type AuraId = 'rarity' | 'cyan' | 'epic' | 'gold' | 'crimson' | 'emerald';

export type CosmeticUnlock =
  | { kind: 'free' }
  | { kind: 'forge'; level: number }
  /** Unlocked by REACHING a rarity tier (the display tier the whole app
   *  shows). Tyson, 2026-07-16: "epic bloom is blocked despite me having
   *  it unlocked" — an EPIC-tier athlete owns the epic aura; a tier-named
   *  cosmetic must gate on the tier, not an unrelated forge level. */
  | { kind: 'tier'; slug: 'rare' | 'epic' | 'legendary' | 'mythic' }
  /** Bought with forge coins (per-line price; see skinPrice). The shop UI
   *  owns the price + BUY affordance; cosmeticUnlocked treats it as locked
   *  because ownership is server data, not a computed gate. */
  | { kind: 'coins' }
  | { kind: 'incoming'; source: string };

/** What unlock evaluation needs: the earned Forge Level AND the legacy
 *  display level (rarity tiers still key off it, like avatar stages). */
export interface UnlockContext {
  forgeLevel: number;
  legacyLevel: number;
  /** Owned coin-skin keys ("line:skin"). Empty when unknown/loading. */
  ownedSkins: ReadonlySet<string>;
  /** Owned palette ids. Empty when unknown/loading. */
  ownedPalettes: ReadonlySet<string>;
}

const TIER_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythic'] as const;

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
  { id: 'epic', name: 'Epic Bloom', colour: '#a855f7', unlock: { kind: 'tier', slug: 'epic' } },
  { id: 'gold', name: 'Gilded Field', colour: '#fbbf24', unlock: { kind: 'tier', slug: 'legendary' } },
  { id: 'crimson', name: 'Blood Halo', colour: '#ef4444', unlock: { kind: 'forge', level: 5 } },
  { id: 'emerald', name: 'Verdant Pulse', colour: '#34d399', unlock: { kind: 'forge', level: 10 } },
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

export function cosmeticUnlocked(unlock: CosmeticUnlock, ctx: UnlockContext): boolean {
  if (unlock.kind === 'free') return true;
  if (unlock.kind === 'forge') return ctx.forgeLevel >= unlock.level;
  if (unlock.kind === 'tier') {
    const reached = TIER_ORDER.indexOf(raritySlug(ctx.legacyLevel) as (typeof TIER_ORDER)[number]);
    return reached >= TIER_ORDER.indexOf(unlock.slug);
  }
  return false; // 'coins' skins resolve via skinUnlocked, 'incoming' never
}

export function unlockLabel(unlock: CosmeticUnlock): string {
  if (unlock.kind === 'free') return '';
  if (unlock.kind === 'forge') return `FORGE LEVEL ${unlock.level}`;
  if (unlock.kind === 'tier') {
    // Mythic is level 100 exactly — say it the way the athlete reads it.
    return unlock.slug === 'mythic' ? 'REACH LEVEL 100 — TRUE ADAM' : `REACH ${unlock.slug.toUpperCase()} TIER`;
  }
  if (unlock.kind === 'coins') return 'BUY WITH FORGE COINS';
  return unlock.source.toUpperCase();
}

export function unlockContext(
  derived: DerivedIdentity,
  ownedSkins: ReadonlySet<string> = new Set(),
  ownedPalettes: ReadonlySet<string> = new Set()
): UnlockContext {
  return { forgeLevel: derived.forgeLevel, legacyLevel: derived.level, ownedSkins, ownedPalettes };
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

// Hybrid removed from the game (Tyson, 2026-07-16) — five classes.
const ROSTER_ORDER: BranchV2[] = ['aesthetic', 'mass', 'shredder', 'titan', 'cardio'];

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

/**
 * A champion's stage ladder. `characterUnlocked` gates the whole ladder
 * (Tyson, 2026-07-16: "stages of other characters show as unlocked
 * despite not completing the skill tree") — your level lights a stage
 * only on champions whose gates you have actually met; a locked
 * champion's stages all read locked, previews only.
 */
export function stageOptions(
  branch: BranchV2,
  level: number,
  bfMid: number | null,
  characterUnlocked = true
): StageOption[] {
  const lockRow = (o: StageOption): StageOption =>
    characterUnlocked
      ? o
      : { ...o, unlocked: false, current: false, requirement: 'UNLOCK THIS CHAMPION FIRST' };
  if (branch === 'shredder') {
    return shredderRows(bfMid).map((row) =>
      lockRow({
        key: `S${row.stage}`,
        stage: row.stage,
        name: row.name,
        unlocked: row.unlocked,
        current: row.current,
        requirement: row.bfTarget === null ? '' : `UNDER ${row.bfTarget}% BODY FAT`,
      })
    );
  }
  return avatarStageRowsV2(branch, level).map((row) =>
    lockRow({
      key: `L${row.level}`,
      stage: row.stage,
      name: row.name,
      unlocked: row.unlocked,
      current: row.current,
      requirement: `REACH LEVEL ${row.level}`,
    })
  );
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
  /** A premium character equipped as an OVERLAY (null = the branch
   *  champion). When set + owned it takes precedence over branch art. */
  character: SpecialCharacterId | null;
  /** Which stage of the premium character (1-based). */
  characterStage: number;
  /** Which look of the premium character. */
  characterSkin: GymericaSkin;
  /** The whole-app colour palette (the palette shop). 'standard' = default. */
  paletteId: PaletteId;
}

export const DEFAULT_LOADOUT: Loadout = {
  branch: null,
  stageKey: null,
  skinId: 'standard',
  auraId: 'rarity',
  emoteId: 'victory',
  effectId: 'podium',
  character: null,
  characterStage: 1,
  characterSkin: 'standard',
  paletteId: 'standard',
};

/** The shape donor for stage math + silhouettes (mirrors avatar-art's
 *  private shapeDonor — pinned equal by the customise vitest). */
export function displayDonor(branch: BranchV2): Branch {
  if (branch === 'titan' || branch === 'mass') return 'mass';
  if (branch === 'cardio' || branch === 'hybrid') return 'hybrid';
  return 'aesthetic';
}

export function currentStageFor(branch: BranchV2, level: number, bfMid: number | null): number {
  if (branch === 'shredder') return shredderStage(bfMid);
  const donor = displayDonor(branch);
  // Mass-donor lines AND cardio carry FOUR sprite stages; the pinned core
  // mapping stops at the three painted ones (see massArtStage).
  if (donor === 'mass' || branch === 'cardio') return massArtStage(level);
  return getBranchStage(donor, level);
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
  /** When set, an equipped premium character overrides the branch art. */
  character: { id: SpecialCharacterId; stage: number; look: GymericaSkin } | null;
}

/**
 * Re-validate a persisted loadout against live state. Anything no longer
 * unlocked falls back to derived/current — silently and safely: gates
 * that closed since equip (a branch lost, a level ladder re-based) must
 * never keep rendering.
 */
export function resolveDisplay(
  derived: DerivedIdentity,
  loadout: Loadout,
  ownedSkins: ReadonlySet<string> = new Set(),
  ownedCharacters: ReadonlySet<string> = new Set()
): ResolvedDisplay {
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
  // The stage pick applies to the loadout's TARGET champion — and null
  // branch MEANS the derived one (Tyson, 2026-07-16: "equipping the skin
  // isn't working when trying to equip a lower level avatar" — comparing
  // null against the resolved branch dropped every own-champion stage
  // pick on the floor).
  if (loadout.stageKey !== null && (loadout.branch ?? derived.branch) === branch) {
    // branch here is already gate-validated (or derived), so the ladder
    // evaluates as an UNLOCKED champion's.
    const option = stageOptions(branch, derived.level, derived.bfMid, true).find(
      (o) => o.key === loadout.stageKey
    );
    if (option?.unlocked) {
      stage = option.stage;
      formName = option.name;
    }
  }

  const ctx = unlockContext(derived, ownedSkins);
  const skinItem = SKINS.find((s) => s.id === loadout.skinId);
  const skin = skinItem && skinUnlocked(skinItem, skinLineFor(branch), ctx) ? skinItem : undefined;
  const aura = AURAS.find((a) => a.id === loadout.auraId);
  const auraUnlocked = aura !== undefined && cosmeticUnlocked(aura.unlock, ctx);
  const emote = EMOTES.find((e) => e.id === loadout.emoteId);
  const emoteUnlocked = emote !== undefined && cosmeticUnlocked(emote.unlock, ctx);

  // Premium character OVERLAY: if one is equipped AND owned, it takes over
  // the rendered avatar (name + art) while the branch identity underneath
  // is untouched. Aura/emote still apply.
  let character: ResolvedDisplay['character'] = null;
  let overlayName = formName;
  if (loadout.character != null && ownedCharacters.has(loadout.character)) {
    const c = PREMIUM_CHARACTERS.find((x) => x.id === loadout.character);
    if (c) {
      const cStage = Math.max(1, Math.min(c.stageNames.length, Math.trunc(loadout.characterStage ?? 1)));
      character = { id: c.id, stage: cStage, look: loadout.characterSkin ?? 'standard' };
      overlayName = c.stageNames[cStage - 1];
    }
  }

  return {
    branch,
    donor: displayDonor(branch),
    stage,
    formName: overlayName,
    skinId: skin ? skin.id : 'standard',
    auraColour: auraUnlocked ? (aura?.colour ?? null) : null,
    emoteId: emoteUnlocked && emote ? emote.id : 'victory',
    character,
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
  /** A premium character overlay in the live selection (null = branch). */
  character: SpecialCharacterId | null;
  characterStage: number;
  characterSkin: GymericaSkin;
  /** The whole-app palette in the live selection (previews immediately). */
  paletteId: PaletteId;
}

export function selectionFromLoadout(derivedBranch: BranchV2, loadout: Loadout): Selection {
  return {
    branch: loadout.branch ?? derivedBranch,
    stageKey: loadout.stageKey,
    skinId: loadout.skinId ?? 'standard',
    auraId: loadout.auraId ?? 'rarity',
    emoteId: loadout.emoteId ?? 'victory',
    effectId: loadout.effectId ?? 'podium',
    // Default the overlay fields (Tyson, 2026-07-16: a loadout persisted
    // before these existed rehydrates them as undefined — undefined is
    // truthy-different-from-null and crashed Gymerica mode).
    character: loadout.character ?? null,
    characterStage: loadout.characterStage ?? 1,
    characterSkin: loadout.characterSkin ?? 'standard',
    paletteId: loadout.paletteId ?? 'standard',
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
    character: sel.character,
    characterStage: sel.characterStage,
    characterSkin: sel.characterSkin,
    paletteId: sel.paletteId,
  };
}

export function sameLoadout(a: Loadout, b: Loadout): boolean {
  return (
    a.branch === b.branch &&
    a.stageKey === b.stageKey &&
    a.skinId === b.skinId &&
    a.auraId === b.auraId &&
    a.emoteId === b.emoteId &&
    a.effectId === b.effectId &&
    a.character === b.character &&
    a.characterStage === b.characterStage &&
    a.characterSkin === b.characterSkin &&
    (a.paletteId ?? 'standard') === (b.paletteId ?? 'standard')
  );
}

export type EquipState =
  | { kind: 'equip' }
  | { kind: 'equipped' }
  | { kind: 'locked-character' }
  | { kind: 'locked-stage'; requirement: string }
  | { kind: 'locked-cosmetic'; requirement: string }
  /** The selected colour is an unbought coin skin — the primary button
   *  becomes BUY (or NEED … when the wallet is short). line+skin+price
   *  drive the purchase call. */
  | { kind: 'buy-skin'; line: SkinLine; skin: SkinId; price: number }
  /** The selected premium character is not owned — BUY it (10000). */
  | { kind: 'buy-character'; character: SpecialCharacterId; price: number }
  /** The selected whole-app palette is unbought — BUY it. */
  | { kind: 'buy-palette'; palette: PurchasablePalette; price: number };

/** Which state the primary button is in for the current selection. */
export function equipState(
  derived: DerivedIdentity,
  sel: Selection,
  equipped: Loadout,
  ownedSkins: ReadonlySet<string> = new Set(),
  ownedCharacters: ReadonlySet<string> = new Set(),
  ownedPalettes: ReadonlySet<string> = new Set()
): EquipState {
  // A premium character overlay is its own decision path — it does not
  // depend on the branch gates (it sits ON TOP of any class).
  if (sel.character != null) {
    const c = PREMIUM_CHARACTERS.find((x) => x.id === sel.character);
    if (c && !ownedCharacters.has(c.id)) {
      return { kind: 'buy-character', character: c.id, price: c.price };
    }
    return sameLoadout(loadoutFromSelection(derived.branch, sel), equipped)
      ? { kind: 'equipped' }
      : { kind: 'equip' };
  }

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

  const ctx = unlockContext(derived, ownedSkins);
  const skin = SKINS.find((s) => s.id === sel.skinId);
  const line = skinLineFor(sel.branch);
  if (skin && !skinUnlocked(skin, line, ctx)) {
    // A coin skin becomes a BUY action; a tier skin (Adam) stays a
    // requirement the athlete earns, not buys.
    const price = skin.unlock.kind === 'coins' ? skinPrice(line, skin.id) : null;
    if (price !== null) return { kind: 'buy-skin', line, skin: skin.id, price };
    return { kind: 'locked-cosmetic', requirement: unlockLabel(skin.unlock) };
  }
  const aura = AURAS.find((a) => a.id === sel.auraId);
  if (aura && !cosmeticUnlocked(aura.unlock, ctx)) {
    return { kind: 'locked-cosmetic', requirement: unlockLabel(aura.unlock) };
  }
  const emote = EMOTES.find((e) => e.id === sel.emoteId);
  if (emote && !cosmeticUnlocked(emote.unlock, ctx)) {
    return { kind: 'locked-cosmetic', requirement: unlockLabel(emote.unlock) };
  }

  // A whole-app palette: previewing is free, equipping needs ownership —
  // an unbought selection turns the primary button into BUY.
  if (sel.paletteId !== 'standard' && !ownedPalettes.has(sel.paletteId)) {
    const price = palettePrice(sel.paletteId);
    if (price !== null) return { kind: 'buy-palette', palette: sel.paletteId, price };
    return { kind: 'locked-cosmetic', requirement: 'BUY WITH FORGE COINS' };
  }

  return sameLoadout(loadoutFromSelection(derived.branch, sel), equipped)
    ? { kind: 'equipped' }
    : { kind: 'equip' };
}
