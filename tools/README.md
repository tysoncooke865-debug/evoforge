# tools/

Verification harness. **Run these before every commit.** They exist because
each one caught a real bug that a green HTTP 200 hid.

## Setup

```bash
pip install -r requirements-dev.txt
python -m playwright install chromium     # only needed for shot.py
```

## The three tools

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
| Screenshotting before Streamlit finishes streaming photographs skeleton placeholders. | `shot.py` waits for `.hero-panel` and zero skeletons |

## Hooks

`tools/hooks/commit-msg` blocks commits touching protected paths without an
`[architect]` marker. Install once:

```bash
git config core.hooksPath tools/hooks
```

