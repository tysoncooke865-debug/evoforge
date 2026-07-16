import { describe, expect, it } from 'vitest';

import { getBranchStage } from '../avatar-stats';
import type { ScoresV2 } from '../branches-v2';
import { avatarStageRowsV2, massArtStage } from '../branches-v2';
import {
  AURAS,
  DEFAULT_LOADOUT,
  EFFECTS,
  EMOTES,
  SKINS,
  buildRoster,
  cosmeticUnlocked,
  currentStageFor,
  displayDonor,
  equipState,
  filterRoster,
  loadoutFromSelection,
  resolveDisplay,
  sameLoadout,
  selectionFromLoadout,
  stageOptions,
  unlockLabel,
  type DerivedIdentity,
  type Selection,
} from '../customise';

const scores = (over: Partial<ScoresV2> = {}): ScoresV2 => ({
  strength: 40,
  size: 40,
  leanness: 40,
  conditioning: 40,
  aesthetic: 60,
  ...over,
});

const derived = (over: Partial<DerivedIdentity> = {}): DerivedIdentity => ({
  branch: 'aesthetic',
  level: 40,
  bfMid: 15,
  scores: scores(),
  ctx: { nutritionPhase: 'bulking', earliestBf: 18 },
  forgeLevel: 8,
  ...over,
});

describe('roster — locks are the LIVE branch gates', () => {
  it('the derived branch is always unlocked and current', () => {
    const roster = buildRoster('aesthetic', scores(), { nutritionPhase: null, earliestBf: null });
    const aes = roster.find((e) => e.id === 'aesthetic');
    expect(aes?.unlocked).toBe(true);
    expect(aes?.current).toBe(true);
    expect(aes?.requirements).toEqual([]);
  });

  it('mass unlocks exactly when its gates are met', () => {
    const locked = buildRoster('aesthetic', scores(), undefined).find((e) => e.id === 'mass');
    expect(locked?.unlocked).toBe(false);
    expect(locked?.requirements.length).toBeGreaterThan(0);

    const open = buildRoster('aesthetic', scores({ strength: 60, size: 70, aesthetic: 50 }), undefined).find(
      (e) => e.id === 'mass'
    );
    expect(open?.unlocked).toBe(true);
    expect(open?.requirements).toEqual([]);
  });

  it('shredder unlocks only via the real entry rule (cutting + earliest bf ≥ 25)', () => {
    const no = buildRoster('aesthetic', scores(), { nutritionPhase: 'bulking', earliestBf: 30 });
    expect(no.find((e) => e.id === 'shredder')?.unlocked).toBe(false);
    const yes = buildRoster('aesthetic', scores(), { nutritionPhase: 'cutting', earliestBf: 30 });
    expect(yes.find((e) => e.id === 'shredder')?.unlocked).toBe(true);
  });

  it('names carry no emoji; the icon carries it', () => {
    for (const entry of buildRoster('aesthetic', scores(), undefined)) {
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.icon.length).toBeGreaterThan(0);
      expect(entry.name).not.toContain(entry.icon);
    }
  });

  it('filters + search compose', () => {
    const roster = buildRoster('aesthetic', scores(), undefined);
    expect(filterRoster(roster, 'owned', '').every((e) => e.unlocked)).toBe(true);
    expect(filterRoster(roster, 'locked', '').every((e) => !e.unlocked)).toBe(true);
    expect(filterRoster(roster, 'all', 'mass').map((e) => e.id)).toEqual(['mass']);
    expect(filterRoster(roster, 'all', 'zzz')).toEqual([]);
  });
});

describe('stage options mirror the real ladders', () => {
  it('level ladders key by unlock level and gate by the live level', () => {
    const options = stageOptions('aesthetic', 40, null);
    expect(options.length).toBeGreaterThanOrEqual(4);
    const locked = options.filter((o) => !o.unlocked);
    expect(locked.length).toBeGreaterThan(0);
    for (const o of locked) expect(o.requirement).toMatch(/^REACH LEVEL \d+$/);
    expect(options.find((o) => o.current)).toBeTruthy();
  });

  it('shredder stages gate by body fat, not level', () => {
    const options = stageOptions('shredder', 99, 20);
    expect(options).toHaveLength(4);
    expect(options[1].unlocked).toBe(true); // bf 20 < 25
    expect(options[3].unlocked).toBe(false); // bf 20 > 12
    expect(options[3].requirement).toBe('UNDER 12% BODY FAT');
  });
});

describe('resolveDisplay — the persisted loadout is re-validated on read', () => {
  it('default loadout = the derived identity untouched', () => {
    const d = derived();
    const display = resolveDisplay(d, DEFAULT_LOADOUT);
    expect(display.branch).toBe('aesthetic');
    expect(display.stage).toBe(currentStageFor('aesthetic', d.level, d.bfMid));
    expect(display.auraColour).toBeNull();
    expect(display.emoteId).toBe('victory');
  });

  it('an equipped branch whose gates are OPEN displays', () => {
    const d = derived({ scores: scores({ strength: 60, size: 70, aesthetic: 50 }) });
    const display = resolveDisplay(d, { ...DEFAULT_LOADOUT, branch: 'mass' });
    expect(display.branch).toBe('mass');
    expect(display.donor).toBe('mass');
  });

  it('an equipped branch whose gates CLOSED falls back to derived', () => {
    const display = resolveDisplay(derived(), { ...DEFAULT_LOADOUT, branch: 'mass' });
    expect(display.branch).toBe('aesthetic');
  });

  it('an equipped LOCKED stage falls back to the current stage', () => {
    const d = derived({ level: 30 });
    const lockedKey = stageOptions('aesthetic', 30, null).find((o) => !o.unlocked)!.key;
    const display = resolveDisplay(d, { ...DEFAULT_LOADOUT, branch: 'aesthetic', stageKey: lockedKey });
    expect(display.stage).toBe(getBranchStage('aesthetic', 30));
  });

  it('an unlocked stage pick displays THAT form (art stage + name)', () => {
    const d = derived({ level: 60 });
    const owned = stageOptions('aesthetic', 60, null).filter((o) => o.unlocked);
    const early = owned[0];
    const display = resolveDisplay(d, { ...DEFAULT_LOADOUT, branch: 'aesthetic', stageKey: early.key });
    expect(display.stage).toBe(early.stage);
    expect(display.formName).toBe(early.name);
  });

  it('a locked aura/emote falls back; an unlocked one applies', () => {
    const low = resolveDisplay(derived({ forgeLevel: 0 }), { ...DEFAULT_LOADOUT, auraId: 'crimson', emoteId: 'punch' });
    expect(low.auraColour).toBeNull();
    expect(low.emoteId).toBe('victory');
    const high = resolveDisplay(derived({ forgeLevel: 20 }), { ...DEFAULT_LOADOUT, auraId: 'crimson', emoteId: 'punch' });
    expect(high.auraColour).toBe('#ef4444');
    expect(high.emoteId).toBe('punch');
  });

  it("TYSON'S CASE: Epic Bloom unlocks at EPIC TIER, whatever the forge level", () => {
    // Forge Level 3, legacy level 57 (epic tier) — the exact live report.
    const d = derived({ forgeLevel: 3, level: 57 });
    const display = resolveDisplay(d, { ...DEFAULT_LOADOUT, auraId: 'epic' });
    expect(display.auraColour).toBe('#a855f7');
    // Below the tier it stays locked no matter the forge level.
    const low = resolveDisplay(derived({ forgeLevel: 99, level: 30 }), { ...DEFAULT_LOADOUT, auraId: 'epic' });
    expect(low.auraColour).toBeNull();
  });
});

describe('equip state machine', () => {
  const sel = (over: Partial<Selection> = {}): Selection => ({
    branch: 'aesthetic',
    stageKey: null,
    skinId: 'standard',
    auraId: 'rarity',
    emoteId: 'victory',
    effectId: 'podium',
    ...over,
  });

  it('the default selection over the default loadout reads EQUIPPED', () => {
    expect(equipState(derived(), sel(), DEFAULT_LOADOUT).kind).toBe('equipped');
  });

  it('changing anything reads EQUIP; equipping round-trips to EQUIPPED', () => {
    const d = derived();
    const s = sel({ skinId: 'red' });
    expect(equipState(d, s, DEFAULT_LOADOUT).kind).toBe('equip');
    const saved = loadoutFromSelection(d.branch, s);
    expect(equipState(d, s, saved).kind).toBe('equipped');
    expect(sameLoadout(saved, DEFAULT_LOADOUT)).toBe(false);
  });

  it('a locked character reads locked-character', () => {
    expect(equipState(derived(), sel({ branch: 'titan' }), DEFAULT_LOADOUT).kind).toBe('locked-character');
  });

  it('a locked stage surfaces its real requirement', () => {
    const d = derived({ level: 30 });
    const locked = stageOptions('aesthetic', 30, null).find((o) => !o.unlocked)!;
    const state = equipState(d, sel({ stageKey: locked.key }), DEFAULT_LOADOUT);
    expect(state).toEqual({ kind: 'locked-stage', requirement: locked.requirement });
  });

  it('a locked cosmetic surfaces its unlock label', () => {
    const forge = equipState(derived({ forgeLevel: 0 }), sel({ auraId: 'crimson' }), DEFAULT_LOADOUT);
    expect(forge).toEqual({ kind: 'locked-cosmetic', requirement: 'FORGE LEVEL 5' });
    // Tier-gated: gold needs LEGENDARY (level 40 = rare tier).
    const tier = equipState(derived({ forgeLevel: 99 }), sel({ auraId: 'gold' }), DEFAULT_LOADOUT);
    expect(tier).toEqual({ kind: 'locked-cosmetic', requirement: 'REACH LEGENDARY TIER' });
  });

  it('selecting the derived branch stores null (follows future evolutions)', () => {
    expect(loadoutFromSelection('aesthetic', sel()).branch).toBeNull();
    expect(loadoutFromSelection('mass', sel()).branch).toBe('aesthetic');
    expect(selectionFromLoadout('aesthetic', DEFAULT_LOADOUT).branch).toBe('aesthetic');
  });
});

describe('catalogs', () => {
  it('every skin id is unique and standard comes first', () => {
    expect(SKINS[0].id).toBe('standard');
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(SKINS.length);
    expect(SKINS.map((s) => s.id)).toEqual(
      expect.arrayContaining(['red', 'green', 'yellow', 'orange', 'white', 'black'])
    );
  });

  it('free/forge/tier/incoming gates all bind correctly', () => {
    const ctx = (forgeLevel: number, legacyLevel = 0) => ({ forgeLevel, legacyLevel });
    expect(cosmeticUnlocked({ kind: 'free' }, ctx(0))).toBe(true);
    expect(cosmeticUnlocked({ kind: 'forge', level: 5 }, ctx(4))).toBe(false);
    expect(cosmeticUnlocked({ kind: 'forge', level: 5 }, ctx(5))).toBe(true);
    expect(cosmeticUnlocked({ kind: 'tier', slug: 'epic' }, ctx(0, 49))).toBe(false);
    expect(cosmeticUnlocked({ kind: 'tier', slug: 'epic' }, ctx(0, 50))).toBe(true);
    expect(cosmeticUnlocked({ kind: 'tier', slug: 'epic' }, ctx(0, 100))).toBe(true);
    expect(cosmeticUnlocked({ kind: 'incoming', source: 'x' }, ctx(999, 100))).toBe(false);
    expect(unlockLabel({ kind: 'forge', level: 5 })).toBe('FORGE LEVEL 5');
    expect(unlockLabel({ kind: 'tier', slug: 'legendary' })).toBe('REACH LEGENDARY TIER');
  });

  it('the mass line spreads FOUR art stages (stage 4 exists, none repeat early)', () => {
    // Tyson: "mass monster is missing its stage 4, and stages 1 and 2 are
    // the same" — the ladder must hit a NEW body at 25/50/75.
    expect([1, 24, 25, 50, 75, 100].map((l) => massArtStage(l))).toEqual([1, 1, 2, 3, 4, 4]);
    const rowStages = avatarStageRowsV2('mass', 100).map((r) => r.stage);
    expect(rowStages).toEqual([1, 2, 3, 4, 4]);
    const titanStages = avatarStageRowsV2('titan', 100).map((r) => r.stage);
    expect(titanStages).toEqual([1, 2, 3, 4, 4]);
    expect(currentStageFor('mass', 80, null)).toBe(4);
    expect(currentStageFor('titan', 55, null)).toBe(3);
    // Cardio keeps the 3-stage hybrid painted scheme.
    expect(Math.max(...avatarStageRowsV2('cardio', 100).map((r) => r.stage))).toBe(3);
  });

  it('emote ids ARE companion anims (the header depends on it)', () => {
    for (const emote of EMOTES) {
      expect(['idle', 'run', 'punch', 'victory']).toContain(emote.id);
    }
  });

  it('the aura + effect catalogs have a free default', () => {
    expect(AURAS[0]).toMatchObject({ id: 'rarity', colour: null, unlock: { kind: 'free' } });
    expect(EFFECTS[0]).toMatchObject({ id: 'podium', unlock: { kind: 'free' } });
  });

  it('displayDonor mirrors avatar-art shapeDonor', () => {
    expect(displayDonor('titan')).toBe('mass');
    expect(displayDonor('mass')).toBe('mass');
    expect(displayDonor('cardio')).toBe('hybrid');
    expect(displayDonor('hybrid')).toBe('hybrid');
    expect(displayDonor('aesthetic')).toBe('aesthetic');
    expect(displayDonor('shredder')).toBe('aesthetic');
  });
});
