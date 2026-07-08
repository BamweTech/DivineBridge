'use strict';

(function () {
  const cfg = window.VOICE_CALL_CONFIG || {};
  const roomId = cfg.roomId;
  const roomCode = (cfg.roomCode || '').trim();
  const hostName = cfg.hostName || 'Host';

  let firebaseApp = null;
  let auth = null;
  let db = null;
  let sfuClient = null;
  let roomUnsub = null;
  let expiryTimer = null;
  let countdownTimer = null;
  let isMuted = false;
  let speakerOn = true;
  let localUserId = null;
  let expiresAtMs = null;
  let ending = false;
  let inCall = false;
  let tornDown = false;

  const $ = (id) => document.getElementById(id);

  const GUEST_DISPLAY_NAME = 'Guest';

  function showState(name) {
    ['connecting', 'incall', 'ended'].forEach((s) => {
      const el = $(`vc-state-${s}`);
      if (!el) return;
      const active = s === name;
      el.hidden = !active;
      el.style.display = active ? 'flex' : 'none';
    });
    // Hide legacy landing panel if a cached older HTML version is still served.
    const legacy = $('vc-state-landing');
    if (legacy) {
      legacy.hidden = true;
      legacy.style.display = 'none';
    }
  }

  async function apiFetch(path, options = {}) {
    const user = auth && auth.currentUser;
    if (!user) throw new Error('Not signed in');
    const token = await user.getIdToken();
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    };
    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  function updateRemoteAudio(peers) {
    if (!peers || typeof peers.forEach !== 'function') return;
    const active = new Set();
    peers.forEach((peer, peerId) => {
      if (peerId === localUserId || !peer.stream) return;
      active.add(peerId);
      const tracks = peer.stream.getAudioTracks();
      if (!tracks.length) return;
      const elId = `sfu-audio-${peerId}`;
      let audioEl = document.getElementById(elId);
      const stream = new MediaStream(tracks);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = elId;
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        document.body.appendChild(audioEl);
      }
      if (audioEl.srcObject !== stream) {
        audioEl.srcObject = stream;
        audioEl.play().catch(() => {});
      }
      if (typeof audioEl.setSinkId === 'function' && speakerOn) {
        audioEl.setSinkId('').catch(() => {});
      }
    });
    document.querySelectorAll('audio[id^="sfu-audio-"]').forEach((el) => {
      const peerId = el.id.replace('sfu-audio-', '');
      if (!active.has(peerId)) {
        el.srcObject = null;
        el.remove();
      }
    });
  }

  function parseExpiresAtMs(raw) {
    if (!raw) return null;
    if (raw.toDate && typeof raw.toDate === 'function') {
      return raw.toDate().getTime();
    }
    if (typeof raw === 'string' || typeof raw === 'number') {
      const parsed = Date.parse(String(raw));
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function setExpiresFromJoin(joinResult) {
    if (joinResult == null) return;
    if (typeof joinResult.seconds_remaining === 'number' && joinResult.seconds_remaining > 0) {
      expiresAtMs = Date.now() + joinResult.seconds_remaining * 1000;
      return;
    }
    if (joinResult.expires_at) {
      const parsed = Date.parse(joinResult.expires_at);
      if (Number.isFinite(parsed) && parsed > Date.now()) {
        expiresAtMs = parsed;
      }
    }
  }

  function tryStartCountdownFromRoom(data) {
    if (expiresAtMs) return;
    const parsed = parseExpiresAtMs(data.expires_at);
    if (parsed && parsed > Date.now()) {
      expiresAtMs = parsed;
      startCountdown();
    }
  }

  function updatePeerLabel(data) {
    const count = (data.participants || []).filter((p) => p.is_active !== false).length;
    const peerLabel = $('vc-peer-label');
    if (peerLabel) {
      peerLabel.textContent = count > 1 ? `Connected with ${hostName}` : 'Waiting for the other person…';
    }
  }

  async function confirmRoomEnded() {
    try {
      const res = await fetch(`/api/prayer-room/room/${roomId}`);
      if (!res.ok) return false;
      const data = await res.json().catch(() => ({}));
      const room = data.room || data;
      return room.is_active === false;
    } catch {
      return false;
    }
  }

  function startCountdown() {
    if (!expiresAtMs || !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return;
    const timerEl = $('vc-timer');
    if (timerEl) timerEl.hidden = false;

    const tick = () => {
      const remaining = Math.max(0, expiresAtMs - Date.now());
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      if (timerEl) {
        timerEl.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
      }
      if (remaining <= 0) {
        clearInterval(countdownTimer);
        void endCall('timeout');
      }
    };
    tick();
    countdownTimer = setInterval(tick, 1000);

    const delay = Math.max(0, expiresAtMs - Date.now());
    expiryTimer = setTimeout(() => void endCall('timeout'), delay);
  }

  function watchRoom() {
    if (!db || !roomId) return;
    roomUnsub = db.collection('prayer_rooms').doc(roomId).onSnapshot(
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.exists) return;
        const data = snap.data() || {};
        updatePeerLabel(data);
        tryStartCountdownFromRoom(data);

        // Ignore cached/offline snapshots for end detection — stale cache caused false "call ended" UI.
        if (snap.metadata && snap.metadata.fromCache) return;
        if (!inCall || data.is_active !== false || ending) return;

        void (async () => {
          const confirmed = await confirmRoomEnded();
          if (!confirmed || ending) return;
          const msg = data.ended_reason === 'timeout'
            ? 'This call reached the 10-minute limit.'
            : 'The other person ended the call.';
          await teardown(msg);
        })();
      },
      (err) => {
        console.warn('[voice-call] room listener error', err);
      },
    );
  }

  async function initFirebase() {
    if (!cfg.firebaseConfig) throw new Error('Firebase not configured');
    if (cfg.linkInvalid || !roomCode) {
      throw new Error('Invalid call link');
    }
    if (!firebase.apps.length) {
      firebaseApp = firebase.initializeApp(cfg.firebaseConfig);
    } else {
      firebaseApp = firebase.app();
    }
    auth = firebase.auth();
    db = firebase.firestore();
    if (!auth.currentUser) {
      await auth.signInAnonymously();
    }
    localUserId = auth.currentUser.uid;
  }

  async function connectSfu(displayName) {
    const joinResult = await apiFetch(`/api/prayer-room/join/${roomId}`, {
      method: 'POST',
      body: JSON.stringify({ room_code: roomCode, display_name: displayName }),
    });

    setExpiresFromJoin(joinResult);

    const tokenResp = await apiFetch(`/api/prayer-room/sfu-token/${roomId}`, { method: 'POST' });
    let sfuUrl = tokenResp.sfuUrl || 'wss://sfu.divinebridge.io/ws';
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!isLocal && (!sfuUrl || /localhost|127\.0\.0\.1/i.test(sfuUrl))) {
      sfuUrl = 'wss://sfu.divinebridge.io/ws';
    }

    const userCred = await auth.signInWithCustomToken(tokenResp.customToken);
    const idToken = await userCred.user.getIdToken();
    localUserId = userCred.user.uid;

    sfuClient = new window.SfuClient({
      sfuUrl,
      token: idToken,
      roomId,
      userId: localUserId,
      userName: displayName,
      isSpeaker: true,
    });
    sfuClient.onPeersChanged = updateRemoteAudio;
    await sfuClient.start({ videoEnabled: false });
  }

  async function autoJoin() {
    if (!roomCode) {
      showState('ended');
      $('vc-ended-reason').textContent = 'Invalid call link (missing code).';
      return;
    }

    showState('connecting');

    try {
      await initFirebase();
      await connectSfu(GUEST_DISPLAY_NAME);
      inCall = true;
      showState('incall');
      $('vc-status-text').textContent = 'In call';
      $('vc-peer-label').textContent = 'Connecting audio…';
      watchRoom();
      startCountdown();
    } catch (err) {
      console.error('[voice-call]', err);
      showState('ended');
      $('vc-ended-reason').textContent = err.message || 'Could not join the call.';
    }
  }

  async function endCall(reason) {
    if (ending) return;
    ending = true;
    try {
      await apiFetch(`/api/prayer-room/room/${roomId}/end`, {
        method: 'POST',
        body: JSON.stringify({ ended_reason: reason || 'user' }),
      });
      await teardown(reason === 'timeout' ? 'This call reached the 10-minute limit.' : 'You left the call.');
    } catch (e) {
      console.warn('[voice-call] end failed', e);
      ending = false;
      inCall = true;
      $('vc-status-text').textContent = 'In call';
      showState('incall');
    }
  }

  async function teardown(message) {
    if (tornDown) return;
    tornDown = true;
    ending = true;
    inCall = false;
    if (countdownTimer) clearInterval(countdownTimer);
    if (expiryTimer) clearTimeout(expiryTimer);
    if (roomUnsub) roomUnsub();
    if (sfuClient) {
      await sfuClient.destroy();
      sfuClient = null;
    }
    document.querySelectorAll('audio[id^="sfu-audio-"]').forEach((el) => {
      el.srcObject = null;
      el.remove();
    });
    showState('ended');
    const reasonEl = $('vc-ended-reason');
    if (reasonEl) reasonEl.textContent = message || 'The call has ended.';
  }

  function bindControls() {
    $('vc-mute-btn')?.addEventListener('click', async () => {
      if (!sfuClient) return;
      isMuted = !isMuted;
      await sfuClient.setAudioEnabled(!isMuted);
      $('vc-mute-btn')?.classList.toggle('active', isMuted);
      const label = $('vc-mute-btn')?.querySelector('.vc-control-label');
      if (label) label.textContent = isMuted ? 'Unmute' : 'Mute';
      apiFetch(`/api/prayer-room/${roomId}/self-mute`, {
        method: 'POST',
        body: JSON.stringify({ muted: isMuted }),
      }).catch(() => {});
    });
    $('vc-speaker-btn')?.addEventListener('click', () => {
      speakerOn = !speakerOn;
      $('vc-speaker-btn')?.classList.toggle('active', speakerOn);
      const label = $('vc-speaker-btn')?.querySelector('.vc-control-label');
      if (label) label.textContent = speakerOn ? 'Speaker' : 'Earpiece';
    });
    $('vc-end-btn')?.addEventListener('click', () => void endCall('user'));
  }

  function initLanding() {
    if (cfg.linkInvalid) {
      showState('ended');
      $('vc-ended-reason').textContent = 'Invalid call link. Ask the host to share the full link again.';
      return;
    }
    if (cfg.isExpired) {
      showState('ended');
      $('vc-ended-reason').textContent = 'This call link has expired.';
      return;
    }
    if (!cfg.isActive) {
      showState('ended');
      $('vc-ended-reason').textContent = 'This call has already ended.';
      return;
    }
    if (cfg.isFull) {
      showState('ended');
      $('vc-ended-reason').textContent = 'This call is full (2 participants max).';
      return;
    }
    void autoJoin();
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindControls();
    showState('connecting');
    initLanding();
  });
})();
