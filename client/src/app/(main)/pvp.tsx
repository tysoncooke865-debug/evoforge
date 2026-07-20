import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { useAvatarData } from '@/data/use-avatar-data';
import { useOriginStatus } from '@/data/origin';
import { useMatchmaking, usePvpMatch } from '@/data/matchmaking';
import { CHAMPIONS, championForBranch } from '@/domain/battle-rpg/champions';
import { originAsBranch } from '@/domain/customise';
import { championRequirement, unlockedChampionSet } from '@/domain/battle-rpg/unlock';
import type { ChampionId } from '@/domain/battle-rpg/types';
import { useBattleRpgStore } from '@/state/battle-rpg-store';
import { pixelFont, PIXEL } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { ChampionPicker } from '@/ui/battle/champion-picker';
import { OnlineBattleRunner } from '@/ui/battle/online-battle-runner';
import { NeonButton } from '@/ui/core/neon-button';
import { OnlineBadge } from '@/ui/core/online-badge';
import { ScreenHeader } from '@/ui/core/screen-header';
import { ScreenShell } from '@/ui/core/shell';

/**
 * QUICK MATCH — real-time PvP matchmaking (migration 074). Pick your champion,
 * queue, get paired with a live opponent, fight move-by-move. Replaces the old
 * join-by-code: no code to share, you just find a real rival online.
 */
export default function PvpScreen() {
  const colors = useThemeColors();
  const { ready, branchV2, stats, earliestBf, nutritionPhase } = useAvatarData();
  const originStatus = useOriginStatus();
  const originBranch = originAsBranch(originStatus.data?.origin_path);
  const storedChampion = useBattleRpgStore((s) => s.selectedChampion);
  const setSelectedChampion = useBattleRpgStore((s) => s.setSelectedChampion);

  const scores = {
    strength: stats.strengthScore, size: stats.sizeScore, leanness: stats.leannessScore,
    conditioning: stats.conditioningScore, aesthetic: stats.aestheticScore,
  };
  const ctx = { nutritionPhase, earliestBf };
  const unlockedSet = useMemo(
    () => unlockedChampionSet(branchV2, scores, ctx, originBranch),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [branchV2, stats.strengthScore, stats.sizeScore, stats.leannessScore, stats.conditioningScore, stats.aestheticScore, nutritionPhase, earliestBf, originBranch]
  );
  const requirementFor = (id: ChampionId) => championRequirement(id, branchV2, scores, ctx, originBranch);

  const [picked, setPicked] = useState<ChampionId | null>(storedChampion);
  const champion: ChampionId = picked && unlockedSet.has(picked) ? picked : championForBranch(originBranch ?? branchV2);
  const input = { size: stats.sizeScore, aes: stats.aestheticScore, str: stats.strengthScore, cnd: stats.conditioningScore };

  const mm = useMatchmaking();
  const matchId = mm.state.status === 'matched' ? mm.state.matchId : null;
  const match = usePvpMatch(matchId);

  // Matched → play. Render the live runner once the match row loads.
  if (mm.state.status === 'matched') {
    if (!match.data) {
      return (
        <ScreenShell>
          <ScreenHeader kicker="ARENA" title="QUICK MATCH" onBack={() => router.replace('/arena' as never)} />
          <View style={{ minHeight: 200, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: colors['text-mute'] }}>Opponent found — entering the arena…</Text>
          </View>
        </ScreenShell>
      );
    }
    return (
      <OnlineBattleRunner
        match={match.data}
        mySeat={mm.state.seat}
        onLeave={(dest) => {
          mm.reset(); // clears 'matched' so this screen stops rendering the runner (and its modal)
          router.replace(dest === 'today' ? ('/today' as never) : ('/arena' as never));
        }}
      />
    );
  }

  if (mm.state.status === 'searching') {
    return (
      <ScreenShell>
        <ScreenHeader kicker="ARENA" title="QUICK MATCH" onBack={() => { void mm.cancel(); router.replace('/arena' as never); }} />
        <View className="rounded-xl border p-s5 items-center" style={{ borderColor: `${colors.accent}45`, backgroundColor: 'rgba(10,16,30,0.55)', gap: 10, marginTop: 24 }}>
          <Text style={{ fontSize: 18, color: colors.accent, ...pixelFont() }}>SEARCHING…</Text>
          <Text className="text-center text-2xs text-text-mute">Finding you a live opponent. Stay on this screen — you’ll drop straight into the fight.</Text>
        </View>
        <View className="mt-s4">
          <NeonButton title="CANCEL" variant="ghost" onPress={() => void mm.cancel()} testID="pvp-cancel" />
        </View>
      </ScreenShell>
    );
  }

  // Idle — pick a champion and queue.
  return (
    <ScreenShell>
      <ScreenHeader kicker="ARENA" title="QUICK MATCH" onBack={() => router.replace('/arena' as never)} />
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <Text className="flex-1 text-2xs text-text-mute">
          Get matched with a real athlete and fight live, turn by turn. No codes — just tap FIND MATCH.
        </Text>
        <OnlineBadge testID="pvp-online" />
      </View>

      <View className="mt-s4">
        <Text style={{ fontSize: 10, color: colors.accent, fontFamily: PIXEL, letterSpacing: 1.5 }}>YOUR CHAMPION</Text>
        <View className="mt-s2">
          <ChampionPicker
            picked={champion}
            unlocked={unlockedSet}
            requirementFor={requirementFor}
            testPrefix="pvp-champion"
            onPick={(id) => { setPicked(id); setSelectedChampion(id); }}
          />
        </View>
      </View>

      <View className="mt-s5">
        <NeonButton
          title="⚔ FIND MATCH"
          onPress={() => void mm.start(champion, input)}
          pixel
          size="hero"
          disabled={!ready}
          testID="pvp-find"
        />
      </View>
      <Text className="mt-s2 text-center text-2xs text-text-mute">
        Fighting as {CHAMPIONS[champion].name}. Casual — for bragging rights and your head-to-head record.
      </Text>
    </ScreenShell>
  );
}
