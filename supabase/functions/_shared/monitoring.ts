/**
 * MONITORING — the edge half of error reporting (WO-005, founder vote).
 *
 * Every function's uncaught throw currently becomes a bare 500 that only the
 * caller sees. The client that spun on 2026-07-21 was diagnosed two days later
 * by counting analytics rows; the server side of that story was never
 * reconstructed at all, because nothing kept it. This ships the exception —
 * type, message, stack, function name — to Sentry.
 *
 * TWO PROPERTIES THIS FILE MUST KEEP:
 *
 * 1. **It changes no behaviour.** `serveMonitored` reports and then RETHROWS,
 *    so every function's status codes, bodies and CORS headers are exactly what
 *    they were. Monitoring that alters the thing it monitors is not monitoring.
 *
 * 2. **It refuses rather than pretends.** With no `SENTRY_DSN` secret nothing
 *    is sent and nothing is buffered. There is no local queue to go stale and
 *    no "sent" that wasn't.
 *
 * SECRETS: `SENTRY_DSN` is a public write-only key (it also ships in the
 * browser bundle). The Sentry AUTH TOKEN, which can read data, belongs only to
 * `sentry-watch` and never here. Neither goes in the repo — this one is public.
 *
 * The wire format lives in `./sentry-envelope.ts`, pinned to the client's copy
 * by a test in the client suite. Runtime globals live here and nowhere else, so
 * that file stays readable by the client's tsc and vitest.
 */
import {
  buildErrorEvent,
  envelopeUrl,
  newEventId,
  parseDsn,
  serialiseEnvelope,
  type SentryDsn,
} from './sentry-envelope.ts';

/** A report must never hold a request open. Two seconds is generous for an
 *  ingest POST and short enough that a Sentry outage costs the athlete
 *  nothing they would notice on a request that was failing anyway. */
const SEND_TIMEOUT_MS = 2000;

/** An isolate serving a failing route would otherwise report every request.
 *  Sentry rate-limits its own ingest, but the point of a bound here is that we
 *  never generate the traffic in the first place — the client half is bounded
 *  by construction for the same reason (domain/error-report.ts). */
const MAX_REPORTS_PER_ISOLATE = 50;

let dsn: SentryDsn | null | undefined; // undefined = not resolved yet
let reports = 0;
const seen = new Set<string>();

function resolvedDsn(): SentryDsn | null {
  if (dsn === undefined) dsn = parseDsn(Deno.env.get('SENTRY_DSN'));
  return dsn;
}

/** True when this function can actually report. Exposed so a health check can
 *  say "monitoring is off" out loud instead of implying it is on. */
export function edgeMonitoringOn(): boolean {
  return resolvedDsn() !== null;
}

/** Counters and ids vary per occurrence; the defect does not. */
function fingerprint(fn: string, type: string, message: string): string {
  return `${fn}|${type}|${message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\d+/g, '<n>')
    .slice(0, 200)}`;
}

/**
 * Report one exception from an edge function. Never throws and never rejects:
 * an error inside the reporter must not become the error the caller sees.
 */
export async function captureEdgeException(
  fn: string,
  error: unknown,
  extra?: Record<string, unknown>
): Promise<void> {
  const target = resolvedDsn();
  if (!target) return;
  try {
    if (reports >= MAX_REPORTS_PER_ISOLATE) return;
    const err = error instanceof Error ? error : undefined;
    const type = err?.name || (typeof error === 'string' ? 'Error' : typeof error);
    const value = String(err?.message ?? error ?? 'Unknown error').slice(0, 1000);
    const key = fingerprint(fn, type, value);
    if (seen.has(key)) return;
    seen.add(key);
    reports++;

    const event = buildErrorEvent({
      eventId: newEventId(Math.random),
      timestampMs: Date.now(),
      type,
      value,
      stack: err?.stack ?? null,
      // Set at deploy time. Without it an issue cannot say which deploy caused
      // it — acceptance criterion 3 — so it reads 'unknown' rather than
      // silently inheriting a stale constant that would blame the wrong build.
      release: Deno.env.get('SENTRY_RELEASE')?.trim() || 'unknown',
      environment: Deno.env.get('SENTRY_ENVIRONMENT')?.trim() || 'production',
      surface: 'edge',
      mechanism: 'edge-handler',
      handled: false,
      tags: { fn },
      extra,
    });

    await fetch(envelopeUrl(target), {
      method: 'POST',
      body: serialiseEnvelope(event, new Date().toISOString()),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    /* a reporter that throws is worse than one that misses */
  }
}

/**
 * `Deno.serve` with the throw reported on the way out.
 *
 * Deliberately RETHROWS: the runtime's own 500 is what every caller and every
 * client error path already expects, and this work order approved monitoring,
 * not a change to how failures look. The await matters — the isolate can be
 * frozen the moment the response settles, and a fire-and-forget report is a
 * report that sometimes does not exist.
 */
export function serveMonitored(
  fn: string,
  handler: (req: Request) => Response | Promise<Response>
): void {
  Deno.serve(async (req) => {
    try {
      return await handler(req);
    } catch (error) {
      let path: string | undefined;
      try {
        path = new URL(req.url).pathname;
      } catch {
        /* unparseable url — the report is still worth sending */
      }
      await captureEdgeException(fn, error, { method: req.method, path });
      throw error;
    }
  });
}
