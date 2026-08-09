/**
 * THE VOCABULARY BAN, ENFORCED — Spec v5 §10, and an acceptance criterion in
 * both v5 §11 and the v5.1 migration briefing.
 *
 *   node tools/sweep-vocabulary.mjs           # report
 *   node tools/sweep-vocabulary.mjs --strict  # exit 1 on any hit (CI)
 *
 * WHAT IS BANNED, AND WHERE. The ban is on what a HUMAN READS: UI copy,
 * notification templates, accessibility labels, analytics event names that
 * surface to users, and store assets. Internal identifiers are explicitly
 * allowed to keep these words — `forge_drop_stake` is a ledger kind, not a
 * sentence, and renaming live database enums to satisfy a copy rule would be a
 * migration with real risk and no compliance value.
 *
 * So this classifies before it complains. A hit only counts when the string
 * looks like PROSE — it renders as JSX text, sits in an accessibility label, or
 * is a quoted literal with a space or sentence casing. `'forge_drop_stake'`,
 * `stakeRef`, and `import { stake }` are identifiers and are skipped.
 *
 * THE FALSE-POSITIVE TRAP THIS ALREADY HIT: naive word matching flags "mistake"
 * for `stake`, "scroll"/"enrolled" for `roll`, "household" for `house`, and
 * "spinner" for `spin`. Every pattern below is word-bounded and the suffixes
 * that produce innocent English are excluded explicitly, because a sweep that
 * cries wolf is a sweep that gets skipped before a store submission.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const STRICT = process.argv.includes('--strict');

/** v5 §10's list, verbatim. The replacements are the sanctioned vocabulary. */
const BANNED = [
  ['bet', 'pledge'], ['wager', 'pledge'], ['stake', 'pledge'], ['odds', 'drop table'],
  ['gamble', '—'], ['gambling', '—'], ['jackpot', '—'], ['spin', '—'], ['roll', '—'],
  ['casino', '—'], ['house', '—'], ['payout', 'settlement'], ['cash out', '—'],
  ['cashout', '—'], ['double down', '—'], ['all-in', '—'], ['near miss', '—'],
];
/** Innocent English that contains a banned word. Matched case-insensitively as
 *  whole words and removed before the ban patterns run. */
const INNOCENT = new RegExp(
  '\\b(' + [
    'mistake', 'mistakes', 'mistaken', 'mistakable',
    'scroll', 'scrolls', 'scrolling', 'scrollable', 'scroller', 'enrolled', 'enrol', 'enroll',
    'rolled', 'rolling', 'payroll', 'household', 'housed', 'housing',
    'spinner', 'spinners', 'spinal', 'spine', 'betwixt', 'between', 'better', 'betterment',
    'alphabet', 'sherbet', 'roller', 'controller', 'controllers', 'stakeholder',
  ].join('|') + ')\\b', 'gi');

/**
 * ENGLISH THAT IS NOT THE CASINO SENSE. Exact user-facing strings that contain a
 * banned word innocently. "Ride or spin" is a CARDIO ACTIVITY — a spin class —
 * and renaming it to satisfy a rule about slot machines would make the product
 * worse to no compliance end. Each entry needs a reason.
 */
const ALLOWED = new Map([
  ['Ride or spin', 'cardio activity: a spin class, not a reel'],
]);

const SEARCH = [
  { dir: 'client/src', exts: ['.ts', '.tsx'] },
  { dir: 'client/app.json', exts: ['.json'] },
  { dir: 'migrations', exts: ['.sql'] },
  { dir: 'supabase/functions', exts: ['.ts'] },
];
const SKIP_DIR = /node_modules|__tests__|\.expo|dist|\.browser/;

/**
 * WHICH LINES OF A MIGRATION CAN A USER EVER SEE?
 *
 * A `raise exception` inside a `create function` body reaches the client as a
 * PostgREST error and gets rendered in a toast — that is user-facing text and the
 * ban applies. A `raise exception` inside a top-level `do $$ … end $$;` block runs
 * ONCE, at apply time, in front of whoever is applying the migration. It cannot
 * reach a user by any path.
 *
 * The distinction is not pedantry. 161's own invariant guard says "a stake may have
 * crept in" — a precise message aimed at the next engineer, flagged by this sweep
 * as banned copy. Without this the choice is to reword a good developer message or
 * to carry a permanent exception, and both are worse than parsing the file properly.
 */
function applyTimeLines(src) {
  const skip = new Set();
  const lines = src.split(/\r?\n/);
  let inDo = false;
  lines.forEach((line, i) => {
    // `do $$` at the start of a statement — function bodies always arrive as
    // `create … function … as $$`, so this is unambiguous.
    if (!inDo && /^\s*do\s+\$\$/i.test(line)) inDo = true;
    if (inDo) {
      skip.add(i + 1);
      if (/^\s*end\s*\$\$\s*;/i.test(line)) inDo = false;
    }
  });
  return skip;
}

function walk(p, exts, out = []) {
  let st;
  try { st = statSync(p); } catch { return out; }
  if (st.isFile()) { if (exts.includes(extname(p))) out.push(p); return out; }
  if (SKIP_DIR.test(p)) return out;
  for (const e of readdirSync(p)) walk(join(p, e), exts, out);
  return out;
}

/**
 * Does this line carry text a person reads?
 *
 * Deliberately generous on the SQL side: a notification title lives in a plain
 * quoted string with no syntactic marker, so any multi-word literal counts.
 */
function proseOn(line, isSql) {
  const out = [];
  // JSX text between tags: >Some words<
  for (const m of line.matchAll(/>([^<>{}\n]{2,})</g)) out.push(m[1]);
  // quoted literals — single, double, backtick
  for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g)) {
    const s = m[2];
    if (!s || s.length < 2) continue;
    // identifiers, paths, imports, css classes, keys: no spaces and not a sentence
    const looksLikeProse = /\s/.test(s) || /^[A-Z][a-z]+$/.test(s) || /^[A-Z ]{4,}$/.test(s);
    if (!looksLikeProse) continue;
    if (/^[\w.\-/@]+$/.test(s)) continue;              // module paths
    if (/^(?:[a-z0-9-]+\s)+[a-z0-9-]+$/.test(s) && isSql === false
        && /className|class=/.test(line)) continue;    // tailwind class lists
    out.push(s);
  }
  // accessibility props even when the value is an expression
  const a11y = line.match(/accessibility(?:Label|Hint|Value)\s*[=:]\s*[{"'`]([^"'`}]+)/);
  if (a11y) out.push(a11y[1]);
  return out;
}

const patterns = BANNED.map(([w, use]) => ({
  word: w, use,
  re: new RegExp(`\\b${w.replace(/[-\s]/g, '[-\\s]')}\\b`, 'i'),
}));

const hits = [];
for (const { dir, exts } of SEARCH) {
  for (const file of walk(join(ROOT, dir), exts)) {
    const isSql = extname(file) === '.sql';
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    // Migration DO-blocks run at apply time and cannot reach a user; see above.
    const applyTime = isSql ? applyTimeLines(text) : new Set();
    lines.forEach((line, i) => {
      if (applyTime.has(i + 1)) return;
      // A comment is not a user-facing string. Code comments explaining WHY a
      // word is banned must not themselves trip the ban.
      const code = line.replace(/^\s*(\/\/|--|\*|\/\*).*$/, '');
      if (!code.trim()) return;
      // Developer logging is not user-facing. `console.warn('… wager value
      // untouched')` is a note to whoever is debugging chip physics.
      if (/\bconsole\.(log|warn|error|info|debug)\b/.test(code)) return;
      for (const text of proseOn(code, isSql)) {
        if (ALLOWED.has(text.trim())) continue;
        const cleaned = text
          // A `${…}` interpolation holds an EXPRESSION, not prose: `${payout}`
          // is a variable being rendered, and the ban covers what the user
          // reads, not what the identifier is called. Strip them before
          // matching, or every well-named variable trips its own rule.
          .replace(/\$\{[^}]*\}/g, ' ')
          // CSS/unit fragments left behind by a template literal.
          .replace(/\b\d+(?:deg|px|ms|%|rem|em)\b/g, ' ')
          .replace(INNOCENT, ' ');
        if (!/[A-Za-z]/.test(cleaned)) continue;
        for (const p of patterns) {
          if (p.re.test(cleaned)) {
            hits.push({ file: rel, line: i + 1, word: p.word, use: p.use, text: text.trim().slice(0, 96) });
          }
        }
      }
    });
  }
}

console.log('\n=== VOCABULARY SWEEP — Spec v5 §10 ===\n');
if (!hits.length) {
  console.log('  clean — no banned vocabulary in any user-facing string.\n');
  process.exit(0);
}
const byFile = new Map();
for (const h of hits) {
  if (!byFile.has(h.file)) byFile.set(h.file, []);
  byFile.get(h.file).push(h);
}
for (const [file, list] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${file}  (${list.length})`);
  for (const h of list) {
    console.log(`  ${String(h.line).padStart(5)}  ${h.word.padEnd(11)} → ${String(h.use).padEnd(11)} ${JSON.stringify(h.text)}`);
  }
  console.log('');
}
const counts = new Map();
for (const h of hits) counts.set(h.word, (counts.get(h.word) ?? 0) + 1);
console.log('by word: ' + [...counts].sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}`).join(', '));
console.log(`\n${hits.length} user-facing hits across ${byFile.size} files.\n`);
process.exit(STRICT ? 1 : 0);
