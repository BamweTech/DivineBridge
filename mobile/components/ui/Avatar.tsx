import { View, Text } from 'react-native';
import { Image } from 'expo-image';
import { THEME_COLORS } from '@/lib/constants';

const AVATAR_COLORS = [
  '#b07d20', '#4a7c5e', '#7040b8', '#b05a50',
  '#5a7fb0', '#6b8c5e', '#9060b0', '#b07a40',
];

function getColorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

interface AvatarProps {
  name: string;
  photoUrl?: string;
  size?: number;
  showSpeakingRing?: boolean;
  isOnline?: boolean;
}

export function Avatar({ name, photoUrl, size = 40, showSpeakingRing, isOnline }: AvatarProps) {
  const ringSize = size + 6;

  return (
    <View style={{ width: ringSize, height: ringSize, alignItems: 'center', justifyContent: 'center' }}>
      {showSpeakingRing && (
        <View
          style={{
            position: 'absolute',
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderWidth: 2,
            borderColor: THEME_COLORS.speaking,
          }}
        />
      )}
      {photoUrl ? (
        <Image
          source={{ uri: photoUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          contentFit="cover"
        />
      ) : (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: getColorFromName(name),
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              color: '#fff',
              fontFamily: 'Geist_700Bold',
              fontSize: size * 0.36,
              lineHeight: size * 0.36 * 1.2,
            }}
          >
            {getInitials(name)}
          </Text>
        </View>
      )}
      {isOnline && (
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: size * 0.28,
            height: size * 0.28,
            borderRadius: (size * 0.28) / 2,
            backgroundColor: THEME_COLORS.online,
            borderWidth: 2,
            borderColor: THEME_COLORS.bg,
          }}
        />
      )}
    </View>
  );
}
