import React from 'react';
import { View, Text } from 'react-native';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle } from '@/lib/typography';

export function DateDivider({ label }: { label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 10 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: THEME_COLORS.border }} />
      <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('500'), fontSize: 11 }}>
        {label}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: THEME_COLORS.border }} />
    </View>
  );
}

export function UnreadDivider({ count }: { count: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 14 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: THEME_COLORS.goldBorder }} />
      <View
        style={{
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 999,
          backgroundColor: THEME_COLORS.goldDim,
          borderWidth: 1,
          borderColor: THEME_COLORS.goldBorder,
        }}
      >
        <Text style={{ color: THEME_COLORS.gold, ...iosFontStyle('600'), fontSize: 11 }}>
          {count > 0 ? `${count} new message${count === 1 ? '' : 's'}` : 'New messages'}
        </Text>
      </View>
      <View style={{ flex: 1, height: 1, backgroundColor: THEME_COLORS.goldBorder }} />
    </View>
  );
}
