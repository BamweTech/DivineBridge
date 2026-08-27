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
import { TYPE, iosFont, iosFontStyle, iosFontStyleItalic } from '@/lib/typography';
import { devotionalApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassPill } from '@/components/ui/GlassPill';
import { useAuthStore } from '@/stores/authStore';
import Icon from '@/components/ui/Icon';
import type { DevotionalPlan, DevotionalDay } from '@/types';
import { useSpeechPlayback } from '@/features/prayer/hooks/useSpeechPlayback';
import { useFocusEffect } from 'expo-router';
import { readDevotionalCache, writeDevotionalCache } from '@/lib/devotionalCache';
import { syncDevotionalReminder } from '@/lib/devotionalReminder';

const THEMES = [
  'Faith & Trust', 'Healing & Restoration', 'Peace & Stillness',
  'Purpose & Calling', 'Gratitude & Worship', 'Family & Relationships',
  'Spiritual Growth', 'Hope & Perseverance',
];

function tsToMs(ts: unknown): number {
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    return ts < 1e12 ? ts * 1000 : ts;
  }
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (ts && typeof ts === 'object') {
    const obj = ts as { toMillis?: () => number; seconds?: number; _seconds?: number };
    if (typeof obj.toMillis === 'function') return obj.toMillis();
    const seconds = obj.seconds ?? obj._seconds;
    if (typeof seconds === 'number') return seconds * 1000;
  }
  return 0;
}

/** Current schedule start: restart uses started_at; older plans fall back to created_at. */
function getScheduleStartMs(plan: DevotionalPlan): number {
  return tsToMs(plan.started_at) || tsToMs(plan.created_at) || Date.now();
}

/** Plan day index (1-based) that falls on the user's local calendar date today, clamped to the plan. */
function getCalendarTodayPlanDay(plan: DevotionalPlan): number {
  const planStart = dayjs(getScheduleStartMs(plan)).startOf('day');
  const today = dayjs().startOf('day');
  const idx = today.diff(planStart, 'day') + 1;
  return Math.min(plan.duration, Math.max(1, idx));
}

function getLatestCompletedDay(plan: DevotionalPlan): number {
  return plan.days.reduce((latest, day) => (
    day.completed && day.day > latest ? day.day : latest
  ), 0);
}

/**
 * Where the carousel should open.
 * 1. Behind — first incomplete day (catch-up).
 * 2. Today still open — today.
 * 3. Finished today only — stay on today (day-by-day rest).
 * 4. Worked ahead of the calendar — next day after the latest completion.
 */
function getLandingPlanDay(plan: DevotionalPlan): number {
  const calendarToday = getCalendarTodayPlanDay(plan);
  const latestCompleted = getLatestCompletedDay(plan);

  const firstIncomplete = plan.days
    .filter((d) => !d.completed)
    .map((d) => d.day)
    .sort((a, b) => a - b)[0];

  if (firstIncomplete != null && firstIncomplete < calendarToday) {
    return firstIncomplete;
  }
  if (latestCompleted < calendarToday) {
    return calendarToday;
  }
  if (latestCompleted > calendarToday) {
    return Math.min(latestCompleted + 1, plan.duration);
  }
  return calendarToday;
}

function isPlanActive(plan: DevotionalPlan): boolean {
  const done = plan.days.filter((d) => d.completed).length;
  return plan.status === 'active' || (!plan.completed_at && done < plan.duration);
}

/** Newest active plan by current schedule start. Restarted plans take priority. */
function pickLatestActivePlan(plans: DevotionalPlan[]): DevotionalPlan | null {
  const active = plans.filter(isPlanActive);
  if (active.length === 0) return null;
  return active.reduce((newest, plan) =>
    getScheduleStartMs(plan) > getScheduleStartMs(newest) ? plan : newest
  );
}

function planDayDate(plan: DevotionalPlan, dayNumber: number) {
  return dayjs(getScheduleStartMs(plan)).add(dayNumber - 1, 'day');
}

// ─── Day selector (synced with pager) ────────────────────────────────────────

const DAY_CHIP_WIDTH = 62;
const DAY_CHIP_GAP = 8;

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
  const planStartDate = dayjs(getScheduleStartMs(plan));
  const dayNumbers = useMemo(() => Array.from({ length: plan.duration }, (_, i) => i + 1), [plan.duration]);

  useEffect(() => {
    const idx = Math.max(0, selectedDay - 1);
    scrollRef.current?.scrollTo({ x: Math.max(0, idx * (DAY_CHIP_WIDTH + DAY_CHIP_GAP) - 80), animated: true });
  }, [selectedDay]);

  return (
    <View style={{ marginBottom: 8 }}>
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 22, gap: DAY_CHIP_GAP, paddingBottom: 2 }}>
        {dayNumbers.map((dayNum) => {
          const dayData = plan.days.find((d) => d.day === dayNum);
          const isCalendarToday = dayNum === calendarTodayDay;
          const isSelected = dayNum === selectedDay;
          const isDone = dayData?.completed ?? false;
          const dayDate = planStartDate.add(dayNum - 1, 'day');
          const dayName = dayDate.format('ddd').substring(0, 3).toUpperCase();
          return (
            <Pressable
              key={dayNum}
              onPress={() => { onSelectDay(dayNum); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              style={{
                width: DAY_CHIP_WIDTH,
                paddingTop: 10,
                paddingBottom: 8,
                paddingHorizontal: 6,
                borderRadius: 14,
                alignItems: 'center',
                backgroundColor: isSelected ? THEME_COLORS.goldDim : THEME_COLORS.bg2,
                borderWidth: 1,
                borderColor: isSelected ? THEME_COLORS.gold : isCalendarToday ? THEME_COLORS.goldBorder : THEME_COLORS.border,
              }}
            >
              <Text
                style={{
                  position: 'absolute',
                  top: 5,
                  right: 6,
                  ...TYPE.caption2,
                  fontSize: 9,
                  color: isSelected || isCalendarToday ? THEME_COLORS.gold : THEME_COLORS.text3,
                }}
              >
                {dayNum}
              </Text>
              <Text style={{ color: THEME_COLORS.text3, fontSize: 10, ...iosFontStyle('600'), textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{dayName}</Text>
              <Text style={{ color: isSelected || isCalendarToday ? THEME_COLORS.gold : THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 18, marginTop: 2 }}>
                {dayDate.format('D')}
              </Text>
              <View style={{ width: 5, height: 5, borderRadius: 2.5, marginTop: 5, backgroundColor: isDone ? THEME_COLORS.sage : isCalendarToday ? THEME_COLORS.gold : THEME_COLORS.border }} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Today's reading (verse-first, editorial) ────────────────────────────────

function TodayReading({
  day,
  isCalendarToday,
  showCheckIn,
  planId,
  dayDateLabel,
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
  dayDateLabel: string;
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
    <Animated.View entering={FadeIn.duration(320)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {isCalendarToday ? (
            <GlassPill tone="gold" radius={999} style={{ paddingHorizontal: 10, paddingVertical: 5 }}>
              <Text style={{ ...TYPE.capsLabel, color: THEME_COLORS.gold }}>Today</Text>
            </GlassPill>
          ) : (
            <Text style={{ ...TYPE.capsLabel, color: THEME_COLORS.text3 }}>Day {day.day}</Text>
          )}
          <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3 }}>{dayDateLabel}</Text>
        </View>
        {day.completed && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Icon name="cross" size={11} color={THEME_COLORS.sage} />
            <Text style={{ ...TYPE.caption1, color: THEME_COLORS.sage, fontWeight: '600', fontFamily: iosFont('600') }}>Complete</Text>
          </View>
        )}
      </View>

      <Text style={{ ...TYPE.title2, color: THEME_COLORS.text, marginBottom: 22 }}>{day.title}</Text>

      <View style={{ borderLeftWidth: 2, borderLeftColor: THEME_COLORS.gold, paddingLeft: 16, marginBottom: 28 }}>
        <Text
          style={{
            ...iosFontStyleItalic('400'),
            fontSize: 24,
            lineHeight: 34,
            letterSpacing: -0.4,
            color: THEME_COLORS.text,
          }}
        >
          &ldquo;{day.scripture}&rdquo;
        </Text>
        <Text style={{ ...TYPE.capsLabel, color: THEME_COLORS.gold, marginTop: 16, letterSpacing: 1.4, fontSize: 12 }}>
          — {day.scripture_reference}
        </Text>
      </View>

      <Text style={{ ...TYPE.capsLabel, color: THEME_COLORS.text3, marginBottom: 10 }}>Reflection</Text>
      <Text style={{ ...TYPE.body, color: THEME_COLORS.text2, lineHeight: 26, marginBottom: 24 }}>
        {day.reflection}
      </Text>

      <Text style={{ ...TYPE.capsLabel, color: THEME_COLORS.text3, marginBottom: 10 }}>Prayer</Text>
      <GlassCard tone="sage" intensity="card" radius={18} style={{ padding: 16, marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <Icon name="pray" size={15} color={THEME_COLORS.sage} style={{ marginTop: 3 }} />
          <Text style={{ flex: 1, ...TYPE.body, color: THEME_COLORS.text, lineHeight: 26 }}>{day.prayer}</Text>
        </View>
      </GlassCard>

      <Pressable
        onPress={() => setJournalOpen((v) => !v)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingVertical: 8 }}
      >
        <Icon name="edit" size={13} color={THEME_COLORS.gold} />
        <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('600'), fontSize: 14, flex: 1 }}>My Reflections</Text>
        {saveStatus === 'saving' && <Text style={{ ...TYPE.caption1, color: THEME_COLORS.text3 }}>Saving...</Text>}
        {saveStatus === 'saved' && <Text style={{ ...TYPE.caption1, color: THEME_COLORS.sage }}>Saved</Text>}
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
            backgroundColor: THEME_COLORS.bg2,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: THEME_COLORS.border,
            color: THEME_COLORS.text,
            ...TYPE.body,
            lineHeight: 24,
            paddingHorizontal: 14,
            paddingVertical: 12,
            marginTop: 4,
            minHeight: 110,
          }}
        />
      )}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 18 }}>
        <Pressable
          onPress={onListen}
          style={{
            flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
            paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: THEME_COLORS.goldBorder, backgroundColor: THEME_COLORS.goldDim,
          }}
        >
          <Icon name="audio" size={14} color={THEME_COLORS.gold} />
          <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('600'), fontSize: 13 }}>{listenLabel}</Text>
        </Pressable>
        <Pressable
          onPress={handleShare}
          style={{
            flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
            paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: THEME_COLORS.border, backgroundColor: THEME_COLORS.bg2,
          }}
        >
          <Icon name="share" size={14} color={THEME_COLORS.text2} />
          <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('600'), fontSize: 13 }}>Share</Text>
        </Pressable>
        <Pressable
          onPress={onOpenReading}
          accessibilityLabel="Open reading mode"
          style={{
            width: 48, alignItems: 'center', justifyContent: 'center',
            paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: THEME_COLORS.border, backgroundColor: THEME_COLORS.bg2,
          }}
        >
          <Icon name="book" size={16} color={THEME_COLORS.text2} />
        </Pressable>
      </View>

      {showCheckIn && !day.completed && (
        <Button label="Mark as Complete" onPress={onCheckIn} style={{ marginTop: 18 }} size="md" fullWidth />
      )}
    </Animated.View>
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
          <Text style={{ color: '#d4c9b0', ...iosFontStyle('500'), fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Day {day.day}</Text>
          <Text style={{ color: '#f5edd8', ...iosFontStyle('700'), fontSize: 24, marginBottom: 28, letterSpacing: -0.5 }}>{day.title}</Text>

          <View style={{ backgroundColor: 'rgba(176,125,32,0.12)', borderRadius: 16, padding: 20, marginBottom: 28 }}>
            <Text style={{ color: '#f5edd8', ...iosFontStyle('400'), fontSize: 18, lineHeight: 30, fontStyle: 'italic', marginBottom: 10 }}>
              &ldquo;{day.scripture}&rdquo;
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: '#b07d20', ...iosFontStyle('600'), fontSize: 13, letterSpacing: 0.5 }}>
                &mdash; {day.scripture_reference}
              </Text>
              <Pressable
                onPress={() => { Share.share({ message: `\u201c${day.scripture}\u201d\n\u2014 ${day.scripture_reference}\n\nDivine Bridge` }).catch(() => null); }}
                hitSlop={8}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, backgroundColor: 'rgba(176,125,32,0.2)' }}
              >
                <Icon name="share" size={11} color="#b07d20" />
                <Text style={{ color: '#b07d20', ...iosFontStyle('500'), fontSize: 11 }}>Share verse</Text>
              </Pressable>
            </View>
          </View>

          <Text style={{ color: '#c9bea8', ...iosFontStyle('400'), fontSize: 18, lineHeight: 32, marginBottom: 28 }}>{day.reflection}</Text>

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
            <Icon name="pray" size={16} color="#b07d20" style={{ marginTop: 5 }} />
            <Text style={{ flex: 1, color: '#f5edd8', ...iosFontStyle('400'), fontSize: 18, lineHeight: 32 }}>{day.prayer}</Text>
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

        <Text style={{ color: '#f5edd8', ...iosFontStyle('700'), fontSize: 28, textAlign: 'center', marginBottom: 8, letterSpacing: -0.5 }}>Plan Complete!</Text>
        <Text style={{ color: '#c9bea8', ...iosFontStyle('400'), fontSize: 15, textAlign: 'center', lineHeight: 24, marginBottom: 32 }}>
          You finished your {plan.duration}-day journey on &ldquo;{plan.theme}&rdquo;. Well done!
        </Text>

        <View style={{ flexDirection: 'row', gap: 16, marginBottom: 36 }}>
          <View style={{ alignItems: 'center', flex: 1 }}>
            <Text style={{ color: '#b07d20', ...iosFontStyle('700'), fontSize: 28 }}>{completedDays}</Text>
            <Text style={{ color: '#9e8e78', ...iosFontStyle('400'), fontSize: 12, marginTop: 2 }}>days done</Text>
          </View>
          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />
          <View style={{ alignItems: 'center', flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="flame" size={20} color="#b07d20" />
              <Text style={{ color: '#b07d20', ...iosFontStyle('700'), fontSize: 28 }}>{plan.streak}</Text>
            </View>
            <Text style={{ color: '#9e8e78', ...iosFontStyle('400'), fontSize: 12, marginTop: 2 }}>day streak</Text>
          </View>
        </View>

        <Button label="Start a New Plan" onPress={onNewPlan} fullWidth size="lg" style={{ marginBottom: 12 }} />
        <Pressable onPress={handleShare} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 }}>
          <Icon name="share" size={14} color="#d4c9b0" />
          <Text style={{ color: '#d4c9b0', ...iosFontStyle('500'), fontSize: 14 }}>Share my journey</Text>
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
    const incomplete = plans.filter(isPlanActive);
    const completed = plans.filter((p) => !isPlanActive(p));
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
              <Text style={{ color: THEME_COLORS.violet, ...iosFontStyle('500'), fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' }}>AI-Powered</Text>
            </View>
            <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 24, letterSpacing: -0.5 }}>My Devotionals</Text>
          </View>
          <Pressable onPress={onToggleReminder} style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: reminderOn ? THEME_COLORS.goldDim : THEME_COLORS.bg3, borderWidth: 1, borderColor: reminderOn ? THEME_COLORS.goldBorder : THEME_COLORS.border, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bell" size={17} color={reminderOn ? THEME_COLORS.gold : THEME_COLORS.text3} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 96 }} showsVerticalScrollIndicator={false}>
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
            <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 16 }}>Create New Plan</Text>
            <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('400'), fontSize: 12, marginTop: 2 }}>AI-generated scripture, reflection & prayer</Text>
          </View>
          <Icon name="chevron-r" size={16} color={THEME_COLORS.gold} />
        </Pressable>

        {sorted.length === 0 && (
          <View style={{ alignItems: 'center', paddingVertical: 40 }}>
            <Icon name="book" size={32} color={THEME_COLORS.text3} style={{ marginBottom: 12 }} />
            <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 14, textAlign: 'center', lineHeight: 22 }}>
              No plans yet. Create your first{'\n'}devotional plan above.
            </Text>
          </View>
        )}

        {sorted.length > 0 && (
          <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 15, marginBottom: 12 }}>
            {sorted.length === 1 ? 'Your Plan' : 'Your Plans'}
          </Text>
        )}

        {sorted.map((p) => {
          const doneCount = p.days.filter((d) => d.completed).length;
          const isComplete = p.status !== 'active' && (!!p.completed_at || doneCount >= p.duration);
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
                <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 15, flex: 1 }} numberOfLines={1}>{p.title || p.theme}</Text>
                {isComplete ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                    <Icon name="cross" size={10} color={THEME_COLORS.sage} />
                    <Text style={{ color: THEME_COLORS.sage, ...iosFontStyle('500'), fontSize: 11 }}>Complete</Text>
                  </View>
                ) : (
                  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: THEME_COLORS.goldDim, marginLeft: 8 }}>
                    <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('600'), fontSize: 10 }}>Day {p.current_day}</Text>
                  </View>
                )}
              </View>
              <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, marginBottom: 10 }}>{p.theme}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('500'), fontSize: 12 }}>{doneCount}/{p.duration} days</Text>
                <View style={{ flex: 1, height: 4, backgroundColor: THEME_COLORS.bg3, borderRadius: 2, overflow: 'hidden' }}>
                  <View style={{ height: 4, borderRadius: 2, backgroundColor: isComplete ? THEME_COLORS.sage : THEME_COLORS.gold, width: `${progressPct}%` }} />
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Icon name="flame" size={12} color={THEME_COLORS.gold} />
                  <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('600'), fontSize: 12 }}>{p.streak}</Text>
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
        <Text style={{ color: THEME_COLORS.violet, ...iosFontStyle('500'), fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' }}>AI-Powered Plan</Text>
      </View>
      <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 26, marginBottom: 6, letterSpacing: -0.5 }}>Your Devotional Plan</Text>
      <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('400'), fontSize: 14, marginBottom: 28, lineHeight: 22 }}>
        Our AI creates a personalized plan with daily scripture, reflection, and prayer — tailored to your theme.
      </Text>

      <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('600'), fontSize: 13, marginBottom: 12 }}>Choose a Theme</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 }}>
        {THEMES.map((t) => (
          <Pressable key={t} onPress={() => setSelectedTheme(t)} style={{
            paddingHorizontal: 14, paddingVertical: 8, borderRadius: 50, borderWidth: 1,
            borderColor: selectedTheme === t ? THEME_COLORS.gold : THEME_COLORS.border,
            backgroundColor: selectedTheme === t ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
          }}>
            <Text style={{ color: selectedTheme === t ? THEME_COLORS.gold : THEME_COLORS.text2, ...iosFontStyle('500'), fontSize: 13 }}>{t}</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setSelectedTheme('custom')} style={{
          paddingHorizontal: 14, paddingVertical: 8, borderRadius: 50, borderWidth: 1,
          borderColor: selectedTheme === 'custom' ? THEME_COLORS.gold : THEME_COLORS.border,
          backgroundColor: selectedTheme === 'custom' ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
          flexDirection: 'row', alignItems: 'center', gap: 5,
        }}>
          <Icon name="edit" size={12} color={selectedTheme === 'custom' ? THEME_COLORS.gold : THEME_COLORS.text2} />
          <Text style={{ color: selectedTheme === 'custom' ? THEME_COLORS.gold : THEME_COLORS.text2, ...iosFontStyle('500'), fontSize: 13 }}>Custom</Text>
        </Pressable>
      </View>

      {selectedTheme === 'custom' && (
        <TextInput
          value={customTheme} onChangeText={setCustomTheme} placeholder="Enter your theme..." placeholderTextColor={THEME_COLORS.text3}
          style={{ backgroundColor: THEME_COLORS.bg2, borderRadius: 14, borderWidth: 1, borderColor: THEME_COLORS.border, color: THEME_COLORS.text, ...iosFontStyle('400'), fontSize: 15, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 24 }}
        />
      )}

      <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('600'), fontSize: 13, marginBottom: 12 }}>Duration</Text>
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 32 }}>
        {DEVOTIONAL_DURATIONS.map((d) => (
          <Pressable key={d} onPress={() => setDuration(d)} style={{
            flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, alignItems: 'center',
            borderColor: duration === d ? THEME_COLORS.gold : THEME_COLORS.border,
            backgroundColor: duration === d ? THEME_COLORS.goldDim : THEME_COLORS.bg3,
          }}>
            <Text style={{ color: duration === d ? THEME_COLORS.gold : THEME_COLORS.text2, ...iosFontStyle('700'), fontSize: 20 }}>{d}</Text>
            <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 11, marginTop: 2 }}>days</Text>
          </Pressable>
        ))}
      </View>

      <Button label={isGenerating ? 'Generating your plan\u2026' : 'Generate My Plan'} onPress={handleGenerate} isLoading={isGenerating} fullWidth size="lg" />
      {onDismiss && (
        <Pressable onPress={() => { if (!isGenerating) onDismiss(); }} disabled={isGenerating} style={{ marginTop: 20, alignItems: 'center', paddingVertical: 12 }}>
          <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('500'), fontSize: 14 }}>Cancel — back to my current plan</Text>
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

  // Navigation: null = hub (or auto-open today), plan = reading view
  const [viewingPlan, setViewingPlan] = useState<DevotionalPlan | null>(null);
  const [showGenerateFlow, setShowGenerateFlow] = useState(false);
  const [hubExplicit, setHubExplicit] = useState(false);
  const [preferLatest, setPreferLatest] = useState(true);

  const [selectedDay, setSelectedDay] = useState(1);
  const [readingDay, setReadingDay] = useState<DevotionalDay | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [reminderOn, setReminderOn] = useState(profile?.notifyDevotional ?? false);

  useEffect(() => {
    if (profile?.notifyDevotional !== undefined) setReminderOn(profile.notifyDevotional);
  }, [profile?.notifyDevotional]);

  const prevCompletedAtRef = useRef<number | undefined>(undefined);
  const pagerRef = useRef<FlatList>(null);
  const latestActiveRef = useRef<DevotionalPlan | null>(null);
  const selectedFromPagerRef = useRef(false);
  const prevScheduleStartRef = useRef(0);

  const { toggle: speechToggle, stop: stopSpeech, isSpeaking, activeSource } = useSpeechPlayback();

  const latestActivePlan = useMemo(() => pickLatestActivePlan(allPlans), [allPlans]);
  const activePlanCount = useMemo(() => allPlans.filter(isPlanActive).length, [allPlans]);
  latestActiveRef.current = latestActivePlan;

  // Keep viewingPlan in sync with Firestore updates
  const plan = useMemo(() => {
    if (!viewingPlan) return null;
    return allPlans.find((p) => p.plan_id === viewingPlan.plan_id) ?? viewingPlan;
  }, [viewingPlan, allPlans]);

  // Opening the tab lands on today's reading for the newest active plan.
  // Staying on the hub after tapping "Plans" is allowed until the user leaves the tab.
  useFocusEffect(
    useCallback(() => {
      setHubExplicit(false);
      setPreferLatest(true);
      const active = latestActiveRef.current;
      if (active) {
        setViewingPlan(active);
        setSelectedDay(getLandingPlanDay(active));
      }
      return () => stopSpeech();
    }, [stopSpeech])
  );

  useEffect(() => {
    if (isLoading || hubExplicit || showGenerateFlow || !latestActivePlan) return;
    if (!viewingPlan || (preferLatest && viewingPlan.plan_id !== latestActivePlan.plan_id)) {
      setViewingPlan(latestActivePlan);
      setSelectedDay(getLandingPlanDay(latestActivePlan));
      setPreferLatest(false);
    }
  }, [isLoading, hubExplicit, showGenerateFlow, viewingPlan, latestActivePlan, preferLatest]);

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
      const calendarToday = getCalendarTodayPlanDay(plan);
      // Stay on today's reading after a same-day check-in. Advance only when
      // catching up or reading ahead so a binge can continue.
      if (dayNumber !== calendarToday && dayNumber < plan.duration) {
        setSelectedDay(dayNumber + 1);
      }
    } catch (err: any) {
      Alert.alert('Check-in failed', err.message ?? 'Please try again');
    }
  }

  function handleRestartPlan() {
    if (!plan) return;
    Alert.alert(
      'Restart this plan?',
      'This starts the plan again from today as Day 1. Completion checkmarks and streak reset. Your written reflections stay.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restart Plan',
          onPress: async () => {
            try {
              await devotionalApi.restart(plan.plan_id);
              setSelectedDay(1);
              setShowCelebration(false);
              prevCompletedAtRef.current = undefined;
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch (err: any) {
              Alert.alert('Could not restart plan', err.message ?? 'Please try again');
            }
          },
        },
      ],
    );
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
    setHubExplicit(false);
    setPreferLatest(false);
    setViewingPlan(p);
    setSelectedDay(getLandingPlanDay(p));
    prevCompletedAtRef.current = p.completed_at ? tsToMs(p.completed_at) : undefined;
  }

  function openPlansHub() {
    setHubExplicit(true);
    setViewingPlan(null);
    stopSpeech();
  }

  const dayPagerData = useMemo(() => plan?.days.slice().sort((a, b) => a.day - b.day) ?? [], [plan?.days]);

  const calendarTodayPlanDay = useMemo(() => (plan ? getCalendarTodayPlanDay(plan) : 1), [plan]);
  const scheduleStartMs = plan ? getScheduleStartMs(plan) : 0;

  // Restart (or a new schedule start) should snap the carousel to the new landing day.
  useEffect(() => {
    if (!plan) return;
    if (prevScheduleStartRef.current && prevScheduleStartRef.current !== scheduleStartMs) {
      setSelectedDay(getLandingPlanDay(plan));
    }
    prevScheduleStartRef.current = scheduleStartMs;
  }, [plan, scheduleStartMs]);

  // Sync pager when selectedDay changes from strip / landing — not from a swipe.
  useEffect(() => {
    if (!plan) return;
    if (selectedFromPagerRef.current) {
      selectedFromPagerRef.current = false;
      return;
    }
    const idx = Math.max(0, selectedDay - 1);
    requestAnimationFrame(() => {
      pagerRef.current?.scrollToIndex({ index: idx, animated: true });
    });
  }, [selectedDay, plan?.plan_id]);

  const renderDayPage = useCallback(({ item: day }: { item: DevotionalDay }) => (
    <ScrollView style={{ width: screenWidth }} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 80 }} showsVerticalScrollIndicator={false}>
      <TodayReading
        day={day}
        isCalendarToday={day.day === calendarTodayPlanDay}
        showCheckIn={!day.completed}
        planId={plan?.plan_id ?? ''}
        dayDateLabel={plan ? planDayDate(plan, day.day).format('dddd, MMMM D') : ''}
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
    if (page >= 1 && page !== selectedDay) {
      selectedFromPagerRef.current = true;
      setSelectedDay(page);
    }
  }, [screenWidth, selectedDay]);

  const onScrollToIndexFailed = useCallback((info: { index: number }) => {
    setTimeout(() => {
      pagerRef.current?.scrollToIndex({ index: info.index, animated: false });
    }, 80);
  }, []);

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
            <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('600'), fontSize: 15 }}>Back to my plans</Text>
          </Pressable>
        </View>
        <GeneratePlanScreen
          onGenerated={() => {
            setRefresh((v) => v + 1);
            setShowGenerateFlow(false);
            setHubExplicit(false);
            setPreferLatest(true);
            setViewingPlan(null);
          }}
          onDismiss={exitGenerate}
        />
      </View>
    );
  }

  // Plans hub — only when there is no active plan, or the user opened it
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
      <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 22, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
          <Pressable
            onPress={openPlansHub}
            accessibilityRole="button"
            accessibilityLabel="My plans"
            style={{ paddingVertical: 8, paddingRight: 12 }}
          >
            <Text style={{ ...TYPE.headline, color: THEME_COLORS.gold, fontSize: 15 }}>Plans</Text>
          </Pressable>
          <Pressable
            onPress={activePlanCount > 1 ? openPlansHub : undefined}
            style={{ flex: 1, paddingRight: 8 }}
            accessibilityRole={activePlanCount > 1 ? 'button' : undefined}
            accessibilityLabel={activePlanCount > 1 ? 'Switch plan' : undefined}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ ...TYPE.headline, color: THEME_COLORS.text, flexShrink: 1 }} numberOfLines={1}>
                {plan.title || plan.theme}
              </Text>
              {activePlanCount > 1 && <Icon name="chevron-d" size={12} color={THEME_COLORS.text3} />}
            </View>
            <Text style={{ ...TYPE.caption1, color: THEME_COLORS.text3, marginTop: 2 }}>
              Day {plan.current_day || calendarTodayPlanDay} of {plan.duration}
              {activePlanCount > 1 ? ` · ${activePlanCount} plans` : ''}
            </Text>
          </Pressable>
          <GlassPill tone="gold" radius={12} style={{ paddingHorizontal: 10, paddingVertical: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="flame" size={13} color={THEME_COLORS.gold} />
              <Text style={{ ...TYPE.headline, color: THEME_COLORS.gold, fontSize: 15 }}>{plan.streak}</Text>
            </View>
          </GlassPill>
        </View>

        <View style={{ height: 3, backgroundColor: THEME_COLORS.bg3, borderRadius: 2, overflow: 'hidden' }}>
          <View style={{ height: 3, borderRadius: 2, backgroundColor: THEME_COLORS.gold, width: `${progressPct}%` }} />
        </View>
        <Pressable onPress={handleRestartPlan} hitSlop={8} style={{ alignSelf: 'flex-end', marginTop: 6 }}>
          <Text style={{ ...TYPE.caption1, color: THEME_COLORS.text3 }}>Restart schedule</Text>
        </Pressable>
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
          <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('500'), fontSize: 13 }}>
            {selectedDay < calendarTodayPlanDay ? 'Catching up' : `Viewing day ${selectedDay}`} ·{' '}
            <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('600') }}>Go to today (day {calendarTodayPlanDay})</Text>
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
        onScrollToIndexFailed={onScrollToIndexFailed}
        style={{ flex: 1 }}
      />

      {/* Modals */}
      {readingDay && <ReadingMode day={readingDay} onClose={() => setReadingDay(null)} />}
      {showCelebration && (
        <CompletionCelebration
          plan={plan}
          onNewPlan={() => { setShowCelebration(false); setHubExplicit(false); setViewingPlan(null); setShowGenerateFlow(true); }}
          onDismiss={() => setShowCelebration(false)}
        />
      )}
    </View>
  );
}
