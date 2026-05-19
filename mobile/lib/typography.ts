import { Platform, type TextStyle } from 'react-native';

/**
 * Apple iOS typography system.
 *
 * On iOS we use the system font (`'System'`), which renders as **SF Pro** — the
 * `-apple-system` equivalent in native land. On Android and Web we fall back to
 * **Nunito Sans**, the open-source typeface that visually pairs best with SF Pro
 * for Latin text. Nunito Sans must be registered via
 * `@expo-google-fonts/nunito-sans` and loaded with `useFonts` on non-iOS
 * platforms (see `mobile/app/_layout.tsx`).
 *
 * Prefer the iOS type roles below (`TYPE.largeTitle`, `TYPE.headline`, …) for
 * any new Text — they encode Apple's exact font-size / line-height / weight /
 * letter-spacing tuples. For rare cases that need a different size with the
 * same font face, use `iosFont(weight)`.
 */

export type IosFontWeight = '300' | '400' | '500' | '600' | '700';

/**
 * Map an iOS-style weight token to the platform-correct `fontFamily`.
 *
 * iOS: returns `'System'` and React Native picks the right SF Pro variant when
 * combined with `fontWeight`.
 * Android: returns the matching Nunito Sans face string. We must explicitly
 * name the face because Android does not synthesize weights from `fontWeight`
 * for non-system fonts.
 * Web / other: returns `'System'`; React Native Web maps this to the browser
 * system stack which already resolves `-apple-system` on Apple devices.
 */
export function iosFont(weight: IosFontWeight = '400'): string {
  if (Platform.OS === 'android') {
    switch (weight) {
      case '300': return 'NunitoSans_300Light';
      case '400': return 'NunitoSans_400Regular';
      case '500': return 'NunitoSans_500Medium';
      case '600': return 'NunitoSans_600SemiBold';
      case '700': return 'NunitoSans_700Bold';
      default:    return 'NunitoSans_400Regular';
    }
  }
  return 'System';
}

/** Italic variant — only meaningful on iOS (SF Pro has true italics). */
export function iosFontItalic(weight: IosFontWeight = '400'): string {
  if (Platform.OS === 'android') {
    switch (weight) {
      case '700': return 'NunitoSans_700Bold_Italic';
      case '600': return 'NunitoSans_600SemiBold_Italic';
      default:    return 'NunitoSans_400Regular_Italic';
    }
  }
  return 'System';
}

/**
 * Apple's published iOS type roles with their exact letter-spacing values.
 *
 * Source: Apple Human Interface Guidelines — Typography. Weights are tuned to
 * match the iOS system app feel: 700 for display titles, 600 for headlines /
 * tappable affordances, 500 for labels, 400 for body, 300 for de-emphasized
 * captions.
 *
 * Each role is a plain `TextStyle` object — spread it directly on a `<Text>`
 * `style` prop, or use the `<AppText variant="…">` wrapper.
 */
export const TYPE = {
  /** 34pt — hero displays (verse hero, onboarding). */
  largeTitle:  { fontFamily: iosFont('700'), fontSize: 34, lineHeight: 41, letterSpacing: -0.5,  fontWeight: '700' },
  /** 28pt — page-level titles. */
  title1:      { fontFamily: iosFont('700'), fontSize: 28, lineHeight: 34, letterSpacing: -0.4,  fontWeight: '700' },
  /** 22pt — section titles ("Today's Global Prayer"). */
  title2:      { fontFamily: iosFont('700'), fontSize: 22, lineHeight: 28, letterSpacing: -0.3,  fontWeight: '700' },
  /** 20pt — sub-section titles, stat values. */
  title3:      { fontFamily: iosFont('600'), fontSize: 20, lineHeight: 25, letterSpacing: -0.2,  fontWeight: '600' },
  /** 17pt — primary tappable label / list headline. */
  headline:    { fontFamily: iosFont('600'), fontSize: 17, lineHeight: 22, letterSpacing: -0.1,  fontWeight: '600' },
  /** 17pt regular — body copy. */
  body:        { fontFamily: iosFont('400'), fontSize: 17, lineHeight: 22, letterSpacing: -0.1,  fontWeight: '400' },
  /** 16pt — secondary callout text, action labels. */
  callout:     { fontFamily: iosFont('500'), fontSize: 16, lineHeight: 21, letterSpacing:  0,    fontWeight: '500' },
  /** 15pt — sub-headline / muted secondary text. */
  subheadline: { fontFamily: iosFont('400'), fontSize: 15, lineHeight: 20, letterSpacing:  0,    fontWeight: '400' },
  /** 13pt — footnotes, helper text. */
  footnote:    { fontFamily: iosFont('400'), fontSize: 13, lineHeight: 18, letterSpacing:  0,    fontWeight: '400' },
  /** 12pt — small captions. */
  caption1:    { fontFamily: iosFont('400'), fontSize: 12, lineHeight: 16, letterSpacing:  0,    fontWeight: '400' },
  /** 11pt — smallest captions, badge text. */
  caption2:    { fontFamily: iosFont('500'), fontSize: 11, lineHeight: 13, letterSpacing:  0.06, fontWeight: '500' },
  /** 11pt uppercase — section eyebrows, frosted pill labels. The +0.6 letter-spacing matches Apple's caps treatment. */
  capsLabel:   { fontFamily: iosFont('600'), fontSize: 11, lineHeight: 13, letterSpacing:  0.6,  fontWeight: '600', textTransform: 'uppercase' as const },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof TYPE;

/** Tabular numbers — keeps digits monospaced so counts/streaks don't shift width. */
export const TABULAR_NUMS: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * `{ fontFamily, fontWeight }` for a given iOS weight. Spread inline:
 *
 * ```tsx
 * <Text style={{ ...iosFontStyle('600'), fontSize: 17 }}>Headline</Text>
 * ```
 *
 * The duo is needed because iOS resolves SF Pro variants from `fontWeight`,
 * while Android needs the explicit `fontFamily` face name (`iosFont()` handles
 * the platform branch). Use this in non-greenfield code as a one-for-one
 * replacement for legacy `fontFamily: 'InterTight_*Bold'` / `'Newsreader_*'`
 * strings.
 */
export function iosFontStyle(weight: IosFontWeight = '400'): TextStyle {
  return { fontFamily: iosFont(weight), fontWeight: weight };
}

/** Italic variant of `iosFontStyle`. */
export function iosFontStyleItalic(weight: IosFontWeight = '400'): TextStyle {
  return { fontFamily: iosFontItalic(weight), fontWeight: weight, fontStyle: 'italic' };
}
