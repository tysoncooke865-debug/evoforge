import { Text, View } from 'react-native';

import { useOnlineCount } from '@/data/presence';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * A live "players online" pill — a green dot + count, fed by the global presence
 * channel (data/presence.ts). Renders nothing until presence has synced (count 0),
 * so it never flashes a misleading "0 online".
 */
export function OnlineBadge({ testID }: { testID?: string }) {
  const colors = useThemeColors();
  const count = useOnlineCount();
  if (count <= 0) return null;
  return (
    <View
      className="flex-row items-center rounded-md border px-s2"
      style={{ minHeight: 24, gap: 5, borderColor: `${colors.success}59`, backgroundColor: 'rgba(34,197,94,0.08)' }}
      testID={testID ?? 'online-badge'}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success }} />
      <Text allowFontScaling={false} style={{ fontSize: 9, color: colors.success, letterSpacing: 0.5, ...pixelFont() }}>
        {count} ONLINE
      </Text>
    </View>
  );
}
