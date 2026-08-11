import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * THE SERVICE WORKER CONTRACT.
 *
 * `public/sw.js` is plain JavaScript served as-is: it cannot import the
 * constants in `data/rest-alarm.ts`, so the message names and the notification
 * tag exist as duplicated string literals on either side of a postMessage.
 * That is a contract held together by nothing but two people typing the same
 * word, and the failure mode is silent — a renamed message means the worker
 * ignores the schedule, no notification is ever armed, and the app looks
 * completely fine right up until an athlete's rest ends without a buzz.
 *
 * `rest-alarm.ts` claims "the sw test pins it". This is that test; without it
 * the comment was a promise rather than a fact.
 *
 * Read as TEXT rather than imported, because `data/rest-alarm.ts` pulls in
 * react-native and `public/sw.js` uses `self`/`ServiceWorkerGlobalScope` —
 * neither survives this environment. The strings are what matter and the
 * strings are what is checked.
 */

const CLIENT = join(__dirname, '..', '..', '..');
const alarm = readFileSync(join(CLIENT, 'src', 'data', 'rest-alarm.ts'), 'utf8');
const sw = readFileSync(join(CLIENT, 'public', 'sw.js'), 'utf8');
const edge = readFileSync(
  join(CLIENT, '..', 'supabase', 'functions', 'rest-alarm', 'index.ts'),
  'utf8'
);

/** The literal each constant is declared as, straight from the source. */
const literal = (name: string): string => {
  const m = new RegExp(`export const ${name} = '([^']+)'`).exec(alarm);
  expect(m, `rest-alarm.ts no longer declares ${name}`).not.toBeNull();
  return (m as RegExpExecArray)[1];
};

describe('rest-alarm ⟷ sw.js', () => {
  it('declares the three constants it says it shares', () => {
    expect(literal('REST_ALARM_SCHEDULE')).toBe('evoforge-rest-schedule');
    expect(literal('REST_ALARM_CANCEL')).toBe('evoforge-rest-cancel');
    expect(literal('REST_ALARM_TAG')).toBe('evoforge-rest');
  });

  it('the worker handles the exact message names the client posts', () => {
    for (const name of ['REST_ALARM_SCHEDULE', 'REST_ALARM_CANCEL']) {
      const value = literal(name);
      expect(
        sw.includes(`'${value}'`),
        `public/sw.js does not handle '${value}' — a rest would arm nothing`
      ).toBe(true);
    }
  });

  it('the worker still has a handler and a single-slot timer', () => {
    // Guard against the handler being deleted wholesale rather than renamed.
    expect(sw).toContain("addEventListener('message'");
    expect(sw).toContain('showNotification');
    // ONE slot is the whole reason a duplicate notification is impossible.
    expect(sw).toMatch(/let restTimer = null/);
    expect(sw).toContain('clearRestTimer');
  });

  it('every path uses the SAME notification tag, or duplicates stack', () => {
    // The tag is what makes the browser collapse a worker notification and a
    // pushed one onto a single entry instead of showing two.
    const tag = literal('REST_ALARM_TAG');
    expect(sw.includes(`'${tag}'`), 'sw.js lost the shared tag').toBe(true);
    expect(edge.includes(`'${tag}'`), 'the edge sender lost the shared tag').toBe(true);
  });
});

describe('the push backstop', () => {
  it('is cron-secret gated — it can notify arbitrary users', () => {
    expect(edge).toContain('x-cron-secret');
    expect(edge).toContain('CRON_SECRET');
  });

  it('reads its queue through the service-role-only RPC', () => {
    expect(edge).toContain('rest_alarms_due');
  });

  it('sweeps dead subscriptions rather than retrying them forever', () => {
    expect(edge).toMatch(/410|404/);
    expect(edge).toContain('push_subscriptions');
  });
});
