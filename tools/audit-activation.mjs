/**
 * AUDIT THE ACTIVATION PATH, AS A BRAND NEW USER.
 *
 * Everything else in tools/ verifies a system that already has an account with
 * history behind it. This one asks the only question that decides whether
 * EvoForge grows: can somebody who has never seen it sign up, understand what
 * they are looking at, and log a set — without hitting an error, a dead end, or
 * a prerequisite nobody explained?
 *
 *   node tools/audit-activation.mjs                 # against production
 *   TOUR_BASE=http://localhost:4188 node ...        # against a local export
 *
 * It creates a REAL account (a disposable one, recorded so it can be cleaned
 * up) and walks the funnel, timing every step and recording every console
 * error. It asserts almost nothing — this is an audit, not a gate. It reports.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

import { chromium } from './browser.mjs';

const BASE = process.env.TOUR_BASE ?? 'https://evoforge.pages.dev';
const SHOTS = process.env.AUDIT_SHOTS ?? './audit-shots';
mkdirSync(SHOTS, { recursive: true });

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
  if (!res.ok) throw new Error(text.slice(0, 300));
  return JSON.parse(text);
}

const findings = [];
const note = (severity, area, what) => {
  findings.push({ severity, area, what });
  console.log(`  [${severity}] ${area}: ${what}`);
};

const timings = [];
async function step(name, fn) {
  const t0 = Date.now();
  let out;
  try {
    out = await fn();
  } catch (e) {
    note('ERROR', name, `threw: ${String(e.message).slice(0, 120)}`);
  }
  const ms = Date.now() - t0;
  timings.push({ name, ms });
  console.log(`  · ${name} — ${ms}ms`);
  return out;
}

async function visible(page, id) {
  const all = page.locator(`[data-testid="${id}"]`);
  const n = await all.count();
  for (let i = 0; i < n; i++) {
    const el = all.nth(i);
    const box = await el.boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) return el;
  }
  return null;
}
async function waitFor(page, id, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const el = await visible(page, id);
    if (el) return el;
    await page.waitForTimeout(200);
  }
  return null;
}
const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false }).catch(() => undefined);

const stamp = Date.now();
const EMAIL = `audit-${stamp}@evoforge.internal`;
const PASSWORD = 'AuditPass-2026!x';

console.log(`\n=== ACTIVATION AUDIT — ${BASE} ===`);
console.log(`fresh account: ${EMAIL}\n`);

const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 200));
});
page.on('pageerror', (e) => errors.push(`pageerror: ${String(e.message).slice(0, 200)}`));

// ── 1. FIRST PAINT ──────────────────────────────────────────────────────────
console.log('1. FIRST PAINT — what a stranger sees');
await step('cold load', async () => {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
});
await shot(page, '01-landing');
const landingText = await page.evaluate(() => document.body.innerText);
if (!/sign|log ?in|start|begin/i.test(landingText)) {
  note('HIGH', 'landing', 'no obvious way in — no sign-in/sign-up wording found');
}
console.log(`     landing copy: ${landingText.replace(/\s+/g, ' ').slice(0, 140)}`);

// ── 2. SIGN UP ──────────────────────────────────────────────────────────────
console.log('\n2. SIGN UP');
await step('reach sign-up', async () => {
  const link = await visible(page, 'go-sign-up');
  if (link) await link.click();
  else await page.goto(`${BASE}/sign-up`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
});
await shot(page, '02-sign-up');
const created = await step('create the account', async () => {
  const email = await waitFor(page, 'email', 10000);
  if (!email) { note('BLOCKER', 'sign-up', 'no email field found'); return false; }
  await email.fill(EMAIL);
  const pw = await visible(page, 'password');
  if (!pw) { note('BLOCKER', 'sign-up', 'no password field'); return false; }
  await pw.fill(PASSWORD);
  const confirm = await visible(page, 'password-confirm');
  if (confirm) await confirm.fill(PASSWORD);
  // The age/terms consent gates the button. Ticking it is part of signing up,
  // not a workaround — but note that the button gives no reason when it is off.
  const agree = await visible(page, 'signup-agree');
  if (agree) await agree.click();
  else note('MEDIUM', 'sign-up', 'no consent control found where one is expected');
  await page.waitForTimeout(300);
  const btn = await visible(page, 'sign-up');
  const stillDisabled = btn
    ? await btn.evaluate((el) => el.getAttribute('aria-disabled') === 'true')
    : false;
  if (stillDisabled) note('HIGH', 'sign-up', 'CREATE ACCOUNT still disabled after consent');
  if (!btn) { note('BLOCKER', 'sign-up', 'no submit button'); return false; }
  await btn.click();
  await page.waitForTimeout(6000);
  return true;
});
await shot(page, '03-after-sign-up');
const afterSignup = await page.evaluate(() => document.body.innerText);
console.log(`     after sign-up: ${afterSignup.replace(/\s+/g, ' ').slice(0, 180)}`);
if (/confirm|verify|check your (e-?mail|inbox)/i.test(afterSignup)) {
  note('CRITICAL', 'sign-up', 'email confirmation appears REQUIRED before any value is visible');
}

// ── 3. ONBOARDING ───────────────────────────────────────────────────────────
console.log('\n3. ONBOARDING — how much is asked before any value');
let onboardingSteps = 0;
await step('walk onboarding', async () => {
  for (let i = 0; i < 25; i++) {
    const url = page.url();
    if (!/onboarding/.test(url)) break;
    onboardingSteps += 1;
    await shot(page, `04-onboarding-${String(i).padStart(2, '0')}`);
    // Walk it the way a person would: answer whatever is asked, then continue.
    // The picker steps need a CHOICE before their continue enables, so choose
    // first and advance second.
    // Answer whatever this step asks: click the first control that is not
    // navigation. Generic on purpose — guessing option testIDs is how the first
    // version of this spent 25 iterations pressing a correctly-disabled button.
    const nav = /^(.?\s*BACK|CONTINUE|SKIP|NOT TODAY|I.M NOT SURE)/i;
    const opts = page.locator('[role="button"]');
    const count = await opts.count();
    for (let j = 0; j < count; j++) {
      const el = opts.nth(j);
      const label = (await el.innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
      if (!label || nav.test(label)) continue;
      const box = await el.boundingBox().catch(() => null);
      if (!box || box.width === 0) continue;
      await el.click().catch(() => undefined);
      await page.waitForTimeout(450);
      break;
    }
    // Every way forward this step offers, in preference order. Take the first
    // ENABLED one — a disabled primary with a labelled escape beside it is a
    // designed choice, not a dead end, and reporting it as one would be the
    // audit inventing a problem.
    const ways = [
      'onboard-begin', 'goal-continue', 'experience-continue', 'route-build',
      'plan-continue', 'plan-unsure', 'origin-forge', 'ready-start',
      'schedule-done', 'mission-reveal',
    ];
    let advanced = false;
    let blockedLabel = '';
    for (const id of ways) {
      const el = await visible(page, id);
      if (!el) continue;
      const off = await el.evaluate((n) => n.getAttribute('aria-disabled') === 'true');
      const label = (await el.innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
      if (off) { blockedLabel = blockedLabel || label; continue; }
      const heading = (await page.evaluate(() => document.body.innerText))
        .split(String.fromCharCode(10)).map((l) => l.trim()).filter(Boolean)[2] ?? '';
      console.log(`       step ${i}: ${heading.slice(0, 40).padEnd(42)} -> ${label.slice(0, 20)}`);
      await el.click();
      await page.waitForTimeout(1700);
      advanced = true;
      break;
    }
    if (!advanced) {
      note('BLOCKER', 'onboarding',
        `nothing enabled moves step ${i} forward` + (blockedLabel ? ` ("${blockedLabel}" is disabled)` : ''));
      break;
    }
  }
});
console.log(`     onboarding screens walked: ${onboardingSteps}`);
if (onboardingSteps > 6) note('MEDIUM', 'onboarding', `${onboardingSteps} screens before the app`);

// ── 4. WHERE DOES IT LAND, AND WHAT DOES IT SAY TO DO? ──────────────────────
console.log('\n4. THE FIRST SCREEN AFTER ONBOARDING');
await page.waitForTimeout(2500);
await shot(page, '05-home');
const homeUrl = page.url();
const homeText = await page.evaluate(() => document.body.innerText);
console.log(`     landed on: ${homeUrl.replace(BASE, '')}`);
console.log(`     copy: ${homeText.replace(/\s+/g, ' ').slice(0, 300)}`);

// Is there ONE obvious primary action?
const buttons = await page.evaluate(() =>
  [...document.querySelectorAll('[role="button"]')]
    .map((b) => (b.innerText || '').trim().replace(/\s+/g, ' '))
    .filter((t) => t.length > 0 && t.length < 40)
);
console.log(`     ${buttons.length} pressable controls on the first screen`);
console.log(`     first eight: ${buttons.slice(0, 8).join(' | ')}`);
if (buttons.length > 12) {
  note('HIGH', 'home', `${buttons.length} competing controls — no single obvious next action`);
}

// Do the game systems explain themselves to somebody who just arrived?
for (const term of ['Evo Rating', 'Forge Level', 'Training Arc', 'Forge Coin']) {
  const present = new RegExp(term, 'i').test(homeText);
  console.log(`     mentions ${term}: ${present ? 'yes' : 'no'}`);
}

// ── 5. CAN THEY REACH A WORKOUT? ────────────────────────────────────────────
console.log('\n5. THE FIRST WORKOUT — the activation moment');
const reachedWorkout = await step('find a way to start training', async () => {
  for (const id of ['home-primary-cta', 'ready-start', 'start-workout', 'today-start', 'mission-start']) {
    const el = await visible(page, id);
    if (el) { await el.click(); await page.waitForTimeout(3000); return id; }
  }
  await page.goto(`${BASE}/today`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  return 'navigated to /today directly';
});
console.log(`     entry used: ${reachedWorkout}`);
await shot(page, '06-today');
const todayText = await page.evaluate(() => document.body.innerText);
console.log(`     copy: ${todayText.replace(/\s+/g, ' ').slice(0, 220)}`);

await step('open the workout', async () => {
  const start = (await visible(page, 'start-workout')) ?? (await visible(page, 'today-start'));
  if (start) { await start.click(); await page.waitForTimeout(3500); }
  else { await page.goto(`${BASE}/workout`, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3500); }
});
await shot(page, '07-workout');
const workoutText = await page.evaluate(() => document.body.innerText);
console.log(`     workout copy: ${workoutText.replace(/\s+/g, ' ').slice(0, 220)}`);
const logBtn = await visible(page, 'log-set-1');
console.log(`     a LOG control is present: ${logBtn !== null}`);
if (!logBtn) {
  const anyLog = await page.evaluate(() => /\bLOG\b/.test(document.body.innerText));
  if (!anyLog) note('CRITICAL', 'activation', 'no way to log a set was reachable from a fresh account');
  else note('MEDIUM', 'activation', 'LOG exists but not at the expected testID');
}

// ── 6. OVERFLOW + ACCESSIBILITY SPOT CHECK ACROSS THE MAIN TABS ─────────────
console.log('\n6. EVERY PRIMARY TAB — overflow, errors, dead ends');
for (const route of ['/', '/today', '/progress', '/social', '/challenges', '/fuel', '/coins', '/customise', '/more']) {
  const t0 = Date.now();
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2600);
  const over = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const text = await page.evaluate(() => document.body.innerText);
  const broke = /something (went wrong|broke)|hit an error|try again/i.test(text);
  const empty = text.trim().length < 40;
  console.log(`     ${route.padEnd(12)} ${String(Date.now() - t0).padStart(5)}ms  overflow ${over}px  ${broke ? 'ERROR SCREEN' : empty ? 'BLANK' : 'ok'}`);
  if (over > 1) note('MEDIUM', `route ${route}`, `horizontal overflow of ${over}px at 390px`);
  if (broke) note('CRITICAL', `route ${route}`, 'shows a generic error screen on a fresh account');
  if (empty) note('HIGH', `route ${route}`, 'renders essentially nothing');
  await shot(page, `08-tab-${route.replace(/\W+/g, '_') || 'root'}`);
}

// ── 7. CONSOLE ──────────────────────────────────────────────────────────────
console.log('\n7. CONSOLE ERRORS ACROSS THE WHOLE RUN');
const unique = [...new Set(errors)];
console.log(`     ${errors.length} errors, ${unique.length} unique`);
for (const e of unique.slice(0, 12)) console.log(`     · ${e}`);
if (unique.some((e) => /418|hydrat/i.test(e))) note('MEDIUM', 'console', 'hydration mismatch on a fresh session');
if (unique.some((e) => /after subscribe|postgres_changes/i.test(e))) {
  note('HIGH', 'console', 'realtime subscription error — the callout crash signature');
}

// ── SUMMARY ─────────────────────────────────────────────────────────────────
console.log('\n=== FINDINGS ===');
const order = { BLOCKER: 0, CRITICAL: 1, HIGH: 2, MEDIUM: 3, ERROR: 4, LOW: 5 };
findings.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
for (const f of findings) console.log(`  [${f.severity}] ${f.area}: ${f.what}`);
if (findings.length === 0) console.log('  (none recorded — read the timings and copy above)');

console.log('\n=== SLOWEST STEPS ===');
for (const t of [...timings].sort((a, b) => b.ms - a.ms).slice(0, 6)) {
  console.log(`  ${String(t.ms).padStart(6)}ms  ${t.name}`);
}

writeFileSync(`${SHOTS}/findings.json`, JSON.stringify({ email: EMAIL, findings, timings, errors: unique }, null, 2));
console.log(`\nscreenshots + findings.json: ${SHOTS}`);
console.log(`\nAUDIT ACCOUNT (delete when done): ${EMAIL}`);

await browser.close();

// Record the account so it can be cleaned up deliberately rather than left behind.
try {
  const row = await sql(
    `select id, email, created_at from auth.users where email = '${EMAIL}';`);
  console.log(`auth row: ${row.length ? row[0].id : 'NONE — sign-up did not create a user'}`);
  if (!row.length) note('BLOCKER', 'sign-up', 'no auth user was created');
} catch (e) {
  console.log(`could not read auth.users: ${String(e.message).slice(0, 100)}`);
}
