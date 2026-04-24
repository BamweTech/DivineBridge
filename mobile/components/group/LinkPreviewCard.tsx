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

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function getMeta(html: string, property: string): string | undefined {
  const propFirst = new RegExp(
    `<meta[^>]*property=["']${property}["'][^>]*content=["']([^"']+)["']`,
    'i',
  );
  const contentFirst = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*property=["']${property}["']`,
    'i',
  );
  const nameFirst = new RegExp(
    `<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']+)["']`,
    'i',
  );
  const nameAlt = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${property}["']`,
    'i',
  );
  return (
    propFirst.exec(html)?.[1] ??
    contentFirst.exec(html)?.[1] ??
    nameFirst.exec(html)?.[1] ??
    nameAlt.exec(html)?.[1]
  );
}

function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com';
  } catch {
    return false;
  }
}

async function fetchViaOEmbed(url: string): Promise<OgData | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(endpoint, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const json = await res.json();
    return {
      title: json.title,
      description: json.author_name ? `by ${json.author_name}` : undefined,
      image: json.thumbnail_url,
      siteName: 'YouTube',
    };
  } catch {
    return null;
  }
}

async function fetchOgData(url: string): Promise<OgData | null> {
  if (cache.has(url)) return cache.get(url)!;
  try {
    if (isYouTubeUrl(url)) {
      const oembed = await fetchViaOEmbed(url);
      if (oembed) { cache.set(url, oembed); return oembed; }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!res.ok) { cache.set(url, null); return null; }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      cache.set(url, null);
      return null;
    }

    const html = await res.text();
    const snippet = html.slice(0, 60_000);

    const titleTag = /<title[^>]*>([^<]+)<\/title>/i.exec(snippet)?.[1];

    const data: OgData = {
      title:
        getMeta(snippet, 'og:title') ??
        getMeta(snippet, 'twitter:title') ??
        titleTag?.trim(),
      description:
        getMeta(snippet, 'og:description') ??
        getMeta(snippet, 'twitter:description') ??
        getMeta(snippet, 'description'),
      image:
        getMeta(snippet, 'og:image') ??
        getMeta(snippet, 'twitter:image'),
      siteName:
        getMeta(snippet, 'og:site_name'),
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

type Props = {
  url: string;
};

export function LinkPreviewCard({ url }: Props) {
  const [og, setOg] = useState<OgData | null | undefined>(
    cache.has(url) ? cache.get(url) : undefined,
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const cached = cache.get(url);
    if (cached !== undefined && cached !== null) {
      setOg(cached);
      return;
    }
    cache.delete(url);
    fetchOgData(url).then((data) => {
      if (mountedRef.current) setOg(data);
    });
    return () => { mountedRef.current = false; };
  }, [url]);

  if (og === undefined) {
    return (
      <View style={{ paddingVertical: 6, alignItems: 'flex-start' }}>
        <ActivityIndicator size="small" color={THEME_COLORS.text3} />
      </View>
    );
  }

  if (og === null) {
    return (
      <Pressable onPress={() => Linking.openURL(url)} hitSlop={8}>
        <Text
          numberOfLines={4}
          style={{
            color: THEME_COLORS.gold,
            fontFamily: 'InterTight_500Medium',
            fontSize: 14,
            lineHeight: 20,
            textDecorationLine: 'underline',
          }}
        >
          {url}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={() => Linking.openURL(url)} style={{ borderRadius: 12, overflow: 'hidden' }}>
      {og.image ? (
        <Image
          source={{ uri: og.image }}
          style={{ width: '100%', height: 140, backgroundColor: THEME_COLORS.surface }}
          contentFit="cover"
        />
      ) : null}
      <View style={{ padding: 10, gap: 3, backgroundColor: THEME_COLORS.bg3 }}>
        {og.siteName ? (
          <Text
            style={{
              color: THEME_COLORS.text3,
              fontFamily: 'InterTight_500Medium',
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: 0.5,
            }}
            numberOfLines={1}
          >
            {og.siteName}
          </Text>
        ) : null}
        {og.title ? (
          <Text
            style={{
              color: THEME_COLORS.text,
              fontFamily: 'InterTight_600SemiBold',
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
              fontFamily: 'InterTight_400Regular',
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
