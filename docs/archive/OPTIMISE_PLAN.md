# OPTIMISE_PLAN — layout, performance, motion (2026-07-16)

> Tyson's brief: professional Expo folder layout, everything efficient and
> easy to change, incredible performance, tasteful load/transition
> animations. Streamlit is RETIRED (same day) — constraints that existed
> only for it are void. Status: EXECUTING.

## 0. Measurements first (source-map, 2026-07-16)

One 3.5MB minified entry (6.5MB pre-min, 1,852 modules). Breakdown:
framework core ~3.2MB pre-min (expo-router 1.16M, reanimated 741K, RN-web
734K, react-dom 533K) — the floor. Removable/splittable: supabase realtime+
storage+phoenix (~255K, constructor-instantiated — skip), url polyfill +
whatwg-url + punycode (~100K, web needs NONE of it), aes-js + buffer (~110K,
native-only secure store), fflate 89K (one route), d3-shape 60K (one
component), app+ui+domain ~1.06M (mostly route-specific).

## 1. Performance (biggest first)

- **P1. Async routes on web** — `expo-router` plugin `asyncRoutes:
  {web: true, default: 'development'}`. Production-supported on web ONLY —
  exactly our deploy. Each route becomes its own chunk; the entry keeps the
  shell + Home. This is the route-level code splitting HANDOVER §7 believed
  this pipeline lacked. Verify: dist has N chunks, entry shrinks, EVERY tab
  + pushed page tours clean (watch the `href: null` workout page and the
  cold-start resume redirect).
- **P2. Platform-split the native-only weight** — `.native.ts` twins so
  Metro's platform resolution drops them from web entirely:
  - `react-native-url-polyfill/auto` (web has real URL),
  - `LargeSecureStore`/aes-js/buffer (web auth uses localStorage).
- **P3. Confirm the stragglers** — semver/iceberg-js/fflate importers;
  fflate + d3-shape ride their route chunks after P1.
- **P4. Ratchet, never relax** — re-run Lighthouse budgets in CI; if LCP
  materially improves, RAISE `lighthouserc.json` budgets to pin the win.

## 2. Folder layout (professional Expo, minimal churn)

The top level is already the standard shape (`src/app` routes · `data`
hooks · `domain` pure logic · `state` stores · `theme` tokens · `ui`
components). What is NOT professional is `src/ui` as a 50-file flat pile.
Regroup by feature, no barrels (they hurt code splitting):

```
src/ui/core/       shell, hud, neon-button, screen-header, segmented-tabs,
                   pixel-icons, field, number-field, toast-host, line-chart
src/ui/character/  avatar-*, hero-stage, sprite-avatar, silhouette,
                   companion-menu, rarity-badge, evolution-teaser, skill-tree,
                   particle-layer, floating-xp, level-up-overlay
src/ui/train/      exercise-*, cardio-logger, rest-timer, week-bar,
                   daily-workout-carousel, summary-sheet, plan-import,
                   scan-frame, scheme-sentence, quest-card, streak-calendar
src/ui/arena/      battle-arena, face-off, coin-flip, leaderboard-*
src/ui/home/       (already exists)
src/ui/muscle-map/ (already exists)
```

Mechanical move + import rewrite; tsc, lint, 561 tests and the tours are
the proof. HANDOVER's map updated in the same commit. `domain/`, `data/`,
`app/`, byte-pinned files: NOT touched.

## 3. Motion (one-shot, quiet, reduced-motion-gated)

- **M1. Screen entrance** — ScreenShell fades+rises its content on focus
  (180ms, one-shot, `useReducedMotion` gated). Every tab switch feels
  intentional; no loops, no scroll jank.
- **M2. Home hero stagger** — header → stage → mission cascade on first
  mount (60ms steps, one-shot).
- **M3. Boot moment** — root layout cross-fades from the splash colour
  once fonts/session resolve (no blocking gate — the system font swap rule
  stands).
- The verify-motion guard must stay green; ambient loops keep their gates.

## 4. Streamlit retirement (same session)

- Docs: HANDOVER + root CLAUDE.md banner the retirement; the "never add
  columns to custom_workout_plan" rule dies with it (the table itself
  remains until data is migrated).
- `tools/hooks/pre-push`: skip the 11 Python checks when the push touches
  only `client/` ([architect] — tools/hooks is protected).
- KEPT deliberately: the domain goldens + parity suite (they pin
  correctness, not Streamlit) and verify-tokens (tokens.js self-consistency
  still guarded; drop the CSS pin only when styles.css is deleted).

## 5. Debug sweep

Console-capture tours across sign-in → Home → Train → workout → Progress →
Forge → Arena; fix real defects (key warnings, act errors, failed fetches
beyond the known 409/401 noise).

## 6. Order of execution

P2 → P1 (measure) → §2 restructure → §3 motion → §4 retirement → §5 sweep
→ full loop → P4 ratchet → push → live-bundle verify → HANDOVER + memory.
