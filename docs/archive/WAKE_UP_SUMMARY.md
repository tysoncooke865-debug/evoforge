# WAKE-UP SUMMARY — overnight session, 2026-07-15 (~2:00–3:00am)

Everything you queued is **shipped, CI-green, deployed and toured against production**.
Three feature batches went out on `expo-rewrite` tonight; the app auto-deployed each.

## 1. KG⇄LB per-exercise toggle — LIVE
Commits `4898400` · `2995498`. The weight column header on every logging card is now
the toggle; preference persists per exercise. **The database never learns pounds** —
lb→kg converts exactly once at save (2 dp, round-trip stable, falsified in tests), and
PRs/e1RM/volume/achievements/battles all still read kg.
- **Toured against production**: typed 100 lb through the real UI → the `workout_log`
  row read back **45.36 kg**; reload showed 100 lb again. Seeded rows deleted.
- ⚠ **YOUR ONE STEP:** run `migrations/020_weight_unit_pref.sql` in the Supabase SQL
  editor. Until then the toggle shows an honest "UNIT NOT SAVED" toast (favourites are
  safe — the read has a pre-020 fallback). One additive ALTER TABLE.

## 2. Type-ahead exercise search bar, everywhere — LIVE
Commit `9f54a20`. Inline search on every add surface: active workout, routine builder,
empty-workout sheet (picks seed the ad-hoc), and the swap sheet (search swaps to
anything). Nothing renders until the first letter; boxes narrow per keystroke;
mid-name matching ("incline press" → machine variants) verified live and now pinned
by a test. Onboarding reaches it via BUILD MY OWN → the builder.

## 3. PLAN SCAN — photo/typed workout → AI reads it → editable draft → MY PLAN
Commits `2fd6379` · `1ecb340` · `24e302b`. The plan you approved, in full:
- `ai-plan-scan` edge function (transcribes, never authors; relaxed validator for
  custom day names; photos read-and-discarded; cache kind `plan-scan`).
- Every scanned name is **deterministically best-guess mapped** onto the 960-library
  client-side; unmatched lines survive verbatim with a ⚠ badge, never dropped.
- The draft seeds the routine builder (custom split) for review → SAVE MY PLAN.
- 📷 SCAN A WRITTEN WORKOUT button in the builder; 📷 SCAN MY PLAN tile in
  onboarding → lands on `/routine?import=1` with the sheet open.
- **Toured against production** (edge-function response mocked — see below): typed
  text → mapped chips + badges → both days seeded → SAVE wrote the real `user_plans`
  row ("Old Notebook Program", bench 5×5 intact, ghost line preserved+flagged) →
  cleaned up.
- ⚠ **YOUR ONE STEP:** `supabase functions deploy ai-plan-scan` (and
  `ai-nutrition` from the parallel branch, whenever). No CLI/token on this machine.
  Until deployed, the sheet shows the standard "AI functions are not deployed yet".

## Numbers
496 tests green (was 427 at HANDOVER) · tsc/lint/3 guards/export all clean per
commit · CI green on every push (client, fixtures, lighthouse, deploy) · every
feature's markers grep-verified in the LIVE bundle.

## The manual steps waiting for you (all dashboard/CLI, none blocking the app)
1. **Migration 020** (`020_weight_unit_pref.sql`) — unlocks the LB toggle.
2. **Deploy `ai-plan-scan`** — unlocks PLAN SCAN's AI call.
3. The parallel `nutrition` branch (untouched tonight): migration `020_nutrition.sql`
   → **renumber to 021 at merge** (mainline claimed 020), deploy `ai-nutrition`.
4. Old TASKS.md `[human]` items still stand (confirm-email, key rotation, T3b…).

## About the 5:20am restart you asked for
Not needed, and not possible without you:
- **Not needed:** every queued task finished before usage ran out; nothing autonomous
  remains — the leftovers above all need your dashboard/CLI access.
- **Not possible:** I tried to schedule a 5:20am cloud routine as insurance, but the
  cloud agents have **no GitHub connection** to this repo — run `/web-setup` (or
  install the Claude GitHub App) once and future overnight scheduling works.

## Honest notes
- PLAN SCAN's OpenAI call itself is the one untoured piece (function not deployed);
  everything around it — validator logic, mapping, seeding, saving — is tested and
  toured. First real photo scan after you deploy is worth a minute of your time.
- Smoke account ALPHA accrued ~20 XP of ledger drift from seeded-then-deleted tour
  sets (append-only ledger; standard seeding cost).
- `client/.env.local` was recreated on this machine from the live bundle's public
  key (gitignored) so local exports work.
- This file is disposable — delete it once read; HANDOVER.md carries the durable state.
