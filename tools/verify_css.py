"""Guard the stylesheet's escape hatches.

`!important` is a loaded gun. The UI rebuild took `assets/styles.css` from 678 of
them to a handful, and every survivor exists for a documented reason. A junior AI
adding one to make a rule stick is how a stylesheet gets back to 678.

This fails if `!important` appears outside the allow-listed blocks below.

    python tools/verify_css.py

THE TRAP: a raw `grep -c '!important' assets/styles.css` returns one MORE than the
number of declarations, because the file's own header comment quotes the historical
count ("`!important` 678 -> 16"). A guard that counts raw matches is off by one from
birth, and would let exactly one real `!important` slip in unnoticed. Comments are
stripped before counting.

Every guard in this repo must be falsifiable: add an `!important` to a rule outside
the allow-list and this goes red. Verified.
"""
import re
import sys
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent
CSS_PATH = APP_DIR / "assets" / "styles.css"

# Selectors permitted to use `!important`, and why. Anything else is a bug.
ALLOW = {
    # Streamlit injects its own icon font on these; losing the cascade renders
    # ligatures as the literal word `keyboard_double_arrow_left`.
    "material-symbols": "Material Symbols ligature guard",
    "[data-testid=\"stIconMaterial\"]": "Material Symbols ligature guard",
    # Streamlit's form controls carry inline styles from the framework itself.
    "stTextInput": "framework inline styles on form controls",
    "stNumberInput": "framework inline styles on form controls",
    "stDateInput": "framework inline styles on form controls",
    "stSelectbox": "framework inline styles on form controls",
    "stTextArea": "framework inline styles on form controls",
    "stFileUploader": "framework inline styles on the uploader",
    "stExpander": "framework inline styles on the expander",
    "baseweb": "BaseWeb internals under Streamlit's widgets",
}

MAX_IMPORTANT = 20

failures = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f"  -- {detail}" if detail and not cond else ""))
    if not cond:
        failures.append(name)


def strip_comments(css):
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def rule_blocks(css):
    """(selector, body) for every rule. Naive but sufficient: no nested at-rules
    in this stylesheet carry `!important`."""
    return re.findall(r"([^{}]+)\{([^{}]*)\}", css)


def main():
    raw = CSS_PATH.read_text(encoding="utf-8")
    css = strip_comments(raw)

    raw_count = raw.count("!important")
    real_count = css.count("!important")

    print(f"stylesheet: {len(raw.splitlines())} lines")
    print(f"  !important -- raw matches: {raw_count}, real declarations: {real_count}")
    if raw_count != real_count:
        print(f"  ({raw_count - real_count} live inside comments; count the declarations, not the matches)")
    print()

    # A positive control. If the regex ever stops matching rules, everything below
    # passes vacuously: `offenders` would be empty because nothing was examined.
    blocks = rule_blocks(css)
    check("the stylesheet parsed into rules", len(blocks) >= 50, f"only {len(blocks)} rules found")

    offenders = []
    allowed_hits = 0
    for selector, body in blocks:
        if "!important" not in body:
            continue
        sel = selector.strip()
        if any(token in sel for token in ALLOW):
            allowed_hits += 1
            continue
        offenders.append((sel.replace("\n", " ")[:70], body.count("!important")))

    # And the other half of the control: the allow-list must actually be matching
    # something, or `offenders` is empty for the wrong reason.
    check("allow-listed rules were found", allowed_hits > 0,
          "no rule matched the allow-list -- has the stylesheet been restructured?")

    check("no !important outside the allow-list", not offenders,
          "; ".join(f"{s} ({n})" for s, n in offenders))
    check(f"!important stays under {MAX_IMPORTANT}", real_count < MAX_IMPORTANT,
          f"count={real_count}")

    print(f"\n  allow-listed rules using !important: {allowed_hits}")

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("ALL CSS CHECKS PASSED")


if __name__ == "__main__":
    main()
