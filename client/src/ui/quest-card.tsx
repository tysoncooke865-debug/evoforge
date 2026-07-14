import { Link, router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import type { NextSession, WeeklyContract } from '@/domain/scheduled-streak';
import tokens from '@/theme/tokens';

import { NeonButton } from './neon-button';
import { GlowCard } from './shell';

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

/**
 * TRANSFORM P5 — Today's Quest leads Home: the start of the loop lives on
 * the first screen, not one tab away. Four honest states from the persisted
 * schedule + real log rows: no schedule (forge one), rest day (recovery is
 * the plan), pending (START MISSION → Train), completed (badge). The weekly
 * contract row shows this Monday-start week as seven pips — completed,
 * missed, pending today, rest, future — and done/target counts only
 * scheduled sessions (a rest-day session is a bonus pip, never quota).
 */
export function QuestCard({
  hasSchedule,
  contract,
  next,
  todayIso,
  finishedToday = false,
}: {
  hasSchedule: boolean;
  contract: WeeklyContract;
  next: NextSession | null;
  todayIso: string;
  /**
   * TRAIN_PAGE_V2: the athlete pressed FINISH. A workout finished EARLY has a
   * marker but not a full day of logged sets, so a quest derived from sets
   * alone still said "pending" — Home disagreeing with a decision the athlete
   * had already made, and had seen a ceremony for.
   */
  finishedToday?: boolean;
}) {
  const todayPip = contract.pips.find((p) => p.date === todayIso) ?? null;
  // Today's pip is only ever completed / pending / rest (missed and future
  // are other days by construction).
  const state: 'none' | 'rest' | 'pending' | 'completed' = !hasSchedule
    ? 'none'
    : todayPip === null
      ? 'none'
      : finishedToday || todayPip.state === 'completed'
        ? 'completed'
        : todayPip.state === 'pending'
          ? 'pending'
          : 'rest';

  const glow =
    state === 'completed' ? tokens.colors.success : state === 'pending' ? tokens.colors.accent : undefined;

  return (
    <GlowCard glow={glow}>
      {state === 'none' ? (
        <View>
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            TODAY&apos;S QUEST
          </Text>
          <Text className="mb-s2 mt-s1 text-base font-bold text-text">No weekly contract yet</Text>
          <Text className="mb-s3 text-xs text-text-dim">
            Pick your training days once — Home then hands you the day&apos;s mission.
          </Text>
          <Link href={'/schedule' as never} asChild>
            <Pressable accessibilityRole="button" testID="quest-forge" className="items-center" style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text className="text-2xs font-bold text-accent" style={{ letterSpacing: 1.5 }}>
                ⚒ FORGE MY WEEK →
              </Text>
            </Pressable>
          </Link>
        </View>
      ) : null}

      {state === 'rest' ? (
        <View>
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            TODAY&apos;S QUEST
          </Text>
          <Text className="mt-s1 text-lg font-bold text-text">REST DAY</Text>
          <Text className="mt-s1 text-xs text-text-dim">
            Recovery is part of the plan.
            {next ? ` Next mission: ${next.day} · ${whenLabel(next)}.` : ''}
          </Text>
        </View>
      ) : null}

      {state === 'pending' ? (
        <View>
          <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
            TODAY&apos;S QUEST
          </Text>
          <Text className="mb-s3 mt-s1 text-lg font-bold text-text">{todayPip?.assigned ?? 'Train'}</Text>
          <NeonButton title="START MISSION" onPress={() => router.push('/today' as never)} testID="quest-start" />
        </View>
      ) : null}

      {state === 'completed' ? (
        <View>
          <Text className="text-2xs font-bold" style={{ letterSpacing: 2, color: tokens.colors.success }}>
            ✓ MISSION COMPLETE
          </Text>
          <Text className="mt-s1 text-lg font-bold text-text">{todayPip?.assigned ?? 'Trained'}</Text>
          {next ? (
            <Text className="mt-s1 text-xs text-text-dim">
              Next mission: {next.day} · {whenLabel(next)}.
            </Text>
          ) : null}
        </View>
      ) : null}

      {hasSchedule ? (
        <View className="mt-s4">
          <View className="flex-row items-center justify-between">
            <Text className="text-2xs font-bold text-text-mute" style={{ letterSpacing: 2 }}>
              WEEKLY CONTRACT
            </Text>
            <Text className="text-2xs font-bold" style={{ color: contract.done >= contract.target && contract.target > 0 ? tokens.colors.success : tokens.colors.accent }}>
              {contract.done} / {contract.target}
            </Text>
          </View>
          <View className="mt-s2 flex-row justify-between">
            {contract.pips.map((pip, i) => (
              <Pip key={pip.date} letter={DAY_LETTERS[i]} state={pip.state} />
            ))}
          </View>
        </View>
      ) : null}
    </GlowCard>
  );
}

function Pip({ letter, state }: { letter: string; state: string }) {
  const palette: Record<string, { bg: string; border: string; text: string }> = {
    completed: { bg: `${tokens.colors.success}26`, border: tokens.colors.success, text: tokens.colors.success },
    missed: { bg: 'transparent', border: `${tokens.colors.danger}66`, text: `${tokens.colors.danger}99` },
    pending: { bg: `${tokens.colors.accent}1f`, border: tokens.colors.accent, text: tokens.colors.accent },
    rest: { bg: 'transparent', border: tokens.colors.border, text: tokens.colors['text-mute'] },
    future: { bg: 'transparent', border: tokens.colors.border, text: tokens.colors['text-dim'] },
  };
  const c = palette[state] ?? palette.future;
  return (
    <View
      className="items-center justify-center rounded-pill"
      style={{ width: 34, height: 34, borderWidth: 1, borderColor: c.border, backgroundColor: c.bg }}
    >
      <Text className="text-2xs font-bold" style={{ color: c.text }}>
        {state === 'completed' ? '✓' : letter}
      </Text>
    </View>
  );
}

function whenLabel(next: NextSession): string {
  if (next.inDays === 1) return 'tomorrow';
  return `${WEEKDAYS[new Date(`${next.date}T00:00:00Z`).getUTCDay()].toLowerCase()} (in ${next.inDays} days)`;
}
