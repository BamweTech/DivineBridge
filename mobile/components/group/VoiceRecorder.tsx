import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, cancelAnimation } from 'react-native-reanimated';
import Icon from '@/components/ui/Icon';
import { THEME_COLORS } from '@/lib/constants';

const MAX_DURATION_MS = 120_000;

type VoiceRecorderProps = {
  onSend: (uri: string, durationMs: number) => void;
};

export function VoiceRecorder({ onSend }: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseScale = useSharedValue(1);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  useEffect(() => {
    if (isRecording) {
      pulseScale.value = withRepeat(withTiming(1.25, { duration: 800 }), -1, true);
    } else {
      cancelAnimation(pulseScale);
      pulseScale.value = 1;
    }
  }, [isRecording, pulseScale]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    };
  }, []);

  const formatTime = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const startRecording = useCallback(async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission needed', 'Please allow microphone access to send voice messages.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = recording;
      setIsRecording(true);
      setElapsed(0);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        const now = Date.now() - startTime;
        setElapsed(now);
        if (now >= MAX_DURATION_MS) {
          void stopAndSend();
        }
      }, 250);
    } catch (err) {
      Alert.alert('Recording failed', err instanceof Error ? err.message : 'Try again.');
    }
  }, []);

  const stopAndSend = useCallback(async () => {
    if (!recordingRef.current) return;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      const rec = recordingRef.current;
      recordingRef.current = null;
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = rec.getURI();
      const status = await rec.getStatusAsync();
      const durationMs = status.durationMillis ?? elapsed;
      setIsRecording(false);
      setElapsed(0);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (uri) onSend(uri, durationMs);
    } catch (err) {
      setIsRecording(false);
      setElapsed(0);
      Alert.alert('Recording error', err instanceof Error ? err.message : 'Try again.');
    }
  }, [elapsed, onSend]);

  const cancelRecording = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      if (recordingRef.current) {
        await recordingRef.current.stopAndUnloadAsync();
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
        recordingRef.current = null;
      }
    } catch {}
    setIsRecording(false);
    setElapsed(0);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  if (!isRecording) {
    return (
      <Pressable
        onPress={startRecording}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: THEME_COLORS.bg3,
          borderWidth: 1,
          borderColor: THEME_COLORS.border,
        }}
      >
        <Icon name="voice-note" size={16} color={THEME_COLORS.text2} />
      </Pressable>
    );
  }

  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Pressable
        onPress={cancelRecording}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(176,90,80,0.08)',
          borderWidth: 1,
          borderColor: 'rgba(176,90,80,0.2)',
        }}
      >
        <Icon name="trash" size={14} color={THEME_COLORS.rose} />
      </Pressable>

      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Animated.View style={[{ width: 10, height: 10, borderRadius: 5, backgroundColor: THEME_COLORS.rose }, pulseStyle]} />
        <Text style={{ color: THEME_COLORS.text, fontFamily: 'InterTight_600SemiBold', fontSize: 15 }}>
          {formatTime(elapsed)}
        </Text>
        <Text style={{ color: THEME_COLORS.text3, fontFamily: 'InterTight_400Regular', fontSize: 12 }}>
          / {formatTime(MAX_DURATION_MS)}
        </Text>
      </View>

      <Pressable
        onPress={stopAndSend}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: THEME_COLORS.gold,
        }}
      >
        <Icon name="send" size={14} color="#ffffff" />
      </Pressable>
    </View>
  );
}
