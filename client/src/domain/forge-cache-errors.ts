/**
 * A SENTENCE THE ATHLETE CAN ACT ON, NEVER A DATABASE ERROR.
 *
 * The server's messages are already written for people — "the weekly cache
 * opens after 3 training days this cycle - you have 1" is exactly what somebody
 * needs. What must never reach a screen is the other kind: a not-null
 * violation, a constraint name, a PostgREST code. That is what this strips.
 *
 * The specific failure this was written after: `null value in column
 * "training_day" of relation "forge_cache_claims" violates not-null
 * constraint`, shown verbatim to an athlete who had done nothing wrong except
 * confirm a rest day (fixed at the source in migration 198 — this is the
 * belt to that fix's braces).
 */
export function friendlyCacheError(raw: string | null | undefined): string {
  const m = String(raw ?? '');
  // The server's own deliberate refusals pass through: they are written to be
  // read, and they carry the number that explains the refusal.
  const deliberate = /^forge_(cache_claim|cache_state|rest_confirm):\s*/.exec(m);
  if (deliberate) return m.slice(deliberate[0].length).trim();
  if (/violates|constraint|null value|PGRST|duplicate key|permission denied/i.test(m)) {
    return 'That did not go through. Pull to refresh and try again.';
  }
  if (/network|fetch|timeout|Failed to fetch/i.test(m)) {
    return 'No connection. Your cache is safe — try again when you are back online.';
  }
  return m.trim() || 'That did not go through. Try again in a moment.';
}
