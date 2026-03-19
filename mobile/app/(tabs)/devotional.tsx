import { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import {
  collection,
  query,
  where,
  onSnapshot,
  limit,
} from 'firebase/firestore';
import dayjs from 'dayjs';
import { db } from '@/lib/firebase';
import { COLLECTIONS, DEVOTIONAL_DURATIONS, THEME_COLORS } from '@/lib/constants';
import { devotionalApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/stores/authStore';
import Icon from '@/components/ui/Icon';
import type { DevotionalPlan, DevotionalDay } from '@/types';

const THEMES = [
  'Faith & Trust', 'Healing & Restoration', 'Peace & Stillness',
  'Purpose & Calling', 'Gratitude & Worship', 'Family & Relationships',
  'Spiritual Growth', 'Hope & Perseverance',
];

// ─── Week Strip ────────────────────────────────────────────────────────────────

function WeekStrip({ plan }: { plan: DevotionalPlan }) {
  // Show the 7 days surrounding the current day
  const startDay = Math.max(1, plan.current_day - 3);
  const endDay = Math.min(plan.duration, startDay + 6);
  const visibleDays = Array.from({ length: endDay - startDay + 1 }, (_, i) => startDay + i);

  // Use today's date as the anchor
  const today = dayjs();
  const planStartDate = plan.created_at
    ? dayjs(typeof plan.created_at === 'number' ? plan.created_at : (plan.created_at as any)?.toMillis?.() ?? Date.now())
    : dayjs();

  return (
    <View style={{ paddingHorizontal: 22, marginBottom: 16 }}>
      <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, marginBottom: 10 }}>This Week</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {visibleDays.map((dayNum) => {
          const dayData = plan.days.find((d) => d.day === dayNum);
          const isToday = dayNum === plan.current_day;
          const isDone = dayData?.completed ?? false;
          const dayDate = planStartDate.add(dayNum - 1, 'day');
          const dayName = dayDate.format('ddd').substring(0, 3);
          const dayNum2 = dayDate.format('D');

          return (
            <View
              key={dayNum}
              style={{
                flex: 1,
                backgroundColor: isToday ? THEME_COLORS.bg2 : THEME_COLORS.bg3,
                borderWidth: 1,
                borderColor: isToday ? THEME_COLORS.gold : isDone ? THEME_COLORS.goldBorder : THEME_COLORS.border,
                borderRadius: 12,
                paddingVertical: 8,
                paddingHorizontal: 2,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: THEME_COLORS.text3, fontSize: 8, fontFamily: 'Geist_400Regular', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                {dayName}
              </Text>
              <Text style={{ color: (isToday || isDone) ? THEME_COLORS.gold : THEME_COLORS.text3, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14 }}>
                {dayNum}
              </Text>
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: (isToday || isDone) ? THEME_COLORS.gold : THEME_COLORS.border, marginTop: 4 }} />
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Day Card ─────────────────────────────────────────────────────────────────

function DayCard({ day, isToday, onCheckIn }: { day: DevotionalDay; isToday: boolean; onCheckIn: () => void }) {
  return (
    <View style={{
      backgroundColor: isToday ? '#f5edd8' : THEME_COLORS.bg2,
      borderWidth: 1,
      borderColor: isToday ? THEME_COLORS.goldBorder : THEME_COLORS.border,
      borderRadius: 20,
      padding: 20,
      marginBottom: 14,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{
            width: 28, height: 28, borderRadius: 14,
            backgroundColor: day.completed ? THEME_COLORS.gold : THEME_COLORS.bg3,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: day.completed ? THEME_COLORS.goldBorder : THEME_COLORS.border,
          }}>
            {day.completed ? (
              <Icon name="cross" size={12} color="#ffffff" />
            ) : (
              <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_700Bold', fontSize: 11 }}>{day.day}</Text>
            )}
          </View>
          {isToday && (
            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: THEME_COLORS.goldDim, borderWidth: 1, borderColor: THEME_COLORS.goldBorder }}>
              <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 10 }}>Today</Text>
            </View>
          )}
        </View>
        {day.completed && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Icon name="cross" size={12} color={THEME_COLORS.sage} />
            <Text style={{ color: THEME_COLORS.sage, fontFamily: 'Geist_500Medium', fontSize: 11 }}>Complete</Text>
          </View>
        )}
      </View>

      <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, marginBottom: 10 }}>
        {day.title}
      </Text>

      {/* Scripture card */}
      <View style={{ backgroundColor: THEME_COLORS.goldDim2, borderWidth: 1, borderColor: THEME_COLORS.goldBorder, borderRadius: 14, padding: 14, marginBottom: 12 }}>
        <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 22, fontStyle: 'italic', marginBottom: 6 }}>
          "{day.scripture}"
        </Text>
        <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 11, letterSpacing: 0.5 }}>
          — {day.scripture_reference}
        </Text>
      </View>

      <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 22, marginBottom: 12 }}>
        {day.reflection}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Icon name="pray" size={14} color={THEME_COLORS.gold} style={{ marginTop: 3 }} />
        <Text style={{ flex: 1, color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 22 }}>
          {day.prayer}
        </Text>
      </View>

      {isToday && !day.completed && (
        <Button label="Mark as Complete" onPress={onCheckIn} style={{ marginTop: 16 }} size="sm" />
      )}
    </View>
  );
}

// ─── Generate Plan Screen ─────────────────────────────────────────────────────

function GeneratePlanScreen({ onGenerated }: { onGenerated: () => void }) {
  const [selectedTheme, setSelectedTheme] = useState('');
  const [customTheme, setCustomTheme] = useState('');
  const [duration, setDuration] = useState<7 | 14 | 30>(7);
  const [isGenerating, setIsGenerating] = useState(false);
  const { user } = useAuthStore();

  async function handleGenerate() {
    const theme = selectedTheme === 'custom' ? customTheme.trim() : selectedTheme;
    if (!theme) { Alert.alert('Choose a theme to continue'); return; }
    if (!user) { Alert.alert('Sign in to generate a devotional plan'); return; }

    setIsGenerating(true);
    try {
      await devotionalApi.generate(theme, duration);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onGenerated();
    } catch (err: any) {
      Alert.alert('Generation failed', err.message ?? 'Please try again');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
      {/* AI tag */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: THEME_COLORS.violetDim, borderWidth: 1, borderColor: 'rgba(112,64,184,0.2)', borderRadius: 50, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 16 }}>
        <Icon name="sparkle" size={10} color={THEME_COLORS.violet} />
        <Text style={{ color: THEME_COLORS.violet, fontFamily: 'Geist_500Medium', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' }}>AI-Powered Plan</Text>
      </View>

      <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 26, marginBottom: 6, letterSpacing: -0.5 }}>
        Your Devotional Plan
      </Text>
      <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 14, marginBottom: 28, lineHeight: 22 }}>
        Our AI creates a personalized plan with daily scripture, reflection, and prayer — tailored to your theme.
      </Text>

      <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_600SemiBold', fontSize: 13, marginBottom: 12 }}>Choose a Theme</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 }}>
        {THEMES.map((t) => (
          <Pressable
            key={t}
            onPress={() => setSelectedTheme(t)}
            style={{
              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 50, borderWidth: 1,
              borderColor: selectedTheme === t ? THEME_COLORS.gold : THEME_COLORS.border,
              backgroundColor: selectedTheme === t ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
            }}
          >
            <Text style={{ color: selectedTheme === t ? THEME_COLORS.gold : THEME_COLORS.text2, fontFamily: 'Geist_500Medium', fontSize: 13 }}>{t}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setSelectedTheme('custom')}
          style={{
            paddingHorizontal: 14, paddingVertical: 8, borderRadius: 50, borderWidth: 1,
            borderColor: selectedTheme === 'custom' ? THEME_COLORS.gold : THEME_COLORS.border,
            backgroundColor: selectedTheme === 'custom' ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
            flexDirection: 'row', alignItems: 'center', gap: 5,
          }}
        >
          <Icon name="edit" size={12} color={selectedTheme === 'custom' ? THEME_COLORS.gold : THEME_COLORS.text2} />
          <Text style={{ color: selectedTheme === 'custom' ? THEME_COLORS.gold : THEME_COLORS.text2, fontFamily: 'Geist_500Medium', fontSize: 13 }}>Custom</Text>
        </Pressable>
      </View>

      {selectedTheme === 'custom' && (
        <TextInput
          value={customTheme}
          onChangeText={setCustomTheme}
          placeholder="Enter your theme..."
          placeholderTextColor={THEME_COLORS.text3}
          style={{
            backgroundColor: THEME_COLORS.bg2, borderRadius: 14, borderWidth: 1, borderColor: THEME_COLORS.border,
            color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 15,
            paddingHorizontal: 16, paddingVertical: 14, marginBottom: 24,
          }}
        />
      )}

      <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_600SemiBold', fontSize: 13, marginBottom: 12 }}>Duration</Text>
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 32 }}>
        {DEVOTIONAL_DURATIONS.map((d) => (
          <Pressable
            key={d}
            onPress={() => setDuration(d)}
            style={{
              flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1,
              borderColor: duration === d ? THEME_COLORS.gold : THEME_COLORS.border,
              backgroundColor: duration === d ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: duration === d ? THEME_COLORS.gold : THEME_COLORS.text2, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20 }}>{d}</Text>
            <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 11, marginTop: 2 }}>days</Text>
          </Pressable>
        ))}
      </View>

      <Button
        label={isGenerating ? 'Generating your plan…' : 'Generate My Plan'}
        onPress={handleGenerate}
        isLoading={isGenerating}
        fullWidth
        size="lg"
      />
    </ScrollView>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DevotionalScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const [plan, setPlan] = useState<DevotionalPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  // Query without orderBy to avoid composite index requirement.
  // We get all the user's plans and pick the most recent one client-side.
  useEffect(() => {
    if (!user) { setIsLoading(false); return; }

    const q = query(
      collection(db, COLLECTIONS.DEVOTIONAL_PLANS),
      where('uid', '==', user.uid),
      limit(10)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          setPlan(null);
          setIsLoading(false);
          return;
        }
        // Sort by created_at client-side, pick the latest
        const plans = snap.docs
          .map((d) => ({ plan_id: d.id, ...d.data() } as DevotionalPlan))
          .sort((a, b) => {
            const ta = typeof a.created_at === 'number' ? a.created_at : (a.created_at as any)?.toMillis?.() ?? 0;
            const tb = typeof b.created_at === 'number' ? b.created_at : (b.created_at as any)?.toMillis?.() ?? 0;
            return tb - ta;
          });
        setPlan(plans[0]);
        setIsLoading(false);
      },
      () => {
        // Error (e.g. permission) — show generate screen
        setPlan(null);
        setIsLoading(false);
      }
    );
    return unsub;
  }, [user?.uid, refresh]);

  // Check-in via the Flask API, then the onSnapshot will automatically refresh the UI
  async function handleCheckIn(dayNumber: number) {
    if (!plan) return;
    try {
      await devotionalApi.checkIn(plan.plan_id, dayNumber);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Alert.alert('Check-in failed', err.message ?? 'Please try again');
    }
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={THEME_COLORS.gold} />
      </View>
    );
  }

  if (!plan) {
    return (
      <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg, paddingTop: insets.top + 16 }}>
        <GeneratePlanScreen onGenerated={() => setRefresh((v) => v + 1)} />
      </View>
    );
  }

  const progressPct = Math.round((plan.current_day / plan.duration) * 100);

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}>
      {/* Header */}
      <Animated.View
        entering={FadeInDown.duration(400)}
        style={{ paddingTop: insets.top + 16, paddingHorizontal: 22, paddingBottom: 12 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: THEME_COLORS.violetDim, borderWidth: 1, borderColor: 'rgba(112,64,184,0.2)', borderRadius: 50, paddingHorizontal: 10, paddingVertical: 3 }}>
                <Icon name="sparkle" size={9} color={THEME_COLORS.violet} />
                <Text style={{ color: THEME_COLORS.violet, fontFamily: 'Geist_500Medium', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' }}>AI Plan</Text>
              </View>
            </View>
            <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 22, letterSpacing: -0.5 }}>My Devotional</Text>
            <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 13, marginTop: 2 }}>{plan.theme}</Text>
          </View>
          <View style={{ alignItems: 'center', backgroundColor: THEME_COLORS.goldDim, borderWidth: 1, borderColor: THEME_COLORS.goldBorder, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="flame" size={16} color={THEME_COLORS.gold} />
              <Text style={{ color: THEME_COLORS.gold, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18 }}>{plan.streak}</Text>
            </View>
            <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 10 }}>day streak</Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={{ height: 4, backgroundColor: THEME_COLORS.bg3, borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: THEME_COLORS.gold, width: `${progressPct}%` }} />
        </View>
        <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 12 }}>
          Day {plan.current_day} of {plan.duration} · {progressPct}% complete
        </Text>
      </Animated.View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Week strip */}
        <WeekStrip plan={plan} />

        {/* Day cards */}
        <View style={{ paddingHorizontal: 22 }}>
          {plan.days.map((day, i) => (
            <Animated.View key={day.day} entering={FadeInDown.delay(i * 30).duration(400)}>
              <DayCard
                day={day}
                isToday={day.day === plan.current_day}
                onCheckIn={() => handleCheckIn(day.day)}
              />
            </Animated.View>
          ))}

          <Button
            label="Start a New Plan"
            onPress={() => setPlan(null)}
            variant="secondary"
            fullWidth
            style={{ marginTop: 8 }}
          />
        </View>
      </ScrollView>
    </View>
  );
}
