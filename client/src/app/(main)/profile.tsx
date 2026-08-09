import { useEffect, useState } from 'react';
import { Pressable, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { useAuth } from '@/data/auth-context';
import { useIsAdmin } from '@/data/analytics-admin';
import { usePublicIdentity, useProfile } from '@/data/hooks';
import { useLogBodyweight, useSavePublicIdentity, useUpdateTrainingNumbers } from '@/data/mutations';
import { useAthleteProfile, useSetPrivacy, type PrivacyFlags } from '@/data/social-profile';
import { useDeleteAccount } from '@/data/moderation';
import { useDeletePhysiqueData, usePhotoPrefs, useSavePhotoPrefs } from '@/data/photo-prefs';
import { useToastStore } from '@/state/toast-store';
import { askForMotion } from '@/ui/duel/physics/motion-permission';
import { useCurrentStats } from '@/data/use-current-stats';
import { useAvatarData } from '@/data/use-avatar-data';
import { rankLadder } from '@/domain/profile';
import { pyFloat } from '@/domain/py';
import { useSettingsStore } from '@/state/settings-store';
import { useCalloutsEnabled, useSetCalloutsEnabled } from '@/data/callout-prefs';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Chip, NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader, SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { TwoFactorCard } from '@/ui/settings/two-factor-card';

const PHASES = ['cutting', 'maintaining', 'bulking'] as const;

/** Profile: who you are on the curve. The ladder is DERIVED from RANK_TIERS
 *  (rankLadder()), never restated -- the old page once hand-wrote all eight
 *  bands as text, free to drift from the function that decides the name. */
export default function ProfileScreen() {
  const colors = useThemeColors();
  const { session, signOut } = useAuth();
  const profile = useProfile();
  const identity = usePublicIdentity();
  const { summary } = useAvatarData();
  const admin = useIsAdmin();

  const ladder = rankLadder().slice().reverse(); // top rank first

  // NO SKELETON HERE, deliberately: (main)/_layout.tsx already blocks every
  // route in this group until the profile has loaded (`session &&
  // profile.isPending`), so this screen can never render without one. A
  // skeleton would be unreachable code pretending to be a safety net.

  return (
    <ScreenShell><ScreenHeader kicker="THE ATHLETE" title="PROFILE" />
        {/* SECTIONED (Tyson, 2026-08-06). This was eleven cards in a row —
            who you are, your privacy switches, your body measurements, a sound
            toggle and ACCOUNT DELETION, all the same size, all the same
            weight, with nothing to say where one concern ended and the next
            began. The order is Identity → Privacy → Physique Photos → Body
            Stats → Training Numbers → Accessibility → Legal → Account, and the
            danger zone is fenced off at the bottom. */}
        <SectionLabel>IDENTITY</SectionLabel>
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

        <SectionLabel>PRIVACY</SectionLabel>
        <PrivacyCard />

        <SectionLabel>PHYSIQUE PHOTOS</SectionLabel>
        <PhysiquePhotosCard />

        <SectionLabel>BODY STATS</SectionLabel>
        <BodyStatsCard />

        <SectionLabel>TRAINING NUMBERS</SectionLabel>
        <TrainingNumbersCard />

        <SectionLabel>ACCESSIBILITY &amp; PREFERENCES</SectionLabel>

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
          <View className="mt-s3 flex-row items-center justify-between">
            <View className="flex-1 pr-s3">
              <Text className="text-sm font-bold text-text">Motion physics</Text>
              <Text className="text-2xs text-text-mute">
                Tilt your phone and the chips on a wager table slide with it. Switching it on here
                asks your phone for motion access once, so a call out never has to. Off here, or
                with your device&apos;s reduced-motion setting on, gravity just points down.
              </Text>
            </View>
            <MotionSwitch />
          </View>
          <View className="mt-s3 flex-row items-center justify-between">
            <View className="flex-1 pr-s3">
              <Text className="text-sm font-bold text-text">Hide forge reveals</Text>
              {/* THE COINS STILL ARRIVE. Saying so plainly is the point of the
                  setting: an opt-out that quietly cost money would not be one. */}
              <Text className="text-2xs text-text-mute">
                Training sometimes earns a bonus from the forge. Hide it and you still receive
                every coin — it just lands as a line in your summary, with no animation and no
                separate screen. Nothing expires and nothing is lost.
              </Text>
            </View>
            <RevealSwitch />
          </View>
          <View className="mt-s3 flex-row items-center justify-between">
            <View className="flex-1 pr-s3">
              <Text className="text-sm font-bold text-text">Workout call outs</Text>
              <Text className="text-2xs text-text-mute">
                &ldquo;50 says you can&apos;t hit this.&rdquo; Put coins on a set you are about to do,
                and let a friend doubt it. Off means off both ways — no call out button in
                Train, and nobody can call you out either.
              </Text>
            </View>
            <CalloutSwitch />
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

        <SectionLabel>LEGAL</SectionLabel>
        <View className="flex-row flex-wrap items-center justify-center" style={{ gap: 14, paddingVertical: 4 }}>
          {([['Terms', 'terms'], ['Privacy', 'privacy'], ['AI & Health', 'ai']] as const).map(([label, id]) => (
            <Pressable key={id} onPress={() => router.push(`/legal?doc=${id}` as never)} accessibilityRole="button" testID={`legal-link-${id}`} style={{ minHeight: 36, justifyContent: 'center' }}>
              <Text className="text-2xs text-text-mute" style={{ letterSpacing: 0.5 }}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <SectionLabel>ACCOUNT</SectionLabel>
        {/* Two-factor is account SECURITY, so it belongs here rather than
            between the body measurements it used to sit under. */}
        <TwoFactorCard />
        <Pressable
          className="items-center rounded-md border border-border bg-surface-2 p-s3"
          onPress={signOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
          style={{ minHeight: 44, justifyContent: 'center' }}
          testID="sign-out"
        >
          <Text className="text-text" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
            SIGN OUT
          </Text>
        </Pressable>
        <Pressable
          className="items-center rounded-md border border-border bg-surface-2 p-s3"
          onPress={() => router.push('/data' as never)}
          accessibilityRole="button"
          accessibilityLabel="Export or manage your data"
          style={{ minHeight: 44, justifyContent: 'center' }}
          testID="open-data"
        >
          <Text className="text-text" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
            MY DATA
          </Text>
        </Pressable>

        {/* THE DANGER ZONE — fenced, and last. Account deletion used to sit
            directly under SIGN OUT in an identical card, one mis-tap from a
            routine action (2026-08-06). It is still two-step; this makes the
            boundary visible before the first step. */}
        <View
          className="mt-s4 rounded-xl border p-s3"
          style={{ borderColor: `${colors.danger}66`, backgroundColor: 'rgba(251,113,133,0.05)', gap: 10 }}
          testID="profile-danger-zone"
        >
          <Text
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1.8, color: colors.danger, ...pixelFont(false) }}
          >
            ⚠ DANGER ZONE
          </Text>
          <Text className="text-2xs text-text-mute">
            Permanent, and not reversible. Everything below removes data for good.
          </Text>
          <DeleteAccountCard />
        </View>
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
/**
 * PHYSIQUE PHOTOS — the controls the consent sheet promises exist
 * (docs/ONBOARDING_V3_SPEC.md §6).
 *
 * Three honest statements, in the order they matter:
 *   1. what is actually stored (scores, never the images);
 *   2. how to stop being asked, permanently;
 *   3. how to delete everything derived from a photo.
 *
 * "Delete photos" would be theatre — solo scan photos were never persisted
 * in the first place. What this deletes is what DOES exist: the assessments
 * and ratings computed from them, and the baseline date.
 */
function PhysiquePhotosCard() {
  const colors = useThemeColors();
  const prefs = usePhotoPrefs();
  const save = useSavePhotoPrefs();
  const del = useDeletePhysiqueData();
  const [confirming, setConfirming] = useState(false);

  return (
    <View className="rounded-xl border p-s4" style={{ borderColor: colors.border, backgroundColor: 'rgba(13,21,36,0.55)' }}>
      <Text
        className="mb-s1 text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
      >
        PHYSIQUE PHOTOS
      </Text>
      <Text className="text-2xs text-text-mute">
        Physique photos are analysed and discarded — EvoForge never stores the images. What is
        kept is the scores they produced, and a one-way fingerprint so the same photo is not
        analysed twice. They are never shown on your profile or to another athlete.
      </Text>

      <View className="mt-s3 flex-row items-center justify-between">
        <View className="flex-1 pr-s3">
          <Text className="text-sm font-bold text-text">Ask me about photos</Text>
          <Text className="text-2xs text-text-mute">
            Off means never again, on every screen. Every training feature works either way.
          </Text>
        </View>
        <Switch
          value={!prefs.promptsDisabled}
          disabled={!prefs.ready || save.isPending}
          onValueChange={(v) => save.mutate({ promptsDisabled: !v })}
          trackColor={{ true: colors['accent-deep'], false: colors['surface-3'] }}
          thumbColor={colors.accent}
          testID="photo-prompts-toggle"
        />
      </View>

      <View className="mt-s4">
        {confirming ? (
          <>
            <Text className="mb-s2 text-2xs text-warn">
              This deletes every physique score derived from a photo, clears your baseline and
              stops the prompts. Your workouts, PRs, strength and cardio are untouched.
            </Text>
            <View className="flex-row gap-s2">
              <View className="flex-1">
                <NeonButton
                  title={del.isPending ? 'DELETING' : 'DELETE IT ALL'}
                  variant="danger"
                  busy={del.isPending}
                  onPress={() => del.mutate(undefined, { onSuccess: () => setConfirming(false) })}
                  testID="physique-delete-confirm"
                />
              </View>
              <View className="flex-1">
                <NeonButton title="CANCEL" variant="ghost" onPress={() => setConfirming(false)} testID="physique-delete-cancel" />
              </View>
            </View>
          </>
        ) : (
          <NeonButton
            title="DELETE MY PHYSIQUE DATA"
            variant="ghost"
            onPress={() => setConfirming(true)}
            testID="physique-delete"
          />
        )}
      </View>
    </View>
  );
}

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

/**
 * MOTION PHYSICS — the chip table's gravity follows the phone's tilt.
 *
 * A setting rather than always-on because a sensor that moves things while
 * somebody is reading has to be refusable, and because a denied or absent
 * sensor must degrade to plain gravity anyway. Reduced motion turns it off on
 * its own; this is the manual override on top.
 */
/**
 * MOTION PHYSICS — and the one place the sensor is asked for.
 *
 * iOS only hands out the accelerometer from inside a real user gesture, so
 * something has to ask. It used to be a chip on the wager table, which meant
 * being asked again on every tray — a question the athlete had already
 * answered, which reads as the app forgetting (Tyson, 2026-08-08).
 *
 * A switch tap IS a gesture, so the ask belongs here: once, deliberately, in
 * the place you would go looking for it. `askForMotion` records the grant, and
 * the table stops offering ENABLE TILT from then on.
 *
 * Turning it OFF never revokes anything — only the OS can — so it simply stops
 * steering gravity, and turning it back on will not re-prompt.
 */
/**
 * HIDE FORGE REVEALS FOREVER (Spec v5 §8).
 *
 * A plain switch with no confirmation and no "are you sure" — §8 wants leaving
 * frictionless, and a dialog defending a feature against being turned off is the
 * sunk-cost pattern the same section bans.
 *
 * It hides the CEREMONY. `forge_reveal_claim` still pays, and the summary still
 * reports the coins, because an opt-out that cost money would make the feature
 * something an athlete cannot really decline.
 */
function RevealSwitch() {
  const colors = useThemeColors();
  const revealsHidden = useSettingsStore((s) => s.revealsHidden);
  const setRevealsHidden = useSettingsStore((s) => s.setRevealsHidden);
  return (
    <Switch
      value={revealsHidden}
      onValueChange={setRevealsHidden}
      trackColor={{ false: colors.border, true: colors.accent }}
      testID="settings-hide-reveals"
      accessibilityLabel="Hide forge reveals. Coins are still awarded."
    />
  );
}

function MotionSwitch() {
  const colors = useThemeColors();
  const motionPhysics = useSettingsStore((s) => s.motionPhysics);
  const setMotionPhysics = useSettingsStore((s) => s.setMotionPhysics);
  const [asking, setAsking] = useState(false);
  return (
    <Switch
      value={motionPhysics}
      disabled={asking}
      onValueChange={(on) => {
        setMotionPhysics(on);
        if (!on) return;
        setAsking(true);
        void askForMotion().then((r) => {
          setAsking(false);
          if (r === 'denied') {
            useToastStore.getState().push({
              kind: 'info',
              title: 'MOTION BLOCKED',
              subtitle: 'Allow Motion & Orientation for this site, then switch it on again.',
            });
          } else if (r === 'unsupported') {
            useToastStore.getState().push({
              kind: 'info',
              title: 'NO MOTION SENSOR',
              subtitle: 'This device has none. Chips still fall, they just do not lean.',
            });
          }
        });
      }}
      trackColor={{ true: colors['accent-deep'], false: colors['surface-3'] }}
      thumbColor={colors.accent}
      testID="motion-physics"
    />
  );
}

/**
 * WORKOUT CALL OUTS. The only switch in this card that is NOT device-local:
 * it also decides whether a friend can put coins on your bench press, so the
 * server has to know it (profile.callouts_enabled, checked inside
 * callout_create). Disabled until the profile has loaded, so it can never flip
 * back under the athlete's finger.
 */
function CalloutSwitch() {
  const colors = useThemeColors();
  const { enabled, ready } = useCalloutsEnabled();
  const save = useSetCalloutsEnabled();
  return (
    <Switch
      value={enabled}
      disabled={!ready || save.isPending}
      onValueChange={(v) => save.mutate(v)}
      trackColor={{ true: colors['accent-deep'], false: colors['surface-3'] }}
      thumbColor={colors.accent}
      testID="callouts-enabled"
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
