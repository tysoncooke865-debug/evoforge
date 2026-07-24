'use no memo'; // frame-driven from the live sim each render (Arena 1.0 doctrine, ARENA_2.0_REDESIGN.md §13)

/**
 * Arena 2.0 — landscape battlefield renderer (Redesign P1, combat feel P4).
 *
 * Renders the SAME deterministic battle sim as Arena 1.0, rotated to landscape:
 * engine x∈[0,laneLength] maps to screen X (player core LEFT at x=0, opponent
 * core RIGHT at x=laneLength), two horizontal lanes stacked, a follow-camera on
 * the content container. A PURE function of live sim state (never mutates it),
 * so battles play digest-identically to portrait.
 *
 * P4 re-homes Arena 1.0's combat-feel layer to landscape and scales it for the
 * bigger champion, reusing the pure toolkit in impact.ts / combat-fx.ts:
 * impact-tiered damage floaters + crit sparks, hit flash + directional recoil,
 * procedural attack pose (anticipation → strike → recovery, remapped to the X
 * axis), ranged projectile streaks, ability/ultimate telegraphs, spawn poofs,
 * decaying screen shake, hit-stop / slow-mo via the store's time dilation, and
 * the ultimate ceremony flash. Every effect ages off the frame clock — no
 * Animated values, no per-unit React state. All motion is reduced-motion gated.
 */
import React, { useRef, useState } from 'react';
import { Image, type ImageStyle, Platform, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/theme';
import { BALANCE, getCardById, getChampionById } from '../../content';
import type { LiveBattle } from '../arena/battle-controller';
import { battleStore } from '../arena/battle-store';
import { resolveChampionBattleAsset } from '../arena/components/battle-assets';
import {
  buildUnitLookup,
  deriveCombatSignals,
  latestMatchingHit,
  type TelegraphTier,
} from '../arena/components/combat-fx';
import {
  attackPose,
  deriveProjectiles,
  detectFiredAttacks,
  type ImpactTier,
  PROJECTILE_TTL_MS,
  shakeOffset,
  spawnScale,
  STRIKE_MS,
  TIER_FX,
  tierForDamage,
} from '../arena/components/impact';
import { healthBarColor } from '../arena/components/readability';
import { arenaFloorTexture, coreSprite, unitSprite } from '../arena/components/sprites';
import { AtlasSprite } from './atlas-sprite';
import { actionCenterX, cameraTranslateX, easeCamera, pixelsPerUnit } from './camera';
import {
  championAnim,
  championAnimKeyFor,
  type ChampionAnim,
  type ClipName,
  clipSheet,
} from './champion-anim';
import { clipFinished, clipFrameIndex } from './champion-controller';

const { laneLength } = BALANCE.arena;

const PIXELATED =
  Platform.OS === 'web' ? ({ imageRendering: 'pixelated' } as unknown as ImageStyle) : undefined;

const HIT_FLASH_TTL_MS = 150;
const FLOATER_TTL_MS = 700;
const SPAWN_POOF_TTL_MS = 400;
const TELEGRAPH_TTL_MS: Record<TelegraphTier, number> = { ability: 450, ultimate: 700 };
const ULTIMATE_FLASH_MS = 600;
const ULTIMATE_SLOWMO_SCALE = 0.35;
const ULTIMATE_SLOWMO_MS = 260;
const CORE_W = 34;
/** Caps keep a swarm from unbounded FX growth (mirrors the 1.0 caps). */
const CAP = { floaters: 16, hits: 24, telegraphs: 6, spawns: 8, projectiles: 14 };
const SHAKE_RANK: Record<ImpactTier, number> = { light: 0, medium: 1, heavy: 2, ultimate: 3, core: 4 };

interface FloaterLite {
  key: number;
  lane: 0 | 1;
  x: number;
  text: string;
  color: string;
  bornAtMs: number;
  fontSize: number;
  weight: '700' | '800' | '900';
  crit: boolean;
}
interface HitLite {
  lane: 0 | 1;
  x: number;
  team: 'player' | 'opponent';
  targetId: number | null;
  amount: number;
  bornAtMs: number;
}
interface TelegraphLite {
  key: number;
  lane: 0 | 1;
  x: number;
  tier: TelegraphTier;
  label: string;
  color: string;
  bornAtMs: number;
}
interface SpawnLite { key: number; lane: 0 | 1; x: number; team: 'player' | 'opponent'; bornAtMs: number }
interface ProjectileLite {
  key: number;
  lane: 0 | 1;
  fromX: number;
  toX: number;
  team: 'player' | 'opponent';
  bornAtMs: number;
}

/** P5: a one-shot champion clip currently playing, with the priority that
 *  triggered it (a bigger beat interrupts a smaller one, never the reverse). */
interface ChampClip {
  clip: ClipName;
  startedAtMs: number;
  prio: number;
}
const CLIP_PRIO: Record<string, number> = { attack: 1, hit: 2, dash: 3, ultimate: 4 };

interface FxRef {
  logIndex: number;
  floaters: FloaterLite[];
  hits: HitLite[];
  telegraphs: TelegraphLite[];
  spawns: SpawnLite[];
  projectiles: ProjectileLite[];
  strikes: Map<number, number>;
  prevCooldowns: Map<number, number>;
  prevCoreHealth: { player: number; opponent: number } | null;
  shake: { bornAtMs: number; tier: ImpactTier } | null;
  ultFlash: { bornAtMs: number; color: string } | null;
  /** P5 champion animation: active one-shot clip per champion unit id. */
  champClip: Map<number, ChampClip>;
  prevAbilityCd: Map<number, number>;
  prevUltCharge: Map<number, number>;
  nextKey: number;
  cameraX: number | null;
}

const newFx = (): FxRef => ({
  logIndex: 0,
  floaters: [],
  hits: [],
  telegraphs: [],
  spawns: [],
  projectiles: [],
  strikes: new Map(),
  prevCooldowns: new Map(),
  prevCoreHealth: null,
  shake: null,
  ultFlash: null,
  champClip: new Map(),
  prevAbilityCd: new Map(),
  prevUltCharge: new Map(),
  nextKey: 1,
  cameraX: null,
});

/** Start a one-shot champion clip unless a higher-priority one is still playing. */
function triggerClip(fx: FxRef, id: number, clip: ClipName, nowMs: number, anim: ChampionAnim | null) {
  if (!anim) return;
  const prio = CLIP_PRIO[clip] ?? 0;
  const active = fx.champClip.get(id);
  if (active && active.prio > prio && !clipFinished(anim.clips[active.clip], active.startedAtMs, nowMs)) {
    return;
  }
  fx.champClip.set(id, { clip, startedAtMs: nowMs, prio });
}

/**
 * P5 — resolve which AutoSprite clip a champion should be showing from SIM
 * state: an active one-shot (ultimate > dash/ability > hit > attack) until it
 * finishes, then locomotion (run while advancing, idle while engaged). Loops
 * free-run off a stable epoch so they never restart mid-stride.
 */
function resolveChampionClip(
  fx: FxRef,
  anim: ChampionAnim,
  unitId: number,
  moving: boolean,
  nowMs: number
): { clip: ClipName; frame: number } {
  const active = fx.champClip.get(unitId);
  if (active) {
    const meta = anim.clips[active.clip];
    if (meta && !clipFinished(meta, active.startedAtMs, nowMs)) {
      return { clip: active.clip, frame: clipFrameIndex(meta, active.startedAtMs, nowMs) };
    }
    fx.champClip.delete(unitId);
  }
  const clip: ClipName = moving ? 'run' : 'idle';
  return { clip, frame: clipFrameIndex(anim.clips[clip], 0, nowMs) };
}

/**
 * Pull every combat signal since the last frame and escalate it: damage/heal/
 * death floaters (impact-tier sized), hit pings, telegraphs, spawn poofs and
 * ranged projectiles, plus the beyond-the-unit reactions — screen shake,
 * hit-stop / slow-mo (through the store's time dilation, which only DELAYS
 * ticks so replays are untouched) and the ultimate ceremony flash.
 */
function pump(fx: FxRef, live: LiveBattle, nowMs: number, reduceMotion: boolean) {
  const state = live.state;
  const requestShake = (tier: ImpactTier) => {
    if (reduceMotion) return;
    const active = fx.shake && nowMs - fx.shake.bornAtMs < TIER_FX[fx.shake.tier].shakeMs ? fx.shake : null;
    if (active && SHAKE_RANK[active.tier] > SHAKE_RANK[tier]) return; // strongest wins
    fx.shake = { bornAtMs: nowMs, tier };
  };

  const units = buildUnitLookup(state.units);
  const { floaters, hits, telegraphs, spawns, nextIndex } = deriveCombatSignals(state.log, fx.logIndex, units);
  fx.logIndex = nextIndex;

  for (const s of floaters) {
    const tier: ImpactTier = s.kind === 'hit' ? tierForDamage(s.amount) : 'light';
    const t = TIER_FX[tier];
    fx.floaters.push({
      key: fx.nextKey++,
      lane: s.lane,
      x: s.x,
      text: s.text,
      color: s.color,
      bornAtMs: nowMs,
      fontSize: t.floaterFontSize,
      weight: t.floaterWeight,
      crit: s.kind === 'hit' && tier === 'heavy',
    });
  }
  for (const h of hits) {
    fx.hits.push({ lane: h.lane, x: h.x, team: h.team, targetId: h.targetId, amount: h.amount, bornAtMs: nowMs });
    // P5: a struck champion plays its hit-react clip.
    if (h.targetId !== null) {
      const target = state.units.find((u) => u.id === h.targetId);
      if (target?.kind === 'champion') {
        triggerClip(fx, target.id, 'hit', nowMs, championAnim(championAnimKeyFor(target.contentId)));
      }
    }
    // Heavy hits reach past the struck unit: a camera bump + a blink of hit-stop.
    if (tierForDamage(h.amount) === 'heavy') {
      requestShake('heavy');
      battleStore.getState().applyTimeDilation(0, TIER_FX.heavy.hitStopMs);
    }
  }
  for (const t of telegraphs) {
    fx.telegraphs.push({ key: fx.nextKey++, lane: t.lane, x: t.x, tier: t.tier, label: t.label, color: t.color, bornAtMs: nowMs });
    if (t.tier === 'ultimate') {
      // The presentation beat: path-tinted screen flash + the strongest
      // pre-core shake + a short slow-motion emphasis.
      if (!reduceMotion) fx.ultFlash = { bornAtMs: nowMs, color: t.color };
      requestShake('ultimate');
      battleStore.getState().applyTimeDilation(ULTIMATE_SLOWMO_SCALE, ULTIMATE_SLOWMO_MS);
    }
  }
  for (const s of spawns) {
    fx.spawns.push({ key: fx.nextKey++, lane: s.lane, x: s.x, team: s.team, bornAtMs: nowMs });
  }

  // Core damage has no log entry (cores mutate in place) — diff the healths.
  const ph = state.cores.player.health;
  const oh = state.cores.opponent.health;
  const prev = fx.prevCoreHealth ?? { player: ph, opponent: oh };
  if (ph < prev.player || oh < prev.opponent) {
    requestShake('core');
    battleStore.getState().applyTimeDilation(0, TIER_FX.core.hitStopMs);
  }
  fx.prevCoreHealth = { player: ph, opponent: oh };

  // Fired attacks → strike lunges + ranged projectile streaks.
  const fired = detectFiredAttacks(state.units, fx.prevCooldowns);
  const byId = new Map(state.units.map((u) => [u.id, u]));
  for (const id of fired) {
    fx.strikes.set(id, nowMs);
    // P5: a champion that just struck plays its attack clip.
    const u = byId.get(id);
    if (u?.kind === 'champion') {
      triggerClip(fx, id, 'attack', nowMs, championAnim(championAnimKeyFor(u.contentId)));
    }
  }

  // P5: detect ability / ultimate casts straight from champion sim state —
  // the ability cooldown jumping back up means it fired; ultimate charge
  // dropping to zero means the ultimate fired. (No log parsing needed, and it
  // works for AI champions too.) Ability maps to the `dash` clip.
  for (const u of state.units) {
    const champ = u.champion;
    if (u.kind !== 'champion' || !champ) continue;
    const anim = championAnim(championAnimKeyFor(u.contentId));
    const prevCd = fx.prevAbilityCd.get(u.id);
    const prevUlt = fx.prevUltCharge.get(u.id);
    if (prevCd !== undefined && champ.abilityCooldownTicks > prevCd) {
      triggerClip(fx, u.id, 'dash', nowMs, anim);
    }
    if (prevUlt !== undefined && champ.ultimateCharge <= 0 && prevUlt > 0) {
      triggerClip(fx, u.id, 'ultimate', nowMs, anim);
    }
    fx.prevAbilityCd.set(u.id, champ.abilityCooldownTicks);
    fx.prevUltCharge.set(u.id, champ.ultimateCharge);
  }
  for (const [id, born] of fx.strikes) {
    if (nowMs - born >= STRIKE_MS || !byId.has(id)) fx.strikes.delete(id);
  }
  for (const shot of deriveProjectiles(fired, byId)) {
    fx.projectiles.push({ key: fx.nextKey++, lane: shot.lane, fromX: shot.fromX, toX: shot.toX, team: shot.team, bornAtMs: nowMs });
  }
  fx.prevCooldowns = new Map(state.units.filter((u) => u.alive).map((u) => [u.id, u.attackCooldownTicks]));

  // Prune by TTL, then cap.
  const keep = <T extends { bornAtMs: number }>(arr: T[], ttl: number, cap: number) =>
    arr.filter((e) => nowMs - e.bornAtMs < ttl).slice(-cap);
  fx.floaters = keep(fx.floaters, FLOATER_TTL_MS, CAP.floaters);
  fx.hits = keep(fx.hits, HIT_FLASH_TTL_MS, CAP.hits);
  fx.spawns = keep(fx.spawns, SPAWN_POOF_TTL_MS, CAP.spawns);
  fx.projectiles = keep(fx.projectiles, PROJECTILE_TTL_MS, CAP.projectiles);
  fx.telegraphs = fx.telegraphs
    .filter((t) => nowMs - t.bornAtMs < TELEGRAPH_TTL_MS[t.tier])
    .slice(-CAP.telegraphs);
}

export function Arena2Battlefield({ live, reduceMotion = false }: { live: LiveBattle; reduceMotion?: boolean }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const fxRef = useRef<FxRef>(newFx());
  const fx = fxRef.current;
  const nowMs = Date.now();
  pump(fx, live, nowMs, reduceMotion);

  const { state } = live;
  const ppu = pixelsPerUnit(size.w || 1, laneLength);
  const contentW = laneLength * ppu;
  const worldH = size.h;
  const laneH = worldH / 2;

  const living = state.units.filter((u) => u.alive);
  const targetEngineX = actionCenterX(
    living.map((u) => ({ x: u.x, team: u.team, isChampion: u.kind === 'champion' && u.team === 'player' })),
    laneLength
  );
  const targetPx = cameraTranslateX(targetEngineX * ppu, size.w || 1, contentW);
  if (fx.cameraX === null) fx.cameraX = targetPx;
  else fx.cameraX = easeCamera(fx.cameraX, targetPx, reduceMotion ? 1 : 0.12);

  // Screen shake rides on top of the camera (one transform on the container).
  const shake = fx.shake ? shakeOffset(nowMs - fx.shake.bornAtMs, fx.shake.tier) : { dx: 0, dy: 0 };
  const cameraX = fx.cameraX + shake.dx;

  const xToPx = (x: number) => x * ppu;
  const laneTop = (lane: 0 | 1) => lane * laneH;
  const groundOf = (lane: 0 | 1) => laneTop(lane) + laneH - 20;

  const ultAge = fx.ultFlash ? nowMs - fx.ultFlash.bornAtMs : Infinity;
  const ultOpacity = ultAge < ULTIMATE_FLASH_MS ? (1 - ultAge / ULTIMATE_FLASH_MS) * 0.18 : 0;

  return (
    <View style={styles.root} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {size.w > 0 && (
        <View
          style={[
            styles.world,
            { width: contentW, height: worldH, transform: [{ translateX: cameraX }, { translateY: shake.dy }] },
          ]}
        >
          {[0, 1].map((raw) => {
            const lane = raw as 0 | 1;
            return (
              <View key={lane} style={[styles.lane, { top: laneTop(lane), height: laneH, width: contentW }]}>
                <Image source={arenaFloorTexture()} style={[styles.floor, PIXELATED]} resizeMode="cover" fadeDuration={0} />
                <View style={[styles.ground, { top: groundOf(lane) - laneTop(lane) }]} />
              </View>
            );
          })}

          <CoreStructure team="player" xPx={0} worldH={worldH} state={state} />
          <CoreStructure team="opponent" xPx={contentW} worldH={worldH} state={state} />

          {/* Spawn/summon arrival poofs. */}
          {fx.spawns.map((s) => {
            const t = Math.min(1, (nowMs - s.bornAtMs) / SPAWN_POOF_TTL_MS);
            const size2 = 8 + t * 26;
            return (
              <View
                key={s.key}
                pointerEvents="none"
                style={[
                  styles.ring,
                  {
                    left: xToPx(s.x) - size2 / 2,
                    top: groundOf(s.lane) - size2 / 2 - 8,
                    width: size2,
                    height: size2,
                    borderRadius: size2 / 2,
                    borderColor: s.team === 'player' ? colors.player : colors.opponent,
                    opacity: 1 - t,
                  },
                ]}
              />
            );
          })}

          {/* Combatants (champions drawn last / on top). */}
          {[...living]
            .sort((a, b) => (a.kind === 'champion' ? 1 : 0) - (b.kind === 'champion' ? 1 : 0) || a.id - b.id)
            .map((u) => {
              const hit = latestMatchingHit(u.id, u.lane, u.x, u.team, fx.hits, 3);
              const strikeBorn = fx.strikes.get(u.id) ?? null;
              // P5: champions with an imported AutoSprite set animate from sim
              // state; everyone else falls back to the Arena 1.0 sprite.
              const anim = u.kind === 'champion' ? championAnim(championAnimKeyFor(u.contentId)) : null;
              const clipFrame = anim
                ? resolveChampionClip(fx, anim, u.id, u.targetId === null, nowMs)
                : null;
              return (
                <Combatant
                  key={u.id}
                  unit={u}
                  leftPx={xToPx(u.x)}
                  groundY={groundOf(u.lane as 0 | 1)}
                  hit={hit}
                  strikeAgeMs={strikeBorn === null ? null : nowMs - strikeBorn}
                  tick={state.tick}
                  nowMs={nowMs}
                  reduceMotion={reduceMotion}
                  anim={anim}
                  clipFrame={clipFrame}
                />
              );
            })}

          {/* Ranged shots: a fast streak from muzzle to target. */}
          {fx.projectiles.map((p) => {
            const t = Math.min(1, (nowMs - p.bornAtMs) / PROJECTILE_TTL_MS);
            const x = xToPx(p.fromX + (p.toX - p.fromX) * t);
            const tint = p.team === 'player' ? colors.player : colors.opponent;
            const dir = p.toX >= p.fromX ? 1 : -1;
            return (
              <View key={p.key} pointerEvents="none" style={{ position: 'absolute', left: x, top: groundOf(p.lane) - 26 }}>
                <View style={[styles.bolt, { backgroundColor: tint }]} />
                <View style={[styles.trail, { backgroundColor: tint, opacity: 0.4 * (1 - t), left: dir > 0 ? -14 : 4 }]} />
              </View>
            );
          })}

          {/* Ability / ultimate telegraphs: expanding ring + name, path-colored. */}
          {fx.telegraphs.map((tg) => {
            const ttl = TELEGRAPH_TTL_MS[tg.tier];
            const t = Math.min(1, (nowMs - tg.bornAtMs) / ttl);
            const max = tg.tier === 'ultimate' ? 70 : 40;
            const size2 = 10 + t * max;
            return (
              <View key={tg.key} pointerEvents="none" style={{ position: 'absolute', left: xToPx(tg.x), top: groundOf(tg.lane) - 28 }}>
                <View
                  style={[
                    styles.ring,
                    {
                      left: -size2 / 2,
                      top: -size2 / 2,
                      width: size2,
                      height: size2,
                      borderRadius: size2 / 2,
                      borderWidth: tg.tier === 'ultimate' ? 3 : 2,
                      borderColor: tg.color,
                      opacity: (1 - t) * 0.9,
                    },
                  ]}
                />
                <Text numberOfLines={1} style={[styles.telegraphLabel, { color: tg.color, opacity: 1 - t }]}>
                  {tg.label.toUpperCase()}
                </Text>
              </View>
            );
          })}

          {/* Impact-tiered damage / heal / death floaters (+ crit spark). */}
          {fx.floaters.map((f) => {
            const t = Math.min(1, (nowMs - f.bornAtMs) / FLOATER_TTL_MS);
            return (
              <View key={f.key} pointerEvents="none" style={{ position: 'absolute', left: xToPx(f.x) - 30, top: groundOf(f.lane) - 54 - t * 24 }}>
                {f.crit && (
                  <View style={[styles.critSpark, { opacity: (1 - t) * 0.9, transform: [{ scale: 1 + t * 1.4 }] }]} />
                )}
                <Text
                  style={[
                    styles.floater,
                    { color: f.color, opacity: 1 - t, fontSize: f.fontSize, fontWeight: f.weight },
                  ]}
                >
                  {f.text}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Ultimate ceremony: a brief path-tinted full-screen wash. */}
      {ultOpacity > 0 && fx.ultFlash && (
        <View pointerEvents="none" style={[styles.ultFlash, { backgroundColor: fx.ultFlash.color, opacity: ultOpacity }]} />
      )}
    </View>
  );
}

/** One combatant: team-outlined sprite + health bar + facing chevron, carrying
 *  the procedural attack pose (remapped to the X axis for landscape), the hit
 *  flash and a directional recoil scaled by the hit's impact tier. */
function Combatant({
  unit,
  leftPx,
  groundY,
  hit,
  strikeAgeMs,
  tick,
  nowMs,
  reduceMotion,
  anim,
  clipFrame,
}: {
  unit: import('../../game-engine/simulation/state').UnitState;
  leftPx: number;
  groundY: number;
  hit: { bornAtMs: number; amount: number } | null;
  strikeAgeMs: number | null;
  tick: number;
  nowMs: number;
  reduceMotion: boolean;
  anim: ChampionAnim | null;
  clipFrame: { clip: ClipName; frame: number } | null;
}) {
  const isChampion = unit.kind === 'champion';
  // P5: an AutoSprite champion renders bigger (128px source art) than the
  // legacy 1.0 sprite, and anchors by its feet rather than its box bottom.
  const spriteSize = anim ? 88 : isChampion ? 60 : 40;
  const tint = unit.team === 'player' ? colors.player : colors.opponent;
  const healthPct = Math.max(0, Math.min(1, unit.health / unit.baseMaxHealth));
  const flashAge = hit === null ? HIT_FLASH_TTL_MS : Math.max(0, nowMs - hit.bornAtMs);
  const flashOpacity = flashAge < HIT_FLASH_TTL_MS ? (1 - flashAge / HIT_FLASH_TTL_MS) * 0.75 : 0;

  // attackPose is authored for portrait (forward = −screenY); landscape forward
  // is +X for the player, so the same curve maps onto X with a sign flip.
  const pose = reduceMotion
    ? { offsetY: 0, scale: 1 }
    : attackPose(unit, strikeAgeMs !== null && strikeAgeMs < STRIKE_MS ? strikeAgeMs : null);
  const lungeX = -pose.offsetY;
  const backward = unit.team === 'player' ? -1 : 1; // toward own core
  const recoilX =
    hit !== null && flashOpacity > 0 && !reduceMotion
      ? backward * TIER_FX[tierForDamage(hit.amount)].recoilPx * (flashOpacity / 0.75)
      : 0;
  const drop = spawnScale(tick - unit.spawnedAtTick);

  let sprite: ReturnType<typeof unitSprite> = null;
  if (isChampion) {
    const champion = getChampionById(unit.contentId);
    sprite = champion ? resolveChampionBattleAsset(champion.art, unit.team, null).still : null;
  } else {
    const card = getCardById(unit.contentId);
    sprite = card ? unitSprite(card.art, unit.team) : null;
  }
  const mirror = unit.team === 'opponent';
  // AutoSprite art anchors on the character's FEET inside the 128px cell;
  // legacy sprites sit on the box bottom.
  const footInset = anim ? spriteSize * (anim.refFeetY / anim.cell) : spriteSize;
  const atlasSheet =
    anim && clipFrame ? clipSheet(championAnimKeyFor(unit.contentId), clipFrame.clip) : null;
  const atlasMeta = anim && clipFrame ? anim.clips[clipFrame.clip] : null;

  return (
    <View
      style={[
        styles.combatant,
        {
          left: leftPx - spriteSize / 2,
          top: groundY - footInset,
          width: spriteSize,
          transform: [{ translateX: lungeX + recoilX }, { scale: pose.scale * drop }],
        },
      ]}
      pointerEvents="none"
    >
      <View style={styles.healthTrack}>
        <View style={[styles.healthFill, { width: `${healthPct * 100}%`, backgroundColor: healthBarColor(healthPct, tint, colors.warning) }]} />
      </View>
      <View style={{ width: spriteSize, height: spriteSize }}>
        <View style={[styles.plate, { borderColor: tint, backgroundColor: `${tint}22` }]} />
        {atlasSheet && atlasMeta && clipFrame ? (
          <AtlasSprite
            sheet={atlasSheet}
            cell={atlasMeta.cell}
            cols={atlasMeta.cols}
            rows={atlasMeta.rows}
            frameIndex={clipFrame.frame}
            size={spriteSize}
            mirror={mirror}
            anchorYOffset={atlasMeta.anchorYOffset}
          />
        ) : sprite ? (
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
  const tint = team === 'player' ? colors.player : colors.opponent;
  return (
    <View style={[styles.core, { left: xPx - CORE_W / 2, top: worldH / 2 - 44 }]} pointerEvents="none">
      <Image source={coreSprite(team, pct <= 0.4)} style={[styles.coreImg, PIXELATED]} fadeDuration={0} />
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
  floater: { width: 60, textAlign: 'center' },
  critSpark: {
    position: 'absolute',
    left: 24,
    top: 4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.warning,
  },
  ring: { position: 'absolute', borderWidth: 2 },
  telegraphLabel: { position: 'absolute', left: -60, top: 14, width: 120, textAlign: 'center', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  bolt: { position: 'absolute', width: 8, height: 3, borderRadius: 1.5 },
  trail: { position: 'absolute', width: 12, height: 2, borderRadius: 1 },
  ultFlash: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  core: { position: 'absolute', width: CORE_W, alignItems: 'center' },
  coreImg: { width: CORE_W, height: 64 },
  coreTrack: { width: CORE_W + 6, height: 4, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 2, overflow: 'hidden', marginTop: 3 },
  coreFill: { height: '100%' },
});
