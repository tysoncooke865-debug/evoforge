import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { router } from 'expo-router';

import { todayIso } from '@/domain/today';
import { batchCullKey, isBatchCulled } from '@/lab/cull-model';
import { useCulled } from '@/lab/cull-store';
import { cullBatchEverywhere, uncullBatchEverywhere, useCullSync } from '@/lab/cull-sync';
import { labVariantHref } from '@/lab/links';
import { LAB_PAGES } from '@/lab/registry';
import type { LabBatch, LabPage } from '@/lab/types';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader, SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/**
 * PAGE LAB — the gallery, and the lab's front door.
 *
 * One large heading per app page. Under it, CURRENT first — the pinned fork
 * of the deployed design, always present, with NO cull affordance (culling
 * the comparison anchor was never a decision anyone meant to offer) — then
 * the REDESIGN batches, newest first: "REDESIGN <n> FROM <date>", made-with
 * line, one OPEN that lands on the batch's first take with CURRENT one tab
 * away. With no batches pending, a page is exactly its CURRENT box — the
 * quiet state is the healthy state.
 *
 * CULL is batch-level and CONFIRMED: the quiet CULL under a batch swaps the
 * card's foot for an inline are-you-sure block (the callout-tray idiom —
 * static, no Modal, no motion, nothing for the hydration gate to trip on).
 * Confirming hides the batch and lists it under CULLED · PENDING REMOVAL,
 * the work list for the deletion commit. RESTORE undoes it.
 *
 * testID contract (the Playwright tour drives these):
 *   lab-open-<page>-baseline, lab-open-<page>-batch-<n>,
 *   lab-cull-<page>-batch-<n>, lab-cull-confirm-<page>-batch-<n>,
 *   lab-cull-cancel-<page>-batch-<n>, lab-uncull-<page>-batch-<n>
 */
export default function LabGalleryScreen() {
  const colors = useThemeColors();
  const culled = useCulled();
  // Pull-and-merge the durable cull list when a real session sits under the
  // lab; `durable` drives the signed-out hint below. cull-sync.ts owns the
  // rule that render never waits on this.
  const { durable } = useCullSync();

  // Keys for batches that no longer exist (already deleted in a follow-up
  // commit) are ignored, never shown — the registry is the only truth about
  // what exists, and a stale key must not outlive its batch on screen.
  const pending = LAB_PAGES.flatMap((page) =>
    page.batches
      .filter((batch) => isBatchCulled(culled, page.id, batch.number))
      .map((batch) => ({ page, batch }))
  );

  return (
    <ScreenShell>
      <ScreenHeader kicker="DEV ONLY" title="PAGE LAB" />
      <Text
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 0.5, color: colors['text-mute'], ...pixelFont(false) }}
      >
        MOCK DATA ONLY — every variant runs on the seeded lab athlete.
      </Text>
      {!durable ? (
        <Text
          testID="lab-cull-hint"
          allowFontScaling={false}
          style={{
            fontSize: 10,
            letterSpacing: 0.5,
            color: colors['text-mute'],
            ...pixelFont(false),
          }}
        >
          CULLS STAY ON THIS DEVICE — SIGN IN TO SYNC THEM ACROSS DEVICES.
        </Text>
      ) : null}

      {LAB_PAGES.map((page) => {
        const live = page.batches.filter((b) => !isBatchCulled(culled, page.id, b.number));
        return (
          <View key={page.id} className="w-full gap-s3">
            {/* The page heading — large on purpose: the gallery's first job
                is "which page am I looking at takes OF". */}
            <View className="w-full gap-s1">
              <Text
                allowFontScaling={false}
                style={{ fontSize: 24, letterSpacing: 2, color: colors.text, ...pixelFont() }}
              >
                {page.title}
              </Text>
              <View style={{ height: 2, width: 48, backgroundColor: colors.accent }} />
            </View>
            <CurrentCard page={page} />
            {live.map((batch) => (
              <BatchCard key={batch.number} page={page} batch={batch} />
            ))}
          </View>
        );
      })}

      {pending.length > 0 ? (
        <View className="w-full gap-s3">
          <SectionLabel size="lg">CULLED · PENDING REMOVAL</SectionLabel>
          <Text className="text-xs text-text-dim">
            Hidden, not deleted. Deleting a batch for good is a commit: its variant files, its
            batches entry, its COMPONENTS lines — and when that empties the page,
            lastBatchNumber resets to 0 in the same edit (lab.test.ts enforces it).
          </Text>
          {pending.map(({ page, batch }) => (
            <CulledRow key={batchCullKey(page.id, batch.number)} page={page} batch={batch} />
          ))}
        </View>
      ) : null}
    </ScreenShell>
  );
}

/** CURRENT — the deployed design. No cull affordance, ever. */
function CurrentCard({ page }: { page: LabPage }) {
  const colors = useThemeColors();
  const open = () =>
    router.push(labVariantHref(page.id, 'baseline', page.exampleParams?.(todayIso())) as never);

  return (
    <GlowCard>
      <View className="gap-s3">
        <Text allowFontScaling={false} style={{ fontSize: 17, color: colors.text, ...pixelFont() }}>
          CURRENT
        </Text>
        <Text className="text-xs text-text-dim">{page.baseline.description}</Text>
        <NeonButton title="OPEN" onPress={open} testID={`lab-open-${page.id}-baseline`} />
      </View>
    </GlowCard>
  );
}

function BatchCard({ page, batch }: { page: LabPage; batch: LabBatch }) {
  const colors = useThemeColors();
  const [confirming, setConfirming] = useState(false);

  const first = batch.variants[0];
  const open = () =>
    router.push(
      labVariantHref(page.id, first.id, {
        ...page.exampleParams?.(todayIso()),
        batch: String(batch.number),
      }) as never
    );

  return (
    <GlowCard>
      <View className="gap-s3">
        <Text allowFontScaling={false} style={{ fontSize: 17, color: colors.text, ...pixelFont() }}>
          {`REDESIGN ${batch.number} FROM ${batch.dateIso}`}
        </Text>
        <Text
          allowFontScaling={false}
          style={{ fontSize: 10, letterSpacing: 0.5, color: colors['text-dim'], ...pixelFont(false) }}
        >
          {`Made with ${batch.model}`}
        </Text>
        <Text className="text-xs text-text-dim">{batch.description}</Text>
        <NeonButton
          title="OPEN"
          onPress={open}
          testID={`lab-open-${page.id}-batch-${batch.number}`}
        />
        {confirming ? (
          /* The callout-tray confirm idiom: swap the card's foot in place for
             a warn-tinted statement + two buttons. Static styles only — no
             Modal, no animation, nothing for verify-motion or the hydration
             gate to trip on. */
          <View
            className="rounded-md border p-s3"
            style={{ borderColor: `${colors.warn}66`, backgroundColor: `${colors.warn}10` }}
          >
            <Text
              allowFontScaling={false}
              className="text-2xs"
              style={{ color: colors.warn, letterSpacing: 1 }}
            >
              ARE YOU SURE?
            </Text>
            <Text className="mt-s1 text-2xs text-text-dim">
              This hides REDESIGN {batch.number} everywhere the cull list reaches and queues it
              for the deletion commit. RESTORE undoes it until then.
            </Text>
            <View className="mt-s2 flex-row" style={{ gap: 8 }}>
              <View style={{ flex: 1 }}>
                <NeonButton
                  title="KEEP IT"
                  variant="ghost"
                  pixel
                  onPress={() => setConfirming(false)}
                  testID={`lab-cull-cancel-${page.id}-batch-${batch.number}`}
                />
              </View>
              <View style={{ flex: 1 }}>
                <NeonButton
                  title="CULL IT"
                  pixel
                  onPress={() => {
                    setConfirming(false);
                    cullBatchEverywhere(page.id, batch.number);
                  }}
                  testID={`lab-cull-confirm-${page.id}-batch-${batch.number}`}
                />
              </View>
            </View>
          </View>
        ) : (
          /* Quiet on purpose: culling is a decision, not a convenience, and
             it must never sit at the same weight as OPEN. */
          <Pressable
            testID={`lab-cull-${page.id}-batch-${batch.number}`}
            accessibilityRole="button"
            accessibilityLabel={`Cull redesign ${batch.number} of ${page.title}`}
            onPress={() => setConfirming(true)}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text
              allowFontScaling={false}
              style={{
                fontSize: 10,
                letterSpacing: 1,
                color: colors['text-mute'],
                ...pixelFont(false),
              }}
            >
              CULL
            </Text>
          </Pressable>
        )}
      </View>
    </GlowCard>
  );
}

function CulledRow({ page, batch }: { page: LabPage; batch: LabBatch }) {
  const colors = useThemeColors();
  return (
    <View
      className="w-full flex-row items-center justify-between"
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: 12,
        paddingVertical: 8,
      }}
    >
      <Text
        allowFontScaling={false}
        style={{
          fontSize: 10,
          letterSpacing: 1,
          color: colors['text-mute'],
          ...pixelFont(false),
        }}
      >
        {`${page.title} / REDESIGN ${batch.number}`}
      </Text>
      <Pressable
        testID={`lab-uncull-${page.id}-batch-${batch.number}`}
        accessibilityRole="button"
        accessibilityLabel={`Restore redesign ${batch.number} of ${page.title}`}
        onPress={() => uncullBatchEverywhere(page.id, batch.number)}
        style={{ minHeight: 44, justifyContent: 'center', paddingLeft: 12 }}
      >
        <Text
          allowFontScaling={false}
          style={{
            fontSize: 10,
            letterSpacing: 1,
            color: colors['text-dim'],
            ...pixelFont(false),
          }}
        >
          RESTORE
        </Text>
      </Pressable>
    </View>
  );
}
