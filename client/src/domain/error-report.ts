/**
 * ERROR REPORT — the pure half of error monitoring (WO-005, founder vote).
 *
 * WHY THIS EXISTS. On 2026-07-21 an athlete hit a hard failure and their client
 * spun: 2,412 rows in a single minute, 60% of 20,862 events inside the first 32
 * minutes. They left for good. Time-to-detection was ~48 hours, and only
 * because a person went looking. The alerting spine shipped since (083/084)
 * watches SIX RULES IN SQL — it is excellent at the failures we predicted and
 * structurally blind to an exception nobody told it to look for. This is the
 * other half: the exception itself, with its stack, tagged with the deploy that
 * produced it.
 *
 * WHAT LIVES HERE: the DSN parse, the stack parse, the redaction, the event
 * shape, the envelope bytes, and — the part that matters most for this repo —
 * the GATE. The incident being monitored was a SPIN LOOP; a reporter wired
 * naively into a spin loop reports at forty per second and becomes the second
 * outage. So the gate is bounded BY CONSTRUCTION: one report per distinct
 * defect, a per-minute ceiling, and a hard session cap. Losing a duplicate
 * costs nothing (Sentry counts occurrences from a single event just as well);
 * an unbounded reporter costs the athlete's battery and buries the signal.
 *
 * Pure and dependency-free on purpose (the nav-stall.ts / chunk-error.ts
 * precedent): every rule below is falsifiable without a DOM, a clock or a
 * network. `data/monitoring.ts` is the wiring; the edge twin is
 * `supabase/functions/_shared/sentry-envelope.ts`, pinned byte-for-byte to this
 * file's envelope by __tests__/sentry-envelope-parity.test.ts (Metro cannot
 * resolve outside the client root, so the wire format is written twice and
 * guarded rather than imported once and hoped about).
 */

/** Sentry's ingest identity, parsed out of a DSN. Nothing here is secret — a
 *  DSN is a public write-only key and ships in the browser bundle by design,
 *  exactly like the Supabase publishable key. */
export interface SentryDsn {
  /** Ingest origin, e.g. `https://o123.ingest.sentry.io`. */
  origin: string;
  publicKey: string;
  projectId: string;
}

/** `https://<publicKey>@<host>/<projectId>`, with the legacy `:secret` form
 *  tolerated and discarded. Returns null for anything else — a malformed DSN
 *  must leave monitoring OFF and admit it, never half-configured. */
export function parseDsn(raw: string | null | undefined): SentryDsn | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const m = /^(https?):\/\/([^:@/]+)(?::[^@/]*)?@([^/]+)\/(\d+)\/?$/.exec(value);
  if (!m) return null;
  return { origin: `${m[1]}://${m[3]}`, publicKey: m[2], projectId: m[4] };
}

export const SENTRY_CLIENT = 'evoforge-minimal/1.0.0';

/**
 * The envelope endpoint, with auth in the QUERY STRING on purpose: an
 * `X-Sentry-Auth` header would turn every report into a CORS preflight, and a
 * report is sent by a device that is already in trouble. Sentry's own browser
 * SDK authenticates the same way, for the same reason.
 */
export function envelopeUrl(dsn: SentryDsn): string {
  return (
    `${dsn.origin}/api/${dsn.projectId}/envelope/` +
    `?sentry_version=7` +
    `&sentry_client=${encodeURIComponent(SENTRY_CLIENT)}` +
    `&sentry_key=${encodeURIComponent(dsn.publicKey)}`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// REDACTION
// ─────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/g;
const TOKEN_RE = /\b(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]{12,})/g;

/**
 * PRIVACY. Sentry is private, but this repo's rule is that an incident is
 * described by BEHAVIOUR, never identity (HANDOVER §3) — and an exception
 * message is one of the few places an address or a token reaches a log by
 * accident, because the library that raised it quoted its own input (a Supabase
 * auth error names the address it rejected). Redact at the edge of the app, not
 * at the edge of the vendor.
 *
 * The athlete's user id is the ONE identifier deliberately kept, and it is not
 * redacted here: counting "more than one athlete" is impossible without it, and
 * that count is the founder-alert condition WO-005 approved.
 */
export function redact(text: string): string {
  return text.replace(EMAIL_RE, '[email]').replace(JWT_RE, '[jwt]').replace(TOKEN_RE, '[token]');
}

// ─────────────────────────────────────────────────────────────────────────
// STACK TRACES — acceptance criterion 2: a stack, not an inference from counts
// ─────────────────────────────────────────────────────────────────────────

export interface SentryFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

/** Frames beyond this add bytes and no diagnosis. `keepalive` fetches are also
 *  capped at 64KB by the browser, and a report that exceeds it is dropped
 *  silently — the one failure mode a monitor may never have. */
export const MAX_FRAMES = 30;

const V8_FRAME_RE = /^at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
const AT_SIGN_FRAME_RE = /^(.*?)@(.+?):(\d+):(\d+)$/;

function frameOf(fn: string, file: string, line: string, col: string): SentryFrame {
  const filename = redact(file.trim());
  return {
    filename,
    function: fn.trim() || '?',
    lineno: Number(line),
    colno: Number(col),
    // Everything web ships from our own hashed bundles; node_modules and
    // native frames are the vendor's. A wrong guess here only changes which
    // frames Sentry highlights, never which ones it keeps.
    in_app: !/node_modules|\[native code\]/.test(filename),
  };
}

/**
 * `error.stack` in the two shapes the app actually runs on: V8 (Chrome, Edge,
 * Node, Deno — `at fn (file:line:col)`) and JavaScriptCore/SpiderMonkey/Hermes
 * (Safari, Firefox, native — `fn@file:line:col`).
 *
 * Returned OLDEST FIRST, which is the order Sentry's protocol expects: the
 * frame that threw is last. Unparseable lines are dropped rather than guessed
 * at; `data/monitoring.ts` also carries the raw stack in `extra`, so a browser
 * neither pattern matches still yields a readable trace instead of nothing.
 */
export function parseStackFrames(stack: string | null | undefined): SentryFrame[] {
  if (!stack) return [];
  const frames: SentryFrame[] = [];
  for (const line of stack.split('\n')) {
    if (frames.length >= MAX_FRAMES) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const v8 = V8_FRAME_RE.exec(trimmed);
    if (v8) {
      frames.push(frameOf(v8[1] ?? '', v8[2], v8[3], v8[4]));
      continue;
    }
    const at = AT_SIGN_FRAME_RE.exec(trimmed);
    if (at) frames.push(frameOf(at[1] ?? '', at[2], at[3], at[4]));
  }
  return frames.reverse();
}

// ─────────────────────────────────────────────────────────────────────────
// THE EVENT
// ─────────────────────────────────────────────────────────────────────────

export interface ErrorEventInput {
  /** 32 lowercase hex characters — see newEventId. */
  eventId: string;
  /** Wall clock of the failure, milliseconds since epoch. */
  timestampMs: number;
  /** Constructor name, e.g. `TypeError`. Sentry groups on this + the frames. */
  type: string;
  /** The message. Redacted here, never at the vendor. */
  value: string;
  stack?: string | null;
  /** ACCEPTANCE CRITERION 3: which deploy caused it. On web this is the hashed
   *  entry bundle the session is actually running (domain/build-id.ts). */
  release: string;
  environment: string;
  /** Which half of the system reported: the client, or an edge function. */
  surface: 'client' | 'edge';
  /** The signed-in athlete's id, or null when signed out. The only identity
   *  ever sent, and the reason "more than one athlete" is countable. */
  userId?: string | null;
  /** How we got hold of it: `onerror`, `unhandledrejection`, `route-error-
   *  boundary`, `edge-handler`. Sentry shows it on the issue. */
  mechanism: string;
  /** false for anything that reached a global handler. */
  handled: boolean;
  tags?: Record<string, string | undefined>;
  extra?: Record<string, unknown>;
}

export interface SentryEvent {
  event_id: string;
  timestamp: number;
  platform: string;
  level: string;
  release: string;
  dist: string;
  environment: string;
  sdk: { name: string; version: string };
  tags: Record<string, string>;
  user?: { id: string };
  exception: {
    values: {
      type: string;
      value: string;
      stacktrace?: { frames: SentryFrame[] };
      mechanism: { type: string; handled: boolean };
    }[];
  };
  extra?: Record<string, unknown>;
}

export function buildErrorEvent(input: ErrorEventInput): SentryEvent {
  const frames = parseStackFrames(input.stack);
  const tags: Record<string, string> = { surface: input.surface };
  for (const [key, value] of Object.entries(input.tags ?? {})) {
    if (value != null && value !== '') tags[key] = redact(String(value));
  }
  return {
    event_id: input.eventId,
    timestamp: input.timestampMs / 1000,
    platform: 'javascript',
    level: 'error',
    release: input.release,
    // `dist` alongside `release` is what lets a source-map upload resolve to
    // one specific build rather than to "some deploy of this version".
    dist: input.release,
    environment: input.environment,
    sdk: { name: 'evoforge.minimal', version: '1.0.0' },
    tags,
    ...(input.userId ? { user: { id: input.userId } } : {}),
    exception: {
      values: [
        {
          type: input.type,
          value: redact(input.value),
          ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
          mechanism: { type: input.mechanism, handled: input.handled },
        },
      ],
    },
    ...(input.extra ? { extra: input.extra } : {}),
  };
}

/**
 * One event, wrapped in a Sentry envelope. The item header deliberately omits
 * `length`: it is a BYTE count, `JSON.stringify` gives characters, and any
 * non-ASCII in a message would make the two disagree and the payload be
 * truncated. Without it the payload runs to the next newline, which is exact.
 *
 * `sentAtIso` is a parameter rather than a `new Date()` so this stays pure —
 * the same reason domain/ never reads the clock (HANDOVER: Date.now() is not
 * allowed where behaviour must be reproducible).
 */
export function serialiseEnvelope(event: SentryEvent, sentAtIso: string): string {
  const header = JSON.stringify({ event_id: event.event_id, sent_at: sentAtIso });
  const item = JSON.stringify({ type: 'event', content_type: 'application/json' });
  return `${header}\n${item}\n${JSON.stringify(event)}\n`;
}

/** 32 lowercase hex characters, Sentry's event id shape. Randomness is
 *  injected so the id is testable; the caller passes `Math.random`. */
export function newEventId(random: () => number): string {
  let out = '';
  for (let i = 0; i < 32; i++) out += (Math.floor(random() * 16) & 15).toString(16);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// THE GATE — the part that stops a monitor becoming the next incident
// ─────────────────────────────────────────────────────────────────────────

/** Distinct defects reported per app session, ever. */
export const REPORT_MAX_PER_SESSION = 20;
/** Distinct defects reported inside any rolling minute. */
export const REPORT_MAX_PER_MINUTE = 5;

/** Ids, counters and timings vary per occurrence; the defect does not. Without
 *  this a loop raising "request 41 failed", "request 42 failed" defeats the
 *  dedupe by never repeating itself. */
function normaliseValue(value: string): string {
  return value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\d+/g, '<n>')
    .slice(0, 200);
}

/** What counts as "the same defect" for the gate. Not Sentry's fingerprint —
 *  Sentry does its own grouping server-side; this only decides what we send. */
export function fingerprintOf(type: string, value: string, frames: SentryFrame[]): string {
  const top = frames.length > 0 ? frames[frames.length - 1] : undefined;
  const where = top ? `${top.filename ?? '?'}:${top.lineno ?? 0}:${top.colno ?? 0}` : 'no-stack';
  return `${type}|${normaliseValue(value)}|${where}`;
}

export interface ReportGate {
  /** True exactly once per distinct defect, and only while under both caps. */
  allow(fingerprint: string, nowMs: number): boolean;
}

export function createReportGate(
  options: { maxPerSession?: number; maxPerMinute?: number } = {}
): ReportGate {
  const maxPerSession = options.maxPerSession ?? REPORT_MAX_PER_SESSION;
  const maxPerMinute = options.maxPerMinute ?? REPORT_MAX_PER_MINUTE;
  // Bounded by construction: `seen` can never hold more than maxPerSession
  // entries, because an entry is only ever added on an allowed report.
  const seen = new Set<string>();
  const recent: number[] = [];
  return {
    allow(fingerprint: string, nowMs: number): boolean {
      if (seen.has(fingerprint)) return false;
      if (seen.size >= maxPerSession) return false;
      while (recent.length > 0 && nowMs - recent[0] > 60_000) recent.shift();
      if (recent.length >= maxPerMinute) return false;
      seen.add(fingerprint);
      recent.push(nowMs);
      return true;
    },
  };
}
