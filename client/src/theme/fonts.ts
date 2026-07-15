/**
 * THE 16-BIT DISPLAY FACE (Tyson, 2026-07-15): Silkscreen (OFL), loaded once
 * at the root. It is a DISPLAY font — headings, button labels, stat numbers,
 * short caps chips. Paragraphs, subtitles and helper copy stay on the system
 * sans for readability; do not apply this to everything.
 *
 * Silkscreen ships a real Bold — use PIXEL_BOLD instead of fontWeight (a
 * synthesized bold smears pixel glyphs). Pair with allowFontScaling={false}
 * on layout-critical labels and near-zero letterSpacing (the face is wide).
 */
export const PIXEL = 'Silkscreen';
export const PIXEL_BOLD = 'Silkscreen-Bold';

export const PIXEL_FONTS = {
  [PIXEL]: require('../../assets/fonts/Silkscreen-Regular.ttf'),
  [PIXEL_BOLD]: require('../../assets/fonts/Silkscreen-Bold.ttf'),
};

/** The style triplet for a pixel label — spread it after className styles. */
export const pixelFont = (bold = true) =>
  ({ fontFamily: bold ? PIXEL_BOLD : PIXEL, fontWeight: 'normal' }) as const;
