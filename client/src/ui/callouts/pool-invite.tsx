import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { useCoinTotal } from '@/data/coins';
import { usePoolInvitations, useJoinPool, type PoolInvitation } from '@/data/callout-pool';
import { useCalloutConfig } from '@/data/callouts';
import { DEFAULT_CALLOUT_CONFIG, clampCalloutStake } from '@/domain/callouts';
import { FORGE_CHIPS } from '@/domain/forge-duel';
import {
  needsIndependentVerifier,
  poolJoinable,
  poolReturnLine,
  poolShare,
  type PoolSide,
} from '@/domain/forge-pool';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { ChipWagerTable } from '@/ui/duel/chip-table';
import { NeonButton } from '@/ui/core/neon-button';

/**
 * "SARAH SAYS 85 × 8." — the only place a pool is ever offered to a friend.
 *
 * WHAT THIS IS NOT, AND THE ABSENCE IS THE DESIGN: there is no list of open pools,
 * no ranking by size, no "pools ending soon", and no way to reach this screen except
 * by having been personally asked. Migration 182 asserts no browsable equivalent
 * exists server-side. A scrollable feed of things to put coins on is what a betting
 * lobby looks like; this is an invitation from somebody you train with.
 *
 * IT RENDERS NOTHING WHEN NOBODY HAS ASKED. No empty state, no "get invited to
 * pools" teaser — that would be soliciting, which §3 and the physiotherapist test
 * both refuse. Same rule as the reveal chip.
 *
 * AND THE PERSON JOINING CANNOT AFFECT THE OUTCOME. That is the honest difference
 * between this and pledging on your own set, so the copy states both sides of every
 * position rather than quoting the upside.
 */

/** The two pans, as bars. Phase 6 replaces this with the physical scale. */
function Pans({
  back,
  push,
  athlete,
  mySide,
}: {
  back: number;
  push: number;
  athlete: string;
  mySide: PoolSide | null;
}) {
  const colors = useThemeColors();
  const { backPct, pushPct } = poolShare({ back, push });
  const row = (
    label: string,
    total: number,
    pct: number,
    tint: string,
    mine: boolean,
    testID: string
  ) => (
    <View className="mt-s2" testID={testID}>
      <View className="flex-row items-center justify-between">
        <Text
          allowFontScaling={false}
          className="text-2xs"
          style={{ color: mine ? tint : colors['text-dim'], letterSpacing: 1 }}
        >
          {label}
          {mine ? ' · YOURS' : ''}
        </Text>
        <Text allowFontScaling={false} className="text-2xs" style={{ color: tint, ...pixelFont() }}>
          {total}
        </Text>
      </View>
      {/* A weighed pan, not a progress bar: it shows how much metal is on each
          side, which is the only thing that decides the split. */}
      <View
        className="mt-s1 rounded-pill"
        style={{ height: 8, backgroundColor: 'rgba(13,21,36,0.9)', overflow: 'hidden' }}
      >
        <View style={{ width: `${pct}%`, height: 8, backgroundColor: tint }} />
      </View>
    </View>
  );
  return (
    <View testID="pool-pans">
      {row(`BACKING ${athlete.toUpperCase()}`, back, backPct, colors.success, mySide === 'back',
        'pool-pan-back')}
      {row('PUSHING BACK', push, pushPct, colors.danger, mySide === 'push', 'pool-pan-push')}
    </View>
  );
}

function InviteSheet({
  invite,
  onClose,
}: {
  invite: PoolInvitation;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const balanceQuery = useCoinTotal();
  const cfgQuery = useCalloutConfig();
  const join = useJoinPool();
  const cfg = cfgQuery.data ?? DEFAULT_CALLOUT_CONFIG;
  // NULL on any failure, never 0 — the coins doctrine. An unreadable wallet shows
  // no affordance rather than a wrong one.
  const balance = balanceQuery.data;

  const [side, setSide] = useState<PoolSide | null>(invite.my_side);
  const [stake, setStake] = useState(0);

  const totals = { back: invite.back_total, push: invite.push_total };
  const alreadyIn = invite.my_side !== null;
  const open = poolJoinable(invite.status);
  const max = Math.max(0, Math.min(balance ?? 0, cfg.max_stake));
  const canSend =
    open && !alreadyIn && side !== null && stake >= cfg.min_stake && stake <= max && !join.isPending;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: 'rgba(2,5,11,0.72)' }}
        onPress={onClose}
        accessibilityLabel="Close"
      >
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{
            borderColor: `${colors.accent}45`,
            backgroundColor: colors.surface,
            maxHeight: 620,
          }}
          testID="pool-invite-sheet"
        >
          {/* THE PROPOSITION, dominant and pinned. Their set, their number. */}
          <Text
            allowFontScaling={false}
            className="text-text-mute"
            numberOfLines={1}
            style={{ fontSize: 8, letterSpacing: 1.6 }}
          >
            {invite.athlete_name.toUpperCase()} · {invite.exercise.toUpperCase()}
          </Text>
          <Text
            allowFontScaling={false}
            testID="pool-invite-target"
            style={{ fontSize: 22, lineHeight: 26, color: colors.legendary, ...pixelFont() }}
          >
            {invite.target_label}
          </Text>
          <Text className="mt-s1 text-2xs text-text-mute">
            Set {invite.set_no}. It settles on the set they log — nothing you can do either way.
          </Text>

          <ScrollView showsVerticalScrollIndicator={false}>
            <View className="mt-s3">
              <Pans
                back={totals.back}
                push={totals.push}
                athlete={invite.athlete_name}
                mySide={invite.my_side}
              />
            </View>

            {needsIndependentVerifier(totals) ? (
              <Text className="mt-s3 text-2xs text-text-mute" testID="pool-verifier-note">
                This pool is big enough that somebody with nothing in it has to say whether the
                set counted.
              </Text>
            ) : null}

            {alreadyIn ? (
              <Text className="mt-s3 text-2xs" style={{ color: colors.accent }} testID="pool-my-position">
                You are {invite.my_side === 'back' ? 'backing' : 'pushing against'}{' '}
                {invite.athlete_name} for {invite.my_stake}. One position each.
              </Text>
            ) : !open ? (
              <Text className="mt-s3 text-2xs text-text-mute" testID="pool-closed">
                That set is already done — too late to take a side.
              </Text>
            ) : (
              <>
                <View className="mt-s3 flex-row" style={{ gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <NeonButton
                      title={`BACK ${invite.athlete_name.split(' ')[0].toUpperCase()}`}
                      variant={side === 'back' ? 'primary' : 'ghost'}
                      pixel
                      onPress={() => setSide('back')}
                      testID="pool-side-back"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <NeonButton
                      title="PUSH BACK"
                      variant={side === 'push' ? 'primary' : 'ghost'}
                      pixel
                      onPress={() => setSide('push')}
                      testID="pool-side-push"
                    />
                  </View>
                </View>

                {side ? (
                  <View className="mt-s3">
                    <ChipWagerTable
                      value={stake}
                      onChange={(v) => setStake(clampCalloutStake(v, balance ?? 0, cfg))}
                      balance={balance ?? 0}
                      min={cfg.min_stake}
                      max={max}
                      potLabel={side === 'back' ? 'BACKING THEM' : 'PUSHING BACK'}
                      potOf={(v) => v}
                      compact
                      tableHeight={132}
                      chipSize={46}
                      denominations={FORGE_CHIPS}
                      disabled={balance == null}
                      testID="pool-invite-table"
                    />
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>

          {/* BOTH OUTCOMES, PINNED OUTSIDE THE SCROLL.
              A screenshot caught this below the fold: the sheet showed the target,
              the pans, the rail and PLEDGE 25 while the one line explaining what
              happens if it goes the other way sat cut off inside the ScrollView.
              Terms an athlete has to scroll to find are not terms they were shown,
              and this person cannot influence the outcome — so it sits against the
              button, always visible, or it is not doing its job. */}
          {side && stake > 0 && !alreadyIn && open ? (
            <Text className="mt-s2 text-2xs text-text-dim" testID="pool-return-line">
              {poolReturnLine(stake, side, totals, invite.athlete_name)}
            </Text>
          ) : null}

          <View className="mt-s2">
            {alreadyIn || !open ? (
              <NeonButton title="DONE" pixel onPress={onClose} testID="pool-invite-done" />
            ) : (
              <>
                <NeonButton
                  title={
                    join.isPending
                      ? 'SENDING…'
                      : side === null
                        ? 'PICK A SIDE'
                        : stake > 0
                          ? `PLEDGE ${stake}`
                          : 'PICK AN INGOT'
                  }
                  size="hero"
                  pixel
                  disabled={!canSend}
                  busy={join.isPending}
                  onPress={() =>
                    side &&
                    join.mutate(
                      { calloutId: invite.callout_id, side, stake },
                      { onSuccess: onClose }
                    )
                  }
                  testID="pool-invite-join"
                />
                {/* Leaving is frictionless (§8): no sunk-cost copy, no confirmation. */}
                <Pressable onPress={onClose} className="mt-s2 items-center py-s2" testID="pool-invite-later">
                  <Text allowFontScaling={false} className="text-2xs text-text-mute">
                    Not this one
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The quiet Home chip. Renders nothing when nobody has asked. */
export function PoolInviteChip() {
  const colors = useThemeColors();
  const invites = usePoolInvitations();
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = invites.data ?? [];
  // Only the ones still worth acting on lead the chip; a settled position stays
  // reachable inside but is not something to be nudged about.
  const actionable = rows.filter((r) => poolJoinable(r.status) && r.my_side === null);
  const current = rows.find((r) => r.callout_id === openId) ?? null;

  if (rows.length === 0) return null;

  return (
    <>
      {actionable.length > 0 ? (
        <Pressable
          onPress={() => setOpenId(actionable[0].callout_id)}
          accessibilityRole="button"
          accessibilityLabel={`${actionable[0].athlete_name} asked you to take a side. Open.`}
          testID="home-pool-chip"
          className="mb-s3 flex-row items-center justify-between rounded-lg px-s3 py-s2"
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: 'rgba(13,21,36,0.6)',
          }}
        >
          <Text allowFontScaling={false} className="text-2xs text-text-dim" numberOfLines={1}>
            <Text style={{ color: colors.legendary }}>◆</Text>{' '}
            {actionable.length === 1
              ? `${actionable[0].athlete_name} called a set`
              : `${actionable.length} friends called a set`}
          </Text>
          <Text allowFontScaling={false} className="text-2xs text-text-mute">
            OPEN
          </Text>
        </Pressable>
      ) : null}
      {current ? (
        <InviteSheet key={current.callout_id} invite={current} onClose={() => setOpenId(null)} />
      ) : null}
    </>
  );
}
