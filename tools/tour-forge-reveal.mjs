/**
 * DOES THE REVEAL ACTUALLY ANIMATE? (Tyson: "I dont think it plays the animations
 * properly".)
 *
 * The sheet is meant to pour an ingot: it falls for a FIXED 900ms, rotates, squashes
 * slightly, and the mould glows as it lands. Reading the source proves the code
 * exists. It does not prove a single pixel moves, and there are at least four ways
 * for this one to be still while looking correct:
 *
 *   - Reanimated's `useReducedMotion()` is true (iOS Reduce Motion, or the browser's
 *     prefers-reduced-motion), which SKIPS the ceremony by design
 *   - `perfMode` in settings does the same
 *   - a worklet style that never commits inside a Modal on web
 *   - the stage jumping straight to 'settled'
 *
 * So this measures. It grants a reveal, opens the sheet, clicks CLAIM, and samples
 * the ingot's computed transform every ~80ms through the fall. A still ingot and a
 * falling one are then distinguishable by data rather than by opinion.
 *
 * It runs the check TWICE: once normally, and once with prefers-reduced-motion
 * forced on — which must skip the ceremony and land on the outcome immediately.
 * Both are correct behaviours; only one of them is a bug if it happens by default.
 */
import { chromium } from './browser.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.TOUR_BASE ?? 'https://evoforge.pages.dev';
const MGMT = readFileSync(join(ROOT, 'client/.env.sbtoken.local'), 'utf8').replace(/^.*=/, '').trim();
const ALPHA_ID = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1';
const ALPHA = ['smoke-test-claude@evoforge.internal', 'SmokeTest-2026-07!x'];

let pass = 0;
const fails = [];
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

async function sql(query) {
  const r = await fetch('https://api.supabase.com/v1/projects/rysbpwpvnqbngqncrfaa/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${JSON.stringify(b).slice(0, 300)}`);
  return b;
}

const clean = `delete from public.forge_reveals where user_id = '${ALPHA_ID}' and source_id like 'tour-%';`;

/** Put one unclaimed reveal in ALPHA's bank. */
async function grantOne(tag) {
  await sql(`select public.forge_reveal_grant(
    '${ALPHA_ID}', 'workout_complete', 'tour-${tag}', current_date, null);`);
  const n = Number((await sql(`select count(*) n from public.forge_reveals
    where user_id='${ALPHA_ID}' and source_id='tour-${tag}' and claimed_at is null;`))[0].n);
  return n;
}

async function run(reducedMotion) {
  const label = reducedMotion ? 'REDUCE MOTION ON' : 'NORMAL';
  console.log(`\n--- ${label} ---`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const email = page.getByTestId('email');
    if (await email.count()) {
      await email.fill(ALPHA[0]);
      await page.getByTestId('password').fill(ALPHA[1]);
      await page.getByTestId('sign-in').click();
      await page.waitForTimeout(6000);
    }
    check(!(await page.getByTestId('email').count()), `${label}: signed in`);

    // What Reanimated itself believes, from inside the page.
    const prefers = await page.evaluate(() =>
      window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    console.log(`        prefers-reduced-motion: ${prefers}`);

    // The chip lives on Home.
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    const chip = page.getByTestId('home-reveal-chip');
    const chipCount = await chip.count();
    if (!chipCount) {
      // Fall back to any control that opens the sheet.
      const anyOpen = await page.getByText('OPEN', { exact: false }).count();
      check(false, `${label}: the reveal chip is on Home`, `chip=0, "OPEN" nodes=${anyOpen}`);
      await page.screenshot({ path: join(ROOT, `client/reveal-${reducedMotion ? 'rm' : 'n'}-home.png`), fullPage: true });
      return;
    }
    check(true, `${label}: the reveal chip is on Home`);
    await chip.first().click();
    await page.waitForTimeout(2000);

    check(await page.getByTestId('reveal-sheet').count() > 0, `${label}: the sheet opened`);
    check(await page.getByTestId('reveal-drop-table').count() > 0,
      `${label}: the drop table is shown BEFORE the claim (§3)`);

    // CLAIM, then sample the ingot's transform through the fall.
    const samples = [];
    const sampler = (async () => {
      for (let i = 0; i < 16; i++) {
        const t = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="reveal-ingot"]');
          if (!el) return null;
          return getComputedStyle(el).transform;
        }).catch(() => null);
        samples.push(t);
        await page.waitForTimeout(80);
      }
    })();

    await page.getByTestId('reveal-claim').click();
    await sampler;

    const seen = samples.filter(Boolean);
    const distinct = new Set(seen);
    console.log(`        ${seen.length} samples, ${distinct.size} distinct transform(s)`);
    console.log(`        first: ${[...distinct][0] ?? '(none)'}`);
    console.log(`        last:  ${[...distinct][distinct.size - 1] ?? '(none)'}`);

    if (reducedMotion) {
      // Correct behaviour: no ceremony at all, straight to the number.
      check(distinct.size <= 2, `${label}: the ceremony is skipped, as designed`,
        `${distinct.size} distinct transforms`);
    } else {
      check(seen.length > 0, `${label}: the ingot is on screen during the fall`,
        `${seen.length} samples`);
      check(distinct.size >= 3, `${label}: THE INGOT ACTUALLY MOVES`,
        `${distinct.size} distinct transforms — 1 means it is frozen`);
    }

    await page.waitForTimeout(1600);
    const outcome = await page.getByTestId('reveal-outcome').count();
    check(outcome > 0, `${label}: it settles on an outcome`);
    await page.screenshot({ path: join(ROOT, `client/reveal-${reducedMotion ? 'rm' : 'n'}-settled.png`), fullPage: true });
  } finally {
    await browser.close();
  }
}

console.log(`\n=== FORGE REVEAL — does it animate? (${BASE}) ===`);
try {
  await sql(clean);
  const a = await grantOne('a');
  console.log(`\n  ..    granted ${a} reveal for the normal run`);
  await run(false);
  await sql(clean);
  const b = await grantOne('b');
  console.log(`\n  ..    granted ${b} reveal for the reduced-motion run`);
  await run(true);
} finally {
  await sql(clean);
  console.log('\n  ..    production restored');
}

console.log(`\n${fails.length === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  - ${f}`);
process.exit(fails.length === 0 ? 0 : 1);
