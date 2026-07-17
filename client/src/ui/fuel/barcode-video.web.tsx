import { useEffect, useRef } from 'react';
import { View } from 'react-native';

/**
 * FUEL_REDESIGN (web twin) — the live barcode viewfinder. A real <video>
 * appended imperatively into an RN-web View (whose ref IS the DOM node), fed
 * by getUserMedia via @zxing/browser, which is lazy-imported so its ~90KB
 * stays out of the entry bundle. iOS Safari has no BarcodeDetector — zxing
 * is the primary path, not a fallback.
 *
 * The native twin (barcode-video.tsx) reports unavailable: native builds
 * will swap in expo-camera's onBarcodeScanned behind this same contract.
 */
export function BarcodeVideo({
  onCode,
  onUnavailable,
}: {
  onCode: (code: string) => void;
  onUnavailable: () => void;
}) {
  const hostRef = useRef<View>(null);
  // The camera must survive parent re-renders: callbacks ride refs so the
  // effect mounts once (the shell.tsx eslint-disable pattern).
  const onCodeRef = useRef(onCode);
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => {
    onCodeRef.current = onCode;
    onUnavailableRef.current = onUnavailable;
  });

  useEffect(() => {
    let stopped = false;
    let controls: { stop: () => void } | null = null;
    const host = hostRef.current as unknown as HTMLElement | null;
    if (!host || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      onUnavailableRef.current();
      return;
    }
    const video = document.createElement('video');
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    video.autoplay = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    host.appendChild(video);
    void (async () => {
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] =
          await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
        ]);
        const reader = new BrowserMultiFormatReader(hints);
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: 'environment' } },
          video,
          (result) => {
            if (result && !stopped) {
              stopped = true;
              controls?.stop();
              onCodeRef.current(result.getText());
            }
          }
        );
        if (stopped) controls.stop(); // unmounted while the camera warmed up
      } catch {
        if (!stopped) onUnavailableRef.current();
      }
    })();
    return () => {
      stopped = true;
      controls?.stop();
      video.srcObject = null;
      video.remove();
    };
  }, []);

  return <View ref={hostRef} style={{ flex: 1 }} />;
}

/** Decode one still photo (the no-live-camera fallback). Null = no barcode. */
export async function decodeBarcodePhoto(dataUrl: string): Promise<string | null> {
  try {
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const reader = new BrowserMultiFormatReader();
    const result = await reader.decodeFromImageUrl(dataUrl);
    return result.getText();
  } catch {
    return null;
  }
}
