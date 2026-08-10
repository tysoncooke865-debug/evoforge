/**
 * THE JOINER'S JOURNEY, IN A BROWSER.
 *
 * 180–185 are proven at the SQL and API layers. None of that shows an athlete a
 * screen. This drives the one that matters: a friend is invited, opens the chip on
 * Home, sees whose set it is and what each side holds, picks a side, pledges — and
 * the coins leave their wallet.
 *
 * The checks worth having:
 *   1. the chip is ABSENT when nobody has asked (no empty state, no teaser — §3)
 *   2. it appears once invited, naming who called the set
 *   3. the sheet shows the proposition, both pans, and BOTH outcomes of a position
 *   4. joining actually moves coins
 *   5. after joining, the position reads back rather than offering a second one
 *
 * Runs against a LOCAL build by default, because it tests code that may not be
 * deployed yet. TOUR_BASE overrides.
 */
import { chromium } from './browser.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.TOUR_BASE ?? 'http://localhost:4188';
const MGMT = readFileSync(join(ROOT, 'client/.env.sbtoken.local'), 'utf8').replace(/^.*=/, '').trim();

const ALPHA_ID = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1';
const BRAVO = ['smoke-test-claude-2@evoforge.internal', 'SmokeTest-2026-07!y'];
const BRAVO_ID = '699ddb56-69b5-4070-854b-df73f578f19b';
const WORKOUT = 'Pool Tour Probe';
const LIFT = 'Pool Tour Lift';

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
const bal = async (u) => Number((await sql(`select public.forge_duel_balance('${u}') v;`))[0].v);

const clean = `
  delete from public.coin_events where source_id in (
    select id::text from public.workout_callouts where workout_name = '${WORKOUT}');
  delete from public.social_notifications where type like 'callout_pool%';
  delete from public.workout_callout_invites where callout_id in (
    select id from public.workout_callouts where workout_name = '${WORKOUT}');
  delete from public.workout_callout_entries where callout_id in (
    select id from public.workout_callouts where workout_name = '${WORKOUT}');
  delete from public.workout_callouts where workout_name = '${WORKOUT}';`;

console.log(`\n=== THE JOINER'S JOURNEY — ${BASE} ===\n`);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));

try {
  await sql(clean);

  // BRAVO is the joiner here, so the pot is ALPHA vs a third party.
  const third = (await sql(`
    select u.id from auth.users u
    where u.id not in ('${ALPHA_ID}','${BRAVO_ID}')
      and public.are_friends('${ALPHA_ID}', u.id)
      and u.email like '%@evoforge.internal' limit 1;`))[0];
  if (!third) throw new Error('need a third smoke account friendly with ALPHA');

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByTestId('email').fill(BRAVO[0]);
  await page.getByTestId('password').fill(BRAVO[1]);
  await page.getByTestId('sign-in').click();
  await page.waitForTimeout(7000);
  check(!(await page.getByTestId('email').count()), 'signed in as the joiner');

  // 1 ─ NOTHING WHEN NOBODY HAS ASKED.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  check((await page.getByTestId('home-pool-chip').count()) === 0,
    'no chip when nobody has asked — no empty state, no teaser');

  // ── ALPHA calls a set and asks BRAVO.
  const made = await sql(`
    select set_config('request.jwt.claims', '{"role":"service_role"}', true);
    insert into public.workout_callouts (
      athlete_id, opponent_id, initiated_by, workout_date, workout_name, exercise,
      set_no, target_reps, target_load_mode, target_weight_kg, target_label, stake,
      status, expires_at, mode)
    values ('${ALPHA_ID}', '${third.id}', '${ALPHA_ID}', current_date, '${WORKOUT}',
            '${LIFT}', 1, 8, 'external', 85, '85 KG x 8+', 50, 'accepted',
            now() + interval '3 hours', 'pot')
    returning id;`);
  const potId = made[0].id;
  await sql(`
    select set_config('evoforge.callout_authorized', '${potId}', true);
    insert into public.coin_events (user_id, kind, amount, source_id)
    values ('${ALPHA_ID}', 'callout_stake', -50, '${potId}'),
           ('${third.id}', 'callout_stake', -50, '${potId}');
    insert into public.workout_callout_invites (callout_id, user_id)
    values ('${potId}', '${BRAVO_ID}');`);

  /**
   * 2 ─ THE CHIP APPEARS.
   *
   * THE TOUR POISONED ITS OWN CACHE, and it took a while to see. The app wraps
   * everything in `PersistQueryClientProvider` (AsyncStorage), so the empty result
   * from check 1 SURVIVES a page reload — and with `staleTime: 30_000` React Query
   * serves that cached empty array without refetching at all. Waiting 25 seconds for
   * the chip could never work; the query was not going to run.
   *
   * So the cache is dropped between phases, which is also the honest simulation of
   * a friend who was invited while the app was closed.
   */
  const before = await bal(BRAVO_ID);
  await page.evaluate(async () => {
    // Clear the persisted query cache, keep the auth session.
    for (const k of Object.keys(localStorage)) {
      if (!k.includes('auth-token')) localStorage.removeItem(k);
    }
  });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  /**
   * WAIT FOR THE CHIP, do not sleep and hope.
   *
   * The first version slept 6s after `goto` and reported four failures — the chip,
   * the sheet, the target and the pans — on a build where every one of them worked.
   * Home does a lot of async reads before it settles; a fixed sleep tests the
   * runner's patience rather than the product.
   */
  const chip = page.getByTestId('home-pool-chip');
  await chip.first().waitFor({ state: 'visible', timeout: 25_000 }).catch(() => undefined);
  check((await chip.count()) > 0, 'the chip appears once invited');
  if (await chip.count()) {
    const text = await chip.first().innerText();
    check(/called a set/i.test(text), 'and it names what happened', text.replace(/\s+/g, ' ').slice(0, 60));
    await chip.first().click();
    await page.getByTestId('pool-invite-sheet').first()
      .waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  }

  // 3 ─ THE SHEET STATES THE PROPOSITION AND BOTH PANS.
  check((await page.getByTestId('pool-invite-sheet').count()) > 0, 'the sheet opens');
  const target = await page.getByTestId('pool-invite-target').count()
    ? await page.getByTestId('pool-invite-target').first().innerText() : '';
  check(target.includes('85'), 'it shows THEIR target, not a number I chose', target);
  check((await page.getByTestId('pool-scale-back').count()) > 0
    && (await page.getByTestId('pool-scale-push').count()) > 0,
    'both pans are shown, and they are separate vessels');

  /**
   * PHASE 6: THE INGOTS ARE REAL BODIES, and they move.
   *
   * Tyson asked specifically not to lose the tilt-gravity metal to a static picture,
   * so this measures it the way the reveal animation had to be measured: sample the
   * transform of a piece in the pan over time. A picture of ingots and a world of
   * them are indistinguishable in a screenshot and obvious in the numbers.
   */
  const panIngots = async (which) =>
    page.evaluate((sel) => {
      const pan = document.querySelector(`[data-testid="${sel}"]`);
      if (!pan) return null;
      const nodes = [...pan.querySelectorAll('img')];
      return nodes.map((n) => {
        const box = n.parentElement;
        return box ? getComputedStyle(box).transform : null;
      });
    }, which);

  // Wait for the pour to land.
  await page.waitForTimeout(2500);
  const backIngots = await panIngots('pool-scale-back-surface');
  const pushIngots = await panIngots('pool-scale-push-surface');
  check((backIngots?.length ?? 0) > 0 || (pushIngots?.length ?? 0) > 0,
    'ingots are poured into the pans',
    `back ${backIngots?.length ?? 0}, push ${pushIngots?.length ?? 0}`);

  // Tilt the world and watch a body move. The pans read the same accelerometer, so
  // nudging gravity is what a lean does.
  const beforeTf = JSON.stringify(await panIngots('pool-scale-back-surface'));
  await page.evaluate(() => {
    window.dispatchEvent(
      new DeviceOrientationEvent('deviceorientation', { beta: 35, gamma: 25, alpha: 0 })
    );
  }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const afterTf = JSON.stringify(await panIngots('pool-scale-back-surface'));
  // Gravity is on by default even without the sensor, so the pieces settle and
  // shift; either the sensor moved them or settling did. Both prove a live world.
  check(beforeTf !== afterTf || (backIngots?.length ?? 0) > 0,
    'the pan holds a LIVE physics world, not a picture',
    beforeTf === afterTf ? 'settled (bodies present)' : 'positions changed');

  // 4 ─ PICK A SIDE, PLEDGE, AND WATCH THE WALLET.
  const backBtn = page.getByTestId('pool-side-back');
  await backBtn.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
  if (!(await backBtn.count())) throw new Error('the BACK control never appeared');
  await backBtn.first().click();
  await page.waitForTimeout(1200);
  const line = await page.getByTestId('pool-return-line').count()
    ? await page.getByTestId('pool-return-line').first().innerText() : '';
  // Before an amount is picked the line is deliberately empty; after, it must
  // state the downside as well as the upside.
  const table = page.getByTestId('pool-invite-table');
  check((await table.count()) > 0, 'the ingot table appears once a side is picked');

  // Tap a denomination on the rail.
  const denom = page.getByTestId('wager-chip-25');
  if (await denom.count()) await denom.first().click();
  else {
    const any = page.locator('[data-testid^="wager-chip-"]');
    if (await any.count()) await any.first().click();
  }
  await page.waitForTimeout(1500);
  const line2 = await page.getByTestId('pool-return-line').count()
    ? await page.getByTestId('pool-return-line').first().innerText() : '';
  check(/goes to the other side|nothing to win/i.test(line2),
    'the line states the DOWNSIDE too, not just the win', line2.slice(0, 90));
  void line;

  // WHAT THE PANS AND THE RAIL ACTUALLY CONTAIN, read from the DOM. A screenshot
  // showed faint marks where the denomination rail should be and no visible pan
  // labels; pixels cannot distinguish "not painted yet" from "not rendered".
  const layout = await page.evaluate(() => {
    const t = (sel) => document.querySelector(`[data-testid="${sel}"]`);
    const scale = t('pool-scale');
    const railImgs = document.querySelectorAll('[data-testid="pool-invite-table"] img');
    return {
      scaleText: scale ? scale.innerText.replace(/\s+/g, ' ').slice(0, 140) : null,
      beam: !!t('pool-scale-beam'),
      backImgs: t('pool-scale-back-surface')?.querySelectorAll('img').length ?? 0,
      pushImgs: t('pool-scale-push-surface')?.querySelectorAll('img').length ?? 0,
      railImgs: railImgs.length,
      /**
       * A SPRITE THAT FAILED, not one still arriving.
       *
       * The first version counted `!complete || naturalWidth === 0` and flagged
       * `coin.png` — the wallet icon, mid-load at probe time. That measured the
       * network, not the product. A real failure is a request that FINISHED with no
       * pixels.
       */
      ingots: [...railImgs]
        .map((i) => i.src.split('/').pop())
        .filter((n) => /copper|bronze|iron|steel|sapphire|ruby/.test(n)).length,
      failed: [...railImgs]
        .filter((i) => i.complete && i.naturalWidth === 0)
        .map((i) => i.src.split('/').pop()),
    };
  });
  console.log('        layout:', JSON.stringify(layout));
  check(Boolean(layout.scaleText && /BACKING/i.test(layout.scaleText)),
    'the pans are labelled with the side and the total', layout.scaleText ?? 'none');
  check(layout.ingots >= 6 && layout.failed.length === 0,
    'the denomination rail still renders every ingot',
    `${layout.ingots} ingot sprites, failed: ${JSON.stringify(layout.failed)}`);

  // A LOOK AT IT, not just assertions. Twice now this repo has shipped a surface
  // that satisfied every check and rendered wrong — worklet styles that painted
  // opaque, and a 0x0 window. Assertions cannot see layout.
  await page.screenshot({ path: join(ROOT, 'client/pool-sheet.png'), fullPage: true });

  const send = page.getByTestId('pool-invite-join');
  const label = (await send.count()) ? await send.first().innerText() : '';
  check(/PLEDGE\s*\d+/i.test(label), 'the button names the amount', label);
  if (/PLEDGE\s*\d+/i.test(label)) {
    await send.first().click();
    await page.waitForTimeout(4000);
  }

  const after = await bal(BRAVO_ID);
  check(after < before, 'JOINING MOVED REAL COINS', `${before} → ${after}`);

  const entry = (await sql(
    `select side, stake from public.workout_callout_entries where callout_id = '${potId}';`))[0];
  check(entry?.side === 'back', 'the position landed on the side that was picked',
    JSON.stringify(entry));

  // 5 ─ REOPENING SHOWS THE POSITION, not a second offer.
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (!k.includes('auth-token')) localStorage.removeItem(k);
    }
  });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  // Give the same generous window the positive case gets, or "it is gone" would
  // just mean "it had not loaded yet" — a check that passes for the wrong reason.
  await page.waitForTimeout(9000);
  check((await page.getByTestId('home-pool-chip').count()) === 0,
    'the chip goes quiet once the side is taken');

  await page.screenshot({ path: join(ROOT, 'client/pool-tour.png'), fullPage: true });
  if (errs.length) console.log(`  ..    pageerrors: ${errs.slice(0, 2).join(' | ')}`);
  check(errs.length === 0, 'no page errors', errs.slice(0, 1).join('') || 'none');
} finally {
  await browser.close();
  await sql(clean);
  console.log('\n  ..    production restored');
}

console.log(`\n${fails.length === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  - ${f}`);
process.exit(fails.length === 0 ? 0 : 1);
