/**
 * PAGE LAB — HOME variant ARCADE (the experimental wild card).
 * The game start-screen: opening the app feels like powering on a cabinet.
 * EVOFORGE as a marquee title over an LV chip + thin EXP bar, the champion
 * in a framed character-select card whose nameplate carries tier/form and
 * whose top rail is an EVO score readout, today's workout as TODAY'S QUEST
 * behind one dominant START, and the week as a 7-segment power gauge with
 * the streak in legendary gold. Exactly TWO ambient loops (START's sweep,
 * the today-segment pulse); a reduced-motion screen is complete and still.
 * Below the fold is baseline's set verbatim.
 * Built on shared/use-home-model 2026-08-18.
 */
import { Text, View } from 'react-native';

import { useServerGrantedXp } from '@/data/hooks';
import { EvolutionTeaser } from '@/ui/character/evolution-teaser';
import { BelowFold } from '@/ui/home/below-fold';
import { PathSummary } from '@/ui/origin-path/path-summary';
import { RecentPrCard } from '@/ui/home/recent-pr-card';
import { TrainingOverview } from '@/ui/home/training-overview';
import { EdgeLabel } from '@/ui/core/hud';
import { LeaderboardTeaser } from '@/ui/arena/leaderboard-teaser';
import { ScreenShell } from '@/ui/core/shell';
import { PhysiqueBaselineCard } from '@/ui/progression/physique-baseline-card';
import { ReforgeDayCard } from '@/ui/progression/reforge-day-card';
import { EvoRadar } from '@/ui/home/evo-radar';

import { CharacterCard } from './arcade/character-card';
import { ArcadeMasthead } from './arcade/masthead';
import { PowerGauge } from './arcade/power-gauge';
import { QuestBanner } from './arcade/quest-banner';
import { useHomeModel } from './shared/use-home-model';

/** Drift is only alarming when it ISN'T explained by server-granted XP
 *  (battles, adjustments) — those are legitimate ledger-over-derived
 *  surplus. SUBTRACT the explained part (migration 014's rule, exactly as
 *  rank.tsx applies it): the old equality check meant ANY residue made the
 *  whole battle amount read as drift ("ledger drift 840" for 750 of honest
 *  battle XP plus 90 of residue). While the breakdown is still loading,
 *  say nothing — a warning that flashes and retracts teaches athletes to
 *  ignore it. */
function DriftWarning({ drift, source }: { drift: number; source: string }) {
  const serverGranted = useServerGrantedXp();
  if (drift === 0) return null;
  if (serverGranted.isPending) return null;
  const unexplained =
    serverGranted.data === null || serverGranted.data === undefined
      ? drift // breakdown unavailable: fall back to the strict rule
      : drift - serverGranted.data;
  if (unexplained === 0) return null;
  return (
    <Text className="text-2xs text-warn">
      ledger drift {unexplained} · source: {source}
    </Text>
  );
}

export function HomeArcade() {
  const model = useHomeModel();
  const { mission, identity, week, belowFold } = model;

  const questBanner = <QuestBanner quest={mission} />;

  return (
    <ScreenShell>
      {/* 1. THE TITLE MASTHEAD — the cabinet's marquee + the run status. */}
      <ArcadeMasthead
        level={model.forgeProgress.level}
        xpIntoLevel={model.forgeProgress.xpIntoLevel}
        xpNeeded={model.forgeProgress.xpForNextLevel}
      />

      {/* ONBOARDING V3 (spec §8): an athlete who has NEVER TRAINED gets the
          quest first — there is no identity to lead with yet. The moment a
          first workout is logged the character-select order returns. */}
      {model.neverTrained ? questBanner : null}

      {/* 2. THE CHARACTER-SELECT STAGE — one card, one Pressable, the
          champion's aura as the edge light and the EVO score on the rail.
          Origin unset → the card IS the origin invitation. */}
      <CharacterCard identity={identity} />

      {/* 3. TODAY'S QUEST — the page's one dominant CTA. */}
      {model.neverTrained ? null : questBanner}

      {/* 4. THE ENERGY METER — seven segments, the streak in gold. */}
      <PowerGauge
        pips={week.pips}
        todayIso={week.todayIso}
        streak={week.streak}
        streakLabel={week.streakLabel}
      />

      {/* REFORGE DAY — self-hides unless a 28-day cycle has elapsed. */}
      <ReforgeDayCard testID="home-reforge-day" />

      {/* TERTIARY — the optional private baseline; self-hides until a
          workout has been completed (spec §6, §8). */}
      <PhysiqueBaselineCard testID="home-physique-baseline" />

      {/* ---- THE FOLD. Baseline's set verbatim: everything below still
          reads live state and opens the same doors — it just no longer
          competes for the first screen. Mounted after the first paint. ---- */}
      <BelowFold>
        {/* THE EVOLUTION PATH (beta flag) — self-hides when the flag is off
            or no path exists. */}
        <PathSummary />

        {/* This week, by the numbers (the segments live above now). */}
        <TrainingOverview
          contract={week.contract}
          weekSets={week.totals.sets}
          weekCardioMinutes={week.totals.cardioMinutes}
          weekXp={week.totals.xp}
          hasSchedule={week.hasSchedule}
        />

        {/* Recent PR + next evolution. Always stacked: EvolutionTeaser's
            silhouette + readiness columns need the full width — at half width
            "Advanced Form" wraps mid-word, exactly the fragment the brief bans. */}
        <RecentPrCard pr={belowFold.pr} unit={belowFold.prUnit} />
        <EvolutionTeaser branch={belowFold.stats.branch} evolution={belowFold.evolution} />

        {/* Character build — the radar. Sourced from the Evo Rating's four
            pillars so the wheel LINES UP with the rating above (Tyson
            2026-07-19), with a dashed projection of where they head after a
            block of consistent training. Falls back to the legacy live stats
            before the first Evo review. */}
        <View>
          <EdgeLabel>{`${belowFold.stats.characterClass.toUpperCase()} · ${belowFold.stats.buildType.toUpperCase()}`}</EdgeLabel>
          <View className="mt-s3">
            <EvoRadar
              fallbackStats={[
                { label: 'STR', value: belowFold.stats.strengthScore },
                { label: 'SIZE', value: belowFold.stats.sizeScore },
                { label: 'LEAN', value: belowFold.stats.leannessScore },
                { label: 'COND', value: belowFold.stats.conditioningScore },
                { label: 'AES', value: belowFold.stats.aestheticScore },
              ]}
            />
          </View>
        </View>

        {/* P2 C5: collapsed-by-default leaderboard teaser, cyan-framed. */}
        <LeaderboardTeaser />

        <DriftWarning drift={belowFold.summary.xpDrift} source={belowFold.summary.xpSource} />
      </BelowFold>
    </ScreenShell>
  );
}
