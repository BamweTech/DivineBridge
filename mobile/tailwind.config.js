/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './hooks/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Base
        navy: {
          950: '#060A14',
          900: '#0A0F1E',
          800: '#0F1628',
          700: '#141D35',
          600: '#1A2540',
          500: '#1F2D4D',
        },
        // Primary accent — warm amber
        amber: {
          300: '#FCD34D',
          400: '#FBBF24',
          500: '#F59E0B',
          600: '#D97706',
        },
        // Glass surfaces
        glass: {
          white: 'rgba(255,255,255,0.06)',
          'white-border': 'rgba(255,255,255,0.10)',
          amber: 'rgba(245,158,11,0.12)',
          'amber-border': 'rgba(245,158,11,0.25)',
        },
        // Text
        text: {
          primary: '#F8FAFC',
          secondary: '#94A3B8',
          muted: '#475569',
        },
        // Status
        online: '#22C55E',
        speaking: '#F59E0B',
        error: '#EF4444',
      },
      fontFamily: {
        // Apple iOS typography. On iOS `System` resolves to SF Pro; on Android
        // we fall back to Nunito Sans (the open-source SF stand-in). For full
        // type roles + letter-spacing, prefer the helpers in `lib/typography.ts`
        // (`TYPE.headline`, `iosFontStyle('600')`, `<AppText variant="…">`).
        'sans': ['System', 'NunitoSans_400Regular', '-apple-system', 'sans-serif'],
        'sans-medium': ['System', 'NunitoSans_500Medium', '-apple-system', 'sans-serif'],
        'sans-semibold': ['System', 'NunitoSans_600SemiBold', '-apple-system', 'sans-serif'],
        'sans-bold': ['System', 'NunitoSans_700Bold', '-apple-system', 'sans-serif'],
        // Kept as aliases for the rare case a component still uses `font-serif*`.
        // These now resolve to the same iOS stack — Newsreader is retired.
        'serif': ['System', 'NunitoSans_400Regular', '-apple-system', 'sans-serif'],
        'serif-medium': ['System', 'NunitoSans_500Medium', '-apple-system', 'sans-serif'],
        'serif-semibold': ['System', 'NunitoSans_600SemiBold', '-apple-system', 'sans-serif'],
        'serif-bold': ['System', 'NunitoSans_700Bold', '-apple-system', 'sans-serif'],
        'serif-italic': ['System', 'NunitoSans_400Regular_Italic', '-apple-system', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
        '4xl': '32px',
      },
    },
  },
  plugins: [],
};
