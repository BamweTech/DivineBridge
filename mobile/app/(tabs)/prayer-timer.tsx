import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { usePrayerTimer } from '@/stores/prayerTimerStore';
import { THEME_COLORS } from '@/lib/constants';
import { TYPE, iosFont } from '@/lib/typography';
import Icon from '@/components/ui/Icon';

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock = [minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
  return hours > 0 ? `${hours}:${clock}` : clock;
}

export default function PrayerTimerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const startedAt = usePrayerTimer((s) => s.startedAt);
  const start = usePrayerTimer((s) => s.start);
  const stop = usePrayerTimer((s) => s.stop);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  const running = startedAt != null;
  const elapsed = running ? now - startedAt : 0;

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg, paddingTop: insets.top + 12, paddingHorizontal: 22, paddingBottom: insets.bottom + 70 }}>
      <Pressable onPress={() => router.back()} hitSlop={12}>
        <Icon name="back" size={22} color={THEME_COLORS.text2} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ ...TYPE.caption1, color: THEME_COLORS.gold, letterSpacing: 1.4 }}>PRAYER TIMER</Text>
        <Text
          style={{
            marginTop: 18,
            fontSize: 64,
            color: THEME_COLORS.text,
            fontFamily: iosFont('600'),
            fontWeight: '600',
            fontVariant: ['tabular-nums'],
          }}
        >
          {formatElapsed(elapsed)}
        </Text>
        <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3, marginTop: 8, textAlign: 'center' }}>
          {running ? 'This time keeps running if you leave the screen.' : 'A quiet clock for the time you set aside.'}
        </Text>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            if (running) stop();
            else start();
          }}
          style={{
            marginTop: 36,
            minWidth: 160,
            paddingVertical: 14,
            borderRadius: 28,
            backgroundColor: running ? THEME_COLORS.rose : THEME_COLORS.gold,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontFamily: iosFont('700'), fontWeight: '700', fontSize: 16 }}>
            {running ? 'Stop' : 'Start'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
