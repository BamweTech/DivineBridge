import React, { useCallback } from 'react';
import { Text, Linking, type TextStyle, type StyleProp } from 'react-native';

const URL_REGEX =
  /(?:https?:\/\/|www\.)[\w\-._~:/?#[\]@!$&'()*+,;=%]+[\w\-/=]/gi;

type Segment = { text: string; url?: string };

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_REGEX)) {
    const start = match.index!;
    if (start > lastIndex) {
      segments.push({ text: text.slice(lastIndex, start) });
    }
    const raw = match[0];
    const url = raw.startsWith('http') ? raw : `https://${raw}`;
    segments.push({ text: raw, url });
    lastIndex = start + raw.length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }

  return segments;
}

type Props = {
  children: string;
  style?: StyleProp<TextStyle>;
  linkStyle?: StyleProp<TextStyle>;
};

export function LinkifiedText({ children, style, linkStyle }: Props) {
  const segments = parseSegments(children);

  const handlePress = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {});
  }, []);

  if (segments.length === 1 && !segments[0].url) {
    return <Text style={style}>{children}</Text>;
  }

  return (
    <Text style={style}>
      {segments.map((seg, i) =>
        seg.url ? (
          <Text
            key={i}
            style={[{ textDecorationLine: 'underline' }, linkStyle]}
            onPress={() => handlePress(seg.url!)}
            suppressHighlighting={false}
          >
            {seg.text}
          </Text>
        ) : (
          <Text key={i}>{seg.text}</Text>
        ),
      )}
    </Text>
  );
}
