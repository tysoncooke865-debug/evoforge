/**
 * STILLNESS COPY of ui/home/home-ambience.tsx (Page Lab, forked 2026-08-18).
 *
 * HOME'S BACKDROP — held perfectly still.
 *
 * The live alias re-exports `ScreenAmbience` from ui/core/ambience.tsx: three
 * fog masses on a 34s Lissajous drift plus six rising pixel motes, one shared
 * driver. STILLNESS keeps the LIGHT and drops the WEATHER: the same three fog
 * tints sit at their resting positions as a fixed wash, so the page still is
 * not flat black — but nothing in the background ever moves, and the only
 * motion behind the fold line is the champion's own breath. The motes go
 * entirely: a mote that does not rise is a dead pixel.
 *
 * This is a static equivalent rendered here rather than an edit to the core
 * file — Train and the live Home keep their drift untouched. Same colours,
 * same geometry, same sub-0.05 opacities (the backdrop doctrine: the moment
 * it is legible as an object it has failed).
 */

import { memo } from 'react';
import { View } from 'react-native';

export const HomeAmbience = memo(function HomeAmbience() {
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}
    >
      {/* The cyan mass, upper left — at rest. */}
      <View
        style={{
          position: 'absolute',
          top: -180,
          left: -160,
          width: 420,
          height: 420,
          borderRadius: 210,
          backgroundColor: 'rgba(34, 211, 238, 0.045)',
        }}
      />
      {/* The purple mass, upper right — at rest. */}
      <View
        style={{
          position: 'absolute',
          top: 60,
          right: -200,
          width: 460,
          height: 460,
          borderRadius: 230,
          backgroundColor: 'rgba(168, 85, 247, 0.042)',
        }}
      />
      {/* A third mass, low and cool, so the fold does not fall off into flat
          black as the athlete scrolls toward the mission. */}
      <View
        style={{
          position: 'absolute',
          bottom: -240,
          left: 20,
          width: 480,
          height: 480,
          borderRadius: 240,
          backgroundColor: 'rgba(34, 211, 238, 0.03)',
        }}
      />
    </View>
  );
});
