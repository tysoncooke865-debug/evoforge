import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

const emptySubscribe = () => () => {};

/**
 * To support static rendering, this value needs to be re-calculated on the
 * client side for web. useSyncExternalStore is the sanctioned hydration
 * detector: server snapshot false, client snapshot true, no setState-in-effect
 * (the template's original useState/useEffect version trips
 * react-hooks/set-state-in-effect).
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
