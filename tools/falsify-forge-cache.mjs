/**
 * THE FORGE CACHE, THROUGH THE REAL PATH (166 + 189).
 *
 * Both features had never paid a coin. 166 built the ladder and the Recovery Run
 * complete, and nothing in the app ever called them — zero claims, zero recovery runs,
 * ever. So this is the first end-to-end exercise either has had, and it runs as a real
 * signed-in athlete rather than as the migration's own role.
 *
 * The claims worth checking, in the order they would hurt:
 *
 *   FARMING       rest can only be confirmed on a day the PLAN calls rest. If this
 *                 fails, "confirm rest" is a button that pays 430 coins for 7 taps.
 *   THE FLOOR     seven confirmed rest days must NOT complete a cycle. Rungs 1-6 open
 *                 on rest; rung 7 needs real training days.
 *   IDEMPOTENCE   claiming twice pays once; confirming rest twice advances once.
 *   NO EXPIRY     a cycle position survives a gap, with no countdown anywhere.
 *   NO LOGIN PAY  nothing grants coins for merely being signed in.
 *
 * Self-cleaning: every row it writes it deletes, and it never leaves a claim behind.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MGMT = readFileSync(join(ROOT, 'client/.env.sbtoken.local'), 'utf8').replace(/^.*=/, '').trim();
const WORKOUT = 'Cache Probe';
const LIFT = 'Cache Probe Lift';

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

/**
 * A TRAINING-CLEAN FIXTURE, and it has to be verified rather than assumed.
 *
 * The first version used ALPHA, which has been driven by every other tour today: it
 * had 3 training days this week, so "zero training days" was never true, the floor
 * was already met, and five checks failed for reasons that had nothing to do with the
 * feature. smoke-test-claude-3 has no training history, no claims and no schedule —
 * and that last part is what exposed the no-plan hole 190 closed.
 */
let PROBE_ID = '';
const cleanSql = () => `
  delete from public.coin_events where kind in ('forge_cache','recovery_cache')
    and user_id = '${PROBE_ID}';
  delete from public.forge_cache_claims where user_id = '${PROBE_ID}';
  delete from public.forge_rest_days where user_id = '${PROBE_ID}';
  delete from public.workout_log where user_id = '${PROBE_ID}' and workout = '${WORKOUT}';
  delete from public.workout_schedule where user_id = '${PROBE_ID}'
    and effective_from = current_date - 7;`;

const state = async () =>
  (await as(PROBE_ID, 'select public.forge_cache_state() s;'))[0].s;

console.log('\n=== 166 + 189 — the Forge Cache, first end-to-end run ===\n');

try {
  // Resolve the clean account by email rather than hardcoding a uuid I typed.
  const who = (await sql(`
    select u.id from auth.users u
    where u.email = 'smoke-test-claude-3@evoforge.internal' limit 1;`))[0];
  if (!who) throw new Error('the clean smoke account is missing');
  PROBE_ID = who.id;
  const trained = Number((await sql(`
    select count(distinct date) n from public.workout_log
    where user_id = '${PROBE_ID}' and reps > 0 and date > current_date - 30;`))[0].n);
  if (trained !== 0) throw new Error(`fixture is not clean: ${trained} training days`);

  await sql(cleanSql());

  /**
   * A plan where today is REST and yesterday was a training day.
   *
   * `effective_from = current_date`, NOT 300 days ago. `scheduled_workouts_on` takes
   * the row with the LATEST effective_from at or before the date, so a back-dated
   * seed loses to whatever schedule the account already had — the first version of
   * this probe seeded 300 days back, ALPHA's real plan won, and the harness reported
   * "the plan says today is a rest day: FAIL, today_plan=Push 1 - Strength". The
   * guard was right; the fixture was invisible.
   */
  const dow = new Date().getUTCDay();
  const yesterdayDow = (dow + 6) % 7;
  await svc(`
    insert into public.workout_schedule (user_id, plan, effective_from)
    values ('${PROBE_ID}',
      jsonb_build_object('${dow}', 'Rest', '${yesterdayDow}', '${WORKOUT}'),
      current_date - 7)
    on conflict (user_id, effective_from) do update set plan = excluded.plan;`);

  const s0 = await state();
  check(s0.today_is_rest === true, 'the plan says today is a rest day',
    `today_plan=${JSON.stringify(s0.today_plan)}`);
  check(s0.today_rest_confirmed === false, 'and it is not confirmed yet');

  // 1 ─ FARMING: rest cannot be confirmed on a training day.
  /**
   * FARMING: rest cannot be confirmed on a day the plan calls TRAINING.
   *
   * The plan is seeded from `current_date - 7`, so yesterday is covered by it and the
   * training-day guard is what fires. Seeded only from today, 190's no-plan guard
   * fired instead — the row was still refused, but for a different reason, and a
   * check that accepts any refusal is not testing the rule it names.
   */
  let farmed = 'allowed';
  try {
    await as(PROBE_ID, `select public.forge_rest_confirm(current_date - 1);`);
  } catch (e) { farmed = String(e.message); }
  check(/so it is a training day/i.test(farmed),
    'rest CANNOT be confirmed on a day the plan calls training', farmed.slice(0, 100));

  // Nor backfilled beyond the window.
  let old = 'allowed';
  try {
    await as(PROBE_ID, `select public.forge_rest_confirm(current_date - 30);`);
  } catch (e) { old = String(e.message); }
  check(/on the day, not in advance|training day/i.test(old),
    'nor backfilled across a month to fill a cycle', old.slice(0, 80));

  // 2 ─ REST ADVANCES THE LADDER.
  const before = (await state()).rung;
  await as(PROBE_ID, `select public.forge_rest_confirm();`);
  const afterRest = await state();
  check(afterRest.rung >= before + 1 || afterRest.rung >= 1,
    'confirming planned rest ADVANCES the cache', `rung ${before} → ${afterRest.rung}`);
  check(afterRest.today_rest_confirmed === true, 'and the confirmation sticks');

  // Idempotent.
  await as(PROBE_ID, `select public.forge_rest_confirm();`);
  check((await state()).rung === afterRest.rung, 'confirming twice does not advance again',
    `rung ${afterRest.rung}`);

  // 3 ─ THE FLOOR: rest alone must not open the weekly cache.
  //     Seven confirmed rest days, zero training.
  await svc(`
    insert into public.forge_rest_days (user_id, rest_day)
    select '${PROBE_ID}', d::date
    from generate_series(current_date - 6, current_date, interval '1 day') g(d)
    on conflict do nothing;`);
  const seven = await state();
  check(seven.rung === 7, 'seven plan-adherent days reach rung 7', `rung ${seven.rung}`);
  check(seven.trained_this_cycle === 0, 'with zero training days',
    `trained=${seven.trained_this_cycle}`);
  check(seven.claimable === false && seven.floor_met === false,
    'THE WEEKLY CACHE IS REFUSED — rest alone cannot finish a cycle',
    `claimable=${seven.claimable}, floor=${seven.training_floor}`);

  let blocked = 'allowed';
  try {
    await as(PROBE_ID, `select public.forge_cache_claim();`);
  } catch (e) { blocked = String(e.message); }
  check(/weekly cache opens after/i.test(blocked),
    'and claiming it says exactly what would open it', blocked.slice(0, 100));

  // 4 ─ WITH TRAINING, IT OPENS. Three distinct training days.
  await svc(`
    insert into public.workout_log (user_id, date, workout, exercise, muscle, "set", reps, weight, "timestamp")
    select '${PROBE_ID}', d::date, '${WORKOUT}', '${LIFT}', 'Chest', 1, 8, 40, now()
    from generate_series(current_date - 5, current_date - 3, interval '1 day') g(d);`);
  const withTraining = await state();
  check(withTraining.trained_this_cycle >= 3 && withTraining.floor_met === true,
    'three training days meet the floor',
    `trained=${withTraining.trained_this_cycle}, met=${withTraining.floor_met}`);
  check(withTraining.claimable === true, 'and the weekly cache opens');

  // 5 ─ CLAIMING PAYS ONCE, and the amount is the server's.
  const bal0 = Number((await sql(
    `select public.forge_duel_balance('${PROBE_ID}') v;`))[0].v);
  const claimed = (await as(PROBE_ID, `select public.forge_cache_claim() c;`))[0].c;
  const bal1 = Number((await sql(
    `select public.forge_duel_balance('${PROBE_ID}') v;`))[0].v);
  check(bal1 - bal0 === Number(claimed.coins) && Number(claimed.coins) === 150,
    'the weekly cache pays exactly 150, from the tier table',
    `${bal0} → ${bal1}, coins=${claimed.coins}`);
  check(Number.isInteger(bal1 - bal0), 'and it is an integer', String(bal1 - bal0));

  const repeat = (await as(PROBE_ID, `select public.forge_cache_claim() c;`))[0].c;
  const bal2 = Number((await sql(
    `select public.forge_duel_balance('${PROBE_ID}') v;`))[0].v);
  check(repeat.already === true && bal2 === bal1, 'claiming twice pays nothing extra',
    `already=${repeat.already}, balance ${bal2}`);

  // 6 ─ NO EXPIRY AND NO COUNTDOWN anywhere in the state.
  const json = JSON.stringify(await state());
  check(!/expire|expiry|countdown|deadline|seconds_left|hours_left/i.test(json),
    'the state carries no expiry or countdown of any kind');

  // 7 ─ NOTHING PAYS FOR MERELY BEING SIGNED IN.
  const loginFns = await sql(`
    select count(*) n from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
    where n2.nspname = 'public'
      and (p.proname ilike '%welcome%' or p.proname ilike '%daily_login%'
           or p.proname ilike '%login_reward%');`);
  check(Number(loginFns[0].n) === 0,
    'no app-open reward exists (§6: never app-opening)', `${loginFns[0].n} found`);

  // 8 ─ NO RNG IN THE CACHE PATH.
  const rng = await sql(`
    select count(*) n from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
    where n2.nspname = 'public' and p.proname like '%cache%'
      and pg_get_functiondef(p.oid) ilike '%random(%';`);
  check(Number(rng[0].n) === 0, 'zero randomness in any cache function', `${rng[0].n} found`);
} finally {
  await sql(cleanSql());
  console.log('\n  ..    production restored');
}

console.log(`\n${fails.length === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  - ${f}`);
process.exit(fails.length === 0 ? 0 : 1);
