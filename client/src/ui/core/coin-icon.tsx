import { Image } from 'expo-image';

/**
 * The EvoForge coin — Tyson's emblem sprite (assets/coin.png, trimmed and
 * downscaled from the 1024px original). One component so every placement
 * (Home chip, Vault, More row) shares the require and renders identically.
 */
const COIN = require('../assets/coin.png');

export function CoinIcon({ size = 18 }: { size?: number }) {
  return <Image source={COIN} style={{ width: size, height: size }} contentFit="contain" accessibilityLabel="EvoForge coin" />;
}
