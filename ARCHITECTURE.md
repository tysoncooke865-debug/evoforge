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

### Cache layers (four, with different lifetimes)
| Layer | Mechanism | Scope | Danger |
|---|---|---|---|
| Supabase reads | `@st.cache_data(ttl=20)` on `cached_sb_select(_sb, table, user_id)` | process-global, keyed on `(table, user_id)` | Drop `user_id` from the key and one user's rows are served to another. `_sb` is underscore-prefixed so Streamlit excludes it from the hash. |
| Supabase client | `st.session_state["_sb_client"]` | **per session** | Holds the user's JWT. `@st.cache_resource` here would hand it to the next visitor. |
| Decoded avatars | `@st.cache_resource` on `cached_avatar_image` | process-global | Safe — images are shipped assets, not user data. |
| Page snapshot | `session_state["_fast_snapshot"]` via `get_fast_snapshot()` | per session | Safe. Cleared on sign-out. |

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
7. **`st.context.cookies` is read-only.** `StreamlitCookies` has `__getitem__`
   and no `__setitem__`, so Streamlit cannot persist a session. A refresh signs
   the user out. The refresh token must not go in a query param.
8. **Form submit buttons are not `.stButton` children**; their `kind` is
   `primaryFormSubmit`. And Streamlit wraps every button label in a `<p>`, which
   `.stApp p { color: var(--text-dim) }` was painting — unreadable on the cyan
   primary fill. Labels inherit their button's colour.

---

## 2. Backend

### Layering (the important part)
```
views/     Streamlit widgets + layout.  Imports domain/ and ui/.  No SQL.
   ↓
domain/    Pure business logic. 12 modules. Knows nothing about widgets.
   ↓
data/      Supabase CRUD + caching. The only layer that talks to the DB.
   ↓
Supabase (Postgres)
```

`services/` sits beside `domain/` and wraps OpenAI. `config/constants.py` holds the
schema contract and static game data (routine, exercise library, achievements).

**`domain/` is ~80% of a portable service layer** — the single most valuable asset in
this repo. It is what a future FastAPI backend reuses verbatim.

**`domain/xp.py` is the XP contract.** One curve, pure — no `streamlit`, no `pandas`,
no database. Advancing from level `L` costs `500 + (L-1)*25`, and
`level_and_progress()` returns the level *and* the bar's numerator and denominator
together, so they cannot disagree. Three formulas used to exist and the bar divided
by a different number than the one granting the level; it could never fill. Nothing
outside this module may compute a level or a percentage.

Exactly **2 of 14** domain modules still import `streamlit`, and both are shallow:
- `domain/xp_leveling.py` — the UI shim: `mark_xp_gain()` writes toast flags.
- `domain/custom_plan.py` — writes `st.session_state["last_supabase_error"]`.

Both are UI signalling, not business logic. Return values or raise; let `views/` set
session state. Do that and `domain/` is framework-free. **Keep all new business logic
free of `streamlit`.**

### Data flow, a set being logged
```
views/today.py            number_input → weight, reps
  → domain/workouts.py    save_set_auto()
      → sb_delete_matching() + sb_insert()   data/sb_ops.py
      → domain/achievements.check_achievements()
      → domain/xp_leveling.mark_xp_gain()    sets session_state flag
  → st.rerun()
     → app.py ui_toast_area() + render_workout_xp_toast()  read the flags, render, clear
```

### Supabase is the only store — nothing touches local disk
`data/csv_store.py` used to mirror every write to a local CSV. On Streamlit Cloud that
filesystem is **ephemeral and shared by every visitor of the app instance**, so the
moment auth shipped it would have become a cross-user data leak. It has been deleted,
along with every `to_csv()` in `domain/` and the disk read/write paths in
`views/data_manager.py` and `views/delete_data.py`.

Consequences, all deliberate:
- `Data Manager` backup builds the ZIP in a `BytesIO` from Supabase reads. There is no
  restore-from-CSV and no CSV→Supabase migration path any more.
- `Delete Data` deletes from Supabase. It identifies a row by primary key when the
  table exposes one, else by its scalar identity columns. `jsonb` columns are never
  used as a filter — `.eq()` cannot match them.
- `df_from_supabase` surfaces the error and returns an empty frame. **It must never
  fall back to a local file.** Serving stale local rows is how one user sees another's.

### Reads
`df_from_supabase(table, columns)` selects up to **2500 rows**. It runs per table, per
render. At 1,000 users this is the first thing that breaks.

### The write contract
`config/constants.py :: SUPABASE_TABLE_SCHEMAS` is the *write* contract:
`clean_supabase_row()` filters every insert payload down to the listed columns.
**`user_id` is deliberately absent.** Postgres fills it from `DEFAULT auth.uid()`;
listing it here would send an explicit `NULL` and violate its `NOT NULL` constraint.
Inserts therefore need no application change when tenancy lands.

---

## 3. Security model

### Current state — be blunt about it
- **Authentication: done.** Supabase Auth, email + password. `auth/session.py`.
  `app.py` renders the login screen and calls `st.stop()` for a signed-out visitor,
  so the sidebar (avatar, level, XP of whoever loaded last) never renders.
- **Per-user cache keys: done.** `cached_sb_select(_sb, table, user_id)`.
- **Tenancy: written, not yet applied.** `migrations/001_add_user_id_and_rls.sql`
  adds `user_id` and RLS to all 11 tables. Until it is run against the database, the
  tables remain one shared global bucket and **auth is a doorman with no walls**.
- **RLS: OFF on production.** No longer a suspicion. On 2026-07-10
  `verify_rls.py --anon-only` read all 11 tables (646 rows) with an unauthenticated
  publishable-key client. That key is a skeleton key to every row — 198 workout
  sets, 23 physique ratings, body measurements. It has never been committed to git
  (verified across all history), so exploiting it requires the key itself.
  **`migrations/001` is the fix.** It has been applied and verified on a staging
  project; production is untouched. (Project refs are not recorded in this repo —
  it is public. They live in `.streamlit/secrets.toml`, which is gitignored.)
- Secrets live in `.streamlit/secrets.toml` (gitignored, never committed — verified
  across all commits). It contains a `SUPABASE_SECRET_KEY` and JWKS URL the app
  **never reads** — dead service-role credentials on disk. Remove and rotate.
- The publishable key never reaches a browser: Streamlit is server-rendered. That is
  the only reason the current setup is not already exploited.

### How identity reaches Postgres
```
views/auth.py  sign_in()
  → client.auth.sign_in_with_password()      auth/session.py
      → the JWT is stored ON the client instance
        st.session_state["_sb_client"]        data/supabase_client.py
          → Client.postgrest sends `session.access_token if session else supabase_key`
             → Postgres: auth.uid() = the user
                → RLS policy `user_id = auth.uid()` filters every row
```
Break any link and RLS silently degrades to "the publishable key sees everything".
The most fragile link is the client: cache it globally and it is shared.

### A note on natural keys
`achievements` has only `achievements_pkey PRIMARY KEY (id)` — verified against the
live schema. There is **no** unique constraint on `achievement_id`. So users could
never have collided there, but nothing prevented the same achievement being stored
twice for the same person; `load_achievements()` hides that with `drop_duplicates()`
at read time. `migrations/001` STEP 4 deletes the duplicates and adds the
`unique (user_id, achievement_id)` index that should have existed all along.

`avatar_progression` deliberately gets no unique constraint: it is an append-only
snapshot log and its `timestamp` has second resolution.

### Remaining, in order
1. Run `migrations/001_add_user_id_and_rls.sql` (owner signs up first, then backfill).
2. Run `tools/verify_rls.py` against staging. **Nothing ships publicly before it passes.**
3. Remove and rotate `SUPABASE_SECRET_KEY`.
4. Custom SMTP — Supabase's built-in mailer is rate-limited to a few messages/hour,
   so confirmation emails will not survive a real signup rate.
5. Session persistence across refresh (a cookie component). Not the query param.
6. Storage: physique photos are sent to OpenAI and **not stored**. If they ever are,
   they need a private bucket with RLS and a retention policy.

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
