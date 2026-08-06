import { useState } from 'react';
import { Text } from 'react-native';

import { ScreenShell } from '@/ui/core/shell';
import { AiNotice } from '@/ui/legal/ai-badge';
import { BodyfatScanCard } from '@/ui/oracle/bodyfat-scan-card';
import { OracleHero } from '@/ui/oracle/oracle-hero';
import { OracleHistoryCard } from '@/ui/oracle/oracle-history-card';
import { PhysiqueScanCard } from '@/ui/oracle/physique-scan-card';
import { PhotoOptionalNotice } from '@/ui/oracle/photo-optional-notice';
import { usePhotoPrefs } from '@/data/photo-prefs';
import { RoutineForgeCard } from '@/ui/oracle/routine-forge-card';

/**
 * THE ORACLE (ORACLE_REDESIGN 2026-07-18; raised to the mission-briefing
 * standard 2026-08-04; CONSISTENCY PASS 2026-08-05) — the AI analyst, a
 * composition over ui/oracle/*.
 *
 * 2026-08-05: `OracleHeader` and `EvolutionImpactCard` — a masthead and a
 * "widget" stacked beneath it — merged into ONE dominant hero
 * (`oracle-hero.tsx`): the title, the champion, and the real Evo Rating
 * (counting up, with its rank rail and pillars) all live in the same card
 * now, the way Home answers "who am I" with one crest and Train answers
 * "what am I doing" with one mission card. Below it: physique analysis,
 * body-fat estimate, the goal-card routine forge, then the stored-verdict
 * history timeline. The hero's champion PULSES while any one of the three
 * tools below is genuinely mid-request — `scanning` is the OR of their own
 * busy flags, lifted up so one page-level signal drives it.
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
  // "Skip for now" is per-visit; "don't ask me again" is the durable one and
  // lives on the profile (data/photo-prefs.ts).
  const [photosSkipped, setPhotosSkipped] = useState(false);
  const photoPrefs = usePhotoPrefs();

  return (
    <ScreenShell>
      <OracleHero scanning={physiqueBusy || bodyfatBusy || planBusy} />
      <AiNotice text="The Oracle uses AI to estimate your physique and body fat. Results are a rough guide, not medical advice." />
      {/* THE OPTIONAL-PHOTO NOTICE COMES FIRST (2026-08-06). It used to be a
          2xs line at the FOOT of this screen, below both upload cards — which
          is to say, underneath the exact thing people refuse to do. */}
      <PhotoOptionalNotice
        skipped={photosSkipped}
        onSkip={() => setPhotosSkipped(true)}
        onUndo={() => setPhotosSkipped(false)}
        testID="oracle-photo-notice"
      />
      {photosSkipped || !photoPrefs.mayAsk ? null : (
        <>
          <PhysiqueScanCard onBusyChange={setPhysiqueBusy} />
          <BodyfatScanCard onBusyChange={setBodyfatBusy} />
        </>
      )}
      {/* The Oracle without a camera: this is the part that needs no photo. */}
      <RoutineForgeCard onBusyChange={setPlanBusy} />
      <OracleHistoryCard />
      <Text className="text-center text-2xs text-text-mute">
        Scans are rate-limited hourly; identical photos return the cached verdict without a new
        analysis.
      </Text>
    </ScreenShell>
  );
}
