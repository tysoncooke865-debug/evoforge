import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useOriginStatus } from '@/data/origin';
import { useAvatarData } from '@/data/use-avatar-data';
import { CHAMPIONS, championForBranch } from '@/domain/battle-rpg/champions';
import { originAsBranch } from '@/domain/customise';
import { championRequirement, unlockedChampionSet } from '@/domain/battle-rpg/unlock';
import { conditionById } from '@/domain/battle-rpg/conditions';
import { gymById } from '@/domain/battle-rpg/gyms';
import { ITEM_MOVES } from '@/domain/battle-rpg/moves';
import { rivalFor } from '@/domain/battle-rpg/rivals';
import { matchupHint, STYLE_META, styleOfChampion } from '@/domain/battle-rpg/style';
import type { AiPersonality, ChampionId } from '@/domain/battle-rpg/types';
import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { useBattleRpgStore } from '@/state/battle-rpg-store';
import { useGrantBattleReward } from '@/data/battle-rpg';
import { playCrit, playDefeat, playFaint, playHeal, playHit, playMoveFx, playVictory } from '@/ui/core/sound';
import { PIXEL, PIXEL_BOLD, pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { stillAvatar, avatarArtV2 } from '@/ui/character/avatar-art';
import { Image } from 'expo-image';
import { BattleDebugPanel } from '@/ui/battle/debug-panel';
import { BattleResultModal } from '@/ui/battle/result-modal';
import { BattleArena } from '@/ui/battle/battle-arena';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MoveGrid } from '@/ui/battle/move-grid';
import { ChampionPicker, championSprite } from '@/ui/battle/champion-picker';
import { VsIntro } from '@/ui/battle/vs-intro';
import { ChallengeHub } from '@/ui/battle/challenge-hub';
import { recordChallengeResult, type ChallengeSnapshot } from '@/data/battle-rpg-challenge';
import { fetchGhost, recordGhostResult, type GhostSnapshot } from '@/data/ghosts';
import { useAuth } from '@/data/auth-context';
import { NeonButton } from '@/ui/core/neon-button';
import { ScreenHeader } from '@/ui/core/screen-header';
import { ScreenShell } from '@/ui/core/shell';
import {
  opponentPowerLabel,
  settleBattle,
  tacticalTip,
  useBattle,
  type BattleSetup,
} from '@/ui/battle/use-battle';

/**
 * THE BATTLE SCREEN (Tyson beta) — champion select + opponent preview, then
 * the live turn-based fight, then the result. Reached from the Arena hub with
 * ?mode=training|rival|gym[&gym=iron_foundry]. Pushed over the tabs.
 */
export default function BattleScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ mode?: string; gym?: string; code?: string; ghost?: string }>();
  const mode = (['gym', 'rival', 'versus', 'challenge', 'ghost'].includes(params.mode ?? '') ? params.mode : 'training') as BattleSetup['mode'];
  const isChallenge = mode === 'challenge';
  const ghostId = mode === 'ghost' && typeof params.ghost === 'string' ? params.ghost : undefined;
  const gymId = params.gym;
  const versus = mode === 'versus';
  // The Arena's universal code box hands a verified challenge code over.
  const challengeCode = typeof params.code === 'string' && params.code.length === 6 ? params.code : undefined;

  const { ready, branchV2, stats, earliestBf, nutritionPhase } = useAvatarData();
  const forge = useForgeProgression();
  const forgeLevel = forgeProgressFromRow(forge.data ?? null).level;
  const storedChampion = useBattleRpgStore((s) => s.selectedChampion);
  const setSelectedChampion = useBattleRpgStore((s) => s.setSelectedChampion);

  const [picked, setPicked] = useState<ChampionId | null>(storedChampion);
  const [p2Picked, setP2Picked] = useState<ChampionId>('titan');
  const [joined, setJoined] = useState<ChallengeSnapshot | null>(null);
  // GHOST (migration 037): the loaded snapshot, fetched by id from the URL.
  const [ghost, setGhost] = useState<GhostSnapshot | null>(null);
  const [ghostMissing, setGhostMissing] = useState(false);
  // Param change resets the loaded ghost — render-time derived state, not an
  // effect (set-state-in-effect is a lint error in this repo).
  const [prevGhostId, setPrevGhostId] = useState(ghostId);
  if (prevGhostId !== ghostId) {
    setPrevGhostId(ghostId);
    setGhost(null);
    setGhostMissing(false);
  }
  useEffect(() => {
    if (!ghostId) return;
    let live = true;
    void fetchGhost(ghostId).then((g) => {
      if (!live) return;
      if (g) setGhost(g);
      else setGhostMissing(true);
    });
    return () => {
      live = false;
    };
  }, [ghostId]);
  const { session } = useAuth();
  const ownerName = (session?.user?.email ?? 'Challenger').split('@')[0];

  // Which champions the athlete has UNLOCKED (mirrors the CUSTOMISE roster
  // gates) — you can only battle with those.
  const scores = {
    strength: stats.strengthScore, size: stats.sizeScore, leanness: stats.leannessScore,
    conditioning: stats.conditioningScore, aesthetic: stats.aestheticScore,
  };
  const ctx = { nutritionPhase, earliestBf };
  // THE ORIGIN LOCK: with an Origin assigned, the only battle champion is
  // the origin champion (unlockedChampionSet locks with the roster).
  const originStatus = useOriginStatus();
  const originBranch = originAsBranch(originStatus.data?.origin_path);
  const unlockedSet = useMemo(
    () => unlockedChampionSet(branchV2, scores, ctx, originBranch),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [branchV2, stats.strengthScore, stats.sizeScore, stats.leannessScore, stats.conditioningScore, stats.aestheticScore, nutritionPhase, earliestBf, originBranch]
  );
  const requirementFor = (id: ChampionId) => championRequirement(id, branchV2, scores, ctx, originBranch);
  // A single /battle route is REUSED across modes (expo-router keeps it
  // mounted and only swaps params), so tying "started" to a boolean loaded
  // you back into the last fight when you opened a different mode. Instead:
  //  - `started` is derived from whether the STARTED params still match the
  //    current params → switching mode/gym auto-returns to the preview;
  //  - useFocusEffect resets on every fresh navigation → re-entering the
  //    SAME mode also starts at the preview;
  //  - `runNonce` keys the runner so each Start mounts a brand-new battle.
  const paramKey = `${mode}:${gymId ?? ''}`;
  const [startedKey, setStartedKey] = useState<string | null>(null);
  const [runNonce, setRunNonce] = useState(0);
  const started = startedKey === paramKey;
  useFocusEffect(useCallback(() => { setStartedKey(null); setJoined(null); }, []));

  // A picked-but-now-locked champion falls back to your origin champion
  // when one is assigned, else your (always-unlocked) derived class.
  const playerChampion: ChampionId =
    picked && unlockedSet.has(picked) ? picked : championForBranch(originBranch ?? branchV2);

  // Opponent + AI by mode.
  const gym = gymId ? gymById(gymId) : undefined;
  const rival = useMemo(() => rivalFor(forgeLevel), [forgeLevel]);
  const opponentChampion: ChampionId = versus
    ? p2Picked
    : mode === 'gym' ? gym?.championId ?? 'titan' : mode === 'rival' ? rival.championId : balancedOpponent(playerChampion);
  const opponentName = versus ? 'Player 2' : mode === 'gym' ? gym?.leaderName ?? 'Rival' : mode === 'rival' ? rival.name : 'Training Dummy';
  const ai: AiPersonality = mode === 'gym' ? gym?.ai ?? 'defensive' : mode === 'rival' ? rival.ai : 'balanced';
  const difficulty = versus ? 1.0 : mode === 'gym' ? 1.05 : mode === 'rival' ? 1.0 : 0.95;

  const setup: BattleSetup = useMemo(
    () => ({
      mode,
      playerChampion,
      opponentChampion,
      opponentName,
      ai,
      gymId,
      difficulty,
      player: { size: stats.sizeScore, aes: stats.aestheticScore, str: stats.strengthScore, cnd: stats.conditioningScore },
      playerSprite: { branch: CHAMPIONS[playerChampion].spriteBranch, stage: 4 },
      versus,
    }),
    [mode, playerChampion, opponentChampion, opponentName, ai, gymId, difficulty, versus, stats.sizeScore, stats.aestheticScore, stats.strengthScore, stats.conditioningScore]
  );

  if (!ready) {
    return (
      <ScreenShell>
        <ScreenHeader kicker="ARENA" title="BATTLE" onBack={() => router.replace('/arena' as never)} />
        <View style={{ minHeight: 200, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors['text-mute'] }}>Loading your champion…</Text>
        </View>
      </ScreenShell>
    );
  }

  if (isChallenge) {
    const playerInput = { size: stats.sizeScore, aes: stats.aestheticScore, str: stats.strengthScore, cnd: stats.conditioningScore };
    if (!joined) {
      return (
        <ChallengeHub
          // A second code must remount the hub — /battle stays mounted across
          // param swaps, so useState initialisers only run on a fresh key.
          key={challengeCode ?? 'hub'}
          champion={playerChampion}
          input={playerInput}
          ownerName={ownerName}
          unlocked={unlockedSet}
          requirementFor={requirementFor}
          onPick={(id) => { setPicked(id); setSelectedChampion(id); }}
          onJoined={setJoined}
          initialCode={challengeCode}
        />
      );
    }
    const challengeSetup: BattleSetup = {
      mode: 'challenge',
      playerChampion,
      opponentChampion: joined.champion,
      opponentName: joined.ownerName,
      ai: 'balanced',
      difficulty: 1,
      player: playerInput,
      opponentInput: joined.playerInput,
      challengeCode: joined.code,
      playerSprite: { branch: CHAMPIONS[playerChampion].spriteBranch, stage: 4 },
    };
    return <BattleRunner key={`challenge:${joined.code}`} setup={challengeSetup} />;
  }

  // GHOST BATTLE (migration 037): fight the AI driven by a friend's published
  // session snapshot. Loads by id; a missing/non-friend ghost says so.
  if (mode === 'ghost') {
    if (ghostMissing || !ghostId) {
      return (
        <ScreenShell>
          <ScreenHeader kicker="ARENA" title="GHOST BATTLE" onBack={() => router.replace('/arena' as never)} />
          <Text style={{ color: colors['text-mute'] }}>
            That ghost is gone — or its owner isn&apos;t your friend yet.
          </Text>
        </ScreenShell>
      );
    }
    if (!ghost) {
      return (
        <ScreenShell>
          <ScreenHeader kicker="ARENA" title="GHOST BATTLE" onBack={() => router.replace('/arena' as never)} />
          <View style={{ minHeight: 200, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors['text-mute'] }}>Summoning the ghost…</Text>
          </View>
        </ScreenShell>
      );
    }
    const ghostSetup: BattleSetup = {
      mode: 'ghost',
      playerChampion,
      opponentChampion: ghost.champion,
      opponentName: `${ghost.owner_name}'s Ghost`,
      ai: 'balanced',
      difficulty: 1,
      player: { size: stats.sizeScore, aes: stats.aestheticScore, str: stats.strengthScore, cnd: stats.conditioningScore },
      opponentInput: ghost.player_input,
      ghostId: ghost.id,
      playerSprite: { branch: CHAMPIONS[playerChampion].spriteBranch, stage: 4 },
    };
    return <BattleRunner key={`ghost:${ghost.id}`} setup={ghostSetup} />;
  }

  if (!started) {
    return (
      <PreviewScreen
        mode={mode}
        setup={setup}
        versus={versus}
        gymName={gym?.name}
        leaderTitle={gym?.leaderTitle}
        recommendedRating={gym?.recommendedRating}
        opponentPower={opponentPowerLabel(setup)}
        picked={playerChampion}
        p2Picked={p2Picked}
        unlocked={unlockedSet}
        requirementFor={requirementFor}
        onPick={(id) => { setPicked(id); setSelectedChampion(id); }}
        onP2Pick={setP2Picked}
        onStart={() => { setStartedKey(paramKey); setRunNonce((n) => n + 1); }}
      />
    );
  }

  // A fresh key per Start guarantees a brand-new BattleRunner (and useBattle
  // state) every time — never a stale battle carried across navigations.
  return <BattleRunner key={`${paramKey}:${runNonce}`} setup={setup} />;
}

function balancedOpponent(player: ChampionId): ChampionId {
  const order: ChampionId[] = ['aesthetic', 'titan', 'apex', 'shredded'];
  const idx = (order.indexOf(player) + 2) % order.length; // the "opposite" archetype
  return order[idx];
}

// ------------------------------------------------------------- preview

function PreviewScreen({
  mode,
  setup,
  versus,
  gymName,
  leaderTitle,
  recommendedRating,
  opponentPower,
  picked,
  p2Picked,
  unlocked,
  requirementFor,
  onPick,
  onP2Pick,
  onStart,
}: {
  mode: BattleSetup['mode'];
  setup: BattleSetup;
  versus: boolean;
  gymName?: string;
  leaderTitle?: string;
  recommendedRating?: number;
  opponentPower: number;
  picked: ChampionId;
  p2Picked: ChampionId;
  unlocked: Set<ChampionId>;
  requirementFor: (id: ChampionId) => string;
  onPick: (id: ChampionId) => void;
  onP2Pick: (id: ChampionId) => void;
  onStart: () => void;
}) {
  const colors = useThemeColors();
  const title = versus ? 'VERSUS' : mode === 'gym' ? (gymName ?? 'GYM').toUpperCase() : mode === 'rival' ? 'RIVAL BATTLE' : 'TRAINING BATTLE';
  const oppBranch = CHAMPIONS[setup.opponentChampion].spriteBranch;
  return (
    <ScreenShell>
      <ScreenHeader kicker="ARENA" title={title} onBack={() => router.replace('/arena' as never)} />

      {versus ? (
        <>
          {/* VS matchup banner. */}
          <View className="rounded-xl border p-s4 flex-row items-center justify-between" style={{ borderColor: `${colors.accent}45`, backgroundColor: 'rgba(10,16,30,0.55)' }}>
            <MatchupSide label="PLAYER 1" id={picked} tint={colors.accent} />
            <Text style={{ fontSize: 22, color: colors.legendary, ...pixelFont() }}>VS</Text>
            <MatchupSide label="PLAYER 2" id={p2Picked} tint={colors.danger} right />
          </View>
          <Text className="mt-s2 text-center text-2xs text-text-mute">Pass-and-play on one device — take turns choosing moves.</Text>

          <View className="mt-s4">
            <Text style={{ fontSize: 10, color: colors.accent, fontFamily: PIXEL, letterSpacing: 1.5 }}>PLAYER 1 — YOUR CHAMPION</Text>
            <View className="mt-s2">
              <ChampionPicker picked={picked} unlocked={unlocked} requirementFor={requirementFor} testPrefix="champion" onPick={onPick} />
            </View>
          </View>
          <View className="mt-s4">
            <Text style={{ fontSize: 10, color: colors.danger, fontFamily: PIXEL, letterSpacing: 1.5 }}>PLAYER 2 — FRIEND&apos;S CHAMPION</Text>
            <View className="mt-s2">
              <ChampionPicker picked={p2Picked} unlocked={null} testPrefix="p2" onPick={onP2Pick} />
            </View>
          </View>
        </>
      ) : (
        <>
          {/* Opponent preview. */}
          <View className="rounded-xl border p-s4" style={{ borderColor: `${colors.danger}45`, backgroundColor: 'rgba(20,10,16,0.5)' }}>
            <Text style={{ fontSize: 10, color: colors.danger, fontFamily: PIXEL, letterSpacing: 1 }}>OPPONENT</Text>
            <View className="mt-s2 flex-row items-center" style={{ gap: 12 }}>
              <Image source={stillAvatar(oppBranch, 4, 'male') ?? avatarArtV2(oppBranch, 4, 'male').source} style={{ width: 88, height: 88, ...({ imageRendering: 'pixelated' } as object) }} contentFit="contain" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, color: colors.text, ...pixelFont() }}>{setup.opponentName.toUpperCase()}</Text>
                {leaderTitle ? <Text style={{ fontSize: 10, color: colors['text-mute'], fontFamily: PIXEL }}>{leaderTitle.toUpperCase()}</Text> : null}
                <Text style={{ marginTop: 2, fontSize: 12, color: colors.accent }}>{CHAMPIONS[setup.opponentChampion].name}</Text>
                <Text style={{ marginTop: 2, fontSize: 11, color: colors['text-mute'] }}>Combat Power ~{opponentPower}{recommendedRating ? ` · Rec. Evo ${recommendedRating}` : ''}</Text>
                <Text style={{ marginTop: 2, fontSize: 10, color: STYLE_META[styleOfChampion(setup.opponentChampion)].color, fontFamily: PIXEL }}>
                  {STYLE_META[styleOfChampion(setup.opponentChampion)].icon} {STYLE_META[styleOfChampion(setup.opponentChampion)].label} STYLE
                </Text>
              </View>
            </View>
          </View>

          {/* The style triangle (Phase C) — counter-picking is a decision. */}
          <View className="mt-s2 rounded-lg border p-s3" style={{ borderColor: `${colors.accent}33`, backgroundColor: 'rgba(10,16,30,0.5)' }}>
            <Text allowFontScaling={false} style={{ fontSize: 9, color: colors['text-mute'], fontFamily: PIXEL, letterSpacing: 1 }}>
              <Text style={{ color: STYLE_META.force.color }}>▲ FORCE</Text> beats <Text style={{ color: STYLE_META.form.color }}>◆ FORM</Text> beats{' '}
              <Text style={{ color: STYLE_META.flow.color }}>● FLOW</Text> beats <Text style={{ color: STYLE_META.force.color }}>▲ FORCE</Text>
            </Text>
            <Text style={{ marginTop: 4, fontSize: 11, color: colors.text, lineHeight: 15 }}>{matchupHint(picked, setup.opponentChampion)}</Text>
            {mode === 'gym' && setup.gymId && conditionById(setup.gymId) ? (
              <Text style={{ marginTop: 4, fontSize: 10, color: colors.legendary, fontFamily: PIXEL }}>
                ⚠ {conditionById(setup.gymId)!.label} — {conditionById(setup.gymId)!.blurb}
              </Text>
            ) : null}
          </View>

          <View className="mt-s4">
            <Text style={{ fontSize: 10, color: colors.accent, fontFamily: PIXEL, letterSpacing: 1.5 }}>SELECT YOUR CHAMPION</Text>
            <View className="mt-s2">
              <ChampionPicker picked={picked} unlocked={unlocked} requirementFor={requirementFor} testPrefix="champion" onPick={onPick} />
            </View>
          </View>
        </>
      )}

      <View className="mt-s5">
        <NeonButton title={versus ? 'START VERSUS' : 'START BATTLE'} onPress={onStart} pixel size="hero" testID="start-battle" />
      </View>
    </ScreenShell>
  );
}

function MatchupSide({ label, id, tint, right = false }: { label: string; id: ChampionId; tint: string; right?: boolean }) {
  const colors = useThemeColors();
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text allowFontScaling={false} style={{ fontSize: 8, color: tint, fontFamily: PIXEL, letterSpacing: 1 }}>{label}</Text>
      <Image source={championSprite(id)} style={{ width: 64, height: 64, marginVertical: 2, transform: [{ scaleX: right ? -1 : 1 }], ...({ imageRendering: 'pixelated' } as object) }} contentFit="contain" />
      <Text numberOfLines={1} allowFontScaling={false} style={{ fontSize: 8, color: colors.text, fontFamily: PIXEL_BOLD }}>{CHAMPIONS[id].name.toUpperCase()}</Text>
    </View>
  );
}

// ------------------------------------------------------------- runner

function BattleRunner({ setup }: { setup: BattleSetup }) {
  const colors = useThemeColors();
  const [resultOpen, setResultOpen] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [handedTurn, setHandedTurn] = useState(-1);
  const grantReward = useGrantBattleReward();
  const battle = useBattle(setup, (won, s) => {
    const { resultKey } = settleBattle(setup, won, s.turnNumber, setup.opponentChampion, setup.opponentName);
    // Real, server-authoritative reward (idempotent + daily-capped). Casual
    // versus duels bank nothing — bragging rights only.
    // Ghost battles bank the 'training' reward tier — the server RPC (033)
    // only vouches for training/rival/gym, and a friendly vs a snapshot IS
    // training-grade. The rivalry update rides record_ghost_result (037).
    if (!setup.versus && setup.mode !== 'challenge')
      grantReward.mutate({ resultKey, mode: setup.mode === 'ghost' ? 'training' : setup.mode, won });
    if (setup.mode === 'challenge' && setup.challengeCode) void recordChallengeResult(setup.challengeCode, won);
    if (setup.mode === 'ghost' && setup.ghostId) void recordGhostResult(setup.ghostId, won);
    if (won) playVictory(); else playDefeat();
    setResultOpen(true);
  });
  const { state, activeEvent, message } = battle;
  const condition = conditionById(state.conditionId);
  const battleSpeed = useBattleRpgStore((s) => s.battleSpeed);
  const setBattleSpeed = useBattleRpgStore((s) => s.setBattleSpeed);
  const insets = useSafeAreaInsets();

  // VERSUS: the "pass the device" gate — derived from the turn it was
  // acknowledged for, so it auto-resets each new turn (no setState-in-effect).
  const needsHandover = !!(setup.versus && battle.awaitingSide === 'opponent' && handedTurn !== state.turnNumber && !battle.isBusy && !state.winner);

  // Floating number: fire once per damage/heal event (effect-driven so render
  // stays pure — a monotonic trigger re-runs the float animation) + SFX.
  const [floating, setFloating] = useState<{ side: 'player' | 'opponent'; kind: 'damage' | 'crit' | 'heal'; amount: number; trigger: number } | null>(null);
  const triggerRef = useRef(0);
  useEffect(() => {
    if (!activeEvent) return;
    if (activeEvent.kind === 'crit') playCrit();
    else if (activeEvent.kind === 'damage') playHit();
    else if (activeEvent.kind === 'heal') playHeal();
    else if (activeEvent.kind === 'defeated') playFaint();
    else if (activeEvent.kind === 'move' && activeEvent.moveId) playMoveFx(activeEvent.moveId);
    if ((activeEvent.kind === 'damage' || activeEvent.kind === 'crit' || activeEvent.kind === 'heal') && activeEvent.amount) {
      triggerRef.current += 1;
      setFloating({
        side: activeEvent.side,
        kind: activeEvent.kind === 'crit' ? 'crit' : activeEvent.kind === 'heal' ? 'heal' : 'damage',
        amount: activeEvent.amount,
        trigger: triggerRef.current,
      });
    }
  }, [activeEvent]);

  const rewards = state.winner ? useBattleRpgStore.getState().history[0]?.rewards ?? null : null;
  const orderHint =
    !battle.isBusy && !state.winner && !setup.versus
      ? state.player.stats.speed >= state.opponent.stats.speed
        ? 'You strike first'
        : `${setup.opponentName} is faster`
      : null;

  // VERSUS: the move grid serves whichever player is choosing now.
  const chooserLabel = setup.versus ? (battle.awaitingSide === 'opponent' ? 'PLAYER 2' : 'PLAYER 1') : null;
  const gridMoves = setup.versus ? battle.activeMoves : battle.playerMoves;
  const gridChooser = setup.versus ? battle.activeChooser : state.player;
  const versusPrompt = setup.versus && !battle.isBusy && !state.winner ? `${chooserLabel} — choose your move` : null;

  // ONE SCREEN, NO SCROLL (Tyson): a fixed column — slim top bar, the arena
  // takes every spare pixel (HUD plates live inside it), message strip, move
  // panel. The tab bar takes its own layout space, so no bottom fudge.
  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-deep'], paddingTop: insets.top + 4, paddingHorizontal: 10, paddingBottom: 8 }}>
      <BattleDebugPanel battle={battle} />

      {/* Slim top bar: back · turn · condition · speed · run. */}
      <View className="flex-row items-center" style={{ gap: 8, minHeight: 30 }}>
        <Pressable
          onPress={() => router.replace('/arena' as never)}
          accessibilityRole="button"
          accessibilityLabel="back"
          hitSlop={10}
          style={{ width: 26, height: 26, borderRadius: 8, borderWidth: 1, borderColor: `${colors.accent}44`, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,16,30,0.6)' }}
        >
          <Text allowFontScaling={false} style={{ fontSize: 12, color: colors.accent, fontFamily: PIXEL_BOLD, marginTop: -1 }}>‹</Text>
        </Pressable>
        <Text allowFontScaling={false} style={{ fontSize: 11, color: colors.text, ...pixelFont() }}>
          TURN {state.turnNumber}
        </Text>
        {condition ? (
          <View className="rounded-md border" style={{ borderColor: `${colors.legendary}55`, backgroundColor: 'rgba(251,191,36,0.08)', paddingHorizontal: 6, paddingVertical: 3, flexShrink: 1 }}>
            <Text numberOfLines={1} allowFontScaling={false} style={{ fontSize: 7.5, color: colors.legendary, fontFamily: PIXEL, letterSpacing: 0.5 }}>
              ⚠ {condition.label}
            </Text>
          </View>
        ) : null}
        <View style={{ flex: 1 }} />
        <Pressable
          onPress={() => setBattleSpeed(battleSpeed === 1 ? 2 : 1)}
          accessibilityRole="button"
          accessibilityLabel={`battle speed ${battleSpeed} times, tap to toggle`}
          testID="battle-speed"
          style={{ borderRadius: 8, borderWidth: 1, borderColor: `${colors.accent}55`, backgroundColor: battleSpeed === 2 ? 'rgba(34,211,238,0.14)' : 'rgba(10,16,30,0.6)', paddingHorizontal: 9, paddingVertical: 4 }}
        >
          <Text allowFontScaling={false} style={{ fontSize: 9, color: colors.accent, fontFamily: PIXEL_BOLD }}>{battleSpeed === 2 ? '▶▶ 2×' : '▶ 1×'}</Text>
        </Pressable>
        {setup.mode === 'training' && !state.winner ? (
          <Pressable
            onPress={() => router.replace('/arena' as never)}
            accessibilityRole="button"
            accessibilityLabel="run from this training battle"
            testID="battle-run"
            style={{ borderRadius: 8, borderWidth: 1, borderColor: `${colors.danger}55`, backgroundColor: 'rgba(10,16,30,0.6)', paddingHorizontal: 9, paddingVertical: 4 }}
          >
            <Text allowFontScaling={false} style={{ fontSize: 9, color: colors.danger, fontFamily: PIXEL_BOLD }}>RUN</Text>
          </Pressable>
        ) : null}
      </View>

      {/* THE ARENA — every spare pixel; HUD plates overlaid inside. */}
      <View style={{ flex: 1, minHeight: 230, marginTop: 6 }}>
        <BattleArena
          player={state.player}
          opponent={state.opponent}
          mode={setup.mode}
          activeEvent={activeEvent}
          floating={floating}
          winner={state.winner}
          opponentPower={Math.round(state.opponent.stats.maxHealth + state.opponent.stats.power * 3)}
        />
      </View>

      {/* Battle message — typewriter reveal; tap to fast-forward. */}
      <Pressable
        onPress={() => battle.advance()}
        accessibilityRole="button"
        accessibilityLabel="advance battle text"
        style={{ minHeight: 42, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: `${colors.accent}44`, backgroundColor: 'rgba(10,16,30,0.86)', paddingHorizontal: 12, paddingVertical: 7, marginTop: 8 }}
      >
        <TypewriterText key={message || versusPrompt || 'idle'} text={message || versusPrompt || (orderHint ? `Choose your move · ${orderHint}` : 'Choose your move…')} busy={battle.isBusy} />
      </Pressable>

      {/* Moves — served to whoever is choosing. */}
      <View style={{ marginTop: 8, position: 'relative' }}>
        {chooserLabel ? (
          <Text allowFontScaling={false} style={{ marginBottom: 4, fontSize: 9, color: battle.awaitingSide === 'opponent' ? colors.danger : colors.accent, fontFamily: PIXEL, letterSpacing: 1 }}>
            {chooserLabel} — SELECT MOVE
          </Text>
        ) : null}
        <MoveGrid moves={gridMoves} player={gridChooser} items={ITEM_MOVES} disabled={battle.isBusy || state.winner !== null || needsHandover} onSelect={battle.selectMove} />

        {/* Pass-the-device gate — keeps P1's pick hidden until P2 is ready. */}
        {needsHandover ? (
          <Pressable
            onPress={() => setHandedTurn(state.turnNumber)}
            accessibilityRole="button"
            accessibilityLabel="pass the device to player 2"
            testID="pass-device"
            style={{ position: 'absolute', inset: -4, borderRadius: 14, backgroundColor: 'rgba(2,6,14,0.94)', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <Text style={{ fontSize: 15, color: colors.danger, ...pixelFont() }}>PASS TO PLAYER 2</Text>
            <Text allowFontScaling={false} style={{ fontSize: 10, color: colors['text-mute'], fontFamily: PIXEL }}>PLAYER 1 LOCKED IN · TAP WHEN READY</Text>
          </Pressable>
        ) : null}
      </View>

      {!introDone ? (
        <VsIntro
          playerId={setup.playerChampion}
          opponentId={setup.opponentChampion}
          playerName={setup.versus ? 'Player 1' : CHAMPIONS[setup.playerChampion].name}
          opponentName={setup.opponentName}
          onDone={() => setIntroDone(true)}
        />
      ) : null}

      <BattleResultModal
        visible={resultOpen}
        state={state}
        rewards={rewards}
        opponentName={setup.opponentName}
        versus={setup.versus ?? false}
        tip={tacticalTip(state, setup.gymId)}
        onRematch={() => { setResultOpen(false); setIntroDone(true); battle.rematch(); }}
        onArena={() => router.replace('/arena')}
        onTrain={() => router.replace('/today')}
      />
    </View>
  );
}

/** Reveals the message character-by-character; snaps to full instantly when
 *  the turn is idle (so move hints read immediately) or the text is short. */
function TypewriterText({ text, busy }: { text: string; busy: boolean }) {
  const colors = useThemeColors();
  // Keyed by `text` in the parent, so `shown` starts empty for each new
  // message — the interval (async setState) is the only writer.
  const [shown, setShown] = useState('');
  useEffect(() => {
    if (!busy) return;
    let i = 0;
    const id = setInterval(() => {
      i += 2;
      setShown(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, 18);
    return () => clearInterval(id);
  }, [text, busy]);
  return (
    <Text allowFontScaling={false} style={{ fontSize: 10.5, color: colors.text, lineHeight: 16, fontFamily: PIXEL, letterSpacing: 0.3 }}>
      {busy ? shown : text}
    </Text>
  );
}
