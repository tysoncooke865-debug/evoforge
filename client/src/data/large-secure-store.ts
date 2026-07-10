import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aesjs from 'aes-js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * Supabase's documented Expo storage pattern (MIGRATION_PLAN "Auth flow";
 * risk #5 anticipated this): SecureStore rejects values over 2048 bytes, and a
 * Supabase session JSON is bigger than that. So the AES-256 key (32 bytes,
 * well under the cap) lives in SecureStore -- hardware-backed keychain -- and
 * the session, AES-CTR-encrypted with it, lives in AsyncStorage.
 *
 * A fresh random key is generated on every setItem, so a stale key can never
 * decrypt a newer session. Random bytes come from expo-crypto explicitly
 * rather than a global `crypto` polyfill, so this file cannot silently fall
 * back to Math.random if the runtime changes underneath it.
 *
 * Native only. On web the supabase-js default (localStorage) applies -- see
 * supabase.ts. The Streamlit app's whole hand-rolled cookie/rotation saga in
 * auth/persistence.py is replaced by this adapter plus autoRefreshToken.
 */
export class LargeSecureStore {
  private async encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = Crypto.getRandomValues(new Uint8Array(256 / 8));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async decrypt(key: string, value: string): Promise<string | null> {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) {
      return null;
    }
    const cipher = new aesjs.ModeOfOperation.ctr(
      aesjs.utils.hex.toBytes(encryptionKeyHex),
      new aesjs.Counter(1)
    );
    const decryptedBytes = cipher.decrypt(aesjs.utils.hex.toBytes(value));
    return aesjs.utils.utf8.fromBytes(decryptedBytes);
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) {
      return null;
    }
    return this.decrypt(key, encrypted);
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this.encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}
