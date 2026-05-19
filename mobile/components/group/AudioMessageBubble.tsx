import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Audio, AVPlaybackStatus } from 'expo-av';
import Svg, { Circle } from 'react-native-svg';
import Icon from '@/components/ui/Icon';
import { THEME_COLORS } from '@/lib/constants';
import { iosFontStyle } from '@/lib/typography';

let activeSound: Audio.Sound | null = null;

const CIRCLE_SIZE = 52;
const STROKE_WIDTH = 3;
const RADIUS = (CIRCLE_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

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
  const strokeDashoffset = CIRCUMFERENCE * (1 - progress);

  return (
    <View style={{ alignItems: isMe ? 'flex-end' : 'flex-start' }}>
      <Pressable
        onPress={togglePlayPause}
        style={{ alignItems: 'center', gap: 4 }}
      >
        <View style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE }}>
          <Svg width={CIRCLE_SIZE} height={CIRCLE_SIZE} style={{ position: 'absolute' }}>
            {/* Background track */}
            <Circle
              cx={CIRCLE_SIZE / 2}
              cy={CIRCLE_SIZE / 2}
              r={RADIUS}
              stroke={THEME_COLORS.border}
              strokeWidth={STROKE_WIDTH}
              fill={isMe ? THEME_COLORS.gold : THEME_COLORS.bg3}
            />
            {/* Progress ring */}
            {progress > 0 && (
              <Circle
                cx={CIRCLE_SIZE / 2}
                cy={CIRCLE_SIZE / 2}
                r={RADIUS}
                stroke="#ffffff"
                strokeWidth={STROKE_WIDTH}
                fill="transparent"
                strokeDasharray={`${CIRCUMFERENCE}`}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                rotation="-90"
                origin={`${CIRCLE_SIZE / 2}, ${CIRCLE_SIZE / 2}`}
              />
            )}
          </Svg>
          <View style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <Icon
              name={playing ? 'pause' : 'play'}
              size={18}
              color={isMe ? '#ffffff' : THEME_COLORS.text}
            />
          </View>
        </View>
        <Text style={{
          color: THEME_COLORS.text3,
          ...iosFontStyle('400'),
          fontSize: 10,
        }}>
          {durationMs > 0 ? formatTime(playing ? positionMs : durationMs) : '—'}
        </Text>
      </Pressable>
    </View>
  );
}
