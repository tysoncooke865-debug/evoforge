# EvoForge — Task queue

The live work queue. `ROADMAP.md` says *what order and why*; this says *what next*.

**Owners:** `[claude]` architecture, security, schema, XP · `[junior]` UI, CSS,
tests, docs · `[human]` anything needing a dashboard login or a decision.

**Definition of done, every task — all ten checks:**
```bash
python tools/verify_ui.py && python tools/verify_deep.py && python tools/verify_ordering.py \
  && python tools/verify_xp.py && python tools/verify_goals.py && python tools/verify_css.py \
  && python tools/verify_isolation.py && python tools/verify_perf.py \
  && python tools/verify_escape.py && python tools/verify_session.py \
  && python tools/verify_leaderboard.py
python tools/shot.py                                        # if the change is visual
```
Plus: the doc describing the change is updated **in the same commit**.
CI runs all eleven on every push and PR. **A new guard is not accepted until it has
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
   **Now worse:** sessions persist for 30 days, so an account opened against someone
   else's address stays signed in for a month. Accepted as a risk while the app is
   unadvertised; revisit before any launch.
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

### T4 · Remove and rotate the unused service-role key `[human]` 🟠
`.streamlit/secrets.toml` contains `SUPABASE_SECRET_KEY` and `SUPABASE_JWKS_URL`.
Neither is read by any code (`data/supabase_client.py` reads only `SUPABASE_URL` +
`SUPABASE_KEY`).

- **Nuance added by `verify_rls`:** the secret key *is* now used, as the positive
  control for `--anon-only` — but as an **env var for that run only**. It still must
  not live in `secrets.toml`, and the app must never see it.
- **Acceptance:** both removed from the file; the secret key rotated in the Supabase
  dashboard; app still boots. Also remove them from Streamlit Cloud's secrets.
- Never committed to git (verified across all history), so this is hygiene, not incident.

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

### T15a · Leaderboard foundation `[claude]` + `[human]` 🟠 `[architect]`
Toward T15, done honestly. See `plan-...rustling-dusk.md` for the full chain. Stages:
1. ✅ **Server-side XP sum.** `migrations/003_xp_total_rpc.sql` written (human-run).
   `ledger_xp()` calls `xp_total()` — the 2500-row cap (problem #13) is gone. Code is
   correct before `003` is applied: a missing function reads as `None` → derived.
   **Human:** apply `003` on staging, run its STEP 3 checks, then production.
2. `display_name` + opt-in `public_profile` (T12).
3. ✅ `leaderboard_top(n)` read surface (4 columns only) + the anti-cheat trigger.
   **`006` applied and validated in production 2026-07-11**: a logged set produced an
   `xp_events` row with `amount=10` set by the trigger, proving `auth.uid()` resolves
   inside it. A raw `{"kind":"adjustment",...}` POST is now rejected — the
   mint-from-nothing hole is closed, so the RPC fallback was not needed.
   **Still true, and honest:** `workout_log` is user-writable by design, so a user can
   fabricate plausible sets and legitimately earn matching XP. Validating workout
   *writes* (rate limits / plausibility bounds) is a separate later task; until then the
   board is trust-on-first-use against a known user base for *that* vector only.
4. ✅ **Trim the reads.** `cached_sb_select`/`df_from_supabase` take an optional
   PostgREST projection; `load_log()` reads only its columns (keeps `id`, drops the
   four heavy ones). Row cap still there — server-side `activity_totals()` RPC is the
   follow-up if a real user nears 2500 rows. `verify_perf` pins the projection.

### T7 · Serve the avatars from `static/` instead of base64 `[claude]` 🟡 `[architect]`
The ten PNGs are 4.8 MB. Inlined as `data:image/png;base64,...` they become ~6.4 MB
of **text re-serialized into the DOM on every rerun** — and the Avatar page renders
three at once. Serving them as `<img src="app/static/…">` means the browser fetches
each once.

**This was written, it worked, and it was rolled back** — not because it was wrong,
but because it shipped without a way to verify it on Cloud. Locally:
`/app/static/aesthetic_stage_1.png → HTTP 200, image/png, 308409 bytes`, and 5/5
`<img>` elements loaded with `naturalWidth > 0`.

- **The unknown:** on Cloud the app runs inside an iframe at `<host>/~/+/`, and
  `app/static/…` is a **relative** URL. It may resolve to `/~/app/static/…`.
- **Do not re-land it without a way to test that.** `shot.py` only ever reaches the
  signed-out gate, and the avatars are behind the login. Options: a temporary
  unauthenticated page that renders one `<img>`, or a `naturalWidth` probe run by a
  human after deploy.
- Streamlit resolves `static/` relative to the **entrypoint script**, not the CWD.
- Only `.png/.jpg/.gif` (plus fonts, pdf, xml, json) get an image content-type. A
  `.webp` arrives as `text/plain` and will not render.
- `tools/verify_deep.py` asserts `src="data:image` **inside** the `ef-avatar-img`
  tag; widen it to accept `app/static/` in the same commit.

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
- **Session persistence + XSS hardening.** Closing the tab no longer signs you out.
  `auth/persistence.py` keeps the Supabase **refresh token** (never the access token)
  in a cookie and exchanges it before the gate. Supabase rotates that token on every
  use, so `persist_session()` rewrites the cookie on `sign_in`, `sign_up` **and**
  `restore_session` — miss the third and sign-outs are *intermittent*: the first
  reopen works, the second fails. Verified on the live app: two reopens, both signed
  in. Every failure path falls through to the login screen; persistence cannot break.
  - **The cookie is JS-readable** — Streamlit components cannot set `HttpOnly`. So the
    escape pass landed first: `ui/escape.py` + `tools/verify_escape.py`, which render
    Missions with a hostile AI exercise name and **parse** the output. AI-generated
    `exercise`/`reps` and the athlete's email (inside a `title="…"` attribute) were the
    live vectors.
  - **This raises the stakes on T1c item 1.** With a persistent session, an account
    registered against an email the attacker does not own stays signed in for 30 days.
- **Perf.** A render cost 44 DataFrame builds on Home and ran `calculate_avatar_stats`
  twice; it is now 8 and once. `check_achievements` did **20 table reads and 19
  inserts** per set save (measured by sabotaging the fix), and `today.py` ran the whole
  sweep a second time before rerunning the script. `tools/verify_perf.py` budgets it.
- **Dependencies are pinned, and Cloud must run Python 3.13.** Unpinned deps segfaulted
  the live app at import — a native ABI mismatch between pandas/numpy/pyarrow, on
  Python 3.14. See `requirements.txt` and `CLAUDE.md` → Deploying.
- **Process hardening.** CI (`.github/workflows/verify.yml`) runs all seven checks on
  every push and PR, over Python 3.11 and 3.13. Nothing ran automatically before; the
  definition of done was prose. The `commit-msg` hook now protects `.github/` and every
  verify script — a weakened check could previously be written and self-merged in the
  same afternoon. `pre-push` runs the suite locally and says in its own header that it
  is convenience, not enforcement: an uninstalled hook cannot verify its installation.
  - **The doctrine, earned the hard way.** Four checks passed while testing nothing.
    Every negative check needs a paired positive; execute the code rather than grep its
    source; **a guard is not accepted until it has been falsified.** Two of the positive
    controls written that same day were themselves vacuous — one measured the sidebar,
    one the mobile brand bar. Only falsification caught them.
  - `verify_deep` §3 asserts each page drew its own `.hero-panel`; §4 floors the emitted
    class set; §6 **executes** `clear_data_cache()` against substituted globals.
  - `verify_rls --anon-only` demands a positive control (`SUPABASE_SECRET_KEY`, env var
    only) and exits 2 INCONCLUSIVE without one. `_is_authorization_error()` — which read
    any exception mentioning `jwt`/`401`/`403` as a *denial*, i.e. a pass — is gone.
- **T1d · Per-user isolation proven in the process, not just in Postgres.**
  `tools/verify_isolation.py`. Streamlit Cloud multiplexes sessions into one process and
  `st.cache_data`/`st.cache_resource` are process-global; by the time a row is cached,
  RLS was satisfied with somebody else's JWT. Asserts `cached_sb_select` is keyed on
  `user_id`, `get_supabase_client()` is not cached and a new session gets a new client,
  and two AppTest sessions share no rows. Falsified 3/3: renaming `user_id` → `_user_id`
  (Streamlit skips underscore-prefixed args) serves Bob Alice's rows, `user_id` and all.
- **T1c item 1 — ACCEPTED RISK, not fixed.** "Confirm email" is OFF on the live app, so
  anyone can register an address they do not own and write data under that identity.
  Accepted 2026-07-10 on the grounds that the app is unadvertised. Revisit before any
  public launch. Items 2-4 of T1c remain open.
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
