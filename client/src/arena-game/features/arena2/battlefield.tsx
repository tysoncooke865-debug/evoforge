'use no memo'; // frame-driven from the live sim each render (Arena 1.0 doctrine, ARENA_2.0_REDESIGN.md §13)

/**
 * Arena 2.0 — landscape battlefield renderer (Redesign P1).
 *
 * Renders the SAME deterministic battle sim as Arena 1.0, rotated to landscape:
 * engine x∈[0,laneLength] maps to screen X (player core LEFT at x=0, opponent
 * core RIGHT at x=laneLength), two horizontal lanes stacked, a follow-camera on
 * the content container. It is a PURE function of live sim state (never mutates
 * it), so the battle plays digest-identical to portrait — this phase changes
 * only how the battle is drawn, not how it is simulated. FX/combat feel are
 * intentionally minimal here (health, hit flash, damage floaters); the full FX
 * layer is re-homed to landscape at P4.
 *
 * Champions/units render via the EXISTING 1.0 sprite system for now; the 128px
 * AutoSprite champions (P0 pipeline) are wired into battle at P5.
 */
import React, { useRef, useState } from 'react';
import { Image, type ImageStyle, Platform, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/theme';
import { BALANCE, getCardById, getChampionById } from '../../content';
import type { LiveBattle } from '../arena/battle-controller';
import { resolveChampionBattleAsset } from '../arena/components/battle-assets';
import {
  buildUnitLookup,
  deriveCombatSignals,
  latestMatchingHit,
} from '../arena/components/combat-fx';
import { healthBarColor } from '../arena/components/readability';
import { arenaFloorTexture, coreSprite, unitSprite } from '../arena/components/sprites';
import { actionCenterX, cameraTranslateX, easeCamera, pixelsPerUnit } from './camera';

const { laneLength } = BALANCE.arena;

const PIXELATED =
  Platform.OS === 'web' ? ({ imageRendering: 'pixelated' } as unknown as ImageStyle) : undefined;

const HIT_FLASH_TTL_MS = 150;
const FLOATER_TTL_MS = 700;
const CORE_W = 34;

interface FloaterLite {
  key: number;
  lane: 0 | 1;
  x: number;
  text: string;
  color: string;
  bornAtMs: number;
}
interface HitLite {
  lane: 0 | 1;
  x: number;
  team: 'player' | 'opponent';
  targetId: number | null;
  bornAtMs: number;
}
interface FxRef {
  logIndex: number;
  floaters: FloaterLite[];
  hits: HitLite[];
  nextKey: number;
  cameraX: number | null;
}

/** Incrementally pull damage/heal/death + hit signals from the battle log — a
 *  trimmed cousin of arena 1.0's collectCombatFx, self-contained so P1 has no
 *  dependency on the portrait screen's FX plumbing. */
function pump(fx: FxRef, live: LiveBattle, nowMs: number) {
  const units = buildUnitLookup(live.state.units);
  const { floaters, hits, nextIndex } = deriveCombatSignals(live.state.log, fx.logIndex, units);
  fx.logIndex = nextIndex;
  for (const s of floaters) {
    fx.floaters.push({ key: fx.nextKey++, lane: s.lane, x: s.x, text: s.text, color: s.color, bornAtMs: nowMs });
  }
  for (const h of hits) {
    fx.hits.push({ lane: h.lane, x: h.x, team: h.team, targetId: h.targetId, bornAtMs: nowMs });
  }
  fx.floaters = fx.floaters.filter((f) => nowMs - f.bornAtMs < FLOATER_TTL_MS).slice(-24);
  fx.hits = fx.hits.filter((h) => nowMs - h.bornAtMs < HIT_FLASH_TTL_MS).slice(-24);
}

export function Arena2Battlefield({ live, reduceMotion = false }: { live: LiveBattle; reduceMotion?: boolean }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const fxRef = useRef<FxRef>({ logIndex: 0, floaters: [], hits: [], nextKey: 1, cameraX: null });
  const fx = fxRef.current;
  const nowMs = Date.now();
  pump(fx, live, nowMs);

  const { state } = live;
  const ppu = pixelsPerUnit(size.w || 1, laneLength);
  const contentW = laneLength * ppu;
  const worldH = size.h;
  const laneH = worldH / 2;

  // Follow-camera: ease toward the action centre (or snap under reduced motion).
  const living = state.units.filter((u) => u.alive);
  const targetEngineX = actionCenterX(
    living.map((u) => ({ x: u.x, team: u.team, isChampion: u.kind === 'champion' && u.team === 'player' })),
    laneLength
  );
  const targetPx = cameraTranslateX(targetEngineX * ppu, size.w || 1, contentW);
  if (fx.cameraX === null) fx.cameraX = targetPx;
  else fx.cameraX = easeCamera(fx.cameraX, targetPx, reduceMotion ? 1 : 0.12);
  const cameraX = fx.cameraX;

  const xToPx = (x: number) => x * ppu;
  const laneTop = (lane: 0 | 1) => lane * laneH;

  return (
    <View style={styles.root} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {/* World (camera-scrolled): lanes + cores at the ends. */}
      {size.w > 0 && (
        <View style={[styles.world, { width: contentW, height: worldH, transform: [{ translateX: cameraX }] }]}>
          {[0, 1].map((laneRaw) => {
            const lane = laneRaw as 0 | 1;
            const groundY = laneTop(lane) + laneH - 20;
            return (
              <View key={lane} style={[styles.lane, { top: laneTop(lane), height: laneH, width: contentW }]}>
                <Image source={arenaFloorTexture()} style={[styles.floor, PIXELATED]} resizeMode="cover" fadeDuration={0} />
                <View style={[styles.ground, { top: groundY }]} />
              </View>
            );
          })}

          {/* Forge Cores at the lane ends (span both lanes). */}
          <CoreStructure team="player" xPx={0} worldH={worldH} state={state} />
          <CoreStructure team="opponent" xPx={contentW} worldH={worldH} state={state} />

          {/* Combatants (champions drawn last / on top). */}
          {[...living]
            .sort((a, b) => (a.kind === 'champion' ? 1 : 0) - (b.kind === 'champion' ? 1 : 0) || a.id - b.id)
            .map((u) => {
              const flash = latestMatchingHit(u.id, u.lane, u.x, u.team, fx.hits, 3);
              return (
                <Combatant
                  key={u.id}
                  unit={u}
                  leftPx={xToPx(u.x)}
                  groundY={laneTop(u.lane as 0 | 1) + laneH - 20}
                  flashBornAtMs={flash?.bornAtMs ?? null}
                  nowMs={nowMs}
                />
              );
            })}

          {/* Damage / heal / death floaters. */}
          {fx.floaters.map((f) => {
            const t = Math.min(1, (nowMs - f.bornAtMs) / FLOATER_TTL_MS);
            return (
              <Text
                key={f.key}
                style={[
                  styles.floater,
                  {
                    left: xToPx(f.x) - 20,
                    top: laneTop(f.lane) + laneH - 60 - t * 22,
                    color: f.color,
                    opacity: 1 - t,
                  },
                ]}
              >
                {f.text}
              </Text>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** One combatant: team-outlined sprite + health bar + a facing chevron
 *  (player advances RIGHT, opponent LEFT) + a white hit-flash overlay. */
function Combatant({
  unit,
  leftPx,
  groundY,
  flashBornAtMs,
  nowMs,
}: {
  unit: import('../../game-engine/simulation/state').UnitState;
  leftPx: number;
  groundY: number;
  flashBornAtMs: number | null;
  nowMs: number;
}) {
  const isChampion = unit.kind === 'champion';
  const spriteSize = isChampion ? 60 : 40;
  const tint = unit.team === 'player' ? colors.player : colors.opponent;
  const healthPct = Math.max(0, Math.min(1, unit.health / unit.baseMaxHealth));
  const flashAge = flashBornAtMs === null ? HIT_FLASH_TTL_MS : Math.max(0, nowMs - flashBornAtMs);
  const flashOpacity = flashAge < HIT_FLASH_TTL_MS ? (1 - flashAge / HIT_FLASH_TTL_MS) * 0.75 : 0;

  let sprite: ReturnType<typeof unitSprite> = null;
  if (isChampion) {
    const champion = getChampionById(unit.contentId);
    sprite = champion ? resolveChampionBattleAsset(champion.art, unit.team, null).still : null;
  } else {
    const card = getCardById(unit.contentId);
    sprite = card ? unitSprite(card.art, unit.team) : null;
  }
  // Opponents face left → mirror their sprite; player faces right (source).
  const mirror = unit.team === 'opponent';

  return (
    <View style={[styles.combatant, { left: leftPx - spriteSize / 2, top: groundY - spriteSize, width: spriteSize }]} pointerEvents="none">
      <View style={styles.healthTrack}>
        <View style={[styles.healthFill, { width: `${healthPct * 100}%`, backgroundColor: healthBarColor(healthPct, tint, colors.warning) }]} />
      </View>
      <View style={{ width: spriteSize, height: spriteSize }}>
        <View style={[styles.plate, { borderColor: tint, backgroundColor: `${tint}22` }]} />
        {sprite ? (
          <>
            <Image source={sprite} style={[{ width: spriteSize, height: spriteSize }, PIXELATED, mirror && styles.mirror]} fadeDuration={0} />
            {flashOpacity > 0 && (
              <Image
                source={sprite}
                style={[styles.flash, { width: spriteSize, height: spriteSize, opacity: flashOpacity }, PIXELATED, mirror && styles.mirror]}
                fadeDuration={0}
              />
            )}
          </>
        ) : (
          <View style={[styles.dot, { backgroundColor: tint }]} />
        )}
      </View>
      {/* facing chevron */}
      <View style={[styles.chevron, unit.team === 'player' ? { borderLeftColor: tint } : { borderRightColor: tint }]} />
    </View>
  );
}

function CoreStructure({
  team,
  xPx,
  worldH,
  state,
}: {
  team: 'player' | 'opponent';
  xPx: number;
  worldH: number;
  state: import('../../game-engine/simulation/state').BattleState;
}) {
  const core = state.cores[team];
  const pct = Math.max(0, Math.min(1, core.health / core.maxHealth));
  const damaged = pct <= 0.4;
  const tint = team === 'player' ? colors.player : colors.opponent;
  return (
    <View style={[styles.core, { left: xPx - CORE_W / 2, top: worldH / 2 - 44 }]} pointerEvents="none">
      <Image source={coreSprite(team, damaged)} style={[styles.coreImg, PIXELATED]} fadeDuration={0} />
      <View style={styles.coreTrack}>
        <View style={[styles.coreFill, { width: `${pct * 100}%`, backgroundColor: tint }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
  world: { position: 'absolute', left: 0, top: 0 },
  lane: { position: 'absolute', left: 0, overflow: 'hidden', borderColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  floor: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', opacity: 0.85 },
  ground: { position: 'absolute', left: 0, right: 0, height: 2, backgroundColor: 'rgba(34, 211, 238, 0.18)' },
  combatant: { position: 'absolute', alignItems: 'center' },
  healthTrack: { width: 24, height: 3, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 2, overflow: 'hidden', marginBottom: 2 },
  healthFill: { height: '100%' },
  plate: { position: 'absolute', bottom: 0, alignSelf: 'center', width: 22, height: 7, borderRadius: 4, borderWidth: 1.5 },
  mirror: { transform: [{ scaleX: -1 }] },
  flash: { position: 'absolute', top: 0, left: 0, tintColor: '#FFFFFF' },
  dot: { position: 'absolute', bottom: 4, alignSelf: 'center', width: 14, height: 14, borderRadius: 4 },
  chevron: {
    marginTop: 1,
    width: 0,
    height: 0,
    borderTopWidth: 3,
    borderBottomWidth: 3,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  floater: { position: 'absolute', width: 40, textAlign: 'center', fontSize: 12, fontWeight: '800' },
  core: { position: 'absolute', width: CORE_W, alignItems: 'center' },
  coreImg: { width: CORE_W, height: 64 },
  coreTrack: { width: CORE_W + 6, height: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 2, overflow: 'hidden', marginTop: 3 },
  coreFill: { height: '100%' },
});
