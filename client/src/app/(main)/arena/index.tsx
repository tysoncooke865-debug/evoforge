import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { progressionFeatures } from '@/data/progression/features';

import { useAuth } from '@/data/auth-context';
import { useMyBattles, useMyBattleScores, type BattleMatch } from '@/data/battle/hooks';
import { useBattleSnapshot, useCreateInvite, useJoinBattle } from '@/data/battle/mutations';
import { totalRoundsFor } from '@/domain/battle/engine';
import { formatGlyph, formatLabel, splitBattles } from '@/domain/battle/format';
import tokens from '@/theme/tokens';
import {
  BLITZ_RULES,
  CodeCard,
  IconBadge,
  PressCard,
  RulesStrip,
} from '@/ui/arena/battle-arena';
import { SegmentedTabs } from '@/ui/core/segmented-tabs';
import { CompanionMenuButton } from '@/ui/character/companion-menu';
import { NeonButton } from '@/ui/core/neon-button';
import { SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { useBattleRpgStore } from '@/state/battle-rpg-store';
import { PIXEL, PIXEL_BOLD } from '@/theme/fonts';
import { GYMS } from '@/domain/battle-rpg/gyms';

/**
 * The Arena hub, in the Home screen's language. TRANSFORM P7: A BATTLE IN
 * FLIGHT COMES FIRST — an athlete with a live match opens the Arena to
 * RESUME, not to a create form they don't want. Below that: the segmented
 * CREATE/JOIN capsule, the blitz card with the live invite code, the rules
 * strip, the mini games, the coming modes, and history rows that glow the
 * way they ended.
 */
export default function ArenaScreen() {
  const router = useRouter();
  const snapshot = useBattleSnapshot();
  const invite = useCreateInvite();
  const join = useJoinBattle();
  const battles = useMyBattles();
  const results = useMyBattleScores();
  const [tab, setTab] = useState<0 | 1>(0);
  const [code, setCode] = useState('');
  const rivalry = useBattleRpgStore((s) => s.rivalry);
  const gymProgress = useBattleRpgStore((s) => s.gymProgress);
  const badgeCount = GYMS.filter((g) => gymProgress[g.id]?.firstClearClaimed).length;

  // Live matches lead; open invites keep their code card; history is what's
  // actually over. Every match lands in exactly one bucket (pure, tested).
  const { live, invites, history } = splitBattles(battles.data ?? []);
  const openInvite = invites[0] ?? null;

  const createBattle = (format: string) => {
    invite.mutate(
      { snapshot, format },
      {
        onSuccess: (data) => router.push(`/arena/battle/${String(data.match_id)}`),
      }
    );
  };

  const joinBattle = () => {
    const clean = code.trim().toUpperCase();
    if (clean.length !== 6) return;
    join.mutate(
      { code: clean, snapshot },
      {
        onSuccess: (data) => {
          setCode('');
          router.push(`/arena/battle/${String(data.match_id)}`);
        },
      }
    );
  };

  return (
    <ScreenShell>
      {/* PROGRESSION P7: the Rival Rank door — competitive standing lives
          on its own page; battles here feed it. */}
      {progressionFeatures.rivalRankEnabled ? (
        <Pressable
          onPress={() => router.push('/rival' as never)}
          accessibilityRole="button"
          accessibilityLabel="Open your Rival Rank"
          testID="arena-rival-door"
          className="flex-row items-center justify-between rounded-md border px-s3"
          style={{ minHeight: 44, borderColor: `${tokens.colors.accent}45`, backgroundColor: 'rgba(34,211,238,0.06)' }}
        >
          <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1.5 }}>
            ⚔ RIVAL RANK — placements, rating, rated history
          </Text>
          <Text className="text-base font-bold text-accent">›</Text>
        </Pressable>
      ) : null}
      {/* Masthead — the Home identity treatment, with the arena emblem. */}
      <View className="w-full">
        <View className="flex-row items-end justify-between">
          <View className="flex-1">
            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 3 }}>
              SEASON 0 · PREVIEW
            </Text>
            <Text
              className="text-3xl font-bold text-text"
              style={{ letterSpacing: 0.5, textShadowColor: 'rgba(34,211,238,0.5)', textShadowRadius: 18 }}
            >
              BATTLE ARENA
            </Text>
            <Text className="text-xs text-text-dim">Compete. Improve. Dominate.</Text>
          </View>
          <CompanionMenuButton anim="punch" height={62} />
        </View>
      </View>

      {/* P7: the battle you are ALREADY IN, above everything else. */}
      {live.length > 0 ? (
        <View>
          <SectionLabel>{live.length === 1 ? 'ACTIVE BATTLE' : 'ACTIVE BATTLES'}</SectionLabel>
          {live.map((m) => (
            <ActiveBattleCard key={m.id} match={m} onPress={() => router.push(`/arena/battle/${m.id}`)} />
          ))}
        </View>
      ) : null}

      <SegmentedTabs left="⚔ CREATE BATTLE" right="🔍 JOIN BATTLE" active={tab} onChange={setTab} />

      {tab === 0 ? (
        <GlowCard glow={tokens.colors.accent}>
          <View className="mb-s3 flex-row items-center gap-s3">
            <IconBadge glyph="🏋" />
            <View className="flex-1">
              <Text className="text-xl font-bold text-text" style={{ letterSpacing: 0.5 }}>
                FRIENDLY BLITZ
              </Text>
              <View className="mt-s1 flex-row gap-s2">
                <MiniChip label="👥 1V1" />
                <MiniChip label="⏱ ~25 MIN" />
              </View>
            </View>
          </View>
          <Text className="mb-s4 text-2xs text-text-mute">
            Three lifts a rut, twelve minutes a bell. Challenge a friend, lift the object first.
          </Text>

          {openInvite?.invite_code ? (
            <View className="gap-s3">
              <CodeCard code={openInvite.invite_code} />
              <NeonButton
                title="ENTER THE ARENA"
                onPress={() => router.push(`/arena/battle/${openInvite.id}`)}
                testID="arena-enter"
              />
              <Text className="text-center text-2xs text-text-mute">
                Share the code — the battle starts the moment they join.
              </Text>
            </View>
          ) : (
            <NeonButton
              title="CREATE BATTLE · GET CODE"
              onPress={() => createBattle('blitz')}
              busy={invite.isPending}
              testID="arena-create"
            />
          )}
        </GlowCard>
      ) : (
        <GlowCard glow={tokens.colors.epic}>
          <View className="mb-s3 flex-row items-center gap-s3">
            <IconBadge glyph="🔍" tint={tokens.colors.epic} />
            <View className="flex-1">
              <Text className="text-xl font-bold text-text" style={{ letterSpacing: 0.5 }}>
                ENTER BATTLE CODE
              </Text>
              <Text className="mt-s1 text-2xs text-text-mute">Six characters, read aloud across the gym.</Text>
            </View>
          </View>
          <TextInput
            className="min-h-[52px] rounded-xl border bg-surface-2 p-s3 text-center text-2xl font-bold text-text"
            style={{
              letterSpacing: 10,
              borderColor: code.trim().length === 6 ? `${tokens.colors.epic}8c` : tokens.colors.border,
            }}
            placeholder="——————"
            placeholderTextColor="#64758f"
            autoCapitalize="characters"
            maxLength={6}
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            testID="arena-code"
          />
          <View className="mt-s3">
            <NeonButton
              title="JOIN BATTLE · ENTER ARENA"
              onPress={joinBattle}
              disabled={code.trim().length !== 6}
              busy={join.isPending}
              testID="arena-join"
            />
          </View>
        </GlowCard>
      )}

      <RulesStrip rules={BLITZ_RULES} />

      {/* CHAMPION BATTLES (turn-based beta) — Gyms / Rival / Training. */}
      <View>
        <SectionLabel>CHAMPION BATTLES</SectionLabel>
        {badgeCount > 0 ? (
          <View className="mb-s2 flex-row items-center rounded-lg border px-s3 py-s2" style={{ gap: 6, borderColor: `${tokens.colors.legendary}45`, backgroundColor: 'rgba(251,191,36,0.06)' }}>
            <Text style={{ fontSize: 13 }}>🎖</Text>
            <Text allowFontScaling={false} style={{ fontSize: 9, color: tokens.colors.legendary, fontFamily: PIXEL, letterSpacing: 1 }}>
              {badgeCount} / {GYMS.length} FORGE BADGES EARNED
            </Text>
          </View>
        ) : null}
        <View style={{ gap: 8 }}>
          {GYMS.map((g) => (
            <BattleModeCard
              key={g.id}
              glyph="🛡️"
              tint={tokens.colors.legendary}
              title={`${g.name.toUpperCase()} GYM`}
              note={`${g.leaderName} — ${g.leaderTitle}. ${g.theme}`}
              tag={gymProgress[g.id]?.cleared ? 'CLEARED ✓' : `REC. EVO ${g.recommendedRating}`}
              onPress={() => router.push(`/battle?mode=gym&gym=${g.id}` as never)}
              testID={`mode-gym-${g.id}`}
            />
          ))}
          <BattleModeCard
            glyph="⚔"
            tint={tokens.colors.danger}
            title="RIVAL BATTLE"
            note="Fight a saved rival or simulated challenger."
            tag={`VEX · ${rivalry.wins}W ${rivalry.losses}L`}
            onPress={() => router.push('/battle?mode=rival' as never)}
            testID="mode-rival"
          />
          <BattleModeCard
            glyph="🎯"
            tint={tokens.colors.accent}
            title="TRAINING BATTLE"
            note="Test moves without affecting your record."
            tag="NO STAKES"
            onPress={() => router.push('/battle?mode=training' as never)}
            testID="mode-training"
          />
        </View>
      </View>

      {/* MINI GAMES (design §16): single-round duels on the battle spine. */}
      {tab === 0 && !openInvite ? (
        <View>
          <SectionLabel>MINI GAMES</SectionLabel>
          <GlowCard glow={tokens.colors.danger}>
            <View className="mb-s3 flex-row items-center gap-s3">
              <IconBadge glyph="⚖" tint={tokens.colors.danger} />
              <View className="flex-1">
                <Text className="text-xl font-bold text-text" style={{ letterSpacing: 0.5 }}>
                  VOLUME DUEL
                </Text>
                <View className="mt-s1 flex-row gap-s2">
                  <MiniChip label="👥 1V1" />
                  <MiniChip label="⏱ 75 MIN" />
                </View>
              </View>
            </View>
            <Text className="mb-s4 text-2xs text-text-mute">
              Same gym hour, your own workout. Every set counts, coefficients keep it honest —
              most weight moved takes the duel. Every set is a REAL set: streak, stats and XP all bank.
            </Text>
            <NeonButton
              title="START VOLUME DUEL · GET CODE"
              variant="danger"
              onPress={() => createBattle('volume_duel')}
              busy={invite.isPending}
              testID="arena-create-duel"
            />
          </GlowCard>
          <View className="mt-s3">
            <GlowCard glow={tokens.colors.legendary}>
              <View className="mb-s3 flex-row items-center gap-s3">
                <IconBadge glyph="🪙" tint={tokens.colors.legendary} />
                <View className="flex-1">
                  <Text className="text-xl font-bold text-text" style={{ letterSpacing: 0.5 }}>
                    HEADS OR TAILS
                  </Text>
                  <View className="mt-s1 flex-row gap-s2">
                    <MiniChip label="👥 1V1" />
                    <MiniChip label="🪙 3 FLIPS" />
                    <MiniChip label="⏱ 30 MIN" />
                  </View>
                </View>
              </View>
              <Text className="mb-s4 text-2xs text-text-mute">
                The coin picks the muscle group — and who chooses each fighter{'’'}s exercise.
                Locked lifts, thirty minutes, most weight moved on YOUR lift wins.
              </Text>
              <NeonButton
                title="FLIP THE COIN · GET CODE"
                onPress={() => createBattle('heads_or_tails')}
                busy={invite.isPending}
                testID="arena-create-hot"
              />
            </GlowCard>
          </View>
        </View>
      ) : null}

      {/* The queue modes — coming, honestly labelled, dressed like Home cards. */}
      <View className="flex-row gap-s3">
        <ComingCard glyph="⚡" tint={tokens.colors.accent} title="QUICK MATCH" note="Matchmaking queue" />
        <ComingCard glyph="🏆" tint={tokens.colors.epic} title="RANKED" note="Trophies on the line" />
      </View>

      <View>
        <SectionLabel>BATTLE HISTORY</SectionLabel>
        {history.length === 0 ? (
          <Text className="text-2xs text-text-mute">
            {live.length > 0 || openInvite
              ? 'Nothing settled yet — finish what you started.'
              : 'No battles yet. Mint a code and call someone out.'}
          </Text>
        ) : (
          history.map((m) => <HistoryRow key={m.id} match={m} xp={results.data?.[m.id]?.xp ?? null} />)
        )}
      </View>
    </ScreenShell>
  );
}

/**
 * P7: the resume card. Live means the match is waiting on somebody — the
 * status says which somebody, so the athlete knows whether to lift or to
 * wait before they tap. Round n/N comes from the engine's own
 * totalRoundsFor, not a hardcoded 3 (a duel has one round).
 */
function ActiveBattleCard({ match, onPress }: { match: BattleMatch; onPress: () => void }) {
  const rounds = totalRoundsFor(match.format);
  const state =
    match.status === 'judging'
      ? { text: 'JUDGING · REVEAL WAITING', tint: tokens.colors.epic }
      : match.status === 'matched'
        ? { text: 'BOTH READY TO START', tint: tokens.colors.legendary }
        : { text: 'LIVE NOW', tint: tokens.colors.success };

  return (
    <View className="mb-s3">
      <PressCard onPress={onPress} tint={state.tint}>
        <View
          className="rounded-xl p-s4"
          style={{
            borderWidth: 1,
            borderColor: `${state.tint}66`,
            backgroundColor: 'rgba(13,21,36,0.72)',
            shadowColor: state.tint,
            shadowOpacity: 0.35,
            shadowRadius: 18,
            elevation: 5,
          }}
        >
          <View className="mb-s3 flex-row items-center gap-s3">
            <IconBadge glyph={formatGlyph(match.format)} tint={state.tint} />
            <View className="flex-1">
              <Text className="text-lg font-bold text-text" style={{ letterSpacing: 0.5 }}>
                {formatLabel(match.format)}
              </Text>
              <Text className="mt-s1 text-2xs font-bold" style={{ color: state.tint, letterSpacing: 1.5 }}>
                {state.text}
                {rounds > 1 ? ` · ROUND ${Math.min(Math.max(match.current_round, 1), rounds)}/${rounds}` : ''}
              </Text>
            </View>
          </View>
          <NeonButton title="RESUME BATTLE" onPress={onPress} testID={`arena-resume-${match.id}`} />
        </View>
      </PressCard>
    </View>
  );
}

function MiniChip({ label }: { label: string }) {
  return (
    <View
      className="rounded-pill px-s2 py-[3px]"
      style={{ borderWidth: 1, borderColor: `${tokens.colors.accent}40`, backgroundColor: 'rgba(34,211,238,0.08)' }}
    >
      <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1 }}>
        {label}
      </Text>
    </View>
  );
}

function ComingCard({ glyph, tint, title, note }: { glyph: string; tint: string; title: string; note: string }) {
  return (
    <View
      className="flex-1 rounded-xl p-s4"
      style={{
        borderWidth: 1,
        borderColor: `${tint}33`,
        backgroundColor: 'rgba(13,21,36,0.5)',
        shadowColor: tint,
        shadowOpacity: 0.18,
        shadowRadius: 16,
        elevation: 3,
      }}
    >
      <IconBadge glyph={glyph} tint={tint} size={44} />
      <Text className="mt-s3 text-sm font-bold text-text" style={{ letterSpacing: 1 }}>
        {title}
      </Text>
      <Text className="mt-s1 text-2xs text-text-mute">{note}</Text>
      <Text className="mt-s2 text-2xs font-bold" style={{ color: tint, letterSpacing: 1.5 }}>
        COMING SOON
      </Text>
    </View>
  );
}

function HistoryRow({ match, xp }: { match: BattleMatch; xp: number | null }) {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const settled = match.status === 'settled';
  const abandoned = match.status === 'abandoned';
  const won = settled && match.winner_user_id !== null && match.winner_user_id === userId;
  const draw = settled && match.winner_user_id === null;
  const tint = abandoned
    ? tokens.colors['text-mute']
    : !settled
      ? tokens.colors.accent
      : won
        ? tokens.colors.success
        : draw
          ? tokens.colors.rare
          : tokens.colors.danger;
  const label = abandoned ? 'CANCELLED' : !settled ? match.status.toUpperCase() : won ? 'VICTORY' : draw ? 'DRAW' : 'DEFEAT';

  return (
    <View className="mb-s2">
      <PressCard onPress={() => router.push(`/arena/battle/${match.id}`)} tint={tint}>
        <View
          className="flex-row items-center gap-s3 rounded-xl p-s3"
          style={{
            borderWidth: 1,
            borderColor: `${tint}40`,
            backgroundColor: 'rgba(13,21,36,0.55)',
            shadowColor: settled ? tint : '#000',
            shadowOpacity: settled ? 0.22 : 0,
            shadowRadius: 14,
            elevation: settled ? 3 : 0,
          }}
        >
          <IconBadge glyph={formatGlyph(match.format)} tint={tint} size={40} />
          <View className="flex-1">
            {/* Every row used to say "Friendly Blitz" — a duel lied about
                what it was. The format decides its own name now. */}
            <Text className="text-sm font-bold text-text">
              {formatLabel(match.format)}
              {match.invite_code ? ` · ${match.invite_code}` : ''}
            </Text>
            <Text className="text-2xs text-text-mute">{String(match.created_at).slice(0, 10)}</Text>
          </View>
          <View className="items-end">
            <Text className="text-xs font-bold" style={{ color: tint, letterSpacing: 1.5 }}>
              {label}
            </Text>
            {settled && xp ? (
              <Text className="text-2xs font-bold text-text-dim">+{xp} XP</Text>
            ) : null}
          </View>
        </View>
      </PressCard>
    </View>
  );
}

/** A turn-based battle mode card for the Arena hub. */
function BattleModeCard({ glyph, tint, title, note, tag, onPress, testID }: { glyph: string; tint: string; title: string; note: string; tag: string; onPress: () => void; testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${note}`}
      testID={testID}
      className="rounded-xl border p-s4"
      style={{ borderColor: `${tint}59`, backgroundColor: 'rgba(13,21,36,0.6)', shadowColor: tint, shadowOpacity: 0.18, shadowRadius: 14 }}
    >
      <View className="flex-row items-center" style={{ gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: `${tint}66`, backgroundColor: `${tint}14`, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 22 }}>{glyph}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text allowFontScaling={false} style={{ fontSize: 15, color: tokens.colors.text, fontFamily: PIXEL_BOLD, letterSpacing: 0.5 }}>{title}</Text>
          <Text style={{ marginTop: 2, fontSize: 12, color: tokens.colors['text-mute'] }} numberOfLines={2}>{note}</Text>
        </View>
        <Text allowFontScaling={false} style={{ fontSize: 15, color: tint }}>›</Text>
      </View>
      <Text allowFontScaling={false} style={{ marginTop: 8, fontSize: 8, color: tint, fontFamily: PIXEL, letterSpacing: 1 }}>{tag}</Text>
    </Pressable>
  );
}
