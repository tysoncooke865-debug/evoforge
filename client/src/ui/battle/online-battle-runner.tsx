import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CHAMPIONS } from '@/domain/battle-rpg/champions';
import { ITEM_MOVES } from '@/domain/battle-rpg/moves';
import { pvpFinish, type PvpMatch } from '@/data/matchmaking';
import { playCrit, playDefeat, playFaint, playHeal, playHit, playMoveFx, playVictory } from '@/ui/core/sound';
import { PIXEL, PIXEL_BOLD, pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { BattleArena } from '@/ui/battle/battle-arena';
import { MoveGrid } from '@/ui/battle/move-grid';
import { BattleResultModal } from '@/ui/battle/result-modal';
import { VsIntro } from '@/ui/battle/vs-intro';
import { useOnlineBattle } from '@/ui/battle/use-online-battle';

/**
 * The live PvP fight. Same arena/move UI as the single-player runner, but driven
 * by useOnlineBattle (canonical resolution + Realtime move exchange). Casual —
 * banks nothing farmable; only the head-to-head record moves, via pvp_finish.
 */
export function OnlineBattleRunner({
  match,
  mySeat,
  onLeave,
}: {
  match: PvpMatch;
  mySeat: 1 | 2;
  /** Tear the match down (clears matchmaking state so THIS runner unmounts —
   *  which closes the result modal) and navigate. 'pvp' re-queues for another
   *  live match; 'arena'/'today' exit. Owned by the /pvp screen. */
  onLeave: (dest: 'arena' | 'today' | 'pvp') => void;
}) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [resultOpen, setResultOpen] = useState(false);
  const [introDone, setIntroDone] = useState(false);
  const finishedRef = useRef(false);
  const leftRef = useRef(false);
  // Guard so a double-tap (or both a forfeit + a nav) only leaves once.
  const leave = (dest: 'arena' | 'today' | 'pvp') => {
    if (leftRef.current) return;
    leftRef.current = true;
    setResultOpen(false); // close immediately, in case unmount is deferred
    onLeave(dest);
  };

  const battle = useOnlineBattle(match, mySeat, (iWon) => {
    if (!finishedRef.current) {
      finishedRef.current = true;
      void pvpFinish(match.id, iWon); // idempotent; both clients may call
    }
    if (iWon) playVictory(); else playDefeat();
    setResultOpen(true);
  });
  const { state, activeEvent, message, waitingForOpponent, opponentLeft } = battle;

  const myChampion = mySeat === 1 ? match.champion1 : match.champion2;
  const oppChampion = mySeat === 1 ? match.champion2 : match.champion1;
  const opponentName = `${CHAMPIONS[oppChampion].name}`;

  // Floating damage/heal + SFX, exactly like the single-player runner.
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

  const prompt = state.winner
    ? ''
    : waitingForOpponent
      ? 'Waiting for your opponent…'
      : battle.isBusy
        ? message || '…'
        : message || 'Choose your move';

  return (
    <View style={{ flex: 1, backgroundColor: colors['bg-deep'], paddingTop: insets.top + 4, paddingHorizontal: 10, paddingBottom: 8 }}>
      {/* Top bar: back(forfeit) · turn · LIVE · forfeit. */}
      <View className="flex-row items-center" style={{ gap: 8, minHeight: 30 }}>
        <Pressable
          onPress={() => { battle.forfeit(); leave('arena'); }}
          accessibilityRole="button"
          accessibilityLabel="leave the match (forfeit)"
          hitSlop={10}
          style={{ width: 26, height: 26, borderRadius: 8, borderWidth: 1, borderColor: `${colors.accent}44`, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(10,16,30,0.6)' }}
        >
          <Text allowFontScaling={false} style={{ fontSize: 12, color: colors.accent, fontFamily: PIXEL_BOLD, marginTop: -1 }}>‹</Text>
        </Pressable>
        <Text allowFontScaling={false} style={{ fontSize: 11, color: colors.text, ...pixelFont() }}>TURN {state.turnNumber}</Text>
        <View className="rounded-md border" style={{ borderColor: `${colors.danger}66`, backgroundColor: 'rgba(239,68,68,0.10)', paddingHorizontal: 6, paddingVertical: 3 }}>
          <Text allowFontScaling={false} style={{ fontSize: 7.5, color: colors.danger, fontFamily: PIXEL, letterSpacing: 0.5 }}>● LIVE PvP</Text>
        </View>
        <View style={{ flex: 1 }} />
        {!state.winner ? (
          <Pressable
            onPress={() => { battle.forfeit(); leave('arena'); }}
            accessibilityRole="button"
            accessibilityLabel="forfeit the match"
            testID="pvp-forfeit"
            style={{ borderRadius: 8, borderWidth: 1, borderColor: `${colors.danger}55`, backgroundColor: 'rgba(10,16,30,0.6)', paddingHorizontal: 9, paddingVertical: 4 }}
          >
            <Text allowFontScaling={false} style={{ fontSize: 9, color: colors.danger, fontFamily: PIXEL_BOLD }}>FORFEIT</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ flex: 1, minHeight: 230, marginTop: 6 }}>
        <BattleArena
          player={state.player}
          opponent={state.opponent}
          mode="versus"
          activeEvent={activeEvent}
          floating={floating}
          winner={state.winner}
          opponentPower={Math.round(state.opponent.stats.maxHealth + state.opponent.stats.power * 3)}
        />
      </View>

      <View style={{ minHeight: 42, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: `${colors.accent}44`, backgroundColor: 'rgba(10,16,30,0.86)', paddingHorizontal: 12, paddingVertical: 7, marginTop: 8 }}>
        <Text allowFontScaling={false} style={{ fontSize: 10.5, color: colors.text, lineHeight: 16, fontFamily: PIXEL, letterSpacing: 0.3 }}>{prompt}</Text>
      </View>

      <View style={{ marginTop: 8, position: 'relative' }}>
        <MoveGrid
          moves={battle.playerMoves}
          player={state.player}
          items={ITEM_MOVES}
          disabled={battle.isBusy || state.winner !== null}
          onSelect={battle.selectMove}
        />
        {waitingForOpponent ? (
          <View pointerEvents="none" style={{ position: 'absolute', inset: -4, borderRadius: 14, backgroundColor: 'rgba(2,6,14,0.72)', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Text style={{ fontSize: 13, color: colors.accent, ...pixelFont() }}>MOVE LOCKED IN</Text>
            <Text allowFontScaling={false} style={{ fontSize: 10, color: colors['text-mute'], fontFamily: PIXEL }}>WAITING FOR YOUR OPPONENT…</Text>
          </View>
        ) : null}
      </View>

      {!introDone ? (
        <VsIntro
          playerId={myChampion}
          opponentId={oppChampion}
          playerName={CHAMPIONS[myChampion].name}
          opponentName={opponentName}
          onDone={() => setIntroDone(true)}
        />
      ) : null}

      <BattleResultModal
        visible={resultOpen}
        state={state}
        rewards={null}
        opponentName={opponentLeft ? `${opponentName} (bailed)` : opponentName}
        tip={opponentLeft ? 'Your opponent bailed — the win is yours. Queue up for another?' : 'A real rival — your head-to-head just moved. Run it back?'}
        onRematch={() => leave('pvp')}
        onArena={() => leave('arena')}
        onTrain={() => leave('today')}
      />
    </View>
  );
}
