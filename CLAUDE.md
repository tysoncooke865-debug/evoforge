# EvoForge — project memory

> This file is auto-loaded into every session. It is the token budget.
> Keep it under 200 lines. Detail belongs in the linked docs, read on demand.

**Start command:** `Read CLAUDE.md and continue development.`

## What it is
A fitness tracker with an RPG layer: your character's stats, level, rarity and
evolution branch are derived from real lift data plus AI photo analysis of physique.
Live: https://evoforge.streamlit.app · Repo: `tysoncooke865-debug/evoforge` (public)

**Ambition: a real public product.** Strangers will sign up. Auth, RLS and per-user
isolation are non-negotiable, not polish.

## Stack
Streamlit (UI) · Supabase/Postgres (data) · OpenAI Responses API (vision) · Pillow (avatars)
Deployed on Streamlit Community Cloud from `main`.

## Layout
```
app.py            entrypoint: page_config, styles, auth gate, nav, router dispatch
auth/             session.py -> sign_up/sign_in/sign_out/current_user. Identity.
migrations/       numbered .sql, run by hand in the Supabase SQL editor
config/           constants.py -> SUPABASE_TABLE_SCHEMAS is the schema contract
data/             supabase_client · sb_ops (CRUD+cache). Supabase is the ONLY store.
domain/           pure business logic. 12 modules. ~80% of a portable service layer.
services/         openai_client + ai_avatar / ai_bodyfat / ai_physique
ui/               nav · components · avatar_cards · avatar_images · styles
views/            15 page modules, each exposing render()
assets/styles.css single design system, ~1.4k lines
tools/            verification harness — RUN BEFORE EVERY COMMIT
avatar_assets/    10 PNGs: aesthetic 1-4, mass 1-3, hybrid 1-3
```

> `views/` is **not** named `pages/` on purpose. A top-level `pages/` dir makes
> Streamlit build its own multipage sidebar nav on top of ours. Do not rename it.

## Database — 11 tables
`workout_log` `bodyweight_log` `cardio_log` `bodyfat_log` `measurements`
`physique_ratings` `custom_workout_plan` `achievements` `targets` `profile`
`avatar_progression`

Column lists live in one place: `config/constants.py :: SUPABASE_TABLE_SCHEMAS`. That
dict is the **write** contract — `clean_supabase_row()` filters inserts down to it.
Never add `user_id` to it: Postgres fills that from `DEFAULT auth.uid()`, and listing
it would send an explicit `NULL` against a `NOT NULL` column.

**None of them has a `user_id`.** The database is currently one shared global bucket.
Access uses the publishable key; **RLS status is unverified** (see #3).

## Auth
Supabase Auth, email + password. `auth/session.py` is the only entry point.

- `app.py` gates: signed out → `views/auth.py` + `st.stop()`. No sidebar renders.
- Then: no `profile` row → `views/onboarding.py` (3-step wizard) + `st.stop()`.
  **A saved profile row IS the onboarded flag.** No extra table or column.
- The JWT lives **on the Supabase client instance**. `get_supabase_client()`
  returns one client per browser session from `st.session_state["_sb_client"]`.
  **Never `@st.cache_resource` an authenticated client** — that cache is
  process-global and would hand one user's JWT to the next visitor.
- `cached_sb_select(_sb, table, user_id)` — `_sb` is excluded from the hash by
  its underscore; `user_id` must stay in the key or `@st.cache_data` (also
  process-global) serves one user's rows to another.
- **A page refresh signs the user out.** `st.context.cookies` is read-only, so
  Streamlit cannot persist a session. Fixing it needs a cookie component. Do
  **not** put the refresh token in a query param — it leaks into history and
  `Referer`.

`migrations/001_add_user_id_and_rls.sql` adds `user_id` + RLS to all 11 tables.
**It has not been run yet.** Until it has, tenancy is not enforced.

## The XP / evolution contract
- **XP is derived, not stored.** A pure function of `workout_log` + `cardio_log`,
  recomputed each render. Idempotent, but no ledger → no timestamps, no anti-cheat.
- `workout_summary()` (`domain/workouts.py`): `xp = sets*10 + cardio_min*2`,
  `level = base_level + xp//500`, capped at 100. `base_level` comes from `profile`.
- Rarity by level: COMMON <25 · RARE <50 · EPIC <75 · LEGENDARY <100 · MYTHIC 100
- Branch (`determine_avatar_branch`): mass / hybrid / aesthetic, from stat mix.
- Stage → which PNG renders. 4 aesthetic stages, 3 each for mass/hybrid.

⚠️ **Three competing XP formulas exist.** See #6. Do not build ranking on this yet.

## Known problems
Ordered by what blocks what. Full detail: ARCHITECTURE.md.

| # | Problem | Status |
|---|---|---|
| 1 | ~~No authentication at all~~ | ✅ Supabase Auth; see **Auth** above |
| 2 | No `user_id` on any of the 11 tables | migration written, **not yet run** |
| 3 | **RLS unverified** — if off, the publishable key grants full table access | **run the migration, then `tools/verify_rls.py`** |
| 4 | ~~`data/csv_store.py` mirrored writes to local disk~~ | ✅ deleted. Supabase is the only store; never reintroduce a disk fallback |
| 5 | ~~`cached_sb_select` keyed only on `table_name`~~ | ✅ keyed on `user_id` too |
| 6 | Three XP formulas: `workout_summary` grants a level per flat 500 XP; `xp_to_next_level` = `500+(level-1)*25`; `current_level_xp` falls back to `sets*35+reps*2`. **The progress bar can never fill at level-up**, and you cannot rank on this | fix before leaderboards |
| 7 | No XP event ledger — no "when earned", no streak integrity, no anti-cheat | needed for PvP/seasons |
| 8 | `df_from_supabase` pulls up to 2500 rows/table/render | cost scales users×history |
| 9 | `achievements` has **no** unique key on `achievement_id` (only `pkey (id)`), so the same achievement can be stored twice per user. `load_achievements()` hides it with `drop_duplicates()` | `migrations/001` STEP 4 dedupes, then adds `unique (user_id, achievement_id)` |
| 10 | ~~`Delete Data` edits CSV only, never Supabase~~ | ✅ deletes from Supabase |
| 11 | `.streamlit/secrets.toml` holds a `SUPABASE_SECRET_KEY` + JWKS URL the app never reads | remove and rotate |
| 12 | Streamlit cannot do mobile apps, real-time PvP, or embedded payments | plan the seam, don't rewrite |

## Coding rules
- **Never split a `<div>` across two `st.markdown` calls.** Streamlit sanitizes each
  call independently and auto-closes tags, producing an empty styled box plus an
  orphaned sibling. Build the whole card in one f-string. Use
  `ui/avatar_images.py :: avatar_img_tag()` / `avatar_stage_html()` to embed images
  as real children.
- **Never set `font-family` on `.stApp span`** — it clobbers Material Symbols and
  icons render as the literal word `keyboard_double_arrow_left`.
- **Never hide `header[data-testid="stHeader"]`** — on mobile it hosts the sidebar
  toggle, and the sidebar is the only navigation.
- **Never globally squash `animation-duration`** — one-shot toasts end at
  `opacity: 0`; fast-forwarding them makes them invisible. Disable ambient loops
  by name instead.
- **`overflow-x: hidden` still allows programmatic sideways scroll.** Use `clip`.
- **Form submit buttons are not `.stButton` children** and their `kind` is
  `primaryFormSubmit`, not `primary`. Style `.stFormSubmitButton > button` too,
  and let the label `<p>` inherit its colour or it renders `--text-dim` on the
  cyan fill.
- Business logic goes in `domain/` and stays free of `streamlit` imports where
  possible — that is the seam a future FastAPI backend reuses.
- Streamlit Cloud renders the app inside an `<iframe>`. Its viewer badge and profile
  icons live in the **host page** — no app CSS can reach them. Don't try.

## Protected paths — require `[architect]` in the commit message
`data/` · `auth/` · `config/constants.py` · `migrations/` · `services/payments*` ·
`domain/xp_leveling.py` · `domain/avatar_stats.py` · `.streamlit/` · `tools/hooks/`

Enforced by `tools/hooks/commit-msg`. Install once: `git config core.hooksPath tools/hooks`
The junior AI must never touch these. See LOCAL_AI.md.

## Session protocol
1. This file is already loaded. **Do not scan the tree.**
2. Read `TASKS.md` for the queue. Open other docs only if the task needs them.
3. Make targeted edits. Never re-read unchanged files.
4. Before committing: `python tools/verify_ui.py && python tools/verify_deep.py`.
   For anything visual, also `python tools/shot.py` — it sees what AppTest cannot.
5. Update the affected doc **in the same commit**.

> Verification note: Streamlit returns HTTP 200 even when a page renders a
> traceback. Never verify with `curl` alone. Two pages crashed on load for months
> behind a green 200.

## Docs
- `migrations/001_add_user_id_and_rls.sql` — tenancy + RLS. Read before touching schema.
- `ARCHITECTURE.md` — structure, data flow, security model, scale plan (10 → 100k users)
- `ROADMAP.md` — NOW / NEXT / LATER with dependency reasoning
- `TASKS.md` — the live work queue
- `LOCAL_AI.md` — junior-AI capability boundary and PR workflow
- `tools/README.md` — what each check catches, and the trap it encodes
