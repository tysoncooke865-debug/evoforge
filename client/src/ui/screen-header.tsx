import { Text, View } from 'react-native';

/** The screen masthead: kicker + neon title, the design system's hero voice. */
export function ScreenHeader({ kicker, title }: { kicker: string; title: string }) {
  return (
    <View className="mb-s2 w-full">
      <Text className="text-2xs font-bold tracking-widest text-text-mute">{kicker}</Text>
      <Text className="text-2xl font-bold text-accent" style={{ textShadowColor: 'rgba(34,211,238,0.45)', textShadowRadius: 14 }}>
        {title}
      </Text>
    </View>
  );
}
