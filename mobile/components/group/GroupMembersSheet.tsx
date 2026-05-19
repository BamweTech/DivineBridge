import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle } from '@/lib/typography';
import { Avatar } from '@/components/ui/Avatar';
import type { GroupMember } from '@/types';

export function GroupMembersSheet({
  visible,
  groupName,
  members,
  loading,
  onClose,
}: {
  visible: boolean;
  groupName: string;
  members: GroupMember[];
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(44,36,22,0.45)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: THEME_COLORS.bg,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: 20,
            paddingTop: 14,
            paddingBottom: 32,
            maxHeight: '72%',
          }}
        >
          <View style={{ width: 36, height: 4, backgroundColor: THEME_COLORS.border, borderRadius: 2, alignSelf: 'center', marginBottom: 18 }} />
          <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('700'), fontSize: 18 }}>
            {groupName}
          </Text>
          <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 13, marginTop: 4, marginBottom: 14 }}>
            {loading ? 'Loading members...' : `${members.length} ${members.length === 1 ? 'member' : 'members'}`}
          </Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {loading ? (
              <ActivityIndicator color={THEME_COLORS.gold} style={{ marginTop: 18 }} />
            ) : (
              members.map((member) => (
                <View
                  key={member.uid}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 12,
                    borderTopWidth: 1,
                    borderTopColor: THEME_COLORS.border,
                  }}
                >
                  <Avatar name={member.display_name} photoUrl={member.photo_url} size={34} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: THEME_COLORS.text, ...iosFontStyle('600'), fontSize: 14 }}>
                      {member.display_name}
                    </Text>
                    <Text style={{ color: member.role === 'admin' ? THEME_COLORS.gold : THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 12, marginTop: 2 }}>
                      {member.role === 'admin' ? 'Admin' : 'Member'}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
