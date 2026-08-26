import { useCallback, useState } from 'react';
import { View, Pressable, ActivityIndicator } from 'react-native';
import { Image, ImageLoadEventData } from 'expo-image';
import { ResizeMode, Video } from 'expo-av';
import { THEME_COLORS } from '@/lib/constants';
import Icon from '@/components/ui/Icon';
import type { GroupChatAttachment } from '@/types';

const imageDimensionCache = new Map<string, number>();

function AdaptiveImagePreview({
  uri,
  knownWidth,
  knownHeight,
  accessibilityLabel,
}: {
  uri: string;
  knownWidth?: number;
  knownHeight?: number;
  accessibilityLabel: string;
}) {
  const storedRatio =
    knownWidth && knownHeight ? knownWidth / knownHeight : undefined;
  const cached = storedRatio ?? imageDimensionCache.get(uri);
  const [ratio, setRatio] = useState(cached ?? 4 / 3);
  const [loaded, setLoaded] = useState(!!cached);

  const handleLoad = useCallback(
    (e: ImageLoadEventData) => {
      const { width, height } = e.source;
      if (!imageDimensionCache.has(uri) && width > 0 && height > 0) {
        const r = width / height;
        imageDimensionCache.set(uri, r);
        setRatio(r);
      }
      setLoaded(true);
    },
    [uri],
  );

  return (
    <View style={{ width: 264, aspectRatio: ratio, backgroundColor: THEME_COLORS.bg3, justifyContent: 'center', alignItems: 'center' }}>
      {!loaded && <ActivityIndicator size="small" color={THEME_COLORS.gold} style={{ position: 'absolute' }} />}
      <Image
        source={{ uri }}
        style={{ width: '100%', height: '100%' }}
        contentFit="contain"
        cachePolicy="memory-disk"
        recyclingKey={uri}
        transition={cached ? 0 : 150}
        onLoad={handleLoad}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

export function MediaAttachmentCard({
  attachment,
  onOpen,
}: {
  attachment: GroupChatAttachment;
  onOpen: (attachment: GroupChatAttachment) => void;
}) {
  const isVideo = attachment.content_type.startsWith('video/');

  return (
    <Pressable
      onPress={() => onOpen(attachment)}
      style={{
        width: 264,
        borderRadius: 18,
        overflow: 'hidden',
        backgroundColor: THEME_COLORS.bg3,
        borderWidth: 1,
        borderColor: THEME_COLORS.border,
      }}
    >
      {isVideo ? (
        <View style={{ position: 'relative' }}>
          <Video
            source={{ uri: attachment.url }}
            style={{ width: 264, height: 220, backgroundColor: '#111' }}
            resizeMode={ResizeMode.COVER}
            shouldPlay={false}
            isLooping={false}
            isMuted
          />
          <View
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 54,
                height: 54,
                borderRadius: 27,
                backgroundColor: 'rgba(0,0,0,0.45)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="play" size={18} color="#fff" />
            </View>
          </View>
        </View>
      ) : (
        <AdaptiveImagePreview
          uri={attachment.url}
          knownWidth={attachment.width}
          knownHeight={attachment.height}
          accessibilityLabel={attachment.file_name}
        />
      )}
    </Pressable>
  );
}
