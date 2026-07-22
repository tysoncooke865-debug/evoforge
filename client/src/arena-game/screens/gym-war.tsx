/**
 * Gym War (M9): pick a rival gym, then fight your squad (captain + selected
 * borrowed members) against that gym's auto-squad — the shared ArenaScreen
 * runs the battle in mode 'gym-war'. Rival gym data flows through the
 * provider boundary.
 */
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ErrorBoundary } from '../components/error-boundary';
import { Body, Heading, Mono, NeonButton, Panel, Screen } from '../components/ui';
import { ArenaScreen } from '../features/arena/components/arena-screen';
import type { GymProfile } from '../integration/evoforge/types';
import { playerProvider } from '../services/app-services';
import { usePlayer } from '../services/player-data/use-player';

export default function GymWarScreen() {
  const router = useRouter();
  const save = usePlayer((s) => s.save);
  const [rivals, setRivals] = useState<GymProfile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warGymId, setWarGymId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void playerProvider
      .listRivalGyms()
      .then((gyms) => {
        if (!cancelled) setRivals(gyms);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (warGymId) {
    return (
      <ErrorBoundary label="gym-war">
        <ArenaScreen gymWarGymId={warGymId} />
      </ErrorBoundary>
    );
  }

  return (
    <Screen>
      <Panel>
        <Heading>Gym War</Heading>
        <Body dim>
          Your captain leads {save.gym.selectedSquad.length} borrowed champion
          {save.gym.selectedSquad.length === 1 ? '' : 's'} against a rival gym&apos;s best. The
          enemy fields its Overall Champion as captain with its Strength and Cardio Champions at
          its side.
        </Body>
        <Mono>
          War record: {save.gym.warsPlayed} played · {save.gym.warsWon} won
        </Mono>
      </Panel>

      {error && (
        <Panel>
          <Body dim>{error}</Body>
        </Panel>
      )}
      {!rivals && !error && <Body dim>Scouting rival gyms…</Body>}
      {rivals?.map((gym) => (
        <Panel key={gym.gymId}>
          <Heading>{gym.name}</Heading>
          <Body dim>{gym.memberIds.length} members</Body>
          <NeonButton label={`ATTACK ${gym.name.toUpperCase()}`} onPress={() => setWarGymId(gym.gymId)} />
        </Panel>
      ))}

      <NeonButton label="Edit War Squad" variant="secondary" onPress={() => router.push('/forge-arena/gym-squad')} />
      <NeonButton label="Back" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
