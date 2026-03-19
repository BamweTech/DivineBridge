import { useState, useRef } from 'react';
import {
  View,
  Text,
  Pressable,
  FlatList,
  Dimensions,
  ViewToken,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import Icon from '@/components/ui/Icon';
import { THEME_COLORS } from '@/lib/constants';

const { width: SCREEN_W } = Dimensions.get('window');

const SLIDES = [
  {
    key: 'pray',
    icon: 'cross' as const,
    iconColor: THEME_COLORS.gold,
    bgHint: 'rgba(176,125,32,0.06)',
    title: 'Pray Together.\nAnywhere.',
    italicWord: 'Anywhere.',
    body: 'Join small prayer groups, attend live rooms, and grow daily with an AI-powered devotional plan.',
    verse: '"Where two or three gather in my name, I am there among them."',
    verseRef: '— Matthew 18:20',
  },
  {
    key: 'groups',
    icon: 'groups' as const,
    iconColor: THEME_COLORS.sage,
    bgHint: 'rgba(74,124,94,0.06)',
    title: 'Find Your\nPrayer Family.',
    italicWord: 'Prayer Family.',
    body: 'Join or create small groups focused on faith topics that matter to you. Pray and grow together.',
    verse: '"Therefore confess your sins to each other and pray for each other so that you may be healed."',
    verseRef: '— James 5:16',
  },
  {
    key: 'devo',
    icon: 'sparkle' as const,
    iconColor: THEME_COLORS.violet,
    bgHint: 'rgba(112,64,184,0.06)',
    title: 'Daily Devotionals,\nPersonalized.',
    italicWord: 'Personalized.',
    body: 'Our AI crafts a devotional plan around your theme — scripture, reflection, and prayer for every day.',
    verse: '"Your word is a lamp for my feet, a light on my path."',
    verseRef: '— Psalm 119:105',
  },
];

function Slide({ item }: { item: typeof SLIDES[number] }) {
  return (
    <View style={{ width: SCREEN_W, flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 40 }}>
      <Animated.View entering={FadeIn.duration(600)}>
        {/* Icon glow */}
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <View style={{
            width: 96, height: 96, borderRadius: 32,
            backgroundColor: item.bgHint,
            borderWidth: 1.5, borderColor: item.iconColor + '44',
            alignItems: 'center', justifyContent: 'center',
            shadowColor: item.iconColor, shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 8 },
          }}>
            <Icon name={item.icon} size={44} color={item.iconColor} strokeWidth={1.5} />
          </View>
        </View>

        {/* Title */}
        <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 34, letterSpacing: -1, textAlign: 'center', lineHeight: 42, marginBottom: 14 }}>
          {item.title.replace(item.italicWord, '')}
          <Text style={{ fontStyle: 'italic', color: item.iconColor }}>{item.italicWord}</Text>
        </Text>

        {/* Body */}
        <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 15, lineHeight: 24, textAlign: 'center', marginBottom: 28 }}>
          {item.body}
        </Text>

        {/* Verse */}
        <View style={{ backgroundColor: item.bgHint, borderWidth: 1, borderColor: item.iconColor + '33', borderRadius: 18, padding: 18 }}>
          <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 21, fontStyle: 'italic', textAlign: 'center', marginBottom: 6 }}>
            {item.verse}
          </Text>
          <Text style={{ color: item.iconColor, fontFamily: 'Geist_600SemiBold', fontSize: 11, letterSpacing: 0.4, textAlign: 'center' }}>
            {item.verseRef}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<FlatList>(null);

  const onViewRef = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems[0]) setActiveIndex(viewableItems[0].index ?? 0);
  });
  const viewConfigRef = useRef({ viewAreaCoveragePercentThreshold: 50 });

  const isLast = activeIndex === SLIDES.length - 1;
  const activeSlide = SLIDES[activeIndex];

  function handleNext() {
    if (isLast) {
      router.push('/(auth)/signup');
    } else {
      listRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: THEME_COLORS.bg, paddingTop: insets.top }}>
      {/* Skip button */}
      <Animated.View entering={FadeIn.delay(300)} style={{ alignItems: 'flex-end', paddingHorizontal: 24, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => router.push('/(auth)/login')} hitSlop={12}>
          <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_500Medium', fontSize: 14 }}>Skip</Text>
        </Pressable>
      </Animated.View>

      {/* Slide list */}
      <FlatList
        ref={listRef}
        data={SLIDES}
        renderItem={({ item }) => <Slide item={item} />}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewRef.current}
        viewabilityConfig={viewConfigRef.current}
        style={{ flex: 1 }}
      />

      {/* Bottom controls */}
      <Animated.View
        entering={FadeInDown.duration(500).delay(200)}
        style={{ paddingHorizontal: 28, paddingBottom: insets.bottom + 20, paddingTop: 16 }}
      >
        {/* Dots */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 7, marginBottom: 24 }}>
          {SLIDES.map((_, i) => (
            <Pressable
              key={i}
              onPress={() => listRef.current?.scrollToIndex({ index: i, animated: true })}
            >
              <View style={{
                width: i === activeIndex ? 24 : 6,
                height: 6, borderRadius: 3,
                backgroundColor: i === activeIndex ? activeSlide.iconColor : THEME_COLORS.bg3,
              }} />
            </Pressable>
          ))}
        </View>

        {/* Primary CTA */}
        <Pressable
          onPress={handleNext}
          style={({ pressed }) => ({
            backgroundColor: activeSlide.iconColor,
            borderRadius: 50, paddingVertical: 16,
            alignItems: 'center', justifyContent: 'center',
            opacity: pressed ? 0.88 : 1,
            marginBottom: 12,
            shadowColor: activeSlide.iconColor, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
          })}
        >
          <Text style={{ color: '#ffffff', fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, letterSpacing: 0.2 }}>
            {isLast ? "Get Started — It's Free" : 'Continue'}
          </Text>
        </Pressable>

        {/* Secondary — sign in link */}
        <Pressable
          onPress={() => router.push('/(auth)/login')}
          style={({ pressed }) => ({
            borderRadius: 50, paddingVertical: 14,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1.5, borderColor: THEME_COLORS.border,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_500Medium', fontSize: 14 }}>
            Sign in to existing account
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
