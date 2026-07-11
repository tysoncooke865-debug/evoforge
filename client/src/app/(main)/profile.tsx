import { useEffect, useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';

import { useAuth } from '@/data/auth-context';
import { usePublicIdentity, useProfile } from '@/data/hooks';
import { useUpdateTrainingNumbers } from '@/data/mutations';
import { useAvatarData } from '@/data/use-avatar-data';
import { rankLadder } from '@/domain/profile';
import { pyFloat } from '@/domain/py';
import { useSettingsStore } from '@/state/settings-store';
import tokens from '@/theme/tokens';
import { Chip, NeonButton } from '@/ui/neon-button';
import { ScreenHeader } from '@/ui/screen-header';
import { ScreenShell } from '@/ui/shell';

const PHASES = ['cutting', 'maintaining', 'bulking'] as const;

/** Profile: who you are on the curve. The ladder is DERIVED from RANK_TIERS
 *  (rankLadder()), never restated -- the old page once hand-wrote all eight
 *  bands as text, free to drift from the function that decides the name. */
export default function ProfileScreen() {
  const { session, signOut } = useAuth();
  const profile = useProfile();
  const identity = usePublicIdentity();
  const { summary } = useAvatarData();

  const ladder = rankLadder().slice().reverse(); // top rank first

  return (
    <ScreenShell><ScreenHeader kicker="THE ATHLETE" title="PROFILE" />
        <View className="rounded-lg border border-border bg-surface p-s6">
          <Text className="text-xs text-text-mute">SIGNED IN AS</Text>
          <Text className="mb-s2 text-sm text-text" testID="user-email">
            {session?.user.email}
          </Text>
          <Text className="text-xs text-text-mute">
            Public identity:{' '}
            {identity.data?.displayName
              ? `${identity.data.displayName} · ${identity.data.isPublic ? 'visible' : 'hidden'}`
              : 'not set (see Rank tab)'}
          </Text>
          <Text className="mt-s1 text-xs text-text-mute">
            Base level {profile.data?.base_level ?? 1} · Current level {summary.level} ·{' '}
            {summary.rank}
          </Text>
        </View>

        <View className="rounded-lg border border-border bg-surface p-s6">
          <Text className="mb-s3 text-xs text-text-mute">THE RANK LADDER</Text>
          {ladder.map(([low, high, name]) => {
            const current = summary.level >= low && summary.level <= high;
            return (
              <View
                key={name}
                className={`mb-s1 flex-row items-center justify-between rounded-md border p-s2 ${
                  current ? 'border-border-strong bg-surface-2' : 'border-border-soft'
                }`}
              >
                <Text className={current ? 'font-bold text-text' : 'text-text-dim'}>{name}</Text>
                <Text className="text-xs text-text-mute">
                  {low === high ? `Lv ${low}` : `Lv ${low}–${high}`}
                </Text>
              </View>
            );
          })}
        </View>

        <TrainingNumbersCard />

        <View className="rounded-lg border border-border bg-surface p-s4">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-s3">
              <Text className="text-sm font-bold text-text">Performance mode</Text>
              <Text className="text-2xs text-text-mute">
                Disables ambient animation loops (aura, float, sheen). One-shot effects like toasts
                always play — fast-forwarding them makes them invisible.
              </Text>
            </View>
            <PerfSwitch />
          </View>
        </View>

        <Pressable
          className="items-center rounded-md border border-border bg-surface-2 p-s3"
          onPress={signOut}
          testID="sign-out"
        >
          <Text className="font-bold text-text">SIGN OUT</Text>
        </Pressable>
    </ScreenShell>
  );
}

/**
 * The 008 training numbers: deadlift e1RM (feeds the strength standards
 * curve and the Skill Tree) and nutrition phase (the Shredder entry gate).
 * Editable here because onboarding pre-dated the questions for existing
 * athletes; base_level stays immutable.
 */
function TrainingNumbersCard() {
  const profile = useProfile();
  const save = useUpdateTrainingNumbers();
  const [deadlift, setDeadlift] = useState('');
  const [phase, setPhase] = useState<string | null>(null);

  // Seed the form from the profile once it arrives.
  const stored = profile.data;
  useEffect(() => {
    if (!stored) return;
    const dl = pyFloat(stored.deadlift_e1rm) ?? 0;
    setDeadlift(dl > 0 ? String(dl) : '');
    setPhase(stored.nutrition_phase ?? null);
  }, [stored]);

  const dl = pyFloat(deadlift);
  const dlValid = deadlift.trim() === '' || (dl !== null && dl > 0 && dl < 500);
  const dirty =
    (pyFloat(deadlift) ?? 0) !== (pyFloat(stored?.deadlift_e1rm) ?? 0) ||
    (phase ?? null) !== (stored?.nutrition_phase ?? null);

  const submit = () => {
    if (!dlValid) return;
    save.mutate({
      deadliftE1rm: deadlift.trim() === '' ? null : dl,
      ...(phase ? { nutritionPhase: phase } : {}),
    });
  };

  return (
    <View className="rounded-lg border border-border bg-surface p-s4">
      <Text className="mb-s1 text-xs text-text-mute">TRAINING NUMBERS</Text>
      <Text className="mb-s3 text-2xs text-text-mute">
        The deadlift feeds your strength score (40/30/30 with bench and squat); the phase drives
        the Shredder gates. Starting level never changes.
      </Text>
      <View className="mb-s3 flex-row items-end gap-s2">
        <View className="flex-1">
          <Text className="mb-s1 text-2xs font-bold text-text-mute" style={{ letterSpacing: 1.5 }}>
            DEADLIFT E1RM (KG)
          </Text>
          <TextInput
            className="min-h-[44px] rounded-md border bg-surface-2 p-s2 text-text"
            style={{ borderColor: dlValid ? tokens.colors.border : tokens.colors.danger }}
            inputMode="decimal"
            placeholder="e.g. 180"
            placeholderTextColor="#64758f"
            value={deadlift}
            onChangeText={setDeadlift}
            testID="profile-deadlift"
          />
        </View>
      </View>
      <View className="mb-s4 flex-row flex-wrap gap-s2">
        {PHASES.map((p) => (
          <Chip key={p} label={p.toUpperCase()} active={phase === p} onPress={() => setPhase(p)} />
        ))}
      </View>
      <NeonButton
        title="SAVE TRAINING NUMBERS"
        onPress={submit}
        disabled={!dirty || !dlValid}
        busy={save.isPending}
        testID="profile-save-training"
      />
    </View>
  );
}

function PerfSwitch() {
  const perfMode = useSettingsStore((s) => s.perfMode);
  const setPerfMode = useSettingsStore((s) => s.setPerfMode);
  return (
    <Switch
      value={perfMode}
      onValueChange={setPerfMode}
      trackColor={{ true: tokens.colors['accent-deep'], false: tokens.colors['surface-3'] }}
      thumbColor={tokens.colors.accent}
      testID="perf-mode"
    />
  );
}
