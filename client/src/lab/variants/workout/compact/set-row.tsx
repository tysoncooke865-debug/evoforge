import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { useLabSaveSet as useSaveSet } from '@/lab/mock/mutations';
import { pyFloat } from '@/domain/py';
import type { SetVerdict } from '@/domain/set-save';
import { WEIGHT_STEP, convertTyped, displayWeight, toKgForSave, type WeightUnit } from '@/domain/units';
import { XP_PER_SET } from '@/domain/xp';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { FloatingXP } from '@/ui/character/floating-xp';
import { KeyPad } from '@/ui/core/number-field';
import { playCoin, playPr, playSelect } from '@/ui/core/sound';

import { HorizontalStepper } from './horizontal-stepper';
import { LogButton } from './log-button';
import type { LogState } from './model';

/**
 * COMPACT variant SetRow — forked from the baseline logger's private SetRow.
 * Diverges: horizontal steppers (req 9-12), the three-state LogButton
 * (req 13, driven by the card's logButtonState), and NO startRest() — the
 * rest-timer store is module-global and shared with the live app; this
 * variant excludes rest UI entirely (user decision). The save path, prefill
 * dimming, unit lens, drop sets, FloatingXP and testIDs are verbatim.
 */
export function CompactSetRow({
  date,
  workout,
  exercise,
  setNo,
  initialWeight,
  initialReps,
  initialNotes = '',
  prefill = null,
  logState,
  onPr,
  onLogged,
  durable = false,
  unit,
}: {
  date: string;
  workout: string;
  exercise: string;
  setNo: number;
  initialWeight: string;
  initialReps: string;
  /** The row's saved notes — DROPS ride here ("DROPS: 50x6, 40x5"). */
  initialNotes?: string;
  /** Last session's numbers for this set — shown editable, saved only on LOG. */
  prefill?: { weight: number; reps: number } | null;
  /** The card's verdict from logButtonState — 'next' at most once per page. */
  logState: LogState;
  onPr: () => void;
  onLogged?: (verdict: SetVerdict) => void;
  durable?: boolean;
  /** The lens: what the athlete types/reads. Props and saves are ALWAYS kg. */
  unit: WeightUnit;
}) {
  const colors = useThemeColors();
  const tint = colors.accent;
  // Seeds arrive as kg (log rows / last-session prefill) and are painted in
  // the exercise's unit. Typed state lives in that unit until save.
  const [weight, setWeight] = useState(
    initialWeight !== ''
      ? displayWeight(pyFloat(initialWeight) ?? 0, unit)
      : prefill
        ? displayWeight(prefill.weight, unit)
        : ''
  );
  const [reps, setReps] = useState(initialReps !== '' ? initialReps : prefill ? String(prefill.reps) : '');
  // Flipping the toggle converts the string UNDER the athlete, in place —
  // dirty flags untouched, half-typed garbage left alone (convertTyped).
  // Render-time adjustment, not an effect: set-state-in-effect is a lint
  // error in this repo, and this is the React-documented derived-state form.
  const [prevUnit, setPrevUnit] = useState(unit);
  if (prevUnit !== unit) {
    setPrevUnit(unit);
    setWeight(convertTyped(weight, prevUnit, unit));
  }
  // Prefill renders DIM until the athlete touches it. Steppers, keypad DONE
  // and desktop typing all funnel through onChange -> dirty.
  const [weightDirty, setWeightDirty] = useState(initialWeight !== '');
  const [repsDirty, setRepsDirty] = useState(initialReps !== '');
  const [floatXp, setFloatXp] = useState(false);
  // DROP SETS: back-off mini-sets after the working set, stored in the row's
  // notes — ONE set row, ONE XP grant (the anti-farm contract).
  const parseDrops = (n: string) => (n.startsWith('DROPS: ') ? n.slice(7).split(', ').filter(Boolean) : []);
  const [drops, setDrops] = useState<string[]>(() => parseDrops(initialNotes));
  const [dropPad, setDropPad] = useState<null | { stage: 'w' | 'r'; w?: string; keep?: boolean }>(null);
  const save = useSaveSet();
  const logged = initialWeight !== '';

  const saveDrops = (next: string[]) => {
    setDrops(next);
    const w = pyFloat(weight);
    const r = pyFloat(reps);
    // 061: 0 kg is a valid (bodyweight) set — only reps still gate.
    if (w === null || r === null || w < 0 || r <= 0) return;
    save.mutate({
      workoutDate: date,
      workout,
      exercise,
      setNo,
      weight: toKgForSave(w, unit),
      reps: Math.trunc(r),
      notes: next.length ? `DROPS: ${next.join(', ')}` : '',
      durable,
    });
  };

  const onSave = () => {
    const w = pyFloat(weight);
    const r = pyFloat(reps);
    // 061: 0 kg is a valid (bodyweight) set — only reps still gate.
    if (w === null || r === null || w < 0 || r <= 0) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Logging a prefill as-is whitens both fields immediately (before the
    // refetch flips `logged`).
    setWeightDirty(true);
    setRepsDirty(true);
    save.mutate(
      {
        workoutDate: date,
        workout,
        exercise,
        setNo,
        // THE conversion boundary: pounds become kilograms here and nowhere
        // else. kg mode passes through verbatim (no new rounding on metric).
        weight: toKgForSave(w, unit),
        reps: Math.trunc(r),
        notes: drops.length ? `DROPS: ${drops.join(', ')}` : '',
        durable,
      },
      {
        // Confirmed state only: the float fires on a REAL insert verdict,
        // never optimistically -- a failed save must not celebrate.
        // (No startRest() here — the COMPACT variant has no rest timer.)
        onSuccess: (verdict) => {
          if (verdict.action === 'insert') setFloatXp(true);
          const isPr = (verdict.action === 'insert' || verdict.action === 'update') && verdict.is_pr;
          if (isPr) onPr();
          // Retro reward SFX: a PR fanfare trumps the coin; a plain re-log ticks.
          if (isPr) playPr();
          else if (verdict.action === 'insert') playCoin();
          else if (verdict.action === 'update') playSelect();
          onLogged?.(verdict);
        },
      }
    );
  };

  return (
    <View style={{ marginBottom: 8 }}>
      {/* Req 9: the one grid — SET n | weight stepper | reps stepper | LOG. */}
      <View className="flex-row items-center gap-s1 px-[2px]">
        {floatXp ? <FloatingXP amount={XP_PER_SET} onDone={() => setFloatXp(false)} /> : null}
        <View className="justify-center" style={{ width: 34 }}>
          <Text
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 0.5, color: colors['text-mute'], ...pixelFont(false) }}
          >
            SET {setNo}
          </Text>
        </View>
        <HorizontalStepper
          value={weight}
          onChange={(v) => {
            setWeightDirty(true);
            setWeight(v);
          }}
          step={WEIGHT_STEP[unit].step}
          bigStep={WEIGHT_STEP[unit].bigStep}
          quickSteps={WEIGHT_STEP[unit].quick}
          placeholder={unit}
          label={`WEIGHT · ${unit.toUpperCase()}`}
          tint={tint}
          dim={!logged && prefill !== null && !weightDirty}
          testID={`${exercise}-w-${setNo}`}
        />
        <HorizontalStepper
          value={reps}
          onChange={(v) => {
            setRepsDirty(true);
            setReps(v);
          }}
          step={1}
          integer
          placeholder="reps"
          label="REPS"
          tint={tint}
          dim={!logged && prefill !== null && !repsDirty}
          testID={`${exercise}-r-${setNo}`}
        />
        <LogButton state={logState} saving={save.isPending} onPress={onSave} testID={`${exercise}-save-${setNo}`} />
      </View>
      {/* Drop-set chips + the add affordance (once the set is banked). */}
      {logged || drops.length > 0 ? (
        <View className="flex-row flex-wrap items-center px-[2px] pt-s1" style={{ gap: 6 }}>
          {drops.map((d, i) => (
            <Pressable
              key={`${d}:${i}`}
              onPress={() => saveDrops(drops.filter((_, j) => j !== i))}
              accessibilityRole="button"
              accessibilityLabel={`remove drop ${d}`}
              className="rounded-pill border px-s2 py-s1"
              style={{ borderColor: `${colors.warn}59`, backgroundColor: 'rgba(251,191,36,0.07)' }}
              testID={`${exercise}-drop-${setNo}-${i}`}
            >
              <Text allowFontScaling={false} className="text-2xs font-bold" style={{ color: colors.warn }}>
                ↓ {d} ✕
              </Text>
            </Pressable>
          ))}
          {logged ? (
            <Pressable
              onPress={() => setDropPad({ stage: 'w' })}
              accessibilityRole="button"
              accessibilityLabel={`add a drop set to set ${setNo}`}
              className="rounded-pill border px-s2 py-s1"
              style={{ borderColor: colors.border, minHeight: 28, justifyContent: 'center' }}
              testID={`${exercise}-adddrop-${setNo}`}
            >
              <Text allowFontScaling={false} className="text-2xs font-bold text-text-dim">＋ DROP</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {dropPad ? (
        <KeyPad
          label={dropPad.stage === 'w' ? `DROP WEIGHT · ${unit.toUpperCase()}` : 'DROP REPS'}
          initial=""
          integer={dropPad.stage === 'r'}
          tint={colors.warn}
          quickSteps={dropPad.stage === 'w' ? WEIGHT_STEP[unit].quick : undefined}
          onDone={(v) => {
            const n = pyFloat(v);
            if (n === null || n <= 0) return;
            if (dropPad.stage === 'w') {
              // KeyPad fires onDone THEN onClose — `keep` survives that close
              // exactly once, so the reps pad stays up.
              setDropPad({ stage: 'r', w: v, keep: true });
            } else {
              saveDrops([...drops, `${dropPad.w}×${Math.trunc(n)}`]);
              setDropPad(null);
            }
          }}
          onClose={() => setDropPad((p) => (p?.keep ? { ...p, keep: false } : null))}
        />
      ) : null}
    </View>
  );
}
