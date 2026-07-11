import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { captureCameraPhoto } from '@/data/ai';
import { useAuth } from '@/data/auth-context';
import {
  useBattleBundle,
  useBattleChannel,
  type BattleBundle,
  type BattleParticipant,
  type BattleRound,
} from '@/data/battle/hooks';
import {
  postBattleCardio,
  postBattleVolume,
  useBattlePhysique,
  useReadyUp,
  useSettleBattle,
} from '@/data/battle/mutations';
import { useWorkoutLog } from '@/data/hooks';
import { useLogCardio, useSaveSet } from '@/data/mutations';
import {
  cardioChallengeByKey,
  objectByKey,
  poseByKey,
  totalEffectiveKg,
  totalEnergyUnits,
  type CardioEvent,
  type VolumeEvent,
} from '@/domain/battle/engine';
import { pyFloat, pyInt } from '@/domain/py';
import { BLITZ_RULES, CodeCard, RulesStrip } from '@/ui/battle-arena';
import { BattleRulesPanel, FaceOffScene, ReadyCTA } from '@/ui/face-off';
import { EdgeLabel } from '@/ui/hud';
import { Chip, NeonButton } from '@/ui/neon-button';
import { ScreenHeader } from '@/ui/screen-header';
import { GlowCard, ScreenShell } from '@/ui/shell';
import tokens from '@/theme/tokens';

const BATTLE_WORKOUT = 'Battle Arena';

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
      {match.status === 'inviting' ? <InvitePhase code={match.invite_code} /> : null}
      {match.status === 'matched' ? <VsPhase matchId={match.id} me={me} them={them} /> : null}
      {match.status === 'active' ? (
        <ActivePhase matchId={match.id} data={data} me={me} them={them} userId={userId} />
      ) : null}
      {match.status === 'settled' || match.status === 'abandoned' ? (
        <ResultsPhase data={data} me={me} them={them} />
      ) : null}
    </ScreenShell>
  );
}

// ------------------------------------------------------------------ phases

function InvitePhase({ code }: { code: string | null }) {
  return (
    <>
      <ScreenHeader kicker="FRIENDLY BLITZ" title="CHALLENGE SENT" />
      <GlowCard glow={tokens.colors.accent}>
        {code ? <CodeCard code={code} /> : null}
        <Text className="mt-s3 text-center text-2xs text-text-mute">
          Waiting for a challenger… the screen advances the moment they join.
        </Text>
      </GlowCard>
      <RulesStrip rules={BLITZ_RULES} />
    </>
  );
}

function VsPhase({ matchId, me, them }: { matchId: string; me: BattleParticipant | null; them: BattleParticipant | null }) {
  const ready = useReadyUp(matchId);
  const iAmReady = me?.ready_at != null;
  return (
    <>
      <ScreenHeader kicker="FRIENDLY BLITZ" title="FACE OFF" />
      <FaceOffScene me={me} them={them} />
      <BattleRulesPanel rules={BLITZ_RULES} />
      <ReadyCTA
        title={iAmReady ? 'WAITING FOR OPPONENT…' : 'READY UP'}
        onPress={() => ready.mutate()}
        disabled={iAmReady}
        busy={ready.isPending}
        testID="battle-ready"
      />
      <Text className="text-center text-2xs text-text-mute">
        When both athletes are ready the object is rolled and the 12-minute bell sounds.
      </Text>
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
      {round.kind === 'strength' ? (
        <StrengthRound matchId={matchId} data={data} round={round} me={me} them={them} userId={userId} />
      ) : round.kind === 'cardio' ? (
        <CardioRound matchId={matchId} data={data} round={round} me={me} them={them} userId={userId} />
      ) : (
        <PhysiqueRound matchId={matchId} data={data} round={round} userId={userId} />
      )}
      <RoundStrip data={data} userId={userId} />
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

      {!over && !bothDone ? <BattleLogger matchId={matchId} /> : null}

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

  const capture = async () => {
    const photo = await captureCameraPhoto();
    if (photo) judge.mutate(photo);
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
              busy={judge.isPending}
              testID="battle-capture"
            />
          </View>
        ) : null}

        <Text className="mt-s3 text-center text-2xs text-text-mute">
          Opponent: {theirMedia.length === 0 ? 'not yet judged' : theyAreDone ? 'verdict locked' : 'retaking…'}
        </Text>
      </GlowCard>

      {over || (iAmDone && theyAreDone) ? (
        <NeonButton title="REVEAL THE FINAL VERDICT" onPress={() => settle.mutate()} busy={settle.isPending} testID="battle-settle" />
      ) : null}
    </>
  );
}

/** Log a battle set: the NORMAL save path (update-in-place, real XP), then
 *  the confirmed row id is tied to the battle. Never optimistic. */
function BattleLogger({ matchId }: { matchId: string }) {
  const [exercise, setExercise] = useState(BATTLE_EXERCISES[0]);
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
            void postBattleVolume(matchId, 1, verdict.rowId);
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
        {BATTLE_EXERCISES.map((ex) => (
          <Chip key={ex} label={ex.replace(' (Strength)', '')} active={ex === exercise} onPress={() => setExercise(ex)} />
        ))}
      </View>
      <View className="flex-row items-center gap-s2">
        <TextInput
          className="min-h-[44px] w-[90px] rounded-md border border-border bg-surface-2 p-s2 text-center text-text"
          inputMode="decimal"
          placeholder="kg"
          placeholderTextColor="#64758f"
          value={weight}
          onChangeText={setWeight}
          testID="battle-w"
        />
        <Text className="text-text-mute">×</Text>
        <TextInput
          className="min-h-[44px] w-[70px] rounded-md border border-border bg-surface-2 p-s2 text-center text-text"
          inputMode="numeric"
          placeholder="reps"
          placeholderTextColor="#64758f"
          value={reps}
          onChangeText={setReps}
          testID="battle-r"
        />
        <View className="flex-1">
          <NeonButton title="LOG SET" onPress={log} busy={save.isPending} testID="battle-log" />
        </View>
      </View>
    </GlowCard>
  );
}

const ROUND_LABELS: Record<number, string> = { 1: 'STRENGTH', 2: 'CARDIO', 3: 'PHYSIQUE' };
const ROUND_BUDGETS: Record<number, number> = { 1: 1200, 2: 1050, 3: 750 };

function ScoreCard({ p, scores, won }: { p: BattleParticipant | null; scores: BattleBundle['scores']; won: boolean }) {
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
            R{s.round_no} {ROUND_LABELS[s.round_no] ?? ''}
          </Text>
          <Text className="text-2xs font-bold text-text-dim">
            {s.points} / {ROUND_BUDGETS[s.round_no] ?? ''}
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
      <ScoreCard p={me} scores={data.scores} won={iWon} />
      <ScoreCard p={them} scores={data.scores} won={!iWon && !draw && match.status === 'settled'} />
      <NeonButton title="BACK TO THE ARENA" variant="ghost" onPress={() => router.back()} />
    </>
  );
}
