/**
 * Tutorial route (M6) — a guided battle against the training AI with an
 * overlay step sequencer (deploy → technique → ability → ultimate → win
 * condition). Steps advance on the matching player action; skippable at any
 * time. Uses the same shared arena screen as /battle.
 */
import React from 'react';
import { ErrorBoundary } from '../components/error-boundary';
import { ArenaScreen } from '../features/arena/components/arena-screen';

export default function TutorialScreen() {
  return (
    <ErrorBoundary label="tutorial">
      <ArenaScreen tutorial />
    </ErrorBoundary>
  );
}
