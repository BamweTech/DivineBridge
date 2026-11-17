import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { prayerApi } from '@/services/api';
import { useSpeechPlayback } from '@/features/prayer/hooks/useSpeechPlayback';
import { THEME_COLORS } from '@/lib/constants';
import { TYPE, iosFont } from '@/lib/typography';
import { Button } from '@/components/ui/Button';
import Icon from '@/components/ui/Icon';

export default function PersonalPrayerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { toggle, isSpeaking, activeSource } = useSpeechPlayback();
  const [topic, setTopic] = useState('');
  const [scripture, setScripture] = useState('');
  const [prayer, setPrayer] = useState('');
  const [busy, setBusy] = useState(false);
  const listening = activeSource === 'personal' && isSpeaking;

  async function generate() {
    if (topic.trim().length < 3) {
      Alert.alert('Add a topic', 'Tell us what you want to pray about.');
      return;
    }
    setBusy(true);
    try {
      const result = await prayerApi.personal(topic.trim(), scripture.trim());
      setPrayer(result.data?.content ?? '');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Please try again.';
      Alert.alert('Could not write the prayer', message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: THEME_COLORS.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 22, paddingBottom: insets.bottom + 36 }}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginBottom: 16 }}>
        <Icon name="back" size={22} color={THEME_COLORS.text2} />
      </Pressable>
      <Text style={{ ...TYPE.title2, color: THEME_COLORS.text }}>Personal prayer</Text>
      <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3, marginTop: 6, marginBottom: 18 }}>
        A prayer written for this moment. It is not saved.
      </Text>
      <Text style={label}>What is on your heart?</Text>
      <TextInput
        value={topic}
        onChangeText={setTopic}
        placeholder="Peace for a hard conversation"
        placeholderTextColor={THEME_COLORS.text3}
        style={input}
      />
      <Text style={label}>Scripture, if you want one</Text>
      <TextInput
        value={scripture}
        onChangeText={setScripture}
        placeholder="Psalm 23"
        placeholderTextColor={THEME_COLORS.text3}
        style={input}
      />
      <Button label={busy ? 'Writing…' : 'Write a prayer'} onPress={() => { void generate(); }} isLoading={busy} fullWidth />
      {prayer ? (
        <View style={{ marginTop: 22, backgroundColor: THEME_COLORS.bg2, borderRadius: 18, borderWidth: 1, borderColor: THEME_COLORS.border, padding: 16 }}>
          <Text style={{ ...TYPE.body, color: THEME_COLORS.text }}>{prayer}</Text>
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 14 }}>
            <Pressable onPress={() => toggle([prayer], 'personal')}>
              <Text style={link}>{listening ? 'Stop' : 'Listen'}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                void Clipboard.setStringAsync(prayer);
                Alert.alert('Copied', 'The prayer is on your clipboard.');
              }}
            >
              <Text style={link}>Copy</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const label = { ...TYPE.caption1, color: THEME_COLORS.text2, marginBottom: 8, fontFamily: iosFont('600') };
const input = {
  borderRadius: 14,
  backgroundColor: THEME_COLORS.bg3,
  borderWidth: 1,
  borderColor: THEME_COLORS.border,
  padding: 14,
  color: THEME_COLORS.text,
  marginBottom: 16,
  fontFamily: iosFont('400'),
};
const link = { color: THEME_COLORS.gold, fontFamily: iosFont('600'), fontSize: 14 };
