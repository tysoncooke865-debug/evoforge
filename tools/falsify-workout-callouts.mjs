/**
 * Falsify LIVE WORKOUT CALL OUTS against production.
 *
 * Every step runs as a real athlete (request.jwt.claims), so the SECURITY
 * DEFINER bodies do their own authorisation exactly as they would for a client.
 * Self-cleaning and re-runnable: it clears its own footprints first, because an
 * absolute assertion only ever passes on a virgin database.
 *
 *   node tools/falsify-workout-callouts.mjs
 *
 * The companion is tools/tour-workout-callouts.mjs. Run BOTH. This one proves
 * the server is right; that one proves an athlete can reach it.
 */
import { readFileSync } from 'node:fs';

const TOKEN = readFileSync(new URL('../client/.env.sbtoken.local', import.meta.url), 'utf8')
  .trim().replace(/^[A-Z_]+=/, '').replace(/^["']|["']$/g, '');
const PROJECT = 'rysbpwpvnqbngqncrfaa';

const ALPHA = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1';   // the athlete
const BRAVO = '699ddb56-69b5-4070-854b-df73f578f19b';   // the doubter
const CHARLIE = '493924db-fe1d-458c-abc3-21202fcb5848'; // a third party
const STRANGER = '00000000-0000-4000-8000-0000000000ff'; // nobody's friend

const WORKOUT = 'Callout Smoke';
const LIFT = 'Callout Bench';
const BW_LIFT = 'Callout Pull-Up';

async function raw(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).message; } catch { /* keep raw */ }
    throw new Error(String(msg).replace(/\s+/g, ' ').trim());
  }
  return JSON.parse(text);
}

const as = (user, sql) =>
  raw(`select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true);\n${sql}`);
const svc = (sql) =>
  raw(`select set_config('request.jwt.claims', '{"role":"service_role"}', true);\n${sql}`);

/**
 * AS AN ATHLETE, *AND* UNDER RLS.
 *
 * `as()` only sets the JWT claims — the management API still runs as the table
 * OWNER, and Postgres exempts an owner from row-level security unless the table
 * is FORCEd. So a policy test written with `as()` reads every row and passes
 * whatever the policy says, which is the most dangerous shape a security test
 * can have. `set local role authenticated` drops the exemption, and the
 * statement then meets exactly the policy a signed-in client meets.
 */
const asRls = (user, sql) =>
  raw(`set local role authenticated;
       select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true);\n${sql}`);

let pass = 0;
let fail = 0;
const failures = [];
function ok(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; failures.push(label); console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
}
async function refused(label, fn, expect) {
  try {
    await fn();
    fail++; failures.push(label); console.log(`  FAIL  ${label} — it was allowed`);
  } catch (e) {
    const m = String(e.message).replace(/^Failed to run sql query: ERROR:\s*\S+\s*/, '');
    if (!expect || new RegExp(expect, 'i').test(m)) {
      pass++; console.log(`  PASS  ${label} — "${m.split('CONTEXT')[0].trim().slice(0, 90)}"`);
    } else {
      fail++; failures.push(label); console.log(`  FAIL  ${label} — wrong refusal: ${m.slice(0, 160)}`);
    }
  }
}

const one = (rows) => rows[0];
const bal = async (u) => Number(one(await svc(`select public.forge_duel_balance('${u}') v;`)).v);
const row = async (id) => one(await svc(`select * from public.workout_callouts where id = '${id}';`));

/** Create a call out as ALPHA on BRAVO. Returns the id. */
async function call(opts = {}) {
  const {
    setNo = 1, reps = 5, mode = 'external', kg = 100, label = '100 KG × 5+',
    stake = 25, p = 0.63, exercise = LIFT, athlete = ALPHA, opponent = BRAVO,
    date = 'current_date',
  } = opts;
  const r = one(await as(athlete, `select public.callout_create(
    '${opponent}', ${date}, '${WORKOUT}', '${exercise}', ${setNo}, ${reps},
    '${mode}', ${kg === null ? 'null' : kg}, '${label}', ${stake}, ${p}, 'v1',
    '{"recent_best":"100 x 4"}'::jsonb) v;`)).v;
  return r.callout_id;
}

/**
 * Does this database know about migration 133's load columns?
 *
 * As of 2026-08-08 production does NOT — `workout_log` is still the legacy 13
 * columns, and the client's set-save path already retries without them. The
 * harness asks rather than assumes, so the same file proves the trigger on
 * either schema instead of passing on one and crashing on the other.
 */
let HAS_133 = false;

/** Log a set as ALPHA — exactly what the app's LOG button produces. */
async function logSet(opts = {}) {
  const { setNo = 1, reps = 6, kg = 100, mode = 'external', exercise = LIFT,
          externalKg = null, assistKg = null } = opts;
  const cols = HAS_133
    ? `, load_mode, external_load_kg, assistance_kg`
    : '';
  const vals = HAS_133
    ? `, '${mode}', ${externalKg === null ? 'null' : externalKg}, ${assistKg === null ? 'null' : assistKg}`
    : '';
  await as(ALPHA, `insert into public.workout_log
    (date, workout, exercise, muscle, "set", reps, weight${cols})
    values (current_date, '${WORKOUT}', '${exercise}', 'Chest', ${setNo}, ${reps}, ${kg}${vals});`);
}

async function wipe() {
  await svc(`
    delete from public.coin_events
      where kind in ('callout_stake','callout_payout')
        and user_id in ('${ALPHA}','${BRAVO}','${CHARLIE}');
    delete from public.workout_callouts
      where athlete_id in ('${ALPHA}','${BRAVO}','${CHARLIE}')
         or opponent_id in ('${ALPHA}','${BRAVO}','${CHARLIE}');
    delete from public.workout_log where workout = '${WORKOUT}';
    delete from public.social_notifications where type like 'callout_%';
    update public.profile set callouts_enabled = true
      where user_id in ('${ALPHA}','${BRAVO}','${CHARLIE}');`);
}

console.log('\n=== LIVE WORKOUT CALL OUTS — falsification against production ===\n');

await wipe();
HAS_133 = Number(one(await svc(
  `select count(*)::int n from information_schema.columns
   where table_name = 'workout_log' and column_name = 'load_mode';`)).n) > 0;
console.log(HAS_133
  ? 'schema   workout_log HAS migration 133 load modes'
  : 'schema   workout_log is PRE-133 (legacy weight/reps only) — the legacy judge path is live');
const cfg = one(await svc('select * from public.workout_callout_config where id;'));
const b0 = { A: await bal(ALPHA), B: await bal(BRAVO), C: await bal(CHARLIE) };
console.log(`opening  ALPHA ${b0.A}  BRAVO ${b0.B}  CHARLIE ${b0.C}`);
console.log(`config   stake ${cfg.min_stake}-${cfg.max_stake}  offer ${cfg.offer_minutes}m  ` +
            `attempt ${cfg.attempt_hours}h  verify ${cfg.verify_hours}h  dispute ${cfg.dispute_hours}h\n`);

// ── 1. CREATE — a call moves nothing ────────────────────────────────────────
console.log('1. CREATE — the proposition comes from the logger, and no coin moves');
const c1 = await call({ stake: 25 });
ok('a call out is created', Boolean(c1), c1);
ok('no coins moved on create', (await bal(ALPHA)) === b0.A && (await bal(BRAVO)) === b0.B);
ok('it starts as an offer', (await row(c1)).status === 'offered');
ok('the offer carries a deadline', new Date((await row(c1)).expires_at) > new Date());
ok('the opponent was told', Number(one(await svc(
  `select count(*)::int n from public.social_notifications
   where user_id = '${BRAVO}' and type = 'callout_offered';`)).n) === 1);

await refused('a second live call from the same athlete is refused',
  () => call({ setNo: 2 }), 'already have a call out running');
await refused('a stake above the configured maximum is refused',
  () => call({ setNo: 2, stake: cfg.max_stake + 1 }), `between ${cfg.min_stake} and ${cfg.max_stake}`);
await refused('a stake below the configured minimum is refused',
  () => call({ setNo: 2, stake: 0 }), 'between');
await refused('calling a stranger is refused',
  () => call({ setNo: 2, opponent: STRANGER }), 'only call out a friend');
await refused('calling yourself is refused',
  () => call({ setNo: 2, opponent: ALPHA }), 'only call out a friend');
await refused('a duration set cannot be called',
  () => call({ setNo: 2, mode: 'duration' }), 'cannot be called');
await refused('a date that is not today is refused',
  () => call({ setNo: 2, date: "current_date - 30" }), 'is not today');
await refused('set 0 is not a working set',
  () => call({ setNo: 0 }), 'not a working set');

// The one-live index is the REAL rule; prove it holds even past the body's check.
await refused('the one-live-call index refuses a second row at the storage layer',
  () => svc(`insert into public.workout_callouts
      (athlete_id, opponent_id, initiated_by, workout_date, workout_name, exercise, set_no,
       target_reps, target_label, stake, hit_probability, odds_model_version, expires_at)
      values ('${ALPHA}','${BRAVO}','${ALPHA}', current_date, '${WORKOUT}', '${LIFT}', 3,
              5, 'x', 25, 0.5, 'v1', now() + interval '1 hour');`),
  'duplicate key|workout_callouts_one_live');

// ── 2. THE OPT-OUT IS A REAL FENCE ──────────────────────────────────────────
console.log('\n2. OPT-OUT — a serious logger cannot be called out at all');
await svc(`update public.workout_callouts set status = 'cancelled' where id = '${c1}';`);
await svc(`update public.profile set callouts_enabled = false where user_id = '${BRAVO}';`);
await refused('an athlete who switched call outs off cannot be targeted',
  () => call({ setNo: 2 }), 'switched off');
await svc(`update public.profile set callouts_enabled = true where user_id = '${BRAVO}';
           update public.profile set callouts_enabled = false where user_id = '${ALPHA}';`);
await refused('an athlete who switched them off cannot call either',
  () => call({ setNo: 2 }), 'your call outs are switched off');
await svc(`update public.profile set callouts_enabled = true where user_id = '${ALPHA}';`);

// ── 3. ACCEPT — the only place coins move ───────────────────────────────────
console.log('\n3. DOUBT — acceptance is the only place coins move');
const c2 = await call({ setNo: 1, reps: 5, kg: 100, stake: 25, label: '100 KG × 5+' });
await refused('a third party cannot accept',
  () => as(CHARLIE, `select public.callout_respond('${c2}', true);`), 'only the athlete you called');
await refused('the athlete cannot accept their own call',
  () => as(ALPHA, `select public.callout_respond('${c2}', true);`), 'only the athlete you called');

const acc = one(await as(BRAVO, `select public.callout_respond('${c2}', true) v;`)).v;
ok('accepting reports the pot', Number(acc.pot) === 50, JSON.stringify(acc.pot));
ok('the athlete is 25 lighter', (await bal(ALPHA)) === b0.A - 25);
ok('the opponent is 25 lighter', (await bal(BRAVO)) === b0.B - 25);
ok('the status is accepted', (await row(c2)).status === 'accepted');
ok('the deadline was re-armed for the attempt', (await row(c2)).accepted_at !== null);

const again = one(await as(BRAVO, `select public.callout_respond('${c2}', true) v;`)).v;
ok('a doubled accept is a no-op', again.already === true);
ok('and escrows nothing more', (await bal(ALPHA)) === b0.A - 25 && (await bal(BRAVO)) === b0.B - 25);
ok('the ledger holds exactly two stake rows', Number(one(await svc(
  `select count(*)::int n from public.coin_events
   where kind = 'callout_stake' and source_id = '${c2}';`)).n) === 2);

// ── 4. THE TERMS ARE FROZEN ─────────────────────────────────────────────────
console.log('\n4. SNAPSHOT — accepted terms cannot be edited underneath the wager');
await svc(`update public.workout_callouts
           set stake = 5, target_reps = 1, target_weight_kg = 20, exercise = 'Something Else'
           where id = '${c2}';`);
const frozen = await row(c2);
ok('the stake is frozen after acceptance', Number(frozen.stake) === 25);
ok('the rep target is frozen', Number(frozen.target_reps) === 5);
ok('the load is frozen', Number(frozen.target_weight_kg) === 100);
ok('the exercise is frozen', frozen.exercise === LIFT);

// ── 5. THE LOGGER ANSWERS THE CALL ──────────────────────────────────────────
console.log('\n5. LOG — the normal set-completion tap resolves the proposition');
await logSet({ setNo: 1, reps: 6, kg: 100 });
const logged = await row(c2);
ok('the call moved to awaiting verification', logged.status === 'awaiting_verification');
ok('the result is a hit', logged.result === 'hit');
ok('the logged reps were read off the row', Number(logged.actual_reps) === 6);
ok('the logged load was read off the row', Number(logged.actual_weight_kg) === 100);
ok('the workout_log row is referenced', Boolean(logged.workout_log_id));
ok('no coins moved on logging', (await bal(ALPHA)) === b0.A - 25 && (await bal(BRAVO)) === b0.B - 25);
ok('the opponent was asked to verify', Number(one(await svc(
  `select count(*)::int n from public.social_notifications
   where user_id = '${BRAVO}' and type = 'callout_logged';`)).n) === 1);

console.log('   an edit corrects the result rather than leaving a stale one');
await svc(`update public.workout_log set reps = 3
           where user_id = '${ALPHA}' and workout = '${WORKOUT}' and exercise = '${LIFT}' and "set" = 1;`);
ok('editing the set down turns the hit into a miss', (await row(c2)).result === 'miss');
await svc(`update public.workout_log set reps = 6
           where user_id = '${ALPHA}' and workout = '${WORKOUT}' and exercise = '${LIFT}' and "set" = 1;`);
ok('editing it back restores the hit', (await row(c2)).result === 'hit');

// ── 6. VERIFY — nothing pays without the opponent ───────────────────────────
console.log('\n6. VERIFY — the athlete can never certify their own win');
await refused('the athlete cannot verify their own set',
  () => as(ALPHA, `select public.callout_verify('${c2}', 'verify');`), 'only the athlete who doubted');
await refused('a third party cannot verify',
  () => as(CHARLIE, `select public.callout_verify('${c2}', 'verify');`), 'only the athlete who doubted');
await refused('a made-up verdict is refused',
  () => as(BRAVO, `select public.callout_verify('${c2}', 'pay me');`), 'not a verdict');

const settled = one(await as(BRAVO, `select public.callout_verify('${c2}', 'verify') v;`)).v;
ok('verification settles it', settled.status === 'settled');
ok('the winner is the athlete on a hit', settled.winner_id === ALPHA);
ok('the athlete takes the whole pot', (await bal(ALPHA)) === b0.A + 25, `${await bal(ALPHA)} vs ${b0.A + 25}`);
ok('the opponent is down their stake', (await bal(BRAVO)) === b0.B - 25);
ok('the call out ledger nets to zero', Number(one(await svc(
  `select coalesce(sum(amount),0)::int n from public.coin_events
   where split_part(source_id, ':', 1) = '${c2}';`)).n) === 0);

const replay = one(await as(BRAVO, `select public.callout_verify('${c2}', 'verify') v;`)).v;
ok('a replayed verification is a no-op', replay.already === true);
ok('and pays nothing more', (await bal(ALPHA)) === b0.A + 25);

await svc(`update public.workout_callouts set result = 'miss', status = 'awaiting_verification'
           where id = '${c2}';`);
ok('a settled result cannot be rewritten', (await row(c2)).status === 'settled',
   `guard held: ${(await row(c2)).result}`);

// ── 7. A MISS PAYS THE DOUBTER ──────────────────────────────────────────────
console.log('\n7. MISS — the doubter takes the pot');
const b1 = { A: await bal(ALPHA), B: await bal(BRAVO) };
const c3 = await call({ setNo: 2, reps: 8, kg: 100, stake: 50, label: '100 KG × 8+' });
await as(BRAVO, `select public.callout_respond('${c3}', true);`);
await logSet({ setNo: 2, reps: 4, kg: 100 });
ok('four reps against a call of eight is a miss', (await row(c3)).result === 'miss');
await as(BRAVO, `select public.callout_verify('${c3}', 'verify');`);
ok('the doubter takes the pot', (await bal(BRAVO)) === b1.B + 50);
ok('the athlete is down their stake', (await bal(ALPHA)) === b1.A - 50);
ok('that ledger nets to zero too', Number(one(await svc(
  `select coalesce(sum(amount),0)::int n from public.coin_events
   where split_part(source_id, ':', 1) = '${c3}';`)).n) === 0);

console.log('   the reps alone are not the bet — the LOAD is part of it');
const b2 = { A: await bal(ALPHA), B: await bal(BRAVO) };
const c4 = await call({ setNo: 3, reps: 5, kg: 100, stake: 25, label: '100 KG × 5+' });
await as(BRAVO, `select public.callout_respond('${c4}', true);`);
await logSet({ setNo: 3, reps: 12, kg: 60 });
ok('twelve reps at a lighter load is still a miss', (await row(c4)).result === 'miss');
await as(BRAVO, `select public.callout_verify('${c4}', 'verify');`);
ok('and the doubter is paid', (await bal(BRAVO)) === b2.B + 25);

// ── 8. THE OFFER DIES WHEN THE SET IS DONE ──────────────────────────────────
console.log('\n8. NOBODY BETS ON A SET THAT ALREADY HAPPENED');
const b3 = { A: await bal(ALPHA), B: await bal(BRAVO) };
const c5 = await call({ setNo: 4, reps: 5, kg: 100, stake: 25 });
await logSet({ setNo: 4, reps: 9, kg: 100 });
ok('an unanswered offer expires the moment the set lands', (await row(c5)).status === 'expired');
const dead = one(await as(BRAVO, `select public.callout_respond('${c5}', true) v;`)).v;
ok('and it can no longer be accepted', dead.already === true && dead.status === 'expired',
   JSON.stringify(dead));
ok('no coins moved on the dead offer', (await bal(ALPHA)) === b3.A && (await bal(BRAVO)) === b3.B);
await refused('a set that is already logged cannot be called',
  () => call({ setNo: 4, reps: 5 }), 'already logged');

// ── 9. DECLINE ──────────────────────────────────────────────────────────────
console.log('\n9. DECLINE and CANCEL — nothing moved, so nothing is lost');
const c6 = await call({ setNo: 5, reps: 5, stake: 25 });
const dec = one(await as(BRAVO, `select public.callout_respond('${c6}', false) v;`)).v;
ok('declining is recorded', dec.status === 'declined');
ok('and costs nobody anything', (await bal(ALPHA)) === b3.A && (await bal(BRAVO)) === b3.B);

const c7 = await call({ setNo: 6, reps: 5, stake: 25 });
await refused('the opponent cannot cancel the athlete\'s offer',
  () => as(BRAVO, `select public.callout_cancel('${c7}');`), 'only the athlete who called');
ok('the athlete may withdraw an unanswered offer',
  one(await as(ALPHA, `select public.callout_cancel('${c7}') v;`)).v.status === 'cancelled');
ok('withdrawing costs nothing', (await bal(ALPHA)) === b3.A);

// ── 10. DISPUTE — the pot freezes and pays nobody ───────────────────────────
console.log('\n10. DISPUTE — frozen, and no automatic payout to anybody');
const c8 = await call({ setNo: 7, reps: 5, kg: 100, stake: 25 });
await as(BRAVO, `select public.callout_respond('${c8}', true);`);
await logSet({ setNo: 7, reps: 7, kg: 100 });
const disputed = one(await as(BRAVO, `select public.callout_verify('${c8}', 'dispute', 'Did not see it') v;`)).v;
ok('a dispute freezes the call', disputed.status === 'disputed');
ok('and pays nobody', (await bal(ALPHA)) === b3.A - 25 && (await bal(BRAVO)) === b3.B - 25);
ok('the reason is kept', (await row(c8)).dispute_reason === 'Did not see it');
ok('a disputed call does not block the next one',
   Boolean(await call({ setNo: 8, reps: 5, stake: 25 }).then((id) =>
     svc(`update public.workout_callouts set status='cancelled' where id='${id}';`).then(() => true))));

console.log('    calling it off needs BOTH signatures');
const half = one(await as(ALPHA, `select public.callout_call_off('${c8}') v;`)).v;
ok('one side asking is only a request', half.awaiting_other_side === true);
ok('and refunds nothing yet', (await bal(ALPHA)) === b3.A - 25);
const done = one(await as(BRAVO, `select public.callout_call_off('${c8}') v;`)).v;
ok('both sides asking refunds both', done.status === 'cancelled');
ok('the athlete has their stake back', (await bal(ALPHA)) === b3.A);
ok('the opponent has theirs back', (await bal(BRAVO)) === b3.B);
ok('that ledger nets to zero', Number(one(await svc(
  `select coalesce(sum(amount),0)::int n from public.coin_events
   where split_part(source_id, ':', 1) = '${c8}';`)).n) === 0);

// ── 11. TIMEOUTS — silence never pays ───────────────────────────────────────
console.log('\n11. TIMEOUTS — every one of them refunds BOTH, and none of them pays');
const b4 = { A: await bal(ALPHA), B: await bal(BRAVO) };

const t1 = await call({ setNo: 1, exercise: 'Callout Row', reps: 5, stake: 25 });
await svc(`update public.workout_callouts set expires_at = now() - interval '1 minute' where id = '${t1}';`);
await as(ALPHA, `select public.callout_sweep();`);
ok('an unanswered offer expires', (await row(t1)).status === 'expired');
ok('and nothing was moved to return', (await bal(ALPHA)) === b4.A);

const t2 = await call({ setNo: 2, exercise: 'Callout Row', reps: 5, stake: 25 });
await as(BRAVO, `select public.callout_respond('${t2}', true);`);
await svc(`update public.workout_callouts set expires_at = now() - interval '1 minute' where id = '${t2}';`);
await as(ALPHA, `select public.callout_sweep();`);
ok('a call the athlete never attempted expires', (await row(t2)).status === 'expired');
ok('the athlete is refunded', (await bal(ALPHA)) === b4.A);
ok('the doubter is refunded', (await bal(BRAVO)) === b4.B);

const t3 = await call({ setNo: 3, exercise: 'Callout Row', reps: 5, kg: 100, stake: 25 });
await as(BRAVO, `select public.callout_respond('${t3}', true);`);
await logSet({ setNo: 3, exercise: 'Callout Row', reps: 9, kg: 100 });
ok('the athlete hit it', (await row(t3)).result === 'hit');
await svc(`update public.workout_callouts set expires_at = now() - interval '1 minute' where id = '${t3}';`);
await as(ALPHA, `select public.callout_sweep();`);
ok('an unverified WIN still does not pay the athlete', (await bal(ALPHA)) === b4.A,
   `balance ${await bal(ALPHA)}, opening ${b4.A}`);
ok('both sides are refunded instead', (await bal(BRAVO)) === b4.B);
ok('the status says it expired', (await row(t3)).status === 'expired');

const t4 = await call({ setNo: 4, exercise: 'Callout Row', reps: 5, kg: 100, stake: 25 });
await as(BRAVO, `select public.callout_respond('${t4}', true);`);
await logSet({ setNo: 4, exercise: 'Callout Row', reps: 9, kg: 100 });
await as(BRAVO, `select public.callout_verify('${t4}', 'dispute', 'Was not there');`);
await svc(`update public.workout_callouts set expires_at = now() - interval '1 minute' where id = '${t4}';`);
await as(ALPHA, `select public.callout_sweep();`);
ok('an abandoned dispute refunds both', (await bal(ALPHA)) === b4.A && (await bal(BRAVO)) === b4.B);
ok('a swept refund cannot run twice',
   await as(ALPHA, `select public.callout_sweep();`).then(async () => (await bal(ALPHA)) === b4.A));

// ── 12. THE JUDGE — every 133 load mode, decided as a mode ──────────────────
console.log('\n12. THE JUDGE — bodyweight is decided as bodyweight, never as 0 kg');
const judge = (t, kg, reps, am, w, assist, ext, ar) =>
  svc(`select public.callout_judge('${t}', ${kg === null ? 'null' : kg}, ${reps},
       '${am}', ${w === null ? 'null' : w}, ${assist === null ? 'null' : assist},
       ${ext === null ? 'null' : ext}, ${ar}) v;`).then((r) => one(r).v);
ok('external: enough reps at the load is a hit', (await judge('external', 100, 5, 'external', 100, null, null, 5)) === 'hit');
ok('external: more weight and enough reps is a hit', (await judge('external', 100, 5, 'external', 105, null, null, 5)) === 'hit');
ok('external: one rep short is a miss', (await judge('external', 100, 5, 'external', 100, null, null, 4)) === 'miss');
ok('external: a lighter bar is a miss', (await judge('external', 100, 5, 'external', 95, null, null, 8)) === 'miss');
ok('bodyweight: reps alone decide it', (await judge('bodyweight', null, 8, 'bodyweight', 0, null, null, 8)) === 'hit');
ok('bodyweight: adding weight is strictly harder, so it counts',
   (await judge('bodyweight', null, 8, 'weighted_bodyweight', 0, null, 10, 8)) === 'hit');
ok('bodyweight: being assisted does NOT count',
   (await judge('bodyweight', null, 8, 'assisted_bodyweight', 0, 20, null, 12)) === 'miss');
ok('weighted: the added kilos must be there',
   (await judge('weighted_bodyweight', 10, 5, 'weighted_bodyweight', 0, null, 10, 5)) === 'hit');
ok('weighted: less added weight is a miss',
   (await judge('weighted_bodyweight', 10, 5, 'weighted_bodyweight', 0, null, 5, 9)) === 'miss');
ok('assisted: LESS assistance is more work, so it is a hit',
   (await judge('assisted_bodyweight', 30, 5, 'assisted_bodyweight', 0, 20, null, 5)) === 'hit');
ok('assisted: more assistance is a miss',
   (await judge('assisted_bodyweight', 30, 5, 'assisted_bodyweight', 0, 40, null, 9)) === 'miss');
ok('assisted: needing none at all is a hit',
   (await judge('assisted_bodyweight', 30, 5, 'bodyweight', 0, null, null, 5)) === 'hit');
ok('repetition-only: reps and nothing else',
   (await judge('repetition_only', null, 20, 'repetition_only', 0, null, null, 20)) === 'hit');

console.log('    and on a PRE-133 row, where only (weight, reps) exist');
const legacy = (t, kg, reps, w, ar) =>
  svc(`select public.callout_judge('${t}', ${kg === null ? 'null' : kg}, ${reps},
       null, ${w === null ? 'null' : w}, null, null, ${ar}) v;`).then((r) => one(r).v);
ok('legacy external: the weight still has to be there',
   (await legacy('external', 100, 5, 100, 5)) === 'hit');
ok('legacy external: a lighter bar is still a miss',
   (await legacy('external', 100, 5, 80, 9)) === 'miss');
ok('legacy external: short reps are still a miss',
   (await legacy('external', 100, 5, 100, 4)) === 'miss');
ok('legacy bodyweight: a 0 kg row is judged on its reps, not called a miss for being 0 kg',
   (await legacy('bodyweight', null, 8, 0, 8)) === 'hit');
ok('legacy bodyweight: short reps are a miss',
   (await legacy('bodyweight', null, 8, 0, 7)) === 'miss');
ok('legacy weighted: the legacy weight IS the added load',
   (await legacy('weighted_bodyweight', 10, 5, 10, 5)) === 'hit');
ok('legacy assisted: judged on reps, because assistance was never recorded',
   (await legacy('assisted_bodyweight', 30, 5, 0, 5)) === 'hit');

console.log('    and the trigger uses it on a real bodyweight set');
const b5 = { A: await bal(ALPHA), B: await bal(BRAVO) };
const cbw = await call({ setNo: 1, exercise: BW_LIFT, reps: 8, mode: 'bodyweight', kg: null,
                         label: 'BW × 8+', stake: 25 });
await as(BRAVO, `select public.callout_respond('${cbw}', true);`);
await logSet({ setNo: 1, exercise: BW_LIFT, reps: 10, kg: 0, mode: 'bodyweight' });
ok('ten bodyweight pull-ups answers a call of eight', (await row(cbw)).result === 'hit');
await as(BRAVO, `select public.callout_verify('${cbw}', 'verify');`);
ok('and it pays', (await bal(ALPHA)) === b5.A + 25);

// ── 13. RLS — the client can read its own rows and write nothing ────────────
console.log('\n13. RLS — one policy, and it is a SELECT');
const pols = await svc(`select cmd, count(*)::int n from pg_policies
                        where tablename = 'workout_callouts' group by cmd;`);
ok('there is exactly one policy', pols.length === 1 && Number(pols[0].n) === 1,
   JSON.stringify(pols));
ok('and it is a SELECT', pols[0]?.cmd === 'SELECT');
ok('a third party sees nothing', Number(one(await asRls(CHARLIE,
  `select count(*)::int n from public.workout_callouts;`)).n) === 0);
ok('the athlete sees their own', Number(one(await asRls(ALPHA,
  `select count(*)::int n from public.workout_callouts;`)).n) > 0);
ok('the doubter sees the ones they are in', Number(one(await asRls(BRAVO,
  `select count(*)::int n from public.workout_callouts;`)).n) > 0);
await refused('a client cannot insert a call out directly',
  () => asRls(ALPHA, `insert into public.workout_callouts
      (athlete_id, opponent_id, initiated_by, workout_date, workout_name, exercise, set_no,
       target_reps, target_label, stake, hit_probability, odds_model_version, expires_at)
      values ('${ALPHA}','${BRAVO}','${ALPHA}', current_date, 'x', 'y', 1,
              1, 'x', 5, 0.5, 'v1', now() + interval '1 hour');`),
  'row-level security|permission denied');
// A MISSING POLICY DOES NOT RAISE — it matches nothing. An UPDATE or DELETE
// with no policy of its own sees zero rows and reports success on zero rows,
// so "did it throw?" is the wrong question and would have passed on a table
// that was wide open. Ask what actually matters: did anything change?
const beforeWrite = one(await svc(
  `select count(*)::int n, count(*) filter (where status = 'settled')::int settled
   from public.workout_callouts where athlete_id = '${ALPHA}';`));
await asRls(ALPHA, `update public.workout_callouts set status = 'settled', stake = 1
                    where athlete_id = '${ALPHA}';`);
const afterUpdate = one(await svc(
  `select count(*)::int n, count(*) filter (where status = 'settled')::int settled,
          count(*) filter (where stake = 1)::int cheap
   from public.workout_callouts where athlete_id = '${ALPHA}';`));
ok('a client UPDATE changes nothing (no policy = no rows, not an error)',
   Number(afterUpdate.settled) === Number(beforeWrite.settled) && Number(afterUpdate.cheap) === 0,
   `settled ${beforeWrite.settled}->${afterUpdate.settled}, stake=1 rows ${afterUpdate.cheap}`);
await asRls(ALPHA, `delete from public.workout_callouts where athlete_id = '${ALPHA}';`);
const afterDelete = one(await svc(
  `select count(*)::int n from public.workout_callouts where athlete_id = '${ALPHA}';`));
ok('and a client DELETE cannot destroy a losing call out',
   Number(afterDelete.n) === Number(beforeWrite.n), `${beforeWrite.n} -> ${afterDelete.n}`);
await refused('a client cannot forge escrow without the GUC',
  () => as(ALPHA, `insert into public.coin_events (kind, amount, source_id)
                   values ('callout_payout', 9999, '${c2}');`),
  'may only be written by call out settlement');
await refused('and cannot mint one under the duel\'s GUC either',
  () => as(ALPHA, `select set_config('evoforge.challenge_authorized','${c2}',true);
                   insert into public.coin_events (kind, amount, source_id)
                   values ('callout_payout', 9999, '${c2}');`),
  'may only be written by call out settlement');

// ── 14. THE LIST ────────────────────────────────────────────────────────────
console.log('\n14. MY CALL OUTS — the one read, and what it does not carry');
const mine = one(await as(ALPHA, `select public.my_workout_callouts() v;`)).v;
ok('the athlete sees their calls', Array.isArray(mine) && mine.length > 0, `${mine.length} rows`);
ok('each carries the pot', mine.every((m) => Number(m.pot) === Number(m.stake) * 2));
ok('each says which side I am', mine.every((m) => typeof m.i_am_athlete === 'boolean'));
ok('names come through', mine.every((m) => typeof m.opponent_name === 'string'));
ok('no workout rows cross', !JSON.stringify(mine).includes('bodyweight_snapshot'));
const theirs = one(await as(CHARLIE, `select public.my_workout_callouts() v;`)).v;
ok('a third party gets an empty list', Array.isArray(theirs) && theirs.length === 0);

// ── 15. CONSERVATION ────────────────────────────────────────────────────────
console.log('\n15. THE LEDGER — every call out conserves it');
// ALWAYS RETURN A ROW. The management API answers with the PREVIOUS statement's
// result when the last one selects nothing, so `rows.length === 0` is not a
// readable "there were no leaks" — it is indistinguishable from set_config's
// output. Count inside the query instead.
const leaks = one(await svc(`select count(*)::int n, coalesce(min(g.id::text), '') as worst from (
                        select split_part(source_id, ':', 1) as id, sum(amount)::int as net
                        from public.coin_events
                        where kind in ('callout_stake','callout_payout')
                        group by 1 having sum(amount) <> 0) g;`));
ok('no settled call out leaks a coin', Number(leaks.n) === 0, leaks.worst || 'none');
const totalMoved = Number(one(await svc(
  `select coalesce(sum(amount),0)::int n from public.coin_events
   where kind in ('callout_stake','callout_payout');`)).n);
ok('the whole feature has minted and burned nothing', totalMoved === 0, `net ${totalMoved}`);

// ── 16. FALSIFYING THE GUARDS ───────────────────────────────────────────────
//
// A guard that cannot fail is not a guard. Each one below is REMOVED, the test
// that depends on it is shown to go red, and the whole thing is rolled back —
// so production is never, for one statement, without the rule.
console.log('\n16. FALSIFICATION — break each guard, watch it go red, roll it back');

const probe = await call({ setNo: 1, exercise: 'Callout Probe', reps: 5, stake: 25 });
{
  // Without the partial unique index, the duplicate row the body refuses would
  // simply land. If this ever says "still refused", the index has stopped being
  // the thing doing the work.
  const r = await svc(`begin;
    drop index public.workout_callouts_one_live;
    insert into public.workout_callouts
      (athlete_id, opponent_id, initiated_by, workout_date, workout_name, exercise, set_no,
       target_reps, target_label, stake, hit_probability, odds_model_version, expires_at)
      values ('${ALPHA}','${BRAVO}','${ALPHA}', current_date, '${WORKOUT}', 'Probe 2', 2,
              5, 'x', 25, 0.5, 'v1', now() + interval '1 hour');
    select count(*)::int n from public.workout_callouts
      where athlete_id = '${ALPHA}' and status = 'offered';
    rollback;`);
  ok('the one-live rule IS the index — without it a second live call lands',
     Number(one(r).n) === 2, `${one(r).n} live offers with the index dropped`);
}
ok('and the index is back', Number(one(await svc(
  `select count(*)::int n from pg_indexes where indexname = 'workout_callouts_one_live';`)).n) === 1);
await refused('so a second live call is refused again',
  () => call({ setNo: 2, exercise: 'Callout Probe' }), 'already have a call out running');

{
  // If the judge stopped judging, a four-rep set against a five-rep call would
  // read as a hit. This proves the miss assertions above are testing the judge
  // and not merely agreeing with a default.
  const r = await svc(`begin;
    create or replace function public.callout_judge(
      p_target_mode text, p_target_kg numeric, p_target_reps int,
      p_actual_mode text, p_actual_weight numeric, p_actual_assistance numeric,
      p_actual_external numeric, p_actual_reps int)
    returns text language sql immutable as 'select ''hit''::text';
    select public.callout_judge('external', 100, 5, 'external', 100, null, null, 4) v;
    rollback;`);
  ok('the miss verdicts come from the judge, not from a default',
     one(r).v === 'hit', 'a stubbed judge calls a 4-rep set a hit');
}
ok('the real judge still calls it a miss',
   (await judge('external', 100, 5, 'external', 100, null, null, 4)) === 'miss');

{
  // The coin guard is the only thing standing between a client and a minted
  // payout. Stood down, the forged insert lands.
  const r = await svc(`begin;
    alter table public.coin_events disable trigger user;
    select set_config('request.jwt.claims', '{"sub":"${ALPHA}","role":"authenticated"}', true);
    insert into public.coin_events (user_id, kind, amount, source_id)
      values ('${ALPHA}', 'callout_payout', 9999, '${probe}');
    select coalesce(sum(amount),0)::int n from public.coin_events
      where source_id = '${probe}' and kind = 'callout_payout';
    rollback;`);
  ok('the coin guard IS what refuses a forged payout',
     Number(one(r).n) === 9999, 'with the trigger disabled, 9999 coins were minted');
}
await refused('and with it back, the same insert is refused',
  () => as(ALPHA, `insert into public.coin_events (kind, amount, source_id)
                   values ('callout_payout', 9999, '${probe}');`),
  'may only be written by call out settlement');
ok('nothing survived the falsification', Number(one(await svc(
  `select coalesce(sum(amount),0)::int n from public.coin_events where source_id = '${probe}';`)).n) === 0);

// ── CLEANUP ─────────────────────────────────────────────────────────────────
console.log('\nCLEANUP');
await wipe();
const b9 = { A: await bal(ALPHA), B: await bal(BRAVO), C: await bal(CHARLIE) };
ok('cleanup restored every balance',
   b9.A === b0.A && b9.B === b0.B && b9.C === b0.C,
   `ALPHA ${b0.A}->${b9.A}  BRAVO ${b0.B}->${b9.B}  CHARLIE ${b0.C}->${b9.C}`);
ok('no call out rows survive', Number(one(await svc(
  `select count(*)::int n from public.workout_callouts;`)).n) === 0);
ok('no smoke sets survive', Number(one(await svc(
  `select count(*)::int n from public.workout_log where workout = '${WORKOUT}';`)).n) === 0);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) console.log('FAILURES:\n  - ' + failures.join('\n  - '));
process.exit(fail === 0 ? 0 : 1);
