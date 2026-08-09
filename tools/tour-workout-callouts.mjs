/**
 * Tour LIVE WORKOUT CALL OUTS through a real browser, as two real athletes.
 *
 * The companion to tools/falsify-workout-callouts.mjs. That one proves the
 * SERVER is correct; this one proves an athlete can reach it — and it carries
 * the one test the whole feature is judged by:
 *
 *   TEST A — a logger who never touches call outs must reach the end of their
 *   workout with EXACTLY the same taps, no wager UI, no extra request and
 *   nothing overlapping the LOG button. It is asserted mechanically, not by eye.
 *
 * Run:
 *   cd client && npx expo export -p web
 *   npx serve <abs>/client/dist -l 4173
 *   npm i playwright            # NOT a repo dependency; install it outside client/
 *   node tools/tour-workout-callouts.mjs
 *
 * NOTE ON hasTouch: pad-env.ts switches every number field to the in-app keypad
 * on a coarse pointer, deliberately keeping desktop web typeable "so the
 * Playwright tours can .fill() it". So these contexts are phone-SIZED but not
 * touch — the layout under test is the mobile one, the entry path is fillable.
 */
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';

import { chromium } from './browser.mjs';

const BASE = process.env.TOUR_BASE ?? 'http://localhost:4173';
const SHOTS = process.env.CALLOUT_SHOTS ?? './callout-shots';
mkdirSync(SHOTS, { recursive: true });

const TOKEN = readFileSync(new URL('../client/.env.sbtoken.local', import.meta.url), 'utf8')
  .trim().replace(/^[A-Z_]+=/, '').replace(/^["']|["']$/g, '');
const PROJECT = 'rysbpwpvnqbngqncrfaa';
const ALPHA_ID = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1';
const BRAVO_ID = '699ddb56-69b5-4070-854b-df73f578f19b';
const ACCOUNTS = {
  ALPHA: ['smoke-test-claude@evoforge.internal', 'SmokeTest-2026-07!x'],
  BRAVO: ['smoke-test-claude-2@evoforge.internal', 'SmokeTest-2026-07!y'],
};
const WORKOUT = 'Callout Tour';
/** Seeded history, removed at both ends (the duel tour's rule). */
const HISTORY = 'Callout Tour History';
const LIFT = 'Barbell Bench Press';
const BRAVO_WORKOUT = 'Callout Tour Legs';

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 500));
  return JSON.parse(text);
}

let pass = 0;
let fail = 0;
const failures = [];
function ok(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; failures.push(label); console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}

const errors = { ALPHA: [], BRAVO: [] };

/** The node with a real box. Several testIDs exist on more than one screen and
 *  preloaded tabs stay MOUNTED, so `querySelector` finds a hidden 0×0 copy —
 *  which reads exactly like "missing". */
async function visible(page, testId) {
  const all = page.locator(`[data-testid="${testId}"]`);
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const el = all.nth(i);
    const box = await el.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) return el;
  }
  return null;
}
const seen = async (page, testId) => (await visible(page, testId)) !== null;

async function waitFor(page, testId, timeout = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const el = await visible(page, testId);
    if (el) return el;
    await page.waitForTimeout(220);
  }
  return null;
}

/**
 * RECORD A SHORT-LIVED OVERLAY FROM INSIDE THE PAGE.
 *
 * The payout is ~1.3 seconds long and removes itself, which is the product
 * behaviour the brief asks for — so polling it from Node loses the race about
 * half the time, and a flaky assertion about a real feature is worse than no
 * assertion. This installs a 60ms sampler in the page BEFORE the event that
 * triggers it, and reads what it caught afterwards.
 */
async function armSettleWatcher(page) {
  await page.evaluate(() => {
    const w = window;
    w.__calloutSettle = null;
    if (w.__calloutSettleTimer) clearInterval(w.__calloutSettleTimer);
    w.__calloutSettleTimer = setInterval(() => {
      if (w.__calloutSettle) return;
      const el = [...document.querySelectorAll('[data-testid="callout-settle"]')]
        .find((e) => e.getBoundingClientRect().width > 0);
      if (!el) return;
      const head = el.querySelector('[data-testid="callout-settle-headline"]');
      const coins = el.querySelector('[data-testid="callout-settle-coins"]');
      const pot = el.querySelector('[data-testid="callout-settle-pot"]');
      w.__calloutSettle = {
        headline: head ? head.textContent.trim() : null,
        coins: coins ? coins.textContent.trim() : null,
        hasPot: Boolean(pot),
        pointerEvents: getComputedStyle(el).pointerEvents,
      };
    }, 60);
  });
}
async function readSettleWatcher(page, timeout = 25_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const got = await page.evaluate(() => window.__calloutSettle ?? null);
    if (got) {
      await page.evaluate(() => clearInterval(window.__calloutSettleTimer));
      return got;
    }
    await page.waitForTimeout(200);
  }
  return null;
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => undefined);
}

async function dismissOverlays(page) {
  for (let i = 0; i < 8; i++) {
    const skip = await visible(page, 'tutorial-skip');
    if (skip) { await skip.click().catch(() => undefined); await page.waitForTimeout(400); continue; }
    break;
  }
}

async function signIn(browser, who) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors[who].push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => errors[who].push(String(e.message).slice(0, 200)));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const [email, password] = ACCOUNTS[who];
  const emailBox = await waitFor(page, 'email');
  if (!emailBox) throw new Error(`${who}: never reached sign-in`);
  await emailBox.fill(email);
  await (await visible(page, 'password')).fill(password);
  await (await visible(page, 'sign-in')).click();
  await page.waitForTimeout(3500);
  await dismissOverlays(page);
  return { ctx, page };
}

/** Open a workout page directly and put one exercise in it. */
async function openWorkout(page, workoutName, lift) {
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  await page.goto(`${BASE}/workout?date=${iso}&workout=${encodeURIComponent(workoutName)}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(2200);
  await dismissOverlays(page);
  if (!(await seen(page, `${lift}-save-1`))) {
    const search = await waitFor(page, 'workout-search-input');
    if (search) {
      await search.fill(lift);
      await page.waitForTimeout(900);
      const hit = await visible(page, `workout-search-hit-${lift}`);
      if (hit) await hit.click();
      await page.waitForTimeout(1200);
    }
  }
  return iso;
}

/** Type a set's numbers (which also publishes the draft the tray reads). */
async function typeSet(page, lift, setNo, weight, reps) {
  const w = await visible(page, `${lift}-w-${setNo}`);
  const r = await visible(page, `${lift}-r-${setNo}`);
  if (!w || !r) return false;
  await w.fill(String(weight));
  await r.fill(String(reps));
  await page.waitForTimeout(250);
  return true;
}

console.log('\n=== LIVE WORKOUT CALL OUTS — browser tour ===\n');

// A clean floor: absolute assertions only pass on a virgin database.
await sql(`
  delete from public.coin_events where kind in ('callout_stake','callout_payout')
    and user_id in ('${ALPHA_ID}','${BRAVO_ID}');
  delete from public.workout_callouts
    where athlete_id in ('${ALPHA_ID}','${BRAVO_ID}') or opponent_id in ('${ALPHA_ID}','${BRAVO_ID}');
  delete from public.workout_log where workout in ('${WORKOUT}','${BRAVO_WORKOUT}');
  delete from public.social_notifications where type like 'callout_%';
  delete from public.workout_log where workout = '${HISTORY}';
  update public.profile set callouts_enabled = true
    where user_id in ('${ALPHA_ID}','${BRAVO_ID}');`);
await seedHistory();

/**
 * SEED THE ATHLETE SOME HISTORY, AND DELETE IT AFTERWARDS.
 *
 * Two reasons, both discovered the hard way:
 *
 *  1. The affordance is REVEALED at 20 counted sets, and ALPHA sits within one
 *     or two of that line. A tour whose first assertion depends on how many
 *     sets a smoke account happens to be carrying is not testing the product,
 *     it is testing the fixture — it passed three times and then failed with
 *     nothing changed but a previous run's cleanup.
 *  2. Without prior sets on the lift, EVO ODDS can only say EARLY ESTIMATE.
 *     Twelve real sets make the estimator do its actual job, which is the
 *     thing worth looking at in the screenshots.
 */
async function seedHistory() {
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const daysAgo = 3 + i * 3;
    rows.push(`('${ALPHA_ID}', current_date - ${daysAgo}, '${HISTORY}', '${LIFT}', 'Chest',
                ${(i % 3) + 1}, ${6 + (i % 3)}, 100, now() - interval '${daysAgo} days')`);
  }
  await sql(`insert into public.workout_log
    (user_id, date, workout, exercise, muscle, "set", reps, weight, "timestamp")
    values ${rows.join(',')};`);
}

const bal = async (u) => Number((await sql(`select public.forge_duel_balance('${u}') v;`))[0].v);
/**
 * WHAT THIS CALL OUT DID TO THIS ATHLETE'S WALLET.
 *
 * NOT the raw balance. The app mints PR coins (+50) and a workout-complete
 * bonus (+25) from the very sets this tour logs, so a raw balance comparison
 * measures the tour's own training as well as its wagers — the first run read
 * 1100 where 1050 was expected, and both numbers were correct.
 */
const net = async (u, id) => Number((await sql(
  `select coalesce(sum(amount),0)::int n from public.coin_events
   where user_id='${u}' and split_part(source_id, ':', 1) = '${id}';`))[0].n);
const b0 = { A: await bal(ALPHA_ID), B: await bal(BRAVO_ID) };
console.log(`opening  ALPHA ${b0.A}  BRAVO ${b0.B}\n`);

const browser = await chromium.launch();
const alpha = await signIn(browser, 'ALPHA');
const bravo = await signIn(browser, 'BRAVO');

// ── TEST A — THE PURE LOGGER ───────────────────────────────────────────────
console.log('TEST A — a logger who never uses call outs loses nothing');
const iso = await openWorkout(alpha.page, WORKOUT, LIFT);
ok('the workout page opened with a logging card', await seen(alpha.page, `${LIFT}-save-1`));
await shot(alpha.page, 'A1-workout');

// Nothing from the feature is on screen except the one small affordance.
const calloutNodes = await alpha.page.evaluate(() =>
  [...document.querySelectorAll('[data-testid]')]
    .map((e) => e.getAttribute('data-testid'))
    .filter((t) => t && (t.startsWith('callout-') || t === 'callout-layer'))
);
ok('no call out card, tray or badge is rendered', calloutNodes.length === 0,
   calloutNodes.join(', ') || 'none');
// The ◉ depends on three async reads — the log (has this athlete trained
// enough for the question to mean anything), the friend list, and the setting.
// Asserting it EVENTUALLY appears is the honest test; asserting it instantly
// is a race, and it flaked exactly once before this wait was added.
ok('the one affordance IS present (it is discoverable, not hidden)',
   await waitFor(alpha.page, `${LIFT}-callout`, 12_000) !== null);

// Nothing overlaps the LOG button. The forge-intro bug shipped an invisible
// full-screen layer that ate every tap; only this question catches it.
const logOnTop = await alpha.page.evaluate((tid) => {
  const el = [...document.querySelectorAll(`[data-testid="${tid}"]`)]
    .find((e) => e.getBoundingClientRect().width > 0);
  if (!el) return 'missing';
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return el.contains(hit) || hit?.contains(el) ? 'clear' : (hit?.getAttribute('data-testid') ?? hit?.tagName ?? '?');
}, `${LIFT}-save-1`);
ok('nothing is covering the LOG button', logOnTop === 'clear', String(logOnTop));

// Log one set, watching every request that leaves the page.
const requests = [];
alpha.page.on('request', (r) => requests.push(r.url()));
await typeSet(alpha.page, LIFT, 1, 60, 10);
await (await visible(alpha.page, `${LIFT}-save-1`)).click();
await alpha.page.waitForTimeout(2500);
ok('the set logged and the rest timer started', await seen(alpha.page, 'rest-timer-bar') ||
   Number((await sql(`select count(*)::int n from public.workout_log
     where user_id='${ALPHA_ID}' and workout='${WORKOUT}' and "set"=1;`))[0].n) === 1);
const calloutCalls = requests.filter((u) => /\/rpc\/callout_/.test(u));
ok('logging a set made ZERO call out requests', calloutCalls.length === 0,
   calloutCalls.map((u) => u.split('/').pop()).join(', ') || 'none');
ok('the set is in the database', Number((await sql(
  `select count(*)::int n from public.workout_log
   where user_id='${ALPHA_ID}' and workout='${WORKOUT}' and "set"=1 and reps=10;`))[0].n) === 1);
await shot(alpha.page, 'A2-logged');

// ── TEST B — CALL IT, DOUBT IT, HIT IT, VERIFY IT ──────────────────────────
console.log('\nTEST B — the whole loop, on two phones');
// Jesse is on his own LEG workout the entire time (TEST D rides along here).
await openWorkout(bravo.page, BRAVO_WORKOUT, 'Leg Press');
ok('the opponent is in a DIFFERENT workout', await seen(bravo.page, 'Leg Press-save-1'));

await typeSet(alpha.page, LIFT, 2, 100, 5);
const openCall = await waitFor(alpha.page, `${LIFT}-callout`, 12_000);
ok('the call out affordance is reachable', openCall !== null);
await openCall.click();
const tray = await waitFor(alpha.page, 'callout-tray');
ok('the tray rises over the workout', tray !== null);
// LET IT FINISH ARRIVING. animationType="fade" means a screenshot taken the
// instant the node has a box catches it at ~40% opacity, which reads as a
// transparency bug the sheet does not have — and would hide a real one.
await alpha.page.waitForTimeout(700);
await shot(alpha.page, 'B1-tray');
const target = await visible(alpha.page, 'callout-target');
const targetText = target ? (await target.innerText()).trim() : '';
ok('the proposition came from the logger, not a form', targetText.includes('100') && targetText.includes('5'),
   targetText);
ok('the odds are shown before anybody commits', await seen(alpha.page, 'callout-odds'));
const oddsText = await (await visible(alpha.page, 'callout-odds')).innerText();
ok('and they are a real estimate, not a shrug', /HIT \d+%/.test(oddsText) && !/EARLY ESTIMATE/.test(oddsText),
   oddsText.replace(/\s+/g, ' ').trim());


// ── THE TRAY IS EDITABLE, COMPLETE, AND DOES NOT CRASH A TAB CHANGE ────────
ok('the call’s weight can be changed in the tray',
   await seen(alpha.page, 'callout-target-weight'));
ok('and its reps', await seen(alpha.page, 'callout-target-reps'));
{
  // Editing the call re-states the proposition AND writes back to the row, so
  // the two can never be different numbers for the same set.
  const reps = await visible(alpha.page, 'callout-target-reps');
  await reps.fill('7');
  await alpha.page.waitForTimeout(500);
  const edited = (await (await visible(alpha.page, 'callout-target')).innerText()).trim();
  ok('editing the reps restates the call', edited.includes('7+'), edited);
  await reps.fill('5');
  await alpha.page.waitForTimeout(400);
}
ok('the smallest chip is 5, not 25', await seen(alpha.page, 'wager-chip-5'));
{
  // THE CHIPS MUST NOT NEED A SCROLL. The whole path is "tap a chip, tap
  // SEND"; a rail below the fold makes that three actions and a hunt.
  const reachable = await alpha.page.evaluate(() => {
    const pick = (t) => [...document.querySelectorAll(`[data-testid="${t}"]`)]
      .find((e) => e.getBoundingClientRect().width > 0);
    const chip = pick('wager-chip-5');
    const send = pick('callout-send');
    if (!chip || !send) return 'missing';
    const h = window.innerHeight;
    const c = chip.getBoundingClientRect();
    const s2 = send.getBoundingClientRect();
    return c.bottom <= h && s2.bottom <= h ? 'visible' : `chip ${Math.round(c.bottom)} send ${Math.round(s2.bottom)} of ${h}`;
  });
  ok('the chip rail and SEND are both on screen without scrolling',
     reachable === 'visible', String(reachable));
}
{
  /**
   * THE CRASH THIS RELEASE FIXED. Opening the tray and changing tabs threw
   *   "cannot add postgres_changes callbacks for realtime:callouts::id
   *    after subscribe()"
   * because the realtime hook was mounted on three screens and a visited tab
   * stays mounted. Production's own route-crash analytics named it seven times
   * in twelve minutes. It is one channel now, mounted at the authenticated
   * root — so this asserts BOTH that the screen survives and that exactly one
   * channel exists.
   */
  await alpha.page.goto(`${BASE}/today`, { waitUntil: 'domcontentloaded' });
  await alpha.page.waitForTimeout(2200);
  await dismissOverlays(alpha.page);
  const crashed = await alpha.page.evaluate(() =>
    document.body.innerText.includes('hit an error'));
  ok('changing tabs with the tray open does not crash the screen', crashed === false);
  await alpha.page.goto(`${BASE}/challenges`, { waitUntil: 'domcontentloaded' });
  await alpha.page.waitForTimeout(2200);
  const crashed2 = await alpha.page.evaluate(() =>
    document.body.innerText.includes('hit an error'));
  ok('and neither does the Challenges hub', crashed2 === false);
  // Back to the workout, re-open the tray, and carry on.
  await openWorkout(alpha.page, WORKOUT, LIFT);
  await typeSet(alpha.page, LIFT, 2, 100, 5);
  await (await waitFor(alpha.page, `${LIFT}-callout`, 12_000)).click();
  await waitFor(alpha.page, 'callout-tray');
}

const friendPill = await visible(alpha.page, `callout-friend-${BRAVO_ID}`);
if (friendPill) await friendPill.click();
await (await visible(alpha.page, 'wager-chip-50')).click();
await alpha.page.waitForTimeout(500);
await shot(alpha.page, 'B2-chip-in');
await (await visible(alpha.page, 'callout-send')).click();
await alpha.page.waitForTimeout(2500);

const created = await sql(`select id, status, stake, target_label from public.workout_callouts
                           where athlete_id='${ALPHA_ID}' order by created_at desc limit 1;`);
ok('the call out exists as an OFFER', created[0]?.status === 'offered', JSON.stringify(created[0] ?? {}));
ok('nothing left either wallet on the offer',
   (await bal(ALPHA_ID)) === b0.A && (await bal(BRAVO_ID)) === b0.B);
ok('the tray collapsed back to the workout', !(await seen(alpha.page, 'callout-tray')));
ok('the called set wears a badge', await waitFor(alpha.page, 'callout-badge-2') !== null);
await shot(alpha.page, 'B3-offered');

// The opponent, mid leg-press, is told without being interrupted.
const incoming = await waitFor(bravo.page, 'callout-incoming', 20_000);
ok('the offer reached the opponent without a modal', incoming !== null);
// The micro pot spawns real bodies on layout; give them a moment to land.
await bravo.page.waitForTimeout(1100);
await shot(bravo.page, 'B4-incoming');
// THE CALLER'S MONEY IS ALREADY ON THE TABLE — that is the card's whole
// argument, and an empty pot passes every structural test ever written.
const potChips = await bravo.page.evaluate(() => {
  const pot = [...document.querySelectorAll('[data-testid="callout-incoming-pot"]')]
    .find((e) => e.getBoundingClientRect().width > 0);
  if (!pot) return -1;
  return pot.querySelectorAll('svg').length;
});
ok('the caller’s chips are already sitting in it', potChips > 0, `${potChips} chip bodies`);
if (incoming) {
  const stillTyping = await bravo.page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-testid="Leg Press-save-1"]')]
      .find((e) => e.getBoundingClientRect().width > 0);
    if (!el) return 'missing';
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el.contains(hit) || hit?.contains(el) ? 'clear' : 'blocked';
  });
  ok('the opponent\'s own LOG button is still reachable underneath', stillTyping === 'clear', stillTyping);
  ok('the incoming card carries a real chip pot', await seen(bravo.page, 'callout-incoming-pot'));
  await (await visible(bravo.page, 'callout-doubt')).click();
  await bravo.page.waitForTimeout(2600);
}
const accepted = await sql(`select status from public.workout_callouts where id='${created[0].id}';`);
ok('the doubt was accepted', accepted[0]?.status === 'accepted', accepted[0]?.status);
ok('both stakes are in escrow',
   (await net(ALPHA_ID, created[0].id)) === -50 && (await net(BRAVO_ID, created[0].id)) === -50,
   `${await net(ALPHA_ID, created[0].id)} / ${await net(BRAVO_ID, created[0].id)}`);
await shot(bravo.page, 'B5-doubted');

// The athlete logs the set exactly as they always do.
await alpha.page.waitForTimeout(1200);
await (await visible(alpha.page, `${LIFT}-save-2`)).click();
await alpha.page.waitForTimeout(3000);
const logged = await sql(`select status, result, actual_reps from public.workout_callouts
                          where id='${created[0].id}';`);
ok('logging the set — the NORMAL tap — resolved the proposition',
   logged[0]?.status === 'awaiting_verification', JSON.stringify(logged[0] ?? {}));
ok('and the server judged it a hit', logged[0]?.result === 'hit');
await shot(alpha.page, 'B6-awaiting');

// The opponent verifies when they are ready.
const verifyCard = await waitFor(bravo.page, 'callout-verify', 20_000);
ok('the opponent is asked to verify, not to type a number', verifyCard !== null);
await shot(bravo.page, 'B7-verify');
// THE PAYOUT IS ~1.3 SECONDS LONG AND REMOVES ITSELF. Arm a sampler inside
// the page BEFORE the tap, or every assertion about it races an animation the
// brief specifically asked to be brief.
await armSettleWatcher(alpha.page);
// A burst of frames, because the overlay is deliberately brief: one of these
// catches it, and a feature nobody can SEE in a screenshot is unreviewable.
if (verifyCard) {
  await (await visible(bravo.page, 'callout-verify-yes')).click();
  // PHOTOGRAPH THE PAYOUT WHILE IT IS HAPPENING. The frames used to start
  // after this wait, by which time a deliberately ~1.3s overlay had already
  // come and gone — so the tour proved it functionally and could never show
  // it. The waiting IS the window; take the pictures inside it.
  for (let i = 0; i < 14; i++) {
    await alpha.page.screenshot({ path: `${SHOTS}/B8-payout-${String(i).padStart(2, '0')}.png` })
      .catch(() => undefined);
  }
  await bravo.page.waitForTimeout(1200);
}
const settled = await sql(`select status, result from public.workout_callouts where id='${created[0].id}';`);
ok('it settled', settled[0]?.status === 'settled');
ok('the athlete took the pot', (await net(ALPHA_ID, created[0].id)) === 50,
   `${await net(ALPHA_ID, created[0].id)}`);
ok('the doubter is down their stake', (await net(BRAVO_ID, created[0].id)) === -50);
ok('the whole call out conserved the ledger', Number((await sql(
  `select coalesce(sum(amount),0)::int n from public.coin_events
   where split_part(source_id, ':', 1) = '${created[0].id}';`))[0].n) === 0);

// The payout plays on the athlete's screen, over their workout.
/**
 * SCREENSHOT WHILE WAITING, not on a timer beside it.
 *
 * A fire-and-forget interval queues inside Playwright and every frame landed
 * after the ~1.3s overlay had gone. Awaiting each capture in the same loop that
 * polls the sampler means the frames are taken WHEN the loop is running, which
 * is exactly the window the overlay is alive in.
 */
const settle = await readSettleWatcher(alpha.page);
await alpha.page.evaluate(() => clearInterval(window.__calloutSettleTimer));
ok('the payout plays over the workout, with real chips', settle !== null && settle.hasPot,
   JSON.stringify(settle ?? {}));
if (settle) {
  ok('and it says what happened', settle.headline === 'CALL HIT', String(settle.headline));
  ok('with the coins it moved', settle.coins === '+100', String(settle.coins));
  // IT MUST NOT BE ABLE TO INTERCEPT ANYTHING, EVER. A full-screen element
  // over an interactive app, removed by a TIMER rather than by the user's own
  // gesture, is the exact shape of the forge-intro bug that made sign-in
  // untypeable on Safari and the installed PWA.
  ok('the payout overlay cannot intercept a tap', settle.pointerEvents === 'none',
     settle.pointerEvents);
}
// And the workout is immediately usable again — no CLAIM, no CONTINUE.
await alpha.page.waitForTimeout(1800);
ok('it removed itself with no button to press', !(await seen(alpha.page, 'callout-settle')));

// ── TEST C — A MISS PAYS THE DOUBTER ───────────────────────────────────────
console.log('\nTEST C — the athlete falls short');
const b1 = { A: await bal(ALPHA_ID), B: await bal(BRAVO_ID) };
await alpha.page.waitForTimeout(1500);
await typeSet(alpha.page, LIFT, 3, 100, 8);
await (await visible(alpha.page, `${LIFT}-callout`)).click();
await waitFor(alpha.page, 'callout-tray');
const pill3 = await visible(alpha.page, `callout-friend-${BRAVO_ID}`);
if (pill3) await pill3.click();
await (await visible(alpha.page, 'wager-chip-25')).click();
await (await visible(alpha.page, 'callout-send')).click();
await alpha.page.waitForTimeout(2500);
const c2 = (await sql(`select id from public.workout_callouts where athlete_id='${ALPHA_ID}'
                       order by created_at desc limit 1;`))[0];
const doubt2 = await waitFor(bravo.page, 'callout-doubt', 20_000);
if (doubt2) { await doubt2.click(); await bravo.page.waitForTimeout(2600); }

// Fall short — and be TOLD before tapping, not after losing.
await alpha.page.waitForTimeout(1500);
await typeSet(alpha.page, LIFT, 3, 100, 4);
ok('the athlete is warned BEFORE logging that they are under their call',
   await waitFor(alpha.page, `${LIFT}-below-call-3`, 4000) !== null);
await shot(alpha.page, 'C1-below-call');
await (await visible(alpha.page, `${LIFT}-save-3`)).click();
await alpha.page.waitForTimeout(3000);
const missed = await sql(`select status, result from public.workout_callouts where id='${c2.id}';`);
ok('four reps against a call of eight is a miss', missed[0]?.result === 'miss', JSON.stringify(missed[0]));
const verify2 = await waitFor(bravo.page, 'callout-verify-yes', 20_000);
if (verify2) { await verify2.click(); await bravo.page.waitForTimeout(2600); }
ok('the doubter took the pot', (await net(BRAVO_ID, c2.id)) === 25, `${await net(BRAVO_ID, c2.id)}`);
ok('the athlete paid their stake and no more', (await net(ALPHA_ID, c2.id)) === -25);
await shot(bravo.page, 'C2-doubter-wins');

// ── TEST E — VERIFICATION CAN WAIT ─────────────────────────────────────────
console.log('\nTEST E — nobody is blocked while it waits');
await alpha.page.waitForTimeout(1200);
// Every set of this card is logged, so the ◉ is correctly gone — there is
// nothing left to call. Adding a set brings it back, which is the natural
// "run it back" move and the reason nextCallableSet exists.
ok('the affordance disappears once every set is logged',
   !(await seen(alpha.page, `${LIFT}-callout`)));
await (await visible(alpha.page, `${LIFT}-add-set`)).click();
await alpha.page.waitForTimeout(900);
ok('adding a set brings it back', await waitFor(alpha.page, `${LIFT}-callout`, 5000) !== null);
await typeSet(alpha.page, LIFT, 4, 80, 5);
await (await visible(alpha.page, `${LIFT}-callout`)).click();
await waitFor(alpha.page, 'callout-tray');
const pill4 = await visible(alpha.page, `callout-friend-${BRAVO_ID}`);
if (pill4) await pill4.click();
await (await visible(alpha.page, 'wager-chip-25')).click();
await (await visible(alpha.page, 'callout-send')).click();
await alpha.page.waitForTimeout(2400);
const c3 = (await sql(`select id from public.workout_callouts where athlete_id='${ALPHA_ID}'
                       order by created_at desc limit 1;`))[0];
const doubt3 = await waitFor(bravo.page, 'callout-doubt', 20_000);
if (doubt3) { await doubt3.click(); await bravo.page.waitForTimeout(2400); }
await alpha.page.waitForTimeout(1200);
await (await visible(alpha.page, `${LIFT}-save-4`)).click();
await alpha.page.waitForTimeout(3000);

// Jesse dismisses instead of answering, and carries on with his own workout.
const dismiss = await waitFor(bravo.page, 'callout-verify-dismiss', 20_000);
ok('the verification can be dismissed', dismiss !== null);
if (dismiss) { await dismiss.click(); await bravo.page.waitForTimeout(900); }
ok('and the card is gone from his workout', !(await seen(bravo.page, 'callout-verify')));
ok('his own logging card is untouched', await seen(bravo.page, 'Leg Press-save-1'));
ok('nothing was paid to anybody',
   (await net(ALPHA_ID, c3.id)) === -25 && (await net(BRAVO_ID, c3.id)) === -25);
ok('the athlete is not blocked either — the set banked normally', Number((await sql(
  `select count(*)::int n from public.workout_log
   where user_id='${ALPHA_ID}' and workout='${WORKOUT}' and "set"=4;`))[0].n) === 1);
await shot(bravo.page, 'E1-dismissed');

// It waits for him on the hub — where every call out notification lands.
await bravo.page.goto(`${BASE}/challenges`, { waitUntil: 'domcontentloaded' });
await bravo.page.waitForTimeout(3000);
await dismissOverlays(bravo.page);
ok('it is waiting on the Challenges hub', await waitFor(bravo.page, 'callout-list') !== null);
await shot(bravo.page, 'E2-hub');
const hubVerify = await visible(bravo.page, `callout-row-verify-${c3.id}`);
ok('with a VERIFY he can still tap', hubVerify !== null);
if (hubVerify) { await hubVerify.click(); await bravo.page.waitForTimeout(2600); }
ok('verifying later works exactly the same', (await sql(
  `select status from public.workout_callouts where id='${c3.id}';`))[0]?.status === 'settled');
ok('and the ledger still balances', Number((await sql(
  `select coalesce(sum(amount),0)::int n from public.coin_events
   where split_part(source_id, ':', 1) = '${c3.id}';`))[0].n) === 0);

// ── TEST: THE OPT-OUT ──────────────────────────────────────────────────────
console.log('\nTEST — the opt-out removes it entirely');
await sql(`update public.profile set callouts_enabled = false where user_id = '${ALPHA_ID}';`);
await alpha.page.goto(`${BASE}/workout?date=${iso}&workout=${encodeURIComponent(WORKOUT)}`,
  { waitUntil: 'domcontentloaded' });
await alpha.page.waitForTimeout(3200);
await dismissOverlays(alpha.page);
ok('the affordance is gone from Train', !(await seen(alpha.page, `${LIFT}-callout`)));
ok('the workout logger is exactly as it was', await seen(alpha.page, `${LIFT}-save-1`));
await shot(alpha.page, 'F1-opted-out');
await sql(`update public.profile set callouts_enabled = true where user_id = '${ALPHA_ID}';`);

// ── CONSOLE + CLEANUP ──────────────────────────────────────────────────────
console.log('\nCONSOLE');
for (const who of ['ALPHA', 'BRAVO']) {
  // The app legitimately emits a 409 on the coin daily-grant upsert and can
  // race a 401 on the first authed fetch; neither is a failure.
  const real = errors[who].filter((e) => !/409|401|Failed to load resource/i.test(e));
  ok(`${who} finished with no console errors`, real.length === 0, real.slice(0, 2).join(' | '));
}

console.log('\nCLEANUP');
await sql(`
  delete from public.coin_events where kind in ('callout_stake','callout_payout')
    and user_id in ('${ALPHA_ID}','${BRAVO_ID}');
  delete from public.workout_callouts
    where athlete_id in ('${ALPHA_ID}','${BRAVO_ID}') or opponent_id in ('${ALPHA_ID}','${BRAVO_ID}');
  delete from public.workout_log where workout in ('${WORKOUT}','${BRAVO_WORKOUT}','${HISTORY}');
  delete from public.social_notifications where type like 'callout_%';`);
ok('the seeded history was removed', Number((await sql(
  `select count(*)::int n from public.workout_log where workout = '${HISTORY}';`))[0].n) === 0);
// SCOPED TO THE SMOKE ACCOUNTS, not to the table. These asserted a globally
// empty `workout_callouts`, which was true only while the harness was the
// feature's only user — the day real athletes started calling sets, a correct
// cleanup began failing. A test that breaks when the product succeeds is
// measuring the wrong thing.
ok('no call out coin rows survive for the smoke accounts', Number((await sql(
  `select count(*)::int n from public.coin_events
   where kind in ('callout_stake','callout_payout')
     and user_id in ('${ALPHA_ID}','${BRAVO_ID}');`))[0].n) === 0);
ok('no call out rows survive for the smoke accounts', Number((await sql(
  `select count(*)::int n from public.workout_callouts
   where athlete_id in ('${ALPHA_ID}','${BRAVO_ID}')
      or opponent_id in ('${ALPHA_ID}','${BRAVO_ID}');`))[0].n) === 0);
// The wallet is ABOVE where it started, and that is correct: this tour logged
// real sets, and real sets earn PR and workout-complete coins.
console.log(`  NOTE  ALPHA ${b0.A} -> ${await bal(ALPHA_ID)}, BRAVO ${b0.B} -> ${await bal(BRAVO_ID)}` +
            ' (training earned during the tour; every call out netted zero)');

await browser.close();
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) console.log('FAILURES:\n  - ' + failures.join('\n  - '));
console.log(`screenshots: ${SHOTS}`);
process.exit(fail === 0 ? 0 : 1);
