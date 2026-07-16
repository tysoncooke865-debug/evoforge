import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { CoinIcon } from '@/ui/core/coin-icon';
import { ScreenHeader } from '@/ui/core/screen-header';
import { ScreenShell } from '@/ui/core/shell';

/** The overflow: everything that doesn't earn a bottom-bar slot. */
const ITEMS: { href: string; title: string; sub: string; glyph: string }[] = [
  { href: '/progress', title: 'Progress', sub: 'Bodyweight and bench e1RM over time', glyph: '◺' },
  { href: '/log', title: 'Stats Entry', sub: 'Log bodyweight and tape measurements', glyph: '▤' },
  { href: '/goals', title: 'Goals', sub: 'Targets with honest journey bars', glyph: '◎' },
  { href: '/awards', title: 'Awards', sub: 'All 64 achievements', glyph: '★' },
  { href: '/rank', title: 'Rank', sub: 'The leaderboard — opt in to compete', glyph: '♛' },
  { href: '/streak', title: 'Streak', sub: 'The consistency calendar', glyph: '▦' },
  { href: '/schedule', title: 'Schedule', sub: 'Map your training week', glyph: '◫' },
  { href: '/routine', title: 'My Routine', sub: 'Build your own split and exercises', glyph: '⚒' },
  { href: '/coins', title: 'Coins', sub: 'Every coin, server-verified', glyph: '◍' },
  { href: '/profile', title: 'Profile', sub: 'Rank ladder, identity, sign out', glyph: '◉' },
  { href: '/data', title: 'Data', sub: 'Export everything · delete data', glyph: '⛃' },
];

export default function MoreScreen() {
  return (
    <ScreenShell><ScreenHeader kicker="YOUR COMPANION'S BAG" title="MENU" />
        {ITEMS.map((item) => (
          <Link key={item.href} href={item.href as never} asChild>
            <View className="mb-s2 flex-row items-center rounded-lg border border-border bg-surface p-s4">
              {item.href === '/coins' ? (
                <View className="mr-s3"><CoinIcon size={22} /></View>
              ) : (
                <Text className="mr-s3 text-lg text-accent">{item.glyph}</Text>
              )}
              <View className="flex-1">
                <Text className="font-bold text-text">{item.title}</Text>
                <Text className="text-xs text-text-mute">{item.sub}</Text>
              </View>
              <Text className="text-text-mute">›</Text>
            </View>
          </Link>
        ))}
    </ScreenShell>
  );
}
