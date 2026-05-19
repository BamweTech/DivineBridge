import { View, Platform, type ViewStyle, type StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';

/**
 * Frosted action bar.
 *
 * Mirrors iOS's bottom-anchored toolbars (Photos, Mail) and the spec:
 * `backdrop-filter: saturate(180%) blur(16px)` + `rgba(255,255,255,.07)` tint
 * + 0.5px hairline border. Adapted to the warm-cream theme with a cream tint
 * (`rgba(255,253,247,0.18)`) so iconography stays legible while the background
 * shows through.
 */

interface GlassActionBarProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
}

const ANDROID_BLUR_METHOD = Platform.OS === 'android' && (Platform.Version as number) >= 31
  ? 'dimezisBlurView'
  : 'none';

export function GlassActionBar({ children, style, radius = 20 }: GlassActionBarProps) {
  return (
    <View
      style={[
        {
          borderRadius: radius,
          overflow: 'hidden',
          backgroundColor: 'rgba(255,253,247,0.18)',
          borderWidth: 1,
          borderColor: 'rgba(44,36,23,0.09)',
        },
        style,
      ]}
    >
      <BlurView
        intensity={65}
        tint="light"
        experimentalBlurMethod={ANDROID_BLUR_METHOD}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {/* Top-edge highlight — 1px hairline of near-white to mimic the lit-glass shimmer. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 1,
          backgroundColor: 'rgba(255,255,255,0.55)',
        }}
      />
      {children}
    </View>
  );
}

export default GlassActionBar;
