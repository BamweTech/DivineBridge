import { useEffect } from 'react';
import { View, Text, useWindowDimensions, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import DivineBridgeLogo from '@/components/ui/DivineBridgeLogo';
import { THEME_COLORS } from '@/lib/constants';

const LOGO_SIZE = 80;
const GAP = 18;

type Props = {
  onFinish: () => void;
};

/**
 * Post–native-splash brand moment: small centered mark scales up, then the whole
 * wordmark row shifts so the logo slides left while “Divine Bridge” fades in — keeps
 * the group centered so nothing clips on narrow screens.
 */
export default function BrandedSplashOverlay({ onFinish }: Props) {
  const { width: W } = useWindowDimensions();

  // Reserve horizontal space for the title so the row shift math matches real layout.
  const textBlock = Math.min(320, Math.max(220, W * 0.58));
  const initialRowShift = (textBlock + GAP) / 2;

  const logoScale = useSharedValue(0.6);
  const rowShift = useSharedValue(initialRowShift);
  const textOpacity = useSharedValue(0);
  const textTx = useSharedValue(12);

  useEffect(() => {
    rowShift.value = initialRowShift;

    const SCALE_MS = 480;
    const HOLD_MS = 260;
    const SLIDE_MS = 640;
    const TEXT_MS = 520;
    const DONE_AFTER = 380;

    logoScale.value = withTiming(1, {
      duration: SCALE_MS,
      easing: Easing.out(Easing.cubic),
    });

    const slideStart = SCALE_MS + HOLD_MS;
    rowShift.value = withDelay(
      slideStart,
      withTiming(0, { duration: SLIDE_MS, easing: Easing.inOut(Easing.cubic) })
    );
    textOpacity.value = withDelay(
      slideStart,
      withTiming(1, { duration: TEXT_MS, easing: Easing.out(Easing.cubic) })
    );
    textTx.value = withDelay(
      slideStart,
      withTiming(0, { duration: TEXT_MS, easing: Easing.out(Easing.cubic) })
    );

    const totalMs = slideStart + SLIDE_MS + DONE_AFTER;
    const id = setTimeout(() => onFinish(), totalMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot intro; dimensions stable at cold start
  }, []);

  const rowStyle = useAnimatedStyle(() => ({
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    transform: [{ translateX: rowShift.value }],
  }));

  const logoInnerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoScale.value }],
  }));

  const textWrapStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateX: textTx.value }],
  }));

  return (
    <View style={styles.root} pointerEvents="auto">
      <View style={styles.centerSlot}>
        <Animated.View style={rowStyle}>
          <Animated.View style={logoInnerStyle}>
            <DivineBridgeLogo size={LOGO_SIZE} color={THEME_COLORS.gold} />
          </Animated.View>
          <Animated.View style={[styles.textSlot, { marginLeft: GAP, minWidth: textBlock }, textWrapStyle]}>
            <Text
              style={styles.title}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
              numberOfLines={1}
            >
              Divine Bridge
            </Text>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#faf6ef',
    zIndex: 99999,
    elevation: 99999,
    overflow: 'visible',
  },
  centerSlot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'visible',
    paddingHorizontal: 12,
  },
  textSlot: {
    justifyContent: 'center',
    overflow: 'visible',
  },
  title: {
    color: THEME_COLORS.text,
    fontFamily: 'Newsreader_700Bold',
    fontSize: 38,
    letterSpacing: -0.5,
    width: '100%',
    textAlign: 'left',
  },
});
