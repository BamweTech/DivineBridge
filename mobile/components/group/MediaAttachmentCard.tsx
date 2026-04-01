import { useState, useEffect } from 'react';
import { View, Pressable, Image as RNImage } from 'react-native';
import { Image } from 'expo-image';
import { ResizeMode, Video } from 'expo-av';
import { THEME_COLORS } from '@/lib/constants';
import Icon from '@/components/ui/Icon';
import type { GroupChatAttachment } from '@/types';

function AdaptiveImagePreview({
  uri,
  accessibilityLabel,
}: {
  uri: string;
  accessibilityLabel: string;
}) {
  const [ratio, setRatio] = useState(4 / 3);

  useEffect(() => {
    let active = true;
    RNImage.getSize(
      uri,
      (width, height) => {
        if (active && width > 0 && height > 0) setRatio(width / height);
      },
      () => {}
    );
    return () => {
      active = false;
    };
  }, [uri]);

  return (
    <Image
      source={{ uri }}
      style={{ width: 264, aspectRatio: ratio, backgroundColor: THEME_COLORS.bg3 }}
      contentFit="contain"
      accessibilityLabel={accessibilityLabel}
    />
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
        <AdaptiveImagePreview uri={attachment.url} accessibilityLabel={attachment.file_name} />
      )}
    </Pressable>
  );
}
