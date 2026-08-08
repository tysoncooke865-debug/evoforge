import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { track } from '@/data/analytics';
import { useCoinTotal } from '@/data/coins';
import { beginDrop, useMyDropTier, usePlayDrop, useRecoverDrop } from '@/data/forge-drop';
import {
  canAfford,
  clampStake,
  columnsFor,
  formatMultiplier,
  quickStakes,
  type DropResult,
} from '@/domain/forge-drop';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { DropBoard } from '@/ui/forge-drop/drop-board';
import { PayoutTable, laneName } from '@/ui/forge-drop/payout-table';

/**
 * FORGE DROP.
 *
 * Train → the Evo Rating rises → a stronger board unlocks → coins earned by
 * training are risked on it → winnings are spent in Customise or on a duel.
 *
 * THE THREE RULES THIS SCREEN KEEPS:
 *
 *   1. NOTHING IS CELEBRATED BEFORE IT IS SETTLED. The puck only falls once the
 *      server has returned an authoritative result, and the balance only moves
 *      when the server's own `coin_total()` says so. There is no optimistic
 *      state anywhere in here.
 *   2. THE ODDS ARE ON SCREEN BEFORE THE WAGER. Every slot, its payout at this
 *      stake, and its exact chance from this lane — the same numbers the server
 *      settles by.
 *   3. NO LOSS-CHASING. "Drop again" appears when it can be afforded and says
 *      nothing about winning anything back; when it cannot, the only way on is
 *      back to the Forge. No near misses, no "so close", no doubling prompts.
 */
export default function ForgeDropScreen() {
  const colors = useThemeColors();
  const coins = useCoinTotal();
  const { tier, rating, ready, missingRating } = useMyDropTier();
  const play = usePlayDrop();
  const recover = useRecoverDrop();

  // NULL ON ANY FAILURE, NEVER 0 (the coins doctrine): an unreadable wallet
  // must not read as an empty one, and must not offer a wager either.
  const balance = coins.data;
  const [lane, setLane] = useState<number | null>(null);
  const [stake, setStake] = useState<number | null>(null);
  const [result, setResult] = useState<DropResult | null>(null);
  const [falling, setFalling] = useState(false);
  const [announce, setAnnounce] = useState('');

  const chosenLane = lane ?? tier.lanes[Math.floor(tier.lanes.length / 2)];
  const chosenStake = stake ?? Math.min(tier.min_stake, Math.max(0, Math.floor(balance ?? 0)));
  const affordable = balance != null && canAfford(tier, balance);
  const quick = balance == null ? [] : quickStakes(tier, balance);

  useEffect(() => {
    track('forge_drop_viewed', {});
  }, []);
  const seenTier = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || seenTier.current === tier.tier) return;
    seenTier.current = tier.tier;
    track('forge_drop_tier_viewed', { tier: tier.tier, rating: rating ?? null });
  }, [ready, tier.tier, rating]);

  /**
   * DID A WAGER SURVIVE THE LAST SESSION?
   *
   * On mount, ask about any key left on disk. A refresh mid-animation, a killed
   * tab or a dead tunnel all land here: the drop is retrieved by ID, never
   * replayed as a new wager.
   */
  useEffect(() => {
    let live = true;
    void recover().then((r) => {
      if (!live || !r) return;
      setResult(r);
      setLane(r.lane);
      setStake(r.stake);
      setAnnounce(describe(r));
    });
    return () => { live = false; };
  }, [recover]);

  const drop = async () => {
    if (!affordable || play.isPending || falling) return;
    const s = clampStake(chosenStake, tier, balance ?? 0);
    track('forge_drop_started', { tier: tier.tier, lane: chosenLane, stake: s });
    // The key is minted and written to disk BEFORE the request, so a settlement
    // this client never hears about is still something it can ask after.
    const key = await beginDrop();
    setResult(null);
    setAnnounce('');
    play.mutate(
      { stake: s, lane: chosenLane, key },
      {
        onSuccess: (r) => {
          setResult(r);
          // The fall begins only now — there is nothing to animate until the
          // server has said what happened.
          setFalling(true);
        },
      }
    );
  };

  const settledColumns = result ? columnsFor(result, tier.rows) : null;
  const showResult = result !== null && !falling;

  return (
    <ScreenShell>
      <ScreenHeader
        kicker="WAGER YOUR TRAINING"
        title="FORGE DROP"
        onBack={() => {
          track('forge_drop_exited', { tier: tier.tier });
          router.replace('/coins' as never);
        }}
        right={
          <View className="flex-row items-center" style={{ gap: 6 }}>
            <CoinIcon size={16} />
            <Text
              allowFontScaling={false}
              testID="drop-balance"
              style={{ fontSize: 15, color: colors.legendary, ...pixelFont() }}
            >
              {balance == null ? '—' : balance}
            </Text>
          </View>
        }
      />

      {/* THE AUTHORITATIVE RESULT, ANNOUNCED. Assertive because it is the answer
          to something the athlete just did, and it carries the balance change —
          a screen reader should never have to hunt for what happened. */}
      <View
        accessibilityLiveRegion="assertive"
        accessibilityRole="alert"
        testID="drop-live-region"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }}
      >
        <Text>{announce}</Text>
      </View>

      <GlowCard>
        <View className="flex-row items-center justify-between">
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              allowFontScaling={false}
              className="text-text-mute"
              style={{ fontSize: 8, letterSpacing: 1.6 }}
            >
              EVO {rating ?? '—'} · TIER {tier.tier}
            </Text>
            <Text
              allowFontScaling={false}
              testID="drop-tier-label"
              style={{ fontSize: 18, color: colors.legendary, ...pixelFont() }}
            >
              {tier.label}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text allowFontScaling={false} className="text-text-mute" style={{ fontSize: 8, letterSpacing: 1.2 }}>
              MAX STAKE
            </Text>
            <Text allowFontScaling={false} className="text-2xs font-bold text-text-dim">
              {tier.max_stake} · UP TO {tier.max_payout}
            </Text>
          </View>
        </View>

        {missingRating ? (
          <Text className="mt-s1 text-2xs text-text-mute" testID="drop-no-rating">
            No Evo review yet, so this is the starting board. Train and it will be reviewed — the
            board changes with your rating, never with anything you do here.
          </Text>
        ) : null}

        <View className="mt-s3">
          <DropBoard
            tier={tier}
            lane={chosenLane}
            columns={falling ? settledColumns : null}
            slotHighlight={showResult && result ? result.slot : null}
            onSettled={() => {
              setFalling(false);
              if (result) setAnnounce(describe(result));
            }}
          />
        </View>

        {/* ── THE RESULT, only ever after settlement ── */}
        {showResult && result ? (
          <View
            className="mt-s3 rounded-lg border p-s3"
            style={{
              borderColor: result.net > 0 ? `${colors.legendary}66` : colors.border,
              backgroundColor: 'rgba(13,21,36,0.6)',
            }}
            testID="drop-result"
          >
            <View className="flex-row items-center justify-between">
              <Text
                allowFontScaling={false}
                testID="drop-result-headline"
                style={{ fontSize: 16, color: result.net > 0 ? colors.legendary : colors['text-dim'], ...pixelFont() }}
              >
                {formatMultiplier(result.multiplier)} · {result.payout} BACK
              </Text>
              <Text
                allowFontScaling={false}
                testID="drop-result-net"
                style={{ fontSize: 16, color: result.net > 0 ? colors.legendary : colors.danger, ...pixelFont() }}
              >
                {result.net > 0 ? `+${result.net}` : result.net}
              </Text>
            </View>
            <Text className="mt-s1 text-2xs text-text-mute">
              Staked {result.stake} · {tier.label} · balance {result.balance}
            </Text>
            <View className="mt-s2">
              {canAfford(tier, result.balance) ? (
                <NeonButton
                  title="DROP AGAIN"
                  size="base"
                  pixel
                  onPress={() => {
                    setResult(null);
                    setAnnounce('');
                  }}
                  testID="drop-again"
                />
              ) : (
                <NeonButton
                  title="RETURN TO FORGE"
                  variant="ghost"
                  onPress={() => router.replace('/avatar' as never)}
                  testID="drop-return-forge"
                />
              )}
            </View>
          </View>
        ) : null}
      </GlowCard>

      {/* ── THE WAGER ── */}
      {!showResult ? (
        <GlowCard>
          <Text allowFontScaling={false} className="text-text-mute" style={{ fontSize: 8, letterSpacing: 1.6 }}>
            DROP FROM
          </Text>
          <View className="mt-s1 flex-row" style={{ gap: 8 }}>
            {tier.lanes.map((l) => {
              const on = l === chosenLane;
              return (
                <Pressable
                  key={l}
                  onPress={() => setLane(l)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, disabled: falling }}
                  accessibilityLabel={`Drop from the ${laneName(l, tier).toLowerCase()} lane`}
                  disabled={falling || play.isPending}
                  testID={`drop-lane-${l}`}
                  className="flex-1 items-center justify-center rounded-lg border"
                  style={{
                    minHeight: 44,
                    borderColor: on ? colors.accent : colors.border,
                    backgroundColor: on ? 'rgba(34,211,238,0.12)' : 'transparent',
                  }}
                >
                  <Text
                    allowFontScaling={false}
                    className="text-2xs font-bold"
                    style={{ color: on ? colors.accent : colors['text-dim'] }}
                  >
                    {/* Not colour alone: the chosen lane is marked. */}
                    {on ? '● ' : ''}{laneName(l, tier)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text
            allowFontScaling={false}
            className="mt-s3 text-text-mute"
            style={{ fontSize: 8, letterSpacing: 1.6 }}
          >
            STAKE
          </Text>
          <View className="mt-s1 flex-row flex-wrap" style={{ gap: 8 }}>
            {quick.map((s, i) => {
              const on = s === chosenStake;
              const label = i === 0 ? 'MIN' : i === quick.length - 1 ? 'MAX' : 'HALF';
              return (
                <Pressable
                  key={s}
                  onPress={() => setStake(s)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`Stake ${s} coins, the ${label.toLowerCase()} for this board`}
                  disabled={falling || play.isPending}
                  testID={`drop-stake-${s}`}
                  className="flex-1 items-center justify-center rounded-lg border px-s3"
                  style={{
                    minHeight: 48,
                    minWidth: 76,
                    borderColor: on ? colors.legendary : colors.border,
                    backgroundColor: on ? 'rgba(251,191,36,0.1)' : 'transparent',
                  }}
                >
                  <Text
                    allowFontScaling={false}
                    style={{ fontSize: 15, color: on ? colors.legendary : colors['text-dim'], ...pixelFont() }}
                  >
                    {on ? '● ' : ''}{s}
                  </Text>
                  <Text allowFontScaling={false} className="text-text-mute" style={{ fontSize: 8, letterSpacing: 1 }}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View className="mt-s3">
            <PayoutTable tier={tier} lane={chosenLane} stake={Math.max(1, chosenStake)} />
          </View>

          <View className="mt-s3">
            {balance == null ? (
              <Text className="text-2xs text-text-mute" testID="drop-balance-unknown">
                We could not read your coins just now. Nothing has been staked — pull to refresh and
                try again.
              </Text>
            ) : !affordable ? (
              <View testID="drop-cannot-afford">
                <Text className="text-2xs text-text-mute">
                  You need at least {tier.min_stake} {tier.min_stake === 1 ? 'coin' : 'coins'} to
                  drop. Coins come from training — a workout, a personal record, a streak.
                </Text>
                <View className="mt-s2">
                  <NeonButton
                    title="BACK TO TRAINING"
                    variant="ghost"
                    onPress={() => router.replace('/today' as never)}
                    testID="drop-go-train"
                  />
                </View>
              </View>
            ) : (
              <NeonButton
                title={
                  play.isPending ? 'DROPPING…' : falling ? 'FALLING…' : `DROP ${chosenStake}`
                }
                size="hero"
                pixel
                busy={play.isPending}
                disabled={play.isPending || falling || chosenStake < tier.min_stake}
                onPress={() => void drop()}
                testID="drop-play"
              />
            )}
          </View>
        </GlowCard>
      ) : null}
    </ScreenShell>
  );
}

/** What the live region says. The authoritative numbers, in a sentence. */
function describe(r: DropResult): string {
  const outcome = r.net > 0 ? `won ${r.net}` : r.net === 0 ? 'broke even' : `lost ${Math.abs(r.net)}`;
  return (
    `Landed on ${formatMultiplier(r.multiplier)}. Staked ${r.stake}, paid ${r.payout}, ` +
    `${outcome} coins. Balance ${r.balance}.`
  );
}
