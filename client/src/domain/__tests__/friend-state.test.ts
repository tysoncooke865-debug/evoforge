import { describe, expect, it } from 'vitest';

import {
  canRequest,
  challengeCtaFor,
  challengeCtaForRoster,
  friendStateFor,
  FRIEND_STATE_LABEL,
} from '../friend-state';

/**
 * §5 — THE STATE THE BUTTON NEVER HAD.
 *
 * `AddFriendButton` showed `+ ADD` before a request, during one, and forever
 * after — its only other state was `…` while its own mutation was in flight.
 * Nothing in the app remembered an outgoing request, because nothing had ever
 * returned one (`my_friend_requests()` is the INCOMING side; migration 199
 * adds the other half).
 *
 * The cost was not cosmetic: `calloutsAvailable()` gates the pledge control on
 * an ACCEPTED friend, so an athlete stuck at `+ ADD` never got one and never
 * saw the Golden Dot in the workout logger.
 */

const ME = 'me-uuid';
const THEM = 'them-uuid';

describe('friendStateFor', () => {
  it('is `none` with no relationship — the only state where + ADD is honest', () => {
    expect(friendStateFor({ athleteId: THEM, meId: ME })).toBe('none');
    expect(canRequest('none')).toBe(true);
  });

  it('is `pending_out` once I have asked — NEVER + ADD again', () => {
    const s = friendStateFor({ athleteId: THEM, meId: ME, sent: [{ to_id: THEM }] });
    expect(s).toBe('pending_out');
    expect(FRIEND_STATE_LABEL[s]).toBe('PENDING');
    // The bug in one assertion: this must not be re-requestable.
    expect(canRequest(s)).toBe(false);
  });

  it('is `pending_in` when they asked me', () => {
    expect(friendStateFor({ athleteId: THEM, meId: ME, incoming: [{ from_id: THEM }] })).toBe('pending_in');
  });

  it('is `friends` once accepted, under either projection of the row', () => {
    expect(friendStateFor({ athleteId: THEM, meId: ME, friends: [{ id: THEM }] })).toBe('friends');
    expect(friendStateFor({ athleteId: THEM, meId: ME, friends: [{ user_id: THEM }] })).toBe('friends');
  });

  it('FRIENDS outranks a stale request row left behind by acceptance', () => {
    // Accepting can leave the request row in place; "we are friends" is the
    // later and stronger fact, so order of checks is load-bearing.
    expect(
      friendStateFor({ athleteId: THEM, meId: ME, friends: [{ id: THEM }], sent: [{ to_id: THEM }] })
    ).toBe('friends');
  });

  it('never offers to befriend the athlete holding the phone', () => {
    expect(friendStateFor({ athleteId: ME, meId: ME })).toBe('self');
  });

  it('does not confuse one athlete with another', () => {
    const s = friendStateFor({
      athleteId: THEM,
      meId: ME,
      sent: [{ to_id: 'someone-else' }],
      friends: [{ id: 'a-third-person' }],
    });
    expect(s).toBe('none');
  });
});

describe('§4 — the Challenges page must never show a dead label', () => {
  it('offers a real action for every state', () => {
    expect(challengeCtaFor('none')).toEqual({ action: 'find_friend', label: 'FIND A FRIEND' });
    expect(challengeCtaFor('pending_out')).toEqual({
      action: 'waiting',
      label: 'WAITING FOR ACCEPTANCE',
    });
    expect(challengeCtaFor('pending_in')).toEqual({ action: 'respond', label: 'RESPOND TO REQUEST' });
    expect(challengeCtaFor('friends')).toEqual({ action: 'start_trial', label: 'START A TRIAL' });
  });

  it('a trial is offered ONLY after acceptance', () => {
    for (const s of ['none', 'pending_out', 'pending_in', 'self'] as const) {
      expect(challengeCtaFor(s).action, s).not.toBe('start_trial');
    }
    expect(challengeCtaFor('friends').action).toBe('start_trial');
  });

  it('an empty roster asks for a friend, not for a trial', () => {
    expect(challengeCtaForRoster(0).action).toBe('find_friend');
    expect(challengeCtaForRoster(2).action).toBe('start_trial');
  });

  it('every CTA carries an action — a label alone is how a dead control ships', () => {
    for (const s of ['none', 'pending_out', 'pending_in', 'friends', 'self'] as const) {
      const cta = challengeCtaFor(s);
      expect(cta.action).toBeTruthy();
      expect(cta.label.length).toBeGreaterThan(3);
    }
  });
});

describe('the approved vocabulary', () => {
  it('uses none of the banned words', () => {
    const banned = /casino|gambl|wager|\bbet\b|odds|jackpot|payout|spin|roll|cash out|all-in|near miss/i;
    const strings = [
      ...Object.values(FRIEND_STATE_LABEL),
      ...(['none', 'pending_out', 'pending_in', 'friends', 'self'] as const).map(
        (s) => challengeCtaFor(s).label
      ),
    ];
    for (const s of strings) expect(banned.test(s), s).toBe(false);
  });
});
