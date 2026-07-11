import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { useAvatarData } from '@/data/use-avatar-data';
import { nextEvolutionInfo } from '@/domain/next-evolution';
import { avatarStageRows } from '@/domain/xp-leveling';
import { AvatarCard } from '@/ui/avatar-card';
import { avatarImage } from '@/ui/avatar-images';
import tokens from '@/theme/tokens';
import { ScreenShell } from '@/ui/shell';

/**
 * The Avatar page: current form, the branch's stage ladder, and what the next
 * evolution demands. Locked stages render as tinted silhouettes (tintColor
 * over the same PNG) -- standing in for the build-time Pillow-generated
 * *_locked.png set until tools/gen_locked_avatars.py exists.
 */
export default function AvatarScreen() {
  const { summary, stats, bfMid } = useAvatarData();

  const rows = avatarStageRows(stats.branch, summary.level);
  const evo = nextEvolutionInfo(stats.branch, {
    level: summary.level,
    benchE1rm: stats.benchE1rm,
    bfMid,
    totalSets: summary.totalSets,
    cardioMinutes: summary.cardioMinutes,
  });

  return (
    <ScreenShell><AvatarCard branch={stats.branch} level={summary.level} />

        <View className="rounded-lg border border-border bg-surface p-s6">
          <Text className="mb-s4 text-xs text-text-mute">EVOLUTION LINE</Text>
          {rows.map((row) => (
            <View
              key={row.level}
              className={`mb-s2 flex-row items-center rounded-md border p-s3 ${
                row.current
                  ? 'border-border-strong bg-surface-2'
                  : row.unlocked
                    ? 'border-border bg-surface-2'
                    : 'border-border-soft'
              }`}
            >
              <Image
                source={avatarImage(stats.branch, row.stage)}
                style={{
                  width: 44,
                  height: 44,
                  ...(row.unlocked ? {} : { tintColor: tokens.colors['surface-3'] }),
                }}
                contentFit="contain"
              />
              <View className="ml-s3 flex-1">
                <Text className={`font-bold ${row.unlocked ? 'text-text' : 'text-text-mute'}`}>
                  {row.unlocked ? row.name : '???'}
                </Text>
                <Text className="text-xs text-text-mute">Level {row.level}</Text>
              </View>
              {row.current ? (
                <Text className="text-xs font-bold text-accent">CURRENT</Text>
              ) : row.unlocked ? (
                <Text className="text-xs text-success">UNLOCKED</Text>
              ) : (
                <Text className="text-xs text-text-mute">LOCKED</Text>
              )}
            </View>
          ))}
        </View>

        <View className="rounded-lg border border-border bg-surface p-s6">
          <Text className="text-xs text-text-mute">NEXT EVOLUTION</Text>
          <Text className="mb-s4 text-lg font-bold text-text">
            {evo.targetName} <Text className="text-sm text-text-dim">· Level {evo.targetLevel}</Text>
          </Text>
          {evo.requirements.map((req) => (
            <View key={req.label} className="mb-s2 flex-row items-center justify-between">
              <Text className={req.met ? 'text-success' : 'text-text-dim'}>
                {req.met ? '✓' : '○'} {req.label}
              </Text>
              <Text className={`text-sm ${req.met ? 'text-success' : 'text-text-mute'}`}>
                {formatReq(req.label, req.current)} / {formatReq(req.label, req.target)}
              </Text>
            </View>
          ))}
        </View>
    </ScreenShell>
  );
}

function formatReq(label: string, value: number): string {
  if (label === 'Bench') return `${value.toFixed(0)}kg`;
  if (label === 'Body Fat') return `${value.toFixed(1)}%`;
  return String(Math.trunc(value));
}
