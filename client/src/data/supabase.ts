import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

import { LargeSecureStore } from './large-secure-store';

// Trim and strip accidental wrapping quotes: these values transit dashboards,
// .env files and CI secret forms, and a copy-paste from secrets.toml carries
// TOML's double quotes along. createClient rejects `"https://...` as an
// invalid URL -- in CI that surfaced only as a mid-export crash.
const clean = (value: string | undefined) =>
  value?.trim().replace(/^['"]+|['"]+$/g, '') || undefined;

const supabaseUrl = clean(process.env.EXPO_PUBLIC_SUPABASE_URL);
const supabaseKey = clean(process.env.EXPO_PUBLIC_SUPABASE_KEY);

if (!supabaseUrl || !supabaseKey) {
  // EXPO_PUBLIC_ vars are inlined at build time; a missing one means .env.local
  // was not set up (see .env.example). Fail loudly now, not with an opaque
  // network error on the first query.
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_KEY. Copy .env.example to .env.local and fill it in.'
  );
}

/**
 * One client for the whole app, both platforms.
 *
 * Native: sessions persist through LargeSecureStore (AES key in the keychain,
 * ciphertext in AsyncStorage). Web: `storage` is left undefined so supabase-js
 * uses localStorage -- with React escaping by default and dangerouslySetInnerHTML
 * banned by ESLint, the XSS vector that made the Streamlit JS-readable cookie
 * dangerous is gone (root CLAUDE.md "Auth"; ui/escape.py has no equivalent here
 * because nothing needs it).
 *
 * `detectSessionInUrl` is web-only: email confirmation links land on
 * https://<host>/auth/callback with tokens in the URL for the web app, while
 * native gets them via the evoforge:// deep link and exchanges them explicitly.
 *
 * Module-scope side effects (AppState listener) are guarded to native, so
 * importing this file during static web export (Node, no window) stays inert.
 */
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    ...(Platform.OS !== 'web' ? { storage: new LargeSecureStore() } : {}),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

if (Platform.OS !== 'web') {
  // supabase-js only refreshes tokens while told the app is foregrounded.
  // Without this, a session that sits backgrounded past expiry comes back dead.
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
