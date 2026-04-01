import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Audio, AVPlaybackStatus } from 'expo-av';
import Icon from '@/components/ui/Icon';
import { THEME_COLORS } from '@/lib/constants';

let activeSound: Audio.Sound | null = null;

type AudioMessageBubbleProps = {
  uri: string;
  isMe: boolean;
};

export function AudioMessageBubble({ uri, isMe }: AudioMessageBubbleProps) {
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const soundRef = useRef<Audio.Sound | null>(null);

  const formatTime = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setPositionMs(status.positionMillis);
    if (status.durationMillis) setDurationMs(status.durationMillis);
    if (status.didJustFinish) {
      setPlaying(false);
      setPositionMs(0);
    }
  }, []);

  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  const togglePlayPause = useCallback(async () => {
    try {
      if (!soundRef.current) {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });

        if (activeSound) {
          await activeSound.pauseAsync().catch(() => {});
        }

        const { sound } = await Audio.Sound.createAsync(
          { uri },
          { shouldPlay: true },
          onPlaybackStatusUpdate,
        );
        soundRef.current = sound;
        activeSound = sound;
        setPlaying(true);
        return;
      }

      const status = await soundRef.current.getStatusAsync();
      if (!status.isLoaded) return;

      if (status.isPlaying) {
        await soundRef.current.pauseAsync();
        setPlaying(false);
      } else {
        if (activeSound && activeSound !== soundRef.current) {
          await activeSound.pauseAsync().catch(() => {});
        }
        activeSound = soundRef.current;
        if (status.positionMillis >= (status.durationMillis ?? 0)) {
          await soundRef.current.setPositionAsync(0);
        }
        await soundRef.current.playAsync();
        setPlaying(true);
      }
    } catch {
      setPlaying(false);
    }
  }, [uri, onPlaybackStatusUpdate]);

  const progress = durationMs > 0 ? positionMs / durationMs : 0;
  const bg = isMe ? THEME_COLORS.goldDim : THEME_COLORS.bg2;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 18,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: THEME_COLORS.border,
        minWidth: 200,
        maxWidth: 264,
      }}
    >
      <Pressable
        onPress={togglePlayPause}
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: THEME_COLORS.gold,
        }}
      >
        <Icon
          name={playing ? 'pause' : 'play'}
          size={16}
          color="#ffffff"
        />
      </Pressable>

      <View style={{ flex: 1, gap: 4 }}>
        <View
          style={{
            height: 4,
            borderRadius: 2,
            backgroundColor: THEME_COLORS.bg3,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              height: '100%',
              width: `${progress * 100}%`,
              backgroundColor: THEME_COLORS.gold,
              borderRadius: 2,
            }}
          />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 11 }}>
            {formatTime(positionMs)}
          </Text>
          <Text style={{ color: THEME_COLORS.text3, fontFamily: 'Geist_400Regular', fontSize: 11 }}>
            {durationMs > 0 ? formatTime(durationMs) : '—'}
          </Text>
        </View>
      </View>
    </View>
  );
}
