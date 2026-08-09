/**
 * GRACE AND THE PAUSE, THROUGH THE REAL PATH (179, Spec v5 §6).
 *
 * The migration proves the streak MATHS inside Postgres. This proves the parts a
 * screen depends on: that a signed-in athlete can start and end a pause over
 * PostgREST, that `my_streak_state` tells the truth, and — the one that matters —
 * that a pause is OWNER-ONLY. A pause table with a loose policy would let anyone
 * bridge anyone's streak.
 *
 * Self-cleaning. Safe against production.
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

const rpc = async (token, fn, body = {}) => {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
};

const clean = `delete from public.streak_pauses where user_id = '${ALPHA_ID}';`;

console.log('\n=== 179 — grace and the pause, through the real path ===\n');

try {
  await sql(clean);
  const alpha = await signIn(ALPHA);

  // 1 ─ NOT PAUSED TO BEGIN WITH, and the allowance is on by default (§6).
  const before = await rpc(alpha, 'my_streak_state');
  check(before.status === 200, 'my_streak_state reads', `HTTP ${before.status}`);
  check(before.body?.paused === false, 'not paused to begin with', JSON.stringify(before.body?.paused));
  check(Number(before.body?.grace_per_30d) >= 1,
    'grace is ON BY DEFAULT, no setting to find', `grace_per_30d=${before.body?.grace_per_30d}`);

  // 2 ─ ONE TAP TO PAUSE.
  const started = await rpc(alpha, 'streak_pause_start', { p_reason: 'probe injury' });
  check(started.status === 200 && started.body?.paused === true, 'one tap starts a pause',
    `HTTP ${started.status} ${JSON.stringify(started.body)}`);
  const during = await rpc(alpha, 'my_streak_state');
  check(during.body?.paused === true, 'the state reports it', JSON.stringify(during.body?.paused));

  // 3 ─ IDEMPOTENT. Double-tapping must not open a second pause.
  const again = await rpc(alpha, 'streak_pause_start', { p_reason: 'probe injury' });
  const open = Number((await sql(
    `select count(*) n from public.streak_pauses where user_id='${ALPHA_ID}' and ended_on is null;`))[0].n);
  check(again.status === 200 && open === 1, 'pausing twice leaves exactly one open pause',
    `${open} open`);

  // 4 ─ OWNER-ONLY. The one that would actually matter if it were wrong.
  const bravo = await signIn(BRAVO);
  const seen = await fetch(
    `${SB_URL}/rest/v1/streak_pauses?select=id,user_id&user_id=eq.${ALPHA_ID}`,
    { headers: { apikey: SB_KEY, Authorization: `Bearer ${bravo}` } });
  const rows = await seen.json();
  check(Array.isArray(rows) && rows.length === 0,
    "another athlete cannot read this pause", `${Array.isArray(rows) ? rows.length : '?'} row(s)`);

  const forged = await fetch(`${SB_URL}/rest/v1/streak_pauses`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${bravo}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: ALPHA_ID, started_on: '2020-01-01' }),
  });
  check(forged.status >= 400, "another athlete cannot bridge this streak", `HTTP ${forged.status}`);

  // 5 ─ AND ONE TAP BACK.
  const ended = await rpc(alpha, 'streak_pause_end');
  const after = await rpc(alpha, 'my_streak_state');
  check(ended.status === 200 && after.body?.paused === false, 'one tap ends it',
    `HTTP ${ended.status} paused=${after.body?.paused}`);

  // 6 ─ ENDING A PAUSE YOU DO NOT HAVE IS NOT AN ERROR.
  const noop = await rpc(alpha, 'streak_pause_end');
  check(noop.status === 200, 'ending a pause you do not have is harmless', `HTTP ${noop.status}`);

  // 7 ─ NOTHING HERE TOUCHES COINS. A streak freeze must never be buyable.
  const kinds = await sql(`select count(*) n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname like 'streak_pause%'
      and pg_get_functiondef(p.oid) ilike '%coin_events%';`);
  check(Number(kinds[0].n) === 0, 'no pause function can touch the ledger', `${kinds[0].n} that do`);
} finally {
  await sql(clean);
  console.log('\n  ..    production restored');
}

console.log(`\n${fails.length === 0 ? 'ALL GREEN' : 'FAILURES'} — ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  - ${f}`);
process.exit(fails.length === 0 ? 0 : 1);
