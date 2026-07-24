import { useEffect, useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '@/data/auth-context';
import { useIsAdmin } from '@/data/analytics-admin';
import { usePublicIdentity, useProfile } from '@/data/hooks';
import { useLogBodyweight, useSavePublicIdentity, useUpdateTrainingNumbers } from '@/data/mutations';
import { useAthleteProfile, useSetPrivacy, type PrivacyFlags } from '@/data/social-profile';
import { useDeleteAccount } from '@/data/moderation';
import { useToastStore } from '@/state/toast-store';
import { useCurrentStats } from '@/data/use-current-stats';
import { useAvatarData } from '@/data/use-avatar-data';
import { rankLadder } from '@/domain/profile';
import { pyFloat } from '@/domain/py';
import { useSettingsStore } from '@/state/settings-store';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { TwoFactorCard } from '@/ui/settings/two-factor-card';

const PHASES = ['cutting', 'maintaining', 'bulking'] as const;

/** Profile: who you are on the curve. The ladder is DERIVED from RANK_TIERS
 *  (rankLadder()), never restated -- the old page once hand-wrote all eight
 *  bands as text, free to drift from the function that decides the name. */
export default function ProfileScreen() {
  const { session, signOut } = useAuth();
  const profile = useProfile();
  const identity = usePublicIdentity();
  const { summary } = useAvatarData();
  const admin = useIsAdmin();

  const ladder = rankLadder().slice().reverse(); // top rank first

  return (
    <ScreenShell><ScreenHeader kicker="THE ATHLETE" title="PROFILE" />
        <GlowCard>
          <Text
            className="text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
          >
            SIGNED IN AS
          </Text>
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
        </GlowCard>

        <GlowCard>
          <Text
            className="mb-s3 text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
          >
            THE RANK LADDER
          </Text>
          {ladder.map(([low, high, name]) => {
            const current = summary.level >= low && summary.level <= high;
            return (
              <View
                key={name}
                className={`mb-s1 flex-row items-center justify-between rounded-md border p-s2 ${
                  current ? 'border-border-strong bg-surface-2' : 'border-border-soft'
                }`}
              >
                <Text
                  className={current ? 'text-text' : 'text-text-dim'}
                  allowFontScaling={false}
                  style={{ fontSize: 14, ...pixelFont() }}
                >
                  {name}
                </Text>
                <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 11, ...pixelFont() }}>
                  {low === high ? `Lv ${low}` : `Lv ${low}–${high}`}
                </Text>
              </View>
            );
          })}
        </GlowCard>

        <PrivacyCard />

        <TwoFactorCard />

        <BodyStatsCard />

        <TrainingNumbersCard />

        <GlowCard>
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
          <View className="mt-s3 flex-row items-center justify-between">
            <View className="flex-1 pr-s3">
              <Text className="text-sm font-bold text-text">Retro sounds</Text>
              <Text className="text-2xs text-text-mute">
                8-bit blips on button presses. Synthesized in-house, gym-headphone friendly.
              </Text>
            </View>
            <SoundSwitch />
          </View>
        </GlowCard>

        {admin.data === true ? (
          <>
            {/* The founder's dashboard sits ABOVE Insights on purpose: it is the
                one that answers "what should I do today", and it carries the
                alerts. Insights stays as the raw metrics view underneath. */}
            <Pressable
              onPress={() => router.push('/exec' as never)}
              accessibilityRole="button"
              testID="open-exec"
              className="flex-row items-center justify-between rounded-lg border p-s3"
              style={{ borderColor: 'rgba(251,113,133,0.35)', backgroundColor: 'rgba(251,113,133,0.06)' }}
            >
              <View className="flex-1">
                <Text className="text-danger" allowFontScaling={false} style={{ fontSize: 12, ...pixelFont() }}>🧭 EXEC →</Text>
                <Text className="mt-s1 text-2xs text-text-mute">Health score, activation funnel, live alerts and quick actions.</Text>
              </View>
            </Pressable>
            <Pressable
              onPress={() => router.push('/insights' as never)}
              accessibilityRole="button"
              testID="open-insights"
              className="flex-row items-center justify-between rounded-lg border p-s3"
              style={{ borderColor: 'rgba(34,211,238,0.35)', backgroundColor: 'rgba(34,211,238,0.06)' }}
            >
              <View className="flex-1">
                <Text className="text-accent" allowFontScaling={false} style={{ fontSize: 12, ...pixelFont() }}>📊 INSIGHTS →</Text>
                <Text className="mt-s1 text-2xs text-text-mute">Product metrics: active users, signups, retention, top pages.</Text>
              </View>
            </Pressable>
          </>
        ) : null}

        <View className="flex-row flex-wrap items-center justify-center" style={{ gap: 14, paddingVertical: 4 }}>
          {([['Terms', 'terms'], ['Privacy', 'privacy'], ['AI & Health', 'ai']] as const).map(([label, id]) => (
            <Pressable key={id} onPress={() => router.push(`/legal?doc=${id}` as never)} accessibilityRole="button" testID={`legal-link-${id}`} style={{ minHeight: 36, justifyContent: 'center' }}>
              <Text className="text-2xs text-text-mute" style={{ letterSpacing: 0.5 }}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable
          className="items-center rounded-md border border-border bg-surface-2 p-s3"
          onPress={signOut}
          testID="sign-out"
        >
          <Text className="text-text" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
            SIGN OUT
          </Text>
        </Pressable>

        <DeleteAccountCard />
    </ScreenShell>
  );
}

/** ACCOUNT DELETION (Apple 5.1.1(v), 2026-07-19): a two-step confirm — the
 *  athlete types DELETE, then the edge function removes the auth user and every
 *  owned row cascades. On success we sign out into the clean slate. */
function DeleteAccountCard() {
  const colors = useThemeColors();
  const { signOut } = useAuth();
  const del = useDeleteAccount();
  const [arming, setArming] = useState(false);
  const [confirm, setConfirm] = useState('');
  const ready = confirm.trim().toUpperCase() === 'DELETE';

  return (
    <GlowCard glow={colors.danger}>
      <Text className="text-2xs font-bold text-danger" style={{ letterSpacing: 1.5 }}>
        DANGER ZONE
      </Text>
      {!arming ? (
        <Pressable
          onPress={() => setArming(true)}
          accessibilityRole="button"
          testID="delete-account-open"
          className="mt-s2 items-center rounded-md border p-s3"
          style={{ borderColor: `${colors.danger}66`, backgroundColor: 'rgba(248,113,113,0.06)' }}
        >
          <Text className="text-danger" allowFontScaling={false} style={{ fontSize: 12, ...pixelFont() }}>
            DELETE MY ACCOUNT
          </Text>
        </Pressable>
      ) : (
        <View className="mt-s2 gap-s2">
          <Text className="text-2xs text-text-dim">
            This permanently deletes your account and all your data — workouts, stats, social, gyms.
            It cannot be undone. Type DELETE to confirm.
          </Text>
          <TextInput
            className="min-h-[46px] rounded-md border bg-surface-2 px-s3 text-center text-base font-bold text-text"
            style={{ letterSpacing: 3, borderColor: ready ? `${colors.danger}8c` : colors.border }}
            placeholder="DELETE"
            placeholderTextColor="#64758f"
            autoCapitalize="characters"
            value={confirm}
            onChangeText={setConfirm}
            testID="delete-account-confirm"
          />
          <View className="flex-row gap-s2">
            <Pressable
              onPress={() => { setArming(false); setConfirm(''); }}
              accessibilityRole="button"
              className="flex-1 items-center justify-center rounded-md border border-border p-s3"
              style={{ minHeight: 46 }}
            >
              <Text className="text-text-mute" allowFontScaling={false} style={{ fontSize: 12, ...pixelFont() }}>CANCEL</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                del.mutate(undefined, {
                  onSuccess: () => {
                    useToastStore.getState().push({ kind: 'info', title: 'ACCOUNT DELETED', subtitle: '' });
                    void signOut();
                  },
                  onError: (e) =>
                    useToastStore.getState().push({ kind: 'error', title: 'NOT DELETED', subtitle: e.message }),
                })
              }
              accessibilityRole="button"
              disabled={!ready || del.isPending}
              testID="delete-account-confirm-btn"
              className="flex-1 items-center justify-center rounded-md p-s3"
              style={{ minHeight: 46, backgroundColor: colors.danger, opacity: ready && !del.isPending ? 1 : 0.5 }}
            >
              <Text style={{ fontSize: 12, color: '#0b0f16', ...pixelFont() }}>
                {del.isPending ? 'DELETING…' : 'DELETE FOREVER'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </GlowCard>
  );
}

/**
 * BODY STATS (IMPROVEMENT_PLAN #1): the corrected write path over the one
 * read seam. Bodyweight APPENDS to bodyweight_log (never edits the frozen
 * onboarding snapshot -- base_level was derived from it); height updates
 * profile.height_cm; lifts are read-only because they are DERIVED from the
 * logs -- an editable field here would recreate the second source of truth
 * this card exists to remove.
 */
function BodyStatsCard() {
  const current = useCurrentStats();
  const logBw = useLogBodyweight();
  const training = useUpdateTrainingNumbers();
  const [bw, setBw] = useState('');
  const [height, setHeight] = useState('');

  const bwNum = pyFloat(bw);
  const heightNum = pyFloat(height);
  const fmt = (v: number | null, unit: string) => (v === null ? 'not tracked' : `${Math.round(v * 10) / 10} ${unit}`);

  return (
    <GlowCard>
      <Text
        className="mb-s1 text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
      >
        BODY STATS
      </Text>
      <Text className="mb-s3 text-2xs text-text-mute">
        One source of truth: weight entries append to your log; lifts derive from what you train.
      </Text>
      <View className="mb-s3 flex-row gap-s2">
        <View className="flex-1">
          <Text
            className="mb-s1 text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
          >
            BODYWEIGHT · {fmt(current.bodyweightKg, 'kg')}
          </Text>
          <TextInput
            className="min-h-[44px] rounded-md border border-border bg-surface-2 p-s2 text-text"
            inputMode="decimal"
            placeholder="log new (kg)"
            placeholderTextColor="#64758f"
            value={bw}
            onChangeText={setBw}
            testID="body-bw"
          />
        </View>
        <View className="flex-1">
          <Text
            className="mb-s1 text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
          >
            HEIGHT · {fmt(current.heightCm, 'cm')}
          </Text>
          <TextInput
            className="min-h-[44px] rounded-md border border-border bg-surface-2 p-s2 text-text"
            inputMode="decimal"
            placeholder="update (cm)"
            placeholderTextColor="#64758f"
            value={height}
            onChangeText={setHeight}
            testID="body-height"
          />
        </View>
      </View>
      <View className="mb-s3">
        {([
          ['BENCH', current.benchE1rm, current.sources.bench],
          ['SQUAT', current.squatE1rm, current.sources.squat],
          ['DEADLIFT', current.deadliftE1rm, current.sources.deadlift],
        ] as const).map(([label, value, src]) => (
          <View key={label} className="flex-row items-center justify-between py-s1">
            <Text
              className="text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
            >
              {label}
            </Text>
            <Text className="text-xs text-text-dim">
              {value === null ? 'not tracked' : `${Math.round(value * 10) / 10} kg e1RM`}
              <Text className="text-text-mute">
                {src === 'log' ? ' · from your logs' : src === 'profile' ? ' · onboarding' : ''}
              </Text>
            </Text>
          </View>
        ))}
      </View>
      <NeonButton
        title="SAVE BODY STATS"
        onPress={() => {
          if (bwNum !== null && bwNum > 0) logBw.mutate(bwNum, { onSuccess: () => setBw('') });
          if (heightNum !== null && heightNum > 50 && heightNum < 260) {
            training.mutate({ heightCm: heightNum });
            setHeight('');
          }
        }}
        disabled={!((bwNum ?? 0) > 0 || ((heightNum ?? 0) > 50 && (heightNum ?? 0) < 260))}
        busy={logBw.isPending || training.isPending}
        testID="body-save"
      />
    </GlowCard>
  );
}

/**
 * The 008 training numbers: deadlift e1RM (feeds the strength standards
 * curve and the Skill Tree) and nutrition phase (the Shredder entry gate).
 * Editable here because onboarding pre-dated the questions for existing
 * athletes; base_level stays immutable.
 */
function TrainingNumbersCard() {
  const colors = useThemeColors();
  const profile = useProfile();
  const save = useUpdateTrainingNumbers();
  const [deadlift, setDeadlift] = useState('');
  const [phase, setPhase] = useState<string | null>(null);

  // Seed the form from the profile once it arrives.
  const stored = profile.data;
  useEffect(() => {
    if (!stored) return;
    // Deferred: a synchronous setState inside an effect is a cascading-
    // render lint error (cold-cache CI catches it; warm local caches hide it).
    const t = setTimeout(() => {
      const dl = pyFloat(stored.deadlift_e1rm) ?? 0;
      setDeadlift(dl > 0 ? String(dl) : '');
      setPhase(stored.nutrition_phase ?? null);
    }, 0);
    return () => clearTimeout(t);
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
    <GlowCard>
      <Text
        className="mb-s1 text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
      >
        TRAINING NUMBERS
      </Text>
      <Text className="mb-s3 text-2xs text-text-mute">
        The deadlift feeds your strength score (40/30/30 with bench and squat); the phase drives
        the Shredder gates. Starting level never changes.
      </Text>
      <View className="mb-s3 flex-row items-end gap-s2">
        <View className="flex-1">
          <Text
            className="mb-s1 text-text-mute"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
          >
            DEADLIFT E1RM (KG)
          </Text>
          <TextInput
            className="min-h-[44px] rounded-md border bg-surface-2 p-s2 text-text"
            style={{ borderColor: dlValid ? colors.border : colors.danger }}
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
    </GlowCard>
  );
}

/**
 * IMPROVEMENT_PLAN #13: the privacy setting, first-class. It writes the
 * SAME public_profile row the Rank tab's opt-in does (one mutation, no
 * duplicate state). The backend already enforces the matrix: the
 * leaderboard is the ONLY cross-user read and it hard-filters is_public
 * in SQL; body data is owner-only regardless; battles are consent-by-
 * invite-code either way. The full matrix lives in IMPROVEMENT_PLAN.md #13.
 */
function PrivacyCard() {
  const colors = useThemeColors();
  const identity = usePublicIdentity();
  const save = useSavePublicIdentity();
  const [name, setName] = useState('');

  const hasName = Boolean(identity.data?.displayName);
  const isPublic = Boolean(identity.data?.isPublic);

  return (
    <GlowCard>
      <Text
        className="mb-s1 text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
      >
        PROFILE PRIVACY
      </Text>
      <View className="flex-row items-center justify-between">
        <View className="flex-1 pr-s3">
          <Text className="text-sm font-bold text-text">
            {isPublic ? 'Public profile' : 'Private profile'}
          </Text>
          <Text className="text-2xs text-text-mute">
            Public = listed on the leaderboard by display name. Private = invisible there. Either
            way your training data, measurements and photos are never readable by other athletes;
            battles are always by explicit invite code and show your name, level, class, scores and
            round-3 photos to that one opponent only.
          </Text>
        </View>
        <Switch
          value={isPublic}
          disabled={!hasName || save.isPending}
          onValueChange={(v) =>
            save.mutate({ displayName: identity.data?.displayName ?? null, isPublic: v })
          }
          trackColor={{ true: colors['accent-deep'], false: colors['surface-3'] }}
          thumbColor={colors.accent}
          testID="privacy-toggle"
        />
      </View>
      {!hasName ? (
        <View className="mt-s3 flex-row items-end gap-s2">
          <View className="flex-1">
            <Text
              className="mb-s1 text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
            >
              DISPLAY NAME (needed to go public or battle)
            </Text>
            <TextInput
              className="min-h-[44px] rounded-md border border-border bg-surface-2 p-s2 text-text"
              placeholder="3–24 characters"
              placeholderTextColor="#64758f"
              value={name}
              onChangeText={setName}
              testID="privacy-name"
            />
          </View>
          <Pressable
            className={`min-h-[44px] items-center justify-center rounded-md px-s4 ${name.trim().length >= 3 ? 'bg-accent' : 'border border-border bg-surface-2'}`}
            onPress={() => save.mutate({ displayName: name.trim(), isPublic: false })}
            disabled={save.isPending || name.trim().length < 3}
            accessibilityRole="button"
            testID="privacy-save-name"
          >
            <Text
              className={name.trim().length >= 3 ? 'text-accent-ink' : 'text-text-mute'}
              allowFontScaling={false}
              style={{ fontSize: 13, ...pixelFont() }}
            >
              SET
            </Text>
          </Pressable>
        </View>
      ) : null}

      {hasName ? <ProfileFieldPrivacy /> : null}
    </GlowCard>
  );
}

/**
 * FIELD PRIVACY (migration 055) — what a profile viewer sees. Discoverability
 * lists you in Social ▸ Discover; the three field toggles gate the stat blocks
 * on your public profile card (Evo pillars, exact lift e1RMs, bodyweight). Your
 * own profile always shows everything; these govern OTHER athletes' view.
 */
function ProfileFieldPrivacy() {
  const { session } = useAuth();
  const myId = session?.user?.id ?? null;
  const profile = useAthleteProfile(myId);
  const setPrivacy = useSetPrivacy();
  const flags = profile.data?.privacy ?? null;

  const rows: { key: keyof PrivacyFlags; title: string; sub: string }[] = [
    { key: 'discoverable', title: 'Discoverable', sub: 'List me in Social ▸ Discover (requires a public profile).' },
    { key: 'show_evo', title: 'Show Evo stats', sub: 'Forge Level, rank and the five Evo pillar scores.' },
    { key: 'show_lifts', title: 'Show exact lifts', sub: 'Bench / squat / deadlift estimated 1RM.' },
    { key: 'show_bodyweight', title: 'Show bodyweight', sub: 'Your current bodyweight on your profile.' },
  ];

  return (
    <View className="mt-s3 border-t border-border-soft pt-s3">
      <Text className="mb-s2 text-text-mute" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1.5, ...pixelFont(false) }}>
        WHAT OTHERS SEE ON YOUR PROFILE
      </Text>
      {rows.map((r) => (
        <PrivacyRow
          key={r.key}
          title={r.title}
          sub={r.sub}
          value={Boolean(flags?.[r.key])}
          disabled={profile.isPending || setPrivacy.isPending}
          onChange={(v) => setPrivacy.mutate({ [r.key]: v } as Partial<PrivacyFlags>)}
          testID={`fieldpriv-${r.key}`}
        />
      ))}
    </View>
  );
}

function PrivacyRow({ title, sub, value, disabled, onChange, testID }: { title: string; sub: string; value: boolean; disabled: boolean; onChange: (v: boolean) => void; testID: string }) {
  const colors = useThemeColors();
  return (
    <View className="mb-s2 flex-row items-center justify-between">
      <View className="flex-1 pr-s3">
        <Text className="text-sm font-bold text-text">{title}</Text>
        <Text className="text-2xs text-text-mute">{sub}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: colors['accent-deep'], false: colors['surface-3'] }}
        thumbColor={colors.accent}
        testID={testID}
      />
    </View>
  );
}

function SoundSwitch() {
  const colors = useThemeColors();
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const setSoundEnabled = useSettingsStore((s) => s.setSoundEnabled);
  return (
    <Switch
      value={soundEnabled}
      onValueChange={setSoundEnabled}
      trackColor={{ true: colors['accent-deep'], false: colors['surface-3'] }}
      thumbColor={colors.accent}
      testID="sound-toggle"
    />
  );
}

function PerfSwitch() {
  const colors = useThemeColors();
  const perfMode = useSettingsStore((s) => s.perfMode);
  const setPerfMode = useSettingsStore((s) => s.setPerfMode);
  return (
    <Switch
      value={perfMode}
      onValueChange={setPerfMode}
      trackColor={{ true: colors['accent-deep'], false: colors['surface-3'] }}
      thumbColor={colors.accent}
      testID="perf-mode"
    />
  );
}
