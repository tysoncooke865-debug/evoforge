import { describe, expect, it } from 'vitest';

import { getBranchStage } from '../avatar-stats';
import type { ScoresV2 } from '../branches-v2';
import { avatarStageRowsV2, massArtStage } from '../branches-v2';
import {
  AURAS,
  DEFAULT_LOADOUT,
  EFFECTS,
  EMOTES,
  PALETTE_IDS,
  palettePrice,
  resolveActivePalette,
  SKINS,
  buildRoster,
  cosmeticUnlocked,
  GYMERICA,
  characterStageOptions,
  currentStageFor,
  skinKey,
  skinPrice,
  skinUnlocked,
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

describe('THE ORIGIN LOCK — the origin champion is the only equipable one', () => {
  it('buildRoster with an origin unlocks the origin champion ONLY', () => {
    // Gates that would open mass are irrelevant once an origin exists.
    const roster = buildRoster('aesthetic', scores({ strength: 60, size: 70, aesthetic: 50 }), undefined, 'titan');
    for (const entry of roster) {
      expect(entry.unlocked).toBe(entry.id === 'titan');
      expect(entry.current).toBe(entry.id === 'titan');
    }
  });

  it('an unknown/absent origin slug changes nothing', () => {
    const base = buildRoster('aesthetic', scores(), undefined);
    expect(buildRoster('aesthetic', scores(), undefined, null)).toEqual(base);
    expect(buildRoster('aesthetic', scores(), undefined, 'gymerica')).toEqual(base);
  });

  it('resolveDisplay pins the branch to the origin over derivation AND loadout', () => {
    const d = derived({ scores: scores({ strength: 60, size: 70, aesthetic: 50 }), originPath: 'titan' });
    // Loadout says mass (its gates are even open) — origin still wins.
    const display = resolveDisplay(d, { ...DEFAULT_LOADOUT, branch: 'mass' });
    expect(display.branch).toBe('titan');
  });

  it('equipState refuses a non-origin champion selection', () => {
    const d = derived({ scores: scores({ strength: 60, size: 70, aesthetic: 50 }), originPath: 'titan' });
    const sel: Selection = { ...selectionFromLoadout('titan', DEFAULT_LOADOUT), branch: 'mass' };
    expect(equipState(d, sel, DEFAULT_LOADOUT)).toEqual({ kind: 'locked-character' });
    const own: Selection = { ...selectionFromLoadout('titan', DEFAULT_LOADOUT), branch: 'titan' };
    expect(equipState(d, own, DEFAULT_LOADOUT).kind).not.toBe('locked-character');
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

  it("a LOCKED champion's stages are all locked, whatever your level", () => {
    // Tyson, 2026-07-16: level 57 lit stages 1-3 of champions whose
    // gates he had not met.
    const options = stageOptions('mass', 57, null, false);
    expect(options.every((o) => !o.unlocked && !o.current)).toBe(true);
    expect(options.every((o) => o.requirement === 'UNLOCK THIS CHAMPION FIRST')).toBe(true);
    // The same ladder for an UNLOCKED champion keeps its level gates.
    expect(stageOptions('mass', 57, null, true).some((o) => o.unlocked)).toBe(true);
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

  it("TYSON'S CASE: equipping a LOWER stage of your OWN champion applies", () => {
    // Equipping your own champion stores branch: null (follow future
    // evolutions) — the stage pick must still land.
    const d = derived({ level: 57 });
    const early = stageOptions('aesthetic', 57, null).filter((o) => o.unlocked)[0];
    const owned = new Set([skinKey('aesthetic', 'red')]);
    const display = resolveDisplay(d, { ...DEFAULT_LOADOUT, branch: null, stageKey: early.key, skinId: 'red' }, owned);
    expect(display.stage).toBe(early.stage);
    expect(display.formName).toBe(early.name);
    expect(display.skinId).toBe('red');
    // Not owned → the skin falls back to standard, form still resolves.
    const unowned = resolveDisplay(d, { ...DEFAULT_LOADOUT, branch: null, stageKey: early.key, skinId: 'red' });
    expect(unowned.skinId).toBe('standard');
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
    character: null,
    characterStage: 1,
    characterSkin: 'standard',
    paletteId: 'standard',
    ...over,
  });

  it('the default selection over the default loadout reads EQUIPPED', () => {
    expect(equipState(derived(), sel(), DEFAULT_LOADOUT).kind).toBe('equipped');
  });

  it('changing anything reads EQUIP; equipping round-trips to EQUIPPED', () => {
    const d = derived();
    const s = sel({ skinId: 'red' });
    const owned = new Set([skinKey('aesthetic', 'red')]);
    expect(equipState(d, s, DEFAULT_LOADOUT, owned).kind).toBe('equip');
    const saved = loadoutFromSelection(d.branch, s);
    expect(equipState(d, s, saved, owned).kind).toBe('equipped');
    // Unowned red is a BUY action, priced for the aesthetic line (50).
    const buy = equipState(d, s, DEFAULT_LOADOUT);
    expect(buy).toEqual({ kind: 'buy-skin', line: 'aesthetic', skin: 'red', price: 50 });
    // The SAME colour on a dearer line prices higher.
    const buyMass = equipState(
      derived({ scores: scores({ strength: 60, size: 70, aesthetic: 50 }) }),
      sel({ branch: 'mass', skinId: 'red' }),
      DEFAULT_LOADOUT
    );
    expect(buyMass).toEqual({ kind: 'buy-skin', line: 'mass', skin: 'red', price: 100 });
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
    const ctx = (forgeLevel: number, legacyLevel = 0) => ({
      forgeLevel,
      legacyLevel,
      ownedSkins: new Set<string>(),
      ownedPalettes: new Set<string>(),
    });
    expect(cosmeticUnlocked({ kind: 'free' }, ctx(0))).toBe(true);
    expect(cosmeticUnlocked({ kind: 'forge', level: 5 }, ctx(4))).toBe(false);
    expect(cosmeticUnlocked({ kind: 'forge', level: 5 }, ctx(5))).toBe(true);
    expect(cosmeticUnlocked({ kind: 'tier', slug: 'epic' }, ctx(0, 49))).toBe(false);
    expect(cosmeticUnlocked({ kind: 'tier', slug: 'epic' }, ctx(0, 50))).toBe(true);
    expect(cosmeticUnlocked({ kind: 'tier', slug: 'epic' }, ctx(0, 100))).toBe(true);
    expect(cosmeticUnlocked({ kind: 'incoming', source: 'x' }, ctx(999, 100))).toBe(false);
    expect(cosmeticUnlocked({ kind: 'coins' }, ctx(999, 100))).toBe(false); // skins resolve via skinUnlocked
    expect(unlockLabel({ kind: 'forge', level: 5 })).toBe('FORGE LEVEL 5');
    expect(unlockLabel({ kind: 'tier', slug: 'legendary' })).toBe('REACH LEGENDARY TIER');
  });

  it('every ladder shows ONE ROW PER BODY — four stages, stage 4 real', () => {
    // Tyson: "mass monster is missing its stage 4, and stages 1 and 2 are
    // the same" + "only 4 stages for each type of skin".
    expect([1, 24, 25, 50, 75, 100].map((l) => massArtStage(l))).toEqual([1, 1, 2, 3, 4, 4]);
    expect(avatarStageRowsV2('mass', 100).map((r) => r.stage)).toEqual([1, 2, 3, 4]);
    expect(avatarStageRowsV2('titan', 100).map((r) => r.stage)).toEqual([1, 2, 3, 4]);
    expect(avatarStageRowsV2('aesthetic', 100).map((r) => r.stage)).toEqual([1, 2, 3, 4]);
    expect(currentStageFor('mass', 80, null)).toBe(4);
    expect(currentStageFor('titan', 55, null)).toBe(3);
    // Cardio spreads four too since the Enduro pack.
    expect(avatarStageRowsV2('cardio', 100).map((r) => r.stage)).toEqual([1, 2, 3, 4]);
    expect(currentStageFor('cardio', 80, null)).toBe(4);
    // The fold recomputes CURRENT onto the kept ladder (level 100's row
    // folded into the stage-4 card).
    const rows = avatarStageRowsV2('mass', 100);
    expect(rows.filter((r) => r.current)).toHaveLength(1);
    expect(rows.find((r) => r.current)?.stage).toBe(4);
  });

  it("TRUE ADAM: the level-100 skin unlocks at mythic, locked before", () => {
    const adam = SKINS.find((s) => s.id === 'adam')!;
    const noSkins = { legacyLevel: 99, ownedSkins: new Set<string>() };
    expect(skinUnlocked(adam, 'aesthetic', noSkins)).toBe(false);
    expect(skinUnlocked(adam, 'aesthetic', { legacyLevel: 100, ownedSkins: new Set() })).toBe(true);
    expect(unlockLabel(adam.unlock)).toBe('REACH LEVEL 100 — TRUE ADAM');
    // resolveDisplay refuses a locked adam skin (falls back to standard)…
    const locked = resolveDisplay(derived({ level: 57 }), { ...DEFAULT_LOADOUT, skinId: 'adam' });
    expect(locked.skinId).toBe('standard');
    // …and serves it at 100.
    const open = resolveDisplay(derived({ level: 100 }), { ...DEFAULT_LOADOUT, skinId: 'adam' });
    expect(open.skinId).toBe('adam');
    // The equip button surfaces the requirement.
    const state = equipState(derived({ level: 57 }), { branch: 'aesthetic', stageKey: null, skinId: 'adam', auraId: 'rarity', emoteId: 'victory', effectId: 'podium', character: null, characterStage: 1, characterSkin: 'standard', paletteId: 'standard' }, DEFAULT_LOADOUT);
    expect(state).toEqual({ kind: 'locked-cosmetic', requirement: 'REACH LEVEL 100 — TRUE ADAM' });
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

describe('skin shop prices (Tyson: coins, ascending, aesthetics cheaper)', () => {
  const COLOURS = ['red', 'green', 'yellow', 'orange', 'white', 'black'] as const;

  it('aesthetic prices ascend and every other line is dearer per colour', () => {
    const aes = COLOURS.map((c) => skinPrice('aesthetic', c)!);
    expect(aes).toEqual([50, 75, 100, 150, 200, 250]);
    // Strictly ascending.
    for (let i = 1; i < aes.length; i++) expect(aes[i]).toBeGreaterThan(aes[i - 1]);
    for (const line of ['mass', 'titan', 'cardio', 'shredder'] as const) {
      const other = COLOURS.map((c) => skinPrice(line, c)!);
      for (let i = 1; i < other.length; i++) expect(other[i]).toBeGreaterThan(other[i - 1]);
      // Cheaper on aesthetics, colour for colour.
      COLOURS.forEach((c, i) => expect(other[i]).toBeGreaterThan(aes[i]));
    }
  });

  it('standard and adam are not for sale', () => {
    expect(skinPrice('aesthetic', 'standard')).toBeNull();
    expect(skinPrice('aesthetic', 'adam')).toBeNull();
  });

  it('a coin skin unlocks only for the line it was bought on', () => {
    const owned = new Set([skinKey('aesthetic', 'red')]);
    const red = SKINS.find((s) => s.id === 'red')!;
    expect(skinUnlocked(red, 'aesthetic', { legacyLevel: 0, ownedSkins: owned })).toBe(true);
    expect(skinUnlocked(red, 'mass', { legacyLevel: 0, ownedSkins: owned })).toBe(false);
  });
});

describe('premium character: Captain Gymerica (Tyson, 2026-07-16)', () => {
  const d = (over = {}) => ({
    branch: 'aesthetic' as const, level: 40, bfMid: 15,
    scores: { strength: 40, size: 40, leanness: 40, conditioning: 40, aesthetic: 60 },
    ctx: { nutritionPhase: 'bulking', earliestBf: 18 }, forgeLevel: 8, ...over,
  });
  const gsel = (over = {}) => ({
    branch: 'aesthetic' as const, stageKey: null, skinId: 'standard' as const,
    auraId: 'rarity' as const, emoteId: 'victory' as const, effectId: 'podium',
    character: 'gymerica' as const, characterStage: 1, characterSkin: 'standard' as const,
    paletteId: 'standard' as const, ...over,
  });

  it('costs 10000 and has two stages + two looks', () => {
    expect(GYMERICA.price).toBe(10000);
    expect(GYMERICA.stageNames).toHaveLength(2);
    expect(GYMERICA.looks.map((l) => l.id)).toEqual(['standard', 'usa']);
  });

  it('unowned -> BUY; owned -> equip/equipped; overlay resolves art', () => {
    const owned = new Set(['gymerica']);
    // Unowned: the button is a 10000-coin buy, whatever the class gates.
    expect(equipState(d(), gsel(), DEFAULT_LOADOUT, new Set(), new Set()))
      .toEqual({ kind: 'buy-character', character: 'gymerica', price: 10000 });
    // Owned + different from equipped -> equip.
    expect(equipState(d(), gsel(), DEFAULT_LOADOUT, new Set(), owned).kind).toBe('equip');
    // resolveDisplay only shows the overlay when OWNED.
    const eq = { ...DEFAULT_LOADOUT, character: 'gymerica' as const, characterStage: 2, characterSkin: 'usa' as const };
    const shown = resolveDisplay(d(), eq, new Set(), owned);
    expect(shown.character).toEqual({ id: 'gymerica', stage: 2, look: 'usa' });
    expect(shown.formName).toBe('Gymerica, Shielded');
    // Not owned -> overlay dropped, falls back to the branch identity.
    expect(resolveDisplay(d(), eq, new Set(), new Set()).character).toBeNull();
  });

  it('stage options are both unlocked once owned, both locked otherwise', () => {
    expect(characterStageOptions(GYMERICA, true).every((o) => o.unlocked)).toBe(true);
    expect(characterStageOptions(GYMERICA, false).every((o) => !o.unlocked)).toBe(true);
  });
});

describe('stale loadout migration (Tyson: "app crashes on Customise")', () => {
  it('a loadout persisted before the overlay fields is safe', () => {
    // Simulate an old persisted wallet: no character/characterStage/
    // characterSkin (they rehydrate as undefined, not null).
    const stale = {
      branch: null, stageKey: null, skinId: 'standard', auraId: 'rarity',
      emoteId: 'victory', effectId: 'podium',
    } as unknown as typeof DEFAULT_LOADOUT;
    const sel = selectionFromLoadout('aesthetic', stale);
    expect(sel.character).toBeNull();
    expect(sel.characterStage).toBe(1);
    expect(sel.characterSkin).toBe('standard');
    // resolveDisplay must not treat undefined as an equipped character.
    const d = { branch: 'aesthetic' as const, level: 40, bfMid: 15,
      scores: { strength: 40, size: 40, leanness: 40, conditioning: 40, aesthetic: 60 },
      ctx: { nutritionPhase: 'bulking', earliestBf: 18 }, forgeLevel: 8 };
    const shown = resolveDisplay(d, stale, new Set(), new Set(['gymerica']));
    expect(shown.character).toBeNull();
  });
});

describe('the palette shop (whole-app themes, migration 044)', () => {
  const sel = (over: Partial<Selection> = {}): Selection => ({
    branch: 'aesthetic',
    stageKey: null,
    skinId: 'standard',
    auraId: 'rarity',
    emoteId: 'victory',
    effectId: 'podium',
    character: null,
    characterStage: 1,
    characterSkin: 'standard',
    paletteId: 'standard',
    ...over,
  });

  it('prices mirror palette_price() exactly and ascend', () => {
    expect(PALETTE_IDS.map((id) => [id, palettePrice(id)])).toEqual([
      ['emerald', 500],
      ['crimson', 750],
      ['synthwave', 1000],
      ['solar', 1250],
      ['arctic', 1500],
      ['void', 2000],
    ]);
    const prices = PALETTE_IDS.map((id) => palettePrice(id)!);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it('standard is free — never priced, never purchasable', () => {
    expect(palettePrice('standard')).toBeNull();
    expect(palettePrice('nope')).toBeNull();
    expect(DEFAULT_LOADOUT.paletteId).toBe('standard');
  });

  it('resolveActivePalette: preview beats equipped and needs NO ownership', () => {
    expect(resolveActivePalette('emerald', 'crimson', new Set(['crimson']))).toBe('emerald');
    expect(resolveActivePalette('void', null, new Set())).toBe('void');
  });

  it('resolveActivePalette: the equipped palette renders only while owned', () => {
    expect(resolveActivePalette(null, 'emerald', new Set(['emerald']))).toBe('emerald');
    expect(resolveActivePalette(null, 'emerald', new Set())).toBe('standard');
    expect(resolveActivePalette(null, 'standard', new Set())).toBe('standard');
    expect(resolveActivePalette(null, null, new Set())).toBe('standard');
    expect(resolveActivePalette(null, undefined, new Set())).toBe('standard');
    // A retired/garbage id can never render or throw.
    expect(resolveActivePalette('garbage', 'garbage', new Set(['garbage']))).toBe('standard');
  });

  it('an unbought palette turns the primary button into BUY at its price', () => {
    const d = derived();
    const s = sel({ paletteId: 'emerald' });
    expect(equipState(d, s, DEFAULT_LOADOUT)).toEqual({ kind: 'buy-palette', palette: 'emerald', price: 500 });
    // Owned: a plain EQUIP, and the equip round-trips to EQUIPPED.
    const owned = new Set(['emerald']);
    expect(equipState(d, s, DEFAULT_LOADOUT, new Set(), new Set(), owned).kind).toBe('equip');
    const saved = loadoutFromSelection(d.branch, s);
    expect(equipState(d, s, saved, new Set(), new Set(), owned).kind).toBe('equipped');
    expect(saved.paletteId).toBe('emerald');
    // Standard is always equippable without coins.
    expect(equipState(d, sel(), DEFAULT_LOADOUT).kind).toBe('equipped');
  });

  it('sameLoadout discriminates on paletteId and tolerates stale wallets', () => {
    const a = { ...DEFAULT_LOADOUT, paletteId: 'emerald' as const };
    expect(sameLoadout(a, DEFAULT_LOADOUT)).toBe(false);
    // A pre-palette persisted loadout (undefined) equals an explicit standard.
    const stale = { ...DEFAULT_LOADOUT } as Record<string, unknown>;
    delete stale.paletteId;
    expect(sameLoadout(stale as unknown as typeof DEFAULT_LOADOUT, DEFAULT_LOADOUT)).toBe(true);
  });

  it('selection round-trips paletteId and defaults stale loadouts to standard', () => {
    const stale = { ...DEFAULT_LOADOUT } as Record<string, unknown>;
    delete stale.paletteId;
    expect(selectionFromLoadout('aesthetic', stale as unknown as typeof DEFAULT_LOADOUT).paletteId).toBe('standard');
    const s = sel({ paletteId: 'void' });
    expect(loadoutFromSelection('aesthetic', s).paletteId).toBe('void');
  });
});
