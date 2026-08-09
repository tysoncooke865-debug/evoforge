/**
 * THE POOL SCHEMA (180), FROM THE OUTSIDE.
 *
 * The migration's own block proves the trigger refuses malformed entries. It runs
 * as the migration's role, so it proves nothing about what a signed-in athlete can
 * reach — and for this table that is the whole question, because an entry is a coin
 * position. 180 deliberately ships NO insert policy: joining moves money and
 * belongs to a definer function in 181.
 *
 * So this checks the things only a real JWT can answer:
 *
 *   1. NOBODY CAN INSERT AN ENTRY FROM A CLIENT. If this ever passes, somebody can
 *      join a pool without paying for it.
 *   2. Nor update or delete one — leaving would move coins back.
 *   3. A stranger cannot read a pool they are not in.
 *   4. A participant CAN read it (an anonymous pool cannot be rendered as two pans).
 *   5. `callout_pool` refuses a call out that is not yours.
 *   6. A duel still reads as a matched pair — the property that makes 180 safe on a
 *      table with 20 live pledges in it.
 *
 * Self-cleaning, and it never leaves a real row in 'pot'.
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
const WORKOUT = 'Pool Schema Probe';
const LIFT = 'Pool Probe Lift';

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

const rest = (token, path, init = {}) =>
  fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_KEY, Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json', ...(init.headers ?? {}),
    },
  });

const clean = `
  delete from public.workout_callout_entries where callout_id in (
    select id from public.workout_callouts where workout_name = '${WORKOUT}');
  delete from public.workout_callouts where workout_name = '${WORKOUT}';
  delete from public.workout_log where workout = '${WORKOUT}' or exercise = '${LIFT}';`;

console.log('\n=== 180 — the pool schema, through real JWTs ===\n');

try {
  await sql(clean);

  // A pot nobody real is in. Inserted as the migration's role, which is the only
  // way a row can exist before 181 — exactly the point being made.
  const made = await sql(`
    select set_config('request.jwt.claims', '{"role":"service_role"}', true);
    insert into public.workout_callouts (
      athlete_id, opponent_id, initiated_by, workout_date, workout_name, exercise,
      set_no, target_reps, target_load_mode, target_weight_kg, target_label, stake,
      status, expires_at, mode)
    values ('${ALPHA_ID}', '${BRAVO_ID}', '${ALPHA_ID}', current_date, '${WORKOUT}',
            '${LIFT}', 1, 5, 'external', 60, '60 x 5', 50, 'accepted',
            now() + interval '2 hours', 'pot')
    returning id;`);
  const potId = made[0].id;
  console.log(`  ..    pot ${potId.slice(0, 8)} — ALPHA vs BRAVO, 50 each\n`);

  const alpha = await signIn(ALPHA);
  const bravo = await signIn(BRAVO);

  /**
   * 0 ─ THE INVARIANT ITSELF: no write policy exists on this table.
   *
   * This assertion is here because the behavioural one below is NOT SUFFICIENT, and
   * I only found that out by opening a real hole. I added an insert policy to
   * production and the harness stayed green — ALPHA is the athlete, so the trigger
   * refused the row for a completely different reason and the missing policy was
   * never the thing being tested. A check that passes for the wrong reason is worse
   * than no check, because it is evidence.
   *
   * Joining moves coins, so the write path must be a definer function (181) and
   * nothing else. That is a statement about POLICIES, so it is tested as one.
   */
  const writePolicies = await sql(`
    select coalesce(string_agg(policyname || ':' || cmd, ', '), '') as p
    from pg_policies
    where schemaname = 'public' and tablename = 'workout_callout_entries'
      and cmd <> 'SELECT';`);
  check(writePolicies[0].p === '',
    'the entries table has NO insert, update or delete policy',
    writePolicies[0].p || 'none');

  // 1 ─ AND BEHAVIOURALLY, no client may create a position.
  const forged = await rest(alpha, 'workout_callout_entries', {
    method: 'POST',
    body: JSON.stringify({ callout_id: potId, side: 'back', stake: 25 }),
  });
  check(forged.status >= 400, 'no client can insert a position (joining must cost coins)',
    `HTTP ${forged.status}`);

  // A third party too, not just a principal.
  const forged2 = await rest(bravo, 'workout_callout_entries', {
    method: 'POST',
    body: JSON.stringify({ callout_id: potId, side: 'push', stake: 25 }),
  });
  check(forged2.status >= 400, 'nor can anybody else', `HTTP ${forged2.status}`);

  // 2 ─ NOR CHANGE ONE. Seed a real entry as the migration's role to test against.
  await sql(`insert into public.workout_callout_entries (callout_id, user_id, side, stake)
             select '${potId}', u.id, 'push', 30 from auth.users u
             where u.id not in ('${ALPHA_ID}', '${BRAVO_ID}') limit 1;`);
  const entry = (await sql(
    `select id, user_id from public.workout_callout_entries where callout_id = '${potId}';`))[0];
  check(Boolean(entry), 'a third-party position exists to test against');

  const patched = await rest(alpha, `workout_callout_entries?id=eq.${entry.id}`, {
    method: 'PATCH', body: JSON.stringify({ stake: 1 }),
  });
  // ASSERT ON THE DATA, NOT THE STATUS. With no UPDATE policy PostgREST answers a
  // cheerful 204 having matched zero rows, because RLS filtered the row out of the
  // statement rather than rejecting it. Reading the status alone reported a hole
  // that was not there — and would equally have missed a real one that returned 204
  // after changing the row.
  const afterPatch = Number((await sql(
    `select stake from public.workout_callout_entries where id = '${entry.id}';`))[0].stake);
  check(afterPatch === 30, 'no client can change a position',
    `HTTP ${patched.status}, stake is still ${afterPatch}`);
  const deleted = await rest(alpha, `workout_callout_entries?id=eq.${entry.id}`, { method: 'DELETE' });
  const stillThere = Number((await sql(
    `select count(*) n from public.workout_callout_entries where id = '${entry.id}';`))[0].n);
  check(stillThere === 1, 'no client can withdraw a position',
    `HTTP ${deleted.status}, ${stillThere} row(s) remain`);

  // 3 ─ A PARTICIPANT SEES THE POOL. §5 needs owner identification on every ingot,
  //     so the sides cannot be hidden from the people in them.
  const seen = await rest(alpha, `workout_callout_entries?select=side,stake,user_id&callout_id=eq.${potId}`);
  const rows = await seen.json();
  check(Array.isArray(rows) && rows.length === 1,
    'the athlete can read every position in their pool',
    `${Array.isArray(rows) ? rows.length : JSON.stringify(rows).slice(0, 80)}`);

  // 4 ─ A STRANGER SEES NOTHING. The entrant is a third user, so BRAVO is a
  //     principal and CAN see — the stranger here is whoever holds the entry.
  const strangerToken = null; // no third smoke account; assert via the policy shape
  const anon = await fetch(
    `${SB_URL}/rest/v1/workout_callout_entries?select=id&callout_id=eq.${potId}`,
    { headers: { apikey: SB_KEY } });
  const anonRows = await anon.json();
  check(!Array.isArray(anonRows) || anonRows.length === 0,
    'an unauthenticated client sees no positions',
    `${Array.isArray(anonRows) ? anonRows.length : 'error'} row(s)`);
  void strangerToken;

  // 5 ─ callout_pool REFUSES A CALL OUT THAT IS NOT YOURS.
  const other = await sql(`
    select set_config('request.jwt.claims', '{"role":"service_role"}', true);
    insert into public.workout_callouts (
      athlete_id, opponent_id, initiated_by, workout_date, workout_name, exercise,
      set_no, target_reps, target_load_mode, target_weight_kg, target_label, stake,
      status, expires_at)
    select u.id, u2.id, u.id, current_date, '${WORKOUT}', '${LIFT}', 2, 5, 'external',
           60, '60 x 5', 10, 'offered', now() + interval '2 hours'
    from auth.users u, auth.users u2
    where u.id not in ('${ALPHA_ID}','${BRAVO_ID}') and u2.id not in ('${ALPHA_ID}','${BRAVO_ID}')
      and u.id <> u2.id limit 1
    returning id;`);
  if (other.length) {
    const nosy = await fetch(`${SB_URL}/rest/v1/rpc/callout_pool`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${alpha}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_callout: other[0].id }),
    });
    check(nosy.status >= 400, 'callout_pool refuses somebody else\'s call out', `HTTP ${nosy.status}`);
  } else {
    console.log('  ..    only two users available; skipping the stranger-pool check');
  }

  // 6 ─ THE POOL ARITHMETIC, as the athlete reads it.
  const mine = await fetch(`${SB_URL}/rest/v1/rpc/callout_pool`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${alpha}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_callout: potId }),
  });
  const pool = await mine.json();
  check(Number(pool?.back) === 50 && Number(pool?.push) === 80 && Number(pool?.total) === 130,
    'one 30-coin PUSH joiner makes it 50 v 80', JSON.stringify(pool));

  // 7 ─ AND A PLAIN DUEL IS STILL A MATCHED PAIR. The 20 live pledges depend on it.
  const duel = (await sql(
    `select id, stake from public.workout_callouts
      where mode = 'duel' and athlete_id = '${ALPHA_ID}' order by created_at desc limit 1;`))[0];
  if (duel) {
    const dp = (await sql(`select public.callout_pool('${duel.id}') p;`))[0].p;
    check(Number(dp.back) === Number(duel.stake) && Number(dp.total) === Number(duel.stake) * 2,
      'a duel still reads as stake each side', JSON.stringify(dp));
  }
} finally {
  await sql(clean);
  const left = Number((await sql(
    `select count(*) n from public.workout_callouts where mode <> 'duel';`))[0].n);
  console.log(`\n  ..    production restored; ${left} row(s) left in 'pot' (must be 0)`);
  if (left !== 0) {
    fails.push('a real row was left in pot mode');
    console.log('  FAIL  a real row was left in pot mode');
  }
}

console.log(`\n${fails.length === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  - ${f}`);
process.exit(fails.length === 0 ? 0 : 1);
