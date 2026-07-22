/**
 * Beta feedback tool (M10) — a simple local feedback screen: pick a category
 * (Bug / Balance / Idea), write a note, and it is stored in the corrupt-safe
 * feedback log (services/feedback/feedback-log.ts). Past entries are listed
 * newest-first and the whole log can be exported as a shareable text blob via
 * the React Native Share API. Fully offline — nothing leaves the device until
 * the player shares the export themselves.
 */
import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Body, Heading, NeonButton, Panel, Screen } from '../components/ui';
import { colors, radius, spacing, typography } from '../constants/theme';
import { BALANCE } from '../content';
import { appStorage } from '../services/app-services';
import {
  appendFeedbackEntry,
  createFeedbackEntry,
  exportFeedbackText,
  FEEDBACK_CATEGORIES,
  FeedbackCategory,
  FeedbackEntry,
  loadFeedbackEntries,
  MAX_FEEDBACK_MESSAGE_LENGTH,
} from '../services/feedback/feedback-log';

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: 'Bug',
  balance: 'Balance',
  idea: 'Idea',
};

const CATEGORY_TINT: Record<FeedbackCategory, string> = {
  bug: colors.danger,
  balance: colors.warning,
  idea: colors.cyan,
};

export default function FeedbackScreen() {
  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [message, setMessage] = useState('');
  const [entries, setEntries] = useState<FeedbackEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadFeedbackEntries(appStorage);
      if (!cancelled) setEntries(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(async () => {
    const entry = createFeedbackEntry(category, message, BALANCE.balanceVersion);
    if (!entry) {
      setNotice('Write a note first — empty feedback is not saved.');
      return;
    }
    try {
      const next = await appendFeedbackEntry(appStorage, entry);
      setEntries(next);
      setMessage('');
      setNotice('Feedback saved on this device. Use Export to share it.');
    } catch (e) {
      setNotice(`Could not save feedback: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [category, message]);

  const exportAll = useCallback(async () => {
    try {
      await Share.share({ message: exportFeedbackText(entries) });
    } catch {
      // Share sheet dismissed or unavailable (e.g. some browsers) — no-op.
    }
  }, [entries]);

  const newestFirst = [...entries].reverse();

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Beta Feedback' }} />
      <Body dim>
        Found a bug, a balance problem, or have an idea? Log it here — entries
        stay on this device until you export and share them.
      </Body>

      <Panel>
        <Text style={styles.sectionLabel}>CATEGORY</Text>
        <View style={styles.chipRow}>
          {FEEDBACK_CATEGORIES.map((c) => {
            const selected = category === c;
            return (
              <Pressable
                key={c}
                onPress={() => setCategory(c)}
                accessibilityRole="button"
                accessibilityLabel={`Category ${CATEGORY_LABEL[c]}`}
                accessibilityState={{ selected }}
                style={[styles.chip, selected && styles.chipSelected]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {CATEGORY_LABEL[c]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>YOUR NOTE</Text>
        <TextInput
          value={message}
          onChangeText={(text) => {
            setMessage(text);
            setNotice(null);
          }}
          multiline
          maxLength={MAX_FEEDBACK_MESSAGE_LENGTH}
          placeholder="What happened? What should change?"
          placeholderTextColor={colors.textDim}
          style={styles.input}
          accessibilityLabel="Feedback note"
          textAlignVertical="top"
        />
        {notice && <Body dim>{notice}</Body>}
        <NeonButton label="Save feedback" onPress={() => void submit()} />
      </Panel>

      <Panel>
        <View style={styles.historyHeader}>
          <Heading>Past entries ({entries.length})</Heading>
        </View>
        {entries.length === 0 && <Body dim>Nothing logged yet.</Body>}
        {newestFirst.map((entry) => (
          <View key={entry.id} style={styles.entry}>
            <View style={styles.entryHeader}>
              <Text style={[styles.entryCategory, { color: CATEGORY_TINT[entry.category] }]}>
                {CATEGORY_LABEL[entry.category].toUpperCase()}
              </Text>
              <Text style={styles.entryDate}>{entry.createdAt.slice(0, 10)}</Text>
            </View>
            <Body>{entry.message}</Body>
          </View>
        ))}
        {entries.length > 0 && (
          <NeonButton label="Export" variant="secondary" onPress={() => void exportAll()} />
        )}
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { ...typography.label, color: colors.textDim, letterSpacing: 1 },
  chipRow: { flexDirection: 'row', gap: spacing.xs },
  chip: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  chipSelected: { borderColor: colors.cyan, backgroundColor: colors.cyanDim },
  chipText: { ...typography.label, color: colors.textDim },
  chipTextSelected: { color: '#E0FBFF' },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 100,
  },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  entry: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  entryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  entryCategory: { ...typography.label, fontSize: 11, letterSpacing: 1 },
  entryDate: { ...typography.mono, color: colors.textDim },
});
