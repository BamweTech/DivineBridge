import React from 'react';
import { Text, Pressable } from 'react-native';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle } from '@/lib/typography';

export function JumpToLatestButton({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        position: 'absolute',
        right: 16,
        bottom: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 999,
        backgroundColor: THEME_COLORS.text,
        shadowColor: '#000',
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      }}
    >
      <Text style={{ color: '#fff', ...iosFontStyle('600'), fontSize: 12 }}>
        {count > 0 ? `${count} new` : 'Latest'}
      </Text>
      <Text style={{ color: '#fff', fontSize: 12 }}>↓</Text>
    </Pressable>
  );
}
