/**
 * Web stub — react-native-webrtc is a native-only module.
 * This file prevents metro from trying to bundle it for web.
 * The prayer room screen gracefully shows an unsupported message on web.
 */
export const RTCView = () => null;
export const isWebRTCAvailable = false;

export class WebRTCEngine {
  constructor() {}
  async start() {}
  async setVideoEnabled() {}
  setAudioEnabled() {}
  async transitionToMode() {}
  updateParticipantCount() {}
  async onNewSpeakerJoined() {}
  async onSpeakerLeft() {}
  async createOffer() {}
  getLocalStream() { return null; }
  getPeers() { return new Map(); }
  getCurrentMode() { return 'group_call' as const; }
  destroy() {}
  onPeersChanged?: any;
  onModeChanged?: any;
  onActiveSpeakersChanged?: any;
}

export class SfuEngine {
  constructor(_opts: any) {}
  async start(_opts: any) {}
  async setVideoEnabled(_enabled: boolean) {}
  setAudioEnabled(_enabled: boolean) {}
  updateParticipantCount(_count: number) {}
  getLocalStream() { return null; }
  getPeers() { return new Map(); }
  getCurrentMode() { return 'group_call' as const; }
  destroy() {}
  onPeersChanged?: any;
  onModeChanged?: any;
  onActiveSpeakersChanged?: any;
}
