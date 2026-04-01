import React, { useState } from 'react';
import { View, Text, Pressable, Modal, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import * as Haptics from 'expo-haptics';
import { THEME_COLORS } from '@/lib/constants';
import Icon from '@/components/ui/Icon';
import type { PrayerGroup } from '@/types';

export function InviteSheet({ group, onClose }: { group: PrayerGroup; onClose: () => void }) {
  const inviteCode = group.invite_code;
  const inviteUrl = inviteCode
    ? `https://divinebridge.io/join/${group.group_id}?code=${inviteCode}`
    : `https://divinebridge.io/join/${group.group_id}`;

  const [copied, setCopied] = useState(false);

  async function handleShare() {
    try {
      await Share.share({
        message: `Join me in "${group.name}" on DivineBridge — a space for prayer and community.\n\n${inviteUrl}`,
        url: inviteUrl,
      });
    } catch {}
  }

  async function handleCopy() {
    await Clipboard.setStringAsync(inviteUrl);
    setCopied(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(44,36,22,0.55)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: THEME_COLORS.bg,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: 24,
            paddingTop: 16,
            paddingBottom: 48,
          }}
        >
          {/* Handle */}
          <View style={{ width: 36, height: 4, backgroundColor: THEME_COLORS.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />

          {/* Title */}
          <Text style={{ color: THEME_COLORS.text, fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20, textAlign: 'center', marginBottom: 4, letterSpacing: -0.3 }}>
            Invite to Group
          </Text>
          <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 13, textAlign: 'center', marginBottom: 24 }} numberOfLines={1}>
            {group.name}
          </Text>

          {/* QR Code */}
          <View style={{ alignItems: 'center', marginBottom: 24 }}>
            <View style={{
              backgroundColor: '#ffffff',
              padding: 18,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: THEME_COLORS.border,
            }}>
              <QRCode
                value={inviteUrl}
                size={180}
                color={THEME_COLORS.text}
                backgroundColor="#ffffff"
              />
            </View>
            <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 10 }}>
              Scan to join
            </Text>
          </View>

          {/* Invite code badge */}
          {inviteCode && (
            <View style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              paddingVertical: 10,
              paddingHorizontal: 16,
              backgroundColor: THEME_COLORS.goldDim2,
              borderWidth: 1,
              borderColor: THEME_COLORS.goldBorder,
              borderRadius: 14,
              marginBottom: 20,
            }}>
              <Icon name="lock" size={14} color={THEME_COLORS.gold} />
              <Text style={{ color: THEME_COLORS.text2, fontFamily: 'Geist_400Regular', fontSize: 13 }}>
                Code: <Text style={{ color: THEME_COLORS.gold, fontFamily: 'Geist_700Bold', letterSpacing: 2 }}>{inviteCode}</Text>
              </Text>
            </View>
          )}

          {/* Action buttons */}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable
              onPress={handleCopy}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 15,
                borderRadius: 15,
                backgroundColor: copied ? THEME_COLORS.sageDim : THEME_COLORS.bg3,
                borderWidth: 1,
                borderColor: copied ? 'rgba(74,124,94,0.3)' : THEME_COLORS.border,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Icon name="attach" size={16} color={copied ? THEME_COLORS.sage : THEME_COLORS.text2} />
              <Text style={{ color: copied ? THEME_COLORS.sage : THEME_COLORS.text2, fontFamily: 'Geist_600SemiBold', fontSize: 14 }}>
                {copied ? 'Copied!' : 'Copy Link'}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleShare}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 15,
                borderRadius: 15,
                backgroundColor: THEME_COLORS.gold,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Icon name="share" size={16} color="#ffffff" />
              <Text style={{ color: '#ffffff', fontFamily: 'Geist_600SemiBold', fontSize: 14 }}>
                Share
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
