import { beforeEach, describe, expect, it, vi } from 'vitest';

// The store persists through AsyncStorage, whose web shim wants `window`. What
// is under test is the ASKING RULE, so storage is faked exactly as the
// finish-queue tests fake it.
const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => void store.set(k, v),
    removeItem: async (k: string) => void store.delete(k),
  },
}));

const { PUSH_PROMPT_MIN_FINISHES, usePushPromptStore } = await import('../push-prompt-store');

const fresh = () =>
  usePushPromptStore.setState({ pending: false, askDisabled: false, asked: false, finishes: 0 });

describe('push prompt — when it may ask', () => {
  beforeEach(fresh);

  it('does not ask on the first finished workout', () => {
    // A workout finish already raises up to two other sheets. The first one is
    // not the moment to add a third.
    usePushPromptStore.getState().offerAfterFinish();
    expect(usePushPromptStore.getState().pending).toBe(false);
    expect(usePushPromptStore.getState().finishes).toBe(1);
  });

  it('asks on the second', () => {
    usePushPromptStore.getState().offerAfterFinish();
    usePushPromptStore.getState().offerAfterFinish();
    expect(usePushPromptStore.getState().finishes).toBe(PUSH_PROMPT_MIN_FINISHES);
    expect(usePushPromptStore.getState().pending).toBe(true);
  });

  it('never asks again once told not to', () => {
    usePushPromptStore.getState().disableForever();
    for (let i = 0; i < 10; i++) usePushPromptStore.getState().offerAfterFinish();
    expect(usePushPromptStore.getState().pending).toBe(false);
    // The counter still rises — the record stays honest even while silent.
    expect(usePushPromptStore.getState().finishes).toBe(10);
  });

  it('counts every finish even while it is not asking', () => {
    usePushPromptStore.getState().offerAfterFinish();
    expect(usePushPromptStore.getState().finishes).toBe(1);
    usePushPromptStore.setState({ askDisabled: true });
    usePushPromptStore.getState().offerAfterFinish();
    expect(usePushPromptStore.getState().finishes).toBe(2);
  });

  it('dismissing lowers the sheet without disabling it', () => {
    usePushPromptStore.getState().offerAfterFinish();
    usePushPromptStore.getState().offerAfterFinish();
    usePushPromptStore.getState().clear();
    expect(usePushPromptStore.getState().pending).toBe(false);
    expect(usePushPromptStore.getState().askDisabled).toBe(false);
  });

  it('does not re-ask once it has been asked', () => {
    usePushPromptStore.setState({ asked: true });
    usePushPromptStore.getState().offerAfterFinish();
    usePushPromptStore.getState().offerAfterFinish();
    usePushPromptStore.getState().offerAfterFinish();
    expect(usePushPromptStore.getState().pending).toBe(false);
  });

  it('reset clears the athlete-specific state on sign-out', () => {
    usePushPromptStore.getState().offerAfterFinish();
    usePushPromptStore.getState().offerAfterFinish();
    usePushPromptStore.getState().reset();
    const s = usePushPromptStore.getState();
    expect(s.pending).toBe(false);
    expect(s.finishes).toBe(0);
    expect(s.asked).toBe(false);
  });
});
