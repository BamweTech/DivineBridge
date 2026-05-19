import { View, Pressable, Platform, type ViewStyle, type StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';

/**
 * Compact frosted pill — used for cap labels (e.g. "DAILY VERSE"), the
 * notification bell affordance, and small status chips.
 *
 * Renders a `Pressable` if `onPress` is supplied, otherwise a plain `View`,
 * so it doubles as both a tappable button and a non-interactive label.
 */

export type GlassPillTone = 'default' | 'gold' | 'sage' | 'rose';

const TONE: Record<GlassPillTone, { fill: string; border: string }> = {
  default: { fill: 'rgba(255,253,247,0.45)', border: 'rgba(44,36,23,0.10)' },
  gold:    { fill: 'rgba(252,243,220,0.55)', border: 'rgba(176,125,32,0.30)' },
  sage:    { fill: 'rgba(232,242,236,0.55)', border: 'rgba(74,124,94,0.25)'  },
  rose:    { fill: 'rgba(247,234,232,0.55)', border: 'rgba(176,90,80,0.25)'  },
};

const ANDROID_BLUR_METHOD = Platform.OS === 'android' && (Platform.Version as number) >= 31
  ? 'dimezisBlurView'
  : 'none';

interface GlassPillProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: GlassPillTone;
  radius?: number;
  onPress?: () => void;
  accessibilityLabel?: string;
  hitSlop?: number;
}

export function GlassPill({
  children,
  style,
  tone = 'default',
  radius = 999,
  onPress,
  accessibilityLabel,
  hitSlop,
}: GlassPillProps) {
  const t = TONE[tone];
  const containerStyle: StyleProp<ViewStyle> = [
    {
      borderRadius: radius,
      overflow: 'hidden',
      backgroundColor: t.fill,
      borderWidth: 1,
      borderColor: t.border,
    },
    style,
  ];

  const inner = (
    <>
      <BlurView
        intensity={30}
        tint="light"
        experimentalBlurMethod={ANDROID_BLUR_METHOD}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 1,
          backgroundColor: 'rgba(255,255,255,0.72)',
        }}
      />
      {children}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        hitSlop={hitSlop}
        style={containerStyle}
      >
        {inner}
      </Pressable>
    );
  }

  return <View style={containerStyle}>{inner}</View>;
}

export default GlassPill;
