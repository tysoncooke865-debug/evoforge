import { Text, View } from 'react-native';

// TEMPORARY Phase 0 probe. Proves NativeWind v4's Tailwind -> RN style pipeline
// actually compiles on Expo SDK 57 / RN 0.86 / Reanimated 4.5, rather than merely
// installing without error. `bg-[#22d3ee]` is EvoForge's --accent; the arbitrary
// value makes it unique enough to grep out of the emitted web CSS bundle.
// Deleted once the real theme lands.
export default function NativeWindProbe() {
  return (
    <View className="flex-1 items-center justify-center bg-[#070b14]">
      <Text className="text-2xl font-bold text-[#22d3ee]">NATIVEWIND_PROBE_OK</Text>
    </View>
  );
}
