/**
 * OPTIMISE_PLAN P2 — web twin of session-storage.native.ts: returning
 * undefined lets supabase-js use localStorage (see supabase.ts for why
 * that is safe here), and keeps aes-js/buffer out of the web bundle.
 */
import type { LargeSecureStore } from './large-secure-store';

export const makeSessionStorage = (): LargeSecureStore | undefined => undefined;
