import { View, Platform, type ViewStyle, type StyleProp } from 'react-native';
import { BlurView, type BlurTint } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * Cream-tinted glassmorphism primitive.
 *
 * Composition (bottom → top):
 *   1. `BlurView`           — backdrop blur (`saturate(180%) blur(16px)` equivalent)
 *   2. Tinted fill          — semi-translucent cream so type stays legible on busy backgrounds
 *   3. 0.5px hairline border (rendered as a real 1px border because RN can't render 0.5px reliably across platforms)
 *   4. 1px top-edge highlight (linear-gradient) — gives the "lit-from-above" glass feel
 *   5. `children`
 *
 * Tones map to the warm cream palette so glass surfaces look intentional on the
 * `#faf6ef` canvas. Default = neutral white-cream; `warm` = subtly warmer; `gold`
 * = devotional / verse accent.
 */

export type GlassTone = 'default' | 'warm' | 'gold' | 'sage' | 'rose';
export type GlassIntensity = 'subtle' | 'card' | 'bar' | 'heavy';

interface GlassCardProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: GlassTone;
  intensity?: GlassIntensity;
  radius?: number;
  /** Render the 1px top-edge highlight. Defaults to true. */
  highlight?: boolean;
  /** Render the hairline border. Defaults to true. */
  bordered?: boolean;
}

const TONE: Record<GlassTone, { fill: string; border: string; highlight: string }> = {
  default: {
    fill:      'rgba(255,253,247,0.55)',
    border:    'rgba(44,36,23,0.10)',
    highlight: 'rgba(255,255,255,0.72)',
  },
  warm: {
    fill:      'rgba(252,244,228,0.62)',
    border:    'rgba(44,36,23,0.10)',
    highlight: 'rgba(255,255,255,0.75)',
  },
  gold: {
    fill:      'rgba(252,243,220,0.55)',
    border:    'rgba(176,125,32,0.22)',
    highlight: 'rgba(255,238,196,0.80)',
  },
  sage: {
    fill:      'rgba(232,242,236,0.55)',
    border:    'rgba(74,124,94,0.20)',
    highlight: 'rgba(255,255,255,0.72)',
  },
  rose: {
    fill:      'rgba(247,234,232,0.55)',
    border:    'rgba(176,90,80,0.20)',
    highlight: 'rgba(255,255,255,0.70)',
  },
};

const INTENSITY: Record<GlassIntensity, number> = {
  subtle: 25,   // ambient surface
  card:   40,   // standard card
  bar:    50,   // action bar `saturate(180%) blur(16px)` equivalent
  heavy:  80,   // tab bar / sheet — `saturate(200%) blur(40px)` equivalent
};

/** Use the modern Android blur backend on API 31+ where it actually composites. */
const ANDROID_BLUR_METHOD = Platform.OS === 'android' && (Platform.Version as number) >= 31
  ? 'dimezisBlurView'
  : 'none';

export function GlassCard({
  children,
  style,
  tone = 'default',
  intensity = 'card',
  radius = 20,
  highlight = true,
  bordered = true,
}: GlassCardProps) {
  const t = TONE[tone];
  const blurIntensity = INTENSITY[intensity];
  // Light tint reads cleanly over the warm cream background.
  const blurTint: BlurTint = 'light';

  return (
    <View
      style={[
        {
          borderRadius: radius,
          overflow: 'hidden',
          backgroundColor: t.fill,
          borderWidth: bordered ? 1 : 0,
          borderColor: t.border,
        },
        style,
      ]}
    >
      <BlurView
        intensity={blurIntensity}
        tint={blurTint}
        experimentalBlurMethod={ANDROID_BLUR_METHOD}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {highlight && (
        <LinearGradient
          colors={[t.highlight, 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1 }}
        />
      )}
      {children}
    </View>
  );
}

export default GlassCard;
