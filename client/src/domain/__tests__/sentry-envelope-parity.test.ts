import { describe, expect, it } from 'vitest';

// The Sentry wire format exists TWICE — once here for the app, once in
// supabase/functions/_shared for Deno — because Metro cannot resolve a module
// outside the client root. This file is the reason that is safe: it drives both
// copies with the same input and asserts the bytes match. If the two ever
// diverge, the edge half stops being accepted by ingest and the edge functions
// go dark WITHOUT anything failing — the 086 lesson (three green cron runs and
// an alerting system that could not alert) in a new costume.
//
// The cross-root import follows the meal-scan/food-match precedent. If it ever
// breaks the client toolchain, delete this file and pin the edge copy with a
// curl against ingest instead — but do not delete it and pin nothing.
import * as edge from '../../../../supabase/functions/_shared/sentry-envelope';
import * as app from '../error-report';

const DSN = 'https://pubkey123@o4507.ingest.us.sentry.io/4507999';

const STACK = [
  'TypeError: Cannot read properties of undefined',
  '    at saveSet (https://app/entry-abc.js:10:20)',
  '    at flushQueue (https://app/node_modules/q/index.js:30:40)',
  'anonymous@https://app/entry-abc.js:1:1',
].join('\n');

const INPUT = {
  eventId: 'b'.repeat(32),
  timestampMs: 1_760_000_000_123,
  type: 'TypeError',
  value: 'Cannot read properties of undefined — athlete@example.com, Bearer abcdefghijklmnop',
  stack: STACK,
  release: 'deadbeef',
  environment: 'production',
  surface: 'edge' as const,
  userId: '3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607',
  mechanism: 'edge-handler',
  handled: false,
  tags: { fn: 'meal-scan', dropped: undefined },
  extra: { method: 'POST' },
};

describe('sentry envelope parity (client ⟷ edge)', () => {
  it('parses a DSN the same way', () => {
    expect(edge.parseDsn(DSN)).toEqual(app.parseDsn(DSN));
    expect(edge.parseDsn('rubbish')).toEqual(app.parseDsn('rubbish'));
    expect(edge.parseDsn('https://pub:secret@sentry.io/42/')).toEqual(
      app.parseDsn('https://pub:secret@sentry.io/42/')
    );
  });

  it('builds the same ingest URL', () => {
    expect(edge.envelopeUrl(edge.parseDsn(DSN)!)).toBe(app.envelopeUrl(app.parseDsn(DSN)!));
    expect(edge.SENTRY_CLIENT).toBe(app.SENTRY_CLIENT);
  });

  it('redacts identically', () => {
    const text = 'rejected athlete@example.com with Bearer abcdefghijklmnop and sb_publishable_x1';
    expect(edge.redact(text)).toBe(app.redact(text));
    expect(edge.redact(text)).not.toContain('athlete@example.com');
  });

  it('parses stacks identically, frame for frame', () => {
    expect(edge.parseStackFrames(STACK)).toEqual(app.parseStackFrames(STACK));
    expect(edge.parseStackFrames(null)).toEqual(app.parseStackFrames(null));
    expect(edge.MAX_FRAMES).toBe(app.MAX_FRAMES);
  });

  it('emits byte-identical envelopes', () => {
    const sentAt = '2026-07-25T12:00:00.000Z';
    const fromEdge = edge.serialiseEnvelope(edge.buildErrorEvent(INPUT), sentAt);
    const fromApp = app.serialiseEnvelope(app.buildErrorEvent(INPUT), sentAt);
    expect(fromEdge).toBe(fromApp);
    // A parity test that passes on two empty strings is not a test.
    expect(fromEdge.length).toBeGreaterThan(200);
    expect(JSON.parse(fromEdge.split('\n')[2]).exception.values[0].stacktrace.frames).toHaveLength(3);
  });

  it('emits byte-identical envelopes for the signed-out, stackless case too', () => {
    const bare = { ...INPUT, userId: null, stack: null, tags: undefined, extra: undefined };
    expect(edge.serialiseEnvelope(edge.buildErrorEvent(bare), 'now')).toBe(
      app.serialiseEnvelope(app.buildErrorEvent(bare), 'now')
    );
  });

  it('mints event ids identically', () => {
    let n = 0;
    const seq = () => ((n = (n + 7) % 16) / 16);
    const a = app.newEventId(seq);
    n = 0;
    const b = edge.newEventId(seq);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });
});
