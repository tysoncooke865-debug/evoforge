/**
 * PAGE LAB — HOME variant COMMAND (bold restructure): the veteran's HUD.
 * The live Home optimizes the first impression — ~340pt of crest + champion
 * before the mission. COMMAND inverts it for the 200th-session athlete who
 * opens the app twice a day wanting three glances: today's mission (a
 * condensed strip with the one START/RESUME button, first), the week's
 * contract + streak, and the week by the numbers — all above the fold.
 * Identity compresses to one pressable rail (rating · tier · forge level ·
 * portrait → /avatar); no entrance choreography, no ambient loops — the
 * HUD is stationary by doctrine. Everything below the fold is the live
 * components, wired as baseline. Built on shared/use-home-model 2026-08-18.
 */
import { Text, View } from 'react-native';

import { useServerGrantedXp } from '@/data/hooks';
import { EvolutionTeaser } from '@/ui/character/evolution-teaser';
import { BelowFold } from '@/ui/home/below-fold';
import { WeekStrip } from '@/ui/home/week-strip';
import { PathSummary } from '@/ui/origin-path/path-summary';
import { RecentPrCard } from '@/ui/home/recent-pr-card';
import { TrainingOverview } from '@/ui/home/training-overview';
import { EdgeLabel } from '@/ui/core/hud';
import { LeaderboardTeaser } from '@/ui/arena/leaderboard-teaser';
import { ScreenShell } from '@/ui/core/shell';
import { PhysiqueBaselineCard } from '@/ui/progression/physique-baseline-card';
import { ReforgeDayCard } from '@/ui/progression/reforge-day-card';
import { EvoRadar } from '@/ui/home/evo-radar';

import { CommandIdentityRail } from './command/identity-rail';
import { CommandMissionStrip } from './command/mission-strip';
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

export function HomeCommand() {
  const m = useHomeModel();

  return (
    // No HomeAmbience backdrop: the shell's two static glows are the whole
    // light rig. A stationary HUD earns its stillness everywhere, including
    // behind itself.
    <ScreenShell>
      {/* ---- 1. THE HUD BAND — everything a daily athlete came for, above
          the fold. Mission first (the model's full state machine, condensed),
          which also makes the neverTrained reorder structural: the mission
          ALREADY leads for everyone, so the funnel's exception needs no
          branch here. ---- */}
      <CommandMissionStrip
        mission={m.mission.mission}
        title={m.mission.title}
        sub={m.mission.sub}
        minutes={m.mission.minutes}
        kcal={m.mission.kcal}
        next={m.mission.next}
        loading={m.mission.loading}
        error={m.mission.error}
        onRetry={m.mission.retry}
        onOpen={m.mission.open}
      />

      {/* REFORGE DAY — self-hides unless a 28-day cycle has elapsed. It is
          the only other thing on the page with a deadline, so it stays in
          the HUD band, directly under the mission. */}
      <ReforgeDayCard testID="home-reforge-day" />

      {/* The week's contract and the streak — the second and third glance. */}
      <WeekStrip
        pips={m.week.pips}
        todayIso={m.week.todayIso}
        streak={m.week.streak}
        streakLabel={m.week.streakLabel}
      />

      {/* The week BY THE NUMBERS — surfaced from below the fold. On the
          live page these four metrics render after first paint; the veteran
          this variant serves checks them daily, so they earn HUD rank.
          (They leave BelowFold below — one copy per page, as always.) */}
      <TrainingOverview
        contract={m.week.contract}
        weekSets={m.week.totals.sets}
        weekCardioMinutes={m.week.totals.cardioMinutes}
        weekXp={m.week.totals.xp}
        hasSchedule={m.week.hasSchedule}
      />

      {/* ---- 2. IDENTITY, COMPRESSED TO A RAIL — rating · tier · forge
          level + XP · portrait, one Pressable to /avatar. The masthead is
          retired with the crest: its level module lives inside the rail,
          and a veteran does not need the app's name to know where they are.
          When no Origin is bound the rail is the FORGE YOUR ORIGIN state
          instead (routed exactly as the live podium routes it). ---- */}
      <CommandIdentityRail identity={m.identity} forgeProgress={m.forgeProgress} />

      {/* TERTIARY — the optional private baseline. Self-hides until a
          workout has been COMPLETED; styled as an offer, never a task. */}
      <PhysiqueBaselineCard testID="home-physique-baseline" />

      {/* ---- 3. THE FOLD. Everything below still exists, still reads live
          state, and still opens the same doors — wired exactly as baseline,
          minus TrainingOverview (promoted to the HUD band above). ---- */}
      <BelowFold>
        {/* THE EVOLUTION PATH (beta flag) — self-hides when the flag is off
            or no path exists. */}
        <PathSummary />

        {/* Recent PR + next evolution. Always stacked: EvolutionTeaser's
            silhouette + readiness columns need the full width. */}
        <RecentPrCard pr={m.belowFold.pr} unit={m.belowFold.prUnit} />
        <EvolutionTeaser branch={m.belowFold.stats.branch} evolution={m.belowFold.evolution} />

        {/* Character build — the radar, sourced from the Evo Rating's four
            pillars so the wheel LINES UP with the rating in the rail. */}
        <View>
          <EdgeLabel>{`${m.belowFold.stats.characterClass.toUpperCase()} · ${m.belowFold.stats.buildType.toUpperCase()}`}</EdgeLabel>
          <View className="mt-s3">
            <EvoRadar
              fallbackStats={[
                { label: 'STR', value: m.belowFold.stats.strengthScore },
                { label: 'SIZE', value: m.belowFold.stats.sizeScore },
                { label: 'LEAN', value: m.belowFold.stats.leannessScore },
                { label: 'COND', value: m.belowFold.stats.conditioningScore },
                { label: 'AES', value: m.belowFold.stats.aestheticScore },
              ]}
            />
          </View>
        </View>

        {/* P2 C5: collapsed-by-default leaderboard teaser, cyan-framed. */}
        <LeaderboardTeaser />

        <DriftWarning drift={m.belowFold.summary.xpDrift} source={m.belowFold.summary.xpSource} />
      </BelowFold>
    </ScreenShell>
  );
}
