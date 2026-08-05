#!/usr/bin/env node
/**
 * RLS VERIFICATION — the check that was deleted, rebuilt so it cannot lie.
 *
 * HANDOVER §7 recorded this as a real gap on 2026-07-30: `verify-rls.yml` was
 * removed because it invoked a `tools/verify_rls.py` that no longer existed,
 * and it was not restored because that script wrote to a hardcoded list of 12
 * tables — including `custom_workout_plan`, retired by migration 062 — while
 * the schema is now 180 tables wide. A green run would have certified a stale
 * subset and ignored the entire Command / social / battle / gym surface.
 *
 * THE CHECK THAT MATTERS: a client holding only the publishable key, with no
 * session, reads ZERO rows from every table.
 *
 * THE TWO WAYS THAT CHECK LIES, both closed here:
 *
 *   1. "Zero rows" is trivially true of an EMPTY table. So when a management
 *      token is available the script asks the server how many rows each table
 *      actually holds, and REFUSES TO PASS unless it verified a meaningful
 *      number of NON-EMPTY tables. A green with nothing behind it is worse
 *      than no check.
 *
 *   2. A hardcoded table list goes stale silently — the exact failure that
 *      killed the last one. The list is read from the live schema when a
 *      management token is present; the committed manifest is the fallback,
 *      and a mismatch between the two is itself a failure, so a new table
 *      cannot be added without this check learning about it.
 *
 * Usage:
 *   node tools/verify-rls.mjs                 # verify
 *   node tools/verify-rls.mjs --write-manifest # regenerate the manifest
 *
 * Env: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_KEY (publishable only —
 * never a secret key), optional SUPABASE_ACCESS_TOKEN for the two guards above.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, '..', 'contracts', 'rls-tables.json');
const PROJECT_REF = 'rysbpwpvnqbngqncrfaa';

/** GitHub secrets arrive decorated (quotes, whole NAME="value" lines). */
function clean(raw, pattern) {
  if (!raw) return null;
  const m = String(raw).match(pattern);
  return m ? m[0] : null;
}

const URL_ = clean(process.env.EXPO_PUBLIC_SUPABASE_URL, /https:\/\/[a-z0-9-]+\.supabase\.co/);
const KEY = clean(process.env.EXPO_PUBLIC_SUPABASE_KEY, /(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)/);
const MGMT = clean(process.env.SUPABASE_ACCESS_TOKEN, /sbp_[A-Za-z0-9]+/);

if (!URL_ || !KEY) {
  console.error('verify-rls: EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY are required.');
  process.exit(2);
}
if (/sb_secret|service_role/.test(String(process.env.EXPO_PUBLIC_SUPABASE_KEY))) {
  console.error('verify-rls: that is a SECRET key. This check is only meaningful with the publishable key.');
  process.exit(2);
}

async function mgmtQuery(sql) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!resp.ok) throw new Error(`management API ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return resp.json();
}

/** Every base table in `public`, from the live schema. */
async function liveTables() {
  const rows = await mgmtQuery(
    `select c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname;`
  );
  return rows.map((r) => r.name);
}

/** Exact row counts — the "green is not green-because-empty" guard. */
async function rowCounts(tables) {
  const union = tables
    .map((t) => `select '${t}'::text as t, (select count(*) from public."${t}") as n`)
    .join(' union all ');
  const rows = await mgmtQuery(union);
  return new Map(rows.map((r) => [r.t, Number(r.n)]));
}

const writeMode = process.argv.includes('--write-manifest');

let tables;
let live = null;
if (MGMT) {
  live = await liveTables();
  tables = live;
} else {
  if (!fs.existsSync(MANIFEST)) {
    console.error('verify-rls: no management token and no manifest — nothing to check against.');
    process.exit(2);
  }
  tables = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).tables;
}

if (writeMode) {
  if (!live) {
    console.error('verify-rls: --write-manifest needs SUPABASE_ACCESS_TOKEN.');
    process.exit(2);
  }
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(
    MANIFEST,
    `${JSON.stringify({ generated_note: 'Regenerate with: node tools/verify-rls.mjs --write-manifest', project: PROJECT_REF, tables: live }, null, 2)}\n`
  );
  console.log(`verify-rls: manifest written with ${live.length} tables.`);
  process.exit(0);
}

/* ── 1. the manifest must not be stale ─────────────────────────────────── */
const failures = [];
if (live && fs.existsSync(MANIFEST)) {
  const stored = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).tables;
  const added = live.filter((t) => !stored.includes(t));
  const removed = stored.filter((t) => !live.includes(t));
  if (added.length || removed.length) {
    failures.push(
      `manifest is stale — ${added.length} new table(s) [${added.slice(0, 8).join(', ')}], ` +
        `${removed.length} removed [${removed.slice(0, 8).join(', ')}]. ` +
        'Run: node tools/verify-rls.mjs --write-manifest'
    );
  }
}

/* ── 2. anonymous reads must return nothing ────────────────────────────── */
let checked = 0;
const leaked = [];
for (const table of tables) {
  const resp = await fetch(`${URL_}/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  checked += 1;
  // ALWAYS drain the body. An undrained response leaves a live handle, and
  // 180 of them tore down the Node process on Windows with a libuv assertion
  // before the script could report anything — a check that crashes instead of
  // failing is indistinguishable from a check that passed.
  const text = await resp.text().catch(() => '');
  if (resp.status === 401 || resp.status === 403 || resp.status === 404) continue; // denied outright
  if (!resp.ok) continue; // 4xx/5xx that is not a read
  let body = null;
  try { body = JSON.parse(text); } catch { body = null; }
  if (Array.isArray(body) && body.length > 0) leaked.push(table);
}
if (leaked.length) {
  failures.push(`ANONYMOUS READ RETURNED ROWS from ${leaked.length} table(s): ${leaked.join(', ')}`);
}

/* ── 3. the anti-vacuous guard ─────────────────────────────────────────── */
let nonEmpty = 0;
if (MGMT) {
  const counts = await rowCounts(tables);
  nonEmpty = [...counts.values()].filter((n) => n > 0).length;
  // 20 is a floor chosen to be far below the real number (this project has
  // well over a hundred populated tables) and far above zero. Its only job is
  // to make "the database was empty" impossible to mistake for "RLS works".
  if (nonEmpty < 20) {
    failures.push(
      `only ${nonEmpty} table(s) actually contain rows — a pass here would prove nothing. ` +
        'Point this at a project with data.'
    );
  }
} else {
  console.log('verify-rls: no management token — skipping the manifest and non-empty guards.');
}

console.log(`verify-rls: ${checked} tables probed anonymously, ${nonEmpty || '?'} of them non-empty.`);
if (failures.length) {
  for (const f of failures) console.error(`::error::verify-rls: ${f}`);
  process.exit(1);
}
console.log('verify-rls: OK — no table returns a row to an unauthenticated publishable-key client.');
