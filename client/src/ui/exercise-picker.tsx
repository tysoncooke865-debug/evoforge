import { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { buildCorpus } from '@/data/exercise-corpus';
import { unitFor, useExercisePrefs, useToggleFavourite } from '@/data/exercise-prefs';
import { useCreateUserExercise, useUserExercises } from '@/data/exercises';
import { useWorkoutLog } from '@/data/hooks';
import { lastPerformanceLabel } from '@/domain/exercise-history';
import { passesFilters, rankExercises, type ExerciseFilters } from '@/domain/exercise-rank';
import { buildSections } from '@/domain/exercise-sections';
import {
  CATEGORY_OPTIONS,
  DIFFICULTY_OPTIONS,
  EQUIPMENT_OPTIONS,
  MUSCLE_GROUPS,
  muscleOptionsForCreate,
  type Category,
  type Difficulty,
  type Equipment,
  type LibraryExercise,
} from '@/domain/exercise-taxonomy';

import tokens from '@/theme/tokens';

import { NeonButton } from './neon-button';

/**
 * ADD EXERCISE (redesigned 2026-07-14, Tyson's spec).
 *
 * The library is ~960 exercises. THE ATHLETE MUST NEVER FEEL THAT. Everything
 * here narrows: a sticky search that understands what people actually type
 * ("db incline", "rdl", "skullcrusher"), one-tap muscle chips with subgroups,
 * equipment and advanced filters in a sheet, and — before a single keystroke —
 * personalised sections: what is in today's workout, what they did recently,
 * what they starred, what suits what they are training, then the staples.
 *
 * The thinking lives in pure modules (exercise-rank, exercise-sections,
 * exercise-history) and is tested there. This file is the surface.
 *
 * PERFORMANCE: one FlatList over a FLATTENED list (headers + rows are items),
 * so there is never a nested-scroll or a 960-row render. Search is debounced,
 * ranking is memoised on (query, filters, context), and rows are pure.
 */

export interface PickedExercise {
  name: string;
  muscle: string;
}

type Row =
  | { kind: 'header'; key: string; title: string; count?: number }
  | { kind: 'exercise'; key: string; exercise: LibraryExercise; match: string };

const SEARCH_DEBOUNCE_MS = 120;

export function ExercisePicker({
  visible,
  onClose,
  onPick,
  excludeNames = [],
  /** The day's exercises — drives IN YOUR PROGRAM and the target muscles. */
  programExercises = [],
  /** Add several before closing (the workout builder wants this). */
  multi = false,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (e: PickedExercise) => void;
  excludeNames?: readonly string[];
  programExercises?: readonly string[];
  multi?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [groupKey, setGroupKey] = useState('all');
  const [subKey, setSubKey] = useState<string | null>(null);
  const [filters, setFilters] = useState<ExerciseFilters>({});
  const [filterSheet, setFilterSheet] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const listRef = useRef<FlatList<Row>>(null);

  const userExercises = useUserExercises();
  const create = useCreateUserExercise();
  const prefs = useExercisePrefs();
  const toggleFav = useToggleFavourite();
  const workouts = useWorkoutLog();

  // A keystroke must not re-rank 960 exercises. 120ms is below the threshold
  // where typing feels laggy and above the rate a thumb produces characters.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // PERF (found 2026-07-14): everything below this line is real work — a
  // 2,500-row history digest, a 960-entry library, a full rank+sort for the
  // default sections. The picker is MOUNTED by Train the whole time and only
  // `visible` when opened, so all of it was running on EVERY Today render:
  // every keystroke in a set row, every logged set. Bail out first. (Hooks are
  // all above; nothing below this point calls one, so the early return is safe.)
  if (!visible) return null;

  // The corpus recipe now lives in data/exercise-corpus.ts so the inline
  // ExerciseSearchBar ranks against the SAME world as this picker.
  const { library, context, isCustom, history } = buildCorpus(
    { userExercises: userExercises.data, prefRows: prefs.data, workoutRows: workouts.data },
    { programExercises, excludeNames }
  );
  const favourites = context.favourites;
  const hidden = context.hidden;
  const alreadyAdded = context.alreadyAdded;
  const targetMuscles = context.targetMuscles;

  const group = MUSCLE_GROUPS.find((g) => g.key === groupKey) ?? MUSCLE_GROUPS[0];
  const sub = group.subgroups.find((s) => s.key === subKey) ?? null;
  const muscleFilter = sub ? sub.muscles : group.muscles;

  const activeFilters: ExerciseFilters = {
    ...filters,
    muscles: muscleFilter.length > 0 ? muscleFilter : undefined,
  };

  const searching = debounced.trim().length > 0;

  const results = searching
    ? rankExercises(library, {
        query: debounced,
        filters: activeFilters,
        context,
        isCustom,
        limit: 120, // more than anyone scrolls; keeps the list bounded
      })
    : [];

  const sections = searching
    ? []
    : buildSections({
        library,
        program: programExercises,
        history,
        favourites,
        hidden,
        targetMuscles,
        alreadyAdded,
        filterPass: (e) => passesFilters(e, activeFilters, context, isCustom),
      });

  /** One flat list: headers and rows are both items. No nested scrolling. */
  const rows: Row[] = (() => {
    if (searching) {
      const out: Row[] = [
        { kind: 'header', key: 'results', title: 'RESULTS', count: results.length },
      ];
      for (const r of results) {
        out.push({ kind: 'exercise', key: r.exercise.name, exercise: r.exercise, match: r.match });
      }
      return out;
    }
    const out: Row[] = [];
    for (const s of sections) {
      out.push({ kind: 'header', key: s.key, title: s.title });
      for (const e of s.exercises) {
        out.push({ kind: 'exercise', key: `${s.key}:${e.name}`, exercise: e, match: '' });
      }
    }
    return out;
  })();

  /** Emptiness is a property of the RESULTS, not of the row list — the row list
   *  always has a header in it while searching. */
  const isEmpty = searching ? results.length === 0 : sections.length === 0;

  const filterCount =
    (filters.equipment?.length ?? 0) +
    (filters.categories?.length ?? 0) +
    (filters.difficulties?.length ?? 0) +
    (filters.favouritesOnly ? 1 : 0) +
    (filters.performedOnly ? 1 : 0) +
    (filters.inProgramOnly ? 1 : 0) +
    (filters.customOnly ? 1 : 0);

  const reset = () => {
    setQuery('');
    setDebounced('');
    setGroupKey('all');
    setSubKey(null);
    setFilters({});
    setSelected([]);
    setCreating(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const add = (e: LibraryExercise) => {
    const key = e.name.toLowerCase();
    if (alreadyAdded.has(key)) return; // never add the same exercise twice
    if (multi) {
      setSelected((s) => (s.includes(e.name) ? s : [...s, e.name]));
      return;
    }
    onPick({ name: e.name, muscle: e.muscle });
    reset();
  };

  const confirmMulti = () => {
    const byName = new Map(library.map((e) => [e.name, e]));
    for (const n of selected) {
      const e = byName.get(n);
      if (e) onPick({ name: e.name, muscle: e.muscle });
    }
    reset();
    onClose();
  };

  const renderRow = ({ item }: ListRenderItemInfo<Row>) => {
      if (item.kind === 'header') {
        return (
          <View className="mb-s2 mt-s3 flex-row items-center justify-between">
            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              {item.title}
            </Text>
            {item.count !== undefined ? (
              <Text className="text-2xs text-text-mute">
                {item.count} {item.count === 1 ? 'result' : 'results'}
              </Text>
            ) : null}
          </View>
        );
      }
      const e = item.exercise;
      const key = e.name.toLowerCase();
      return (
        <ExerciseRow
          exercise={e}
          match={item.match}
          last={lastPerformanceLabel(history, e.name, unitFor(prefs.data, e.name))}
          favourite={favourites.has(key)}
          added={alreadyAdded.has(key)}
          selected={selected.includes(e.name)}
          onAdd={() => add(e)}
          onFavourite={() => toggleFav.mutate({ exercise: e.name, favourite: !favourites.has(key) })}
        />
      );
  };

  const trimmed = query.trim();
  const exactExists = library.some((e) => e.name.toLowerCase() === trimmed.toLowerCase());
  const canCreate = trimmed.length >= 2 && !exactExists;

  return (
    <Modal transparent={false} animationType="slide" onRequestClose={close} visible>
      <View className="flex-1" style={{ backgroundColor: tokens.colors.bg, paddingTop: insets.top }}>
        {creating ? (
          <CreateCustom
            name={trimmed}
            busy={create.isPending}
            onCancel={() => setCreating(false)}
            onChoose={(muscle) =>
              create.mutate(
                { name: trimmed, muscle },
                {
                  onSuccess: (made) => {
                    setCreating(false);
                    add({ name: made.name, muscle: made.muscle });
                  },
                }
              )
            }
          />
        ) : (
          <>
            {/* STICKY HEADER — stays put while the list scrolls. */}
            <View className="border-b border-border px-s4 pb-s2" style={{ backgroundColor: tokens.colors.surface }}>
              <View className="flex-row items-center justify-between">
                <Pressable
                  onPress={close}
                  accessibilityRole="button"
                  accessibilityLabel="close add exercise"
                  testID="picker-close"
                  className="items-center justify-center"
                  style={{ minWidth: 44, minHeight: 44 }}
                >
                  <Text className="text-lg text-text-dim">✕</Text>
                </Pressable>
                <Text className="text-sm font-bold text-text" style={{ letterSpacing: 1 }}>
                  ADD EXERCISE
                  {multi && selected.length > 0 ? ` · ${selected.length}` : ''}
                </Text>
                <View style={{ minWidth: 44 }} />
              </View>

              {/* STICKY SEARCH */}
              <View className="mt-s1 flex-row items-center rounded-xl border bg-surface-2 px-s3" style={{ borderColor: tokens.colors.border, minHeight: 48 }}>
                <Text className="mr-s2 text-sm text-text-mute">🔍</Text>
                <TextInput
                  className="flex-1 text-base text-text"
                  style={{ minHeight: 48 }}
                  placeholder="Search exercises, muscles or equipment"
                  placeholderTextColor="#64758f"
                  value={query}
                  onChangeText={setQuery}
                  autoCorrect={false}
                  autoCapitalize="none"
                  accessibilityLabel="search exercises"
                  testID="picker-search"
                />
                {query.length > 0 ? (
                  <Pressable
                    onPress={() => setQuery('')}
                    accessibilityRole="button"
                    accessibilityLabel="clear search"
                    testID="picker-search-clear"
                    className="items-center justify-center"
                    style={{ minWidth: 44, minHeight: 44 }}
                  >
                    <Text className="text-sm text-text-mute">✕</Text>
                  </Pressable>
                ) : null}
              </View>

              {/* MUSCLE CHIPS — subgroups appear only once a group is chosen. */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-s2" keyboardShouldPersistTaps="handled">
                <View className="flex-row gap-s2 pb-s1">
                  {MUSCLE_GROUPS.map((g) => (
                    <Chip
                      key={g.key}
                      label={g.label}
                      active={g.key === groupKey}
                      testID={`muscle-${g.key}`}
                      onPress={() => {
                        setGroupKey(g.key);
                        setSubKey(null);
                        listRef.current?.scrollToOffset({ offset: 0, animated: false });
                      }}
                    />
                  ))}
                </View>
              </ScrollView>

              {group.subgroups.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  <View className="flex-row gap-s2 pb-s1">
                    {group.subgroups.map((s) => (
                      <Chip
                        key={s.key}
                        label={s.label}
                        small
                        active={s.key === subKey || (subKey === null && s.key.endsWith('-all'))}
                        testID={`sub-${s.key}`}
                        onPress={() => setSubKey(s.key.endsWith('-all') ? null : s.key)}
                      />
                    ))}
                  </View>
                </ScrollView>
              ) : null}

              {/* EQUIPMENT / FILTERS */}
              <View className="mt-s1 flex-row gap-s2">
                <Pressable
                  onPress={() => setFilterSheet(true)}
                  accessibilityRole="button"
                  testID="picker-filters"
                  className="flex-row items-center justify-center rounded-pill border px-s3"
                  style={{
                    minHeight: 44,
                    borderColor: filterCount > 0 ? `${tokens.colors.accent}8c` : tokens.colors.border,
                    backgroundColor: filterCount > 0 ? 'rgba(34,211,238,0.10)' : 'transparent',
                  }}
                >
                  <Text className={`text-2xs font-bold ${filterCount > 0 ? 'text-accent' : 'text-text-dim'}`}>
                    ⚙ FILTERS{filterCount > 0 ? ` · ${filterCount}` : ''}
                  </Text>
                </Pressable>
                {filterCount > 0 || groupKey !== 'all' ? (
                  <Pressable
                    onPress={() => {
                      setFilters({});
                      setGroupKey('all');
                      setSubKey(null);
                    }}
                    accessibilityRole="button"
                    testID="picker-clear-all"
                    className="items-center justify-center px-s2"
                    style={{ minHeight: 44 }}
                  >
                    <Text className="text-2xs font-bold text-text-mute">CLEAR ALL</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            {/* THE LIST — one FlatList, flattened items, windowed. */}
            {isEmpty ? (
              <EmptyState
                query={trimmed}
                hasFilters={filterCount > 0 || groupKey !== 'all'}
                onCreate={() => setCreating(true)}
                canCreate={canCreate}
                onClearFilters={() => {
                  setFilters({});
                  setGroupKey('all');
                  setSubKey(null);
                }}
              />
            ) : (
              <FlatList
                ref={listRef}
                data={rows}
                keyExtractor={(r) => r.key}
                renderItem={renderRow}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                initialNumToRender={12}
                maxToRenderPerBatch={12}
                windowSize={7}
                removeClippedSubviews
                contentContainerStyle={{
                  paddingHorizontal: 16,
                  paddingBottom: 24 + insets.bottom + (multi && selected.length > 0 ? 72 : 0),
                }}
                ListFooterComponent={
                  canCreate ? (
                    <Pressable
                      onPress={() => setCreating(true)}
                      accessibilityRole="button"
                      testID="picker-create"
                      className="mt-s3 rounded-md px-s3 py-s3"
                      style={{
                        minHeight: 44,
                        justifyContent: 'center',
                        borderWidth: 1,
                        borderColor: `${tokens.colors.legendary}66`,
                        backgroundColor: 'rgba(250,204,21,0.08)',
                      }}
                    >
                      <Text className="text-sm font-bold" style={{ color: tokens.colors.legendary }}>
                        ＋ CREATE &ldquo;{trimmed}&rdquo;
                      </Text>
                      <Text className="text-2xs text-text-mute">Not in the library — make it yours.</Text>
                    </Pressable>
                  ) : null
                }
              />
            )}

            {/* MULTI-ADD footer — thumb-reachable, never covers the list. */}
            {multi && selected.length > 0 ? (
              <View
                className="border-t border-border px-s4 pt-s2"
                style={{ backgroundColor: tokens.colors.surface, paddingBottom: 8 + insets.bottom }}
              >
                <NeonButton
                  title={`ADD ${selected.length} ${selected.length === 1 ? 'EXERCISE' : 'EXERCISES'}`}
                  onPress={confirmMulti}
                  testID="picker-add-selected"
                />
              </View>
            ) : null}
          </>
        )}

        {filterSheet ? (
          <FilterSheet
            filters={filters}
            // Count the DRAFT, not the committed filters — a preview of the
            // filters you already had is not a preview.
            countFor={(draft) =>
              rankExercises(library, {
                query: debounced,
                filters: { ...draft, muscles: activeFilters.muscles },
                context,
                isCustom,
              }).length
            }
            onApply={(f) => {
              setFilters(f);
              setFilterSheet(false);
            }}
            onClose={() => setFilterSheet(false)}
          />
        ) : null}
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ rows */

function ExerciseRow({
  exercise,
  match,
  last,
  favourite,
  added,
  selected,
  onAdd,
  onFavourite,
}: {
  exercise: LibraryExercise;
  /** The text that matched, lowercased. '' = nothing in the NAME matched. */
  match: string;
  last: string | null;
  favourite: boolean;
  added: boolean;
  selected: boolean;
  onAdd: () => void;
  onFavourite: () => void;
}) {
  const name = exercise.name;
  // Locate the matched text in the name we are ACTUALLY RENDERING. The old code
  // used an offset measured against the NORMALISED name, where "(" had become a
  // space and runs were collapsed — so in "Reverse Pec Deck (Rear Delt Fly)" a
  // search for "rear" highlighted "(Rea".
  const at = match ? name.toLowerCase().indexOf(match) : -1;
  const before = at >= 0 ? name.slice(0, at) : name;
  const hit = at >= 0 ? name.slice(at, at + match.length) : '';
  const after = at >= 0 ? name.slice(at + match.length) : '';

  const state = added ? 'added' : selected ? 'selected' : 'idle';

  return (
    <View
      className="mb-s2 flex-row items-center rounded-xl border px-s3 py-s2"
      style={{
        minHeight: 64,
        borderColor: state === 'idle' ? tokens.colors.border : `${tokens.colors.success}66`,
        backgroundColor: state === 'idle' ? 'rgba(13,21,36,0.6)' : 'rgba(52,211,153,0.06)',
      }}
    >
      <Pressable
        onPress={onFavourite}
        accessibilityRole="button"
        accessibilityLabel={`${favourite ? 'unfavourite' : 'favourite'} ${name}`}
        accessibilityState={{ selected: favourite }}
        testID={`fav-${name}`}
        className="mr-s2 items-center justify-center"
        style={{ minWidth: 44, minHeight: 44 }}
      >
        <Text className="text-base" style={{ color: favourite ? tokens.colors.legendary : tokens.colors['text-mute'] }}>
          {favourite ? '★' : '☆'}
        </Text>
      </Pressable>

      <View className="flex-1 pr-s2">
        <Text className="text-sm font-bold text-text" numberOfLines={2}>
          {hit ? (
            <>
              {before}
              <Text style={{ color: tokens.colors.accent }}>{hit}</Text>
              {after}
            </>
          ) : (
            name
          )}
        </Text>
        <Text className="text-2xs text-text-mute" numberOfLines={1}>
          {exercise.muscle}
          {exercise.equipment ? ` • ${exercise.equipment}` : ''}
        </Text>
        {last ? (
          <Text className="text-2xs" style={{ color: tokens.colors.accent }} numberOfLines={1}>
            {last}
          </Text>
        ) : null}
      </View>

      <Pressable
        onPress={onAdd}
        disabled={added}
        accessibilityRole="button"
        accessibilityLabel={added ? `${name} already added` : `add ${name}`}
        accessibilityState={{ disabled: added, selected }}
        testID={`pick-${name}`}
        className="items-center justify-center rounded-md"
        style={{
          minWidth: 48,
          minHeight: 48,
          borderWidth: 1,
          borderColor: state === 'idle' ? `${tokens.colors.accent}66` : `${tokens.colors.success}8c`,
          backgroundColor: state === 'idle' ? 'rgba(34,211,238,0.10)' : 'rgba(52,211,153,0.14)',
        }}
      >
        <Text
          className="text-base font-bold"
          style={{ color: state === 'idle' ? tokens.colors.accent : tokens.colors.success }}
        >
          {state === 'idle' ? '＋' : '✓'}
        </Text>
      </Pressable>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
  testID,
  small = false,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
  small?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      testID={testID}
      className="items-center justify-center rounded-pill border px-s3"
      style={{
        minHeight: 44,
        borderColor: active ? `${tokens.colors.accent}8c` : tokens.colors.border,
        backgroundColor: active ? 'rgba(34,211,238,0.10)' : 'rgba(13,21,36,0.6)',
      }}
    >
      <Text
        className={`font-bold ${small ? 'text-2xs' : 'text-2xs'}`}
        style={{ letterSpacing: 1, color: active ? tokens.colors.accent : tokens.colors['text-dim'] }}
      >
        {/* Colour is never the only cue (a11y): the selected chip is ticked. */}
        {active ? `✓ ${label}` : label}
      </Text>
    </Pressable>
  );
}

/* --------------------------------------------------------------- filters */

function FilterSheet({
  filters,
  countFor,
  onApply,
  onClose,
}: {
  filters: ExerciseFilters;
  /** How many exercises a given draft would leave. Live, as they tap. */
  countFor: (draft: ExerciseFilters) => number;
  onApply: (f: ExerciseFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<ExerciseFilters>(filters);
  const insets = useSafeAreaInsets();

  const toggle = <T,>(list: readonly T[] | undefined, v: T): T[] => {
    const cur = list ?? [];
    return cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} visible>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.72)' }} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          className="rounded-t-xl border-t px-s4 pt-s4"
          style={{
            borderColor: `${tokens.colors.accent}40`,
            backgroundColor: tokens.colors.surface,
            maxHeight: '85%',
            paddingBottom: 12 + insets.bottom,
          }}
        >
          <Text className="mb-s3 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            FILTERS
          </Text>
          <ScrollView style={{ maxHeight: 420 }}>
            <FilterGroup title="EQUIPMENT">
              {EQUIPMENT_OPTIONS.map((e) => (
                <Chip
                  key={e}
                  label={e}
                  active={(draft.equipment ?? []).includes(e)}
                  testID={`equip-${e}`}
                  onPress={() => setDraft((d) => ({ ...d, equipment: toggle<Equipment>(d.equipment, e) }))}
                />
              ))}
            </FilterGroup>

            <FilterGroup title="CATEGORY">
              {CATEGORY_OPTIONS.map((c) => (
                <Chip
                  key={c}
                  label={c}
                  active={(draft.categories ?? []).includes(c)}
                  testID={`cat-${c}`}
                  onPress={() => setDraft((d) => ({ ...d, categories: toggle<Category>(d.categories, c) }))}
                />
              ))}
            </FilterGroup>

            <FilterGroup title="DIFFICULTY">
              {DIFFICULTY_OPTIONS.map((d0) => (
                <Chip
                  key={d0}
                  label={d0}
                  active={(draft.difficulties ?? []).includes(d0)}
                  testID={`diff-${d0}`}
                  onPress={() => setDraft((d) => ({ ...d, difficulties: toggle<Difficulty>(d.difficulties, d0) }))}
                />
              ))}
            </FilterGroup>

            <FilterGroup title="MINE">
              <Chip
                label="Favourites"
                active={draft.favouritesOnly === true}
                testID="filter-fav"
                onPress={() => setDraft((d) => ({ ...d, favouritesOnly: !d.favouritesOnly }))}
              />
              <Chip
                label="Performed before"
                active={draft.performedOnly === true}
                testID="filter-performed"
                onPress={() => setDraft((d) => ({ ...d, performedOnly: !d.performedOnly }))}
              />
              <Chip
                label="In this workout"
                active={draft.inProgramOnly === true}
                testID="filter-program"
                onPress={() => setDraft((d) => ({ ...d, inProgramOnly: !d.inProgramOnly }))}
              />
              <Chip
                label="My exercises"
                active={draft.customOnly === true}
                testID="filter-custom"
                onPress={() => setDraft((d) => ({ ...d, customOnly: !d.customOnly }))}
              />
            </FilterGroup>
          </ScrollView>

          <View className="mt-s3 flex-row gap-s2">
            <View className="flex-1">
              <NeonButton title="CLEAR ALL" variant="ghost" onPress={() => setDraft({})} testID="filters-clear" />
            </View>
            <View className="flex-1">
              <NeonButton
                title={`APPLY · ${countFor(draft)}`}
                onPress={() => onApply(draft)}
                testID="filters-apply"
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mb-s4">
      <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
        {title}
      </Text>
      <View className="flex-row flex-wrap gap-s2">{children}</View>
    </View>
  );
}

/* ---------------------------------------------------------------- states */

function EmptyState({
  query,
  hasFilters,
  canCreate,
  onCreate,
  onClearFilters,
}: {
  query: string;
  hasFilters: boolean;
  canCreate: boolean;
  onCreate: () => void;
  onClearFilters: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center px-s6">
      <Text className="mb-s2 text-base font-bold text-text">No exercises found</Text>
      {hasFilters ? (
        <>
          <Text className="mb-s3 text-center text-2xs text-text-mute">
            Your filters may be hiding it.
          </Text>
          <View className="mb-s3 w-full">
            <NeonButton title="CLEAR FILTERS" variant="ghost" onPress={onClearFilters} testID="empty-clear" />
          </View>
        </>
      ) : null}
      {canCreate ? (
        <View className="w-full">
          <NeonButton title={`CREATE “${query}”`} onPress={onCreate} testID="empty-create" />
        </View>
      ) : (
        <Text className="text-center text-2xs text-text-mute">Type a name to create your own.</Text>
      )}
    </View>
  );
}

function CreateCustom({
  name,
  busy,
  onChoose,
  onCancel,
}: {
  name: string;
  busy: boolean;
  onChoose: (muscle: string) => void;
  onCancel: () => void;
}) {
  return (
    <View className="flex-1 px-s4 pt-s3">
      <Text className="mb-s1 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
        WHAT DOES IT TRAIN?
      </Text>
      <Text className="mb-s3 text-lg font-bold text-text">{name}</Text>
      <ScrollView>
        {muscleOptionsForCreate().map((section) => (
          <View key={section.label} className="mb-s3">
            <Text className="mb-s2 text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              {section.label.toUpperCase()}
            </Text>
            <View className="flex-row flex-wrap gap-s2">
              {section.muscles.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => (busy ? undefined : onChoose(m))}
                  disabled={busy}
                  accessibilityRole="button"
                  testID={`muscle-tag-${m}`}
                  className="rounded-md border border-border px-s3 py-s2"
                  style={{ minHeight: 44, justifyContent: 'center', backgroundColor: 'rgba(13,21,36,0.7)' }}
                >
                  <Text className="text-2xs font-bold text-text-dim">{m}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
      <View className="my-s3">
        <NeonButton title="BACK" variant="ghost" onPress={onCancel} testID="picker-create-back" />
      </View>
    </View>
  );
}
