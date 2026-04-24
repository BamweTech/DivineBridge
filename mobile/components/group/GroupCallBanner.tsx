import React, { useEffect, useRef, useCallback } from 'react';
import { View, Text, Pressable, Animated, Easing } from 'react-native';
import { useRouter } from 'expo-router';
import { startCallRingtone, stopCallRingtone } from '@/lib/callRingtone';
import Icon from '@/components/ui/Icon';
import { THEME_COLORS } from '@/lib/constants';

type Props = {
  groupId: string;
  groupName: string;
  hostName: string;
  onDismiss: () => void;
};

export function GroupCallBanner({ groupId, groupName, hostName, onDismiss }: Props) {
  const router = useRouter();
  const pulse = useRef(new Animated.Value(1)).current;

  const dismiss = useCallback(() => {
    stopCallRingtone();
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    startCallRingtone();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.15, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();

    const timeout = setTimeout(dismiss, 15000);
    return () => {
      clearTimeout(timeout);
      stopCallRingtone();
    };
  }, []);

  return (
    <View style={{
      position: 'absolute',
      top: 54,
      left: 16,
      right: 16,
      backgroundColor: '#1a2a1a',
      borderRadius: 16,
      padding: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 12,
      elevation: 8,
      zIndex: 9999,
    }}>
      <Animated.View style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: THEME_COLORS.sage,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ scale: pulse }],
      }}>
        <Icon name="gathering" size={22} color="#fff" />
      </Animated.View>

      <View style={{ flex: 1 }}>
        <Text style={{ color: '#fff', fontFamily: 'InterTight_600SemiBold', fontSize: 14 }} numberOfLines={1}>
          {groupName}
        </Text>
        <Text style={{ color: THEME_COLORS.sage, fontFamily: 'InterTight_400Regular', fontSize: 12, marginTop: 2 }} numberOfLines={1}>
          {hostName} started a live prayer
        </Text>
      </View>

      <Pressable
        onPress={() => {
          dismiss();
          router.push(`/group/${groupId}`);
        }}
        style={{
          backgroundColor: THEME_COLORS.sage,
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderRadius: 20,
        }}
        hitSlop={8}
      >
        <Text style={{ color: '#fff', fontFamily: 'InterTight_600SemiBold', fontSize: 13 }}>Join</Text>
      </Pressable>

      <Pressable onPress={dismiss} hitSlop={8}>
        <Icon name="cross" size={16} color={THEME_COLORS.text3} />
      </Pressable>
    </View>
  );
}
