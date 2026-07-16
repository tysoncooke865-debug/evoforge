import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useAvatarData } from '@/data/use-avatar-data';
import { CHAMPIONS, CHAMPION_LIST, championForBranch } from '@/domain/battle-rpg/champions';
import { gymById } from '@/domain/battle-rpg/gyms';
import { rivalFor } from '@/domain/battle-rpg/rivals';
import type { AiPersonality, ChampionId } from '@/domain/battle-rpg/types';
import { forgeProgressFromRow, useForgeProgression } from '@/data/progression/use-forge';
import { useBattleRpgStore } from '@/state/battle-rpg-store';
import { PIXEL, PIXEL_BOLD, pixelFont } from '@/theme/fonts';
import tokens from '@/theme/tokens';
import { stillAvatar, avatarArtV2 } from '@/ui/character/avatar-art';
import { Image } from 'expo-image';
import { BattleDebugPanel } from '@/ui/battle/debug-panel';
import { BattleResultModal } from '@/ui/battle/result-modal';
import { BattleSprite } from '@/ui/battle/battle-sprite';
import { CombatantHud, FloatingNumber } from '@/ui/battle/battle-bits';
import { MoveGrid } from '@/ui/battle/move-grid';
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
  const mode = (params.mode === 'gym' || params.mode === 'rival' ? params.mode : 'training') as BattleSetup['mode'];
  const gymId = params.gym;

  const { ready, branchV2, stats } = useAvatarData();
  const forge = useForgeProgression();
  const forgeLevel = forgeProgressFromRow(forge.data ?? null).level;
  const storedChampion = useBattleRpgStore((s) => s.selectedChampion);
  const setSelectedChampion = useBattleRpgStore((s) => s.setSelectedChampion);

  const [picked, setPicked] = useState<ChampionId | null>(storedChampion);
  const [started, setStarted] = useState(false);

  const playerChampion: ChampionId = picked ?? championForBranch(branchV2);

  // Opponent + AI by mode.
  const gym = gymId ? gymById(gymId) : undefined;
  const rival = useMemo(() => rivalFor(forgeLevel), [forgeLevel]);
  const opponentChampion: ChampionId = mode === 'gym' ? gym?.championId ?? 'titan' : mode === 'rival' ? rival.championId : balancedOpponent(playerChampion);
  const opponentName = mode === 'gym' ? gym?.leaderName ?? 'Rival' : mode === 'rival' ? rival.name : 'Training Dummy';
  const ai: AiPersonality = mode === 'gym' ? gym?.ai ?? 'defensive' : mode === 'rival' ? rival.ai : 'balanced';
  const difficulty = mode === 'gym' ? 1.05 : mode === 'rival' ? 1.0 : 0.95;

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
    }),
    [mode, playerChampion, opponentChampion, opponentName, ai, gymId, difficulty, stats.sizeScore, stats.aestheticScore, stats.strengthScore, stats.conditioningScore]
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

  if (!started) {
    return (
      <PreviewScreen
        mode={mode}
        setup={setup}
        gymName={gym?.name}
        leaderTitle={gym?.leaderTitle}
        recommendedRating={gym?.recommendedRating}
        opponentPower={opponentPowerLabel(setup)}
        picked={playerChampion}
        onPick={(id) => { setPicked(id); setSelectedChampion(id); }}
        onStart={() => setStarted(true)}
      />
    );
  }

  return <BattleRunner setup={setup} />;
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
  gymName,
  leaderTitle,
  recommendedRating,
  opponentPower,
  picked,
  onPick,
  onStart,
}: {
  mode: BattleSetup['mode'];
  setup: BattleSetup;
  gymName?: string;
  leaderTitle?: string;
  recommendedRating?: number;
  opponentPower: number;
  picked: ChampionId;
  onPick: (id: ChampionId) => void;
  onStart: () => void;
}) {
  const title = mode === 'gym' ? (gymName ?? 'GYM').toUpperCase() : mode === 'rival' ? 'RIVAL BATTLE' : 'TRAINING BATTLE';
  const oppBranch = CHAMPIONS[setup.opponentChampion].spriteBranch;
  return (
    <ScreenShell>
      <ScreenHeader kicker="ARENA" title={title} onBack={() => router.back()} />

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

      {/* Champion picker. */}
      <View className="mt-s4">
        <Text style={{ fontSize: 10, color: tokens.colors.accent, fontFamily: PIXEL, letterSpacing: 1.5 }}>SELECT YOUR CHAMPION</Text>
        <View className="mt-s2 flex-row flex-wrap" style={{ gap: 8 }}>
          {CHAMPION_LIST.map((c) => {
            const selected = c.id === picked;
            return (
              <Pressable
                key={c.id}
                onPress={() => onPick(c.id)}
                accessibilityRole="button"
                accessibilityLabel={`${c.name}, ${c.role}${selected ? ', selected' : ''}`}
                testID={`champion-${c.id}`}
                className="rounded-xl border p-s2"
                style={{ width: '48%', borderColor: selected ? `${tokens.colors.accent}b3` : tokens.colors.border, backgroundColor: selected ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)' }}
              >
                <View className="flex-row items-center" style={{ gap: 8 }}>
                  <Image source={stillAvatar(c.spriteBranch, 4, 'male') ?? avatarArtV2(c.spriteBranch, 4, 'male').source} style={{ width: 46, height: 46, ...({ imageRendering: 'pixelated' } as object) }} contentFit="contain" />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} allowFontScaling={false} style={{ fontSize: 10, color: selected ? tokens.colors.accent : tokens.colors.text, fontFamily: PIXEL_BOLD }}>{c.name.toUpperCase()}</Text>
                    <Text numberOfLines={2} allowFontScaling={false} style={{ fontSize: 7.5, color: tokens.colors['text-mute'], fontFamily: PIXEL }}>{c.role.toUpperCase()}</Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View className="mt-s5">
        <NeonButton title="START BATTLE" onPress={onStart} pixel size="hero" testID="start-battle" />
      </View>
    </ScreenShell>
  );
}

// ------------------------------------------------------------- runner

function BattleRunner({ setup }: { setup: BattleSetup }) {
  const [resultOpen, setResultOpen] = useState(false);
  const battle = useBattle(setup, (won, s) => {
    settleBattle(setup, won, s.turnNumber, setup.opponentChampion, setup.opponentName);
    setResultOpen(true);
  });
  const { state, activeEvent, message } = battle;

  // Floating number: fire once per damage/heal event (effect-driven so render
  // stays pure — a monotonic trigger re-runs the float animation).
  const [floating, setFloating] = useState<{ side: 'player' | 'opponent'; kind: 'damage' | 'crit' | 'heal'; amount: number; trigger: number } | null>(null);
  const triggerRef = useRef(0);
  useEffect(() => {
    if (!activeEvent) return;
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

  return (
    <View style={{ flex: 1, backgroundColor: tokens.colors['bg-deep'] }}>
      <ScreenShell>
        <BattleDebugPanel battle={battle} />
        <ScreenHeader kicker="ARENA BATTLE" title={`TURN ${state.turnNumber}`} onBack={() => router.back()} />

        {/* Opponent HUD. */}
        <CombatantHud combatant={state.opponent} align="right" />

        {/* Arena. */}
        <View style={{ height: 210, marginVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: `${tokens.colors.accent}22`, backgroundColor: 'rgba(6,12,24,0.6)', overflow: 'hidden' }}>
          {/* holo floor */}
          <View style={{ position: 'absolute', bottom: 14, alignSelf: 'center', width: '78%', height: 40, borderRadius: 999, borderWidth: 1, borderColor: `${tokens.colors.accent}44`, backgroundColor: 'rgba(34,211,238,0.06)' }} />
          {/* opponent upper-right */}
          <View style={{ position: 'absolute', top: 6, right: 18 }}>
            <View>
              {floating && floating.side === 'opponent' ? <FloatingNumber amount={floating.amount} kind={floating.kind} trigger={floating.trigger} /> : null}
              <BattleSprite branch={state.opponent.spriteBranch} stage={state.opponent.spriteStage} side="opponent" activeEvent={activeEvent} size={110} defeated={state.winner === 'player'} />
            </View>
          </View>
          {/* player lower-left */}
          <View style={{ position: 'absolute', bottom: 6, left: 18 }}>
            <View>
              {floating && floating.side === 'player' ? <FloatingNumber amount={floating.amount} kind={floating.kind} trigger={floating.trigger} /> : null}
              <BattleSprite branch={state.player.spriteBranch} stage={state.player.spriteStage} side="player" activeEvent={activeEvent} size={120} defeated={state.winner === 'opponent'} victory={state.winner === 'player'} />
            </View>
          </View>
        </View>

        {/* Battle message. */}
        <View style={{ minHeight: 34, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: `${tokens.colors.accent}33`, backgroundColor: 'rgba(10,16,30,0.7)', paddingHorizontal: 12, paddingVertical: 6, marginBottom: 8 }}>
          <Text allowFontScaling={false} style={{ fontSize: 12, color: tokens.colors.text }}>{message || 'Choose your move…'}</Text>
        </View>

        {/* Player HUD. */}
        <CombatantHud combatant={state.player} />

        {/* Moves. */}
        <View style={{ marginTop: 10 }}>
          <MoveGrid moves={battle.playerMoves} player={state.player} disabled={battle.isBusy || state.winner !== null} onSelect={battle.selectMove} />
        </View>
      </ScreenShell>

      <BattleResultModal
        visible={resultOpen}
        state={state}
        rewards={rewards}
        opponentName={setup.opponentName}
        tip={tacticalTip(state, setup.gymId)}
        onRematch={() => { setResultOpen(false); battle.rematch(); }}
        onArena={() => router.replace('/arena')}
        onTrain={() => router.replace('/today')}
      />
    </View>
  );
}

