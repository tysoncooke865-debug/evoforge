import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';

import { track } from '@/data/analytics';
import { useMyDropTier } from '@/data/forge-drop';
import { useDropSession } from '@/data/forge-drop-session';
import { columnsFor, formatMultiplier, type DropTier } from '@/domain/forge-drop';
import { celebrationFor, outcomeTier } from '@/domain/forge-drop-feel';
import {
  chipOffers,
  dropCapacity,
  laneFor,
  rackBlocker,
  type LaneChoice,
  type SessionDrop,
} from '@/domain/forge-drop-session';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { CoinIcon } from '@/ui/core/coin-icon';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { ChipRack } from '@/ui/forge-drop/chip-rack';
import { DropBoard, type BoardPuck } from '@/ui/forge-drop/drop-board';
import { PayoutTable, laneName } from '@/ui/forge-drop/payout-table';
import { DropResultCard, JackpotMoment } from '@/ui/forge-drop/result-card';
import { playDropOutcome, resetDropAudio } from '@/ui/forge-drop/drop-audio';

/**
 * FORGE DROP.
 *
 * Train → the Evo Rating rises → a stronger board unlocks → coins earned by
 * training are risked on it → winnings are spent in Customise or on a duel.
 *
 * THE SHAPE: the board never leaves the screen, and the chips live under it.
 * Pick one up, flick it at the board, and while it is still falling pick up
 * another. Results stack into a rail beside the board rather than covering it,
 * because a modal result would make a second chip impossible — and throwing the
 * second chip while the first is in the air is the entire point.
 *
 * THE RULES THIS SCREEN KEEPS:
 *
 *   1. NOTHING IS CELEBRATED BEFORE IT IS SETTLED. A puck only falls once the
 *      server has returned an authoritative result. There is no optimistic
 *      state anywhere in here.
 *   2. NOTHING IS SPOILED BEFORE IT LANDS. A falling chip has already settled
 *      and its payout is already in the ledger — so the balance deliberately
 *      reads as if it lost until the chip arrives. The number never announces
 *      the result the animation is on its way to deliver.
 *   3. THE ODDS ARE ON SCREEN BEFORE THE WAGER. Every slot, its payout at this
 *      stake, its exact chance from this lane — the same numbers the server
 *      settles by, and never hidden behind a disclosure.
 *   4. NO LOSS-CHASING. DROP AGAIN repeats the chip and lane already chosen and
 *      says nothing about winning anything back. No near misses, no "so close",
 *      no doubling prompts, and never an automatic second wager.
 */
export default function ForgeDropScreen() {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const { tier, rating, ready, missingRating } = useMyDropTier();
  const session = useDropSession(ready ? tier : null);
  // Destructured because `session` is a new object every render: a useCallback
  // depending on it is a useCallback that never holds. `play` and `reveal` are
  // stable; the data fields are not, and are read directly.
  const { play, reveal, drops, balance, summary, loading, recovered } = session;

  const capacity = dropCapacity(width);
  const [chip, setChip] = useState<number | null>(null);
  const [laneChoice, setLaneChoice] = useState<LaneChoice>('centre');
  const [preview, setPreview] = useState<LaneChoice | null>(null);
  const [announce, setAnnounce] = useState('');
  const [showOdds, setShowOdds] = useState(false);
  const [jackpot, setJackpot] = useState<{ multiplier: number; payout: number } | null>(null);
  // History is secondary on a phone: the loop is board -> chip -> result, and
  // a growing list between them pushes the rack under the fold.
  const [showHistory, setShowHistory] = useState(false);

  const lane = laneFor(laneChoice, tier);
  const offers = chipOffers(tier, balance, capacity);
  const blocker = rackBlocker(tier, balance, capacity);

  // The selected chip survives every drop, so DROP AGAIN is a repeat and not a
  // re-decision. It moves only when the athlete moves it, or when the board
  // stops allowing it.
  const selected = useMemo(() => {
    if (chip !== null && offers.some((o) => o.value === chip && o.enabled)) return chip;
    return offers.find((o) => o.enabled)?.value ?? null;
  }, [chip, offers]);

  useEffect(() => {
    track('forge_drop_opened', {});
    return resetDropAudio;
  }, []);
  const seenTier = useRef<number | null>(null);
  useEffect(() => {
    if (!ready || seenTier.current === tier.tier) return;
    seenTier.current = tier.tier;
    track('forge_drop_tier_viewed', { tier: tier.tier, rating: rating ?? null });
  }, [ready, tier.tier, rating]);

  /**
   * A drop recovered from a previous session is announced, never re-animated:
   * the athlete was not watching, and replaying it as a fall would be theatre.
   *
   * Derived rather than pushed into state by an effect — the recovery is a fact
   * about the data, so it is read from the data. An effect would only be a
   * slower way to say the same thing, one render later.
   */
  const recoveryNote = useMemo(() => {
    if (recovered.length === 0) return '';
    const n = recovered.length;
    const total = recovered.reduce((sum, d) => sum + (d.net ?? 0), 0);
    return (
      `${n} drop${n === 1 ? '' : 's'} settled while you were away, ` +
      `${total >= 0 ? `up ${total}` : `down ${Math.abs(total)}`} coins in total.`
    );
  }, [recovered]);

  // Plain function: the compiler memoises this better than a hand-written
  // useCallback, which it has to skip because the closure it would preserve is
  // not the one the deps describe.
  const throwChip = async (value: number, choice: LaneChoice) => {
    setLaneChoice(choice);
    setChip(value);
    await play(value, choice);
  };

  /**
   * THE FALLING CHIPS — and the ones that refuse to fall.
   *
   * `columnsFor` returns null when the server's path and the slot it actually
   * PAID disagree. That should never happen, and if it ever does the ledger
   * wins: there is no honest animation of a route that did not end where the
   * money did, so the chip does not fall at all and its result is revealed
   * straight away. Animating it would be inventing a journey to justify a
   * number.
   */
  const pucks = useMemo(() => {
    const out: BoardPuck[] = [];
    for (const d of drops) {
      if (d.phase !== 'falling' || !d.path) continue;
      const columns = columnsFor({ lane: d.lane, path: d.path, slot: d.slot ?? -1 }, tier.rows);
      // A drop whose path disagrees with its paid slot never reaches `falling`
      // — the session hook reveals it outright — so this is belt and braces
      // rather than a branch anybody expects to take.
      if (columns) out.push({ key: d.key, stake: d.stake, columns });
    }
    return out;
  }, [drops, tier.rows]);

  const landed = drops.filter((d) => d.phase === 'revealed');
  const highlights = landed.slice(-capacity).map((d) => d.slot ?? 0);
  const rail = [...drops].reverse().filter((d) => d.phase !== 'pending').slice(0, 6);

  // Deliberately not memoised: it closes over `drops` and the live balance,
  // both of which change on every render that matters, so a useCallback here
  // would rebuild every time anyway while pretending not to.
  const onSettled = (key: string) => {
    const d = drops.find((x) => x.key === key);
    reveal(key);
    if (!d) return;
    setAnnounce(describe(d, tier, balance.available));
    // Graded from the ledger, once, here — so the sound, the card and the
    // ceiling moment can never disagree about how big this was.
    const grade = outcomeTier(d.stake, d.payout ?? 0, d.multiplier ?? 1, tier);
    playDropOutcome(grade);
    if (celebrationFor(grade).dim) {
      setJackpot({ multiplier: d.multiplier ?? 1, payout: d.payout ?? 0 });
    }
  };

  // The most recent chip the athlete has actually been shown. The hero card is
  // about THAT drop, not about whatever is still in the air.
  const latest = [...drops].reverse().find((d) => d.phase === 'revealed') ?? null;

  const canDrop = selected !== null && !blocker;

  return (
    <ScreenShell>
      <ScreenHeader
        kicker="WAGER YOUR TRAINING"
        title="FORGE DROP"
        onBack={() => {
          track('forge_drop_exited', { tier: tier.tier, drops: summary.drops });
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
              {loading ? '—' : balance.available}
            </Text>
          </View>
        }
      />

      {/* THE AUTHORITATIVE RESULT, ANNOUNCED. Assertive because it answers
          something the athlete just did, and it carries the balance change — a
          screen reader should never have to hunt for what happened. */}
      <View
        accessibilityLiveRegion="assertive"
        accessibilityRole="alert"
        testID="drop-live-region"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 }}
      >
        <Text>{announce || recoveryNote}</Text>
      </View>

      <GlowCard>
        <View className="flex-row items-center justify-between">
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text allowFontScaling={false} className="text-text-mute" style={{ fontSize: 8, letterSpacing: 1.6 }}>
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
            lane={lane}
            previewLane={preview ? laneFor(preview, tier) : null}
            charged={selected !== null}
            pucks={pucks}
            highlights={highlights}
            onSettled={onSettled}
          />
        </View>

        {/* THE WALLET, WHILE CHIPS ARE FALLING. Three numbers, because one is a
            lie while anything is in the air: what is spendable now, what is
            committed, and what it becomes when everything lands. */}
        <View className="mt-s3 flex-row items-center justify-between" testID="drop-wallet">
          <Stat label="BALANCE" value={loading ? '—' : String(balance.available)} tone={colors.legendary} />
          <Stat
            label="IN PLAY"
            value={String(balance.reserved)}
            tone={balance.reserved > 0 ? colors.accent : colors['text-mute']}
            testID="drop-in-play"
          />
          <Stat
            label="WHEN THEY LAND"
            value={String(balance.projected)}
            tone={colors['text-dim']}
            testID="drop-projected"
          />
          <Stat
            label="FALLING"
            value={`${balance.activeCount}/${capacity}`}
            tone={balance.activeCount >= capacity ? colors.danger : colors['text-mute']}
            testID="drop-active-count"
          />
        </View>
      </GlowCard>

      {/* ── THE RACK ── */}
      <GlowCard>
        <ChipRack
          offers={offers}
          selected={selected}
          onSelect={setChip}
          onThrow={(v, c) => void throwChip(v, c)}
          onPreview={setPreview}
          blocker={blocker}
          laneLabel={`INTO ${laneName(lane, tier)}`}
        />

        {/* THE KEYBOARD AND SCREEN-READER PATH. Everything the flick can do,
            as ordinary buttons — a gesture cannot be tabbed to, described, or
            performed one-handed on a bus. */}
        <Text allowFontScaling={false} className="mt-s3 text-text-mute" style={{ fontSize: 8, letterSpacing: 1.6 }}>
          DROP FROM
        </Text>
        <View className="mt-s1 flex-row" style={{ gap: 8 }}>
          {(['left', 'centre', 'right'] as const).map((c) => {
            const on = c === laneChoice;
            return (
              <Pressable
                key={c}
                onPress={() => setLaneChoice(c)}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Drop from the ${c} lane`}
                testID={`drop-lane-${laneFor(c, tier)}`}
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
                  {on ? '● ' : ''}{c.toUpperCase()}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View className="mt-s3">
          <NeonButton
            title={
              loading
                ? 'READING YOUR COINS…'
                : blocker
                  ? 'NO CHIPS AVAILABLE'
                  : `DROP ${selected} FROM ${laneName(lane, tier)}`
            }
            size="hero"
            pixel
            disabled={!canDrop}
            onPress={() => { if (selected !== null) void throwChip(selected, laneChoice); }}
            testID="drop-play"
          />
        </View>


        {balance.available < tier.min_stake && balance.activeCount === 0 ? (
          <View className="mt-s2" testID="drop-cannot-afford">
            <Text className="text-2xs text-text-mute">
              You need at least {tier.min_stake} {tier.min_stake === 1 ? 'coin' : 'coins'} to drop.
              Coins come from training — a workout, a personal record, a streak.
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
        ) : null}
      </GlowCard>

      {/* ── THE RESULT. One hero card for the drop just shown, then the
             session behind a toggle. The old version led with a rail of
             equal-weight rows and made the athlete work out which line was
             the answer to what they had just done. ── */}
      {latest ? (
        <DropResultCard
          drop={latest}
          tier={tier}
          balance={balance.available}
          canAgain={canDrop}
          onAgain={() => { if (selected !== null) void throwChip(selected, laneChoice); }}
        />
      ) : null}

      {rail.length > 0 ? (
        <GlowCard>
          <Pressable
            onPress={() => setShowHistory((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showHistory }}
            accessibilityLabel={showHistory ? 'Hide this session' : 'Show every drop this session'}
            testID="drop-history-toggle"
            className="flex-row items-center justify-between"
            style={{ minHeight: 40 }}
          >
            <Text allowFontScaling={false} className="text-2xs font-bold" style={{ color: colors.accent }}>
              {showHistory ? '▾ THIS SESSION' : '▸ THIS SESSION'}
            </Text>
            <Text allowFontScaling={false} className="text-2xs text-text-mute" testID="drop-session-summary">
              {summary.drops} drops · staked {summary.staked} · back {summary.returned} ·{' '}
              <Text style={{ color: summary.net > 0 ? colors.legendary : colors['text-dim'] }}>
                {summary.net > 0 ? `+${summary.net}` : summary.net}
              </Text>
            </Text>
          </Pressable>
          {showHistory ? (
            <View className="mt-s1" testID="drop-result-rail">
              {rail.map((d) => (
                <RailRow key={d.key} drop={d} tier={tier} />
              ))}
            </View>
          ) : null}
        </GlowCard>
      ) : null}

      {/* ── THE ODDS. Behind a toggle to keep the board and rack above the
             fold, but never hidden: the summary line below is always visible,
             and the toggle is a real button that says what it opens. ── */}
      <GlowCard>
        <Pressable
          onPress={() => setShowOdds((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded: showOdds }}
          accessibilityLabel={showOdds ? 'Hide the payout table' : 'View the full payout table and odds'}
          testID="drop-view-odds"
          className="flex-row items-center justify-between"
          style={{ minHeight: 44 }}
        >
          <Text allowFontScaling={false} className="text-2xs font-bold" style={{ color: colors.accent }}>
            {showOdds ? '▾ HIDE ODDS' : '▸ VIEW ODDS'}
          </Text>
          <Text allowFontScaling={false} className="text-2xs text-text-mute">
            {tier.label} · {laneName(lane, tier)}
          </Text>
        </Pressable>
        {showOdds ? (
          <View className="mt-s2">
            <PayoutTable tier={tier} lane={lane} stake={Math.max(tier.min_stake, selected ?? tier.min_stake)} />
          </View>
        ) : (
          <Text className="mt-s1 text-2xs text-text-mute">
            Every board returns less than it takes. Forge Coins are earned by training and cannot be
            bought, sold or cashed out.
          </Text>
        )}
      </GlowCard>
      {jackpot ? (
        <JackpotMoment
          multiplier={jackpot.multiplier}
          payout={jackpot.payout}
          onDone={() => setJackpot(null)}
        />
      ) : null}
    </ScreenShell>
  );
}

function Stat({
  label, value, tone, testID,
}: { label: string; value: string; tone: string; testID?: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }} testID={testID}>
      <Text allowFontScaling={false} className="text-text-mute" style={{ fontSize: 7, letterSpacing: 1 }}>
        {label}
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={{ fontSize: 14, color: tone, ...pixelFont() }}>
        {value}
      </Text>
    </View>
  );
}

/** One line of the rail. A falling chip says so and shows NOTHING about its
 *  result — it has settled, but the athlete has not seen it, and the rail must
 *  not be the thing that tells them before the puck does. */
function RailRow({ drop, tier }: { drop: SessionDrop; tier: DropTier }) {
  const colors = useThemeColors();
  const falling = drop.phase === 'falling';
  const failed = drop.phase === 'failed';
  const net = drop.net ?? 0;

  return (
    <View
      testID={`drop-rail-${drop.key}`}
      className="flex-row items-center justify-between py-[3px]"
      accessibilityRole="text"
      accessibilityLabel={
        failed
          ? `${drop.stake} coin drop refused: ${drop.error ?? 'not played'}`
          : falling
            ? `${drop.stake} coin chip still falling into the ${laneName(drop.lane, tier)} lane`
            : `${drop.stake} coins on ${formatMultiplier(drop.multiplier ?? 1)}, ` +
              `${net > 0 ? `up ${net}` : net === 0 ? 'even' : `down ${Math.abs(net)}`}`
      }
    >
      <Text allowFontScaling={false} className="text-2xs" style={{ color: colors['text-mute'], width: 58 }}>
        {drop.stake} · {laneName(drop.lane, tier).slice(0, 1)}
      </Text>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        className="text-2xs"
        style={{ flex: 1, color: failed ? colors.danger : colors['text-dim'] }}
      >
        {failed ? drop.error : falling ? 'falling…' : formatMultiplier(drop.multiplier ?? 1)}
      </Text>
      <Text
        allowFontScaling={false}
        style={{
          fontSize: 12,
          color: failed || falling ? colors['text-mute'] : net > 0 ? colors.legendary : colors['text-dim'],
          ...pixelFont(),
        }}
      >
        {failed ? '—' : falling ? '···' : net > 0 ? `+${net}` : String(net)}
      </Text>
    </View>
  );
}

/** What the live region says. The authoritative numbers, in a sentence. */
function describe(d: SessionDrop, tier: DropTier, balance: number): string {
  const net = d.net ?? 0;
  const outcome = net > 0 ? `won ${net}` : net === 0 ? 'broke even' : `lost ${Math.abs(net)}`;
  return (
    `Landed on ${formatMultiplier(d.multiplier ?? 1)} in the ${laneName(d.lane, tier)} lane. ` +
    `Staked ${d.stake}, paid ${d.payout ?? 0}, ${outcome} coins. Balance ${balance}.`
  );
}
