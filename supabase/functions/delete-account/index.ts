/**
 * delete-account (2026-07-19) — in-app account deletion.
 *
 * Apple Guideline 5.1.1(v): an app that supports account creation MUST let the
 * user delete their account from within the app. The caller is resolved from
 * the JWT (never a client-supplied id), then the service role deletes the auth
 * user. Every user table references auth.users(id) ON DELETE CASCADE, so all
 * of the athlete's rows (profile, logs, progression, social, gyms, ...) are
 * removed automatically — no per-table cleanup to drift.
 *
 * The client must send a fresh confirmation (a re-typed word) so a stray tap
 * can't nuke an account; the JWT is still the authority for WHOSE account.
 */
import { CORS_HEADERS, json } from '../_shared/ai.ts';
import { callerUserId, serviceClient } from '../_shared/battle/service.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const uid = await callerUserId(req);
  if (!uid) return json({ error: 'Not signed in.' }, 401);

  const body = await req.json().catch(() => ({}));
  // A deliberate confirmation gesture — the client sends the word the UI asked
  // the user to type. Guards against an accidental one-tap deletion.
  if (String(body.confirm ?? '').trim().toUpperCase() !== 'DELETE') {
    return json({ error: 'Confirmation required.' }, 400);
  }

  const admin = serviceClient();
  // Delete the auth user; ON DELETE CASCADE removes every owned row.
  const { error } = await admin.auth.admin.deleteUser(uid);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
});
