import { Text, View } from 'react-native';

// TEMPORARY Phase 0 probe. Proves the token-driven Tailwind theme resolves:
// these class names only exist if tailwind.config.js successfully consumed
// src/theme/tokens.js, so finding --accent's #22d3ee in the exported CSS via
// `text-accent` (not an arbitrary value) verifies the whole chain
// tokens.js -> tailwind.config.js -> NativeWind -> bundle.
// Deleted once the real theme components land.
export default function NativeWindProbe() {
  return (
    <View className="flex-1 items-center justify-center bg-bg">
      <View className="rounded-lg border border-border bg-surface p-s6 shadow-glow-sm">
        <Text className="text-2xl font-bold text-accent">NATIVEWIND_PROBE_OK</Text>
        <Text className="text-sm text-text-dim">tokens.js drives this styling</Text>
        <Text className="text-xs text-epic">rarity: epic aura palette</Text>
      </View>
    </View>
  );
}
