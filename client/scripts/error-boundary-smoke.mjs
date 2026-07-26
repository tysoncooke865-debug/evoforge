/**
 * ERROR-BOUNDARY SMOKE — WO-005 AC-3, in a real browser.
 *
 * AC-3: "The reporter is wired into the existing route-error-boundary without
 * changing its fallback UI." Both halves of that sentence are browser
 * properties — one is a network POST that only happens once React has caught a
 * throw, the other is what the athlete is looking at while it happens — so
 * neither is reachable from vitest. This is the journey the acceptance criteria
 * name; `__tests__/error-reporter.test.ts` covers AC-1/AC-2 at the unit level.
 *
 * NOTHING LEAVES THE MACHINE. The ingest endpoint is intercepted and fulfilled
 * locally, so this needs no Sentry project, no DSN secret and no deploy —
 * production deployment is explicitly out of WO-005's scope. The DSN below is a
 * well-formed fake whose host we intercept; the reporter cannot tell the
 * difference, which is the point.
 *
 * Prereqs (see client/.claude/skills/verify/SKILL.md, HANDOVER §5):
 *   cd client
 *   npm ci
 *   EXPO_PUBLIC_SENTRY_DSN=https://journey@o0.ingest.sentry.io/1 \
 *     npx expo export -p web --clear     # --clear IS REQUIRED: Metro inlines
 *                                        # EXPO_PUBLIC_ and does not invalidate
 *                                        # its transform cache on an env change
 *   npx serve "<abs path>/client/dist" -l 4173
 *   node scripts/error-boundary-smoke.mjs
 * Playwright is NOT a client dependency — run from a directory where
 * `npm i playwright` has been done (e.g. the session scratchpad), or point
 * NODE_PATH at one. Same arrangement as scripts/arena-visual-tour.mjs.
 *
 * Exits non-zero with a per-check summary, so a verifier can gate on it.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

// Smoke account ALPHA — RLS-isolated test account (HANDOVER.md section 5).
const SMOKE_EMAIL = 'smoke-test-claude@evoforge.internal';
const SMOKE_PASSWORD = 'SmokeTest-2026-07!x';
const BASE = process.env.TOUR_BASE_URL ?? 'http://localhost:4173';

// The message the forced crash carries. Deliberately NOT chunk-shaped: every
// pattern in domain/chunk-error.ts must miss it, or the boundary renders the
// "UPDATING…" variant instead of the "SOMETHING BROKE" panel AC-3 is about.
const PROBE = 'EVOFORGE error-boundary smoke probe';

// error-screen.tsx's one-auto-reload-per-window guard. Pre-arming it with a
// fresh timestamp makes tryAutoReload() decline, so the fallback panel STAYS on
// screen and can be asserted instead of racing a location.reload(). Using the
// app's own guard rather than fighting it is what makes this journey
// deterministic for both fallback variants.
const CHUNK_RELOAD_AT_KEY = 'evoforge-chunk-reload-at';

const failures = [];
const check = (name, ok, detail) => {
  if (ok) {
    console.log(`  PASS  ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    failures.push(name);
  }
};

/** Envelopes the reporter handed to the transport, newest last. */
const envelopes = [];

/** serialiseEnvelope writes header \n item-header \n event. */
const eventOf = (body) => JSON.parse(String(body).split('\n')[2]);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

try {
  // --- the sink: captured, never sent ------------------------------------
  await ctx.route('**/*.ingest.sentry.io/**', async (route) => {
    envelopes.push(route.request().postData() ?? '');
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  // --- sign in (SKILL.md flow) -------------------------------------------
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('[data-testid=email]', SMOKE_EMAIL);
  await page.fill('[data-testid=password]', SMOKE_PASSWORD);
  await page.click('[data-testid=sign-in]');
  await page.waitForTimeout(4000);
  // The main-app tutorial overlay eats every click — skip it if it shows.
  try {
    const skip = page.locator('[data-testid=tutorial-skip]');
    await skip.waitFor({ state: 'visible', timeout: 9000 });
    await skip.click();
    await skip.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  } catch {}
  console.log('signed in');

  await page.evaluate(
    ([key]) => localStorage.setItem(key, String(Date.now())),
    [CHUNK_RELOAD_AT_KEY]
  );

  // --- force a route crash ------------------------------------------------
  // Every web route is a lazily-fetched chunk (app.json asyncRoutes.web), so
  // serving one chunk a body that throws makes its route throw on its INITIAL
  // render — the shape docs/ERROR_MONITORING.md §4 probe 8 cares about, and the
  // one the self-start fix in captureException exists for. Poisoning by
  // response rather than by editing a route keeps the built bundle untouched.
  // Everything the booted shell already loaded is off limits. The entry bundle
  // is the obvious one, but any shared chunk is just as fatal: poison the shell
  // and there is no boundary left to catch, which fails as a blank screen and
  // no report. Only a chunk this navigation pulls in fresh can be the route's.
  const shellScripts = new Set(
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]')).map((s) => s.src)
    )
  );

  let poison = true;
  const poisoned = new Set();
  await ctx.route('**/_expo/static/js/web/**', async (route) => {
    const url = route.request().url();
    if (!poison || /entry-[a-f0-9]+\.js/.test(url) || shellScripts.has(url)) {
      return route.fallback();
    }
    poisoned.add(url);
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `throw new Error(${JSON.stringify(PROBE)});`,
    });
  });

  // /progress is a (main) route not loaded after sign-in, so it fetches a fresh
  // chunk. Deliberately NOT a /forge-arena screen: the arena has its own class
  // boundary that catches first (mechanism: arena-error-boundary) and the route
  // boundary never sees it.
  //
  // Navigate CLIENT-SIDE rather than with goto(). A full load refetches the
  // entry and any shared chunks, and poisoning one of those would break the app
  // shell itself — including the boundary that is supposed to catch — which
  // fails as a blank screen and no report, the most confusing outcome
  // available. After boot the only new chunk is the route's own. It also means
  // the session has already restored, so the crash lands under the (main)
  // boundary with the providers above it still mounted, which is the case the
  // boundary's own comment says matters most.
  const navigated = await page
    .evaluate(() => {
      history.pushState({}, '', '/progress');
      window.dispatchEvent(new PopStateEvent('popstate'));
      return true;
    })
    .catch(() => false);
  await page.waitForTimeout(2000);

  const screenAppeared = await page
    .locator('[data-testid=error-screen]')
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!navigated || !screenAppeared) {
    // Fallback: a hard load of the route. Less ideal for the reasons above, but
    // better than reporting AC-3 unverified because a history shim moved.
    console.log('  note  client-side nav did not crash the route; falling back to a hard load');
    await page.goto(BASE + '/progress', { waitUntil: 'domcontentloaded' });
  }

  const screen = page.locator('[data-testid=error-screen]');
  await screen.waitFor({ state: 'visible', timeout: 15000 });

  // --- AC-3, half one: the fallback UI is unchanged -----------------------
  const heading = await page
    .locator('[data-testid=error-screen] >> text=/SOMETHING BROKE|UPDATING/i')
    .innerText()
    .catch(() => '');
  check('the route boundary rendered its fallback screen', await screen.isVisible());
  check(
    'the fallback still offers RETRY',
    await page.locator('[data-testid=error-retry]').isVisible()
  );
  check(
    'the fallback still offers CLEAR CACHE & RELOAD',
    await page.locator('[data-testid=error-clear-cache]').isVisible()
  );
  check(
    'the panel is the ordinary render-error variant, not the chunk one',
    /SOMETHING BROKE/i.test(heading),
    `heading read "${heading}" — a chunk-shaped message would take the auto-reload path instead`
  );

  // --- AC-3, half two: the reporter is wired in ---------------------------
  // The report is fire-and-forget, so give the POST a moment to be issued.
  await page.waitForTimeout(1500);

  // Count only what this journey is about. The app may legitimately report
  // something else during boot (a rejected fetch racing session restore is
  // known console noise, per the verify skill), and failing on that would
  // blame the monitoring diff for an unrelated event.
  const boundaryReports = () =>
    envelopes
      .map((b) => {
        try {
          return eventOf(b);
        } catch {
          return null;
        }
      })
      .filter((e) => e?.exception?.values?.[0]?.mechanism?.type === 'route-error-boundary');

  const reports = boundaryReports();
  if (envelopes.length !== reports.length) {
    console.log(`  note  ${envelopes.length - reports.length} unrelated report(s) also seen`);
  }
  check('the boundary reported exactly once', reports.length === 1, `saw ${reports.length}`);

  if (reports.length > 0) {
    const event = reports[0];
    const value = event.exception?.values?.[0] ?? {};
    check(
      'it is attributed to the route error boundary',
      value.mechanism?.type === 'route-error-boundary',
      `mechanism was ${JSON.stringify(value.mechanism)}`
    );
    check('it carries the thrown message', String(value.value ?? '').includes(PROBE));
    check(
      'it carries a stack (AC-4 client half)',
      (value.stacktrace?.frames?.length ?? 0) > 0 || Boolean(event.extra?.raw_stack),
      'no parsed frames and no raw_stack fallback'
    );
    // AC-2 at the real surface: the release must be the entry bundle this
    // session is running, not a version string.
    const entry = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]'))
        .map((s) => /entry-([a-f0-9]+)\.js/.exec(s.src)?.[1])
        .find(Boolean)
    );
    check(
      'it names the deploy (AC-2)',
      Boolean(event.release) && event.release !== 'unknown',
      `release=${event.release}`
    );
    check(
      'the release IS the running entry bundle',
      event.release === entry,
      `release=${event.release} entry=${entry}`
    );
    check('release and dist agree', event.release === event.dist);
    check('it is tagged as the client surface', event.tags?.surface === 'client');
    // PRIVACY, the hard assertion: the athlete's address must never reach the
    // wire. The unit test pins redaction on a crafted message; this pins it on
    // a real session's payload.
    check(
      'no address rode along in the payload',
      !envelopes.some((b) => b.includes(SMOKE_EMAIL)),
      'the smoke account address reached the wire unredacted'
    );
    // NOT an assertion, on purpose. `user.id` is set by auth-context once the
    // session restores from LargeSecureStore, which is async — so a crash on
    // the FIRST render legitimately races it, and an absent id here is correct
    // behaviour rather than a defect. That it is kept on sign-in and dropped on
    // sign-out is pinned by error-reporter.test.ts, where there is no race.
    console.log(`  note  user.id ${event.user?.id ? 'present' : 'absent (first-render race)'}`);
  }

  // --- the gate holds in the browser, not just in the unit test -----------
  // RETRY re-renders into the still-poisoned chunk, so the same defect throws
  // again. One report per distinct defect means the count must NOT move — this
  // is the property that stops the reporter becoming the second outage.
  await page.click('[data-testid=error-retry]');
  await page.waitForTimeout(2500);
  check(
    'a repeat of the same defect is not reported twice',
    boundaryReports().length === 1,
    `count moved to ${boundaryReports().length}`
  );

  // --- the athlete is not locked out --------------------------------------
  // Part of "without changing its fallback UI" is that the fallback is still an
  // exit, not a dead end. RETRY is the intended path; a reload is the fallback
  // if Metro has cached the failed module, which is Metro's behaviour and not
  // something WO-005 changed — so recovery by EITHER path passes, and only a
  // permanent lockout fails.
  poison = false;
  await page.click('[data-testid=error-retry]');
  let recovered = await screen
    .waitFor({ state: 'detached', timeout: 10000 })
    .then(() => 'RETRY')
    .catch(() => null);
  if (!recovered) {
    await page.reload({ waitUntil: 'networkidle' });
    recovered = (await screen.isVisible().catch(() => false)) ? null : 'reload';
  }
  check(
    'the fallback is an exit, not a lockout',
    Boolean(recovered),
    'still on the error screen after RETRY and a reload'
  );
  if (recovered) console.log(`  note  recovered via ${recovered}`);

  check(
    'a route chunk was actually poisoned',
    poisoned.size > 0,
    'the trigger never fired — no chunk was intercepted, so nothing above was proven'
  );
} catch (e) {
  check('the journey ran to completion', false, String(e?.message ?? e));
} finally {
  await browser.close();
}

console.log(
  failures.length === 0
    ? '\nerror-boundary-smoke: PASS'
    : `\nerror-boundary-smoke: FAIL (${failures.length}) — ${failures.join(' · ')}`
);
process.exit(failures.length === 0 ? 0 : 1);
