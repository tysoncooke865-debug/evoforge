import { useEffect, useState } from 'react';

import { supabase } from './supabase';

/**
 * TWO-FACTOR AUTHENTICATION (TOTP) — Supabase MFA. The project already enables
 * TOTP enrol + verify server-side; this is the client half.
 *
 * Model: signInWithPassword returns a session at **aal1**. If the account has a
 * VERIFIED factor, Supabase reports nextLevel 'aal2' — the app must then pass a
 * 6-digit challenge to reach aal2. The gate lives in the authed layout so it
 * applies to every entry path (fresh sign-in AND a restored aal1 session), not
 * just the sign-in screen.
 */

export interface MfaFactor {
  id: string;
  friendlyName?: string;
  status: string; // 'verified' | 'unverified'
}

export async function listTotpFactors(): Promise<MfaFactor[]> {
  try {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error || !data) return [];
    return (data.totp ?? []).map((f) => ({ id: f.id, friendlyName: f.friendly_name ?? undefined, status: f.status }));
  } catch {
    return [];
  }
}

/** Begin enrolment — returns the secret + otpauth URI + a QR to scan. */
export async function enrollTotp(friendlyName = 'EvoForge') {
  // A stale unverified factor blocks re-enrolment; clear those first.
  const existing = await listTotpFactors();
  for (const f of existing.filter((x) => x.status !== 'verified')) {
    try { await supabase.auth.mfa.unenroll({ factorId: f.id }); } catch { /* ignore */ }
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName });
  if (error || !data) throw new Error(error?.message ?? 'Could not start 2FA setup.');
  return { factorId: data.id, secret: data.totp.secret, uri: data.totp.uri, qr: data.totp.qr_code };
}

/** Verify a 6-digit code — completes enrolment AND satisfies a login challenge. */
export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const clean = code.replace(/\D/g, '');
  if (clean.length !== 6) throw new Error('Enter the 6-digit code from your authenticator.');
  const ch = await supabase.auth.mfa.challenge({ factorId });
  if (ch.error || !ch.data) throw new Error(ch.error?.message ?? 'Could not start the challenge.');
  const v = await supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code: clean });
  if (v.error) throw new Error(v.error.message);
}

export async function unenrollTotp(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw new Error(error.message);
}

/** True while the session is aal1 but the account requires aal2. */
export async function mfaChallengeRequired(): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error || !data) return false;
    return data.currentLevel === 'aal1' && data.nextLevel === 'aal2';
  } catch {
    return false;
  }
}

/**
 * Gate hook for the authed layout. `required` blocks the app until a code is
 * entered; `recheck` re-evaluates after a successful verify. Fails OPEN on any
 * error so an MFA outage can never lock an athlete out of their own app.
 */
export function useMfaGate(sessionUserId: string | null) {
  const [nonce, setNonce] = useState(0);
  // The answer is stamped with the key it was fetched for, so a sign-out or a
  // recheck invalidates it by comparison — no synchronous reset setState needed.
  const key = `${sessionUserId ?? ''}#${nonce}`;
  const [answer, setAnswer] = useState<{ key: string; required: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    const probe = sessionUserId ? mfaChallengeRequired() : Promise.resolve(false);
    void probe.then((need) => {
      if (live) setAnswer({ key, required: need });
    });
    return () => { live = false; };
  }, [key, sessionUserId]);
  const checked = answer?.key === key;
  return {
    required: checked ? answer.required : false,
    checked,
    recheck: () => setNonce((n) => n + 1),
  };
}
