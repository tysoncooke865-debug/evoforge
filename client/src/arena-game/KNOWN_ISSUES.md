# Known Issues

- **Same-tick mirror-order advantage (deferred design decision).** Units act
  in ascending entity-id order and ids follow same-tick command order, so in
  a perfectly mirrored same-tick engagement the later-listed deploy wins the
  first strike. Irrelevant for AI and asynchronous battles (each side's
  commands come from one recorded stream), but before any live PvP the engine
  needs a fairness rule (interleaved ordering or snapshot-based simultaneous
  resolution). Documented by the M2 ultracode review.
- No emulator/device verification loop on this machine yet — verification is
  typecheck + vitest + `expo export` static render. Native testing happens via
  Expo Go on a physical phone.
- `expo lint` not yet configured beyond template defaults.

## Milestone 3/4 — Arena + cards

- Tap-to-deploy reads `PressEvent.nativeEvent.locationY` on a `Pressable` per
  lane. Verified via `expo export --platform web` only — no device/emulator
  on this machine (same gap for all milestones).
- ~~Stale result overlay when re-entering /battle~~ — fixed in M4 (`reset()`
  on screen unmount).
- ~~Engine consumes no RNG~~ — since M4 the deck shuffle consumes the battle
  RNG (player first, then opponent).

## Milestone 5 — Champions

- ~~The scripted opponent fields a champion but never triggers its ability or
  ultimate~~ — closed in M6: the opponent AI uses ability, ultimate and
  techniques at 'standard'/'advanced' (never at 'training', by design).
- A champion respawns in the lane it currently occupies, not its configured
  spawn lane — a Speedster that Lane Shifted revives in the shifted lane.
  Deliberate ('beside own core' fixes x; cores are lane-agnostic), noted in
  case playtesting wants respawns to reset the lane.
- Champion ability charge/cooldown state is intentionally NOT part of save
  data — it is per-battle runtime state only.

## Engine deep review (Opus 4.8, post-M5 batch)

- Fixed: modifier stacking (refresh-by-sourceId; re-casts refresh duration,
  never stack multiplicatively), replay sort ordering made explicitly
  (tick, arrival-index), support-drone got a real `shielder` behavior
  (capped shields to the frontmost ally), cross-lane AoE isolation pinned by
  test. `balanceVersion` 0.3.0.
- ~~Deferred to M6: `armorFlat` / `healingMult` modifier support consumed by
  synergies, implemented as a recomputed aura layer (not accumulating timed
  modifiers), per the review's recommendation.~~ — shipped in M6 exactly as
  recommended (`game-engine/synergies/synergies.ts`).

## Milestone 6 — AI and autobattler depth

- Aura armour can blunt Final Cut's execute: the execute follow-up routes
  through `damageUnit` like all damage, so an armoured (titan-bulwark)
  melee target may survive an 'executed' log line with a sliver of health.
  Same shape as the pre-existing Bulwark-stance `damageTakenMult`
  interaction — deliberate uniformity; revisit if playtesting wants
  executes to be absolute.
- Aura snapshot timing: composition changes (deaths, deploys, augment
  choice) take effect on the NEXT tick's aura snapshot (recomputed at
  end-of-tick, consumed uniformly the following tick). One tick = 50ms;
  deterministic and replay-safe by construction.
- The augment offer consumes battle RNG at the offer tick, so digests of
  any battle crossing 90s differ from pre-0.4.0 builds (expected;
  balanceVersion gates replays).
- AI decisions are recorded as ordinary commands in the commandLog — replays
  and ghost battles need no AI code. Consequence: in a battle where BOTH
  sides act on the same tick, a same-tick kill can invalidate the other
  side's queued targeted command (logged as rejected, replays identically).
  AI-only battles are rejection-free by construction (tested).
- Difficulty tuning is heuristic-quality only (verified by test: no stat
  modifiers, energy bounded by regen). Real balance passes need human
  playtesting on device.

## Milestone 8 — Ghost battles and replay

- **Ghost fidelity is best-effort by design (reliability over fidelity).**
  A ghost battle uses a FRESH seed, so the ghost's deck shuffle differs from
  the original battle: recorded card plays that are not in the ghost's
  rotating hand at that tick are rejected ('not in hand') and the battle
  continues — a decked ghost typically lands only part of its recorded card
  sequence. Deckless records (dev battles) replay their deploys perfectly
  (proven by test). A hand-cycle-aware remap (play the same hand SLOT
  instead of the same card id) is the known improvement path if playtesting
  wants stronger ghosts; it was deliberately not built in M8 to keep the
  transform simple and the rejection semantics honest.
- Ghost `play-card` commands keep their recorded target unit id, which
  resolves against the NEW battle's entity ids: usually a rejection,
  occasionally a valid-but-different target of the right team. Deterministic
  and replay-safe either way; same fail-soft policy as above (also applies
  to champion ability/ultimate timing — cooldown/charge/death state diverges
  from the original battle).
- The ghost's augment re-pick (first id of its OWN offer) predicts the offer
  at build time by replaying the real `offerAugments` draw on a scratch
  battle. This is exact because nothing consumes battle RNG between battle
  creation (deck shuffles) and the offer tick. If a future engine change
  adds an RNG consumer in that window (crits, spawn jitter), the prediction
  can go stale — the command would then be rejected at runtime (fail-soft)
  and the ghost tests would catch the drift.
- `startGhost` validates records structurally + by balance version, but does
  NOT run the full `verifyBattleRecord` re-simulation (the replay viewer
  does). A tampered-but-well-formed record therefore produces a ghost whose
  commands simply play out (or get rejected) under normal engine validation
  — safe, just not authenticated. Full verification before ghost start is a
  one-line change if Gym Wars (M9+) needs it. *(P4 2026-07-23: the "safe"
  claim had real holes — a null/missing play-card target THREW out of the
  live tick loop, and non-finite champion scaling spawned Infinity-health
  ghosts. Both closed; see the P4 section.)*
- Ghost battles are recorded as battle records (mode 'ghost') but never
  reach the provider: no rank movement, no stats. Fighting the ghost of a
  ghost battle is possible and intentional (the record's player side is
  always the human's own commands).
- The replay viewer renders units/cores/synergies but not the combat
  floaters (damage numbers) — those are derived from the live store's frame
  loop in the arena screen; wiring them into the replay player is cosmetic
  backlog.
- Battle-log actions for records from an older balance version are disabled
  with an explanation (verification would refuse them anyway) — records are
  not migrated across balance tuning, by design.

## Milestone 9 — Gym Champions

- **Borrowed champions never use their ultimate** (simplified build, by
  design): ultimate charge accrues through the generic combat hooks — and
  visibly caps at full — but is never spent. A real borrowed-ultimate rule
  (auto-fire heuristics or captain-triggered) is future work; auto-casting
  ultimates with the current always-cast rule would make Titan/Shredder
  borrows disproportionately strong.
- **warContribution is a participation proxy, not damage attribution**:
  +`contributionPerWar` per war fielded, +`contributionWinBonus` extra on a
  win (BALANCE.gym). Real damage attribution needs per-unit damage-source
  tracking in the engine — deferred until a milestone needs it for more
  than a leaderboard chip.
- ~~**Always-valid abilities auto-cast on cooldown**: a borrowed Speedster
  casts Lane Shift the moment it recharges (its validate is
  unconditionally OK), ping-ponging lanes every 10s~~ — fixed in P4
  (2026-07-23): Lane Shift auto-casts are gated by `laneShiftJoinsCombat`
  (shift only to JOIN combat in the other lane when the current lane is
  quiet — see the P4 section). A borrowed Aesthetics (ex-Hybrid) still
  stance-shifts on cooldown, which remains fine (the stance buff is always
  useful).
- Borrowed champions respawn at their STAGGERED spawn slot (spawnX stored
  per champion), in the lane they currently occupy — same lane semantics as
  the M5 captain respawn note.
- A gym-war record fought as a ghost keeps the full squad on the ghost
  side; the ghost's borrowed champions auto-cast engine-side (not from the
  record), so ghost fidelity for squads is the captain's command stream
  only — consistent with the M8 reliability-over-fidelity policy.
- The enemy gym squad is derived from seeded rosters at battle time; there
  is no persistence of rival-gym war outcomes (the war record tracks the
  player's gym only). Rival standings/leaderboards are backlog.

## Milestone 8 — Opus replay review (post-fix notes)

- Fixed from the review: null/non-object command-array elements are skipped
  (never thrown) across transformGhostCommands / prepareCommandSchedule /
  every never-throw consumer, fuzz-tested; recordId is collision-proof for
  same-seed battles.
- Deferred to the M10 audit (forward-looking, no current impact): when
  digests are used as cross-player attestations (M9 Gym Wars/PvP), bind
  identity into the hash (mix playerIds + seed) and add separators between
  id-list boundaries in computeDigest.

## Milestone 10 — beta hardening (final)

- On-device / screen-reader verification pending a physical phone (Expo Go):
  accessibility and layout work verified statically — do one manual pass on
  small + large phones with VoiceOver/TalkBack before wide beta.
- Corpse accumulation: dead units stay in state.units (digest/replay
  stability) so late-battle ticks cost 2.4–3.7x more — measured ~0.5–1.3ms
  worst case on a phone (~2.6% of the 50ms budget). Backlog: living-units
  index for the hot loops.
- Replay-open verification re-simulates the battle behind the spinner;
  invariant audits disabled already. Backlog: chunk with event-loop yields.
- Feedback export uses the native Share sheet; some browsers lack
  Share.share and export no-ops (fail-soft). Backlog: clipboard fallback.
- colors.textFaint measures 3.4–3.6:1 (passes AA-large, fails AA-normal) —
  remaining uses are disabled/dev/decorative; #7285A3 clears 4.5:1 if a
  theme-level bump is wanted.

## Integrated beta (overnight run 2026-07-23)
- See ARENA_BETA_AUDIT.md for the classified audit; items graduate into
  this file as they are fixed or explicitly deferred.

## Five-champion pass (P2+P3, 2026-07-23)

- **Balance 0.6.0 makes pre-existing battle records cleanly unplayable.**
  The roster change (paths, kits, passives, synergy tags) bumped
  BALANCE_VERSION; old records stay listed in the battle log with the
  existing stale-balance explanation and their Watch/Fight actions disabled
  (the established gate). Not destructive — nothing is deleted — and
  accepted: records are not migrated across balance tuning, by design.
- **Save v4→v5 remaps champion identity, never resets it**: saved
  `championId` speedster→champion-cardio, hybrid→champion-aesthetic,
  official ids pass through, anything unknown normalizes to champion-titan;
  the mock fitness avatarPath migrates by the same table and its stage
  clamps onto the real 1–4 art-stage ladder. All other fields preserved
  (tested, incl. the full v1→v5 chain).
- **The Arena's avatar stage is now EvoForge's real one** (provider):
  The Shredder's stage is body-fat-driven (latest bodyfat_log bf_mid > 0);
  level branches use their real ladders off base_level + public.xp_total().
  Two documented under-statements (never inflations): a failed/unreconciled
  ledger read falls back to base_level alone, and EvoForge's screens floor
  the ledger at the log-derived XP total, which a pure profile query cannot
  compute — a ledger-behind-derived athlete may briefly see an earlier
  stage in the Arena than on the avatar screen.
- **Gym member identity is estimated** (unchanged mechanism, now labeled):
  paths synthesize deterministically over the FIVE official slugs and
  stages estimate from forge_level; the roster chips read "(EST.)". The
  real fix is a gym_detail origin_path migration (flagged in the audit,
  shared-schema protected).
- ~~**Borrowed Cardio Machine still auto-casts Lane Shift on cooldown**
  (audit HIGH #5, kit inherited): its validate is unconditionally OK, so a
  borrowed one ping-pongs lanes every 10s in gym wars. A combat-nearby gate
  is the sketched fix — deliberately not landed in the roster pass (P4+
  engine-reliability scope).~~ — RESOLVED in P4 (2026-07-23), see below.

## P4 — engine reliability (overnight run 2026-07-23)

Adversarially-verified findings, all fixed this phase:

- **play-card with a null/missing/primitive target THREW instead of
  rejecting** (high): `validateCardTarget` dereferenced `target.kind`
  unguarded, so a poisoned-but-structurally-valid stored record could
  TypeError inside `advanceTick` mid-frame in a live ghost battle (the
  50ms interval has no try/catch). Fixed with a shape guard in
  `validateCardTarget` + the same guard mirrored in `applyCardEffects`;
  `transformGhostCommands` additionally normalizes non-object targets to
  `{ kind: 'none' }` (defense in depth). Rejected, never thrown; rejection
  costs no energy.
- **Schedule entries with a valid tick but null/missing command threw**
  (medium): `prepareCommandSchedule` never inspected `entry.command`, and
  `applyCommand` dereferenced `command.team` unconditionally. Fixed at both
  layers: the schedule rejects `{tick: N}` / `{tick: N, command: null}` up
  front ('malformed command'), and `applyCommand` shape-guards the command
  itself (covers direct `advanceTick` consumers). `RejectedCommand.command`
  is now `BattleCommand | null` (honest type for malformed entries; all
  shipping consumers only read `.length`/`.reason`).
- **Untrusted championScaling was never validated** (medium): a record
  config carrying `maxHealthMult: 1e999` (JSON.parse → Infinity) fielded an
  unkillable Infinity-health ghost champion; partial scaling objects would
  bake NaN. Fixed at both layers: `isValidChampionScaling`
  (game-engine/balance/fitness-scaling.ts — all five fields finite inside
  the [0.1, 10] engine sanity bounds; NOT the ranked cap, which
  services/progression/ranked.ts enforces separately and tighter) is
  required by `validateBattleRecordValue` for every config slot (legacy
  field, squad captain, borrowed) and re-checked by `createBattle`, which
  throws like its deck/champion-id validation (all untrusted-data consumers
  wrap it).
- **No bound on record.commands length** (low — fixed, cheap): re-sim cost
  is O(ticks × commands), so a 1M-noop-command record would freeze the UI
  thread for minutes. `validateBattleRecordValue` now caps commands at
  `MAX_RECORD_COMMANDS` (10,000 — orders of magnitude above legitimate
  play). Deferred (documented, not built): a per-tick index into the sorted
  schedule for `applyScheduledCommands` — the full-scan cost is now bounded
  by the cap, and the live command log is not guaranteed pre-sorted, so the
  index needs its own invariant work to be worth it.
- **Borrowed Cardio Lane Shift ping-pong** (high, audit #5) + **the AI's
  lane-blind champion-ability gate** (medium): fixed together. New
  `validateChampionAutoCast` resolves a handler's optional
  `autoCastValidate` (falling back to `validate` — bit-identical for the
  other champions). Lane Shift's gate `laneShiftJoinsCombat`: shift ONLY
  when the current lane holds no living enemy within aggro range AND the
  other lane holds at least one within aggro range of the champion's x.
  Ping-pong is structurally impossible (right after a shift the destination
  lane has an in-range enemy, so the gate stays closed until that fight
  resolves). Consumers: `autoCastBorrowedAbility` and the opponent AI's
  `maybeUseChampion` (which used a lane-blind enemies-near count and made
  its Cardio captain teleport out of its own fight every cooldown).
  Commanded captain casts and their UI pre-validation stay unconditional —
  a human's tactical choice. Pure state reads, no RNG: deterministic and
  replay-identical.

Digest note: the Lane Shift gate changes simulation behaviour for squad
battles fielding a borrowed Cardio Machine (and AI command streams with a
Cardio captain). No BALANCE_VERSION bump: 0.6.0 shipped in this same
overnight run and has zero player records (unreleased) — the change rides
the existing 0.6.0 gate. All other P4 fixes only affect malformed inputs
(previously: throw or nonsense; now: reject) — no digest impact for any
well-formed battle.

## P4 addendum — passives/combat-correctness review (2026-07-23)

Adversarial pass over the five champion passives. One defect found+fixed
(log-only); everything else verified correct or already documented:

- **Fixed: spawn-active synergies never logged 'synergy-on'** (low,
  observability): `createBattle`'s initial aura seeding assigned
  `computeTeamAuras` directly, so a squad whose tags meet a threshold at
  spawn (e.g. 3 titan champions → Titan Bulwark) activated silently and a
  later death emitted an orphan 'synergy-off' with no matching 'on'.
  Seeding now goes through `recomputeAuras` (tick-0 transitions logged
  against the neutral placeholder). Log-only — the log is not digested —
  so ZERO digest impact.
- **Verified, correct by probe** (regression tests added in
  five-champions.test.ts): aura `armorFlat` + Iron Hide stack as ONE flat
  reduction with ONE min-1 floor (8+5 → 30-damage hit deals 17, 10-damage
  hit deals 1); Killer Instinct's 35% threshold is against the BAKED
  `baseMaxHealth` (35% of a Colossal-Frame Mass Monster = 731.5 of 2090,
  not 665 of the listed 1900) and never applies to sourceless damage
  (ultimates pass no source); Colossal Frame survives respawn exactly once
  (respawn at 50% of 2090 = 1045, healable back to 2090, never re-baked —
  fitness scaling preserved the same way); Mass Uprising summons inherit
  the deploy-shield aura and count toward tag synergies via their card
  tags (both documented design: champion-abilities.ts header + the
  synergy copies-count rule); initial tick-0 aura seed is bit-identical
  to what `recomputeAuras` produces (same function).
- **Quantified, intended (the documented one-tick aura latency)**: a team
  passive's aura lags composition by exactly one tick in BOTH directions,
  because the tick consumes the end-of-previous-tick snapshot. Respawn
  tick: energy regen at ×1 (not ×1.05), fresh from the next tick. Death
  between ticks: one tick of ×1.05 overhang. Magnitude ≈ 0.05 ×
  regenPerTick ≈ 0.0009 energy — imperceptible; deterministic and
  replay-identical (live and replay share the pipeline; digest-equality
  probed across reruns with mid-battle champion deaths).
- **Re-confirmed already-documented semantics** (no change): armour and
  `damageTakenMult` can blunt Final Cut's execute (M6 note above — an
  Iron-Hide Titan survives the execute at 5 health); armour applies only
  to melee (frontline rule) and never to cores or heals.

## P6 — combat feel

- **Idle bob deliberately deferred.** The brief allowed (not required) a
  cheap tick-parity champion bob gated on `useReducedMotion`. Skipped: it
  is the one P6 item that's continuous/ambient rather than reactive to an
  actual combat event, so it would need real reduced-motion wiring (the
  `verify-motion` guard only scans for `withRepeat` — a tick-parity bob
  wouldn't even trip it, meaning a careless implementation could ship
  ungated and undetected). Every shipped P6 effect is reactive and
  short-lived (≤700ms) instead, sidestepping the question entirely. Worth
  revisiting only if playtesting specifically asks for more ambient life
  in a stalled lane.
- **Telegraph position is the caster's position AT THE TIME THE FRAME
  PROCESSES the log entry**, not at cast time. For non-instant-movement
  abilities (most of them) this is identical; Phase Dash (which moves the
  champion TO the target as part of the same log line) telegraphs at the
  post-dash position, one frame later than the in-fiction cast point.
  Cosmetic only — the ability's actual targeting/damage is unaffected
  (visual layer never reads back into the engine); revisit only if
  playtesting finds the ring position confusing.
- **Hit-flash is proximity-matched, not id-matched**, because the `fx
  hit` log entry (combat.ts's `damageUnit`) carries lane/x/(defending)
  team but no unit id. Two units of the same team standing within
  `HIT_FLASH_MATCH_RADIUS` (3 world units) of each other could both flash
  on one hit meant for only one of them. Rare in practice (`unitSpacing`
  is 2, so this needs near-perfectly-stacked units) and harmless
  (over-flashing looks like "the group took splash," never wrong in a
  way that misleads about who died/survived — health bars are ground
  truth). Fixing it properly needs the engine's fx log entry to carry a
  target unit id, which is an engine change outside this pass's scope.

## P7 — readability (deferrals)

- **No pulsing/glowing "ready" animation on the ability/ultimate
  buttons.** A continuous ambient loop that only stops once the button is
  tapped is precisely the class of effect P6 already flagged and skipped
  for the idle bob: it isn't reactive to a discrete combat event, so
  shipping it carelessly could sit outside `verify-motion.mjs`'s reach
  (the guard only greps for `withRepeat` calls; a hand-rolled
  `Date.now()`-driven sine pulse wouldn't trip it either way, meaning a
  future author could add a real ambient loop here without the guard ever
  seeing it). Shipped a static alternative instead — a visibly thicker
  border (2px vs. 1px cooling) plus the new cooldown/charge progress fill
  — that reads "ready" at a glance without opening the reduced-motion
  question. Revisit only if playtesting specifically wants more visual
  "pop" on readiness.
- **No circular/radial cooldown sweep.** The ability/ultimate progress
  fills are linear bars, not a radial wipe around the button. React
  Native has no native radial-progress primitive; building one needs
  either an SVG dependency or a multi-view arc-mask hack, disproportionate
  effort for a readability pass whose brief was "clarity," not new visual
  chrome. The numeric label (READY/`Ns`/`%`) plus the linear fill already
  cover the same "how close" question.
- **Lane momentum is presence-only, not predictive.** `computeLaneMomentum`
  weighs each lane's CURRENTLY ALIVE units' health by team — it says
  "who's winning this lane right now," not "whose core falls first" (that
  would need each unit's remaining distance/speed/target and a real ETA
  calculation, i.e. engine-level pathing data this visual-only pass has
  no business computing or duplicating). Good enough for the stated goal
  (an at-a-glance push indicator); revisit only if playtesting wants a
  genuine "time to impact" readout.
- **No additional borrowed-vs-captain label.** The existing ring-thickness
  difference (captain: 2px border, `championSpriteFrame`; borrowed: 1px,
  `borrowedSpriteFrame`) plus the smaller overall marker size were judged
  legible enough at arena scale; a text label would either compete with
  the unit's own health bar/chevron for the ~18-26px marker's vertical
  space or require a bigger marker, which the M9 gym-war notes already
  weighed against (borrowed markers are deliberately smaller so a squad
  doesn't overwhelm a lane).
- **No animated energy-regen "creep" on the energy fill.** The new pips
  (one divider per whole energy point) were judged sufficient for the
  "can I afford this" question; an animated leading-edge creep would be a
  second new continuous visual driver in the same pass that just argued
  against one for the ability buttons — inconsistent to add here.
- **No formal colorblind simulation pass.** The chevron (a) and the
  `pathCardio` retint (g) were verified by inspecting every team/path hex
  pairwise for hue distinctness (documented in PROGRESS.md's P7 section),
  not by running the palette through a simulator (e.g. Coblis) — no such
  tool was available in this environment. The team hues themselves
  (cyan/red) were already colorblind-safe pre-P7 (not a red/green pair).

## P9 — cards & synergies (deferrals)

- **Mass still has only one FIGHTER card** (`heavy-tank`, dual-tagged
  titan/mass). `power-belt` picked up the `'mass'` tag for collection-
  screen/flavor coverage, but equipment never spawns a combatant, so it
  cannot help `mass-presence` activate — that synergy is (and remains)
  reachable only via champion-mass + heavy-tank, or by replaying
  heavy-tank twice in one match. A second mass-identity fighter (not a
  stat-clone of heavy-tank) is the real fix; deferred rather than adding
  a 21st card outside the 12–20 requirement without a matching
  merge/cut elsewhere.
- **Equipment/technique tags are cosmetic only, not audited for
  synergy-reachability parity with fighters.** `content/validate.ts`'s
  new reachability check deliberately counts FIGHTER cards only (matching
  how `game-engine/synergies/synergies.ts` counts combatants), so a
  technique/equipment card's tag (e.g. `overload`'s `'tech'`,
  `reinforced-armour`'s `'titan'`) is never verified against anything —
  it is pure collection-screen flavor text. Fine today (no mismatches
  found), but nothing stops a future card from picking a tag that reads
  as wrong in the collection screen without any test catching it; a
  lightweight "does this technique/equipment's tag match its
  `balanceTags`/effect shape" lint is the sketched follow-up, not
  built (no clear falsifiable rule presented itself in this pass).
- **`art` placeholder keys were left unchanged on every renamed card**
  (e.g. `neon-boxer`'s art key is still `'neon-boxer'` though its display
  name is now "Cardio Boxer"). Per `content/types.ts`, `art` is "a
  placeholder key — maps to a temporary visual (color/icon), not a
  file," so this has zero player-visible effect; flagged only so a
  future real-art pass does not assume the art key is the display name.

## P10 — AI tendencies (deferrals)

- **Shredder sits on the band edge (58%) and Titan near the floor (43%)**
  in the 362-match deep harness — inside the required [42,58] band, but
  the tendency pass widened the P8 spread (7 → 15 points) because smarter
  ultimate usage is real value (Shredder no longer wastes Final Cut) and
  holding stomps has real cost (Titan). One tuning attempt (a low-health
  "defensive peel" stomp valve) measurably moved both edges the wrong way
  (Titan 43→42, Shredder 58→59) and was reverted. If a future pass needs
  to narrow the spread, tune the TENDENCY table in
  `features/arena/champion-tendencies.ts` (never champion stats — that
  was P8's job and its numbers are pinned by tests).
- **Final Cut kill estimate ignores armor and damage-taken modifiers.**
  `finalCutWouldKill` models shield-then-health and the post-hit execute
  threshold exactly, but not the target's flat armor (Iron Hide, synergy
  auras) or damageTakenMult modifiers — against an armored/bulwarked
  target the AI may cast a Final Cut that leaves a sliver. Legality and
  determinism are unaffected (the engine resolves the truth); it is a
  deliberately simple heuristic, refine only if the harness ever shows
  Shredder underperforming into Titan/Aesthetics specifically.
- **Cardio's Overclock tendency has no held-long valve by design** — a
  fully-charged ultimate can sit unused until the champion is engaged in
  its lane (or the core is threatened). It cannot strand forever in
  practice (the AI keeps deploying and enemies march), but a
  pathological stalemate with an empty enemy lane would leave the charge
  banked; accepted as the lesser evil versus overclocking while walking
  alone.
- **Standard-tier tendency rolls consume one extra RNG draw per decision**
  (with a living captain), and runtime creation consumes two extra draws
  (opening lane/style) at every tier — every pre-P10 AI stream shifted,
  which is why three seed-sensitive fixtures were re-pinned (see
  PROGRESS P10). Replays/records are unaffected (commands are recorded;
  the AI never runs during replay), but any external harness that pinned
  exact P9 battle digests must re-pin.
- **Opening variety only varies the PRESSURE branch** (lane + fighter
  scoring style) inside the 20s window. The defend/heal/support branches
  deliberately stay reactive, and training keeps its per-decision random
  lanes — so two seeds with an identical early threat pattern can still
  converge to similar defensive openings. Accepted: never ignoring a real
  push outranks variety.

## P11 — player journey (deferrals)

- **The difficulty lock is advisory by design**: a 0-win player can still
  select Standard/Advanced with a deliberate second tap (the brief's
  "explicit choice"). Pre-v6 saves that never battled are re-defaulted
  to 'training' by the migration; a pre-v6 player who had EXPLICITLY set
  'standard' without ever battling is indistinguishable from the old
  default and gets re-defaulted too — accepted (two taps restore it).
- **The result overlay has no "Watch Replay" shortcut**: the battle
  record is persisted asynchronously (best-effort, after snapshots
  resolve), so a link straight from the overlay could race a
  not-yet-written record. Entry point stays the Battle Log (one tap
  away via Back to Lobby); wiring a ready-when-persisted link is
  backlog.
- **Identity sync is boot-time only**: an EvoForge display-name change
  mid-session shows up in the Arena on the next `/forge-arena` boot, not
  live. Same staleness class as the provider's other reads (fitness is
  fetched per battle already); acceptable for the beta.
- **`showDebugPanel` has no UI toggle**: with the debug doors dev-gated,
  production access to /forge-arena/debug is by URL only (deliberate —
  the flag remains in the save for a future settings screen).
- **gym-roster/gym-squad still phrase non-membership as "unavailable"**:
  they are only linked from the gym overview, which now gates
  non-members with the dedicated no-gym state first, so the copy is
  unreachable in the normal journey; unifying them onto the no-gym
  component is cosmetic backlog.
