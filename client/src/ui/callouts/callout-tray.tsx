import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import { useCoinTotal } from '@/data/coins';
import {
  loadFieldLabel,
  loadFieldSign,
  type ExerciseLoadMode,
} from '@/domain/exercise-load';
import { putSetDraft } from '@/state/set-draft';
import { NumberField } from '@/ui/core/number-field';
import { displayWeight, toKgForSave, WEIGHT_STEP } from '@/domain/units';
import { pyFloat, pyInt } from '@/domain/py';
import {
  isAboveProgramRefusal,
  useCalloutConfig,
  useCreateCallout,
  useForgeTrialAllowance,
  useMyCallouts,
} from '@/data/callouts';
import { trialCeiling } from '@/domain/forge-trial';
import { useTrainingFriends } from '@/data/presence';
import { useFriends } from '@/data/social';
import {
  DEFAULT_CALLOUT_CONFIG,
  calloutTargetLabel,
  clampCalloutStake,
  maxCalloutStake,
  type CalloutTarget,
} from '@/domain/callouts';
import type { WorkoutRow } from '@/domain/summary';
import type { WeightUnit } from '@/domain/units';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ChipWagerTable } from '@/ui/duel/chip-table';
import { FORGE_CHIPS } from '@/domain/forge-duel';


/**
 * CALL THIS SET.
 *
 * A tray over the workout, never a screen. The logger stays visible behind it,
 * the athlete never leaves Train, and nothing here is a form: the exercise, the
 * load and the reps are ALREADY KNOWN — they come from the row the athlete is
 * about to log — so the only two decisions are how much and who.
 *
 * THE FASTEST PATH IS TWO TAPS: a chip, then SEND. The friend is preselected
 * (whoever was last called, else somebody training right now, else the only
 * friend there is), the stake starts empty, and a chip tap fills it. Flicking a
 * chip at the table does the same thing with more feeling.
 *
 * HEIGHT: the brief asked for 30–35%. It is ~44% here, and that is a deliberate
 * miss rather than an accident. A real chip table under about 100pt reads as
 * decoration rather than as objects, and the proposition — the thing the whole
 * feature exists to state — has to be the most legible text on screen. Squeezing
 * both into a third of a phone produces a cramped sheet that serves neither. The
 * workout is still visible behind it and it collapses the moment SEND lands.
 */
export function CalloutTray({
  visible,
  onClose,
  date,
  workout,
  exercise,
  setNo,
  target,
  unit,
  rows,
  todayIso,
  /** How many call outs this athlete has already sent this session — the
   *  "do they run it back?" measurement, and nothing else. */
  sessionSeq,
}: {
  visible: boolean;
  onClose: () => void;
  date: string;
  workout: string;
  exercise: string;
  setNo: number;
  target: CalloutTarget;
  unit: WeightUnit;
  rows: WorkoutRow[];
  todayIso: string;
  sessionSeq: number;
}) {
  const colors = useThemeColors();
  const { height } = useWindowDimensions();
  const friends = useFriends();
  const balanceQuery = useCoinTotal();
  const cfgQuery = useCalloutConfig();
  const callouts = useMyCallouts();
  const create = useCreateCallout();
  const allowanceQuery = useForgeTrialAllowance(visible ? exercise : null, date);

  const cfg = cfgQuery.data ?? DEFAULT_CALLOUT_CONFIG;
  // NULL on any failure, never 0 (the coins doctrine) — so an unreadable wallet
  // shows no affordance rather than a wrong one.
  const balance = balanceQuery.data;
  const friendList = useMemo(() => friends.data ?? [], [friends.data]);
  const trainingNow = useTrainingFriends(friendList.map((f) => f.id));
  const trainingIds = new Set(trainingNow.map((t) => t.userId));

  /**
   * WHO, BY DEFAULT. Last person you called → somebody training right now →
   * the only friend you have. A preselected opponent is the difference between
   * two taps and four, and it is almost always right.
   */
  const suggested = useMemo(() => {
    const previous = (callouts.data ?? []).find((c) => c.i_am_athlete)?.opponent_id;
    if (previous && friendList.some((f) => f.id === previous)) return previous;
    const live = friendList.find((f) => trainingIds.has(f.id));
    if (live) return live.id;
    return friendList[0]?.id ?? null;
    // trainingIds is rebuilt each render; its CONTENTS are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callouts.data, friendList, trainingNow.length]);

  const [picked, setPicked] = useState<string | null>(null);
  const opponentId = picked ?? suggested;
  const [pickedStake, setStake] = useState(0);

  /**
   * THE CALL IS EDITABLE (Tyson, 2026-08-08).
   *
   * It opens on the numbers the set row is showing — that is still the point,
   * and it is why nobody has to type anything — but "I'm going for one more
   * than that" is exactly the moment a call out gets interesting, and it should
   * not require closing the tray to say so.
   *
   * Editing here writes BACK to the set row (state/set-draft.ts), so the call
   * and the set stay one number. Otherwise calling 105 × 5 and then logging the
   * 100 × 5 you were always going to do would be a miss you never chose.
   */
  const wantsLoad =
    target.loadMode === 'external' ||
    target.loadMode === 'weighted_bodyweight' ||
    target.loadMode === 'assisted_bodyweight';
  const [tgtWeight, setTgtWeight] = useState(() =>
    target.weightKg === null ? '' : displayWeight(target.weightKg, unit)
  );
  const [tgtReps, setTgtReps] = useState(() => String(target.reps));

  const liveTarget: CalloutTarget = {
    loadMode: target.loadMode,
    weightKg: wantsLoad
      ? pyFloat(tgtWeight) === null
        ? null
        : toKgForSave(pyFloat(tgtWeight) as number, unit)
      : null,
    reps: Math.max(0, pyInt(tgtReps) ?? 0),
  };

  /** Push an edit down to the row this call is about. */
  const publish = (weightText: string, repsText: string) => {
    const w = pyFloat(weightText);
    putSetDraft(
      date,
      workout,
      exercise,
      setNo,
      {
        weightKg: !wantsLoad || w === null ? null : toKgForSave(w, unit),
        reps: pyInt(repsText),
        loadMode: target.loadMode as ExerciseLoadMode,
      },
      'tray'
    );
  };
  // WHEN THE TRAY OPENED — the "time from opening Call Out to offer sent"
  // measurement the brief asks for. Stamped in an effect: reading the wall
  // clock during render is impure and the compiler lint is right to refuse it.
  const opened = useRef(0);
  useEffect(() => {
    opened.current = Date.now();
  }, []);

  // NO ESTIMATE. The tray used to recompute a hit probability on every edit and
  // show it. v5 §4: settlement is fixed and symmetric, and nothing may be displayed
  // as odds — so there is nothing to estimate and nothing to quote.

  const label = calloutTargetLabel(liveTarget, unit);
  /**
   * THE RAIL IS SIZED BY THE SERVER'S CEILING, NOT JUST THE WALLET.
   *
   * `forge_trial_allowance` holds the escalation ramp, the miss-ends-the-day rule
   * and the rest-day check — none of which the client can compute. Before this the
   * tray offered whatever the wallet held, so an athlete whose ramp topped out at
   * 120 could pick 400, press pledge, and be refused at the moment of commit.
   *
   * `trialCeiling` only ever narrows, and a missing allowance falls back to the
   * wallet — an unread limit must not silently become a zero one.
   */
  const ceiling = trialCeiling(maxCalloutStake(balance ?? 0, cfg), allowanceQuery.data);
  const max = ceiling.max;
  /**
   * THE CEILING CAN MOVE UNDER AN OPEN TRAY: a set logged on another device, a
   * pledge that settled, or the allowance query simply landing a moment after
   * the sheet did. A chip picked under the old ceiling must not survive into a
   * send the server will refuse.
   *
   * DERIVED, NOT AN EFFECT. Clamping in a useEffect is a second render pass over
   * state React can compute directly, and the compiler rejects it, correctly.
   */
  const stake = Math.min(pickedStake, max);
  const canSend =
    opponentId !== null &&
    !ceiling.blocked &&
    stake >= cfg.min_stake &&
    stake <= max &&
    liveTarget.reps > 0 &&
    (!wantsLoad || liveTarget.weightKg !== null) &&
    !create.isPending;

  /**
   * ABOVE YOUR OWN BEST (174 · 176) — ASKED, NEVER SUGGESTED.
   *
   * Tyson overrode the flat refusal on 2026-08-09: an athlete may pledge on a
   * target above anything they have logged, with the onus on them. What he did
   * NOT override is v5.1's other half — the app may never solicit a max attempt.
   *
   * So there is no badge, no hint and no "go bigger" affordance anywhere in this
   * tray. Nothing appears until the athlete has typed an above-best target of
   * their own accord and pressed pledge, and the server has refused it. The
   * athlete's own decision is the trigger; this panel only spells out what they
   * are accepting and lets them say yes or change the number.
   *
   * IT IS PER TARGET. Editing the weight or the reps clears it, so an
   * acknowledgement of 110 kg can never travel silently to 130.
   */
  const [confirmAbove, setConfirmAbove] = useState(false);

  const send = (aboveProgramAck = false) => {
    if (!canSend || opponentId === null) return;
    create.mutate(
      {
        aboveProgramAck,
        opponentId,
        workoutDate: date,
        workout,
        exercise,
        setNo,
        targetReps: liveTarget.reps,
        targetLoadMode: liveTarget.loadMode,
        targetWeightKg: liveTarget.weightKg,
        targetLabel: label,
        stake,
        msToSend: Date.now() - opened.current,
        sessionSeq,
      },
      {
        onSuccess: () => {
          setStake(0);
          setConfirmAbove(false);
          onClose();
        },
        onError: (e) => {
          // The one refusal with an answer. Everything else has already gone out
          // as a toast from the mutation itself.
          if (isAboveProgramRefusal(e)) setConfirmAbove(true);
        },
      }
    );
  };

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: 'rgba(2,5,11,0.72)' }}
        onPress={onClose}
        accessibilityLabel="Close the call out tray"
      >
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t p-s4"
          style={{
            borderColor: `${colors.legendary}45`,
            backgroundColor: colors.surface,
            /**
             * TALLER THAN THE BRIEF ASKED FOR, on purpose and on request.
             *
             * 30–35% was the target; at 50% the chip rail still fell below the
             * fold, so the two-tap path began with a scroll. The tray now takes
             * roughly two thirds, because everything in it is load-bearing: the
             * proposition, the odds, WHO, a chip table big enough to be objects
             * rather than decoration, the rail, and SEND. The workout is still
             * visible behind it and it collapses the instant the offer goes.
             */
            maxHeight: Math.min(height * 0.72, 620),
          }}
          testID="callout-tray"
        >
          {/* ── THE PROPOSITION IS THE DOMINANT THING ON THIS SHEET, and it is
              PINNED. It scrolled out of frame the moment a chip went in, which
              left an athlete looking at a wager whose terms were off-screen —
              the one line the whole feature exists to state. Pinned at the top,
              SEND pinned at the bottom, everything else scrolls between them. ── */}
          <View className="flex-row items-start justify-between">
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                allowFontScaling={false}
                className="text-text-mute"
                numberOfLines={1}
                style={{ fontSize: 8, letterSpacing: 1.6 }}
                testID="callout-exercise"
              >
                CALL THIS SET · {exercise.toUpperCase()}
              </Text>
              <Text
                allowFontScaling={false}
                testID="callout-target"
                style={{ fontSize: 22, lineHeight: 26, color: colors.legendary, ...pixelFont() }}
              >
                {label}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              testID="callout-tray-close"
              style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center' }}
            >
              <Text className="text-sm text-text-mute">✕</Text>
            </Pressable>
          </View>

          {/* THE CALL, EDITABLE. Same steppers as the set row, same units, and
              every change goes back to the row so the two can never disagree.
              NumberField draws no label of its own — the set row's column
              headers do that job there — so the tray needs its own, or the two
              controls are a pair of bare numbers. */}
          <View className="mt-s2 flex-row items-center" style={{ gap: 8 }}>
            <View style={{ width: 72 }}>
              <Text
                allowFontScaling={false}
                className="text-text-mute"
                numberOfLines={1}
                style={{ fontSize: 8, letterSpacing: 1 }}
              >
                {wantsLoad
                  ? `${loadFieldSign(target.loadMode) ?? ''}${(loadFieldLabel(target.loadMode) ?? 'WEIGHT').toUpperCase()} ${unit.toUpperCase()}`
                  : 'BODYWEIGHT'}
              </Text>
            </View>
            <View style={{ width: 32 }} />
            <View style={{ width: 72 }}>
              <Text
                allowFontScaling={false}
                className="text-text-mute"
                numberOfLines={1}
                style={{ fontSize: 8, letterSpacing: 1 }}
              >
                REPS OR MORE
              </Text>
            </View>
          </View>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            {wantsLoad ? (
              <NumberField
                value={tgtWeight}
                onChange={(v) => {
                  setTgtWeight(v);
                  setConfirmAbove(false);
                  publish(v, tgtReps);
                }}
                step={WEIGHT_STEP[unit].step}
                bigStep={WEIGHT_STEP[unit].bigStep}
                quickSteps={WEIGHT_STEP[unit].quick}
                placeholder={unit}
                label={`${loadFieldSign(target.loadMode) ? `${loadFieldSign(target.loadMode)} ` : ''}${(
                  loadFieldLabel(target.loadMode) ?? 'WEIGHT'
                ).toUpperCase()} · ${unit.toUpperCase()}`}
                tint={colors.legendary}
                width={72}
                testID="callout-target-weight"
              />
            ) : (
              <View
                className="items-center justify-center rounded-md border"
                style={{
                  width: 72,
                  minHeight: 48,
                  borderColor: `${colors.legendary}59`,
                  backgroundColor: `${colors.legendary}14`,
                }}
                accessibilityLabel="Bodyweight set — no external load"
                testID="callout-target-bw"
              >
                <Text allowFontScaling={false} style={{ fontSize: 16, color: colors.legendary, ...pixelFont() }}>
                  BW
                </Text>
              </View>
            )}
            <NumberField
              value={tgtReps}
              onChange={(v) => {
                setTgtReps(v);
                setConfirmAbove(false);
                publish(tgtWeight, v);
              }}
              step={1}
              integer
              placeholder="reps"
              label="REPS OR MORE"
              tint={colors.legendary}
              width={72}
              testID="callout-target-reps"
            />
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* ── WHO ── */}
            {friendList.length === 0 ? (
              <Text className="text-2xs text-text-mute">
                Add a friend and you can put coins on this.
              </Text>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6, paddingVertical: 2 }}
              >
                {friendList.map((f) => {
                  const on = f.id === opponentId;
                  const live = trainingIds.has(f.id);
                  return (
                    <Pressable
                      key={f.id}
                      onPress={() => setPicked(f.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`Call out ${f.display_name}${live ? ', training now' : ''}`}
                      testID={`callout-friend-${f.id}`}
                      className="flex-row items-center rounded-pill border px-s3"
                      style={{
                        gap: 6,
                        minHeight: 44,
                        borderColor: on ? colors.accent : colors.border,
                        backgroundColor: on ? 'rgba(34,211,238,0.12)' : 'rgba(13,21,36,0.5)',
                      }}
                    >
                      <Text
                        allowFontScaling={false}
                        className="text-2xs font-bold"
                        style={{ color: on ? colors.accent : colors['text-dim'] }}
                        numberOfLines={1}
                      >
                        {f.display_name.toUpperCase()}
                      </Text>
                      {/* TRAINING NOW. A dot, not a sentence — it says "they are
                          holding their phone", which is the only thing that
                          matters when you are about to call a set. */}
                      {live ? (
                        <View
                          testID={`callout-friend-live-${f.id}`}
                          style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success }}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            {/* WHAT TODAY ALLOWS, said before the athlete commits rather than
                after — §4 asks for the limit inline, and the server's own
                sentence is the one that will be enforced, so it is the one
                shown. Absent when nothing but the wallet is binding. */}
            {ceiling.note ? (
              <Text
                className="mt-s2 text-2xs"
                style={{ color: ceiling.blocked ? colors.warn : colors['text-dim'] }}
                testID="callout-allowance-note"
              >
                {ceiling.note}
              </Text>
            ) : null}

            {/* ── THE MONEY, as objects ── */}
            <View className="mt-s2">
              <ChipWagerTable
                value={stake}
                onChange={(next) => setStake(clampCalloutStake(next, balance ?? 0, cfg))}
                balance={balance ?? 0}
                min={cfg.min_stake}
                max={max}
                potLabel="POOL IF THEY PUSH"
                compact
                tableHeight={132}
                chipSize={46}
                // EVERY DENOMINATION, 5 INCLUDED (Tyson, 2026-08-08). The first
                // build offered 25 as the smallest, which quietly made 25 the
                // real minimum stake even though the config's floor is 5 — a
                // limit nobody chose, expressed as a missing button. The rail
                // scrolls; the wallet and the config decide what is affordable.
                denominations={FORGE_CHIPS}
                disabled={balance == null || ceiling.blocked}
                testID="callout-table"
              />
            </View>

          </ScrollView>

          {/* PINNED, OUTSIDE THE SCROLL. The first build put SEND at the end of
              a ScrollView and the screenshot showed it — and the chip rail —
              below the fold on a 390×844 phone. A two-tap interaction whose
              second tap needs a scroll first is not a two-tap interaction. */}
          <View className="mt-s2">
            {confirmAbove ? (
              /* Plain statement, no encouragement. It says what is true — the
                 target is above their logged best and the coins are identical
                 either way — so there is nothing here that makes the attempt
                 more attractive than it was before they typed it. */
              <View
                className="rounded-md border p-s3"
                style={{ borderColor: `${colors.warn}66`, backgroundColor: `${colors.warn}10` }}
                testID="callout-above-program"
              >
                <Text
                  allowFontScaling={false}
                  className="text-2xs"
                  style={{ color: colors.warn, letterSpacing: 1 }}
                >
                  ABOVE YOUR BEST
                </Text>
                <Text className="mt-s1 text-2xs text-text-dim">
                  {label} is more than anything you have logged for {exercise}. The coins
                  pay the same either way — send this only if you had already decided to
                  attempt it.
                </Text>
                <View className="mt-s2 flex-row" style={{ gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <NeonButton
                      title="CHANGE THE TARGET"
                      variant="ghost"
                      pixel
                      onPress={() => setConfirmAbove(false)}
                      testID="callout-above-cancel"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <NeonButton
                      title={create.isPending ? 'SENDING…' : 'I HAVE DECIDED'}
                      pixel
                      disabled={!canSend}
                      busy={create.isPending}
                      onPress={() => send(true)}
                      testID="callout-above-confirm"
                    />
                  </View>
                </View>
              </View>
            ) : (
              <>
                <NeonButton
                  title={
                    create.isPending
                      ? 'SENDING…'
                      : ceiling.blocked
                        ? 'NOT TODAY'
                        : stake > 0
                          ? `PLEDGE ${stake} ON THIS SET`
                          : 'PICK AN INGOT'
                  }
                  size="hero"
                  pixel
                  disabled={!canSend}
                  busy={create.isPending}
                  onPress={() => send()}
                  testID="callout-send"
                />
                <Text className="mt-s1 text-center text-2xs text-text-mute">
                  Nothing leaves your wallet until they take it.
                </Text>
              </>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
