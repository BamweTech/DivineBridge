import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Dimensions, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import * as Haptics from 'expo-haptics';

import { Button } from '@/components/ui/Button';
import Icon from '@/components/ui/Icon';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle } from '@/lib/typography';
import { prayerWarriorApi } from '@/services/api';

const LANGUAGES = ['English', 'Spanish', 'Kirundi'] as const;
const WEEKDAYS = [
  ['sun', 'S'],
  ['mon', 'M'],
  ['tue', 'T'],
  ['wed', 'W'],
  ['thu', 'T'],
  ['fri', 'F'],
  ['sat', 'S'],
] as const;
const WEEKDAY_NAME: Record<string, string> = {
  sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday',
};

type TimeSlot = { key: string; weekdays: string[]; start: number | null; end: number | null };
type PickerEdge = 'start' | 'end';

function todayWeekday() {
  return WEEKDAYS[new Date().getDay()][0];
}

function dateFromMinute(minute: number) {
  const date = new Date();
  date.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return date;
}

function snapQuarter(date: Date) {
  const next = new Date(date);
  const remainder = next.getMinutes() % 15;
  if (remainder !== 0) next.setMinutes(next.getMinutes() + (15 - remainder));
  next.setSeconds(0, 0);
  return next.getHours() * 60 + next.getMinutes();
}

function endMinute(date: Date) {
  const minute = snapQuarter(date);
  return minute === 0 ? 24 * 60 : minute;
}

function formatMinute(minute: number) {
  return dayjs(dateFromMinute(minute)).format('h:mm A');
}

function earliestEnd(start: number) {
  return Math.min(start + 15, 24 * 60);
}

function rangeProblem(start: number | null, end: number | null) {
  if (start == null || end == null) return null;
  if (end <= start) return `End has to be later the same day. ${formatMinute(end)} is not after ${formatMinute(start)}.`;
  if (end - start < 15) return 'Leave at least 15 minutes between the start and the end.';
  return null;
}

function dayLabel(weekdays: string[]) {
  const names = WEEKDAYS.filter(([id]) => weekdays.includes(id)).map(([id]) => WEEKDAY_NAME[id].slice(0, 3));
  return names.length ? names.join(', ') : 'Choose days';
}

function groupSavedRanges(saved: { weekday: string; start_minute: number; end_minute: number }[]): TimeSlot[] {
  const groups: TimeSlot[] = [];
  saved.forEach((slot) => {
    const match = groups.find((item) => item.start === slot.start_minute && item.end === slot.end_minute);
    if (match) {
      if (!match.weekdays.includes(slot.weekday)) match.weekdays.push(slot.weekday);
      return;
    }
    groups.push({ key: `${slot.start_minute}-${slot.end_minute}-${groups.length}`, weekdays: [slot.weekday], start: slot.start_minute, end: slot.end_minute });
  });
  return groups;
}

function offered(value: string) {
  return LANGUAGES.find((item) => item.toLowerCase() === value.toLowerCase()) ?? null;
}

export default function PrayerWarriorScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const applicationQuery = useQuery({
    queryKey: ['prayer-warrior-application'],
    queryFn: prayerWarriorApi.get,
  });
  const application = applicationQuery.data?.data;
  const [languages, setLanguages] = useState<string[]>([]);
  const [church, setChurch] = useState('');
  const [note, setNote] = useState('');
  const [slots, setSlots] = useState<TimeSlot[]>([{ key: '1', weekdays: [todayWeekday()], start: null, end: null }]);
  const [openPicker, setOpenPicker] = useState<{ key: string; edge: PickerEdge } | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!application || hydrated) return;
    setLanguages(application.languages.map(offered).filter((item): item is (typeof LANGUAGES)[number] => item != null));
    setChurch(application.church || '');
    setNote(application.note || '');
    if (application.availability?.slots?.length) {
      setSlots(groupSavedRanges(application.availability.slots));
    }
    setHydrated(true);
  }, [application, hydrated]);

  const submit = useMutation({
    mutationFn: () => prayerWarriorApi.submit({
      languages,
      note: note.trim(),
      church: church.trim(),
      availability: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        slots: slots.flatMap((slot) => (
          slot.start == null || slot.end == null
            ? []
            : slot.weekdays.map((weekday) => ({ weekday, start_minute: slot.start as number, end_minute: slot.end as number }))
        )),
      },
    }),
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['prayer-warrior-application'] });
      Alert.alert('Application received', 'We will review it before you are enrolled as a prayer warrior.');
    },
    onError: (error: Error) => Alert.alert('Could not submit application', error.message),
  });

  function toggleLanguage(item: string) {
    setLanguages((current) => (current.includes(item) ? current.filter((language) => language !== item) : [...current, item]));
  }

  function send() {
    if (languages.length === 0) {
      Alert.alert('Choose a language', 'Select at least one language you can pray in.');
      return;
    }
    if (slots.some((slot) => slot.weekdays.length === 0)) {
      Alert.alert('Choose days', 'Select at least one day for each time range.');
      return;
    }
    const invalidRange = slots.map((slot) => rangeProblem(slot.start, slot.end)).find((problem) => problem != null);
    if (slots.some((slot) => slot.start == null || slot.end == null)) {
      Alert.alert('Choose a time range', 'Each range needs a start and an end.');
      return;
    }
    if (invalidRange) {
      Alert.alert('That range does not work', invalidRange);
      return;
    }
    if (note.trim().length < 10) {
      Alert.alert('Tell us a little more', 'Share a short note of at least 10 characters.');
      return;
    }
    submit.mutate();
  }

  function updateSlot(key: string, patch: Partial<TimeSlot>) {
    setSlots((current) => current.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)));
  }

  function toggleDay(key: string, day: string) {
    setSlots((current) => current.map((slot) => {
      if (slot.key !== key) return slot;
      const weekdays = slot.weekdays.includes(day)
        ? slot.weekdays.filter((item) => item !== day)
        : [...slot.weekdays, day];
      return { ...slot, weekdays };
    }));
  }

  const enrolled = application?.status === 'enrolled';
  const pending = application?.status === 'pending';
  const scrollRef = useRef<ScrollView>(null);
  const pickerAnchorRef = useRef<View>(null);
  const scrollY = useRef(0);
  const [pickerTop, setPickerTop] = useState<number | null>(null);
  const activeSlot = slots.find((slot) => slot.key === openPicker?.key) ?? null;
  const wheelMinute = !openPicker || !activeSlot
    ? snapQuarter(new Date())
    : openPicker.edge === 'start'
      ? (activeSlot.start ?? snapQuarter(new Date()))
      : (activeSlot.end != null && activeSlot.start != null && activeSlot.end >= earliestEnd(activeSlot.start)
        ? activeSlot.end
        : activeSlot.start != null
          ? Math.min(activeSlot.start + 60, 24 * 60)
          : snapQuarter(new Date()));
  const wheelDate = useMemo(() => dateFromMinute(wheelMinute), [wheelMinute]);

  useEffect(() => {
    if (!openPicker || Platform.OS !== 'ios') {
      setPickerTop(null);
      return;
    }
    let cancelled = false;
    const place = (attempt: number) => {
      pickerAnchorRef.current?.measureInWindow((_x, y, _width, height) => {
        if (cancelled) return;
        const limit = Dimensions.get('window').height - insets.bottom - 70 - 16;
        const overflow = y + height + 216 - limit;
        if (overflow > 4 && attempt < 2) {
          const next = scrollY.current + overflow + 28;
          scrollY.current = next;
          scrollRef.current?.scrollTo({ y: next, animated: true });
          setTimeout(() => place(attempt + 1), 360);
          return;
        }
        setPickerTop(y + height);
      });
    };
    const timer = setTimeout(() => place(0), 40);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [openPicker, insets.bottom]);

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}>
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: insets.bottom + 96 }}
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16}
      onScroll={(event) => { scrollY.current = event.nativeEvent.contentOffset.y; }}
    >
      <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={{ marginBottom: 16 }}>
        <Icon name="back" size={22} color={THEME_COLORS.text2} />
      </Pressable>
      <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 23 }}>
        {enrolled ? 'Prayer warrior' : 'Enroll as Prayer Warrior'}
      </Text>
      {enrolled ? (
        <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 14, lineHeight: 20, marginTop: 8 }}>
          You receive private prayer requests in the languages you serve. Accepting one schedules a live call at the time they chose.
        </Text>
      ) : (
        <View style={{ marginTop: 8 }}>
          <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('400'), fontSize: 12, lineHeight: 16 }}>
            We pray for others because God asks us to carry one another. Someone may be too weary to pray, and our prayer stands with them. Healing, courage, and peace often begin when another person brings their name to God.
          </Text>
          <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('400'), fontSize: 12, lineHeight: 16, fontStyle: 'italic', marginTop: 6 }}>
            “Therefore confess your sins to each other and pray for each other so that you may be healed. The prayer of a righteous person is powerful and effective.”
          </Text>
          <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('600'), fontSize: 10, letterSpacing: 1.1, marginTop: 4 }}>
            JAMES 5:16
          </Text>
          <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, lineHeight: 16, marginTop: 6 }}>
            We review each application before you are enrolled. Accepting a request schedules a live call at the time they chose.
          </Text>
        </View>
      )}

      {enrolled ? (
        <View style={{ marginTop: 22, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(44,36,23,0.06)', padding: 18 }}>
          <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('600'), fontSize: 13, marginBottom: 8 }}>Languages you serve</Text>
          <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('500'), fontSize: 16 }}>
            {application.languages.map((item) => offered(item) ?? item).join(', ') || 'English'}
          </Text>
        </View>
      ) : (
        <View style={{ marginTop: 22, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(44,36,23,0.06)', padding: 18 }}>
          {pending ? (
            <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('600'), fontSize: 13, lineHeight: 18, marginBottom: 14 }}>
              Application received. You can update it until you are enrolled.
            </Text>
          ) : null}
          <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('600'), fontSize: 13, marginBottom: 8 }}>Languages you can pray in</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {LANGUAGES.map((item) => {
              const selected = languages.includes(item);
              return (
                <Pressable
                  key={item}
                  onPress={() => toggleLanguage(item)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: selected ? THEME_COLORS.goldDim : THEME_COLORS.bg3, borderWidth: 1, borderColor: selected ? THEME_COLORS.goldBorder : THEME_COLORS.border }}
                >
                  <Text style={{ color: selected ? THEME_COLORS.gold : THEME_COLORS.text2, ...iosFontStyle('500'), fontSize: 13 }}>{item}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('600'), fontSize: 13, marginTop: 18, marginBottom: 4 }}>When can you take a call?</Text>
          <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, lineHeight: 18, marginBottom: 10 }}>
            Tap every day this range repeats. Add another range when the hours are different. A request is offered when the call fits inside a range.
          </Text>
          {slots.map((slot) => (
            <View key={slot.key} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('600'), fontSize: 14 }}>{dayLabel(slot.weekdays)}</Text>
                {slots.length > 1 ? (
                  <Pressable onPress={() => setSlots((current) => current.filter((item) => item.key !== slot.key))} hitSlop={8}>
                    <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('600'), fontSize: 13 }}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                {WEEKDAYS.map(([id, label]) => {
                  const selected = slot.weekdays.includes(id);
                  return (
                    <Pressable
                      key={id}
                      onPress={() => toggleDay(slot.key, id)}
                      accessibilityRole="button"
                      accessibilityLabel={WEEKDAY_NAME[id]}
                      accessibilityState={{ selected }}
                      style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 12, backgroundColor: selected ? THEME_COLORS.goldDim : THEME_COLORS.bg3, borderWidth: 1, borderColor: selected ? THEME_COLORS.goldBorder : THEME_COLORS.border }}
                    >
                      <Text style={{ color: selected ? THEME_COLORS.gold : THEME_COLORS.text2, ...iosFontStyle('600'), fontSize: 12 }}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View ref={openPicker?.key === slot.key ? pickerAnchorRef : undefined} collapsable={false} style={{ flexDirection: 'row', gap: 10 }}>
                {(['start', 'end'] as const).map((edge) => {
                  const selected = openPicker?.key === slot.key && openPicker.edge === edge;
                  const minute = edge === 'start' ? slot.start : slot.end;
                  return (
                    <Pressable
                      key={edge}
                      onPress={() => {
                        if (edge === 'end' && slot.start == null) {
                          Alert.alert('Choose a start time first', 'The end time stays after the start.');
                          return;
                        }
                        const alreadyOpen = openPicker?.key === slot.key && openPicker.edge === edge;
                        if (alreadyOpen) {
                          setOpenPicker(null);
                          return;
                        }
                        if (edge === 'start' && slot.start == null) {
                          updateSlot(slot.key, { start: snapQuarter(new Date()) });
                        } else if (edge === 'end' && slot.end == null && slot.start != null) {
                          updateSlot(slot.key, { end: Math.min(earliestEnd(slot.start) + 45, 24 * 60) });
                        }
                        setOpenPicker({ key: slot.key, edge });
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Choose a ${edge} time for ${dayLabel(slot.weekdays)}`}
                      style={{ flex: 1, borderRadius: 14, backgroundColor: selected ? THEME_COLORS.goldDim : THEME_COLORS.bg3, borderWidth: 1, borderColor: selected ? THEME_COLORS.goldBorder : THEME_COLORS.border, paddingHorizontal: 12, paddingVertical: 12 }}
                    >
                      <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('500'), fontSize: 11 }}>{edge === 'start' ? 'Start' : 'End'}</Text>
                      <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('600'), fontSize: 15, marginTop: 4 }}>
                        {minute == null ? 'Choose' : formatMinute(minute)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {openPicker?.key === slot.key && Platform.OS === 'ios' ? <View style={{ height: 216 }} /> : null}
              {rangeProblem(slot.start, slot.end) ? (
                <Text style={{ color: '#9a4034', ...iosFontStyle('500'), fontSize: 12, lineHeight: 16, marginTop: 8 }}>
                  {rangeProblem(slot.start, slot.end)}
                </Text>
              ) : null}
            </View>
          ))}
          {slots.length < 14 ? (
            <Pressable
              onPress={() => setSlots((current) => [...current, { key: String(Date.now()), weekdays: [todayWeekday()], start: null, end: null }])}
              accessibilityRole="button"
              style={{ alignSelf: 'flex-start', marginBottom: 4 }}
            >
              <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('600'), fontSize: 14 }}>Add another range</Text>
            </Pressable>
          ) : null}
          <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('600'), fontSize: 13, marginTop: 18, marginBottom: 8 }}>
            Church you attend <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400') }}>· Optional</Text>
          </Text>
          <TextInput
            value={church}
            onChangeText={setChurch}
            placeholder="Name of your church"
            placeholderTextColor={THEME_COLORS.text3}
            maxLength={80}
            style={{ borderRadius: 14, backgroundColor: THEME_COLORS.bg3, borderWidth: 1, borderColor: THEME_COLORS.border, padding: 14, color: THEME_COLORS.text, ...iosFontStyle('400') }}
          />
          <Text style={{ color: THEME_COLORS.text2, ...iosFontStyle('600'), fontSize: 13, marginTop: 18, marginBottom: 8 }}>Why do you want to serve?</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="A short note about how you hope to pray with people"
            placeholderTextColor={THEME_COLORS.text3}
            multiline
            maxLength={500}
            style={{ minHeight: 110, borderRadius: 14, backgroundColor: THEME_COLORS.bg3, borderWidth: 1, borderColor: THEME_COLORS.border, padding: 14, color: THEME_COLORS.text, ...iosFontStyle('400'), textAlignVertical: 'top' }}
          />
          <Button
            label={submit.isPending ? 'Sending…' : pending ? 'Update application' : 'Submit application'}
            onPress={send}
            isLoading={submit.isPending}
            fullWidth
            style={{ marginTop: 16 }}
          />
        </View>
      )}
    </ScrollView>
    {openPicker && activeSlot && Platform.OS === 'ios' && pickerTop != null ? (
      <>
        <Pressable
          onPress={() => setOpenPicker(null)}
          accessibilityRole="button"
          accessibilityLabel="Close time picker"
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 1 }}
        />
        <View
          style={{
            position: 'absolute',
            top: pickerTop,
            left: 20,
            right: 20,
            zIndex: 2,
            backgroundColor: THEME_COLORS.bg,
            borderRadius: 16,
          }}
        >
          <DateTimePicker
            style={{ height: 216, width: '100%' }}
            value={wheelDate}
            mode="time"
            display="spinner"
            minuteInterval={15}
            minimumDate={openPicker.edge === 'end' && activeSlot.start != null ? dateFromMinute(earliestEnd(activeSlot.start)) : undefined}
            themeVariant="light"
            accentColor={THEME_COLORS.gold}
            onChange={(event: DateTimePickerEvent, date?: Date) => {
              if (event.type === 'dismissed' || !date) return;
              if (openPicker.edge === 'start') {
                updateSlot(activeSlot.key, { start: snapQuarter(date) });
              } else {
                const floor = activeSlot.start == null ? 15 : earliestEnd(activeSlot.start);
                updateSlot(activeSlot.key, { end: Math.max(endMinute(date), floor) });
              }
            }}
          />
        </View>
      </>
    ) : null}
    {openPicker && activeSlot && Platform.OS === 'android' ? (
      <DateTimePicker
        value={wheelDate}
        mode="time"
        display="default"
        minuteInterval={15}
        minimumDate={openPicker.edge === 'end' && activeSlot.start != null ? dateFromMinute(earliestEnd(activeSlot.start)) : undefined}
        onChange={(event: DateTimePickerEvent, date?: Date) => {
          setOpenPicker(null);
          if (event.type === 'dismissed' || !date) return;
          if (openPicker.edge === 'start') {
            updateSlot(activeSlot.key, { start: snapQuarter(date) });
          } else {
            const floor = activeSlot.start == null ? 15 : earliestEnd(activeSlot.start);
            updateSlot(activeSlot.key, { end: Math.max(endMinute(date), floor) });
          }
        }}
      />
    ) : null}
    </View>
  );
}
