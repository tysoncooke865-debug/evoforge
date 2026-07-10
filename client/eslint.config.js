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
]);
