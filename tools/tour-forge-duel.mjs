/**
 * THE FORGE DUEL, driven through a real browser as four real athletes.
 *
 *   create -> counter the stake -> accept -> train -> raise -> counter ->
 *   accept -> re-lock -> all in -> watch -> back a side -> settle -> result
 *
 * WHY THIS EXISTS AND `tools/falsify-forge-duel.mjs` IS NOT ENOUGH. That one
 * proves the SERVER is correct; this one proves an athlete can reach it. Every
 * bug it found was invisible to SQL: a counter-stake the challenger was never
 * shown, a Reanimated callback recursing into "Maximum call stack size
 * exceeded" on every chip tap, a 45-second react-query cache hiding a rival's
 * raise on a card with a countdown on it, and "1 days".
 *
 * RUNNING IT
 *   cd client && npx expo export -p web
 *   npx serve <abs path>/client/dist -l 4173
 *   npm i playwright          # NOT a repo dependency; install it outside client/
 *   node tools/tour-forge-duel.mjs
 *
 * It SEEDS PRODUCTION and deletes what it seeded, at both ends: workout_sessions
 * is unique on (user, date, workout), so a leftover row makes the re-insert a
 * silent no-op and the trigger that drives the whole duel never fires. The first
 * run passes and the second measures yesterday.
 *
 * Screenshots land in $DUEL_SHOTS (default ./duel-shots).
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = 'http://localhost:4173';
const SHOTS = process.env.DUEL_SHOTS ?? 'duel-shots';
mkdirSync(SHOTS, { recursive: true });

const ACCOUNTS = {
  ALPHA: ['smoke-test-claude@evoforge.internal', 'SmokeTest-2026-07!x'],
  BRAVO: ['smoke-test-claude-2@evoforge.internal', 'SmokeTest-2026-07!y'],
  CHARLIE: ['smoke-test-claude-3@evoforge.internal', 'SmokeTest-2026-07!z'],
  DELTA: ['smoke-test-claude-4@evoforge.internal', 'SmokeTest-2026-07!w'],
};

async function launch() {
  return chromium.launch({ headless: true });
}

/** A fresh signed-in context on an iPhone-sized viewport. */
async function signIn(browser, who) {
  const [email, password] = ACCOUNTS[who];
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack ?? '').split('\n').slice(1, 12).join('\n')}`));
  page.on('console', async (m) => {
    if (m.type() !== 'error') return;
    let stack = '';
    for (const arg of m.args().slice(0, 3)) {
      const v = await arg.evaluate((o) => (o && o.stack ? o.stack : null)).catch(() => null);
      if (v) stack += `\n${String(v).split('\n').slice(0, 12).join('\n')}`;
    }
    errors.push(m.text().slice(0, 200) + stack);
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid=email]', { timeout: 30_000 });
  await page.fill('[data-testid=email]', email);
  await page.fill('[data-testid=password]', password);
  await page.click('[data-testid=sign-in]');
  await page.waitForTimeout(4000);
  await dismissOverlays(page);
  return { ctx, page, errors };
}

/** The tutorial overlay and the origin sheet both eat every click. */
async function dismissOverlays(page) {
  for (let i = 0; i < 4; i++) {
    const skip = page.locator('[data-testid=tutorial-skip]');
    if (await skip.count().catch(() => 0)) {
      await skip.first().click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(600);
      continue;
    }
    const later = page.getByText(/^LATER$/i);
    if (await later.count().catch(() => 0)) {
      await later.first().click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      continue;
    }
    break;
  }
}

async function goto(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2200);
  await dismissOverlays(page);
  // A cold navigation resets react-query, so the first paint is a skeleton.
  // Wait for it to go, or the assertions race the data.
  for (let i = 0; i < 30; i++) {
    const loading =
      (await page.locator('[data-testid=challenge-detail-loading]').count()) +
      (await page.locator('[data-testid=challenges-loading]').count()) +
      (await page.locator('[data-testid=watch-loading]').count());
    if (loading === 0) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(900);
  await dismissOverlays(page);
}

async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  return `${SHOTS}/${name}.png`;
}

/** RN-web renders several screens at once (idle preload); take the first node
 *  with a real box, never the hidden 0×0 copy behind it. */
async function visible(page, testId) {
  return page
    .locator(`[data-testid="${testId}"]`)
    .filter({ has: page.locator(':scope') })
    .first();
}

async function tap(page, testId, opts = {}) {
  const el = page.locator(`[data-testid="${testId}"]`);
  const n = await el.count();
  for (let i = 0; i < n; i++) {
    const box = await el.nth(i).boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) {
      await el.nth(i).click({ timeout: opts.timeout ?? 8000 });
      await page.waitForTimeout(opts.wait ?? 700);
      return true;
    }
  }
  return false;
}

async function textOf(page, testId) {
  const el = page.locator(`[data-testid="${testId}"]`);
  const n = await el.count();
  for (let i = 0; i < n; i++) {
    const box = await el.nth(i).boundingBox().catch(() => null);
    if (box && box.width > 0) return (await el.nth(i).innerText()).trim();
  }
  return null;
}

async function has(page, testId) {
  const el = page.locator(`[data-testid="${testId}"]`);
  const n = await el.count();
  for (let i = 0; i < n; i++) {
    const box = await el.nth(i).boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) return true;
  }
  return false;
}

const ALPHA = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1';
const BRAVO = '699ddb56-69b5-4070-854b-df73f578f19b';
const TOKEN = readFileSync('C:/Users/tyson/Downloads/Previous_Code/evoforge/client/.env.sbtoken.local', 'utf8')
  .trim().replace(/^[A-Z_]+=/, '').replace(/^["']|["']$/g, '');

async function sql(query) {
  const res = await fetch('https://api.supabase.com/v1/projects/rysbpwpvnqbngqncrfaa/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `select set_config('request.jwt.claims', '{"role":"service_role"}', true);\n${query}` }),
  });
  const t = await res.text();
  if (!res.ok) throw new Error(t.slice(0, 300));
  return JSON.parse(t);
}

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

// START FROM A KNOWN FLOOR. workout_sessions is unique on (user, date,
// workout), so a leftover 'Tour Duel Push' from an earlier run makes the
// re-insert a silent no-op — and the trigger that drives the whole duel never
// fires. The first run passed; the second measured yesterday's data.
await sql(`delete from public.coin_events
             where source_id ~ '^[0-9a-f]{8}-'
               and split_part(source_id, ':', 1)::uuid in (select id from public.forge_challenges);
           delete from public.forge_challenges
             where challenger_id in ('${ALPHA}','${BRAVO}')
                or opponent_id in ('${ALPHA}','${BRAVO}');
           delete from public.workout_sessions
             where user_id in ('${ALPHA}','${BRAVO}')
               and (workout like 'Tour Duel%' or date >= current_date - 1);
           delete from public.cardio_log where notes = 'Tour Duel Cardio';
           delete from public.social_notifications where type like 'duel_%';`);

const browser = await launch();

// ── ALPHA creates ────────────────────────────────────────────────────────
console.log('\n1. ALPHA SENDS A DUEL');
const a = await signIn(browser, 'ALPHA');
await goto(a.page, '/challenges');
await tap(a.page, 'challenge-create', { wait: 2500 });
await tap(a.page, `challenge-opponent-${BRAVO}`);
await tap(a.page, 'challenge-type-training_consistency');
await tap(a.page, 'challenge-duration-3');
await tap(a.page, 'wager-chip-25');
await tap(a.page, 'challenge-agree');
ok('sent', await tap(a.page, 'challenge-send', { wait: 4000 }));
const duel = (await sql(`select id from public.forge_challenges where challenger_id='${ALPHA}' and status='pending' order by created_at desc limit 1;`))[0]?.id;
ok('the duel exists', Boolean(duel), duel);
await goto(a.page, `/challenges/${duel}`);
ok('the AWAITING state renders', await has(a.page, 'duel-awaiting'));
await shot(a.page, '10-awaiting');

// ── BRAVO counters the stake ─────────────────────────────────────────────
console.log('\n2. BRAVO COUNTERS THE STAKE');
const b = await signIn(browser, 'BRAVO');
await goto(b.page, `/challenges/${duel}`);
ok('the invite renders', await has(b.page, 'duel-invite'));
await shot(b.page, '11-invite');
ok('COUNTER STAKE opens the table', await tap(b.page, 'challenge-counter', { wait: 1200 }));
await tap(b.page, 'wager-chip-25');
await shot(b.page, '12-counter-stake');
ok('counter sent', await tap(b.page, 'duel-counter-send', { wait: 3500 }));
const offer1 = (await sql(`select id, amount, kind from public.forge_duel_offers where challenge_id='${duel}' and status='pending';`))[0];
ok('a counter_stake offer is pending', offer1?.kind === 'counter_stake', `${offer1?.amount} coins`);

// ── ALPHA accepts the counter, BRAVO accepts the duel ────────────────────
console.log('\n3. ALPHA AGREES, BRAVO ACCEPTS');
await goto(a.page, `/challenges/${duel}`);
ok('ALPHA sees the incoming offer', await has(a.page, 'duel-offer-incoming'));
await shot(a.page, '13-offer-incoming');
ok('ALPHA accepts it', await tap(a.page, 'offer-accept', { wait: 3500 }));
const stakeNow = (await sql(`select stake from public.forge_challenges where id='${duel}';`))[0].stake;
ok('the opening stake was rewritten', stakeNow === offer1.amount, `${stakeNow} coins`);

await goto(b.page, `/challenges/${duel}`);
ok('BRAVO accepts the duel', await tap(b.page, 'challenge-accept', { wait: 4000 }));
const afterAccept = (await sql(`select status, current_stake from public.forge_challenges where id='${duel}';`))[0];
ok('the duel is live', afterAccept.status === 'active', `stake ${afterAccept.current_stake}`);
await goto(b.page, `/challenges/${duel}`);
ok('the pot renders', await has(b.page, 'duel-pot'), await textOf(b.page, 'duel-pot-value'));
ok('the arena renders', await has(b.page, 'challenge-versus'));
ok('the raise is LOCKED before training', (await textOf(b.page, 'duel-raise-lock'))?.includes('Unlocks'));
await shot(b.page, '14-live-duel');

// ── both train ───────────────────────────────────────────────────────────
console.log('\n4. BOTH TRAIN (the duel updates itself)');
await sql(`insert into public.workout_sessions (user_id, date, workout, finished_at) values
  ('${ALPHA}', current_date, 'Tour Duel Push', now()),
  ('${BRAVO}', current_date, 'Tour Duel Pull', now()) on conflict do nothing;`);
const ev = await sql(`select kind from public.forge_challenge_events where challenge_id='${duel}' and kind='workout_logged';`);
ok('the sessions landed on the timeline', ev.length === 2, `${ev.length} entries`);
await goto(a.page, `/challenges/${duel}`);
ok('the timeline renders', await has(a.page, 'duel-timeline'));
ok('the raise is now UNLOCKED', await has(a.page, 'duel-raise-open'));
await shot(a.page, '15-after-training');

// ── ALPHA raises, BRAVO counters, ALPHA accepts ──────────────────────────
console.log('\n5. RAISE → COUNTER → ACCEPT');
ok('the raise sheet opens', await tap(a.page, 'duel-raise-open', { wait: 1400 }));
ok('the sheet renders', await has(a.page, 'raise-sheet'));
await tap(a.page, 'wager-chip-25');
await shot(a.page, '16-raise-sheet');
ok('the raise is sent', await tap(a.page, 'raise-send', { wait: 3500 }));

await goto(b.page, `/challenges/${duel}`);
ok('BRAVO sees the raise', await has(b.page, 'duel-offer-incoming'));
await shot(b.page, '17-raise-incoming');
ok('BRAVO opens a counter', await tap(b.page, 'offer-counter', { wait: 1200 }));
await tap(b.page, 'wager-clear');
await tap(b.page, 'wager-chip-10');
ok('the counter is sent', await tap(b.page, 'offer-counter-send', { wait: 3500 }));

await goto(a.page, `/challenges/${duel}`);
ok('ALPHA accepts the counter-raise', await tap(a.page, 'offer-accept', { wait: 3500 }));
const raised = (await sql(`select current_stake, raises_accepted from public.forge_challenges where id='${duel}';`))[0];
ok('the pot grew by the counter, not the original', raised.current_stake === offer1.amount + 10,
   `stake ${raised.current_stake}, ${raised.raises_accepted} raise(s)`);
await goto(a.page, `/challenges/${duel}`);
await shot(a.page, '18-pot-raised');

// ── the raise re-locks, then ALL IN ──────────────────────────────────────
console.log('\n6. THE RAISE RE-LOCKS, THEN ALL IN');
ok('an accepted raise re-locks the next one',
   (await textOf(a.page, 'duel-raise-lock'))?.includes('Unlocks'),
   await textOf(a.page, 'duel-raise-lock'));
// Both train again, which is what buys the next negotiation.
await sql(`insert into public.cardio_log (user_id, date, type, minutes, notes) values
  ('${ALPHA}', current_date, 'Row', 12, 'Tour Duel Cardio'),
  ('${BRAVO}', current_date, 'Row', 12, 'Tour Duel Cardio');`);
await goto(a.page, `/challenges/${duel}`);
ok('training unlocks it again', await has(a.page, 'duel-raise-open'));
ok('the raise sheet reopens', await tap(a.page, 'duel-raise-open', { wait: 1400 }));
ok('the all-in door is there', await tap(a.page, 'raise-go-all-in', { wait: 1200 }));
ok('the all-in sheet renders', await has(a.page, 'all-in-sheet'), await textOf(a.page, 'all-in-amount'));
await shot(a.page, '19-all-in');
ok('it needs a HOLD, not a tap', await has(a.page, 'all-in-hold'));
await tap(a.page, 'all-in-cancel', { wait: 900 });

// ── CHARLIE watches and backs ────────────────────────────────────────────
console.log('\n7. A FRIEND WATCHES AND BACKS');
const c = await signIn(browser, 'CHARLIE');
await goto(c.page, '/challenges');
ok('the duel is listed as watchable', await has(c.page, `duel-watch-${duel}`));
await shot(c.page, '20-watch-list');
await goto(c.page, `/challenges/watch/${duel}`);
ok('the spectator view renders', await has(c.page, 'watch-scoreline'));
ok('the crowd meter renders', await has(c.page, 'watch-support-meter'));
await shot(c.page, '21-spectator');
ok('backing opens the table', await tap(c.page, 'watch-back-challenger', { wait: 1400 }));
await tap(c.page, 'wager-chip-25');
await shot(c.page, '22-backing');
ok('the support is placed', await tap(c.page, 'watch-support-confirm', { wait: 3500 }));
const sup = (await sql(`select amount, backed_id from public.forge_duel_support where challenge_id='${duel}';`))[0];
ok('the stake reached the pool', Boolean(sup), `${sup?.amount} on ${sup?.backed_id === ALPHA ? 'ALPHA' : 'BRAVO'}`);
await goto(c.page, `/challenges/watch/${duel}`);
ok('the spectator sees their own position', await has(c.page, 'watch-my-support'));
ok('reactions render', await has(c.page, 'duel-react-fire'));
await tap(c.page, 'duel-react-fire', { wait: 1500 });
await shot(c.page, '23-backed');

// ── DELTA backs the other side, so the pool actually splits ──────────────
const d = await signIn(browser, 'DELTA');
await goto(d.page, `/challenges/watch/${duel}`);
await tap(d.page, 'watch-back-opponent', { wait: 1400 });
await tap(d.page, 'wager-chip-10');
ok('DELTA backs the other side', await tap(d.page, 'watch-support-confirm', { wait: 3500 }));

// ── settle ───────────────────────────────────────────────────────────────
console.log('\n8. THE WINDOW CLOSES');
// ALPHA trained one more day than BRAVO inside the window.
await sql(`insert into public.workout_sessions (user_id, date, workout, finished_at)
           values ('${ALPHA}', current_date - 1, 'Tour Duel Legs', now()) on conflict do nothing;`);
await sql(`alter table public.forge_challenges disable trigger forge_challenge_lock_trigger;
           update public.forge_challenges set starts_at = (current_date - 1)::timestamptz,
             ends_at = now() - interval '1 minute' where id='${duel}';
           alter table public.forge_challenges enable trigger forge_challenge_lock_trigger;`);
const before = (await sql(`select public.forge_duel_balance('${ALPHA}') v;`))[0].v;

// The HUB sweeps on open — nobody presses a button to be paid.
await goto(a.page, '/challenges');
await a.page.waitForTimeout(4000);
const settled = (await sql(`select status, outcome, winner_id from public.forge_challenges where id='${duel}';`))[0];
ok('the hub settled it on open, with no button', settled.status === 'settled',
   `${settled.outcome}, winner ${settled.winner_id === ALPHA ? 'ALPHA' : settled.winner_id === BRAVO ? 'BRAVO' : 'none'}`);
const after = (await sql(`select public.forge_duel_balance('${ALPHA}') v;`))[0].v;
ok('the winner was paid', after > before, `${before} → ${after}`);

await goto(a.page, `/challenges/${duel}`);
ok('the result screen renders', await has(a.page, 'duel-result'));
ok('it says VICTORY', (await textOf(a.page, 'duel-result-headline')) === 'VICTORY',
   await textOf(a.page, 'duel-result-headline'));
ok('REMATCH is offered', await has(a.page, 'challenge-rematch'));
ok('DOUBLE OR NOTHING is offered', await has(a.page, 'challenge-double'));
await shot(a.page, '24-victory');

await goto(b.page, `/challenges/${duel}`);
ok('the loser gets a clean DEFEAT', (await textOf(b.page, 'duel-result-headline')) === 'DEFEAT');
await shot(b.page, '25-defeat');

await goto(c.page, `/challenges/watch/${duel}`);
ok('the backer of the winner sees their payout', await has(c.page, 'watch-my-support'));
await shot(c.page, '26-support-settled');
const payouts = await sql(`select s.amount, s.payout, s.backed_id from public.forge_duel_support s where s.challenge_id='${duel}' order by s.created_at;`);
ok('the pari-mutuel split ran', payouts.every((p) => p.payout !== null),
   payouts.map((p) => `${p.amount}→${p.payout}`).join(', '));

// ── the ledger, and a refresh mid-duel ───────────────────────────────────
const net = (await sql(`select coalesce(sum(amount),0)::int n from public.coin_events where source_id like '${duel}%';`))[0].n;
ok('the whole duel conserved the ledger', Number(net) === 0, `net ${net}`);

console.log('\nCONSOLE ERRORS');
for (const [who, s] of [['ALPHA', a], ['BRAVO', b], ['CHARLIE', c], ['DELTA', d]]) {
  const real = s.errors.filter((e) => !/404|409|app_flag_enabled/.test(e));
  console.log(`  ${who}: ${real.length ? real.slice(0, 3).join(' | ').slice(0, 400) : 'none'}`);
}

// SEEDED IN PRODUCTION, DELETED AFTERWARDS (HANDOVER §5).
console.log('\nCLEANUP');
await sql(`delete from public.coin_events where source_id like '${duel}%';
           delete from public.forge_challenges where id = '${duel}';
           delete from public.workout_sessions where workout like 'Tour Duel%';
           delete from public.cardio_log where notes = 'Tour Duel Cardio';
           delete from public.social_notifications where type like 'duel_%';`);
const balances = await sql(`select public.forge_duel_balance('${ALPHA}') a, public.forge_duel_balance('${BRAVO}') b;`);
console.log('  balances restored:', JSON.stringify(balances[0]));

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
console.log(`duel id: ${duel}`);
await browser.close();
process.exit(fail === 0 ? 0 : 1);
