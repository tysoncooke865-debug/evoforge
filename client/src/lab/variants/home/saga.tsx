/**
 * PAGE LAB — HOME variant SAGA (bold restructure): identity-maximal,
 * editorial. The live page's three stacked identity modules (forge hint, Evo
 * crest, champion podium — three overlapping tap zones) fuse into ONE
 * monument with ONE Pressable: champion large, aura, the rating engraved as
 * a plaque, forge level as the plinth. The mission leaves the scroll and
 * docks to the bottom edge, so the page's one action lives at the thumb on
 * every viewport; the card deck scrolls beneath, wired as baseline wires it.
 * Built on shared/use-home-model 2026-08-18.
 */
import { Text, View } from 'react-native';

import { useServerGrantedXp } from '@/data/hooks';
import { EvolutionTeaser } from '@/ui/character/evolution-teaser';
import { BelowFold } from '@/ui/home/below-fold';
import { PathSummary } from '@/ui/origin-path/path-summary';
import { RecentPrCard } from '@/ui/home/recent-pr-card';
import { WeekStrip } from '@/ui/home/week-strip';
import { EdgeLabel } from '@/ui/core/hud';
import { LeaderboardTeaser } from '@/ui/arena/leaderboard-teaser';
import { ScreenShell } from '@/ui/core/shell';
import { PhysiqueBaselineCard } from '@/ui/progression/physique-baseline-card';
import { ReforgeDayCard } from '@/ui/progression/reforge-day-card';
import { EvoRadar } from '@/ui/home/evo-radar';

import { MissionDock, DOCK_CONTENT_HEIGHT } from './saga/mission-dock';
import { SagaMonument } from './saga/monument';
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

export function HomeSaga() {
  const m = useHomeModel();

  /* neverTrained: live Home reorders itself for athletes who never logged a
     set — the mission card jumps ABOVE the identity block so the funnel's
     drop-outs meet the CTA first. SAGA needs no reorder: the docked bar
     already puts START at the thumb for EVERYONE, on-screen without a scroll,
     which is a stronger version of the same guarantee. The flag stays read
     (m.neverTrained) so a future pass can theme the monument for day zero. */

  return (
    <View style={{ flex: 1 }}>
      <ScreenShell>
        {/* 1. THE MONUMENT — the whole first viewport is identity: champion,
            aura, the Evo Rating plaque and the forge-level plinth, one tap
            zone opening /avatar. No HomeHeader above it: the plinth carries
            the level and XP, and a masthead would compete with the numeral. */}
        <SagaMonument
          identity={m.identity}
          level={m.forgeProgress.level}
          xpIntoLevel={m.forgeProgress.xpIntoLevel}
          xpNeeded={m.forgeProgress.xpForNextLevel}
        />

        {/* 2. THE CARD DECK, scrolling under the monument. The merged week
            card (live 2026-08-07) carries the four numbers and the last
            session, so no separate overview card follows below the fold. */}
        <WeekStrip
          pips={m.week.pips}
          todayIso={m.week.todayIso}
          streak={m.week.streak}
          streakLabel={m.week.streakLabel}
          totals={m.week.weekCard}
          lastSession={m.week.lastSessionLine}
        />

        {/* REFORGE DAY — self-hides unless a 28-day cycle has elapsed. */}
        <ReforgeDayCard testID="home-reforge-day" />

        {/* The optional private baseline — self-hides until a workout has
            been COMPLETED, styled as an offer, not a task. */}
        <PhysiqueBaselineCard testID="home-physique-baseline" />

        {/* ---- THE FOLD. Everything below still exists, still reads live
            state, and still opens the same doors — wired exactly as
            baseline.tsx wires it. Mounted after the first paint. ---- */}
        <BelowFold>
          {/* THE EVOLUTION PATH (beta flag) — self-hides when the flag is off
              or no path exists. */}
          <PathSummary />

          {/* Recent PR + next evolution. Always stacked: EvolutionTeaser's
              silhouette + readiness columns need the full width — at half
              width "Advanced Form" wraps mid-word, exactly the fragment the
              brief bans. */}
          <RecentPrCard pr={m.belowFold.pr} unit={m.belowFold.prUnit} />
          <EvolutionTeaser branch={m.belowFold.stats.branch} evolution={m.belowFold.evolution} />

          {/* Character build — the radar. Sourced from the Evo Rating's four
              pillars so the wheel LINES UP with the rating above, with a
              dashed projection of where they head after a block of
              consistent training. Falls back to the legacy live stats before
              the first Evo review. */}
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

        {/* Dock clearance: ScreenShell already bottom-pads past a tab bar
            that isn't there in the lab; this spacer buys the rest, so the
            last card's controls never hide beneath the fixed mission bar. */}
        <View style={{ height: DOCK_CONTENT_HEIGHT - 24 }} />
      </ScreenShell>

      {/* 3. THE DOCKED MISSION BAR — a SIBLING of ScreenShell on purpose:
          the shell scrolls its children, and the mission must not scroll. */}
      <MissionDock mission={m.mission} />
    </View>
  );
}
