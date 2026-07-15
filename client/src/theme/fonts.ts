/**
 * THE PIXEL DISPLAY FACES — Jersey 25 + Jersey 10 (OFL, one designer,
 * license beside the files). They replaced Silkscreen on 2026-07-16
 * (Tyson: Silkscreen's W and ~ were genuinely hard to read) after a
 * side-by-side against Pixelify Sans (its bold 5 reads as an S), Press
 * Start 2P (too wide) and VT323 (too thin). Jersey's numerals are
 * unambiguous and the condensed width ends the wordmark-wrapping wars.
 *
 * PIXEL_BOLD → Jersey 25: headings, buttons, stat values (display sizes).
 * PIXEL → Jersey 10: the tiny caps labels — it is DRAWN on a 10px grid,
 * so the 8–10px whisper text stays crisp. Both are single-weight faces;
 * keep fontWeight normal (a synthesized bold smears pixel glyphs).
 *
 * Still DISPLAY fonts — paragraphs, subtitles and helper copy stay on the
 * system sans for readability; do not apply these to everything.
 */
export const PIXEL = 'Jersey10';
export const PIXEL_BOLD = 'Jersey25';

export const PIXEL_FONTS = {
  [PIXEL]: require('../../assets/fonts/Jersey10-Regular.ttf'),
  [PIXEL_BOLD]: require('../../assets/fonts/Jersey25-Regular.ttf'),
};

/** The style triplet for a pixel label — spread it after className styles. */
export const pixelFont = (bold = true) =>
  ({ fontFamily: bold ? PIXEL_BOLD : PIXEL, fontWeight: 'normal' }) as const;
