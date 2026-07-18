import Svg, { Rect } from 'react-native-svg';

/**
 * TRAIN_OVERHAUL — the pixel-art icon set. One convention: every icon is a
 * hand-authored pixel grid ('#' = filled cell) rendered as SVG rects, so it is
 * genuinely pixel art (crisp at any size, no font fallback roulette like the
 * old text glyphs) and tints through a `color` prop — the tab bar's
 * active/inactive tint keeps working unchanged.
 *
 * The grids are art: iterate them against screenshots, the API never moves.
 */

export function PixelGlyph({
  rows,
  size = 18,
  color = '#e8f2fb',
  testID,
}: {
  /** The grid, row strings of equal length; '#' fills a cell. */
  rows: readonly string[];
  size?: number;
  color?: string;
  testID?: string;
}) {
  const h = rows.length;
  const w = rows[0]?.length ?? 1;
  const cells: { x: number; y: number }[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') cells.push({ x, y });
  });
  // Icons are wider-or-taller; scale the longest side into `size`.
  const scale = size / Math.max(w, h);
  return (
    <Svg width={w * scale} height={h * scale} viewBox={`0 0 ${w} ${h}`} testID={testID}>
      {cells.map((c) => (
        // 1.06 overlap: adjacent cells fuse without antialiased hairlines.
        <Rect key={`${c.x},${c.y}`} x={c.x} y={c.y} width={1.06} height={1.06} fill={color} />
      ))}
    </Svg>
  );
}

const DUMBBELL = [
  '.##.....##.',
  '.##.....##.',
  '###########',
  '###########',
  '.##.....##.',
  '.##.....##.',
] as const;

const FORK = [
  '#.#.#',
  '#.#.#',
  '#.#.#',
  '#####',
  '.###.',
  '..#..',
  '..#..',
  '..#..',
  '..#..',
] as const;

const HEART = [
  '.##...##.',
  '####.####',
  '#########',
  '#########',
  '.#######.',
  '..#####..',
  '...###...',
  '....#....',
] as const;

const PENCIL = [
  '.......##',
  '......###',
  '.....###.',
  '....###..',
  '...###...',
  '..###....',
  '.###.....',
  '###......',
  '#........',
] as const;

const PLUS_SQUARE = [
  '#########',
  '#.......#',
  '#...#...#',
  '#...#...#',
  '#.#####.#',
  '#...#...#',
  '#...#...#',
  '#.......#',
  '#########',
] as const;

const SWAP = [
  '........#..',
  '.#########.',
  '........#..',
  '...........',
  '..#........',
  '.#########.',
  '..#........',
] as const;

const CURVED_ARROW = [
  '...#.....',
  '..###....',
  '.#####...',
  '...#.....',
  '...#.....',
  '...#.....',
  '...#.....',
  '...##....',
  '....###..',
  '......##.',
] as const;

const BARS = [
  '......##',
  '......##',
  '...##.##',
  '...##.##',
  '##.##.##',
  '##.##.##',
] as const;

const ROTATE = [
  '....##.#..',
  '..##...##.',
  '.#.....###',
  '#.........',
  '#.........',
  '#.........',
  '.#.......#',
  '..##....#.',
  '....####..',
] as const;

const CLOCK = [
  '..#####..',
  '.#.....#.',
  '#...#...#',
  '#...#...#',
  '#...##..#',
  '#.......#',
  '#.......#',
  '.#.....#.',
  '..#####..',
] as const;

const FLAME = [
  '....#...',
  '...##..#',
  '...##..#',
  '..####.#',
  '..######',
  '.###.###',
  '###...##',
  '###...##',
  '.##...#.',
  '..####..',
] as const;

const TICK = [
  '.....#',
  '....##',
  '#..##.',
  '####..',
  '.##...',
] as const;

const CROSS = [
  '#...#',
  '##.##',
  '.###.',
  '##.##',
  '#...#',
] as const;

// HOME_REDESIGN — the avatar hero's wardrobe doors + the schedule card.
const SHIRT = [
  '###.....###',
  '####...####',
  '###########',
  '##.#####.##',
  '..#######..',
  '..#######..',
  '..#######..',
  '..#######..',
  '..#######..',
] as const;

const HELMET = [
  '..######..',
  '.########.',
  '##########',
  '##########',
  '##.####.##',
  '##########',
  '.##....##.',
] as const;

const CALENDAR = [
  '..#.....#..',
  '###########',
  '#.........#',
  '###########',
  '#.........#',
  '#.##.#.##.#',
  '#.........#',
  '#.##.#.##.#',
  '#.........#',
  '###########',
] as const;

type IconProps = { size?: number; color?: string; testID?: string };

export const PixelDumbbell = ({ size = 18, color, testID }: IconProps) => (
  <PixelGlyph rows={DUMBBELL} size={size} color={color} testID={testID ?? 'pixel-dumbbell'} />
);
export const PixelFork = ({ size = 18, color, testID }: IconProps) => (
  <PixelGlyph rows={FORK} size={size} color={color} testID={testID ?? 'pixel-fork'} />
);
export const PixelHeart = ({ size = 18, color, testID }: IconProps) => (
  <PixelGlyph rows={HEART} size={size} color={color} testID={testID ?? 'pixel-heart'} />
);
export const PixelPencil = ({ size = 18, color, testID }: IconProps) => (
  <PixelGlyph rows={PENCIL} size={size} color={color} testID={testID ?? 'pixel-pencil'} />
);
export const PixelPlusSquare = ({ size = 18, color, testID }: IconProps) => (
  <PixelGlyph rows={PLUS_SQUARE} size={size} color={color} testID={testID ?? 'pixel-plus-square'} />
);
export const PixelSwap = ({ size = 18, color, testID }: IconProps) => (
  <PixelGlyph rows={SWAP} size={size} color={color} testID={testID ?? 'pixel-swap'} />
);
export const PixelCurvedArrow = ({ size = 18, color, testID }: IconProps) => (
  <PixelGlyph rows={CURVED_ARROW} size={size} color={color} testID={testID ?? 'pixel-curved-arrow'} />
);
/** The hero card's stat-row marks: sets · minutes · kcal. */
export const PixelBars = ({ size = 14, color, testID }: IconProps) => (
  <PixelGlyph rows={BARS} size={size} color={color} testID={testID ?? 'pixel-bars'} />
);
export const PixelClock = ({ size = 14, color, testID }: IconProps) => (
  <PixelGlyph rows={CLOCK} size={size} color={color} testID={testID ?? 'pixel-clock'} />
);
export const PixelFlame = ({ size = 14, color, testID }: IconProps) => (
  <PixelGlyph rows={FLAME} size={size} color={color} testID={testID ?? 'pixel-flame'} />
);
/** The muscle map's view flipper. */
export const PixelRotate = ({ size = 16, color, testID }: IconProps) => (
  <PixelGlyph rows={ROTATE} size={size} color={color} testID={testID ?? 'pixel-rotate'} />
);
/** The week bars' verdict marks — same kit, tiny sizes. */
export const PixelTick = ({ size = 10, color, testID }: IconProps) => (
  <PixelGlyph rows={TICK} size={size} color={color} testID={testID ?? 'pixel-tick'} />
);
export const PixelCross = ({ size = 10, color, testID }: IconProps) => (
  <PixelGlyph rows={CROSS} size={size} color={color} testID={testID ?? 'pixel-cross'} />
);
/** The avatar hero's wardrobe doors. */
export const PixelShirt = ({ size = 18, color, testID }: IconProps) => (
  <PixelGlyph rows={SHIRT} size={size} color={color} testID={testID ?? 'pixel-shirt'} />
);
export const PixelHelmet = ({ size = 18, color, testID }: IconProps) => (
  <PixelGlyph rows={HELMET} size={size} color={color} testID={testID ?? 'pixel-helmet'} />
);
export const PixelCalendar = ({ size = 18, color, testID }: IconProps) => (
  <PixelGlyph rows={CALENDAR} size={size} color={color} testID={testID ?? 'pixel-calendar'} />
);

// FUEL_REDESIGN — the calorie day's iconography: meal-slot marks (sun /
// bloom / moon / apple), the macro trio (muscle / bolt / drop), and the
// scanner kit (camera / barcode / target / shield). Same convention: grids
// are art, iterate them against screenshots.

const SUN = [
  '.....#.....',
  '.#...#...#.',
  '..#.###.#..',
  '...#####...',
  '..#######..',
  '#.#######.#',
  '..#######..',
  '...#####...',
  '..#.###.#..',
  '.#...#...#.',
  '.....#.....',
] as const;

const BLOOM = [
  '...###...',
  '...###...',
  '##..#..##',
  '###...###',
  '..#####..',
  '###...###',
  '##..#..##',
  '...###...',
  '...###...',
] as const;

const MOON = [
  '..#####..',
  '.#####...',
  '#####....',
  '####.....',
  '####.....',
  '####.....',
  '#####....',
  '.#####...',
  '..#####..',
] as const;

const APPLE = [
  '....#....',
  '...#.....',
  '.###.###.',
  '#########',
  '#########',
  '#########',
  '#########',
  '.#######.',
  '..##.##..',
] as const;

const MUSCLE = [
  '..###......',
  '..####.....',
  '..####..##.',
  '...###.###.',
  '...#######.',
  '..########.',
  '.#########.',
  '.########..',
  '..######...',
] as const;

const BOLT = [
  '...###.',
  '..###..',
  '.###...',
  '#######',
  '...###.',
  '..###..',
  '.###...',
  '###....',
] as const;

const DROP = [
  '...#...',
  '...#...',
  '..###..',
  '..###..',
  '.#####.',
  '#######',
  '#######',
  '.#####.',
  '..###..',
] as const;

const CAMERA = [
  '....###....',
  '###########',
  '####...####',
  '###.....###',
  '###.....###',
  '####...####',
  '###########',
  '###########',
] as const;

const BARCODE = [
  '#.##.#.##..#',
  '#.##.#.##..#',
  '#.##.#.##..#',
  '#.##.#.##..#',
  '#.##.#.##..#',
  '#.##.#.##..#',
  '#.##.#.##..#',
  '#.##.#.##..#',
] as const;

const TARGET = [
  '...###...',
  '.##...##.',
  '.#.....#.',
  '#...#...#',
  '#..###..#',
  '#...#...#',
  '.#.....#.',
  '.##...##.',
  '...###...',
] as const;

const SHIELD = [
  '#########',
  '#########',
  '#########',
  '#########',
  '#########',
  '.#######.',
  '.#######.',
  '..#####..',
  '...###...',
  '....#....',
] as const;

/** The meal-slot marks. */
export const PixelSun = ({ size = 16, color, testID }: IconProps) => (
  <PixelGlyph rows={SUN} size={size} color={color} testID={testID ?? 'pixel-sun'} />
);
export const PixelBloom = ({ size = 16, color, testID }: IconProps) => (
  <PixelGlyph rows={BLOOM} size={size} color={color} testID={testID ?? 'pixel-bloom'} />
);
export const PixelMoon = ({ size = 16, color, testID }: IconProps) => (
  <PixelGlyph rows={MOON} size={size} color={color} testID={testID ?? 'pixel-moon'} />
);
export const PixelApple = ({ size = 16, color, testID }: IconProps) => (
  <PixelGlyph rows={APPLE} size={size} color={color} testID={testID ?? 'pixel-apple'} />
);
/** The macro trio: protein / carbs / fat. */
export const PixelMuscle = ({ size = 16, color, testID }: IconProps) => (
  <PixelGlyph rows={MUSCLE} size={size} color={color} testID={testID ?? 'pixel-muscle'} />
);
export const PixelBolt = ({ size = 14, color, testID }: IconProps) => (
  <PixelGlyph rows={BOLT} size={size} color={color} testID={testID ?? 'pixel-bolt'} />
);
export const PixelDrop = ({ size = 14, color, testID }: IconProps) => (
  <PixelGlyph rows={DROP} size={size} color={color} testID={testID ?? 'pixel-drop'} />
);
// CARDIO_REDESIGN — the conditioning activity set.

const TREADMILL = [
  '.......##',
  '......###',
  '..#..###.',
  '.###.....',
  '..#......',
  '.###.....',
  '#########',
  '#.......#',
  '##.....##',
] as const;

const WALK = [
  '..##..',
  '..##..',
  '......',
  '.###..',
  '####..',
  '.###.#',
  '.#.##.',
  '##..#.',
  '#...##',
] as const;

const RUN = [
  '...##..',
  '...##..',
  '.......',
  '..####.',
  '####.#.',
  '..###..',
  '.##.##.',
  '##...##',
  '#.....#',
] as const;

const BIKE = [
  '.....##..',
  '.........',
  '..#####..',
  '.#..#..#.',
  '###.#.###',
  '#.#.#.#.#',
  '#.#####.#',
  '.#.....#.',
  '..#####..',
] as const;

const STAIRS = [
  '......###',
  '......#.#',
  '...####.#',
  '...#..#.#',
  '####..#.#',
  '#..#..#.#',
  '#..#..#.#',
  '#########',
] as const;

const GLOVE = [
  '.####..',
  '######.',
  '#######',
  '#######',
  '#######',
  '.######',
  '.#####.',
  '.#####.',
  '..###..',
] as const;

/** The scanner kit. */
export const PixelCamera = ({ size = 16, color, testID }: IconProps) => (
  <PixelGlyph rows={CAMERA} size={size} color={color} testID={testID ?? 'pixel-camera'} />
);
export const PixelTreadmill = ({ size = 18, color, testID }: IconProps) => (
  <PixelGlyph rows={TREADMILL} size={size} color={color} testID={testID ?? 'pixel-treadmill'} />
);
export const PixelWalk = ({ size = 16, color, testID }: IconProps) => (
  <PixelGlyph rows={WALK} size={size} color={color} testID={testID ?? 'pixel-walk'} />
);
export const PixelRun = ({ size = 16, color, testID }: IconProps) => (
  <PixelGlyph rows={RUN} size={size} color={color} testID={testID ?? 'pixel-run'} />
);
export const PixelBike = ({ size = 18, color, testID }: IconProps) => (
  <PixelGlyph rows={BIKE} size={size} color={color} testID={testID ?? 'pixel-bike'} />
);
export const PixelStairs = ({ size = 16, color, testID }: IconProps) => (
  <PixelGlyph rows={STAIRS} size={size} color={color} testID={testID ?? 'pixel-stairs'} />
);
export const PixelGlove = ({ size = 16, color, testID }: IconProps) => (
  <PixelGlyph rows={GLOVE} size={size} color={color} testID={testID ?? 'pixel-glove'} />
);

// The Social tab — two figures.
const PEOPLE = [
  '.##...##.',
  '.##...##.',
  '.........',
  '###...###',
  '####.####',
  '####.####',
] as const;
export const PixelPeople = ({ size = 19, color, testID }: IconProps) => (
  <PixelGlyph rows={PEOPLE} size={size} color={color} testID={testID ?? 'pixel-people'} />
);

// The notification bell (§6.4, 2026-07-19) — dome, mouth, clapper.
const BELL = [
  '....##....',
  '...####...',
  '..######..',
  '..######..',
  '..######..',
  '.########.',
  '##########',
  '....##....',
] as const;
export const PixelBell = ({ size = 18, color, testID }: IconProps) => (
  <PixelGlyph rows={BELL} size={size} color={color} testID={testID ?? 'pixel-bell'} />
);
export const PixelBarcode = ({ size = 18, color, testID }: IconProps) => (
  <PixelGlyph rows={BARCODE} size={size} color={color} testID={testID ?? 'pixel-barcode'} />
);
export const PixelTarget = ({ size = 14, color, testID }: IconProps) => (
  <PixelGlyph rows={TARGET} size={size} color={color} testID={testID ?? 'pixel-target'} />
);
export const PixelShield = ({ size = 18, color, testID }: IconProps) => (
  <PixelGlyph rows={SHIELD} size={size} color={color} testID={testID ?? 'pixel-shield'} />
);
