import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { RTCView } from '@/lib/sfu';
import { THEME_COLORS } from '@/lib/constants';

/** Minimal shape for react-native-webrtc MediaStream in UI. */
export interface StreamLike {
  toURL: () => string;
}

type Props = {
  stream: StreamLike | null | undefined;
  style?: StyleProp<ViewStyle>;
  objectFit?: 'cover' | 'contain';
  /** Use for local front-camera preview. */
  mirror?: boolean;
  label?: string;
};

/**
 * Single place to render SFU/WebRTC video for prayer rooms (and future group embed).
 * Uses RTCView from @/lib/sfu so Expo Go gets the stub without importing native webrtc in every screen.
 */
export function VideoStreamView({
  stream,
  style,
  objectFit = 'cover',
  mirror,
  label,
}: Props) {
  if (!stream) {
    return (
      <View style={[styles.placeholder, style]}>
        {label ? <Text style={styles.placeholderText}>{label}</Text> : null}
      </View>
    );
  }
  return (
    <View style={[styles.container, style]}>
      <RTCView
        streamURL={stream.toURL()}
        style={StyleSheet.absoluteFillObject}
        objectFit={objectFit}
        mirror={mirror}
      />
      {label ? (
        <View style={styles.labelBar} pointerEvents="none">
          <Text style={styles.labelText} numberOfLines={1}>
            {label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: THEME_COLORS.bg3,
  },
  placeholder: {
    backgroundColor: THEME_COLORS.bg3,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: THEME_COLORS.border,
  },
  placeholderText: {
    color: THEME_COLORS.text3,
    fontFamily: 'InterTight_400Regular',
    fontSize: 12,
    paddingHorizontal: 8,
    textAlign: 'center',
  },
  labelBar: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  labelText: {
    color: '#ffffff',
    fontSize: 11,
    fontFamily: 'InterTight_500Medium',
  },
});
