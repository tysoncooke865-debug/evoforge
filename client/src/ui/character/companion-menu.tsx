import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { SpriteCompanion } from '@/ui/character/sprite-avatar';

/**
 * TRANSFORM P1: your companion IS your profile menu. The animated sprite
 * in every screen's top-right now opens the menu (Account, Awards, Coins,
 * Oracle, Stats entry, Schedule, Data…) — the five-tab bar keeps only the
 * majors. The sprite itself ignores pointer events, so the wrapper owns
 * the tap; 44pt minimum target held by minWidth/minHeight.
 */
export function CompanionMenuButton({ anim, height = 56 }: { anim: 'idle' | 'run' | 'punch' | 'victory'; height?: number }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/more')}
      accessibilityRole="button"
      accessibilityLabel="open profile menu"
      className="items-center justify-center"
      style={{ minWidth: 44, minHeight: 44 }}
      testID="profile-menu"
    >
      <SpriteCompanion anim={anim} height={height} />
    </Pressable>
  );
}
