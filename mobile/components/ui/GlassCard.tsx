import { View, ViewStyle, StyleProp } from 'react-native';
import { THEME_COLORS } from '@/lib/constants';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  amber?: boolean;
  sage?: boolean;
  violet?: boolean;
}

export function GlassCard({
  children,
  className,
  style,
  amber = false,
  sage = false,
  violet = false,
}: GlassCardProps) {
  let bg = THEME_COLORS.bg2;
  let borderColor = THEME_COLORS.border;

  if (amber) {
    bg = 'rgba(176,125,32,0.06)';
    borderColor = THEME_COLORS.goldBorder;
  } else if (sage) {
    bg = THEME_COLORS.sageDim;
    borderColor = 'rgba(74,124,94,0.22)';
  } else if (violet) {
    bg = THEME_COLORS.violetDim;
    borderColor = 'rgba(112,64,184,0.18)';
  }

  return (
    <View
      className={className}
      style={[
        {
          borderRadius: 20,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor,
          backgroundColor: bg,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
