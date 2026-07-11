import { create } from 'zustand';

/**
 * The toast queue: Zustand replaces the Streamlit session_state pumps
 * (`show_xp_toast`, `last_xp_gain`, ...) that existed because reruns wiped
 * component state. No reruns exist here, so a toast is just data with a
 * lifetime; <ToastHost> renders the queue and expires entries on the
 * animations.ts one-shot durations (which END at opacity 0 -- never
 * fast-forward them, an invisible toast is the old bug class).
 *
 * DOCTRINE: this store is cleared on sign-out (auth-context). Every Zustand
 * store added after it must be cleared there too -- a sign-out that misses a
 * cache hands the last athlete's state to the next visitor.
 */

export type ToastKind = 'xp' | 'pr' | 'achievement' | 'info' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  subtitle?: string;
  /** XP actually earned -- announced XP must be XP that lands (never a made-up
   *  number; the old UI once announced +75 for a 10 XP set). */
  xp?: number;
}

interface ToastState {
  toasts: Toast[];
  push: (toast: Omit<Toast, 'id'>) => number;
  dismiss: (id: number) => void;
  reset: () => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  reset: () => set({ toasts: [] }),
}));

/** The one place a logged set's toast is minted; mirrors mark_xp_gain(). */
export function announceXp(xp: number, title = 'QUEST COMPLETE', subtitle = 'Set logged successfully') {
  useToastStore.getState().push({ kind: 'xp', title, subtitle, xp: Math.trunc(xp) });
}
