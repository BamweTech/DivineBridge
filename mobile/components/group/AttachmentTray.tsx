import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { THEME_COLORS } from '@/lib/constants';
import Icon from '@/components/ui/Icon';

export function AttachmentTray({
  onPickPhoto,
  onTakePhoto,
  onPickVideo,
  onPickDocument,
}: {
  onPickPhoto: () => void;
  onTakePhoto: () => void;
  onPickVideo: () => void;
  onPickDocument: () => void;
}) {
  const options = [
    {
      key: 'photo',
      label: 'Photo',
      sublabel: 'Choose from library',
      icon: 'image' as const,
      iconColor: '#2F7D6B',
      iconBg: 'rgba(47,125,107,0.14)',
      onPress: onPickPhoto,
    },
    {
      key: 'camera',
      label: 'Camera',
      sublabel: 'Take a photo',
      icon: 'camera' as const,
      iconColor: '#C67A12',
      iconBg: 'rgba(198,122,18,0.14)',
      onPress: onTakePhoto,
    },
    {
      key: 'video',
      label: 'Video',
      sublabel: 'Choose a video',
      icon: 'video' as const,
      iconColor: '#8A5CF6',
      iconBg: 'rgba(138,92,246,0.14)',
      onPress: onPickVideo,
    },
    {
      key: 'document',
      label: 'Document',
      sublabel: 'Share a file',
      icon: 'scroll' as const,
      iconColor: '#D3536A',
      iconBg: 'rgba(211,83,106,0.14)',
      onPress: onPickDocument,
    },
  ];

  return (
    <View
      style={{
        marginHorizontal: 12,
        marginTop: 8,
        marginBottom: 4,
        padding: 8,
        borderRadius: 18,
        backgroundColor: THEME_COLORS.bg2,
        borderWidth: 1,
        borderColor: THEME_COLORS.border,
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((option) => (
          <Pressable
            key={option.key}
            onPress={option.onPress}
            style={{
              width: '48%',
              minWidth: 146,
              paddingVertical: 12,
              paddingHorizontal: 12,
              borderRadius: 14,
              backgroundColor: THEME_COLORS.bg3,
              borderWidth: 1,
              borderColor: THEME_COLORS.border,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: option.iconBg,
              }}
            >
              <Icon name={option.icon} size={18} color={option.iconColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: THEME_COLORS.text, fontFamily: 'Geist_600SemiBold', fontSize: 13 }}>
                {option.label}
              </Text>
              <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 11, marginTop: 2 }}>
                {option.sublabel}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
