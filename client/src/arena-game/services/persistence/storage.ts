/**
 * Storage abstraction. Pure-TS consumers (save system, providers, tests)
 * depend on this interface only; the AsyncStorage-backed implementation
 * lives in async-storage.ts and is wired up in app code, keeping the
 * engine and services testable in Node.
 */

export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<string[]>;
}

/** In-memory storage used by tests and as a crash-safe fallback. */
export class MemoryStorage implements KeyValueStorage {
  private map = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.map.delete(key);
  }

  async getAllKeys(): Promise<string[]> {
    return [...this.map.keys()];
  }
}
