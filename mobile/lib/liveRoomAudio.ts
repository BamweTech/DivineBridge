/**
 * Live prayer room / WebRTC output routing — loudspeaker vs earpiece.
 * Uses expo-av for session + Android route; react-native-incall-manager for
 * reliable speakerphone on iOS (and reinforcement on Android) with webrtc.
 */

import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { Platform } from 'react-native';
import { isWebRTCAvailable } from '@/lib/sfu';

export type LiveRoomAudioRoute = 'speaker' | 'earpiece';

function getInCallManager(): {
  start: (o?: { media?: string }) => void;
  stop: () => void;
  setSpeakerphoneOn: (v: boolean) => void;
  setForceSpeakerphoneOn: (v: boolean) => void;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-incall-manager').default;
  } catch {
    return null;
  }
}

/**
 * @param route speaker = main loudspeaker; earpiece = phone receiver (quieter, private)
 */
export async function setLiveRoomAudioRoute(route: LiveRoomAudioRoute): Promise<void> {
  if (!isWebRTCAvailable) return;

  const earpiece = route === 'earpiece';

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    shouldDuckAndroid: true,
    playThroughEarpieceAndroid: earpiece,
  });

  const icm = getInCallManager();
  if (!icm) return;

  icm.start({ media: 'audio' });
  const useSpeaker = !earpiece;
  if (Platform.OS === 'ios') {
    icm.setForceSpeakerphoneOn(useSpeaker);
  } else {
    icm.setSpeakerphoneOn(useSpeaker);
    icm.setForceSpeakerphoneOn(useSpeaker);
  }
}

/** Call when leaving the live room so other app audio behaves normally. */
export async function resetLiveRoomAudio(): Promise<void> {
  const icm = getInCallManager();
  if (icm) {
    try {
      icm.stop();
    } catch {
      /* noop */
    }
  }

  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: false,
      staysActiveInBackground: false,
      interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  } catch {
    /* noop */
  }
}
