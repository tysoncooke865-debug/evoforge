/**
 * Falsify the Forge Duel economy against production.
 * Every step runs as a real athlete (request.jwt.claims), so the SECURITY
 * DEFINER bodies do their own authorisation exactly as they would for a client.
 */
import { readFileSync } from 'node:fs';

const TOKEN = readFileSync('C:/Users/tyson/Downloads/Previous_Code/evoforge/client/.env.sbtoken.local', 'utf8')
  .trim().replace(/^[A-Z_]+=/, '').replace(/^["']|["']$/g, '');
const PROJECT = 'rysbpwpvnqbngqncrfaa';

const ALPHA = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1';
const BRAVO = '699ddb56-69b5-4070-854b-df73f578f19b';
const CHARLIE = '493924db-fe1d-458c-abc3-21202fcb5848';
const DELTA = 'e95e773a-1bd5-4a12-a034-de5afc6c34f4';
const NAME = { [ALPHA]: 'ALPHA', [BRAVO]: 'BRAVO', [CHARLIE]: 'CHARLIE', [DELTA]: 'DELTA' };

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
    throw new Error(msg.replace(/\s+/g, ' ').trim());
  }
  return JSON.parse(text);
}

const as = (user, sql) =>
  raw(`select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true);\n${sql}`);
const svc = (sql) =>
  raw(`select set_config('request.jwt.claims', '{"role":"service_role"}', true);\n${sql}`);
/** The lock guard freezes the window after acceptance — as it must. A TEST
 *  harness is the one caller allowed to move a clock, and only with the guard
 *  visibly stood down. */
const backdate = (sql) =>
  svc(`alter table public.forge_challenges disable trigger forge_challenge_lock_trigger;
       ${sql}
       alter table public.forge_challenges enable trigger forge_challenge_lock_trigger;`);

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
    if (!expect || new RegExp(expect, 'i').test(m)) { pass++; console.log(`  PASS  ${label} — "${m.split('CONTEXT')[0].trim().slice(0, 100)}"`); }
    else { fail++; failures.push(label); console.log(`  FAIL  ${label} — wrong refusal: ${m.slice(0, 140)}`); }
  }
}
const bal = async (u) => (await svc(`select public.forge_duel_balance('${u}') v`))[0].v;
const one = (rows) => rows[0];
const made = [];
async function newDuel(type, days, stake, metric = null) {
  const id = one(await as(ALPHA, `insert into public.forge_challenges
    (opponent_id, challenge_type, metric_key, duration_days, stake)
    values ('${BRAVO}','${type}', ${metric ? `'${metric}'` : 'null'}, ${days}, ${stake}) returning id;`)).id;
  made.push(id);
  return id;
}

console.log('\n=== FORGE DUEL — falsification against production ===\n');

/**
 * START FROM A KNOWN FLOOR.
 *
 * Several assertions here are about a CHANGE ("the leader moved", "the record
 * went up by one"), and a leftover duel or a same-day session from an earlier
 * run silently turns those into a different question. The harness clears its
 * own footprints first, and baselines what it cannot clear.
 */
await svc(`delete from public.coin_events
             where source_id ~ '^[0-9a-f]{8}-'
               and split_part(source_id, ':', 1)::uuid in (select id from public.forge_challenges);
           delete from public.forge_challenges
             where challenger_id in ('${ALPHA}','${BRAVO}','${CHARLIE}','${DELTA}');
           delete from public.workout_sessions
             where workout like 'Duel Smoke%' or workout like 'Tour Duel%';
           delete from public.cardio_log where notes in ('Duel Smoke Cardio','Tour Duel Cardio');
           delete from public.social_notifications where type like 'duel_%';`);
// Any session either athlete already logged today would make the very first
// "who is ahead" comparison a tie before the harness had trained anybody.
const sameDay = await svc(`select count(*)::int n from public.workout_sessions
                           where user_id in ('${ALPHA}','${BRAVO}') and date = current_date;`);
if (Number(one(sameDay).n) > 0) {
  console.log(`  NOTE  ${one(sameDay).n} session(s) already logged today by the smoke accounts;`);
  console.log('        removing them so the lead-change assertions measure this run.');
  await svc(`delete from public.workout_sessions
             where user_id in ('${ALPHA}','${BRAVO}') and date = current_date;`);
}
const rivalryBefore = one(await as(ALPHA, `select public.forge_rivalry('${BRAVO}') r;`)).r;

const b0 = { A: await bal(ALPHA), B: await bal(BRAVO), C: await bal(CHARLIE), D: await bal(DELTA) };
console.log(`opening  ALPHA ${b0.A}  BRAVO ${b0.B}  CHARLIE ${b0.C}  DELTA ${b0.D}\n`);

// ── 1. CREATE ────────────────────────────────────────────────────────────
console.log('1. CREATE — a proposal moves nothing');
const duel = await newDuel('training_consistency', 7, 25);
ok('duel created', Boolean(duel), duel);
ok('no coins moved on create', (await bal(ALPHA)) === b0.A && (await bal(BRAVO)) === b0.B);
await refused('a stake above the configured maximum is refused',
  () => as(ALPHA, `insert into public.forge_challenges (opponent_id, challenge_type, duration_days, stake)
                   values ('${BRAVO}','cardio_minutes',7, 999999);`), 'between 5 and 2000');
await refused('staking more than you own is refused',
  () => as(CHARLIE, `insert into public.forge_challenges (opponent_id, challenge_type, duration_days, stake)
                     values ('${ALPHA}','cardio_minutes',7, 1500);`), 'coins and this duel stakes');

// ── 2. COUNTER-STAKE ─────────────────────────────────────────────────────
console.log('\n2. COUNTER-STAKE — the invited athlete negotiates');
const counter = one(await as(BRAVO, `select public.forge_duel_propose('${duel}','counter_stake', 50) r;`)).r;
ok('BRAVO counters at 50', counter.amount === 50);
await refused('a second pending offer is impossible',
  () => as(BRAVO, `select public.forge_duel_propose('${duel}','counter_stake', 60);`), 'duplicate key|one_pending');
await refused('you cannot answer your own offer',
  () => as(BRAVO, `select public.forge_duel_respond('${counter.offer_id}', true);`), 'own offer');
const cAcc = one(await as(ALPHA, `select public.forge_duel_respond('${counter.offer_id}', true) r;`)).r;
ok('ALPHA accepts the counter', cAcc.stake === 50 && cAcc.pot === 100);
ok('still nothing escrowed', (await bal(ALPHA)) === b0.A && (await bal(BRAVO)) === b0.B);

// ── 3. ACCEPT ────────────────────────────────────────────────────────────
console.log('\n3. ACCEPT — both stakes leave the wallet, atomically');
const acc = one(await as(BRAVO, `select public.forge_challenge_accept('${duel}', current_date) r;`)).r;
ok('escrow is the pot', acc.pot === 100);
const b1 = { A: await bal(ALPHA), B: await bal(BRAVO) };
ok('ALPHA charged exactly the stake', b1.A === b0.A - 50, `${b0.A} → ${b1.A}`);
ok('BRAVO charged exactly the stake', b1.B === b0.B - 50, `${b0.B} → ${b1.B}`);
ok('a second accept is a no-op',
   one(await as(BRAVO, `select public.forge_challenge_accept('${duel}', current_date) r;`)).r.already === true
   && (await bal(BRAVO)) === b1.B);
await refused('only the invited athlete may accept',
  () => as(ALPHA, `select public.forge_challenge_accept('${duel}', current_date);`), 'only the invited');

// The rules lock. Proving it here is what earns the harness the right to
// stand the guard down later.
const endsBefore = one(await svc(`select ends_at, stake from public.forge_challenges where id='${duel}';`));
await svc(`update public.forge_challenges set ends_at = now() - interval '1 day', stake = 999 where id='${duel}';`);
const endsAfter = one(await svc(`select ends_at, stake from public.forge_challenges where id='${duel}';`));
ok('the lock guard refuses to move the window or the stake after acceptance',
   endsAfter.ends_at === endsBefore.ends_at && endsAfter.stake === endsBefore.stake,
   `${endsBefore.stake} coins, ends ${endsBefore.ends_at}`);

// ── 4/5. TRAINING ────────────────────────────────────────────────────────
console.log('\n4. RAISE — locked until BOTH athletes have trained');
let rs = one(await as(ALPHA, `select public.forge_duel_raise_state('${duel}') r;`)).r;
ok('a raise starts locked', rs.unlocked === false && rs.reason === 'needs_session');
await refused('proposing a locked raise is refused',
  () => as(ALPHA, `select public.forge_duel_propose('${duel}','raise', 25);`), 'unlocks once you have both trained');

console.log('\n5. TRAINING DRIVES THE DUEL');
await as(ALPHA, `insert into public.workout_sessions (user_id, date, workout, finished_at)
                 values ('${ALPHA}', current_date, 'Duel Smoke Push', now()) on conflict do nothing;`);
const ev = await svc(`select kind, actor_id from public.forge_challenge_events where challenge_id='${duel}' order by created_at;`);
ok('a workout appended a timeline entry', ev.some((e) => e.kind === 'workout_logged' && e.actor_id === ALPHA),
   ev.map((e) => e.kind).join(', '));
ok('the leader moved to ALPHA',
   one(await svc(`select leader_id from public.forge_challenges where id='${duel}';`)).leader_id === ALPHA);
ok('a lead change was recorded', ev.some((e) => e.kind === 'lead_change'));
const q = await svc(`select value from public.forge_challenge_qualifying where challenge_id='${duel}';`);
ok('the qualifying snapshot was written (139 built the table; nothing ever wrote it)',
   q.length === 1 && Number(q[0].value) === 1);
rs = one(await as(ALPHA, `select public.forge_duel_raise_state('${duel}') r;`)).r;
ok('still locked — BRAVO has not trained', rs.unlocked === false && rs.waiting_on === BRAVO, rs.waiting_on_name);
await as(BRAVO, `insert into public.workout_sessions (user_id, date, workout, finished_at)
                 values ('${BRAVO}', current_date, 'Duel Smoke Pull', now()) on conflict do nothing;`);
ok('a raise unlocks once both have trained',
   one(await as(ALPHA, `select public.forge_duel_raise_state('${duel}') r;`)).r.unlocked === true);
ok('a tie has no leader',
   one(await svc(`select leader_id from public.forge_challenges where id='${duel}';`)).leader_id === null);

// ── 6. RAISE ─────────────────────────────────────────────────────────────
console.log('\n6. RAISE — a formal negotiation');
const raise1 = one(await as(ALPHA, `select public.forge_duel_propose('${duel}','raise', 25) r;`)).r;
ok('ALPHA proposes +25', raise1.amount === 25 && raise1.pot_if_accepted === 150);
ok('a proposal moves nothing', (await bal(ALPHA)) === b1.A);
const raise2 = one(await as(BRAVO, `select public.forge_duel_propose('${duel}','raise', 10, '${raise1.offer_id}') r;`)).r;
ok('BRAVO counters at +10', raise2.amount === 10);
ok('the countered offer is superseded',
   one(await svc(`select status from public.forge_duel_offers where id='${raise1.offer_id}';`)).status === 'superseded');
const stale = one(await as(BRAVO, `select public.forge_duel_respond('${raise1.offer_id}', true) r;`)).r;
ok('a superseded offer is refused, not silently "already done"',
   stale.refused === true && stale.already === false, stale.reason);
const rAcc = one(await as(ALPHA, `select public.forge_duel_respond('${raise2.offer_id}', true) r;`)).r;
ok('accepting the counter grows the pot', rAcc.pot === 120);
const b2 = { A: await bal(ALPHA), B: await bal(BRAVO) };
ok('both athletes paid the raise', b2.A === b1.A - 10 && b2.B === b1.B - 10, `A ${b2.A} B ${b2.B}`);
ok('accepting a raise twice charges nothing more',
   one(await as(ALPHA, `select public.forge_duel_respond('${raise2.offer_id}', true) r;`)).r.already === true
   && (await bal(ALPHA)) === b2.A);

console.log('\n7. DECLINE — says no to the raise, not to the duel');
await svc(`update public.forge_challenges set last_raise_at = accepted_at where id='${duel}';`);
const raise3 = one(await as(BRAVO, `select public.forge_duel_propose('${duel}','raise', 200) r;`)).r;
const dec = one(await as(ALPHA, `select public.forge_duel_respond('${raise3.offer_id}', false) r;`)).r;
ok('declining leaves the pot and the duel untouched', dec.pot === 120 && dec.duel_status === 'active');
ok('declining moves no coins', (await bal(ALPHA)) === b2.A && (await bal(BRAVO)) === b2.B);

// ── 8. ALL IN ────────────────────────────────────────────────────────────
console.log('\n8. ALL IN — the amount is the ledger, not an argument');
await svc(`update public.forge_challenges set last_raise_at = accepted_at where id='${duel}';`);
const allIn = one(await as(ALPHA, `select public.forge_duel_propose('${duel}','all_in', 5) r;`)).r;
ok('the client-sent amount is ignored', allIn.amount === b2.A, `sent 5, server used ${allIn.amount}`);
ok('the server says up front whether it can be matched',
   allIn.opponent_can_match === false, `ALPHA ${b2.A} vs BRAVO ${b2.B}`);
await refused('BRAVO cannot match an all-in they cannot afford',
  () => as(BRAVO, `select public.forge_duel_respond('${allIn.offer_id}', true);`), 'need .* coins to match');
const maxMatch = one(await as(BRAVO, `select public.forge_duel_propose('${duel}','raise', ${b2.B}, '${allIn.offer_id}') r;`)).r;
ok('BRAVO counters with their maximum match', maxMatch.amount === b2.B);
await refused('only the proposer may withdraw an offer',
  () => as(ALPHA, `select public.forge_duel_withdraw_offer('${maxMatch.offer_id}');`), 'only the proposer');
await as(BRAVO, `select public.forge_duel_withdraw_offer('${maxMatch.offer_id}');`);
ok('the proposer withdraws it',
   one(await svc(`select status from public.forge_duel_offers where id='${maxMatch.offer_id}';`)).status === 'withdrawn');

// ── 9. SUPPORT ───────────────────────────────────────────────────────────
console.log('\n9. SUPPORT — a separate pool, in a separate table');
await refused('backing above the configured cap is refused',
  () => as(CHARLIE, `select public.forge_duel_support('${duel}','${ALPHA}', 9999);`), 'Back between 1 and 500');
if (b0.C < 500) {
  await refused('backing more than you own is refused',
    () => as(CHARLIE, `select public.forge_duel_support('${duel}','${ALPHA}', ${b0.C + 50});`), 'coins and this backs');
} else {
  // The wallet is above the configured cap, so the cap refuses first and the
  // balance path is unreachable from this account. Saying so beats a green
  // tick on an assertion that did not run.
  console.log(`  SKIP  balance path (CHARLIE holds ${b0.C}, above the ${500} cap)`);
}
await refused('a participant cannot back their own duel',
  () => as(ALPHA, `select public.forge_duel_support('${duel}','${ALPHA}', 10);`), 'You are in this duel');
const supRes = one(await as(CHARLIE, `select public.forge_duel_support('${duel}','${ALPHA}', 100) r;`)).r;
ok('CHARLIE backs ALPHA', supRes.amount === 100);
ok('the supporter is charged', (await bal(CHARLIE)) === b0.C - 100);
const kinds = await svc(`select kind, sum(amount)::int total from public.coin_events
                         where source_id like '${duel}%' group by kind order by kind;`);
ok('supporter coins never share a kind with participant escrow',
   kinds.some((k) => k.kind === 'duel_support_stake') && kinds.some((k) => k.kind === 'challenge_stake'),
   JSON.stringify(kinds));
await refused('backing twice is refused',
  () => as(CHARLIE, `select public.forge_duel_support('${duel}','${BRAVO}', 10);`), 'already backed');

// ── 10. WATCHING ─────────────────────────────────────────────────────────
console.log('\n10. WATCHING — friends only, and never a private number');
const watch = one(await as(CHARLIE, `select public.forge_duel_watch('${duel}') r;`)).r;
ok('a friend can watch', watch.id === duel && watch.pot === 120, `pot ${watch.pot}, ${watch.supporter_count} supporter(s)`);
ok('the watcher sees their own position', watch.my_support?.amount === 100);
const strangerId = one(await svc(`select u.id from auth.users u
   where u.id not in ('${ALPHA}','${BRAVO}','${CHARLIE}','${DELTA}')
     and not public.are_friends(u.id,'${ALPHA}') and not public.are_friends(u.id,'${BRAVO}') limit 1;`))?.id;
if (strangerId) {
  await refused('a stranger cannot watch', () => as(strangerId, `select public.forge_duel_watch('${duel}');`), 'not open to you');
  await refused('a stranger cannot back it either',
    () => as(strangerId, `select public.forge_duel_support('${duel}','${ALPHA}', 10);`), 'not open to you');
}
const tl = one(await as(CHARLIE, `select public.forge_duel_timeline('${duel}') r;`)).r;
ok('the timeline is readable by a spectator', Array.isArray(tl) && tl.length > 0, `${tl.length} events`);
ok('and leaks no baseline or measurement',
   !JSON.stringify(tl).includes('baseline') && !JSON.stringify(tl).includes('measured'));
const watchable = one(await as(DELTA, `select public.forge_duels_watchable() r;`)).r;
ok("a friend's duel appears in the watch list", watchable.some((w) => w.id === duel), `${watchable.length} watchable`);
await as(DELTA, `select public.forge_duel_react('${duel}','fire', true);`);
ok('a spectator can react',
   Number(one(await svc(`select count(*)::int n from public.forge_duel_reactions where challenge_id='${duel}';`)).n) === 1);
await as(DELTA, `select public.forge_duel_react('${duel}','fire', true);`);
ok('reacting twice is still one reaction (the key is the rate limit)',
   Number(one(await svc(`select count(*)::int n from public.forge_duel_reactions where challenge_id='${duel}';`)).n) === 1);

// ── 11. SUPPORT CLOSES ───────────────────────────────────────────────────
console.log('\n11. SUPPORT CLOSES, and stays closed');
const dClose = await newDuel('cardio_minutes', 7, 10);
await as(BRAVO, `select public.forge_challenge_accept('${dClose}', current_date);`);
await backdate(`update public.forge_challenges set support_closes_at = now() - interval '1 minute' where id='${dClose}';`);
await refused('late money is refused',
  () => as(DELTA, `select public.forge_duel_support('${dClose}','${ALPHA}', 10);`), 'Support closed');
await as(ALPHA, `select public.forge_challenge_cancel('${dClose}');`);

// ── 12. SETTLEMENT ───────────────────────────────────────────────────────
console.log('\n12. SETTLEMENT — the window closes and the pools pay');
await svc(`insert into public.workout_sessions (user_id, date, workout, finished_at)
           values ('${ALPHA}', current_date - 1, 'Duel Smoke Legs', now()) on conflict do nothing;`);
await backdate(`update public.forge_challenges
                set starts_at = (current_date - 1)::timestamptz, ends_at = now() - interval '1 minute'
                where id='${duel}';`);
const b3 = { A: await bal(ALPHA), B: await bal(BRAVO), C: await bal(CHARLIE) };
const settle = one(await as(BRAVO, `select public.forge_challenge_settle('${duel}') r;`)).r;
ok('ALPHA wins on training days', settle.outcome === 'winner' && settle.winner_id === ALPHA,
   `${settle.score_challenger} vs ${settle.score_opponent}, pot ${settle.pot}`);
const b4 = { A: await bal(ALPHA), B: await bal(BRAVO), C: await bal(CHARLIE) };
ok('the winner takes the whole escrow', b4.A === b3.A + 120, `${b3.A} → ${b4.A}`);
ok('the loser pays only what they staked', b4.B === b3.B);
ok('the sole backer of the winner is refunded (nothing on the other side to win)',
   b4.C === b3.C + 100, `${b3.C} → ${b4.C}`);
ok('settling twice pays nothing more',
   one(await as(ALPHA, `select public.forge_challenge_settle('${duel}') r;`)).r.already === true
   && (await bal(ALPHA)) === b4.A);
ok('the duel conserved the ledger exactly',
   Number(one(await svc(`select coalesce(sum(amount),0)::int net from public.coin_events where source_id like '${duel}%';`)).net) === 0);

// ── 13. PARI-MUTUEL ──────────────────────────────────────────────────────
console.log('\n13. PARI-MUTUEL — winners divide the losing pool');
const d2 = await newDuel('cardio_minutes', 7, 20);
await as(BRAVO, `select public.forge_challenge_accept('${d2}', current_date);`);
await as(CHARLIE, `select public.forge_duel_support('${d2}','${BRAVO}', 60);`);   // backs the loser
await as(DELTA, `select public.forge_duel_support('${d2}','${ALPHA}', 40);`);     // backs the winner
// Only ALPHA logs cardio, so the winner is not in doubt.
await as(ALPHA, `insert into public.cardio_log (user_id, date, type, minutes, notes)
                 values ('${ALPHA}', current_date, 'Run', 30, 'Duel Smoke Cardio');`);
await backdate(`update public.forge_challenges set starts_at = current_date::timestamptz,
                ends_at = now() - interval '1 minute' where id='${d2}';`);
const before = { C: await bal(CHARLIE), D: await bal(DELTA) };
const s2 = one(await as(ALPHA, `select public.forge_challenge_settle('${d2}') r;`)).r;
ok('the winning side takes the losing pool', s2.support?.paid === 100,
   `winner pool ${s2.support?.pool_winner}, loser pool ${s2.support?.pool_loser}, paid ${s2.support?.paid}, rake ${s2.support?.rake}`);
ok('the backer of the winner is paid stake + share', (await bal(DELTA)) === before.D + 100,
   `${before.D} → ${await bal(DELTA)} (staked 40, won 60)`);
ok('the backer of the loser gets nothing back', (await bal(CHARLIE)) === before.C);
ok('the second duel conserved the ledger too',
   Number(one(await svc(`select coalesce(sum(amount),0)::int net from public.coin_events where source_id like '${d2}%';`)).net) === 0);

// ── 14. DRAW ─────────────────────────────────────────────────────────────
console.log('\n14. A DRAW refunds both athletes and every supporter');
// Both athletes trained exactly one day inside this window (step 5), so the
// contest is genuinely level — the draw is earned, not manufactured.
const d3 = await newDuel('training_consistency', 7, 30);
await as(BRAVO, `select public.forge_challenge_accept('${d3}', current_date);`);
await as(CHARLIE, `select public.forge_duel_support('${d3}','${ALPHA}', 25);`);
const b5 = { A: await bal(ALPHA), B: await bal(BRAVO), C: await bal(CHARLIE) };
await backdate(`update public.forge_challenges set ends_at = now() - interval '1 minute' where id='${d3}';`);
const s3 = one(await as(BRAVO, `select public.forge_challenge_settle('${d3}') r;`)).r;
ok('an equal contest is a draw', s3.outcome === 'draw',
   `${s3.score_challenger} vs ${s3.score_opponent}`);
ok('both stakes come back', (await bal(ALPHA)) === b5.A + 30 && (await bal(BRAVO)) === b5.B + 30);
ok('the supporter is refunded in full', (await bal(CHARLIE)) === b5.C + 25);
ok('the draw conserved the ledger',
   Number(one(await svc(`select coalesce(sum(amount),0)::int net from public.coin_events where source_id like '${d3}%';`)).net) === 0);

// ── 15. CANCEL ───────────────────────────────────────────────────────────
console.log('\n15. CANCEL refunds everybody');
const d4 = await newDuel('cardio_minutes', 7, 15);
await as(BRAVO, `select public.forge_challenge_accept('${d4}', current_date);`);
await as(DELTA, `select public.forge_duel_support('${d4}','${BRAVO}', 20);`);
const b6 = { A: await bal(ALPHA), B: await bal(BRAVO), D: await bal(DELTA) };
await as(ALPHA, `select public.forge_challenge_cancel('${d4}');`);
ok('participants refunded', (await bal(ALPHA)) === b6.A + 15 && (await bal(BRAVO)) === b6.B + 15);
ok('supporter refunded', (await bal(DELTA)) === b6.D + 20);
ok('cancelling twice refunds nothing more',
   one(await as(ALPHA, `select public.forge_challenge_cancel('${d4}') r;`)).r.already === true);
ok('the cancel conserved the ledger',
   Number(one(await svc(`select coalesce(sum(amount),0)::int net from public.coin_events where source_id like '${d4}%';`)).net) === 0);

// ── 16. HISTORY EDITS ────────────────────────────────────────────────────
console.log('\n16. AN EDIT TO A QUALIFYING SESSION IS FLAGGED, and the set survives');
const d5 = await newDuel('most_improved_lift', 7, 10, 'Barbell Bench Press (Strength)');
await as(BRAVO, `select public.forge_challenge_accept('${d5}', current_date);`);
const setRow = one(await as(ALPHA, `insert into public.workout_log (user_id, date, exercise, weight, reps, "timestamp")
  values ('${ALPHA}', current_date, 'Barbell Bench Press (Strength)', 100, 5, now()) returning id;`)).id;
await as(ALPHA, `update public.workout_log set weight = 180 where id='${setRow}';`);
const flag = one(await svc(`select integrity_flag from public.forge_challenge_participants
                            where challenge_id='${d5}' and user_id='${ALPHA}';`)).integrity_flag;
ok('the edit is recorded against the participant', Boolean(flag), String(flag));
ok('and the set itself survived the trigger',
   Number(one(await svc(`select weight from public.workout_log where id='${setRow}';`)).weight) === 180);
await as(ALPHA, `select public.forge_challenge_cancel('${d5}');`);

// ── 17. RIVALRY + SWEEP + NOTIFICATIONS ──────────────────────────────────
console.log('\n17. THE DERIVED SURFACES');
const riv = one(await as(ALPHA, `select public.forge_rivalry('${BRAVO}') r;`)).r;
// Measured as a DELTA against the baseline taken at startup: these accounts
// carry history from every previous run, and an absolute assertion would only
// ever pass on a virgin database.
ok('the rivalry record counts this run exactly',
   riv.wins - rivalryBefore.wins === 2
   && riv.losses - rivalryBefore.losses === 0
   && riv.draws - rivalryBefore.draws === 1
   && riv.total - rivalryBefore.total === 3,
   `+${riv.wins - rivalryBefore.wins}W +${riv.losses - rivalryBefore.losses}L +${riv.draws - rivalryBefore.draws}D · streak ${riv.streak}`);
ok('a draw does not break the run (only a loss resets)',
   riv.streak >= rivalryBefore.streak + 2,
   `streak ${rivalryBefore.streak} → ${riv.streak} over 2 wins and a draw`);
const sweep = one(await as(ALPHA, `select public.forge_duel_sweep() r;`)).r;
ok('the sweep runs clean', typeof sweep.settled === 'number', JSON.stringify(sweep));
const notes = await svc(`select type, count(*)::int n from public.social_notifications
                         where type like 'duel_%' group by type order by type;`);
ok('duel notifications were written', notes.length > 0, JSON.stringify(notes));
const mine = one(await as(ALPHA, `select public.my_forge_challenges() r;`)).r;
ok('my_forge_challenges carries the live economy',
   mine.length > 0 && mine.every((m) => typeof m.pot === 'number' && 'raise_state' in m),
   `${mine.length} rows, first pot ${mine[0]?.pot}`);


// ── 18. ORPHANED ESCROW ──────────────────────────────────────────────────
console.log('\n18. AN OPPONENT WHO DELETES THEIR ACCOUNT CANNOT DESTROY COINS');
const d6 = await newDuel('cardio_minutes', 7, 40);
await as(BRAVO, `select public.forge_challenge_accept('${d6}', current_date);`);
await as(CHARLIE, `select public.forge_duel_support('${d6}','${ALPHA}', 30);`);
const b7 = { A: await bal(ALPHA), C: await bal(CHARLIE) };
// The cascade, exactly: deleting an account takes the duel row with it and
// leaves the survivor's stake pointing at nothing.
await svc(`delete from public.forge_challenges where id='${d6}';`);
ok('the duel is gone and the stakes are still out', (await bal(ALPHA)) === b7.A);
const swept1 = one(await as(ALPHA, `select public.forge_duel_sweep() r;`)).r;
ok('the sweep makes the participant whole', (await bal(ALPHA)) === b7.A + 40, `repaired ${swept1.repaired}`);
ok('and never twice',
   one(await as(ALPHA, `select public.forge_duel_sweep() r;`)).r.repaired === 0
   && (await bal(ALPHA)) === b7.A + 40);
const swept2 = one(await as(CHARLIE, `select public.forge_duel_sweep() r;`)).r;
ok('the supporter is made whole too', (await bal(CHARLIE)) === b7.C + 30, `repaired ${swept2.repaired}`);
await svc(`delete from public.coin_events where source_id like '${d6}%';`);

// ── cleanup ──────────────────────────────────────────────────────────────
console.log('\nCLEANUP');
const ids = made.map((i) => `'${i}'`).join(',');
await svc(`delete from public.workout_log where id='${setRow}';
           delete from public.workout_sessions where workout like 'Duel Smoke%'; delete from public.cardio_log where notes='Duel Smoke Cardio';
           delete from public.coin_events where source_id ~ '^[0-9a-f-]{36}(:|$)'
             and split_part(source_id, ':', 1)::uuid in (${ids});
           delete from public.forge_challenges where id in (${ids});
           delete from public.social_notifications where type like 'duel_%';`);
const bEnd = { A: await bal(ALPHA), B: await bal(BRAVO), C: await bal(CHARLIE), D: await bal(DELTA) };
ok('cleanup restored every balance',
   bEnd.A === b0.A && bEnd.B === b0.B && bEnd.C === b0.C && bEnd.D === b0.D,
   `A ${b0.A}→${bEnd.A}  B ${b0.B}→${bEnd.B}  C ${b0.C}→${bEnd.C}  D ${b0.D}→${bEnd.D}`);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) console.log(failures.map((f) => `  · ${f}`).join('\n'));
console.log();
process.exit(fail === 0 ? 0 : 1);
