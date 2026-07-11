# PARITY.md — the "faithful" checklist (MIGRATION_PLAN Phase 6)

Web at 1280px and 390px is the parity target; native gets *documented*
idiomatic deviations. A row is closed when both teammates sign it off against
the live Streamlit app. Domain numbers are NOT re-checked by eye — 4,621
golden cases already pin Python↔TS agreement in CI; this list is about what
renders.

Legend: ✅ built + machine-verified · 👁 built, needs human sign-off · — not built

| View (Streamlit) | Expo route | State | Deviations / notes |
|---|---|---|---|
| auth | (auth)/sign-in, sign-up | 👁 | Live-smoke-tested against prod auth (gate redirect, clean 400 render). |
| onboarding | /onboarding | 👁 | Single-screen character creation (Streamlit is a 3-step wizard). **NEW: optional AI assist** — photo → physique/leanness scores + first bf reading. Targets step (old step 2) lives on Goals instead. |
| home | (main)/index | 👁 | Character sheet with animated stat meters (numbers were plain text in Streamlit). Rank shown in the masthead. |
| today | (main)/today | 👁 | Update-in-place set editing; day pills in true week order (ROUTINE_ORDER). |
| routine | (main)/today | 👁 | Merged into Today — the day picker IS the routine browser. |
| cardio | (main)/log | 👁 | Merged into Log; XP preview on the button = exact grant. |
| bodyweight | (main)/log | 👁 | Merged into Log. |
| measurements | (main)/log | 👁 | Merged into Log (11-field tape card). |
| bodyfat | (main)/ai | 👁 | **Product change (Tyson):** one AI page. Navy/measurement estimate modes not yet ported — AI photo mode only. |
| physique | (main)/ai | 👁 | Same page as body fat. Plan generation (ai-plan) not yet built. |
| avatar | (main)/avatar | 👁 | Living stage (idleFloat/breathe/auraPulse/groundPulse), evolution line, locked = tinted silhouette (build-time locked PNGs pending). |
| progress | (main)/progress | 👁 | Bodyweight + bench e1RM lines (hand-rolled SVG chart, crosshair tooltip). Streamlit had more series — extend on demand. |
| goals | (main)/goals | 👁 | BF/BW/bench targets with journey bars. 1RM targets for other lifts not yet. |
| achievements | (main)/awards | 👁 | All 64, earned state + dates. |
| leaderboard | (main)/rank | 👁 | Drift refusal, opt-in gate, rank-by-level. |
| profile | (main)/profile | 👁 | Rank ladder (derived), identity state, **perf-mode toggle**, sign-out. |
| data_manager | (main)/data | 👁 | fflate ZIP export (web download; native share pending). |
| delete_data | (main)/data | 👁 | Typed-DELETE per-table wipe; xp_events excluded by design. |

## Cross-cutting
- Animations: 12 keyframes transcribed in `client/src/theme/animations.ts`; ambient loops
  (float/breathe/aura/ground/sheen/xpPulse) yield to perf mode + OS reduced-motion;
  one-shots (toasts, fills, unlock) always play. ✅
- Design tokens: 56/56 `:root` values byte-checked both directions in CI. ✅
- Rarity palettes: badge=Python, aura=CSS — the shipped mismatch, pinned on purpose. ✅
- Screenshot tour: `scratchpad/ui_tour.py` drives the exported build as the
  `smoke-test-claude@evoforge.internal` account (admin-created, RLS-isolated,
  safe to delete) and captures every screen at 430px.

## Living-RPG pass (2026-07-11, plan cheeky-floating-lecun)
HeroStage (platform/fog/reflection/particles, XP-reactive bloom), HUD layout on
Home (cards removed where they added nothing), StatBar rows w/ radar toggle,
FloatingXP from confirmed insert verdicts, SummarySheet ceremony, LevelUpOverlay
(confirmed-state detector, ready-gated -- the tour caught the pre-load false
fire), Avatar requirement bars + readiness + NEXT UP/THE WALL, true silhouettes
w/ ??? beyond the next form, Oracle ScanFrame states mapped to the real invoke
lifecycle, contextual cardio fields + repeat-last, derived day streaks, safe-area
shell + tab bar, motion duration tokens.

## Known gaps (tracked, deliberate)
- ai-coach / ai-plan Edge Functions (custom plan generator) — not yet built.
- Navy-formula body-fat entry mode (non-AI) — domain math is ported and
  golden-pinned (`navyBodyFatMale`), screen not yet wired.
- Locked-avatar PNGs via build-time Pillow script — tintColor stands in.
- Native (Expo Go) session check — parked on Apple approving Expo Go SDK 57.
- 1280px desktop sidebar variant — bottom tabs serve all widths for now.
- Personalisation (accent themes, banners, custom titles) — needs a user-prefs
  table (would be migration 008); component slots exist, deferred.
- Workout duration on the summary sheet — needs session start/stop tracking.
