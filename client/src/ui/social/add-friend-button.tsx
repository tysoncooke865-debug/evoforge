import { Pressable, Text } from 'react-native';

import { useAuth } from '@/data/auth-context';
import { useRequestFriend } from '@/data/social-profile';
import { useFriends, useFriendRequests, useSentFriendRequests, useCancelFriendRequest } from '@/data/social';
import { canRequest, friendStateFor, FRIEND_STATE_LABEL } from '@/domain/friend-state';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';

/**
 * ADD FRIEND — the id-based request (migration 055's request_friend), used from
 * a public profile or the Discover list where the athlete's code isn't in hand.
 * A compact chip so it fits a profile header or a discovery row.
 *
 * ---- WHAT CHANGED, 2026-08-11 ----
 *
 * This button had exactly two states: `+ ADD`, and `…` while its own mutation
 * was in flight. So the moment a request landed it reverted to `+ ADD`, and
 * reopening Social showed `+ ADD` again — there was nothing anywhere in the app
 * that remembered a request had been sent. The only sensible response is to tap
 * it again, which the unique (from_id, to_id) index refuses silently, so
 * nothing at all appears to happen. Twice.
 *
 * It now renders the real relationship (domain/friend-state.ts), which needed
 * migration 199 to exist at all: `my_friend_requests()` returns requests TO me,
 * and nothing had ever returned the ones FROM me.
 *
 * PENDING IS NOT A DEAD LABEL. §4's rule — never show something that looks
 * tappable and does nothing — applies here first: a pending chip withdraws the
 * request, and says so to a screen reader.
 */
export function AddFriendButton({
  athleteId,
  token,
  testID,
}: {
  athleteId: string;
  token?: string | null;
  testID?: string;
}) {
  const colors = useThemeColors();
  const { session } = useAuth();
  const request = useRequestFriend();
  const cancel = useCancelFriendRequest();
  const friends = useFriends();
  const sent = useSentFriendRequests();
  const incoming = useFriendRequests();

  const state = friendStateFor({
    athleteId,
    meId: session?.user?.id ?? null,
    friends: friends.data,
    sent: sent.data,
    incoming: incoming.data,
  });

  // Nothing to offer about yourself, and nothing to offer once you are already
  // friends — the surface that matters then is the trial, not this chip.
  if (state === 'self') return null;

  const pendingOut = state === 'pending_out';
  const busy = request.isPending || cancel.isPending;
  const label = busy ? '…' : FRIEND_STATE_LABEL[state];

  const onPress = () => {
    if (busy) return;
    if (pendingOut) {
      const row = (sent.data ?? []).find((r) => r.to_id === athleteId);
      if (row) cancel.mutate(row.id);
      return;
    }
    if (canRequest(state)) request.mutate({ athleteId, token });
    // `friends` and `pending_in` are states, not actions, on this surface.
  };

  // Cyan for a live invitation out, purple for the offer to send one — the
  // app's existing meaning for each, not a new colour.
  const tint = pendingOut ? colors.accent : state === 'friends' ? colors['text-mute'] : colors.epic;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={
        pendingOut
          ? 'friend request pending — tap to withdraw it'
          : state === 'friends'
            ? 'already friends'
            : state === 'pending_in'
              ? 'this athlete has sent you a request — respond in Social'
              : 'add friend'
      }
      accessibilityState={{ disabled: busy || state === 'friends' }}
      disabled={busy || state === 'friends'}
      testID={testID ?? `add-friend-${athleteId}`}
      className="items-center justify-center rounded-lg border px-s3"
      // 44pt is the touch floor; the chip used to be 40 and sits in a dense
      // list where a miss costs a wrong profile.
      style={{ minHeight: 44, borderColor: `${tint}8c`, backgroundColor: `${tint}1a` }}
    >
      <Text
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 1, color: tint, ...pixelFont(false) }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
