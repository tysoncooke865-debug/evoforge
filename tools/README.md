# tools/

Verification harness. **Run these before every commit.** They exist because
each one caught a real bug that a green HTTP 200 hid.

## Setup

```bash
pip install -r requirements-dev.txt
python -m playwright install chromium     # only needed for shot.py
```

## The tools

Before every commit: `verify_ui.py`, `verify_deep.py`, `verify_ordering.py`.
If the change is visual, also `shot.py`. `verify_rls.py` is for the database.

### `verify_ui.py` — fast, no browser
```bash
python tools/verify_ui.py
```
Runs all 15 pages through `streamlit.testing.v1.AppTest` and asserts:
zero exceptions, `EVOFORGE` appears exactly once in the main column, no orphaned
avatar wrappers.

> **Why this exists:** Streamlit returns HTTP 200 even when a page renders a
> traceback into the body. Two pages (Body Fat, Physique) crashed on load for
> months behind a passing 200 check. Never verify with `curl` alone.

### `verify_deep.py` — fast, no browser
```bash
python tools/verify_deep.py
```
Toasts fire and self-clear · avatar stage has all four layers with the image as a
real child · no unbalanced `<div>` · every emitted CSS class has a rule · one
`:root`, no duplicate `@keyframes`, `!important` bounded.

### `verify_ordering.py` — fast, no database
```bash
python tools/verify_ordering.py
```
Asserts that "the latest record" really is the latest. Stubs the Supabase layer
with rows in the order Supabase actually returns them, then checks
`latest_bodyweight_value`, `get_base_level`, `latest_bodyfat_mid`,
`latest_measurements` and `latest_physique_rating_values`.

> **Why this exists:** `cached_sb_select` orders **descending** so `limit(2500)`
> keeps recent rows. Every consumer then read `.iloc[-1]` to mean "latest" — which
> on a descending frame is the *oldest* row. The app showed the first bodyweight
> ever logged as the current one, and derived avatar stats from the oldest
> measurements. `df_from_supabase` now re-sorts ascending. Delete that sort and
> this file fails; that was checked.

### `verify_rls.py` — hits a real database
```bash
# read-only, safe against production:
python tools/verify_rls.py --anon-only

# the full test. STAGING ONLY. It signs up two users and writes to all 11 tables:
python tools/verify_rls.py --i-understand-this-writes-to-the-database
```
The full test asserts each user reads only their own rows, that an unauthenticated
publishable-key client reads **zero**, and that a forged `user_id` is rejected —
which is the only evidence that RLS policies carry `with check` and not just
`using`.

> **Why this exists:** on 2026-07-10 `--anon-only` read all 11 production tables,
> 646 rows, with no session at all. RLS was off. It had been "unverified" for the
> life of the project because nobody had run the query.

> **`preflight()` must probe `/auth/v1/health`, never `/rest/v1/`.** PostgREST's
> root serves the OpenAPI schema to **secret keys only**; a publishable key gets
> `401 Secret API key required`. The first version of `preflight()` read that 401 as
> "wrong or rotated key" and exited 2, which meant this acceptance test could not
> pass against *any* new-format project no matter how correct the key — while the
> app, connecting with that same publishable key, worked fine. Probe on the
> credential the app actually uses.

> **`--anon-only` against an empty database proves nothing.** Zero rows is
> consistent with RLS enforced *and* with RLS off on an empty table. The full test
> is the real evidence, because it writes rows first. Run `--anon-only` again once
> there is data. *An error is not a denial — and zero rows is not a denial either,
> when there are zero rows.*

### `shot.py` — real browser, sees pixels
```bash
streamlit run app.py --server.port 8501      # terminal 1
python tools/shot.py                          # terminal 2
python tools/shot.py "http://localhost:8501/?nav=Avatar" avatar
```
Screenshots at 1440px and 390px into `tools/shots/` (gitignored), plus DOM
diagnostics. Fails on: exceptions, JS errors, sideways scroll, icons rendering
with the wrong font, or Streamlit's auto multipage nav appearing.

> **Why this exists:** three bugs were invisible to `AppTest` — Streamlit
> building its own sidebar nav from a `pages/` directory, Material Symbols
> ligatures rendering as the literal word `keyboard_double_arrow_left`, and the
> sidebar scrolling sideways. If a symptom is visual, use this, don't theorise.

## Traps this harness encodes

| Trap | Guard |
|---|---|
| A `<div>` split across two `st.markdown` calls does not nest. Streamlit sanitizes each call independently and auto-closes the tag, producing an empty styled box plus an orphaned sibling. | `verify_deep.py` balanced-div + orphan checks |
| Setting `font-family` on `.stApp span` clobbers Material Symbols and icons render as words. | `shot.py` `iconsWithWrongFont` |
| A top-level `pages/` directory makes Streamlit build its own multipage sidebar nav. Our page modules live in `views/`. | `shot.py` `streamlitAutoNav` |
| `overflow-x: hidden` still permits programmatic sideways scroll. Use `clip`. | `shot.py` `canScrollSideways` |
| Globally squashing `animation-duration` fast-forwards one-shot toasts to their `opacity: 0` end state, making them invisible. | `verify_deep.py` toast checks |
| Screenshotting before Streamlit finishes streaming photographs skeleton placeholders. | `shot.py` waits for a hero, login or wizard, and zero skeletons |
| On Streamlit Cloud the app is inside an `<iframe>` at `<host>/~/+/`. Querying the main frame measures the wrapper: every selector returns 0 and every check passes vacuously. A dead deploy reported "NO PROBLEMS DETECTED". | `shot.py` `app_frame()` finds the frame holding `.stApp` |
| A blank page satisfies every check that counts something bad. | `shot.py` `appRendered` + `cloudErrorPage` |
| `cached_sb_select` orders **descending**; `.iloc[-1]` is therefore the *oldest* row, not the latest. | `verify_ordering.py` |
| An RLS denial returns HTTP 200 with an empty array. "No rows" and "you may not see the rows" are indistinguishable — so emptiness must never be read as "new user". | `views/onboarding.py :: gate_decision()` |
| Supabase's `/rest/v1/` root accepts **secret keys only**. Health-checking it with the app's publishable key returns 401 and looks exactly like a bad key. | `verify_rls.py :: preflight()` probes `/auth/v1/health` |
| An `AppTest` that seeds `_auth_user` has an identity but no JWT, so under RLS every read returns 0 rows, the onboarding wizard swallows all 15 pages, and the brand/avatar assertions fail. Before `001` the shared-bucket database hid this. | `verify_ui.py` / `verify_deep.py` :: `stub_onboarded()` |
| `.streamlit/secrets.toml` is gitignored; `.streamlit/secrets.toml.example` is **tracked**, in a **public** repo, and the names differ by eight characters. | `git status` before any commit touching `.streamlit/` |
| Parsing `secrets.toml` by splitting on `=` corrupts any value with an inline comment, producing a 401 indistinguishable from a wrong key. | use `tomllib`, as Streamlit does |

## Hooks

`tools/hooks/commit-msg` blocks commits touching protected paths without an
`[architect]` marker. Install once:

```bash
git config core.hooksPath tools/hooks
```

