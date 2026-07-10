# EvoForge — Task queue

The live work queue. `ROADMAP.md` says *what order and why*; this says *what next*.

**Owners:** `[claude]` architecture, security, schema, XP · `[junior]` UI, CSS,
tests, docs · `[human]` anything needing a dashboard login or a decision.

**Definition of done, every task:**
```bash
python tools/verify_ui.py && python tools/verify_deep.py && python tools/verify_ordering.py \
  && python tools/verify_xp.py && python tools/verify_goals.py && python tools/verify_css.py
python tools/shot.py                                        # if the change is visual
```
Plus: the doc describing the change is updated **in the same commit**.
CI runs all six on every push and PR. **A new guard is not accepted until it has
been falsified** — delete the fix, watch it go red, restore.

---

## IN PROGRESS
**The cutover is done.** Two real users have signed up, onboarded and are using the
app against the new production project. What is left of T1 is dashboard hygiene —
**T1c** — and one of its items is a live signup hole.

---

## UP NEXT — in this order

### T1c · Close out the cutover `[human]` 🔴 item 1 is a live hole

The app is on the new project, RLS is enforced, `shot.py … live` is clean and
`--anon-only` prints `ANON LOCKED OUT` against **populated** tables. Remaining, all
in the Supabase dashboard:

1. **Re-enable "Confirm email"** (Authentication → Providers → Email). It was turned
   off so `verify_rls.py` could sign in. **While it is off anyone can register an
   address they do not own** — this is open right now, on a live public app.
2. Delete the `rls-verify-*` accounts and the throwaway owner.
3. Confirm `000`'s seed rows are gone. If the tables were never truncated, those rows
   still exist owned by the throwaway account — invisible to real users under RLS,
   but they will resurface the moment anything aggregates across users
   (leaderboards, T15). Truncating now is safe: real users' rows are separate.
4. Keep the old project **paused, not deleted** — it is the only copy of the 646
   rows. Delete the third, empty project.

- **Do not run the full `verify_rls.py` against this project.** It writes to all 11
  tables and creates accounts. It is a staging tool, and this is production now.
- Project refs are deliberately not recorded here. This repo is public.

### T1d · Verify per-user isolation *in the app*, not just in the database `[claude]` 🟠
RLS is proven at the SQL layer. The app has a second, independent way to leak one
user's data to another: Streamlit's caches are **process-global**, and Cloud serves
many browser sessions from one process. `cached_sb_select` is keyed on `user_id` and
`_sb_client` is per-session and never `@st.cache_resource`d — both correct, both
untested by anything in `tools/`.

- Now testable for the first time: there are two real accounts on one Cloud process.
- **Cheapest check, do it today:** you and your mate load Home at the same time.
  Each must see *your own* level, avatar and XP. If either sees the other's, the
  bug is in the cache key, not in RLS.
- **Acceptance:** a harness that runs two AppTest sessions with different `user_id`s
  and asserts no row crosses over.

### T3b · Apply the `xp_events` ledger `[human]` 🟠 `[architect]`
**The code is written, verified and committed.** All that remains is running the
migration — DDL against a live production database with two real users, which is
yours, not Claude's.

Run `migrations/002_xp_events.sql` in the Supabase SQL editor, then check its
**STEP 4** query returns `reconciles = true` for every user. Then push.

- **Deploy order does not matter.** `ledger_xp()` returns `None` (never `0`) when
  `xp_events` is absent, and `resolve_xp()` falls back to the derived recount. The
  app is correct before and after. A missing ledger read as `0` would have dropped
  every user to their base level.
- **One real hazard.** If you apply `002` and *don't* push, sets logged in the gap
  create `workout_log` rows with no grant, so the ledger falls behind the derived
  total. The backfill is re-runnable (`on conflict do nothing`): re-run STEP 3 and
  the drift closes. `workout_summary()` reports `xp_drift` so you can see it.
- **What changed in code:**
  - `domain/xp_ledger.py` (new, protected) — `ledger_xp()`, `record_set_event()`,
    `record_cardio_event()`. Never raises, never blocks a save.
  - `domain/xp.py` — `level_from_ledger()`, `resolve_xp()`. Still pure.
  - `save_set_auto()` now **updates a set in place** instead of delete-and-insert.
    A set is a flat 10 XP whatever the load, so an edit must not re-grant — but the
    grant is keyed to `workout_log.id`, and RLS cannot revoke the old one. A fresh
    uuid would double the XP or strand the grant. **Do not undo this.**
  - **Cardio mints too.** `002` STEP 3 backfills `cardio_log` as well; wiring only
    sets would have drifted on the first cardio session. The task note omitted this.
- **Acceptance:** STEP 4 returns `reconciles = true` for every user, and
  `workout_summary()["xp_drift"] == 0`.
- **Do not** start T15 (leaderboards) or T17 (PvP) before this lands. A leaderboard
  must refuse to rank any account whose `xp_drift` is non-zero.

### T4 · Remove and rotate the unused service-role key `[human]` 🟠
`.streamlit/secrets.toml` contains `SUPABASE_SECRET_KEY` and `SUPABASE_JWKS_URL`.
Neither is read by any code (`data/supabase_client.py` reads only `SUPABASE_URL` +
`SUPABASE_KEY`).

- **Acceptance:** both removed from the file; the secret key rotated in the Supabase
  dashboard; app still boots. Also remove them from Streamlit Cloud's secrets.
- Never committed to git (verified across all history), so this is hygiene, not incident.

### T6 · Make `domain/` framework-free `[claude]` 🟡
Only 2 of 13 modules import `streamlit`, both shallow:
- `domain/xp_leveling.py :: mark_xp_gain()` writes `st.session_state` toast flags.
- `domain/custom_plan.py` writes `st.session_state["last_supabase_error"]`.

Return values or raise; let `views/` write session state.

- **Why:** these are the last two blockers to a portable service layer (T14 → mobile).
- **Acceptance:** `grep -l streamlit domain/*.py` returns nothing; all pages pass.

---

## BACKLOG — safe for the junior `[junior]`
Small, isolated, verifiable. Nothing here touches protected paths.

- **J4** Add docstrings to every public function in `ui/components.py`. *Partly done:
  `page_hero`, `compact_metric` and `render_target_bar` have them; the rest do not.*

**Closed 2026-07-10 (UI consistency pass):**
- ~~**J1** showcase above the page title~~ ✅ fixed, and `verify_ui` now asserts the
  hero precedes every content card, so it cannot return.
- ~~**J2** stat bars flush to the card edge~~ ✅ `.avatar-stat` gained `padding-inline`.
- ~~**J5** `tools/verify_css.py`~~ ✅ written. **The trap it encodes:** a raw grep of
  `!important` returns 16, but line 6 is inside the header comment — the real count
  is 15. Comments are stripped before counting, or the guard is off by one from birth.
- ~~**J6** `hero-badge` wraps under 360px~~ ✅ **does not reproduce.** Measured at
  390/360/340/320px: `badgeOverflowsHero=false`, `pageScrollsSideways=false`. The
  `@media (max-width: 420px)` rule already flips `.hero-panel` to column, so the
  nowrap badge takes its own line long before 360px. The item predates that
  breakpoint. Closed with evidence rather than "fixed".

Junior workflow: branch `junior/<id>-<slug>` → make both verify scripts pass → PR.
See `LOCAL_AI.md`. **The commit-msg hook will block you if you stray into protected
paths — that is intended. Hand those tasks to Claude.**

---

## DONE
- **T1 · `migrations/001` applied; RLS enforced.** The old production project (646
  rows, RLS off) was **abandoned, not migrated**: the staging project already had
  `001` applied and had passed the full `verify_rls.py`, so it was adopted as the new
  production. The old one is **paused, not deleted** — it is the only copy of those
  646 rows. `verify_rls.py --anon-only` now prints `ANON LOCKED OUT`.
  - **Three tooling bugs stood between us and that result, and every one of them
    blamed the human.** Worth reading before you trust a red check:
    1. `preflight()` probed PostgREST's root, `/rest/v1/`. On new-format Supabase
       projects that route accepts **secret keys only** and answers a publishable
       key with `401 Secret API key required`. `preflight()` mapped 401 →
       "wrong or rotated key" and exited 2 — so the acceptance test for `001`
       **could never have passed**, on any project, with any correct key. It now
       probes `/auth/v1/health`. Note the shape of the bug: `95fc37d` fixed a false
       *pass* and introduced a permanent false *inconclusive*. That is the safe
       direction to fail, and it still cost hours.
    2. A throwaway runner parsed `secrets.toml` by splitting on `=` and stripping
       quotes. An inline comment would have silently corrupted the key into a 401
       indistinguishable from a wrong one. Use `tomllib` — it is what Streamlit uses.
    3. `verify_ui` / `verify_deep` seeded `_auth_user` but no JWT. Pre-`001` the
       shared-bucket database handed any client *somebody's* `profile` row, so the
       onboarding gate stayed shut by accident and the harness passed. The moment
       RLS landed, all 15 pages rendered the wizard. Both tools now call
       `stub_onboarded()`. **The harness was never checking what it appeared to.**
  - **Near miss, and the first diagnosis of it was wrong.** A publishable key, a
    `sb_secret_` service-role key, an OpenAI `sk-` key and the project ref were
    pasted into `.streamlit/secrets.toml.example` — **tracked**, in a **public**
    repo. It looked like an unstaged edit, so it was "fixed" with
    `git checkout -- <file>`. But commit `95fc37d` had *already committed* them:
    restoring from HEAD restored the leak. Only a scan of the whole push range
    (`git diff origin/main..HEAD`) caught it, seconds before `git push`.
    - Verified the public remote never held them: the only commit on `origin/main`
      touching that file is the initial one, with placeholders. **They never left
      the machine, so no rotation was forced.**
    - The five unpushed commits were rewritten (`filter-branch --index-filter`) to
      carry the clean blob, so the secret never enters history.
    - **Lesson:** `git status` shows the working tree. It says nothing about what is
      already in your commits. Scan `git diff origin/main..HEAD` before any push to
      a public repo — a restore from HEAD is not a fix if HEAD is what is poisoned.
  - The first `--anon-only` green was measured against an **empty** database, where it
    proved nothing: zero rows is consistent with RLS off. **Re-run 2026-07-10 against
    populated tables** — two users onboarded, so `profile` demonstrably held rows —
    and an anonymous client still read zero. *That* is the denial.
  - `tools/shot.py … live` clean on desktop and mobile. Note it only exercised the
    signed-out auth gate, which touches no database: it could not have distinguished
    the new project from the old paused one. The cutover was confirmed by two humans
    signing up, not by that check.
  - Remaining dashboard hygiene moved to **T1c**; in-app cache isolation to **T1d**.
- **T3 · Unified XP.** One curve in `domain/xp.py`, pure and portable. Advancing from
  level `L` costs `500 + (L-1)*25`; the progress bar divides by the same number that
  grants the level, so it reaches exactly 100% at level-up — previously impossible.
  Deleted `sets*35 + reps*2` and the flat-500 level grant. `mark_xp_gain` announced
  `+75` for a set worth 10; it now reports what the athlete actually earned.
  Consolidated four hand-rolled bar calculations (`views/home.py`, `ui/nav.py`,
  `ui/components.py`, `domain/xp_leveling.py`) onto `progress_percent()`.
  `tools/verify_xp.py` pins the curve, the cap, monotonicity, and that
  `migrations/002`'s backfill literals still match the code's constants.
- **Login & onboarding.** Supabase Auth (email + password) in `auth/session.py`.
  Session-scoped Supabase client — the JWT lives on the client instance, so it must
  never be `@st.cache_resource`d. `cached_sb_select` is now keyed on `user_id`.
  Login gate + 3-step onboarding wizard in `app.py`; a saved `profile` row is the
  onboarded flag. `migrations/001_add_user_id_and_rls.sql` and `tools/verify_rls.py`
  written; the migration was applied on 2026-07-10 — see **T1** above.
- **Fixed a latent CSS bug the login screen exposed:** form submit buttons are not
  `.stButton` children and their `kind` is `primaryFormSubmit`. Streamlit also wraps
  every button label in a `<p>`, which `.stApp p` was painting `--text-dim`. Every
  primary CTA in the app had a washed-out label.
- **T2 · Deleted the CSV layer.** `data/csv_store.py` gone. Removed `save_csv_backup`
  from 7 domain modules and — missed by the original audit — five direct `to_csv()`
  disk writes in `profile`, `targets`, `custom_plan` (×2) and `workouts`.
  `df_from_supabase(table, columns)` no longer takes a fallback path and surfaces read
  errors instead of serving stale local rows. `views/data_manager.py` builds its backup
  ZIP in memory from Supabase; restore-from-CSV and CSV→Supabase migration are gone.
  `_cache_key_for_path` moved into `ui/avatar_images.py` as `_asset_cache_key` (it only
  ever keyed static PNGs, never user data).
- **T5 · `Delete Data` deletes from Supabase.** Identifies a row by primary key when the
  table exposes one, else by its scalar identity columns. `jsonb` columns are never used
  as an `.eq()` filter.
- Modular refactor: 10,380-line monolith → 47 files across 6 layers.
- Fixed 6 latent bugs: Supabase sync silently dropped on 4 subsystems; custom plans
  never synced; XP toast unreachable after a `return`; two pages crashing on load
  behind a green HTTP 200.
- Full UI rebuild: 3,766-line stylesheet → 1,300; `!important` 678 → 16; one `:root`;
  zero duplicate keyframes.
- Fixed the duplicate sidebar (Streamlit auto-nav from a `pages/` dir), Material
  Symbols ligatures rendering as words, and the sidebar's sideways scroll.
- Project memory: this file + `CLAUDE.md`, `ARCHITECTURE.md`, `ROADMAP.md`,
  `LOCAL_AI.md`, `tools/`.
