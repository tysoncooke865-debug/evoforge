/**
 * THE COMPLIANCE GATE — the factual claims, checked against production.
 *
 * THIS TOOL DOES NOT SAY THE APP IS LEGALLY CLEARED, and it must never be read that
 * way. Classification is a judgement about a jurisdiction's rules applied to a
 * product, and no script can make it. What this does is establish the FACTS a
 * reviewer would otherwise have to take on trust — each one measured, from the live
 * database and the shipped bundle, so a legal review argues about consequences
 * instead of first having to discover what the app does.
 *
 * The four claims that matter, and why each is the one that matters:
 *
 *   1. NO DEDUCTION IS DOWNSTREAM OF RANDOMNESS. This is the balance-decrease test.
 *      A stake that a random outcome can reduce is the mechanic that mandates R18+
 *      under the Guidelines for the Classification of Computer Games 2023, and
 *      earned-only currency does NOT exempt it — it is a mechanics test.
 *
 *   2. CHANCE AND PLEDGE NEVER COMBINE. Chance is additive with no stake; pledges
 *      are skill-resolved with no chance. Enforced at build time by
 *      client/src/domain/__tests__/module-boundaries.test.ts.
 *
 *   3. THE MONEY WALLS HOLD. Coins cannot be bought, cashed out, or transferred
 *      except by settlement between participants. No payment SDK ships at all.
 *
 *   4. THE VOCABULARY IS CLEAN. §10's ban, on every user-facing surface including
 *      SQL exception text, which reaches athletes as toasts.
 *
 * Anything this cannot verify is printed as an OPEN QUESTION rather than omitted.
 * A gate that silently skips what it cannot check is worse than no gate, because it
 * reads as coverage.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MGMT = readFileSync(join(ROOT, 'client/.env.sbtoken.local'), 'utf8').replace(/^.*=/, '').trim();

let pass = 0;
const fails = [];
const open = [];
const facts = [];

const check = (ok, label, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fails.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
  facts.push({ ok, label, detail });
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

console.log('\n=== EVOFORGE COMPLIANCE GATE — facts, not a legal opinion ===\n');
console.log('--- 1. No deduction is downstream of randomness (balance-decrease test)\n');

// EVERY function that uses randomness, and whether it can touch the ledger.
const rng = await sql(`
  select p.proname,
    (pg_get_functiondef(p.oid) like '%coin_events%') as touches_coins
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and pg_get_functiondef(p.oid) ilike '%random(%'
  order by 1;`);
const rngCoins = rng.filter((r) => r.touches_coins).map((r) => r.proname);
console.log(`        functions using random(): ${rng.map((r) => r.proname).join(', ')}`);
check(
  rngCoins.length === 1 && rngCoins[0] === 'forge_reveal_claim',
  'exactly ONE random function can reach the ledger, and it is the reveal',
  rngCoins.join(', ') || 'none'
);

// And that one is additive by CHECK CONSTRAINT — not by the function's good manners.
const addsOnly = await sql(`
  select pg_get_constraintdef(oid) as def from pg_constraint
  where conrelid = 'public.coin_events'::regclass and conname = 'coin_events_reveal_adds_only';`);
check(
  addsOnly.length === 1 && /amount > \(?0/.test(addsOnly[0].def),
  'a reveal can only ADD coins, enforced by CHECK constraint',
  addsOnly[0]?.def ?? 'CONSTRAINT MISSING'
);

// The reveal cannot even be given a stake: the signature has no such argument.
const revealArgs = await sql(`
  select pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'forge_reveal_claim';`);
check(
  revealArgs.length === 1 && !/int|numeric|stake|amount/i.test(revealArgs[0].args),
  'a staked reveal is UNCONSTRUCTIBLE — the signature takes no amount',
  revealArgs[0]?.args ?? 'missing'
);

// No pledge or settlement path may use randomness at all.
const pledgeRng = await sql(`
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'callout_%' or p.proname like 'forge_duel%'
         or p.proname like 'forge_trial%' or p.proname like '%settle%')
    and pg_get_functiondef(p.oid) ilike '%random(%'
  order by 1;`);
check(
  pledgeRng.length === 0,
  'ZERO randomness in any pledge, duel, trial or settlement function',
  pledgeRng.map((r) => r.proname).join(', ') || 'none'
);

console.log('\n--- 2. Chance and pledge never combine\n');

let boundaries = 'not run';
try {
  execFileSync('npx', ['vitest', 'run', 'src/domain/__tests__/module-boundaries.test.ts'], {
    cwd: join(ROOT, 'client'),
    stdio: 'pipe',
    shell: process.platform === 'win32',
  });
  boundaries = 'green';
} catch (e) {
  boundaries = `RED: ${String(e.message).slice(0, 120)}`;
}
check(boundaries === 'green', 'the module boundary test holds chance and pledge apart', boundaries);

console.log('\n--- 3. The money walls\n');

const walls = (await sql(`
  select
    (select count(*) from information_schema.tables where table_schema = 'public'
       and (table_name ilike '%purchase%' or table_name ilike '%receipt%'
            or table_name ilike '%payment%' or table_name ilike '%withdraw%'
            or table_name ilike '%cashout%' or table_name ilike '%payout_request%')) as money_tables,
    (select coalesce(string_agg(policyname || ':' || cmd, ', '), 'none') from pg_policies
       where schemaname = 'public' and tablename = 'coin_events') as coin_policies;`))[0];
check(Number(walls.money_tables) === 0,
  'no purchase, receipt, payment, withdrawal or cash-out table exists',
  `${walls.money_tables} found`);

const pkg = readFileSync(join(ROOT, 'client/package.json'), 'utf8');
const paySdk = /in-app-purchase|revenuecat|stripe|braintree|paypal|react-native-iap/i.test(pkg);
check(!paySdk, 'no payment SDK is shipped in the client at all',
  paySdk ? 'a payment dependency is present' : 'none in package.json');

// Coins can only ever be written for yourself, and the guard fixes every amount.
check(/coin_events_owner_insert:INSERT/.test(walls.coin_policies)
  && !/coin_events.*(UPDATE|DELETE)/.test(walls.coin_policies),
  'the ledger is append-only and owner-scoped: no client UPDATE or DELETE',
  walls.coin_policies);

// Spending exists — and only ever on cosmetics.
const spends = await sql(`
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname ilike 'purchase%' order by 1;`);
check(spends.every((r) => /skin|palette|character/i.test(r.proname)),
  'coins are spent only on cosmetics, never converted outward',
  spends.map((r) => r.proname).join(', ') || 'none');

console.log('\n--- 4. Vocabulary (§10)\n');

let sweep = 'not run';
try {
  execFileSync('node', ['tools/sweep-vocabulary.mjs', '--strict'], {
    cwd: ROOT, stdio: 'pipe',
  });
  sweep = 'clean';
} catch {
  sweep = 'HITS FOUND';
}
check(sweep === 'clean', 'no banned vocabulary on any user-facing surface', sweep);

// ─────────────────────────────────────────────────── what this cannot answer

open.push(
  'A LEGAL OPINION. This tool checks mechanics; whether those mechanics clear a ' +
  'given jurisdiction is a judgement no script can make. The one-off external ' +
  'review before first submission with Trials live remains outstanding.'
);
open.push(
  'THIRD-PARTY POOLS (180-187). A friend may put coins on another athlete\'s set ' +
  'and cannot influence the outcome. Skill-resolved with zero RNG and no rake, so ' +
  'it trips neither governing invariant — but it is the closest mechanic in the ' +
  'product to a book and should be reviewed as such rather than discovered.'
);
open.push(
  'BATTLE REWARDS are chance-influenced and additive (capped 25/day). Free entry, ' +
  'no stake, cannot reduce a balance — but whether an RNG-seeded reward sits inside ' +
  'the "no simulated gambling" IARC answer is a question for counsel, not for me.'
);
open.push(
  'FIVE DELIBERATE DEVIATIONS from Spec v5 were taken by the product owner on ' +
  '2026-08-09: no daily pledge cap (170), unlimited trials per exercise (171/172), ' +
  'first-time exercises eligible (173), above-best targets by informed consent ' +
  '(174-176), and the miss-ends-the-day brake removed (178). None changes the ' +
  'chance/skill test or the money walls. All are recorded with reasoning in their ' +
  'migration headers and in docs/V5_MIGRATION_STATUS.md.'
);
open.push(
  'STORE METADATA AND MARKETING COPY are outside this repo, and §10 applies to ' +
  'them too. The sweep covers the app and its SQL, not the listing.'
);

console.log('\n--- OPEN QUESTIONS — for counsel, not for this tool\n');
for (const q of open) console.log(`  ??  ${q}\n`);

console.log(`${fails.length === 0 ? 'ALL FACTUAL CHECKS PASS' : 'FAILURES'} — ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  - ${f}`);
console.log(
  '\nTHIS IS NOT A STATEMENT THAT THE APP IS LEGALLY CLEARED. It is the evidence a\n' +
  'legal review needs in order to reach its own conclusion.\n'
);
process.exit(fails.length === 0 ? 0 : 1);
