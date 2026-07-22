# EvoForge Arena — Progress

Working log per the master prompt's milestone plan. Every milestone records
what is genuinely complete, how it was verified, and known limitations.

## Architecture summary

- Expo SDK 57 + TypeScript strict, Expo Router (`src/app`), zustand, AsyncStorage.
- `src/game-engine/**` is pure TypeScript — no React Native imports, fully
  deterministic (all randomness via `SeededRng`), testable headless with Vitest.
- All content (cards/champions/synergies) is data-driven under `src/content`
  and validated at boot; all tunables live in `src/content/balance.ts`
  (stamped with `balanceVersion`).
- Player/fitness data flows only through `EvoForgePlayerProvider`
  (`src/integration/evoforge`), implemented by `LocalMockPlayerProvider`.
- Persistence is a `KeyValueStorage` interface: AsyncStorage in the app,
  `MemoryStorage` in tests. Saves are versioned with migrations and
  corrupt-data recovery.

## Milestone checklist

- [x] M1 — Foundation
- [x] M2 — Deterministic battle engine
- [x] M3 — Arena interface
- [x] M4 — Card deck system
- [x] M5 — Champions
- [x] M6 — AI and autobattler depth
- [x] M7 — Progression bridge
- [x] M8 — Ghost battles and replay
- [x] M9 — Gym Champions
- [x] M10 — Beta hardening

---

## Milestone 1 — Foundation (2026-07-22) ✅

Built:
- Expo TS project with the mandated folder architecture.
- Navigation: Title → Lobby / Profile / Developer Debug (Expo Router stack).
- Global dark-cyberpunk theme (`src/constants/theme.ts`) + shared UI primitives.
- Typed content schemas + full initial dataset: 20 cards, 4 Champions,
  4 synergies, central balance config (`balanceVersion 0.1.0`).
- Runtime content validation with a structured report (shown on debug screen).
- Seeded RNG (`mulberry32`) with string-seed derivation.
- Versioned save data (v1) with migration framework, corrupt-data recovery,
  newer-version refusal, and persistence through the storage interface.
- Player store (vanilla zustand) + `LocalMockPlayerProvider` implementing the
  EvoForge integration boundary.
- Error boundary; boot sequence that validates content before entering the app.
- Developer debug screen: validation report, balance info, save inspector,
  load flags (fresh/recovered), reset-data with confirmation.

Verified:
- `npx tsc --noEmit` — clean.
- `npx vitest run` — 3 files, 31 tests, all passing (RNG determinism, content
  validation incl. negative cases, save round-trip/corruption/migration/restart
  simulation, provider behaviour).
- `npx expo export --platform web` — bundles; all routes statically render.

Known limitations:
- Battle button disabled until M3; no engine yet (M2).
- Debug seed display arrives with the battle engine (no battles exist yet).
- App verified via web bundle + static render; on-device Expo Go check
  pending Tyson's device (no emulator on this machine).

---

## Milestone 2 — Deterministic battle engine (2026-07-22) ✅

Built (all pure TS under `src/game-engine`, no RN imports):
- Battle state model: two lanes on one axis (player core x=0, opponent core
  x=laneLength), sequential entity ids, per-team energy, structured log.
- Fixed six-step tick pipeline (`tick.ts`): clock → scheduled commands →
  energy regen (with final-minute multiplier) → modifier expiry (with
  health clamping) → unit actions in ascending-id order → outcome resolution.
- Movement (march toward enemy core / approach target with exact-stop),
  deterministic targeting (nearest-in-aggro with id tie-breaks; behaviours:
  default, core-only, healer), attacks with per-unit cooldowns, shields,
  timed stat modifiers, stuns, death handling that clears all references.
- Command layer (`events.ts`): the only input path into the simulation.
  Validates everything (card, category, lane, team, deploy zone, core
  exclusion, energy with float-epsilon) and rejects rather than throws —
  including unknown command types and malformed team ids from untrusted
  replay data. Malformed schedule ticks rejected up front in the runner.
- Outcome logic: core destruction, timeout core-health comparison, sudden
  death (first blood decides; draw after the SD window). Battles cannot
  stall (hard cap backstop) and always produce exactly one valid outcome.
- Per-tick invariant checker (energy/cooldown/position/health/target-alive/
  unique-id/phase-outcome consistency) + headless runner with an FNV-1a
  state digest (covers positions, health, shields, cooldowns, stuns,
  modifiers, teams, energy, rng state, outcome) for replay verification.

Ultracode review (multi-agent, adversarial): 4 finder lenses → skeptic
verification per finding. 12 confirmed findings fixed (2 engine defects:
unknown-command-type and invalid-team crashes; 10 test gaps, several proven
by mutation testing — e.g. a team-direction sign flip previously survived
the whole suite). 3 findings refuted with evidence. Unverified low-severity
findings triaged manually: fixed fan-out stacking at lane edges, energy
float-drift affordability, negative-heal latent bug, digest omissions,
NaN-tick sort hazard; deferred same-tick mirror-order fairness (see
KNOWN_ISSUES).

Verified:
- `npx tsc --noEmit` — clean.
- `npx vitest run` — 5 files, 82 tests passing: determinism (identical
  digests, fixture honesty via rejected===[]), movement numerics (exact
  per-tick deltas both directions, no overshoot, no edge stacking), attack
  cadence (hit ticks exactly every interval), stun window + wake semantics,
  modifier stacking/expiry/interval-floor, shield absorption/kill-through,
  energy rates incl. final-minute multiplier and float boundaries, deploy
  validation for both teams incl. boundaries and core-exclusion, replay
  safety for malformed commands, timeout both directions, sudden-death
  first-blood, invariants on every tick of every battle run.

Known limitations: see KNOWN_ISSUES.md (mirror-order fairness; engine
consumes no RNG yet — first consumer arrives with crits/spawn jitter or AI).

---

## Milestone 3 — Arena interface (2026-07-22) ✅

Built:
- `src/features/arena/battle-store.ts` — vanilla zustand store that owns a
  `LiveBattle` and its real-time loop: a 50ms `setInterval` driven by a
  `Date.now()` wall-clock accumulator (not "1 tick per fire" — timers drift),
  catch-up capped at 5 ticks/fire so a stall plays out at normal speed
  instead of skipping to the end. Actions: `start`, `selectCard`, `deploy`
  (validates via `queuePlayerDeploy`, surfaces the rejection reason, clears
  selection on success), `stop`, `restart` (fully resets every field —
  status/live/version/selection/rejection — while leaving the old
  `LiveBattle` object untouched), `clearRejection`. Records the battle
  result exactly once per battle (guarded by a closure flag reset on
  start/restart) via `EvoForgePlayerProvider.recordBattleResult`, with
  `rankPointsDelta` from `BALANCE.rank` and a `battle-<seed>-<endTick>` id.
  The provider is injected lazily through a `{ current }` ref (same pattern
  as `player-store.ts`'s `storageRef`) so the module never imports
  `services/app-services` (and therefore never AsyncStorage) at load time —
  tests supply a fake provider up front; the app leaves it unset and the
  real provider is `import()`ed only the first time a result is recorded.
- `src/features/arena/use-battle.ts` — React binding, mirrors `use-player.ts`.
- `src/app/battle.tsx` — full-screen dark arena (no header, no scroll):
  opponent core bar on top, two vertical lane strips, player core bar,
  bottom HUD (energy bar + the fixed 5-card fighter hand). Engine x maps to
  screen y per lane (`top% = (1 - x/laneLength) * 100`); tap-to-deploy reads
  `locationY` off a `Pressable` per lane, converts back to engine x, clamps
  into `[0, deployZoneDepth]`. Rejected deploys flash their reason for 1.5s
  near the card row. Countdown timer + a SUDDEN DEATH phase indicator up
  top. Result overlay (VICTORY/DEFEAT/DRAW, reason, both core healths,
  Rematch with a fresh random seed, Back to Lobby) when the store status is
  `finished`. `__DEV__` corner readout: seed/tick/frame version/digest.
  Auto-starts a battle on mount (`Date.now() >>> 0` as seed) if the store is
  still `idle`; `stop()`s the loop on unmount. Wrapped in
  `ErrorBoundary label="battle"`.
  Components: `features/arena/components/{core-bar,lane-strip,card-row,result-overlay}.tsx`.
- Wiring: `battle` registered in the root `Stack` (`headerShown: false`);
  lobby's BATTLE button now navigates to `/battle` instead of being disabled.
- `src/tests/battle-flow.test.ts` (pure TS — controller + store only):
  live-battle-stepped-headless digest/outcome match against
  `runBattle(config, commandLog, BALANCE)` (replay fidelity of the live
  path); same seed + same inputs at the same ticks ⇒ identical digests;
  `queuePlayerDeploy` rejections (finished battle, out-of-zone position,
  insufficient energy) with exact reason strings; `restart` producing a
  fresh battle while the old `LiveBattle` object is provably untouched;
  the store's record-once guard verified end-to-end with `vi.useFakeTimers()`
  driving the real interval loop to `finished` against an injected fake
  provider, then asserting a second long time-advance does not re-record.

Verified:
- `npx tsc --noEmit` — clean.
- `npx vitest run` — 6 files, 100 tests, all passing (82 prior + 18 new;
  no existing test weakened).
- `npx expo export --platform web` — bundles; `/battle` listed among the 9
  static routes.

Deviations from the brief:
- `battle-store.ts`'s `start`/`restart` take an optional second `playerId`
  argument (default `'local-player'`, matching the default save) instead of
  seed-only, so tests can use a distinct player id without touching the
  save system; the app calls them with just the seed as specified.
- The arena screen builds its own full-bleed layout rather than wrapping in
  the shared `<Screen>` primitive (which forces a scrolling, padded
  container) — inappropriate for a HUD that must fill the viewport exactly.
  Theme tokens (`colors`/`spacing`/`typography`) are still used throughout,
  no inline hex.

Known limitations (added to KNOWN_ISSUES.md):
- Re-entering `/battle` from the lobby after a battle finished (without
  pressing Rematch) shows the previous result overlay, because the store is
  an app-wide singleton and only auto-starts when `status === 'idle'` (as
  specified). Pressing Rematch or Back to Lobby both work correctly; only
  the "navigate away without finishing, then come back" path is stale.
- Tap-to-deploy relies on `PressEvent.nativeEvent.locationY`, verified via
  the web static export only; on-device touch-coordinate behaviour is
  unverified (no emulator/device on this machine — same gap as M1/M2).
- The scripted opponent (from `battle-controller.ts`, M2) only ever plays
  fighter cards from a fixed pool; no opponent AI depth yet (M6).
- Card hand is the fixed 5-fighter list named in the brief, not the real
  deck/hand system (draw, energy curve, techniques/equipment) — that is M4.

---

## Milestone 4 — Card deck system (2026-07-22) ✅

Built:
- `src/game-engine/cards/deck.ts` — deck validation (size/dupes/unknown),
  deterministic initial shuffle consuming the battle RNG (player first, then
  opponent — the engine's first real RNG consumer), hand/queue cycling
  (played card → queue tail, queue head → same hand slot), and a cycle
  invariant (hand ∪ queue is always the full 8, no losses, no dupes) wired
  into the per-tick battle invariant checker.
- `src/game-engine/cards/effects.ts` — data-driven technique/equipment
  resolution with validate→pay→apply ordering: a bad target never costs
  energy, and energy refunds land after the cost so the cap can't eat them.
  AoE is lane-scoped around the target; buffs land on allies, debuffs
  (slows) on enemies; equipment bonus-max-health grants temporary vitality
  clamped on expiry by the existing tick pipeline.
- `play-card` command in the engine event union; both `deploy-card` and
  `play-card` enforce hand membership when the team fights with a deck
  (`TeamState.cards`; null keeps legacy free-deploy for dev tools). Hand and
  queue contents are mixed into the replay digest.
- Live controller: deck options on `createLiveBattle`, `queuePlayerPlayCard`
  (next-tick queued, replay-exact), `resolveCardTargetForLane` (deterministic
  tap-a-lane targeting: most-wounded ally for heals/shields, frontmost ally
  for buffs, closest threat for offensive cards); deck-aware scripted
  opponent plays fighters from its rotating hand.
- Battle store/screen: the HUD card row now renders the live 4-card rotating
  hand (with ⚡/⚙ markers for techniques/equipment); the player's saved
  active deck (validated, starter-deck fallback) and a starter-deck opponent
  flow into every battle and rematch. Added `reset()` on screen unmount —
  re-entering /battle never shows a stale result (closes the M3 known issue).
- `src/app/deck-builder.tsx` — 8-slot deck editing over all 20 cards with
  live validation and persistence to the save; `src/app/collection.tsx` —
  full card collection with stats/tags; lobby links to both.

Verified:
- `npx tsc --noEmit` — clean; `npx vitest run` — 6 files, 102 tests passing
  (deck validation, 500-play cycle integrity, deterministic shuffle, hand
  enforcement in battle, every shipped technique/equipment card's effects
  incl. stacking and expiry clamping, validate→pay→apply energy semantics,
  deck-battle determinism, live-with-decks replay fidelity vs runBattle,
  lane target resolution).
- `npx expo export --platform web` — 9 routes including /deck-builder and
  /collection.

Known limitations:
- `second-wind` (friendly-champion target) is unplayable until Champions
  exist (M5) — validated and tested as a clean rejection.
- Card upgrades remain schema-only (disabled), per the master prompt.

---

## Milestone 5 — Champions (2026-07-22) ✅

Built:
- Champion entities: `BattleTeamConfig` gains `championId`/`championLane`
  (default lane 0); `createBattle` spawns each configured champion via
  `spawnChampion` (entities/spawn.ts) just in front of its own core
  (`BALANCE.champion.spawnOffsetFromCore`, opponent mirrored), fighting
  automatically with 'default' behavior on `ChampionDefinition.stats`.
  `UnitState` gains an optional `champion` sub-state `{ definitionId,
  abilityCooldownTicks, ultimateCharge, respawnAtTick, stanceShifts }` plus
  charge rates / respawn delay copied from content+balance at spawn, so
  combat.ts and tick.ts never import content.
- Death/respawn: a champion death schedules `respawnAtTick` (in `damageUnit`,
  which now also clears every unit's `targetId` on ANY kill — closing a
  latent M4 gap where a card-effect kill could leave a stunned bystander
  targeting a corpse). The corpse stays at health 0, untargetable
  (targeting/card validation already filter `alive`). A new respawn step at
  the top of the tick pipeline revives at exactly `respawnAtTick` beside the
  own core at `respawnHealthFraction` health with shield/modifiers/stun/
  target/attack-cooldown cleared; ability cooldown and ultimate charge
  persist through death (cooldown freezes while down).
- Ultimate charge: accrues in `damageUnit`/`damageCore` from damage actually
  dealt (attacker passed as `source`) and taken, at the definition's rates,
  capped at `ultimateChargeRequired`. Shields count, overkill does not, the
  killing blow still charges, and damage from an ultimate itself passes no
  source (no self-recharging ultimates). Card effects remain source-less.
- Commands: `champion-ability` / `champion-ultimate` in the BattleCommand
  union with validate → pay → apply (champion exists + alive, cooldown /
  full charge, ability-specific target validation — 'no valid targets' never
  wastes the cooldown or charge). Abilities are usable while stunned (they
  are player commands, like cards).
- `src/game-engine/abilities/champion-abilities.ts`: per-ability handlers on
  a shared `applyEffectPayload` extracted from cards/effects.ts (one
  interpreter for damage/stun/heal/shield/modifier payloads, now also
  handling the new `damageTakenMult` modifier applied in `damageUnit`).
  Semantics: Titan Quake Stomp / Seismic Smash are ground AoE around the
  champion hitting BOTH lanes (cross-lane areas are champion-only; card AoE
  stays lane-scoped); Lane Shift flips lane at the same x and clears the
  target; Overclock self-buffs; Phase Dash teleports to the FURTHEST living
  in-lane enemy within aggro range and deals contact damage (charges the
  ult); Final Cut hits the LOWEST-current-health in-lane enemy in aggro
  range and executes—through shields—if the survivor is left below
  `executeBelowHealthFraction` (0.3, in content) of base max health,
  checked AFTER the hit; Stance Shift alternates starting with Bulwark
  (damageTakenMult 0.7) then Assault (+25% damage), each use replacing the
  previous stance modifier; Forge Rally buffs and heals ALL living allies in
  both lanes.
- Digest covers champion identity, cooldown, charge, respawn tick, stance
  count, unit kind and `damageTakenMult`; invariants extended (kind/sub-state
  coherence, cooldown/charge ranges, dead champion keeps health 0 with a
  strictly-future respawn tick, alive champion has none, ≤1 champion per
  team) and stay [] in every test battle.
- Live path: `createLiveBattle` gains `playerChampionId`; when set, the
  opponent fields a champion picked deterministically via the existing
  `opponentRng` (recorded in the config so replays reproduce it; the RNG
  stream of champion-less battles is untouched). `queueChampionAbility` /
  `queueChampionUltimate` pre-validate and queue for the NEXT tick (same
  replay-exact pattern as deploys); store actions `championAbility` /
  `championUltimate` surface rejections as toasts. Battle screen passes the
  saved champion (`save.player.championId`, roster-fallback if invalid).
- UI: champions render as larger path-colored markers with wider health bars
  (lane-strip); new `ChampionHud` shows champion name + prominent health,
  ability button with cooldown seconds, ultimate button with charge % and a
  respawn countdown while down. `src/app/champions.tsx` (select-and-persist
  cards, current selection highlighted, DETAILS links),
  `src/app/champion/[id].tsx` (full stats/abilities, static params for all
  four), lobby 'Champions' button. `second-wind` is now genuinely playable
  on a live champion (M4 limitation closed, tested).
- Balance: `BALANCE_VERSION` 0.2.0; `champion.spawnOffsetFromCore` added and
  validated (with respawn config) in validateBalance. Hybrid stance numbers
  and the execute threshold moved into content effects (`damageTakenMult`,
  `executeBelowHealthFraction` — new optional CardEffects fields).

Verified:
- `npx tsc --noEmit` — clean.
- `npx vitest run` — 7 files, 129 tests passing (102 prior all unweakened +
  27 new): spawn/positions/lane/config-throw, digest sensitivity to every
  champion field, every ability and ultimate's numeric outcomes (stomp
  cross-lane stun incl. enemy champion, smash damage+stun+charge reset,
  lane-shift retargeting both directions, overclock modifiers + expiry,
  phase-dash furthest-target teleport + charge, final-cut lowest-target /
  survive-above-threshold / execute-below / execute-through-shield, stance
  alternation with replacement, rally global buff+clamped heal), charge from
  dealt/taken/core/shields with cap and overkill exclusion, cooldown
  tick-down with exact regate, all rejection reasons (cooldown, uncharged,
  no valid targets — cooldown/charge never consumed), death → untargetable →
  exact-tick respawn with clean state and persisted charge/cooldown, killing
  blow clears attacker targets, 16-matchup matrix headless with zero
  invariant violations, scheduled + live replay fidelity incl. ability and
  ultimate commands (digest-identical reruns), live determinism.
- `npx expo export --platform web` — 15 static routes incl. /champions and
  /champion/[id] + all four champion pages via generateStaticParams.

Known limitations:
- The scripted opponent never uses its champion's ability or ultimate — its
  champion only auto-fights. Opponent AI depth is M6.
- A champion respawns in the lane it died in (e.g. a lane-shifted Speedster
  revives in the shifted lane) — deliberate: 'beside own core' fixes x, and
  cores are lane-agnostic.
- HUD/selection screens verified via typecheck + web static export only —
  same no-device gap as M1–M4.

---

## Milestone 6 — AI and autobattler depth (2026-07-22) ✅

Built:
- **Synergy aura layer** (`game-engine/synergies/synergies.ts`) — per the
  engine review, synergies are a RECOMPUTED aura, not accumulating timed
  modifiers: `recomputeAuras` runs once per (team, tick) at the END of the
  tick pipeline (new step 10), deriving the active set from LIVING team
  composition (units + champion; card/champion content tags; copies count;
  'mixed-paths' counts DISTINCT avatar-path tags). The whole next tick
  consumes that one snapshot uniformly — O(living units)/tick. Consumers:
  `armorFlat` flat per-hit reduction in `damageUnit` for FRONTLINE
  combatants (rule: melee, `base.isRanged === false` — needs no content
  lookup mid-combat and every shipped champion qualifies), minimum 1 damage
  per hit, applied before shields; `healingMult` scales every `healUnit`
  (healer beams, card heals, rally, augment pulses) via a new optional
  multiplier parameter; `moveSpeedMult`/`attackDamageMult` fold into
  `effectiveStats` via a new optional aura parameter (tick/targeting pass
  `state.auras[team]`; omitting it keeps pre-M6 behaviour for tests).
  Auras are DERIVED state — recomputable, so NOT digested; transitions are
  logged 'synergy-on'/'synergy-off' and shown as chips near each core bar.
- **Opponent AI** (`features/arena/opponent-ai.ts`) — replaces the M3 drip
  script. Lives OUTSIDE the sim: reads state, consumes the seed-derived
  `opponentRng`, queues ordinary validated commands for the next tick, so a
  recorded commandLog replays digest-identically without the AI. Heuristics
  (tunables in `BALANCE.ai`): lane-threat scoring (enemy units past midline
  weighted by health+shield, depth, DPS) → role-appropriate defence from
  HAND (swarm → AoE technique on the densest clump or bulkiest blocker;
  tank → highest damage; fast runner → ranged counter), heals the most
  wounded ally (champion heals incl.), buffs/shields the frontmost pusher,
  deploys healer/shielder fighters behind a push, pressures the weaker
  enemy lane with an energy reserve at higher tiers, champion ability when
  combat is nearby + validation passes, ultimate on clump/core-threat/held-
  full-too-long. Difficulties 'training'|'standard'|'advanced' differ ONLY
  in decision quality (interval/jitter, reserve, deterministic-RNG mistake
  chance = wrong lane + random card, technique/champion usage, augment
  delay); training is non-reactive (no counters/techniques/champion, random
  lanes) and proven beatable by test. NO stat modifications anywhere.
- **Mid-match augment** — `content/augments.ts` (6 data-driven augments:
  +10% damage, +15% speed, +10% energy regen, 40-heal pulse per 10s, +150
  core repair, 100-shield on deploy; validated in content validation). At
  `BALANCE.augment.offerTick` (90s) each team is offered 3 of 6, drawn from
  the battle RNG in fixed team order (digest-affecting, by design). New
  `choose-augment` command: only after the offer, only from the own offer,
  once per team, rejected-never-thrown; one-shot core repair applies at
  choice, ongoing bonuses fold into the aura layer, heal pulses anchor at
  the choice tick. Offered/chosen ids + choice tick ARE state → digested;
  invariants check offer/choice coherence + aura shape. The AI always
  chooses (content order = deterministic priority) shortly after the offer.
  UI: non-blocking 3-option picker at the top (battle continues), dismiss/
  reopen pill until chosen; chosen augment appears as a chip.
- **Combat feedback** — engine emits structured 'fx' log entries
  (hit/heal/death with lane/x/amount/team) from the single damage/heal
  choke points; the arena screen converts the log delta since the last
  frame into capped (12), 700ms floaters rendered inside LaneStrip (plain
  Views aged per existing per-frame re-render — no Animated, no per-unit
  state churn) — floating damage/heal numbers + a death '✕' fade. Tapping
  an unaffordable card now surfaces the energy toast (cards are no longer
  silently disabled).
- **Tutorial** — `/tutorial` route runs the shared arena screen
  (`features/arena/components/arena-screen.tsx`, extracted from battle.tsx)
  vs the training AI with an overlay step sequencer (deploy → technique →
  ability → ultimate → win condition) that advances when the matching
  player command appears in the commandLog; skippable at any time. Lobby
  gains a Tutorial button — rendered as the primary CTA when
  `stats.battlesPlayed === 0` — plus a persisted difficulty selector.
- **Save v2** — `settings.aiDifficulty` added via the documented MIGRATIONS
  pattern (v1→v2 preserves fields, rebuilds malformed settings; invalid
  difficulty values fail validation into recovery). Balance 0.4.0 with
  `augment` + `ai` config blocks, all validated in `validateBalance`.

Verified:
- `npx tsc --noEmit` — clean.
- `npx vitest run` — 13 files, 208 tests passing (all pre-M6 tests
  unweakened + 52 new): synergy counting incl. champion tags/copies/
  mixed-paths distinctness, death-deactivation + redeploy-reactivation with
  logged transitions, armorFlat math (flat reduction, min-1 floor, melee-
  only, before shields), healingMult math (direct/card/healer under
  cooldown), aura folding into effectiveStats + real march speed,
  derived-not-digested proof, purity of computeTeamAuras; augment offer
  determinism + exact-3-distinct-known offers, all rejection paths (before
  offer/wrong id/double choose/malformed id/scheduled), every effect kind's
  numbers (core-repair clamp, regen mult from next tick, pulse timing,
  deploy-shield after fold only, team-aura folds), digest inclusion (choice
  changes digests; same choice reproduces); per-difficulty AI battles
  headless to completion — deterministic (same seed → same digest), zero
  invariant violations, rejected === [] (AI emits only valid commands),
  replay digest-identical through runBattle WITHOUT the AI, mid-battle
  no-cheating sweep (every modifier traces to a played card/champion
  ability/augment; energy bounded by regen), training-only-fighters vs
  standard/advanced technique+ability+ultimate usage, deterministic augment
  pick incl. delay and once-only, full live battle with AI + augments +
  synergies replaying digest-identically, same-script-beats-training-loses-
  to-advanced; save v1→v2 migration (fields preserved, malformed settings
  rebuilt, invalid difficulty recovered, default is v2).
- `npx expo export --platform web` — 18 static routes incl. /tutorial.

Deviations from the brief:
- The min-1-damage armour floor is an engine constant, not a balance entry —
  it is a rule of the armour mechanic; the armour VALUES are the tunables
  (content synergies/augments).
- `effectiveStats` takes an optional aura parameter instead of reading
  state (keeps the signature usable by tests/max-health clamp paths where
  auras are irrelevant); every combat call site passes the team aura.
- The AI keeps the M5 `opponentRng` seed-derivation and champion-pick
  stream, so champion-battle configs stay reproducible; the M3
  `nextOpponentActionTick` field moved into an `ai` runtime block.

Known limitations:
- Aura armour (like the pre-existing Bulwark `damageTakenMult`) can blunt
  Final Cut's execute follow-up — an armoured frontliner may survive an
  'executed' hit with a sliver of health (documented in KNOWN_ISSUES).
- AI-only battles vs a passive player end before the 90s augment offer, so
  augment behaviour is exercised via defended battles and engine tests with
  an early offer tick (balance is a parameter — same shipped code path).
- Floaters/picker/tutorial verified via typecheck + web static export only —
  same no-device gap as M1–M5.

---

## Milestone 7 — Progression bridge (2026-07-22) ✅

Built:
- `src/game-engine/balance/fitness-scaling.ts` — pure fitness→combat mapping:
  each Evo sub-rating shapes exactly one champion trait (strength→attack
  damage, cardio→ability cooldowns, muscularity→max health, leanness→speed,
  aesthetics→ultimate charge rate). Each stat confined to 1/5 of the total
  advantage budget so a maxed profile lands exactly on the ranked cap
  (`fitness.rankedMaxTotalAdvantage` = ±12%, inside the mandated 10–15%
  band), with a defensive proportional re-cap and clamping of garbage input.
  The engine sees plain ratings only — FitnessProfile never crosses into
  game-engine.
- Engine wiring: `BattleTeamConfig.championScaling` (part of BattleConfig →
  replays reproduce it exactly); `spawnChampion` bakes all multipliers at
  spawn (stats, scaled ability-cooldown duration, scaled charge rates) so
  combat/tick/events never consult scaling again. AI opponents always fight
  neutral.
- Provider-boundary flow: the arena screen fetches the FitnessProfile via
  `playerProvider.getCurrentPlayer()/getFitnessProfile()` (never from save/
  UI state), computes capped scaling, and passes it through battle options;
  graceful neutral fallback if the profile is unavailable.
- `src/app/dev-fitness-editor.tsx` — edit all five sub-ratings (Evo Rating
  derives from them), Forge Level, Avatar Path/Stage; live-previews the
  champion effect with the same computeFitnessScaling used in battle, so
  editing fitness changes the Champion predictably by construction.
- `src/app/rank.tsx` — tier ladder, progress to next tier, record; explains
  the Rank / Evo Rating / Forge Level separation. Lobby links to Rank and
  the dev editor. (Rank itself already flowed through
  recordBattleResult/rank tiers since M3/M1.)
- `src/services/progression/rank.ts` — tier resolution with boundary tests.

Verified:
- `npx tsc --noEmit` clean; `npx vitest run` — 13 files, 213 tests passing
  (20 progression tests: cap exactness both directions, per-stat budget,
  monotonicity, garbage clamping, spawn-stat exactness vs an unscaled
  reference, scaled cooldown application, JSON round-trip replay
  determinism, neutral-scaling equivalence, rank boundaries).
- `npx expo export --platform web` — 18 routes incl. /rank and
  /dev-fitness-editor.

Known limitations:
- Forge Level gating (card/mode unlocks) is intentionally light in the beta:
  it is displayed and editable but does not yet lock content — unlock tables
  belong to the M10 balance/content pass.
- Avatar Path currently informs identity (champion selection default,
  colors); it does not force the champion choice.

---

## Milestone 8 — Ghost battles and replay (2026-07-22) ✅

Built (no gameplay numbers changed — `balanceVersion` stays 0.4.0):
- **Recording** — when a battle finishes, the battle store builds a
  BattleRecord (schema v1, the existing M2-era type) and persists it through
  the new `src/services/persistence/battle-records.ts`: a ring buffer of the
  last 10 records under one storage key, versioned envelope
  `{version:1, records:[...]}`, backed by the `KeyValueStorage` interface
  (AsyncStorage in the app via a lazily-imported storage ref — the same
  pattern as the provider ref — MemoryStorage in tests). Fail-safe like the
  save system: corrupt/missing data loads as an empty list, a NEWER envelope
  version is refused on load AND append never clobbers it, invalid records
  inside a valid envelope are dropped individually. BattleRecord gained two
  OPTIONAL fields only — `recordId` (storage lookup) and `debug`
  `{rejectedCount, mode, aiDifficulty}` — `parseBattleRecord` keeps accepting
  records without them and strictly validates them when present. Standard
  battles record snapshots from the provider profile + `ai-<difficulty>`;
  tutorial battles are NOT recorded; ghost battles ARE recorded (mode
  'ghost', snapshots derived offline from the source record). Writes are
  serialized through a promise chain and best-effort (a storage failure
  never breaks the battle flow).
- **Ghost battles** — fight a past self. `src/features/arena/ghost.ts`
  transforms the PLAYER side of a record into a pre-scheduled opponent
  command list: team swap on every command, deploy x mirrored across the
  lane axis (`x' = laneLength - x`, lane unchanged, ticks kept — the player
  zone maps exactly onto the opponent zone, proven at both boundaries);
  champion-ability/ultimate/play-card transform by team swap only;
  choose-augment re-picks deterministically the FIRST id of the ghost's OWN
  offer (offers are RNG-drawn per seed), predicted at build time by running
  the real `offerAugments` draw against a scratch battle. Ghost config:
  fresh seed, opponent = the record's player deck/champion/lane/SCALING (a
  ghost preserves its fitness-derived build) under `ghost-<original id>`.
  The commands are merged into the live commandLog at start and applied by
  the engine's normal command path — no AI runs (`LiveBattle.opponentKind`),
  and commands the sim rejects (energy/hand/cooldown divergence vs the
  original battle) are recorded rejections while the battle continues —
  reliability over fidelity (see KNOWN_ISSUES). Fully offline: `startGhost`
  touches neither provider nor network, and moves no rank points. Store API:
  `startGhost(record, seed, playerId?, options?)`, rejected-never-thrown;
  `/battle?ghostId=<key>` starts one from the UI (unusable record → clear
  error state, never a silent fallback to a standard battle).
- **Replay viewer** — `/battle-log` lists stored records newest-first
  (opponent, outcome, date, mode/difficulty chips, stale-balance marker,
  empty state) with Watch Replay and Fight Ghost actions; lobby gained a
  Battle Log button. `/replay?id=<key>` VERIFIES the record first
  (`verifyBattleRecord` — a tampered or cross-balance record shows a clear
  error state instead of playing), then plays it back with the read-only
  arena visuals (LaneStrip/CoreBar/SynergyChips) driven by the pure
  `src/features/arena/replay-player.ts`: a local BattleState advanced by
  `advanceTick` over the record's schedule — prepared by the SAME
  `prepareCommandSchedule` the headless runner uses (extracted from
  `runBattle`, refactor-only) — on a wall-clock accumulator timer at
  20 ticks/s x speed. Controls: play/pause, 1x/2x/4x, restart, tick/endTick
  progress bar. No store singleton involved.
- **Debug data** — replay viewer dev overlay shows seed, tick, digest-so-far
  and rejected count (the arena dev readout also gained the live rejected
  count); the debug screen gained a battle-records section (count, size
  estimate, clear-records with confirmation).

Verified:
- `npx tsc --noEmit` — clean.
- `npx vitest run` — 16 files, 242 tests passing (all 213 prior unweakened +
  29 new): ring-buffer persistence (cap at 10 with oldest dropped, corrupt
  envelope/garbage/throwing storage → empty list, newer-version refusal on
  load AND append-no-clobber, per-record validation inside a valid
  envelope); a record built from a finished store battle verifies
  (`verifyBattleRecord ok:true`) and includes balanceVersion + seed
  (acceptance criteria) with provider-profile snapshots and a correct debug
  block; one record per battle, appended across restarts; tutorial battles
  not recorded (but still reported to the provider as mode 'tutorial');
  optional-field parsing (accepted absent, round-tripped present, malformed
  rejected); ghost transform correctness (team swap, tick preservation,
  opponent/malformed-entry filtering, x mirroring with boundary x=0 and
  x=deployZoneDepth proven VALID opponent deploys, source record never
  mutated, deck/champion/lane/scaling carried under ghost-<id>, augment
  re-pick = first of predicted own offer ≠ recorded id); full ghost battle
  headless to completion with zero invariant violations, digest-identical
  rerun through runBattle and zero rejections in the deckless case; ghost
  determinism (same record + seed → same digest); runtime augment re-pick
  (the ghost chooses the first id of its own runtime offer at the recorded
  tick); ghost battles offline (a throwing provider records ZERO calls while
  a verifying ghost-mode record still persists via MemoryStorage); startGhost
  failing safely on stale-balance records without touching store state;
  replay-player stepping (chunk sizes 1/2/4/7/20 all reproduce the one-shot
  runBattle digest/outcome/endTick, stepping past the end is a no-op,
  restart reproduces playback, invalid configs fail without throwing).
- `npx expo export --platform web` — 20 static routes incl. /battle-log and
  /replay.

Deviations from the brief:
- Ghost battles are also persisted as battle records (the brief pinned down
  standard=recorded and tutorial=not, leaving ghosts open): they verify like
  any record, power the mode chips in the battle log, and enable replaying
  or re-fighting a ghost run. Their provider path stays untouched (offline,
  no rank movement — you cannot farm progression off your own ghost).
- `BattleResult.mode` now reports 'tutorial' for tutorial battles (was
  always 'standard'); the type already had the value and the provider treats
  all modes identically, so stats/rank behaviour is unchanged.
- `startGhost` takes `(record, seed, playerId?, options?)` rather than the
  brief's `startGhost(record)` — same injectable-seed/player pattern as
  `start` since M3, so tests control determinism; the app calls it with a
  random seed and the saved player exactly as `start`.

Known limitations (added to KNOWN_ISSUES.md): ghost hand-cycle fidelity
under fresh-seed shuffles, stale play-card target ids, the augment-offer
prediction invariant, structural-only validation on ghost start, no combat
floaters in the replay viewer, and the usual no-device verification gap.

---

## Milestone 9 — Gym Champions (2026-07-22) ✅

Built (`balanceVersion` 0.5.0 — new gameplay mechanics; `BALANCE.gym` block:
`maxBorrowed`, `contributionPerWar`, `contributionWinBonus`, all validated):
- **Provider boundary (gyms)** — the local player belongs to seed gym
  'forge-district': `getGymProfile` returns it with the player in
  `memberIds`. Boundary extended minimally with `GymMemberInfo`
  (`{playerId, displayName, fitness}`) + `getGymMembers(gymId)` (own or
  rival roster, rejects unknown ids) + `listRivalGyms()` (war opponents,
  never the own gym); `BattleResult` gains an optional `gymWar`
  `{enemyGymId, fieldedMemberIds}` attribution block (mode 'gym-war' only).
  The mock implements everything from `services/gyms/gym-data`; screens
  never import gym-data directly (documented in EVOFORGE_INTEGRATION.md).
- **Engine — multi-champion squads** (the core change): the
  one-champion-per-team invariant is relaxed to *at most one COMMANDABLE
  champion per team* (the captain) plus up to `BALANCE.gym.maxBorrowed`
  (3) borrowed AUTO champions. `ChampionState` gains `commandable`
  (digested) and `spawnX` (respawn slot, config-derived — not digested).
  `champion-ability`/`champion-ultimate` route via the new
  `findTeamCaptain` (events, live controller AND the opponent AI — the AI
  commands its captain only). `BattleTeamConfig` gains an optional `squad`
  `{captain: {championId, scaling?}, borrowed: [{championId, scaling?,
  lane, displayName?, sourcePlayerId?}]}` which supersedes the legacy
  `championId`/`championLane`/`championScaling` fields; legacy configs
  normalize to a captain-only squad (`normalizeTeamSquad`) and produce
  IDENTICAL digests (tested) — every pre-M9 record/config still verifies.
  createBattle throws on >maxBorrowed, unknown ids and invalid lanes
  (replay loaders already wrap it fail-safe). Borrowed spawn captain-first
  in their configured lanes, staggered one `unitSpacing` per slot BEHIND
  the captain's offset (mirrored for the opponent) so nothing stacks;
  respawn revives each champion at its own `spawnX` — identical mechanics
  for captain and borrowed (tested).
- **Borrowed auto-cast** — in the tick pipeline's unit-action loop, an
  alive, non-stunned, non-commandable champion with its ability off
  cooldown casts it automatically whenever `validateChampionAbility`
  passes (validate → pay → apply; a no-target tick never wastes the
  cooldown). Engine-driven and deterministic — no AI, no RNG — so replays
  reproduce auto-casts by construction ('auto-ability' log entries).
  Borrowed champions NEVER use ultimates: charge accrues via the generic
  combat hooks but is never spent (simplified build, see KNOWN_ISSUES).
  Stun suppresses auto-casts (engine-driven unit behaviour, unlike captain
  commands which remain usable while stunned).
- **Squads + fitness builds** — `features/gyms/squad.ts`: borrowed member →
  champion via `getChampionByPath(fitness.avatarPath)`, scaling via
  `computeFitnessScaling` of the member's own sub-ratings (same capped
  mapping as the player captain — 'simplified fitness-derived build');
  displayName + sourcePlayerId carried in config for UI/records; lanes
  alternate deterministically starting opposite the captain. Champion role
  titles (`computeMemberRoles`/`roleLabelsFor` over provider data, wrapping
  `computeGymChampions`). Borrowing never mutates the owner (pure reads,
  proven by test).
- **Gym War (async, local)** — `features/gyms/gym-war.ts` builds the enemy
  auto-squad: captain = the gym's Overall Champion (path champion +
  fitness scaling from THEIR profile), borrowed = its Strength and Cardio
  Champions (own scalings), deduped by playerId (one person fights once).
  Driven by the existing opponent AI at the saved difficulty via ordinary
  `LiveBattleOptions` (`playerSquad`/`opponentSquad`/`opponentPlayerId`
  'gym-<id>'/`opponentDisplayName`; the deterministic opponent-champion
  RNG pick is skipped when a squad is supplied). Battle mode 'gym-war' in
  the store: provider result mode 'gym-war' + `gymWar` attribution;
  records persist like standard battles with `debug.mode: 'gym-war'`
  (parser accepts the new value; absent debug still parses — backward
  compatible). Ghosts of gym-war records keep their full squad.
- **Contribution stats (save v2→v3)** — `save.gym = {selectedSquad (max 3),
  championStats: Record<memberId, {appearances, wins, warContribution}>,
  warsPlayed, warsWon}` with a documented migration (malformed pre-existing
  'gym' fields rebuilt; malformed v3 blocks recovered). After a gym war
  (via the store's recordResult path → provider): appearances +1 per
  fielded member, wins +1 on victory, warContribution +1 per war +2 extra
  on win — a deliberate deterministic damage PROXY (real attribution needs
  per-unit damage tracking, deferred). MVP = highest warContribution,
  most-used = highest appearances (`services/gyms/contribution.ts`).
- **Screens** (theme tokens + shared primitives; all data via the provider):
  `/gym` (name, member count, your titles, war record, MVP/most-fielded),
  `/gym-roster` (fitness summaries, champion-role badges, WAR MVP /
  MOST FIELDED chips, per-member war stats), `/gym-squad` (pick ≤3 borrowed
  members, per-member champion path + scaling preview, persists
  `selectedSquad` via the player store), `/gym-war` (rival-gym picker →
  shared ArenaScreen in mode 'gym-war'; borrowed champions render as
  smaller path-colored rings with initials while the captain keeps the big
  marker; result overlay shows the fielded members' contribution summary;
  fail-safe error state, never a silent standard battle). Lobby gained a
  Gym button; battle-log chips show GYM-WAR via the debug mode.

Verified:
- `npx tsc --noEmit` — clean.
- `npx vitest run` — 17 files, 276 tests passing (all pre-M9 tests
  unweakened; the only touched expectations were the three provider fakes
  gaining the two new interface methods and the 'default save is v2' →
  current-version assertion, both mechanical consequences of the boundary/
  schema extension): squad spawn geometry incl. opponent mirroring and
  no-stacking, >3-borrowed/unknown-id/invalid-lane rejection at creation,
  ≤1-commandable + ≤3-borrowed invariants (state-surgery violations
  detected), digest sensitivity to `commandable`, legacy-config ≡ squad-
  config digest equality, captain-only routing (borrowed cooldowns
  untouched; downed captain rejects while borrowed live), auto-cast
  (fires when valid, exact cooldown regate, no-target never wastes,
  never ultimates with charge pinned at cap, captain never auto-casts,
  stun suppresses), borrowed respawn at its stagger slot with clean state,
  full-squad headless determinism + JSON-round-trip replay, squad builder
  correctness (path champion + exact member scaling + lanes + metadata),
  enemy-squad role selection + dedupe (real gyms and synthetic
  all-titles-one-member roster), borrowing-never-mutates proof, full live
  gym-war vs the standard AI to completion with per-tick invariant checks
  and a digest-identical runBattle replay, store-level gym-war flow
  (result mode + gymWar attribution + verifiable record with gym display
  name), contribution helper + provider stat updates (win/loss sequences,
  other modes untouched), save v2→v3 (+v1 chain, malformed 'gym' variants,
  recovery), provider gym boundary (membership, roster parity, unknown-gym
  rejection, rival listing).
- `npx expo export --platform web` — 24 static routes incl. /gym,
  /gym-roster, /gym-squad and /gym-war.

Deviations from the brief:
- `BattleResult` gained the optional `gymWar` attribution block: the brief
  routed contribution updates "via the battle store's existing recordResult
  path", and the store's recordResult path IS the provider call — passing
  the fielded members through the result keeps the battle store free of
  player-store imports and gives the future backend the same attribution
  data. Documented in EVOFORGE_INTEGRATION.md.
- The provider also gained `listRivalGyms()` (the brief only named
  `getGymMembers`): the war screen needs rival gym identities/names, and
  fetching them through anything but the provider would violate the
  screens-never-import-gym-data rule.
- Enemy gym captain uses the Overall Champion's own fitness scaling (their
  'simplified fitness-derived build'), same rule as borrowed members — the
  brief specified scaling explicitly only for the borrowed side.

Known limitations (see KNOWN_ISSUES.md): borrowed champions never ultimate;
warContribution is a participation proxy, not damage attribution; a borrowed
Speedster auto-casts Lane Shift on cooldown (always-valid ability); UI
verified via typecheck + web static export only (usual no-device gap).

---

## Milestone 10 — Beta hardening (2026-07-22) ✅ — BETA READY

Built (ultracode: 3 parallel scope-owned agents + Opus 4.8 xhigh audit):
- **Onboarding**: 3-step first-run flow at /onboarding (name → champion pick →
  gameplay primer), exits via Start Tutorial or Skip to Lobby, both setting
  `player.onboardingComplete`; the title screen routes through it until
  complete (pure `resolveEntryRoute` helper, tested); re-runnable from the
  lobby. Save v3→v4 migration makes the flag a validated boolean (pre-M10
  saves migrate as already-onboarded).
- **Feedback tool**: /feedback with Bug/Balance/Idea chips, corrupt-safe
  versioned local log (50-entry cap, mirrors battle-records.ts), history and
  Share-API text export; lobby "Send Feedback" button.
- **Accessibility + device-size pass**: 44pt+ touch targets across every
  interactive element (NeonButton 48), accessibilityRole/label/state on all
  buttons and battle HUD controls incl. lane deploy zones and core bars,
  WCAG contrast audit (small-text uses of textFaint bumped to textDim),
  320pt-width audit clean (flex/percent layouts throughout).
- **Stability harness** (src/tests/stability.test.ts + ai-driver.ts — the
  player side driven by the SAME opponent-AI heuristics over a mirrored
  state view, so the two can never drift): **117 AI-vs-AI matches** across
  3 difficulties x 5 configs x seeds — 117/117 completed, 0 stalls,
  0 thrown errors, 0 invalid outcomes, 0 invariant violations (per-tick
  checks on for 59 matches), 0 rejected commands; avg duration 88s;
  win-rate distribution free of side bias (training 51/49, standard 57/43,
  advanced 43/57); explicit "20 consecutive matches without deadlock"
  sub-test passes with invariants on. Ranked mode: 'ranked' labeling + cap
  guards (services/progression/ranked.ts) with tests that any ranked
  config's total scaling advantage stays within the mandated band.
- **Performance analysis** (measured, phone-derated): worst-case tick cost
  ~0.5–1.3ms against the 50ms budget (~2.6%) — comfortable; replay-open
  verification cost fixed by disabling per-tick invariant audits in
  verifyBattleRecord (digest is the authority); corpse accumulation
  documented as backlog with a living-units-index fix sketch.
- **Audit fixes applied**: replay verification cost, ErrorBoundary around
  the profile screen, onboardingComplete schema/validator lockstep (v4).

Opus 4.8 xhigh audit verdict: **betaReady: true** — all 12 master-prompt
acceptance criteria PASS on evidence the auditor gathered itself (traced
onboard→deck→battle and Gym-War paths end-to-end, ran every suite, spot-
checked fresh record verification, diffed EVOFORGE_INTEGRATION.md against
the actual provider interface, confirmed zero purchase/IAP code, walked the
master prompt's reliability list item by item). No blockers. The M8
digest-attestation deferral confirmed non-blocking for a fully local beta.

Verified (final gates): npx tsc --noEmit clean; npx vitest run — 20 files,
318 tests passing; npx expo export --platform web — 26 static routes.

---

# BETA COMPLETE

All ten milestones executed, verified and committed. The game is a playable
standalone beta: onboard → tutorial → build a deck → pick a champion →
standard/ranked battles vs three AI tiers with synergies, augments and
fitness-scaled champions → ghost battles and replays → gym squads and Gym
Wars — all deterministic, replay-verifiable, and isolated from EvoForge
behind one provider interface documented in EVOFORGE_INTEGRATION.md.

---

# INTEGRATED PHASE (inside EvoForge, client/src/arena-game)

## Overnight hardening run (2026-07-23) — in progress
- Phase 1 audit complete: see ARENA_BETA_AUDIT.md. Headline: champion roster
  must become the official FIVE (Aesthetics, Titan, Mass Monster,
  The Shredder, Cardio Machine); real avatar stages; dev editor demoted.
