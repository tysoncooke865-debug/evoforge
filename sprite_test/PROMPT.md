# Paste-ready AI prompt for this folder

Copy everything in the block below into Claude / ChatGPT / Copilot when you want
help changing the game. Add your actual request at the end.

```
You are working ONLY inside the `sprite_test/` folder of the evoforge repo.
It is a standalone browser mini-game for testing a pixel-art character's
animations. Nothing outside this folder may be read, imported, or modified —
the main EvoForge app must be completely unaffected.

How it works:
- `index.html` is the entire game: an HTML5 canvas player with a neon arcade
  stage. All JavaScript is inline at the bottom of the file. It runs by
  double-clicking the file (file:// URL, no server), so never introduce
  fetch/XHR, ES modules, CDNs, or a build step — everything must stay inline
  or loaded via <script src> / <img> from this same folder.
- `frames.js` (loaded by index.html) defines SHEET_SRC and ANIMS. Each
  animation has fps, mode ("loop" | "once" | "hold"), and frames — rectangles
  {x, y, w, h, dy} into sheet_clean.png. dy lifts a frame above the ground
  line to preserve jump arcs. "once" animations return to idle when finished;
  "hold" animations freeze on the last frame.
- `sheet_clean.png` is the transparent-background sprite sheet the game draws
  from. It is GENERATED — to change it, edit `sprites.png` and rerun
  `python build_frames.py` (needs pillow + numpy), then check
  `contact_rows.png` to confirm every frame still cuts cleanly.
- Game state lives in the `st` object; per-animation playback in `update()`;
  input in the keydown/keyup handlers and the generated buttons (ORDER /
  KEYHINT / TAP); BUSY lists animations that can't be interrupted by movement.
- Rendering must stay pixel-crisp: imageSmoothingEnabled stays false, and the
  character is drawn feet-anchored at GROUND with facing applied via
  ctx.scale(facing, 1).

After any change, verify by opening index.html in a browser and checking the
console for errors, or run `python shot_test.py` if playwright is installed.

My request:
```

## Example requests to append

- "Add a double-jump: pressing Space in mid-air replays jump frames 2–3 with a
  higher arc."
- "Add a second player on the right side controlled by WASD + GH, using the
  same frame data flipped to face left, and make projectiles damage them."
- "Make KICK move the character forward 40px over its three frames."
- "Slow every animation to half speed and add an on-screen frame counter."
