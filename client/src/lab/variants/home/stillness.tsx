/**
 * STILLNESS — the conservative refinement of Home (Page Lab design variant).
 *
 * Same sections, same order as the live page; the ambient motion halved to
 * exactly TWO movements — the champion's breathing (the character is alive)
 * and the week strip's today-pip beat (the day is now). Every other idle loop
 * is gone: the crest's entrance assembly, the celebrations and press feedback
 * all survive as one-shots, and then the page HOLDS. Throne room, not casino.
 * Forked from baseline 2026-08-18; copies: evo-hero, next-rank-card (the
 * sheen lives there), forge-hint, home-ambience.
 */
import { Text, View } from 'react-native';

import { useServerGrantedXp } from '@/data/hooks';
import { EvolutionTeaser } from '@/ui/character/evolution-teaser';
import { AvatarHero } from '@/ui/home/avatar-hero';
import { BelowFold } from '@/ui/home/below-fold';
import { WeekStrip } from '@/ui/home/week-strip';
import { PathSummary } from '@/ui/origin-path/path-summary';
import { homeFeatures } from '@/ui/home/home-features';
import { HomeHeader } from '@/ui/home/home-header';
import { MissionCard } from '@/ui/home/mission-card';
import { RecentPrCard } from '@/ui/home/recent-pr-card';
import { EdgeLabel } from '@/ui/core/hud';
import { LeaderboardTeaser } from '@/ui/arena/leaderboard-teaser';
import { ScreenShell } from '@/ui/core/shell';
import { PhysiqueBaselineCard } from '@/ui/progression/physique-baseline-card';
import { ReforgeDayCard } from '@/ui/progression/reforge-day-card';
import { EvoRadar } from '@/ui/home/evo-radar';

import { useHomeModel } from './shared/use-home-model';
import { EvoHero } from './stillness/evo-hero';
import { ForgeHint } from './stillness/forge-hint';
import { HomeAmbience } from './stillness/home-ambience';

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

export function HomeStillness() {
  const model = useHomeModel();
  const { mission, identity, week, belowFold } = model;

  const missionCard = (
    <MissionCard
      mission={mission.mission}
      title={mission.title}
      sub={mission.sub}
      pills={mission.pills}
      minutes={mission.minutes}
      kcal={mission.kcal}
      next={mission.next}
      loading={mission.loading}
      error={mission.error}
      onRetry={mission.retry}
      onOpen={mission.open}
      onTrainAnyway={mission.trainAnyway}
      features={homeFeatures}
      evoPerSession={mission.evoPerSession}
    />
  );

  return (
    // STILLNESS backdrop: the same fog tints as live, frozen at rest — the
    // page's weather system is retired so the champion's breath reads.
    <ScreenShell backdrop={<HomeAmbience />}>
      {/* 1. Identity + the level module — FORGE LEVEL (Tyson, 2026-07-16:
          the game level starts from zero and holds ONLY earned XP; the old
          onboarding-seeded level is retired from display, avatar stages
          keep their own track so no character regresses). */}
      <HomeHeader
        level={model.forgeProgress.level}
        xpIntoLevel={model.forgeProgress.xpIntoLevel}
        xpNeeded={model.forgeProgress.xpForNextLevel}
      />

      {/* ONBOARDING V3 (spec §8). For an athlete who has NEVER TRAINED the
          page's job is different: there is no identity to lead with yet — the
          rating is calibrating and the champion has one workout of history.
          So the mission leads, and identity follows.

          This does NOT reverse the 2026-08-03 order for everybody. The moment
          a first workout is logged, the established identity-first page
          returns and stays. The exception is scoped to exactly the athletes
          the funnel says we lose: 16 bound an Origin, 11 ever logged a set. */}
      {model.neverTrained ? missionCard : null}

      {/* 2. THE IDENTITY BLOCK — the Evo Rating and the champion are ONE
          thing on the page, so they are one slot in the shell's gap stack and
          set their own tighter internal rhythm. Separate slots spent 24pt of
          the fold on air between parts of the same sentence. */}
      <View className="w-full items-center">
        {/* The forge hint (STILLNESS copy: fully lit, perfectly still) —
            still on top, because it teaches interaction before the user
            sees the Champion. */}
        {identity.originUnset ? null : <ForgeHint />}
        {/* zIndex, for the same reason HomeHeader carries one: the champion's
            rig is taller than its own box and reaches up under whatever sits
            above it. AvatarStage's sprite is pointerEvents:none now, and this
            is the belt to that brace — the rating's doors must win. */}
        <View className="mt-s1 w-full items-center" style={{ zIndex: 1 }}>
          <EvoHero suppressEmptyState={identity.originUnset} />
        </View>
        {/* 10pt, not 0: at HOME_ART_SCALE the champion's head reaches ABOVE
            the rig's own top edge (the sprite frame overflows into the sky it
            reclaimed), and without this it crowds the descriptor pill. */}
        <View className="w-full" style={{ marginTop: 6 }}>
          {/* LIVE AvatarHero on purpose: the champion's breathing is one of
              the two ambient movements STILLNESS keeps. */}
          <AvatarHero
            originUnset={identity.originUnset}
            originChoiceReady={identity.originChoiceReady}
            branch={identity.donor}
            stage={identity.stage}
            auraColour={identity.auraColour}
            source={identity.paintedSource}
            animatedSource={identity.animatedSource}
            stillSource={identity.stillSource}
            silhouette={!identity.hasArt}
            tierName={identity.tierName}
            formName={identity.formName}
            features={homeFeatures}
          />
        </View>
      </View>

      {/* 3. TODAY'S MISSION — the one dominant CTA on the page, and the
          reason the page exists. It moves ABOVE the identity block for an
          athlete who has never trained (see missionCard's note). */}
      {model.neverTrained ? null : missionCard}

      {/* REFORGE DAY — self-hides unless a 28-day cycle has elapsed. When it
          IS due it sits directly under the mission, because it is the only
          other thing on the page with a deadline. */}
      <ReforgeDayCard testID="home-reforge-day" />

      {/* 4. THIS WEEK — seven days and a streak. LIVE WeekStrip on purpose:
          the today-pip beat is the other ambient movement STILLNESS keeps.
          The merged card (live 2026-08-07) carries the four numbers and the
          last session, so the old TrainingOverview card below is retired. */}
      <WeekStrip
        pips={week.pips}
        todayIso={week.todayIso}
        streak={week.streak}
        streakLabel={week.streakLabel}
        totals={week.weekCard}
        lastSession={week.lastSessionLine}
      />

      {/* 5. TERTIARY — the optional private baseline. Self-hides until a
          workout has been COMPLETED, hides for good once the athlete says
          don't ask again, and is deliberately styled as an offer rather than
          an outstanding task (spec §6, §8). */}
      <PhysiqueBaselineCard testID="home-physique-baseline" />

      {/* ---- THE FOLD. Everything below still exists, still reads live
          state, and still opens the same doors — it just no longer competes
          for the first screen. Mounted after the first paint. ---- */}
      <BelowFold>
        {/* THE EVOLUTION PATH (beta flag) — self-hides when the flag is off
            or no path exists. */}
        <PathSummary />

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
