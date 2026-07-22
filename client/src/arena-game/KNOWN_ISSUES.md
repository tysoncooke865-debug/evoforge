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
  one-line change if Gym Wars (M9+) needs it.
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
- **Always-valid abilities auto-cast on cooldown**: a borrowed Speedster
  casts Lane Shift the moment it recharges (its validate is
  unconditionally OK), ping-ponging lanes every 10s; a borrowed Hybrid
  similarly stance-shifts on cooldown (which is fine). Deterministic and
  replay-safe; a "combat nearby" gate like the AI's would fix the Speedster
  quirk if playtesting minds it.
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
