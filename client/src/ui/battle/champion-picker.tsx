import { Image } from 'expo-image';
import { Pressable, Text, View } from 'react-native';

import { CHAMPIONS, CHAMPION_LIST } from '@/domain/battle-rpg/champions';
import type { ChampionId } from '@/domain/battle-rpg/types';
import { PIXEL, PIXEL_BOLD } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { avatarArtV2, stillAvatar } from '@/ui/character/avatar-art';
import { playSelect } from '@/ui/core/sound';

/**
 * The battle champion picker — a 2×2 grid of cards with LOCK state (champions
 * you haven't unlocked are dimmed + show their gate) and quick stat bars so
 * the archetype reads at a glance.
 */
export function ChampionPicker({
  picked,
  unlocked,
  requirementFor,
  allowLocked = false,
  testPrefix = 'champion',
  onPick,
}: {
  picked: ChampionId;
  /** null = everything unlocked (e.g. the guest P2 in versus). */
  unlocked: Set<ChampionId> | null;
  requirementFor?: (id: ChampionId) => string;
  /** Let locked champions be picked anyway (guest player). */
  allowLocked?: boolean;
  testPrefix?: string;
  onPick: (id: ChampionId) => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
      {CHAMPION_LIST.map((c) => {
        const isUnlocked = unlocked === null || unlocked.has(c.id);
        const selectable = isUnlocked || allowLocked;
        const selected = c.id === picked;
        const req = !isUnlocked ? requirementFor?.(c.id) ?? 'LOCKED' : '';
        return (
          <Pressable
            key={c.id}
            onPress={() => {
              if (!selectable) return;
              playSelect();
              onPick(c.id);
            }}
            disabled={!selectable}
            accessibilityRole="button"
            accessibilityLabel={`${c.name}, ${c.role}${isUnlocked ? '' : `, locked, ${req.toLowerCase()}`}${selected ? ', selected' : ''}`}
            testID={`${testPrefix}-${c.id}`}
            className="rounded-xl border p-s2"
            style={{
              width: '48%',
              opacity: selectable ? 1 : 0.55,
              borderColor: selected ? `${colors.accent}b3` : isUnlocked ? colors.border : 'rgba(120,170,220,0.12)',
              backgroundColor: selected ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)',
            }}
          >
            <View className="flex-row items-center" style={{ gap: 8 }}>
              <View style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }}>
                <Image
                  source={stillAvatar(c.spriteBranch, 4, 'male') ?? avatarArtV2(c.spriteBranch, 4, 'male').source}
                  style={{ width: 46, height: 46, opacity: isUnlocked ? 1 : 0.4, ...({ imageRendering: 'pixelated' } as object) }}
                  contentFit="contain"
                />
                {!isUnlocked ? <Text style={{ position: 'absolute', fontSize: 16 }}>🔒</Text> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} allowFontScaling={false} style={{ fontSize: 10, color: selected ? colors.accent : colors.text, fontFamily: PIXEL_BOLD }}>
                  {c.name.toUpperCase()}
                </Text>
                {isUnlocked ? (
                  <Text numberOfLines={1} allowFontScaling={false} style={{ fontSize: 7, color: colors['text-mute'], fontFamily: PIXEL }}>
                    {c.role.toUpperCase()}
                  </Text>
                ) : (
                  <Text numberOfLines={1} allowFontScaling={false} style={{ fontSize: 7, color: colors.danger, fontFamily: PIXEL }}>
                    {req}
                  </Text>
                )}
              </View>
            </View>
            {/* Quick stat bars. */}
            <View style={{ marginTop: 6, gap: 2 }}>
              <MiniStat label="HP" value={c.base.maxHealth} max={150} colour={colors.success} />
              <MiniStat label="PWR" value={c.base.power} max={24} colour="#f59e0b" />
              <MiniStat label="SPD" value={c.base.speed} max={24} colour={colors.accent} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function MiniStat({ label, value, max, colour }: { label: string; value: number; max: number; colour: string }) {
  const colors = useThemeColors();
  const pct = Math.max(6, Math.min(100, (value / max) * 100));
  return (
    <View className="flex-row items-center" style={{ gap: 4 }}>
      <Text allowFontScaling={false} style={{ width: 20, fontSize: 6.5, color: colors['text-mute'], fontFamily: PIXEL }}>{label}</Text>
      <View style={{ flex: 1, height: 3, borderRadius: 3, backgroundColor: 'rgba(120,170,220,0.12)' }}>
        <View style={{ width: `${pct}%`, height: 3, borderRadius: 3, backgroundColor: colour }} />
      </View>
    </View>
  );
}

/** Look up a champion sprite for previews. */
export function championSprite(id: ChampionId) {
  const branch = CHAMPIONS[id].spriteBranch;
  return stillAvatar(branch, 4, 'male') ?? avatarArtV2(branch, 4, 'male').source;
}
