/**
 * DOES AN ADDED EXERCISE GET A GOLDEN DOT, ON THE REAL SITE?
 *
 * Reported from production twice today: a mate added an exercise and the yellow
 * pledge affordance was not there. `trialEligibility` refused `added` outright;
 * b13bca7 removed that rule. The unit test proves the function, and the bundle
 * check proves the string is gone from the deploy — NEITHER proves an athlete
 * sees a dot, which is the actual claim.
 *
 * So this drives the deployed site: sign in, open today's workout, add an
 * exercise through the picker exactly as an athlete would, and look for
 * `<exercise>-callout` in the DOM.
 *
 * It also checks the dot on a PLANNED exercise in the same pass. If both are
 * missing, the cause is upstream of the fix (the reveal gate, the pref, the
 * friend list) and I would otherwise have blamed the wrong thing.
 *
 * TOUR_BASE overrides the target; it defaults to production because a stale
 * PWA shell is one of the two live hypotheses and only the real host can show it.
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
const WORKOUT = 'Adhoc Dot Probe';
// Real catalog names. My first pass used 'Bench Press' / 'Cable Fly', which the
// catalog does not contain, and 'Adhoc Dot Probe' is not a template so it has no
// planned exercises at all — both PLANNED and ADDED are added here, and the
// control is simply the FIRST one, which was already proven to work before today.
const FIRST = 'Barbell Bench Press';
const ADDED = 'Cable Chest Fly';

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

const iso = new Date().toISOString().slice(0, 10);
const dow = new Date().getDay();

console.log(`\n=== THE GOLDEN DOT ON AN ADDED EXERCISE — ${BASE} ===\n`);

// ALPHA needs today to be a training day naming this workout, and enough
// counted sets to be past the 20-set reveal.
await sql(`
  insert into public.workout_schedule (user_id, plan, effective_from)
  values ('${ALPHA_ID}', jsonb_build_object('${dow}', '${WORKOUT}'::text), current_date)
  on conflict (user_id, effective_from) do update
    set plan = public.workout_schedule.plan || jsonb_build_object('${dow}', '${WORKOUT}'::text);`);

const gates = (await sql(`
  select (select count(*) from public.workout_log where user_id='${ALPHA_ID}' and reps>0) sets,
         (select count(*) from public.friendships where user_a='${ALPHA_ID}' or user_b='${ALPHA_ID}') friends,
         public.scheduled_workouts_on('${ALPHA_ID}', current_date) today;`))[0];
console.log(`  ..    ALPHA: ${gates.sets} counted sets, ${gates.friends} friend rows, today ${JSON.stringify(gates.today)}\n`);
check(Number(gates.sets) >= 20, 'past the 20-set reveal', String(gates.sets));
check(Number(gates.friends) >= 1, 'has at least one friend', String(gates.friends));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const bad = [];
page.on('console', (m) => { if (m.type() === 'error') bad.push(m.text().slice(0, 160)); });

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // Which bundle is this browser actually running? The stale-shell hypothesis
  // is only answerable from inside a real page load.
  const entry = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[src]'))
      .map((s) => s.src.match(/entry-([a-f0-9]+)\.js/)?.[1]).find(Boolean) ?? null);
  console.log(`  ..    running entry-${entry}\n`);

  // testIDs are 'email' / 'password' / 'sign-in' — the same ones
  // tour-workout-callouts.mjs uses. My first guess at signin-* silently filled
  // nothing and the tour then reported four failures on a sign-in screen.
  const email = page.getByTestId('email');
  if (await email.count()) {
    await email.fill(ALPHA[0]);
    await page.getByTestId('password').fill(ALPHA[1]);
    await page.getByTestId('sign-in').click();
    await page.waitForTimeout(6000);
  } else {
    throw new Error('never reached the sign-in form');
  }
  if (await page.getByTestId('email').count()) {
    throw new Error('still on sign-in after submitting');
  }

  await page.goto(`${BASE}/workout?date=${iso}&workout=${encodeURIComponent(WORKOUT)}`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  /** Add one exercise through the picker, the way an athlete does: search, then
   *  the row's own + button (`pick-<name>`), then close. */
  const addExercise = async (name, shot) => {
    const add = page.getByTestId('add-exercise');
    if (!(await add.count())) return false;
    await add.click();
    await page.waitForTimeout(2500);
    const search = page.getByTestId('picker-search');
    if (await search.count()) {
      await search.fill(name);
      await page.waitForTimeout(2000);
    }
    const row = page.getByTestId(`pick-${name}`);
    const found = await row.count();
    if (found) await row.first().click();
    await page.waitForTimeout(1200);
    if (shot) await page.screenshot({ path: join(ROOT, shot), fullPage: true });
    const selected = page.getByTestId('picker-add-selected');
    if (await selected.count()) { await selected.first().click(); await page.waitForTimeout(2500); }
    else {
      const close = page.getByTestId('picker-close');
      if (await close.count()) { await close.first().click(); await page.waitForTimeout(2000); }
    }
    return Boolean(found);
  };

  check(await addExercise(FIRST, 'client/adhoc-2-picker.png'), `${FIRST} is in the catalog`);
  await page.waitForTimeout(2000);
  const firstDot = await page.getByTestId(`${FIRST}-callout`).count();
  check(firstDot > 0, `the added ${FIRST} shows a dot`, `${firstDot} node(s)`);

  check(await addExercise(ADDED, null), `${ADDED} is in the catalog`);
  await page.waitForTimeout(2000);
  const addedDot = await page.getByTestId(`${ADDED}-callout`).count();
  check(addedDot > 0, `THE ADDED ${ADDED} SHOWS A DOT`, `${addedDot} node(s)`);

  await page.screenshot({ path: join(ROOT, 'client/adhoc-dot.png'), fullPage: true });
  console.log('\n  ..    screenshot: client/adhoc-dot.png');
  if (bad.length) console.log(`  ..    console errors: ${bad.slice(0, 3).join(' | ')}`);
} finally {
  await browser.close();
  await sql(`
    delete from public.workout_log where user_id='${ALPHA_ID}' and workout='${WORKOUT}';
    update public.workout_schedule set plan = plan - '${dow}'
      where user_id='${ALPHA_ID}' and effective_from=current_date
        and plan ->> '${dow}' = '${WORKOUT}';
    delete from public.workout_schedule
      where user_id='${ALPHA_ID}' and effective_from=current_date and plan='{}'::jsonb;`);
  console.log('  ..    production restored');
}

console.log(`\n${fails.length === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  - ${f}`);
process.exit(fails.length === 0 ? 0 : 1);
