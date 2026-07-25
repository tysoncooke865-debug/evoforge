import { describe, expect, it } from 'vitest';

import {
  buildErrorEvent,
  createReportGate,
  envelopeUrl,
  fingerprintOf,
  MAX_FRAMES,
  newEventId,
  parseDsn,
  parseStackFrames,
  redact,
  serialiseEnvelope,
  type ErrorEventInput,
} from '../error-report';

const BASE: ErrorEventInput = {
  eventId: 'a'.repeat(32),
  timestampMs: 1_760_000_000_000,
  type: 'TypeError',
  value: 'Cannot read properties of undefined',
  stack: null,
  release: 'deadbeef',
  environment: 'production',
  surface: 'client',
  mechanism: 'onerror',
  handled: false,
};

describe('parseDsn', () => {
  it('reads the standard shape', () => {
    expect(parseDsn('https://abc123@o4507.ingest.us.sentry.io/4507999')).toEqual({
      origin: 'https://o4507.ingest.us.sentry.io',
      publicKey: 'abc123',
      projectId: '4507999',
    });
  });

  it('tolerates the legacy secret half and a trailing slash', () => {
    expect(parseDsn('https://pub:secret@sentry.io/42/')).toEqual({
      origin: 'https://sentry.io',
      publicKey: 'pub',
      projectId: '42',
    });
  });

  it('returns null rather than half-configuring', () => {
    // Monitoring must be OFF and say so, never on-with-a-broken-endpoint.
    expect(parseDsn(null)).toBeNull();
    expect(parseDsn('')).toBeNull();
    expect(parseDsn('   ')).toBeNull();
    expect(parseDsn('not-a-dsn')).toBeNull();
    expect(parseDsn('https://sentry.io/42')).toBeNull(); // no public key
    expect(parseDsn('https://abc@sentry.io/')).toBeNull(); // no project id
    expect(parseDsn('https://abc@sentry.io/notanumber')).toBeNull();
  });
});

describe('envelopeUrl', () => {
  it('carries auth in the query string, so a report is never preflighted', () => {
    const url = envelopeUrl(parseDsn('https://k1@o1.ingest.sentry.io/7')!);
    expect(url).toContain('https://o1.ingest.sentry.io/api/7/envelope/');
    expect(url).toContain('sentry_key=k1');
    expect(url).toContain('sentry_version=7');
  });
});

describe('redact', () => {
  it('removes addresses, jwts and bearer tokens', () => {
    expect(redact('sign-in failed for athlete@example.com')).toBe('sign-in failed for [email]');
    expect(redact('bad jwt eyJhbGciOiJI.eyJzdWIiOiIx.QSSf4Nabc')).toBe('bad jwt [jwt]');
    expect(redact('header Bearer abcdefghijklmnop')).toBe('header [token]');
    expect(redact('key sb_publishable_AbC-123')).toBe('key [token]');
  });

  it('leaves an ordinary message alone', () => {
    const msg = 'Cannot read properties of undefined (reading "sets")';
    expect(redact(msg)).toBe(msg);
  });

  it('keeps the athlete id — the founder alert counts on it', () => {
    const id = '3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607';
    expect(redact(`no row for ${id}`)).toContain(id);
  });
});

describe('parseStackFrames', () => {
  it('reads V8 frames and returns them oldest first', () => {
    const stack = [
      'TypeError: boom',
      '    at saveSet (https://app/entry-abc.js:10:20)',
      '    at flushQueue (https://app/entry-abc.js:30:40)',
    ].join('\n');
    const frames = parseStackFrames(stack);
    expect(frames).toHaveLength(2);
    // Sentry's protocol wants the throwing frame LAST.
    expect(frames[1].function).toBe('saveSet');
    expect(frames[0].function).toBe('flushQueue');
    expect(frames[1]).toMatchObject({
      filename: 'https://app/entry-abc.js',
      lineno: 10,
      colno: 20,
      in_app: true,
    });
  });

  it('reads the at-sign grammar (Safari / Firefox / Hermes)', () => {
    const frames = parseStackFrames('saveSet@https://app/entry.js:5:6\n@https://app/entry.js:7:8');
    expect(frames).toHaveLength(2);
    expect(frames[1].function).toBe('saveSet');
    expect(frames[0].function).toBe('?'); // anonymous, not missing
  });

  it('reads a bare V8 frame with no function name', () => {
    const frames = parseStackFrames('    at https://app/entry.js:1:2');
    expect(frames).toEqual([
      { filename: 'https://app/entry.js', function: '?', lineno: 1, colno: 2, in_app: true },
    ]);
  });

  it('marks vendor frames out of app', () => {
    const frames = parseStackFrames('    at x (https://app/node_modules/foo/i.js:1:2)');
    expect(frames[0].in_app).toBe(false);
  });

  it('drops lines it cannot parse instead of guessing', () => {
    expect(parseStackFrames('TypeError: boom\n    at <anonymous>\n')).toEqual([]);
    expect(parseStackFrames(null)).toEqual([]);
    expect(parseStackFrames(undefined)).toEqual([]);
  });

  it('caps frames so a keepalive report can never exceed the 64KB limit', () => {
    const stack = Array.from({ length: 200 }, (_, i) => `    at f${i} (https://a/e.js:${i}:1)`).join('\n');
    expect(parseStackFrames(stack)).toHaveLength(MAX_FRAMES);
  });
});

describe('buildErrorEvent', () => {
  it('tags the release and the surface', () => {
    const event = buildErrorEvent(BASE);
    expect(event.release).toBe('deadbeef');
    expect(event.dist).toBe('deadbeef');
    expect(event.tags.surface).toBe('client');
    expect(event.timestamp).toBe(1_760_000_000);
    expect(event.exception.values[0]).toMatchObject({
      type: 'TypeError',
      mechanism: { type: 'onerror', handled: false },
    });
  });

  it('sends the athlete id and nothing else identifying', () => {
    const withUser = buildErrorEvent({ ...BASE, userId: 'u-1' });
    expect(withUser.user).toEqual({ id: 'u-1' });
    expect(JSON.stringify(withUser)).not.toContain('@');
  });

  it('omits `user` entirely when signed out', () => {
    expect(buildErrorEvent({ ...BASE, userId: null }).user).toBeUndefined();
    expect(buildErrorEvent(BASE).user).toBeUndefined();
  });

  it('redacts the message and drops empty tags', () => {
    const event = buildErrorEvent({
      ...BASE,
      value: 'rejected athlete@example.com',
      tags: { route: '/today', platform: undefined, empty: '' },
    });
    expect(event.exception.values[0].value).toBe('rejected [email]');
    expect(event.tags.route).toBe('/today');
    expect(event.tags.platform).toBeUndefined();
    expect(event.tags.empty).toBeUndefined();
  });

  it('omits the stacktrace key when there are no frames', () => {
    expect(buildErrorEvent(BASE).exception.values[0].stacktrace).toBeUndefined();
    const withStack = buildErrorEvent({ ...BASE, stack: '    at f (https://a/e.js:1:2)' });
    expect(withStack.exception.values[0].stacktrace?.frames).toHaveLength(1);
  });
});

describe('serialiseEnvelope', () => {
  it('emits three newline-terminated lines and no length field', () => {
    const body = serialiseEnvelope(buildErrorEvent(BASE), '2026-07-25T00:00:00.000Z');
    const lines = body.split('\n');
    expect(lines).toHaveLength(4); // header, item header, payload, trailing ''
    expect(JSON.parse(lines[0])).toEqual({
      event_id: 'a'.repeat(32),
      sent_at: '2026-07-25T00:00:00.000Z',
    });
    // `length` is a BYTE count; JSON.stringify counts characters. Omitting it
    // is what keeps a non-ASCII message from being truncated on ingest.
    expect(JSON.parse(lines[1])).toEqual({ type: 'event', content_type: 'application/json' });
    expect(JSON.parse(lines[2]).event_id).toBe('a'.repeat(32));
  });

  it('survives a non-ASCII message', () => {
    const body = serialiseEnvelope(buildErrorEvent({ ...BASE, value: 'café — 💥' }), 'now');
    expect(JSON.parse(body.split('\n')[2]).exception.values[0].value).toBe('café — 💥');
  });
});

describe('newEventId', () => {
  it('is 32 lowercase hex characters', () => {
    expect(newEventId(Math.random)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('cannot emit a non-hex character when random() returns exactly 1', () => {
    expect(newEventId(() => 1)).toMatch(/^[0-9a-f]{32}$/);
    expect(newEventId(() => 0)).toBe('0'.repeat(32));
  });
});

describe('the gate', () => {
  it('reports a defect once and never again', () => {
    const gate = createReportGate();
    expect(gate.allow('fp', 0)).toBe(true);
    expect(gate.allow('fp', 1)).toBe(false);
    expect(gate.allow('fp', 10 * 60_000)).toBe(false);
  });

  it('holds a spin loop to the per-minute ceiling', () => {
    // The 2026-07-21 shape: ~40 failures a second, all different.
    const gate = createReportGate({ maxPerMinute: 5, maxPerSession: 100 });
    let allowed = 0;
    for (let i = 0; i < 2400; i++) if (gate.allow(`fp-${i}`, 25 * i)) allowed++;
    expect(allowed).toBe(5);
  });

  it('lets the next minute through', () => {
    const gate = createReportGate({ maxPerMinute: 2, maxPerSession: 100 });
    expect(gate.allow('a', 0)).toBe(true);
    expect(gate.allow('b', 1)).toBe(true);
    expect(gate.allow('c', 2)).toBe(false);
    expect(gate.allow('c', 60_001)).toBe(true);
  });

  it('caps the session no matter how slowly failures arrive', () => {
    const gate = createReportGate({ maxPerSession: 3, maxPerMinute: 100 });
    let allowed = 0;
    for (let i = 0; i < 50; i++) if (gate.allow(`fp-${i}`, i * 5 * 60_000)) allowed++;
    expect(allowed).toBe(3);
  });
});

describe('fingerprintOf', () => {
  it('collapses ids and counters, so a numbered loop still dedupes', () => {
    const frames = parseStackFrames('    at f (https://a/e.js:1:2)');
    expect(fingerprintOf('Error', 'request 41 failed', frames)).toBe(
      fingerprintOf('Error', 'request 42 failed', frames)
    );
    expect(fingerprintOf('Error', 'no row for 3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f607', frames)).toBe(
      fingerprintOf('Error', 'no row for 9c11e2d3-4a5b-4c6d-8e7f-0a1b2c3d4e5f', frames)
    );
  });

  it('separates different defects', () => {
    const frames = parseStackFrames('    at f (https://a/e.js:1:2)');
    const other = parseStackFrames('    at g (https://a/e.js:9:9)');
    expect(fingerprintOf('Error', 'boom', frames)).not.toBe(fingerprintOf('TypeError', 'boom', frames));
    expect(fingerprintOf('Error', 'boom', frames)).not.toBe(fingerprintOf('Error', 'boom', other));
    expect(fingerprintOf('Error', 'boom', [])).toContain('no-stack');
  });
});
