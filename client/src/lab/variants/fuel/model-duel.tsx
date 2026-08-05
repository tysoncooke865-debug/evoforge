import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { describeMeal, scanTotals, type MealItem } from '@/data/nutrition';
import { FUEL_PROBES, type FuelProbe } from '@/lab/fixtures/fuel-probes';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/**
 * FUEL / MODEL DUEL (Page Lab, 2026-08): the describe-a-meal accuracy bench.
 *
 * NOT a fork of the Fuel page — a purpose-built instrument: one text input,
 * one RUN, and the SAME text through the live model (gpt-5.1, the bare
 * describeMeal call) and the allowlisted test model (gpt-5.6) IN PARALLEL,
 * rendered side by side with latency, per-item DB/AI provenance and totals.
 * Probe chips carry known-answer meals (lab/fixtures/fuel-probes.ts, vitest-
 * pinned to the USDA table) so each column grades itself pass/fail.
 *
 * DISPLAY-ONLY BY CONSTRUCTION: no useLogMeal, nothing writes, so no mock
 * shims — the variant is registered real-mode-only because the whole point
 * is the real edge function (which needs a real session's JWT anyway).
 * The server enforces the model allowlist and an hourly limit on the test
 * path; both surface here as the inline error text.
 */

type DuelOutcome =
  | { kind: 'ok'; items: MealItem[]; notes: string; ms: number }
  | { kind: 'error'; error: string; ms: number };

export function FuelModelDuel() {
  const colors = useThemeColors();
  const [mode, setMode] = useState<'describe' | 'recipe'>('describe');
  const [text, setText] = useState('');
  const [probe, setProbe] = useState<FuelProbe | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<DuelOutcome | null>(null);
  const [test, setTest] = useState<DuelOutcome | null>(null);

  const pickProbe = (p: FuelProbe) => {
    setProbe(p);
    setText(p.text);
    setMode(p.mode);
  };

  const edit = (t: string) => {
    setText(t);
    // An edited text is no longer the probe's text — grading it against the
    // probe's band would lie. Chips re-arm it.
    if (probe && t !== probe.text) setProbe(null);
  };

  const timed = async (opts?: { model: 'gpt-5.6' }): Promise<DuelOutcome> => {
    const t0 = Date.now();
    const r = await describeMeal(text.trim(), mode, opts);
    const ms = Date.now() - t0;
    return 'error' in r ? { kind: 'error', error: r.error, ms } : { kind: 'ok', ...r, ms };
  };

  const run = async () => {
    if (text.trim().length < 3 || busy) return;
    setBusy(true);
    setLive(null);
    setTest(null);
    const [a, b] = await Promise.all([timed(), timed({ model: 'gpt-5.6' })]);
    setLive(a);
    setTest(b);
    setBusy(false);
  };

  return (
    <ScreenShell>
      <ScreenHeader kicker="PAGE LAB · FUEL" title="MODEL DUEL" />

      <GlowCard>
        <View className="gap-s3">
          <View className="flex-row" style={{ gap: 8 }}>
            <ModeTab label="DESCRIBE" active={mode === 'describe'} onPress={() => setMode('describe')} />
            <ModeTab label="RECIPE" active={mode === 'recipe'} onPress={() => setMode('recipe')} />
          </View>

          <TextInput
            multiline
            className="w-full rounded-md border bg-surface-2 px-s3 py-s3 text-base text-text"
            style={{ borderColor: `${colors.epic}59`, minHeight: 96, textAlignVertical: 'top' }}
            placeholder="Describe a meal, or tap a probe below."
            placeholderTextColor="#64758f"
            value={text}
            onChangeText={edit}
            maxLength={1500}
            testID="duel-input"
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {FUEL_PROBES.map((p) => (
              <View key={p.id} testID={`duel-probe-${p.id}`}>
                <Chip label={p.label} active={probe?.id === p.id} onPress={() => pickProbe(p)} />
              </View>
            ))}
          </ScrollView>

          {probe ? (
            <Text className="text-2xs text-text-mute">
              {`Known answer: ${probe.kcal.min}–${probe.kcal.max} kcal${probe.dbAnchor ? ' (USDA table owns this one)' : ' (estimate band)'}.`}
            </Text>
          ) : (
            <Text className="text-2xs text-text-mute">
              Same text, both models, in parallel. The test path is rate-limited server-side (10/hr).
            </Text>
          )}

          <NeonButton
            title={busy ? 'RUNNING BOTH…' : 'RUN BOTH'}
            variant="epic"
            onPress={() => void run()}
            busy={busy}
            disabled={text.trim().length < 3}
            testID="duel-run"
          />
        </View>
      </GlowCard>

      {live || test ? (
        <View className="w-full flex-row" style={{ gap: 8 }}>
          <DuelColumn title="GPT-5.1 · LIVE" outcome={live} probe={probe} testID="duel-col-live" />
          <DuelColumn title="GPT-5.6 · TEST" outcome={test} probe={probe} testID="duel-col-test" />
        </View>
      ) : null}

      <View className="w-full">
        <NeonButton
          title="BACK TO THE GALLERY"
          variant="ghost"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/lab' as never))}
          testID="duel-back"
        />
      </View>
    </ScreenShell>
  );
}

function DuelColumn({
  title,
  outcome,
  probe,
  testID,
}: {
  title: string;
  outcome: DuelOutcome | null;
  probe: FuelProbe | null;
  testID: string;
}) {
  const colors = useThemeColors();
  if (!outcome) return <View className="flex-1" testID={testID} />;

  if (outcome.kind === 'error') {
    return (
      <View className="flex-1 rounded-md border bg-surface p-s3" style={{ borderColor: colors.border }} testID={testID}>
        <ColumnTitle title={title} ms={outcome.ms} />
        <Text className="mt-s2 text-2xs text-danger" testID={`${testID}-error`}>
          {outcome.error}
        </Text>
      </View>
    );
  }

  const totals = scanTotals(outcome.items);
  const graded = probe ? totals.kcal >= probe.kcal.min && totals.kcal <= probe.kcal.max : null;
  const kcalColor = graded === null ? colors.text : graded ? colors.success : colors.danger;

  return (
    <View className="flex-1 rounded-md border bg-surface p-s3" style={{ borderColor: colors.border }} testID={testID}>
      <ColumnTitle title={title} ms={outcome.ms} />
      <Text
        allowFontScaling={false}
        className="mt-s2"
        style={{ fontSize: 20, color: kcalColor, ...pixelFont() }}
        testID={`${testID}-kcal`}
      >
        {`${totals.kcal} KCAL${graded === null ? '' : graded ? ' ✓' : ' ✗'}`}
      </Text>
      <Text className="text-2xs text-text-dim">
        {`P ${Math.round(totals.p)} · C ${Math.round(totals.c)} · F ${Math.round(totals.f)}`}
      </Text>

      <View className="mt-s2 gap-s1">
        {outcome.items.map((it, i) => (
          <View key={`${it.name}-${i}`} className="flex-row items-start justify-between" style={{ gap: 6 }}>
            <Text className="flex-1 text-2xs text-text" numberOfLines={2}>
              {`${it.name} · ${it.grams}g`}
              {it.source === 'db' && it.matched ? (
                <Text className="text-2xs text-text-mute">{`  [${it.matched}]`}</Text>
              ) : null}
            </Text>
            <View className="flex-row items-center" style={{ gap: 4 }}>
              <Text className="text-2xs text-text-dim">
                {`${Math.round((it.grams * it.per100.kcal) / 100)}`}
              </Text>
              <SourceBadge source={it.source} />
            </View>
          </View>
        ))}
      </View>

      {outcome.notes ? (
        <Text className="mt-s2 text-2xs text-text-mute" numberOfLines={3}>
          {outcome.notes}
        </Text>
      ) : null}
    </View>
  );
}

function ColumnTitle({ title, ms }: { title: string; ms: number }) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-center justify-between">
      <Text allowFontScaling={false} style={{ fontSize: 10, letterSpacing: 0.5, color: colors['text-dim'], ...pixelFont(false) }}>
        {title}
      </Text>
      <Text className="text-2xs text-text-mute">{`${ms}ms`}</Text>
    </View>
  );
}

/** The DB/AI provenance chip — db means the deterministic table priced it,
 *  ai means the model's own clamped per-100g estimate did. */
function SourceBadge({ source }: { source: MealItem['source'] }) {
  const colors = useThemeColors();
  const db = source === 'db';
  return (
    <View
      className="rounded-sm border px-s1"
      style={{ borderColor: db ? `${colors.success}59` : `${colors.warn}59` }}
    >
      <Text
        allowFontScaling={false}
        style={{ fontSize: 8, letterSpacing: 0.5, color: db ? colors.success : colors.warn, ...pixelFont(false) }}
      >
        {db ? 'DB' : 'AI'}
      </Text>
    </View>
  );
}

/** Copied BESIDE the variant from ui/fuel/describe-meal.tsx (README rule 5:
 *  never edit src/ui/ for a variant's sake) — same look, lab testIDs. */
function ModeTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className="flex-1 items-center justify-center rounded-md border py-s2"
      style={{
        minHeight: 44,
        borderColor: active ? `${colors.epic}8c` : colors.border,
        backgroundColor: active ? 'rgba(168,85,247,0.12)' : colors['surface-2'],
      }}
      testID={`duel-mode-${label.toLowerCase()}`}
    >
      <Text
        allowFontScaling={false}
        style={{ fontSize: 11, letterSpacing: 1, color: active ? colors.epic : colors['text-dim'], ...pixelFont(false) }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
