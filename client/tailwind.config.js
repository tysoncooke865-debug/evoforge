/** @type {import('tailwindcss').Config} */
module.exports = {
  // NativeWind v4 compiles Tailwind 3. Only files listed here are scanned for
  // class names -- a class used in a file outside these globs silently produces
  // no style rather than an error.
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {},
  },
  plugins: [],
};
