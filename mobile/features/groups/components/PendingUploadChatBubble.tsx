import React from 'react';
import { View, Text } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ResizeMode, Video } from 'expo-av';
import { Image } from 'expo-image';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle } from '@/lib/typography';
import Icon from '@/components/ui/Icon';
import type { PendingUploadBubble } from '@/features/groups/components/groupChatUtils';

export function PendingUploadChatBubble({
  item,
  userUid,
}: {
  item: PendingUploadBubble;
  userUid?: string;
}) {
  const isMe = !!userUid;
  const isImage = item.content_type.startsWith('image/');
  const isVideo = item.content_type.startsWith('video/');

  return (
    <Animated.View
      entering={FadeInDown.duration(180)}
      style={{ marginBottom: 12, alignItems: isMe ? 'flex-end' : 'flex-start', opacity: item.status === 'failed' ? 0.72 : 1 }}
    >
      {(isImage || isVideo) && (
        <View
          style={{
            width: 264,
            borderRadius: 18,
            overflow: 'hidden',
            backgroundColor: THEME_COLORS.bg3,
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: item.status === 'failed' ? THEME_COLORS.rose : THEME_COLORS.border,
            marginBottom: item.message ? 8 : 0,
          }}
        >
          {isVideo ? (
            <View style={{ position: 'relative' }}>
              <Video
                source={{ uri: item.local_uri ?? '' }}
                style={{ width: 264, height: 220, backgroundColor: '#111' }}
                resizeMode={ResizeMode.COVER}
                shouldPlay={false}
                isLooping={false}
                isMuted
              />
              <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="play" size={18} color="#fff" />
                </View>
              </View>
            </View>
          ) : (
            <Image
              source={{ uri: item.local_uri ?? '' }}
              style={{ width: 264, aspectRatio: 4 / 3, backgroundColor: THEME_COLORS.bg3 }}
              contentFit="cover"
              accessibilityLabel={item.file_name}
            />
          )}
          <View style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
            <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('500'), fontSize: 12 }} numberOfLines={1}>
              {item.file_name}
            </Text>
            <Text
              style={{
                color: item.status === 'failed' ? THEME_COLORS.rose : THEME_COLORS.text3,
                ...iosFontStyle('500'),
                fontSize: 11,
                marginTop: 4,
              }}
            >
              {item.status === 'failed' ? 'Upload failed' : 'Uploading...'}
            </Text>
          </View>
        </View>
      )}
      {(!isImage && !isVideo) || item.message ? (
        <View
          style={{
            maxWidth: 264,
            backgroundColor: THEME_COLORS.bg2,
            borderRadius: 18,
            borderBottomRightRadius: isMe ? 4 : 18,
            borderBottomLeftRadius: isMe ? 18 : 4,
            overflow: 'hidden',
            borderWidth: 1,
            borderStyle: 'dashed',
            borderColor: item.status === 'failed' ? THEME_COLORS.rose : THEME_COLORS.border,
          }}
        >
          <View style={{ padding: 12 }}>
            {!isImage && !isVideo && (
              <View
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: 12,
                  backgroundColor: THEME_COLORS.bg3,
                  borderWidth: 1,
                  borderColor: THEME_COLORS.border,
                  marginBottom: item.message ? 10 : 0,
                }}
              >
                <Text style={{ color: THEME_COLORS.violet, ...iosFontStyle('600'), fontSize: 12 }}>
                  File
                </Text>
                <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('400'), fontSize: 13, marginTop: 4 }} numberOfLines={2}>
                  {item.file_name}
                </Text>
              </View>
            )}
            {!!item.message && (
              <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('400'), fontSize: 14, lineHeight: 22 }}>
                {item.message}
              </Text>
            )}
            {!(isImage || isVideo) && (
              <Text
                style={{
                  color: item.status === 'failed' ? THEME_COLORS.rose : THEME_COLORS.text3,
                  ...iosFontStyle('500'),
                  fontSize: 11,
                  marginTop: 8,
                }}
              >
                {item.status === 'failed' ? 'Upload failed' : 'Uploading...'}
              </Text>
            )}
          </View>
        </View>
      ) : null}
    </Animated.View>
  );
}
