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

- [ ] PR-1 **HIGH (the Phase 4 question): script-bound render path on
  phone-class CPU.** Whole-tree un-memoized re-render at 20Hz = 9.0fps at
  4× CPU throttle / 6.2fps at 6× (30/team + 150 particles), while layout+
  style stay <5% and the sim holds 20Hz. Desktop is fine to 30/team.
  Evidence: ARENA_PERFORMANCE_BASELINE.md, ARENA_STRESS_TEST_REPORT.md.
  Candidates ranked in ARENA_RENDER_ARCHITECTURE.md §5. OPEN → Phase 4.
- [ ] PR-2 MEDIUM: **Arena ignores the app's avatar identity** — path-only
  sprites; no stage/sex/skin/premium-character awareness
  (AVATAR_VISUAL_SOURCE_MAP.md §2). Phase 5 scope. OPEN.
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
