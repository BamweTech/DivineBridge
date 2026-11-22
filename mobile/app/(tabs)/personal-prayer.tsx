import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import dayjs from 'dayjs';

import { prayerApi, type SavedPersonalPrayer } from '@/services/api';
import { useSpeechPlayback } from '@/features/prayer/hooks/useSpeechPlayback';
import { THEME_COLORS } from '@/lib/constants';
import { TYPE, iosFont } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import Icon from '@/components/ui/Icon';

const SAVED_KEY = ['personal-prayers'];
const MENU_WIDTH = 0.78;

function AiGeneratedBanner() {
  return (
    <View
      accessibilityRole="text"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        alignSelf: 'flex-start',
        backgroundColor: THEME_COLORS.violetDim,
        borderWidth: 1,
        borderColor: 'rgba(112,64,184,0.2)',
        borderRadius: 50,
        paddingHorizontal: 12,
        paddingVertical: 4,
      }}
    >
      <Icon name="sparkle" size={10} color={THEME_COLORS.violet} />
      <Text style={{ color: THEME_COLORS.violet, fontFamily: iosFont('500'), fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase' }}>
        AI-generated
      </Text>
    </View>
  );
}

function MenuLines() {
  return (
    <View style={{ width: 22, height: 16, justifyContent: 'space-between' }}>
      {[0, 1, 2].map((line) => (
        <View key={line} style={{ height: 2, borderRadius: 1, backgroundColor: THEME_COLORS.text2 }} />
      ))}
    </View>
  );
}

function spokenParts(prayer: SavedPersonalPrayer) {
  const verses = (prayer.verses ?? []).map((verse) => `${verse.reference}. ${verse.text}`);
  return [...verses, prayer.content].filter((part) => part.trim().length > 0);
}

export default function PersonalPrayerScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const slide = useSharedValue(0);
  const queryClient = useQueryClient();
  const { toggle, isSpeaking, activeSource } = useSpeechPlayback();
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const savedQuery = useQuery({
    queryKey: SAVED_KEY,
    queryFn: prayerApi.listPersonal,
  });
  const prayers = savedQuery.data?.data ?? [];
  const openPrayer = prayers.find((prayer) => prayer.id === openId) ?? null;
  const menuWidth = width * MENU_WIDTH;
  const pageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: slide.value * -menuWidth }],
  }));

  function openMenu() {
    setMenuOpen(true);
    slide.value = withTiming(1, { duration: 280 });
  }

  function closeMenu() {
    slide.value = withTiming(0, { duration: 260 }, (finished) => {
      if (finished) runOnJS(setMenuOpen)(false);
    });
  }

  async function generate() {
    if (topic.trim().length < 3) {
      Alert.alert('Add a topic', 'Tell us what you want to pray about.');
      return;
    }
    setBusy(true);
    try {
      const result = await prayerApi.personal(topic.trim());
      queryClient.setQueryData(SAVED_KEY, (current: { success: boolean; data: SavedPersonalPrayer[] } | undefined) => {
        const existing = current?.data ?? [];
        return {
          success: true,
          data: [result.data, ...existing.filter((item) => item.id !== result.data.id)],
        };
      });
      setTopic('');
      setOpenId(result.data.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Please try again.';
      Alert.alert('Could not write the prayer', message);
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(prayer: SavedPersonalPrayer) {
    Alert.alert('Delete this prayer?', 'This removes it from your saved prayers.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setDeletingId(prayer.id);
          prayerApi.deletePersonal(prayer.id)
            .then(() => {
              queryClient.setQueryData(SAVED_KEY, (current: { success: boolean; data: SavedPersonalPrayer[] } | undefined) => ({
                success: true,
                data: (current?.data ?? []).filter((item) => item.id !== prayer.id),
              }));
              if (openId === prayer.id) setOpenId(null);
            })
            .catch((err: unknown) => {
              const message = err instanceof Error ? err.message : 'Please try again.';
              Alert.alert('Could not delete the prayer', message);
            })
            .finally(() => setDeletingId(null));
        },
      },
    ]);
  }

  function openFromMenu(prayer: SavedPersonalPrayer) {
    setOpenId(prayer.id);
    closeMenu();
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fff', overflow: 'hidden' }}>
      <View style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: menuWidth, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }}>
        <Text style={{ ...TYPE.headline, color: THEME_COLORS.text, paddingHorizontal: 18, paddingBottom: 8 }}>
          Previous prayers
        </Text>
        {savedQuery.isLoading ? (
          <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3, paddingHorizontal: 18, paddingTop: 8 }}>Loading your prayers…</Text>
        ) : prayers.length === 0 ? (
          <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3, paddingHorizontal: 18, paddingTop: 8 }}>Your saved prayers will appear here.</Text>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled">
            {prayers.map((prayer) => {
              const selected = prayer.id === openId;
              return (
                <Pressable
                  key={prayer.id}
                  onPress={() => openFromMenu(prayer)}
                  accessibilityRole="button"
                  style={{
                    paddingHorizontal: 18,
                    paddingVertical: 14,
                    borderTopWidth: 1,
                    borderTopColor: THEME_COLORS.border,
                    backgroundColor: selected ? THEME_COLORS.goldDim : '#fff',
                  }}
                >
                  <Text style={{ color: THEME_COLORS.text, fontFamily: iosFont('600'), fontSize: 16 }}>{prayer.topic}</Text>
                  {prayer.created_at ? (
                    <Text style={{ ...TYPE.caption1, color: THEME_COLORS.text3, marginTop: 2 }}>
                      {dayjs(prayer.created_at).format('MMM D, YYYY')}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      <Animated.View style={[{ flex: 1, backgroundColor: THEME_COLORS.bg }, pageStyle, pageShadow]}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 22, paddingBottom: insets.bottom + 96 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
            <Icon name="back" size={22} color={THEME_COLORS.text2} />
          </Pressable>
          <Pressable
            onPress={openMenu}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Previous prayers"
          >
            <MenuLines />
          </Pressable>
        </View>
        <AiGeneratedBanner />
        <Text style={{ ...TYPE.title2, color: THEME_COLORS.text, marginTop: 10 }}>Personal prayer</Text>
        <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3, marginTop: 6, marginBottom: 18 }}>
          A prayer written for you. It is saved so you can read it again, and you can delete it.
        </Text>
        <Text style={label}>What is on your heart?</Text>
        <TextInput
          value={topic}
          onChangeText={setTopic}
          placeholder="Peace for a hard conversation"
          placeholderTextColor={THEME_COLORS.text3}
          multiline
          textAlignVertical="top"
          style={input}
        />
        <Button label="Submit" onPress={() => { void generate(); }} isLoading={busy} fullWidth />

        {openPrayer ? (
          <PrayerDetail
            prayer={openPrayer}
            listening={activeSource === `personal-${openPrayer.id}` && isSpeaking}
            deleting={deletingId === openPrayer.id}
            onListen={() => toggle(spokenParts(openPrayer), `personal-${openPrayer.id}`)}
            onCopy={() => {
              void Clipboard.setStringAsync(spokenParts(openPrayer).join('\n\n'));
              Alert.alert('Copied', 'The prayer is on your clipboard.');
            }}
            onDelete={() => confirmDelete(openPrayer)}
          />
        ) : null}
      </ScrollView>
      {menuOpen ? (
        <Pressable
          accessibilityLabel="Close previous prayers"
          onPress={closeMenu}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
        />
      ) : null}
      </Animated.View>
    </View>
  );
}

function PrayerDetail({
  prayer,
  listening,
  deleting,
  onListen,
  onCopy,
  onDelete,
}: {
  prayer: SavedPersonalPrayer;
  listening: boolean;
  deleting: boolean;
  onListen: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  return (
    <View style={card}>
      <AiGeneratedBanner />
      <Text style={{ color: THEME_COLORS.text, fontFamily: iosFont('600'), fontSize: 16, marginTop: 8 }}>{prayer.topic}</Text>
      {prayer.created_at ? (
        <Text style={{ ...TYPE.caption1, color: THEME_COLORS.text3, marginTop: 4 }}>
          {dayjs(prayer.created_at).format('MMM D, YYYY')}
        </Text>
      ) : null}
      {(prayer.verses ?? []).map((verse) => (
        <View key={verse.reference} style={{ marginTop: 12 }}>
          <Text style={{ ...TYPE.caption1, color: THEME_COLORS.gold }}>
            {verse.translation ? `${verse.reference} · ${verse.translation}` : verse.reference}
          </Text>
          <Text style={{ ...TYPE.body, color: THEME_COLORS.text, marginTop: 4 }}>{verse.text}</Text>
        </View>
      ))}
      <Text style={{ ...TYPE.body, color: THEME_COLORS.text, marginTop: 12 }}>{prayer.content}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 14 }}>
        <Pressable onPress={onListen} accessibilityRole="button">
          <Text style={link}>{listening ? 'Stop' : 'Listen'}</Text>
        </Pressable>
        <Pressable onPress={onCopy} accessibilityRole="button">
          <Text style={link}>Copy</Text>
        </Pressable>
        <Pressable
          onPress={onDelete}
          disabled={deleting}
          accessibilityRole="button"
          accessibilityLabel="Delete prayer"
          style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4 }}
        >
          <Icon name="trash" size={16} color={THEME_COLORS.rose} />
          <Text style={{ color: THEME_COLORS.rose, fontFamily: iosFont('600'), fontSize: 14 }}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const label = { ...TYPE.caption1, color: THEME_COLORS.text2, marginBottom: 8, fontFamily: iosFont('600') };
const input = {
  borderRadius: 14,
  backgroundColor: THEME_COLORS.bg3,
  borderWidth: 1,
  borderColor: THEME_COLORS.border,
  padding: 14,
  minHeight: 144,
  fontSize: 15,
  lineHeight: 20,
  color: THEME_COLORS.text,
  marginBottom: 16,
  fontFamily: iosFont('400'),
};
const link = { color: THEME_COLORS.gold, fontFamily: iosFont('600'), fontSize: 14 };
const card = {
  backgroundColor: '#fff',
  borderRadius: 18,
  borderWidth: 1,
  borderColor: THEME_COLORS.border,
  padding: 16,
  marginTop: 22,
};
const pageShadow = {
  shadowColor: '#2c2417',
  shadowOffset: { width: 8, height: 0 },
  shadowOpacity: 0.12,
  shadowRadius: 16,
  elevation: 8,
};
