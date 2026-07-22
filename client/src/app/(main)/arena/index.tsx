import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { progressionFeatures } from '@/data/progression/features';

import { useMyBattles, useMyBattleScores, type BattleMatch } from '@/data/battle/hooks';
import { useFriendGhosts } from '@/data/ghosts';
import { useBattleSnapshot } from '@/data/battle/mutations';
import { useDuelMatchmaking, type DuelFormat } from '@/data/matchmaking';
import { totalRoundsFor } from '@/domain/battle/engine';
import { formatGlyph, formatLabel, splitBattles } from '@/domain/battle/format';
import { PIXEL, PIXEL_BOLD, pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { IconBadge, PressCard } from '@/ui/arena/battle-arena';
import { CompanionMenuButton } from '@/ui/character/companion-menu';
import { NeonButton } from '@/ui/core/neon-button';
import { OnlineBadge } from '@/ui/core/online-badge';
import { SectionLabel } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { arenaGameFeatures } from '@/arena-game/features';
import { HistoryRow } from '@/ui/arena/history-row';
import { useBattleRpgStore } from '@/state/battle-rpg-store';
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
  const colors = useThemeColors();
  const router = useRouter();
  const snapshot = useBattleSnapshot();
  const battles = useMyBattles();
  const results = useMyBattleScores();
  const rivalry = useBattleRpgStore((s) => s.rivalry);
  const gymProgress = useBattleRpgStore((s) => s.gymProgress);
  const badgeCount = GYMS.filter((g) => gymProgress[g.id]?.firstClearClaimed).length;
  const friendGhosts = useFriendGhosts();

  // Live matches lead; history is what's actually over. Every match lands in
  // exactly one bucket (pure, tested).
  const { live, history } = splitBattles(battles.data ?? []);

  // FITNESS-DUEL matchmaking (077): pick a format → get paired → drop into the
  // existing /arena/battle/[id] flow. Replaces the old create/join-by-code.
  const duel = useDuelMatchmaking();
  const startDuel = (format: DuelFormat) => void duel.start(format, snapshot);
  const searching = duel.state.status === 'searching';
  // After a wait with no opponent, offer an AI-battle fallback (never stuck).
  const [duelLongWait, setDuelLongWait] = useState(false);
  useEffect(() => {
    if (!searching) return;
    const t = setTimeout(() => setDuelLongWait(true), 40000);
    return () => { clearTimeout(t); setDuelLongWait(false); };
  }, [searching]);
  const navigatedRef = useRef(false);
  useEffect(() => {
    if (duel.state.status === 'matched' && !navigatedRef.current) {
      navigatedRef.current = true;
      router.push(`/arena/battle/${duel.state.matchId}`);
    }
    if (duel.state.status === 'idle') navigatedRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duel.state.status]);

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
          style={{ minHeight: 44, borderColor: `${colors.accent}45`, backgroundColor: 'rgba(34,211,238,0.06)' }}
        >
          <Text
            className="text-accent"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
          >
            ⚔ RIVAL RANK — placements, rating, rated history
          </Text>
          <Text className="text-base font-bold text-accent">›</Text>
        </Pressable>
      ) : null}
      {/* EVOFORGE ARENA (card-battler beta) — the mini-game, mounted as its
          own route group; champion + build derive from this athlete's real
          Evo Rating pillars and Origin. */}
      {arenaGameFeatures.arenaGameEnabled ? (
        <Pressable
          onPress={() => router.push('/forge-arena' as never)}
          accessibilityRole="button"
          accessibilityLabel="Open EvoForge Arena, the card battler beta"
          testID="arena-game-door"
          className="flex-row items-center justify-between rounded-md border px-s3"
          style={{ minHeight: 44, borderColor: `${colors.accent}45`, backgroundColor: 'rgba(34,211,238,0.06)' }}
        >
          <Text
            className="text-accent"
            allowFontScaling={false}
            style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
          >
            ♜ EVOFORGE ARENA — card battler (beta), forged from your Evo Rating
          </Text>
          <Text className="text-base font-bold text-accent">›</Text>
        </Pressable>
      ) : null}
      {/* FRIENDS & RIVALS door (migration 036) — the social hub. */}
      <Pressable
        onPress={() => router.push('/friends?from=arena' as never)}
        accessibilityRole="button"
        accessibilityLabel="Open friends and rivals"
        testID="arena-friends-door"
        className="flex-row items-center justify-between rounded-md border px-s3"
        style={{ minHeight: 44, borderColor: `${colors.epic}45`, backgroundColor: 'rgba(168,85,247,0.06)' }}
      >
        <Text className="text-epic" allowFontScaling={false} style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}>
          ✦ FRIENDS &amp; RIVALS — add by name, track your head-to-head
        </Text>
        <Text className="text-base font-bold text-epic">›</Text>
      </Pressable>
      {/* Masthead — the Home identity treatment, with the arena emblem. */}
      <View className="w-full">
        <View className="flex-row items-end justify-between">
          <View className="flex-1">
            <Text
              className="text-text-mute"
              allowFontScaling={false}
              style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
            >
              SEASON 0 · PREVIEW
            </Text>
            <Text
              className="text-text"
              allowFontScaling={false}
              style={{
                fontSize: 30,
                lineHeight: 36,
                letterSpacing: 0,
                textShadowColor: 'rgba(34,211,238,0.55)',
                textShadowRadius: 18,
                ...pixelFont(),
              }}
            >
              BATTLE ARENA
            </Text>
            <View className="mt-s1 flex-row items-center" style={{ gap: 8 }}>
              <Text className="text-xs text-text-dim">Compete. Improve. Dominate.</Text>
              <OnlineBadge testID="arena-online" />
            </View>
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

      <GlowCard glow={colors.accent}>
        <View className="mb-s3 flex-row items-center gap-s3">
          <IconBadge glyph="🏋" />
          <View className="flex-1">
            <Text className="text-text" allowFontScaling={false} style={{ fontSize: 20, ...pixelFont() }}>
              FRIENDLY BLITZ
            </Text>
            <View className="mt-s1 flex-row gap-s2">
              <MiniChip label="👥 1V1" />
              <MiniChip label="⏱ ~25 MIN" />
            </View>
          </View>
        </View>
        <Text className="mb-s4 text-2xs text-text-mute">
          Three lifts a rut, twelve minutes a bell. Get matched with a real opponent and lift the object first — no code.
        </Text>
        <NeonButton
          title="⚔ FIND A DUEL"
          onPress={() => startDuel('blitz')}
          busy={searching}
          testID="arena-create"
        />
      </GlowCard>

      {/* §7.2 (2026-07-19): the JOIN tab is ONLY the box — every section
          The fragment closes just before BATTLE HISTORY's sibling below. */}
      {(
        <>
      {/* The queue modes — still coming-soon, promoted to the old rules
          strip's slot (the strip is gone; the rules live on the battle page). */}
      <View className="flex-row gap-s3">
        <LiveCard
          glyph="⚡"
          tint={colors.accent}
          title="QUICK MATCH"
          note="Get paired with a live rival and fight now — no code."
          onPress={() => router.push('/pvp' as never)}
          testID="mode-quickmatch"
        />
        <LiveCard
          glyph="🏆"
          tint={colors.epic}
          title="RIVAL RANK"
          note="Your rating, division and rated history."
          onPress={() => router.push('/rival' as never)}
          testID="mode-ranked"
        />
      </View>

      {/* The turn-based trio — same tints, glyphs and doors as their old
          full-width cards, compacted to one row. */}
      <View className="flex-row gap-s2">
        <BattleModeCard
          compact
          glyph="⚔"
          tint={colors.danger}
          title="RIVAL"
          note="Fight a saved rival or simulated challenger."
          tag={`VEX · ${rivalry.wins}W ${rivalry.losses}L`}
          onPress={() => router.push('/battle?mode=rival' as never)}
          testID="mode-rival"
        />
        <BattleModeCard
          compact
          glyph="👥"
          tint={colors.epic}
          title="VERSUS"
          note="Pass-and-play a friend on one device."
          tag="LOCAL 1V1"
          onPress={() => router.push('/battle?mode=versus' as never)}
          testID="mode-versus"
        />
        <BattleModeCard
          compact
          glyph="🎯"
          tint={colors.accent}
          title="TRAINING"
          note="Test moves without affecting your record."
          tag="NO STAKES"
          onPress={() => router.push('/battle?mode=training' as never)}
          testID="mode-training"
        />
      </View>

      {/* CHAMPION BATTLES (turn-based beta) — the gyms. */}
      <View>
        <SectionLabel>CHAMPION BATTLES</SectionLabel>
        {badgeCount > 0 ? (
          <View className="mb-s2 flex-row items-center rounded-lg border px-s3 py-s2" style={{ gap: 6, borderColor: `${colors.legendary}45`, backgroundColor: 'rgba(251,191,36,0.06)' }}>
            <Text style={{ fontSize: 13 }}>🎖</Text>
            <Text allowFontScaling={false} style={{ fontSize: 9, color: colors.legendary, fontFamily: PIXEL, letterSpacing: 1 }}>
              {badgeCount} / {GYMS.length} FORGE BADGES EARNED
            </Text>
          </View>
        ) : null}
        <View style={{ gap: 8 }}>
          {GYMS.map((g) => (
            <BattleModeCard
              key={g.id}
              glyph="🛡️"
              tint={colors.legendary}
              title={`${g.name.toUpperCase()} GYM`}
              note={`${g.leaderName} — ${g.leaderTitle}. ${g.theme}`}
              tag={gymProgress[g.id]?.cleared ? 'CLEARED ✓' : `REC. EVO ${g.recommendedRating}`}
              onPress={() => router.push(`/battle?mode=gym&gym=${g.id}` as never)}
              testID={`mode-gym-${g.id}`}
            />
          ))}
        </View>
      </View>

      {/* GHOST BATTLES (migration 037): fight the snapshot of a friend's real
          logged session. Empty state points at the Friends hub. */}
      <View>
        <SectionLabel>GHOST BATTLES</SectionLabel>
        {friendGhosts.data && friendGhosts.data.length > 0 ? (
          <View style={{ gap: 8 }}>
            {friendGhosts.data.slice(0, 6).map((g) => (
              <BattleModeCard
                key={g.id}
                glyph="👻"
                tint={colors.epic}
                title={`${g.owner_name.toUpperCase()} — ${g.workout.toUpperCase()}`}
                note={`${g.date} · ${g.headline?.sets ?? '?'} sets banked. Beat the session's ghost.`}
                tag={g.plays > 0 ? `${g.defeats}/${g.plays} FELLED` : 'UNTESTED'}
                onPress={() => router.push(`/battle?mode=ghost&ghost=${g.id}` as never)}
                testID={`mode-ghost-${g.id}`}
              />
            ))}
          </View>
        ) : (
          <Text className="text-2xs text-text-mute">
            No ghosts yet — friends publish them from a finished workout. Add rivals above.
          </Text>
        )}
      </View>

      {/* DAMAGE ASSESSMENT (migration 038): the pre/post pump photo duel. */}
      <View>
        <SectionLabel>DAMAGE ASSESSMENT</SectionLabel>
        <BattleModeCard
          glyph="📸"
          tint={colors.danger}
          title="DAMAGE ASSESSMENT"
          note="PRE photo, train, POST photo — the AI judges whose physique changed most."
          tag="VS A FRIEND"
          onPress={() => router.push('/damage' as never)}
          testID="mode-damage"
        />
      </View>

      {/* MINI GAMES (design §16): single-round duels on the battle spine. */}
      {(
        <View>
          <SectionLabel>MINI GAMES</SectionLabel>
          <GlowCard glow={colors.danger}>
            <View className="mb-s3 flex-row items-center gap-s3">
              <IconBadge glyph="⚖" tint={colors.danger} />
              <View className="flex-1">
                <Text className="text-text" allowFontScaling={false} style={{ fontSize: 20, ...pixelFont() }}>
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
              title="⚔ FIND A VOLUME DUEL"
              variant="danger"
              onPress={() => startDuel('volume_duel')}
              busy={searching}
              testID="arena-create-duel"
            />
          </GlowCard>
          <View className="mt-s3">
            <GlowCard glow={colors.legendary}>
              <View className="mb-s3 flex-row items-center gap-s3">
                <IconBadge glyph="🪙" tint={colors.legendary} />
                <View className="flex-1">
                  <Text className="text-text" allowFontScaling={false} style={{ fontSize: 20, ...pixelFont() }}>
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
                title="⚔ FIND A COIN DUEL"
                onPress={() => startDuel('heads_or_tails')}
                busy={searching}
                testID="arena-create-hot"
              />
            </GlowCard>
          </View>
        </View>
      )}

      <View>
        <SectionLabel>BATTLE HISTORY</SectionLabel>
        {history.length === 0 ? (
          <Text className="text-2xs text-text-mute">
            {live.length > 0
              ? 'Nothing settled yet — finish what you started.'
              : 'No battles yet. Find a duel and call someone out.'}
          </Text>
        ) : (
          <>
            {/* The hub shows the LAST FIVE; the GAME LOG holds the record. */}
            {history.slice(0, 5).map((m) => (
              <HistoryRow key={m.id} match={m} xp={results.data?.[m.id]?.xp ?? null} />
            ))}
            <Pressable
              onPress={() => router.push('/game-log' as never)}
              accessibilityRole="button"
              accessibilityLabel="See full battle history"
              testID="arena-full-history"
              className="mt-s1 flex-row items-center justify-center rounded-lg border px-s3 py-s2"
              style={{ gap: 6, minHeight: 44, borderColor: `${colors.accent}40` }}
            >
              <Text
                allowFontScaling={false}
                style={{ fontSize: 9, color: colors.accent, letterSpacing: 1, ...pixelFont(false) }}
              >
                SEE FULL HISTORY ›
              </Text>
            </Pressable>
          </>
        )}
      </View>
        </>
      )}

      {/* Searching for a live duel opponent (System-A matchmaking). */}
      <Modal transparent visible={searching} animationType="fade" onRequestClose={() => void duel.cancel()}>
        <View style={{ flex: 1, backgroundColor: 'rgba(2,5,11,0.85)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View className="w-full items-center rounded-xl border p-s5" style={{ borderColor: `${colors.accent}59`, backgroundColor: colors.surface, gap: 10, maxWidth: 360 }}>
            <Text allowFontScaling={false} style={{ fontSize: 18, color: colors.accent, ...pixelFont() }}>SEARCHING…</Text>
            <Text className="text-center text-2xs text-text-mute">
              {duelLongWait
                ? 'No opponents online right now — keep waiting, or train against the AI.'
                : 'Finding you a live opponent. Stay here — you’ll drop into the arena the moment you’re matched.'}
            </Text>
            {duelLongWait ? (
              <View className="w-full">
                <NeonButton
                  title="⚔ BATTLE THE AI INSTEAD"
                  onPress={() => { void duel.cancel(); router.push('/battle?mode=training' as never); }}
                  testID="duel-fallback-ai"
                />
              </View>
            ) : null}
            <View className="mt-s2 w-full">
              <NeonButton title="CANCEL" variant="ghost" onPress={() => void duel.cancel()} testID="duel-cancel" />
            </View>
          </View>
        </View>
      </Modal>
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
  const colors = useThemeColors();
  const rounds = totalRoundsFor(match.format);
  const state =
    match.status === 'judging'
      ? { text: 'JUDGING · REVEAL WAITING', tint: colors.epic }
      : match.status === 'matched'
        ? { text: 'BOTH READY TO START', tint: colors.legendary }
        : { text: 'LIVE NOW', tint: colors.success };

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
              <Text className="text-text" allowFontScaling={false} style={{ fontSize: 18, ...pixelFont() }}>
                {formatLabel(match.format)}
              </Text>
              <Text
                className="mt-s1"
                allowFontScaling={false}
                style={{ fontSize: 9, color: state.tint, letterSpacing: 1, ...pixelFont(false) }}
              >
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
  const colors = useThemeColors();
  return (
    <View
      className="rounded-pill px-s2 py-[3px]"
      style={{ borderWidth: 1, borderColor: `${colors.accent}40`, backgroundColor: 'rgba(34,211,238,0.08)' }}
    >
      <Text
        className="text-accent"
        allowFontScaling={false}
        style={{ fontSize: 9, letterSpacing: 0.5, ...pixelFont(false) }}
      >
        {label}
      </Text>
    </View>
  );
}

/** A LIVE, tappable version of ComingCard — same look, but a real door (Quick
 *  Match). Glows a touch stronger and says PLAY NOW instead of COMING SOON. */
function LiveCard({ glyph, tint, title, note, onPress, testID }: { glyph: string; tint: string; title: string; note: string; onPress: () => void; testID: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
      className="flex-1 rounded-xl p-s4"
      style={{ borderWidth: 1, borderColor: `${tint}66`, backgroundColor: 'rgba(13,21,36,0.5)', shadowColor: tint, shadowOpacity: 0.28, shadowRadius: 16, elevation: 3 }}
    >
      <IconBadge glyph={glyph} tint={tint} size={44} />
      <Text className="mt-s3 text-text" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>{title}</Text>
      <Text className="mt-s1 text-2xs text-text-mute">{note}</Text>
      <Text className="mt-s2" allowFontScaling={false} style={{ fontSize: 9, color: tint, letterSpacing: 1, ...pixelFont(false) }}>▶ PLAY NOW</Text>
    </Pressable>
  );
}


/** A turn-based battle mode card for the Arena hub. `compact` is the
 *  3-across mini-tile: same tint/border/glow formula, glyph tile on top,
 *  no note (it survives in the accessibility label) and no chevron. */
function BattleModeCard({ glyph, tint, title, note, tag, onPress, testID, compact = false }: { glyph: string; tint: string; title: string; note: string; tag: string; onPress: () => void; testID: string; compact?: boolean }) {
  const colors = useThemeColors();
  if (compact) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${note}`}
        testID={testID}
        className="flex-1 items-center rounded-xl border px-s1 py-s3"
        style={{ borderColor: `${tint}59`, backgroundColor: 'rgba(13,21,36,0.6)', shadowColor: tint, shadowOpacity: 0.18, shadowRadius: 14 }}
      >
        <View style={{ width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: `${tint}66`, backgroundColor: `${tint}14`, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 18 }}>{glyph}</Text>
        </View>
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={{ marginTop: 6, fontSize: 12, color: colors.text, fontFamily: PIXEL_BOLD, letterSpacing: 0.5, textAlign: 'center' }}
        >
          {title}
        </Text>
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={{ marginTop: 3, fontSize: 8, color: tint, fontFamily: PIXEL, letterSpacing: 0.5, textAlign: 'center' }}
        >
          {tag}
        </Text>
      </Pressable>
    );
  }
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
          <Text allowFontScaling={false} style={{ fontSize: 15, color: colors.text, fontFamily: PIXEL_BOLD, letterSpacing: 0.5 }}>{title}</Text>
          <Text style={{ marginTop: 2, fontSize: 12, color: colors['text-mute'] }} numberOfLines={2}>{note}</Text>
        </View>
        <Text allowFontScaling={false} style={{ fontSize: 15, color: tint }}>›</Text>
      </View>
      <Text allowFontScaling={false} style={{ marginTop: 8, fontSize: 8, color: tint, fontFamily: PIXEL, letterSpacing: 1 }}>{tag}</Text>
    </Pressable>
  );
}
