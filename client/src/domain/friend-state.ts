/**
 * WHERE DO I STAND WITH THIS ATHLETE? — one answer, derived once.
 *
 * Every add-friend surface used to answer this for itself, and all of them
 * answered "not friends" because that is what the absence of data looks like.
 * `AddFriendButton` showed `+ ADD` before a request, during a request, and
 * forever after one — its only other state was `…` while its own mutation was
 * in flight. Reopening Social reset it. So the athlete taps again, and the
 * unique (from_id, to_id) index refuses it silently.
 *
 * THE COST OF THAT WAS NOT COSMETIC. `calloutsAvailable()` gates the pledge
 * control on having an ACCEPTED friend. An athlete stuck believing their
 * request never sent never gets one, so the Golden Dot never appears in the
 * workout logger — reported separately as "the pledge feature is missing". It
 * was never missing. It was correctly hidden behind a friendship the Social
 * screen made look like it had never been asked for.
 *
 * Pure, so the five states can be tested without a network or a React tree.
 */

export type FriendState =
  /** No relationship. The only state in which `+ ADD` is honest. */
  | 'none'
  /** I asked them. Show PENDING and offer to withdraw — never `+ ADD`. */
  | 'pending_out'
  /** They asked me. Show ACCEPT / DECLINE, not `+ ADD`. */
  | 'pending_in'
  /** Accepted both ways. This is the state that unlocks trials. */
  | 'friends'
  /** Me. No surface should offer to befriend the athlete holding the phone. */
  | 'self';

export interface FriendLike {
  /** `my_friends()` projects the athlete under one of these. */
  id?: string;
  user_id?: string;
}
export interface SentLike {
  to_id: string;
}
export interface IncomingLike {
  from_id: string;
}

/**
 * ORDER MATTERS. `friends` is checked before either pending state because an
 * accepted friendship can leave a stale request row behind, and "we are
 * friends" is the stronger, later fact. `self` is first because none of the
 * other questions are meaningful about yourself.
 */
export function friendStateFor(input: {
  athleteId: string;
  meId: string | null;
  friends?: readonly FriendLike[];
  sent?: readonly SentLike[];
  incoming?: readonly IncomingLike[];
}): FriendState {
  const { athleteId, meId } = input;
  if (!athleteId) return 'none';
  if (meId && athleteId === meId) return 'self';
  if ((input.friends ?? []).some((f) => (f.id ?? f.user_id) === athleteId)) return 'friends';
  if ((input.sent ?? []).some((r) => r.to_id === athleteId)) return 'pending_out';
  if ((input.incoming ?? []).some((r) => r.from_id === athleteId)) return 'pending_in';
  return 'none';
}

/** The label a control shows for each state. Kept here so Discover, a public
 *  profile and the Challenges list cannot word the same state three ways. */
export const FRIEND_STATE_LABEL: Readonly<Record<FriendState, string>> = {
  none: '+ ADD',
  pending_out: 'PENDING',
  pending_in: 'RESPOND',
  friends: 'FRIENDS',
  self: 'YOU',
};

/** Can this athlete be sent a request right now? */
export function canRequest(state: FriendState): boolean {
  return state === 'none';
}

/**
 * §4's Challenges rule, as one function: what the challenge surface should
 * offer for a given relationship.
 *
 *   no friend        -> FIND A FRIEND
 *   request pending  -> WAITING FOR ACCEPTANCE
 *   accepted         -> START A TRIAL
 *
 * Returned as an ACTION and a label together, so a screen cannot render the
 * label without deciding what tapping it does — which is how a dead text label
 * that looks clickable gets shipped.
 */
export type ChallengeCta =
  | { action: 'find_friend'; label: 'FIND A FRIEND' }
  | { action: 'waiting'; label: 'WAITING FOR ACCEPTANCE' }
  | { action: 'respond'; label: 'RESPOND TO REQUEST' }
  | { action: 'start_trial'; label: 'START A TRIAL' };

export function challengeCtaFor(state: FriendState): ChallengeCta {
  switch (state) {
    case 'friends':
      return { action: 'start_trial', label: 'START A TRIAL' };
    case 'pending_out':
      return { action: 'waiting', label: 'WAITING FOR ACCEPTANCE' };
    case 'pending_in':
      return { action: 'respond', label: 'RESPOND TO REQUEST' };
    default:
      return { action: 'find_friend', label: 'FIND A FRIEND' };
  }
}

/** The Challenges page with no friends at all — the empty state's one action. */
export function challengeCtaForRoster(friendCount: number): ChallengeCta {
  return friendCount > 0
    ? { action: 'start_trial', label: 'START A TRIAL' }
    : { action: 'find_friend', label: 'FIND A FRIEND' };
}
