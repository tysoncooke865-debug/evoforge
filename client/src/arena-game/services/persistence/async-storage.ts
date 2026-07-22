/**
 * AsyncStorage-backed KeyValueStorage. Only imported from app (React Native)
 * code — never from the game engine or tests.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValueStorage } from './storage';

export class AsyncStorageBackend implements KeyValueStorage {
  async getItem(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  }

  async getAllKeys(): Promise<string[]> {
    return [...(await AsyncStorage.getAllKeys())];
  }
}
