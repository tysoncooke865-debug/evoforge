/**
 * Rep-scheme -> human sentence (PHASE_2_PLAN commit 2, item 1.4). The
 * catalog is GENERATED and must not be edited, so the vividness lives here
 * in the UI layer: bare numbers and ranges become "Aim for …", AMRAP gets
 * spelled out, and anything else (the long top-set strings) passes through
 * verbatim.
 */
export function schemeSentence(scheme: string): string {
  const s = String(scheme).trim();
  if (/amrap/i.test(s)) return 'As many reps as possible';
  if (/^\d+$/.test(s)) return `Aim for ${s} reps`;
  const range = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) return `Aim for ${range[1]}–${range[2]} reps`;
  return s;
}
