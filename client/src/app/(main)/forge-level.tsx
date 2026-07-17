/**
 * PROGRESSION_OVERHAUL P5 — the Forge Level page (spec §32): level,
 * lifetime XP, progress, the ledger, Weekly Momentum, the legacy level
 * preserved. States its own boundary: consistency, never physique.
 */

import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { progressionFeatures } from '@/data/progression/features';
import { claimWeeklyTarget } from '@/data/progression/award-xp';
import { forgeProgressFromRow, useForgeProgression, useMomentum, useXpLedger } from '@/data/progression/use-forge';
import { supabase } from '@/data/supabase';
import { weekStartOf } from '@/domain/progression/momentum';
import { todayIso } from '@/domain/today';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/data/auth-context';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { XpBar } from '@/ui/character/xp-bar';

const EVENT_LABEL: Record<string, string> = {
  workout_completed: 'Workout completed',
  workout_completed_migrated: 'Workout (history)',
  weekly_target: 'Weekly target met',
  weekly_checkin: 'Weekly check-in',
  cardio_test_completed: 'Cardio test',
  evo_scan_completed: 'Evo Scan',
};

export default function ForgeLevelScreen() {
  const colors = useThemeColors();
  const forge = useForgeProgression();
  const ledger = useXpLedger(20);
  const { momentum } = useMomentum();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  // Claim LAST week (the most recent completed week) — server re-proves it.
  const lastWeekStart = (() => {
    const thisMonday = weekStartOf(todayIso());
    const d = new Date(`${thisMonday}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  })();
  const claim = useMutation({
    mutationFn: () => claimWeeklyTarget(supabase, lastWeekStart),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['user_progression', userId] });
      void queryClient.invalidateQueries({ queryKey: ['xp_ledger', userId] });
    },
  });

  if (!progressionFeatures.newProgressionEnabled) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="PROGRESSION" title="FORGE LEVEL" onBack={() => router.back()} />
        <Text className="text-sm text-text-dim">The new progression system is not enabled yet.</Text>
      </ScreenShell>
    );
  }

  const progress = forgeProgressFromRow(forge.data ?? null);

  return (
    <ScreenShell>
      <ScreenHeader kicker="PROGRESSION" title="FORGE LEVEL" onBack={() => router.back()} />

      <GlowCard glow={colors.accent} padding={16}>
        <View className="flex-row items-end justify-between">
          <View>
            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              FORGE LEVEL
            </Text>
            <Text allowFontScaling={false} style={{ fontSize: 44, lineHeight: 50, letterSpacing: 0, color: colors.accent, textShadowColor: 'rgba(34,211,238,0.5)', textShadowRadius: 14, ...pixelFont() }}>
              {progress.level}
            </Text>
          </View>
          <View className="items-end">
            <Text className="text-2xs text-text-mute">LIFETIME XP</Text>
            <Text className="text-base text-text" allowFontScaling={false} style={{ ...pixelFont() }}>
              {progress.lifetimeXp.toLocaleString('en-US')}
            </Text>
            {forge.data?.legacy_xp != null ? (
              <Text className="text-2xs text-text-mute">legacy record: {Number(forge.data.legacy_xp).toLocaleString('en-US')} XP</Text>
            ) : null}
          </View>
        </View>
        <View className="mt-s3">
          <XpBar xpIntoLevel={progress.xpIntoLevel} xpNeeded={progress.xpForNextLevel} />
        </View>
        <Text className="mt-s1 text-2xs text-text-mute">
          Forge Level measures your journey and consistency. It never decreases and cannot be bought — and it does not determine your real-world Evo Rating.
        </Text>
      </GlowCard>

      {/* Weekly Momentum. */}
      <GlowCard padding={16}>
        <View className="flex-row items-center justify-between">
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            WEEKLY MOMENTUM
          </Text>
          {momentum?.tier ? (
            <Text className="text-2xs" allowFontScaling={false} style={{ color: colors.legendary, letterSpacing: 0, ...pixelFont() }}>
              {momentum.tier.toUpperCase()}
            </Text>
          ) : null}
        </View>
        <View className="mt-s2 flex-row" style={{ gap: 16 }}>
          <View>
            <Text className="text-xl text-text" allowFontScaling={false} style={{ ...pixelFont() }}>
              {momentum?.current ?? 0}
            </Text>
            <Text className="text-2xs text-text-mute">CURRENT WEEKS</Text>
          </View>
          <View>
            <Text className="text-xl text-text" allowFontScaling={false} style={{ ...pixelFont() }}>
              {momentum?.peak ?? 0}
            </Text>
            <Text className="text-2xs text-text-mute">PEAK</Text>
          </View>
          <View>
            <Text className="text-xl text-text" allowFontScaling={false} style={{ ...pixelFont() }}>
              {momentum?.lifetimeSuccessfulWeeks ?? 0}
            </Text>
            <Text className="text-2xs text-text-mute">LIFETIME WEEKS</Text>
          </View>
        </View>
        <Text className="mt-s2 text-2xs text-text-mute">
          Weekly target: {forge.data?.weekly_target ?? 3} sessions · rest days never break Momentum
        </Text>
        <View className="mt-s2">
          <NeonButton
            title="CLAIM LAST WEEK"
            variant="ghost"
            pixel
            busy={claim.isPending}
            onPress={() => claim.mutate()}
            testID="claim-weekly"
          />
          {claim.data ? (
            <Text className="mt-s1 text-center text-2xs text-text-dim">
              {claim.data.granted > 0 ? `+${claim.data.granted} XP — week banked` : `No grant: ${claim.data.reason.replace(/_/g, ' ')}`}
            </Text>
          ) : null}
        </View>
      </GlowCard>

      {/* The ledger. */}
      <View>
        <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
          RECENT FORGE XP
        </Text>
        {(ledger.data ?? []).length === 0 ? (
          <Text className="text-xs text-text-mute">No Forge XP yet — finish a workout to begin.</Text>
        ) : (
          (ledger.data ?? []).map((e) => (
            <View key={String(e.id)} className="mb-s1 flex-row items-center justify-between rounded-md border px-s3 py-s2" style={{ borderColor: colors.border, backgroundColor: colors['surface-2'] }}>
              <Text className="text-xs text-text-dim" numberOfLines={1} style={{ flexShrink: 1 }}>
                {EVENT_LABEL[String(e.event_type)] ?? String(e.event_type)} · {String(e.created_at).slice(0, 10)}
              </Text>
              <Text className="text-sm" allowFontScaling={false} style={{ color: colors.accent, ...pixelFont() }}>
                +{String(e.xp_awarded)}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScreenShell>
  );
}
