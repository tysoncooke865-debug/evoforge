"""Deep structural verification of the EvoForge UI.

Checks the things that break silently and cost hours to find:
  1. Both toast systems fire and self-clear.
  2. The layered avatar stage renders all four CSS layers, image as a real child.
  3. No unbalanced <div> anywhere (Streamlit sanitizes each markdown call
     independently and auto-closes tags, so a <div> split across calls does not
     nest -- it produces an empty styled box plus an orphaned sibling).
  4. Every CSS class the Python emits actually has a rule.
  5. Stylesheet health: one :root, no duplicate @keyframes, !important bounded.

Usage:
    python tools/verify_deep.py

Exits non-zero on any failure.
"""
import collections
import re
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_DIR))

PAGES = [
    "Home", "Profile", "Measurements", "Physique", "Today", "Cardio",
    "Avatar", "Progress", "Goals", "Achievements", "Body Fat",
    "Bodyweight", "Data Manager", "Delete Data", "Routine",
]

failures = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(f"{name}: {detail}")


# app.py stops before the router unless someone is signed in. The email must not
# contain "evoforge" -- the sidebar renders it, and brand counts are asserted.
TEST_USER = {"id": "00000000-0000-0000-0000-0000000000ff", "email": "verify@example.test"}


def stub_onboarded():
    """Report the test user as already onboarded, without touching the database.

    app.py gates twice: auth, then `onboarding.should_render()`. `_auth_user`
    fakes identity but not a JWT, so under the RLS added by migrations/001 the
    profile read returns 0 rows, the wizard renders and `st.stop()` fires before
    the router -- no avatar stage, no toasts, nothing to check.

    See tools/verify_ui.py :: stub_onboarded() for why this harness passed before
    001 landed: the pre-RLS database was one shared bucket, so any client read
    somebody's profile row.
    """
    import views.onboarding as vo
    vo.is_onboarded = lambda: True


def run(page, **ss):
    from streamlit.testing.v1 import AppTest
    stub_onboarded()
    at = AppTest.from_file(str(APP_DIR / "app.py"), default_timeout=90)
    at.session_state["_auth_user"] = TEST_USER
    at.session_state["active_page"] = page
    at.session_state["_nav_initialised"] = True
    for k, v in ss.items():
        at.session_state[k] = v
    at.run()
    return at


def blobs(at, sidebar=False):
    src = at.sidebar.markdown if sidebar else at.main.markdown
    seen, out = set(), []
    for m in src:
        v = m.value
        if "<style>" in v or v in seen:
            continue
        seen.add(v)
        out.append(v)
    return out


def section(n):
    print("\n" + "=" * 72 + f"\n{n}\n" + "=" * 72)


section("1. TOAST SYSTEMS")
at = run("Routine", just_saved_message="SET SAVED", pr_message="Bench 102kg",
         achievement_message="100kg Club", show_xp_toast=True, last_xp_gain=75)
html = "\n".join(blobs(at))
check("save toast renders", "save-toast" in html)
check("pr toast renders", "pr-toast" in html)
check("achievement toast renders", "achievement-toast" in html)
check("xp burst renders", "xp-toast" in html)
check("xp amount shown", "+75 XP" in html)
check("no exceptions", not at.exception, str([str(e.value) for e in at.exception]))
check("just_saved cleared", at.session_state["just_saved_message"] == "")
check("show_xp_toast cleared", at.session_state["show_xp_toast"] is False)

section("2. AVATAR STAGE LAYERS")
for page in ("Home", "Avatar"):
    at = run(page)
    html = "\n".join(blobs(at))
    check(f"{page}: stage", "ef-avatar-stage" in html)
    check(f"{page}: aura", "ef-avatar-aura" in html)
    check(f"{page}: flare", "ef-avatar-flare" in html)
    check(f"{page}: ground shadow", "ef-avatar-ground" in html)
    check(f"{page}: img is data-uri child", 'class="ef-avatar-img"' in html and "data:image" in html)
    check(f"{page}: rarity class", bool(re.search(r"rarity-(common|rare|epic|legendary|mythic)", html)))
    check(f"{page}: no exceptions", not at.exception)

section("3. HTML INTEGRITY (all pages)")
# `any(...)` over an EMPTY list is False. So a page that rendered nothing at all
# used to satisfy "balanced <div> everywhere" and "no orphan closing tags", and
# contributed nothing to `emitted`, which then let section 4 pass too. A blank
# page was indistinguishable from a healthy one.
#
# Every negative check ("no unbalanced div") needs a paired positive ("this page
# actually drew something"). verify_ui.py has always done this by asserting
# EVOFORGE appears exactly once per page; section 3 did not.
bad_pages, orphan_pages, heroless_pages, emitted = [], [], [], set()
for page in PAGES:
    at = run(page)
    main_blobs = blobs(at)
    all_blobs = main_blobs + blobs(at, sidebar=True)
    # THE POSITIVE CONTROL: the page drew its OWN content, not just the chrome.
    #
    # Two wrong versions preceded this one. "all_blobs is non-empty" tested the
    # sidebar, which always renders. "main_blobs is non-empty" tested
    # render_mobile_navigation()'s brand bar, which app.py writes into the main
    # column on every page. Both passed with a page's render() stubbed to `return`.
    #
    # `.hero-panel` comes only from `page_hero()`, which all 15 pages call and no
    # chrome emits. Falsification found both mistakes; the rule earns its keep.
    if not any("hero-panel" in v for v in main_blobs):
        heroless_pages.append(page)
    if any(v.count("<div") != v.count("</div>") for v in all_blobs):
        bad_pages.append(page)
    if any(v.strip() in ("</div>", "</div></div>") for v in blobs(at)):
        orphan_pages.append(page)
    if at.exception:
        bad_pages.append(f"{page}!exc")
    for v in all_blobs:
        for m in re.finditer(r'class="([^"]+)"', v):
            emitted.update(m.group(1).split())
check("every page rendered its own hero", not heroless_pages,
      f"no .hero-panel in the main column: {heroless_pages}")
check("balanced <div> everywhere", not bad_pages, str(bad_pages))
check("no orphan closing tags", not orphan_pages, str(orphan_pages))

section("4. CSS COVERAGE")
css = (APP_DIR / "assets" / "styles.css").read_text(encoding="utf-8")
css_nc = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
css_classes = set(re.findall(r"\.([a-zA-Z_][\w-]*)", css_nc))
# The floor. `missing` is a set difference: if `emitted` is empty it is empty too,
# and "every emitted class is styled" passes while nothing was ever emitted. The
# app renders ~120 distinct classes across 15 pages; 20 is a floor, not a target.
check("emitted class set is non-trivial", len(emitted) >= 20,
      f"only {len(emitted)} classes emitted -- did the pages render?")
missing = sorted(c for c in emitted if c not in css_classes)
check("every emitted class is styled", not missing, f"unstyled: {missing}")
print(f"       emitted={len(emitted)}  styled_in_css={len(css_classes)}")

section("5. STYLESHEET HEALTH")
kf = re.findall(r"@keyframes\s+([\w-]+)", css_nc)
dup_kf = [k for k, v in collections.Counter(kf).items() if v > 1]
check("no duplicate @keyframes", not dup_kf, str(dup_kf))
check("braces balanced", css_nc.count("{") == css_nc.count("}"))
check("!important under 20", css.count("!important") < 20, f"count={css.count('!important')}")
root_top = len(re.findall(r"^:root\s*\{", css_nc, re.M))
check("exactly one top-level :root", root_top == 1, f"count={root_top}")

# Every referenced animation must be defined. Strip function calls first --
# `steps(1, end)` and `cubic-bezier(...)` contain commas and would otherwise be
# split into bogus "names".
KEYWORDS = {"none", "infinite", "linear", "ease", "both", "forwards", "end", "start"}
refs = set()
for decl in re.findall(r"animation:\s*([^;]+);", css_nc):
    decl = re.sub(r"\w[\w-]*\([^)]*\)", " ", decl)
    for part in decl.split(","):
        tok = part.strip().split()
        if tok:
            refs.add(tok[0])
undefined = sorted(r for r in refs if r not in set(kf) and r not in KEYWORDS)
check("all animations defined", not undefined, f"undefined: {undefined}")

section("6. WRITE INVALIDATES EVERY READ CACHE")
# There are TWO caches over the same rows, and only one of them is obvious.
# `get_fast_snapshot()` memoises df + summary into session_state["_fast_snapshot"];
# Home, the sidebar and the stat panels read it. It used to be cleared only on
# sign-out, so a logged set was stored, its XP granted, and every surface kept
# rendering the summary computed before the set existed -- correct in the database,
# stale on the screen for the whole session.
#
# EXECUTE the function. Do not grep its source.
#
# The first version of this check did `"_fast_snapshot" in inspect.getsource(fn)`
# and matched the DOCSTRING -- it passed with the fix deleted. The second stripped
# the docstring via ast.unparse, which is better and still wrong: ast.unparse
# preserves string literals, so `log("cleared _fast_snapshot")` would satisfy it,
# and a legitimate refactor into a helper would fail it. Neither version ever ran
# the function. Both were assertions about prose.
#
# Substituting the module's globals is the only honest way to observe the two side
# effects without a Streamlit runtime or a database.
import data.sb_ops as sb_ops  # noqa: E402


class _FakeCachedSelect:
    """Stands in for the `st.cache_data`-wrapped `cached_sb_select`."""

    def __init__(self):
        self.cleared = False

    def clear(self):
        self.cleared = True


class _FakeStreamlit:
    """Just enough `st` for `clear_data_cache`: a real dict for session_state."""

    def __init__(self, session_state):
        self.session_state = session_state


_real_cached, _real_st = sb_ops.cached_sb_select, sb_ops.st
try:
    fake_cache = _FakeCachedSelect()
    snapshot_sentinel = object()
    fake_state = {"_fast_snapshot": snapshot_sentinel, "keep_me": 1}

    sb_ops.cached_sb_select = fake_cache
    sb_ops.st = _FakeStreamlit(fake_state)

    sb_ops.clear_data_cache()

    check("clear_data_cache clears the st.cache_data read cache", fake_cache.cleared,
          "cached_sb_select.clear() was never called")
    check("clear_data_cache drops the session_state page snapshot",
          "_fast_snapshot" not in fake_state,
          "a write must invalidate get_fast_snapshot(), not just cached_sb_select")
    check("...and leaves the rest of session_state alone", fake_state.get("keep_me") == 1,
          "clear_data_cache is clobbering unrelated session state")
finally:
    sb_ops.cached_sb_select, sb_ops.st = _real_cached, _real_st

print("\n" + "=" * 72)
if failures:
    print(f"FAILURES ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("ALL CHECKS PASSED")
