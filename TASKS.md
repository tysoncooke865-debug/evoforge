# EvoForge — Task queue

The live work queue. `ROADMAP.md` says *what order and why*; this says *what next*.

**Owners:** `[claude]` architecture, security, schema, XP · `[junior]` UI, CSS,
tests, docs · `[human]` anything needing a dashboard login or a decision.

**Definition of done, every task:**
```bash
python tools/verify_ui.py && python tools/verify_deep.py && python tools/verify_ordering.py && python tools/verify_xp.py
python tools/shot.py                                        # if the change is visual
```
Plus: the doc describing the change is updated **in the same commit**.

---

## IN PROGRESS
**Login & Onboarding** — code landed. **T1 is the last step and only you can do it.**

---

## UP NEXT — in this order

### T1 · Run the migration and verify RLS `[human]` 🔴 blocks the public launch

> **Measured 2026-07-10** with `verify_rls.py --anon-only`: **RLS is OFF on
> production.** An unauthenticated publishable-key client read all 11 tables —
> 646 rows. Counts: workout_log 198, custom_workout_plan 283, achievements 83,
> physique_ratings 23, bodyfat_log 16, targets 16, profile 10, bodyweight_log 9,
> cardio_log 4, measurements 2, avatar_progression 2.
>
> The staging project HAS the migration applied and passed the full
> `verify_rls.py`. Production has not been touched.
>
> Note: the deployed app's `SUPABASE_URL` (Streamlit Cloud → Settings → Secrets)
> appears to point at a THIRD, empty project — that is why signing in produced an
> onboarding wizard rather than a level-43 character.
>
> Project refs are deliberately not recorded here. This repo is public.

Auth without RLS is a doorman with no walls. The chosen plan is to **adopt the
staging project as the new production**, since it already has `001` applied and
verified, and to pause the old project so its 646 rows survive as a backup.

Remaining, all in the Supabase dashboard:
1. `truncate` staging's 11 tables — they hold `000`'s seed rows.
2. Delete the `rls-verify-*` accounts and the throwaway owner.
3. **Rotate staging's publishable key** — it was exposed in a chat transcript.
4. Repoint **Streamlit Cloud → Settings → Secrets** *and* `.streamlit/secrets.toml`.
5. Reboot the app (Cloud keeps stale modules across a pull).
6. Sign up. `_just_signed_up` is set, so the wizard runs immediately.
7. **Re-enable "Confirm email"** — it was turned off so `verify_rls.py` could sign in.
8. Pause the old project. Delete the third, empty one.

- **Acceptance:** `python tools/verify_rls.py --anon-only` prints `ANON LOCKED OUT`;
  `python tools/shot.py https://evoforge.streamlit.app/ live` is clean.
- Claude was correctly blocked from probing production, so all of this needs you.

### T3b · Apply the `xp_events` ledger `[claude]` + `[human]` 🟠 `[architect]`
`migrations/002_xp_events.sql` is written and **not applied**. XP is still derived
from `workout_log` + `cardio_log`, which is correct and idempotent but has no
timestamps and no anti-cheat: the score is a pure function of rows the user can
insert at will, with any `date` they like.

- **Blocked by:** T1. `002` depends on `001`'s `user_id` + RLS.
- **The migration:** append-only by construction — the owner gets `select` and
  `insert` policies and no `update`/`delete`, so RLS refuses both. A partial unique
  index on `(user_id, source_table, source_id)` makes the backfill re-runnable and
  stops a workout minting XP twice.
- **Then, in code:** `save_set_auto()` inserts an `xp_event`; `domain/xp.py` grows
  `level_from_ledger()`; `workout_summary()` reads the ledger sum. Keep the derived
  path as the reconciliation oracle — it is the only thing that can detect drift.
- **Acceptance:** `002`'s STEP 4 reconciliation query returns `reconciles = true`
  for every user.
- **Do not** start T15 (leaderboards) or T17 (PvP) before this lands.

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

- **J1** Avatar page renders the evolution showcase *above* the page title. Move
  `render_evolution_showcase()` below `page_hero()` in `views/avatar.py`.
- **J2** Stat bars in `render_avatar_image_panel` sit flush to the card edge. Add
  horizontal padding.
- **J4** Add docstrings to every public function in `ui/components.py`.
- **J5** Write a `tools/verify_css.py` that fails if any `!important` is added outside
  the documented allow-list.
- **J6** Mobile: `hero-badge` wraps awkwardly under 360px. Tune the breakpoint.

Junior workflow: branch `junior/<id>-<slug>` → make both verify scripts pass → PR.
See `LOCAL_AI.md`. **The commit-msg hook will block you if you stray into protected
paths — that is intended. Hand those tasks to Claude.**

---

## DONE
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
  written — **the migration has not been run.** See T1.
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
