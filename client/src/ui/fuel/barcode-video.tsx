import { useEffect } from 'react';
import { View } from 'react-native';

/**
 * FUEL_REDESIGN (native twin) — no live decoder yet: the product is the web
 * PWA; when native builds ship, this twin swaps in expo-camera's
 * onBarcodeScanned behind the same contract. Until then it reports
 * unavailable so the modal falls straight to photo / manual entry.
 */
export function BarcodeVideo({
  onCode: _onCode,
  onUnavailable,
}: {
  onCode: (code: string) => void;
  onUnavailable: () => void;
}) {
  useEffect(() => {
    onUnavailable();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once
  }, []);
  return <View style={{ flex: 1 }} />;
}

export async function decodeBarcodePhoto(_dataUrl: string): Promise<string | null> {
  return null;
}
