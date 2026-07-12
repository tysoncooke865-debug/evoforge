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

## V2 divergence (2026-07-11, deliberate new-app features)
The pinned 3-branch rule and v1 placement stay golden-fixtured (the Streamlit
app still runs them). The new app layers on top, client-side only:
- **5 classes** (`branches-v2.ts`): TITAN (str≥80 & size≥70 & size dominant)
  and CARDIO MACHINE (cond≥70 & dominant) checked BEFORE the pinned core, so
  existing athletes cannot flip branch without crossing an extreme gate.
  Sub-extreme space sweep-tested identical to the core rule.
- **Placement v2** (`starting-level-v2.ts`): bench/squat/deadlift bands +
  years + AI physique/leanness (0-15). NO self-scored sliders. Skipped scan →
  documented derived defaults (lifts→physique; phase→leanness). Matches v1
  exactly when deadlift=0 and AI scores equal the old sliders (tested).
- **Onboarding v2**: sex → lifts (incl. deadlift) → nutrition phase → AI scan.
  Migration 008 (applied): profile.sex / deadlift_e1rm / nutrition_phase,
  additive+nullable; Streamlit unaffected.
- **Strength standards curve (2026-07-11)**: `strength_score_from_ratios`
  changed IN THE CORE (both sides identically, golden-pinned in avatar.json):
  per-lift anchors novice 25 / intermediate 50 / advanced 75 / elite 100
  (bench 0.75/1.25/1.75/2.25 × BW, squat 1.0/1.5/2.0/2.5, deadlift
  1.25/1.75/2.25/2.75), replacing the old linear (bench/1.5)·55+(squat/2)·45.
  Deadlift ≤ 0 falls back to the 55/45 two-lift blend; with one it blends
  40/30/30. **Client-side deviation**: the Expo app feeds
  profile.deadlift_e1rm (an 008 column) into the deadlift slot — Streamlit
  cannot see that column and its catalog has no barbell deadlift, so its
  behaviour is identical to the two-lift blend until cutover. Romanian
  Deadlift deliberately does not count as the deadlift.
- **Sex calibration (2026-07-12, client-side deviation, Tyson-requested)**:
  `calculateAvatarStats` / `strengthScoreFromRatios` take an optional
  `SexCalibration`; the DEFAULT is the male constants verbatim (goldens
  untouched — the parity suite runs the default path). Female athletes
  (profile.sex = 'female', wired in use-avatar-data) grade against female
  standards: strength anchors bench 0.5/0.85/1.2/1.6 × BW, squat
  0.75/1.15/1.6/2.05, deadlift 0.95/1.35/1.8/2.3; leanness 100 from 16% bf
  (slope 5.0/%); size bodyweight window 50–75 kg; frame labels 72/64/58 kg;
  default bodyweight 62 kg. Self-consistency: sex-calibration.test.ts
  (male-path identity + equal-relative-performance-equal-points).
  Streamlit remains sex-blind until cutover — a female athlete's scores
  will differ between the two apps; the Expo numbers are the intended ones.

## THE SHREDDER (sixth class, 2026-07-11)
Entry by STARTING CONDITION: first body-fat reading ≥25% + cutting phase.
Expires when the phase changes (falls through to the other resolvers).
Stages are driven by BODY FAT FALLING, not level: ≥25 Hooded Resolve →
<25 The Grind → <18 Cut Deep → ≤12 Shredded. Four male art stages SHIPPED
(client/src/assets/avatars/shredder_stage_1-4.png, ~1-3MB each — could use
compression). NOTE: this art has BAKED BACKGROUNDS (not transparent), so it
renders as-is and is never tint-silhouetted (a solid box results); locked
previews use the aesthetic donor silhouette. Transparent re-exports of the
same art would unlock the full stage effects (reflection, tint).

## ART NEEDED (male art exists for aesthetic ×4, mass ×3, hybrid ×3, shredder ×4)
Until these land, forms render as rim-lit silhouettes captioned
"FORM NOT YET FORGED". Drop PNGs in client/src/assets/avatars/ and register
them in `client/src/ui/avatar-art.ts` (one require + hasArt flip each):
- male_titan stages 1-3 · male_cardio stages 1-3
- female_aesthetic 1-4 · female_mass 1-3 · female_hybrid 1-3
- female_titan 1-3 · female_cardio 1-3 · female_shredder 1-4
- transparent-background re-exports of male shredder 1-4 (optional, unlocks staging)

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
