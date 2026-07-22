// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    rules: {
      // Doctrine (MIGRATION_PLAN note #3): the Streamlit app needed ui/escape.py
      // because a JS-readable auth cookie made HTML injection a session theft.
      // Here React escapes by default, and this rule closes the one hatch out.
      // It bites on web (react-native-web renders real DOM); no exceptions.
      'react/no-danger': 'error',
    },
  },
  {
    // The Arena card-battler renders a MUTABLE deterministic simulation: the
    // battle/replay screens re-render on a version counter and read the live
    // sim state from refs by design (see arena-game battle-store docs). Those
    // components carry 'use no memo' so the React Compiler skips them; the
    // compiler-assumption rules are scoped off here to match. Everything else
    // (exhaustive-deps, rules-of-hooks, react/no-danger) still applies.
    files: ['src/arena-game/**', 'src/app/(main)/forge-arena/**'],
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
