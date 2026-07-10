"""Fast structural sweep of every EvoForge page.

Runs the real Streamlit script via streamlit.testing.v1.AppTest and inspects the
elements it produced. This catches what an HTTP check cannot: Streamlit returns
HTTP 200 even when a page renders a traceback into the body. Two pages were
crashing on load for months behind a green 200.

Usage:
    python tools/verify_ui.py

Exits non-zero if any page raises or an invariant breaks.
"""
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

AVATAR_WRAPPERS = [
    "avatar-image-native-wrap", "ef-console-image-card",
    "home-avatar-img-wrap", "true-silhouette-panel", "ef-evo-panel",
]

# app.py stops before the router unless someone is signed in. Seeding the key
# that auth/session.py reads is enough to get past the gate: these checks are
# about page structure, not about identity. tools/verify_rls.py tests identity.
#
# The email must not contain "evoforge": the sidebar renders it, and the brand
# invariant below counts EVOFORGE case-insensitively.
TEST_USER = {"id": "00000000-0000-0000-0000-0000000000ff", "email": "verify@example.test"}


def stub_onboarded():
    """Report the test user as already onboarded, without touching the database.

    app.py has a SECOND gate after the auth gate: `onboarding.should_render()`,
    and "a saved profile row IS the onboarded flag". Seeding `_auth_user` fakes
    identity but not a JWT, so once migrations/001 enabled RLS the profile read
    returns 0 rows for this fake id, the wizard renders, and `st.stop()` fires
    before the router. Every page then reports brand_main=0 and data_img=0.

    Before 001 the database was one shared bucket with no `user_id`, so any
    client read *somebody's* profile row and the gate stayed shut by accident.
    That is the only reason this harness ever passed. It was never checking what
    it looked like it was checking.

    Patching the module object is enough: AppTest execs app.py in this same
    process, so `import views.onboarding` resolves out of sys.modules.
    """
    import views.onboarding as vo
    vo.is_onboarded = lambda: True


def run_page(page):
    from streamlit.testing.v1 import AppTest
    stub_onboarded()
    at = AppTest.from_file(str(APP_DIR / "app.py"), default_timeout=90)
    at.session_state["_auth_user"] = TEST_USER
    at.session_state["active_page"] = page
    at.session_state["_nav_initialised"] = True
    at.run()
    return at


def check_auth_gate():
    """A signed-out visitor sees the login screen and nothing else.

    Specifically: no sidebar. The sidebar renders the avatar, level and XP of
    whoever was last loaded, so leaking it past the gate would leak them too.
    """
    from streamlit.testing.v1 import AppTest
    at = AppTest.from_file(str(APP_DIR / "app.py"), default_timeout=90)
    at.session_state["active_page"] = "Avatar"
    at.run()

    problems = []
    if at.exception:
        problems.append(f"login screen raised: {str(at.exception[0].value)[:80]}")

    main_html = "\n".join(markdown_bodies(at))
    if "ef-auth-mark" not in main_html:
        problems.append("login screen did not render")
    if sidebar_bodies(at):
        problems.append("sidebar rendered for a signed-out visitor")
    if 'src="data:image' in main_html:
        problems.append("an avatar image rendered for a signed-out visitor")
    return problems


def _no_style(bodies):
    """Drop the injected <style> blob (CSS, not page markup) and de-duplicate.

    AppTest can surface the same element twice when the script triggers an
    st.rerun() mid-run, so identical blobs are collapsed to one.
    """
    seen, out = set(), []
    for b in bodies:
        if "<style>" in b or b in seen:
            continue
        seen.add(b)
        out.append(b)
    return out


def markdown_bodies(at):
    return _no_style([m.value for m in at.main.markdown])


def sidebar_bodies(at):
    return _no_style([m.value for m in at.sidebar.markdown])


def main():
    results, failures = [], []

    for page in PAGES:
        try:
            at = run_page(page)
        except Exception as e:
            results.append((page, "BOOT-FAIL", str(e)[:60], ""))
            failures.append(page)
            continue

        exc = "; ".join(str(e.value)[:60] for e in at.exception) if at.exception else ""
        if exc:
            failures.append(page)

        main_html = "\n".join(markdown_bodies(at))
        side_html = "\n".join(sidebar_bodies(at))

        brand_main = len(re.findall(r"EVOFORGE", main_html, re.I))
        brand_side = len(re.findall(r"EVOFORGE|EVO<span>FORGE", side_html, re.I))
        data_img = main_html.count('src="data:image')

        # An avatar wrapper is "orphaned" if its blob opens the div but contains
        # no <img> -- meaning the image is a sibling, not a child. That is the
        # signature of a <div> split across separate st.markdown calls, which
        # Streamlit auto-closes independently.
        orphan = 0
        for cls in AVATAR_WRAPPERS:
            for body in markdown_bodies(at):
                if cls in body and "<img" not in body \
                        and "placeholder" not in body and "locked-silhouette" not in body:
                    orphan += 1
        for body in markdown_bodies(at):
            if body.strip() in ("</div>", "</div></div>"):
                orphan += 1

        results.append((
            page, exc or "ok",
            f"brand_main={brand_main} brand_side={brand_side}",
            f"data_img={data_img} orphan={orphan} sel={len(at.selectbox)}",
        ))

    print(f"{'PAGE':<15} {'STATUS':<12} {'BRAND':<32} IMG/ORPHAN")
    print("-" * 92)
    for r in results:
        print(f"{r[0]:<15} {r[1][:12]:<12} {r[2]:<32} {r[3]}")

    print(f"\npages with exceptions/boot failures: {len(failures)}")
    for f in failures:
        print(f"  - {f}")

    gate_problems = check_auth_gate()
    print(f"\nauth gate: {'OK' if not gate_problems else 'FAIL'}")
    for p in gate_problems:
        print(f"  - {p}")

    # Invariants that must hold on every page.
    bad_brand = [r[0] for r in results if "brand_main=1 " not in r[2]]
    bad_orphan = [r[0] for r in results if "orphan=0" not in r[3]]
    if bad_brand:
        print(f"\nFAIL: EVOFORGE must appear exactly once in the main column: {bad_brand}")
    if bad_orphan:
        print(f"FAIL: orphaned avatar wrappers: {bad_orphan}")

    if failures or bad_brand or bad_orphan or gate_problems:
        sys.exit(1)
    print("\nALL PAGES OK")


if __name__ == "__main__":
    main()
