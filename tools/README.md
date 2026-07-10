# tools/

Verification harness. **Run these before every commit.** They exist because
each one caught a real bug that a green HTTP 200 hid.

`.github/workflows/verify.yml` runs all seven on every push and PR, over Python
3.11 and 3.13. **CI is the gate**; the `pre-push` hook is convenience.

## The rule

> Every check that enumerates bad things over a collection must also assert the
> collection is non-empty. `any([])` is `False`: a page that renders nothing has no
> unbalanced `<div>`, an empty table leaks no rows, an empty class set is fully
> styled. **Pair every negative with a positive.** Prefer executing the code to
> grepping its source.
>
> **A guard is not accepted until it has been falsified.** Delete the fix, watch it
> go red, restore it. On 2026-07-10 four checks passed while testing nothing — and
> two of the "positive controls" written that same day were themselves vacuous (one
> measured the sidebar, one measured the mobile brand bar). Only falsification found
> them.

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

> **`--anon-only` against an empty database proves nothing**, so it no longer tries.
> Reaching a pass means every table read empty, and "the stranger saw nothing" is the
> same observation as "there was nothing to see". It now demands a **positive
> control**: set `SUPABASE_SECRET_KEY` (it bypasses RLS) and the check first
> establishes which tables hold rows, then requires the anon client to read zero from
> exactly those. Without it, exit 2 `INCONCLUSIVE`. Pass the key as an env var for
> the run — it must never live in `.streamlit/secrets.toml` (T4).
>
> **An error is not a denial.** `_is_authorization_error()` used to return True for
> any exception whose text mentioned `jwt`, `401`, `403` or `unauthorized`, and every
> caller read True as "securely denied" — a pass. An expired token, a rejected key, a
> proxy 403 all counted as proof that RLS worked. It is now `describe_error()`, which
> returns a *label for the log* and never a verdict; every exception routes to
> inconclusive. Under RLS a genuine denial is HTTP 200 with an empty array. It never
> raises.

### `verify_goals.py` — pure, no database
```bash
python tools/verify_goals.py
```
`journey_percent(baseline, current, target)` measures the distance travelled, not a
ratio. Also pins that the rank ladder is derived from `RANK_TIERS`, not restated.

> **Why this exists:** the bodyweight bar used `current / target`. Cutting 85kg → 75kg
> it read **100% at 85kg** — full before a gram was lost — and **98.7% at 74kg**, so
> the bar went *down* on beating the goal. `lower_is_better=True` breaks the athlete
> who is bulking. A ratio cannot know where you started; direction is a property of
> the starting point, not of the metric.
> *Falsify:* restore the ratio → ten checks red.

### `verify_css.py` — pure, no database
```bash
python tools/verify_css.py
```
Fails if `!important` appears outside the documented allow-list.

> **The trap:** `grep -c '!important' assets/styles.css` returns **16**, but line 6
> is inside the file's own header comment (`"!important 678 -> 16"`). The real count
> is **15**. A guard counting raw matches is off by one from birth and lets exactly
> one real `!important` through. Comments are stripped first.
> *Falsify:* add an `!important` to a non-allow-listed rule → red. Add a *comment*
> mentioning it → stays green.

### `verify_isolation.py` — no database, no browser
```bash
python tools/verify_isolation.py
```
`migrations/001` proves isolation in **Postgres**. This proves it in the **process**.
Streamlit Cloud multiplexes every browser session into one Python process, and
`st.cache_data` / `st.cache_resource` are process-global. By the time a row is in a
module-level cache, RLS has already been satisfied — with somebody else's JWT.

Asserts: `cached_sb_select` is keyed on `user_id` (`_sb` is excluded from the hash by
its underscore); `get_supabase_client()` is not a cached function and a new session
gets a new client; and two AppTest sessions with different users share no rows.

> *Falsify, all three:* rename `user_id` → `_user_id` (Streamlit then skips it) and
> Bob's read returns Alice's rows, carrying Alice's `user_id`. Add `@st.cache_resource`
> to `get_supabase_client` and one user's JWT is served to the next. Memoise
> `get_fast_snapshot()` into a module global and Bob's session never stores its own
> snapshot — the **absence** is the symptom.

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
| `any(...)` over an empty collection is `False`. A page that renders nothing has no unbalanced `<div>`; an empty class set is fully styled; an empty table leaks no rows. | `verify_deep` §3 hero control + §4 floor; `verify_rls` positive control |
| A substring check against `inspect.getsource()` matches the **docstring**. Stripping it with `ast.unparse` still leaves string literals. | `verify_deep` §6 **executes** `clear_data_cache()` against substituted globals |
| An exception whose text says `jwt` / `401` / `403` is **not** a denial. Under RLS a denial is HTTP 200 with an empty array and never raises. | `verify_rls :: describe_error()` labels, never verdicts |
| Streamlit excludes an argument from a cache key when its name starts with `_`. Renaming `user_id` → `_user_id` silently serves one user's rows to the next. | `verify_isolation` §1 |
| `st.cache_resource` is process-global. On it, `get_supabase_client()` hands one visitor's JWT to the next. | `verify_isolation` §2 |
| A ratio cannot express a goal approached from either side. `current / target` reads 100% for an athlete cutting toward a lower target. | `verify_goals` — measure the journey from a baseline |
| `--text-dim` (#93a6c4) is **brighter** than `--text-mute` (#64758f). The names read backwards. | check computed styles, don't trust the token name |
| `tools/shot.py` only ever reaches the **signed-out gate**. It cannot see any page behind the login. | it proves the app boots; nothing more |

## Hooks

`tools/hooks/commit-msg` blocks commits touching protected paths without an
`[architect]` marker. Install once:

```bash
git config core.hooksPath tools/hooks
```

