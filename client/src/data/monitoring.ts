/**
 * MONITORING — the client half of error reporting (WO-005, founder vote).
 *
 * The alerting spine (083/084) watches six rules in SQL and is blind to any
 * exception it was never told about; the 2026-07-21 incident was diagnosed two
 * days late by counting analytics rows. This ships the exception itself — type,
 * message, stack, and the deploy that produced it — to Sentry.
 *
 * OFF BY DEFAULT AND HONEST ABOUT IT. Without `EXPO_PUBLIC_SENTRY_DSN` nothing
 * initialises, nothing is queued, and `monitoringStatus()` says `no-dsn`. A
 * monitor that pretends to be watching is worse than none, so there is no local
 * buffer, no fake success and no silent degradation (the repo's "a system
 * without a backend is HIDDEN, never mocked" rule).
 *
 * A DSN is a public write-only key — it ships in the browser bundle by design,
 * exactly like the Supabase publishable key. It is NOT the Sentry auth token,
 * which can read data and lives only as an edge-function secret.
 *
 * IMPORTS STAY react-native + domain ONLY. ui/core/route-error-boundary imports
 * this file, and that boundary must still render while app-layer modules are
 * broken — the same constraint error-screen.tsx carries.
 */
import { Platform } from 'react-native';

import { runningBuildId } from '@/domain/build-id';
import {
  buildErrorEvent,
  createReportGate,
  envelopeUrl,
  fingerprintOf,
  newEventId,
  parseDsn,
  parseStackFrames,
  redact,
  serialiseEnvelope,
  type ReportGate,
  type SentryDsn,
} from '@/domain/error-report';

type MonitoringStatus = 'off' | 'no-dsn' | 'bad-dsn' | 'on';

let dsn: SentryDsn | null = null;
let status: MonitoringStatus = 'off';
let release = 'unknown';
let environment = 'production';
let gate: ReportGate = createReportGate();
let athleteId: string | null = null;
let started = false;

/** What the reporter is actually doing. Never a boolean: "off because no DSN"
 *  and "off because the DSN is malformed" are different operational facts. */
export function monitoringStatus(): MonitoringStatus {
  return status;
}

/** Route as a TAG, with ids stripped: `/gym/3f2a…` is the same screen as
 *  `/gym/9c11…`, and an id in a tag is an athlete in a tag. */
function routeTag(): string | undefined {
  if (Platform.OS !== 'web' || typeof location === 'undefined') return undefined;
  try {
    return location.pathname
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
      .slice(0, 100);
  } catch {
    return undefined;
  }
}

/** Never throws, never rejects, never retries. A reporter that can fail loudly
 *  can turn one broken screen into a crash loop, and a retry on a device that
 *  is already spinning is the 2026-07-21 shape all over again. */
function send(body: string): void {
  const target = dsn;
  if (!target) return;
  try {
    // No headers on purpose: a string body defaults to text/plain, which keeps
    // this a SIMPLE request — no CORS preflight on a device in trouble. This is
    // what Sentry's own browser transport does. `keepalive` lets the report
    // outlive the page when the athlete closes the tab on a broken screen,
    // which is precisely the athlete we lost last time.
    const init = { method: 'POST', body, keepalive: true } as unknown as RequestInit;
    void fetch(envelopeUrl(target), init).catch(() => undefined);
  } catch {
    /* transport unavailable — monitoring must never surface an error */
  }
}

export interface CaptureContext {
  mechanism: string;
  handled: boolean;
  tags?: Record<string, string | undefined>;
  extra?: Record<string, unknown>;
}

/** Report one exception. Safe to call from anywhere, including an error path. */
export function captureException(error: unknown, context: CaptureContext): void {
  if (!dsn) return;
  try {
    const err = error instanceof Error ? error : undefined;
    const type = err?.name || (typeof error === 'string' ? 'Error' : typeof error);
    const value = String(err?.message ?? error ?? 'Unknown error').slice(0, 1000);
    const stack = err?.stack ?? null;
    const frames = parseStackFrames(stack);
    if (!gate.allow(fingerprintOf(type, value, frames), Date.now())) return;

    const event = buildErrorEvent({
      eventId: newEventId(Math.random),
      timestampMs: Date.now(),
      type,
      value,
      stack,
      release,
      environment,
      surface: 'client',
      userId: athleteId,
      mechanism: context.mechanism,
      handled: context.handled,
      tags: { platform: Platform.OS, route: routeTag(), ...context.tags },
      extra: {
        ...context.extra,
        // The raw stack rides along truncated: if a browser matches neither
        // frame grammar the parsed list is empty, and a readable blob beats a
        // stackless issue that reads like the counts we are trying to replace.
        ...(stack && frames.length === 0 ? { raw_stack: redact(stack).slice(0, 4000) } : {}),
      },
    });
    send(serialiseEnvelope(event, new Date().toISOString()));
  } catch {
    /* a reporter that throws is worse than one that misses */
  }
}

/**
 * The athlete this session belongs to. Set on sign-in, CLEARED ON SIGN-OUT —
 * the every-cache-layer doctrine applies to the monitor too, and attributing
 * the next athlete's crash to the last one would corrupt the very count the
 * founder alert is built on.
 */
export function setMonitoringUser(id: string | null): void {
  athleteId = id;
}

/**
 * Install the global handlers. Idempotent; called once from app/_layout.tsx.
 *
 * KNOWN GAP, stated rather than papered over: a throw before React mounts (a
 * 404'd bundle, a module-scope error) never reaches this, because this has not
 * run yet. That failure already has an owner — the +html.tsx boot overlay —
 * and closing it properly means a snippet in the HTML shell, which is a
 * separate change.
 */
export function initMonitoring(): void {
  if (started) return;
  started = true;

  const raw = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!raw || !raw.trim()) {
    status = 'no-dsn';
    return;
  }
  dsn = parseDsn(raw);
  if (!dsn) {
    status = 'bad-dsn';
    return;
  }
  status = 'on';

  // ACCEPTANCE CRITERION 3. On web the release IS the deploy: runningBuildId()
  // returns the hashed entry bundle this session is running, the same identity
  // the persisted-cache buster and the stale-shell guard already trust. Native
  // builds have no such hash, so they carry an explicit release or say
  // 'unknown' — never a stale constant that would blame the wrong deploy.
  release = runningBuildId(process.env.EXPO_PUBLIC_SENTRY_RELEASE?.trim() || 'unknown');
  environment = __DEV__ ? 'development' : 'production';
  gate = createReportGate();

  // React Native's global handler covers native and anything RN routes through
  // it; the previous handler is CHAINED, never replaced — dropping it would
  // silence the red box in development.
  // Through `unknown`: react-native declares its own global `ErrorUtils` type,
  // and a direct assertion between the two shapes is a compile error on some
  // type-versions and not others. This one cannot rot.
  const globals = globalThis as unknown as {
    ErrorUtils?: {
      getGlobalHandler?: () => ((e: unknown, fatal?: boolean) => void) | undefined;
      setGlobalHandler?: (h: (e: unknown, fatal?: boolean) => void) => void;
    };
  };
  const errorUtils = globals.ErrorUtils;
  if (errorUtils?.setGlobalHandler) {
    const previous = errorUtils.getGlobalHandler?.();
    errorUtils.setGlobalHandler((e: unknown, fatal?: boolean) => {
      captureException(e, {
        mechanism: 'global-handler',
        handled: false,
        tags: { fatal: fatal ? '1' : '0' },
      });
      previous?.(e, fatal);
    });
  }

  if (Platform.OS !== 'web' || typeof window === 'undefined') return;

  // `error` also fires for failed <img>/<script> loads, which carry no `error`
  // object. Those are not exceptions and would drown the real ones.
  window.addEventListener('error', (e: ErrorEvent) => {
    if (!e?.error) return;
    captureException(e.error, { mechanism: 'onerror', handled: false });
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    captureException(e?.reason, { mechanism: 'unhandledrejection', handled: false });
  });
}
