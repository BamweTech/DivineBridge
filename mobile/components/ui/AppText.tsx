import { Text, type TextProps, type TextStyle } from 'react-native';
import { TYPE, type TypeVariant } from '@/lib/typography';

export interface AppTextProps extends TextProps {
  /** iOS type role — defaults to `body` if omitted. */
  variant?: TypeVariant;
  /**
   * Render digit runs with monospaced (`tabular-nums`) glyphs.
   *
   * Use for live counters, streaks, timers — anything where the number can
   * change while the surrounding layout must not jitter.
   */
  tabular?: boolean;
}

/**
 * Text wrapper that applies an iOS type role from `lib/typography.ts`.
 *
 * Inline `style` overrides the variant defaults — so `color`, `marginTop`,
 * etc. work as expected, while the font family / size / weight / leading
 * stay locked to the Apple spec unless you intentionally override them.
 */
export function AppText({ variant = 'body', tabular, style, ...rest }: AppTextProps) {
  const base: TextStyle = TYPE[variant];
  const merged: TextStyle = tabular
    ? { ...base, fontVariant: ['tabular-nums'] }
    : base;
  return <Text {...rest} style={[merged, style]} />;
}

export default AppText;
