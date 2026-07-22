import { describe, expect, it } from 'vitest';
import { BALANCE, CARDS, getCardById } from '../content';
import { checkCardsInvariant, cycleCard, initTeamCards, validateDeck } from '../game-engine/cards/deck';
import { spawnUnitsForCard } from '../game-engine/entities/spawn';
import { SeededRng } from '../game-engine/random/rng';
import { applyCommand } from '../game-engine/simulation/events';
import { checkInvariants } from '../game-engine/simulation/invariants';
import { computeDigest, runBattle } from '../game-engine/simulation/run';
import { createBattle, effectiveStats, isStunned, UnitState } from '../game-engine/simulation/state';
import { advanceTick } from '../game-engine/simulation/tick';
import { DEFAULT_DECK_CARD_IDS } from '../services/persistence/save';

const config = { seed: 777, player: { playerId: 'p1' }, opponent: { playerId: 'p2' } };

const deckConfig = {
  seed: 777,
  player: { playerId: 'p1', deckCardIds: DEFAULT_DECK_CARD_IDS },
  opponent: { playerId: 'p2', deckCardIds: DEFAULT_DECK_CARD_IDS },
};

describe('deck validation', () => {
  it('accepts the default deck', () => {
    expect(validateDeck(DEFAULT_DECK_CARD_IDS, BALANCE)).toEqual([]);
  });

  it('rejects wrong size, duplicates and unknown cards', () => {
    expect(validateDeck(DEFAULT_DECK_CARD_IDS.slice(0, 7), BALANCE)).not.toEqual([]);
    const dupes = [...DEFAULT_DECK_CARD_IDS.slice(0, 7), DEFAULT_DECK_CARD_IDS[0]];
    expect(validateDeck(dupes, BALANCE).some((e) => e.includes('duplicate'))).toBe(true);
    const unknown = [...DEFAULT_DECK_CARD_IDS.slice(0, 7), 'not-a-card'];
    expect(validateDeck(unknown, BALANCE).some((e) => e.includes('unknown'))).toBe(true);
  });

  it('createBattle throws on a structurally invalid deck', () => {
    expect(() =>
      createBattle(
        { seed: 1, player: { playerId: 'p', deckCardIds: ['forge-recruit'] }, opponent: { playerId: 'o' } },
        BALANCE
      )
    ).toThrow(/invalid deck/);
  });
});

describe('card cycle', () => {
  it('shuffles deterministically per seed and deals hand/queue sizes', () => {
    const a = initTeamCards(DEFAULT_DECK_CARD_IDS, BALANCE, new SeededRng(42));
    const b = initTeamCards(DEFAULT_DECK_CARD_IDS, BALANCE, new SeededRng(42));
    const c = initTeamCards(DEFAULT_DECK_CARD_IDS, BALANCE, new SeededRng(43));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.hand.length).toBe(BALANCE.cards.handSize);
    expect(a.queue.length).toBe(BALANCE.cards.deckSize - BALANCE.cards.handSize);
  });

  it('never loses or duplicates cards across hundreds of plays', () => {
    const rng = new SeededRng(7);
    const cards = initTeamCards(DEFAULT_DECK_CARD_IDS, BALANCE, rng);
    for (let i = 0; i < 500; i++) {
      const played = rng.pick(cards.hand);
      expect(cycleCard(cards, played)).toBe(true);
      expect(checkCardsInvariant(cards, BALANCE)).toEqual([]);
    }
    expect(new Set([...cards.hand, ...cards.queue]).size).toBe(BALANCE.cards.deckSize);
  });

  it('rejects playing a card that is not in hand', () => {
    const cards = initTeamCards(DEFAULT_DECK_CARD_IDS, BALANCE, new SeededRng(1));
    const notInHand = cards.queue[0];
    expect(cycleCard(cards, notInHand)).toBe(false);
  });

  it('played card returns after cycling through the queue', () => {
    const cards = initTeamCards(DEFAULT_DECK_CARD_IDS, BALANCE, new SeededRng(1));
    const first = cards.hand[0];
    cycleCard(cards, first);
    expect(cards.hand.includes(first)).toBe(false);
    expect(cards.queue[cards.queue.length - 1]).toBe(first);
    // Play enough other cards for `first` to be drawn again.
    for (let i = 0; i < BALANCE.cards.deckSize - BALANCE.cards.handSize; i++) {
      cycleCard(cards, cards.hand[0]);
    }
    expect(cards.hand.includes(first)).toBe(true);
  });
});

describe('hand enforcement in battle', () => {
  it('deck teams can only deploy cards from hand, and playing cycles the hand', () => {
    const state = createBattle(deckConfig, BALANCE);
    state.tick = 1;
    state.teams.player.energy = 10;
    const cards = state.teams.player.cards!;
    const fighterInHand = cards.hand.find((id) => getCardById(id)!.category === 'fighter');
    const inQueue = cards.queue[0];

    const rejected = applyCommand(state, BALANCE, {
      type: 'deploy-card',
      team: 'player',
      cardId: inQueue,
      lane: 0,
      x: 10,
    });
    expect(rejected.ok).toBe(false);

    if (fighterInHand) {
      const played = applyCommand(state, BALANCE, {
        type: 'deploy-card',
        team: 'player',
        cardId: fighterInHand,
        lane: 0,
        x: 10,
      });
      expect(played.ok).toBe(true);
      expect(cards.hand.includes(fighterInHand)).toBe(false);
      expect(cards.queue[cards.queue.length - 1]).toBe(fighterInHand);
      expect(checkCardsInvariant(cards, BALANCE)).toEqual([]);
    }
  });

  it('no-deck teams keep legacy behaviour (any fighter deployable)', () => {
    const state = createBattle(config, BALANCE);
    state.tick = 1;
    state.teams.player.energy = 10;
    const result = applyCommand(state, BALANCE, {
      type: 'deploy-card',
      team: 'player',
      cardId: 'heavy-tank',
      lane: 0,
      x: 10,
    });
    expect(result.ok).toBe(true);
  });
});

describe('technique and equipment effects', () => {
  function battleWithUnits() {
    const state = createBattle(config, BALANCE);
    state.tick = 1;
    state.teams.player.energy = 10;
    state.teams.opponent.energy = 10;
    const ally = spawnUnitsForCard(state, BALANCE, getCardById('titan-guard')!, 'player', 0, 30)[0];
    const ally2 = spawnUnitsForCard(state, BALANCE, getCardById('neon-boxer')!, 'player', 0, 28)[0];
    const enemy = spawnUnitsForCard(state, BALANCE, getCardById('titan-guard')!, 'opponent', 0, 70)[0];
    const enemy2 = spawnUnitsForCard(state, BALANCE, getCardById('forge-recruit')!, 'opponent', 0, 72)[0];
    return { state, ally, ally2, enemy, enemy2 };
  }

  function play(state: ReturnType<typeof createBattle>, cardId: string, unitId: number) {
    return applyCommand(state, BALANCE, {
      type: 'play-card',
      team: 'player',
      cardId,
      target: { kind: 'unit', unitId },
    });
  }

  it('adrenaline-surge buffs damage and attack speed', () => {
    const { state, ally } = battleWithUnits();
    expect(play(state, 'adrenaline-surge', ally.id).ok).toBe(true);
    const stats = effectiveStats(ally, state.tick);
    expect(stats.attackDamage).toBeCloseTo(ally.base.attackDamage * 1.3);
    expect(stats.attackIntervalTicks).toBe(Math.round(ally.base.attackIntervalTicks * 0.6));
  });

  it('recovery-pulse heals all wounded allies in radius', () => {
    const { state, ally, ally2 } = battleWithUnits();
    ally.health -= 300;
    ally2.health -= 100;
    const h1 = ally.health;
    const h2 = ally2.health;
    expect(play(state, 'recovery-pulse', ally.id).ok).toBe(true);
    expect(ally.health).toBe(h1 + 180);
    expect(ally2.health).toBe(h2 + 100); // clamped at max
  });

  it('overload damages and stuns enemies in radius', () => {
    const { state, enemy, enemy2 } = battleWithUnits();
    const h = enemy.health;
    expect(play(state, 'overload', enemy.id).ok).toBe(true);
    expect(enemy.health).toBe(h - 140);
    expect(isStunned(enemy, state.tick)).toBe(true);
    expect(isStunned(enemy2, state.tick)).toBe(true); // within radius 8 (70 vs 72)
    // The 160hp recruit takes the 140 AoE damage too.
    expect(enemy2.health).toBe(160 - 140);
  });

  it('shockwave damages and slows enemies', () => {
    const { state, enemy } = battleWithUnits();
    expect(play(state, 'shockwave', enemy.id).ok).toBe(true);
    const stats = effectiveStats(enemy, state.tick);
    expect(stats.moveSpeedPerTick).toBeCloseTo(enemy.base.moveSpeedPerTick * 0.6);
  });

  it('emergency-shield grants a shield that absorbs damage', () => {
    const { state, ally } = battleWithUnits();
    expect(play(state, 'emergency-shield', ally.id).ok).toBe(true);
    expect(ally.shield).toBe(250);
  });

  it('second-wind is rejected until champions exist (friendly-champion target)', () => {
    const { state, ally } = battleWithUnits();
    const result = play(state, 'second-wind', ally.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Champion');
    // No energy was spent on the failed play.
    expect(state.teams.player.energy).toBe(10);
  });

  it('equipment modifiers stack from multiple cards', () => {
    const { state, ally } = battleWithUnits();
    expect(play(state, 'power-belt', ally.id).ok).toBe(true);
    expect(play(state, 'neon-blades', ally.id).ok).toBe(true); // energy 10-2-2 = 6
    const stats = effectiveStats(ally, state.tick);
    expect(stats.attackDamage).toBeCloseTo(ally.base.attackDamage * 1.35);
    expect(stats.attackIntervalTicks).toBe(Math.round(ally.base.attackIntervalTicks * 0.7));
    expect(state.teams.player.energy).toBeCloseTo(6);
  });

  it('all shipped equipment cards produce observable stat changes', () => {
    for (const card of CARDS.filter((c) => c.category === 'equipment')) {
      const { state, ally } = battleWithUnits();
      const before = effectiveStats(ally, state.tick);
      const beforeHealth = ally.health;
      const result = play(state, card.id, ally.id);
      expect(result.ok, `${card.id} should be playable`).toBe(true);
      const after = effectiveStats(ally, state.tick);
      const changed =
        after.attackDamage !== before.attackDamage ||
        after.attackIntervalTicks !== before.attackIntervalTicks ||
        after.moveSpeedPerTick !== before.moveSpeedPerTick ||
        after.maxHealth !== before.maxHealth ||
        ally.health !== beforeHealth;
      expect(changed, `${card.id} should change stats`).toBe(true);
      expect(checkInvariants(state, BALANCE)).toEqual([]);
    }
  });

  it('reinforced-armour grants temporary vitality clamped on expiry', () => {
    const { state, ally } = battleWithUnits();
    const baseMax = ally.baseMaxHealth;
    expect(play(state, 'reinforced-armour', ally.id).ok).toBe(true);
    expect(ally.health).toBe(baseMax + 300);
    expect(effectiveStats(ally, state.tick).maxHealth).toBe(baseMax + 300);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('play-card validations: wrong side, dead target, fighters, energy', () => {
    const { state, ally, enemy } = battleWithUnits();
    expect(play(state, 'overload', ally.id).ok).toBe(false); // enemy-only on ally
    expect(play(state, 'power-belt', enemy.id).ok).toBe(false); // friendly-only on enemy
    enemy.alive = false;
    enemy.health = 0;
    expect(play(state, 'overload', enemy.id).ok).toBe(false); // dead target
    expect(play(state, 'adrenaline-surge', 99999).ok).toBe(false); // unknown target
    const fighter = applyCommand(state, BALANCE, {
      type: 'play-card',
      team: 'player',
      cardId: 'heavy-tank',
      target: { kind: 'unit', unitId: ally.id },
    });
    expect(fighter.ok).toBe(false); // fighters must use deploy-card
    state.teams.player.energy = 0.5;
    expect(play(state, 'emergency-shield', ally.id).ok).toBe(false);
  });
});

describe('engine deep-review batch (Opus findings)', () => {
  function battlePair() {
    const state = createBattle(config, BALANCE);
    state.tick = 1;
    state.teams.player.energy = 10;
    const ally = spawnUnitsForCard(state, BALANCE, getCardById('titan-guard')!, 'player', 0, 30)[0];
    return { state, ally };
  }

  it('re-casting the same buff refreshes instead of stacking (1.3, not 1.3^n)', () => {
    const { state, ally } = battlePair();
    const cast = () =>
      applyCommand(state, BALANCE, {
        type: 'play-card',
        team: 'player',
        cardId: 'adrenaline-surge',
        target: { kind: 'unit', unitId: ally.id },
      });
    expect(cast().ok).toBe(true);
    expect(cast().ok).toBe(true);
    expect(cast().ok).toBe(true);
    const stats = effectiveStats(ally, state.tick);
    expect(stats.attackDamage).toBeCloseTo(ally.base.attackDamage * 1.3);
    // Only one live modifier from that source remains.
    expect(ally.modifiers.filter((m) => m.sourceId === 'adrenaline-surge').length).toBe(1);
  });

  it('re-casting reinforced-armour refreshes duration without re-granting vitality', () => {
    const { state, ally } = battlePair();
    const cast = () =>
      applyCommand(state, BALANCE, {
        type: 'play-card',
        team: 'player',
        cardId: 'reinforced-armour',
        target: { kind: 'unit', unitId: ally.id },
      });
    expect(cast().ok).toBe(true);
    const healthAfterFirst = ally.health;
    expect(healthAfterFirst).toBe(ally.baseMaxHealth + 300);
    state.teams.player.energy = 10;
    expect(cast().ok).toBe(true);
    expect(ally.health).toBe(healthAfterFirst); // no double vitality
    expect(effectiveStats(ally, state.tick).maxHealth).toBe(ally.baseMaxHealth + 300);
    expect(checkInvariants(state, BALANCE)).toEqual([]);
  });

  it('card AoE is lane-scoped: equal-x unit in the other lane is untouched', () => {
    const { state } = battlePair();
    const inLane = spawnUnitsForCard(state, BALANCE, getCardById('titan-guard')!, 'opponent', 0, 70)[0];
    const otherLane = spawnUnitsForCard(state, BALANCE, getCardById('titan-guard')!, 'opponent', 1, 70)[0];
    const result = applyCommand(state, BALANCE, {
      type: 'play-card',
      team: 'player',
      cardId: 'overload', // damage 140, radius 8
      target: { kind: 'unit', unitId: inLane.id },
    });
    expect(result.ok).toBe(true);
    expect(inLane.health).toBe(inLane.baseMaxHealth - 140);
    expect(otherLane.health).toBe(otherLane.baseMaxHealth); // same x, different lane
    expect(isStunned(otherLane, state.tick)).toBe(false);
  });

  it('support-drone shields the frontmost ally up to the cap', () => {
    const state = createBattle(config, BALANCE);
    state.tick = 1;
    const back = spawnUnitsForCard(state, BALANCE, getCardById('titan-guard')!, 'player', 0, 20)[0];
    const front = spawnUnitsForCard(state, BALANCE, getCardById('heavy-tank')!, 'player', 0, 30)[0];
    const drone = spawnUnitsForCard(state, BALANCE, getCardById('support-drone')!, 'player', 0, 25)[0];
    expect(drone.behavior).toBe('shielder');
    const cap = drone.base.attackDamage * BALANCE.units.shielderShieldCapMult;

    // March/shield for a while: the frontmost ally accrues shield, capped.
    for (let i = 0; i < 400; i++) {
      advanceTick(state, BALANCE);
      expect(checkInvariants(state, BALANCE)).toEqual([]);
    }
    expect(front.shield).toBeGreaterThan(0);
    expect(front.shield).toBeLessThanOrEqual(cap);
    // The backline unit is not the frontmost — the drone should not have
    // prioritized it while the tank was in range.
    expect(front.shield).toBeGreaterThanOrEqual(back.shield);
  });

  it('shielder battles remain deterministic and complete', () => {
    const commands = [
      { tick: 10, command: { type: 'deploy-card', team: 'player', cardId: 'support-drone', lane: 0, x: 20 } as const },
      { tick: 12, command: { type: 'deploy-card', team: 'player', cardId: 'forge-recruit', lane: 0, x: 25 } as const },
      { tick: 15, command: { type: 'deploy-card', team: 'opponent', cardId: 'neon-boxer', lane: 0, x: 75 } as const },
    ];
    const a = runBattle(config, commands, BALANCE);
    const b = runBattle(config, commands, BALANCE);
    expect(a.digest).toBe(b.digest);
    expect(a.rejected).toEqual([]);
    expect(a.invariantViolations).toEqual([]);
    expect(a.stalled).toBe(false);
  });
});

describe('live controller with decks', () => {
  it('deck-constrained live battles replay exactly through runBattle', async () => {
    const { createLiveBattle, queuePlayerDeploy, queuePlayerPlayCard, stepLiveBattle, liveDigest } =
      await import('../features/arena/battle-controller');
    const live = createLiveBattle(4242, 'p1', {
      playerDeckCardIds: DEFAULT_DECK_CARD_IDS,
      opponentDeckCardIds: DEFAULT_DECK_CARD_IDS,
    });
    stepLiveBattle(live, 100);
    // Deploy whatever fighter is currently in hand.
    const hand = live.state.teams.player.cards!.hand;
    const fighter = hand.find((id) => getCardById(id)!.category === 'fighter');
    if (fighter) queuePlayerDeploy(live, fighter, 0, 20);
    stepLiveBattle(live, 400);
    // Play a technique from hand at a live target if possible.
    const technique = live.state.teams.player.cards!.hand.find(
      (id) => getCardById(id)!.category !== 'fighter'
    );
    const anyEnemy = live.state.units.find((u) => u.alive && u.team === 'opponent');
    if (technique && anyEnemy) queuePlayerPlayCard(live, technique, anyEnemy.id);
    while (live.state.phase !== 'finished') stepLiveBattle(live, 200);

    const replay = runBattle(live.config, live.commandLog, BALANCE);
    expect(replay.digest).toBe(liveDigest(live));
    expect(replay.outcome).toEqual(live.state.outcome);
    expect(replay.invariantViolations).toEqual([]);
  });

  it('resolveCardTargetForLane picks sensible deterministic targets', async () => {
    const { createLiveBattle, resolveCardTargetForLane } = await import(
      '../features/arena/battle-controller'
    );
    const live = createLiveBattle(1, 'p1');
    const state = live.state;
    state.tick = 1;
    const wounded = spawnUnitsForCard(state, BALANCE, getCardById('titan-guard')!, 'player', 0, 30)[0];
    const front = spawnUnitsForCard(state, BALANCE, getCardById('neon-boxer')!, 'player', 0, 35)[0];
    const threatNear = spawnUnitsForCard(state, BALANCE, getCardById('forge-recruit')!, 'opponent', 0, 60)[0];
    spawnUnitsForCard(state, BALANCE, getCardById('heavy-tank')!, 'opponent', 0, 80);
    wounded.health -= 400;

    // Heal → most-wounded ally; buff → frontmost ally; damage → enemy
    // closest to the player core; empty lane → null.
    expect(resolveCardTargetForLane(live, 'recovery-pulse', 0)).toBe(wounded.id);
    expect(resolveCardTargetForLane(live, 'power-belt', 0)).toBe(front.id);
    expect(resolveCardTargetForLane(live, 'overload', 0)).toBe(threatNear.id);
    expect(resolveCardTargetForLane(live, 'overload', 1)).toBeNull();
    expect(resolveCardTargetForLane(live, 'forge-recruit', 0)).toBeNull(); // fighters don't auto-target
  });
});

describe('deck battles stay deterministic', () => {
  it('same seed and commands with decks produce identical digests', () => {
    const commands = [
      { tick: 10, command: { type: 'noop', team: 'player' } as const },
    ];
    const a = runBattle(deckConfig, commands, BALANCE);
    const b = runBattle(deckConfig, commands, BALANCE);
    expect(a.digest).toBe(b.digest);
    expect(a.invariantViolations).toEqual([]);
  });

  it('deck shuffle consumes battle RNG (deck battles differ from no-deck)', () => {
    const withDeck = createBattle(deckConfig, BALANCE);
    const without = createBattle(config, BALANCE);
    expect(computeDigest(withDeck)).not.toBe(computeDigest(without));
    // Same seed, same decks → same shuffle.
    const again = createBattle(deckConfig, BALANCE);
    expect(computeDigest(withDeck)).toBe(computeDigest(again));
  });
});
