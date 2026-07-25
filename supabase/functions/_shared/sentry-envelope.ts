/**
 * SENTRY ENVELOPE — the wire format, for the Deno side (WO-005, founder vote).
 *
 * THE TWIN OF `client/src/domain/error-report.ts`. The wire format is written
 * twice on purpose: Metro cannot resolve a module outside the client root, and
 * a build-config change to make it could not be verified without shipping. What
 * stops the two drifting is not discipline — it is
 * `client/src/domain/__tests__/sentry-envelope-parity.test.ts`, which builds the
 * same event through both files and asserts the bytes are identical. A monitor
 * whose edge half silently stopped being accepted by ingest is the exact
 * failure this repo has already paid for once (086: three green cron runs and
 * an alerting system that could not alert).
 *
 * PURE, IMPORT-FREE AND FREE OF `Deno.*` on purpose — the client's vitest and
 * tsc both read this file (the meal-scan/food-match precedent), and either
 * would fail on a runtime global. Everything that touches the runtime lives in
 * `_shared/monitoring.ts`.
 */

export interface SentryDsn {
  origin: string;
  publicKey: string;
  projectId: string;
}

export function parseDsn(raw: string | null | undefined): SentryDsn | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const m = /^(https?):\/\/([^:@/]+)(?::[^@/]*)?@([^/]+)\/(\d+)\/?$/.exec(value);
  if (!m) return null;
  return { origin: `${m[1]}://${m[3]}`, publicKey: m[2], projectId: m[4] };
}

export const SENTRY_CLIENT = 'evoforge-minimal/1.0.0';

export function envelopeUrl(dsn: SentryDsn): string {
  return (
    `${dsn.origin}/api/${dsn.projectId}/envelope/` +
    `?sentry_version=7` +
    `&sentry_client=${encodeURIComponent(SENTRY_CLIENT)}` +
    `&sentry_key=${encodeURIComponent(dsn.publicKey)}`
  );
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+/g;
const TOKEN_RE = /\b(?:sb_(?:publishable|secret)_[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9._-]{12,})/g;

/** Matters MORE here than on the client: an edge function holds the service
 *  role key and the OpenAI key, and an upstream error message is exactly where
 *  a credential leaks into a log. */
export function redact(text: string): string {
  return text.replace(EMAIL_RE, '[email]').replace(JWT_RE, '[jwt]').replace(TOKEN_RE, '[token]');
}

export interface SentryFrame {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
}

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
    in_app: !/node_modules|\[native code\]/.test(filename),
  };
}

/** Oldest first — the throwing frame is last, which is what Sentry expects. */
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

export interface ErrorEventInput {
  eventId: string;
  timestampMs: number;
  type: string;
  value: string;
  stack?: string | null;
  release: string;
  environment: string;
  surface: 'client' | 'edge';
  userId?: string | null;
  mechanism: string;
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

/** No `length` in the item header: it is a BYTE count and JSON.stringify gives
 *  characters, so any non-ASCII would truncate the payload on ingest. Omitted,
 *  the payload runs to the next newline, which is exact. */
export function serialiseEnvelope(event: SentryEvent, sentAtIso: string): string {
  const header = JSON.stringify({ event_id: event.event_id, sent_at: sentAtIso });
  const item = JSON.stringify({ type: 'event', content_type: 'application/json' });
  return `${header}\n${item}\n${JSON.stringify(event)}\n`;
}

export function newEventId(random: () => number): string {
  let out = '';
  for (let i = 0; i < 32; i++) out += (Math.floor(random() * 16) & 15).toString(16);
  return out;
}
