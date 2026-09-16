import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { THEME_COLORS } from '@/lib/constants';
import { TYPE, iosFont } from '@/lib/typography';
import Icon from '@/components/ui/Icon';
import {
  downloadServerImage,
  shareLocalImage,
  verseExplainerImagePath,
  VERSE_EXPLAINER_SECTIONS,
  VERSE_EXPLAINER_LABELS,
  type VerseExplainerSection,
  devotionalShareImagePath,
  DEVOTIONAL_SHARE_SECTIONS,
  DEVOTIONAL_SHARE_LABELS,
  type DevotionalShareSection,
} from '@/lib/shareServerImage';

export type SharePackSection = { id: string; label: string };

type CardState = {
  id: string;
  uri: string | null;
  error: boolean;
};

type SharePackProps = {
  visible: boolean;
  title: string;
  subtitle: string;
  sections: SharePackSection[];
  imagePath: (sectionId: string) => string;
  filename: (sectionId: string) => string;
  fallback: string;
  onClose: () => void;
  onShared?: () => void;
};

/**
 * Horizontal pager of server-rendered share cards. Used by the verse
 * explainer (4 cards) and the daily devotional reading (3 cards).
 */
export function SharePack({
  visible,
  title,
  subtitle,
  sections,
  imagePath,
  filename,
  fallback,
  onClose,
  onShared,
}: SharePackProps) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const [cards, setCards] = useState<CardState[]>([]);
  const [sharing, setSharing] = useState(false);

  const cardWidth = Math.min(320, windowWidth - 72);
  const cardHeight = Math.round(cardWidth * (1580 / 1080));
  const pageWidth = windowWidth;
  const sectionKey = sections.map((s) => s.id).join(',');

  useEffect(() => {
    if (!visible) {
      setCards([]);
      setPage(0);
      setSharing(false);
      return;
    }

    let cancelled = false;
    setCards(sections.map((section) => ({ id: section.id, uri: null, error: false })));

    (async () => {
      const results = await Promise.all(
        sections.map(async (section) => {
          const uri = await downloadServerImage(imagePath(section.id), filename(section.id));
          return { id: section.id, uri, error: !uri } satisfies CardState;
        })
      );
      if (!cancelled) setCards(results);
    })();

    return () => {
      cancelled = true;
    };
    // imagePath / filename are stable closures from the wrappers below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, sectionKey]);

  const readyUris = cards.filter((c) => c.uri).map((c) => c.uri) as string[];
  const current = cards[page];
  const currentLabel = sections[page]?.label ?? 'card';
  const loading = visible && cards.some((c) => !c.uri && !c.error);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
    if (next !== page && next >= 0 && next < sections.length) setPage(next);
  }

  async function shareUri(uri: string | null) {
    if (!uri || sharing) return;
    setSharing(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await shareLocalImage(uri, fallback);
      onShared?.();
    } finally {
      setSharing(false);
    }
  }

  async function shareAll() {
    if (!readyUris.length || sharing) return;
    setSharing(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      for (const uri of readyUris) {
        await shareLocalImage(uri, fallback);
      }
      onShared?.();
    } finally {
      setSharing(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: 'rgba(44,36,22,0.55)', justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Dismiss share pack" />
        <View
          style={{
            backgroundColor: '#fbf2da',
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingBottom: insets.bottom + 16,
            maxHeight: '92%',
          }}
        >
          <View
            style={{
              width: 36,
              height: 4,
              backgroundColor: THEME_COLORS.border,
              borderRadius: 2,
              alignSelf: 'center',
              marginTop: 12,
            }}
          />

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 20,
              paddingTop: 16,
              paddingBottom: 8,
            }}
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ ...TYPE.title3, color: THEME_COLORS.text }}>{title}</Text>
              <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3, marginTop: 4 }}>
                {subtitle}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close"
              hitSlop={8}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: 'rgba(44,36,23,0.06)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="chevron-d" size={16} color={THEME_COLORS.text2} />
            </Pressable>
          </View>

          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={16}
            style={{ marginTop: 8 }}
          >
            {sections.map((section, i) => {
              const card = cards[i];
              return (
                <View
                  key={section.id}
                  style={{ width: pageWidth, alignItems: 'center', paddingVertical: 8 }}
                >
                  <View
                    style={{
                      width: cardWidth,
                      height: cardHeight,
                      borderRadius: 22,
                      overflow: 'hidden',
                      backgroundColor: 'rgba(255,253,247,0.7)',
                      borderWidth: 1,
                      borderColor: 'rgba(44,36,23,0.08)',
                    }}
                  >
                    {card?.uri ? (
                      <Image
                        source={{ uri: card.uri }}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                      />
                    ) : (
                      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                        {card?.error ? (
                          <Text style={{ ...TYPE.footnote, color: THEME_COLORS.text3, textAlign: 'center', paddingHorizontal: 24 }}>
                            Couldn&apos;t load the {section.label.toLowerCase()} card.
                          </Text>
                        ) : (
                          <>
                            <ActivityIndicator color={THEME_COLORS.gold} />
                            <Text style={{ ...TYPE.capsLabel, color: THEME_COLORS.text3 }}>
                              {section.label}
                            </Text>
                          </>
                        )}
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {sections.length > 1 ? (
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 }}>
              {sections.map((section, i) => (
                <View
                  key={section.id}
                  style={{
                    width: i === page ? 16 : 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: i === page ? THEME_COLORS.gold : 'rgba(44,36,23,0.16)',
                  }}
                />
              ))}
            </View>
          ) : null}

          <View style={{ paddingHorizontal: 20, marginTop: 18, gap: 10 }}>
            <Pressable
              onPress={() => shareUri(current?.uri ?? null)}
              disabled={!current?.uri || sharing}
              accessibilityRole="button"
              accessibilityLabel={`Share ${currentLabel}`}
              style={{
                backgroundColor: current?.uri ? THEME_COLORS.text : 'rgba(44,36,23,0.18)',
                borderRadius: 16,
                paddingVertical: 14,
                alignItems: 'center',
                flexDirection: 'row',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Icon name="share" size={16} color="#fff" />
              <Text
                style={{
                  fontFamily: iosFont('600'),
                  fontWeight: '600',
                  fontSize: 16,
                  color: '#fff',
                }}
              >
                Share {currentLabel}
              </Text>
            </Pressable>

            {readyUris.length > 1 ? (
              <Pressable
                onPress={shareAll}
                disabled={sharing}
                accessibilityRole="button"
                accessibilityLabel="Share all cards"
                style={{
                  borderRadius: 16,
                  paddingVertical: 14,
                  alignItems: 'center',
                  borderWidth: 1,
                  borderColor: THEME_COLORS.goldBorder,
                  backgroundColor: THEME_COLORS.goldDim,
                }}
              >
                <Text style={{ ...TYPE.headline, color: THEME_COLORS.gold }}>
                  {loading ? 'Preparing remaining cards…' : `Share all ${readyUris.length}`}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

type VerseSharePackProps = {
  visible: boolean;
  date: string;
  verseText: string;
  verseRef: string;
  includeSermonCards: boolean;
  onClose: () => void;
  onShared?: () => void;
};

export function VerseSharePack({
  visible,
  date,
  verseText,
  verseRef,
  includeSermonCards,
  onClose,
  onShared,
}: VerseSharePackProps) {
  const sections = useMemo<SharePackSection[]>(
    () =>
      (includeSermonCards ? [...VERSE_EXPLAINER_SECTIONS] : (['verse'] as VerseExplainerSection[])).map(
        (id) => ({ id, label: VERSE_EXPLAINER_LABELS[id] })
      ),
    [includeSermonCards]
  );
  const fallback =
    verseText && verseRef
      ? `Today's Verse (${verseRef}):\n\n"${verseText}"\n\nDivine Bridge — divinebridge.io`
      : `Today's verse on Divine Bridge — divinebridge.io`;

  return (
    <SharePack
      visible={visible}
      title="Share today's message"
      subtitle={
        includeSermonCards
          ? 'Four cards — verse, context, meaning, and application.'
          : 'Preparing the full message. The verse card is ready now.'
      }
      sections={sections}
      imagePath={(id) => verseExplainerImagePath(date, id as VerseExplainerSection)}
      filename={(id) => `divine_bridge_${id}_${date}.jpg`}
      fallback={fallback}
      onClose={onClose}
      onShared={onShared}
    />
  );
}

type DevotionalSharePackProps = {
  visible: boolean;
  planId: string;
  day: number;
  scripture: string;
  reference: string;
  onClose: () => void;
};

export function DevotionalSharePack({
  visible,
  planId,
  day,
  scripture,
  reference,
  onClose,
}: DevotionalSharePackProps) {
  const sections = useMemo<SharePackSection[]>(
    () =>
      DEVOTIONAL_SHARE_SECTIONS.map((id: DevotionalShareSection) => ({
        id,
        label: DEVOTIONAL_SHARE_LABELS[id],
      })),
    []
  );
  const fallback =
    scripture && reference
      ? `Day ${day} (${reference}):\n\n"${scripture}"\n\nDivine Bridge — divinebridge.io`
      : `Today's reading on Divine Bridge — divinebridge.io`;

  return (
    <SharePack
      visible={visible}
      title="Share today's reading"
      subtitle="Three cards — scripture, reflection, and prayer."
      sections={sections}
      imagePath={(id) => devotionalShareImagePath(planId, day, id as DevotionalShareSection)}
      filename={(id) => `divine_bridge_devo_${id}_${planId}_day${day}.jpg`}
      fallback={fallback}
      onClose={onClose}
    />
  );
}
