/**
 * PAGE LAB — HOME variant CLARITY (conservative refinement).
 * The live Home's structure, order and components exactly, with the fold's
 * legibility rebuilt: nothing renders below Jersey 10's 10px design grid,
 * sub-12px labels sit on text-dim (AA) instead of text-mute, the streak
 * flame is drawn pixel art instead of a system emoji, missed days read at
 * full contrast and are spoken to screen readers, the drift line speaks
 * athlete instead of debug, and the crest wears a one-line tap whisper.
 * Forked from baseline 2026-08-18; copies: forge-hint, mission-card,
 * training-overview, week-strip.
 */
import { Text, View } from 'react-native';

import { useServerGrantedXp } from '@/data/hooks';
import { pixelFont } from '@/theme/fonts';
import { EvolutionTeaser } from '@/ui/character/evolution-teaser';
import { AvatarHero } from '@/ui/home/avatar-hero';
import { BelowFold } from '@/ui/home/below-fold';
import { EvoHero } from '@/ui/home/evo-hero';
import { HomeAmbience } from '@/ui/home/home-ambience';
import { PathSummary } from '@/ui/origin-path/path-summary';
import { homeFeatures } from '@/ui/home/home-features';
import { HomeHeader } from '@/ui/home/home-header';
import { RecentPrCard } from '@/ui/home/recent-pr-card';
import { EdgeLabel } from '@/ui/core/hud';
import { LeaderboardTeaser } from '@/ui/arena/leaderboard-teaser';
import { ScreenShell } from '@/ui/core/shell';
import { PhysiqueBaselineCard } from '@/ui/progression/physique-baseline-card';
import { ReforgeDayCard } from '@/ui/progression/reforge-day-card';
import { EvoRadar } from '@/ui/home/evo-radar';

import { ForgeHint } from './clarity/forge-hint';
import { MissionCard } from './clarity/mission-card';
import { TrainingOverview } from './clarity/training-overview';
import { WeekStrip } from './clarity/week-strip';
import { useHomeModel } from './shared/use-home-model';

/** Drift is only alarming when it ISN'T explained by server-granted XP
 *  (battles, adjustments) — those are legitimate ledger-over-derived
 *  surplus. SUBTRACT the explained part (migration 014's rule, exactly as
 *  rank.tsx applies it). While the breakdown is still loading, say nothing —
 *  a warning that flashes and retracts teaches athletes to ignore it.
 *  CLARITY: the visible line speaks to the athlete, not the debugger —
 *  what they need to know is that a recheck is running and nothing they
 *  logged is at risk; the number and the source belong in rank.tsx. */
function DriftWarning({ drift }: { drift: number }) {
  const serverGranted = useServerGrantedXp();
  if (drift === 0) return null;
  if (serverGranted.isPending) return null;
  const unexplained =
    serverGranted.data === null || serverGranted.data === undefined
      ? drift // breakdown unavailable: fall back to the strict rule
      : drift - serverGranted.data;
  if (unexplained === 0) return null;
  return (
    <Text
      className="text-text-dim"
      allowFontScaling={false}
      style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
    >
      XP IS BEING RECHECKED — YOUR SETS ARE SAFE
    </Text>
  );
}

export function HomeClarity() {
  const m = useHomeModel();

  const missionCard = (
    <MissionCard
      mission={m.mission.mission}
      title={m.mission.title}
      sub={m.mission.sub}
      pills={m.mission.pills}
      minutes={m.mission.minutes}
      kcal={m.mission.kcal}
      next={m.mission.next}
      loading={m.mission.loading}
      error={m.mission.error}
      onRetry={m.mission.retry}
      onOpen={m.mission.open}
      features={homeFeatures}
      evoPerSession={m.mission.evoPerSession}
    />
  );

  return (
    <ScreenShell backdrop={<HomeAmbience />}>
      {/* 1. Identity + the level module — FORGE LEVEL. */}
      <HomeHeader
        level={m.forgeProgress.level}
        xpIntoLevel={m.forgeProgress.xpIntoLevel}
        xpNeeded={m.forgeProgress.xpForNextLevel}
      />

      {/* ONBOARDING V3 (spec §8): for an athlete who has NEVER TRAINED the
          mission leads and identity follows — scoped to exactly the athletes
          the funnel says we lose. */}
      {m.neverTrained ? missionCard : null}

      {/* 2. THE IDENTITY BLOCK — the Evo Rating and the champion are ONE
          thing on the page, one slot in the shell's gap stack. */}
      <View className="w-full items-center">
        {m.identity.originUnset ? null : <ForgeHint />}
        {/* zIndex: the champion's rig is taller than its own box and reaches
            up under whatever sits above it — the rating's doors must win. */}
        <View className="mt-s1 w-full items-center" style={{ zIndex: 1 }}>
          <EvoHero suppressEmptyState={m.identity.originUnset} />
        </View>
        {/* The crest is the page's loudest element and it is a BUTTON — this
            whisper is the one visible clue. Informational text, not a second
            pressable: the crest above it is the tap it describes. Hidden
            until an Origin exists, because until then there is no breakdown
            behind the crest to promise. */}
        {m.identity.originUnset ? null : (
          <Text
            className="mt-s1 text-text-dim"
            numberOfLines={1}
            allowFontScaling={false}
            style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
            testID="clarity-crest-whisper"
          >
            TAP THE CREST FOR YOUR FULL BREAKDOWN
          </Text>
        )}
        {/* 10pt, not 0: at HOME_ART_SCALE the champion's head reaches ABOVE
            the rig's own top edge and without this it crowds the pill. */}
        <View className="w-full" style={{ marginTop: 6 }}>
          <AvatarHero
            originUnset={m.identity.originUnset}
            originChoiceReady={m.identity.originChoiceReady}
            branch={m.identity.donor}
            stage={m.identity.stage}
            auraColour={m.identity.auraColour}
            source={m.identity.paintedSource}
            animatedSource={m.identity.animatedSource}
            stillSource={m.identity.stillSource}
            silhouette={!m.identity.hasArt}
            tierName={m.identity.tierName}
            formName={m.identity.formName}
            features={homeFeatures}
          />
        </View>
      </View>

      {/* 3. TODAY'S MISSION — the one dominant CTA on the page. */}
      {m.neverTrained ? null : missionCard}

      {/* REFORGE DAY — self-hides unless a 28-day cycle has elapsed. */}
      <ReforgeDayCard testID="home-reforge-day" />

      {/* 4. THIS WEEK — seven days and a streak, nothing else. */}
      <WeekStrip
        pips={m.week.pips}
        todayIso={m.week.todayIso}
        streak={m.week.streak}
        streakLabel={m.week.streakLabel}
      />

      {/* 5. TERTIARY — the optional private baseline. Self-hides until a
          workout has been COMPLETED. */}
      <PhysiqueBaselineCard testID="home-physique-baseline" />

      {/* ---- THE FOLD. Everything below still exists, still reads live
          state, and still opens the same doors. Mounted after first paint. */}
      <BelowFold>
        {/* THE EVOLUTION PATH (beta flag) — self-hides when the flag is off
            or no path exists. */}
        <PathSummary />

        {/* This week, by the numbers (the pips live above now). */}
        <TrainingOverview
          contract={m.week.contract}
          weekSets={m.week.totals.sets}
          weekCardioMinutes={m.week.totals.cardioMinutes}
          weekXp={m.week.totals.xp}
          hasSchedule={m.week.hasSchedule}
        />

        {/* Recent PR + next evolution. Always stacked: EvolutionTeaser's
            columns need the full width. */}
        <RecentPrCard pr={m.belowFold.pr} unit={m.belowFold.prUnit} />
        <EvolutionTeaser branch={m.belowFold.stats.branch} evolution={m.belowFold.evolution} />

        {/* Character build — the radar, sourced from the Evo Rating's four
            pillars so the wheel LINES UP with the rating above. */}
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

        <DriftWarning drift={m.belowFold.summary.xpDrift} />
      </BelowFold>
    </ScreenShell>
  );
}
