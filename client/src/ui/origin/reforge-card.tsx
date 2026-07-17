/**
 * FREE REFORGE (047 program, Phase 6 — docs/ORIGIN_DATA_MODEL.md §5).
 *
 * One free re-choice after 3 valid post-binding workout days, server-proved.
 * The claim is idempotent and runs on Forge-page visit (the rival-page
 * reconcile pattern); the grant is a write-once server timestamp, so
 * deleting/recreating workouts cannot duplicate it. KEEP is a dismiss —
 * the credit is never consumed by staying (same_origin server-side).
 *
 * Renders nothing for origin-less users, nothing before the first claim
 * resolves, and nothing once the reforge is used — a system without a
 * state is hidden, never mocked.
 */

import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { track } from '@/data/analytics';
import { useProfile } from '@/data/hooks';
import {
  PATH_NAMES,
  useClaimReforge,
  useOriginCandidates,
  useOriginStatus,
  useReforgeOrigin,
} from '@/data/origin';
import type { OriginId } from '@/domain/origin/types';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { useToastStore } from '@/state/toast-store';
import { NeonButton } from '@/ui/core/neon-button';
import { playPowerUp } from '@/ui/core/sound';
import { GlowCard } from '@/ui/core/shell';

import { OriginCandidateCard } from './candidate-card';

const FLOW_PROPS = { calibration_version: 5 } as const;

export function ReforgeCard() {
  const colors = useThemeColors();
  const profile = useProfile();
  const status = useOriginStatus();
  const claim = useClaimReforge();
  const reforge = useReforgeOrigin();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<OriginId | null>(null);
  const claimed = useRef(false);

  const originSet = status.data != null && status.data.origin_path != null;
  const candidates = useOriginCandidates(open && originSet);

  // Idempotent reconcile-on-visit: grants the reforge the moment the
  // athlete is eligible, reports days otherwise.
  useEffect(() => {
    if (!originSet || claimed.current) return;
    claimed.current = true;
    claim.mutate(undefined, {
      onSuccess: (r) => {
        if (r.ok && r.granted) track('free_reforge_unlocked', FLOW_PROPS);
      },
      onError: () => {
        claimed.current = false; // allow the next visit to retry
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originSet]);

  if (!originSet) return null;
  const statusData = status.data;
  const claimData = claim.data;

  // Nothing to say yet, or the credit is spent — hidden.
  if (!claimData || (claimData.ok && claimData.used)) return null;
  const available = Boolean(claimData.ok && (claimData.granted || claimData.already_granted));

  if (!available) {
    const remaining = claimData.days_remaining ?? null;
    if (remaining == null) return null;
    return (
      <GlowCard padding={12}>
        <Text allowFontScaling={false} style={{ fontSize: 9, color: colors['text-mute'], letterSpacing: 1.5, ...pixelFont(false) }}>
          FREE REFORGE — {Math.max(0, remaining)} VALID WORKOUT DAY{remaining === 1 ? '' : 'S'} TO GO
        </Text>
        <Text className="mt-s1 text-2xs text-text-mute">
          Train {remaining === 1 ? 'one more day' : `${remaining} more days`} to earn one free Origin re-choice.
        </Text>
      </GlowCard>
    );
  }

  const list = candidates.data?.ok && candidates.data.candidates ? candidates.data.candidates : null;
  const current = statusData?.origin_path ?? null;

  const doReforge = async () => {
    if (!selected || reforge.isPending) return;
    try {
      const r = await reforge.mutateAsync(selected);
      if (!r.ok) {
        const subtitle = r.reason === 'same_origin'
          ? 'That is already your Origin — the credit stays.'
          : r.reason === 'already_used'
            ? 'The Reforge was already used.'
            : 'Try again.';
        useToastStore.getState().push({ kind: 'error', title: 'NOT REFORGED', subtitle });
        return;
      }
      track('free_reforge_completed', {
        ...FLOW_PROPS,
        from_origin: r.previous_origin ?? null,
        to_origin: selected,
      });
      playPowerUp();
      useToastStore.getState().push({
        kind: 'achievement',
        title: 'ORIGIN REFORGED',
        subtitle: `${PATH_NAMES[selected] ?? selected} — your Firstbound stays ${PATH_NAMES[r.firstbound ?? ''] ?? 'recorded'}`,
      });
      setOpen(false);
    } catch {
      useToastStore.getState().push({ kind: 'error', title: 'NOT REFORGED', subtitle: 'Connection problem — try again.' });
    }
  };

  return (
    <GlowCard glow={colors.epic} padding={14}>
      <Text allowFontScaling={false} style={{ fontSize: 10, color: colors.epic, letterSpacing: 2, ...pixelFont(false) }}>
        ✦ FREE REFORGE AVAILABLE
      </Text>
      <Text className="mt-s1 text-2xs text-text-mute">
        Three valid workouts earned you one free Origin re-choice, now with real training evidence.
        Your Firstbound, stages, mastery and purchases are never touched — the old Origin stays in
        your collection.
      </Text>
      {!open ? (
        <View className="mt-s3">
          <NeonButton
            title="VIEW YOUR NEW CANDIDATES"
            variant="ghost"
            onPress={() => {
              setOpen(true);
              track('free_reforge_started', FLOW_PROPS);
            }}
            testID="reforge-open"
          />
        </View>
      ) : (
        <>
          <View className="mt-s3">
            {list ? (
              list.map((c) => (
                <View key={c.originId} className="mb-s3">
                  <OriginCandidateCard
                    candidate={c}
                    recommended={candidates.data?.recommended_origin === c.originId}
                    selected={selected === c.originId}
                    onSelect={() => setSelected(c.originId as OriginId)}
                    sex={profile.data?.sex ?? 'male'}
                    testID={`reforge-candidate-${c.originId}`}
                  />
                </View>
              ))
            ) : (
              <Text className="mb-s3 text-xs text-text-mute">Forging your candidates…</Text>
            )}
          </View>
          <View className="gap-s2">
            <NeonButton
              title={selected && selected !== current ? `REFORGE TO ${(PATH_NAMES[selected] ?? selected).toUpperCase()}` : 'REFORGE'}
              disabled={!selected || selected === current}
              busy={reforge.isPending}
              onPress={() => void doReforge()}
              testID="reforge-bind"
            />
            <NeonButton
              title={`KEEP ${(PATH_NAMES[current ?? ''] ?? 'MY ORIGIN').toUpperCase()}`}
              variant="ghost"
              onPress={() => setOpen(false)}
              testID="reforge-keep"
            />
          </View>
        </>
      )}
    </GlowCard>
  );
}
