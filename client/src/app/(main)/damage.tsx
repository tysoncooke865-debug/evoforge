import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { captureCameraPhoto } from '@/data/ai';
import {
  useCancelAssessment,
  useCreateAssessment,
  useDamageAssessments,
  useSubmitDaPhoto,
  type DamageAssessment,
} from '@/data/damage-assessment';
import { useAuth } from '@/data/auth-context';
import { useFriends } from '@/data/social';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';

/**
 * DAMAGE ASSESSMENT (Tyson, 2026-07-17) — migration 038. Challenge a friend:
 * both capture a PRE-pump photo, train, capture a POST photo; the AI judges
 * whose physique changed the most and the winner takes the XP. Photos are
 * CAMERA CAPTURES ONLY, go straight to the edge function, and are deleted
 * server-side the moment the verdict lands.
 */
export default function DamageScreen() {
  const colors = useThemeColors();
  const { session } = useAuth();
  const me = session?.user?.id ?? '';
  const assessments = useDamageAssessments();
  const friends = useFriends();
  const create = useCreateAssessment();
  const cancel = useCancelAssessment();
  const submit = useSubmitDaPhoto();
  const [picking, setPicking] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const capture = async (id: string, kind: 'pre' | 'post') => {
    const uri = await captureCameraPhoto();
    if (!uri) return; // cancelled — nothing captured, nothing stored
    setBusyId(id);
    submit.mutate({ id, kind, image: uri }, { onSettled: () => setBusyId(null) });
  };

  const open = (assessments.data ?? []).filter((a) => a.status === 'open');
  const judged = (assessments.data ?? []).filter((a) => a.status === 'judged');
  const activeRivals = new Set(open.flatMap((a) => [a.challenger_id, a.opponent_id]));

  return (
    <ScreenShell>
      <ScreenHeader kicker="ARENA" title="DAMAGE ASSESSMENT" onBack={() => router.replace('/arena' as never)} />
      <Text className="text-2xs text-text-mute">
        PRE photo → train → POST photo. The AI judges whose physique changed the most. Photos are
        judged then deleted — only the scores survive.
      </Text>

      {/* Start one. */}
      {picking ? (
        <GlowCard>
          <Text allowFontScaling={false} style={{ fontSize: 10, color: colors.epic, letterSpacing: 1.5, ...pixelFont(false) }}>
            PICK YOUR VICTIM
          </Text>
          <View className="mt-s2 gap-s2">
            {(friends.data ?? []).filter((f) => !activeRivals.has(f.id)).map((f) => (
              <Pressable
                key={f.id}
                onPress={() => {
                  setPicking(false);
                  create.mutate(f.id);
                }}
                accessibilityRole="button"
                testID={`da-pick-${f.id}`}
                className="flex-row items-center justify-between rounded-xl border border-border p-s3"
                style={{ backgroundColor: 'rgba(13,21,36,0.5)' }}
              >
                <Text className="text-sm font-bold text-text">{f.display_name}</Text>
                <Text className="text-base text-epic">⚔</Text>
              </Pressable>
            ))}
            {(friends.data ?? []).length === 0 ? (
              <Text className="text-2xs text-text-mute">No friends yet — add rivals from the Arena first.</Text>
            ) : null}
          </View>
          <View className="mt-s3">
            <NeonButton title="CANCEL" variant="ghost" onPress={() => setPicking(false)} />
          </View>
        </GlowCard>
      ) : (
        <NeonButton title="⚔ CHALLENGE A FRIEND" onPress={() => setPicking(true)} pixel testID="da-new" />
      )}

      {/* Open assessments. */}
      {open.map((a) => (
        <OpenCard
          key={a.id}
          a={a}
          busy={busyId === a.id}
          onCapture={capture}
          onCancel={() => cancel.mutate(a.id)}
        />
      ))}

      {/* Verdicts. */}
      {judged.length > 0 ? (
        <Text allowFontScaling={false} style={{ fontSize: 10, color: colors['text-mute'], letterSpacing: 1.5, ...pixelFont(false) }}>
          PAST VERDICTS
        </Text>
      ) : null}
      {judged.map((a) => {
        const iWon = a.winner_id === me;
        const draw = a.winner_id === null;
        const mySide = a.i_am_challenger ? a.verdict?.challenger : a.verdict?.opponent;
        const theirSide = a.i_am_challenger ? a.verdict?.opponent : a.verdict?.challenger;
        return (
          <View
            key={a.id}
            className="rounded-xl border p-s3"
            style={{
              borderColor: draw ? colors.border : iWon ? `${colors.success}59` : `${colors.danger}45`,
              backgroundColor: draw ? 'rgba(13,21,36,0.4)' : iWon ? 'rgba(52,211,153,0.06)' : 'rgba(251,113,133,0.05)',
            }}
            testID={`da-verdict-${a.id}`}
          >
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-bold text-text">vs {a.opponent_name}</Text>
              <Text
                allowFontScaling={false}
                style={{ fontSize: 12, color: draw ? colors['text-dim'] : iWon ? colors.success : colors.danger, ...pixelFont() }}
              >
                {draw ? 'DRAW' : iWon ? 'VICTORY +40 XP' : 'DEFEAT'}
              </Text>
            </View>
            <Text className="mt-s1 text-2xs text-text-dim">
              You {mySide?.delta ?? '?'} — {theirSide?.delta ?? '?'} them
            </Text>
            {mySide?.blurb ? <Text className="mt-s1 text-2xs text-text-mute">{mySide.blurb}</Text> : null}
          </View>
        );
      })}
    </ScreenShell>
  );
}

function OpenCard({
  a,
  busy,
  onCapture,
  onCancel,
}: {
  a: DamageAssessment;
  busy: boolean;
  onCapture: (id: string, kind: 'pre' | 'post') => void;
  onCancel: () => void;
}) {
  const colors = useThemeColors();
  const stage: 'pre' | 'post' | 'waiting' = !a.my_pre ? 'pre' : !a.my_post ? 'post' : 'waiting';
  return (
    <GlowCard glow={colors.epic}>
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-bold text-text">vs {a.opponent_name}</Text>
        <Text allowFontScaling={false} style={{ fontSize: 9, color: colors.epic, letterSpacing: 1, ...pixelFont(false) }}>
          {stage === 'waiting' ? 'YOU ARE IN' : stage === 'pre' ? 'PRE PHOTO DUE' : 'TRAIN, THEN POST PHOTO'}
        </Text>
      </View>
      <View className="mt-s2 flex-row gap-s2">
        <Step done={a.my_pre} label="MY PRE" />
        <Step done={a.my_post} label="MY POST" />
        <Step done={a.their_pre} label="THEIR PRE" />
        <Step done={a.their_post} label="THEIR POST" />
      </View>
      <View className="mt-s3">
        {stage !== 'waiting' ? (
          <NeonButton
            title={busy ? 'JUDGING…' : stage === 'pre' ? '📸 CAPTURE PRE PHOTO' : '📸 CAPTURE POST PHOTO'}
            onPress={() => onCapture(a.id, stage)}
            busy={busy}
            pixel
            testID={`da-capture-${a.id}`}
          />
        ) : (
          <Text className="text-center text-2xs text-text-mute">
            Waiting on {a.opponent_name} — the verdict lands the moment their photos are in.
          </Text>
        )}
      </View>
      <Pressable onPress={onCancel} accessibilityRole="button" className="mt-s2 items-center" style={{ minHeight: 32, justifyContent: 'center' }} testID={`da-cancel-${a.id}`}>
        <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>CALL IT OFF</Text>
      </Pressable>
    </GlowCard>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  const colors = useThemeColors();
  return (
    <View
      className="flex-1 items-center rounded-lg border px-s1 py-s1"
      style={{
        borderColor: done ? `${colors.success}59` : colors.border,
        backgroundColor: done ? 'rgba(52,211,153,0.08)' : 'rgba(13,21,36,0.4)',
      }}
    >
      <Text allowFontScaling={false} style={{ fontSize: 7.5, color: done ? colors.success : colors['text-mute'], letterSpacing: 0.5, ...pixelFont(false) }}>
        {done ? '✓ ' : ''}{label}
      </Text>
    </View>
  );
}
