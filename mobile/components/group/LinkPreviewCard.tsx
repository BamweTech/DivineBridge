import React, { useEffect, useState, useRef } from 'react';
import { View, Text, Pressable, Linking, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { THEME_COLORS } from '@/lib/constants';

type OgData = {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
};

const cache = new Map<string, OgData | null>();

async function fetchOgData(url: string): Promise<OgData | null> {
  if (cache.has(url)) return cache.get(url)!;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DivineBridge/1.0)' },
    });
    clearTimeout(timeout);
    if (!res.ok) { cache.set(url, null); return null; }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) { cache.set(url, null); return null; }

    const html = await res.text();
    const snippet = html.slice(0, 30_000);

    const get = (property: string): string | undefined => {
      const re = new RegExp(
        `<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']+)["']`,
        'i',
      );
      const alt = new RegExp(
        `<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:${property}["']`,
        'i',
      );
      return re.exec(snippet)?.[1] ?? alt.exec(snippet)?.[1];
    };

    const titleTag = /<title[^>]*>([^<]+)<\/title>/i.exec(snippet)?.[1];

    const data: OgData = {
      title: get('title') ?? titleTag?.trim(),
      description: get('description'),
      image: get('image'),
      siteName: get('site_name'),
    };

    if (!data.title && !data.description && !data.image) {
      cache.set(url, null);
      return null;
    }

    cache.set(url, data);
    return data;
  } catch {
    cache.set(url, null);
    return null;
  }
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

type Props = {
  url: string;
  isMe?: boolean;
};

export function LinkPreviewCard({ url, isMe }: Props) {
  const [og, setOg] = useState<OgData | null | undefined>(
    cache.has(url) ? cache.get(url) : undefined,
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (cache.has(url)) {
      setOg(cache.get(url));
      return;
    }
    fetchOgData(url).then((data) => {
      if (mountedRef.current) setOg(data);
    });
    return () => { mountedRef.current = false; };
  }, [url]);

  if (og === undefined) {
    return (
      <View style={{ paddingVertical: 10, alignItems: 'center' }}>
        <ActivityIndicator size="small" color={THEME_COLORS.text3} />
      </View>
    );
  }

  if (og === null) {
    return (
      <Pressable onPress={() => Linking.openURL(url)}>
        <Text
          style={{
            color: THEME_COLORS.gold,
            fontFamily: 'Geist_600SemiBold',
            fontSize: 13,
            textDecorationLine: 'underline',
          }}
          numberOfLines={3}
        >
          {url}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => Linking.openURL(url)}
      style={{
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: isMe ? THEME_COLORS.goldBorder : THEME_COLORS.border,
        backgroundColor: isMe ? 'rgba(255,255,255,0.48)' : THEME_COLORS.bg3,
      }}
    >
      {og.image ? (
        <Image
          source={{ uri: og.image }}
          style={{ width: '100%', height: 140, backgroundColor: THEME_COLORS.surface }}
          contentFit="cover"
        />
      ) : null}
      <View style={{ padding: 10, gap: 3 }}>
        {og.siteName ? (
          <Text
            style={{
              color: THEME_COLORS.text3,
              fontFamily: 'Geist_500Medium',
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
            numberOfLines={1}
          >
            {og.siteName}
          </Text>
        ) : (
          <Text
            style={{
              color: THEME_COLORS.text3,
              fontFamily: 'Geist_400Regular',
              fontSize: 10,
            }}
            numberOfLines={1}
          >
            {hostFromUrl(url)}
          </Text>
        )}
        {og.title ? (
          <Text
            style={{
              color: THEME_COLORS.text,
              fontFamily: 'Geist_600SemiBold',
              fontSize: 13,
              lineHeight: 18,
            }}
            numberOfLines={2}
          >
            {og.title}
          </Text>
        ) : null}
        {og.description ? (
          <Text
            style={{
              color: THEME_COLORS.text2,
              fontFamily: 'Geist_400Regular',
              fontSize: 12,
              lineHeight: 16,
              marginTop: 1,
            }}
            numberOfLines={3}
          >
            {og.description}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
