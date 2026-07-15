---
name: verify
description: Build, serve and drive the EvoForge Expo web client with Playwright to verify a change at the real surface (screenshots, signed in as a smoke account).
---

# Verify the Expo client in a real browser

The recipe that works (2026-07-15). HANDOVER.md §5 is the authority for the
full pre-commit loop; this is the browser-tour half.

## Build + serve

```powershell
cd client
npx expo export -p web            # --clear ONLY after an env change (Metro caches EXPO_PUBLIC_)
npx serve "<absolute path>\client\dist" -l 4173   # ABSOLUTE path — the shell cwd resets between tool calls
```

`expo export` prints "Something prevented Expo from exiting, forcefully
exiting now." — that is normal, the export succeeded if it printed
`Exported: dist`.

## Drive (Playwright)

Playwright is NOT in client/package.json. Install it in the session
scratchpad (`npm i playwright`), not in client/. Chromium is usually already
in `~\AppData\Local\ms-playwright`.

Flow that reaches the Train page:

1. `goto http://localhost:4173` → redirects to `/sign-in`.
2. Smoke account ALPHA `smoke-test-claude@evoforge.internal` /
   `SmokeTest-2026-07!x` (see HANDOVER.md §5; BRAVO is the female twin).
   Fill `[data-testid=email]`, `[data-testid=password]`, click
   `[data-testid=sign-in]`.
3. Land on Home. **A tutorial overlay (`tutorial-overlay`) appears after a
   few seconds and eats every click** — wait up to ~8s for
   `[data-testid=tutorial-skip]`, click it, wait for the overlay to detach.
4. Tabs are `role=tab` links named Home / Train / Progress / Forge / Arena.
   The workout page is pushed OVER the tabs (no tab bar there) — use
   `page.goBack()` to return.
5. RN-web maps `testID` → `data-testid`. Useful ones on Train: `hero-card`,
   `hero-start`, `map-rotate` (flips front/back), `start-empty`, `change-workout`,
   `edit-week`, `adhoc-name`, `adhoc-search-input`,
   `adhoc-search-hit-<name>`, `adhoc-start`.

## Gotchas

- **Screenshot paths must be absolute** — relative paths land in whatever the
  shell cwd reset to (once: PNGs strewn into the repo root).
- Expected console noise, not failures: 409 on `coin_events` (daily-grant
  upsert), sometimes a 401 on first authed fetch racing session restore.
- ALPHA's schedule may map today to a day with no plan entries (hero shows
  0 sets, no pills). To exercise pills/lit-map/stats WITHOUT writing to
  production, intercept the schedule read and remap today client-side:

  ```js
  await page.route('**/rest/v1/workout_schedule*', async (route) => {
    const resp = await route.fetch();
    const rows = await resp.json();
    rows[rows.length - 1].plan[String(new Date().getDay())] = 'Push 1 - Strength';
    await route.fulfill({ response: resp, json: rows });
  });
  ```

  Saving via the real schedule page APPENDS a production row — avoid unless
  you also delete it (SQL via the management API, HANDOVER.md §5).
- Zoom on pixel-art details with `deviceScaleFactor: 4` and a `clip` — 1×
  screenshots are too coarse to judge a 14px glyph.
- Kill the server when done: `npx kill-port 4173`.
