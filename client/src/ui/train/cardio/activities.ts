import {
  PixelBike,
  PixelGlove,
  PixelPlusSquare,
  PixelRun,
  PixelStairs,
  PixelTreadmill,
  PixelWalk,
} from '@/ui/core/pixel-icons';

/**
 * CARDIO_REDESIGN — the activity catalogue: icon + one-line descriptor + which
 * fields each type actually uses. The field map is the cardio-logger's rule
 * VERBATIM (irrelevant inputs never render); it moved here so the selector,
 * the form, and the recent-session rows all read one source.
 */
export type CardioIcon = (p: { size?: number; color?: string }) => React.ReactNode;

export interface CardioFields {
  minutes?: boolean;
  distance?: boolean;
  incline?: boolean;
  speed?: boolean;
  calories?: boolean;
  rounds?: boolean;
}

export interface CardioActivity {
  type: string;
  label: string;
  blurb: string;
  Icon: CardioIcon;
  fields: CardioFields;
}

export const CARDIO_ACTIVITIES: readonly CardioActivity[] = [
  {
    type: 'Treadmill incline walk',
    label: 'TREADMILL',
    blurb: 'Incline or steady pace',
    Icon: PixelTreadmill,
    fields: { minutes: true, incline: true, speed: true, distance: true, calories: true },
  },
  { type: 'Outdoor walk', label: 'OUTDOOR WALK', blurb: 'Steps & distance', Icon: PixelWalk, fields: { minutes: true, distance: true, calories: true } },
  { type: 'Run', label: 'RUN', blurb: 'Pace & distance', Icon: PixelRun, fields: { minutes: true, distance: true, calories: true } },
  { type: 'Bike', label: 'BIKE', blurb: 'Ride or spin', Icon: PixelBike, fields: { minutes: true, distance: true, calories: true } },
  { type: 'Stairmaster', label: 'STAIRMASTER', blurb: 'Climb & incline', Icon: PixelStairs, fields: { minutes: true, incline: true, calories: true } },
  { type: 'Boxing', label: 'BOXING', blurb: 'Rounds & intensity', Icon: PixelGlove, fields: { rounds: true, calories: true } },
  { type: 'Other', label: 'OTHER', blurb: 'Anything conditioning', Icon: PixelPlusSquare, fields: { minutes: true, distance: true, calories: true } },
];

const BY_TYPE = new Map(CARDIO_ACTIVITIES.map((a) => [a.type, a]));

export function activityFor(type: string): CardioActivity {
  return BY_TYPE.get(type) ?? CARDIO_ACTIVITIES[CARDIO_ACTIVITIES.length - 1];
}

/** Which companion animation a cardio type earns: rounds-based types punch. */
export function cardioAnim(type: string): 'punch' | 'run' {
  return activityFor(type).fields.rounds ? 'punch' : 'run';
}

/** Speed is stored in cardio_log as km/h (no unit column); mph converts on
 *  save so history stays comparable. 1 mph = 1.609344 km/h. */
export const KMH_PER_MPH = 1.609344;
