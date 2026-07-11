import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import {
  useBattleBundle,
  useBattleChannel,
  type BattleBundle,
  type BattleParticipant,
} from '@/data/battle/hooks';
import { postBattleVolume, useReadyUp, useSettleBattle } from '@/data/battle/mutations';
import { useWorkoutLog } from '@/data/hooks';
import { useSaveSet } from '@/data/mutations';
import {
  objectByKey,
  totalEffectiveKg,
  type VolumeEvent,
} from '@/domain/battle/engine';
import { type BranchV2 } from '@/domain/branches-v2';
import { pyFloat, pyInt } from '@/domain/py';
import { avatarArtV2 } from '@/ui/avatar-art';
import { EdgeLabel } from '@/ui/hud';
import { Chip, NeonButton } from '@/ui/neon-button';
import { ScreenHeader } from '@/ui/screen-header';
import { GlowCard, ScreenShell } from '@/ui/shell';
import { Silhouette } from '@/ui/silhouette';
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
        <Text className="text-center text-2xs font-bold text-text-mute" style={{ letterSpacing: 2.5 }}>
          YOUR BATTLE CODE
        </Text>
        <Text
          className="my-s3 text-center text-4xl font-bold text-text"
          style={{ letterSpacing: 12, textShadowColor: 'rgba(34,211,238,0.6)', textShadowRadius: 18 }}
          testID="battle-code"
        >
          {code ?? '——————'}
        </Text>
        <Text className="text-center text-2xs text-text-mute">
          Waiting for a challenger… the screen advances the moment they join.
        </Text>
      </GlowCard>
    </>
  );
}

function FighterCard({ p, align }: { p: BattleParticipant | null; align: 'left' | 'right' }) {
  const snap = p?.snapshot ?? {};
  const branch = (snap.branch ?? 'aesthetic') as BranchV2;
  const sex = snap.sex === 'female' ? 'female' as const : 'male' as const;
  const stage = typeof snap.stage === 'number' ? snap.stage : 1;
  const art = avatarArtV2(branch, stage, sex);
  const donor = branch === 'titan' ? 'mass' : branch === 'cardio' ? 'hybrid' : branch === 'shredder' ? 'aesthetic' : branch;
  return (
    <View className={`flex-1 ${align === 'left' ? 'items-start' : 'items-end'}`}>
      {art.hasArt ? (
        <Image source={art.source} style={{ width: 84, height: 92 }} contentFit="contain" />
      ) : (
        <Silhouette branch={donor as 'aesthetic' | 'mass' | 'hybrid'} stage={Math.min(stage, 4)} />
      )}
      <Text className="mt-s2 text-base font-bold text-text" numberOfLines={1}>
        {snap.name ?? '???'}
      </Text>
      <Text className="text-2xs text-text-mute">
        LV {snap.level ?? '?'} · PWR {snap.power ?? '?'}
      </Text>
      <Text className="text-2xs text-text-mute" numberOfLines={1}>
        {snap.characterClass ?? ''}
      </Text>
    </View>
  );
}

function VsPhase({ matchId, me, them }: { matchId: string; me: BattleParticipant | null; them: BattleParticipant | null }) {
  const ready = useReadyUp(matchId);
  const iAmReady = me?.ready_at != null;
  return (
    <>
      <ScreenHeader kicker="FRIENDLY BLITZ" title="FACE OFF" />
      <GlowCard glow={tokens.colors.epic}>
        <View className="flex-row items-center">
          <FighterCard p={me} align="left" />
          <Text
            className="px-s3 text-3xl font-bold"
            style={{ color: tokens.colors.epic, textShadowColor: 'rgba(168,85,247,0.7)', textShadowRadius: 18 }}
          >
            VS
          </Text>
          <FighterCard p={them} align="right" />
        </View>
      </GlowCard>
      <NeonButton
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

function ProgressBar({ pct, colour, label, kg }: { pct: number; colour: string; label: string; kg: number }) {
  return (
    <View className="mb-s2">
      <View className="mb-s1 flex-row justify-between">
        <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
          {label}
        </Text>
        <Text className="text-2xs font-bold" style={{ color: colour }}>
          {Math.trunc(pct)}% · {Math.trunc(kg)} kg
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
  const round = data.round;
  const spec = round?.spec ?? {};
  const object = objectByKey(String(spec.objectKey ?? ''));
  const target = Number(spec.targetEffectiveKg ?? object.blitzTargetKg);
  const secondsLeft = useCountdown(round?.ends_at ?? null);
  const settle = useSettleBattle(matchId);

  const myEvents = useMemo(
    () => data.events.filter((e) => e.user_id === userId).map(toVolume),
    [data.events, userId]
  );
  const theirEvents = useMemo(
    () => data.events.filter((e) => e.user_id !== userId).map(toVolume),
    [data.events, userId]
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
        <NeonButton title="REVEAL THE VERDICT" onPress={() => settle.mutate()} busy={settle.isPending} testID="battle-settle" />
      ) : (
        <Text className="text-center text-2xs text-text-mute">
          Every set logs to your real training history — battle sets are real sets.
        </Text>
      )}
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

function ScoreCard({ p, scores, won }: { p: BattleParticipant | null; scores: BattleBundle['scores']; won: boolean }) {
  const mine = scores.find((s) => s.user_id === p?.user_id);
  const c = (mine?.components ?? {}) as Record<string, number>;
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
          {mine?.points ?? p?.total_score ?? 0}
        </Text>
      </View>
      {(['completion', 'speed', 'variety', 'overload'] as const).map((key) => (
        <View key={key} className="flex-row justify-between">
          <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1.5 }}>
            {key.toUpperCase()}
          </Text>
          <Text className="text-2xs font-bold text-text-dim">{c[key] ?? 0}</Text>
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
