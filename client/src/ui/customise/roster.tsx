import { Image } from 'expo-image';
import { memo, useState } from 'react';
import { Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';

import type { RosterEntry, RosterFilter, SkinId } from '@/domain/customise';
import { COMING_SOON_SLOTS, currentStageFor, filterRoster } from '@/domain/customise';
import { PIXEL, PIXEL_BOLD } from '@/theme/fonts';
import tokens from '@/theme/tokens';
import type { Sex } from '@/ui/character/avatar-art';
import { Chip } from '@/ui/core/neon-button';
import { EdgeLabel } from '@/ui/core/hud';
import { playSelect } from '@/ui/core/sound';

import { formArt } from './art';

/**
 * CUSTOMISE §roster — the character-select grid. 4 portrait cards per row
 * (3 under 360pt), built from the REAL class roster (branch gates), plus
 * honest COMING SOON slots so the layout is proven at scale. The catalog
 * is bounded (six classes + slots), so a plain wrapped grid inside the
 * page scroll is the right tool — a virtualised list nested in a
 * ScrollView would fight it for the gesture.
 */
export function RosterSection({
  entries,
  selectedId,
  equippedId,
  level,
  bfMid,
  sex,
  skin,
  onSelect,
}: {
  entries: RosterEntry[];
  selectedId: string;
  /** The branch the persisted loadout resolves to (shows the ◈ marker). */
  equippedId: string;
  level: number;
  bfMid: number | null;
  sex: Sex;
  skin: SkinId;
  onSelect: (id: RosterEntry['id']) => void;
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
        <View className="mt-s3 flex-row flex-wrap" style={{ gap: 8 }}>
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
          {filter === 'all' && !search
            ? Array.from({ length: COMING_SOON_SLOTS }, (_, i) => (
                <ComingSoonCard key={`soon-${i}`} width={cardWidth} />
              ))
            : null}
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
        borderColor: selected ? `${tokens.colors.accent}b3` : entry.unlocked ? tokens.colors.border : 'rgba(120,170,220,0.10)',
        backgroundColor: selected ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)',
        shadowColor: tokens.colors.accent,
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
            style={{ position: 'absolute', top: 0, right: 0, fontSize: 9, color: tokens.colors.accent }}
            accessibilityLabel="equipped"
          >
            ◈
          </Text>
        ) : null}
      </View>
      <Text
        numberOfLines={1}
        allowFontScaling={false}
        style={{ fontSize: 8, textAlign: 'center', color: selected ? tokens.colors.accent : tokens.colors.text, fontFamily: PIXEL_BOLD }}
      >
        {entry.name.toUpperCase()}
      </Text>
      <View className="mt-s1 flex-row items-center justify-center" style={{ gap: 3 }}>
        <Text allowFontScaling={false} style={{ fontSize: 7, color: tokens.colors['text-mute'], fontFamily: PIXEL, letterSpacing: 0.5 }}>
          {statusText}
        </Text>
        <Text style={{ fontSize: 8 }}>{entry.unlocked ? entry.icon : '🔒'}</Text>
      </View>
    </Pressable>
  );
});

/** An honest future slot — art not delivered, not pretending otherwise. */
function ComingSoonCard({ width }: { width: number }) {
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
      <Text allowFontScaling={false} style={{ marginTop: 6, fontSize: 8, color: tokens.colors['text-mute'], fontFamily: PIXEL_BOLD }}>
        ???
      </Text>
      <Text allowFontScaling={false} style={{ marginTop: 2, fontSize: 7, color: tokens.colors['text-mute'], fontFamily: PIXEL, letterSpacing: 0.5 }}>
        COMING SOON
      </Text>
    </View>
  );
}
