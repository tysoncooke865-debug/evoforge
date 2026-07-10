"""Render EvoForge in a real browser: screenshots + DOM diagnostics.

The only tool here that sees what a user sees. It found the duplicate sidebar
(Streamlit's auto multipage nav), the Material Symbols ligatures rendering as
literal words, and the sidebar's sideways scroll -- none of which AppTest can see.

Waits for Streamlit to finish streaming (skeletons gone, hero rendered) before
capturing. Screenshot too early and you photograph the loading state, then
misread the skeleton placeholders as missing content.

Setup (once):
    pip install -r requirements-dev.txt
    python -m playwright install chromium

Usage:
    streamlit run app.py --server.port 8501        # in another terminal
    python tools/shot.py                            # defaults to localhost:8501
    python tools/shot.py http://localhost:8501/?nav=Avatar avatar
    python tools/shot.py https://evoforge.streamlit.app/ live

Screenshots land in tools/shots/ (gitignored).
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent / "shots"
OUT.mkdir(exist_ok=True)

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8501/"
TAG = sys.argv[2] if len(sys.argv) > 2 else "run"
FULL = "--full" in sys.argv

VIEWPORTS = (
    ("desktop", {"width": 1440, "height": 1000}),
    ("mobile", {"width": 390, "height": 844}),
)

DIAG = r"""
() => {
  const q = (s) => Array.from(document.querySelectorAll(s));
  const sb = q('section[data-testid="stSidebar"]')[0];
  const icons = q('[data-testid="stIconMaterial"]');
  const vw = document.documentElement.clientWidth;

  return {
    viewport: vw,
    skeletons: q('[data-testid="stSkeleton"], .stSkeleton').length,
    exceptions: q('[data-testid="stException"]').length,
    sidebar: sb ? {
      overflowX: getComputedStyle(sb).overflowX,
      // `hidden` still permits programmatic sideways scroll; `clip` forbids it.
      canScrollSideways: (() => {
        const b = sb.scrollLeft; sb.scrollLeft = 80;
        const a = sb.scrollLeft; sb.scrollLeft = b; return a > 0;
      })(),
      brand: sb.querySelectorAll('.ef-sidebar-brand').length,
      navBtns: sb.querySelectorAll('.stButton button').length,
      // Streamlit builds this automatically from a top-level pages/ dir.
      // It must be 0 -- our page modules live in views/ for exactly this reason.
      streamlitAutoNav: q('[data-testid="stSidebarNav"]').length,
    } : null,
    // Icons are Material Symbols LIGATURES: the text really is
    // "keyboard_double_arrow_left". If the icon font is overridden, the raw
    // word renders. Never set font-family on `.stApp span`.
    iconsWithWrongFont: icons.filter(e =>
      !/Material Symbols/i.test(getComputedStyle(e).fontFamily)).length,
    iconsTotal: icons.length,
    heroPanels: q('.hero-panel').length,
    avatarStages: q('.ef-avatar-stage').length,
    // The signed-out gate. When this is 1 the sidebar must be absent: it renders
    // the last-loaded avatar, level and XP.
    authScreens: q('.ef-auth-hero').length,
    onboardingSteps: q('.ef-onb-dot').length,

    // Did the app render ANYTHING of ours? Every reachable state produces one of
    // these three. Zero means a dead app -- and every other check below passes
    // vacuously on a blank page, so this must be its own failure.
    appRendered: q('.hero-panel, .ef-auth-hero, .ef-onb-header').length,

    // Streamlit Cloud replaces a startup traceback with its own error card,
    // which is NOT [data-testid="stException"]. Without this, a completely
    // broken deploy reports zero exceptions.
    cloudErrorPage: /This app has encountered an error/i.test(
      document.body.innerText || '') ? 1 : 0,

    pageScrollsSideways: document.documentElement.scrollWidth > vw + 2,
  };
}
"""


def app_frame(pg, timeout_ms=20000):
    """Return the frame the Streamlit app lives in.

    On localhost the app IS the top document. On Streamlit Cloud it is served
    inside an <iframe> at `<host>/~/+/` -- the Fork button and viewer badge
    belong to the host page. Evaluating DIAG against the main frame there
    measures the wrapper: every selector returns 0 and every check passes
    vacuously, including the exception check. That is how a completely dead
    deploy reported "NO PROBLEMS DETECTED".

    The iframe attaches a second or two after domcontentloaded, so poll.
    """
    waited = 0
    while waited < timeout_ms:
        for frame in pg.frames:
            try:
                if frame.evaluate("() => !!document.querySelector('.stApp')"):
                    return frame
            except Exception:
                continue  # cross-origin or torn-down frame
        pg.wait_for_timeout(500)
        waited += 500
    return pg.main_frame


def main():
    problems = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, vp in VIEWPORTS:
            pg = b.new_page(viewport=vp)
            js_errors = []
            pg.on("pageerror", lambda e: js_errors.append(str(e)[:90]))
            pg.goto(URL, wait_until="domcontentloaded", timeout=60000)

            frame = app_frame(pg)
            if frame is pg.main_frame:
                print(f"[{name}] app is the top document (localhost)")
            else:
                print(f"[{name}] app is in an iframe (Streamlit Cloud); measuring that frame")

            try:
                # A signed-out visitor gets .ef-auth-hero and never a .hero-panel;
                # the onboarding wizard gets neither. Wait for whichever arrives.
                frame.wait_for_selector(".hero-panel, .ef-auth-hero, .ef-onb-header", timeout=45000)
                frame.wait_for_function(
                    "() => document.querySelectorAll('[data-testid=\"stSkeleton\"]').length === 0",
                    timeout=30000)
            except Exception as e:
                print(f"[{name}] wait warning: {str(e)[:90]}")
            pg.wait_for_timeout(2500)  # let CSS animations settle

            diag = frame.evaluate(DIAG)
            diag["jsErrors"] = js_errors
            print(f"\n===== {name.upper()} ({vp['width']}px) =====")
            print(json.dumps(diag, indent=2))

            sbd = diag.get("sidebar") or {}
            if diag["cloudErrorPage"]:
                problems.append(f"{name}: Streamlit Cloud error page -- the app failed to start")
            if not diag["appRendered"]:
                problems.append(f"{name}: the app rendered nothing (no hero, login or wizard)")
            if diag["exceptions"]:
                problems.append(f"{name}: {diag['exceptions']} exception(s)")
            if diag["iconsWithWrongFont"]:
                problems.append(f"{name}: {diag['iconsWithWrongFont']} icon(s) with wrong font")
            if diag["pageScrollsSideways"]:
                problems.append(f"{name}: page scrolls sideways")
            if sbd.get("streamlitAutoNav"):
                problems.append(f"{name}: Streamlit auto multipage nav present (duplicate sidebar)")
            if sbd.get("canScrollSideways"):
                problems.append(f"{name}: sidebar scrolls sideways")
            if diag["authScreens"] and sbd.get("navBtns"):
                problems.append(f"{name}: sidebar nav rendered behind the login gate")
            if js_errors:
                problems.append(f"{name}: js errors {js_errors[:1]}")

            path = OUT / f"{TAG}_{name}.png"
            pg.screenshot(path=str(path), full_page=FULL)
            print(f"  -> {path}")
            pg.close()
        b.close()

    print("\n" + "=" * 60)
    if problems:
        print("PROBLEMS:")
        for p_ in problems:
            print("  -", p_)
        sys.exit(1)
    print("NO PROBLEMS DETECTED")


if __name__ == "__main__":
    main()
