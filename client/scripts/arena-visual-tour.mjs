/**
 * Arena visual-audit tour (polish pass Phase 1, 2026-07-23).
 *
 * Drives the built web client through a full Arena battle and every arena
 * menu screen, saving phone-sized screenshots for visual review. Used to
 * produce the evidence behind src/arena-game/ARENA_VISUAL_AUDIT.md; re-run
 * it after each polish phase to compare against the baseline captures.
 *
 * Prereqs (see client/.claude/skills/verify/SKILL.md):
 *   npx expo export -p web
 *   npx serve "<abs path>/client/dist" -l 4173
 *   node scripts/arena-visual-tour.mjs <output-dir>
 * Playwright is NOT a client dependency — run from a directory where
 * `npm i playwright` has been done (e.g. the session scratchpad), or point
 * NODE_PATH at one.
 *
 * NOTE: the arena package exposes no testIDs yet (audit finding C6), so
 * in-battle card/lane taps are coordinate-based for a 390x844 viewport.
 * Replace with testID selectors once Phase 3 adds them.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const SHOTS = path.resolve(process.argv[2] ?? 'arena-tour-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (page, name) =>
  page.screenshot({ path: path.join(SHOTS, name + '.png') }).then(() => console.log('shot', name));

// Smoke account ALPHA — RLS-isolated test account (HANDOVER.md section 5).
const SMOKE_EMAIL = 'smoke-test-claude@evoforge.internal';
const SMOKE_PASSWORD = 'SmokeTest-2026-07!x';
const BASE = process.env.TOUR_BASE_URL ?? 'http://localhost:4173';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

try {
  // --- sign in ---
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('[data-testid=email]', SMOKE_EMAIL);
  await page.fill('[data-testid=password]', SMOKE_PASSWORD);
  await page.click('[data-testid=sign-in]');
  await page.waitForTimeout(4000);
  // The main-app tutorial overlay eats every click — skip it if it shows.
  try {
    const skip = page.locator('[data-testid=tutorial-skip]');
    await skip.waitFor({ state: 'visible', timeout: 9000 });
    await skip.click();
    await skip.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  } catch {}
  console.log('signed in');

  // --- arena entry ---
  await page.goto(BASE + '/forge-arena', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot(page, '01-title');
  await page.getByText('ENTER THE ARENA').first().click();
  await page.waitForTimeout(1200);
  if (await page.getByText('NEXT', { exact: true }).count()) {
    await shot(page, '03-onboarding-champion-pick');
    await page.getByText('NEXT', { exact: true }).first().click();
    await page.waitForTimeout(800);
    await shot(page, '04-onboarding-step2');
    await page.getByText('Skip to Lobby').first().click();
    await page.waitForTimeout(1200);
  }
  await shot(page, '05-lobby');

  // --- a full battle, deploying cards along the way ---
  await page.getByText('BATTLE', { exact: true }).first().click();
  await page.waitForTimeout(1000);
  await shot(page, '06-battle-t01s');
  const cardX = [60, 150, 240, 330];
  let ended = false;
  for (let t = 2; t <= 210 && !ended; t += 4) {
    await page.waitForTimeout(4000);
    const cx = cardX[((t / 4) | 0) % 4];
    await page.mouse.click(cx, 772).catch(() => {});
    await page.waitForTimeout(150);
    await page.mouse.click(t % 8 < 4 ? 110 : 280, 575).catch(() => {});
    if (t === 6) await shot(page, '07-battle-t06s');
    if (t === 18) await shot(page, '08-battle-t18s');
    if (t === 38) await shot(page, '09-battle-t38s');
    if (t === 70) await shot(page, '10-battle-t70s');
    if (t === 110) await shot(page, '11-battle-t110s');
    if (t === 150) await shot(page, '12-battle-t150s');
    const over = await page.getByText(/VICTORY|DEFEAT|DRAW/i).count().catch(() => 0);
    if (over > 0) {
      ended = true;
      await shot(page, '13-battle-end');
      await page.waitForTimeout(1500);
      await shot(page, '14-result');
    }
  }
  if (!ended) await shot(page, '13-battle-timeout-state');

  // --- pixel-level lane crop at DPR 4 (judge sprite crispness) ---
  const zoomCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 4,
    storageState: await ctx.storageState(),
  });
  const zp = await zoomCtx.newPage();
  await zp.goto(BASE + '/forge-arena/battle', { waitUntil: 'networkidle' });
  await zp.waitForTimeout(12000);
  await zp.screenshot({
    path: path.join(SHOTS, '15-battle-zoom-lanes.png'),
    clip: { x: 10, y: 200, width: 370, height: 420 },
  });
  console.log('shot 15-battle-zoom-lanes');
  await zoomCtx.close();

  // --- every arena menu screen ---
  const tours = [
    ['champions', '20-champions'],
    ['champion/champion-titan', '21-champion-detail-titan'],
    ['deck-builder', '22-deck-builder'],
    ['collection', '23-collection'],
    ['rank', '24-rank'],
    ['gym', '25-gym'],
    ['battle-log', '26-battle-log'],
    ['profile', '27-profile'],
    ['tutorial', '28-tutorial'],
  ];
  for (const [route, name] of tours) {
    await page.goto(`${BASE}/forge-arena/${route}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(1800);
    await shot(page, name);
  }
  console.log('DONE');
} finally {
  await browser.close();
}
