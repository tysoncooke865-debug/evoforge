/**
 * REFORGE DAY — the 28-day ceremony (docs/ONBOARDING_V3_SPEC.md §7).
 *
 * Review the cycle · offer physique calibration · recalculate · reveal the
 * movement · give the next priorities.
 *
 * THE RULE THIS SCREEN EXISTS TO KEEP: **it completes without photos.** The
 * reveal is never held behind an upload, the physique offer sits below the
 * dominant action rather than in front of it, and an athlete who has turned
 * photo prompts off never sees the offer at all — their Reforge is simply a
 * training review, which is a whole ceremony on its own.
 *
 * Every number here is read from rows the athlete already produced. The
 * rating movement is measured against the snapshot at the start of the
 * cycle; when there is no such snapshot the card says so instead of
 * inventing a delta.
 */

import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { track } from '@/data/analytics';
import { useCardioLog, useWorkoutLog } from '@/data/hooks';
import { usePhotoPrefs } from '@/data/photo-prefs';
import { useCalibration } from '@/data/progression/use-calibration';
import { useCompleteReforge, useReforgeDay } from '@/data/progression/use-reforge-day';
import { useEvoRatingCurrent, useEvoSnapshots, useRunEvoReview } from '@/data/progression/use-evo-rating';
import { periodTotals } from '@/domain/progress-aggregates';
import { reforgeOutcomeCopy, REFORGE_CYCLE_DAYS } from '@/domain/progression/reforge-day';
import { recentPr } from '@/domain/recent-pr';
import { todayIso as calendarToday } from '@/domain/today';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { CalibrationCard } from '@/ui/progression/calibration-card';

export default function ReforgeDayScreen() {
  const colors = useThemeColors();
  const { cadence, ready, anchorIso } = useReforgeDay();
  const workouts = useWorkoutLog();
  const cardio = useCardioLog();
  const prefs = usePhotoPrefs();
  const calibration = useCalibration();
  const current = useEvoRatingCurrent();
  const snapshots = useEvoSnapshots(26);
  const review = useRunEvoReview();
  const complete = useCompleteReforge();
  const [done, setDone] = useState<{ withPhotos: boolean } | null>(null);

  const viewedRef = useRef(false);
  useEffect(() => {
    if (!ready || viewedRef.current) return;
    viewedRef.current = true;
    track('reforge_day_viewed', {
      cycle: cadence.cycleNumber,
      due: cadence.due,
      is_first: cadence.isFirst,
      photo_prompts_disabled: prefs.promptsDisabled,
    });
  }, [ready, cadence.cycleNumber, cadence.due, cadence.isFirst, prefs.promptsDisabled]);

  const today = calendarToday();
  const fromIso = cadence.fromIso ?? anchorIso ?? today;
  const totals = periodTotals(workouts.data ?? [], cardio.data ?? [], fromIso, today);
  const trainedDays = new Set(
    (workouts.data ?? [])
      .map((r) => String((r as Record<string, unknown>).date ?? ''))
      .filter((d) => d >= fromIso && d <= today)
  ).size;
  const pr = recentPr(workouts.data);

  const row = (current.data ?? null) as Record<string, unknown> | null;
  const rating = row ? Number(row.displayed_rating ?? 0) : null;
  // The rating as it stood when this cycle began — the oldest snapshot at or
  // after fromIso. Null when the athlete has no history that far back, which
  // is stated rather than rendered as "+0".
  const cycleStart = (snapshots.data ?? [])
    .map((s) => s as Record<string, unknown>)
    .filter((s) => String(s.calculated_at ?? '').slice(0, 10) <= fromIso)
    .sort((a, b) => String(b.calculated_at).localeCompare(String(a.calculated_at)))[0];
  const startRating = cycleStart ? Number(cycleStart.displayed_rating ?? 0) : null;
  const movement = rating !== null && startRating !== null ? rating - startRating : null;

  // A physique calibration counts as "this Reforge" when it postdates the
  // cycle start — the same freshness rule the review itself applies.
  const baselineAt = prefs.baselineAt?.slice(0, 10) ?? null;
  const freshCalibration = baselineAt !== null && baselineAt >= fromIso;

  const runReforge = async () => {
    const withPhotos = freshCalibration;
    try {
      await review.mutateAsync({ force: true });
    } catch {
      /* the ceremony still completes on the data that did land */
    }
    await complete.mutateAsync().catch(() => undefined);
    track(withPhotos ? 'reforge_completed_with_photos' : 'reforge_completed_without_photos', {
      cycle: cadence.cycleNumber,
      trained_days: trainedDays,
      sets: totals.sets,
      photo_prompts_disabled: prefs.promptsDisabled,
    });
    setDone({ withPhotos });
  };

  if (!ready) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="EVO RATING" title="REFORGE DAY" onBack={() => router.back()} />
      </ScreenShell>
    );
  }

  if (done) {
    const copy = reforgeOutcomeCopy({ withPhotos: done.withPhotos, hasBaseline: prefs.hasBaseline });
    return (
      <ScreenShell>
        <ScreenHeader kicker="EVO RATING" title="REFORGE DAY" onBack={() => router.replace('/' as never)} />
        <GlowCard glow={colors.success} padding={18}>
          <Text
            allowFontScaling={false}
            style={{ fontSize: 20, letterSpacing: 0, color: colors.success, ...pixelFont() }}
          >
            {copy.title}
          </Text>
          <Text className="mt-s2 text-sm text-text-dim">{copy.body}</Text>
          {movement !== null ? (
            <Text className="mt-s3 text-sm text-text">
              Evo Rating {movement >= 0 ? '+' : ''}
              {movement.toFixed(1)} over the last {REFORGE_CYCLE_DAYS} days.
            </Text>
          ) : null}
        </GlowCard>
        <CalibrationCard summary={calibration.summary} testID="reforge-calibration" />
        <NeonButton title="BACK TO THE FORGE" onPress={() => router.replace('/' as never)} testID="reforge-exit" />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <ScreenHeader kicker="EVO RATING" title="REFORGE DAY" onBack={() => router.back()} />

      {!cadence.started ? (
        <GlowCard padding={16}>
          <Text className="text-sm text-text">Your first Reforge starts with your first workout.</Text>
          <Text className="mt-s1 text-2xs text-text-mute">
            Reforge Day comes round every {REFORGE_CYCLE_DAYS} days from then.
          </Text>
        </GlowCard>
      ) : (
        <>
          <GlowCard glow={colors.epic} padding={16}>
            <Text
              className="text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
            >
              REFORGE {cadence.cycleNumber} · LAST {REFORGE_CYCLE_DAYS} DAYS
            </Text>
            <View className="mt-s3 flex-row flex-wrap" style={{ gap: 16 }}>
              <Metric label="TRAINING DAYS" value={String(trainedDays)} />
              <Metric label="SETS" value={String(totals.sets)} />
              <Metric label="CARDIO MIN" value={String(totals.cardioMinutes)} />
              <Metric label="XP" value={String(totals.xp)} />
            </View>
            {pr ? (
              <Text className="mt-s3 text-2xs text-text-mute">
                BEST RECENT LIFT · {pr.exercise.toUpperCase()}
              </Text>
            ) : null}
          </GlowCard>

          {/* THE DOMINANT ACTION, above the photo offer and never gated by it. */}
          <NeonButton
            title={cadence.due ? 'RUN MY REFORGE' : `REFORGE IN ${cadence.daysUntil} DAYS`}
            size="hero"
            disabled={!cadence.due}
            busy={review.isPending || complete.isPending}
            onPress={() => void runReforge()}
            testID="reforge-run"
          />
          {!cadence.due ? (
            <Text className="text-center text-2xs text-text-mute">
              Day {cadence.dayOfCycle} of {REFORGE_CYCLE_DAYS}. Your strength, PRs, XP and streak
              keep updating every day in between.
            </Text>
          ) : null}

          {/* THE OFFER — below the action, and absent entirely for an athlete
              who asked not to be asked. */}
          {prefs.mayAsk && !freshCalibration ? (
            <GlowCard padding={16}>
              <Text
                className="text-text-mute"
                allowFontScaling={false}
                style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}
              >
                OPTIONAL · PHYSIQUE CALIBRATION
              </Text>
              <Text className="mt-s2 text-xs text-text-dim">
                {prefs.hasBaseline
                  ? 'Refresh your physique calibration to see visual change against your baseline.'
                  : 'These photos will create your private baseline. Your next Reforge can show visual change.'}
              </Text>
              <Text className="mt-s2 text-2xs text-text-mute">
                Your Reforge completes either way — this only refreshes the physique part of your
                rating.
              </Text>
              <View className="mt-s3">
                <NeonButton
                  title="ADD PHYSIQUE CALIBRATION"
                  variant="ghost"
                  onPress={() => {
                    track('photo_baseline_started', { surface: 'reforge_day' });
                    router.push('/evo-scan' as never);
                  }}
                  testID="reforge-scan"
                />
              </View>
            </GlowCard>
          ) : null}

          <CalibrationCard summary={calibration.summary} testID="reforge-calibration" />
        </>
      )}
    </ScreenShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ minWidth: 72 }}>
      <Text allowFontScaling={false} style={{ fontSize: 22, color: colors.text, ...pixelFont() }}>
        {value}
      </Text>
      <Text
        className="text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 8, letterSpacing: 0.5, ...pixelFont(false) }}
      >
        {label}
      </Text>
    </View>
  );
}
