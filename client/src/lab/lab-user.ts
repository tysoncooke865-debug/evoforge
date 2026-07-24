import type { Session } from '@supabase/supabase-js';

/**
 * The lab's fake athlete. Every data hook keys its query as [name, userId]
 * and computes userId from the auth session — so a fake session with THIS id
 * makes every hook look up exactly the entries seedLabCache() planted, and
 * staleTime: Infinity on the mock client means the queryFn never fires.
 *
 * The id is deliberately a syntactically valid UUID that can never exist in
 * production (RLS keys on auth.uid(); no JWT ever carries this id), so even
 * a write that escapes the shims cannot land under it.
 */
export const LAB_USER_ID = '00000000-0000-4000-8000-00000000c1ab';

/** Just enough session for useAuth consumers — the hooks read user.id only. */
export const LAB_SESSION = {
  user: {
    id: LAB_USER_ID,
    email: 'lab@evoforge.internal',
    aud: 'lab',
    created_at: '2026-01-01T00:00:00Z',
    app_metadata: {},
    user_metadata: {},
  },
  access_token: 'lab-mock-token',
  refresh_token: 'lab-mock-token',
  token_type: 'bearer',
  expires_in: 3600,
} as unknown as Session;
