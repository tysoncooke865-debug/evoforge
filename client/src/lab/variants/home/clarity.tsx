/**
 * PAGE LAB — HOME variant CLARITY: the live Home's structure and order
 * EXACTLY, with its legibility rebuilt. Nothing renders under the 10px
 * pixel-grid floor (9px only where a plate can't fit 10), sub-12px labels
 * sit on text-dim (AA) not text-mute, the crest wears a persistent
 * BREAKDOWN cue, the cache's ghost door stops duplicating the mission's
 * label, FOCUS says what the warn fill means, and the drift line speaks
 * athlete instead of debug. Rebuilt on the current Home 2026-08-21;
 * copies: home-header, forge-hint, mission-card, forge-cache-card,
 * evo-hero, evo-standing-rail, week-strip, progress-hub, evo-pillars.
 */
import { Text, View } from 'react-native';

import { useServerGrantedXp } from '@/data/hooks';
import { pixelFont } from '@/theme/fonts';
import { EvolutionTeaser } from '@/ui/character/evolution-teaser';
import { AvatarHero } from '@/ui/home/avatar-hero';
import { BelowFold } from '@/ui/home/below-fold';
import { HomeAmbience } from '@/ui/home/home-ambience';
import { PathSummary } from '@/ui/origin-path/path-summary';
import { homeFeatures } from '@/ui/home/home-features';
import { RecentPrCard } from '@/ui/home/recent-pr-card';
import { EdgeLabel } from '@/ui/core/hud';
import { LeaderboardTeaser } from '@/ui/arena/leaderboard-teaser';
import { ScreenShell } from '@/ui/core/shell';
import { PhysiqueBaselineCard } from '@/ui/progression/physique-baseline-card';
import { ReforgeDayCard } from '@/ui/progression/reforge-day-card';
import { PoolInviteChip } from '@/ui/callouts/pool-invite';
import { RevealChip } from '@/ui/forge-reveal/reveal-chip';

import { EvoHero } from './clarity/evo-hero';
import { EvoPillars } from './clarity/evo-pillars';
import { ForgeCacheCard } from './clarity/forge-cache-card';
import { ForgeHint } from './clarity/forge-hint';
import { HomeHeader } from './clarity/home-header';
import { MissionCard } from './clarity/mission-card';
import { ProgressHub } from './clarity/progress-hub';
import { WeekStrip } from './clarity/week-strip';
import { useHomeModel } from './shared/use-home-model';

/** Drift is only alarming when it ISN'T explained by server-granted XP
 *  (battles, adjustments) — those are legitimate ledger-over-derived
 *  surplus. SUBTRACT the explained part (migration 014's rule, exactly as
 *  rank.tsx applies it). While the breakdown is still loading, say nothing —
 *  a warning that flashes and retracts teaches athletes to ignore it.
 *  CLARITY: the visible line speaks to the athlete, not the debugger — the
 *  number is theirs, the verification is ours, and their sets are safe. The
 *  source string belongs on rank.tsx. */
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
      testID="clarity-drift"
    >
      {unexplained} XP IS BEING VERIFIED — YOUR SETS ARE SAFE
    </Text>
  );
}

export function HomeClarity() {
  const m = useHomeModel();

  return (
    <ScreenShell backdrop={<HomeAmbience />}>
      {/* 1. Identity + the level module — FORGE LEVEL. */}
      <HomeHeader
        level={m.forgeProgress.level}
        xpIntoLevel={m.forgeProgress.xpIntoLevel}
        xpNeeded={m.forgeProgress.xpForNextLevel}
      />

      {/* TODAY'S MISSION — the visually dominant card, first under the
          masthead FOR EVERYONE (the live 2026-08-06 hierarchy; no
          never-trained reorder). The banked chips render nothing when there
          is nothing waiting — no teasers, no empty states. */}
      <PoolInviteChip />
      <RevealChip />
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
        onTrainAnyway={m.mission.trainAnyway}
        features={homeFeatures}
        evoPerSession={m.mission.evoPerSession}
      />
      {/* THE DAILY FORGE CACHE (§6), DIRECTLY UNDER the mission — which is
          where its own comment says it belongs: it says what today is worth
          once the mission has said what today IS. Its ghost door reads VIEW
          TRAIN PLAN, because TODAY'S MISSION is the card above. */}
      <ForgeCacheCard />

      {/* REFORGE DAY — self-hides unless a 28-day cycle has elapsed. */}
      <ReforgeDayCard testID="home-reforge-day" />

      {/* 2 + 3. THE IDENTITY BLOCK — the Evo Rating and the champion are ONE
          thing on the page, one slot in the shell's gap stack. The hint sits
          on top: it teaches the tap before the champion appears. */}
      <View className="w-full items-center">
        {m.identity.originUnset ? null : <ForgeHint />}
        {/* zIndex: the champion's rig is taller than its own box and reaches
            up under whatever sits above it — the rating's doors must win. */}
        <View className="mt-s1 w-full items-center" style={{ zIndex: 1 }}>
          <EvoHero suppressEmptyState={m.identity.originUnset} />
        </View>
        {/* 6pt, not 0: at HOME_ART_SCALE the champion's head reaches ABOVE
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

      {/* 4. THIS WEEK — ONE card: the seven days, the streak, the four
          numbers and the last session (the live 2026-08-07 merge). */}
      <WeekStrip
        pips={m.week.pips}
        todayIso={m.week.todayIso}
        streak={m.week.streak}
        streakLabel={m.week.streakLabel}
        totals={m.week.weekCard}
        lastSession={m.week.lastSessionLine}
      />

      {/* 5. TERTIARY — the optional private baseline. Self-hides until a
          workout has been COMPLETED. NEVER a gate. */}
      <PhysiqueBaselineCard testID="home-physique-baseline" />

      {/* ---- THE FOLD. Everything below still exists, still reads live
          state, and still opens the same doors. Mounted after first paint. */}
      <BelowFold>
        {/* THE EVOLUTION PATH (beta flag) — self-hides when the flag is off
            or no path exists. */}
        <PathSummary />

        {/* ONE PROGRESSION STORY: the PR, the form it advanced and where the
            pillars head next are the same sentence — a spine says so. */}
        <ProgressHub testID="progress-hub">
          <RecentPrCard pr={m.belowFold.pr} unit={m.belowFold.prUnit} />
          <EvolutionTeaser
            branch={m.belowFold.stats.branch}
            evolution={m.belowFold.evolution}
            currentName={m.identity.formName}
            currentSource={m.identity.stillSource}
          />

          {/* Where those pillars head next — the third beat of the story. */}
          <View>
            <EdgeLabel>{`${m.belowFold.stats.characterClass.toUpperCase()} · ${m.belowFold.stats.buildType.toUpperCase()}`}</EdgeLabel>
            <View className="mt-s3">
              <EvoPillars
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
        </ProgressHub>

        {/* P2 C5: collapsed-by-default leaderboard teaser, cyan-framed. */}
        <LeaderboardTeaser />

        <DriftWarning drift={m.belowFold.summary.xpDrift} />
      </BelowFold>
    </ScreenShell>
  );
}
