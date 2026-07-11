import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { supabase } from './supabase';

/**
 * Client side of the AI Edge Functions. Photos are picked, resized to ~1024px
 * (the plan's cap -- keeps upload small and detail sufficient), sent as data
 * URLs, and NEVER persisted anywhere on the device or in state stores beyond
 * the in-memory component state that holds them until the call returns.
 */

export interface PhotoConditions {
  lighting: 'flattering' | 'neutral' | 'unflattering' | string;
  pump: 'none' | 'mild' | 'moderate' | 'strong' | string;
  /** false when the model omitted its estimate and we defaulted. */
  estimated?: boolean;
}

export interface PhysiqueResult {
  physique_score: number;
  leanness_score: number;
  symmetry_score: number;
  muscularity_score: number;
  confidence: string;
  weak_points: string[];
  improvements: string[];
  summary: string;
  conditions?: PhotoConditions;
}

export interface BodyfatResult {
  bf_low: number;
  bf_high: number;
  bf_mid: number;
  confidence: string;
  notes: string;
  fat_storage?: string;
  ten_percent_notes?: string;
  conditions?: PhotoConditions;
}

/** Pick one photo and return it as a ~1024px JPEG data URL, or null if cancelled. */
export async function pickPhoto(): Promise<string | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: 'images',
    quality: 0.9,
    allowsEditing: false,
  });
  if (picked.canceled || picked.assets.length === 0) return null;
  const asset = picked.assets[0];

  const context = ImageManipulator.manipulate(asset.uri);
  const wide = (asset.width ?? 0) >= (asset.height ?? 0);
  context.resize(wide ? { width: 1024 } : { height: 1024 });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  if (!result.base64) return null;
  return `data:image/jpeg;base64,${result.base64}`;
}

/**
 * Capture a FRESH photo with the camera — no gallery — as a ~1024px JPEG
 * data URL. Round 3 of a battle only accepts live captures; the server
 * additionally judges pose compliance, so a bypass still has to look like
 * the rolled pose in a fresh frame.
 */
export async function captureCameraPhoto(): Promise<string | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const picked = await ImagePicker.launchCameraAsync({
    mediaTypes: 'images',
    quality: 0.9,
    allowsEditing: false,
  });
  if (picked.canceled || picked.assets.length === 0) return null;
  const asset = picked.assets[0];

  const context = ImageManipulator.manipulate(asset.uri);
  const wide = (asset.width ?? 0) >= (asset.height ?? 0);
  context.resize(wide ? { width: 1024 } : { height: 1024 });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  if (!result.base64) return null;
  return `data:image/jpeg;base64,${result.base64}`;
}

async function invoke<T>(fn: string, body: Record<string, unknown>): Promise<{ result: T | null; error: string | null }> {
  try {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) {
      // A FunctionsHttpError carries the response; surface the server's message.
      const ctx = (error as { context?: Response }).context;
      if (ctx) {
        const payload = await ctx.json().catch(() => null);
        return { result: null, error: payload?.error ?? error.message };
      }
      return { result: null, error: error.message };
    }
    if (data?.error) return { result: null, error: String(data.error) };
    return { result: (data?.result ?? null) as T | null, error: data?.result ? null : 'Empty AI response.' };
  } catch (e) {
    return {
      result: null,
      error:
        e instanceof Error && /Failed to fetch|FunctionsFetchError/i.test(String(e))
          ? 'AI functions are not deployed yet — see the setup checklist.'
          : String(e),
    };
  }
}

export interface ScanOptions {
  /** false = estimate pass: verdict returned, nothing persisted. */
  save?: boolean;
  /** Set only when the athlete CORRECTED the estimated conditions. */
  confirmedConditions?: { lighting: string; pump: string };
}

export function runAiPhysique(images: string[], stats: Record<string, unknown>, opts: ScanOptions = {}) {
  return invoke<PhysiqueResult>('ai-physique', {
    images,
    stats,
    save: opts.save,
    confirmed_conditions: opts.confirmedConditions,
  });
}

export function runAiPlan(payload: { goal: string; physique: unknown; volume: Record<string, number> }) {
  return invoke<import('@/domain/custom-plan').CustomPlan>('ai-plan', payload);
}

export function runAiBodyfat(
  images: string[],
  context: {
    height_cm: number;
    weight_kg: number;
    waist_cm?: number;
    neck_cm?: number;
    lighting?: string;
    pump_status?: string;
    time_of_day?: string;
    save?: boolean;
  },
  opts: ScanOptions = {}
) {
  return invoke<BodyfatResult>('ai-bodyfat', {
    images,
    ...context,
    save: opts.save ?? context.save,
    confirmed_conditions: opts.confirmedConditions,
  });
}
