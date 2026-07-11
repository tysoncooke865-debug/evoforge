# HANDOFF.md — continuing the EvoForge Expo migration

> For a future Claude session. Read this, then `client/CLAUDE.md`, then `PARITY.md`.
> Written 2026-07-11 at the end of the sessions that built the entire Expo app.

## What this is

EvoForge is a fitness RPG: real training data (Supabase) powers a levelling,
evolving character. Two apps share one production database:

- **Streamlit app** (`app.py`, `views/`, `domain/` in Python) — LIVE at
  https://evoforge.streamlit.app, deploys from `main`. Two real users. Do not
  break it. Its rules are the *contract* (see The Contract System below).
- **Expo app** (`client/`) — the replacement, on branch **`expo-rewrite`**,
  auto-deploys every push to **https://expo-rewrite.evoforge.pages.dev**.
  MIGRATION_PLAN.md phases 0–6 are complete; Phase 7 (app stores) remains.

The plan of record is `MIGRATION_PLAN.md`; the view-by-view state and every
deliberate deviation is `PARITY.md`; the live task queue is `TASKS.md`.

## State at handoff (all deployed and green)

- 18 screens, all on real data: (auth) sign-in/up · onboarding **v2** ·
  tabs Home/Today/Log/AI(Oracle)/Avatar/More · Progress/Goals/Awards/Rank/
  Profile/Data via More.
- **120 vitest tests + 4,621 golden parity cases**, CI green, tsc/lint/export
  green. CI (`.github/workflows/client.yml`) gates every deploy.
- **AI Edge Functions deployed to production**: `ai-physique`, `ai-bodyfat`
  (Deno, `supabase/functions/`). `OPENAI_API_KEY` set as a function secret.
  Photos in-memory only; results written with the caller's JWT; hourly rate
  limit + sha256 cache via `ai_scan_cache` (migration 007, applied).
- **Migrations 007 and 008 are APPLIED to production** (via the management
  API). 008 added `profile.sex / deadlift_e1rm / nutrition_phase` (additive,
  nullable — invisible to Streamlit).
- **The v2 game layer** (client-side only, core contract untouched):
  - **Six classes** (`client/src/domain/branches-v2.ts`): the pinned 3-branch
    core, plus TITAN (str≥80 & size≥70 & size dominant), CARDIO MACHINE
    (cond≥70 & dominant), and **THE SHREDDER** — entry by starting condition
    (first bf reading ≥25% + cutting phase), stages driven by **body fat
    falling** (≥25 Hooded Resolve → <25 The Grind → <18 Cut Deep → ≤12
    Shredded). Shredder has real art (4 male stages, baked backgrounds — see
    PARITY art notes). Titan/cardio/all-female render as silhouettes until art.
  - **Placement v2** (`starting-level-v2.ts`): onboarding asks quick questions
    (sex, lifts incl. deadlift, years, nutrition phase) + optional AI scan.
    NO self-scored sliders — skipped scans use documented derived defaults.
- Full premium UI: HeroStage (platform/fog/reflection/particles, XP-reactive
  bloom), HUD layout, floating +XP from confirmed verdicts, workout summary
  sheet, level-up overlay (ready-gated detector), Oracle scan chamber,
  contextual cardio forms, derived day-streaks, safe-area shell.

## The Contract System (the most important thing to preserve)

The Python `domain/` is the source of truth until cutover. Its pure functions
are pinned by golden fixtures:

- `tools/gen_fixtures.py` (Python) writes `contracts/fixtures/*.json`;
  `--check` fails CI if Python drifts. Deterministic: sorted keys, LF, UTF-8.
  **sort_keys destroys dict order** — order-bearing data (ROUTINE) travels in
  explicit `*_order` arrays.
- `client/src/domain/__tests__/parity.test.ts` asserts the TS port reproduces
  every case EXACTLY (floats bit-for-bit; CPython libm and V8 agree).
- `client/src/domain/py.ts` exists because Python `int()`/`float()` ≠ JS
  `Number()` — don't "simplify" it away.
- **Never change domain semantics client-side.** New game rules go in v2
  layers (like `branches-v2.ts`) that CHECK NEW GATES FIRST and fall through
  to the pinned core — with a sweep test proving the sub-gate space still
  matches the core exactly, and self-consistency tests proving displayed
  targets really resolve where they claim.
- Load-bearing invariants (each has tests; several have been falsified on
  purpose to prove the guards work):
  - An EDIT to a set updates in place by `workout_log.id` — never
    delete-and-insert, never a second XP grant (`set-save.ts` verdicts).
  - `useLedgerXp` returns **null on any failure, never 0** (resolveXp treats
    them as different worlds; 0 would drop athletes to base level).
  - A failed grant never fails the save, and is never silent (error toast).
  - Celebrations fire from CONFIRMED state only (`ready` gate in
    `use-avatar-data.ts` — the level-up detector once fired on pre-load
    defaults; the tour caught it).
  - Announced XP = XP that landed. No optimistic celebration, ever.
  - Sign-out clears EVERY cache layer: queryClient + toast store + settings
    store. Add a store → clear it in `auth-context.tsx`.
  - Design tokens: `client/src/theme/tokens.js` is the single copy, verified
    both directions against `assets/styles.css` by
    `client/scripts/verify-tokens.mjs`. Token VALUES are a contract.
  - Two rarity palettes coexist ON PURPOSE (badge=Python, aura=CSS tokens).

**The doctrine: falsify every new guard** (break it, watch red, restore) and
"render it and look at it" — the Playwright tour caught real bugs the test
suite could not (routine order alphabetized, zero-width fills, spurious
level-up, modal blocking nav).

## Hard-won operational gotchas (violating these costs hours)

1. **Metro caches inlined `EXPO_PUBLIC_` env** — after any env change, export
   with `--clear` or you ship stale values ("Failed to fetch" was this).
2. **`className` on `Animated.*` drops styles on web** — animated nodes take
   INLINE STYLES ONLY. (This shipped invisible XP bars and toasts once.)
3. **expo-image tint via the `tintColor` PROP**, not style (style is ignored
   on web — silhouettes leaked art until fixed). Never tint the shredder art
   (baked backgrounds → solid box).
4. **CI logs are unreadable anonymously** (403). The workflow replays failure
   lines as `::error::` annotations — read them via
   `GET /repos/tysoncooke865-debug/evoforge/check-runs/{id}/annotations`.
   Annotations cap at 10/step: spend them on message lines, never stack frames.
5. **GitHub secrets arrive decorated** (quotes, whole `NAME="value"` lines).
   `supabase.ts` extracts URL/key by pattern; the CI "Validate Supabase env
   shape" step warns with derived properties only.
6. **`expo export` does NOT generate `expo-env.d.ts`** (only `expo start`
   does); CI writes the one-line shim before tsc. Locally, a brief
   `CI=1 npx expo start --web --port 809x` regenerates typed routes after
   adding screens.
7. **Windows console is cp1252** — `PYTHONIOENCODING=utf-8` for anything
   printing emoji. Git Bash needs
   `export PATH="$PATH:/c/Users/tyson/AppData/Local/nodejs"` (user-scope Node
   24). Supabase CLI at `%LOCALAPPDATA%\supabase-cli\supabase.exe`.
8. **Management API**: urllib is Cloudflare-blocked (403 error 1010) — use
   curl. SQL executes via
   `POST https://api.supabase.com/v1/projects/rysbpwpvnqbngqncrfaa/database/query`
   with the `sbp_` token.
9. **The commit-msg hook** requires `[architect]` for protected paths —
   including `.github/workflows/` and `migrations/`. The pre-push hook runs
   the Python suite: pushes need generous timeouts (~5 min).
10. **`git status` clean ≠ committed intentions**: one interrupted compound
    command had already committed — check `git log` before re-running.
11. Cloudflare Pages: `client/public/_headers` keeps HTML `no-cache` (deploys
    were invisible behind browser cache before). Push-to-live latency is
    ~4–6 min because checks gate the deploy — check the served bundle for a
    marker string before telling the user it's live.
12. Python-side work: run ALL ELEVEN verify tools before committing
    (root CLAUDE.md lists them); NEVER run `tools/verify_rls.py` full mode
    (writes to production).

## Credentials & accounts (all local, all gitignored)

- `client/.env.local` — Supabase URL + publishable key (from
  `.streamlit/secrets.toml`).
- `client/.env.sbtoken.local` — `sbp_` management token: deploys functions,
  runs SQL, reads api-keys. Keep; revocable in dashboard.
- Smoke account `smoke-test-claude@evoforge.internal` (password inside
  `scratchpad ui_tour.py`) — admin-created, RLS-isolated, safe to delete.
  The tour signs in as it and LOGS REAL SETS (its own rows only).
- GitHub secrets set by Tyson: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
  (`0eb6cc25b24aab3d40ac0818b8885576`), `EXPO_PUBLIC_SUPABASE_URL/KEY`
  (decorated; see gotcha 5).

## The verification workflow (run per change-set)

```bash
cd client
npx tsc --noEmit
npx vitest run src
npx expo lint
rm -rf dist && npx expo export -p web --clear
# then the look-at-it pass:
python <scratchpad>/ui_tour.py   # serves dist, signs in as smoke, logs sets,
                                 # screenshots every screen — READ the PNGs
```
Commit per coherent step (long-form messages carry the reasoning — read
`git log` for the full history of decisions), push, and verify CI + the
live-bundle marker.

## Open items

- **Human checklist** (task #11): Expo Go native session test (parked —
  Apple hasn't approved Expo Go SDK 57; `eas go` needs a paid Apple account);
  Supabase Auth redirect URLs (`evoforge://auth/callback`,
  `http://localhost:8081/**`, `https://evoforge.pages.dev/**`).
- **Art** (PARITY.md list): male titan/cardio ×3 each; female all six classes;
  transparent re-exports of shredder art (unlocks staging effects);
  shredder PNGs could use compression (1–3 MB each).
- **Not yet built**: `ai-coach` / `ai-plan` Edge Functions (the custom plan
  generator — prompts live in `services/ai_physique.py::run_ai_custom_plan_*`);
  Navy-formula bf entry mode (math ported+pinned, screen unwired); desktop
  sidebar ≥1024px; personalisation (needs a user-prefs migration 009);
  workout duration (needs session tracking).
- **Phase 7**: EAS builds + store listings + health-data privacy labels.
  Needs the Apple Developer account decision.
- Streamlit cutover eventually: merge to `main`, point the domain at Pages.

## How to resume

```bash
cd C:\Users\tyson\Downloads\Previous_Code\evoforge
git checkout expo-rewrite && git pull
# read: this file → client/CLAUDE.md → PARITY.md → TASKS.md → git log --oneline -30
```
Then keep the loop: small steps, gates green, falsify new guards, look at the
screens, commit with reasoning, push, confirm live.
