/**
 * EVERY COIN KIND THE DATABASE ACCEPTS HAS A LABEL, AND THE RIGHT AMOUNT.
 *
 *   node tools/falsify-coin-labels.mjs
 *
 * Extracted from tools/falsify-forge-drop.mjs, which was deleted with the staked
 * board it tested. This check is kept because it has now caught a real live defect
 * TWICE and is the only thing that can:
 *
 *   1. `forge_drop_unlock` (159) reached the CHECK constraint and the guard and
 *      never got a client label, so the largest debit in the game would have
 *      rendered as a blank row.
 *   2. the claim toast held a SECOND COPY of the server's amounts — hardcoded '+25'
 *      and '+50' — which migration 160 silently made wrong when it retuned
 *      workout_complete to 20 and pr to 25.
 *
 * A coin kind needs FOUR edits, not three: the CHECK constraint decides whether the
 * word may exist, the guard decides who may write it, the label decides what a
 * human reads, and the toast amount decides what number they are told. The first
 * two fail loudly when missed. THE LAST TWO FAIL SILENTLY — the ledger stays
 * correct and the screen lies about it, in the one place an athlete goes to check
 * what they earned.
 */
import { readdirSync, readFileSync } from 'node:fs';

const TOKEN = readFileSync(new URL('../client/.env.sbtoken.local', import.meta.url), 'utf8')
  .trim().replace(/^[A-Z_]+=/, '').replace(/^["']|["']$/g, '');
const PROJECT = 'rysbpwpvnqbngqncrfaa';

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(String(text).replace(/\s+/g, ' ').slice(0, 300));
  return JSON.parse(text);
}

let pass = 0, fail = 0;
const failures = [];
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; failures.push(label); console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`); }
};

console.log('\n=== COIN KINDS: constraint vs label vs amount ===\n');

// ── the words the database admits ───────────────────────────────────────────
const [{ def }] = await sql(`
  select pg_get_constraintdef(oid) as def
  from pg_constraint
  where conrelid = 'public.coin_events'::regclass and conname = 'coin_events_kind_check';`);
const dbKinds = [...new Set([...String(def).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))];
ok('the CHECK constraint was found', dbKinds.length > 5, `${dbKinds.length} kinds`);

// ── the words the client can render ─────────────────────────────────────────
const src = readFileSync(new URL('../client/src/data/coins.ts', import.meta.url), 'utf8');
const labelBody = src.slice(src.indexOf('COIN_LABELS'), src.indexOf('\n};', src.indexOf('COIN_LABELS')));
const labelled = new Set([...labelBody.matchAll(/^\s*([a-z_]+):\s*'/gm)].map((m) => m[1]));
ok('COIN_LABELS was parsed', labelled.size > 5, `${labelled.size} labels`);

const missing = dbKinds.filter((k) => !labelled.has(k));
ok('every kind the ledger can hold renders with a name, not a blank',
   missing.length === 0,
   missing.length ? `UNLABELLED: ${missing.join(', ')}` : `all ${dbKinds.length} labelled`);

// ── and the toast's second copy of the amounts ──────────────────────────────
//
// Only the athlete-claimable kinds appear here; the server-only ones are never
// announced by `useClaimCoin`. The amounts are read out of the LIVE guard body so
// this compares the client against the database rather than against itself.
const [{ body }] = await sql(`
  select pg_get_functiondef(p.oid) as body
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'coin_events_guard';`);

// The map is now EXPORTED, because it had been copied. See the fifth check below.
const AMOUNTS_DECL = 'export const COIN_AMOUNTS: Record<CoinKind, string>';
if (src.indexOf(AMOUNTS_DECL) === -1) {
  ok('the amounts map is where this tool expects it', false, `no ${AMOUNTS_DECL}`);
}
const amountsBody = src.slice(
  src.indexOf(AMOUNTS_DECL),
  src.indexOf('};', src.indexOf(AMOUNTS_DECL))
);
const clientAmounts = Object.fromEntries(
  [...amountsBody.matchAll(/^\s*([a-z_]+):\s*'\+?(\d*)'/gm)].map((m) => [m[1], m[2]])
);

/** What the guard actually sets for a kind, read from the live function body. */
function serverAmount(kind) {
  // …the branch for this kind, up to its `new.amount := N;`
  const at = body.indexOf(`new.kind = '${kind}'`);
  if (at === -1) return null;
  const m = body.slice(at).match(/new\.amount\s*:=\s*(\d+)\s*;/);
  return m ? m[1] : null;
}

for (const kind of ['workout_complete', 'pr', 'set_reward', 'starting_bonus']) {
  const server = serverAmount(kind);
  const client = clientAmounts[kind];
  if (server === null) { ok(`${kind}: found in the live guard`, false, 'no branch found'); continue; }
  ok(`${kind}: the toast says what the ledger pays`,
     client === server,
     `server ${server}, toast ${client ?? '(absent)'}`);
}

/**
 * THE FIFTH EDIT: NO SECOND COPY OF AN AMOUNT, ANYWHERE.
 *
 * The four checks above compare ONE map against the live guard, and that map was
 * right. It was also not the only copy: `mutations.ts` and `set-queue.ts` each
 * carried a hardcoded 'COINS BANKED +50' for the PR toast, and 160 retuned pr from
 * 50 to 25. Both save paths had been overstating a PR by 25 coins ever since, and
 * this tool passed every time because it was reading the copy that was correct.
 *
 * So the rule is now structural rather than comparative: a coin amount may appear
 * in exactly one place. Any literal number next to COINS BANKED is a second copy
 * by definition, whatever it happens to say today.
 */
const clientDir = new URL('../client/src/', import.meta.url);
function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    if (e.isDirectory()) out.push(...walk(child));
    else if (/\.tsx?$/.test(e.name)) out.push(child);
  }
  return out;
}
const hardcoded = [];
for (const file of walk(clientDir)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/COINS BANKED\s*\+\s*\d+/g)) {
    hardcoded.push(`${file.pathname.split('/client/src/')[1]}: ${m[0]}`);
  }
}
ok('no coin amount is hardcoded outside COIN_AMOUNTS',
   hardcoded.length === 0,
   hardcoded.join(', ') || 'none');

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
if (fail) console.log('FAILURES:\n  - ' + failures.join('\n  - '));
process.exit(fail === 0 ? 0 : 1);
