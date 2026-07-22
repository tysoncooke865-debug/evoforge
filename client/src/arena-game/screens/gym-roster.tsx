/**
 * Gym roster (M9): every member with a fitness summary, champion-role badges
 * (computed from member fitness via the squad feature helpers) and most-used
 * / MVP chips from the war contribution stats. Data flows through the
 * provider boundary only.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Body, Heading, Mono, Panel, Screen } from '../components/ui';
import { colors, pathColor, radius, spacing, typography } from '../constants/theme';
import { computeMemberRoles, GYM_ROLE_LABELS } from '../features/gyms/squad';
import type { GymMemberInfo } from '../integration/evoforge/types';
import { playerProvider } from '../services/app-services';
import { gymMostUsedMemberId, gymMvpMemberId } from '../services/gyms/contribution';
import { usePlayer } from '../services/player-data/use-player';

export default function GymRosterScreen() {
  const save = usePlayer((s) => s.save);
  const [members, setMembers] = useState<GymMemberInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await playerProvider.getGymProfile(save.player.playerId);
        if (!profile) {
          if (!cancelled) setError('You are not a member of a gym yet.');
          return;
        }
        const roster = await playerProvider.getGymMembers(profile.gymId);
        if (!cancelled) setMembers(roster);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [save.player.playerId]);

  if (error) {
    return (
      <Screen>
        <Panel>
          <Heading>Roster unavailable</Heading>
          <Body dim>{error}</Body>
        </Panel>
      </Screen>
    );
  }

  if (!members) {
    return (
      <Screen>
        <Body dim>Loading roster…</Body>
      </Screen>
    );
  }

  const roles = computeMemberRoles(members);
  const mvpId = gymMvpMemberId(save.gym);
  const mostUsedId = gymMostUsedMemberId(save.gym);

  return (
    <Screen>
      {members.map((member) => {
        const f = member.fitness;
        const memberRoles = roles[member.playerId] ?? [];
        const stats = save.gym.championStats[member.playerId];
        const isSelf = member.playerId === save.player.playerId;
        return (
          <Panel key={member.playerId}>
            <View style={styles.headerRow}>
              <Heading>
                {member.displayName}
                {isSelf ? ' (you)' : ''}
              </Heading>
              <View style={[styles.pathChip, { borderColor: pathColor(f.avatarPath) }]}>
                <Text style={[styles.pathChipText, { color: pathColor(f.avatarPath) }]}>
                  {f.avatarPath.toUpperCase()}
                </Text>
              </View>
            </View>
            <Mono>
              Evo {f.evoRating} · STR {f.strengthRating} · CAR {f.cardioRating} · MUS{' '}
              {f.muscularityRating} · LEA {f.leannessRating} · AES {f.aestheticsRating} · Forge Lv{' '}
              {f.forgeLevel}
            </Mono>
            {(memberRoles.length > 0 ||
              member.playerId === mvpId ||
              member.playerId === mostUsedId) && (
              <View style={styles.badgeRow}>
                {memberRoles.map((role) => (
                  <View key={role} style={styles.roleBadge}>
                    <Text style={styles.roleBadgeText}>{GYM_ROLE_LABELS[role]}</Text>
                  </View>
                ))}
                {member.playerId === mvpId && (
                  <View style={[styles.roleBadge, styles.statBadge]}>
                    <Text style={[styles.roleBadgeText, styles.statBadgeText]}>WAR MVP</Text>
                  </View>
                )}
                {member.playerId === mostUsedId && (
                  <View style={[styles.roleBadge, styles.statBadge]}>
                    <Text style={[styles.roleBadgeText, styles.statBadgeText]}>MOST FIELDED</Text>
                  </View>
                )}
              </View>
            )}
            {stats && (
              <Body dim>
                Wars: {stats.appearances} fielded · {stats.wins} won · {stats.warContribution}{' '}
                contribution
              </Body>
            )}
          </Panel>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  pathChip: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  pathChipText: { ...typography.label, fontSize: 10 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  roleBadge: {
    borderWidth: 1,
    borderColor: colors.cyan,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  roleBadgeText: { ...typography.label, fontSize: 10, color: colors.cyan },
  statBadge: { borderColor: colors.warning },
  statBadgeText: { color: colors.warning },
});
