/**
 * Arena profile (P11): identity + Arena-local standing from the save, and
 * the athlete's REAL EvoForge fitness profile read through the provider
 * boundary (the same data every battle's champion scaling uses). Fails soft:
 * a broken fitness read shows the neutral-scaling note instead of numbers —
 * it never blocks the screen (and battles fall back the same way).
 */
import React, { useEffect, useState } from 'react';
import { ErrorBoundary } from '../components/error-boundary';
import { Body, Heading, Mono, Panel, Screen } from '../components/ui';
import { getChampionById, pathDisplayName } from '../content';
import type { FitnessProfile } from '../integration/evoforge/types';
import { playerProvider } from '../services/app-services';
import { usePlayer } from '../services/player-data/use-player';

export default function ProfileScreen() {
  return (
    <ErrorBoundary label="profile">
      <ProfileScreenInner />
    </ErrorBoundary>
  );
}

type FitnessState =
  | { phase: 'loading' }
  | { phase: 'unavailable' }
  | { phase: 'ready'; fitness: FitnessProfile };

function ProfileScreenInner() {
  const save = usePlayer((s) => s.save);
  const champion = getChampionById(save.player.championId);
  const [state, setState] = useState<FitnessState>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const player = await playerProvider.getCurrentPlayer();
        const fitness = await playerProvider.getFitnessProfile(player.playerId);
        if (!cancelled) setState({ phase: 'ready', fitness });
      } catch {
        if (!cancelled) setState({ phase: 'unavailable' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Screen>
      <Panel>
        <Heading>{save.player.displayName}</Heading>
        <Body dim>Champion: {champion?.name ?? 'none'}</Body>
        <Body dim>Arena Rating: {save.player.rankPoints}</Body>
        <Body dim>
          Record: {save.stats.wins}W / {save.stats.losses}L / {save.stats.draws}D (
          {save.stats.battlesPlayed} battles)
        </Body>
      </Panel>

      <Panel>
        <Heading>Evo Rating</Heading>
        {state.phase === 'loading' && <Body dim>Loading your fitness profile…</Body>}
        {state.phase === 'unavailable' && (
          <Body dim>Fitness profile unavailable — battles use neutral scaling.</Body>
        )}
        {state.phase === 'ready' && (
          <>
            <Body>Overall: {state.fitness.evoRating}</Body>
            <Body dim>
              Strength {state.fitness.strengthRating} · Cardio {state.fitness.cardioRating}
            </Body>
            <Body dim>
              Size {state.fitness.muscularityRating} · Leanness {state.fitness.leannessRating} ·
              Aesthetics {state.fitness.aestheticsRating}
            </Body>
            <Body dim>
              Forge Level {state.fitness.forgeLevel} · Path{' '}
              {pathDisplayName(state.fitness.avatarPath)} · Stage {state.fitness.avatarStage}
            </Body>
          </>
        )}
        <Mono>
          Live EvoForge ratings — they shape your Champion within the capped band, and nothing in
          the Arena changes them back.
        </Mono>
      </Panel>
    </Screen>
  );
}
