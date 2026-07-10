"""Prove that database- and AI-sourced text cannot inject HTML.

This app builds whole cards as one HTML string and passes them to `st.markdown(...,
unsafe_allow_html=True)`, because a `<div>` split across two markdown calls does not
nest. Every value interpolated into one of those f-strings lands in the DOM verbatim.

Two sources are not trustworthy:

  * OpenAI -- `custom_workout_plan.exercise` and `.reps` are model output, stored in
    the database and rendered on Missions. `stats["weak_point_focus"]` is overwritten
    with model output after an AI avatar run.
  * The athlete -- their email address, rendered in the sidebar INSIDE a `title="..."`
    attribute, where an unescaped quote breaks out of the attribute, not the element.

Today an injection is defacement. Once a persistent auth cookie exists it is account
takeover: Streamlit components cannot set `HttpOnly`, so any script on the page can
read the refresh token. This file exists so that cookie can be added safely.

No database, no browser. `sb_select` is stubbed the way tools/verify_ordering.py does.

    python tools/verify_escape.py
"""
import sys
from html.parser import HTMLParser
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP_DIR))


class _HandlerHunter(HTMLParser):
    """Collect real `on*` attributes and real tags, by PARSING, not by regex.

    A regex like `<[a-z][^>]*\\son\\w+=` matches `onmouseover=` sitting harmlessly
    INSIDE `title="a&quot; onmouseover=&quot;..."`, where the browser sees only an
    attribute value. That false positive would fail this guard on correct code.
    Parse the markup the way a browser does and ask what attributes actually exist.
    """

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.handlers = []
        self.tags = []
        self.attrs_by_tag = []

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        self.attrs_by_tag.append((tag, dict(attrs)))
        for name, value in attrs:
            if name.lower().startswith("on"):
                self.handlers.append((tag, name, value))


def parse_html(fragment):
    p = _HandlerHunter()
    p.feed(fragment)
    return p

# A payload with three teeth: a tag, an event handler, and an attribute break.
PAYLOAD = '<img src=x onerror=alert(1)>" onmouseover="alert(2)'
ATTR_PAYLOAD = 'a" onmouseover="alert(3)'

USER = {"id": "00000000-0000-0000-0000-0000000000ff", "email": ATTR_PAYLOAD}

ROWS = {
    "workout_log": [
        {"user_id": USER["id"], "date": "2026-07-01", "workout": "Push 1 - Strength",
         "exercise": "Barbell Bench Press (Strength)", "set": 1, "weight": 100.0,
         "reps": 5, "timestamp": "2026-07-01T10:00:00"},
    ],
    "profile": [{"base_level": 42, "created_at": "2026-07-01T10:00:00",
                 "timestamp": "2026-07-01T10:00:00"}],
    # The AI plan. `exercise` and `reps` are model output.
    # `plan_id` is present because views/today.py indexes it unconditionally once a
    # plan exists (it falls back to ["default_plan"] for the id LIST but then reads
    # the column). Without it the page raises KeyError before we reach the card.
    "custom_workout_plan": [
        {"plan_id": "plan-1", "plan_name": "AI Plan", "workout": "Push 1 - Strength",
         "exercise": PAYLOAD, "sets": 3, "reps": PAYLOAD, "muscle": "Chest",
         "reason": "weak point", "day_goal": "hypertrophy",
         "timestamp": "2026-07-01T10:00:00"},
    ],
}

failures = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def section(n):
    print("\n" + "=" * 72 + f"\n{n}\n" + "=" * 72)


# ---------------------------------------------------------------------------
section("1. esc() ITSELF")
from ui.escape import esc  # noqa: E402

check("angle brackets are escaped", esc("<b>") == "&lt;b&gt;")
check("double quotes are escaped (attribute safety)", '"' not in esc('a"b'))
check("single quotes are escaped", "'" not in esc("a'b"))
check("ampersands are escaped first", esc("&lt;") == "&amp;lt;")
check("None becomes empty, not the text 'None'", esc(None) == "")
check("numbers survive", esc(3) == "3")

# `onerror=alert(1)` SURVIVES as literal text, and that is correct: without a `<`
# to open a tag and without a `"` to close an attribute, it is inert prose. The
# thing to assert is that no tag can open and no attribute can break -- not that a
# scary-looking substring is absent. (The first version of this check asserted the
# substring and failed on its own correct output.)
escaped = esc(PAYLOAD)
check("no tag can open", "<" not in escaped)
check("no attribute can be closed", '"' not in escaped)
check("the payload is still visible, as inert text", "&lt;img" in escaped)

# ---------------------------------------------------------------------------
section("2. RENDERED HTML: an AI exercise name cannot inject")
import data.sb_ops as sb_ops  # noqa: E402

sb_ops.sb_select = lambda table, select_cols="*": (ROWS.get(table, []), None)

from tools.verify_ui import stub_onboarded  # noqa: E402


def render(page, **state):
    from streamlit.testing.v1 import AppTest
    stub_onboarded()
    at = AppTest.from_file(str(APP_DIR / "app.py"), default_timeout=120)
    at.session_state["_auth_user"] = USER
    at.session_state["active_page"] = page
    at.session_state["_nav_initialised"] = True
    for k, v in state.items():
        at.session_state[k] = v
    at.run()
    return at


def blobs(at, sidebar=False):
    src = at.sidebar.markdown if sidebar else at.main.markdown
    return [m.value for m in src if "<style>" not in m.value]


# The AI plan renders only when its radio option is selected. Drive the widget --
# seeding session_state under the label does not work; Streamlit keys the radio
# itself. Then re-run so the plan branch executes.
at = render("Today")
at.radio[0].set_value("AI Custom Workout Plan").run()
main_html = "\n".join(blobs(at))

check("Today rendered without exceptions", not at.exception,
      "; ".join(str(e.value)[:70] for e in at.exception))

# THE POSITIVE CONTROL, and it must be about the PAYLOAD, not about the page.
#
# The first version asserted only that `nw-exercise-card` appeared. It does -- the
# default PPPPLA routine renders exercise cards with ordinary names. So the AI-plan
# branch never ran, the payload never reached the DOM, and the three "no injection"
# checks below passed while testing nothing at all.
#
# If the escaped payload is not in the HTML, we are not looking at the text we think
# we are, and nothing below means anything.
payload_rendered = "&lt;img" in main_html
check("the ESCAPED payload reached the DOM (positive control)", payload_rendered,
      "the AI-plan branch did not run; the injection checks below would be vacuous")

if payload_rendered:
    # `onerror=alert(1)` SURVIVES as literal text, and that is fine: with no `<` to
    # open a tag it is inert prose. Asserting the absence of a scary substring tests
    # nothing (the first version of this check did exactly that, and failed on its
    # own correct output). Ask the real question: does any rendered TAG carry an
    # inline event handler, and did the payload manage to open a tag?
    parsed = parse_html(main_html)
    check("no rendered tag carries an inline event handler", not parsed.handlers,
          str(parsed.handlers[:2]))
    check("the payload opened no <img> tag", "img" not in parsed.tags,
          f"tags: {sorted(set(parsed.tags))[:8]}")
    check("the parser saw real markup (positive control)", len(parsed.tags) > 5,
          f"only {len(parsed.tags)} tags parsed")
    check("the rep scheme is escaped too", main_html.count("&lt;img") >= 2,
          "exercise AND reps both carry the payload; both must be escaped")

# ---------------------------------------------------------------------------
section("3. RENDERED HTML: an email cannot break out of title=\"...\"")
side_html = "\n".join(blobs(at, sidebar=True))

account_rendered = "ef-side-account" in side_html
check("the account chip rendered at all (positive control)", account_rendered)
if account_rendered:
    check("the email's quote is escaped inside the attribute", "&quot;" in side_html,
          side_html[side_html.find("ef-side-account"):][:120])

    parsed = parse_html(side_html)
    check("no sidebar tag carries an inline event handler", not parsed.handlers,
          str(parsed.handlers[:2]))
    check("the parser saw real sidebar markup (positive control)", len(parsed.tags) > 3,
          f"only {len(parsed.tags)} tags parsed")

    # The payload must survive as ONE attribute VALUE, not split into a second
    # attribute. `title="a" onmouseover="alert(3)"` would parse as two attributes;
    # `title='a" onmouseover="alert(3)'` parses as one. That distinction IS the bug.
    account_attrs = [attrs for tag, attrs in parsed.attrs_by_tag
                     if "ef-side-account" in (attrs.get("class") or "")]
    check("the account chip was parsed", len(account_attrs) == 1, str(account_attrs))
    if account_attrs:
        title = account_attrs[0].get("title") or ""
        check("the whole email is one attribute value, quotes and all",
              "onmouseover" in title,
              f"title={title!r} -- the payload escaped its attribute")
        check("the chip has no extra attributes beyond class and title",
              set(account_attrs[0]) <= {"class", "title"}, str(set(account_attrs[0])))

print()
if failures:
    print(f"FAILED: {len(failures)} check(s)")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("ALL ESCAPE CHECKS PASSED")
