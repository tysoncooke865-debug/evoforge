import { zipSync, strToU8 } from 'fflate';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/data/auth-context';
import { supabase } from '@/data/supabase';
import { useToastStore } from '@/state/toast-store';
import { pixelFont } from '@/theme/fonts';
import { ScreenHeader } from '@/ui/core/screen-header';
import { GlowCard, ScreenShell } from '@/ui/core/shell';
import { todayIso } from '@/domain/today';

/**
 * Data: export everything as a ZIP of CSVs (client-side fflate, the plan's
 * replacement for the Streamlit ZIP backup), and the delete surface.
 *
 * DELETES ARE THE ONE GENUINELY DESTRUCTIVE SURFACE IN THE APP. Typed
 * confirmation, per-table, RLS-scoped to the caller's own rows -- and the XP
 * ledger is deliberately NOT deletable: it is append-only by policy, and a
 * user cannot delete grants (that is the anti-cheat).
 */

const EXPORT_TABLES = [
  'workout_log',
  'cardio_log',
  'bodyweight_log',
  'bodyfat_log',
  'measurements',
  'physique_ratings',
  'achievements',
  'targets',
  'profile',
  'custom_workout_plan',
  'avatar_progression',
] as const;

const DELETABLE_TABLES = EXPORT_TABLES; // xp_events intentionally absent

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

export default function DataScreen() {
  return (
    <ScreenShell><ScreenHeader kicker="YOURS TO KEEP" title="DATA" />
        <ExportCard />
        <DeleteCard />
    </ScreenShell>
  );
}

function ExportCard() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const exportAll = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const files: Record<string, Uint8Array> = {};
      let total = 0;
      for (const table of EXPORT_TABLES) {
        const { data, error } = await supabase.from(table).select('*').limit(10000);
        if (error) continue; // a missing table skips, the export still lands
        files[`${table}.csv`] = strToU8(toCsv((data ?? []) as Record<string, unknown>[]));
        total += data?.length ?? 0;
      }
      const zipped = zipSync(files);

      if (Platform.OS === 'web') {
        const blob = new Blob([zipped.slice().buffer as ArrayBuffer], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `evoforge-export-${todayIso()}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        setStatus(`Exported ${total} rows across ${Object.keys(files).length} tables.`);
      } else {
        setStatus('Native export lands with the store build — use the web app for now.');
      }
    } catch (e) {
      setStatus(`Export failed: ${String(e)}`);
    }
    setBusy(false);
  };

  return (
    <GlowCard>
      <Text
        className="mb-s2 text-text-mute"
        allowFontScaling={false}
        style={{ fontSize: 10, letterSpacing: 1.5, ...pixelFont(false) }}
      >
        EXPORT EVERYTHING
      </Text>
      <Text className="mb-s3 text-xs text-text-dim">
        One ZIP of CSVs — every table, your rows only. Your data is yours.
      </Text>
      <Pressable className="items-center rounded-md bg-accent p-s3" onPress={exportAll} disabled={busy}>
        {busy ? (
          <ActivityIndicator color="#04121a" />
        ) : (
          <Text className="text-accent-ink" allowFontScaling={false} style={{ fontSize: 14, ...pixelFont() }}>
            DOWNLOAD ZIP
          </Text>
        )}
      </Pressable>
      {status ? <Text className="mt-s2 text-2xs text-text-dim">{status}</Text> : null}
    </GlowCard>
  );
}

function DeleteCard() {
  const [table, setTable] = useState<string | null>(null);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const { session } = useAuth();

  const armed = table !== null && confirm === 'DELETE';

  const wipe = async () => {
    if (!armed || !table) return;
    setBusy(true);
    // RLS scopes this to the caller's own rows; .not.is('id','null') is the
    // match-everything filter that works on every table (root CLAUDE.md: a
    // neq-sentinel breaks on date/numeric first columns).
    const { error } = await supabase.from(table).delete().not('id', 'is', null);
    setBusy(false);
    setTable(null);
    setConfirm('');
    if (error) {
      useToastStore.getState().push({ kind: 'error', title: 'DELETE FAILED', subtitle: error.message });
      return;
    }
    queryClient.clear(); // every cache layer: the nuked table feeds many views
    useToastStore.getState().push({ kind: 'info', title: 'DELETED', subtitle: `${table} wiped` });
    void session; // cache clear covers per-user keys
  };

  return (
    <View className="rounded-lg border border-danger/40 bg-surface p-s4">
      <Text
        className="mb-s2 text-danger"
        allowFontScaling={false}
        style={{ fontSize: 12, letterSpacing: 1, ...pixelFont() }}
      >
        DANGER ZONE
      </Text>
      <Text className="mb-s3 text-xs text-text-dim">
        Wipe one table&apos;s rows (yours only — isolation is enforced by the database). The XP
        ledger is append-only and cannot be deleted; that is the anti-cheat, not an oversight.
      </Text>
      <View className="mb-s3 flex-row flex-wrap gap-s1">
        {DELETABLE_TABLES.map((t) => (
          <Pressable
            key={t}
            onPress={() => setTable(table === t ? null : t)}
            className={`rounded-pill border px-s2 py-s1 ${
              table === t ? 'border-danger bg-surface-3' : 'border-border bg-surface-2'
            }`}
          >
            <Text className={`text-2xs ${table === t ? 'font-bold text-danger' : 'text-text-mute'}`}>{t}</Text>
          </Pressable>
        ))}
      </View>
      {table ? (
        <View className="flex-row items-center gap-s2">
          <TextInput
            className="flex-1 rounded-md border border-border bg-surface-2 p-s2 text-text"
            placeholder='Type "DELETE" to arm'
            placeholderTextColor="#64758f"
            value={confirm}
            onChangeText={setConfirm}
            autoCapitalize="characters"
          />
          <Pressable
            className={`rounded-md px-s4 py-s2 ${armed ? 'bg-danger' : 'bg-surface-2'}`}
            onPress={wipe}
            disabled={!armed || busy}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#04121a" />
            ) : (
              <Text
                className={armed ? 'text-accent-ink' : 'text-text-mute'}
                allowFontScaling={false}
                style={{ fontSize: 12, ...pixelFont() }}
              >
                WIPE {table}
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
