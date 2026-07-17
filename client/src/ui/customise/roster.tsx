import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';

import type { RosterEntry, RosterFilter, SkinId } from '@/domain/customise';
import { COMING_SOON_SLOTS, currentStageFor, filterRoster } from '@/domain/customise';
import { PIXEL, PIXEL_BOLD } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import type { Sex } from '@/ui/character/avatar-art';
import { CoinIcon } from '@/ui/core/coin-icon';
import { Chip } from '@/ui/core/neon-button';
import { EdgeLabel } from '@/ui/core/hud';
import { playSelect } from '@/ui/core/sound';

import { formArt } from './art';
import { StepperWheel } from './wheel';

/**
 * CUSTOMISE §roster — the character-select WHEEL (owner ask: each filter
 * pill opens a scroll wheel like the OUTFIT rail, not a laid-out grid).
 * Cards keep their grid-era width so ~3–4 ride the viewport; the ‹ ›
 * steppers move one champion at a time. Built from the REAL class roster
 * (branch gates), plus honest COMING SOON slots.
 */
/** A premium-character roster card's data (Captain Gymerica et al). */
export interface PremiumRosterEntry {
  id: string;
  name: string;
  icon: string;
  owned: boolean;
  price: number;
  still: import('react-native').ImageSourcePropType;
}

export function RosterSection({
  entries,
  premium = [],
  selectedId,
  equippedId,
  level,
  bfMid,
  sex,
  skin,
  onSelect,
  onSelectPremium,
}: {
  entries: RosterEntry[];
  /** Premium overlay characters, rendered after the class cards. */
  premium?: PremiumRosterEntry[];
  selectedId: string;
  /** The branch the persisted loadout resolves to (shows the ◈ marker). */
  equippedId: string;
  level: number;
  bfMid: number | null;
  sex: Sex;
  skin: SkinId;
  onSelect: (id: RosterEntry['id']) => void;
  onSelectPremium?: (id: string) => void;
}) {
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [search, setSearch] = useState('');

  const unlockedCount = entries.filter((e) => e.unlocked).length;
  const totalCount = entries.length + COMING_SOON_SLOTS;
  const visible = filterRoster(entries, filter, search);

  // Grid maths: page padding (20×2) + inter-card gaps of 8.
  const columns = width < 360 ? 3 : 4;
  const cardWidth = Math.floor((Math.min(width, 560) - 40 - (columns - 1) * 8) / columns);

  return (
    <View>
      <EdgeLabel
        right={
          <Text className="text-2xs text-text-mute" style={{ letterSpacing: 1 }}>
            {unlockedCount} / {totalCount} UNLOCKED
          </Text>
        }
      >
        ROSTER
      </EdgeLabel>

      <TextInput
        className="mt-s2 min-h-[44px] rounded-md border border-border bg-surface-2 p-s2 text-text"
        placeholder="Search champions…"
        placeholderTextColor="#64758f"
        value={search}
        onChangeText={setSearch}
        accessibilityLabel="search the roster"
        testID="roster-search"
      />

      <View className="mt-s2 flex-row" style={{ gap: 8 }}>
        {(['all', 'owned', 'locked'] as const).map((f) => (
          <Chip
            key={f}
            label={f.toUpperCase()}
            active={filter === f}
            onPress={() => setFilter(f)}
            testID={`roster-filter-${f}`}
          />
        ))}
      </View>

      {visible.length === 0 ? (
        <View className="mt-s3 items-center rounded-xl border border-border p-s5">
          <Text className="text-sm text-text-mute">No champions match.</Text>
        </View>
      ) : (
        <View className="mt-s3">
          <StepperWheel itemWidth={cardWidth} testID={`roster-wheel-${filter}`}>
            {visible.map((entry) => (
              <RosterCard
                key={entry.id}
                entry={entry}
                width={cardWidth}
                selected={entry.id === selectedId}
                equipped={entry.id === equippedId}
                stage={currentStageFor(entry.id, level, bfMid)}
                sex={sex}
                skin={skin}
                onSelect={onSelect}
              />
            ))}
            {premium
              .filter((pc) => {
                const q = search.trim().toLowerCase();
                if (filter === 'owned' && !pc.owned) return false;
                if (filter === 'locked' && pc.owned) return false;
                return !q || pc.name.toLowerCase().includes(q);
              })
              .map((pc) => (
                <PremiumCard
                  key={pc.id}
                  entry={pc}
                  width={cardWidth}
                  selected={pc.id === selectedId}
                  equipped={pc.id === equippedId}
                  onSelect={() => onSelectPremium?.(pc.id)}
                />
              ))}
            {filter === 'all' && !search
              ? Array.from({ length: COMING_SOON_SLOTS }, (_, i) => (
                  <ComingSoonCard key={`soon-${i}`} width={cardWidth} />
                ))
              : null}
          </StepperWheel>
        </View>
      )}
    </View>
  );
}

const RosterCard = memo(function RosterCard({
  entry,
  width,
  selected,
  equipped,
  stage,
  sex,
  skin,
  onSelect,
}: {
  entry: RosterEntry;
  width: number;
  selected: boolean;
  equipped: boolean;
  stage: number;
  sex: Sex;
  skin: SkinId;
  onSelect: (id: RosterEntry['id']) => void;
}) {
  const colors = useThemeColors();
  const art = formArt(entry.id, stage, sex, skin);
  const statusText = entry.current ? 'ACTIVE' : entry.unlocked ? 'OWNED' : 'LOCKED';
  return (
    <Pressable
      onPress={() => {
        playSelect();
        onSelect(entry.id);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${entry.name}, ${statusText.toLowerCase()}${selected ? ', selected' : ''}`}
      testID={`roster-card-${entry.id}`}
      className="rounded-xl border p-s2"
      style={{
        width,
        minHeight: 44,
        borderColor: selected ? `${colors.accent}b3` : entry.unlocked ? colors.border : 'rgba(120,170,220,0.10)',
        backgroundColor: selected ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)',
        shadowColor: colors.accent,
        shadowOpacity: selected ? 0.4 : 0,
        shadowRadius: 12,
        elevation: selected ? 4 : 0,
      }}
    >
      <View className="items-center" style={{ height: width * 0.82, justifyContent: 'center' }}>
        <Image
          source={art.still ?? art.painted}
          style={{
            width: width * 0.72,
            height: width * 0.78,
            opacity: entry.unlocked ? 1 : 0.35,
            ...(art.still ? ({ imageRendering: 'pixelated' } as object) : {}),
          }}
          contentFit="contain"
        />
        {equipped ? (
          <Text
            style={{ position: 'absolute', top: 0, right: 0, fontSize: 9, color: colors.accent }}
            accessibilityLabel="equipped"
          >
            ◈
          </Text>
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        allowFontScaling={false}
        style={{ fontSize: 8, textAlign: 'center', color: selected ? colors.accent : colors.text, fontFamily: PIXEL_BOLD }}
      >
        {entry.name.toUpperCase()}
      </Text>
      <View className="mt-s1 flex-row items-center justify-center" style={{ gap: 3 }}>
        <Text allowFontScaling={false} style={{ fontSize: 7, color: colors['text-mute'], fontFamily: PIXEL, letterSpacing: 0.5 }}>
          {statusText}
        </Text>
        <Text style={{ fontSize: 8 }}>{entry.unlocked ? entry.icon : '🔒'}</Text>
      </View>
    </Pressable>
  );
});

/** A premium overlay character card (Captain Gymerica): shows the price
 *  when unowned, a gold ◆ when owned, ◈ when it's the equipped avatar. */
const PremiumCard = memo(function PremiumCard({
  entry,
  width,
  selected,
  equipped,
  onSelect,
}: {
  entry: PremiumRosterEntry;
  width: number;
  selected: boolean;
  equipped: boolean;
  onSelect: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={() => {
        playSelect();
        onSelect();
      }}
      accessibilityRole="button"
      accessibilityLabel={`${entry.name}, ${entry.owned ? 'owned' : `locked, ${entry.price} coins`}${selected ? ', selected' : ''}`}
      testID={`roster-card-${entry.id}`}
      className="rounded-xl border p-s2"
      style={{
        width,
        minHeight: 44,
        borderColor: selected ? `${colors.accent}b3` : entry.owned ? `${colors.legendary}66` : 'rgba(120,170,220,0.10)',
        backgroundColor: selected ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)',
        shadowColor: selected ? colors.accent : colors.legendary,
        shadowOpacity: selected ? 0.4 : entry.owned ? 0.25 : 0,
        shadowRadius: 12,
        elevation: selected ? 4 : 0,
      }}
    >
      <View className="items-center" style={{ height: width * 0.82, justifyContent: 'center' }}>
        <Image
          source={entry.still}
          style={{ width: width * 0.72, height: width * 0.78, opacity: entry.owned ? 1 : 0.55, ...({ imageRendering: 'pixelated' } as object) }}
          contentFit="contain"
        />
        {equipped ? (
          <Text style={{ position: 'absolute', top: 0, right: 0, fontSize: 9, color: colors.accent }} accessibilityLabel="equipped">
            ◈
          </Text>
        ) : null}
      </View>
      <Text numberOfLines={1} allowFontScaling={false} style={{ fontSize: 8, textAlign: 'center', color: selected ? colors.accent : colors.text, fontFamily: PIXEL_BOLD }}>
        {entry.name.toUpperCase()}
      </Text>
      <View className="mt-s1 flex-row items-center justify-center" style={{ gap: 3 }}>
        <Text allowFontScaling={false} style={{ fontSize: 7, color: entry.owned ? colors.legendary : colors['text-mute'], fontFamily: PIXEL, letterSpacing: 0.5 }}>
          {entry.owned ? 'OWNED' : `${entry.price}`}
        </Text>
        {/* Purchasable → the forge coin, not a lock (owner ask). */}
        {entry.owned ? <Text style={{ fontSize: 8 }}>★</Text> : <CoinIcon size={10} />}
      </View>
    </Pressable>
  );
});

/** An honest future slot — art not delivered, not pretending otherwise. */
function ComingSoonCard({ width }: { width: number }) {
  const colors = useThemeColors();
  return (
    <View
      className="items-center justify-center rounded-xl border p-s2"
      style={{
        width,
        height: width * 0.82 + 34,
        borderColor: 'rgba(120,170,220,0.08)',
        backgroundColor: 'rgba(9,14,26,0.6)',
      }}
      accessibilityLabel="future champion, coming soon"
    >
      <Text style={{ fontSize: 22, opacity: 0.25 }}>👤</Text>
      <Text allowFontScaling={false} style={{ marginTop: 6, fontSize: 8, color: colors['text-mute'], fontFamily: PIXEL_BOLD }}>
        ???
      </Text>
      <Text allowFontScaling={false} style={{ marginTop: 2, fontSize: 7, color: colors['text-mute'], fontFamily: PIXEL, letterSpacing: 0.5 }}>
        COMING SOON
      </Text>
    </View>
  );
}
