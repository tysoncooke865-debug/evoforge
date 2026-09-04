import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { LabDataProvider } from '@/lab/lab-data-provider';
import { findLabBatch, findLabVariant } from '@/lab/registry';
import { resolveBatchNumber } from '@/lab/switcher-model';
import { LabVariantSwitcher } from '@/lab/variant-switcher';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { ScreenShell } from '@/ui/core/shell';

/**
 * The variant host: /lab/<page>/<variant>[?batch=<n>][&page-contract params].
 *
 * Looks the variant up in the registry and mounts it inside LabDataProvider.
 * Page-contract params (the workout's date/workout/source) ride the SAME URL
 * and are read unchanged by the fork's own useLocalSearchParams — the host
 * only consumes page/variant/batch. The batch scope resolves by MEMBERSHIP
 * for a codename (its owning batch is the truth) and by the ?batch param for
 * `baseline` (CURRENT belongs to no batch, so the URL says which strip it is
 * sharing — see switcher-model.ts). Keyed by page/variant so every swap
 * remounts with a fresh seeded client.
 */
export default function LabVariantHost() {
  const params = useLocalSearchParams<{ page?: string; variant?: string; batch?: string }>();
  // The (lab) layout's mount gate blanks the static pre-render of every lab
  // page, so by the time this renders the params are the client's real ones.
  const found = findLabVariant(params.page, params.variant);
  if (!found) return <UnknownVariant page={params.page} variant={params.variant} />;

  const batchNumber = resolveBatchNumber(found.page, found.variant.id, params.batch);
  const batch = batchNumber === null ? null : findLabBatch(found.page, batchNumber);

  const Variant = found.variant.component;
  return (
    <View style={{ flex: 1 }}>
      {/* The tab strip renders FIRST, in flow — the design gets the rest of
          the viewport and is never overlaid by lab chrome. OUTSIDE the
          provider on purpose: the tabs must survive the variant remount and
          must never read the mock QueryClient — they are lab chrome, not
          part of the design under judgement. */}
      <LabVariantSwitcher page={found.page} current={found.variant.id} batch={batch} />
      <LabDataProvider key={`${found.page.id}/${found.variant.id}`}>
        <Variant />
      </LabDataProvider>
    </View>
  );
}

function UnknownVariant({ page, variant }: { page?: string; variant?: string }) {
  const colors = useThemeColors();
  return (
    <ScreenShell>
      <ScreenHeader kicker="PAGE LAB" title="NO SUCH VARIANT" />
      <Text
        allowFontScaling={false}
        style={{ fontSize: 12, color: colors['text-dim'], ...pixelFont(false) }}
      >
        {`Nothing registered at /lab/${page ?? '?'}/${variant ?? '?'} — check src/lab/registry.ts.`}
      </Text>
      <View className="w-full">
        <NeonButton title="BACK TO THE GALLERY" onPress={() => router.replace('/lab' as never)} />
      </View>
    </ScreenShell>
  );
}
