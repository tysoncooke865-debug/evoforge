import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { captureCameraPhoto } from '@/data/ai';
import { useAuth } from '@/data/auth-context';
import {
  useBattleBundle,
  useBattleChannel,
  useBattleMediaUrl,
  type BattleBundle,
  type BattleMediaRow,
  type BattleParticipant,
  type BattleRound,
} from '@/data/battle/hooks';
import { revealReady, sideState } from '@/data/battle/physique-reveal';
import {
  postBattleCardio,
  postBattleVolume,
  useBattlePhysique,
  useBattlePick,
  useCancelBattle,
  useReadyUp,
  useSettleBattle,
} from '@/data/battle/mutations';
import { useCustomPlan, useWorkoutLog } from '@/data/hooks';
import { useLogCardio, useSaveSet } from '@/data/mutations';
import { ROUTINE, ROUTINE_ORDER } from '@/domain/catalogs';
import { normaliseWorkoutLog } from '@/domain/summary';
import { CoinFlip } from '@/ui/coin-flip';
import { ExerciseCard } from '@/ui/exercise-logger';
import { NumberField } from '@/ui/number-field';
import {
  cardioChallengeByKey,
  objectByKey,
  PICK_GROUPS,
  pickGroupByKey,
  poseByKey,
  totalEffectiveKg,
  totalEnergyUnits,
  type CardioEvent,
  type VolumeEvent,
} from '@/domain/battle/engine';
import { pyFloat, pyInt } from '@/domain/py';
import { useToastStore } from '@/state/toast-store';
import { BLITZ_RULES, CodeCard, RulesStrip } from '@/ui/battle-arena';
import { BattleRulesPanel, FaceOffScene, ReadyCTA } from '@/ui/face-off';
import { EdgeLabel } from '@/ui/hud';
import { Chip, NeonButton } from '@/ui/neon-button';
import { ScreenHeader } from '@/ui/screen-header';
import { GlowCard, ScreenShell } from '@/ui/shell';
import tokens from '@/theme/tokens';

const BATTLE_WORKOUT = 'Battle Arena';

const formatName = (f: string | null | undefined): string =>
  f === 'volume_duel' ? 'VOLUME DUEL' : f === 'heads_or_tails' ? 'HEADS OR TAILS' : 'FRIENDLY BLITZ';

const DUEL_RULES = [
  { glyph: '⚖', text: 'Every set counts' },
  { glyph: '⏱', text: 'Seventy-five minutes' },
  { glyph: '🏆', text: 'Most weight moved wins' },
] as const;

/** Curated blitz picks: barbell pay full rate, the rest teach the coefficient. */
const BATTLE_EXERCISES = [
  'Barbell Bench Press (Strength)',
  'Barbell Back Squat',
  'Romanian Deadlift',
  'T-Bar Row',
  'Lat Pulldown',
  'Leg Press',
  'Hack Squat Machine',
  'Machine Chest Press',
];

/**
 * The battle screen, phase by match status: inviting (share the code) →
 * matched (VS + ready) → active (the live round) → settled (the verdict).
 * All state is rows; realtime + a slow poll keep both athletes honest.
 * The client only PREVIEWS scores — the settle function decides.
 */
export default function BattleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = typeof id === 'string' ? id : null;
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const bundle = useBattleBundle(matchId);
  useBattleChannel(matchId);

  if (!bundle.data?.match) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="BATTLE ARENA" title="LOADING…" />
      </ScreenShell>
    );
  }

  const data = bundle.data;
  const match = data.match!;
  const me = data.participants.find((p) => p.user_id === userId) ?? null;
  const them = data.participants.find((p) => p.user_id !== userId) ?? null;

  return (
    <ScreenShell>
      {match.status === 'inviting' ? <InvitePhase matchId={match.id} code={match.invite_code} format={match.format} /> : null}
      {match.status === 'matched' ? <VsPhase matchId={match.id} me={me} them={them} format={match.format} /> : null}
      {match.status === 'active' ? (
        <ActivePhase matchId={match.id} data={data} me={me} them={them} userId={userId} />
      ) : null}
      {match.status === 'settled' ? <ResultsPhase data={data} me={me} them={them} /> : null}
      {match.status === 'abandoned' ? <AbandonedPhase match={match} me={me} them={them} /> : null}
    </ScreenShell>
  );
}

// ------------------------------------------------------------------ phases

function InvitePhase({ matchId, code, format }: { matchId: string; code: string | null; format: string | null }) {
  const router = useRouter();
  const cancel = useCancelBattle(matchId);
  const duel = format === 'volume_duel';
  return (
    <>
      <ScreenHeader kicker={formatName(format)} title="CHALLENGE SENT" />
      <GlowCard glow={duel ? tokens.colors.danger : tokens.colors.accent}>
        {code ? <CodeCard code={code} /> : null}
        <Text className="mt-s3 text-center text-2xs text-text-mute">
          Waiting for a challenger… the screen advances the moment they join.
        </Text>
      </GlowCard>
      <RulesStrip rules={duel ? DUEL_RULES : BLITZ_RULES} />
      <NeonButton
        title="CANCEL INVITE"
        variant="ghost"
        onPress={() => cancel.mutate(undefined, { onSuccess: () => router.replace('/arena') })}
        busy={cancel.isPending}
        testID="battle-cancel"
      />
    </>
  );
}

/**
 * IMPROVEMENT_PLAN #5: the web-safe confirmation overlay (Alert.alert is
 * unimplemented on react-native-web). Nothing destructive happens without
 * this explicit second tap.
 */
function ConfirmAbandon({
  visible,
  busy,
  onConfirm,
  onKeep,
}: {
  visible: boolean;
  busy: boolean;
  onConfirm: () => void;
  onKeep: () => void;
}) {
  if (!visible) return null;
  return (
    <View
      className="absolute inset-0 items-center justify-center px-s5"
      style={{ backgroundColor: 'rgba(2,6,12,0.85)', zIndex: 50 }}
    >
      <View
        className="w-full max-w-[420px] rounded-xl p-s5"
        style={{ borderWidth: 1, borderColor: `${tokens.colors.danger}59`, backgroundColor: tokens.colors.surface }}
      >
        <Text className="text-lg font-bold text-text" style={{ letterSpacing: 1 }}>
          ABANDON BATTLE?
        </Text>
        <Text className="mt-s2 text-xs text-text-dim">
          This ends it for both players — no XP, no winner, no way back in.
        </Text>
        <View className="mt-s4 gap-s2">
          <NeonButton title="ABANDON BATTLE" variant="danger" onPress={onConfirm} busy={busy} testID="confirm-abandon" />
          <NeonButton title="KEEP FIGHTING" variant="ghost" onPress={onKeep} testID="keep-fighting" />
        </View>
      </View>
    </View>
  );
}

/** A quiet exit affordance + the confirm overlay, shared by VS and rounds. */
function AbandonControl({ matchId }: { matchId: string }) {
  const [confirming, setConfirming] = useState(false);
  const cancel = useCancelBattle(matchId);
  return (
    <>
      <Pressable
        onPress={() => setConfirming(true)}
        accessibilityRole="button"
        className="min-h-[44px] items-center justify-center"
        testID="battle-abandon"
      >
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
          ABANDON BATTLE
        </Text>
      </Pressable>
      <ConfirmAbandon
        visible={confirming}
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate(undefined, { onSuccess: () => setConfirming(false) })}
        onKeep={() => setConfirming(false)}
      />
    </>
  );
}

function AbandonedPhase({
  match,
  me,
  them,
}: {
  match: { cancelled_by: string | null };
  me: BattleParticipant | null;
  them: BattleParticipant | null;
}) {
  const router = useRouter();
  const byMe = match.cancelled_by !== null && match.cancelled_by === me?.user_id;
  const who = byMe ? 'You ended it' : `${them?.snapshot.name ?? 'Your opponent'} ended it`;
  return (
    <>
      <ScreenHeader kicker="FRIENDLY BLITZ" title="BATTLE CANCELLED" />
      <GlowCard>
        <Text className="text-center text-sm text-text-dim">{who}. No XP, no winner — the arena forgets fast.</Text>
      </GlowCard>
      <NeonButton title="BACK TO THE ARENA" variant="ghost" onPress={() => router.replace('/arena')} />
    </>
  );
}

function VsPhase({ matchId, me, them, format }: { matchId: string; me: BattleParticipant | null; them: BattleParticipant | null; format: string | null }) {
  const ready = useReadyUp(matchId);
  const iAmReady = me?.ready_at != null;
  const duel = format === 'volume_duel';
  return (
    <>
      <ScreenHeader kicker={formatName(format)} title="FACE OFF" />
      <FaceOffScene me={me} them={them} />
      <BattleRulesPanel rules={duel ? DUEL_RULES : BLITZ_RULES} />
      <ReadyCTA
        title={iAmReady ? 'WAITING FOR OPPONENT…' : 'READY UP'}
        onPress={() => ready.mutate()}
        disabled={iAmReady}
        busy={ready.isPending}
        testID="battle-ready"
      />
      <Text className="text-center text-2xs text-text-mute">
        {duel
          ? 'When both athletes are ready the 75-minute window opens — your whole workout counts.'
          : 'When both athletes are ready the object is rolled and the 12-minute bell sounds.'}
      </Text>
      <AbandonControl matchId={matchId} />
    </>
  );
}

/** Seconds remaining, or null before the first tick lands (never a false TIME). */
function useCountdown(endsAt: string | null): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // First tick rides a macrotask: a synchronous setState inside an effect
    // is a cascading-render lint error (CI caught it; a stale local ESLint
    // cache had hidden it).
    const update = () => setNow(Date.now());
    const first = setTimeout(update, 0);
    const t = setInterval(update, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  if (!endsAt || now === null) return null;
  return Math.max(0, Math.trunc((new Date(endsAt).getTime() - now) / 1000));
}

const toVolume = (e: { payload: { exercise?: string; weight?: number; reps?: number }; server_ts: string }): VolumeEvent => ({
  exercise: String(e.payload.exercise ?? ''),
  weightKg: Number(e.payload.weight ?? 0) || 0,
  reps: Number(e.payload.reps ?? 0) || 0,
  serverTs: e.server_ts,
});

const toCardio = (e: { payload: Record<string, unknown>; server_ts: string }): CardioEvent => ({
  type: String(e.payload.type ?? ''),
  minutes: Number(e.payload.minutes ?? 0) || 0,
  distanceKm: Number(e.payload.distance_km ?? 0) || 0,
  serverTs: e.server_ts,
});

function ProgressBar({ pct, colour, label, kg, unit = 'kg' }: { pct: number; colour: string; label: string; kg: number; unit?: string }) {
  return (
    <View className="mb-s2">
      <View className="mb-s1 flex-row justify-between">
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
          {label}
        </Text>
        <Text className="text-2xs font-bold" style={{ color: colour }}>
          {Math.trunc(pct)}% · {Math.trunc(kg)} {unit}
        </Text>
      </View>
      <View className="h-s3 overflow-hidden rounded-pill bg-surface-3">
        <View
          style={{
            width: `${Math.min(100, pct)}%`,
            height: '100%',
            borderRadius: 999,
            backgroundColor: colour,
            minWidth: pct > 0 ? 4 : 0,
            shadowColor: colour,
            shadowOpacity: 0.6,
            shadowRadius: 8,
          }}
        />
      </View>
    </View>
  );
}

/** Which round we're in, with the scores banked so far. */
function RoundStrip({ data, userId }: { data: BattleBundle; userId: string | null }) {
  const current = data.match?.current_round ?? 1;
  // Single-round duels have no round journey to narrate.
  if (data.match && ['volume_duel', 'heads_or_tails'].includes(String(data.match.format))) return null;
  return (
    <View className="flex-row gap-s2">
      {[1, 2, 3].map((n) => {
        const mine = data.scores.find((s) => s.round_no === n && s.user_id === userId);
        const live = n === current && !mine;
        const kindLabel = n === 1 ? 'STR' : n === 2 ? 'CARDIO' : 'PHYSIQUE';
        return (
          <View
            key={n}
            className="flex-1 items-center rounded-md py-s2"
            style={{
              borderWidth: 1,
              borderColor: live ? `${tokens.colors.accent}66` : tokens.colors.border,
              backgroundColor: live ? 'rgba(34,211,238,0.08)' : 'rgba(13,21,36,0.5)',
            }}
          >
            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
              R{n} {kindLabel}
            </Text>
            <Text className={`text-sm font-bold ${live ? 'text-accent' : mine ? 'text-text' : 'text-text-mute'}`}>
              {mine ? mine.points : live ? 'LIVE' : '—'}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function ActivePhase({
  matchId,
  data,
  me,
  them,
  userId,
}: {
  matchId: string;
  data: BattleBundle;
  me: BattleParticipant | null;
  them: BattleParticipant | null;
  userId: string | null;
}) {
  const currentNo = data.match?.current_round ?? 1;
  const round = data.rounds.find((r) => r.round_no === currentNo) ?? null;
  if (!round) return null;
  return (
    <>
      {round.kind === 'volume_duel' ? (
        <VolumeDuelRound matchId={matchId} data={data} round={round} me={me} them={them} userId={userId} />
      ) : round.kind === 'heads_or_tails' ? (
        <HeadsOrTailsRound matchId={matchId} data={data} round={round} me={me} them={them} userId={userId} />
      ) : round.kind === 'strength' ? (
        <StrengthRound matchId={matchId} data={data} round={round} me={me} them={them} userId={userId} />
      ) : round.kind === 'cardio' ? (
        <CardioRound matchId={matchId} data={data} round={round} me={me} them={them} userId={userId} />
      ) : (
        <PhysiqueRound matchId={matchId} data={data} round={round} userId={userId} />
      )}
      <RoundStrip data={data} userId={userId} />
      <AbandonControl matchId={matchId} />
    </>
  );
}

interface RoundProps {
  matchId: string;
  data: BattleBundle;
  round: BattleRound;
  me: BattleParticipant | null;
  them: BattleParticipant | null;
  userId: string | null;
}

/**
 * HEADS OR TAILS (design §16, MG2): three server-side coin flips assign a
 * muscle group and each athlete's exercise; then a 30-minute locked duel —
 * most effective kg on YOUR assigned exercise wins. The client never flips
 * a coin: it replays server verdicts, with a short one-shot spin ceremony
 * per step (a single timeout state flip — not frame driving).
 */
function HeadsOrTailsRound({ matchId, data, round, me, them, userId }: RoundProps) {
  const spec = round.spec as Record<string, unknown>;
  const state = String(spec.state ?? 'awaiting_muscle');
  const step = Math.min(3, Number(spec.step ?? 1));
  const face = (String(spec.face ?? 'heads') === 'tails' ? 'tails' : 'heads') as 'heads' | 'tails';
  const pickerId = spec.picker == null ? null : String(spec.picker);
  const secondsLeft = useCountdown(round.ends_at ?? null);
  const pickMut = useBattlePick(matchId);
  const settle = useSettleBattle(matchId);
  const gold = tokens.colors.legendary;

  // The ceremony: spin briefly whenever a new flip lands, then reveal.
  const [revealedStep, setRevealedStep] = useState(0);
  useEffect(() => {
    if (state === 'live') return;
    const t = setTimeout(() => setRevealedStep(step), 1500);
    return () => clearTimeout(t);
  }, [step, state]);
  const spinning = state !== 'live' && revealedStep < step;

  const group = pickGroupByKey(String(spec.muscleGroup ?? ''));
  const iAmPicker = pickerId !== null && pickerId === userId;
  const pickerName =
    pickerId === me?.user_id ? 'YOU' : String(them?.snapshot.name ?? 'YOUR RIVAL').toUpperCase();
  const seat1 = data.participants.find((p) => p.seat === 1) ?? null;
  const seat2 = data.participants.find((p) => p.seat === 2) ?? null;
  const nameOf = (p: BattleParticipant | null) =>
    p === null ? '?' : p.user_id === userId ? 'YOUR' : `${String(p.snapshot.name ?? 'RIVAL').toUpperCase()}'S`;
  const over = secondsLeft !== null && secondsLeft <= 0;
  const mm = secondsLeft === null ? '–' : String(Math.trunc(secondsLeft / 60)).padStart(1, '0');
  const ss = secondsLeft === null ? '––' : String(secondsLeft % 60).padStart(2, '0');

  if (state !== 'live') {
    const stepLabel =
      state === 'awaiting_muscle'
        ? 'THE MUSCLE GROUP'
        : state === 'awaiting_ex_p1'
          ? `${nameOf(seat1)} EXERCISE`
          : `${nameOf(seat2)} EXERCISE`;
    return (
      <>
        <ScreenHeader
          kicker={`HEADS OR TAILS · FLIP ${step} OF 3`}
          title="THE COIN DECIDES"
          titleLines={2}
          autoSize
          right={
            <Text className="text-2xl font-bold" style={{ color: gold, textShadowColor: 'rgba(251,191,36,0.6)', textShadowRadius: 14 }}>
              {over ? 'TIME' : `${mm}:${ss}`}
            </Text>
          }
        />
        <GlowCard glow={gold}>
          <View className="items-center py-s3">
            <CoinFlip spinning={spinning} face={face} />
            <Text className="mt-s3 text-center text-sm font-bold text-text" style={{ letterSpacing: 1 }}>
              {spinning ? 'THE COIN IS IN THE AIR…' : `${face.toUpperCase()} · ${pickerName} PICK${pickerName === 'YOU' ? '' : 'S'} ${stepLabel}`}
            </Text>
            <Text className="mt-s1 text-center text-2xs text-text-mute">
              Heads is seat one, tails is seat two. Three flips: the group, their exercise, yours.
            </Text>
            {group && state !== 'awaiting_muscle' ? (
              <Text className="mt-s2 text-2xs font-bold" style={{ color: gold, letterSpacing: 1.5 }}>
                GROUP LOCKED: {group.emoji} {group.name.toUpperCase()}
                {spec.exerciseSeat1 ? ` · ${nameOf(seat1)} LIFT: ${String(spec.exerciseSeat1).toUpperCase()}` : ''}
              </Text>
            ) : null}
          </View>
        </GlowCard>

        {!spinning && iAmPicker && !over ? (
          <GlowCard glow={gold}>
            <View className="mb-s3">
              <EdgeLabel>{`YOUR CALL — ${stepLabel}`}</EdgeLabel>
            </View>
            <View className="flex-row flex-wrap gap-s2">
              {state === 'awaiting_muscle'
                ? PICK_GROUPS.map((g) => (
                    <Chip
                      key={g.key}
                      label={`${g.emoji} ${g.name}`}
                      active={false}
                      onPress={() => {
                        if (!pickMut.isPending) pickMut.mutate({ pick: g.key });
                      }}
                    />
                  ))
                : (group?.exercises ?? []).map((ex) => (
                    <Chip
                      key={ex}
                      label={ex.replace(' (Strength)', '')}
                      active={false}
                      onPress={() => {
                        if (!pickMut.isPending) pickMut.mutate({ pick: ex });
                      }}
                    />
                  ))}
            </View>
          </GlowCard>
        ) : null}
        {!spinning && !iAmPicker && !over ? (
          <Text className="text-center text-2xs text-text-mute">
            {pickerName} won the toss and is choosing… the pick locks in {mm}:{ss}.
          </Text>
        ) : null}
        {!spinning && over ? (
          <NeonButton
            title="TIME'S UP · CLAIM A RANDOM PICK"
            variant="danger"
            onPress={() => pickMut.mutate({ auto: true })}
            busy={pickMut.isPending}
            testID="battle-claim-pick"
          />
        ) : null}
      </>
    );
  }

  // LIVE: locked exercises, 30-minute window, assigned-only scoring.
  const myAssigned = String(me?.seat === 1 ? spec.exerciseSeat1 ?? '' : spec.exerciseSeat2 ?? '');
  const theirAssigned = String(me?.seat === 1 ? spec.exerciseSeat2 ?? '' : spec.exerciseSeat1 ?? '');
  const liveAt = String(spec.liveAt ?? '');
  const countFor = (uid: string | null, assigned: string) =>
    totalEffectiveKg(
      data.events
        .filter((e) => (uid === null ? e.user_id !== userId : e.user_id === uid) && e.kind === 'volume' && e.round_no === round.round_no && e.server_ts >= liveAt)
        .map(toVolume)
        .filter((e) => e.exercise === assigned)
    );
  const myKg = countFor(userId, myAssigned);
  const theirKg = countFor(null, theirAssigned);
  const lead = Math.max(myKg, theirKg, 1);

  return (
    <>
      <ScreenHeader
        kicker="HEADS OR TAILS · LIVE"
        title={`OWN THE ${group ? group.name.toUpperCase() : 'LIFT'}`}
        titleLines={2}
        autoSize
        right={
          <Text className="text-2xl font-bold" style={{ color: over ? tokens.colors.danger : gold, textShadowColor: 'rgba(251,191,36,0.6)', textShadowRadius: 14 }}>
            {over ? 'TIME' : `${mm}:${ss}`}
          </Text>
        }
      />
      <GlowCard glow={myKg >= theirKg && myKg > 0 ? gold : undefined}>
        <ProgressBar
          pct={(myKg / lead) * 100}
          colour={gold}
          label={`YOU · ${myAssigned.replace(' (Strength)', '').toUpperCase()}${myKg >= theirKg && myKg > 0 ? ' · LEADING' : ''}`}
          kg={myKg}
        />
        <ProgressBar
          pct={(theirKg / lead) * 100}
          colour={tokens.colors.epic}
          label={`${String(them?.snapshot.name ?? 'RIVAL').toUpperCase()} · ${theirAssigned.replace(' (Strength)', '').toUpperCase()}${theirKg > myKg ? ' · LEADING' : ''}`}
          kg={theirKg}
        />
        <Text className="text-2xs text-text-mute">
          Only sets on YOUR assigned exercise count, logged after the coin settled. Effective kg —
          coefficients apply.
        </Text>
      </GlowCard>
      {!over ? (
        <BattleLogger matchId={matchId} roundNo={round.round_no} exercises={[myAssigned]} />
      ) : (
        <NeonButton
          title="LOCK IN THE DUEL · REVEAL THE VERDICT"
          variant="danger"
          onPress={() => settle.mutate()}
          busy={settle.isPending}
          testID="battle-settle"
        />
      )}
    </>
  );
}

/**
 * VOLUME DUEL (design §16, MG1): the Today screen wearing war paint. The
 * athlete logs their OWN day plan through the SHARED ExerciseCard — every
 * set is a real workout_log row (streak/stats/XP bank exactly like Today) —
 * and each confirmed INSERT also posts a battle 'volume' event with the
 * row id. Scores freeze at first log (the guard rebuilds payloads at event
 * insert), so a post-hoc edit can never inflate a duel.
 */
function VolumeDuelRound({ matchId, data, round, me, them, userId }: RoundProps) {
  const secondsLeft = useCountdown(round.ends_at ?? null);
  const settle = useSettleBattle(matchId);
  const workouts = useWorkoutLog();
  const aiPlan = useCustomPlan();
  const todayIso = new Date().toISOString().slice(0, 10);
  const days = ROUTINE_ORDER.filter((d) => ROUTINE[d].length > 0);
  const [day, setDay] = useState(days[0]);
  const [source, setSource] = useState<0 | 1>(0);
  const useAi = source === 1 && aiPlan.data !== null && aiPlan.data !== undefined;
  const prNoop = useRef(0);

  const roundNo = round.round_no;
  const myEvents = useMemo(
    () => data.events.filter((e) => e.user_id === userId && e.kind === 'volume' && e.round_no === roundNo).map(toVolume),
    [data.events, userId, roundNo]
  );
  const theirEvents = useMemo(
    () => data.events.filter((e) => e.user_id !== userId && e.kind === 'volume' && e.round_no === roundNo).map(toVolume),
    [data.events, userId, roundNo]
  );
  const myKg = totalEffectiveKg(myEvents);
  const theirKg = totalEffectiveKg(theirEvents);
  // No target: the leader defines 100% and the other bar chases them.
  const lead = Math.max(myKg, theirKg, 1);
  const over = secondsLeft !== null && secondsLeft <= 0;

  const todayRows = useMemo(
    () =>
      normaliseWorkoutLog(workouts.data ?? []).filter(
        (r) => String(r.date) === todayIso && String(r.workout) === day
      ),
    [workouts.data, todayIso, day]
  );
  const validCount = (exercise: string) =>
    todayRows.filter(
      (r) => String(r.exercise) === exercise && (pyFloat(r.weight) ?? 0) > 0 && (pyFloat(r.reps) ?? 0) > 0
    ).length;

  const builtIn = ROUTINE[day];
  const aiDay = useAi ? aiPlan.data?.days.find((d) => d.day === day) : null;
  const plan: readonly (readonly [string, number, string])[] = aiDay
    ? aiDay.exercises.map((e) => [e.exercise, e.sets, e.reps] as const)
    : builtIn;
  const nextExercise = plan.find(([exercise, sets]) => validCount(exercise) < sets)?.[0] ?? null;

  const mm = secondsLeft === null ? '–' : String(Math.trunc(secondsLeft / 60)).padStart(1, '0');
  const ss = secondsLeft === null ? '––' : String(secondsLeft % 60).padStart(2, '0');
  const tint = tokens.colors.danger;

  return (
    <>
      <ScreenHeader
        kicker="VOLUME DUEL · LIVE"
        title="MOVE THE MOST WEIGHT"
        titleLines={2}
        autoSize
        right={
          <Text
            className="text-2xl font-bold"
            style={{
              color: over ? tokens.colors.danger : tint,
              textShadowColor: 'rgba(251,113,133,0.6)',
              textShadowRadius: 14,
            }}
          >
            {over ? 'TIME' : `${mm}:${ss}`}
          </Text>
        }
      />

      <GlowCard glow={myKg >= theirKg && myKg > 0 ? tint : undefined}>
        <ProgressBar
          pct={(myKg / lead) * 100}
          colour={tint}
          label={`${String(me?.snapshot.name ?? 'YOU').toUpperCase()}${myKg >= theirKg && myKg > 0 ? ' · LEADING' : ''}`}
          kg={myKg}
        />
        <ProgressBar
          pct={(theirKg / lead) * 100}
          colour={tokens.colors.epic}
          label={`${String(them?.snapshot.name ?? 'RIVAL').toUpperCase()}${theirKg > myKg ? ' · LEADING' : ''}`}
          kg={theirKg}
        />
        <Text className="text-2xs text-text-mute">
          Effective kg = weight × reps × exercise coefficient. Log here, not on Today —
          only sets logged on THIS screen enter the duel. A set banks as first logged.
        </Text>
      </GlowCard>

      {!over ? (
        <>
          <View className="flex-row flex-wrap gap-s2">
            {days.map((d) => (
              <Chip key={d} label={d.split(' - ')[0]} active={d === day} onPress={() => setDay(d)} />
            ))}
          </View>
          {aiPlan.data ? (
            <View className="flex-row gap-s2">
              <Chip label="BUILT-IN" active={source === 0} onPress={() => setSource(0)} />
              <Chip label="AI PLAN" active={source === 1} onPress={() => setSource(1)} />
            </View>
          ) : null}
          {plan.map(([exercise, sets, scheme]) => (
            <ExerciseCard
              key={`${day}:${exercise}`}
              date={todayIso}
              workout={day}
              exercise={exercise}
              targetSets={sets}
              scheme={scheme}
              loggedRows={todayRows.filter((r) => String(r.exercise) === exercise)}
              allRows={workouts.data ?? []}
              doneCount={validCount(exercise)}
              isNext={exercise === nextExercise}
              onPr={() => (prNoop.current += 1)}
              tint={tint}
              onLogged={(verdict) => {
                if (verdict.action === 'insert' && verdict.rowId) {
                  void postBattleVolume(matchId, roundNo, verdict.rowId);
                }
              }}
            />
          ))}
        </>
      ) : (
        <NeonButton
          title="LOCK IN THE DUEL · REVEAL THE VERDICT"
          variant="danger"
          onPress={() => settle.mutate()}
          busy={settle.isPending}
          testID="battle-settle"
        />
      )}
    </>
  );
}

function StrengthRound({ matchId, data, round, me, them, userId }: RoundProps) {
  const spec = round.spec;
  const object = objectByKey(String(spec.objectKey ?? ''));
  const target = Number(spec.targetEffectiveKg ?? object.blitzTargetKg);
  const secondsLeft = useCountdown(round.ends_at ?? null);
  const settle = useSettleBattle(matchId);

  const roundNo = round.round_no;
  const myEvents = useMemo(
    () => data.events.filter((e) => e.user_id === userId && e.kind === 'volume' && e.round_no === roundNo).map(toVolume),
    [data.events, userId, roundNo]
  );
  const theirEvents = useMemo(
    () => data.events.filter((e) => e.user_id !== userId && e.kind === 'volume' && e.round_no === roundNo).map(toVolume),
    [data.events, userId, roundNo]
  );
  const myKg = totalEffectiveKg(myEvents);
  const theirKg = totalEffectiveKg(theirEvents);
  const myPct = target > 0 ? (myKg / target) * 100 : 0;
  const theirPct = target > 0 ? (theirKg / target) * 100 : 0;
  const bothDone = myKg >= target && theirKg >= target;
  const over = secondsLeft !== null && secondsLeft <= 0;

  // The object rises with the leading athlete: 0% grounded, 100% airborne.
  const lift = Math.min(100, Math.max(myPct, theirPct));

  const mm = secondsLeft === null ? '–' : String(Math.trunc(secondsLeft / 60)).padStart(1, '0');
  const ss = secondsLeft === null ? '––' : String(secondsLeft % 60).padStart(2, '0');

  return (
    <>
      <ScreenHeader
        kicker="ROUND 1 · STRENGTH"
        title={`LIFT THE ${object.name.toUpperCase()}`}
        titleLines={2}
        autoSize
        right={
          <Text
            className="text-2xl font-bold"
            style={{
              color: over ? tokens.colors.danger : tokens.colors.accent,
              textShadowColor: over ? 'rgba(251,113,133,0.6)' : 'rgba(34,211,238,0.6)',
              textShadowRadius: 14,
            }}
          >
            {over ? 'TIME' : `${mm}:${ss}`}
          </Text>
        }
      />

      {/* The object, rising off its shadow as the leader closes in. */}
      <GlowCard glow={lift >= 100 ? tokens.colors.success : undefined}>
        <View className="items-center py-s2">
          <Text style={{ fontSize: 72, transform: [{ translateY: -(lift * 0.28) }] }}>{object.emoji}</Text>
          <View
            style={{
              width: 90 - lift * 0.4,
              height: 8,
              borderRadius: 999,
              backgroundColor: 'rgba(0,0,0,0.55)',
              marginTop: 2,
            }}
          />
          <Text className="mt-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            GAME WEIGHT {Number(spec.displayKg ?? object.displayKg).toLocaleString()} KG
          </Text>
          <Text className="text-2xs text-text-mute">
            Effective volume to lift: {target.toLocaleString()} kg · weight × reps × exercise coefficient
          </Text>
        </View>
        <View className="mt-s3">
          <ProgressBar pct={myPct} colour={tokens.colors.accent} label={String(me?.snapshot.name ?? 'YOU').toUpperCase()} kg={myKg} />
          <ProgressBar pct={theirPct} colour={tokens.colors.epic} label={String(them?.snapshot.name ?? 'RIVAL').toUpperCase()} kg={theirKg} />
        </View>
      </GlowCard>

      {!over && !bothDone ? <BattleLogger matchId={matchId} roundNo={round.round_no} /> : null}

      {over || bothDone ? (
        <NeonButton title="LOCK IN ROUND 1 · ON TO CARDIO" onPress={() => settle.mutate()} busy={settle.isPending} testID="battle-settle" />
      ) : (
        <Text className="text-center text-2xs text-text-mute">
          Every set logs to your real training history — battle sets are real sets.
        </Text>
      )}
    </>
  );
}

function CardioRound({ matchId, data, round, me, them, userId }: RoundProps) {
  const spec = round.spec;
  const challenge = cardioChallengeByKey(String(spec.challengeKey ?? ''));
  const target = Number(spec.targetUnits ?? challenge.blitzTargetUnits);
  const secondsLeft = useCountdown(round.ends_at ?? null);
  const settle = useSettleBattle(matchId);

  const roundNo = round.round_no;
  const myEvents = useMemo(
    () => data.events.filter((e) => e.user_id === userId && e.kind === 'cardio' && e.round_no === roundNo).map(toCardio),
    [data.events, userId, roundNo]
  );
  const theirEvents = useMemo(
    () => data.events.filter((e) => e.user_id !== userId && e.kind === 'cardio' && e.round_no === roundNo).map(toCardio),
    [data.events, userId, roundNo]
  );
  const myUnits = totalEnergyUnits(myEvents);
  const theirUnits = totalEnergyUnits(theirEvents);
  const myPct = target > 0 ? (myUnits / target) * 100 : 0;
  const theirPct = target > 0 ? (theirUnits / target) * 100 : 0;
  const bothDone = myUnits >= target && theirUnits >= target;
  const over = secondsLeft !== null && secondsLeft <= 0;

  const mm = secondsLeft === null ? '–' : String(Math.trunc(secondsLeft / 60)).padStart(1, '0');
  const ss = secondsLeft === null ? '––' : String(secondsLeft % 60).padStart(2, '0');

  return (
    <>
      <ScreenHeader
        kicker="ROUND 2 · CARDIO"
        title={challenge.name.toUpperCase()}
        titleLines={2}
        autoSize
        right={
          <Text
            className="text-2xl font-bold"
            style={{
              color: over ? tokens.colors.danger : tokens.colors.rare,
              textShadowColor: over ? 'rgba(251,113,133,0.6)' : 'rgba(56,189,248,0.6)',
              textShadowRadius: 14,
            }}
          >
            {over ? 'TIME' : `${mm}:${ss}`}
          </Text>
        }
      />

      <GlowCard glow={Math.max(myPct, theirPct) >= 100 ? tokens.colors.success : tokens.colors.rare}>
        <View className="items-center py-s2">
          <Text style={{ fontSize: 64 }}>{challenge.emoji}</Text>
          <Text className="mt-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            TARGET {target} ENERGY UNITS
          </Text>
          <Text className="text-center text-2xs text-text-mute">
            Minutes and kilometres convert per machine — a stair minute outranks a walking one.
          </Text>
        </View>
        <View className="mt-s3">
          <ProgressBar pct={myPct} colour={tokens.colors.rare} label={String(me?.snapshot.name ?? 'YOU').toUpperCase()} kg={myUnits} unit="EU" />
          <ProgressBar pct={theirPct} colour={tokens.colors.epic} label={String(them?.snapshot.name ?? 'RIVAL').toUpperCase()} kg={theirUnits} unit="EU" />
        </View>
      </GlowCard>

      {!over && !bothDone ? <CardioBattleLogger matchId={matchId} roundNo={roundNo} /> : null}

      {over || bothDone ? (
        <NeonButton title="LOCK IN ROUND 2 · TO THE JUDGING" onPress={() => settle.mutate()} busy={settle.isPending} testID="battle-settle" />
      ) : (
        <Text className="text-center text-2xs text-text-mute">
          Sessions log to your real cardio history — battle minutes are real minutes.
        </Text>
      )}
    </>
  );
}

const BATTLE_CARDIO_TYPES = ['Run', 'Bike', 'Stairmaster', 'Outdoor walk', 'Boxing'];

/** Round 2's logger: the NORMAL cardio save (real XP), then the confirmed
 *  row ties into the battle. Same doctrine as sets. */
function CardioBattleLogger({ matchId, roundNo }: { matchId: string; roundNo: number }) {
  const [type, setType] = useState(BATTLE_CARDIO_TYPES[0]);
  const [minutes, setMinutes] = useState('');
  const [distance, setDistance] = useState('');
  const log = useLogCardio();

  const submit = () => {
    const mins = pyFloat(minutes) ?? 0;
    if (mins <= 0) return;
    log.mutate(
      {
        type,
        minutes: mins,
        distanceKm: pyFloat(distance) ?? 0,
        incline: 0,
        speed: 0,
        calories: 0,
        notes: 'Battle Arena',
      },
      {
        onSuccess: ({ rowId }) => {
          setMinutes('');
          setDistance('');
          void postBattleCardio(matchId, roundNo, rowId);
        },
      }
    );
  };

  return (
    <GlowCard>
      <View className="mb-s3">
        <EdgeLabel>LOG A BATTLE SESSION</EdgeLabel>
      </View>
      <View className="mb-s3 flex-row flex-wrap gap-s2">
        {BATTLE_CARDIO_TYPES.map((t) => (
          <Chip key={t} label={t} active={t === type} onPress={() => setType(t)} />
        ))}
      </View>
      <View className="flex-row items-center gap-s2">
        <TextInput
          className="min-h-[44px] w-[80px] rounded-md border border-border bg-surface-2 p-s2 text-center text-text"
          inputMode="decimal"
          placeholder="min"
          placeholderTextColor="#64758f"
          value={minutes}
          onChangeText={setMinutes}
          testID="battle-cardio-min"
        />
        <TextInput
          className="min-h-[44px] w-[80px] rounded-md border border-border bg-surface-2 p-s2 text-center text-text"
          inputMode="decimal"
          placeholder="km"
          placeholderTextColor="#64758f"
          value={distance}
          onChangeText={setDistance}
          testID="battle-cardio-km"
        />
        <View className="flex-1">
          <NeonButton title="LOG SESSION" onPress={submit} busy={log.isPending} testID="battle-cardio-log" />
        </View>
      </View>
    </GlowCard>
  );
}

function PhysiqueRound({ matchId, data, round, userId }: Omit<RoundProps, 'me' | 'them'>) {
  const spec = round.spec;
  const pose = poseByKey(String(spec.poseKey ?? ''));
  const secondsLeft = useCountdown(round.ends_at ?? null);
  const judge = useBattlePhysique(matchId);
  const settle = useSettleBattle(matchId);
  // Covers the permission-prompt/camera window BEFORE judge.isPending goes
  // true: without it a double tap launches two captures, and two distinct
  // photos burn BOTH attempts (different sha256s — nothing dedupes them).
  const [capturing, setCapturing] = useState(false);

  const roundNo = round.round_no;
  const myMedia = data.media.filter((m) => m.user_id === userId && m.round_no === roundNo);
  const theirMedia = data.media.filter((m) => m.user_id !== userId && m.round_no === roundNo);
  const last = myMedia[myMedia.length - 1] ?? null;
  const attemptsLeft = 2 - myMedia.length;
  const needRetry = last !== null && String(last.confidence).toLowerCase() === 'low' && attemptsLeft > 0;
  const iAmDone = last !== null && (!needRetry || attemptsLeft <= 0);
  const theyAreDone =
    theirMedia.length >= 2 ||
    theirMedia.some((m) => String(m.confidence).toLowerCase() !== 'low');
  const over = secondsLeft !== null && secondsLeft <= 0;
  const roundScored = data.scores.some((sc) => sc.round_no === roundNo);
  const revealed = revealReady(myMedia, theirMedia, roundScored);

  const capture = async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const photo = await captureCameraPhoto();
      if (photo) judge.mutate(photo);
    } catch {
      // A camera-pipeline throw was previously swallowed by `void capture()`:
      // the user granted camera, shot, and the UI did nothing at all.
      useToastStore.getState().push({
        kind: 'error',
        title: 'CAPTURE FAILED',
        subtitle: 'The photo could not be processed. Attempt not used — try again.',
      });
    } finally {
      setCapturing(false);
    }
  };

  const mm = secondsLeft === null ? '–' : String(Math.trunc(secondsLeft / 60)).padStart(1, '0');
  const ss = secondsLeft === null ? '––' : String(secondsLeft % 60).padStart(2, '0');

  return (
    <>
      <ScreenHeader
        kicker="ROUND 3 · PHYSIQUE"
        title="FACE THE JUDGE"
        right={
          <Text
            className="text-2xl font-bold"
            style={{
              color: over ? tokens.colors.danger : tokens.colors.mythic,
              textShadowColor: over ? 'rgba(251,113,133,0.6)' : 'rgba(244,114,182,0.6)',
              textShadowRadius: 14,
            }}
          >
            {over ? 'TIME' : `${mm}:${ss}`}
          </Text>
        }
      />

      <GlowCard glow={iAmDone ? tokens.colors.success : tokens.colors.mythic}>
        <View className="items-center py-s2">
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2.5 }}>
            THE ROLLED POSE
          </Text>
          <Text
            className="my-s2 text-center text-2xl font-bold text-text"
            style={{ textShadowColor: 'rgba(244,114,182,0.5)', textShadowRadius: 16 }}
          >
            {pose.name.toUpperCase()}
          </Text>
          <Text className="text-center text-2xs text-text-mute">
            Camera only — no gallery. The judge scores five ways and checks the pose.
            {'\n'}Low-confidence verdicts are never ranked; you get one retake.
          </Text>
        </View>

        {last ? (
          <View className="mt-s3 rounded-md border border-border-strong bg-surface-2 p-s3">
            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
              ATTEMPT {myMedia.length} · {String(last.confidence ?? '').toUpperCase()} CONFIDENCE ·{' '}
              {last.compliant ? 'POSE OK' : 'POSE NOT RECOGNISED'}
            </Text>
            {needRetry ? (
              <Text className="mt-s1 text-xs text-warn">The judge wants a clearer shot. One retake remains.</Text>
            ) : (
              <Text className="mt-s1 text-xs text-text-dim">Verdict locked. Waiting on the opponent…</Text>
            )}
          </View>
        ) : null}

        {!over && !iAmDone ? (
          <View className="mt-s4">
            <NeonButton
              title={last ? 'RETAKE · FACE THE JUDGE' : '📸 CAPTURE & FACE THE JUDGE'}
              onPress={() => void capture()}
              busy={judge.isPending || capturing}
              testID="battle-capture"
            />
          </View>
        ) : null}

        <View className="mt-s4 flex-row gap-s3">
          <DuelPanel label="YOU" tint={tokens.colors.accent} rows={myMedia} revealed={revealed} judging={judge.isPending} />
          <DuelPanel label="OPPONENT" tint={tokens.colors.epic} rows={theirMedia} revealed={revealed} judging={false} />
        </View>
        {!revealed && (myMedia.length > 0 || theirMedia.length > 0) ? (
          <Text className="mt-s2 text-center text-2xs text-text-mute">
            Photos reveal when both verdicts are locked — no first-mover disadvantage.
          </Text>
        ) : null}
      </GlowCard>

      {over || (iAmDone && theyAreDone) ? (
        <NeonButton title="REVEAL THE FINAL VERDICT" onPress={() => settle.mutate()} busy={settle.isPending} testID="battle-settle" />
      ) : null}
    </>
  );
}

/** Log a battle set: the NORMAL save path (update-in-place, real XP), then
 *  the confirmed row id is tied to the battle. Never optimistic. */
function BattleLogger({
  matchId,
  roundNo,
  exercises = BATTLE_EXERCISES,
}: {
  matchId: string;
  roundNo: number;
  /** Heads or Tails locks this to the single assigned exercise. */
  exercises?: readonly string[];
}) {
  const [exercise, setExercise] = useState(exercises[0]);
  const [weight, setWeight] = useState('');
  const [reps, setReps] = useState('');
  const save = useSaveSet();
  const workouts = useWorkoutLog();
  const todayIso = new Date().toISOString().slice(0, 10);
  // Set numbers already handed out this session, per exercise. The query
  // cache lags the refetch after each save, so two identical rapid sets
  // would otherwise collide on the same setNo and collapse into a noop —
  // one of them silently not counting for the battle. (The tour caught it.)
  const issuedSetNo = useRef<Record<string, number>>({});

  const nextSetNo = (ex: string): number => {
    const rows = (workouts.data ?? []).filter(
      (r) =>
        String(r.date) === todayIso &&
        String(r.workout) === BATTLE_WORKOUT &&
        String(r.exercise) === ex
    );
    let maxSet = issuedSetNo.current[ex] ?? 0;
    for (const r of rows) maxSet = Math.max(maxSet, pyInt(r.set) ?? 0);
    return maxSet + 1;
  };

  const log = () => {
    const w = pyFloat(weight);
    const r = pyFloat(reps);
    if (w === null || r === null || w <= 0 || r <= 0) return;
    const setNo = nextSetNo(exercise);
    save.mutate(
      {
        workoutDate: todayIso,
        workout: BATTLE_WORKOUT,
        exercise,
        setNo,
        weight: w,
        reps: Math.trunc(r),
      },
      {
        onSuccess: (verdict) => {
          setWeight('');
          setReps('');
          if (verdict.action !== 'reject') {
            issuedSetNo.current[exercise] = Math.max(issuedSetNo.current[exercise] ?? 0, setNo);
          }
          if (verdict.action === 'insert' && verdict.rowId) {
            void postBattleVolume(matchId, roundNo, verdict.rowId);
          }
        },
      }
    );
  };

  return (
    <GlowCard>
      <View className="mb-s3">
        <EdgeLabel>LOG A BATTLE SET</EdgeLabel>
      </View>
      <View className="mb-s3 flex-row flex-wrap gap-s2">
        {exercises.map((ex) => (
          <Chip key={ex} label={ex.replace(' (Strength)', '')} active={ex === exercise} onPress={() => setExercise(ex)} />
        ))}
      </View>
      <View className="flex-row items-center gap-s2">
        <NumberField
          value={weight}
          onChange={setWeight}
          step={2.5}
          bigStep={20}
          placeholder="kg"
          label="WEIGHT · KG"
          width={54}
          testID="battle-w"
        />
        <NumberField
          value={reps}
          onChange={setReps}
          step={1}
          integer
          placeholder="reps"
          label="REPS"
          width={44}
          testID="battle-r"
        />
        <View className="flex-1">
          <NeonButton title="LOG SET" onPress={log} busy={save.isPending} testID="battle-log" />
        </View>
      </View>
    </GlowCard>
  );
}

/**
 * One side of the round-3 duel (IMPROVEMENT_PLAN #8): the photo behind the
 * both-final reveal gate, verdict axes once revealed, honest placeholders
 * everywhere else. A dead signed URL renders PHOTO UNAVAILABLE — it never
 * blocks scores.
 */
function DuelPanel({
  label,
  tint,
  rows,
  revealed,
  judging,
}: {
  label: string;
  tint: string;
  rows: BattleMediaRow[];
  revealed: boolean;
  judging: boolean;
}) {
  const state = sideState(rows, revealed, judging);
  const last = rows.length > 0 ? rows[rows.length - 1] : null;
  const url = useBattleMediaUrl(state === 'revealed' || state === 'noncompliant' ? (last?.storage_path ?? null) : null);
  const verdict = (last?.verdict ?? {}) as Record<string, number>;
  const axes: [string, string][] = [
    ['muscular_development', 'MUSCLE'],
    ['conditioning', 'COND'],
    ['symmetry', 'SYM'],
    ['proportion', 'PROP'],
    ['presentation', 'PRES'],
  ];
  return (
    <View className="flex-1 rounded-xl p-s2" style={{ borderWidth: 1, borderColor: `${tint}40`, backgroundColor: 'rgba(6,12,24,0.5)' }}>
      <Text className="mb-s1 text-center text-2xs font-bold" style={{ color: tint, letterSpacing: 2 }}>
        {label}
      </Text>
      <View className="items-center justify-center rounded-md" style={{ height: 150, backgroundColor: 'rgba(4,10,20,0.7)', overflow: 'hidden' }}>
        {state === 'waiting' ? (
          <Text className="text-2xs text-text-mute">NO PHOTO YET</Text>
        ) : state === 'judging' ? (
          <Text className="text-2xs font-bold" style={{ color: tint, letterSpacing: 1.5 }}>
            JUDGING…
          </Text>
        ) : state === 'locked' ? (
          <View className="items-center gap-s1">
            <Text className="text-xl">🔒</Text>
            <Text className="px-s2 text-center text-2xs text-text-mute">PHOTO LOCKED — reveals when both are in</Text>
          </View>
        ) : url.data ? (
          <Image source={{ uri: url.data }} style={{ width: '100%', height: 150 }} contentFit="cover" />
        ) : (
          <Text className="text-2xs text-text-mute">PHOTO UNAVAILABLE</Text>
        )}
      </View>
      {state === 'noncompliant' ? (
        <Text className="mt-s1 text-center text-2xs font-bold text-warn" style={{ letterSpacing: 1 }}>
          NON-COMPLIANT · {rows.length}/2
        </Text>
      ) : null}
      {(state === 'revealed' || state === 'noncompliant') && last?.verdict ? (
        <View className="mt-s2">
          {axes.map(([key, short]) => {
            const v = Math.max(0, Math.min(15, Number(verdict[key] ?? 0)));
            return (
              <View key={key} className="mb-s1 flex-row items-center gap-s1">
                <Text className="w-[38px] text-2xs text-text-mute" style={{ fontSize: 9, letterSpacing: 0.5 }}>
                  {short}
                </Text>
                <View className="h-[4px] flex-1 overflow-hidden rounded-pill bg-surface-3">
                  <View style={{ width: `${(v / 15) * 100}%`, height: '100%', borderRadius: 999, backgroundColor: tint, minWidth: v > 0 ? 3 : 0 }} />
                </View>
                <Text className="text-2xs font-bold text-text-dim" style={{ fontSize: 9 }}>
                  {v}
                </Text>
              </View>
            );
          })}
          <Text className="text-center text-2xs text-text-mute" style={{ fontSize: 9, letterSpacing: 1 }}>
            JUDGE VERDICT — final points at settle
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const ROUND_LABELS: Record<number, string> = { 1: 'STRENGTH', 2: 'CARDIO', 3: 'PHYSIQUE' };
const ROUND_BUDGETS: Record<number, number> = { 1: 1200, 2: 1050, 3: 750 };

function ScoreCard({ p, scores, won, format }: { p: BattleParticipant | null; scores: BattleBundle['scores']; won: boolean; format?: string | null }) {
  // Duels: one round, no budget — points ARE effective kg.
  const duel = format === 'volume_duel' || format === 'heads_or_tails';
  const mine = scores.filter((s) => s.user_id === p?.user_id).sort((a, b) => a.round_no - b.round_no);
  const total = p?.total_score ?? mine.reduce((acc, s) => acc + s.points, 0);
  const tint = won ? tokens.colors.success : tokens.colors.border;
  return (
    <View className="mb-s3 rounded-xl p-s4" style={{ borderWidth: 1, borderColor: won ? `${tokens.colors.success}59` : tint, backgroundColor: 'rgba(13,21,36,0.5)' }}>
      <View className="mb-s2 flex-row items-center justify-between">
        <Text className="text-base font-bold text-text">
          {won ? '👑 ' : ''}
          {p?.snapshot.name ?? '???'}
        </Text>
        <Text
          className="text-2xl font-bold"
          style={{ color: won ? tokens.colors.success : tokens.colors.text, textShadowColor: won ? 'rgba(52,211,153,0.6)' : undefined, textShadowRadius: won ? 14 : 0 }}
        >
          {total}
        </Text>
      </View>
      {mine.map((s) => (
        <View key={s.round_no} className="flex-row justify-between">
          <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
            {duel ? 'WEIGHT MOVED' : `R${s.round_no} ${ROUND_LABELS[s.round_no] ?? ''}`}
          </Text>
          <Text className="text-2xs font-bold text-text-dim">
            {duel ? `${s.points} EFFECTIVE KG` : `${s.points} / ${ROUND_BUDGETS[s.round_no] ?? ''}`}
          </Text>
        </View>
      ))}
      {p?.xp_awarded ? (
        <Text className="mt-s2 text-2xs font-bold text-accent" style={{ letterSpacing: 1 }}>
          +{p.xp_awarded} XP BANKED
        </Text>
      ) : null}
    </View>
  );
}

function ResultsPhase({ data, me, them }: { data: BattleBundle; me: BattleParticipant | null; them: BattleParticipant | null }) {
  const router = useRouter();
  const match = data.match!;
  const iWon = match.winner_user_id !== null && match.winner_user_id === me?.user_id;
  const draw = match.winner_user_id === null && match.status === 'settled';
  return (
    <>
      <ScreenHeader
        kicker="THE VERDICT"
        title={draw ? 'DEAD EVEN' : iWon ? 'VICTORY' : 'DEFEAT'}
      />
      <ScoreCard p={me} scores={data.scores} won={iWon} format={match.format} />
      <ScoreCard p={them} scores={data.scores} won={!iWon && !draw && match.status === 'settled'} format={match.format} />
      {/* replace, not back(): from a deep link or refresh, back() can land
          on Home or exit the group -- and the settled battle should not be
          back-reachable into a stale state (IMPROVEMENT_PLAN #7). */}
      <NeonButton title="BACK TO THE ARENA" variant="ghost" onPress={() => router.replace('/arena')} />
    </>
  );
}
