/**
 * Arena render-stress measurement sweep (premium program P3).
 *
 * Drives the Render Stress Lab (/forge-arena/dev-stress) in the built web
 * client, sweeping combatant density and the synthetic particle overlay
 * while scraping window.__ARENA_PROFILE, then loops 10 stress matches for a
 * JS-heap trend. Results land as JSON + a console table — the evidence
 * package behind ARENA_STRESS_TEST_REPORT.md.
 *
 * Prereqs (see client/.claude/skills/verify/SKILL.md):
 *   npx expo export -p web
 *   npx serve "<abs path>/client/dist" -l 4173
 *   node scripts/arena-stress-measure.mjs <output-dir>
 * Playwright is NOT a client dependency — run from a directory where
 * `npm i playwright` has been done (e.g. the session scratchpad).
 *
 * Caveats printed with the results:
 *  - Desktop Chromium numbers. Phone-hardware figures need a device pass.
 *  - heap is Chrome-only (performance.memory); commit stats are null in
 *    production exports (React strips <Profiler> timings) — the store's
 *    publishMs (synchronous subscriber flush) is the prod-valid proxy.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const OUT_DIR = path.resolve(process.argv[2] ?? 'arena-stress-results');
fs.mkdirSync(OUT_DIR, { recursive: true });

const SMOKE_EMAIL = 'smoke-test-claude@evoforge.internal';
const SMOKE_PASSWORD = 'SmokeTest-2026-07!x';
const BASE = process.env.TOUR_BASE_URL ?? 'http://localhost:4173';

const DENSITIES = [10, 20, 30, 40];
const PARTICLE_STEPS = [0, 150, 400];
const SETTLE_MS = 8000; // intro hold (3.5s) + density ramp
const WINDOW_MS = 15000; // measurement window per step
const HEAP_MATCHES = 10;

const browser = await chromium.launch({ args: ['--js-flags=--expose-gc'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

const results = { startedAt: new Date().toISOString(), base: BASE, densitySweep: [], particleSweep: [], heapTrend: [] };

async function snapshot() {
  return page.evaluate(() => window.__ARENA_PROFILE?.snapshot() ?? null);
}
async function resetWindow() {
  await page.evaluate(() => window.__ARENA_PROFILE?.reset());
}
async function measureStep(label) {
  await page.waitForTimeout(SETTLE_MS);
  await resetWindow();
  await markPerfWindow();
  await page.waitForTimeout(WINDOW_MS);
  const snap = await snapshot();
  if (!snap) throw new Error(`no __ARENA_PROFILE at step ${label}`);
  snap.cdp = await perfDelta(WINDOW_MS);
  const r = snap.raf;
  const s = snap.store;
  console.log(
    `${label}: fps ${r.fpsAvg.toFixed(1)} (1% ${r.fps1PercentLow.toFixed(1)}) | ` +
      `frame avg ${r.avgFrameMs.toFixed(1)}ms worst ${r.worstFrameMs.toFixed(0)}ms | ` +
      `>16.7 ${r.framesOver16_7}/${r.sampleCount} >33 ${r.framesOver33} | ` +
      `sim ${s.avgSimMs.toFixed(2)}ms pub ${s.avgPublishMs.toFixed(2)}ms tickHz ${s.effectiveTickHz.toFixed(1)} | ` +
      `units ${snap.battle?.units ?? '?'} log ${snap.battle?.logLength ?? '?'} ` +
      `status ${snap.battle?.status ?? '?'} tick ${snap.battle?.tick ?? '?'}` +
      (snap.heap ? ` | heap ${snap.heap.usedMB.toFixed(1)}MB` : '')
  );
  // A dead window must never masquerade as a healthy measurement: a stress
  // battle can finish mid-window (auto-restart covers the gap), but if the
  // sim executed no ticks at all the step measured a frozen screen.
  if (s.effectiveTickHz < 1) console.log(`  WARNING: ${label} window had a frozen sim — remeasure`);
  return snap;
}

/** Fresh battle at the CURRENT config — density chips only update config
 *  once the driver is running, so each step forces a restart. */
async function freshBattle() {
  await page.click('[data-testid=stress-restart]');
  await page.waitForTimeout(500);
}

// CDP Performance domain: splits the frame budget into script vs
// style/layout in the REAL prod build (React Profiler is stripped there,
// and the store's publishMs only measures scheduling — React 19 does not
// flush subscribers synchronously, as the first sweep proved).
let cdp = null;
async function perfMetrics() {
  if (!cdp) return null;
  const { metrics } = await cdp.send('Performance.getMetrics');
  const get = (name) => metrics.find((m) => m.name === name)?.value ?? 0;
  return {
    script: get('ScriptDuration'),
    layout: get('LayoutDuration'),
    style: get('RecalcStyleDuration'),
    task: get('TaskDuration'),
    nodes: get('Nodes'),
  };
}
let perfBefore = null;
async function markPerfWindow() {
  perfBefore = await perfMetrics();
}
async function perfDelta(windowMs) {
  const after = await perfMetrics();
  if (!perfBefore || !after) return null;
  const d = {
    scriptPct: ((after.script - perfBefore.script) * 1000 / windowMs) * 100,
    layoutPct: ((after.layout - perfBefore.layout) * 1000 / windowMs) * 100,
    stylePct: ((after.style - perfBefore.style) * 1000 / windowMs) * 100,
    taskPct: ((after.task - perfBefore.task) * 1000 / windowMs) * 100,
    domNodes: after.nodes,
  };
  console.log(
    `  cdp: script ${d.scriptPct.toFixed(1)}% layout ${d.layoutPct.toFixed(1)}% style ${d.stylePct.toFixed(1)}% task ${d.taskPct.toFixed(1)}% | DOM nodes ${d.domNodes}`
  );
  return d;
}

try {
  // --- sign in (same dance as arena-visual-tour) ---
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('[data-testid=email]', SMOKE_EMAIL);
  await page.fill('[data-testid=password]', SMOKE_PASSWORD);
  await page.click('[data-testid=sign-in]');
  await page.waitForTimeout(4000);
  try {
    const skip = page.locator('[data-testid=tutorial-skip]');
    await skip.waitFor({ state: 'visible', timeout: 9000 });
    await skip.click();
    await skip.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  } catch {}
  console.log('signed in');

  // --- stress lab ---
  await page.goto(BASE + '/forge-arena/dev-stress', { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid=stress-ready]', { timeout: 20000 });
  await page.waitForTimeout(1500);
  cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');

  // Enable auto-restart FIRST (this also starts the first battle): stress
  // battles finish in ~40-60s at high density, so without the loop, later
  // measurement windows would silently profile a frozen result screen.
  await page.click('[data-testid=stress-autorestart]');
  await page.waitForTimeout(1000);

  // Density sweep at 0 particles — fresh battle per step so every window
  // starts from live combat at the target density.
  for (const d of DENSITIES) {
    await page.click(`[data-testid=stress-density-${d}]`);
    await freshBattle();
    const snap = await measureStep(`density ${d}/team`);
    results.densitySweep.push({ density: d, ...snap });
  }

  // Particle sweep at density 30 (the prompt's combatant target).
  await page.click('[data-testid=stress-density-30]');
  for (const p of PARTICLE_STEPS) {
    await page.click(`[data-testid=stress-particles-${p}]`);
    await freshBattle();
    const snap = await measureStep(`particles ${p} @30/team`);
    results.particleSweep.push({ particles: p, ...snap });
  }
  await page.click('[data-testid=stress-particles-0]');

  // CPU-throttled steps (CDP): desktop Chromium never saturates, so 4x/6x
  // throttling is the closest desktop proxy for phone-class silicon. Still
  // NOT a device pass — figures stay labeled as approximations.
  for (const rate of [4, 6]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.click('[data-testid=stress-density-30]');
    await page.click('[data-testid=stress-particles-150]');
    await freshBattle();
    const snap = await measureStep(`cpu ${rate}x throttle @30/team +150 particles`);
    results.throttledSweep = results.throttledSweep ?? [];
    results.throttledSweep.push({ rate, ...snap });
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.click('[data-testid=stress-particles-0]');

  // Heap trend: 10 restarted matches at density 30 (gc before each reading
  // when --expose-gc took; readings without gc are still trend-valid).
  // battle.tick validates each restart really produced a fresh battle.
  await page.click('[data-testid=stress-density-30]');
  for (let i = 0; i < HEAP_MATCHES; i++) {
    await page.click('[data-testid=stress-restart]');
    await page.waitForTimeout(10000);
    const reading = await page.evaluate(() => {
      window.gc?.();
      const snap = window.__ARENA_PROFILE?.snapshot();
      return snap ? { heap: snap.heap, tick: snap.battle?.tick, status: snap.battle?.status } : null;
    });
    console.log(
      `match ${i + 1}/${HEAP_MATCHES}: heap ${reading?.heap ? reading.heap.usedMB.toFixed(1) + 'MB' : 'n/a'} | tick ${reading?.tick} status ${reading?.status}`
    );
    results.heapTrend.push({ match: i + 1, ...reading });
  }

  // Teardown check: leave the arena, confirm the profiler global is gone
  // (screen unmount must stop the driver + profiler).
  await page.goto(BASE + '/forge-arena', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const globalGone = await page.evaluate(() => typeof window.__ARENA_PROFILE === 'undefined');
  results.teardown = { profilerGlobalRemoved: globalGone };
  console.log('teardown: __ARENA_PROFILE removed =', globalGone);

  const outFile = path.join(OUT_DIR, `stress-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log('results written to', outFile);
} finally {
  await browser.close();
}
