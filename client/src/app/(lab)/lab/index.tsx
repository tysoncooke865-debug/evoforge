import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import { todayIso } from '@/domain/today';
import { labVariantHref } from '@/lab/links';
import { LAB_PAGES } from '@/lab/registry';
import type { LabDataMode, LabPage, LabVariant } from '@/lab/types';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader, SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { SegmentedTabs } from '@/ui/core/segmented-tabs';

/**
 * PAGE LAB — the gallery. One section per page, one card per variant:
 * what it is, which data modes it supports, a REAL/MOCK toggle, OPEN.
 * The (lab) layout is the gate; by the time this renders, the lab is on.
 */
export default function LabGalleryScreen() {
  const colors = useThemeColors();
  const { session } = useAuth();
  return (
    <ScreenShell>
      <ScreenHeader kicker="DEV ONLY" title="PAGE LAB" />
      {LAB_PAGES.map((page) => (
        <View key={page.id} className="w-full gap-s3">
          <SectionLabel size="lg">{page.title}</SectionLabel>
          {page.variants.map((variant) => (
            <VariantCard key={variant.id} page={page} variant={variant} />
          ))}
        </View>
      ))}
      <Text
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 0.5, color: colors['text-mute'], ...pixelFont(false) }}
      >
        {session
          ? `REAL mode uses ${session.user?.email ?? 'the signed-in account'} — a lab workout IS a real workout.`
          : 'Signed out — REAL mode renders empty states. MOCK mode is fully seeded.'}
      </Text>
    </ScreenShell>
  );
}

function VariantCard({ page, variant }: { page: LabPage; variant: LabVariant }) {
  const colors = useThemeColors();
  const [mode, setMode] = useState<LabDataMode>(variant.defaultMode);
  const switchable = variant.modes.length > 1;

  const open = () =>
    router.push(
      labVariantHref(page.id, variant.id, mode, page.exampleParams?.(todayIso())) as never
    );

  return (
    <GlowCard>
      <View className="gap-s3">
        <View className="flex-row items-center justify-between">
          <Text
            allowFontScaling={false}
            style={{ fontSize: 17, color: colors.text, ...pixelFont() }}
          >
            {variant.title}
          </Text>
          <View className="flex-row gap-s2">
            {variant.modes.map((m) => (
              <Chip key={m} label={m.toUpperCase()} active={m === mode} onPress={() => setMode(m)} />
            ))}
          </View>
        </View>
        <Text className="text-xs text-text-dim">{variant.description}</Text>
        {switchable ? (
          <SegmentedTabs
            left="REAL"
            right="MOCK"
            active={mode === 'mock' ? 1 : 0}
            onChange={(i) => setMode(i === 1 ? 'mock' : 'real')}
            testIDPrefix={`lab-mode-${page.id}-${variant.id}`}
            pixelLabels
          />
        ) : null}
        <NeonButton title="OPEN" onPress={open} testID={`lab-open-${page.id}-${variant.id}`} />
      </View>
    </GlowCard>
  );
}
