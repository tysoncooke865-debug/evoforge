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

## P2+P3 — The official five-champion roster + real progression (2026-07-23) ✅

Built (BALANCE_VERSION 0.6.0, save v5):
- **THE OFFICIAL ROSTER** (audit CRITICAL #1): `AvatarPath` = EvoForge's live
  `BranchV2` slugs minus retired hybrid (`aesthetic|titan|mass|shredder|
  cardio`); five champions with stable slug-aligned ids `champion-<path>`
  and display names PINNED by content validation ("Aesthetics", "Titan",
  "Mass Monster", "The Shredder", "Cardio Machine" — exactly five, one per
  path, both enforced as validation ERRORS). Aesthetics inherits the
  tactician kit (Stance Shift + Forge Rally, ids renamed); Titan unchanged;
  The Shredder keeps Phase Dash + Final Cut under the official name; Cardio
  Machine inherits the tempo kit reflavored + `energyRefund: 1` on Overclock.
- **Mass Monster — NEW kit, tested distinct from Titan** (different stats +
  different ability behaviour class): 1900 HP bruiser with LOWER burst;
  **Gravity Well** (cross-lane ground slow to 60% for 4s — area denial, no
  stun/damage) and **Mass Uprising** (summons two Titan Guards at his
  position, one per lane, via spawnUnitsForCard — a new deterministic
  summon handler; `CardEffects.summon` validated against the card catalog).
- **PASSIVES** — one per champion, data-driven (`ChampionPassiveDefinition`),
  each mapped onto ONE existing engine mechanism, all validated + tested:
  Iron Hide (Titan, 5 flat self-armour in damageUnit, min-1 shared rule);
  Colossal Frame (Mass, ×1.1 max health baked at spawn); Killer Instinct
  (The Shredder, own sourced hits ×1.25 vs targets below 35% — execute-
  adjacent, never ultimates); Perpetual Motion (Cardio, team energy regen
  ×1.05 while ALIVE via the aura recompute); Flow State (Aesthetics, team
  healing ×1.1 while ALIVE). createBattle now seeds the initial aura
  snapshot from real starting composition so passives are live from tick 1.
- **Synergies/tags**: `speedster`→`cardio`, `hybrid`→`aesthetic` across all
  card tags; heavy-tank dual-tagged `titan+mass`; new `mass-presence`
  synergy (2 mass: 4 flat armour); `cardio-momentum` renamed; mixed-paths
  now counts over five. Theme: five path colors (mass = fuchsia #E879F9,
  distinct from titan amber and opponent red).
- **Save v4→v5** (no destructive resets): championId speedster→cardio,
  hybrid→aesthetic, official ids pass, unknown/malformed→titan default;
  mock fitness avatarPath remapped identically, stage clamped to the real
  1–4 ladder; everything else preserved (tested incl. v1→v5 chain).
- **REAL PROGRESSION (audit HIGH #2)**: provider Origin mapping is 5→5
  passthrough (hybrid→aesthetic, null→titan); avatar stage is EvoForge's
  REAL derivation via pure `progression-mapping.ts` reusing domain
  functions (`currentStageFor`): Shredder = body-fat (bodyfat_log latest
  valid bf_mid), others = legacy level (base_level + xp_total() ledger,
  pinned curve). Fallbacks only under-state (ledger null → base level; no
  bf → stage 1). Gym members: path hash over FIVE, stage estimated from
  forge_level, labeled "(EST.)" in the roster UI.
- **Dev editor demoted (audit HIGH #3)**: no lobby button; debug-screen-only
  with a DEV MOCK banner; champion detail screen now lists the athlete's
  five real scaling multipliers (Size pillar naming) — "communicate, don't
  hide".
- **Sprites**: pipeline + CC0 sheet copied into the repo
  (client/assets/arena-pixel-src/, client/scripts/arena-sprite-tools.mjs,
  pngjs devDependency); five champion sprites regenerated with slug
  variants; Mass Monster tile picked via preview survey (col 29 row 2 —
  broadest silhouette, bulkier than Titan's); orphaned speedster/hybrid
  PNGs deleted; registry updated.

Verified:
- `npx tsc --noEmit` clean · `npm test` — 93 files, 1,425+ tests green
  (38 new: five-champion validation + pinned names, Mass kit numerics +
  Titan distinctness, all five passives incl. alive-only aura lifecycle,
  migration v4→v5 + malformed + v1→v5 chain, provider stage derivation
  against a mocked supabase client + pure mapping table, mass-presence
  synergy; 5x5 matchup matrix headless with zero invariant violations;
  stability harness asserts all five champions fielded).
- `npx expo lint` 0 errors · `npx expo export -p web` succeeds (all five
  /forge-arena/champion/[id] routes statically render, incl. champion-mass).
- Added `client/vitest.config.ts` (alias `@`→src only — enables the mocked
  provider test; discovery untouched).

Deviations, documented: records from balance <0.6.0 become cleanly
unplayable (existing gate; KNOWN_ISSUES); ledger-behind-derived athletes
may briefly see an earlier stage (KNOWN_ISSUES); borrowed Cardio Lane Shift
ping-pong deferred to P4 (audit HIGH #5).

## P4 — engine reliability (2026-07-23) ✅

Adversarially-verified findings (all confirmed against the working tree),
every one fixed this phase — none deferred:

- **play-card null/missing target threw instead of rejecting** (HIGH +
  duplicate MEDIUM report): shape guard in `validateCardTarget` before the
  `target.kind` dereference, mirrored in `applyCardEffects`;
  `transformGhostCommands` normalizes non-object targets to
  `{ kind: 'none' }` as defense in depth. The reject-never-throw contract
  holds again on the live ghost path (no try/catch in the 50ms frame loop
  — the throw was a production crash vector from stored records).
- **Schedule entries with valid tick but null/missing command threw**
  (MEDIUM): `prepareCommandSchedule` rejects them up front ('malformed
  command'); `applyCommand` shape-guards the command itself for direct
  `advanceTick` consumers. `RejectedCommand.command` widened to
  `BattleCommand | null` (honest shape for malformed entries).
- **championScaling from untrusted records never validated** (MEDIUM):
  new `isValidChampionScaling` (five fields, finite, engine sanity bounds
  [0.1, 10]) enforced by `validateBattleRecordValue` on every config slot
  (legacy/captain/borrowed, plus minimal squad shape) AND by `createBattle`
  (throws, like deck validation). Kills the Infinity-health-ghost vector
  (`1e999` parses to Infinity; JSON can't carry NaN but partial objects
  multiplied to NaN).
- **Unbounded record.commands length** (LOW — fixed, cheap):
  `MAX_RECORD_COMMANDS` (10,000) cap in `validateBattleRecordValue`;
  refuses O(ticks × commands) stall padding. The per-tick schedule index
  optimization stays deferred (documented in KNOWN_ISSUES P4 section).
- **Borrowed Cardio Lane Shift ping-pong (audit HIGH #5, the mandated fix)
  + the AI's lane-blind champion-ability gate** (MEDIUM): new optional
  `autoCastValidate` on ability handlers + `validateChampionAutoCast`
  resolver (falls back to `validate`; bit-identical for the other four
  champions). Gate rule `laneShiftJoinsCombat`: auto-shift ONLY when the
  current lane has no living enemy within aggro range AND the other lane
  has one within aggro range of the champion's x — shift to JOIN combat,
  never out of it; ping-pong structurally impossible. Wired into
  `autoCastBorrowedAbility` and the opponent AI's `maybeUseChampion`
  (whose enemies-near count was lane-blind — an AI Cardio captain used to
  teleport out of its own fight every 10s). Commanded captain casts stay
  unconditional. Audit item #5 marked RESOLVED.

DIGEST-AFFECTING (no BALANCE_VERSION bump, deliberate): the Lane Shift
gate changes outcomes for squad battles fielding a borrowed Cardio Machine
and for AI Cardio-captain command streams. 0.6.0 shipped in this same
overnight run with zero real player records, so the change rides the
existing 0.6.0 gate rather than burning 0.6.1. Every other fix only turns
former throws/nonsense into clean rejections — zero digest impact for
well-formed battles (full suite green unchanged except new tests).

New regression tests (13): engine.test.ts (malformed schedule commands
reject with null command, applyCommand null/undefined guard);
ghost.test.ts (play-card target null/undefined/primitive rejected without
energy loss; poisoned record runs headless + ghost-transforms with
target normalized; non-finite scaling record fails safely in ghost setup
AND verify); replay.test.ts (command-count cap boundary; scaling
validation incl. the raw-JSON 1e999→Infinity vector, partials, squad
slots); gym-champions.test.ts (createBattle throws on bad scaling in all
three config slots, accepts real fitness scaling; borrowed Lane Shift:
quiet arena → zero shifts ever + cooldown never burned, never shifts out
of an own-lane fight, shifts once to join then holds across multiple
cooldown expiries and re-arms when the fight resolves; commanded captain
stays unconditional); opponent-ai.test.ts (engaged Cardio captain never
queues Lane Shift even with other-lane enemies in range; queues it when
its lane is quiet and other-lane combat is in range).

Verified: `npx tsc --noEmit` clean · `npm test` 94 files / 1,441 tests
green · `npx expo lint` 0 errors (7 pre-existing warnings, none from P4).

### P4 addendum — passives review (2026-07-23)

Dedicated adversarial pass over the five champion passives (armor
stacking, Killer Instinct threshold basis, Colossal Frame across respawn,
alive-only aura timing, initial aura seeding, summons × deploy-shield).
Every claim probed numerically before verdict; full detail in
KNOWN_ISSUES.md ("P4 addendum — passives review").

- ONE fix: `createBattle` now seeds auras via `recomputeAuras` so
  synergies active from spawn log their tick-0 'synergy-on' (previously a
  silent activation produced an orphan 'synergy-off' on a later death).
  Log-only; the log is not digested — zero digest impact for any battle.
- Six regression tests added (five-champions.test.ts): armour
  stacking/min-1 (8+5→17, floor at 1), Killer Instinct baked-max basis
  (boost at 700/2090, none at 800, none sourceless), Colossal Frame
  respawn (1045 → healable to 2090, never re-baked), Perpetual Motion
  snapshot timing (respawn tick ×1, next tick ×1.05), summons inherit
  deploy-shield + count for synergies, tick-0 synergy-on logging.
- Verdicts elsewhere: armor/Killer Instinct/Colossal Frame/seeding all
  correct; aura one-tick latency intended + now quantified (≈0.0009
  energy per respawn, deterministic); execute-blunting and summon
  behaviour already documented, re-confirmed.

Gates: `npx vitest run src/arena-game` 22 files / 376 tests green ·
`npx tsc --noEmit` clean (arena introduces no errors) · `npx expo lint`
0 errors (6 pre-existing warnings, none in files this pass touched).

---

## P5 — stability @ five champions (2026-07-23) ✅

Extended `__tests__/stability.test.ts` (no new files) to close the P5 bar:
the full 5x5 champion matchup matrix, squads that guarantee borrowed
Mass/Cardio, ghost battles (record → transform → replay), and the
maxTicks/timeout outcome paths, all folded into the same harness so the
per-champion stat table covers the whole run. Zero defects found — every
category terminated cleanly on the first pass; no engine fix was needed.

**Match counts by category (default run — no `ARENA_STABILITY_DEEP`):**

| category | matches | seeds/tiers |
|---|---|---|
| base M10 set (full/decks-only/free-pool/squads/scaled + cross-difficulty) | 117 | unchanged from M10 |
| 5x5 champion matchup matrix (`matchup`) | 75 | 25 pairs × 3 AI tiers × 1 seed |
| squads w/ guaranteed borrowed Mass + borrowed Cardio (`squad-mass-cardio-borrowed`) | 9 | 3 tiers × 3 seeds |
| maxTicks/timeout outcome paths (`timeout-draw`, `timeout-decisive`) | 2 | deterministic, no AI/commands |
| **AI-vs-AI + engine subtotal** | **203** | |
| ghost battles (record → transform → replay) | 5 | 1 per official champion @ standard |
| **total** | **208** | |

`ARENA_STABILITY_DEEP=1` widens the sweep to 383 AI-vs-AI/engine matches
(225 matchup + 18 squad-borrowed, 3 seeds each) + 30 ghost battles (every
tier × 2 seeds per champion) — gated behind the env var per the P5 brief;
the default run alone clears the 100+ bar by 2x.

Every match (both modes) asserts: terminates inside the engine backstop
(zero stalls), zero invariant violations (per-tick checks on all 145
default / all new-category matches, not just the M10-era 50% sample), zero
thrown errors, a structurally valid outcome, and — on the matchup, ghost
and consecutive-run subsets plus a dedicated determinism test — replay
digest identity (`runBattle` on the recorded command log reproduces the
live digest exactly). The borrowed-Mass-never-ultimates rule is asserted
directly from the log (see below), not just implied by engine design.

**Per-champion aggregate stats (default run, Phase 8 balance-pass input):**

| champion | fielded | win% | avg ticks (s) | avg dmg out* | ults | summons |
|---|---|---|---|---|---|---|
| champion-aesthetic | 73 | 37% | 1652 (82.6s) | 4892 | 97 | 0 |
| champion-titan | 63 | 56% | 1702 (85.1s) | 5687 | 62 | 0 |
| champion-mass | 62 | 63% | 1696 (84.8s) | 5711 | 72 | 144 |
| champion-shredder | 58 | 48% | 1761 (88.1s) | 5672 | 91 | 0 |
| champion-cardio | 62 | 48% | 1601 (80.0s) | 5337 | 93 | 0 |

\* "avg dmg out" is a **team damage-output proxy**, not per-unit
attribution: the `fx` log carries `hit|lane|x|amount|targetTeam` with no
source id, so it sums damage landed on the OTHER team for every match this
champion's side fielded — an honest, reproducible number for the balance
pass, but it includes fighters/cards/summons on that side, not the
champion's own hits in isolation. Ultimate cast counts and summon counts
ARE exact (every `'ultimate'` log line is authored
`${champion.contentId}#${id} …`, parsed directly). Mass Monster's
Mass Uprising fired 72 times across 62 matches fielded (144 Titan Guards
summoned, 2 per cast, matching the pinned content constant) — the highest
win rate of the five (63%) at this pass, worth flagging for Phase 8
balance even though nothing here is a defect.

**Defects found: none.** Across 208 matches (383 + 30 under
`ARENA_STABILITY_DEEP=1`) spanning every required category: 0 stalls, 0
thrown errors, 0 invariant violations, 0 invalid outcomes, 0 borrowed-
champion ultimate casts, 100% digest-identical replays (matchup
determinism test + all 5/5 default ghost battles + the pre-existing M10
determinism/replay tests). The engine held up cleanly on the first run;
no fix was needed and KNOWN_ISSUES.md is unchanged.

**New assertions added** (`stability.test.ts`): full 5x5×3-tier matchup
coverage (asserts all 75 combinations present, not just a count); borrowed
champions (incl. Mass) never cast an ultimate, checked across every
squad-shaped match in the run via log-parsed actor ids; the two
maxTicks-path fixtures resolve to the correct outcome/endTick
(`timeout-draw` → draw at duration+suddenDeath ticks via full sudden
death; `timeout-decisive` → `timeout-core-health` at exactly the duration
tick); ghost-battle pipeline (per-champion record capture → transform →
full AI-driven replay → digest-identity through `runBattle`).

Gates: `npx vitest run src/arena-game` — 22 files, 382 tests green (up
from 376; all pre-P5 tests unweakened) · `npx tsc --noEmit` clean (one
switch-exhaustiveness fix needed for the two new engine-only config kinds,
no arena regressions) · `npx expo lint` 0 errors (7 warnings — 5
pre-existing + 2 new "unused eslint-disable directive" on the P5 console
reports; `no-console` is not an active rule anywhere in this project's
eslint config, so the pre-existing directive at the same call site was
already inert before this pass — matching the master prompt's instruction
to reuse "the harness's existing console reporting pattern", not a new
class of warning).

**Runtime**: `stability.test.ts` alone — 5.81s test time (default),
10.28s (deep). Full `src/arena-game` suite — 8.31s test time / 9.83s wall
(default). Both far under the ~120s budget with no gating needed for the
default run; `ARENA_STABILITY_DEEP=1` exists per the brief but isn't
required to hit the 100+ bar or stay inside budget.

## P6 — combat feel (2026-07-23) ✅

Visual-only pass: battles now telegraph hits, deaths, ability/ultimate
casts, summon/deploy arrivals and core damage without touching the
simulation. Zero engine/content edits — every new effect is derived from
log entry types the engine already wrote for other reasons (`fx`,
`ability`, `ultimate`, `spawn`) or, for core hits, a before/after
comparison of the (already-rendered) core health. No digest impact:
nothing new is logged, nothing new is read that wasn't already part of
`BattleState`.

**The derivation pattern** — a new pure module,
`features/arena/components/combat-fx.ts`, extends the pre-existing M6
floater pattern instead of inventing a new one:

- `deriveCombatSignals(log, fromIndex, unitLookup)` scans the log delta
  once per frame and returns raw signals only (lane/x/team/label/color,
  no timestamps) — floaters (hit/heal/death, replacing the inline parsing
  that used to live in arena-screen.tsx's `collectFloaters`), hit pings
  (for the unit flash), ability/ultimate telegraphs (resolved to the
  caster's CURRENT position via a small id→position lookup built fresh
  each frame from `state.units`) and spawn signals (deploy landings AND
  Mass Uprising Titan Guard arrivals — both go through the engine's
  `spawnUnitsForCard`, which logs one identical `'spawn'` entry either
  way, so one signal kind covers 2d and 2f).
- `latestMatchingHit(lane, x, team, hits, toleranceX)` matches a unit's
  CURRENT position against recent hit pings by proximity — the `fx hit`
  log entry carries no unit id, only lane/x/(defending) team, so a unit
  that moved slightly since being struck still flashes correctly.
- `deriveCoreHitIntensity(prevHealth, nextHealth, maxHealth)` compares
  two consecutive core-health snapshots (cores mutate in place and carry
  no history of their own) to decide `'none' | 'normal' | 'severe'`
  (severe = at/below 25% max health) — the only derivation here that
  ISN'T a log scan, because core damage was never logged as an event.
- The component layer (arena-screen.tsx's `collectCombatFx`,
  lane-strip.tsx, core-bar.tsx) does exactly what it always did for
  floaters: timestamp new signals with `Date.now()` when first observed,
  age/prune/cap them every ~50ms render, render purely from age — no
  `Animated` values, no per-unit React state, `'use no memo'` unchanged
  on arena-screen.tsx/lane-strip.tsx.

**Effects implemented:**
- **a. Hit flash** — a unit struck this frame gets a brief (150ms,
  `HIT_FLASH_TTL_MS`) white overlay clipped to its own sprite/dot box,
  never the health bar above it.
- **b. Death dissolve** — the death floater ('✕') now pairs with a
  fading, shrinking ring (`Floater`'s death branch in lane-strip.tsx) —
  reads as "gone" instead of just another number.
- **c. Ability/ultimate telegraphs** — an expanding ring + the ability's
  real name (from content: `champion.ability.name` /
  `champion.ultimate.name`) in the champion's path color at the cast
  position; ultimates ring bigger and hold longer
  (`TELEGRAPH_TTL_MS`/`TELEGRAPH_MAX_RING_PX`: ability 450ms/30px vs.
  ultimate 700ms/50px).
- **d. Summon arrival** — Mass Uprising's Titan Guards get the same
  landing poof as (f) below (see the spawn-signal note above).
- **e. Core hits** — the Forge Core sprite shakes (decaying sine, 2-3
  oscillations) and flashes (white, or red once at/below 25% health) on
  every hit this frame, via `CoreBar`'s new optional `hit` prop
  (`CoreHitFlash { ageFrac, severe }`, aged the same way as everything
  else — `CORE_HIT_TTL_MS` = 220ms).
- **f. Deploy feedback** — a quick expanding ring in the deploying
  team's color where a card lands in the deploy zone.
- Idle bob (task item 3, "allowed only if…") was deliberately **not**
  added — see KNOWN_ISSUES.md.

**Readability**: every new effect's TTL is ≤ 700ms and the hit-flash is
capped at 150ms per the brief's "never obscures for more than ~150ms"
rule; each category has its own cap (`HIT_PING_CAP` 12, `TELEGRAPH_CAP`
4, `SPAWN_POOF_CAP` 8 — `FLOATER_CAP` 12 unchanged), same "newest wins"
rule the pre-existing floater cap already used.

**Perf**: one log scan per frame (unchanged from before — floaters used
to scan the same log separately; `collectCombatFx` now does it once for
every category), plus O(units × recent hit pings) proximity checks for
the flash (both bounded small numbers). No new timers, no new Animated
drivers — the existing 50ms battle-store loop is the only clock any of
this reads.

**Files touched**: `features/arena/components/combat-fx.ts` (new, pure
derivation + tests), `features/arena/components/lane-strip.tsx` (hit
flash, telegraph/poof rendering, death dissolve, new optional props),
`features/arena/components/core-bar.tsx` (hit shake/flash, new optional
`hit` prop), `features/arena/components/arena-screen.tsx`
(`collectFloaters` replaced by `collectCombatFx`, core-hit tracking,
wiring the new props into `CoreBar`/`LaneStrip`).
`screens/replay.tsx` is untouched (it already renders `LaneStrip`/
`CoreBar` without floaters at all — the new props are optional so
replay's visuals are unchanged, not regressed).

**Tests**: `__tests__/combat-fx.test.ts` (new, 27 cases) —
`deriveCombatSignals` for every entry type (fx hit/heal/death incl.
malformed/unknown-kind entries, ability/ultimate incl. unresolvable-
caster and unknown-champion fallback, spawn incl. malformed, incremental
`fromIndex`/`nextIndex` scanning, unrelated log types produce nothing),
`latestMatchingHit` (lane/team/tolerance/most-recent-wins/no-match) and
`deriveCoreHitIntensity` (none/normal/severe/zero-maxHealth defensive
case).

Gates: `npx vitest run src/arena-game` — 23 files, 409 tests green (up
from 382) · `npx tsc --noEmit` clean, zero arena errors · `npx expo lint`
0 errors (7 pre-existing warnings, none in touched files) ·
`node scripts/verify-motion.mjs` OK (14 looping components, all gated —
unchanged; none of the new effects loop, so none needed gating) ·
`npx expo export -p web` succeeded.

## P7 — readability

Code-level audit of the battle screen as a new player would see it, then
targeted fixes. No engine/content/digest changes — visual layer only, on
top of P6's combat FX without undoing any of it.

**Audit verdicts:**
- **Team-at-a-glance**: cyan (player) vs. red (opponent) is already
  colorblind-safe (not a red/green pair), but the ONLY cue was hue — no
  shape/direction backup. Fixed (a).
- **Whose champion is whose**: champion sprites are PATH-tinted, not
  team-tinted (by design — one sprite per path, shared across teams); team
  only read from a thin 1-2px border + the health-bar fill. Found a real
  collision doing this: `pathCardio` was `#22D3EE`, bit-for-bit the same
  hex as `colors.player`/`colors.cyan` — a Cardio champion fielded by the
  OPPONENT wore the exact "this is my team" hue everywhere else on screen.
  Fixed (retinted to indigo `#818CF8`, no test pinned the old hex).
- **Lane momentum**: nothing existed — a new player has no read on which
  side is winning a given push until a core bar visibly drops. Fixed (e).
- **Card affordance**: unaffordable cards were already dimmed with a 44px
  hit target and an accessibilityLabel calling out "not enough energy" —
  good — but the cost number dimmed identically to the name, so the
  specific reason didn't stand out. Fixed (c). No pip/segment cue existed
  on the energy bar itself either. Fixed (c).
- **Ability/ultimate affordance**: READY/cooldown-seconds/charge-% text
  already existed and is genuinely informative, but there was no
  progress-fill visual for either — a player has to read a number, not
  glance at a bar. Fixed (d).
- **Deploy zone**: already tinted + labeled; no change needed.
- **FX density**: P6's caps/TTLs still hold (nothing added or removed
  there). The one real gap: floaters landing at the same spot in the same
  tick (a multi-hit or an AoE) rendered EXACTLY on top of each other for
  their whole lifetime — the age-based rise alone doesn't separate
  simultaneous floaters, only sequential ones. Fixed (f).
- **Low-health read**: health bars (unit, champion, core) were team/path-
  tinted at every health level — no visual distinction between "healthy"
  and "about to die," so a player can't see the Shredder's Killer
  Instinct execute range (35% of baked max) coming. Fixed (b).

**Fixes shipped** (new pure module `features/arena/components/
readability.ts`, mirroring combat-fx.ts's split — plain-number derivations,
zero React/Date.now()/engine imports, wired by the callers which already
read the wall clock every ~50ms frame):
- **(a) Team direction chevron** — a small CSS-triangle under every unit
  marker (regular units, champions, borrowed), team-tinted, pointing up
  for the player (toward the opponent core) and down for the opponent
  (toward the player's own core). Independent of hue — holds even in
  grayscale.
- **(b) Low-health emphasis** — `healthBarColor(fraction, teamTint,
  lowColor)`: below 35% health (`LOW_HEALTH_FRACTION`, chosen to match the
  Shredder's Killer Instinct threshold as a UI convention, not a read of
  that specific champion's data) any health bar — unit, champion, Forge
  Core — switches to amber (`colors.warning`) regardless of team/path
  tint. Applied in `lane-strip.tsx` (units + champions + borrowed),
  `champion-hud.tsx` (the HUD's own health bar) and `core-bar.tsx` (both
  team cores), so the "danger zone" reads identically everywhere.
- **(c) Energy affordance** — `card-row.tsx`: an unaffordable card's COST
  number now renders in `colors.danger`, distinct from the name's plain
  dim — the number that's actually the blocker gets the emphasis.
  `arena-screen.tsx`: the energy track now has a divider every whole
  energy point (`ENERGY_PIPS`, 9 pips for a max of 10) so a player can
  eyeball "two more fighters' worth" without doing the division.
- **(d) Ability/ultimate progress fills** — `champion-hud.tsx`: a thin
  fill bar under the ability button (`abilityCooldownFraction`, 0 = just
  used, 1 = ready) and under the ultimate button (existing `chargePct`,
  now also rendered as a bar, not just text). Ready states also get a
  visibly thicker border (2px vs. cooling's 1px) — a static contrast bump,
  deliberately NOT a pulsing glow (see Deferrals).
- **(e) Lane momentum edge** — `computeLaneMomentum(units)`: -1..1 signed,
  from each lane's currently-alive units' summed health by team (0 for an
  empty lane or an exact standoff — no indicator shown). `LaneMomentumEdge`
  in `lane-strip.tsx` renders a few stacked, capped-opacity
  (`MOMENTUM_MAX_OPACITY` 0.35) bands against whichever edge is under
  pressure — the top (opponent core) tinted player-color when the player
  dominates a lane, the bottom (player core) tinted opponent-color when
  the opponent does. Cheap (reuses the units list the screen already
  filters per lane; no new log scanning) and quiet by construction (a
  perfectly even lane renders nothing).
- **(f) Floater stagger** — `computeFloaterStagger(existingTopPcts,
  topPct)`: counts how many currently-active floaters in the SAME lane
  sit within 5% topPct of a new one and returns
  `min(count, 4) * 11px` as an extra, constant vertical lift on top of the
  existing age-based rise. Wired in `arena-screen.tsx`'s `collectCombatFx`
  (computed against the running `fx.floaters` list, so simultaneous
  multi-hit floaters within one tick fan out too, not just sequential
  ones) and consumed in `lane-strip.tsx`'s `Floater` (both the rising
  hit/heal text and the death-dissolve glyph/ring). `FLOATER_CAP` (12) and
  every P6 TTL are unchanged.
- **(g) Champion identity** — covered by (b)'s pathCardio retint above;
  the existing path-color + initial + team-ring + borrowed-vs-captain
  ring-thickness distinction was otherwise judged sufficient and left
  alone.

**Deferrals** (see KNOWN_ISSUES.md for the full writeups):
- No pulsing/glowing "ready" animation on the ability/ultimate buttons —
  a continuous ambient loop needs real reduced-motion wiring the same way
  P6's idle bob did (and for the same reason, deliberately skipped it);
  static border-width contrast + the new progress fill cover the same
  affordance without the accessibility question.
- No circular/radial cooldown sweep — a linear fill was used instead;
  RN has no native radial-progress primitive, and adding one (SVG or a
  view-stack hack) is disproportionate to a visual-clarity pass.
- Lane momentum reads current unit health only, not a predictive
  "who reaches the core first" — that needs engine-level pathing/ETA data,
  out of scope for a visual-only derivation.
- No additional champion-vs-borrowed label beyond the existing ring-
  thickness difference — screen real estate at the arena's marker sizes.
- No animated energy-regen "creep" on the fill — the new pips were judged
  sufficient; avoids introducing a new continuous driver.
- No formal colorblind simulation pass (e.g. Coblis) was run — the fixes
  are colorblind-safe by construction (shape cue + a hue not already
  reused, verified by inspecting every path/team hex pairwise) but no
  screenshot-based simulation tool was available in this pass.

**Tests**: `__tests__/readability.test.ts` (new, 19 cases) — every
`readability.ts` export: `healthBarColor` (above/at/below threshold, the
non-special-cased exact-0 case, defensive negative input), `
computeLaneMomentum` (empty lane, standoff, one-sided, proportional,
non-positive-health entries ignored), `computeFloaterStagger` (no
neighbors, far neighbors, per-neighbor stepping, the pile-up cap) and
`abilityCooldownFraction` (ready, just-used, proportional, the
zero-total-cooldown ultimate edge case, defensive clamping).

**Files touched**: `features/arena/components/readability.ts` (new, pure
+ tests), `constants/theme.ts` (`pathCardio` retint), `features/arena/
components/lane-strip.tsx` (direction chevron, lane momentum edge,
low-health color, floater stagger consumption, `LaneFloater.staggerPx`),
`features/arena/components/arena-screen.tsx` (momentum computed/passed per
lane, floater stagger computed on push, energy pips), `features/arena/
components/champion-hud.tsx` (low-health color, cooldown/charge progress
fills, bolder ready border), `features/arena/components/card-row.tsx`
(unaffordable cost highlight), `features/arena/components/core-bar.tsx`
(low-health color). `screens/replay.tsx` untouched — `momentum` is an
optional prop defaulting to 0 (no edge rendered), `LaneFloater.staggerPx`
is never constructed on the replay path since replay doesn't pass
floaters at all.

Gates: `npx vitest run src/arena-game` — 24 files, 428 tests green (up
from 409) · `npx tsc --noEmit` clean, zero arena errors · `npx expo lint`
0 errors (same 7 pre-existing warnings, none in touched files) ·
`node scripts/verify-motion.mjs` OK (14 looping components, all gated —
unchanged; nothing new loops) · `npx expo export -p web` succeeded.

## P8 — five-champion balance (2026-07-23, overnight hardening)

Tuned from the P5 deep-harness win rates (see ARENA_BALANCE.md P8
section for data + rationale). Aesthetics buffed (HP/damage/stance
cadence/rally heal), Mass Monster's summon tempo trimmed (HP 1820,
taken-damage ult charge 0.045). Spread narrowed 18 → 7 points: all five
champions in [46%, 53%] across the 362-match deterministic matrix.
Re-pinned the two Colossal Frame numeric tests (baked max 2090 → 2002).

## P9 — cards & synergies (2026-07-23, overnight hardening)

Audit findings (20 cards, 5 champions, 5 synergies pre-pass):
- **Aesthetics had zero fighter-card presence.** Every other path had at
  least one fighter card carrying its tag (titan 2, mass 1, shredder 2,
  cardio 3) but no card carried `'aesthetic'` — the path's only combatant
  was its own champion.
- **No path-identity synergy for aesthetic or shredder.** `titan-bulwark`,
  `mass-presence`, `cardio-momentum` shipped (P2/P3); aesthetic and
  shredder had none, leaving 2 of 5 official paths with no synergy to
  build a deck around.
- **Six cyberpunk-flavored names clashed with the fitness-forge theme**
  (`Neon Boxer`, `Cyber Medic`, `Drone Archer`, `Support Drone`, `Neon
  Blades`) or read as a generic-fantasy/movie-reference name unrelated to
  fitness (`Shadow Striker`, `Blade Runner` — literally a film title).
  No leftover `speedster`/`hybrid` strings existed (already swept in
  P2/P3 per ARENA_BETA_AUDIT.md); the remaining 14 names/descriptions
  (Forge Recruit, Titan Guard, Cardio Runner, Heavy Tank, Adrenaline
  Surge, Recovery Pulse, Overload, Second Wind, Shockwave, Emergency
  Shield, Power Belt, Reinforced Armour, Carbon Boots) already read as
  genuine fitness/strength-training terminology and were left alone.
- **Mass had only one fighter card** (`heavy-tank`, dual-tagged
  titan/mass) and no equipment; `power-belt`'s "target ally deals 35%
  more damage" buff was untagged despite being a clean fit for the raw-
  power identity.
- Tags otherwise matched mechanical identity throughout (no healer
  tagged brawler, no support unit tagged shredder, etc.); energy costs
  all sit inside 1..10; card count (20) was already inside the 12–20
  requirement, so no cards were added or removed — every fix below is a
  rename, retag, or new synergy on the EXISTING 20-card set.

Renames (id unchanged — only `name`/`description`; ids stay the stable
save/replay-referenced keys):
- `neon-boxer` → **Cardio Boxer** ("Fast combinations, endless
  conditioning...").
- `cyber-medic` → **Recovery Coach** (kept description; added tag, see
  below).
- `drone-archer` → **Javelin Marksman** ("Throws javelins from deep in
  the lane...").
- `support-drone` → **Spotter** (a spotter is genuine gym terminology —
  matches its shielder behavior exactly).
- `shadow-striker` → **The Cutter** (ties into the Shredder's own
  body-fat-driven "Cut Deep"/"Shredded" lore ladder in
  `domain/branches-v2.ts`).
- `blade-runner` → **Tempo Cutter** ("tempo" mirrors Cardio Machine's own
  role text "Tempo specialist"; "cutter" mirrors the Shredder side of its
  dual `['shredder','cardio']` tag).
- `neon-blades` → **Cutting Program** ("training tempo" flavor, same
  effect).

Retags (mechanical/engine-relevant — the synergy aura layer only counts
tags on FIGHTER cards and champions; technique/equipment tags are
collection-screen flavor only, confirmed by reading
`game-engine/synergies/synergies.ts`):
- `cyber-medic`/Recovery Coach gained `'aesthetic'` (kept `support`,
  `tech`, `ranged`) — a dedicated healer directly amplifies Aesthetics'
  Flow State (+10% team healing); same dual-identity pattern already
  used by `heavy-tank` (titan+mass) and `blade-runner` (shredder+cardio).
  This is the ONLY fighter-card tag change and it is what makes the new
  `aesthetic-poise` synergy reachable (champion-aesthetic + one Recovery
  Coach = 2).
- `power-belt` (equipment, untagged) gained `'mass'` — a lifting-belt
  damage buff is a clean equipment-slot fit for Mass Monster's raw-power
  identity; does not affect synergy counting (equipment never spawns a
  combatant) but gives mass a second card in the collection screen.

New synergies (`content/synergies.ts`, reordered to the canonical
aesthetic/titan/mass/shredder/cardio path order):
- **`aesthetic-poise`** — 2 Aesthetic combatants: +10% movement speed.
  Reachable via champion-aesthetic + Recovery Coach (exactly 2, same
  shape as the existing `mass-presence`: champion-mass + heavy-tank).
- **`shredder-cut-deep`** — 3 Shredder combatants: +12% damage. Reachable
  via champion-shredder + The Cutter + Tempo Cutter (exactly 3, same
  shape as `titan-bulwark`: champion-titan + titan-guard + heavy-tank).
  Name borrows the Shredder's own lore stage ("Cut Deep" in
  `branches-v2.ts`'s body-fat ladder) for terminology consistency.

Final synergy list (7): `aesthetic-poise`, `titan-bulwark`,
`mass-presence`, `shredder-cut-deep`, `cardio-momentum`,
`support-network`, `balanced-forge` — every official path now has
exactly one path-identity synergy plus the two existing cross-path ones.

Final per-path fighter-card tag coverage (fighter cards + champion,
`'X'` = the champion itself):
| Path | Fighter cards | +Champion |
|---|---|---|
| Aesthetic | Recovery Coach | champion-aesthetic |
| Titan | Titan Guard, Heavy Tank | champion-titan |
| Mass | Heavy Tank (+Power Belt, equipment-only) | champion-mass |
| Shredder | The Cutter, Tempo Cutter | champion-shredder |
| Cardio | Cardio Boxer, Cardio Runner, Tempo Cutter | champion-cardio |

Content validation (`content/validate.ts`): extended `validateSynergies`
with two new checks, gated behind optional `cards`/`champions` params
(existing shape-only callers unaffected):
1. **Reachability** — every non-`mixed-paths` synergy's threshold must
   not exceed the fighter-cards + champions that can ever carry the tag
   (counts FIGHTER cards only, matching how the aura layer actually
   counts — see `combatantTags` in `synergies.ts`, which only looks at
   spawned units + the champion).
2. **Path coverage** — every entry in `ALL_AVATAR_PATHS` must have at
   least one synergy with `tag === path`.
Both are wired into `validateAllContent` via `content/index.ts` passing
`CARDS`/`CHAMPIONS` through. Falsified in `content.test.ts`: an
`impossible` synergy with `threshold: 50` on the `aesthetic` tag trips
the reachability error, and dropping the `shredder` entry from the
synergy list trips the path-coverage error; a third test confirms
omitting `cards`/`champions` stays a pure no-op (existing callers keep
their old, narrower behavior).

Tests: `content.test.ts` gained 5 new tests (P9 fighter-tag-coverage-per-
path, P9 path-synergy-coverage-and-reachability, the two falsification
tests above, the shape-only-omit test) and re-pinned the existing card/
champion/synergy count test to the exact new synergy count (7);
`synergies.test.ts`/`cards.test.ts`/`five-champions.test.ts` needed no
changes — they reference cards/champions by `id`, never by display
`name`, and none of the pre-existing spawns land on the new
threshold-2/3 boundaries unintentionally (checked by hand against every
test that spawns `cyber-medic`, `shadow-striker`, or `blade-runner`
together with other same-team combatants).

Balance spot-check: `ARENA_STABILITY_DEEP=1` stability harness (362
matches) after the retag/synergy changes — win rates unchanged from the
P8 baseline: Aesthetics 50%, Titan 46%, Mass 53%, Shredder 53%, Cardio
49% (same [46%, 53%] spread as P8; the champion's own tag identity, not
any card tag, is what P8 tuned). No champion re-tuning needed or
performed.

Gates: `npx vitest run src/arena-game` — 24 files, 433 tests green (up
from 428, +5 new in `content.test.ts`) · `npx tsc --noEmit` clean, zero
arena errors · `npx expo lint` 0 errors (same 7 pre-existing warnings,
none newly introduced) · `npx expo export -p web` succeeded.
No BALANCE_VERSION bump (0.6.0 unreleased this same run).

## P10 — AI tendencies (2026-07-23, overnight hardening)

Champion-path tendency profiles for the rule-based AI plus seed-varied
openings. AI-layer only — zero engine changes; every command still passes
validateChampionAbility / validateChampionAutoCast at queue time and the
engine's authoritative validation at apply time, so a tendency can never
produce an illegal command. All logic is a pure function of (battle state,
the AI's own seeded RNG stream) — the mirrored player-side driver
(ai-driver.ts) exercises identical behavior by construction.

New module `features/arena/champion-tendencies.ts`: a data-driven TENDENCY
knob table + per-champion `ChampionTendencyProfile`s consumed by
`opponent-ai.ts maybeUseChampion`. Profiles either HOLD an already-valid
cast for a better moment (ability + most ultimates) or RELAX the ultimate
trigger for a still-validated cast (Mass). Every holding ultimate keeps
escape valves (core threatened; usually also charge-held-too-long) so a
tendency can delay an ultimate but never strand it.

### Tendency table

| Champion | Ability tendency | Ultimate tendency |
|---|---|---|
| Titan | Hold Quake Stomp until ≥2 enemies inside its radius, OR ≥1 with the ultimate ≥80% charged (stun→smash combo) | Seismic Smash wants ≥2 enemies inside ITS radius (not just aggro-range clump); valves: core threat, held-long |
| Mass Monster | Gravity Well on ≥2 enemies in the well, OR defensively whenever its lane's threat score ≥ threatTriggerScore (lane is losing) | Baseline triggers PLUS defensive relaxation: summon early when its lane's threat ≥ trigger (pushed) |
| The Shredder | (Phase Dash unchanged — baseline) | Hold Final Cut until the actual target it would strike (engine-mirrored lowest-health selection) dies outright (damage > shield+health) or lands in execute range post-hit; valves: core threat, held-long |
| Cardio Machine | (Lane Shift unchanged — P4 join-combat gate) | Overclock only with an engaged fight (living enemy in its lane within aggro range) or core threat — deliberately NO held-long valve (walking-alone casts are the waste it prevents) |
| Aesthetics | Time the stance the toggle would produce: Bulwark when health ≤55% or ≥2 same-lane enemies in aggro range; Assault when health ≥70% with ≥1 enemy in reach | Forge Rally wants ≥2 living allied units besides the captain; valves: core threat, held-long |

### Tier scaling

New `AiDifficultyConfig.tendencyFollowChance` (validated in [0,1] by
content/validate.ts): training 0 (never follows; it also never commands
champions — tier-0 contract), standard 0.75, advanced 1. One deterministic
roll per decision on the AI's own stream (`rng.chance` consumes no draw at
0/1, so training and advanced stay draw-free); a failed roll reverts that
decision to the exact pre-P10 baseline heuristics.

### Opening variety

Pre-P10, openings were seed-invariant in lane/policy (always
strongest-affordable into the weaker lane — effectively the same lane every
battle). Now `createOpponentAiRuntime` draws an `openingLane` (0/1) and an
`openingStyle` (strongest/bulkiest/swiftest fighter scoring) from the AI's
seeded stream; during `BALANCE.ai.openingWindowTicks` (20s) the pressure
branch uses them instead of weaker-lane/strongest. Threat responses still
preempt (an opening never ignores a real push); training keeps its
per-decision random lanes. Deterministic per seed, different across seeds —
verified by test (12 seeds: both lanes + ≥2 distinct first cards; same seed
⇒ identical opening command sequence).

### Deep-harness win rates (ARENA_STABILITY_DEEP=1, 362 matches)

| Champion | P8/P9 baseline | P10 | Band [42,58] |
|---|---|---|---|
| Aesthetics | 50% | 46% | ok |
| Titan | 46% | 43% | ok |
| Mass Monster | 53% | 57% | ok |
| The Shredder | 53% | 58% | ok (edge) |
| Cardio Machine | 49% | 47% | ok |

Zero stalls / errors / invariant violations (304 matches checked every
tick); 30/30 ghost replays digest-identical; borrowed-champion ultimates 0;
2 rejected commands (the documented report-only same-tick-invalidation
category). Spread widened 7 → 15 points but every champion stays inside the
band — the shifts are the tendencies themselves (Shredder stops wasting
Final Cut, Mass summons defensively; Titan pays a small cost for holding
stomps). A Titan "defensive peel" stomp valve was tried and reverted: the
harness measured it moving Titan 43→42 and Shredder 58→59 (wrong direction
on both edges). Future tuning lever is the TENDENCY table (never champion
stats) — see KNOWN_ISSUES.

Tests: new `__tests__/ai-tendencies.test.ts` (20 tests): hold + cast cases
per tendency on crafted states, standard-tier follow-roll determinism with
the roll PREDICTED from the RNG state (both branches observed across 40
seeds), tier-0-vs-top-tier difference on the same state, opening variety +
per-seed opening determinism. Three seed-sensitive fixtures re-pinned (the
runtime's two new opening draws shifted every AI stream):
opponent-ai.test.ts 777→510 (augment-crossing training battle), 555→500
(beats-training/loses-to-advanced), champions.test.ts 20260722→20260723
(live ability+ultimate use).

Gates: `npx vitest run src/arena-game` — 25 files, 453 tests green (+20) ·
deep stability harness 26/26 green · `npx tsc --noEmit` zero arena errors ·
`npx expo lint` 0 errors · `npx expo export -p web` succeeded.
No BALANCE_VERSION bump (0.6.0 unreleased this same run).

## P11 — player journey (2026-07-23, overnight hardening)

The complete first-time journey, traced and repaired as a first-time
EvoForge athlete would walk it.

### The journey map (after this pass)

Arena hub door (`/arena` → "EVOFORGE ARENA" card) → `/forge-arena`
(_layout boots: content validation + `initArenaForUser` = per-user storage
+ Supabase provider + NEW identity sync) → title screen ("ENTER THE
ARENA") → `resolveEntryRoute`: first-timer → `/onboarding` (2 steps:
champion pick prefilled from the real Origin, then the 3-block core-loop
primer) → "START TUTORIAL" → guided battle vs the training AI (overlay
sequencer; rating unchanged) → result overlay (outcome + Arena Rating
line + cosmetic-rewards note) → lobby (difficulty defaults to Training;
Standard/Advanced locked behind the first win with a two-tap explicit
override) → BATTLE → results with real ±Arena Rating → Battle Log →
Watch Replay / Fight Ghost → Gym (member: full flow; non-member: honest
empty state + door to EvoForge Social → Gyms).

### What was broken (found by the trace)

1. **Onboarding asked for a display name** (audit #9) while the provider
   overrides it with the EvoForge profile name — so the lobby/profile
   showed "Challenger" while battle records showed the real name.
2. **A first-timer's first real battle hit the 'standard' AI** — the
   default save difficulty was 'standard' and nothing gated the tiers.
3. **Tutorial battles moved rank points** (±30/−20 through the provider):
   losing your guided lesson cost ladder points.
4. **The result overlay showed no earnings at all** — no rating delta, no
   hint that rewards are Arena-local (a player could reasonably assume
   real Forge XP).
5. **"Rank points" copy everywhere** (lobby/profile/rank screen) — the
   audit-#6 collision with EvoForge's Rival Rank, never renamed in UI.
6. **The Arena profile showed the MOCK fitness block** ("Evo Rating
   (mock)", the local save's flat 50s) instead of the real provider data
   integrated battles actually use.
7. **"Developer Debug" sat on the player-facing title screen and lobby**
   in production builds (standalone-ism).
8. **Gym non-membership rendered as an error** ("Gym unavailable") with
   no path forward.

### What changed

- **Identity sync (audit #9 closed)**: `applyProviderIdentity` (pure,
  services/onboarding) runs at the end of `initArenaForUser` — display
  name always follows EvoForge (sanitised, fail-soft); the Origin-derived
  champion prefills the save ONLY until onboarding completes (a finished
  player's pick is never overridden). No-op returns the same object so
  nothing persists on the common path. Onboarding is now 2 steps — the
  name step is gone; the primer is exactly 3 blocks (deploy cards /
  command your champion / destroy the Forge Core) plus the first-battle
  difficulty note.
- **First-battle gating**: save v5→v6 (SAVE_VERSION 6) — `createDefaultSave`
  now starts at 'training', and the migration re-defaults ONLY
  never-battled saves (battlesPlayed 0, or malformed stats/settings) to
  'training'; any save with battles keeps its chosen tier. Lobby chips
  show 🔒 on Standard/Advanced until the first WIN
  (`isDifficultyUnlocked`); the lock is advisory — first tap explains
  ("unlocks after your first win — tap again to face it anyway"), second
  tap selects (explicit choice per the brief).
- **Tutorial off the ladder**: `ratingDeltaForOutcome` (pure,
  services/progression/rank) is now the single delta source for BOTH the
  battle store's `recordResult` and the overlay display — tutorial and
  ghost modes return 0. Tutorial battles still count in battle stats, so
  a tutorial win unlocks the harder tiers.
- **Results clarity**: ResultOverlay takes `mode` + `ratingDelta` and
  renders `ratingLineFor` ("Arena Rating +30" / "Tutorial — Arena Rating
  unchanged" / "Ghost battle — Arena Rating unchanged") plus the standing
  line "Arena progress stays in the Arena — no Forge XP, no Evo Rating
  change."
- **Arena Rating naming (audit #6 closed)**: lobby, profile and the rank
  screen (title now "Arena Rating") all say Arena Rating; the progression
  panel states it is Arena-local and cosmetic.
- **Real profile**: /profile now reads the provider's fitness profile
  (the exact data battles scale from), with loading and
  "unavailable — battles use neutral scaling" states; the mock block,
  "Player ID: local-player" row and "simulated locally" copy are gone.
- **Debug doors dev-gated**: title + lobby "Developer Debug" buttons
  render only under `__DEV__` or the save's `showDebugPanel` flag (the
  route stays reachable by URL for development).
- **Gym empty state**: non-membership is its own state ("No gym yet" +
  what Gym Wars are + "Open EvoForge Social" door to the real gyms UI);
  only genuine read failures show the error panel.

### Tests

469 arena tests green (+16 this pass): v5→v6 migration (re-default only
when unbattled; preserved when battled; malformed settings/stats
normalise), training default pinned across the v1→v6 chain,
`applyProviderIdentity` (sync/adopt/never-override/no-op identity/other
fields untouched), `isDifficultyUnlocked` (win-gated, training always),
`ratingDeltaForOutcome` + `ratingLineFor` (table modes, zero modes, sign
rendering). Existing save fixtures updated where the v6 default
legitimately changed expectations.

### Verified journey states (empty/error)

- No fitness data: provider baselines (50s) or profile "unavailable"
  note; battles fall back to neutral scaling (unchanged, re-verified).
- No gyms joined: dedicated no-gym state (gym overview); sub-screens
  (roster/squad/war) keep their fail-soft panels and are only linked from
  the gated overview.
- No battle records: battle log's existing "No battles recorded" panel +
  arena CTA (unchanged, verified).
- Boot failure: _layout's retry panel; screen crashes: ErrorBoundary
  (battle, tutorial, profile, gym-war, layout-wide) — unchanged.

Gates: `npx vitest run src/arena-game` 25 files / 469 tests green ·
`npx tsc --noEmit` clean · `npx expo lint` 0 errors · `npx expo export -p
web` succeeded. No BALANCE_VERSION bump (no simulation change; the
tutorial delta lives outside the engine).

## P12 — Gym Champions slice (2026-07-23, overnight hardening)

Made the gym mode a coherent, honest vertical slice: official-path squad
ROLES, squad-composition guidance, and estimate/Arena-local honesty across
every gym surface. No engine, content or balance changes — the roles NAME
what the kits already do.

### The flow, mapped end-to-end (after this pass)

`/gym` (name, member count, your champion titles, war record + MVP/most-
fielded, NEW Arena-local honesty line) → `/gym-roster` (per-member fitness
summary, "(EST.)" path chip, NEW squad-role line, champion-role badges, war
stats "(Arena-local)", NEW estimated-builds header) → `/gym-squad` (borrow
≤3, NEW role line + synergy preview + stale-selection pruning + empty/no-gym
states) → `/gym-war` (rival picker → shared ArenaScreen mode 'gym-war') →
result overlay (SQUAD CONTRIBUTION +pts, the standing "Arena progress stays
in the Arena" line) → provider `recordBattleResult` mode 'gym-war' →
`applyGymWarResult` into `save.gym` (local only) → back to `/gym`.

### Official-path squad roles (features/gyms/path-roles.ts)

Data-driven display metadata; each summary NAMES the path's actual passive
(asserted by test) and `teamAura` is DERIVED from champion content:

| Path      | Role     | Mechanical meaning (existing kit)                          | Squad-wide? |
|-----------|----------|------------------------------------------------------------|-------------|
| titan     | Anchor   | Iron Hide self-armour; Quake Stomp area stun               | self        |
| mass      | Bulwark  | Colossal Frame health bake; Gravity Well area slow         | self        |
| shredder  | Finisher | Killer Instinct low-health bonus; Phase Dash reach         | self        |
| cardio    | Pacer    | Perpetual Motion team energy aura; gated Lane Shift        | TEAM aura   |
| aesthetic | Coach    | Flow State team healing aura; Stance Shift                 | TEAM aura   |

Borrowed-context verification (probe tests in gym-roles.test.ts): every
passive functions on a borrowed, non-commandable champion — the aura layer
keys on `unit.kind === 'champion'` (never `commandable`) and the spawn bakes
are per-champion. Pinned: borrowed Perpetual Motion/Flow State auras apply
from tick 0, die with the champion and return on respawn; borrowed Iron
Hide reduces hits (min-1 floor); borrowed Colossal Frame bakes ×1.1 max
health; borrowed Killer Instinct scales the borrowed unit's own hits. No
passive needed fixing — the P2/P3 implementation was already
commandable-agnostic; P12 adds the probes that keep it that way.

### Squad synergy preview (features/gyms/synergy-preview.ts)

Pure `previewSquadSynergies(squadChampionIds, deckCardIds)` mirroring the
engine's counting rules: squad champions are living combatants from tick 0,
so squad-only counts meeting a threshold are "LIVE FROM SPAWN" — pinned by
a test asserting the preview's active set EXACTLY equals
`createBattle(...).auras.player.activeSynergyIds` across squad shapes.
Deck potential counts DISTINCT fighter cards per tag (techniques/equipment
never spawn combatants; mixed-paths counts only paths the squad lacks) —
deliberately under-stating, never overclaiming (engine counts copies).
The squad picker renders per-synergy `name n/threshold` rows (deck-support
notes on incomplete ones) and a hint when no synergy is live from spawn.

### Honesty fixes

- Gym overview: "Wars and contribution are Arena-local — winning here never
  changes your real EvoForge gym standing."
- Roster: estimated-builds header (paths/stages/stats estimated from Forge
  Level + Evo Rating), "(EST.)" chips kept, war stats line says
  "(Arena-local)"; squad-role lines derive from the synthesized path.
- Squad picker: "(EST.)" on champion names + estimated-builds footer;
  borrowed copy now says "never their ultimate" (the M9 rule, previously
  undisclosed in UI).
- Result overlay already showed the standing line + per-member `+pts`
  matching `BALANCE.gym` exactly (verified, unchanged).

### Polish

- gym-roster and gym-squad non-membership now shows the friendly no-gym
  state with the EvoForge Social door (P11 deferral closed).
- Single-member gyms: explicit "No squad-mates yet" panel (captain fights
  solo) instead of a silently empty list; synergy preview still renders for
  the captain-only squad.
- Stale squad selections (members who left the gym) are pruned on squad-
  screen load via pure `pruneSquadSelection` (persisted only when changed),
  so the saved squad and the n/3 cap reflect reality — battle-time fielding
  already filtered stale ids identically (unchanged).
- Members with no fitness cache keep the provider's fail-soft baselines
  (unchanged, re-verified).

### Save decision

NO schema change: `gym.selectedSquad` (save v3, M9) already persists squad
selection across sessions — verified by a round-trip test. SAVE_VERSION
stays 6.

### Tests

487 arena tests green (+18 this pass, gym-roles.test.ts): role coverage/
uniqueness/pinned labels, summary-names-passive data link, derived teamAura
flags, unknown-path fail-soft; synergy preview vs engine spawn auras (4
squad shapes), tag + mixed-paths counting, fighter-only deck potential,
no-synergy hint, purity; 6 borrowed-passive probes; pruneSquadSelection;
selectedSquad persistence round-trip.

Gates: `npx vitest run src/arena-game` 26 files / 487 tests green ·
`npx tsc --noEmit` clean · `npx expo lint` 0 errors · `npx expo export -p
web` succeeded. Deep harness NOT re-run: no battle-affecting change (no
game-engine/content/balance/AI edits; the new modules are display-only pure
functions and battle-time squad fielding is byte-identical).

## P13 — reward safety audit (2026-07-23, overnight hardening)

PROTECTION audit (highest-priority constraint). Verdict: **CLEAN across all
8 scope items + integration edges — no violations, no fixes, no CRITICAL
flags.** Verified by reading source, not summaries. Full evidence trail
(file:line per item) in `ARENA_BETA_AUDIT.md` § "P13 — reward safety audit".

Key confirmations: the package's entire external surface is one READ-ONLY
`@/data/supabase` client (only in supabase-provider.ts — all `.select`/read
RPCs, no insert/update/upsert/delete/mutating-rpc) plus one pure domain fn
(`forgeProgressFor`). No `xp_ledger`/`xp_events` writes; no
`@/data/mutations`/`hooks` imports. All battle-completion paths
(`battle-store.recordResult`, `local-mock-provider.recordBattleResult`,
`applyGymWarResult`) write ONLY the per-user-namespaced local save. Arena
Rating/stats/gym contribution are device-local (farming harms self only);
avatar stage is the real provider derivation, Forge Level read-only. Sign-out
teardown (`resetArenaSession`) stops the battle loop + drops in-memory state,
wired into auth-context alongside `supabase.auth.signOut()` +
`queryClient.clear()`; `u/<userId>/` namespacing blocks cross-account leakage.
No camera/photo/media anywhere; feedback export is user-initiated Share only.
Untrusted record/ghost parse is fail-safe + scaling-bounded and only drives
offline replays (zero rank, no server write).

Gates: docs-only change (no code touched) — tsc/vitest/lint unaffected;
`npx vitest run src/arena-game` remains 487 green from P12.

## P14 — final verification + report (2026-07-23, overnight hardening) ✅ RUN COMPLETE

Full independent gate sweep re-run from a clean tree (arena package untouched
this phase; a concurrent session was editing `data/`/`domain/`/`today.tsx`,
attributed separately). Every gate GREEN:

- `npx tsc --noEmit` — clean, 0 errors.
- `npx vitest run` (FULL) — 98 files / 1,558 tests passing (arena: 26 files /
  487 tests; non-arena 1,069 → 1,071, the other session's muscle-lookup test).
- `npx expo lint` — 0 errors (7 documented warnings: test unused-vars + inert
  `no-console` disables).
- `node scripts/verify-tokens.mjs` — OK (56 tokens + 2 overrides, 591 files clean).
- `node scripts/verify-motion.mjs` — OK (14 looping components, all gated).
- `node scripts/verify-battle-engine.mjs` — OK (parity 18026 bytes × 3).
- `ARENA_STABILITY_DEEP=1` stability harness — 362 matches, 0 stalls / 0 errors /
  0 invariant violations (304 checked every tick), 1 report-only rejected command,
  30/30 ghosts digest-identical, 0 borrowed-champion ultimates. Win rates
  [45, 54]: Shredder 54 · Mass 54 · Titan 50 · Cardio 47 · Aesthetics 45.
- `npx expo export -p web` — 130 routes; all 25 `/forge-arena` routes emit incl.
  all five champion pages.

Audit closure: findings #1/#2/#3/#5/#6/#9 RESOLVED (spot-checked in source);
#4 (gym-mate origin_path) OPEN by design — shared-schema migration left for Tyson;
#7/#8/#11 deferred (perf/cosmetic); #10 addressed via P6/P7 reactive FX.
Requirement sweep all PASS: exactly five official champions, no player-facing
speedster/hybrid, real progression read-only (Evo cap 12%, Forge Level read-only,
separate Arena Rating, real stages incl. Shredder body-fat), save v1→v6 migrations
(not resets), P13 reward-safety clean, deterministic engine, 20 cards, tutorial +
tier gating, gym slice with roles.

Full report at repo root: `OVERNIGHT_ARENA_BUILD_REPORT.md`.

# OVERNIGHT ARENA HARDENING RUN COMPLETE (P1–P14, 2026-07-23)

# POLISH PASS (vertical slice)

## Phase 1 — visual audit (2026-07-23, commit 93877b3)

Real-build audit (played battle + full screen tour via
scripts/arena-visual-tour.mjs). Docs: ARENA_VISUAL_AUDIT.md,
VERTICAL_SLICE_PLAN.md, KNOWN_POLISH_ISSUES.md.

## Phases 2+3 — arena environment + PixelLab sprite replacement (2026-07-23)

The 1-bit look is gone. PixelLab (pixellab.ai, key in .env.local) generates
the entire character/structure/floor set: 5 champions with distinct
physiques + path colors baked in the art, 10 fighter units, 2 Forge Cores
with cracked damage variants, 1 lane floor texture. Pipeline:
scripts/arena-pixellab-gen.mjs (generate = API, idempotent per raw file,
pinned seeds; build = team-outline post-process player-cyan/opponent-red);
raws in assets/arena-pixellab-src/, game PNGs in
features/arena/sprites/px/ (pngquant-crushed, 35 files 59KB).

Renderer (sim untouched, replay digests unaffected):
- lane-strip: floor texture per lane (static Image), center line, visible
  deploy boundary + brighter zone while a card is selected; units 26pt /
  champions 38pt / borrowed 30pt with team base-plate ellipses (team =
  outline + plate + health bar + chevron; art = identity); walk-bob while a
  unit has no combat target (movement-driven, per-unit phase offset,
  gated by new use-reduced-motion.ts); hit flash upgraded from white box to
  white-tinted sprite silhouette; imageRendering:pixelated on web (C5).
- core-bar: 44pt core art, cracked variant below 50% health, pixelated.
- championSprite() now keys by TEAM (outline variant); path identity lives
  in the art itself. Legacy Kenney set kept on disk as documented fallback
  source (ASSETS.md rewritten).

Verified: tsc clean; arena suite 26 files/487 tests green; lint 0 errors
(7 documented warnings); verify-motion/verify-tokens OK; web export +
Playwright tour re-run — floor/cores/units/damage-variant all confirmed
on-screen at DPR 2 and DPR 4 (shots compared against the Phase 1 baseline).

Deferred (documented in KNOWN_POLISH_ISSUES.md): PixelLab walk-cycle
animation (frames degrade/turn the character — evidence in the Phase 1
session; bob + hit-flash carry motion for now), north-facing back views
(rotate returned another front view; chevron still carries direction),
deploy-wash/floor-busyness tuning judged fine pending the Phase 12 review.

## Phase 4 — combat-feel system + character animations (2026-07-23)

One escalation ladder, one tuning table (components/impact.ts TIER_FX):
light < medium < heavy < ultimate < core. Damage numbers size/weight by
tier; light/medium hits deliberately do NOT shake the screen.

Engine (sanctioned, digest-safe — computeDigest reads no log entries;
replay-fidelity + engine-parity gates green): fx hit entries now carry
target unit id + shield flag (combat.ts). Closes the P6 proximity-match
deferral — flashes/recoil are id-matched exactly; legacy id-less records
fall back to the old proximity rule (tested both ways).

Battle store: transient time dilation (applyTimeDilation) — scale 0 =
hit-stop (heavy hits 50ms, severe core hits 90ms), fractional = slow-mo
(ultimates 0.35x for 380ms). Piecewise wall-clock accumulator: ticks are
DELAYED never skipped; command recording + replay digests untouched;
capped 450ms; slower active dilation never overridden by weaker; cleared
on begin/reset. Pinned by 3 fake-timer store tests.

Character animation (procedural, sim-synced): attackPose derives
anticipation (pull-back in the last 3 cooldown ticks) -> strike lunge +
swell (cooldown-reset detection, 160ms) -> fighting lean, all signed by
facing; defender recoil scaled by tier while its flash is active; spawn
drop-in scale from ticks-since-spawn; shield hits flash steel-blue.
Champion REAL walk cycles: PixelLab animate-with-text finally works with
frame-0 inpainting anchor + image_guidance 3.0 (the earlier turn-around
failure documented in KNOWN_POLISH_ISSUES E1) — 4 frames x 5 champions x
2 team outlines (75 px files total, 161KB crushed), cycled at 140ms/frame
while moving, static in combat, reduced-motion gated, per-unit phase
offset. Units keep the walk-bob.

Also: ranged projectiles (cooldown-reset -> fast 110ms streak to target,
visual-only, no engine change), screen shake on the arena container
(strongest-wins rank, reduced-motion suppressed), ultimate full-screen
path-color tint + slow-mo, and the core-destruction CLIMAX: result
overlay held ~1.1s behind a top-tier shake + winner-colored wash (local
50ms interval drives climax frames since the loop stops on finish;
cleared on unmount/rematch).

Verified: tsc clean; arena 27 files / 504 tests (+17 new impact tests:
tier table monotonicity, shake decay, attackPose phases, spawn scale,
fired-attack/projectile derivation, all 3 dilation behaviours); full
suite 1,575; lint 0 errors; verify-motion/tokens/battle-engine OK; export
+ tour re-run — climax hold, defeat wash, delayed overlay, champion-duel
readability all confirmed on screen.

## Phases 5-7 - champion FX identity, readability, premium UI (2026-07-23)

P5 (identity beyond hue): TelegraphSignal/LaneTelegraph carry the caster
PATH; TelegraphMarker renders a per-path shape language - Titan trailing
shockwave ring + four radial cracks (and its ABILITY now bumps the camera:
the one path that shakes on a non-ultimate), Mass Monster thick ring +
drifting dust dots (deliberately shake-free: oppressive, not explosive),
Shredder crossing violet/crimson slash arcs, Cardio widening pulse lines,
Aesthetics gold inner ring + four symmetric sparks. In-motion identity:
Cardio champion carries a speed afterimage while moving; Shredder a
crimson ghost during its strike lunge (sprite re-draw, zero assets).

P6 (readability): computeStackOffsets in readability.ts fans co-located
units laterally (center-out slots 0,+1,-1,+2,-2 cycling, id-stable across
frames; 6 new tests) - closes audit C1; champions draw LAST (on top of
piles); steady crimson danger edge on a core side at <=25% (severe
threshold; static by doctrine); card chips grew two-line names (C3 fixed,
tour-verified: "Emergency Shield"/"Javelin Marksman" full width).

P7 (premium UI): tab bar HIDDEN for the whole /forge-arena group
(tabBarStyle display none in the (main) Tabs layout - audit D1, ~70pt of
battle screen reclaimed, tour-verified full-bleed); the EvoForge pixel
faces (Jersey10/25 - family names PINNED as strings in arena theme.ts,
NOT imported from src/theme/fonts.ts whose .ttf requires break the node
test env; comment explains) on the battle timer, energy label, title
wordmark and result banner; card chips became mini-cards (fighter sprite
thumbnails, category top-edge fighter-cyan/technique-amber/equipment-blue,
cost badge); champion-select cards + lobby profile got real sprite
portraits in path-colored frames; ResultOverlay is a staged ceremony
(pixel banner slams in scale 1.5->1 with outcome-colored glow + card
border, facts at 240ms, rating at 430ms, actions at 640ms; one bounded
~1s interval, sections hold layout via opacity so nothing reflows;
reduced-motion shows everything instantly) - verified by a dedicated
Playwright check capturing the reveal mid-stage (no buttons) and complete.

Gates: tsc clean; arena 27 files / 510 tests; full suite 1,581; lint 0
errors; verify-motion/tokens/battle-engine OK; export + full tour +
ceremony check on the real build.

## Phases 8-9 - slice roster + match flow (2026-07-23)

P8 (roster). DECISION: the starter deck composition is KEPT UNCHANGED -
the AI always fields DEFAULT_DECK_CARD_IDS (arena-screen battleOptions),
so the deck is coupled to the deep-harness balance (45-54 percent band);
churning it blind would violate the balance lesson in ARENA_BALANCE.md.
Role audit of the featured 8: tank (Titan Guard), cheap cycle (Forge
Recruit x2), bruiser dps (Cardio Boxer), ranged (Javelin Marksman),
win-condition lane pressure (Cardio Runner), area+control (Overload),
heal (Recovery Pulse), defensive response (Emergency Shield) - every
required role covered, no always-optimal card. What P8 DID change: three
sprite identity fixes (audit E3) - cardio-runner regenerated as an
unmistakable human sprinter (was bike-ish), drone-archer as a javelin
THROWER (card renamed to Javelin Marksman in P9-overnight but the art
was still a drone), support-drone as a gym SPOTTER projecting a shield
(was an orb). Raws deleted + reseeded in the manifest; the rest of the
20-card set stays as collection content.

P9 (match flow). Battle INTRO: every non-tutorial battle (standard,
ghost, gym-war, and every Rematch) opens with battle-intro.tsx - the
opponent line (difficulty/gym/ghost), both champions in team-framed
84pt portraits, VS, then 3-2-1-FIGHT in 72pt pixel numerals with per-beat
pops (suppressed under reduced motion; the count itself remains). The sim
is FROZEN underneath via the store's new holdForIntro (same delay-only
dilation mechanism, intro-sized 3.5s cap; ticks never skipped; player can
pre-select a card during the countdown; fake-timer tested). The overlay
is driven by a bounded local interval keyed on the live object (a frozen
sim produces no version bumps). Timer tension: amber inside the final
30s, danger red in sudden death. Tour-verified: countdown over a dimmed
frozen arena at t=1s, combat underway by t=6s, two-way core damage.

Gates: tsc clean; arena 27 files / 511 tests; full suite 1,582; lint 0
errors; verify-motion/tokens/battle-engine OK; export + tour.

GOTCHA (build tooling): PowerShell Select-Object -First N terminates the
upstream native command early - it killed a pixellab generate run
mid-way. Never pipe the generator through early-terminating filters.

## Phase 10 - Gym Champions presentation (2026-07-23)

Borrowed champions now carry their OWNER on the battlefield: engine-level
ownerName on ChampionState (copied from the squad config at spawn -
display/attribution metadata like spawnX, NEVER digested; pinned by two
new tests incl. digest-identity across renames) -> a tiny team-tinted
nameplate under every borrowed champion in lane-strip. Gym War battles
get a squad ENTRANCE: the battle intro shows a FIGHTING BESIDE YOU row -
each borrowed gym-mate's champion portrait in its path frame with the
member's name. The War Squad builder cards show the member's actual
champion sprite in a path-colored frame next to name/role/(EST.) chips.
Result-side contribution lines were already in the staged ceremony (P7);
gym overview MVP/most-fielded unchanged. All presentation-only: zero
schema changes, (EST.) honesty copy intact, ownership/progression data
untouched.

HONESTY NOTE: the gym-war INTRO/nameplate visuals could not be verified
on-screen this session - smoke ALPHA is in no gym, and creating/joining
one would write real social data (discoverable by real users), which
this package's zero-write discipline forbids. Verified instead via the
engine tests + shared component paths (SquadEntry reuses the tour-
verified ChampionPlate patterns). On-screen gym-war check is OWED to
Phase 12 / Tyson's device pass (flagged in KNOWN_POLISH_ISSUES).

Gates: tsc clean; arena 28 files / 513 tests (+2); full suite 1,584;
lint back to the documented 7 warnings (a mid-file import-order slip in
gym-squad was caught by lint and fixed); verify-motion/battle-engine OK;
web export green.
