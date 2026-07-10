"""Prove the leaderboard leaks nothing: not a body-data column, not an injection.

The leaderboard is the ONLY surface in this app that reads across users. Every other
table is `using (user_id = auth.uid())`. So this is where a leak would be worst, and
it gets the most adversarial test:

  1. The RPC is stubbed to return rows that ALSO carry `email` and `bodyweight`.
     The rendered page must not contain them -- the view selects four fields, and a
     future edit that interpolates the whole row would be caught here.
  2. A `display_name` of `<img src=x onerror=alert(1)>" onmouseover="alert(2)`.
     The rendered HTML, PARSED (not grepped), must carry no live tag and no event
     handler. A display name is attacker text shown on other athletes' screens, and
     the auth cookie is JS-readable, so this is stored-XSS -> account takeover.

Positive controls first, always: the safe fields must actually appear, or "the bad
stuff is absent" is vacuously true on an empty page.

No database, no browser. `sb_rpc` is stubbed, and the page is rendered via AppTest.
"""
import sys
from html.parser import HTMLParser
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_DIR))

NAME_PAYLOAD = '<img src=x onerror=alert(1)>" onmouseover="alert(2)'

# Rows as the RPC returns them -- PLUS two fields the function must never expose, to
# prove the view cannot accidentally pass a whole row through.
POISONED_ROWS = [
    {"display_name": "Alice", "xp": 5000, "base_level": 42, "rank_position": 1,
     "email": "alice@secret.test", "bodyweight": 82.5},
    {"display_name": NAME_PAYLOAD, "xp": 3000, "base_level": 30, "rank_position": 2,
     "email": "attacker@secret.test", "bodyweight": 91.1},
]

failures = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


class _Handlers(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.handlers = []
        self.tags = []

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        for n, v in attrs:
            if n.lower().startswith("on"):
                self.handlers.append((tag, n, v))


def parse(html):
    p = _Handlers()
    p.feed(html)
    return p


# ---------------------------------------------------------------------------
print("=" * 72)
print("LEADERBOARD: four columns leave, and no name can inject")
print("=" * 72)

import data.sb_ops as sb_ops  # noqa: E402
import domain.public_profile as public_profile  # noqa: E402

# `leaderboard_top()` reads through the sb_rpc bound INTO domain.public_profile.
public_profile.sb_rpc = lambda fn, params=None: (POISONED_ROWS, None)
# The rest of the page reads the log; make those empty so the athlete isn't "drifting".
sb_ops.sb_select = lambda table: ([], None)

from tools.verify_ui import stub_onboarded  # noqa: E402

USER = {"id": "00000000-0000-0000-0000-0000000000ff", "email": "me@example.test"}


def render_leaderboard():
    from streamlit.testing.v1 import AppTest
    stub_onboarded()
    at = AppTest.from_file(str(APP_DIR / "app.py"), default_timeout=120)
    at.session_state["_auth_user"] = USER
    at.session_state["active_page"] = "Leaderboard"
    at.session_state["_nav_initialised"] = True
    at.run()
    return at


at = render_leaderboard()
html = "\n".join(m.value for m in at.main.markdown if "<style>" not in m.value)

check("the leaderboard rendered without exceptions", not at.exception,
      "; ".join(str(e.value)[:70] for e in at.exception))

# POSITIVE CONTROL: the board actually rendered rows. Without this, every "leak
# absent" check below passes on an empty page.
board_rendered = "lb-board" in html and "lb-name" in html
check("the board rendered its rows (positive control)", board_rendered,
      "no .lb-board in the output; the leak checks below would be vacuous")

if board_rendered:
    # The four safe fields are present...
    check("a safe display_name is shown", "Alice" in html)
    check("xp is shown", "5000 XP" in html)

    # ...and the two forbidden ones are NOT, anywhere on the page.
    check("no email column leaked", "secret.test" not in html,
          "an email address reached the DOM")
    check("no bodyweight column leaked", "82.5" not in html and "91.1" not in html,
          "a bodyweight reached the DOM")

    # The hostile name is escaped, not live.
    parsed = parse(html)
    check("the escaped payload is present (we are looking at the attacker row)",
          "&lt;img" in html, "the payload row did not render")
    check("no rendered tag carries an event handler", not parsed.handlers,
          str(parsed.handlers[:2]))
    check("the payload opened no <img> tag", "img" not in parsed.tags,
          f"tags: {sorted(set(parsed.tags))[:10]}")

# ---------------------------------------------------------------------------
print()
print("=" * 72)
print("RANKED BY AVATAR LEVEL, NOT RAW XP")
print("=" * 72)
# The level shown is level_and_progress(base_level, xp). Two athletes with the same
# XP but different base levels rank differently, so XP order and LEVEL order can
# disagree -- and the board must follow the level. These two rows are constructed so
# the orders are OPPOSITE: HighLevel has more level but less XP than LowLevel.
#
# level_and_progress(base_level=90, 0)   -> level 90
# level_and_progress(base_level=1, 400)  -> level 1  (first level costs 500)
DIVERGENT_ROWS = [
    {"display_name": "LowLevelBigXP", "xp": 400, "base_level": 1, "rank_position": 1},
    {"display_name": "HighLevelNoXP", "xp": 0, "base_level": 90, "rank_position": 2},
]
public_profile.sb_rpc = lambda fn, params=None: (DIVERGENT_ROWS, None)

at2 = render_leaderboard()
html2 = "\n".join(m.value for m in at2.main.markdown if "<style>" not in m.value)

both = "HighLevelNoXP" in html2 and "LowLevelBigXP" in html2
check("both divergent rows rendered (positive control)", both, html2[:0])
if both:
    hi = html2.index("HighLevelNoXP")
    lo = html2.index("LowLevelBigXP")
    check("the higher-LEVEL athlete ranks above the higher-XP one",
          hi < lo,
          "the board is ordered by XP, not by avatar level")

print()
if failures:
    print(f"FAILED: {len(failures)} check(s)")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("ALL LEADERBOARD CHECKS PASSED")
