import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ComposeModal, PrayerWallFeed } from '@/features/groups/components/PrayerWallFeed';
import { useAuthStore } from '@/stores/authStore';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle } from '@/lib/typography';
import Icon from '@/components/ui/Icon';

export default function PrayerWallScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const { compose } = useLocalSearchParams<{ compose?: string }>();
  const [showCompose, setShowCompose] = useState(compose === '1');

  useEffect(() => {
    if (compose === '1') setShowCompose(true);
  }, [compose]);

  if (showCompose) {
    return (
      <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg, paddingTop: insets.top + 8 }}>
        <ComposeModal onClose={() => setShowCompose(false)} onPosted={() => setShowCompose(false)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}>
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 22, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Icon name="back" size={22} color={THEME_COLORS.text2} />
        </Pressable>
        <Text style={{ flex: 1, color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 26, letterSpacing: -0.5 }}>
          Prayer Wall
        </Text>
        <Pressable
          onPress={() => setShowCompose(true)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 50,
            backgroundColor: THEME_COLORS.goldDim,
            borderWidth: 1,
            borderColor: THEME_COLORS.goldBorder,
          }}
        >
          <Icon name="plus" size={14} color={THEME_COLORS.gold} />
          <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('500'), fontSize: 12 }}>Pray</Text>
        </Pressable>
      </View>
      <PrayerWallFeed currentUserId={user?.uid} onCompose={() => setShowCompose(true)} />
    </View>
  );
}
