/**
 * PAGE HELP — the coach-mark content, one topic per screen. Shown the first
 * time a screen is opened and reopenable any time via the floating "?".
 *
 * The numbers here are the REAL formulas (domain/xp.ts, progression/*.ts,
 * data/coins.ts, avatar-stats-calc.ts). If a curve changes, this copy changes
 * with it — help that lies is worse than no help. Keep each section tight: a
 * heading and two or three sentences, calc theory included where it earns its
 * place.
 */

export interface HelpSection {
  heading: string;
  body: string;
  /** testID(s) of the on-screen element this section points at. A trailing '-'
   *  means "prefix" (first element whose testID starts with it). An array is a
   *  fallback chain — the first target that's actually on screen wins, so a
   *  section still points at something when the primary element isn't rendered
   *  in the current account state. Omitted when the section is conceptual. */
  target?: string | string[];
}
export interface HelpTopic {
  title: string;
  tagline: string;
  sections: HelpSection[];
}

/** Map a pathname to a help key. Dynamic id segments collapse to the base. */
export function helpKeyForPath(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/index') return 'home';
  if (p.startsWith('/athlete')) return 'athlete';
  if (p.startsWith('/gym')) return 'gym';
  const base = p.replace(/^\//, '').split('/')[0];
  return base in HELP ? base : null;
}

export const HELP: Record<string, HelpTopic> = {
  home: {
    title: 'YOUR CHAMPION',
    tagline: 'Home is your character. Everything you do in the gym forges it.',
    sections: [
      { heading: 'XP & Level', target: 'home-level-module', body: 'This is your level and the bar toward the next one. Every working set is worth 10 XP; every minute of cardio is worth 2. Levelling up costs 500 + (level − 1) × 25 XP, so each level asks a little more than the last. Level caps at 100.' },
      { heading: 'Your champion evolves', target: ['hero-avatar', 'hero-origin-empty', 'hero-form'], body: 'This is you. As you level and your stats shift, your champion visibly evolves down one of five paths (Titan, Mass, Apex, Aesthetic, Shredded). Tap it to enter the Forge and see the full evolution.' },
      { heading: "Today's mission", target: ['mission-progress', 'mission-start', 'mission-rest-train', 'mission-view'], body: 'This shows the XP waiting in the sets your plan has for today. Clear it to keep your streak and push your level.' },
      { heading: 'Your menu lives here', target: 'profile-menu', body: 'Tap the animated fighter in the top-right of any screen to open your bag — progress, awards, coins, schedule, profile and everything else.' },
    ],
  },
  today: {
    title: 'TRAIN',
    tagline: 'Your training hub — plans, your week, and today’s session.',
    sections: [
      { heading: 'Start today’s session', target: ['hero-card', 'hero-card-'], body: 'This card is today’s workout. Tap it to open the session and log sets — each set banks 10 XP the moment you tap it, and saves even offline, so a dropped signal never loses a set.' },
      { heading: 'Three plans, one switch', target: 'plan-dropdown', body: 'This dropdown switches the whole week between MY PLAN (yours), AI PLAN (built for you) and the EVOFORGE PLAN.' },
      { heading: 'Set your week', target: 'edit-week', body: 'EDIT SCHEDULE is where you pick which split lands on each day. Today’s pick drives your Home mission and the sets you see here.' },
      { heading: 'Your own split', target: 'change-workout', body: 'CHOOSE/UPLOAD MY WORKOUT builds a session from scratch or scans a photo of a plan you already follow. QUICK WORKOUT just starts logging with no plan at all.' },
    ],
  },
  ai: {
    title: 'THE ORACLE',
    tagline: 'AI reads your physique and turns it into stats and guidance.',
    sections: [
      { heading: 'Physique scan', body: 'Take or upload photos and the Oracle estimates your body composition and rates your physique. Solo scan photos are never stored — they are analysed and discarded.' },
      { heading: 'Body-fat drives leanness', body: 'Your latest body-fat estimate feeds the Leanness pillar of your avatar and gates several achievements (under 15%, 13%, 12%, 10%). Log it regularly to keep the read honest.' },
      { heading: 'It informs, it does not decide', body: 'AI ratings are one input among many. Your logged lifts, bodyweight and cardio all feed your stats too — the scan sharpens the picture, it is not the whole picture.' },
    ],
  },
  evo: {
    title: 'EVO RATING',
    tagline: 'One number for your whole physique — and why a weak spot hurts.',
    sections: [
      { heading: 'Four weighted pillars', target: 'evo-pillars', body: 'These bars are your rating’s four pillars: Size (30%), Strength (30%), Aesthetics (25%) and Cardio (15%). Each is scored 0–100 from your logged evidence.' },
      { heading: 'Why balance wins', target: 'evo-pillars', body: 'The pillars combine as a weighted GEOMETRIC mean, not an average — so one neglected pillar (your shortest bar here) drags the whole rating down. You cannot rank up by maxing a single quality; well-rounded athletes rate highest.' },
      { heading: 'Confidence', target: 'evo-pillars', body: 'Each pillar carries a confidence that grows as you log more evidence. A high score with low confidence is provisional; keep logging and it firms up. The pillar marked LIMITING is the one holding you back most.' },
      { heading: 'Evolution & peak', target: 'evo-rating-card', body: 'Your displayed rating eases toward your true rating over time, and your peak is remembered — if you slip, RECLAIM YOUR PEAK is the target to chase back.' },
    ],
  },
  'forge-level': {
    title: 'FORGE LEVEL',
    tagline: 'Your lifetime prestige — it only ever goes up.',
    sections: [
      { heading: 'Lifetime, not current', body: 'Forge Level is earned from your TOTAL lifetime XP. Unlike your champion level it never decreases, and it can never be bought — only training moves it.' },
      { heading: 'The curve', body: 'Holding a Forge Level needs 250 × (level − 1)^1.65 total XP. Each level costs steeply more than the last, so a high Forge Level is a real signal of how much work you have put in.' },
      { heading: 'It unlocks cosmetics', body: 'Forge Levels gate some champion skins and palettes in Customise — hitting a milestone opens new ways to make your champion yours.' },
    ],
  },
  rank: {
    title: 'RANK LADDER',
    tagline: 'Eight tiers, decided purely by your level.',
    sections: [
      { heading: 'The tiers', body: 'Rookie (Lv 1) → Trainee (10) → Athlete (25) → Aesthetic Tier (40) → Elite Physique (60) → Chad-Lite (75) → Chad (90) → True Adam (100). You hold the highest tier your level has passed.' },
      { heading: 'How to climb', body: 'Rank follows your champion level, and level follows XP — 10 per set, 2 per cardio minute. There are no shortcuts; the ladder is a clean read of the work.' },
    ],
  },
  awards: {
    title: 'ACHIEVEMENTS',
    tagline: '64 to unlock, each with a real target you can track toward.',
    sections: [
      { heading: 'Seven categories', target: 'award-filter-', body: 'These chips filter by category — Milestones, Consistency, Strength, Physique, Volume, Cardio and Rank — and each shows how many you have earned.' },
      { heading: 'Next up', target: 'nextup-', body: 'The NEXT UP card surfaces the three achievements you are closest to earning, each with a live progress bar, so you always know what is within reach.' },
      { heading: 'Live progress', target: 'award-', body: 'Every locked achievement shows a bar toward its exact target — 19/100 sets, 100/120 kg bench, and so on. The number is the same threshold that grants it, so the bar never lies.' },
    ],
  },
  coins: {
    title: 'COINS',
    tagline: 'Earned by training, spent on your champion.',
    sections: [
      { heading: 'How you earn', target: 'coin-balance', body: 'This is your balance. Every coin is server-verified: a completed workout pays +25, a personal record +50, and streak milestones pay 10× the milestone day. New athletes start with a 100-coin welcome.' },
      { heading: 'Where they come from', target: 'coin-source-', body: 'This breakdown shows which sources built your balance and their share, plus what you have banked this week — so you can see what is actually paying out.' },
      { heading: 'How to spend', target: 'coin-spend-cta', body: 'Coins buy champion skins, whole new champions and colour palettes in Customise. Tap SPEND YOUR COINS to go straight there.' },
    ],
  },
  streak: {
    title: 'STREAKS',
    tagline: 'Consistency, rewarded — and worth protecting.',
    sections: [
      { heading: 'Keep the chain', body: 'Your streak counts consecutive days you train. Missing a day breaks it, so the daily mission on Home is the thing to clear.' },
      { heading: 'Milestones pay out', body: 'Hitting a streak milestone banks coins worth 10× the milestone day and can unlock Consistency achievements. Longer chains are worth steadily more.' },
    ],
  },
  fuel: {
    title: 'FUEL',
    tagline: 'Calories and macros, as fast as logging a set.',
    sections: [
      { heading: 'Log a meal', target: 'meal-scan', body: 'Scan a meal photo (here), scan a barcode, describe it in words, or search the database. Everything lands against today’s target so you always know what is left.' },
      { heading: 'Your target', target: 'fuel-set-target', body: 'Your daily calorie and protein targets come from your stats and goal (cut, maintain or bulk) — set or tune them here. Protein remaining is called out because it is what protects your muscle in a cut.' },
      { heading: 'It feeds your physique', body: 'Nutrition phase (cutting/bulking) informs how your body-composition change is read across the app — fuelling is part of the transformation, not a side app.' },
    ],
  },
  arena: {
    title: 'THE ARENA',
    tagline: 'Turn your training into a fighter and battle.',
    sections: [
      { heading: 'Quick Match', target: 'mode-quickmatch', body: 'QUICK MATCH puts you against a real athlete live, turn by turn — no codes, just tap to find a match. If no one is around, you fight a matched AI so you are never stuck waiting. Your champion’s power comes from the same pillars that build your Evo Rating.' },
      { heading: 'Rival Rank', target: 'arena-rival-door', body: 'Ranked results move your Rival Rank via a skill-rating system (wins against stronger opponents are worth more), so the ladder reflects real matchups, not just volume.' },
      { heading: 'Friends & history', target: 'arena-friends-door', body: 'Battle a friend directly, and review every past fight in your game log. The Arena is where your training becomes a fight.' },
    ],
  },
  pvp: {
    title: 'QUICK MATCH',
    tagline: 'Live, turn-based PvP against a real athlete.',
    sections: [
      { heading: 'How it works', body: 'Pick your champion and tap FIND MATCH. You are paired with another athlete in the queue and fight in real time, each choosing a move per turn. Both devices resolve the same seeded outcome, so there is no desync.' },
      { heading: 'No opponent? No wait', body: 'If the queue is empty for a while, you are matched against an AI of similar strength — you always get a fight.' },
    ],
  },
  battle: {
    title: 'BATTLE',
    tagline: 'Turn-based combat with a rock-paper-scissors core.',
    sections: [
      { heading: 'The move triangle', body: 'Moves beat and lose to each other in a triangle, so reading your opponent matters as much as raw stats. Power, defence and recovery each have their moment.' },
      { heading: 'Stamina & timing', body: 'Big moves cost stamina; recover to keep swinging. Winning is stats plus tempo — spend at the right moment, not every moment.' },
    ],
  },
  customise: {
    title: 'CUSTOMISE',
    tagline: 'Spend coins and Forge Levels to make your champion yours.',
    sections: [
      { heading: 'Skins, champions, palettes', body: 'Unlock alternate skins, whole new champions and colour palettes. Some cost coins (earned by training), others unlock at Forge Level milestones.' },
      { heading: 'It is cosmetic', body: 'Customisation changes how your champion looks, never its combat power — your stats always come from your training, so nothing here is pay-to-win.' },
    ],
  },
  avatar: {
    title: 'THE FORGE',
    tagline: 'Where your champion evolves.',
    sections: [
      { heading: 'Five evolution paths', body: 'Your champion follows one of five branches — Titan, Mass, Apex, Aesthetic, Shredded — chosen by HOW your stats develop. Heavy strength and size push one way; leanness and conditioning push another.' },
      { heading: 'Stages', body: 'Each path evolves through stages as you level. The art you see is a direct read of your training story, not a costume you pick.' },
    ],
  },
  social: {
    title: 'SOCIAL',
    tagline: 'Friends, rivals, gyms and the feed.',
    sections: [
      { heading: 'Feed & tabs', target: 'social-tab-', body: 'These tabs switch between Following, Rivals, Discover and Gyms. Rivals track your head-to-head record; gyms are player groups with a private chat and gym-vs-gym battles decided by your rosters fighting member-versus-member.' },
      { heading: 'Find people', target: 'social-find-friends', body: 'Search any public athlete by display name to add them, or share your own profile link so friends can add you even if your profile is private.' },
      { heading: 'Your privacy', body: 'You control what is visible — set your profile public or private, and choose whether your Evo stats and lifts show. Nothing is shared until you opt in.' },
    ],
  },
  friends: {
    title: 'FRIENDS & RIVALS',
    tagline: 'Add athletes and track your head-to-head.',
    sections: [
      { heading: 'Add by name', target: 'friend-search-input', body: 'Type someone’s display name here and matching public athletes appear — tap ADD. Private athletes only surface if they have shared their profile link with you.' },
      { heading: 'Share your link', target: 'share-profile', body: 'Send your profile link and a friend can open it and add you directly, even if your profile is private.' },
    ],
  },
  athlete: {
    title: 'ATHLETE PROFILE',
    tagline: 'Another athlete’s stats, measured against yours.',
    sections: [
      { heading: 'Evo pillars vs you', target: 'pillar-', body: 'Their Size / Aesthetics / Strength / Cardio pillars show as bars with a "vs you" delta — green where you lead, red where they do — computed on the same scale as your own.' },
      { heading: 'Only what they share', body: 'Stats and lifts appear only if the athlete opted to show them. A private profile you are not friends with shows a locked card with an add path.' },
    ],
  },
  gym: {
    title: 'GYMS',
    tagline: 'Your crew — chat, roster and gym-vs-gym battles.',
    sections: [
      { heading: 'The roster', target: 'gym-member-', body: 'Members are ranked by Evo Rating into a pecking order, your own row highlighted. Everyone’s "vs you" delta shows where you sit in the gym.' },
      { heading: 'Gym battles', target: 'gym-battle-search', body: 'Search a rival gym here and your rosters fight member-versus-member in the combat engine — most duels won takes it. The battle plays out duel by duel before the verdict.' },
    ],
  },
  schedule: {
    title: 'YOUR WEEK',
    tagline: 'Set which split lands on each day.',
    sections: [
      { heading: 'One picker, whole week', body: 'Choose the plan source for the week — MY PLAN, AI PLAN or the EVOFORGE PLAN — then assign a split to each day. Today’s plan drives your Home mission and the sets on Train.' },
    ],
  },
  progress: {
    title: 'PROGRESS',
    tagline: 'The charts behind the numbers.',
    sections: [
      { heading: 'Trends over time', body: 'Track your lifts, bodyweight, body-fat and volume across weeks. Progress is the proof your training is working — the single number on Home is just today’s snapshot.' },
    ],
  },
  goals: {
    title: 'GOALS',
    tagline: 'Set targets the app tracks for you.',
    sections: [
      { heading: 'Targets', body: 'Set goals like a body-fat target or a lift number. The app tracks your progress toward them, and hitting some (like your body-fat target) unlocks achievements.' },
    ],
  },
  rival: {
    title: 'RIVAL RANK',
    tagline: 'Your competitive standing from real matchups.',
    sections: [
      { heading: 'Skill-based', body: 'Rival Rank moves on a skill-rating system: beating a stronger opponent gains more than beating a weaker one, and losing to a weaker one costs more. It rewards who you beat, not just how often.' },
      { heading: 'Reclaim your status', body: 'When a rival beats your PR or climbs past you, you’re notified — the ladder is meant to be fought over, not sat on.' },
    ],
  },
  data: {
    title: 'YOUR DATA',
    tagline: 'The raw record behind your character.',
    sections: [
      { heading: 'Everything you logged', body: 'Your weekly activity, sessions and logged history in one place. It is your data — the app derives every stat from it and never invents a number you did not earn.' },
    ],
  },
};
