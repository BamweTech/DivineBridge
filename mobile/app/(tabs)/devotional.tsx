import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Pressable,
  Alert,
  ActivityIndicator,
  TextInput,
  Share,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, SlideInUp, SlideOutDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import {
  collection,
  query,
  where,
  onSnapshot,
  limit,
  doc,
  updateDoc,
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
import { readDevotionalCache, writeDevotionalCache } from '@/lib/devotionalCache';
import { syncDevotionalReminder } from '@/lib/devotionalReminder';

const THEMES = [
  'Faith & Trust', 'Healing & Restoration', 'Peace & Stillness',
  'Purpose & Calling', 'Gratitude & Worship', 'Family & Relationships',
  'Spiritual Growth', 'Hope & Perseverance',
];

function tsToMs(ts: unknown): number {
  if (typeof ts === 'number') return ts;
  if (ts && typeof (ts as any).toMillis === 'function') return (ts as any).toMillis();
  return 0;
}

/** Plan day index (1-based) that falls on the user's local calendar date today, clamped to the plan. */
function getCalendarTodayPlanDay(plan: DevotionalPlan): number {
  const planStart = plan.created_at
    ? dayjs(tsToMs(plan.created_at)).startOf('day')
    : dayjs().startOf('day');
  const today = dayjs().startOf('day');
  const idx = today.diff(planStart, 'day') + 1;
  return Math.min(plan.duration, Math.max(1, idx));
}

// ─── Day selector (synced with pager) ────────────────────────────────────────

function DaySelectorStrip({
  plan,
  selectedDay,
  calendarTodayDay,
  onSelectDay,
}: {
  plan: DevotionalPlan;
  selectedDay: number;
  /** Plan day that matches today's local calendar date (strip highlight). */
  calendarTodayDay: number;
  onSelectDay: (dayNum: number) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const planStartDate = plan.created_at ? dayjs(tsToMs(plan.created_at)) : dayjs();
  const dayNumbers = useMemo(() => Array.from({ length: plan.duration }, (_, i) => i + 1), [plan.duration]);

  useEffect(() => {
    const idx = Math.max(0, selectedDay - 1);
    scrollRef.current?.scrollTo({ x: Math.max(0, idx * 56 - 80), animated: true });
  }, [selectedDay]);

  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, marginBottom: 10, paddingHorizontal: 22 }}>
        Plan days
      </Text>
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 22, gap: 8, paddingBottom: 4 }}>
        {dayNumbers.map((dayNum) => {
          const dayData = plan.days.find((d) => d.day === dayNum);
          const isCalendarToday = dayNum === calendarTodayDay;
          const isSelected = dayNum === selectedDay;
          const isDone = dayData?.completed ?? false;
          const dayDate = planStartDate.add(dayNum - 1, 'day');
          const dayName = dayDate.format('ddd').substring(0, 3);
          return (
            <Pressable
              key={dayNum}
              onPress={() => { onSelectDay(dayNum); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={{
                minWidth: 52, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 14, alignItems: 'center',
                backgroundColor: isSelected ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
                borderWidth: 2,
                borderColor: isSelected ? THEME_COLORS.gold : isCalendarToday ? THEME_COLORS.goldBorder : isDone ? THEME_COLORS.goldBorder : THEME_COLORS.border,
              }}
            >
              <Text style={{ color: THEME_COLORS.text3, fontSize: 9, fontFamily: 'Geist_500Medium', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>{dayName}</Text>
              <Text style={{ color: isSelected || isCalendarToday ? THEME_COLORS.gold : THEME_COLORS.text2, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16 }}>{dayNum}</Text>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, marginTop: 5, backgroundColor: isDone ? THEME_COLORS.sage : isCalendarToday ? THEME_COLORS.gold : THEME_COLORS.border }} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Day Card (enhanced with journal, share, reading mode) ───────────────────

function DayCard({
  day,
  isCalendarToday,
  showCheckIn,
  planId,
  onCheckIn,
  listenLabel,
  onListen,
  onOpenReading,
}: {
  day: DevotionalDay;
  /** Matches today's local calendar date within the plan timeline. */
  isCalendarToday: boolean;
  /** This day is the server's current check-in step (Mark complete). */
  showCheckIn: boolean;
  planId: string;
  onCheckIn: () => void;
  listenLabel: string;
  onListen: () => void;
  onOpenReading: () => void;
}) {
  const [journalText, setJournalText] = useState(day.journal ?? '');
  const [journalOpen, setJournalOpen] = useState(!!(day.journal));
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setJournalText(day.journal ?? ''); }, [day.journal]);

  const handleJournalChange = useCallback((text: string) => {
    setJournalText(text);
    setSaveStatus('idle');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        await devotionalApi.saveJournal(planId, day.day, text);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('idle');
      }
    }, 1500);
  }, [planId, day.day]);

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  function handleShare() {
    const text = `Day ${day.day}: ${day.title}\n\n"${day.scripture}"\n\u2014 ${day.scripture_reference}\n\n${day.reflection.slice(0, 200)}${day.reflection.length > 200 ? '...' : ''}\n\nFrom my devotional on Divine Bridge`;
    Share.share({ message: text }).catch(() => null);
  }

  return (
    <View style={{
      backgroundColor: isCalendarToday ? '#f5edd8' : THEME_COLORS.bg2,
      borderWidth: 1, borderColor: isCalendarToday ? THEME_COLORS.goldBorder : THEME_COLORS.border,
      borderRadius: 20, padding: 20, marginBottom: 14,
    }}>
      {/* Header row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{
            width: 28, height: 28, borderRadius: 14,
            backgroundColor: day.completed ? THEME_COLORS.gold : THEME_COLORS.bg3,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: day.completed ? THEME_COLORS.goldBorder : THEME_COLORS.border,
          }}>
            {day.completed
              ? <Icon name="cross" size={12} color="#ffffff" />
              : <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_700Bold', fontSize: 11 }}>{day.day}</Text>
            }
          </View>
          {isCalendarToday && (
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

      <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, marginBottom: 10 }}>{day.title}</Text>

      {/* Scripture */}
      <View style={{ backgroundColor: THEME_COLORS.goldDim2, borderWidth: 1, borderColor: THEME_COLORS.goldBorder, borderRadius: 14, padding: 14, marginBottom: 12 }}>
        <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 22, fontStyle: 'italic', marginBottom: 6 }}>
          &ldquo;{day.scripture}&rdquo;
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 11, letterSpacing: 0.5 }}>
            &mdash; {day.scripture_reference}
          </Text>
          <Pressable
            onPress={() => { Share.share({ message: `\u201c${day.scripture}\u201d\n\u2014 ${day.scripture_reference}\n\nDivine Bridge` }).catch(() => null); }}
            hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 8, backgroundColor: THEME_COLORS.goldDim }}
          >
            <Icon name="share" size={10} color={THEME_COLORS.gold} />
            <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_500Medium', fontSize: 10 }}>Share verse</Text>
          </Pressable>
        </View>
      </View>

      {/* Reflection */}
      <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 22, marginBottom: 12 }}>{day.reflection}</Text>

      {/* Prayer */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <Icon name="pray" size={14} color={THEME_COLORS.gold} style={{ marginTop: 3 }} />
        <Text style={{ flex: 1, color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 22 }}>{day.prayer}</Text>
      </View>

      {/* Journal */}
      <Pressable
        onPress={() => setJournalOpen((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, paddingVertical: 6 }}
      >
        <Icon name="edit" size={13} color={THEME_COLORS.gold} />
        <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 13, flex: 1 }}>My Reflections</Text>
        {saveStatus === 'saving' && <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 11 }}>Saving...</Text>}
        {saveStatus === 'saved' && <Text style={{ color: THEME_COLORS.sage, fontFamily: 'Geist_400Regular', fontSize: 11 }}>Saved</Text>}
        <Icon name={journalOpen ? 'chevron-d' : 'chevron-r'} size={12} color={THEME_COLORS.text3} />
      </Pressable>
      {journalOpen && (
        <TextInput
          value={journalText}
          onChangeText={handleJournalChange}
          placeholder="Write your personal reflection..."
          placeholderTextColor={THEME_COLORS.text3}
          multiline
          textAlignVertical="top"
          style={{
            backgroundColor: THEME_COLORS.bg3, borderRadius: 12, borderWidth: 1, borderColor: THEME_COLORS.border,
            color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 22,
            paddingHorizontal: 14, paddingVertical: 12, marginTop: 8, minHeight: 100,
          }}
        />
      )}

      {/* Action buttons */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
        <Pressable
          onPress={onListen}
          style={{
            flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
            paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: THEME_COLORS.goldBorder, backgroundColor: THEME_COLORS.goldDim,
          }}
        >
          <Icon name="audio" size={13} color={THEME_COLORS.gold} />
          <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 12 }}>{listenLabel}</Text>
        </Pressable>
        <Pressable
          onPress={handleShare}
          style={{
            flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
            paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: THEME_COLORS.border, backgroundColor: THEME_COLORS.bg3,
          }}
        >
          <Icon name="share" size={13} color={THEME_COLORS.text2} />
          <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_600SemiBold', fontSize: 12 }}>Share</Text>
        </Pressable>
        <Pressable
          onPress={onOpenReading}
          style={{
            width: 44, alignItems: 'center', justifyContent: 'center',
            paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: THEME_COLORS.border, backgroundColor: THEME_COLORS.bg3,
          }}
        >
          <Icon name="book" size={15} color={THEME_COLORS.text2} />
        </Pressable>
      </View>

      {showCheckIn && !day.completed && (
        <Button label="Mark as Complete" onPress={onCheckIn} style={{ marginTop: 16 }} size="sm" />
      )}
    </View>
  );
}

// ─── Reading Mode ────────────────────────────────────────────────────────────

function ReadingMode({ day, onClose }: { day: DevotionalDay; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="none" transparent statusBarTranslucent>
      <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={{ flex: 1, backgroundColor: '#1a1610' }}>
        <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 22, flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 8 }}>
          <Pressable onPress={onClose} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="cross" size={16} color="#d4c9b0" />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 28, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
          <Text style={{ color: '#d4c9b0', fontFamily: 'Geist_500Medium', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Day {day.day}</Text>
          <Text style={{ color: '#f5edd8', fontFamily: 'PlusJakartaSans_700Bold', fontSize: 24, marginBottom: 28, letterSpacing: -0.5 }}>{day.title}</Text>

          <View style={{ backgroundColor: 'rgba(176,125,32,0.12)', borderRadius: 16, padding: 20, marginBottom: 28 }}>
            <Text style={{ color: '#f5edd8', fontFamily: 'Geist_400Regular', fontSize: 18, lineHeight: 30, fontStyle: 'italic', marginBottom: 10 }}>
              &ldquo;{day.scripture}&rdquo;
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: '#b07d20', fontFamily: 'Geist_600SemiBold', fontSize: 13, letterSpacing: 0.5 }}>
                &mdash; {day.scripture_reference}
              </Text>
              <Pressable
                onPress={() => { Share.share({ message: `\u201c${day.scripture}\u201d\n\u2014 ${day.scripture_reference}\n\nDivine Bridge` }).catch(() => null); }}
                hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, backgroundColor: 'rgba(176,125,32,0.2)' }}
              >
                <Icon name="share" size={11} color="#b07d20" />
                <Text style={{ color: '#b07d20', fontFamily: 'Geist_500Medium', fontSize: 11 }}>Share verse</Text>
              </Pressable>
            </View>
          </View>

          <Text style={{ color: '#c9bea8', fontFamily: 'Geist_400Regular', fontSize: 18, lineHeight: 32, marginBottom: 28 }}>{day.reflection}</Text>

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <Icon name="pray" size={16} color="#b07d20" style={{ marginTop: 5 }} />
            <Text style={{ flex: 1, color: '#f5edd8', fontFamily: 'Geist_400Regular', fontSize: 18, lineHeight: 32 }}>{day.prayer}</Text>
          </View>
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

// ─── Plan Completion Celebration ─────────────────────────────────────────────

function CompletionCelebration({ plan, onNewPlan, onDismiss }: { plan: DevotionalPlan; onNewPlan: () => void; onDismiss: () => void }) {
  const insets = useSafeAreaInsets();
  useEffect(() => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }, []);

  const completedDays = plan.days.filter((d) => d.completed).length;

  function handleShare() {
    const text = `I completed a ${plan.duration}-day devotional on "${plan.theme}" with a ${plan.streak}-day streak on Divine Bridge!`;
    Share.share({ message: text }).catch(() => null);
  }

  return (
    <Modal visible animationType="none" transparent statusBarTranslucent>
      <Animated.View entering={SlideInUp.duration(400)} exiting={SlideOutDown.duration(300)} style={{ flex: 1, backgroundColor: '#1a1610', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 }}>
        <Pressable onPress={onDismiss} style={{ position: 'absolute', top: insets.top + 12, right: 22, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="cross" size={16} color="#d4c9b0" />
        </Pressable>

        <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(176,125,32,0.2)', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
          <Icon name="sparkle" size={36} color="#b07d20" />
        </View>

        <Text style={{ color: '#f5edd8', fontFamily: 'PlusJakartaSans_700Bold', fontSize: 28, textAlign: 'center', marginBottom: 8, letterSpacing: -0.5 }}>Plan Complete!</Text>
        <Text style={{ color: '#c9bea8', fontFamily: 'Geist_400Regular', fontSize: 15, textAlign: 'center', lineHeight: 24, marginBottom: 32 }}>
          You finished your {plan.duration}-day journey on &ldquo;{plan.theme}&rdquo;. Well done!
        </Text>

        <View style={{ flexDirection: 'row', gap: 16, marginBottom: 36 }}>
          <View style={{ alignItems: 'center', flex: 1 }}>
            <Text style={{ color: '#b07d20', fontFamily: 'PlusJakartaSans_700Bold', fontSize: 28 }}>{completedDays}</Text>
            <Text style={{ color: '#9e8e78', fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 2 }}>days done</Text>
          </View>
          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />
          <View style={{ alignItems: 'center', flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="flame" size={20} color="#b07d20" />
              <Text style={{ color: '#b07d20', fontFamily: 'PlusJakartaSans_700Bold', fontSize: 28 }}>{plan.streak}</Text>
            </View>
            <Text style={{ color: '#9e8e78', fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 2 }}>day streak</Text>
          </View>
        </View>

        <Button label="Start a New Plan" onPress={onNewPlan} fullWidth size="lg" style={{ marginBottom: 12 }} />
        <Pressable onPress={handleShare} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 }}>
          <Icon name="share" size={14} color="#d4c9b0" />
          <Text style={{ color: '#d4c9b0', fontFamily: 'Geist_500Medium', fontSize: 14 }}>Share my journey</Text>
        </Pressable>
      </Animated.View>
    </Modal>
  );
}

// ─── Plans Hub (default landing — list of all plans) ─────────────────────────

function PlansHub({ plans, onSelect, onCreateNew, reminderOn, onToggleReminder }: {
  plans: DevotionalPlan[];
  onSelect: (plan: DevotionalPlan) => void;
  onCreateNew: () => void;
  reminderOn: boolean;
  onToggleReminder: () => void;
}) {
  const insets = useSafeAreaInsets();

  const sorted = useMemo(() => {
    const incomplete = plans.filter((p) => {
      const done = p.days.filter((d) => d.completed).length;
      return !p.completed_at && done < p.duration;
    });
    const completed = plans.filter((p) => {
      const done = p.days.filter((d) => d.completed).length;
      return !!p.completed_at || done >= p.duration;
    });
    return [...incomplete, ...completed];
  }, [plans]);

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}>
      {/* Header */}
      <View style={{ paddingTop: insets.top + 16, paddingHorizontal: 22, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: THEME_COLORS.violetDim, borderWidth: 1, borderColor: 'rgba(112,64,184,0.2)', borderRadius: 50, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 6 }}>
              <Icon name="sparkle" size={9} color={THEME_COLORS.violet} />
              <Text style={{ color: THEME_COLORS.violet, fontFamily: 'Geist_500Medium', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' }}>AI-Powered</Text>
            </View>
            <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 24, letterSpacing: -0.5 }}>My Devotionals</Text>
          </View>
          <Pressable onPress={onToggleReminder} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: reminderOn ? THEME_COLORS.goldDim : THEME_COLORS.bg3, borderWidth: 1, borderColor: reminderOn ? THEME_COLORS.goldBorder : THEME_COLORS.border, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bell" size={17} color={reminderOn ? THEME_COLORS.gold : THEME_COLORS.text3} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        {/* Create new plan CTA */}
        <Pressable
          onPress={onCreateNew}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 12,
            backgroundColor: THEME_COLORS.goldDim, borderWidth: 1, borderColor: THEME_COLORS.goldBorder,
            borderRadius: 16, padding: 16, marginBottom: 20,
          }}
        >
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: THEME_COLORS.gold, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="plus" size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16 }}>Create New Plan</Text>
            <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 2 }}>AI-generated scripture, reflection & prayer</Text>
          </View>
          <Icon name="chevron-r" size={16} color={THEME_COLORS.gold} />
        </Pressable>

        {sorted.length === 0 && (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Icon name="book" size={32} color={THEME_COLORS.text3} style={{ marginBottom: 12 }} />
            <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 22 }}>
              No plans yet. Create your first{'\n'}devotional plan above.
            </Text>
          </View>
        )}

        {sorted.length > 0 && (
          <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, marginBottom: 12 }}>
            {sorted.length === 1 ? 'Your Plan' : 'Your Plans'}
          </Text>
        )}

        {sorted.map((p) => {
          const doneCount = p.days.filter((d) => d.completed).length;
          const isComplete = !!p.completed_at || doneCount >= p.duration;
          const progressPct = Math.round((doneCount / p.duration) * 100);
          return (
            <Pressable
              key={p.plan_id}
              onPress={() => onSelect(p)}
              style={{
                backgroundColor: !isComplete ? THEME_COLORS.bg2 : THEME_COLORS.bg3,
                borderWidth: 1, borderColor: !isComplete ? THEME_COLORS.goldBorder : THEME_COLORS.border,
                borderRadius: 16, padding: 16, marginBottom: 10,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, flex: 1 }} numberOfLines={1}>{p.title || p.theme}</Text>
                {isComplete ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                    <Icon name="cross" size={10} color={THEME_COLORS.sage} />
                    <Text style={{ color: THEME_COLORS.sage, fontFamily: 'Geist_500Medium', fontSize: 11 }}>Complete</Text>
                  </View>
                ) : (
                  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: THEME_COLORS.goldDim, marginLeft: 8 }}>
                    <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 10 }}>Day {p.current_day}</Text>
                  </View>
                )}
              </View>
              <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 12, marginBottom: 10 }}>{p.theme}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_500Medium', fontSize: 12 }}>{doneCount}/{p.duration} days</Text>
                <View style={{ flex: 1, height: 4, backgroundColor: THEME_COLORS.bg3, borderRadius: 2, overflow: 'hidden' }}>
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: isComplete ? THEME_COLORS.sage : THEME_COLORS.gold, width: `${progressPct}%` }} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Icon name="flame" size={12} color={THEME_COLORS.gold} />
                  <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold', fontSize: 12 }}>{p.streak}</Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Generate Plan Screen ────────────────────────────────────────────────────

function GeneratePlanScreen({ onGenerated, onDismiss }: { onGenerated: () => void; onDismiss?: () => void }) {
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: THEME_COLORS.violetDim, borderWidth: 1, borderColor: 'rgba(112,64,184,0.2)', borderRadius: 50, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 16 }}>
        <Icon name="sparkle" size={10} color={THEME_COLORS.violet} />
        <Text style={{ color: THEME_COLORS.violet, fontFamily: 'Geist_500Medium', fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' }}>AI-Powered Plan</Text>
      </View>
      <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 26, marginBottom: 6, letterSpacing: -0.5 }}>Your Devotional Plan</Text>
      <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 14, marginBottom: 28, lineHeight: 22 }}>
        Our AI creates a personalized plan with daily scripture, reflection, and prayer — tailored to your theme.
      </Text>

      <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_600SemiBold', fontSize: 13, marginBottom: 12 }}>Choose a Theme</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 }}>
        {THEMES.map((t) => (
          <Pressable key={t} onPress={() => setSelectedTheme(t)} style={{
            paddingHorizontal: 14, paddingVertical: 8, borderRadius: 50, borderWidth: 1,
            borderColor: selectedTheme === t ? THEME_COLORS.gold : THEME_COLORS.border,
            backgroundColor: selectedTheme === t ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
          }}>
            <Text style={{ color: selectedTheme === t ? THEME_COLORS.gold : THEME_COLORS.text2, fontFamily: 'Geist_500Medium', fontSize: 13 }}>{t}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setSelectedTheme('custom')} style={{
          paddingHorizontal: 14, paddingVertical: 8, borderRadius: 50, borderWidth: 1,
          borderColor: selectedTheme === 'custom' ? THEME_COLORS.gold : THEME_COLORS.border,
          backgroundColor: selectedTheme === 'custom' ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
          flexDirection: 'row', alignItems: 'center', gap: 5,
        }}>
          <Icon name="edit" size={12} color={selectedTheme === 'custom' ? THEME_COLORS.gold : THEME_COLORS.text2} />
          <Text style={{ color: selectedTheme === 'custom' ? THEME_COLORS.gold : THEME_COLORS.text2, fontFamily: 'Geist_500Medium', fontSize: 13 }}>Custom</Text>
        </Pressable>
      </View>

      {selectedTheme === 'custom' && (
        <TextInput
          value={customTheme} onChangeText={setCustomTheme} placeholder="Enter your theme..." placeholderTextColor={THEME_COLORS.text3}
          style={{ backgroundColor: THEME_COLORS.bg2, borderRadius: 14, borderWidth: 1, borderColor: THEME_COLORS.border, color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 15, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 24 }}
        />
      )}

      <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_600SemiBold', fontSize: 13, marginBottom: 12 }}>Duration</Text>
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 32 }}>
        {DEVOTIONAL_DURATIONS.map((d) => (
          <Pressable key={d} onPress={() => setDuration(d)} style={{
            flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, alignItems: 'center',
            borderColor: duration === d ? THEME_COLORS.gold : THEME_COLORS.border,
            backgroundColor: duration === d ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
          }}>
            <Text style={{ color: duration === d ? THEME_COLORS.gold : THEME_COLORS.text2, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20 }}>{d}</Text>
            <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 11, marginTop: 2 }}>days</Text>
          </Pressable>
        ))}
      </View>

      <Button label={isGenerating ? 'Generating your plan\u2026' : 'Generate My Plan'} onPress={handleGenerate} isLoading={isGenerating} fullWidth size="lg" />
      {onDismiss && (
        <Pressable onPress={() => { if (!isGenerating) onDismiss(); }} disabled={isGenerating} style={{ marginTop: 20, alignItems: 'center', paddingVertical: 12 }}>
          <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_500Medium', fontSize: 14 }}>Cancel — back to my current plan</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function DevotionalScreen() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { user, profile } = useAuthStore();

  const [allPlans, setAllPlans] = useState<DevotionalPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);

  // Navigation: null = plans hub, plan = detail view, 'generate' = create flow
  const [viewingPlan, setViewingPlan] = useState<DevotionalPlan | null>(null);
  const [showGenerateFlow, setShowGenerateFlow] = useState(false);

  const [selectedDay, setSelectedDay] = useState(1);
  const [readingDay, setReadingDay] = useState<DevotionalDay | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [reminderOn, setReminderOn] = useState(profile?.notifyDevotional ?? false);

  useEffect(() => {
    if (profile?.notifyDevotional !== undefined) setReminderOn(profile.notifyDevotional);
  }, [profile?.notifyDevotional]);

  const prevCompletedAtRef = useRef<number | undefined>(undefined);
  const pagerRef = useRef<FlatList>(null);

  const { toggle: speechToggle, stop: stopSpeech, isSpeaking, activeSource } = useSpeechPlayback();

  // Keep viewingPlan in sync with Firestore updates
  const plan = useMemo(() => {
    if (!viewingPlan) return null;
    return allPlans.find((p) => p.plan_id === viewingPlan.plan_id) ?? viewingPlan;
  }, [viewingPlan, allPlans]);

  useFocusEffect(
    useCallback(() => {
      if (plan) setSelectedDay(getCalendarTodayPlanDay(plan));
      return () => stopSpeech();
    }, [plan?.plan_id, plan?.duration, plan?.created_at, stopSpeech])
  );

  // Firestore subscription — all user plans, cached locally
  useEffect(() => {
    if (!user) { setIsLoading(false); return; }

    let firestoreReady = false;
    void readDevotionalCache(user.uid).then((cached) => {
      if (!firestoreReady && cached && cached.length > 0) {
        setAllPlans(cached);
        setIsLoading(false);
      }
    });

    const q = query(collection(db, COLLECTIONS.DEVOTIONAL_PLANS), where('uid', '==', user.uid), limit(20));
    const unsub = onSnapshot(q, (snap) => {
      firestoreReady = true;
      if (snap.empty) { setAllPlans([]); setIsLoading(false); return; }
      const plans = snap.docs
        .map((d) => ({ plan_id: d.id, ...d.data() } as DevotionalPlan))
        .sort((a, b) => tsToMs(b.created_at) - tsToMs(a.created_at));
      setAllPlans(plans);
      setIsLoading(false);
      void writeDevotionalCache(user.uid, plans);
    }, () => { setAllPlans([]); setIsLoading(false); });
    return unsub;
  }, [user?.uid, refresh]);

  // Detect plan completion for celebration
  useEffect(() => {
    if (!plan) return;
    const newCa = plan.completed_at ? tsToMs(plan.completed_at) : undefined;
    if (newCa && prevCompletedAtRef.current === undefined && newCa > 0) {
      setShowCelebration(true);
    }
    prevCompletedAtRef.current = newCa;
  }, [plan?.completed_at, plan?.plan_id]);

  const handleListenDay = useCallback((day: DevotionalDay) => {
    speechToggle([`Day ${day.day}. ${day.title}`, day.scripture, `Reference: ${day.scripture_reference}`, day.reflection, day.prayer], `day-${day.day}`);
  }, [speechToggle]);

  async function handleCheckIn(dayNumber: number) {
    if (!plan) return;
    try {
      await devotionalApi.checkIn(plan.plan_id, dayNumber);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Alert.alert('Check-in failed', err.message ?? 'Please try again');
    }
  }

  async function toggleReminder() {
    const newVal = !reminderOn;
    setReminderOn(newVal);
    try {
      await syncDevotionalReminder(newVal);
      if (user) {
        await updateDoc(doc(db, COLLECTIONS.USERS, user.uid), { notify_devotional: newVal }).catch(() => null);
      }
    } catch (e: any) {
      setReminderOn(!newVal);
      Alert.alert('Reminder', e.message ?? 'Could not set reminder');
    }
  }

  function openPlan(p: DevotionalPlan) {
    setViewingPlan(p);
    setSelectedDay(getCalendarTodayPlanDay(p));
    prevCompletedAtRef.current = p.completed_at ? tsToMs(p.completed_at) : undefined;
  }

  // Sync pager when selectedDay changes from strip tap
  useEffect(() => {
    if (plan) {
      const idx = Math.max(0, selectedDay - 1);
      pagerRef.current?.scrollToIndex({ index: idx, animated: true });
    }
  }, [selectedDay, plan?.plan_id]);

  const dayPagerData = useMemo(() => plan?.days.slice().sort((a, b) => a.day - b.day) ?? [], [plan?.days]);

  const calendarTodayPlanDay = useMemo(() => (plan ? getCalendarTodayPlanDay(plan) : 1), [plan]);

  const renderDayPage = useCallback(({ item: day }: { item: DevotionalDay }) => (
    <ScrollView style={{ width: screenWidth }} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
      <DayCard
        day={day}
        isCalendarToday={day.day === calendarTodayPlanDay}
        showCheckIn={day.day === (plan?.current_day ?? 1)}
        planId={plan?.plan_id ?? ''}
        onCheckIn={() => handleCheckIn(day.day)}
        listenLabel={activeSource === `day-${day.day}` && isSpeaking ? 'Stop' : 'Listen'}
        onListen={() => handleListenDay(day)}
        onOpenReading={() => setReadingDay(day)}
      />
    </ScrollView>
  ), [plan, calendarTodayPlanDay, activeSource, isSpeaking, screenWidth, insets.bottom]);

  const getItemLayout = useCallback((_: any, index: number) => ({ length: screenWidth, offset: screenWidth * index, index }), [screenWidth]);

  const onPagerScroll = useCallback((e: { nativeEvent: { contentOffset: { x: number } } }) => {
    const page = Math.round(e.nativeEvent.contentOffset.x / screenWidth) + 1;
    if (page >= 1 && page !== selectedDay) setSelectedDay(page);
  }, [screenWidth, selectedDay]);

  // ─── Render states ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={THEME_COLORS.gold} />
      </View>
    );
  }

  // Generate flow (create new plan)
  if (showGenerateFlow) {
    const exitGenerate = () => { setShowGenerateFlow(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
    return (
      <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}>
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 22, paddingBottom: 4, flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={exitGenerate} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingRight: 16 }} accessibilityRole="button" accessibilityLabel="Back to plans">
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: THEME_COLORS.bg3, borderWidth: 1, borderColor: THEME_COLORS.border, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="back" size={16} color={THEME_COLORS.text2} />
            </View>
            <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_600SemiBold', fontSize: 15 }}>Back to my plans</Text>
          </Pressable>
        </View>
        <GeneratePlanScreen
          onGenerated={() => { setRefresh((v) => v + 1); setShowGenerateFlow(false); }}
          onDismiss={exitGenerate}
        />
      </View>
    );
  }

  // Plans hub (default landing)
  if (!viewingPlan) {
    // If no plans at all, show generate screen directly
    if (allPlans.length === 0) {
      return (
        <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg, paddingTop: insets.top + 16 }}>
          <GeneratePlanScreen onGenerated={() => setRefresh((v) => v + 1)} />
        </View>
      );
    }
    return (
      <PlansHub
        plans={allPlans}
        onSelect={openPlan}
        onCreateNew={() => setShowGenerateFlow(true)}
        reminderOn={reminderOn}
        onToggleReminder={toggleReminder}
      />
    );
  }

  // ─── Plan detail view ──────────────────────────────────────────────────────

  if (!plan) return null;

  const completedDayCount = plan.days.filter((d) => d.completed).length;
  const progressPct = Math.round((completedDayCount / plan.duration) * 100);

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}>
      {/* Header with back button */}
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 22, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <Pressable
            onPress={() => { setViewingPlan(null); stopSpeech(); }}
            style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: THEME_COLORS.bg3, borderWidth: 1, borderColor: THEME_COLORS.border, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
          >
            <Icon name="back" size={16} color={THEME_COLORS.text2} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, letterSpacing: -0.3 }} numberOfLines={1}>{plan.title || plan.theme}</Text>
            <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 1 }}>{plan.theme}</Text>
          </View>
          <View style={{ alignItems: 'center', backgroundColor: THEME_COLORS.goldDim, borderWidth: 1, borderColor: THEME_COLORS.goldBorder, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Icon name="flame" size={14} color={THEME_COLORS.gold} />
              <Text style={{ color: THEME_COLORS.gold, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16 }}>{plan.streak}</Text>
            </View>
            <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 9 }}>streak</Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={{ height: 4, backgroundColor: THEME_COLORS.bg3, borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: THEME_COLORS.gold, width: `${progressPct}%` }} />
        </View>
        <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 12 }}>
          Day {plan.current_day} of {plan.duration} · {completedDayCount}/{plan.duration} done ({progressPct}%)
        </Text>
      </View>

      {/* Day selector strip */}
      <DaySelectorStrip plan={plan} selectedDay={selectedDay} calendarTodayDay={calendarTodayPlanDay} onSelectDay={setSelectedDay} />

      {/* "Go to today" banner — calendar date for this plan */}
      {selectedDay !== calendarTodayPlanDay && (
        <Pressable
          onPress={() => { setSelectedDay(calendarTodayPlanDay); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            paddingVertical: 10, paddingHorizontal: 14, marginHorizontal: 22, marginBottom: 8,
            borderRadius: 14, backgroundColor: THEME_COLORS.bg3, borderWidth: 1, borderColor: THEME_COLORS.border,
          }}
        >
          <Icon name="book" size={14} color={THEME_COLORS.gold} />
          <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_500Medium', fontSize: 13 }}>
            Viewing day {selectedDay} ·{' '}
            <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_600SemiBold' }}>Go to today (day {calendarTodayPlanDay})</Text>
          </Text>
        </Pressable>
      )}

      {/* Swipeable day pager */}
      <FlatList
        key={plan.plan_id}
        ref={pagerRef}
        data={dayPagerData}
        keyExtractor={(item) => `day-${item.day}`}
        renderItem={renderDayPage}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        getItemLayout={getItemLayout}
        initialScrollIndex={Math.max(0, selectedDay - 1)}
        onMomentumScrollEnd={onPagerScroll}
        style={{ flex: 1 }}
      />

      {/* Modals */}
      {readingDay && <ReadingMode day={readingDay} onClose={() => setReadingDay(null)} />}
      {showCelebration && (
        <CompletionCelebration
          plan={plan}
          onNewPlan={() => { setShowCelebration(false); setViewingPlan(null); setShowGenerateFlow(true); }}
          onDismiss={() => setShowCelebration(false)}
        />
      )}
    </View>
  );
}
