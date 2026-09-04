/**
 * PAGE LAB baseline sync — CURRENT is mechanically pinned to the deployed app.
 *
 *   node scripts/lab-sync.mjs --check     CI guard: committed baselines equal
 *                                         regeneration from the live sources
 *   node scripts/lab-sync.mjs --write     regenerate every baseline in place
 *                                         (run after ANY change to a live source)
 *   node scripts/lab-sync.mjs --record    re-record the fork-recipe patches
 *                                         (run after a DELIBERATE baseline edit)
 *
 * Why this exists: the baselines are hand-forked copies titled CURRENT, and by
 * 2026-09-04 train/baseline had silently drifted 65 hunks from today.tsx while
 * its header still claimed diff-zero. Prose ("diff against today.tsx") is not
 * a guard. This is: each baseline = its live source + a RECORDED patch (the
 * fork recipe, scripts/lab-sync/<name>.patch), and --check fails CI whenever
 * the committed baseline is not byte-equal (LF-normalized) to that
 * regeneration. A commit that touches a live source must run --write in the
 * same commit; a commit that changes the recipe itself must run --record.
 *
 * Line endings: Windows working copies check out CRLF under `* text=auto`,
 * CI checks out LF, and `git apply` needs patch and target to agree. So every
 * read normalizes CRLF→LF in memory, every comparison is over LF bytes, the
 * patches are committed LF (.gitattributes pins them), and --write writes the
 * baseline back in the LIVE source's on-disk style so the README's manual
 * `git diff --no-index` recipe keeps working on either OS.
 *
 * Doctrine (root CLAUDE.md): a guard that cannot fail is not a guard. --check
 * asserts every mapped file exists and every patch is non-empty before it
 * compares anything, so a moved variant or an empty record cannot vacuously
 * pass. Falsified both directions on 2026-09-04 (a live-page edit and a
 * recipe-hunk edit each went red).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, '..');
const patchDir = join(here, 'lab-sync');

/** Every CURRENT fork the lab holds. `name` names the patch file; `live` and
 *  `baseline` are client-root-relative. Registering a new page's baseline
 *  means one entry here + one --record run. */
const SYNC_MAP = [
  {
    name: 'home-baseline',
    live: 'src/app/(main)/index.tsx',
    baseline: 'src/lab/variants/home/baseline.tsx',
  },
  {
    name: 'train-baseline',
    live: 'src/app/(main)/today.tsx',
    baseline: 'src/lab/variants/train/baseline.tsx',
  },
  {
    name: 'workout-baseline',
    live: 'src/app/(main)/workout.tsx',
    baseline: 'src/lab/variants/workout/baseline.tsx',
  },
  {
    name: 'workout-exercise-logger',
    live: 'src/ui/train/exercise-logger.tsx',
    baseline: 'src/lab/variants/workout/baseline-exercise-logger.tsx',
  },
  {
    name: 'fuel-baseline',
    live: 'src/app/(main)/fuel.tsx',
    baseline: 'src/lab/variants/fuel/baseline.tsx',
  },
];

const mode = process.argv[2];
if (!['--check', '--write', '--record'].includes(mode) || process.argv.length !== 3) {
  console.error('usage: node scripts/lab-sync.mjs --check | --write | --record');
  console.error('  --check   CI guard: baselines equal regeneration (read-only)');
  console.error('  --write   regenerate baselines from live sources + patches');
  console.error('  --record  re-record the fork-recipe patches from the tree');
  process.exit(1);
}

const readLf = (path) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
const patchPath = (entry) => join(patchDir, `${entry.name}.patch`);

/** Apply `patch` to `liveText` (both LF) by materializing the baseline path in
 *  a temp tree and letting `git apply` do the hunk maths — the same engine
 *  that will judge the patch everywhere else. Throws on conflict. */
function regenerate(entry, liveText, patchText) {
  const tmp = mkdtempSync(join(tmpdir(), 'lab-sync-'));
  try {
    const target = join(tmp, entry.baseline);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, liveText);
    const patchFile = join(tmp, 'recipe.patch');
    writeFileSync(patchFile, patchText);
    execFileSync('git', ['-c', 'core.autocrlf=false', 'apply', 'recipe.patch'], { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] });
    return readLf(target);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** git diff --no-index over LF-normalized temp copies, headers rewritten to
 *  the baseline's repo path so the patch applies onto a copy of the live file
 *  placed AT the baseline path. Exit 1 from git means "files differ" — the
 *  expected outcome, not an error. */
function recordPatch(entry, liveText, baselineText) {
  const tmp = mkdtempSync(join(tmpdir(), 'lab-sync-'));
  try {
    writeFileSync(join(tmp, 'live'), liveText);
    writeFileSync(join(tmp, 'base'), baselineText);
    let out;
    try {
      out = execFileSync('git', ['-c', 'core.autocrlf=false', 'diff', '--no-index', '--no-color', 'live', 'base'], {
        cwd: tmp,
        encoding: 'utf-8',
      });
    } catch (e) {
      if (e.status !== 1) throw e;
      out = e.stdout;
    }
    if (!out) {
      throw new Error(`${entry.name}: live and baseline are IDENTICAL — a baseline with no fork recipe cannot be a lab fork (it would still carry the live default export).`);
    }
    // a/live → a/<baseline path>, b/base → b/<baseline path>, and drop the
    // `diff --git` + index lines (git apply does not need them, and hashes of
    // temp files would churn the committed patch on every record).
    const lines = out.replace(/\r\n/g, '\n').split('\n');
    const body = lines.filter((l) => !l.startsWith('diff --git') && !l.startsWith('index '));
    const rewritten = body
      .map((l) => {
        if (l.startsWith('--- ')) return `--- a/${entry.baseline}`;
        if (l.startsWith('+++ ')) return `+++ b/${entry.baseline}`;
        return l;
      })
      .join('\n');
    return rewritten.endsWith('\n') ? rewritten : `${rewritten}\n`;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Write `text` (LF) to `path` in the same newline style `stylePath` uses on
 *  disk, so the working tree stays internally consistent on either OS. */
function writeInStyleOf(path, text, stylePath) {
  const crlf = readFileSync(stylePath, 'utf-8').includes('\r\n');
  writeFileSync(path, crlf ? text.replace(/\n/g, '\r\n') : text);
}

let failed = 0;
const red = (msg) => {
  failed += 1;
  console.error(`LAB-SYNC FAIL: ${msg}`);
};

for (const entry of SYNC_MAP) {
  const livePath = join(clientRoot, entry.live);
  const basePath = join(clientRoot, entry.baseline);

  let liveText;
  let baseText;
  try {
    liveText = readLf(livePath);
    baseText = readLf(basePath);
  } catch (e) {
    red(`${entry.name}: cannot read a mapped file (${e.message}) — if a page or variant moved, update SYNC_MAP in the same commit.`);
    continue;
  }

  if (mode === '--record') {
    const patch = recordPatch(entry, liveText, baseText);
    mkdirSync(patchDir, { recursive: true });
    writeFileSync(patchPath(entry), patch);
    console.log(`recorded ${entry.name}.patch (${patch.split('\n@@').length - 1} hunks)`);
    continue;
  }

  let patchText;
  try {
    patchText = readLf(patchPath(entry));
  } catch {
    red(`${entry.name}: no recorded patch at scripts/lab-sync/${entry.name}.patch — run --record.`);
    continue;
  }
  if (!patchText.includes('@@')) {
    red(`${entry.name}: recorded patch has no hunks — an empty recipe cannot be a fork. Re-run --record.`);
    continue;
  }

  let regenerated;
  try {
    regenerated = regenerate(entry, liveText, patchText);
  } catch {
    red(
      `${entry.name}: the recipe patch no longer applies to ${entry.live} — the live page changed inside a recipe hunk. Re-weave the fork by hand in ${entry.baseline}, then run --record, in this same commit.`
    );
    continue;
  }

  if (mode === '--write') {
    if (regenerated === baseText) {
      console.log(`${entry.name}: already in sync`);
    } else {
      writeInStyleOf(basePath, regenerated, livePath);
      console.log(`${entry.name}: baseline rewritten from ${entry.live}`);
    }
    continue;
  }

  // --check
  if (regenerated !== baseText) {
    const regenLines = regenerated.split('\n');
    const baseLines = baseText.split('\n');
    let firstDiff = 0;
    while (
      firstDiff < Math.min(regenLines.length, baseLines.length) &&
      regenLines[firstDiff] === baseLines[firstDiff]
    ) {
      firstDiff += 1;
    }
    red(
      `${entry.baseline} is not the recorded fork of ${entry.live} (first divergence at line ${firstDiff + 1}).\n` +
        `  expected: ${JSON.stringify(regenLines[firstDiff] ?? '<EOF>')}\n` +
        `  committed: ${JSON.stringify(baseLines[firstDiff] ?? '<EOF>')}\n` +
        `  Fix: \`node scripts/lab-sync.mjs --write\` in the same commit as the live change` +
        ` (or --record if the baseline edit was the deliberate act).`
    );
  }
}

if (mode === '--check' && failed === 0) {
  console.log(`OK: ${SYNC_MAP.length} baselines equal regeneration from their live sources.`);
}
process.exit(failed === 0 ? 0 : 1);
