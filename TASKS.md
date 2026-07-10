# EvoForge — Task queue

The live work queue. `ROADMAP.md` says *what order and why*; this says *what next*.

**Owners:** `[claude]` architecture, security, schema, XP · `[junior]` UI, CSS,
tests, docs · `[human]` anything needing a dashboard login or a decision.

**Definition of done, every task:**
```bash
python tools/verify_ui.py && python tools/verify_deep.py   # must pass
python tools/shot.py                                        # if the change is visual
```
Plus: the doc describing the change is updated **in the same commit**.

---

## IN PROGRESS
**Login & Onboarding** — plan approved. P1 landed; blocked on T1.

---

## UP NEXT — in this order

### T1 · Verify RLS on all 11 tables `[human]` 🔴 blocks everything
Open Supabase → Authentication → Policies. For each of the 11 tables record:
is RLS enabled, and what policies exist.

- **Why:** the app connects with the publishable key. If RLS is off, that key reads
  and writes every row in the database.
- **Acceptance:** a table in this file listing `table → RLS on/off → policies`.
- **If RLS is off:** stop. Do not add features. That is the top priority.
- Claude was correctly blocked from probing production during the audit, so this
  genuinely cannot be automated from here.

### T3 · Unify XP and add an `xp_events` ledger `[claude]` 🔴 `[architect]`
Three formulas exist today:
| Where | Formula |
|---|---|
| `workout_summary()` | `xp = sets*10 + cardio_min*2`; level = `base + xp//500` (flat 500/level) |
| `xp_to_next_level()` | `500 + (level-1)*25` — **1550 at level 43** |
| `current_level_xp()` fallback | `sets*35 + reps*2` |

The progress bar divides by a different number than the one that grants the level, so
**it can mathematically never fill.**

- **Design:** pick one curve. Add append-only `xp_events(id, user_id, kind, amount,
  source_id, created_at)`. Derive level from the ledger sum. Keep the recompute path
  as a one-off backfill.
- **Why now:** ranking on an inconsistent metric is unfixable later — leaderboards and
  seasons built on it would all be invalidated by the fix.
- **Acceptance:** one formula in one place; bar reaches 100% exactly at level-up; a
  unit test asserts `sum(xp_events) == derived_level_xp`.
- **Do not** start T15 (leaderboards) before this lands.

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
