import { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import { useReportPost } from '@/data/social-feed';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { Chip, NeonButton } from '@/ui/core/neon-button';

/**
 * REPORT A POST (§6.2, migration 059 — record-only v1). Reason chips + an
 * optional note; the insert is the whole feature. Reports are readable by
 * the service role only, and duplicates surface as "already reported".
 * No auto-hide: moderation without review tooling would be a mocked system.
 */
const REASONS = [
  { id: 'spam', label: 'SPAM' },
  { id: 'abuse', label: 'ABUSE / HARASSMENT' },
  { id: 'nsfw', label: 'INAPPROPRIATE PHOTO' },
  { id: 'other', label: 'OTHER' },
] as const;

export function ReportSheet({ postId, onClose }: { postId: string; onClose: () => void }) {
  const colors = useThemeColors();
  const [reason, setReason] = useState<(typeof REASONS)[number]['id'] | null>(null);
  const [note, setNote] = useState('');
  const report = useReportPost();

  const send = () => {
    if (reason === null) return;
    report.mutate({ postId, reason, note }, { onSettled: onClose });
  };

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: 'rgba(2,5,11,0.82)' }} onPress={onClose}>
        <Pressable
          onPress={() => undefined}
          className="overflow-hidden rounded-t-xl border-t p-s4"
          style={{ borderColor: `${colors.danger}40`, backgroundColor: colors.surface }}
        >
          <Text className="mb-s2 text-text" allowFontScaling={false} style={{ fontSize: 16, letterSpacing: 0.5, ...pixelFont() }}>
            REPORT POST
          </Text>
          <Text className="mb-s3 text-2xs text-text-mute">
            Reports go to the EvoForge team for review. The author is not told who reported.
          </Text>
          <View className="mb-s3 flex-row flex-wrap" style={{ gap: 6 }}>
            {REASONS.map((r) => (
              <Chip
                key={r.id}
                label={r.label}
                active={reason === r.id}
                onPress={() => setReason(reason === r.id ? null : r.id)}
                testID={`report-reason-${r.id}`}
                hitSlop={{ top: 8, bottom: 8 }}
              />
            ))}
          </View>
          <TextInput
            className="mb-s3 min-h-[48px] w-full rounded-md border border-border bg-surface-2 px-s3 text-sm text-text"
            placeholder="Anything the team should know? (optional)"
            placeholderTextColor="#64758f"
            value={note}
            onChangeText={setNote}
            maxLength={300}
            testID="report-note"
          />
          <NeonButton
            title="SEND REPORT"
            variant="danger"
            onPress={send}
            disabled={reason === null}
            busy={report.isPending}
            testID="report-send"
          />
          <View className="mt-s2">
            <NeonButton title="CANCEL" variant="ghost" onPress={onClose} testID="report-cancel" />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
