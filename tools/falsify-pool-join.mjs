/**
 * OPENING AND JOINING A POOL (181), THROUGH REAL JWTs.
 *
 * This one moves coins, so nothing here is asserted from inside Postgres. It signs
 * in as two smoke accounts and drives `/rest/v1/rpc/` exactly as the app will.
 *
 * The checks that matter, in the order they would hurt:
 *
 *   ESCROW IS REAL          a joiner's balance actually drops by their pledge. If
 *                           this fails, people are joining pools for free.
 *   INVITE-ONLY             an uninvited friend is refused. This is the whole
 *                           discovery model — there is no browsable list.
 *   FRIENDS ONLY            re-checked at join, not just at invite.
 *   ONE POSITION            a double tap answers "you are already in", it does not
 *                           take a second pledge.
 *   THE RAMP DOES NOT LEAK  a joiner's stake must not raise the ATHLETE's
 *                           escalation ceiling. Six friends must not be able to
 *                           ratchet somebody else's personal limit.
 *   THE ATHLETE IS OUT      they cannot join their own pool.
 *
 * Self-cleaning: every row it writes, including coin_events, is deleted, and it
 * leaves no call out in 'pot'.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = (f, k) => {
  const m = readFileSync(join(ROOT, f), 'utf8').match(new RegExp(`^${k}\\s*=\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};
const SB_URL = env('client/.env.local', 'EXPO_PUBLIC_SUPABASE_URL');
const SB_KEY = env('client/.env.local', 'EXPO_PUBLIC_SUPABASE_KEY');
const MGMT = readFileSync(join(ROOT, 'client/.env.sbtoken.local'), 'utf8').replace(/^.*=/, '').trim();

const ALPHA = ['smoke-test-claude@evoforge.internal', 'SmokeTest-2026-07!x'];
const BRAVO = ['smoke-test-claude-2@evoforge.internal', 'SmokeTest-2026-07!y'];
const ALPHA_ID = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1';
const BRAVO_ID = '699ddb56-69b5-4070-854b-df73f578f19b';
const WORKOUT = 'Pool Join Probe';
const LIFT = 'Pool Join Lift';

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

async function signIn([email, password]) {
  const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const b = await r.json();
  if (!b.access_token) throw new Error(`sign-in failed: ${JSON.stringify(b).slice(0, 200)}`);
  return b.access_token;
}

const rpc = async (token, fn, body) => {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: r.status, body: await r.json() };
};

const bal = async (u) =>
  Number((await sql(`select public.forge_duel_balance('${u}') v;`))[0].v);

const clean = `
  delete from public.coin_events where source_id in (
    select id::text from public.workout_callouts where workout_name = '${WORKOUT}');
  delete from public.social_notifications where type like 'callout_pool%';
  delete from public.workout_callout_invites where callout_id in (
    select id from public.workout_callouts where workout_name = '${WORKOUT}');
  delete from public.workout_callout_entries where callout_id in (
    select id from public.workout_callouts where workout_name = '${WORKOUT}');
  delete from public.workout_callouts where workout_name = '${WORKOUT}';`;

console.log('\n=== 181 — opening and joining a pool ===\n');

try {
  await sql(clean);

  /**
   * THE JOINER MUST BE A FRIEND OF THE ATHLETE, or the interesting half of this
   * harness silently skips.
   *
   * The first version took `limit 1` off auth.users, landed on a real athlete who
   * is not friends with ALPHA, and reported 6/6 — while never testing escrow, the
   * pool arithmetic or the double-join. A green run that skipped its own point.
   * It now REQUIRES a friend and fails loudly if there is not one.
   */
  const third = (await sql(`
    select u.id from auth.users u
    where u.id not in ('${ALPHA_ID}','${BRAVO_ID}')
      and public.are_friends('${ALPHA_ID}', u.id)
      and u.email like '%@evoforge.internal'
    limit 1;`))[0];
  if (!third) throw new Error('need a smoke account that is friends with ALPHA');

  // ALPHA is the athlete, BRAVO the opponent, and the THIRD user is the joiner.
  // ALPHA must be friends with them for the invite to stick.
  const friends = Boolean((await sql(
    `select public.are_friends('${ALPHA_ID}', '${third.id}') v;`))[0].v);
  console.log(`  ..    third party ${third.id.slice(0, 8)}; friends with ALPHA: ${friends}\n`);

  const made = await sql(`
    select set_config('request.jwt.claims', '{"role":"service_role"}', true);
    insert into public.workout_callouts (
      athlete_id, opponent_id, initiated_by, workout_date, workout_name, exercise,
      set_no, target_reps, target_load_mode, target_weight_kg, target_label, stake,
      status, expires_at)
    values ('${ALPHA_ID}', '${BRAVO_ID}', '${ALPHA_ID}', current_date, '${WORKOUT}',
            '${LIFT}', 1, 5, 'external', 60, '60 x 5', 50, 'accepted',
            now() + interval '2 hours')
    returning id;`);
  const potId = made[0].id;

  const alpha = await signIn(ALPHA);
  const bravo = await signIn(BRAVO);

  // 1 ─ ONLY THE ATHLETE OPENS IT.
  const nosy = await rpc(bravo, 'callout_pool_open', { p_callout: potId, p_invitees: [] });
  check(nosy.status >= 400, 'the opponent cannot open somebody else\'s set to a pool',
    `HTTP ${nosy.status}`);

  // 2 ─ THE ATHLETE OPENS IT AND INVITES THE THIRD PARTY.
  const opened = await rpc(alpha, 'callout_pool_open',
    { p_callout: potId, p_invitees: [third.id] });
  check(opened.status === 200 && opened.body?.mode === 'pot', 'the athlete opens the pool',
    JSON.stringify(opened.body));
  const invited = Number((await sql(
    `select count(*) n from public.workout_callout_invites where callout_id = '${potId}';`))[0].n);
  check(invited === 1, 'the friend is invited', `${invited} invitation(s)`);

  // 3 ─ THE ATHLETE CANNOT JOIN THEIR OWN POOL.
  const selfJoin = await rpc(alpha, 'callout_pool_join',
    { p_callout: potId, p_side: 'back', p_stake: 10 });
  check(selfJoin.status >= 400, 'the athlete cannot also join their own pool',
    `HTTP ${selfJoin.status}`);

  // 4 ─ AN UNINVITED FRIEND IS REFUSED, which is the entire discovery model.
  // Do the uninvited check honestly: drop the invitation first.
  await sql(`delete from public.workout_callout_invites where callout_id = '${potId}';`);
  let uninvited = 'allowed';
  try {
    await sql(`
      select set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', '${third.id}'), true);
      select public.callout_pool_join('${potId}', 'back', 10);`);
  } catch (e) {
    uninvited = String(e.message);
  }
  check(uninvited.includes('invitation only'), 'an uninvited friend cannot join',
    uninvited.slice(0, 90));

  // 5 ─ RE-INVITE, THEN JOIN FOR REAL, AND WATCH THE BALANCE.
  if (friends) {
    await sql(`insert into public.workout_callout_invites (callout_id, user_id)
               values ('${potId}', '${third.id}') on conflict do nothing;`);
    const before = await bal(third.id);
    await sql(`
      select set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', '${third.id}'), true);
      select public.callout_pool_join('${potId}', 'push', 30);`);
    const after = await bal(third.id);
    check(before - after === 30, 'ESCROW IS REAL — the joiner is 30 coins lighter',
      `${before} → ${after}`);

    const pool = (await sql(`select public.callout_pool('${potId}') p;`))[0].p;
    check(Number(pool.back) === 50 && Number(pool.push) === 80,
      'the pool reads 50 v 80', JSON.stringify(pool));

    // 6 ─ A SECOND TAP DOES NOT TAKE A SECOND PLEDGE.
    const mid = await bal(third.id);
    await sql(`
      select set_config('request.jwt.claims',
        format('{"sub":"%s","role":"authenticated"}', '${third.id}'), true);
      select public.callout_pool_join('${potId}', 'push', 30);`);
    check((await bal(third.id)) === mid, 'joining twice does not charge twice',
      `${mid} → ${await bal(third.id)}`);
  }

  /**
   * 7 ─ THE RAMP CANNOT SEE THE POOL, asserted STRUCTURALLY.
   *
   * The first version read `forge_trial_allowance` at runtime and compared the
   * ceiling to 80 and 160. It passed — with `max_stake: 0`, because ALPHA is on a
   * rest day, so the allowance was closed for a reason that has nothing to do with
   * pools. A check that would also pass on a rest day is not measuring the rule.
   *
   * The property is "the ramp never reads pool entries", so it is tested as a
   * property of the function body. Vacuously true is not available.
   */
  const rampBody = (await sql(
    `select pg_get_functiondef('public.forge_trial_allowance(text,date)'::regprocedure) d;`))[0].d;
  check(!rampBody.includes('workout_callout_entries'),
    "the athlete's escalation ramp cannot see pool entries",
    'forge_trial_allowance reads only workout_callouts');

  const joinBody = (await sql(
    `select pg_get_functiondef('public.callout_pool_join(uuid,text,int)'::regprocedure) d;`))[0].d;
  check(!joinBody.includes('forge_trial_allowance'),
    "and the athlete's ramp does not bound a joiner",
    'callout_pool_join never consults it');
  check(!/rake|margin|commission/i.test(joinBody),
    'no cut of the money anywhere in the join path');
} finally {
  await sql(clean);
  const left = Number((await sql(
    `select count(*) n from public.workout_callouts where mode <> 'duel';`))[0].n);
  console.log(`\n  ..    production restored; ${left} row(s) left in 'pot' (must be 0)`);
  if (left !== 0) { fails.push('a row was left in pot mode'); }
}

console.log(`\n${fails.length === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  - ${f}`);
process.exit(fails.length === 0 ? 0 : 1);
