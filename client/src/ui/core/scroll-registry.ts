/**
 * Scroll-to-top registry (P2 C4, item 7). The FOCUSED screen's ScrollView
 * registers a scroller; the tab bar calls scrollActiveToTop() on every tab
 * press. Focus-scoped on purpose — keying by pathname would let unfocused
 * mounted tabs clobber the registration.
 */
type Scroller = () => void;

let active: Scroller | null = null;

export function setActiveScroller(fn: Scroller): void {
  active = fn;
}

export function clearActiveScroller(fn: Scroller): void {
  if (active === fn) active = null;
}

export function scrollActiveToTop(): void {
  active?.();
}
