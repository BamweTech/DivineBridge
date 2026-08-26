import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle } from '@/lib/typography';
import Icon from '@/components/ui/Icon';
import type { GroupChatMessage } from '@/types';
import { buildReplyPreviewText } from '@/features/groups/components/groupChatUtils';

export function ReplyComposerBanner({
  target,
  onCancel,
}: {
  target: GroupChatMessage;
  onCancel: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 14,
        paddingTop: 10,
        paddingBottom: 8,
        backgroundColor: THEME_COLORS.bg,
      }}
    >
      <View
        style={{
          flex: 1,
          borderLeftWidth: 3,
          borderLeftColor: THEME_COLORS.gold,
          paddingLeft: 10,
        }}
      >
        <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('600'), fontSize: 12 }}>
          Replying to {target.user_name}
        </Text>
        <Text
          numberOfLines={2}
          style={{ color: THEME_COLORS.text2, ...iosFontStyle('400'), fontSize: 12, marginTop: 2 }}
        >
          {buildReplyPreviewText(target)}
        </Text>
      </View>
      <Pressable
        onPress={onCancel}
        accessibilityRole="button"
        accessibilityLabel="Cancel reply"
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: THEME_COLORS.bg3,
          borderWidth: 1,
          borderColor: THEME_COLORS.border,
        }}
      >
        <Icon name="cross" size={12} color={THEME_COLORS.text3} />
      </Pressable>
    </View>
  );
}
