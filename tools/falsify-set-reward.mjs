/**
 * DOES THE PER-SET REWARD ACTUALLY PAY? (160, wired 2026-08-09)
 *
 * 160 shipped the `set_reward` kind, its server validation and its 30-a-day cap.
 * Nothing ever claimed it, so it had paid ZERO coins in production — the
 * deterministic backbone of the v5 economy existed only as a guard. The client now
 * claims it on both save paths.
 *
 * The mistake worth not repeating is the one that created this: I verified the
 * GUARD and inferred the feature. So this drives the real path — a real JWT, a real
 * `/rest/v1/coin_events` insert — and asserts on the coins that land.
 *
 *   1. a set logged by this athlete pays exactly 12, server-set
 *   2. the same set twice does not pay twice
 *   3. somebody else's set pays nothing
 *   4. an implausible set pays nothing
 *   5. the amount is the SERVER's: a client asking for 500 still gets 12
 *
 * Self-cleaning. Safe to run against production.
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

const ALPHA_ID = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1';
const BRAVO_ID = '699ddb56-69b5-4070-854b-df73f578f19b';
const ALPHA = ['smoke-test-claude@evoforge.internal', 'SmokeTest-2026-07!x'];
const WORKOUT = 'Set Reward Probe';
const LIFT = 'Set Reward Bench';

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

/** Exactly what `claimCoin` sends. */
async function claim(token, kind, sourceId, amount = 1) {
  const r = await fetch(`${SB_URL}/rest/v1/coin_events`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: JSON.stringify({ kind, amount, source_id: sourceId }),
  });
  return { status: r.status, body: await r.json() };
}

const cleanup = `
  delete from public.coin_events where source_id in (
    select id::text from public.workout_log where workout = '${WORKOUT}');
  delete from public.workout_log where workout = '${WORKOUT}';`;

console.log('\n=== 160 — the per-set reward, through the real path ===\n');

try {
  await sql(cleanup);

  // Two plausible sets for ALPHA and one for BRAVO, plus one implausible.
  const ids = (await sql(`
    insert into public.workout_log
      (user_id, date, workout, exercise, muscle, "set", reps, weight, "timestamp")
    values
      ('${ALPHA_ID}', current_date, '${WORKOUT}', '${LIFT}', 'Chest', 1, 8, 60, now()),
      ('${ALPHA_ID}', current_date, '${WORKOUT}', '${LIFT}', 'Chest', 2, 8, 60, now()),
      ('${ALPHA_ID}', current_date, '${WORKOUT}', '${LIFT}', 'Chest', 3, 900, 2000, now()),
      ('${BRAVO_ID}', current_date, '${WORKOUT}', '${LIFT}', 'Chest', 1, 8, 60, now())
    returning id, user_id, "set";`));
  const mine = ids.filter((r) => r.user_id === ALPHA_ID);
  const setA = mine.find((r) => Number(r.set) === 1).id;
  const setB = mine.find((r) => Number(r.set) === 2).id;
  const absurd = mine.find((r) => Number(r.set) === 3).id;
  const theirs = ids.find((r) => r.user_id === BRAVO_ID).id;

  const auth = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ALPHA[0], password: ALPHA[1] }),
  });
  const session = await auth.json();
  if (!session.access_token) throw new Error(`sign-in failed: ${JSON.stringify(session).slice(0, 200)}`);
  const token = session.access_token;

  const paidBefore = Number((await sql(
    `select count(*) n from public.coin_events
     where user_id='${ALPHA_ID}' and kind='set_reward' and created_at::date = current_date;`))[0].n);
  console.log(`  ..    ALPHA has ${paidBefore} set rewards already today (cap 30)\n`);

  // 1 ─ IT PAYS, AND IT PAYS 12.
  const first = await claim(token, 'set_reward', setA);
  check(first.status === 201, 'a logged set is rewarded', `HTTP ${first.status} ${JSON.stringify(first.body).slice(0, 140)}`);
  const amount = Array.isArray(first.body) ? first.body[0]?.amount : first.body?.amount;
  check(Number(amount) === 12, 'it pays exactly 12', `amount=${amount}`);

  // 5 ─ AND THE SERVER SETS THE NUMBER, not the client.
  const greedy = await claim(token, 'set_reward', setB, 500);
  const greedyAmount = Array.isArray(greedy.body) ? greedy.body[0]?.amount : greedy.body?.amount;
  check(greedy.status === 201 && Number(greedyAmount) === 12,
    'asking for 500 still pays 12', `HTTP ${greedy.status} amount=${greedyAmount}`);

  // 2 ─ NOT TWICE FOR THE SAME SET.
  const again = await claim(token, 'set_reward', setA);
  const twice = Number((await sql(
    `select count(*) n from public.coin_events where kind='set_reward' and source_id='${setA}';`))[0].n);
  check(twice === 1, 'the same set is not rewarded twice', `${twice} row(s), retry HTTP ${again.status}`);

  // 3 ─ NOT SOMEBODY ELSE'S SET.
  const stolen = await claim(token, 'set_reward', theirs);
  check(stolen.status >= 400, "another athlete's set pays nothing", `HTTP ${stolen.status}`);

  // 4 ─ NOT AN IMPLAUSIBLE ONE. 900 reps at 2000kg is not training.
  const silly = await claim(token, 'set_reward', absurd);
  check(silly.status >= 400, 'an implausible set pays nothing', `HTTP ${silly.status}`);

  const total = Number((await sql(
    `select coalesce(sum(amount),0) v from public.coin_events
     where kind='set_reward' and source_id in
       (select id::text from public.workout_log where workout='${WORKOUT}');`))[0].v);
  check(total === 24, 'exactly 24 coins for two legitimate sets', `${total} coins`);
} finally {
  await sql(cleanup);
  console.log('\n  ..    production restored');
}

console.log(`\n${fails.length === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  - ${f}`);
process.exit(fails.length === 0 ? 0 : 1);
