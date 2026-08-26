import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import { resolvePreferredEnglishVoiceId } from '@/lib/speechVoice';

/**
 * iOS: use a dedicated audio session so TTS works even when the app uses other audio (e.g. rooms).
 */
const BASE_SPEECH_OPTIONS = {
  language: 'en-US' as const,
  ...(Platform.OS === 'ios' ? { useApplicationAudioSession: false as const } : {}),
};

function chunkString(text: string, maxLen: number): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}

function maxChunkLength(): number {
  const n = Speech.maxSpeechInputLength;
  if (typeof n === 'number' && n > 200) return n;
  return 4000;
}

/**
 * Shared TTS for Home (verse / prayer) and Devotional. Stops on unmount.
 * Long text is split into chunks — one string over the platform limit produces no audio.
 */
export function useSpeechPlayback() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const isSpeakingRef = useRef(false);
  const activeSourceRef = useRef<string | null>(null);
  /** OS voice id from `getAvailableVoicesAsync` (Enhanced on iOS when installed). */
  const preferredVoiceRef = useRef<string | undefined>(undefined);
  /** Bumps invalidate in-flight chunk chains (new speak / stop / unmount). */
  const generationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void resolvePreferredEnglishVoiceId().then((id) => {
      if (!cancelled) preferredVoiceRef.current = id;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    isSpeakingRef.current = false;
    activeSourceRef.current = null;
    setIsSpeaking(false);
    setActiveSource(null);
    void Speech.stop();
  }, []);

  const speak = useCallback((parts: string[], source: string) => {
    const text = parts.map((p) => p.trim()).filter(Boolean).join('. ');
    if (!text) return;

    const myGen = ++generationRef.current;

    void Speech.stop().finally(() => {
      if (myGen !== generationRef.current) return;

      const chunks = chunkString(text, maxChunkLength());
      if (chunks.length === 0) return;

      isSpeakingRef.current = true;
      activeSourceRef.current = source;
      setIsSpeaking(true);
      setActiveSource(source);

      let idx = 0;
      const finish = () => {
        if (myGen !== generationRef.current) return;
        isSpeakingRef.current = false;
        activeSourceRef.current = null;
        setIsSpeaking(false);
        setActiveSource(null);
      };

      const speakNext = () => {
        if (myGen !== generationRef.current) return;
        if (idx >= chunks.length) {
          finish();
          return;
        }
        const chunk = chunks[idx];
        idx += 1;
        const voiceId = preferredVoiceRef.current;
        Speech.speak(chunk, {
          ...BASE_SPEECH_OPTIONS,
          ...(voiceId ? { voice: voiceId } : {}),
          onDone: () => speakNext(),
          onStopped: () => finish(),
          onError: () => finish(),
        });
      };

      speakNext();
    });
  }, []);

  const toggle = useCallback(
    (parts: string[], source: string) => {
      if (isSpeakingRef.current && activeSourceRef.current === source) {
        stop();
        return;
      }
      speak(parts, source);
    },
    [speak, stop]
  );

  useEffect(
    () => () => {
      generationRef.current += 1;
      void Speech.stop();
    },
    []
  );

  return { speak, stop, toggle, isSpeaking, activeSource };
}
