/**
 * The Arena route — a standard battle against the AI at the difficulty
 * persisted in save settings, or (M8) a ghost battle against a stored
 * recording when `?ghostId=<record key>` is present. The screen composition
 * lives in features/arena/components/arena-screen.tsx (shared with
 * /tutorial).
 */
import { useLocalSearchParams } from 'expo-router';
import React from 'react';
import { ErrorBoundary } from '../components/error-boundary';
import { ArenaScreen } from '../features/arena/components/arena-screen';

export default function BattleScreen() {
  const params = useLocalSearchParams<{ ghostId?: string }>();
  const ghostId = typeof params.ghostId === 'string' && params.ghostId.length > 0
    ? params.ghostId
    : undefined;
  return (
    <ErrorBoundary label="battle">
      <ArenaScreen ghostRecordId={ghostId} />
    </ErrorBoundary>
  );
}
