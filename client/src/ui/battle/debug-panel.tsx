import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { UseBattle } from '@/ui/battle/use-battle';
import { PIXEL, PIXEL_BOLD } from '@/theme/fonts';
import tokens from '@/theme/tokens';

/**
 * DEV-ONLY battle debug panel. Hidden unless __DEV__; a collapsed tab in the
 * corner opens the controls. Lets us set HP, restore stamina, force crits,
 * apply an instant win/loss — for fast testing tonight.
 */
export function BattleDebugPanel({ battle }: { battle: UseBattle }) {
  const [open, setOpen] = useState(false);
  if (!__DEV__) return null;

  return (
    <View style={{ position: 'absolute', top: 4, right: 4, zIndex: 50, alignItems: 'flex-end' }}>
      <Pressable onPress={() => setOpen((v) => !v)} style={{ borderRadius: 6, borderWidth: 1, borderColor: '#a855f7', backgroundColor: 'rgba(10,16,30,0.9)', paddingHorizontal: 6, paddingVertical: 3 }}>
        <Text allowFontScaling={false} style={{ fontSize: 8, color: '#a855f7', fontFamily: PIXEL_BOLD }}>DEBUG</Text>
      </Pressable>
      {open ? (
        <View style={{ marginTop: 4, gap: 4, borderRadius: 8, borderWidth: 1, borderColor: '#a855f766', backgroundColor: 'rgba(6,12,24,0.96)', padding: 6, width: 150 }}>
          <Btn label="Player HP 10%" onPress={() => battle.debug.setHealth('player', battle.state.player.stats.maxHealth * 0.1)} />
          <Btn label="Enemy HP 10%" onPress={() => battle.debug.setHealth('opponent', battle.state.opponent.stats.maxHealth * 0.1)} />
          <Btn label="Restore stamina" onPress={battle.debug.restoreStamina} />
          <Btn label={`Force crit: ${battle.debug.forceCrit ? 'ON' : 'off'}`} onPress={battle.debug.toggleForceCrit} active={battle.debug.forceCrit} />
          <Btn label="Skip → Victory" onPress={() => battle.debug.skipTo('player')} />
          <Btn label="Skip → Defeat" onPress={() => battle.debug.skipTo('opponent')} />
        </View>
      ) : null}
    </View>
  );
}

function Btn({ label, onPress, active = false }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} style={{ borderRadius: 5, borderWidth: 1, borderColor: active ? tokens.colors.accent : '#334155', backgroundColor: active ? 'rgba(34,211,238,0.12)' : 'rgba(20,30,50,0.8)', paddingHorizontal: 6, paddingVertical: 4 }}>
      <Text allowFontScaling={false} style={{ fontSize: 8.5, color: active ? tokens.colors.accent : tokens.colors.text, fontFamily: PIXEL }}>{label}</Text>
    </Pressable>
  );
}
