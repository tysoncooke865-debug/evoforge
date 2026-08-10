import { useEffect } from 'react';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';

import { track } from '@/data/analytics';
import {
  useClaimForgeCache,
  useClaimRecoveryRun,
  useConfirmRestDay,
  useForgeCacheState,
  useRecoveryRunState,
} from '@/data/forge-cache';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';

/**
 * THE DAILY FORGE CACHE, ON HOME (Spec v5 §6).
 *
 * This card is why the cache and the Recovery Run now pay anything at all. Migration
 * 166 built both features complete — tiers, guards, RLS, idempotency — and nothing in
 * the app ever called them. Zero claims and zero recovery runs, ever, until this
 * shipped.
 *
 * ── WHAT IT DELIBERATELY IS NOT ──
 *
 * NOT A LOGIN REWARD. The brief asked for 15 coins on first open each day and for
 * every tier to be split into a login portion and a check-in portion. Tyson declined:
 * §6 says the cache is "tied to genuine training activity, NEVER app-opening", and
 * splitting the tiers would have moved 105 of every 430-coin cycle from "you trained"
 * to "you opened the app". So opening the app pays nothing, and this card is
 * INFORMATIONAL until the athlete does something the plan called for.
 *
 * NO URGENCY, ANYWHERE. §8 bans countdowns, expiry, manufactured scarcity and guilt.
 * There is no timer, nothing "expires tonight", and a missed day is stated as
 * PROGRESS SAVED rather than as a loss — because that is literally true: the ladder
 * has no time window and a three-week gap leaves it where it was.
 *
 * NO CHANCE. Every number comes from the server's tier table. Nothing here is
 * random, nothing is a multiplier, and this file imports nothing from the reveal or
 * the pledge paths.
 */
export function ForgeCacheCard({ testID = 'home-forge-cache' }: { testID?: string }) {
  const colors = useThemeColors();
  const cacheQuery = useForgeCacheState();
  const recoveryQuery = useRecoveryRunState();
  const claim = useClaimForgeCache();
  const confirmRest = useConfirmRestDay();
  const claimRecovery = useClaimRecoveryRun();

  const s = cacheQuery.data;
  const recovery = recoveryQuery.data;

  // One view event per mount, so "opened Home and saw the cache" is measurable
  // separately from claiming — the brief's "claim the reward and leave" metric.
  useEffect(() => {
    if (!s) return;
    track('daily_checkin_viewed', {
      rung: s.rung,
      claimable: s.claimable,
      today_is_rest: s.today_is_rest,
    });
  }, [s?.rung, s?.claimable, s?.today_is_rest, s]);

  // An unreadable state hides the card rather than inventing rung 0.
  if (!s) return null;

  const done = s.rung > 0 && !s.claimable;
  const weeklyBlocked = s.rung === 7 && !s.floor_met;
  const needsRest = s.today_is_rest && !s.today_rest_confirmed;

  /** The seven-position strip. Filled, open, or ahead — no countdown. */
  const strip = (
    <View className="mt-s2 flex-row" style={{ gap: 4 }} testID={`${testID}-strip`}>
      {[1, 2, 3, 4, 5, 6, 7].map((i) => {
        const filled = i < s.rung || (i === s.rung && done);
        const open = i === s.rung && s.claimable;
        return (
          <View
            key={i}
            style={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              backgroundColor: filled
                ? colors.legendary
                : open
                  ? `${colors.legendary}80`
                  : 'rgba(148,163,184,0.22)',
              // Day 7 reads as the week's end without a flourish.
              borderWidth: i === 7 ? 1 : 0,
              borderColor: i === 7 ? `${colors.legendary}66` : undefined,
            }}
          />
        );
      })}
    </View>
  );

  return (
    <View
      className="mb-s3 rounded-lg border p-s3"
      style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.6)' }}
      testID={testID}
    >
      <View className="flex-row items-start justify-between">
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            allowFontScaling={false}
            className="text-2xs"
            style={{ color: colors['text-dim'], letterSpacing: 1.4 }}
          >
            DAILY FORGE CACHE
          </Text>
          <Text
            allowFontScaling={false}
            testID={`${testID}-headline`}
            style={{ fontSize: 15, color: colors.legendary, ...pixelFont() }}
          >
            {s.rung === 0
              ? `DAY 1 · ${s.next_coins} COINS`
              : done
                ? `DAY ${s.rung} COMPLETE`
                : `DAY ${s.rung} · ${s.coins} COINS`}
          </Text>
        </View>
      </View>

      {strip}

      {/* WHAT TODAY IS. The plan's own words, so the card and Train agree. */}
      <Text className="mt-s2 text-2xs text-text-dim" testID={`${testID}-plan`}>
        {s.today_is_rest ? "TODAY'S PLAN: REST" : `TODAY'S PLAN: ${(s.today_plan ?? 'TRAINING').toUpperCase()}`}
      </Text>

      <Text className="mt-s1 text-2xs text-text-mute" testID={`${testID}-message`}>
        {weeklyBlocked
          ? `The weekly cache opens after ${s.training_floor} training days this cycle — you have ${s.trained_this_cycle}.`
          : done
            ? `Next: day ${Math.min(7, s.rung + 1)} · ${s.next_coins} coins.`
            : s.message}
      </Text>

      {/* A GAP IS NOT A LOSS, and the copy says so plainly rather than consoling.
          The ladder has no time window, so this is a statement of fact. */}
      {s.rung > 0 && s.adherent_this_cycle > 0 ? (
        <Text className="mt-s1 text-2xs text-text-mute" testID={`${testID}-saved`}>
          PROGRESS SAVED · rest days count · nothing expires
        </Text>
      ) : null}

      {/* ── THE ACTIONS ── */}
      <View className="mt-s3 flex-row" style={{ gap: 8 }}>
        {s.claimable && !weeklyBlocked ? (
          <View style={{ flex: 1 }}>
            <NeonButton
              title={claim.isPending ? 'CLAIMING…' : `CLAIM ${s.coins}`}
              pixel
              busy={claim.isPending}
              disabled={claim.isPending}
              onPress={() => claim.mutate()}
              testID={`${testID}-claim`}
            />
          </View>
        ) : null}

        {needsRest ? (
          <View style={{ flex: 1 }}>
            <NeonButton
              title={confirmRest.isPending ? 'CONFIRMING…' : 'CONFIRM REST DAY'}
              variant="ghost"
              pixel
              busy={confirmRest.isPending}
              disabled={confirmRest.isPending}
              onPress={() => confirmRest.mutate()}
              testID={`${testID}-rest`}
            />
          </View>
        ) : !s.today_is_rest ? (
          <View style={{ flex: 1 }}>
            {/* NEVER AUTO-LAUNCHES A WORKOUT. The athlete chooses to go. */}
            <Link href={'/train' as never} asChild>
              <NeonButton
                title="TODAY'S MISSION"
                variant="ghost"
                pixel
                onPress={() => track('daily_checkin_viewed', { via: 'mission' })}
                testID={`${testID}-mission`}
              />
            </Link>
          </View>
        ) : null}
      </View>

      {/* ── RECOVERY RUN. Its own block, because it is a floor and not a reward:
             below 5 coins, three legitimate sets pay a fixed 50 and nobody can be
             locked out of the economy. Only shown when it is actually armed. ── */}
      {recovery?.armed ? (
        <View
          className="mt-s3 rounded-md border p-s2"
          style={{ borderColor: `${colors.accent}59`, backgroundColor: 'rgba(34,211,238,0.07)' }}
          testID={`${testID}-recovery`}
        >
          <Text
            allowFontScaling={false}
            className="text-2xs"
            style={{ color: colors.accent, letterSpacing: 1 }}
          >
            RECOVERY RUN
          </Text>
          <Text className="mt-s1 text-2xs text-text-dim">{recovery.message}</Text>
          {recovery.eligible ? (
            <View className="mt-s2">
              <NeonButton
                title={claimRecovery.isPending ? 'CLAIMING…' : `CLAIM ${recovery.coins}`}
                pixel
                busy={claimRecovery.isPending}
                disabled={claimRecovery.isPending}
                onPress={() => claimRecovery.mutate()}
                testID={`${testID}-recovery-claim`}
              />
            </View>
          ) : (
            <Text className="mt-s1 text-2xs text-text-mute">
              {recovery.sets_done} of {recovery.sets_needed} sets logged.
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}
