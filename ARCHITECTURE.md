# EvoForge — Architecture

Read on demand. `CLAUDE.md` is the always-loaded index; this is the detail behind it.

---

## 1. Frontend

### The Streamlit execution model
Streamlit re-runs `app.py` **top to bottom on every interaction**. There is no
component tree and no diffing. Consequences that shape this codebase:

- Anything expensive must be cached or it runs on every click.
- Widget order *is* layout order. `st.sidebar.toggle()` called before
  `render_sidebar_navigation()` renders *above* the brand.
- `st.rerun()` restarts the script. Code after it never executes.
- State survives only in `st.session_state`.

### Render pipeline (`app.py`, ~80 lines)
```
set_page_config
  └ load_app_styles()            single <style> injection from assets/styles.css
     └ resolve_page_from_state() query param -> session_state
        └ render_sidebar_navigation(page)   the ONLY nav
           └ sidebar Performance-mode toggle  (after nav, so it sits below)
              └ render_mobile_navigation(page) brand bar only, hidden >=1024px
                 └ ui_toast_area()             save / PR / achievement toasts
                    └ render_workout_xp_toast()  the +XP burst
                       └ PAGE_RENDERERS[page]()  dispatch into views/
```

Both toast pumps must be called every run. They read `session_state` keys that
pages *write* during their own render — so the toast appears on the **next** run,
after `st.rerun()`. Remove either call and every save confirmation silently vanishes.

### Cache layers (three, with different lifetimes)
| Layer | Mechanism | Scope | Danger |
|---|---|---|---|
| Supabase reads | `@st.cache_data(ttl=20)` on `cached_sb_select` | **process-global, keyed only on table_name** | Under multi-user, serves one user's rows to another. Must be keyed by `user_id`. |
| Decoded avatars | `@st.cache_resource` on `cached_avatar_image` | process-global | Safe — images are not user data. |
| Page snapshot | `session_state["_fast_snapshot"]` via `get_fast_snapshot()` | per session | Safe. |

### Styling
One stylesheet, `assets/styles.css` (~1.4k lines), injected once by `ui/styles.py`.
Native dark theme in `.streamlit/config.toml` means CSS doesn't fight Streamlit's
light default — `!important` count is 16, down from 678.

Design tokens live in a single `:root`. Glow is a *signal*: allowed on primary CTAs,
active nav, XP fills, rarity badges, avatar auras and unlock moments; banned on body
text, tables, inputs and labels. That restraint is most of the difference between
"premium game UI" and "amateur".

### Hard-won Streamlit truths
1. **A `<div>` cannot span two `st.markdown` calls.** Each call is sanitized
   independently and unbalanced tags are auto-closed. The opening `<div>` becomes an
   empty styled box; the next element is its *sibling*, not its child. Every CSS rule
   scoped `.wrapper img { … }` then matches nothing. Build whole cards in one f-string.
2. **Icons are Material Symbols ligatures.** The element's text really is
   `keyboard_double_arrow_left`; the font turns it into a glyph. Setting `font-family`
   on `.stApp span` exposes the raw word — and its width blows out the sidebar.
3. **A top-level `pages/` directory** makes Streamlit build its own multipage sidebar
   nav. Ours is `views/`, plus `client.showSidebarNavigation = false`.
4. **`header[data-testid="stHeader"]` hosts the mobile sidebar toggle.** Hiding it
   strands phone users, because the sidebar is the only nav.
5. **On Streamlit Cloud the app runs inside an `<iframe>`.** The viewer badge and
   profile icons live in the host document. No app CSS can reach them. `?embed=true`
   removes them but substitutes its own footer bar.
6. **HTTP 200 is not a health check.** Streamlit returns 200 while rendering a
   traceback. Use `tools/verify_ui.py`.

---

## 2. Backend

### Layering (the important part)
```
views/     Streamlit widgets + layout.  Imports domain/ and ui/.  No SQL.
   ↓
domain/    Pure business logic. 12 modules. Knows nothing about widgets.
   ↓
data/      Supabase CRUD, caching, CSV fallback. The only layer that talks to the DB.
   ↓
Supabase (Postgres)
```

`services/` sits beside `domain/` and wraps OpenAI. `config/constants.py` holds the
schema contract and static game data (routine, exercise library, achievements).

**`domain/` is ~80% of a portable service layer** — the single most valuable asset in
this repo. It is what a future FastAPI backend reuses verbatim.

Exactly **2 of 13** domain modules still import `streamlit`, and both are shallow:
- `domain/xp_leveling.py` — `mark_xp_gain()` writes `st.session_state` toast flags.
- `domain/custom_plan.py` — writes `st.session_state["last_supabase_error"]`.

Both are UI signalling, not business logic. Return values or raise; let `views/` set
session state. Do that and `domain/` is framework-free. **Keep all new business logic
free of `streamlit`.**

Seven domain modules still call the CSV fallback (`achievements`, `avatar_stats`,
`bodyfat`, `bodyweight`, `cardio`, `measurements`, `physique_ratings`) — those are the
call sites step 2 must unpick.

### Data flow, a set being logged
```
views/today.py            number_input → weight, reps
  → domain/workouts.py    save_set_auto()
      → sb_delete_matching() + sb_insert()   data/sb_ops.py
      → csv_store.save_csv_backup()          LEGACY — delete before auth
      → domain/achievements.check_achievements()
      → domain/xp_leveling.mark_xp_gain()    sets session_state flag
  → st.rerun()
     → app.py ui_toast_area() + render_workout_xp_toast()  read the flags, render, clear
```

### The CSV fallback (`data/csv_store.py`) — scheduled for deletion
Every write mirrors to a local CSV. On Streamlit Cloud that filesystem is **ephemeral
and shared by every visitor of the app instance**. Today, single-user, it is merely
useless. The moment auth ships it becomes a cross-user data leak. It must be removed
*before* step 5 of the roadmap, not after.

### Reads
`df_from_supabase(table, fallback_path, columns)` selects up to **2500 rows** and
falls back to CSV on error. It runs per table, per render. At 1,000 users this is the
first thing that breaks.

---

## 3. Security model

### Current state — be blunt about it
- **No authentication.** No `user_id`, no `st.user`, no session identity.
- **No tenancy.** All 11 tables are one shared global bucket.
- **RLS: unverified.** The app authenticates with the publishable key. If RLS is off
  or permissive, that key is a skeleton key to every row.
- Secrets live in `.streamlit/secrets.toml` (gitignored, never committed — verified
  across all commits). It contains a `SUPABASE_SECRET_KEY` and JWKS URL the app
  **never reads** — dead service-role credentials on disk. Remove and rotate.
- The publishable key never reaches a browser: Streamlit is server-rendered. That is
  the only reason the current setup is not already exploited.

### Target state
1. **Supabase Auth** (email/OAuth). Identity is `auth.uid()`.
2. **`user_id uuid not null references auth.users` on all 11 tables.**
3. **RLS enabled on every table**, policy `user_id = auth.uid()` for select/insert/
   update/delete. No exceptions — this is the only thing standing between users'
   body measurements and physique photographs.
4. **Per-user cache keys.** `cached_sb_select(table, user_id)`.
5. Composite keys where natural keys collide: `achievements(user_id, achievement_id)`.
6. Storage: physique photos are currently sent to OpenAI and **not stored**. If they
   ever are, they need a private bucket with RLS and a retention policy.

### Threat notes
- Physique photos and body measurements are sensitive personal data. Treat a leak as
  a reportable incident, not a bug.
- XP is client-derivable from `workout_log`. Once leaderboards exist, an append-only
  `xp_events` ledger with server-side validation is the anti-cheat boundary.

---

## 4. Scalability

### 10 users
Current stack holds. **RLS is mandatory.** Supabase free tier, Streamlit Cloud single
container. Do nothing clever.

### 1,000 users
- Kill the 2500-row full-table reads. Query by `user_id` + date window.
- Index every log table on `(user_id, date)`.
- Serve XP from the ledger or a materialised view, not recomputed per render.
- Cache keyed per user, short TTL.
- Streamlit Cloud's single container becomes the bottleneck; move to a paid host.
- **Dominant unit cost is OpenAI vision** for physique scans. Rate-limit per user and
  cache by photo hash — the same photo must never be billed twice.

### 100,000+ users
- Streamlit is the wall. FastAPI + Postgres + Redis. The `domain/` service layer is
  what makes this a **port, not a rewrite** — which is why step 8 exists.
- Read replicas. AI calls behind a job queue with a dead-letter path.
- Avatar assets to a CDN (they are already static PNGs).
- Leaderboards and seasons precomputed on a schedule, never queried live.
- Supabase paid/dedicated, or self-hosted Postgres.

### Cost drivers, ranked
1. OpenAI vision calls (per physique/bodyfat scan).
2. Supabase egress from unbounded table reads.
3. Compute — currently free, and currently a single container.

---

## 5. Migration path off Streamlit

Streamlit cannot deliver a mobile app, real-time PvP, or embedded payments. Accepted.
The plan is to make that migration a port rather than a rewrite:

```
today          views/ ──> domain/ ──> data/ ──> Supabase
               (streamlit)  (pure)     (pg)

step 8         views/ ─┐
               API    ─┴─> services/ ──> repositories/ ──> Supabase
                            (pure)        (swappable)

later          Next.js / React Native ──> FastAPI ──> services/ ──> Postgres
               Streamlit retired or kept as an internal admin tool
```

The seam is already 80% built. Two things must happen before it closes:
- `domain/` must stop importing `streamlit` (caching + session_state behind an interface).
- The CSV fallback must die; a repository interface replaces it.

Do not start this until identity and XP are settled — porting a broken XP model just
moves the problem to a new language.
