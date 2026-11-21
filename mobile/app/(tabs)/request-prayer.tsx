import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { THEME_COLORS } from '@/lib/constants';
import { TYPE, iosFont } from '@/lib/typography';
import Icon from '@/components/ui/Icon';

export default function RequestPrayerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg, paddingTop: insets.top + 12, paddingHorizontal: 22, paddingBottom: insets.bottom + 70 }}>
      <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginBottom: 18 }}>
        <Icon name="back" size={22} color={THEME_COLORS.text2} />
      </Pressable>
      <Text style={{ ...TYPE.title2, color: THEME_COLORS.text }}>Request prayer</Text>
      <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3, marginTop: 6, marginBottom: 22 }}>
        Public requests appear on the Prayer Wall. Private requests go only to a prayer warrior.
      </Text>

      <Pressable
        onPress={() => router.push('/prayer-wall?compose=1' as never)}
        style={card}
      >
        <Icon name="church" size={22} color={THEME_COLORS.gold} />
        <View style={{ flex: 1 }}>
          <Text style={title}>Public</Text>
          <Text style={detail}>Share a request on the Prayer Wall for the community.</Text>
        </View>
        <Icon name="chevron-r" size={16} color={THEME_COLORS.text3} />
      </Pressable>

      <Pressable
        onPress={() => router.push('/prayer-requests?mode=compose' as never)}
        style={card}
      >
        <Icon name="lock" size={22} color={THEME_COLORS.sage} />
        <View style={{ flex: 1 }}>
          <Text style={title}>Private</Text>
          <Text style={detail}>A warrior who speaks your language. If one accepts, a live call is scheduled at the time you choose.</Text>
        </View>
        <Icon name="chevron-r" size={16} color={THEME_COLORS.text3} />
      </Pressable>
    </View>
  );
}

const card = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 14,
  backgroundColor: THEME_COLORS.bg2,
  borderWidth: 1,
  borderColor: THEME_COLORS.border,
  borderRadius: 18,
  padding: 16,
  marginBottom: 12,
};

const title = { color: THEME_COLORS.text, fontFamily: iosFont('600'), fontWeight: '600' as const, fontSize: 16 };
const detail = { ...TYPE.footnote, color: THEME_COLORS.text3, marginTop: 4 };
