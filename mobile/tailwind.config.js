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
        // Primary tokens: Newsreader (serif, headings + long-form) and Inter Tight (sans, UI + chat).
        'serif': ['Newsreader_400Regular'],
        'serif-medium': ['Newsreader_500Medium'],
        'serif-semibold': ['Newsreader_600SemiBold'],
        'serif-bold': ['Newsreader_700Bold'],
        'serif-italic': ['Newsreader_400Regular_Italic'],
        'sans': ['InterTight_400Regular'],
        'sans-medium': ['InterTight_500Medium'],
        'sans-semibold': ['InterTight_600SemiBold'],
        'sans-bold': ['InterTight_700Bold'],

        // Legacy aliases kept as shims mapped to the new faces so any usage we miss still renders.
        'jakarta': ['Newsreader_400Regular'],
        'jakarta-medium': ['Newsreader_500Medium'],
        'jakarta-semibold': ['Newsreader_600SemiBold'],
        'jakarta-bold': ['Newsreader_700Bold'],
        'geist': ['InterTight_400Regular'],
        'geist-medium': ['InterTight_500Medium'],
        'geist-semibold': ['InterTight_600SemiBold'],
        'geist-bold': ['InterTight_700Bold'],
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
