import { View, Text, ScrollView, Pressable, StyleSheet, Dimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { RTCView } from '@/lib/sfu';
import { VideoStreamView } from '@/components/room/VideoStreamView';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle } from '@/lib/typography';
import Icon from '@/components/ui/Icon';
import type { IconName } from '@/components/ui/Icon';
import type { PeerEntry } from '@/lib/sfu';
import type { LiveRoomAudioRoute } from '@/lib/liveRoomAudio';
import type { RoomMode } from '@/types';

type Props = {
  variant: 'embedded' | 'fullscreen';
  peers: Map<string, PeerEntry>;
  localStream: any;
  localVideoRevision: number;
  isVideoOn: boolean;
  isSpeaker: boolean;
  isMuted: boolean;
  userId: string | undefined;
  roomMode: RoomMode;
  modeSwitchToast: string | null;
  audioOutputRoute: LiveRoomAudioRoute;
  onToggleMute: () => void;
  onToggleAudioOutput: () => void;
  onToggleVideo: () => void;
  onLeave: () => void;
  onMaximize: () => void;
  onMinimize: () => void;
};

function AvControl({
  iconName,
  label,
  onPress,
  active,
  danger,
}: {
  iconName: IconName;
  label: string;
  onPress: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onPress();
      }}
      style={{ alignItems: 'center', gap: 4, minWidth: 52 }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: danger
            ? 'rgba(176,90,80,0.08)'
            : active
              ? THEME_COLORS.sageDim
              : THEME_COLORS.bg3,
          borderWidth: 1,
          borderColor: danger
            ? 'rgba(176,90,80,0.2)'
            : active
              ? 'rgba(74,124,94,0.3)'
              : THEME_COLORS.border,
        }}
      >
        <Icon
          name={iconName}
          size={16}
          color={danger ? THEME_COLORS.rose : active ? THEME_COLORS.sage : THEME_COLORS.text2}
        />
      </View>
      <Text style={{ color: THEME_COLORS.text3, ...iosFontStyle('400'), fontSize: 9 }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export function GroupLiveAvPanel({
  variant,
  peers,
  localStream,
  localVideoRevision,
  isVideoOn,
  isSpeaker,
  isMuted,
  userId,
  roomMode,
  modeSwitchToast,
  audioOutputRoute,
  onToggleMute,
  onToggleAudioOutput,
  onToggleVideo,
  onLeave,
  onMaximize,
  onMinimize,
}: Props) {
  const hasAnyVideo = isVideoOn || Array.from(peers.values()).some(
    (p) => p.userId !== userId && p.stream && p.isVideoEnabled,
  );

  return (
    <View style={[styles.shell, variant === 'embedded' && styles.shellEmbedded, variant === 'fullscreen' && styles.shellFullscreen]}>
      {modeSwitchToast ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{modeSwitchToast}</Text>
        </View>
      ) : null}

      {Array.from(peers.values()).map((peer) =>
        peer.userId !== userId && peer.stream && !peer.isVideoEnabled ? (
          <RTCView
            key={`audio-${peer.userId}-r${peer.revision}`}
            streamURL={peer.stream.toURL()}
            style={{ width: 0, height: 0, opacity: 0, position: 'absolute' }}
          />
        ) : null
      )}

      <View
        key={`vr-${hasAnyVideo ? 'vid' : 'aud'}`}
        style={[
          styles.videoRegion,
          variant === 'embedded' ? styles.videoEmbedded : styles.videoFullscreen,
        ]}
      >
        {hasAnyVideo ? (
          variant === 'embedded' ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flex: 1 }}
              contentContainerStyle={{ gap: 8, paddingVertical: 4, alignItems: 'center' }}
            >
              {isSpeaker && isVideoOn ? (
                <View key={`local-${localVideoRevision}`} style={styles.tileEmbedded}>
                  <VideoStreamView stream={localStream} style={StyleSheet.absoluteFillObject} objectFit="cover" mirror label="You" />
                </View>
              ) : null}
              {Array.from(peers.values()).map((peer) =>
                peer.userId !== userId && peer.stream && peer.isVideoEnabled ? (
                  <View key={`${peer.userId}-r${peer.revision}`} style={styles.tileEmbedded}>
                    <VideoStreamView
                      stream={peer.stream}
                      style={StyleSheet.absoluteFillObject}
                      objectFit="cover"
                      label={peer.userName?.split(' ')[0] ?? 'Guest'}
                    />
                  </View>
                ) : null
              )}
            </ScrollView>
          ) : (
            <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 8, alignContent: 'flex-start' }}>
              {isSpeaker && isVideoOn ? (
                <View key={`local-${localVideoRevision}`} style={[styles.tileFull, { width: (Dimensions.get('window').width - 24) / 2 }]}>
                  <VideoStreamView stream={localStream} style={StyleSheet.absoluteFillObject} objectFit="cover" mirror label="You" />
                </View>
              ) : null}
              {Array.from(peers.values()).map((peer) =>
                peer.userId !== userId && peer.stream && peer.isVideoEnabled ? (
                  <View key={`${peer.userId}-r${peer.revision}`} style={[styles.tileFull, { width: (Dimensions.get('window').width - 24) / 2 }]}>
                    <VideoStreamView
                      stream={peer.stream}
                      style={StyleSheet.absoluteFillObject}
                      objectFit="cover"
                      label={peer.userName?.split(' ')[0] ?? 'Guest'}
                    />
                  </View>
                ) : null
              )}
            </View>
          )
        ) : (
          <View style={styles.audioOnlyHint}>
            <Icon name="headphones" size={28} color={THEME_COLORS.text3} />
            <Text style={styles.audioOnlyText}>Audio only — tap Video below to enable</Text>
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <AvControl iconName={isMuted ? 'mic-off' : 'mic'} label={isMuted ? 'Unmute' : 'Mute'} onPress={onToggleMute} active={!isMuted} />
        <AvControl
          iconName={audioOutputRoute === 'speaker' ? 'audio' : 'headphones'}
          label={audioOutputRoute === 'speaker' ? 'Speaker' : 'Phone'}
          onPress={onToggleAudioOutput}
          active={audioOutputRoute === 'speaker'}
        />
        {isSpeaker ? (
          <AvControl iconName="video" label={isVideoOn ? 'Stop' : 'Video'} onPress={onToggleVideo} active={isVideoOn} />
        ) : null}
        {variant === 'embedded' ? (
          <AvControl iconName="maximize" label="Full screen" onPress={onMaximize} />
        ) : (
          <AvControl iconName="minimize" label="Minimize" onPress={onMinimize} />
        )}
        <AvControl iconName="leave" label="Leave" onPress={onLeave} danger />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: THEME_COLORS.bg2,
    borderBottomWidth: 1,
    borderBottomColor: THEME_COLORS.border,
  },
  shellEmbedded: {
    borderRadius: 0,
  },
  shellFullscreen: {
    flex: 1,
    borderBottomWidth: 0,
  },
  toast: {
    marginHorizontal: 12,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: THEME_COLORS.sageDim,
    borderWidth: 1,
    borderColor: 'rgba(74,124,94,0.25)',
  },
  toastText: {
    color: THEME_COLORS.text,
    ...iosFontStyle('500'),
    fontSize: 12,
    textAlign: 'center',
  },
  videoRegion: {},
  videoEmbedded: {
    height: 136,
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  videoFullscreen: {
    flex: 1,
    minHeight: 200,
  },
  tileEmbedded: {
    width: 108,
    height: 120,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: THEME_COLORS.bg3,
    borderWidth: 1,
    borderColor: THEME_COLORS.border,
  },
  tileFull: {
    aspectRatio: 3 / 4,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: THEME_COLORS.bg3,
    borderWidth: 1,
    borderColor: THEME_COLORS.border,
  },
  audioOnlyHint: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  audioOnlyText: {
    color: THEME_COLORS.text3,
    ...iosFontStyle('400'),
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderTopWidth: 1,
    borderTopColor: THEME_COLORS.border,
  },
});
