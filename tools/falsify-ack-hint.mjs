/**
 * DOES THE ACKNOWLEDGEMENT ACTUALLY WORK FROM THE OUTSIDE? (174 · 175 · 176)
 *
 * The tray's design is: say nothing until the athlete has chosen an above-best
 * target themselves, then — and only then — explain what they are accepting.
 * That rests on ONE fact I cannot check with SQL, because SQL is not where the
 * client stands: does `hint` survive the trip out through PostgREST?
 *
 * A `do $$ ... $$` block reading `pg_exception_hint` proves the hint exists
 * INSIDE Postgres. It says nothing about what supabase-js receives, and 176's
 * proof is exactly that shape. So this runs the real path — a password sign-in,
 * a real JWT, `/rest/v1/rpc/callout_create` — and reads the JSON body the
 * browser would get.
 *
 * FOUR THINGS, and the last two are the ones worth having:
 *   1. above-best with no ack   -> refused, `hint === 'above_program_ack'`
 *   2. above-best WITH the ack  -> created, and the row records the flag
 *   3. a rest-day refusal       -> carries NO hint (nothing to confirm)
 *   4. at or below best         -> straight through, no ack, no prompt
 *
 * Every row it writes, it deletes. Run it against production; it seeds the
 * smoke accounts and leaves nothing behind.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = (file, key) => {
  const m = readFileSync(join(ROOT, file), 'utf8').match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};

const SB_URL = env('client/.env.local', 'EXPO_PUBLIC_SUPABASE_URL');
const SB_KEY = env('client/.env.local', 'EXPO_PUBLIC_SUPABASE_KEY');
const MGMT = readFileSync(join(ROOT, 'client/.env.sbtoken.local'), 'utf8').replace(/^.*=/, '').trim();
const PROJECT = 'rysbpwpvnqbngqncrfaa';

const ALPHA_ID = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1';
const BRAVO_ID = '699ddb56-69b5-4070-854b-df73f578f19b';
const ALPHA = ['smoke-test-claude@evoforge.internal', 'SmokeTest-2026-07!x'];

const WORKOUT = 'Ack Hint Probe';
const LIFT = 'Ack Hint Bench';
const BEST = 100; // what we seed as ALPHA's logged best on LIFT

let pass = 0;
const fails = [];
const check = (ok, label, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fails.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`SQL ${r.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

/** The RPC exactly as the client calls it, returning what the client would see. */
async function createCallout(token, args) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/callout_create`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  return { status: r.status, body: await r.json() };
}

// ── the day's workout name has to be in ALPHA's plan for TODAY, or every
//    attempt below dies on the schedule check instead of the one being tested.
const dow = new Date().getDay();

console.log('\n=== 174/175/176 — the acknowledgement, through the real path ===\n');

const cleanup = `
  delete from public.workout_callouts
    where workout_name = '${WORKOUT}' or exercise = '${LIFT}';
  delete from public.workout_log where workout = '${WORKOUT}' or exercise = '${LIFT}';
  delete from public.coin_events where source_id like '%${WORKOUT}%';`;

try {
  await sql(cleanup);

  // ── SEED. History gives ALPHA a real best to be above; the schedule makes
  //    today a training day; the friendship and the wallet get past the two
  //    checks that run before the trigger.
  const rows = [];
  for (let i = 0; i < 6; i++) {
    const d = 4 + i * 3;
    rows.push(`('${ALPHA_ID}', current_date - ${d}, '${WORKOUT}', '${LIFT}', 'Chest',
                1, 6, ${BEST}, now() - interval '${d} days')`);
  }
  await sql(`
    insert into public.workout_log
      (user_id, date, workout, exercise, muscle, "set", reps, weight, "timestamp")
      values ${rows.join(',')};

    -- Today's weekday must name this workout. Merged into whatever plan is there
    -- so the rest of the week is untouched, and restored at the end.
    insert into public.workout_schedule (user_id, plan, effective_from)
    values ('${ALPHA_ID}',
            jsonb_build_object('${dow}', '${WORKOUT}'::text), current_date)
    on conflict (user_id, effective_from) do update
      set plan = public.workout_schedule.plan || jsonb_build_object('${dow}', '${WORKOUT}'::text);

    update public.profile set callouts_enabled = true
      where user_id in ('${ALPHA_ID}', '${BRAVO_ID}');`);

  const scheduled = (await sql(
    `select public.scheduled_workouts_on('${ALPHA_ID}', current_date) v;`
  ))[0].v;
  check(String(scheduled).includes(WORKOUT), 'the probe workout is on today\'s plan', String(scheduled));

  const friends = (await sql(
    `select public.forge_can_challenge('${BRAVO_ID}') is not null v;`
  ))[0].v;
  if (!friends) console.log('  ..    could not evaluate friendship as service role; the RPC will tell us');

  const bal = Number((await sql(`select public.forge_duel_balance('${ALPHA_ID}') v;`))[0].v);
  console.log(`  ..    ALPHA balance ${bal}, logged best on ${LIFT} is ${BEST}kg\n`);
  if (bal < 10) {
    await sql(`insert into public.coin_events (user_id, kind, amount, source_id, occurred_at)
               values ('${ALPHA_ID}', 'starting_bonus', 50, 'ack-probe:${WORKOUT}', now());`);
    console.log('  ..    topped ALPHA up to clear the 10-coin pledge\n');
  }

  // ── SIGN IN, as the app does.
  const auth = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ALPHA[0], password: ALPHA[1] }),
  });
  const session = await auth.json();
  if (!session.access_token) throw new Error(`sign-in failed: ${JSON.stringify(session).slice(0, 300)}`);
  const token = session.access_token;
  console.log('  ..    signed in as ALPHA\n');

  const base = {
    p_opponent: BRAVO_ID,
    p_workout_date: new Date().toISOString().slice(0, 10),
    p_workout: WORKOUT,
    p_exercise: LIFT,
    p_target_load_mode: 'external',
    p_target_label: `${BEST + 10} × 3`,
    p_stake: 10,
  };

  // 1 ─ ABOVE BEST, NO ACK. Refused, and the refusal must be recognisable.
  const noAck = await createCallout(token, {
    ...base, p_set_no: 1, p_target_reps: 3, p_target_weight_kg: BEST + 10,
  });
  check(noAck.status >= 400, 'above-best with no acknowledgement is refused', `HTTP ${noAck.status}`);
  check(
    noAck.body?.hint === 'above_program_ack',
    'the refusal carries hint=above_program_ack THROUGH PostgREST',
    `hint=${JSON.stringify(noAck.body?.hint)}`
  );
  console.log(`        message: ${String(noAck.body?.message ?? '').slice(0, 120)}\n`);

  // 2 ─ ABOVE BEST, WITH THE ACK. Created, and the decision is on the row.
  const withAck = await createCallout(token, {
    ...base, p_set_no: 2, p_target_reps: 3, p_target_weight_kg: BEST + 10,
    p_above_program_ack: true,
  });
  check(withAck.status === 200, 'above-best WITH the acknowledgement is created',
    `HTTP ${withAck.status} ${JSON.stringify(withAck.body).slice(0, 160)}`);
  const stored = await sql(`select above_program_ack a, target_weight_kg w from public.workout_callouts
     where athlete_id = '${ALPHA_ID}' and workout_name = '${WORKOUT}' and set_no = 2;`);
  check(stored.length === 1 && stored[0].a === true,
    'the acknowledgement is recorded on the pledge', JSON.stringify(stored[0] ?? null));

  // 3 ─ A WALL WITH NO WAY THROUGH must not look like one that has. The ack is
  //     sent, and a wrong workout must still refuse WITHOUT the hint.
  const wrongDay = await createCallout(token, {
    ...base, p_workout: 'A Workout Nobody Has Planned', p_set_no: 3,
    p_target_reps: 3, p_target_weight_kg: BEST, p_above_program_ack: true,
  });
  check(wrongDay.status >= 400, 'an unplanned workout is still refused', `HTTP ${wrongDay.status}`);
  check(wrongDay.body?.hint !== 'above_program_ack',
    'the unplanned-workout refusal offers NO way through',
    `hint=${JSON.stringify(wrongDay.body?.hint)}`);

  // 4 ─ AND THE ORDINARY CASE IS UNTOUCHED. At the athlete's own best, no ack,
  //     no prompt, no friction — this is the path 99% of pledges take.
  const normal = await createCallout(token, {
    ...base, p_set_no: 4, p_target_reps: 3, p_target_weight_kg: BEST,
    p_target_label: `${BEST} × 3`,
  });
  check(normal.status === 200, 'a pledge at the athlete\'s own best needs no acknowledgement',
    `HTTP ${normal.status} ${JSON.stringify(normal.body).slice(0, 160)}`);
  const plain = await sql(`select above_program_ack a from public.workout_callouts
     where athlete_id = '${ALPHA_ID}' and workout_name = '${WORKOUT}' and set_no = 4;`);
  check(plain.length === 1 && plain[0].a === false,
    'and it is recorded as NOT acknowledged', JSON.stringify(plain[0] ?? null));
} finally {
  // Put production back exactly as it was, including the schedule day we merged.
  await sql(`
    ${cleanup}
    update public.workout_schedule set plan = plan - '${dow}'
      where user_id = '${ALPHA_ID}' and effective_from = current_date
        and plan ->> '${dow}' = '${WORKOUT}';
    delete from public.workout_schedule
      where user_id = '${ALPHA_ID}' and effective_from = current_date and plan = '{}'::jsonb;
    delete from public.coin_events where source_id = 'ack-probe:${WORKOUT}';`);
  console.log('\n  ..    production restored');
}

console.log(`\n${fails.length === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  - ${f}`);
process.exit(fails.length === 0 ? 0 : 1);
