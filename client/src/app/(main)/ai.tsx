import { useState } from 'react';
import { Text } from 'react-native';

import { ScreenShell } from '@/ui/core/shell';
import { AiNotice } from '@/ui/legal/ai-badge';
import { BodyfatScanCard } from '@/ui/oracle/bodyfat-scan-card';
import { EvolutionImpactCard } from '@/ui/oracle/evolution-impact-card';
import { OracleHeader } from '@/ui/oracle/oracle-header';
import { OracleHistoryCard } from '@/ui/oracle/oracle-history-card';
import { PhysiqueScanCard } from '@/ui/oracle/physique-scan-card';
import { RoutineForgeCard } from '@/ui/oracle/routine-forge-card';

/**
 * THE ORACLE (ORACLE_REDESIGN 2026-07-18; raised to the mission-briefing
 * standard 2026-08-04) — the AI analyst, a composition over ui/oracle/*.
 *
 * 2026-08-04: YOUR CHAMPION EVOLUTION moved up to lead the page, right after
 * the header — Oracle's own "at a glance" hero, the role the Evo Rating
 * plays on Home and the mission card plays on Train/Cardio. It used to live
 * inside PhysiqueScanCard and only appear after a fresh scan THIS SESSION;
 * now it shows real state (or the honest "run your first review" prompt)
 * every time, whether or not the athlete scans anything today. Below it:
 * physique analysis, body-fat estimate, the goal-card routine forge, then
 * the stored-verdict history timeline. The header's champion PULSES while
 * any one of the three tools below is genuinely mid-request — `scanning` is
 * the OR of their own busy flags, lifted up so one page-level signal drives
 * it rather than three cards each reaching into the header.
 *
 * The contracts are UNCHANGED and REAL: photos live in component state only
 * and are dropped the moment a verdict saves; results are written server-side
 * with the caller's JWT; nothing here mints a rating or a reward the backend
 * does not grant. Each card owns its own flow; this file only orders them.
 */
export default function AiScreen() {
  const [physiqueBusy, setPhysiqueBusy] = useState(false);
  const [bodyfatBusy, setBodyfatBusy] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);

  return (
    <ScreenShell>
      <OracleHeader scanning={physiqueBusy || bodyfatBusy || planBusy} />
      <AiNotice text="The Oracle uses AI to estimate your physique and body fat. Results are a rough guide, not medical advice." />
      <EvolutionImpactCard />
      <PhysiqueScanCard onBusyChange={setPhysiqueBusy} />
      <BodyfatScanCard onBusyChange={setBodyfatBusy} />
      <RoutineForgeCard onBusyChange={setPlanBusy} />
      <OracleHistoryCard />
      <Text className="text-center text-2xs text-text-mute">
        Photos are analysed in memory and never stored. Scans are rate-limited hourly; identical
        photos return the cached verdict without a new analysis.
      </Text>
    </ScreenShell>
  );
}
