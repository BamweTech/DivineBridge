import * as Speech from 'expo-speech';
import { VoiceQuality } from 'expo-speech';

/**
 * Picks the most natural-sounding English voice the OS exposes to expo-speech.
 *
 * **iOS — sounds more human:** Settings → Accessibility → Spoken Content → Voices → English →
 * download an **Enhanced** voice (e.g. Samantha, Allison). Those report `quality: Enhanced` here.
 *
 * **Android:** Quality varies by device; we still prefer English voices. Users can install
 * Google Text-to-Speech voices in system settings for better output.
 *
 * **Beyond device TTS:** For studio-quality or custom voices you’d use recorded audio or a
 * cloud API (e.g. Polly, ElevenLabs) and `expo-av` — not `expo-speech`.
 */
export async function resolvePreferredEnglishVoiceId(): Promise<string | undefined> {
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    if (!voices?.length) return undefined;

    const en = voices.filter((v) => (v.language ?? '').toLowerCase().startsWith('en'));
    const pool = en.length > 0 ? en : voices;

    const enhanced = pool.filter((v) => v.quality === VoiceQuality.Enhanced);
    if (enhanced.length > 0) {
      const us = enhanced.find((v) => (v.language ?? '').toLowerCase().includes('us'));
      return (us ?? enhanced[0]).identifier;
    }

    const usDefault = pool.find((v) => (v.language ?? '').toLowerCase() === 'en-us');
    if (usDefault) return usDefault.identifier;

    return pool[0].identifier;
  } catch {
    return undefined;
  }
}
