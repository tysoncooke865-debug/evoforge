# Known Arena Issues — premium-program living checklist

The premium program's issue ledger. Predecessors stay authoritative for
their eras: `KNOWN_ISSUES.md` (engineering, standalone-era) and
`KNOWN_POLISH_ISSUES.md` (polish pass presentation items). Open items from
those ledgers that the premium program inherits are RESTATED here; update
status per phase commit, never silently.

Status: OPEN · IN PROGRESS (phase) · DONE (phase, commit) · NEEDS-TYSON.

## Inherited (polish pass R1-R4 / G2 / A3 / C6)

- [ ] P-R1 HIGH (playtest): Training AI may trap new players (five scripted
  players lost five straight; win-gated tiers). ONE human session decides;
  tune TENDENCY or a training-only handicap, never champion stats. NEEDS-TYSON.
- [ ] P-R2: zero testIDs in the production battle screen — tours click by
  coordinates. The stress lab ships fully test-ID'd (precedent set); battle
  screen is Phase 11 scope. OPEN.
- [ ] P-R3 LOW: floor amber accent strips tile noticeably on tall screens.
  Phase 12 scope. OPEN.
- [ ] P-R4: VICTORY ceremony never captured on screen (code-shared with the
  verified defeat path). Capture during the human playtest. OPEN.
- [ ] P-G2: gym-war intro squad row + owner nameplates never verified
  on-screen (smoke accounts must not create real gyms). NEEDS-TYSON (device
  pass or a blessed private smoke gym).
- [ ] P-A3: audio absent from the arena BY DEFERRAL. Correction on record:
  the app HAS a synth SFX system (`src/ui/core/sound.ts`, settings-gated) —
  Phase 15 extends it; default-volume-in-public remains Tyson's call.

## Premium program findings (Phase 1-3, 2026-07-23)

- [ ] PR-1 **HIGH: script-bound render path on phone-class CPU (Phase 4
  DECIDED, execution pending).** 20Hz whole-tree re-render = 9.0fps at 4×
  CPU throttle / 6.2 at 6× (30/team + 150p); layout+style <5%, sim holds
  20Hz. Desktop meets the slice's 30-combatant target. **Phase 4 decision
  (ARENA_RENDERER_DECISION.md): stay on RN, do NOT migrate to Skia; staged
  measured optimization. Corrected root cause — the cost is (a) a ~12%
  fixed chrome floor (memoizable) + (b) N actively-fighting units that
  change every tick (NOT memoizable; need cheaper-per-unit or off-thread
  Reanimated motion).** Ordered plan in that doc §6. OPEN (execution folds
  into Phase 7/16).
- [ ] PR-7 **HIGH / BLOCKING: no real-device measurement exists.** Every
  perf figure is desktop Chromium; the 4×/6× throttle is a synthetic proxy.
  Phase 4 Step 0: open the Render Stress Lab on a recent iPhone + older
  iPhone + ordinary Android (PWA + Expo Go) at 30/team, read the HUD.
  Decides whether any renderer optimization is even needed. NEEDS-TYSON.
- [x] PR-2 MEDIUM: **Arena ignores the app's avatar identity.** DONE
  (premium P5, 2026-07-23): ArenaAvatarProfile pushed from
  useDisplayIdentity via the layout bridge; battle-asset fidelity chain
  live everywhere; lobby shows the app's own skinned/staged still + form
  line; intro carries stage identity; display path refines the first-run
  champion prefill (fixed: originless athletes no longer default to Titan
  when Home shows a different champion). REMAINING: stage/skin VARIANT ART
  does not exist yet — every profile resolves canonically until Phase 8
  (contract in ARENA_COSMETIC_COMPATIBILITY.md §5).
- [ ] PR-8 INFO (measurement doctrine): stress-sweep ABSOLUTE numbers are
  session-relative (host load/thermals shift everything — a same-day rerun
  of identical code moved 30/team from 60fps to ~50fps). Any before/after
  perf claim must be a same-machine same-session A/B (TOUR_BASE_URL vs
  local dist). Recorded in ARENA_STRESS_TEST_REPORT.md §5b. STANDING RULE.
- [ ] PR-3 LOW: desktop 1%-low dips to 30fps at 40/team (nine >33ms frames
  in 512) — above the slice's 30-combatant target, recorded as the desktop
  ceiling. OPEN (re-measure after Phase 4's chosen optimization).
- [ ] PR-4 LOW: `publishMs` measures scheduling only (React 19 async flush)
  — do not use it as a render-cost proxy; the rAF sampler is the truth.
  Documented in the baseline; profiler HUD labels kept honest. DONE-BY-DOC.
- [ ] PR-5 INFO: battle event log is append-only per match (~4.5
  entries/tick at 40/team); freed on battle drop — heap measured flat across
  10 matches, so this is a bounded design fact, not a leak. No action.
- [x] PR-6: engine purity now CI-enforced (`verify-arena-purity.mjs`,
  falsified once). DONE (premium P2, this commit).

## Standing tripwires (re-verify every phase — not issues)

Replay digest parity · deep harness 0 defects + unchanged win-rate table
(54/54/50/47/45) · full gate sweep green · no new timers/Animated loops ·
FX teardown on unmount (sweep checks `__ARENA_PROFILE` removal) · zero
arena server writes ('dev-stress' and 'ghost' return before the provider) ·
7-warning lint baseline.
