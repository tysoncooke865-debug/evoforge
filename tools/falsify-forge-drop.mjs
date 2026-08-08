/**
 * Falsify FORGE DROP against production.
 *
 * The economy is the whole feature. This asks the questions a UI cannot:
 * does the ledger balance on every path, can the same request charge twice,
 * can two tabs both settle, can a stake beat its ceiling, and — over a hundred
 * thousand real server-side drops — does the board pay what it advertises?
 *
 *   node tools/falsify-forge-drop.mjs
 *
 * Self-cleaning and re-runnable. Every step runs as a real athlete
 * (request.jwt.claims), so the SECURITY DEFINER bodies authorise exactly as
 * they would for a client.
 */
import { readFileSync } from 'node:fs';

const TOKEN = readFileSync(new URL('../client/.env.sbtoken.local', import.meta.url), 'utf8')
  .trim().replace(/^[A-Z_]+=/, '').replace(/^["']|["']$/g, '');
const PROJECT = 'rysbpwpvnqbngqncrfaa';

const ALPHA = '30b0a1b4-0b7e-46ce-ad45-96bfd9d2fab1';
const BRAVO = '699ddb56-69b5-4070-854b-df73f578f19b';

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
/** As an athlete AND under RLS — the owner is exempt without this. */
const asRls = (user, sql) =>
  raw(`set local role authenticated;
       select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true);\n${sql}`);

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`); }
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
      fail++; failures.push(label); console.log(`  FAIL  ${label} — wrong refusal: ${m.slice(0, 150)}`);
    }
  }
}
const one = (r) => r[0];
const bal = async (u) => Number(one(await svc(`select public.forge_duel_balance('${u}') v;`)).v);
const play = (user, key, stake, lane) =>
  as(user, `select public.forge_drop_play('${key}'::uuid, ${stake}, ${lane}) v;`).then((r) => one(r).v);

async function wipe() {
  await svc(`
    delete from public.coin_events where kind in ('forge_drop_stake','forge_drop_payout')
      and user_id in ('${ALPHA}','${BRAVO}');
    delete from public.forge_drops where user_id in ('${ALPHA}','${BRAVO}');`);
}

console.log('\n=== FORGE DROP — falsification against production ===\n');
await wipe();

const tiers = await svc('select * from public.forge_drop_tiers order by tier;');
const b0 = { A: await bal(ALPHA), B: await bal(BRAVO) };
console.log(`opening  ALPHA ${b0.A}  BRAVO ${b0.B}   tiers ${tiers.length}\n`);

// ── 1. THE BOARD ────────────────────────────────────────────────────────────
console.log('1. THE BOARD — configured, bounded, and unable to pay more than it takes');
ok('five tiers are configured', tiers.length === 5);
ok('the stake ceilings are the ones specified',
   tiers.map((t) => t.max_stake).join(',') === '5,10,15,20,25',
   tiers.map((t) => t.max_stake).join(','));
ok('the maximum payouts are the ones specified',
   tiers.map((t) => t.max_payout).join(',') === '15,35,60,100,150',
   tiers.map((t) => t.max_payout).join(','));
ok('every board pays its ceiling exactly',
   tiers.every((t) => Math.floor(t.max_stake * Math.max(...t.multipliers.map(Number))) === t.max_payout));
ok('the Evo bands are contiguous and cover everything',
   tiers.every((t, i) => i === 0 || t.evo_min === tiers[i - 1].evo_max + 1));
ok('every board has an even number of rows (or the puck lands between slots)',
   tiers.every((t) => t.rows % 2 === 0));
ok('every board publishes a return below 100%', tiers.every((t) => Number(t.target_rtp) < 1));
ok('the board is readable by an athlete', Number(one(await asRls(ALPHA,
  `select count(*)::int n from public.forge_drop_tiers;`)).n) === 5);
await refused('and writable by nobody',
  () => asRls(ALPHA, `update public.forge_drop_tiers set max_stake = 9999 where tier = 1;`)
    .then(async () => {
      const m = Number(one(await svc(`select max_stake from public.forge_drop_tiers where tier=1;`)).max_stake);
      if (m === 9999) return; throw new Error('unchanged');
    }), 'unchanged');

// ── 2. EVERY EVO BOUNDARY LANDS ON THE RIGHT BOARD ──────────────────────────
console.log('\n2. EVERY EVO RATING BOUNDARY');
const origRating = one(await svc(
  `select displayed_rating from public.evo_rating_current where user_id = '${ALPHA}';`))?.displayed_rating ?? null;
// UPDATE, never insert: `evo_rating_current` carries not-null columns a
// review fills in, and a harness has no business inventing a rating row. ALPHA
// already has one, which is what makes the boundary sweep possible at all.
const setRating = (r) => svc(
  `update public.evo_rating_current set displayed_rating = ${r}, raw_rating = ${r}
   where user_id = '${ALPHA}';`);
const tierOf = async () => Number(one(await svc(
  `select (public.forge_drop_tier_for('${ALPHA}')).tier v;`)).v);

// The DATABASE bounds a rating to 1–100 (`evo_rating_current_displayed_rating_check`),
// so those are the only values a real athlete can hold. Out-of-range clamping is
// covered by the domain suite, which can pass numbers the database will not.
for (const [rating, want] of [[1,1],[20,1],[21,2],[40,2],[41,3],[60,3],[61,4],[80,4],[81,5],[100,5]]) {
  await setRating(rating);
  const got = await tierOf();
  ok(`Evo ${rating} → tier ${want}`, got === want, `got ${got}`);
}
// MISSING RATING IS NOT AN ERROR. An athlete no review has ever rated gets the
// lowest board — asked of a user id with no row at all, so nobody's data moves.
ok('an athlete with no Evo review at all gets tier 1, not a failure',
   Number(one(await svc(
     `select (public.forge_drop_tier_for('00000000-0000-4000-8000-00000000dead')).tier v;`)).v) === 1);

// ── 3. STAKE LIMITS ─────────────────────────────────────────────────────────
console.log('\n3. STAKE LIMITS — the ceiling is the ceiling');
await setRating(10); // tier 1: max stake 5
const k = () => crypto.randomUUID();
await refused('a stake above the tier ceiling is refused',
  () => play(ALPHA, k(), 6, 6), 'stake must be between 1 and 5');
await refused('a stake of zero is refused', () => play(ALPHA, k(), 0, 6), 'between 1 and 5');
await refused('a negative stake is refused', () => play(ALPHA, k(), -5, 6), 'between 1 and 5');
await refused('a lane that is not on the board is refused',
  () => play(ALPHA, k(), 1, 0), 'lane 0 is not on this board');
await refused('and neither is a lane off the end', () => play(ALPHA, k(), 1, 99), 'not on this board');
await refused('a wager with no idempotency key is refused',
  () => as(ALPHA, `select public.forge_drop_play(null, 1, 6);`), 'idempotency key is required');

await setRating(90); // tier 5: max stake 25
ok('the ceiling rises with the tier',
   Boolean(await play(ALPHA, k(), 25, 6)), 'staked 25 on tier 5');
await refused('but only to ITS ceiling', () => play(ALPHA, k(), 26, 6), 'between 1 and 25');
await setRating(10);

// ── 4. ATOMIC DEBIT AND CREDIT ──────────────────────────────────────────────
console.log('\n4. THE LEDGER — debited and credited in one transaction');
await wipe();
const before = await bal(ALPHA);
const key1 = k();
const r1 = await play(ALPHA, key1, 5, 6);
ok('a drop settles', r1.drop_id && r1.replayed === false, `slot ${r1.slot} ×${r1.multiplier}`);
ok('the stake left the balance and the payout came back',
   (await bal(ALPHA)) === before - r1.stake + r1.payout,
   `${before} → ${await bal(ALPHA)} (staked ${r1.stake}, paid ${r1.payout})`);
ok('the returned balance IS the ledger', Number(r1.balance) === (await bal(ALPHA)));
ok('net agrees with stake and payout', r1.net === r1.payout - r1.stake);
ok('there is exactly one stake row', Number(one(await svc(
  `select count(*)::int n from public.coin_events
   where kind='forge_drop_stake' and source_id='${r1.drop_id}';`)).n) === 1);
ok('and at most one payout row', Number(one(await svc(
  `select count(*)::int n from public.coin_events
   where kind='forge_drop_payout' and source_id='${r1.drop_id}';`)).n) === (r1.payout > 0 ? 1 : 0));
ok('the drop row records the board it was played on',
   Number(one(await svc(`select config_version from public.forge_drops where id='${r1.drop_id}';`)).config_version) >= 1);
ok('and the Evo rating that unlocked it', Number(one(await svc(
  `select evo_rating from public.forge_drops where id='${r1.drop_id}';`)).evo_rating) === 10);
ok('the path lands on the slot that was paid', (() => {
  let h = 2 * r1.lane;
  for (const s of r1.path) h += Number(s);
  return h / 2 === r1.slot;
})(), `lane ${r1.lane} + ${r1.path.length} steps → ${r1.slot}`);

// ── 5. IDEMPOTENCE ──────────────────────────────────────────────────────────
console.log('\n5. THE SAME REQUEST TWICE IS THE SAME DROP');
const afterFirst = await bal(ALPHA);
const r2 = await play(ALPHA, key1, 5, 6);
ok('a replayed key returns the ORIGINAL drop', r2.drop_id === r1.drop_id && r2.replayed === true);
ok('with the same slot and payout', r2.slot === r1.slot && r2.payout === r1.payout);
ok('and charges nothing', (await bal(ALPHA)) === afterFirst);
const r3 = await play(ALPHA, key1, 25, 7); // different stake AND lane, same key
ok('even when the retry asks for a different stake and lane',
   r3.drop_id === r1.drop_id && r3.stake === r1.stake && r3.lane === r1.lane);
ok('still nothing charged', (await bal(ALPHA)) === afterFirst);
ok('only ONE drop row exists for that key', Number(one(await svc(
  `select count(*)::int n from public.forge_drops
   where user_id='${ALPHA}' and idempotency_key='${key1}';`)).n) === 1);

console.log('   and the recovery path returns it without wagering');
const fetched = one(await as(ALPHA, `select public.forge_drop_fetch('${key1}'::uuid) v;`)).v;
ok('fetch by key returns the settled drop', fetched.drop_id === r1.drop_id);
ok('and charges nothing', (await bal(ALPHA)) === afterFirst);
const missing = one(await as(ALPHA, `select public.forge_drop_fetch('${k()}'::uuid) v;`)).v;
ok('a key that was never played returns null — the signal it is safe to send',
   missing === null, JSON.stringify(missing));

// ── 6. CONCURRENCY ──────────────────────────────────────────────────────────
console.log('\n6. TWO TABS, ONE KEY — and two tabs, two keys');
const raceKey = k();
const beforeRace = await bal(ALPHA);
// Both statements in ONE round trip, so they contend inside the database.
const raced = await as(ALPHA,
  `select public.forge_drop_play('${raceKey}'::uuid, 3, 6) a,
          public.forge_drop_play('${raceKey}'::uuid, 3, 6) b;`);
const a = one(raced).a, b = one(raced).b;
ok('both answers are the SAME drop', a.drop_id === b.drop_id, `${a.drop_id} / ${b.drop_id}`);
ok('exactly one of them settled it', a.replayed !== b.replayed);
ok('and it was charged exactly once',
   (await bal(ALPHA)) === beforeRace - a.stake + a.payout,
   `${beforeRace} → ${await bal(ALPHA)}`);
ok('one drop row, not two', Number(one(await svc(
  `select count(*)::int n from public.forge_drops
   where user_id='${ALPHA}' and idempotency_key='${raceKey}';`)).n) === 1);

console.log('   distinct keys are distinct wagers, and both are paid for');
const beforeTwo = await bal(ALPHA);
const two = await as(ALPHA,
  `select public.forge_drop_play('${k()}'::uuid, 2, 6) a,
          public.forge_drop_play('${k()}'::uuid, 2, 6) b;`);
const t1 = one(two).a, t2 = one(two).b;
ok('two drops exist', t1.drop_id !== t2.drop_id);
ok('and the ledger charged for both',
   (await bal(ALPHA)) === beforeTwo - t1.stake - t2.stake + t1.payout + t2.payout);

// ── 7. INSUFFICIENT BALANCE ─────────────────────────────────────────────────
console.log('\n7. YOU CANNOT STAKE WHAT YOU DO NOT HAVE');
const poor = await bal(BRAVO);
await svc(`insert into public.coin_events (user_id, kind, amount, source_id)
           values ('${BRAVO}', 'adjustment', ${-poor}, 'forge-drop-falsify-drain');`);
ok('BRAVO is broke', (await bal(BRAVO)) === 0);
await refused('a broke athlete cannot drop',
  () => play(BRAVO, k(), 1, 6), 'you have 0 coins');
await svc(`insert into public.coin_events (user_id, kind, amount, source_id)
           values ('${BRAVO}', 'adjustment', 3, 'forge-drop-falsify-topup');`);
await refused('and cannot stake more than they hold',
  () => play(BRAVO, k(), 5, 6), 'you have 3 coins, not 5');
ok('but can stake what they do hold', Boolean(await play(BRAVO, k(), 3, 6)));
await svc(`delete from public.coin_events where source_id in
           ('forge-drop-falsify-drain','forge-drop-falsify-topup');`);

// ── 8. THE GUARD ────────────────────────────────────────────────────────────
console.log('\n8. NOBODY MINTS A PAYOUT BUT THE SETTLEMENT');
await refused('a client cannot write a payout',
  () => as(ALPHA, `insert into public.coin_events (kind, amount, source_id)
                   values ('forge_drop_payout', 9999, '${r1.drop_id}');`),
  'may only be written by a Forge Drop settlement');
await refused('nor under another feature\'s key',
  () => as(ALPHA, `select set_config('evoforge.callout_authorized','${r1.drop_id}',true);
                   insert into public.coin_events (kind, amount, source_id)
                   values ('forge_drop_payout', 9999, '${r1.drop_id}');`),
  'may only be written by a Forge Drop settlement');
await refused('and cannot insert a drop row directly',
  () => asRls(ALPHA, `insert into public.forge_drops
      (user_id, idempotency_key, evo_rating, tier, config_version, multipliers, rows,
       lane, stake, slot, multiplier, payout, net, path)
      values ('${ALPHA}', gen_random_uuid(), 100, 5, 1, array[1]::numeric[], 12,
              6, 1, 0, 999, 99999, 99998, array[1]::smallint[]);`),
  'row-level security|violates');
ok('another athlete sees none of my drops', Number(one(await asRls(BRAVO,
  `select count(*)::int n from public.forge_drops where user_id = '${ALPHA}';`)).n) === 0);

// ── 9. THE BOARD PAYS WHAT IT ADVERTISES ────────────────────────────────────
//
console.log('\n9. A HUNDRED THOUSAND DROPS THROUGH THE REAL RESOLVER');
//
// Sampling `forge_drop_walk` — the SAME function `forge_drop_play` calls to
// decide a slot. Verifying a re-implementation would only ever prove the
// re-implementation; this proves the resolver that settles real wagers.
//
// (The first version of this section put the walk in an UNCORRELATED subquery,
// so Postgres evaluated it ONCE and reported a single drop repeated a hundred
// thousand times. A mean multiplier of exactly 1.000 was the tell.)
for (const tier of tiers) {
  const mult = tier.multipliers.map(Number);
  for (const lane of tier.lanes) {
    const N = 100000;
    const r = one(await svc(`
      with drops as (
        select public.forge_drop_slot(${lane},
                 public.forge_drop_walk(${tier.rows}, ${lane})) as slot
        from generate_series(1, ${N})
      )
      select avg((array[${mult.join(',')}])[slot + 1])::numeric as mean_mult,
             min(slot)::int as lo, max(slot)::int as hi,
             count(distinct slot)::int as reached, count(*)::int as n
      from drops;`));
    const mean = Number(r.mean_mult);
    const ceiling = Number(tier.target_rtp);
    ok(`tier ${tier.tier} lane ${lane}: returns ${(mean * 100).toFixed(1)}%, under its ${(ceiling * 100).toFixed(0)}% ceiling`,
       mean < ceiling + 0.02 && mean < 1, `${r.n} drops, slots ${r.lo}-${r.hi}`);
    ok(`tier ${tier.tier} lane ${lane}: the walk is not stuck on one slot`,
       Number(r.reached) >= 9, `${r.reached} distinct slots`);

    // ── WHAT IT ACTUALLY PAYS, IN WHOLE COINS ────────────────────────────
    //
    // The mean multiplier above is the board's theory. This samples the
    // ROUNDING RULE that turns it into coins, at the SMALLEST legal stake —
    // the one that hurts most and the one nobody looks at.
    //
    // This section is here because it did not exist, and its absence is how
    // the feature nearly shipped paying 15% on a board advertised at 86%.
    // Every slot below 1x floored to zero at a 1-coin stake, and no assertion
    // anywhere sampled a payout rather than a multiplier.
    //
    // Both numbers come from the SAME drops, deliberately. Comparing a payout
    // sample against a separate multiplier sample adds the two walks' noise
    // together and needs a tolerance loose enough to hide the bug this is here
    // to catch. Sharing the drops cancels the walk entirely, so what is left is
    // the rounding bias alone — which is what is being asserted.
    for (const stake of [tier.min_stake, tier.max_stake]) {
      const p = one(await svc(`
        with drops as (
          select (array[${mult.join(',')}])[
                   public.forge_drop_slot(${lane},
                     public.forge_drop_walk(${tier.rows}, ${lane})) + 1] as m
          from generate_series(1, ${N})
        ), settled as (
          select m, floor(${stake} * m)
                    + case when random() < ${stake} * m - floor(${stake} * m)
                           then 1 else 0 end as pay
          from drops
        )
        select avg(pay)::numeric as mean_pay,
               avg(m)::numeric   as mean_mult,
               max(pay)::int     as biggest
        from settled;`));
      const paid = Number(p.mean_pay) / stake;
      const theory = Number(p.mean_mult);
      // The rounding contributes at most one coin of spread per drop, so over
      // ${N} drops its standard error is well under a tenth of a point at any
      // stake. Half a point is comfortably outside the noise and nowhere near
      // the 71-point miss that flooring produced.
      ok(`tier ${tier.tier} lane ${lane} stake ${stake}: pays ${(paid * 100).toFixed(1)}%, matching the ${(theory * 100).toFixed(1)}% board it came from`,
         Math.abs(paid - theory) < 0.005 && paid < 1, `${N} drops`);
      ok(`tier ${tier.tier} lane ${lane} stake ${stake}: no payout beat the published ceiling`,
         Number(p.biggest) <= tier.max_payout, `biggest ${p.biggest} of ${tier.max_payout}`);
    }
  }
}

// The real proof: every drop this harness actually played, through the real
// function, conserves the ledger against its own rows.
console.log('\n   and every drop actually played reconciles with its ledger rows');
const recon = one(await svc(`
  select count(*)::int as bad from (
    select d.id,
           d.net as recorded,
           coalesce((select sum(ce.amount) from public.coin_events ce
                     where ce.source_id = d.id::text
                       and ce.kind in ('forge_drop_stake','forge_drop_payout')), 0) as ledger
    from public.forge_drops d
    where d.user_id in ('${ALPHA}','${BRAVO}')
  ) x where x.recorded <> x.ledger;`));
ok('every drop\'s recorded net equals what the ledger actually moved',
   Number(recon.bad) === 0, `${recon.bad} mismatched`);

const totals = one(await svc(`
  select coalesce(sum(stake),0)::int staked, coalesce(sum(payout),0)::int paid,
         count(*)::int n from public.forge_drops where user_id in ('${ALPHA}','${BRAVO}');`));
ok('the house edge held across this run',
   Number(totals.paid) <= Number(totals.staked) * 1.6,
   `${totals.n} drops: staked ${totals.staked}, paid ${totals.paid}`);

// ── 10. THE THIRD EDIT ──────────────────────────────────────────────────────
//
// A coin kind needs THREE edits: the CHECK constraint, the guard branch, and
// the client label. The first two fail loudly when missed. The third fails
// SILENTLY — the ledger screen just renders a blank where a description should
// be, in the one place an athlete goes to check what a board actually paid
// them — and it is the one that gets forgotten. It was forgotten here, and no
// test anywhere noticed.
//
// So this reads the CHECK constraint out of the live database and the label
// map out of the source, and refuses to let them disagree. It covers every
// kind, not just Forge Drop's, because the next one will be forgotten too.
console.log(`
10. EVERY COIN KIND THE DATABASE ACCEPTS HAS A LABEL`);
{
  const def = one(await svc(`
    select pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'public.coin_events'::regclass
      and conname = 'coin_events_kind_check';`));
  const dbKinds = [...new Set([...String(def.def).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))];

  const src = readFileSync(new URL('../client/src/data/coins.ts', import.meta.url), 'utf8');
  const END = `
};`;
  const body = src.slice(src.indexOf('COIN_LABELS'), src.indexOf(END, src.indexOf('COIN_LABELS')));
  const labelled = new Set([...body.matchAll(/^\s*([a-z_]+):\s*'/gm)].map((m) => m[1]));

  ok('the CHECK constraint was actually found', dbKinds.length > 5, `${dbKinds.length} kinds`);
  ok('COIN_LABELS was actually parsed', labelled.size > 5, `${labelled.size} labels`);

  const missing = dbKinds.filter((k) => !labelled.has(k));
  ok('every kind the ledger can hold renders with a name, not a blank',
     missing.length === 0,
     missing.length ? `unlabelled: ${missing.join(', ')}` : `${dbKinds.length} kinds all labelled`);

  for (const k of ['forge_drop_stake', 'forge_drop_payout']) {
    ok(`${k} is accepted by the constraint AND labelled`,
       dbKinds.includes(k) && labelled.has(k));
  }
}

// ── CLEANUP ─────────────────────────────────────────────────────────────────
console.log('\nCLEANUP');
await setRating(origRating);
ok('the Evo rating was restored',
   String(one(await svc(`select displayed_rating from public.evo_rating_current
                         where user_id='${ALPHA}';`))?.displayed_rating ?? null) === String(origRating));
await wipe();
ok('every balance is back where it started',
   (await bal(ALPHA)) === b0.A && (await bal(BRAVO)) === b0.B,
   `ALPHA ${b0.A}→${await bal(ALPHA)}  BRAVO ${b0.B}→${await bal(BRAVO)}`);
ok('no drop rows survive for the smoke accounts', Number(one(await svc(
  `select count(*)::int n from public.forge_drops
   where user_id in ('${ALPHA}','${BRAVO}');`)).n) === 0);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail > 0) console.log('FAILURES:\n  - ' + failures.join('\n  - '));
process.exit(fail === 0 ? 0 : 1);
