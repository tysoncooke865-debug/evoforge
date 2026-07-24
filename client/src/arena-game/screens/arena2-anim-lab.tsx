'use no memo'; // frame index is recomputed from Date.now() each render — never memoize

/**
 * Arena 2.0 — AutoSprite Anim Lab (Redesign P0, dev-only scratch screen).
 *
 * The P0 exit demo: plays the benchmark Shredder (128px AutoSprite atlas) through
 * all six clips (idle/run/attack/hit/dash/ultimate) via the real runtime path —
 * `championAnim` metadata → `AtlasSprite` (clip-View renderer) → frame index from
 * the pure `champion-controller`. Proves the pipeline end-to-end without touching
 * any battle. Gated behind the `animLab` flag; reached from the debug Dev tools
 * panel (same "ships in bundle, linked nowhere in production" precedent as the
 * fitness editor / stress lab).
 *
 * A single rAF loop bumps a counter to re-render; every frame is DERIVED from the
 * frame clock (no per-sprite state, no Animated) — the arena render doctrine.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../components/ui';
import { colors, radius } from '../constants/theme';
import { AtlasSprite } from '../features/arena2/atlas-sprite';
import { championAnim, clipSheet, CLIP_ORDER, type ClipName } from '../features/arena2/champion-anim';
import { clipFinished, clipFrameIndex } from '../features/arena2/champion-controller';
import { arena2FlagEnabled } from '../services/flags/arena-flags';

const CHAMPION = 'shredder';
const RENDER_SIZE = 240;

export default function Arena2AnimLab() {
  const anim = championAnim(CHAMPION);
  const [clip, setClip] = useState<ClipName>('idle');
  const [mirror, setMirror] = useState(false);
  const startRef = useRef(Date.now());
  const [, force] = useState(0);

  // Restart the clip clock whenever the selected clip changes.
  useEffect(() => {
    startRef.current = Date.now();
  }, [clip]);

  // rAF re-render pump (stops on unmount).
  useEffect(() => {
    let raf = 0;
    let alive = true;
    const pump = () => {
      if (!alive) return;
      force((n) => (n + 1) % 1_000_000);
      raf = requestAnimationFrame(pump);
    };
    raf = requestAnimationFrame(pump);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  if (!arena2FlagEnabled('animLab')) {
    return (
      <Screen>
        <Text style={styles.msg}>The Anim Lab is disabled (arena2 flag `animLab`).</Text>
      </Screen>
    );
  }
  if (!anim) {
    return (
      <Screen>
        <Text style={styles.msg}>No `{CHAMPION}` anim metadata — run scripts/arena-autosprite-import.mjs.</Text>
      </Screen>
    );
  }

  const meta = anim.clips[clip];
  const now = Date.now();
  // One-shot clips auto-restart so the demo keeps playing.
  if (!meta.loop && clipFinished(meta, startRef.current, now)) startRef.current = now;
  const frame = clipFrameIndex(meta, startRef.current, now);
  const sheet = clipSheet(CHAMPION, clip);

  return (
    <Screen>
      <Text style={styles.title}>Arena 2.0 · AutoSprite Anim Lab</Text>
      <Text style={styles.sub}>
        Shredder L4 (128px) · {clip} · frame {frame + 1}/{meta.count} · {meta.fps}fps
        {meta.loop ? ' · loop' : ' · one-shot'}
      </Text>

      <View style={styles.stage}>
        {/* ground line — every clip's feet align to it via anchorYOffset */}
        <View style={styles.ground} />
        {sheet ? (
          <AtlasSprite
            sheet={sheet}
            cell={anim.cell}
            cols={meta.cols}
            rows={meta.rows}
            frameIndex={frame}
            size={RENDER_SIZE}
            mirror={mirror}
            anchorYOffset={meta.anchorYOffset}
          />
        ) : (
          <Text style={styles.msg}>Missing sheet for {clip}.</Text>
        )}
      </View>

      <View style={styles.row}>
        {CLIP_ORDER.map((c) => (
          <Pressable
            key={c}
            onPress={() => setClip(c)}
            style={[styles.btn, c === clip && styles.btnActive]}
          >
            <Text style={[styles.btnText, c === clip && styles.btnTextActive]}>{c}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setMirror((m) => !m)} style={[styles.btn, mirror && styles.btnActive]}>
          <Text style={[styles.btnText, mirror && styles.btnTextActive]}>{mirror ? 'facing ←' : 'facing →'}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 18, fontWeight: '800', marginBottom: 2 },
  sub: { color: colors.textDim, fontSize: 12, marginBottom: 12 },
  msg: { color: colors.textDim, fontSize: 13, padding: 16 },
  stage: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    height: RENDER_SIZE + 40,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 16,
  },
  ground: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 18,
    height: 2,
    backgroundColor: 'rgba(34, 211, 238, 0.25)',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  btnActive: { borderColor: colors.player, backgroundColor: 'rgba(34, 211, 238, 0.14)' },
  btnText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  btnTextActive: { color: colors.player },
});
