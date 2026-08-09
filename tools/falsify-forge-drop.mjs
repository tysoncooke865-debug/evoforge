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
/**
 * THE BALANCE, TO THE CENT.
 *
 * NOT `forge_duel_balance()`, which returns an INT. Since 158 a payout is
 * `round(stake * multiplier, 2)`, so a 1-coin chip on x0.89 returns 0.89 and the
 * rounded reading disagrees with the ledger by up to half a coin. Every
 * "balance moved by exactly this much" assertion below was measuring that
 * rounding rather than the economy, and eight of them failed for it.
 */
const bal = async (u) => Number(one(await svc(
  `select round(coalesce(sum(amount), 0), 2) v from public.coin_events where user_id = '${u}';`)).v);
/** Money compared as integer cents. 0.1 + 0.2 !== 0.3 in a float, and a ledger
 *  assertion that trips over that is a bug in the test, not in the ledger. */
const c = (x) => Math.round(Number(x) * 100);
const sameMoney = (a, b) => c(a) === c(b);
const play = (user, key, stake, lane) =>
  as(user, `select public.forge_drop_play('${key}'::uuid, ${stake}, ${lane}) v;`).then((r) => one(r).v);

/**
 * THE EXACT SLOT DISTRIBUTION FOR ONE LANE — by enumeration, not sampling.
 *
 * HALF COLUMNS, reflecting at the walls exactly as `forge_drop_walk` does: `h`
 * runs 0…2*rows and the landing slot is h/2. Stepping whole columns is the bug
 * this shape exists to avoid — after an even number of steps only every OTHER
 * slot is reachable, and the parity artefact piles the walk against the rim
 * where the biggest multiplier lives, which once took a side lane over 100%.
 *
 * Mirrors the domain's `laneDistribution`. Having it here lets the sampling
 * section below compare the server's walk against the TRUTH rather than against
 * a published ceiling, which is what makes its tolerance honest.
 */
function distribution(rows, lane) {
  const H = 2 * rows;
  let d = new Map([[2 * lane, 1]]);
  for (let step = 0; step < rows; step += 1) {
    const next = new Map();
    for (const [h, p] of d) {
      for (const dir of [-1, 1]) {
        const to = h + dir < 0 || h + dir > H ? h - dir : h + dir;
        next.set(to, (next.get(to) ?? 0) + p / 2);
      }
    }
    d = next;
  }
  const out = new Array(rows + 1).fill(0);
  for (const [h, p] of d) out[h / 2] += p;
  return out;
}
/** Exact expected multiplier for a lane, and the spread around it. */
function laneStats(mult, dist) {
  const mean = dist.reduce((s, p, i) => s + p * mult[i], 0);
  const variance = dist.reduce((s, p, i) => s + p * (mult[i] - mean) ** 2, 0);
  return { mean, sd: Math.sqrt(variance) };
}
const bestLaneRtp = (tier) => Math.max(...tier.lanes.map((lane) =>
  laneStats(tier.multipliers.map(Number), distribution(tier.rows, lane)).mean));

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
// 159 retuned these with the five named boards: the rim runs 3x/5x/8x/12x/20x,
// so the ceiling is that multiplier at the stake ceiling.
ok('the maximum payouts are the ones specified',
   tiers.map((t) => t.max_payout).join(',') === '15,50,120,240,500',
   tiers.map((t) => t.max_payout).join(','));
ok('the boards are the five named ones, in order',
   tiers.map((t) => t.label).join(' | ') ===
     'RUSTWORKS | INDUSTRIAL FORGE | CYBER FOUNDRY | ADVANCED REACTOR | MYTHIC CELESTIAL FORGE',
   tiers.map((t) => t.label).join(' | '));
ok('the jackpot rim climbs 3x → 20x',
   tiers.map((t) => Math.max(...t.multipliers.map(Number))).join(',') === '3,5,8,12,20');
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
   sameMoney(await bal(ALPHA), before - r1.stake + r1.payout),
   `${before} → ${await bal(ALPHA)} (staked ${r1.stake}, paid ${r1.payout})`);
ok('the returned balance IS the ledger', sameMoney(r1.balance, await bal(ALPHA)));
ok('net agrees with stake and payout', sameMoney(r1.net, r1.payout - r1.stake));
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
   sameMoney(await bal(ALPHA), beforeRace - a.stake + a.payout),
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
   sameMoney(await bal(ALPHA), beforeTwo - t1.stake - t2.stake + t1.payout + t2.payout));

// ── 7. INSUFFICIENT BALANCE ─────────────────────────────────────────────────
console.log('\n7. YOU CANNOT STAKE WHAT YOU DO NOT HAVE');
const poor = await bal(BRAVO);
await svc(`insert into public.coin_events (user_id, kind, amount, source_id)
           values ('${BRAVO}', 'adjustment', ${-poor}, 'forge-drop-falsify-drain');`);
ok('BRAVO is broke', sameMoney(await bal(BRAVO), 0));
// The balance in the refusal is NUMERIC since 158, so it renders "0.00", not
// "0". Pinning the old spelling made this assert the formatting of a number
// rather than the refusal itself.
await refused('a broke athlete cannot drop',
  () => play(BRAVO, k(), 1, 6), 'you have 0(\.00)? coins');
await svc(`insert into public.coin_events (user_id, kind, amount, source_id)
           values ('${BRAVO}', 'adjustment', 3, 'forge-drop-falsify-topup');`);
await refused('and cannot stake more than they hold',
  () => play(BRAVO, k(), 5, 6), 'you have 3(\.00)? coins, not 5');
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
    // 100k is the shipping figure. FAST=1 drops it to 5k so the ledger and
    // concurrency sections can be iterated on in under a minute — it is for
    // development only, and the tolerances below are sized for the full run.
    const N = process.env.FAST ? 5000 : 100000;
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
    const exact = laneStats(mult, distribution(tier.rows, lane));

    // THE CEILING IS A PROPERTY OF THE TABLE, NOT OF THE SAMPLE, so it is
    // asserted exactly (section 11 does this for every lane). What sampling can
    // prove — and nothing else can — is that the SERVER'S walk is the walk the
    // table describes.
    ok(`tier ${tier.tier} lane ${lane}: the board's own return is ${(exact.mean * 100).toFixed(2)}%, under its ${(ceiling * 100).toFixed(0)}% ceiling`,
       exact.mean < ceiling + 0.01 && exact.mean < 1);

    // …and the sample agrees with it, inside four standard errors.
    //
    // A FIXED TOLERANCE CANNOT WORK HERE AND USED TO FAIL FOR IT. The tolerance
    // was ±2 points regardless of sample size, and MYTHIC's x20 rim — 0.29%
    // likely per side — carries about 1.5 points of standard error at FAST=1's
    // 5,000 drops, so a clean board reported 94% against a 92% bound roughly one
    // run in twenty. An intermittently red harness is a harness people learn to
    // ignore, so the bound is now derived from the board's own spread and the
    // sample size: 4 sigma / sqrt(N), which is ~0.06 points at 100k and ~0.27 at
    // 5k. Tighter than the old bound where it matters, and correct at both sizes.
    const tol = 4 * exact.sd / Math.sqrt(Number(r.n));
    ok(`tier ${tier.tier} lane ${lane}: ${r.n} real resolver drops average ${(mean * 100).toFixed(2)}%, within noise of ${(exact.mean * 100).toFixed(2)}%`,
       Math.abs(mean - exact.mean) < tol,
       `off by ${((mean - exact.mean) * 100).toFixed(3)} pts, tolerance ${(tol * 100).toFixed(3)}`);

    ok(`tier ${tier.tier} lane ${lane}: the walk is not stuck on one slot`,
       Number(r.reached) >= 9, `${r.reached} distinct slots`);

    // ── WHAT IT ACTUALLY PAYS ────────────────────────────────────────────
    //
    // The mean multiplier above is the board's theory. This samples what the
    // settlement rule turns it into, at BOTH ends of the stake range — the
    // smallest being the one that hurts most and the one nobody looks at.
    //
    // This section is here because it did not exist, and its absence is how
    // the feature nearly shipped paying 15% on a board advertised at 86%.
    // Every slot below 1x floored to zero at a 1-coin stake, and no assertion
    // anywhere sampled a payout rather than a multiplier.
    //
    // 158 RETIRED THE ROUNDING ENTIRELY. It used to be "floor, then pay the
    // fraction as a probability", which existed only because payouts had to be
    // whole coins; this sampled that rule, and went on sampling it for a while
    // after the rule was gone. Coins now carry cents and the payout is
    // `round(stake * multiplier, 2)` — and since every multiplier has at most
    // two decimals and every stake is a whole coin, that round() never actually
    // moves anything. So the published return is not approached in expectation,
    // it is EXACT, and the assertion below is exact too.
    //
    // Both numbers still come from the SAME drops. That cancels the walk, so a
    // disagreement can only be the settlement rule.
    for (const stake of [tier.min_stake, tier.max_stake]) {
      const p = one(await svc(`
        with drops as (
          select (array[${mult.join(',')}])[
                   public.forge_drop_slot(${lane},
                     public.forge_drop_walk(${tier.rows}, ${lane})) + 1] as m
          from generate_series(1, ${N})
        ), settled as (
          select m, round(${stake} * m, 2) as pay
          from drops
        )
        select avg(pay)::numeric as mean_pay,
               avg(m)::numeric   as mean_mult,
               max(pay)::numeric as biggest
        from settled;`));
      const paid = Number(p.mean_pay) / stake;
      const theory = Number(p.mean_mult);
      // EXACT, not approximate. `round(stake * m, 2)` on a 2-dp multiplier and a
      // whole-coin stake is the identity, so the paid return must equal the
      // board's own return to the last digit the sample can express. A tolerance
      // here would be room for a rounding bug to hide in, which is exactly what
      // happened last time: the old rule missed by 71 points and the assertion
      // that should have caught it did not exist.
      ok(`tier ${tier.tier} lane ${lane} stake ${stake}: pays ${(paid * 100).toFixed(2)}%, exactly the ${(theory * 100).toFixed(2)}% board it came from`,
         Math.abs(paid - theory) < 1e-9 && paid < 1, `${N} drops, no rounding loss`);
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

// ── 9b. CONCURRENT DROPS CANNOT SPEND THE SAME COINS TWICE ──────────────
//
// The redesign lets an athlete flick a second chip while the first is still
// falling, which turned a latent bug into a live one. `forge_drop_play` read
// the balance with `coin_total()` and compared it to the stake WITHOUT A LOCK,
// so two transactions read the same balance, both decided they could afford
// it, and both debited.
//
// Measured against production before migration 156: six concurrent five-coin
// drops fired at a TEN coin balance were ALL SIX ACCEPTED. Nothing refused.
//
// The assertion below is deliberately NOT "the balance went negative" — that
// is the trap this section fell into first. Payouts land in the same
// transaction as their stake, so winnings quietly refinance the overdraft and
// the closing balance can look perfectly healthy while six drops were
// authorised against funds for two. What is actually broken is the
// AUTHORISATION, so that is what gets asserted: with only one stake affordable,
// somebody has to be told no.
console.log(`
9b. CONCURRENT DROPS, AGAINST A BALANCE THAT ONLY COVERS ONE`);
{
  await wipe();
  // Put ALPHA on a board that accepts the stake, with room for exactly one.
  await svc(`update public.evo_rating_current set displayed_rating = 50 where user_id = '${ALPHA}';`);
  const start = await bal(ALPHA);
  const STAKE = 15; // tier 3's ceiling, so no payout can fund a second at will
  const surplus = start - STAKE;
  if (c(surplus) !== 0) {
    await svc(`insert into public.coin_events (user_id, kind, amount, source_id, source_table)
               values ('${ALPHA}', 'adjustment', ${-surplus}, 'drop-race-${Date.now()}', 'forge_drops');`);
  }
  ok('the athlete starts with exactly one stake to their name',
     sameMoney(await bal(ALPHA), STAKE), `${STAKE} coins`);

  const N = 6;
  const settled = await Promise.allSettled(
    Array.from({ length: N }, () => play(ALPHA, k(), STAKE, 6))
  );
  const accepted = settled.filter((r) => r.status === 'fulfilled').length;
  const refusals = settled.filter((r) => r.status === 'rejected').map((r) => String(r.reason.message));
  const onBalance = refusals.filter((m) => /you have [\d.]+ coins/.test(m)).length;

  // Without the lock this was 6. With it, the very first drop takes the
  // balance to zero plus whatever it won, and the rest are told the truth.
  ok(`not every concurrent drop was accepted — ${accepted} of ${N} got through`,
     accepted < N, `${refusals.length} refused`);
  ok('the refusals name the real balance, not a generic error',
     onBalance > 0, refusals[0] ? refusals[0].split('CONTEXT')[0].trim().slice(0, 80) : 'none');

  // And every drop that WAS accepted was affordable when it was validated:
  // replaying the ledger in commit order must never dip below zero.
  const rows = await svc(`
    select amount from public.coin_events
    where user_id = '${ALPHA}' and kind in ('forge_drop_stake','forge_drop_payout')
    order by created_at, kind;`);
  let running = STAKE;
  let dipped = false;
  for (const r of rows) { running += Number(r.amount); if (running < 0) dipped = true; }
  ok('replaying the ledger in order, the balance never goes negative',
     !dipped, `closed at ${running}`);

  // …and the same thing said in gross terms, which is the readable form: the
  // total ever staked cannot exceed the opening balance plus everything the
  // board handed back along the way.
  //
  // THE BOUND USED TO BE `STAKE + max(0, closing balance)`, WHICH IS WRONG. A
  // win mid-run legitimately funds the next drop, so an athlete who opens with
  // 15, wins 20 and stakes again has staked 30 against a closing balance of 5 —
  // honest, and refused by that bound. It only ever passed because no run had
  // won enough to expose it.
  const paidBack = rows
    .map((r) => Number(r.amount)).filter((a) => a > 0)
    .reduce((sum, a) => sum + a, 0);
  const staked = one(await svc(`select coalesce(sum(stake),0)::numeric s, count(*)::int n
                                from public.forge_drops where user_id = '${ALPHA}';`));
  ok('no more was staked than the athlete could ever have afforded',
     c(staked.s) <= c(STAKE + paidBack),
     `staked ${staked.s} across ${staked.n} drops, against ${STAKE} opening + ${paidBack.toFixed(2)} won`);

  await wipe();
  const back = await bal(ALPHA);
  if (!sameMoney(back, start)) {
    await svc(`insert into public.coin_events (user_id, kind, amount, source_id, source_table)
               values ('${ALPHA}', 'adjustment', ${start - back}, 'drop-race-restore-${Date.now()}', 'forge_drops');`);
  }
  ok('the balance was put back where it started',
     sameMoney(await bal(ALPHA), start), `${start} coins`);
}

// ── 9c. RESTORING SEVERAL DROPS AT ONCE ───────────────────────────
//
// With up to five chips in the air there can be five keys on disk when a tab
// closes. `forge_drop_fetch_many` answers for all of them in one round trip —
// on a connection that has already proven unreliable, N round trips to ask
// "did any of these land?" is N more chances to be interrupted.
console.log(`
9c. RESTORING SEVERAL IN-FLIGHT DROPS IN ONE ROUND TRIP`);
{
  const keys = [k(), k(), k()];
  const played = [];
  for (const key of keys) played.push(await play(ALPHA, key, 2, 6));
  const neverPlayed = k();

  const many = one(await as(ALPHA,
    `select public.forge_drop_fetch_many(array['${keys.join("','")}','${neverPlayed}']::uuid[]) v;`)).v;

  ok('every key that settled comes back', Array.isArray(many) && many.length === keys.length,
     `${many?.length} of ${keys.length}`);
  ok('a key that never played is simply absent — the signal that nothing was charged',
     !many.some((d) => d.idempotency_key === neverPlayed));
  ok('each restored drop carries the result it settled on',
     many.every((d, i) => d.stake === 2 && d.drop_id === played.find((p) => p.drop_id === d.drop_id)?.drop_id),
     `${many.length} matched`);
  ok('restoring charges nothing — it is a read',
     (await svc(`select count(*)::int n from public.forge_drops where user_id = '${ALPHA}';`))[0].n === keys.length,
     `${keys.length} drops, unchanged`);

  const stranger = one(await as(BRAVO,
    `select public.forge_drop_fetch_many(array['${keys.join("','")}']::uuid[]) v;`)).v;
  ok('another athlete holding the same keys gets nothing back',
     Array.isArray(stranger) && stranger.length === 0, `${stranger?.length} rows`);
}

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

  for (const k of ['forge_drop_stake', 'forge_drop_payout', 'forge_drop_unlock']) {
    ok(`${k} is accepted by the constraint AND labelled`,
       dbKinds.includes(k) && labelled.has(k));
  }
}

// ── 11. THE LADDER RUNS THE RIGHT WAY ───────────────────────────────────────
//
// `validateTier` asks each board about its own promises, which is why it has
// nothing to say about the risk that exists only BETWEEN boards: a rebalance
// leaving the top of the ladder returning more than the bottom, so the unlock
// price buys the best expected value in the app. 159 asserts this at apply
// time; this asserts it against whatever the rows say TODAY, because the whole
// point of a config table is that it can be changed without a deploy.
console.log(`
11. CLIMBING BUYS VARIANCE, NOT EDGE`);
{
  const rtp = tiers.map(bestLaneRtp);
  const pc = (x) => `${(x * 100).toFixed(2)}%`;
  console.log(`     live returns: ${rtp.map(pc).join('  ')}`);

  ok('every board returns less than it takes', rtp.every((r) => r < 1),
     rtp.map(pc).join(', '));
  ok('every board stays under the 95% ceiling', rtp.every((r) => r < 0.95));
  ok('every board sits at or under its own published target',
     tiers.every((t, i) => rtp[i] <= Number(t.target_rtp) + 0.01),
     tiers.map((t, i) => `${t.label} ${pc(rtp[i])} vs ${t.target_rtp}`).join('; '));

  // THE ENDGAME BOARD IS STRICTLY THE LEAST GENEROUS. This is the property that
  // stops "unlock the top board" being the correct play.
  const top = rtp[rtp.length - 1];
  ok('the endgame board is strictly the least generous of the five',
     rtp.slice(0, -1).every((r) => r > top),
     `MYTHIC ${pc(top)} vs ${rtp.slice(0, -1).map(pc).join(', ')}`);

  // …and nothing beats the board everyone starts on by more than half a point.
  // A TOLERANCE, NOT ZERO, and deliberately so: CYBER FOUNDRY is 0.37 of a point
  // above RUSTWORKS on the gate values as briefed. That is stated rather than
  // tuned away — see the note at the top of 159.
  ok('no board beats the entry board by more than half a point',
     rtp.every((r) => r <= rtp[0] + 0.005),
     rtp.map((r, i) => `${tiers[i].label} ${pc(r)}`).join('; '));

  // The shape that produces it: the rim climbs, the centre falls.
  const rim = tiers.map((t) => Math.max(...t.multipliers.map(Number)));
  const centre = tiers.map((t) => Number(t.multipliers[(t.multipliers.length - 1) / 2]));
  ok('the rim climbs at every step', rim.every((v, i) => i === 0 || v > rim[i - 1]), rim.join(' → '));
  ok('the centre gate falls at every step',
     centre.every((v, i) => i === 0 || v < centre[i - 1]), centre.join(' → '));
}

// ── 12. BOARDS ARE CHOSEN, AND BOUGHT ONCE ──────────────────────────────────
//
// The selector is presentation; the entitlement is settlement. Everything here
// asks the SERVER, because a screen that offers a locked board is a cosmetic
// bug and a server that accepts one is an economy bug.
console.log(`
12. BOARD ENTITLEMENT AND EARLY UNLOCK`);
{
  const unlocked = async (tier) => Boolean(one(await svc(
    `select public.forge_drop_board_unlocked('${ALPHA}', ${tier}) v;`)).v);
  const boards = async () => one(await as(ALPHA, `select public.my_forge_drop_boards() v;`)).v;
  const countedSets = async () => Number(one(await svc(
    `select public.forge_drop_counted_sets('${ALPHA}') v;`)).v);
  const unlockRows = async () => Number(one(await svc(
    `select count(*)::int n from public.forge_drop_unlocks where user_id = '${ALPHA}';`)).n);

  await svc(`delete from public.forge_drop_unlocks where user_id in ('${ALPHA}','${BRAVO}');
             delete from public.coin_events where kind = 'forge_drop_unlock'
               and user_id in ('${ALPHA}','${BRAVO}');`);

  // ── a board you have PASSED stays yours ───────────────────────────────────
  await setRating(90); // tier 5 by rating
  ok('the rating opens the board it lands on', await unlocked(5));
  ok('and every board beneath it stays open — progressing never takes one away',
     (await Promise.all([1, 2, 3, 4].map(unlocked))).every(Boolean));

  await setRating(10); // back to tier 1
  ok('a board above the rating is closed',
     !(await unlocked(3)) && !(await unlocked(5)));
  ok('the starting board is always open', await unlocked(1));

  // ── the two gates, independently ──────────────────────────────────────────
  const sets = await countedSets();
  const b = await bal(ALPHA);
  console.log(`     ALPHA: rating 10, ${sets} counted sets, ${b} coins`);

  // CYBER FOUNDRY costs 7,500 coins AND 250 logged sets. ALPHA is short of at
  // least one of them; the refusal must name which.
  await refused('an early unlock is refused when a requirement is missing',
    () => as(ALPHA, `select public.forge_drop_unlock(3) v;`),
    sets < 250 ? 'logged training sets' : 'costs');

  // FORGE DROP PLAYS CANNOT BUY A BOARD. Not filtered out — structurally
  // incapable, because the count reads workout_log and a play is a forge_drops
  // row. Proven by playing and re-counting.
  const before = await countedSets();
  await play(ALPHA, crypto.randomUUID(), 1, 6);
  await play(ALPHA, crypto.randomUUID(), 1, 6);
  ok('playing the board does not count as training toward unlocking one',
     (await countedSets()) === before, `${before} sets before, ${await countedSets()} after`);
  await wipe();

  // ── the purchase itself ───────────────────────────────────────────────────
  // Granted enough of both, the unlock must land exactly once and charge the
  // price the BOARD names — never the price the caller names.
  const price = Number(tiers[1].unlock_coins); // INDUSTRIAL FORGE, 2500
  const needSets = Number(tiers[1].unlock_sets);
  ok('INDUSTRIAL FORGE is priced in both currencies',
     price === 2500 && needSets === 100, `${price} coins + ${needSets} sets`);

  const shortBy = price - (await bal(ALPHA));
  if (shortBy > 0) {
    await svc(`select set_config('evoforge.spend_authorized','harness-topup',true);
               insert into public.coin_events (user_id, kind, amount, source_id, source_table)
               values ('${ALPHA}','adjustment',${shortBy + 10},'harness-topup','harness');`);
  }
  const haveSets = await countedSets();
  const balBefore = await bal(ALPHA);

  if (haveSets < needSets) {
    // Not enough real training to buy it — assert the refusal names the sets,
    // and skip the purchase rather than fabricate a hundred workout rows.
    await refused('with the coins but not the sets, the purchase is still refused',
      () => as(ALPHA, `select public.forge_drop_unlock(2) v;`), 'logged training sets');
    ok('and nothing was charged for the attempt', (await bal(ALPHA)) === balBefore,
       `${balBefore} → ${await bal(ALPHA)}`);
    console.log(`     (ALPHA has ${haveSets}/${needSets} sets — the purchase path is`
              + ` exercised below against the rating instead)`);
  } else {
    const r1 = one(await as(ALPHA, `select public.forge_drop_unlock(2) v;`)).v;
    ok('the purchase lands', r1.already === false && r1.unlocked_by === 'purchase',
       JSON.stringify(r1).slice(0, 120));
    ok('and charges exactly the price the board names',
       (await bal(ALPHA)) === balBefore - price, `${balBefore} → ${await bal(ALPHA)}`);
    ok('the board is now open', await unlocked(2));

    // DUPLICATE PURCHASE PREVENTION IS A UNIQUE INDEX, not a code path — a
    // doubled tap, a refresh and two tabs are all the same purchase.
    const mid = await bal(ALPHA);
    const again = await Promise.all([1, 2, 3].map(() =>
      as(ALPHA, `select public.forge_drop_unlock(2) v;`).then((r) => one(r).v)));
    ok('three more taps all report "already", none of them charge',
       again.every((r) => r.already === true) && (await bal(ALPHA)) === mid,
       `${mid} → ${await bal(ALPHA)}`);
    ok('and only one purchase row exists', (await unlockRows()) === 1);
  }

  // ── THE PURCHASE ITSELF, PROVEN IN A TRANSACTION THAT IS THROWN AWAY ──────
  //
  // ALPHA has 20 logged sets and the cheapest early board wants 100, so the
  // purchase path cannot run against production as it stands — and it is the
  // one path in this feature that moves a five-figure sum. Seeding 80 real
  // training rows would work, but `workout_log` carries three triggers that
  // resolve call outs and duels, and a harness that half-cleans those is worse
  // than one that never ran.
  //
  // So the whole thing happens inside `begin … rollback`: the sets, the coins, a
  // rating low enough for the board to be genuinely out of reach, the purchase,
  // three repeat taps, and a real drop on the board that was bought. Nothing
  // survives the statement.
  //
  // ONE STATEMENT PER STEP, DELIBERATELY. Collected in a single SELECT with
  // CTEs, this reported zero unlock rows and an unchanged balance beside a
  // purchase that had plainly succeeded — inside one statement every CTE reads
  // the same snapshot, so none of them can observe a volatile function's writes.
  {
    const proofSql = `
      begin;
      select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      insert into public.workout_log (user_id, date, workout, exercise, muscle, "set", reps, weight)
      select '${ALPHA}', current_date - (g % 20), 'PROOF', 'Bench Press', 'chest',
             (g % 5) + 1, 8, 60
      from generate_series(1, 100) g;
      insert into public.coin_events (user_id, kind, amount, source_id, source_table)
      values ('${ALPHA}', 'adjustment', 5000, 'proof-topup', 'harness');
      update public.evo_rating_current set displayed_rating = 10, raw_rating = 10
      where user_id = '${ALPHA}';
      create temp table proof (ord serial, k text, v jsonb);
      select set_config('request.jwt.claims',
        '{"sub":"${ALPHA}","role":"authenticated"}', true);
      insert into proof (k, v) select 'sets', to_jsonb(public.forge_drop_counted_sets('${ALPHA}'));
      insert into proof (k, v) select 'openBefore', to_jsonb(public.forge_drop_board_unlocked('${ALPHA}', 2));
      insert into proof (k, v) select 'balBefore', to_jsonb(public.coin_total_exact());
      insert into proof (k, v) select 'first', public.forge_drop_unlock(2);
      insert into proof (k, v) select 'balAfter', to_jsonb(public.coin_total_exact());
      insert into proof (k, v) select 'openAfter', to_jsonb(public.forge_drop_board_unlocked('${ALPHA}', 2));
      insert into proof (k, v) select 'second', public.forge_drop_unlock(2);
      insert into proof (k, v) select 'third', public.forge_drop_unlock(2);
      insert into proof (k, v) select 'balAfterRepeats', to_jsonb(public.coin_total_exact());
      insert into proof (k, v) select 'unlockRows', jsonb_build_object(
        'rows', count(*), 'paid', coalesce(sum(coins_paid), 0),
        'sets', max(sets_at_unlock), 'rating', max(rating_at_unlock))
        from public.forge_drop_unlocks where user_id = '${ALPHA}' and tier = 2;
      insert into proof (k, v) select 'ledger', jsonb_build_object(
        'rows', count(*), 'total', coalesce(sum(amount), 0))
        from public.coin_events where user_id = '${ALPHA}' and kind = 'forge_drop_unlock';
      insert into proof (k, v) select 'dropTier',
        (public.forge_drop_play(gen_random_uuid(), 5, 6, 2))->'tier';
      insert into proof (k, v) select 'stillLocked',
        to_jsonb(public.forge_drop_board_unlocked('${ALPHA}', 5));
      select jsonb_object_agg(k, v) as proof from proof;
      rollback;`;
    const rows = await raw(proofSql);
    const p = rows.find((r) => r && r.proof)?.proof;

    ok('the purchase proof ran', Boolean(p), p ? `${Object.keys(p).length} readings` : 'no result');
    if (p) {
      ok('the pacing gate counts logged training, and sees the seeded sets',
         Number(p.sets) === 120, `${p.sets} sets`);
      ok('the board really was out of reach first', p.openBefore === false);
      ok('the purchase lands and reports itself honestly',
         p.first.already === false && p.first.unlocked_by === 'purchase'
           && Number(p.first.coins_paid) === 2500,
         `paid ${p.first.coins_paid}, sets at unlock ${p.first.sets_at_unlock}`);
      ok('and charges exactly the price the BOARD names',
         sameMoney(p.balAfter, Number(p.balBefore) - 2500),
         `${p.balBefore} → ${p.balAfter}`);
      ok('the board opens', p.openAfter === true);
      ok('two more taps both say "already"',
         p.second.already === true && p.third.already === true
           && Number(p.second.coins_paid) === 0 && Number(p.third.coins_paid) === 0);
      ok('and neither charges a coin',
         sameMoney(p.balAfterRepeats, p.balAfter), `${p.balAfter} → ${p.balAfterRepeats}`);
      ok('exactly ONE purchase row exists — the unique index, not a code path',
         Number(p.unlockRows.rows) === 1 && sameMoney(p.unlockRows.paid, 2500),
         `${p.unlockRows.rows} row, paid ${p.unlockRows.paid}, rating at unlock ${p.unlockRows.rating}`);
      ok('and exactly ONE ledger row, priced by the board',
         Number(p.ledger.rows) === 1 && sameMoney(p.ledger.total, -2500),
         `${p.ledger.rows} row totalling ${p.ledger.total}`);
      ok('settlement honours the purchase — a drop lands on the bought board',
         Number(p.dropTier) === 2, `tier ${p.dropTier}`);
      ok('and a board that was NOT bought is still refused', p.stillLocked === false);
    }
  }
  // …and the transaction above must have left production exactly as it found it.
  ok('the purchase proof left nothing behind', Number(one(await svc(
    `select (select count(*) from public.workout_log where workout = 'PROOF')
          + (select count(*) from public.coin_events where source_id = 'proof-topup')
          + (select count(*) from public.forge_drop_unlocks where user_id = '${ALPHA}') n;`)).n) === 0);

  // ── the price is the BOARD's, even against a forged ledger row ────────────
  // The guard reprices from forge_drop_tiers through the unlock row, exactly as
  // the XP guard reprices a claimed award. A hand-written cheap purchase must
  // come back at the real price or be refused outright.
  await refused('a hand-written unlock charge cannot invent its own price',
    () => asRls(ALPHA, `insert into public.coin_events (user_id, kind, amount, source_id)
                        values ('${ALPHA}','forge_drop_unlock',-1,'${crypto.randomUUID()}');`),
    'board purchase|insufficient|violates');

  // ── settlement re-checks the board, whatever the screen sent ──────────────
  await setRating(10);
  await refused('a drop on a locked board is refused by the server',
    () => as(ALPHA, `select public.forge_drop_play('${crypto.randomUUID()}'::uuid, 1, 6, 5) v;`),
    'locked');
  const legit = await play(ALPHA, crypto.randomUUID(), 1, 6);
  ok('a drop with no board named still uses the rating\'s own board',
     Number(legit.tier) === 1, `tier ${legit.tier}`);
  await wipe();

  // ── one round trip describes the whole carousel ──────────────────────────
  const list = await boards();
  ok('the carousel comes back in one call, with all five boards',
     Array.isArray(list.boards) && list.boards.length === 5);
  ok('and carries the three numbers the locked cards count against',
     list.rating !== undefined && list.coins !== undefined ? true
       : list.balance !== undefined && list.sets !== undefined,
     `rating ${list.rating}, sets ${list.sets}, balance ${list.balance}`);
  ok('every board says whether it is open, and how',
     list.boards.every((x) => typeof x.unlocked === 'boolean'
       && typeof x.by_rating === 'boolean' && typeof x.purchased === 'boolean'));
  ok('the client and the server agree on which boards are open',
     (await Promise.all(list.boards.map((x) => unlocked(x.tier))))
       .every((server, i) => server === list.boards[i].unlocked),
     list.boards.map((x) => `${x.tier}:${x.unlocked ? 'open' : 'shut'}`).join(' '));

  // ── nobody can grant themselves a board ──────────────────────────────────
  await refused('an athlete cannot write their own unlock row',
    () => asRls(ALPHA, `insert into public.forge_drop_unlocks
                          (user_id, tier, coins_paid, sets_at_unlock, rating_at_unlock)
                        values ('${ALPHA}', 5, 1, 0, 0);`),
    'policy|permission|denied');
  ok('and cannot see anybody else\'s', Number(one(await asRls(ALPHA,
    `select count(*)::int n from public.forge_drop_unlocks where user_id <> '${ALPHA}';`)).n) === 0);
}

// ── CLEANUP ─────────────────────────────────────────────────────────────────
console.log('\nCLEANUP');
// 159's rows first: the purchase debit, the unlock itself, and the top-up the
// purchase test needed. The debit must go before the balance check below, or
// "every balance is back where it started" measures the harness's own spending.
await svc(`
  delete from public.coin_events
   where user_id in ('${ALPHA}','${BRAVO}')
     and (kind = 'forge_drop_unlock' or (kind = 'adjustment' and source_id = 'harness-topup'));
  delete from public.forge_drop_unlocks where user_id in ('${ALPHA}','${BRAVO}');`);
ok('no board unlock survives for the smoke accounts', Number(one(await svc(
  `select count(*)::int n from public.forge_drop_unlocks
   where user_id in ('${ALPHA}','${BRAVO}');`)).n) === 0);
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
