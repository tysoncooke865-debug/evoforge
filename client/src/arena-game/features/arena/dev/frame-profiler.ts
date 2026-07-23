/**
 * Frame profiler — dev-only measurement for the render-stress lab
 * (premium program P1). Two independent signals:
 *
 *  1. A requestAnimationFrame sampler measuring the *presented* frame
 *     cadence (what the player actually sees). Hot path is allocation-free:
 *     one Float64Array ring buffer write per frame; statistics are computed
 *     lazily in `profileSnapshot()`.
 *  2. The battle store's `devFrameHook`, timing each 50ms store frame:
 *     sim-step cost, publish cost (the Zustand set — which runs React's
 *     synchronous subscriber flush, making it a prod-valid proxy for
 *     render+commit cost), inter-fire gap (JS stall detection), and ticks
 *     consumed (effective tick rate — the sim silently slows below 20Hz
 *     when MAX_CATCHUP_TICKS clamps under load).
 *
 * React `<Profiler>` actualDuration is recorded via `recordCommit` when the
 * stress screen mounts one — dev builds only (production React strips
 * Profiler timings; `commit` is null there and publishMs is the fallback).
 *
 * Never imported by production screens. `startFrameProfiler` installs a
 * `__ARENA_PROFILE` global for Playwright scraping; `stopFrameProfiler`
 * removes it and the store hook.
 */
import { battleStore, devFrameHook } from '../battle-store';

export interface FrameWindowStats {
  sampleCount: number;
  avgFrameMs: number;
  worstFrameMs: number;
  fpsAvg: number;
  /** 1000 / mean of the worst 1% of frame times (standard 1%-low estimate). */
  fps1PercentLow: number;
  framesOver16_7: number;
  framesOver33: number;
}

export interface StoreFrameStats {
  frames: number;
  avgSimMs: number;
  worstSimMs: number;
  avgPublishMs: number;
  worstPublishMs: number;
  avgTicksPerFrame: number;
  /** Sim ticks executed per wall-clock second — 20 when healthy; below 20
   *  the simulation itself is falling behind real time. */
  effectiveTickHz: number;
  /** Inter-fire gaps > STALL_GAP_MS (expected cadence is 50ms). */
  stallCount: number;
  worstGapMs: number;
}

export interface ProfileSnapshot {
  atMs: number;
  raf: FrameWindowStats;
  store: StoreFrameStats;
  /** React <Profiler> commit timings — null in production builds. */
  commit: { count: number; avgActualMs: number; worstActualMs: number } | null;
  /** Chrome-only (performance.memory); null on Hermes/Safari/Firefox. */
  heap: { usedMB: number; totalMB: number; limitMB: number } | null;
  battle: {
    tick: number;
    mode: string;
    status: string;
    units: number;
    playerUnits: number;
    opponentUnits: number;
    logLength: number;
  } | null;
}

const RING_SIZE = 512; // ~10s of 50ms frames / ~8.5s at 60fps
const STALL_GAP_MS = 200;

const ring = new Float64Array(RING_SIZE);
let ringCount = 0; // total samples ever written (index = ringCount & (RING_SIZE-1))
let rafId: number | null = null;
let lastRafTs = 0;
let running = false;

// Store-frame accumulators (reset with the window).
let sFrames = 0;
let sSimTotal = 0;
let sSimWorst = 0;
let sPublishTotal = 0;
let sPublishWorst = 0;
let sTicksTotal = 0;
let sStalls = 0;
let sWorstGap = 0;
let sWindowStartMs = 0;

// React <Profiler> commits.
let cCount = 0;
let cTotal = 0;
let cWorst = 0;

function rafLoop(ts: number): void {
  if (lastRafTs > 0) {
    ring[ringCount & (RING_SIZE - 1)] = ts - lastRafTs;
    ringCount++;
  }
  lastRafTs = ts;
  rafId = requestAnimationFrame(rafLoop);
}

function onStoreFrame(info: { gapMs: number; simMs: number; publishMs: number; ticks: number }) {
  sFrames++;
  sSimTotal += info.simMs;
  if (info.simMs > sSimWorst) sSimWorst = info.simMs;
  sPublishTotal += info.publishMs;
  if (info.publishMs > sPublishWorst) sPublishWorst = info.publishMs;
  sTicksTotal += info.ticks;
  if (info.gapMs > STALL_GAP_MS) sStalls++;
  if (info.gapMs > sWorstGap) sWorstGap = info.gapMs;
}

/** Adapter for a `<Profiler onRender>` callback (dev builds only). */
export function recordCommit(actualDurationMs: number): void {
  cCount++;
  cTotal += actualDurationMs;
  if (actualDurationMs > cWorst) cWorst = actualDurationMs;
}

/** Clear all measurement windows (between density steps) without stopping. */
export function resetProfileWindow(): void {
  ringCount = 0;
  lastRafTs = 0;
  sFrames = 0;
  sSimTotal = 0;
  sSimWorst = 0;
  sPublishTotal = 0;
  sPublishWorst = 0;
  sTicksTotal = 0;
  sStalls = 0;
  sWorstGap = 0;
  sWindowStartMs = Date.now();
  cCount = 0;
  cTotal = 0;
  cWorst = 0;
}

export function profileSnapshot(): ProfileSnapshot {
  const n = Math.min(ringCount, RING_SIZE);
  let total = 0;
  let worst = 0;
  let over16 = 0;
  let over33 = 0;
  const sorted: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = ring[i];
    total += v;
    if (v > worst) worst = v;
    if (v > 16.7) over16++;
    if (v > 33) over33++;
    sorted.push(v);
  }
  sorted.sort((a, b) => b - a);
  const onePct = Math.max(1, Math.floor(n / 100));
  let onePctTotal = 0;
  for (let i = 0; i < onePct && i < sorted.length; i++) onePctTotal += sorted[i];
  const avg = n > 0 ? total / n : 0;
  const onePctAvg = onePct > 0 && sorted.length > 0 ? onePctTotal / Math.min(onePct, sorted.length) : 0;

  const windowSec = Math.max(0.001, (Date.now() - sWindowStartMs) / 1000);
  const mem = (globalThis.performance as unknown as {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  })?.memory;

  const state = battleStore.getState();
  const live = state.live;
  let battle: ProfileSnapshot['battle'] = null;
  if (live) {
    const alive = live.state.units.filter((u) => u.alive);
    battle = {
      tick: live.state.tick,
      mode: state.mode,
      status: state.status,
      units: alive.length,
      playerUnits: alive.filter((u) => u.team === 'player').length,
      opponentUnits: alive.filter((u) => u.team === 'opponent').length,
      logLength: live.state.log.length,
    };
  }

  return {
    atMs: Date.now(),
    raf: {
      sampleCount: n,
      avgFrameMs: avg,
      worstFrameMs: worst,
      fpsAvg: avg > 0 ? 1000 / avg : 0,
      fps1PercentLow: onePctAvg > 0 ? 1000 / onePctAvg : 0,
      framesOver16_7: over16,
      framesOver33: over33,
    },
    store: {
      frames: sFrames,
      avgSimMs: sFrames > 0 ? sSimTotal / sFrames : 0,
      worstSimMs: sSimWorst,
      avgPublishMs: sFrames > 0 ? sPublishTotal / sFrames : 0,
      worstPublishMs: sPublishWorst,
      avgTicksPerFrame: sFrames > 0 ? sTicksTotal / sFrames : 0,
      effectiveTickHz: sTicksTotal / windowSec,
      stallCount: sStalls,
      worstGapMs: sWorstGap,
    },
    commit: cCount > 0 ? { count: cCount, avgActualMs: cTotal / cCount, worstActualMs: cWorst } : null,
    heap: mem
      ? {
          usedMB: mem.usedJSHeapSize / 1048576,
          totalMB: mem.totalJSHeapSize / 1048576,
          limitMB: mem.jsHeapSizeLimit / 1048576,
        }
      : null,
    battle,
  };
}

export function startFrameProfiler(): void {
  if (running) return;
  if (typeof requestAnimationFrame !== 'function') return; // headless test env
  running = true;
  resetProfileWindow();
  devFrameHook.current = onStoreFrame;
  rafId = requestAnimationFrame(rafLoop);
  (globalThis as Record<string, unknown>).__ARENA_PROFILE = {
    snapshot: profileSnapshot,
    reset: resetProfileWindow,
  };
}

export function stopFrameProfiler(): void {
  if (!running) return;
  running = false;
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  lastRafTs = 0;
  devFrameHook.current = null;
  delete (globalThis as Record<string, unknown>).__ARENA_PROFILE;
}

export function isProfilerRunning(): boolean {
  return running;
}
