# EvoForge client — project memory

> **Resuming a session? Read `../HANDOFF.md` FIRST** — full state, invariants,
> operational gotchas, credentials map, and the verification workflow.

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
- **Solo physique photos are never persisted anywhere.** In memory, to the
  Edge Function, discarded. No cache, no temp file, no state store.
  **ONE amendment (Tyson, 2026-07-11, BATTLE_ARENA_DESIGN.md D2): battle
  round-3 photos ARE stored** — camera captures only, uploaded by
  battle-physique (service role) into the private `battle-media` bucket,
  readable solely by that match's two participants (both OPPONENTS VIEW each
  other's round-3 photos in-match via short-lived signed URLs, revealed only
  once both verdicts are final), deleted with the match and on cancel.
  The Oracle screens keep the original rule; do not widen the amendment.
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
  (auth)/       sign-in, sign-up; signed-in users bounce out
  onboarding    character creation; writes the profile row = onboarded flag
  (main)/       gated: no session -> sign-in, no profile -> onboarding
src/data/       supabase client, LargeSecureStore, auth-context, hooks.ts
                (per-user query keys, Python's wire projections, 2500 cap;
                useLedgerXp returns null on ANY failure, NEVER 0)
src/domain/     the TS port + summary.ts (workout_summary's pure core over rows)
src/theme/      tokens.js (SOURCE OF TRUTH) + animations.ts (12 keyframes as data)
src/ui/         AvatarCard, XpBar, RarityBadge, avatar-images (10 PNGs)
scripts/        verify-tokens.mjs
```

## Hard-won operational notes
- **Metro caches inlined EXPO_PUBLIC_ values.** Changing env (or .env.local)
  does NOT invalidate the transform cache: an export after an env change ships
  the OLD values unless you pass `--clear`. This shipped a placeholder Supabase
  URL into a local build once; the only symptom was "Failed to fetch" at
  runtime. CI runners are fresh so they are immune; local exports are not.
- **`expo export` does not generate expo-env.d.ts** — only `expo start` does.
  CI writes the one-line shim itself before tsc.
- **GitHub secret values arrive decorated.** supabase.ts extracts the URL and
  key by pattern from whatever was pasted (quotes, whole NAME="value" lines);
  the CI "Validate Supabase env shape" step warns with derived properties only.
- **Anonymous API access cannot read Actions step logs** (403), only check-run
  annotations. The export/tsc steps replay failures as ::error:: commands so
  they land in the annotations feed. Annotations cap at 10/step — spend them
  on message lines, never stack frames.

## Testing
`src/domain/__tests__/parity.test.ts` drives all 3,323 golden cases from
contracts/fixtures/ (JSON-imported; exact equality, floats included — both
sides are IEEE-754 doubles, a tolerance would let a wrong formula pass).
CI: .github/workflows/client.yml runs tokens guard, export, tsc, and the
Python-side `gen_fixtures.py --check` next to it.
