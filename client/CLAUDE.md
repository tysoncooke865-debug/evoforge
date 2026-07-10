# EvoForge client — project memory

The Expo rewrite of EvoForge (MIGRATION_PLAN.md at repo root is the plan; the
root CLAUDE.md is the Streamlit app's memory and stays authoritative for the
Python side until cutover). Same Supabase project, same 13 tables, same rules.

## Stack (pinned by the scaffold on 2026-07-11 — trust package.json, not recall)
Expo SDK 57 (expo 57.0.4) · React Native 0.86.0 · React 19.2.3 · Expo Router
(src/app/) · NativeWind 4.2.6 + Tailwind 3.4.17 · Reanimated 4.5.0 ·
supabase-js 2.110 · TanStack Query 5 · Zustand 5 · TypeScript 6.0.3 · Vitest 4.

## Commands
```bash
npm test                        # Vitest parity suite vs contracts/fixtures/
node scripts/verify-tokens.mjs  # tokens.js === assets/styles.css :root
npx tsc --noEmit                # needs expo-env.d.ts: run an expo command first
npx expo lint                   # includes react/no-danger (error)
npx expo start / export -p web  # dev / static build to dist/
```
Setup: copy `.env.example` to `.env.local` (gitignored) and fill in the
Supabase URL + PUBLISHABLE key. Never a secret key: EXPO_PUBLIC_ compiles into
the shipped bundle. AI calls go through Edge Functions (Phase 4), never client-side.

## The doctrine, translated from the Streamlit app's hard lessons

- **The XP curve numbers are a contract.** `500 + (L-1)*25`, 10 XP/set,
  2 XP/cardio-min, rarity at 25/50/75/100. They change only by changing
  `domain/xp.py` FIRST, regenerating goldens (`python tools/gen_fixtures.py`),
  then re-porting. `src/domain/` is a line-by-line port; the fixtures are the
  arbiter of correctness, not readability.
- **`src/domain/catalogs.ts` is GENERATED** from contracts/fixtures/catalogs.json.
  Regenerate, don't hand-edit — the parity suite pins every string.
- **`src/domain/py.ts` exists because `int()`/`float()` are not `Number()`.**
  int("5.5") raises in Python; Number("") is 0, float("") raises. The ported
  code sanitises inputs through pyInt/pyFloat to keep truncation-toward-zero
  and raise-vs-default semantics identical. Don't "simplify" them away.
- **Sign-out clears EVERY cache layer**: `supabase.auth.signOut()` +
  `queryClient.clear()` in auth-context, plus every Zustand store as they are
  added. The Streamlit app had four caches; missing one on sign-out handed the
  last athlete's character to the next visitor. Same rule, new stack.
- **Per-user isolation is RLS, never client filtering.** Every query runs as
  the signed-in user; `DEFAULT auth.uid()` fills user_id on insert. Do not add
  .eq('user_id', ...) as a security measure — it is not one.
- **Physique photos are never persisted anywhere.** In memory, to the Edge
  Function, discarded. No cache, no temp file, no state store.
- **No `dangerouslySetInnerHTML`** — react/no-danger is an ESLint *error*.
  The old app's ui/escape.py existed because HTML injection could read the
  auth cookie; React's default escaping is the replacement, and this rule
  keeps the hatch shut on web builds.
- **A guard that cannot fail is not a guard.** verify-tokens asserts a
  non-empty parse; the parity suite asserts fixtures are non-empty before
  iterating; every new check gets falsified once (break it, watch red,
  restore) before it is trusted.
- **Two rarity palettes coexist ON PURPOSE** (pinned, not blessed): the badge
  palette in `src/domain/avatar-stats.ts::avatarRarity` (from Python) and the
  aura palette in `src/theme/tokens.js` (from CSS :root). Only COMMON agrees.
  Unifying them is a product decision tracked outside this migration.
- **tokens.js is the single copy of every design value**, required by
  tailwind.config.js and imported by TS. The Streamlit app once had four
  competing :root blocks. scripts/verify-tokens.mjs enforces parity with
  assets/styles.css both directions while Streamlit remains live on main.

## Layout
```
src/app/        Expo Router routes (src/app, not app/ — root app.py exists)
src/data/       supabase client, LargeSecureStore, auth-context; Query hooks later
src/domain/     the TS port. Pure functions only until Phase 3.
src/theme/      tokens.js (SOURCE OF TRUTH) + animations.ts (12 keyframes as data)
scripts/        verify-tokens.mjs
```

## Testing
`src/domain/__tests__/parity.test.ts` drives all 3,323 golden cases from
contracts/fixtures/ (JSON-imported; exact equality, floats included — both
sides are IEEE-754 doubles, a tolerance would let a wrong formula pass).
CI: .github/workflows/client.yml runs tokens guard, export, tsc, and the
Python-side `gen_fixtures.py --check` next to it.
