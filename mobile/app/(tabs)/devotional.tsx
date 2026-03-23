import { useState, useEffect, useCallback, useRef } from 'react';
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
import { useSpeechPlayback } from '@/hooks/useSpeechPlayback';
import { useFocusEffect } from 'expo-router';

const THEMES = [
  'Faith & Trust', 'Healing & Restoration', 'Peace & Stillness',
  'Purpose & Calling', 'Gratitude & Worship', 'Family & Relationships',
  'Spiritual Growth', 'Hope & Perseverance',
];

// ─── Day selector (horizontal) — pick which day to read; one card below ─────────

function DaySelectorStrip({
  plan,
  selectedDay,
  onSelectDay,
}: {
  plan: DevotionalPlan;
  selectedDay: number;
  onSelectDay: (dayNum: number) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const planStartDate = plan.created_at
    ? dayjs(
        typeof plan.created_at === 'number'
          ? plan.created_at
          : (plan.created_at as { toMillis?: () => number })?.toMillis?.() ?? Date.now()
      )
    : dayjs();

  const dayNumbers = Array.from({ length: plan.duration }, (_, i) => i + 1);

  // Keep the selected pill roughly in view (especially for 14/30-day plans)
  useEffect(() => {
    const idx = Math.max(0, selectedDay - 1);
    const approxX = idx * 56;
    scrollRef.current?.scrollTo({ x: Math.max(0, approxX - 80), animated: true });
  }, [selectedDay, plan.duration]);

  return (
    <View style={{ marginBottom: 14 }}>
      <Text
        style={{
          color: THEME_COLORS.text,
          fontFamily: 'PlusJakartaSans_700Bold',
          fontSize: 13,
          marginBottom: 10,
          paddingHorizontal: 22,
        }}
      >
        Plan days
      </Text>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 22, gap: 8, paddingBottom: 4 }}
      >
        {dayNumbers.map((dayNum) => {
          const dayData = plan.days.find((d) => d.day === dayNum);
          const isPlanToday = dayNum === plan.current_day;
          const isSelected = dayNum === selectedDay;
          const isDone = dayData?.completed ?? false;
          const dayDate = planStartDate.add(dayNum - 1, 'day');
          const dayName = dayDate.format('ddd').substring(0, 3);

          return (
            <Pressable
              key={dayNum}
              onPress={() => {
                onSelectDay(dayNum);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              style={{
                minWidth: 52,
                paddingVertical: 10,
                paddingHorizontal: 10,
                borderRadius: 14,
                alignItems: 'center',
                backgroundColor: isSelected ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
                borderWidth: 2,
                borderColor: isSelected
                  ? THEME_COLORS.gold
                  : isPlanToday
                    ? THEME_COLORS.goldBorder
                    : isDone
                      ? THEME_COLORS.goldBorder
                      : THEME_COLORS.border,
              }}
            >
              <Text
                style={{
                  color: THEME_COLORS.text3,
                  fontSize: 9,
                  fontFamily: 'Geist_500Medium',
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                  marginBottom: 4,
                }}
              >
                {dayName}
              </Text>
              <Text
                style={{
                  color: isSelected || isPlanToday ? THEME_COLORS.gold : THEME_COLORS.text2,
                  fontFamily: 'PlusJakartaSans_700Bold',
                  fontSize: 16,
                }}
              >
                {dayNum}
              </Text>
              <View
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 2.5,
                  marginTop: 5,
                  backgroundColor: isDone
                    ? THEME_COLORS.sage
                    : isPlanToday
                      ? THEME_COLORS.gold
                      : THEME_COLORS.border,
                }}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Day Card ─────────────────────────────────────────────────────────────────

function DayCard({
  day,
  isToday,
  onCheckIn,
  listenLabel,
  onListen,
}: {
  day: DevotionalDay;
  isToday: boolean;
  onCheckIn: () => void;
  listenLabel: string;
  onListen: () => void;
}) {
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

      <Pressable
        onPress={onListen}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          marginTop: 14,
          paddingVertical: 10,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: THEME_COLORS.goldBorder,
          backgroundColor: THEME_COLORS.goldDim,
        }}
      >
        <Icon name="audio" size={14} color={THEME_COLORS.gold} />
        <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 13 }}>{listenLabel}</Text>
      </Pressable>

      {isToday && !day.completed && (
        <Button label="Mark as Complete" onPress={onCheckIn} style={{ marginTop: 16 }} size="sm" />
      )}
    </View>
  );
}

// ─── Generate Plan Screen ─────────────────────────────────────────────────────

function GeneratePlanScreen({
  onGenerated,
  onDismiss,
}: {
  onGenerated: () => void;
  /** When set (e.g. user already has a plan), show a way to leave without generating. */
  onDismiss?: () => void;
}) {
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

      {onDismiss && (
        <Pressable
          onPress={() => {
            if (isGenerating) return;
            onDismiss();
          }}
          disabled={isGenerating}
          style={{ marginTop: 20, alignItems: 'center', paddingVertical: 12 }}
        >
          <Text
            style={{
              color: THEME_COLORS.text3,
              fontFamily: 'Geist_500Medium',
              fontSize: 14,
            }}
          >
            Cancel — back to my current plan
          </Text>
        </Pressable>
      )}
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
  /** True while user chose "Start a New Plan" but has not finished or cancelled. */
  const [showNewPlanFlow, setShowNewPlanFlow] = useState(false);
  /** Which plan day is shown below the strip (defaults to plan's "today" when you open the tab). */
  const [selectedDay, setSelectedDay] = useState(1);
  const { toggle: speechToggle, stop: stopSpeech, isSpeaking, activeSource } = useSpeechPlayback();

  useFocusEffect(
    useCallback(() => {
      if (plan) setSelectedDay(plan.current_day);
      return () => stopSpeech();
    }, [plan?.plan_id, plan?.current_day, stopSpeech])
  );

  const handleListenDay = useCallback(
    (day: DevotionalDay) => {
      const source = `day-${day.day}`;
      speechToggle(
        [
          `Day ${day.day}. ${day.title}`,
          day.scripture,
          `Reference: ${day.scripture_reference}`,
          day.reflection,
          day.prayer,
        ],
        source
      );
    },
    [speechToggle]
  );

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

  if (showNewPlanFlow) {
    const exitNewPlan = () => {
      setShowNewPlanFlow(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    };
    return (
      <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}>
        <View
          style={{
            paddingTop: insets.top + 8,
            paddingHorizontal: 22,
            paddingBottom: 4,
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Pressable
            onPress={exitNewPlan}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingVertical: 10,
              paddingRight: 16,
            }}
            accessibilityRole="button"
            accessibilityLabel="Back to current devotional plan"
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                backgroundColor: THEME_COLORS.bg3,
                borderWidth: 1,
                borderColor: THEME_COLORS.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="back" size={16} color={THEME_COLORS.text2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_600SemiBold', fontSize: 15 }}>
                Back to current plan
              </Text>
              <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {plan.theme}
              </Text>
            </View>
          </Pressable>
        </View>
        <GeneratePlanScreen
          onGenerated={() => {
            setRefresh((v) => v + 1);
            setShowNewPlanFlow(false);
          }}
          onDismiss={exitNewPlan}
        />
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
        <DaySelectorStrip
          plan={plan}
          selectedDay={selectedDay}
          onSelectDay={setSelectedDay}
        />

        <View style={{ paddingHorizontal: 22 }}>
          {selectedDay !== plan.current_day && (
            <Pressable
              onPress={() => {
                setSelectedDay(plan.current_day);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 10,
                paddingHorizontal: 14,
                marginBottom: 12,
                borderRadius: 14,
                backgroundColor: THEME_COLORS.bg3,
                borderWidth: 1,
                borderColor: THEME_COLORS.border,
              }}
            >
              <Icon name="book" size={14} color={THEME_COLORS.gold} />
              <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_500Medium', fontSize: 13 }}>
                Viewing day {selectedDay} ·{' '}
                <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold' }}>Go to today (day {plan.current_day})</Text>
              </Text>
            </Pressable>
          )}

          {(() => {
            const day = plan.days.find((d) => d.day === selectedDay);
            if (!day) {
              return (
                <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 14, textAlign: 'center', paddingVertical: 24 }}>
                  This day is not available yet.
                </Text>
              );
            }
            return (
              <Animated.View key={day.day} entering={FadeInDown.duration(350)}>
                <DayCard
                  day={day}
                  isToday={day.day === plan.current_day}
                  onCheckIn={() => handleCheckIn(day.day)}
                  listenLabel={activeSource === `day-${day.day}` && isSpeaking ? 'Stop' : 'Listen'}
                  onListen={() => handleListenDay(day)}
                />
              </Animated.View>
            );
          })()}

          <Button
            label="Start a New Plan"
            onPress={() => setShowNewPlanFlow(true)}
            variant="secondary"
            fullWidth
            style={{ marginTop: 8 }}
          />
        </View>
      </ScrollView>
    </View>
  );
}
