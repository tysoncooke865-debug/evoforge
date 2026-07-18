import { Text } from 'react-native';

import { ScreenShell } from '@/ui/core/shell';
import { BodyfatScanCard } from '@/ui/oracle/bodyfat-scan-card';
import { OracleHeader } from '@/ui/oracle/oracle-header';
import { OracleHistoryCard } from '@/ui/oracle/oracle-history-card';
import { PhysiqueScanCard } from '@/ui/oracle/physique-scan-card';
import { RoutineForgeCard } from '@/ui/oracle/routine-forge-card';

/**
 * THE ORACLE (ORACLE_REDESIGN, 2026-07-18) — the AI analyst, rebuilt as a
 * composition over ui/oracle/*. One connected experience: a hero header over
 * the scan backdrop, then the three real systems in order — physique analysis
 * (with the honest Evolution Impact beneath it), body-fat estimate, and the
 * goal-card routine forge — closed by the stored-verdict history timeline.
 *
 * The contracts are UNCHANGED and REAL: photos live in component state only
 * and are dropped the moment a verdict saves; results are written server-side
 * with the caller's JWT; nothing here mints a rating or a reward the backend
 * does not grant. Each card owns its own flow; this file only orders them.
 */
export default function AiScreen() {
  return (
    <ScreenShell>
      <OracleHeader />
      <PhysiqueScanCard />
      <BodyfatScanCard />
      <RoutineForgeCard />
      <OracleHistoryCard />
      <Text className="text-center text-2xs text-text-mute">
        Photos are analysed in memory and never stored. Scans are rate-limited hourly; identical
        photos return the cached verdict without a new analysis.
      </Text>
    </ScreenShell>
  );
}
