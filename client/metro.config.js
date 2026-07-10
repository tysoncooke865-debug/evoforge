// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// `input` is the stylesheet NativeWind compiles Tailwind from. The Expo template
// already imports `src/global.css` (via src/constants/theme.ts), so that file is
// the one entry point, not a second one alongside it.
module.exports = withNativeWind(config, { input: './src/global.css' });
