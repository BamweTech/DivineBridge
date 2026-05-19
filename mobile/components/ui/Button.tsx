import { Pressable, Text, ActivityIndicator, ViewStyle, StyleProp } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { THEME_COLORS } from '@/lib/constants';
import { iosFont } from '@/lib/typography';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  style?: StyleProp<ViewStyle>;
  fullWidth?: boolean;
}

const VARIANTS = {
  primary: {
    bg: THEME_COLORS.gold,
    text: '#ffffff',
    border: 'transparent',
  },
  secondary: {
    bg: THEME_COLORS.bg3,
    text: THEME_COLORS.text,
    border: THEME_COLORS.border,
  },
  ghost: {
    bg: 'transparent',
    text: THEME_COLORS.gold,
    border: 'transparent',
  },
  danger: {
    bg: 'rgba(176,90,80,0.08)',
    text: THEME_COLORS.rose,
    border: 'rgba(176,90,80,0.20)',
  },
};

const SIZES = {
  sm: { px: 16, py: 9, fontSize: 12, borderRadius: 50 },
  md: { px: 24, py: 14, fontSize: 14, borderRadius: 50 },
  lg: { px: 32, py: 16, fontSize: 15, borderRadius: 50 },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  isLoading,
  disabled,
  fullWidth,
  style,
}: ButtonProps) {
  const scale = useSharedValue(1);
  const v = VARIANTS[variant];
  const s = SIZES[size];

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <AnimatedPressable
      onPressIn={() => { scale.value = withSpring(0.96, { damping: 15 }); }}
      onPressOut={() => { scale.value = withSpring(1, { damping: 15 }); }}
      onPress={handlePress}
      disabled={disabled || isLoading}
      style={[
        animatedStyle,
        {
          backgroundColor: v.bg,
          borderRadius: s.borderRadius,
          borderWidth: v.border !== 'transparent' ? 1 : 0,
          borderColor: v.border,
          paddingHorizontal: s.px,
          paddingVertical: s.py,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          opacity: disabled ? 0.5 : 1,
          width: fullWidth ? '100%' : undefined,
        },
        style,
      ]}
    >
      {isLoading ? (
        <ActivityIndicator color={v.text} size="small" />
      ) : (
        <Text
          style={{
            color: v.text,
            fontSize: s.fontSize,
            fontFamily: iosFont('500'),
            fontWeight: '500',
            letterSpacing: 0.4,
          }}
        >
          {label}
        </Text>
      )}
    </AnimatedPressable>
  );
}
