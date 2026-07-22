import React from 'react';
import { ErrorBoundary } from '../components/error-boundary';
import { Body, Heading, Mono, Panel, Screen } from '../components/ui';
import { getChampionById } from '../content';
import { usePlayer } from '../services/player-data/use-player';

export default function ProfileScreen() {
  return (
    <ErrorBoundary label="profile">
      <ProfileScreenInner />
    </ErrorBoundary>
  );
}

function ProfileScreenInner() {
  const save = usePlayer((s) => s.save);
  const champion = getChampionById(save.player.championId);
  const f = save.fitness;

  return (
    <Screen>
      <Panel>
        <Heading>{save.player.displayName}</Heading>
        <Body dim>Player ID: {save.player.playerId}</Body>
        <Body dim>Champion: {champion?.name ?? 'none'}</Body>
        <Body dim>Rank points: {save.player.rankPoints}</Body>
      </Panel>

      <Panel>
        <Heading>Evo Rating (mock)</Heading>
        <Body>Overall: {f.evoRating}</Body>
        <Body dim>Strength {f.strengthRating} · Cardio {f.cardioRating}</Body>
        <Body dim>
          Muscularity {f.muscularityRating} · Leanness {f.leannessRating} · Aesthetics{' '}
          {f.aestheticsRating}
        </Body>
        <Body dim>
          Forge Level {f.forgeLevel} · Path {f.avatarPath} · Stage {f.avatarStage}
        </Body>
        <Mono>
          Fitness data is simulated locally and read through the EvoForge provider boundary.
        </Mono>
      </Panel>
    </Screen>
  );
}
