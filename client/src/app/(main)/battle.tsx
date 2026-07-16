import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useAvatarData } from '@/data/use-avatar-data';
import { CHAMPIONS, championForBranch } from '@/domain/battle-rpg/champions';
import { championRequirement, unlockedChampionSet } from '@/domain/battle-rpg/unlock';
import { gymById } from '@/domain/battle-rpg/gyms';
import { rivalFor } from '@/domain/battle-rpg/rivals';
import type { AiPersonality, ChampionId } from '@/domain/battle-rpg/types';
import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { useBattleRpgStore } from '@/state/battle-rpg-store';
import { useGrantBattleReward } from '@/data/battle-rpg';
import { playCrit, playDefeat, playHeal, playHit, playVictory } from '@/ui/core/sound';
import { PIXEL, PIXEL_BOLD, pixelFont } from '@/theme/fonts';
import tokens from '@/theme/tokens';
import { stillAvatar, avatarArtV2 } from '@/ui/character/avatar-art';
import { Image } from 'expo-image';
import { BattleDebugPanel } from '@/ui/battle/debug-panel';
import { BattleResultModal } from '@/ui/battle/result-modal';
import { BattleArena } from '@/ui/battle/battle-arena';
import { CombatantHud } from '@/ui/battle/battle-bits';
import { MoveGrid } from '@/ui/battle/move-grid';
import { ChampionPicker, championSprite } from '@/ui/battle/champion-picker';
import { VsIntro } from '@/ui/battle/vs-intro';
import { ChallengeHub } from '@/ui/battle/challenge-hub';
import { recordChallengeResult, type ChallengeSnapshot } from '@/data/battle-rpg-challenge';
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
  const params = useLocalSearchParams<{ mode?: string; gym?: string }>();
  const mode = (['gym', 'rival', 'versus', 'challenge'].includes(params.mode ?? '') ? params.mode : 'training') as BattleSetup['mode'];
  const isChallenge = mode === 'challenge';
  const gymId = params.gym;
  const versus = mode === 'versus';

  const { ready, branchV2, stats, earliestBf, nutritionPhase } = useAvatarData();
  const forge = useForgeProgression();
  const forgeLevel = forgeProgressFromRow(forge.data ?? null).level;
  const storedChampion = useBattleRpgStore((s) => s.selectedChampion);
  const setSelectedChampion = useBattleRpgStore((s) => s.setSelectedChampion);

  const [picked, setPicked] = useState<ChampionId | null>(storedChampion);
  const [p2Picked, setP2Picked] = useState<ChampionId>('titan');
  const [joined, setJoined] = useState<ChallengeSnapshot | null>(null);
  const { session } = useAuth();
  const ownerName = (session?.user?.email ?? 'Challenger').split('@')[0];

  // Which champions the athlete has UNLOCKED (mirrors the CUSTOMISE roster
  // gates) — you can only battle with those.
  const scores = {
    strength: stats.strengthScore, size: stats.sizeScore, leanness: stats.leannessScore,
    conditioning: stats.conditioningScore, aesthetic: stats.aestheticScore,
  };
  const ctx = { nutritionPhase, earliestBf };
  const unlockedSet = useMemo(
    () => unlockedChampionSet(branchV2, scores, ctx),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [branchV2, stats.strengthScore, stats.sizeScore, stats.leannessScore, stats.conditioningScore, stats.aestheticScore, nutritionPhase, earliestBf]
  );
  const requirementFor = (id: ChampionId) => championRequirement(id, branchV2, scores, ctx);
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

  // A picked-but-now-locked champion falls back to your (always-unlocked)
  // derived class.
  const playerChampion: ChampionId = picked && unlockedSet.has(picked) ? picked : championForBranch(branchV2);

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
        <ScreenHeader kicker="ARENA" title="BATTLE" onBack={() => router.back()} />
        <View style={{ minHeight: 200, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: tokens.colors['text-mute'] }}>Loading your champion…</Text>
        </View>
      </ScreenShell>
    );
  }

  if (isChallenge) {
    const playerInput = { size: stats.sizeScore, aes: stats.aestheticScore, str: stats.strengthScore, cnd: stats.conditioningScore };
    if (!joined) {
      return (
        <ChallengeHub
          champion={playerChampion}
          input={playerInput}
          ownerName={ownerName}
          unlocked={unlockedSet}
          requirementFor={requirementFor}
          onPick={(id) => { setPicked(id); setSelectedChampion(id); }}
          onJoined={setJoined}
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
  const title = versus ? 'VERSUS' : mode === 'gym' ? (gymName ?? 'GYM').toUpperCase() : mode === 'rival' ? 'RIVAL BATTLE' : 'TRAINING BATTLE';
  const oppBranch = CHAMPIONS[setup.opponentChampion].spriteBranch;
  return (
    <ScreenShell>
      <ScreenHeader kicker="ARENA" title={title} onBack={() => router.back()} />

      {versus ? (
        <>
          {/* VS matchup banner. */}
          <View className="rounded-xl border p-s4 flex-row items-center justify-between" style={{ borderColor: `${tokens.colors.accent}45`, backgroundColor: 'rgba(10,16,30,0.55)' }}>
            <MatchupSide label="PLAYER 1" id={picked} tint={tokens.colors.accent} />
            <Text style={{ fontSize: 22, color: tokens.colors.legendary, ...pixelFont() }}>VS</Text>
            <MatchupSide label="PLAYER 2" id={p2Picked} tint={tokens.colors.danger} right />
          </View>
          <Text className="mt-s2 text-center text-2xs text-text-mute">Pass-and-play on one device — take turns choosing moves.</Text>

          <View className="mt-s4">
            <Text style={{ fontSize: 10, color: tokens.colors.accent, fontFamily: PIXEL, letterSpacing: 1.5 }}>PLAYER 1 — YOUR CHAMPION</Text>
            <View className="mt-s2">
              <ChampionPicker picked={picked} unlocked={unlocked} requirementFor={requirementFor} testPrefix="champion" onPick={onPick} />
            </View>
          </View>
          <View className="mt-s4">
            <Text style={{ fontSize: 10, color: tokens.colors.danger, fontFamily: PIXEL, letterSpacing: 1.5 }}>PLAYER 2 — FRIEND&apos;S CHAMPION</Text>
            <View className="mt-s2">
              <ChampionPicker picked={p2Picked} unlocked={null} testPrefix="p2" onPick={onP2Pick} />
            </View>
          </View>
        </>
      ) : (
        <>
          {/* Opponent preview. */}
          <View className="rounded-xl border p-s4" style={{ borderColor: `${tokens.colors.danger}45`, backgroundColor: 'rgba(20,10,16,0.5)' }}>
            <Text style={{ fontSize: 10, color: tokens.colors.danger, fontFamily: PIXEL, letterSpacing: 1 }}>OPPONENT</Text>
            <View className="mt-s2 flex-row items-center" style={{ gap: 12 }}>
              <Image source={stillAvatar(oppBranch, 4, 'male') ?? avatarArtV2(oppBranch, 4, 'male').source} style={{ width: 88, height: 88, ...({ imageRendering: 'pixelated' } as object) }} contentFit="contain" />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 16, color: tokens.colors.text, ...pixelFont() }}>{setup.opponentName.toUpperCase()}</Text>
                {leaderTitle ? <Text style={{ fontSize: 10, color: tokens.colors['text-mute'], fontFamily: PIXEL }}>{leaderTitle.toUpperCase()}</Text> : null}
                <Text style={{ marginTop: 2, fontSize: 12, color: tokens.colors.accent }}>{CHAMPIONS[setup.opponentChampion].name}</Text>
                <Text style={{ marginTop: 2, fontSize: 11, color: tokens.colors['text-mute'] }}>Combat Power ~{opponentPower}{recommendedRating ? ` · Rec. Evo ${recommendedRating}` : ''}</Text>
              </View>
            </View>
          </View>

          <View className="mt-s4">
            <Text style={{ fontSize: 10, color: tokens.colors.accent, fontFamily: PIXEL, letterSpacing: 1.5 }}>SELECT YOUR CHAMPION</Text>
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
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text allowFontScaling={false} style={{ fontSize: 8, color: tint, fontFamily: PIXEL, letterSpacing: 1 }}>{label}</Text>
      <Image source={championSprite(id)} style={{ width: 64, height: 64, marginVertical: 2, transform: [{ scaleX: right ? -1 : 1 }], ...({ imageRendering: 'pixelated' } as object) }} contentFit="contain" />
      <Text numberOfLines={1} allowFontScaling={false} style={{ fontSize: 8, color: tokens.colors.text, fontFamily: PIXEL_BOLD }}>{CHAMPIONS[id].name.toUpperCase()}</Text>
    </View>
  );
}

// ------------------------------------------------------------- runner

function BattleRunner({ setup }: { setup: BattleSetup }) {
  const [resultOpen, setResultOpen] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const [handedTurn, setHandedTurn] = useState(-1);
  const grantReward = useGrantBattleReward();
  const battle = useBattle(setup, (won, s) => {
    const { resultKey } = settleBattle(setup, won, s.turnNumber, setup.opponentChampion, setup.opponentName);
    // Real, server-authoritative reward (idempotent + daily-capped). Casual
    // versus duels bank nothing — bragging rights only.
    if (!setup.versus && setup.mode !== 'challenge') grantReward.mutate({ resultKey, mode: setup.mode, won });
    if (setup.mode === 'challenge' && setup.challengeCode) void recordChallengeResult(setup.challengeCode, won);
    if (won) playVictory(); else playDefeat();
    setResultOpen(true);
  });
  const { state, activeEvent, message } = battle;

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

  return (
    <View style={{ flex: 1, backgroundColor: tokens.colors['bg-deep'] }}>
      <ScreenShell>
        <BattleDebugPanel battle={battle} />
        <ScreenHeader kicker="ARENA BATTLE" title={`TURN ${state.turnNumber}`} onBack={() => router.back()} />

        {/* Opponent HUD. */}
        <CombatantHud combatant={state.opponent} powerLabel={Math.round(state.opponent.stats.maxHealth + state.opponent.stats.power * 3)} align="right" />

        {/* THE POKÉMON-POV ARENA. */}
        <View style={{ marginVertical: 8 }}>
          <BattleArena
            player={state.player}
            opponent={state.opponent}
            mode={setup.mode}
            activeEvent={activeEvent}
            floating={floating}
            winner={state.winner}
            height={236}
          />
        </View>

        {/* Battle message — typewriter reveal; tap to fast-forward. */}
        <Pressable
          onPress={() => battle.advance()}
          accessibilityRole="button"
          accessibilityLabel="advance battle text"
          style={{ minHeight: 40, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: `${tokens.colors.accent}44`, backgroundColor: 'rgba(10,16,30,0.8)', paddingHorizontal: 12, paddingVertical: 7, marginBottom: 8 }}
        >
          <TypewriterText key={message || versusPrompt || 'idle'} text={message || versusPrompt || (orderHint ? `Choose your move · ${orderHint}` : 'Choose your move…')} busy={battle.isBusy} />
        </Pressable>

        {/* Player HUD (the active chooser in versus). */}
        <CombatantHud combatant={gridChooser} />

        {/* Moves — served to whoever is choosing. */}
        <View style={{ marginTop: 10, position: 'relative' }}>
          {chooserLabel ? (
            <Text allowFontScaling={false} style={{ marginBottom: 6, fontSize: 9, color: battle.awaitingSide === 'opponent' ? tokens.colors.danger : tokens.colors.accent, fontFamily: PIXEL, letterSpacing: 1 }}>
              {chooserLabel} — SELECT MOVE
            </Text>
          ) : null}
          <MoveGrid moves={gridMoves} player={gridChooser} disabled={battle.isBusy || state.winner !== null || needsHandover} onSelect={battle.selectMove} />

          {/* Pass-the-device gate — keeps P1's pick hidden until P2 is ready. */}
          {needsHandover ? (
            <Pressable
              onPress={() => setHandedTurn(state.turnNumber)}
              accessibilityRole="button"
              accessibilityLabel="pass the device to player 2"
              testID="pass-device"
              style={{ position: 'absolute', inset: -4, borderRadius: 14, backgroundColor: 'rgba(2,6,14,0.94)', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Text style={{ fontSize: 15, color: tokens.colors.danger, ...pixelFont() }}>PASS TO PLAYER 2</Text>
              <Text allowFontScaling={false} style={{ fontSize: 10, color: tokens.colors['text-mute'], fontFamily: PIXEL }}>PLAYER 1 LOCKED IN · TAP WHEN READY</Text>
            </Pressable>
          ) : null}
        </View>
      </ScreenShell>

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
    <Text allowFontScaling={false} style={{ fontSize: 12.5, color: tokens.colors.text, lineHeight: 17 }}>
      {busy ? shown : text}
    </Text>
  );
}
