/**
 * Python coercion semantics, so the domain port can be line-by-line faithful.
 *
 * The Python domain leans on `int(x)` / `float(x)` inside try/except as its
 * input sanitiser, and those functions are NOT JavaScript's Number():
 *
 *   int("5")    = 5        Number("5")   = 5
 *   int("5.5")  raises     Number("5.5") = 5.5      <- divergence
 *   int(5.9)    = 5        (TRUNCATES toward zero, not floor/round)
 *   int(true)   = 1        (bool is an int in Python)
 *   float("")   raises     Number("")    = 0         <- divergence
 *   float([])   raises     Number([])    = 0         <- divergence
 *   float("abc") raises    Number("abc") = NaN
 *
 * These helpers return null where Python raises ValueError/TypeError, so a
 * caller's `try: ... except: default` becomes `?? default` or an if-null.
 * The parity fixtures are the arbiter: every branch here exists because a
 * golden case exercises it.
 */

/** Python int(x): null where Python raises. Truncates toward zero. */
export function pyInt(value: unknown): number | null {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'number') {
    // int(nan) and int(inf) raise in Python.
    if (!Number.isFinite(value)) {
      return null;
    }
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const s = value.trim();
    // int() takes optionally-signed decimal digits only -- no floats, no hex,
    // no exponents, no empty string.
    if (!/^[+-]?\d+$/.test(s)) {
      return null;
    }
    return parseInt(s, 10);
  }
  return null; // None, objects, arrays, undefined -> TypeError in Python
}

/** Python float(x): null where Python raises. */
export function pyFloat(value: unknown): number | null {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  if (typeof value === 'number') {
    return value; // nan/inf are legal floats; callers guard them explicitly
  }
  if (typeof value === 'string') {
    const s = value.trim();
    if (s === '') {
      return null;
    }
    // Python float() accepts nan/inf spellings; Number() does not.
    if (/^[+-]?nan$/i.test(s)) {
      return NaN;
    }
    if (/^[+-]?inf(inity)?$/i.test(s)) {
      return s.startsWith('-') ? -Infinity : Infinity;
    }
    // Number() additionally accepts hex/octal/binary literals Python rejects.
    if (/^[+-]?0[xob]/i.test(s)) {
      return null;
    }
    const n = Number(s);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}
