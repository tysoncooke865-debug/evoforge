import { Pressable, Text } from 'react-native';

import { useRequestFriend } from '@/data/social-profile';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * ADD FRIEND — the id-based request (migration 055's request_friend), used from
 * a public profile or the Discover list where the athlete's code isn't in hand.
 * A compact chip so it fits a profile header or a discovery row.
 */
export function AddFriendButton({ athleteId, testID }: { athleteId: string; testID?: string }) {
  const colors = useThemeColors();
  const request = useRequestFriend();
  return (
    <Pressable
      onPress={() => request.mutate(athleteId)}
      accessibilityRole="button"
      accessibilityLabel="add friend"
      disabled={request.isPending}
      testID={testID ?? `add-friend-${athleteId}`}
      className="items-center justify-center rounded-lg border px-s3"
      style={{ minHeight: 40, borderColor: `${colors.epic}8c`, backgroundColor: 'rgba(168,85,247,0.1)' }}
    >
      <Text className="text-epic" allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}>
        {request.isPending ? '…' : '+ ADD'}
      </Text>
    </Pressable>
  );
}
