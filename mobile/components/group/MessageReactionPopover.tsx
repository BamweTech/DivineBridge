import React from 'react';
import { View, Text, Pressable, Modal, Dimensions, ScrollView } from 'react-native';
import { THEME_COLORS } from '@/lib/constants';
import {
  REACTION_OPTIONS,
  type ReactionPopoverState,
} from '@/components/group/groupChatUtils';

export function MessageReactionPopover({
  visible,
  state,
  userUid,
  topInset,
  onClose,
  onReact,
}: {
  visible: boolean;
  state: ReactionPopoverState | null;
  userUid?: string;
  topInset: number;
  onClose: () => void;
  onReact: (messageId: string, emoji: string) => void;
}) {
  if (!state) return null;

  const { width, height } = Dimensions.get('window');
  const pickerWidth = Math.min(width - 24, 320);
  const preferredLeft = state.align === 'right'
    ? state.anchorX - pickerWidth + 32
    : state.anchorX - 32;
  const left = Math.min(Math.max(12, preferredLeft), width - pickerWidth - 12);
  const top = state.anchorY > 98
    ? Math.max(topInset + 8, state.anchorY - 70)
    : Math.min(height - 82, state.anchorY + 18);

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        style={{ flex: 1 }}
        onPress={onClose}
      >
        <View pointerEvents="box-none" style={{ flex: 1 }}>
          <Pressable
            onPress={() => {}}
            style={{
              position: 'absolute',
              top,
              left,
              width: pickerWidth,
              paddingHorizontal: 10,
              paddingVertical: 10,
              borderRadius: 18,
              backgroundColor: THEME_COLORS.bg,
              borderWidth: 1,
              borderColor: THEME_COLORS.border,
              shadowColor: '#000',
              shadowOpacity: 0.14,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 12,
            }}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 4, alignItems: 'center', paddingVertical: 2 }}
            >
              {REACTION_OPTIONS.map((emoji) => {
                const reactedByMe = !!userUid && (state.message.reactions?.[emoji] ?? []).includes(userUid);
                return (
                  <Pressable
                    key={`${state.message.message_id}-picker-${emoji}`}
                    onPress={() => {
                      onReact(state.message.message_id, emoji);
                      onClose();
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                    style={{ paddingHorizontal: 6, paddingVertical: 4 }}
                  >
                    <Text
                      style={{
                        fontSize: 26,
                        lineHeight: 30,
                        opacity: reactedByMe ? 1 : 0.92,
                      }}
                    >
                      {emoji}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
