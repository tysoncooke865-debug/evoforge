/**
 * OPTIMISE_PLAN P2 — native session storage: AES key in the keychain,
 * ciphertext in AsyncStorage (LargeSecureStore). The web twin returns
 * undefined so supabase-js falls back to localStorage AND the aes-js +
 * buffer weight (~110KB pre-min) never enters the web bundle.
 */
import { LargeSecureStore } from './large-secure-store';

export const makeSessionStorage = (): LargeSecureStore | undefined => new LargeSecureStore();
