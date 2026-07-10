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


def run(page, **ss):
    from streamlit.testing.v1 import AppTest
    at = AppTest.from_file(str(APP_DIR / "app.py"), default_timeout=90)
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
bad_pages, orphan_pages, emitted = [], [], set()
for page in PAGES:
    at = run(page)
    all_blobs = blobs(at) + blobs(at, sidebar=True)
    if any(v.count("<div") != v.count("</div>") for v in all_blobs):
        bad_pages.append(page)
    if any(v.strip() in ("</div>", "</div></div>") for v in blobs(at)):
        orphan_pages.append(page)
    if at.exception:
        bad_pages.append(f"{page}!exc")
    for v in all_blobs:
        for m in re.finditer(r'class="([^"]+)"', v):
            emitted.update(m.group(1).split())
check("balanced <div> everywhere", not bad_pages, str(bad_pages))
check("no orphan closing tags", not orphan_pages, str(orphan_pages))

section("4. CSS COVERAGE")
css = (APP_DIR / "assets" / "styles.css").read_text(encoding="utf-8")
css_nc = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
css_classes = set(re.findall(r"\.([a-zA-Z_][\w-]*)", css_nc))
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

print("\n" + "=" * 72)
if failures:
    print(f"FAILURES ({len(failures)}):")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("ALL CHECKS PASSED")
