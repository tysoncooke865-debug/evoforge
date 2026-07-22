/**
 * Gym overview (M9): the player's gym, their champion-role titles, the war
 * record and entry points to roster / squad builder / Gym War. All gym data
 * arrives through the EvoForgePlayerProvider boundary — this screen never
 * imports gym data directly.
 */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Body, Heading, Mono, NeonButton, Panel, Screen } from '../components/ui';
import { roleLabelsFor, computeMemberRoles } from '../features/gyms/squad';
import type { GymMemberInfo, GymProfile } from '../integration/evoforge/types';
import { playerProvider } from '../services/app-services';
import { gymMostUsedMemberId, gymMvpMemberId } from '../services/gyms/contribution';
import { usePlayer } from '../services/player-data/use-player';

interface GymData {
  profile: GymProfile;
  members: GymMemberInfo[];
}

export default function GymScreen() {
  const router = useRouter();
  const save = usePlayer((s) => s.save);
  const [data, setData] = useState<GymData | null>(null);
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
        const members = await playerProvider.getGymMembers(profile.gymId);
        if (!cancelled) setData({ profile, members });
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
          <Heading>Gym unavailable</Heading>
          <Body dim>{error}</Body>
        </Panel>
      </Screen>
    );
  }

  if (!data) {
    return (
      <Screen>
        <Body dim>Loading gym…</Body>
      </Screen>
    );
  }

  const roles = computeMemberRoles(data.members);
  const myTitles = roleLabelsFor(save.player.playerId, roles);
  const gym = save.gym;
  const nameOf = (id: string | null) =>
    id === null ? null : (data.members.find((m) => m.playerId === id)?.displayName ?? id);
  const mvp = nameOf(gymMvpMemberId(gym));
  const mostUsed = nameOf(gymMostUsedMemberId(gym));

  return (
    <Screen>
      <Panel>
        <Heading>{data.profile.name}</Heading>
        <Body dim>{data.members.length} members</Body>
        <Body>
          Your titles: {myTitles.length > 0 ? myTitles.join(' · ') : 'none yet — keep training'}
        </Body>
      </Panel>

      <Panel>
        <Heading>Gym Wars</Heading>
        <Mono>
          Wars: {gym.warsPlayed} · Won: {gym.warsWon} · Squad: {gym.selectedSquad.length}/3 borrowed
        </Mono>
        {mvp && <Body dim>War MVP: {mvp}</Body>}
        {mostUsed && <Body dim>Most fielded: {mostUsed}</Body>}
      </Panel>

      <NeonButton label="START GYM WAR" onPress={() => router.push('/forge-arena/gym-war')} />
      <NeonButton label="War Squad" variant="secondary" onPress={() => router.push('/forge-arena/gym-squad')} />
      <NeonButton label="Roster" variant="secondary" onPress={() => router.push('/forge-arena/gym-roster')} />
    </Screen>
  );
}
