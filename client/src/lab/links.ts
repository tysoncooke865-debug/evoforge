import type { LabDataMode } from './types';

/**
 * The lab's mirror of "the ONE door" (/workout?date&workout&source): a train
 * variant that opens a workout must stay INSIDE the lab, or one tap would
 * drop the developer back onto the live pages mid-comparison. Same params,
 * same encoding, plus the lab's own data-mode flag.
 */
export function labWorkoutHref(
  variant: string,
  params: { date: string; workout: string; source: string | number },
  mode: LabDataMode
): string {
  return (
    `/lab/workout/${variant}?date=${encodeURIComponent(params.date)}` +
    `&workout=${encodeURIComponent(params.workout)}` +
    `&source=${encodeURIComponent(String(params.source))}` +
    `&data=${mode}`
  );
}

/** A gallery/host URL for any variant: /lab/<page>/<variant>?…&data=<mode>. */
export function labVariantHref(
  page: string,
  variant: string,
  mode: LabDataMode,
  extraParams?: Record<string, string>
): string {
  const extras = Object.entries(extraParams ?? {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `/lab/${page}/${variant}?${extras ? `${extras}&` : ''}data=${mode}`;
}
