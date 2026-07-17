import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { captureCameraPhoto } from '@/data/ai';
import { isBarcode, lookupBarcode, type BarcodeProduct } from '@/data/food-lookup';
import { pixelFont } from '@/theme/fonts';
import { useThemeColors } from '@/theme/use-theme';
import { NeonButton } from '@/ui/core/neon-button';
import { PixelBarcode } from '@/ui/core/pixel-icons';
import { BarcodeVideo, decodeBarcodePhoto } from '@/ui/fuel/barcode-video';

/**
 * FUEL_REDESIGN — the barcode door. Live viewfinder first (zxing over
 * getUserMedia; works in the installed iOS PWA), then two honest fallbacks:
 * decode a single still photo, or type the digits. Whatever finds the code,
 * ONE path continues: Open Food Facts lookup → the caller's confirm sheet.
 * Nothing here writes — the product is a prefill.
 */
export function BarcodeScanModal({
  onClose,
  onProduct,
}: {
  onClose: () => void;
  onProduct: (product: BarcodeProduct) => void;
}) {
  const colors = useThemeColors();
  const [liveDead, setLiveDead] = useState(false);
  const [busy, setBusy] = useState<'lookup' | 'photo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  // The zxing reader self-stops on its first decode and has no restart API —
  // a failed lookup would otherwise leave a DEAD viewfinder rendered as live.
  // Bumping the epoch remounts BarcodeVideo (permission is already granted,
  // so re-acquisition is seamless). Also bumped on return from backgrounding
  // and after the SNAP flow, both of which iOS uses to suspend the stream.
  const [scanEpoch, setScanEpoch] = useState(0);
  // Synchronous guards refs, not state: the camera's onCode can fire between
  // a setState and the re-render, so state alone cannot close the race.
  const inFlight = useRef(false);
  const dead = useRef(false);
  useEffect(
    () => () => {
      dead.current = true;
    },
    []
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') setScanEpoch((e) => e + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  const found = async (code: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setBusy('lookup');
    try {
      const r = await lookupBarcode(code);
      if (dead.current) return; // modal closed mid-lookup — drop the result
      setBusy(null);
      if ('error' in r) {
        setError(r.error);
        setScanEpoch((e) => e + 1); // revive the live viewfinder
      } else onProduct(r);
    } finally {
      inFlight.current = false;
    }
  };

  const photoPath = async () => {
    if (inFlight.current) return;
    setError(null);
    // The native camera sheet suspends the getUserMedia stream on iOS — the
    // epoch bump after the flow brings the live viewfinder back.
    const uri = await captureCameraPhoto();
    if (dead.current) return;
    setScanEpoch((e) => e + 1);
    if (!uri) return;
    setBusy('photo');
    const code = await decodeBarcodePhoto(uri);
    if (dead.current) return;
    if (code === null) {
      setBusy(null);
      setError('No barcode found in that photo. Fill the frame and try again.');
      return;
    }
    setBusy(null);
    await found(code);
  };

  const corner = (pos: object) => (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: 22,
        height: 22,
        borderColor: colors.accent,
        ...pos,
      }}
    />
  );

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        className="flex-1 justify-center px-s4"
        style={{ backgroundColor: 'rgba(2,5,11,0.85)' }}
        onPress={onClose}
      >
        <Pressable
          onPress={() => undefined}
          className="overflow-hidden rounded-xl border"
          style={{ borderColor: `${colors.epic}59`, backgroundColor: colors.surface, maxHeight: '85%' }}
        >
          {/* Scrollable body: short viewports must not clip the card, and the
              iOS keyboard needs a scrollable ancestor to reveal the digits
              input (the exercise-picker modal pattern). */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16 }}
            showsVerticalScrollIndicator={false}
          >
          <View className="mb-s3 flex-row items-center" style={{ gap: 8 }}>
            <PixelBarcode size={16} color={colors.epic} />
            <Text
              className="text-text"
              allowFontScaling={false}
              style={{ fontSize: 16, letterSpacing: 0.5, ...pixelFont() }}
            >
              SCAN A BARCODE
            </Text>
          </View>

          {!liveDead ? (
            <View
              className="overflow-hidden rounded-lg border"
              style={{ height: 240, borderColor: `${colors.accent}59`, backgroundColor: '#02050b' }}
              testID="barcode-viewfinder"
            >
              <BarcodeVideo
                key={scanEpoch}
                onCode={(c) => void found(c)}
                onUnavailable={() => setLiveDead(true)}
              />
              {corner({ top: 10, left: 10, borderTopWidth: 2, borderLeftWidth: 2 })}
              {corner({ top: 10, right: 10, borderTopWidth: 2, borderRightWidth: 2 })}
              {corner({ bottom: 10, left: 10, borderBottomWidth: 2, borderLeftWidth: 2 })}
              {corner({ bottom: 10, right: 10, borderBottomWidth: 2, borderRightWidth: 2 })}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 24,
                  right: 24,
                  top: '50%',
                  height: 2,
                  backgroundColor: `${colors.accent}8c`,
                }}
              />
            </View>
          ) : (
            <Text className="text-2xs text-text-mute">
              The live camera is unavailable here — snap a photo of the barcode or type the digits
              under it.
            </Text>
          )}

          <Text className="mt-s2 text-2xs text-text-mute">
            {liveDead ? '' : 'Point the camera at the product barcode. '}
            The product comes from Open Food Facts; you confirm before anything saves.
          </Text>

          {busy !== null ? (
            <View className="mt-s3 flex-row items-center justify-center" style={{ gap: 8, minHeight: 32 }}>
              <ActivityIndicator color={colors.epic} />
              <Text className="text-2xs text-text-dim">
                {busy === 'photo' ? 'Reading the photo…' : 'Looking up the product…'}
              </Text>
            </View>
          ) : null}
          {error ? (
            <Text className="mt-s2 text-2xs text-danger" testID="barcode-error">
              {error}
            </Text>
          ) : null}

          <View className="mt-s3 flex-row items-end" style={{ gap: 8 }}>
            <View className="flex-1">
              <Text
                className="mb-s1 text-text-mute"
                allowFontScaling={false}
                style={{ fontSize: 9, letterSpacing: 1, ...pixelFont(false) }}
              >
                OR TYPE THE DIGITS
              </Text>
              <TextInput
                className="min-h-[48px] rounded-md border border-border bg-surface-2 px-s3 text-base text-text"
                placeholder="e.g. 9300605069718"
                placeholderTextColor="#64758f"
                value={manual}
                onChangeText={(v) => setManual(v.replace(/\D/g, '').slice(0, 14))}
                keyboardType="number-pad"
                inputMode="numeric"
                testID="barcode-manual"
              />
            </View>
            <Pressable
              onPress={() => void found(manual)}
              disabled={!isBarcode(manual) || busy !== null}
              accessibilityRole="button"
              accessibilityLabel="look up barcode"
              className="items-center justify-center rounded-md border px-s3"
              style={{
                minHeight: 48,
                borderColor: isBarcode(manual) ? `${colors.epic}8c` : colors.border,
                opacity: isBarcode(manual) ? 1 : 0.5,
              }}
              testID="barcode-lookup"
            >
              <Text
                className="text-epic"
                allowFontScaling={false}
                style={{ fontSize: 10, letterSpacing: 1, ...pixelFont(false) }}
              >
                LOOK UP
              </Text>
            </Pressable>
          </View>

          <View className="mt-s3">
            <NeonButton
              title="📷 SNAP THE BARCODE"
              variant="ghost"
              onPress={() => void photoPath()}
              disabled={busy !== null}
              testID="barcode-photo"
            />
          </View>
          <View className="mt-s2">
            <NeonButton title="CLOSE" variant="ghost" onPress={onClose} testID="barcode-close" />
          </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
