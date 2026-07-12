# Cyber Athlete — sprite animation tester

A standalone mini-game for testing the character's animation sheet.
**It is completely separate from the EvoForge app**: nothing in `app.py`,
`views/` or anywhere else imports this folder, and Streamlit never executes it.
You can change anything in here without touching core functionality.

## Run it

Double-click **`index.html`**. That's it — it runs straight off the file in any
browser, no server, no install, no build step.

## Controls

| Action | Key | Also |
|---|---|---|
| Walk | ← → (or A/D) | WALK button |
| Run | Shift + move | RUN button |
| Jump | Space / ↑ / W | JUMP button |
| Crouch (hold) | ↓ / S | CROUCH button |
| Block (hold) | B | BLOCK button |
| Punch / Kick / Special | J / K / L | buttons |
| Hurt / KO / Victory | H / O / V | buttons |
| Pause / frame-step | P / `.` | PAUSE / STEP buttons |
| Flip facing / reset | F / R | FLIP / RESET buttons |

SPECIAL launches a projectile that flies across the stage. HURT drains the HP
bar, KO empties it, VICTORY refills it. SPEED and ZOOM sliders at the bottom.

## Files — what to edit for what

| I want to… | Edit |
|---|---|
| Change gameplay: speeds, keys, physics, HUD, stage, projectiles | `index.html` (all the JS is at the bottom of the file) |
| Change an animation's frame rate or loop/once/hold behaviour | `frames.js` — each animation has `fps` and `mode` |
| Re-cut frames from a new/edited sprite sheet | replace `sprites.png`, run `python build_frames.py` |

- `index.html` — the whole game: canvas renderer, input, buttons, projectiles, HUD.
  Key constants near the top of the script: `WALK_SPEED`, `RUN_SPEED`, `GROUND`.
- `frames.js` — generated frame map. Each frame is `{x, y, w, h, dy}` — a rectangle
  in `sheet_clean.png`; `dy` lifts a frame above the ground line (jump arc, fist pump).
  Safe to hand-tweak `fps`/`mode`; frame rects get overwritten by `build_frames.py`.
- `sheet_clean.png` — the sprite sheet with text labels removed and the white
  background made transparent. This is what the game actually draws from.
- `build_frames.py` — regenerates `sheet_clean.png`, `frames.js` and
  `contact_rows.png` from `sprites.png`. Needs Python with `pillow` + `numpy`
  (`pip install pillow numpy`). The sheet is **not** a regular 32px grid (whatever
  its legend claims), so frames are found by auto-detection; if you swap in a very
  different sheet, check `contact_rows.png` afterwards to confirm every frame cut
  cleanly, and adjust the split coordinates in `ANIMS` if something looks off.
- `detect_frames.py` / `split_fused.py` / `boxes.json` — the one-off detection pass
  that originally located the frame boxes. Only needed for a brand-new sheet layout.
- `contact_rows.png` — every extracted frame, one animation row each. The quickest
  way to eyeball whether a rebuild worked.
- `shot_test.py` — optional smoke test: loads the page headless, clicks KICK and
  SPECIAL, runs right, and fails on any JS console error
  (`pip install playwright && playwright install chromium`, then `python shot_test.py`).

## Adding a new animation

1. Put the new frames on the sheet (or a copy) and note their bounding boxes.
2. Add an entry to `ANIMS` in `build_frames.py` — a row band `(y0, y1)` plus the
   x-coordinates where each frame starts/ends — and run `python build_frames.py`.
3. In `index.html`: add the animation name to `ORDER` (button appears
   automatically), give it a key in `KEYHINT`/`TAP`, and add it to `BUSY` if it
   should play out fully without being interrupted by movement.

## Working on this with an AI assistant

See `PROMPT.md` for a paste-ready prompt that gives any AI coding assistant the
context it needs to modify this game safely.
