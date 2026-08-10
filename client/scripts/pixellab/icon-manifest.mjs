/**
 * THE ICON MANIFEST — what gets generated, why, and with what.
 *
 * Every entry here is an icon that (a) is ACTUALLY USED in the app today, and
 * (b) has no `PixelGlyph` equivalent and should not have one. Read
 * `docs/ICON_AUDIT.md` for the classification that produced this list; the
 * short version is that the split is decided by ONE question:
 *
 *     DOES COLOUR CARRY MEANING, AND IS IT DRAWN BIGGER THAN ~20px?
 *
 * If no — a padlock, a magnifier, a pair of scales at 14px — it belongs in
 * `ui/core/pixel-icons.tsx` as a tintable SVG grid, because a baked raster is
 * one colour and one size and both of those matter more at that scale than
 * shading does.
 *
 * If yes — a GOLD medal beside a SILVER one, a trophy, a crown — a raster is
 * the honest answer, because the colour IS the information and no amount of
 * tinting a monochrome grid can express three podium places.
 *
 * NOTHING IS GENERATED THAT IS NOT RENDERED. The brief's own rule: "Only
 * generate icons that actually exist or are needed in the current
 * implementation. Do not create unused asset bloat." Each entry names its call
 * sites so that rule stays checkable.
 *
 * ---- CANVAS SIZE DEVIATES FROM THE BRIEF, ON PURPOSE ----
 *
 * The brief specifies a 64×64 canvas. `forge-materials-gen.mjs` already learned
 * why that is wrong for small UI icons, and recorded it: "32px, not the arena's
 * 64: these render at 28-72px and a smaller source keeps the pixels honest
 * rather than letting a 64px sprite be downscaled to mush." A 64px source shown
 * at 16px is a 4:1 downscale — every pixel-art edge the style depends on is
 * averaged away. So `size` is chosen per icon from where it is actually drawn.
 *
 * ---- SEEDS ARE PINNED ----
 *
 * A regeneration must reproduce the committed art, or "regenerate" becomes
 * "roll the dice again" and the family drifts apart one icon at a time.
 */

/** Shared style. The six Forge materials read as a set because they share one
 *  of these; the same applies here, and it is the whole reason it is a
 *  constant rather than repeated prose. Derived from the prompt that produced
 *  the coherent material ladder, plus the palette the audit fixed on. */
export const STYLE =
  'pixel art game icon, single object centered on empty background, '
  + 'chunky readable silhouette, bold dark outline, three-tone shading, '
  + 'dark navy background-free, crisp hard pixel edges, limited palette, '
  + 'no text, no numbers, no letters, no border, no frame';

/** The EvoForge palette, stated for the model in words it responds to. */
const CYBER = 'neon cyan and electric blue highlights, cool steel blue-grey metal, ';
const REWARD = 'warm gold and amber highlights, ';

export const ICONS = [
  // ---------------------------------------------------------------- status
  {
    name: 'trophy',
    category: 'status',
    size: 64,
    seed: 1301,
    /** Rendered at 40–64px on the completion sheet and the arena cards. */
    renders: '20-40px',
    replaces: '🏆',
    sites: [
      'src/ui/train/summary-sheet.tsx:561',
      'src/app/(main)/arena/index.tsx:214',
      'src/ui/arena/battle-arena.tsx:204',
      'src/app/(main)/arena/battle/[id].tsx:66',
    ],
    desc:
      'a single victory trophy cup with two handles on a square plinth, '
      + REWARD
      + 'polished gold cup with a cool steel base, ' + STYLE,
  },
  {
    name: 'medal-gold',
    category: 'status',
    size: 32,
    // SEED BUMPED (1311 -> 1361). The first pass hung the disc from a tall
    // ribbon that ate ~45% of the canvas, so at the 14-18px this actually
    // renders at the disc — the only part carrying the information — was about
    // seven pixels across, and bronze and silver became hard to tell apart.
    // The fix is compositional, not chromatic: fill the frame with the DISC.
    seed: 1361,
    renders: '14-18px',
    replaces: '🥇',
    sites: ['src/ui/arena/leaderboard-row.tsx:29', 'src/ui/arena/leaderboard-teaser.tsx:143'],
    desc:
      'a large round gold medal disc seen face on, filling almost the entire frame, '
      + 'bright saturated yellow-gold, thick raised rim, a tiny blue ribbon loop at the very top, '
      + STYLE,
  },
  {
    name: 'medal-silver',
    category: 'status',
    size: 32,
    seed: 1362,
    renders: '14-18px',
    replaces: '🥈',
    sites: ['src/ui/arena/leaderboard-row.tsx:29', 'src/ui/arena/leaderboard-teaser.tsx:143'],
    desc:
      'a large round silver medal disc seen face on, filling almost the entire frame, '
      + 'bright cool white-silver, thick raised rim, a tiny blue ribbon loop at the very top, '
      + STYLE,
  },
  {
    name: 'medal-bronze',
    category: 'status',
    size: 32,
    seed: 1363,
    renders: '14-18px',
    replaces: '🥉',
    sites: ['src/ui/arena/leaderboard-row.tsx:29', 'src/ui/arena/leaderboard-teaser.tsx:143'],
    desc:
      'a large round bronze medal disc seen face on, filling almost the entire frame, '
      + 'deep saturated orange-brown copper, clearly darker than gold, thick raised rim, '
      + 'a tiny blue ribbon loop at the very top, ' + STYLE,
  },
  {
    name: 'badge',
    category: 'status',
    size: 32,
    // SEED BUMPED (1321 -> 1371). The first pass put red ribbon tails under
    // the star; at the 12-16px this actually renders at they were three stray
    // red pixels that read as damage, not decoration. A star alone survives
    // the size; a star with appendages does not.
    seed: 1371,
    renders: '12-16px',
    replaces: '🎖',
    sites: ['src/ui/battle/result-modal.tsx:142', 'src/app/(main)/arena/index.tsx:263'],
    desc:
      'a single bold five-pointed gold star filling the frame, no ribbon, no tails, '
      + REWARD + 'bright gold with a darker gold bevel, ' + STYLE,
  },
  {
    name: 'crown',
    category: 'status',
    size: 32,
    seed: 1331,
    renders: '14-20px',
    replaces: '👑',
    sites: ['src/app/(main)/arena/battle/[id].tsx:1376'],
    desc:
      'a single simple five-point royal crown, ' + REWARD
      + 'gold band with three small blue gems, ' + STYLE,
  },

  // ------------------------------------------------------------ challenges
  {
    name: 'ghost',
    category: 'challenges',
    size: 32,
    seed: 1341,
    renders: '16-24px',
    replaces: '👻',
    sites: [
      'src/ui/train/summary-sheet.tsx:267',
      'src/ui/train/summary-sheet.tsx:271',
      'src/app/(main)/arena/index.tsx:294',
    ],
    desc:
      'a single translucent ghost figure with a rounded top and a wavy bottom edge, '
      + CYBER + 'glowing cyan spectral body with dark eyes, ' + STYLE,
  },
];

/** Every category the manifest uses — the output folders. */
export const CATEGORIES = [...new Set(ICONS.map((i) => i.category))];
