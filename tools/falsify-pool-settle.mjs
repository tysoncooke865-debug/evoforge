/**
 * A POOL THAT ACTUALLY SETTLES (182) — four balances, real coins.
 *
 * Everything here is measured as a BALANCE DELTA, not read out of the function's
 * return value. A settlement function that says it paid 150 while paying 149 is
 * exactly the failure worth catching, and only the wallets can tell you.
 *
 * The arithmetic under test, with ALPHA 50 + friend 30 on BACK and BRAVO 50 +
 * friend 20 on PUSH, athlete hits:
 *
 *     winners 80, losers 70, pool 150
 *     ALPHA   50 + floor(50*70/80) = 93, +1 remainder (largest position) = 94
 *     friend  30 + floor(30*70/80) = 56
 *     paid    150, and the two losers are out exactly what they put in
 *     net     +44 +26 -50 -20 = 0
 *
 * And the bug 182 exists to fix: `callout_refund_both` used to name the athlete
 * and the opponent, so a JOINER'S ESCROW WAS STRANDED on every refund path. That
 * gets its own scenario, because it is the one that loses somebody real money.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MGMT = readFileSync(join(ROOT, 'client/.env.sbtoken.local'), 'utf8').replace(/^.*=/, '').trim();
const ALPHA_ID = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1';
const BRAVO_ID = '699ddb56-69b5-4070-854b-df73f578f19b';
const WORKOUT = 'Pool Settle Probe';
const LIFT = 'Pool Settle Lift';

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
  if (!r.ok) throw new Error(`SQL ${r.status}: ${JSON.stringify(b).slice(0, 400)}`);
  return b;
}

const as = (u, q) => sql(
  `select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', '${u}'), true);\n${q}`);
const svc = (q) => sql(`select set_config('request.jwt.claims', '{"role":"service_role"}', true);\n${q}`);
const bal = async (u) => Number((await sql(`select public.forge_duel_balance('${u}') v;`))[0].v);

const clean = `
  delete from public.coin_events where source_id in (
    select id::text from public.workout_callouts where workout_name = '${WORKOUT}');
  delete from public.social_notifications where type like 'callout_%';
  delete from public.workout_callout_invites where callout_id in (
    select id from public.workout_callouts where workout_name = '${WORKOUT}');
  delete from public.workout_callout_entries where callout_id in (
    select id from public.workout_callouts where workout_name = '${WORKOUT}');
  delete from public.workout_callouts where workout_name = '${WORKOUT}';`;

/** Build an accepted pot with both principals escrowed and two friends joined. */
async function buildPool(setNo, friends, sides, amounts) {
  const made = await svc(`
    insert into public.workout_callouts (
      athlete_id, opponent_id, initiated_by, workout_date, workout_name, exercise,
      set_no, target_reps, target_load_mode, target_weight_kg, target_label, stake,
      status, expires_at, mode)
    values ('${ALPHA_ID}', '${BRAVO_ID}', '${ALPHA_ID}', current_date, '${WORKOUT}',
            '${LIFT}', ${setNo}, 5, 'external', 60, '60 x 5', 50, 'accepted',
            now() + interval '2 hours', 'pot')
    returning id;`);
  const id = made[0].id;
  // The principals' escrow, exactly as `callout_respond` writes it.
  await svc(`
    select set_config('evoforge.callout_authorized', '${id}', true);
    insert into public.coin_events (user_id, kind, amount, source_id)
    values ('${ALPHA_ID}', 'callout_stake', -50, '${id}'),
           ('${BRAVO_ID}', 'callout_stake', -50, '${id}');`);
  for (let i = 0; i < friends.length; i++) {
    await svc(`insert into public.workout_callout_invites (callout_id, user_id)
               values ('${id}', '${friends[i]}') on conflict do nothing;`);
    await as(friends[i], `select public.callout_pool_join('${id}', '${sides[i]}', ${amounts[i]});`);
  }
  return id;
}

console.log('\n=== 182 — a pool that settles, and one that refunds ===\n');

try {
  await sql(clean);

  const mates = (await sql(`
    select u.id from auth.users u
    where u.id not in ('${ALPHA_ID}','${BRAVO_ID}')
      and public.are_friends('${ALPHA_ID}', u.id)
      and u.email like '%@evoforge.internal'
    order by u.email limit 2;`)).map((r) => r.id);
  if (mates.length < 2) throw new Error('need two smoke accounts friendly with ALPHA');
  const [backer, pusher] = mates;
  console.log(`  ..    backer ${backer.slice(0, 8)} (30 BACK), pusher ${pusher.slice(0, 8)} (20 PUSH)\n`);

  // ─────────────────────────── SCENARIO 1: the athlete hits, BACK divides PUSH
  const open0 = {
    a: await bal(ALPHA_ID), b: await bal(BRAVO_ID),
    k: await bal(backer), p: await bal(pusher),
  };
  const potId = await buildPool(1, [backer, pusher], ['back', 'push'], [30, 20]);

  const pool = (await sql(`select public.callout_pool('${potId}') p;`))[0].p;
  check(Number(pool.back) === 80 && Number(pool.push) === 70,
    'the pool builds to 80 v 70', JSON.stringify(pool));

  await svc(`update public.workout_callouts
             set status = 'awaiting_verification', result = 'hit', set_logged_at = now()
             where id = '${potId}';`);

  // Pool is 150, under the 200 threshold, so the opponent may still call it.
  const settled = (await as(BRAVO_ID,
    `select public.callout_verify('${potId}', 'verify', null) v;`))[0].v;
  check(settled?.status === 'settled', 'it settles', JSON.stringify(settled).slice(0, 130));

  const close0 = {
    a: await bal(ALPHA_ID), b: await bal(BRAVO_ID),
    k: await bal(backer), p: await bal(pusher),
  };
  const d = {
    a: close0.a - open0.a, b: close0.b - open0.b,
    k: close0.k - open0.k, p: close0.p - open0.p,
  };
  console.log(`        deltas — athlete ${d.a}, opponent ${d.b}, backer ${d.k}, pusher ${d.p}`);

  check(d.a === 44, 'the athlete nets +44 (50 back, 43 share, 1 remainder)', String(d.a));
  check(d.k === 26, 'the backer nets +26 (30 back, 26 share)', String(d.k));
  check(d.b === -50, 'the opponent is out exactly their pledge', String(d.b));
  check(d.p === -20, 'the pushing friend is out exactly theirs', String(d.p));
  check(d.a + d.b + d.k + d.p === 0,
    'NOT ONE COIN MINTED OR BURNED', `sum ${d.a + d.b + d.k + d.p}`);

  // ─────────────────── SCENARIO 2: the refund, which used to strand a joiner
  const open1 = { a: await bal(ALPHA_ID), k: await bal(backer) };
  const refundId = await buildPool(2, [backer], ['back'], [30]);
  const heldMid = open1.k - (await bal(backer));
  check(heldMid === 30, 'the joiner has 30 in escrow', String(heldMid));

  await svc(`select public.callout_refund_both('${refundId}');`);
  const close1 = { a: await bal(ALPHA_ID), k: await bal(backer) };
  check(close1.k === open1.k, 'THE JOINER IS MADE WHOLE — the stranding bug is fixed',
    `${open1.k} → ${close1.k}`);
  check(close1.a === open1.a, 'and so is the athlete', `${open1.a} → ${close1.a}`);

  // Idempotent: refunding twice must not mint.
  await svc(`select public.callout_refund_both('${refundId}');`);
  check((await bal(backer)) === open1.k, 'refunding twice pays nothing extra',
    String(await bal(backer)));

  // ───────────── SCENARIO 3: a big pool needs somebody with no position (§5)
  // ONE joiner only, so the other smoke account is free to be the verifier. The
  // first version used both and then "skipped the positive verifier case" — which
  // left the rule proven to REFUSE and never proven to ALLOW. A gate nobody can
  // pass is indistinguishable from a broken one.
  const bigId = await buildPool(3, [backer], ['back'], [200]);
  await svc(`update public.workout_callouts
             set status = 'awaiting_verification', result = 'hit', set_logged_at = now()
             where id = '${bigId}';`);
  let refused = 'allowed';
  try {
    await as(BRAVO_ID, `select public.callout_verify('${bigId}', 'verify', null);`);
  } catch (e) { refused = String(e.message); }
  check(refused.includes('too big for a participant'),
    'a 300-coin pool cannot be called by a participant', refused.slice(0, 80));

  // And an invited non-participant can.
  const outsider = { id: pusher };
  if (outsider) {
    await svc(`insert into public.workout_callout_invites (callout_id, user_id)
               values ('${bigId}', '${outsider.id}') on conflict do nothing;`);
    const byOutsider = (await as(outsider.id,
      `select public.callout_verify('${bigId}', 'verify', null) v;`))[0].v;
    check(byOutsider?.status === 'settled',
      'an invited friend with no position can call it', JSON.stringify(byOutsider).slice(0, 110));
  }
} finally {
  await sql(clean);
  const left = Number((await sql(
    `select count(*) n from public.workout_callouts where mode <> 'duel';`))[0].n);
  console.log(`\n  ..    production restored; ${left} row(s) left in 'pot' (must be 0)`);
  if (left !== 0) fails.push('a row was left in pot mode');
}

console.log(`\n${fails.length === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  - ${f}`);
process.exit(fails.length === 0 ? 0 : 1);
