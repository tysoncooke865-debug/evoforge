import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SentryEvent } from '../error-report';

/**
 * THE REPORTER — WO-005's acceptance criteria, driven through the real capture
 * path rather than around it.
 *
 * `__tests__/error-report.test.ts` next door pins the PURE half (the DSN parse,
 * the envelope bytes, the gate arithmetic). Everything it covers is reachable
 * without a clock, a network or a global. This file covers the half that only
 * exists once those pieces are wired together in `data/monitoring.ts` — which
 * had no test at all, and which is where three of the four acceptance criteria
 * actually live:
 *
 *   AC-1  a thrown error is captured · identifiers are redacted BEFORE they
 *         leave the device · the reporter never throws when the sink is gone
 *   AC-2  every report names the deploy that produced it
 *
 * The seam under test is `fetch`: the reporter is fire-and-forget by design, so
 * asserting on the bytes handed to the transport is the only honest way to see
 * what an athlete's device would actually have sent. Nothing here reaches the
 * network.
 *
 * Living in `domain/__tests__/` while testing `data/` follows the precedent set
 * by `__tests__/finish-queue.test.ts`, which drives `data/finish-queue` the
 * same way.
 */

// `Platform` is the only react-native surface the reporter touches. 'web' is
// the deployed surface and the one the 2026-07-21 incident happened on; under
// vitest there is no `window`/`location`, so initMonitoring() installs no
// listeners and routeTag() declines — both by their own guards, not by luck.
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

// Read inside initMonitoring(), not at module scope, so setting them here — and
// before the dynamic import below — is what the reporter will see. A real DSN
// shape: monitoring stays OFF for anything malformed, which would make every
// assertion in this file vacuously pass.
const DSN = 'https://k1@o1.ingest.sentry.io/7';
const RELEASE = 'entrycafe0123';
process.env.EXPO_PUBLIC_SENTRY_DSN = DSN;
process.env.EXPO_PUBLIC_SENTRY_RELEASE = RELEASE;

// Metro injects `__DEV__`; vitest does not, and initMonitoring() reads it.
// Production is the configuration worth testing.
vi.stubGlobal('__DEV__', false);

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { captureException, monitoringStatus, setMonitoringUser } = await import(
  '../../data/monitoring'
);

/** The envelope's third line is the event; see serialiseEnvelope. */
function sentBody(): string {
  const init = fetchMock.mock.calls.at(-1)?.[1] as { body?: string } | undefined;
  return String(init?.body ?? '');
}

function sentEvent(): SentryEvent {
  return JSON.parse(sentBody().split('\n')[2]) as SentryEvent;
}

// The gate is module state and deliberately unbounded-proof: one report per
// distinct defect ever, five per rolling minute. Stepping the clock two minutes
// between tests keeps the per-minute ceiling from silencing later assertions —
// every test below still uses a DISTINCT message, because a repeat fingerprint
// is dropped forever by design.
let clock = Date.UTC(2026, 6, 26, 9, 0, 0);

beforeAll(() => {
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  clock += 120_000;
  vi.setSystemTime(clock);
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(() => Promise.resolve({ ok: true }));
});

describe('capturing a thrown error (AC-1)', () => {
  it('reports a real throw with its type, message and stack intact', () => {
    let thrown: unknown;
    try {
      // A real throw, so the stack is a real engine stack rather than a string
      // this test wrote to match its own parser.
      throw new TypeError('saveSet exploded');
    } catch (e) {
      thrown = e;
    }

    captureException(thrown, { mechanism: 'route-error-boundary', handled: false });

    expect(monitoringStatus()).toBe('on');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/7/envelope/');

    const event = sentEvent();
    expect(event.exception.values[0]).toMatchObject({
      type: 'TypeError',
      value: 'saveSet exploded',
      mechanism: { type: 'route-error-boundary', handled: false },
    });
    // AC-4 is a stack in the persisted store; this is the client-side half of
    // it — frames parsed off a genuine Error, not an inference from counts.
    const frames = event.exception.values[0].stacktrace?.frames ?? [];
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[frames.length - 1].filename).toBeTruthy();
  });

  it('captures a non-Error throw rather than dropping it', () => {
    // `throw 'string'` and rejected promises carrying non-Errors are the shapes
    // a naive reporter silently loses.
    captureException('a bare string reason', { mechanism: 'unhandledrejection', handled: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentEvent().exception.values[0]).toMatchObject({
      type: 'Error',
      value: 'a bare string reason',
    });
  });
});

describe('release tagging (AC-2)', () => {
  it('names the deploy on an unhandled report', () => {
    captureException(new Error('release tagging alpha'), {
      mechanism: 'onerror',
      handled: false,
    });

    const event = sentEvent();
    // `dist` alongside `release` is what lets a source map resolve to ONE build
    // rather than "some deploy of this version".
    expect(event.release).toBe(RELEASE);
    expect(event.dist).toBe(RELEASE);
    expect(event.environment).toBe('production');
  });

  it('names the deploy on a handled report too — every report, not most', () => {
    captureException(new Error('release tagging beta'), {
      mechanism: 'arena-error-boundary',
      handled: true,
    });

    expect(sentEvent().release).toBe(RELEASE);
  });
});

describe('redaction before sending (AC-1)', () => {
  it('strips an address from the message, and from the bytes on the wire', () => {
    captureException(new Error('sign-in rejected athlete@example.com'), {
      mechanism: 'onerror',
      handled: false,
    });

    expect(sentEvent().exception.values[0].value).toBe('sign-in rejected [email]');
    // The payload, not just the parsed field: redaction that happens after
    // serialisation would pass the assertion above and still leak.
    expect(sentBody()).not.toContain('athlete@example.com');
  });

  it('strips bearer tokens and jwts', () => {
    captureException(new Error('refresh failed Bearer abcdefghijklmnop'), {
      mechanism: 'onerror',
      handled: false,
    });

    expect(sentEvent().exception.values[0].value).toBe('refresh failed [token]');
    expect(sentBody()).not.toContain('abcdefghijklmnop');
  });

  it('keeps the opaque athlete id, and drops it again on sign-out', () => {
    // DELIBERATE, and the one identifier that survives: WO-005's founder alert
    // fires on an issue "affecting more than one athlete", which is not
    // countable without a stable per-athlete id. It is an opaque uuid — no
    // address, no name, nothing that reads as a person — and it is cleared on
    // sign-out with every other cache layer, so the next athlete's crash can
    // never be attributed to the last one.
    const athlete = '3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607';
    setMonitoringUser(athlete);
    captureException(new Error('signed in athlete crash'), {
      mechanism: 'onerror',
      handled: false,
    });
    expect(sentEvent().user).toEqual({ id: athlete });

    setMonitoringUser(null);
    captureException(new Error('signed out athlete crash'), {
      mechanism: 'onerror',
      handled: false,
    });
    expect(sentEvent().user).toBeUndefined();
  });
});

describe('an unavailable sink (AC-1)', () => {
  // The reporter is wired into error paths — a boundary, a global handler. If
  // it can throw, it turns one broken screen into a crash loop, which is the
  // 2026-07-21 shape it exists to prevent.
  it('does not throw when the transport throws synchronously', () => {
    fetchMock.mockImplementation(() => {
      throw new TypeError('Failed to fetch');
    });

    expect(() =>
      captureException(new Error('transport throws sync'), {
        mechanism: 'route-error-boundary',
        handled: false,
      })
    ).not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not throw, or leave a rejection unhandled, when the sink rejects', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('network down')));

    expect(() =>
      captureException(new Error('transport rejects async'), {
        mechanism: 'route-error-boundary',
        handled: false,
      })
    ).not.toThrow();

    // The reporter attaches its own .catch synchronously; flushing microtasks
    // here is what would surface an unhandled rejection if it did not.
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not throw when there is no fetch at all', () => {
    vi.stubGlobal('fetch', undefined);

    expect(() =>
      captureException(new Error('transport absent'), {
        mechanism: 'route-error-boundary',
        handled: false,
      })
    ).not.toThrow();
  });
});
