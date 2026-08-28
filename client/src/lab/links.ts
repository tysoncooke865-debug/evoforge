/**
 * The lab's mirror of "the ONE door" (/workout?date&workout&source): a train
 * variant that opens a workout must stay INSIDE the lab, or one tap would
 * drop the developer back onto the live pages mid-comparison. Same params,
 * same encoding.
 */
export function labWorkoutHref(
  variant: string,
  params: { date: string; workout: string; source: string | number }
): string {
  return (
    `/lab/workout/${variant}?date=${encodeURIComponent(params.date)}` +
    `&workout=${encodeURIComponent(params.workout)}` +
    `&source=${encodeURIComponent(String(params.source))}`
  );
}

/** A gallery/host URL for any variant: /lab/<page>/<variant>[?…]. No query
 *  string at all when the page carries no contract params — the lab used to
 *  append its data-mode flag here, and every URL wore a `?` for it. */
export function labVariantHref(
  page: string,
  variant: string,
  extraParams?: Record<string, string>
): string {
  const extras = Object.entries(extraParams ?? {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `/lab/${page}/${variant}${extras ? `?${extras}` : ''}`;
}
