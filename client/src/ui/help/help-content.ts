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
      { heading: 'XP & Level', body: 'Every working set you log is worth 10 XP; every minute of cardio is worth 2. Levelling from one level to the next costs 500 + (level − 1) × 25 XP, so each level asks a little more than the last. Level caps at 100.' },
      { heading: 'Your form evolves', body: 'As you level and your stats shift, your champion visibly evolves down one of five paths (Titan, Mass, Apex, Aesthetic, Shredded). It reflects HOW you train — heavy and big, lean and sharp, or balanced.' },
      { heading: "Today's mission", body: 'The mission ring shows the XP waiting in the sets your plan has for today. Clear it to keep your streak and push your level. Tap your champion to enter the Forge and see the full evolution.' },
      { heading: 'The menu', body: 'Tap the animated fighter in the top-right of any screen to open your bag — progress, awards, coins, schedule, profile and everything else.' },
    ],
  },
  today: {
    title: 'TRAIN',
    tagline: 'Log sets in one tap. They save even offline, and every one earns XP.',
    sections: [
      { heading: 'One-tap logging', body: 'Tap a set to log it — it banks 10 XP immediately and syncs when you have signal, so a dropped connection never loses a set. The rest timer starts itself between sets.' },
      { heading: 'Swap & reorder', body: 'The ⇄ button swaps any exercise for a same-muscle alternative, and the grip handle lets you drag exercises into the order you actually train them.' },
      { heading: 'Three plans, per week', body: 'Switch the whole week between MY PLAN (yours), AI PLAN (built for you), and the EVOFORGE PLAN. Tap EDIT SCHEDULE to set which split lands on each day.' },
      { heading: 'Your own split', body: 'CHOOSE/UPLOAD MY WORKOUT builds a session from scratch or scans a photo/screenshot of a plan you already follow. QUICK WORKOUT lets you just start logging with no plan at all.' },
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
      { heading: 'Four weighted pillars', body: 'Your rating combines Size (30%), Strength (30%), Aesthetics (25%) and Cardio (15%). Each pillar is scored 0–100 from your logged evidence.' },
      { heading: 'Why balance wins', body: 'The pillars combine as a weighted GEOMETRIC mean, not an average. That means one neglected pillar drags the whole rating down — you cannot rank up by maxing a single quality while ignoring the rest. Well-rounded athletes rate highest.' },
      { heading: 'Confidence', body: 'Each pillar carries a confidence that grows as you log more evidence. A high score with low confidence is provisional; keep logging and the rating firms up. The limiting pillar is the one holding you back most.' },
      { heading: 'Evolution & peak', body: 'Your displayed rating eases toward your true rating over time, and your peak is remembered — if you slip, RECLAIM YOUR PEAK is the target to chase back.' },
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
      { heading: 'Seven categories', body: 'Milestones, Consistency, Strength, Physique, Volume, Cardio and Rank. Filter by category, and each shows how many you have earned.' },
      { heading: 'Live progress', body: 'Every locked achievement shows a bar toward its exact target — 19/100 sets, 100/120 kg bench, and so on. The number is the same threshold that grants it, so the bar never lies.' },
      { heading: 'Next up', body: 'The NEXT UP card surfaces the three achievements you are closest to earning, so you always know what is within reach.' },
    ],
  },
  coins: {
    title: 'COINS',
    tagline: 'Earned by training, spent on your champion.',
    sections: [
      { heading: 'How you earn', body: 'Every coin is server-verified: a completed workout pays +25, a personal record +50, and streak milestones pay 10× the milestone day. New athletes start with a 100-coin welcome.' },
      { heading: 'Where they come from', body: 'The breakdown on this screen shows which sources built your balance and how much you have banked this week — so you can see what is actually paying out.' },
      { heading: 'How to spend', body: 'Coins buy champion skins, whole new champions and colour palettes in Customise. Tap SPEND YOUR COINS to go straight there.' },
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
      { heading: 'Log a meal', body: 'Scan a meal photo, scan a barcode, describe it in words, or search the database. Everything lands against today’s target so you always know what is left.' },
      { heading: 'Your target', body: 'Your daily calorie and protein targets come from your stats and goal (cut, maintain or bulk). Protein remaining is called out because it is what actually protects your muscle in a cut.' },
      { heading: 'It feeds your physique', body: 'Nutrition phase (cutting/bulking) informs how your body-composition change is read across the app — fuelling is part of the transformation, not a side app.' },
    ],
  },
  arena: {
    title: 'THE ARENA',
    tagline: 'Turn your training into a fighter and battle.',
    sections: [
      { heading: 'Your stats are your fighter', body: 'Your champion’s combat power comes from the same Size / Strength / Aesthetics / Cardio pillars that build your Evo Rating. Train harder, hit harder.' },
      { heading: 'Quick Match', body: 'QUICK MATCH puts you against a real athlete live, turn by turn — no codes, just tap to find a match. If no one is around, you fight a matched AI so you are never stuck waiting.' },
      { heading: 'Rival Rank', body: 'Ranked results move your Rival Rank via a skill-rating system (wins against stronger opponents are worth more), so the ladder reflects real matchups, not just volume.' },
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
      { heading: 'Find people', body: 'Search any public athlete by display name to add them, or share your own profile link so friends can add you even if your profile is private.' },
      { heading: 'Rivals & gyms', body: 'Rivals track your head-to-head record; gyms are player groups with a private chat and gym-vs-gym battles decided by your rosters fighting member-versus-member.' },
      { heading: 'Your privacy', body: 'You control what is visible — set your profile public or private, and choose whether your Evo stats and lifts show. Nothing is shared until you opt in.' },
    ],
  },
  friends: {
    title: 'FRIENDS & RIVALS',
    tagline: 'Add athletes and track your head-to-head.',
    sections: [
      { heading: 'Add by name', body: 'Type someone’s display name and matching public athletes appear — tap ADD. Private athletes only surface if they have shared their profile link with you.' },
      { heading: 'Share your link', body: 'Send your profile link and a friend can open it and add you directly, even if your profile is private.' },
    ],
  },
  athlete: {
    title: 'ATHLETE PROFILE',
    tagline: 'Another athlete’s stats, measured against yours.',
    sections: [
      { heading: 'Evo pillars vs you', body: 'Their Size / Aesthetics / Strength / Cardio pillars show as bars with a "vs you" delta — green where you lead, red where they do — computed on the same scale as your own.' },
      { heading: 'Only what they share', body: 'Stats and lifts appear only if the athlete opted to show them. A private profile you are not friends with shows a locked card with an add path.' },
    ],
  },
  gym: {
    title: 'GYMS',
    tagline: 'Your crew — chat, roster and gym-vs-gym battles.',
    sections: [
      { heading: 'The roster', body: 'Members are ranked by Evo Rating into a pecking order, your own row highlighted. Everyone’s "vs you" delta shows where you sit in the gym.' },
      { heading: 'Gym battles', body: 'Challenge a rival gym and your rosters fight member-versus-member in the combat engine — most duels won takes it. The battle plays out duel by duel before the verdict.' },
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
