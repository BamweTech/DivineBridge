import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadPrayerTimeReminder, syncPrayerTimeReminder } from '@/lib/prayerTimeReminder';
import { THEME_COLORS } from '@/lib/constants';
import { TYPE, iosFont } from '@/lib/typography';
import Icon from '@/components/ui/Icon';

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export default function PrayerReminderScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [hour, setHour] = useState(7);
  const [minute, setMinute] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPrayerTimeReminder()
      .then((saved) => {
        setHour(saved.hour);
        setMinute(saved.minute);
        setEnabled(saved.enabled);
      })
      .finally(() => setLoading(false));
  }, []);

  function shiftHour(delta: number) {
    setHour((value) => (value + delta + 24) % 24);
  }

  function shiftMinute(delta: number) {
    setMinute((value) => (value + delta + 60) % 60);
  }

  async function onToggle(next: boolean) {
    setSaving(true);
    try {
      await syncPrayerTimeReminder(next, hour, minute);
      setEnabled(next);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not save the reminder.';
      Alert.alert('Prayer reminder', message);
    } finally {
      setSaving(false);
    }
  }

  async function saveTime() {
    if (!enabled) return;
    setSaving(true);
    try {
      await syncPrayerTimeReminder(true, hour, minute);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not save the reminder.';
      Alert.alert('Prayer reminder', message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg, paddingTop: insets.top + 12, paddingHorizontal: 22, paddingBottom: insets.bottom + 70 }}>
      <Pressable onPress={() => router.back()} hitSlop={12}>
        <Icon name="back" size={22} color={THEME_COLORS.text2} />
      </Pressable>
      <Text style={{ ...TYPE.title2, color: THEME_COLORS.text, marginTop: 18 }}>Prayer reminder</Text>
      <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3, marginTop: 6 }}>
        A daily notification on this device. It does not leave the phone.
      </Text>

      {loading ? (
        <ActivityIndicator color={THEME_COLORS.gold} style={{ marginTop: 40 }} />
      ) : (
        <View style={{ marginTop: 28, backgroundColor: THEME_COLORS.bg2, borderRadius: 20, borderWidth: 1, borderColor: THEME_COLORS.border, padding: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
            <Stepper label="Hour" value={pad(hour)} onDown={() => shiftHour(-1)} onUp={() => shiftHour(1)} />
            <Text style={{ fontSize: 36, color: THEME_COLORS.text, fontFamily: iosFont('600') }}>:</Text>
            <Stepper label="Minute" value={pad(minute)} onDown={() => shiftMinute(-1)} onUp={() => shiftMinute(1)} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 22, gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: THEME_COLORS.text, fontFamily: iosFont('600'), fontSize: 15 }}>Daily reminder</Text>
              <Text style={{ ...TYPE.caption1, color: THEME_COLORS.text3, marginTop: 2 }}>
                {enabled ? `Every day at ${pad(hour)}:${pad(minute)}` : 'Off'}
              </Text>
            </View>
            {saving ? (
              <ActivityIndicator color={THEME_COLORS.gold} />
            ) : (
              <Switch
                value={enabled}
                onValueChange={(value) => { void onToggle(value); }}
                trackColor={{ false: THEME_COLORS.bg3, true: THEME_COLORS.goldDim }}
                thumbColor={enabled ? THEME_COLORS.gold : THEME_COLORS.text3}
              />
            )}
          </View>
          {enabled ? (
            <Pressable onPress={() => { void saveTime(); }} style={{ marginTop: 16, alignItems: 'center' }}>
              <Text style={{ color: THEME_COLORS.gold, fontFamily: iosFont('600'), fontSize: 14 }}>Save this time</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

function Stepper({ label, value, onDown, onUp }: { label: string; value: string; onDown: () => void; onUp: () => void }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <Pressable onPress={onUp} hitSlop={8} style={{ transform: [{ rotate: '180deg' }] }}>
        <Icon name="chevron-d" size={18} color={THEME_COLORS.gold} />
      </Pressable>
      <Text style={{ fontSize: 40, color: THEME_COLORS.text, fontFamily: iosFont('600'), fontVariant: ['tabular-nums'], marginVertical: 4 }}>{value}</Text>
      <Pressable onPress={onDown} hitSlop={8}>
        <Icon name="chevron-d" size={18} color={THEME_COLORS.gold} />
      </Pressable>
      <Text style={{ ...TYPE.caption2, color: THEME_COLORS.text3, marginTop: 4 }}>{label}</Text>
    </View>
  );
}
