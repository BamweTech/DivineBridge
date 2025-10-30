// Prayer Room JavaScript
class PrayerRoomService {
    constructor() {
        this.roomId = null;
        this.userId = null;
        this.userName = null;
        this.isHost = false;
        this.isMuted = false;
        this.isAudioEnabled = false;
        this.peers = new Map();
        this.localStream = null;
        this.simplePeer = null;
        this.firestore = null;
        this.chatMessages = [];
        
        // WebRTC components for high-quality voice
        this.peerConnections = new Map();
        this.audioContext = null;
        this.audioAnalyser = null;
        this.voiceActivityThreshold = 0.01;
        this.isSpeaking = false;
        
        // Advanced Audio Processing Components
        this.audioProcessor = null;
        this.noiseSuppressor = null;
        this.echoCanceller = null;
        this.gainController = null;
        this.audioEnhancer = null;
        this.voiceActivityDetector = null;
        
        // Audio Quality Monitoring
        this.audioQualityMonitor = null;
        this.connectionQuality = 'good';
        this.adaptiveBitrate = false; // Disabled by default to prevent OverconstrainedError
        
        // Multi-device session management
        this.deviceSessions = new Map();
        this.currentDeviceId = null;
        this.sessionConflict = false;
        
        // Throttling for speaking state updates
        this.lastSpeakingStateUpdate = 0;
        this.speakingStateThrottleMs = 300; // Minimum 300ms between updates
        this.pendingSpeakingStateUpdate = false;
        this.voiceActivityDetectionActive = false; // Prevent multiple detection loops
        
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ];
        
        // Track processed signals to prevent duplicates
        this.processedSignals = new Set();
        this.maxProcessedSignals = 1000; // Limit to prevent memory issues
        
        this.init();
    }
    
    async init() {
        try {
            // Initialize Firebase
            await this.initializeFirebase();
            
            // Check authentication first
            await this.waitForAuth();
            const user = firebase.auth().currentUser;
            if (!user) {
                this.showError('Please log in to access the prayer room. Redirecting to login...');
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);
                return;
            }
            
            // Get room ID from URL
            this.roomId = this.getRoomIdFromUrl();
            if (!this.roomId) {
                this.showError('Room ID not found in URL. Please access the prayer room through the Live Prayer Room page.');
                setTimeout(() => {
                    window.location.href = '/prayer-rooms';
                }, 3000);
                return;
            }
            
            // Check for existing device sessions
            const hasConflict = await this.checkForExistingSession();
            if (hasConflict) {
                return; // User will handle the conflict dialog
            }
            
            // Initialize UI
            this.initializeUI();
            
            // Join the room
            await this.joinRoom();
            
            // Load initial data (non-blocking)
            this.loadChatMessages(); // Don't await - load in background
            this.loadParticipants(); // Don't await - load in background
            
            // Note: WebRTC initialization happens when user clicks "Join Audio"
            
        } catch (error) {
            console.error('Error initializing prayer room:', error);
            
            // Provide specific error messages
            if (error.message.includes('Firebase SDK not loaded')) {
                this.showError('Firebase is not loading properly. Please refresh the page and try again.');
            } else if (error.message.includes('Firebase Firestore not loaded')) {
                this.showError('Firebase Firestore is not available. Please refresh the page and try again.');
            } else if (error.message.includes('Auth state timeout')) {
                this.showError('Authentication is taking too long. Please refresh the page and try again.');
            } else {
                this.showError('Failed to initialize prayer room: ' + error.message);
            }
        }
    }
    
    async initializeFirebase() {
        // Wait for Firebase to be available and initialized
        let attempts = 0;
        while (typeof firebase === 'undefined' && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        
        if (typeof firebase === 'undefined') {
            throw new Error('Firebase SDK not loaded. Please refresh the page.');
        }
        
        // Check if Firebase app is already initialized
        if (!firebase.apps || firebase.apps.length === 0) {
            // Wait for Firebase to be initialized by the template
            let initAttempts = 0;
            while ((!firebase.apps || firebase.apps.length === 0) && initAttempts < 50) {
                await new Promise(resolve => setTimeout(resolve, 100));
                initAttempts++;
            }
            
            if (!firebase.apps || firebase.apps.length === 0) {
                throw new Error('Firebase app not initialized. Please refresh the page.');
            }
        }
        
        // Check if Firestore is available
        let firestoreAttempts = 0;
        while (typeof firebase.firestore !== 'function' && firestoreAttempts < 30) {
            await new Promise(resolve => setTimeout(resolve, 200));
            firestoreAttempts++;
        }
        
        if (typeof firebase.firestore !== 'function') {
            throw new Error('Firebase Firestore not loaded. Please refresh the page.');
        }
        
        // Initialize Firestore
        this.firestore = firebase.firestore();
        
        // Set up real-time listeners
        this.setupRealtimeListeners();
    }
    
    getRoomIdFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        const roomId = urlParams.get('room') || window.roomId;
        
        if (!roomId || roomId.trim() === '') {
            console.error('No room ID found in URL');
            return null;
        }
        
        return roomId;
    }
    
    async waitForAuth() {
        // Wait for Firebase auth to be ready
        let attempts = 0;
        while (typeof firebase === 'undefined' || !firebase.auth) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
            if (attempts > 50) {
                throw new Error('Firebase auth not available');
            }
        }
        
        // Wait for auth state to be determined
        return new Promise((resolve, reject) => {
            const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
                unsubscribe();
                resolve(user);
            });
            
            // Timeout after 5 seconds
            setTimeout(() => {
                unsubscribe();
                reject(new Error('Auth state timeout'));
            }, 5000);
        });
    }
    
    initializeUI() {
        // Set up event listeners for elements that exist
        const joinAudioBtn = document.getElementById('joinAudioBtn');
        const muteBtn = document.getElementById('muteBtn');
        const leaveBtn = document.getElementById('leaveBtn');
        const copyRoomCodeBtn = document.getElementById('copyRoomCodeBtn');
        const chatSendBtn = document.getElementById('sendBtn');
        
        if (joinAudioBtn) {
            joinAudioBtn.addEventListener('click', () => this.joinAudio());
        }
        
        if (muteBtn) {
            muteBtn.addEventListener('click', () => this.toggleMute());
        }
        
        if (leaveBtn) {
            leaveBtn.addEventListener('click', () => this.leaveRoom());
        }
        
        // Share button
        const shareBtn = document.getElementById('shareBtn');
        if (shareBtn) {
            shareBtn.addEventListener('click', () => this.shareRoom());
        }
        
        if (copyRoomCodeBtn) {
            copyRoomCodeBtn.addEventListener('click', () => this.copyRoomCode());
        }
        
        if (chatSendBtn) {
            chatSendBtn.addEventListener('click', () => this.sendChatMessage());
        }
        
        // Chat input enter key
        const chatInput = document.getElementById('chatInput');
        if (chatInput) {
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.sendChatMessage();
                }
            });
        }
        
        // Mobile layout is now handled by CSS - no tab navigation needed
        
        // Initialize audio controls
        this.updateAudioControls();
    }
    
    updateUserInfo() {
        // Update any UI elements that show user info
        const userElements = document.querySelectorAll('[data-user-name]');
        userElements.forEach(el => {
            el.textContent = this.userName;
        });
        
        // Update any user ID elements
        const userIdElements = document.querySelectorAll('[data-user-id]');
        userIdElements.forEach(el => {
            el.textContent = this.userId;
        });
        
        // Prayer room initialized successfully
    }
    
    async joinRoom() {
        try {
            if (!this.roomId) {
                throw new Error('Room ID is required');
            }
            
            // Wait for Firebase auth to be ready
            await this.waitForAuth();
            
            // Get user info from Firebase auth
            const user = firebase.auth().currentUser;
            if (!user) {
                this.showError('Please log in to join the prayer room. Redirecting to login...');
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);
                return;
            }
            
            this.userId = user.uid;
            this.userName = user.displayName || 'Anonymous';
            
            // Update UI to show user info
            this.updateUserInfo();
            
            // Join the room via API
            const joinData = {
                user_id: this.userId,
                user_name: this.userName
            };
            
            // Add room code for private rooms
            if (window.roomCode) {
                joinData.room_code = window.roomCode;
            }
            
            const response = await fetch(`/api/prayer-room/join/${this.roomId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify(joinData)
            });
            
            const data = await response.json();
            if (!data.success) {
                throw new Error(data.error || 'Failed to join room');
            }
            
            // Update room info
            this.updateRoomInfo(data);
            
            // Load chat messages
            await this.loadChatMessages();
            
        } catch (error) {
            console.error('Error joining room:', error);
            this.showError('Failed to join room: ' + error.message);
        }
    }
    
    updateRoomInfo(data) {
        // Update room name
        const roomNameEl = document.querySelector('.prayer-room-title');
        if (roomNameEl) {
            const truncatedRoomName = this.truncateName(data.room_name || 'Prayer Room', 50);
            roomNameEl.textContent = truncatedRoomName;
            roomNameEl.title = data.room_name || 'Prayer Room'; // Show full name on hover
        }
        
        // Update participants
        this.updateParticipants(data.participants || []);
        
        // Check if user is host
        this.isHost = data.host_id === this.userId;
    }
    
    async loadParticipants() {
        try {
            // Show loading state
            this.showParticipantsLoading();
            
            // Add timeout to prevent hanging
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
            
            const response = await fetch(`/api/prayer-room/${this.roomId}/participants`, {
                credentials: 'include',
                signal: controller.signal
            }).finally(() => clearTimeout(timeoutId));
            
            const data = await response.json();
            
            if (data.success) {
                // Check if room is still active
                if (!data.is_active) {
                    this.showHostLeftNotification();
                    return;
                }
                
                this.updateParticipants(data.participants || []);
            } else {
                this.updateParticipants([]);
            }
            
            // Set up polling for real-time updates if Firestore listeners fail
            if (!this.participantPollingInterval) {
                this.participantPollingInterval = setInterval(() => {
                    this.loadParticipants();
                }, 3000); // Poll every 3 seconds for faster updates
            }
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn('Participants request timed out, will retry...');
            } else {
                console.error('Error loading participants:', error);
            }
            // Don't show empty state on timeout, just retry on next poll
            if (!this.participantPollingInterval) {
                // If initial load failed, set up polling anyway so we can retry
                this.participantPollingInterval = setInterval(() => {
                    this.loadParticipants();
                }, 3000);
            }
        }
    }
    
    showParticipantsLoading() {
        const participantsContainer = document.getElementById('participantsList');
        if (participantsContainer && !participantsContainer.querySelector('.loading-participants')) {
            const loadingEl = document.createElement('div');
            loadingEl.className = 'loading-participants';
            loadingEl.innerHTML = '<div class="loading-spinner-small"></div><span>Loading participants...</span>';
            loadingEl.style.cssText = 'text-align: center; padding: 20px; color: #64748b; display: flex; align-items: center; justify-content: center; gap: 10px;';
            participantsContainer.appendChild(loadingEl);
        }
    }

    // Utility function to truncate names
    truncateName(name, maxLength = 30) {
        if (!name) return 'Anonymous';
        if (name.length <= maxLength) return name;
        return name.substring(0, maxLength - 3) + '...';
    }

    updateParticipants(participants) {
        const participantsContainer = document.getElementById('participantsList');
        if (!participantsContainer) {
            return;
        }
        
        // Remove loading indicator
        const loadingEl = participantsContainer.querySelector('.loading-participants');
        if (loadingEl) {
            loadingEl.remove();
        }
        
        // Get current participant IDs
        const currentParticipantIds = participants ? participants.map(p => p.user_id) : [];
        
        // Clean up peer connections for participants who have left
        const existingPeerIds = Array.from(this.peers.keys());
        existingPeerIds.forEach(peerId => {
            if (!currentParticipantIds.includes(peerId)) {
                console.log(`🧹 Participant ${peerId} left, cleaning up peer connection`);
                this.cleanupPeerConnection(peerId);
            }
        });
        
        participantsContainer.innerHTML = '';
        
        if (participants && participants.length > 0) {
            participants.forEach(participant => {
                const participantEl = document.createElement('div');
                participantEl.className = 'participant';
                participantEl.setAttribute('data-user-id', participant.user_id);
                
                // Add speaking class if participant is speaking and not muted
                if (participant.is_speaking && !participant.is_muted) {
                    participantEl.classList.add('speaking');
                }
                
                // Add muted class if participant is muted
                if (participant.is_muted) {
                    participantEl.classList.add('muted');
                }
                
                const truncatedName = this.truncateName(participant.user_name);
                participantEl.innerHTML = `
                    <div class="participant-avatar">
                        ${truncatedName.charAt(0).toUpperCase()}
                    </div>
                    <div class="participant-info">
                        <div class="participant-name" title="${participant.user_name}">
                            ${truncatedName}
                            ${participant.is_host ? '<span class="host-badge">Host</span>' : ''}
                        </div>
                        <div class="participant-status">
                            ${participant.is_speaking && !participant.is_muted ? '<span class="speaking-indicator">Speaking</span>' : ''}
                            ${participant.is_muted ? '<span class="mute-indicator">🔇</span>' : ''}
                        </div>
                    </div>
                    ${this.isHost && !participant.is_host ? `
                        <div class="participant-actions">
                            <button class="action-btn mute-btn ${participant.is_muted ? 'muted' : ''}" onclick="window.prayerRoomService.muteParticipant('${participant.user_id}')" title="${participant.is_muted ? 'Unmute' : 'Mute'}">
                                ${participant.is_muted ? 
                                    '<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><path d="M23 9l-6 6"></path><path d="M17 9l6 6"></path></svg>' :
                                    '<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>'
                                }
                            </button>
                            <button class="action-btn remove-btn" onclick="window.prayerRoomService.removeParticipant('${participant.user_id}')" title="Remove">
                                <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                            </button>
                        </div>
                    ` : ''}
                `;
                participantsContainer.appendChild(participantEl);
            });
        } else {
            participantsContainer.innerHTML = '<div class="no-participants">No participants yet</div>';
        }
        
        // Update participant count
        const participantCount = document.getElementById('participantCount');
        if (participantCount) {
            participantCount.textContent = participants ? participants.length : 0;
        }
    }
    
    async joinAudio() {
        try {
            console.log('🎤 Joining audio...');
            
            if (!this.roomId) {
                throw new Error('Room ID not available. Please refresh the page and try again.');
            }
            
            // Update UI immediately for instant feedback
            this.isAudioEnabled = true;
            this.updateAudioControls();
            
            // Request microphone permission with ultra-low latency constraints
            console.log('🎤 Requesting microphone permission...');
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: { ideal: true },
                    noiseSuppression: { ideal: true },
                    autoGainControl: { ideal: true },
                    sampleRate: { ideal: 48000 }, // Higher sample rate for better quality
                    channelCount: { ideal: 1 },
                    // Ultra-low latency audio constraints
                    latency: { ideal: 0.01 }, // 10ms latency target
                    googEchoCancellation: { ideal: true },
                    googAutoGainControl: { ideal: true },
                    googNoiseSuppression: { ideal: true },
                    googHighpassFilter: { ideal: true },
                    googTypingNoiseDetection: { ideal: true },
                    googAudioMirroring: { ideal: false },
                    googDAEchoCancellation: { ideal: true },
                    googNoiseReduction: { ideal: true }
                },
                video: false
            });
            
            console.log('🎤 Microphone permission granted, stream obtained:', this.localStream);
            
            // Quick validation
            if (!this.localStream || !this.localStream.active) {
                throw new Error('Invalid audio stream from microphone');
            }
            
            // Start lightweight initialization immediately
            console.log('🎤 Starting fast initialization...');
            
            // Enable audio playback (non-blocking)
            this.enableAudioPlayback().catch(error => {
                console.warn('⚠️ Audio playback initialization failed:', error);
            });
            
            // Initialize WebRTC first (most critical for voice)
            this.initializeWebRTC().then(() => {
                console.log('🎤 WebRTC initialized, starting participant connections...');
                // Start participant connections immediately
                this.initiateConnectionsWithParticipants().catch(error => {
                    console.error('⚠️ Error initiating connections:', error);
                });
                
                // Initialize advanced audio processing in background (non-blocking)
                this.initializeAdvancedAudioProcessing().catch(error => {
                    console.warn('⚠️ Advanced audio processing failed:', error);
                });
            }).catch(error => {
                console.warn('⚠️ WebRTC initialization failed:', error);
            });
            
            console.log('🎤 Audio join process initiated successfully');
            
        } catch (error) {
            console.error('🎤 Error joining audio:', error);
            this.isAudioEnabled = false;
            this.updateAudioControls();
            this.showError('Failed to access microphone. Please check permissions and try again.');
        }
    }
    
    toggleMute() {
        this.isMuted = !this.isMuted;
        
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => {
                track.enabled = !this.isMuted;
            });
        }
        
        this.updateAudioControls();
        
        // Notify other participants
        this.notifyMuteStatus();
    }
    
    updateAudioControls() {
        const joinAudioBtn = document.getElementById('joinAudioBtn');
        const muteBtn = document.getElementById('muteBtn');
        
        console.log('🔧 updateAudioControls called:', {
            isAudioEnabled: this.isAudioEnabled,
            isMuted: this.isMuted,
            joinAudioBtn: !!joinAudioBtn,
            muteBtn: !!muteBtn
        });
        
        if (joinAudioBtn && muteBtn) {
            if (this.isAudioEnabled) {
                // Show mute button, hide join audio button
                joinAudioBtn.style.display = 'none';
                muteBtn.style.display = 'flex';
                
                // Update mute button state
                if (this.isMuted) {
                    muteBtn.classList.add('muted');
                    // Show muted icon and text
                    const micIcon = muteBtn.querySelector('.mic-icon');
                    const mutedIcon = muteBtn.querySelector('.muted-icon');
                    const muteText = muteBtn.querySelector('.mute-text');
                    const unmuteText = muteBtn.querySelector('.unmute-text');
                    
                    if (micIcon) micIcon.style.display = 'none';
                    if (mutedIcon) mutedIcon.style.display = 'block';
                    if (muteText) muteText.style.display = 'none';
                    if (unmuteText) unmuteText.style.display = 'block';
                } else {
                    muteBtn.classList.remove('muted');
                    // Show mic icon and text
                    const micIcon = muteBtn.querySelector('.mic-icon');
                    const mutedIcon = muteBtn.querySelector('.muted-icon');
                    const muteText = muteBtn.querySelector('.mute-text');
                    const unmuteText = muteBtn.querySelector('.unmute-text');
                    
                    if (micIcon) micIcon.style.display = 'block';
                    if (mutedIcon) mutedIcon.style.display = 'none';
                    if (muteText) muteText.style.display = 'block';
                    if (unmuteText) unmuteText.style.display = 'none';
                }
            } else {
                // Show join audio button, hide mute button
                joinAudioBtn.style.display = 'flex';
                muteBtn.style.display = 'none';
            }
            
            console.log('🔧 Audio controls updated:', {
                joinAudioDisplay: joinAudioBtn.style.display,
                muteDisplay: muteBtn.style.display,
                isAudioEnabled: this.isAudioEnabled,
                isMuted: this.isMuted
            });
        }
    }
    
    async notifyMuteStatus() {
        try {
            await fetch(`/api/prayer-room/${this.roomId}/mute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    user_id: this.userId,
                    is_muted: this.isMuted
                })
            });
        } catch (error) {
            console.error('Error updating mute status:', error);
        }
    }
    
    async leaveRoom() {
        try {
            // If user is the host, show custom confirmation modal
            if (this.isHost) {
                return new Promise((resolve) => {
                    this.showHostLeaveModal(resolve);
                });
            }
            
            // For non-hosts, proceed directly
            await this.performLeave();
            
        } catch (error) {
            console.error('Error leaving room:', error);
            // Still redirect even if API call fails
            window.location.href = '/prayers';
        }
    }

    showHostLeaveModal(resolve) {
        const modal = document.getElementById('hostLeaveModal');
        const cancelBtn = document.getElementById('cancelLeaveBtn');
        const confirmBtn = document.getElementById('confirmLeaveBtn');
        
        if (!modal || !cancelBtn || !confirmBtn) {
            console.error('Modal elements not found');
            // Fallback to browser confirm
            const confirmed = confirm(
                '⚠️ Warning: You are the host of this prayer room.\n\n' +
                'Leaving will end the session for ALL participants.\n\n' +
                'Are you sure you want to end the prayer session?'
            );
            
            if (confirmed) {
                this.performLeave();
            }
            resolve();
            return;
        }
        
        // Show modal
        modal.style.display = 'flex';
        
        // Handle cancel
        cancelBtn.onclick = () => {
            modal.style.display = 'none';
            console.log('Host leave cancelled by user');
            resolve();
        };
        
        // Handle confirm
        confirmBtn.onclick = async () => {
            modal.style.display = 'none';
            console.log('Host confirmed leaving - ending session for all participants');
            await this.performLeave();
            resolve();
        };
        
        // Handle clicking outside modal
        modal.onclick = (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
                console.log('Host leave cancelled by clicking outside');
                resolve();
            }
        };
        
        // Handle escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                modal.style.display = 'none';
                console.log('Host leave cancelled by escape key');
                document.removeEventListener('keydown', handleEscape);
                resolve();
            }
        };
        document.addEventListener('keydown', handleEscape);
    }

    async performLeave() {
        try {
            // Stop local stream
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
            }
            
            // Stop voice activity detection
            this.voiceActivityDetectionActive = false;
            
            // Clear all polling intervals
            if (this.chatPollInterval) {
                clearInterval(this.chatPollInterval);
                this.chatPollInterval = null;
            }
            if (this.participantPollInterval) {
                clearInterval(this.participantPollInterval);
                this.participantPollInterval = null;
            }
            if (this.chatPollingInterval) {
                clearInterval(this.chatPollingInterval);
                this.chatPollingInterval = null;
            }
            if (this.participantPollingInterval) {
                clearInterval(this.participantPollingInterval);
                this.participantPollingInterval = null;
            }
            if (this.signalPollInterval) {
                clearInterval(this.signalPollInterval);
                this.signalPollInterval = null;
            }
            
            // Leave room via API
            await fetch(`/api/prayer-room/leave/${this.roomId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({})
            });
            
            // Redirect to prayers page
            window.location.href = '/prayers';
            
        } catch (error) {
            console.error('Error leaving room:', error);
            // Still redirect even if API call fails
            window.location.href = '/prayers';
        }
    }
    
    copyRoomCode() {
        const roomCode = this.roomId;
        navigator.clipboard.writeText(roomCode).then(() => {
            // Show success message
            const btn = document.getElementById('copyRoomCodeBtn');
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => {
                btn.textContent = originalText;
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy room code:', err);
            // Fallback: show room code in alert
            alert(`Room Code: ${roomCode}`);
        });
    }
    
    shareRoom() {
        const roomUrl = `${window.location.origin}/prayer-room/join?room=${this.roomId}`;
        const roomName = document.querySelector('.prayer-room-title')?.textContent || 'Prayer Room';
        
        // Check if Web Share API is supported
        if (navigator.share) {
            navigator.share({
                title: `Join ${roomName}`,
                text: `Join me in this prayer room: ${roomName}`,
                url: roomUrl
            }).catch(err => {
                console.error('Error sharing:', err);
                this.fallbackShare(roomUrl, roomName);
            });
        } else {
            // Fallback for browsers that don't support Web Share API
            this.fallbackShare(roomUrl, roomName);
        }
    }
    
    fallbackShare(roomUrl, roomName) {
        // Copy URL to clipboard
        navigator.clipboard.writeText(roomUrl).then(() => {
            // Show success message
            const btn = document.getElementById('shareBtn');
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => {
                btn.textContent = originalText;
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy room URL:', err);
            // Final fallback: show URL in alert
            alert(`Share this room: ${roomUrl}`);
        });
    }
    
    async sendChatMessage() {
        const chatInput = document.getElementById('chatInput');
        const message = chatInput.value.trim();
        
        if (!message) return;
        
        try {
            const response = await fetch(`/api/prayer-room/${this.roomId}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include', // Include session cookie
                body: JSON.stringify({
                    message: message
                })
            });
            
            const data = await response.json();
            if (data.success) {
                chatInput.value = '';
                // Message will be added via real-time listener
            }
            
        } catch (error) {
            console.error('Error sending chat message:', error);
        }
    }
    
    async loadChatMessages() {
        try {
            const response = await fetch(`/api/prayer-room/${this.roomId}/chat`, {
                credentials: 'include'
            });
            const data = await response.json();
            
            if (data.success) {
                this.chatMessages = data.messages || [];
                this.updateChatDisplay();
            } else {
                this.chatMessages = [];
                this.updateChatDisplay();
            }
            
        } catch (error) {
            this.chatMessages = [];
            this.updateChatDisplay();
        }
        
            // Set up polling for real-time updates if Firestore listeners fail
            if (!this.chatPollingInterval) {
                this.chatPollingInterval = setInterval(() => {
                    this.loadChatMessages();
                }, 2000); // Poll every 2 seconds for faster chat updates
            }
    }
    
    updateChatDisplay() {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) {
            console.error('Chat messages container not found in updateChatDisplay');
            return;
        }
        
        console.log('Updating chat display with messages:', this.chatMessages ? this.chatMessages.length : 0);
        
        chatMessages.innerHTML = '';
        
        if (this.chatMessages && this.chatMessages.length > 0) {
            console.log('Rendering chat messages...');
            this.chatMessages.forEach(message => {
                const messageEl = document.createElement('div');
                
                // Check if it's a system notification
                if (message.message_type === 'system_notification') {
                    messageEl.className = 'message system-notification';
                    messageEl.innerHTML = `
                        <div class="message-content system-message">
                            <div class="system-icon">⚠️</div>
                            <div class="system-text">${message.message}</div>
                        </div>
                    `;
                } else {
                    messageEl.className = 'message';
                    messageEl.innerHTML = `
                        <div class="message-header">
                            <span class="message-sender">${message.user_name}</span>
                            <span class="message-time">${new Date(message.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div class="message-content">
                            ${message.message}
                        </div>
                    `;
                }
                
                chatMessages.appendChild(messageEl);
            });
            console.log('Chat messages rendered successfully');
        } else {
            console.log('No chat messages, showing empty state');
            // Show empty state
            const emptyEl = document.createElement('div');
            emptyEl.className = 'message';
            emptyEl.innerHTML = `
                <div class="message-content" style="text-align: center; color: #64748b; font-style: italic;">
                    No messages yet. Start the conversation!
                </div>
            `;
            chatMessages.appendChild(emptyEl);
        }
        
        // Scroll to bottom
        scrollChatToBottom();
    }
    
    setupRealtimeListeners() {
        // Note: We're using API endpoints instead of direct Firestore access
        // This avoids permission issues and provides better error handling
        console.log('Using API-based polling instead of direct Firestore listeners');
        
        // Set up polling for chat only - participants polling is handled by loadParticipants()
        // This avoids duplicate polling mechanisms
        this.setupChatPolling();
    }
    
    setupChatPolling() {
        // Poll for new chat messages every 5 seconds
        this.chatPollInterval = setInterval(() => {
            this.loadChatMessages();
        }, 5000);
    }
    
    setupParticipantPolling() {
        // Poll for participant changes every 5 seconds using Firestore directly
        // This is a fallback if REST API polling fails
        if (this.participantPollInterval) {
            clearInterval(this.participantPollInterval);
        }
        
        this.participantPollInterval = setInterval(async () => {
            try {
                const db = firebase.firestore();
                const roomDoc = await db.collection('prayer_rooms').doc(this.roomId).get();
                if (roomDoc.exists) {
                    const data = roomDoc.data();
                    this.updateParticipants(data.participants || []);
                }
            } catch (error) {
                console.error("Error polling for participants (Firestore):", error);
                // Fall back to REST API if Firestore fails
                if (!this.participantPollingInterval) {
                    this.loadParticipants();
                }
            }
        }, 5000);
    }
    
    showError(message) {
        const errorContainer = document.querySelector('.error-state');
        if (errorContainer) {
            errorContainer.style.display = 'flex';
            errorContainer.querySelector('.error-message').textContent = message;
        } else {
            alert(message);
        }
    }

    showHostLeftNotification() {
        // Clear any existing polling intervals
        if (this.chatPollingInterval) {
            clearInterval(this.chatPollingInterval);
            this.chatPollingInterval = null;
        }
        if (this.participantPollingInterval) {
            clearInterval(this.participantPollingInterval);
            this.participantPollingInterval = null;
        }
        
        // Show notification overlay
        const notificationOverlay = document.createElement('div');
        notificationOverlay.className = 'host-left-notification';
        notificationOverlay.innerHTML = `
            <div class="notification-content">
                <div class="notification-icon">⚠️</div>
                <h3>Host Has Left</h3>
                <p>The host has left the prayer room. This session will end shortly.</p>
                <button class="notification-btn" onclick="window.location.href='/prayer-room'">
                    Return to Prayer Rooms
                </button>
            </div>
        `;
        
        document.body.appendChild(notificationOverlay);
        
        // Auto-redirect after 10 seconds
        setTimeout(() => {
            window.location.href = '/prayer-room';
        }, 10000);
    }

    // WebRTC Voice Communication Methods
    async initializeWebRTC() {
        try {
            console.log('🔧 Initializing WebRTC for voice communication...');
            
            if (!this.localStream) {
                console.log('🔧 No local stream available yet. WebRTC will be initialized when user joins audio.');
                return;
            }
            
            // Initialize audio context for voice activity detection
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            console.log('🔧 Audio context created:', this.audioContext.state);
            
            // Resume audio context if it's suspended (required for autoplay)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
                console.log('🔧 Audio context resumed:', this.audioContext.state);
            }
            
            // Set up voice activity detection
            this.setupVoiceActivityDetection();
            
            // Set up WebRTC signaling with SimplePeer
            this.setupWebRTCSignaling();
            
            console.log('🔧 WebRTC initialized successfully');
            
        } catch (error) {
            console.error('🔧 Error initializing WebRTC:', error);
            this.showError('Failed to initialize voice communication. Please try again.');
        }
    }

    setupVoiceActivityDetection() {
        try {
            if (!this.localStream || !this.audioContext) return;
            
            // Create audio analyser for voice activity detection
            const source = this.audioContext.createMediaStreamSource(this.localStream);
            this.audioAnalyser = this.audioContext.createAnalyser();
            this.audioAnalyser.fftSize = 256;
            this.audioAnalyser.smoothingTimeConstant = 0.8;
            
            source.connect(this.audioAnalyser);
            
            // Start voice activity detection
            this.detectVoiceActivity();
            
        } catch (error) {
            console.error('Error setting up voice activity detection:', error);
        }
    }

    detectVoiceActivity() {
        if (!this.audioAnalyser) return;
        
        // Prevent multiple detection loops from running simultaneously
        if (this.voiceActivityDetectionActive) {
            console.log('🎤 Voice activity detection already active, skipping');
            return;
        }
        
        this.voiceActivityDetectionActive = true;
        
        const bufferLength = this.audioAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        const checkVoiceActivity = () => {
            // Stop if detection is no longer active
            if (!this.voiceActivityDetectionActive) {
                return;
            }
            
            this.audioAnalyser.getByteFrequencyData(dataArray);
            
            // Calculate average volume
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            const average = sum / bufferLength;
            
            const wasSpeaking = this.isSpeaking;
            this.isSpeaking = average > this.voiceActivityThreshold;
            
            // Update speaking indicator if state changed
            if (wasSpeaking !== this.isSpeaking) {
                this.updateSpeakingIndicator();
                this.broadcastSpeakingState();
            }
            
            // Continue monitoring
            requestAnimationFrame(checkVoiceActivity);
        };
        
        checkVoiceActivity();
    }

    updateSpeakingIndicator() {
        const speakingIndicator = document.getElementById('speakingIndicator');
        if (speakingIndicator) {
            speakingIndicator.textContent = this.isSpeaking ? 'Speaking...' : 'Silent';
            speakingIndicator.className = this.isSpeaking ? 'speaking' : 'silent';
        }
    }

    async broadcastSpeakingState() {
        try {
            if (!this.roomId) return;
            
            // Throttle updates to prevent resource exhaustion
            const now = Date.now();
            const timeSinceLastUpdate = now - this.lastSpeakingStateUpdate;
            
            // If we're still within the throttle window, skip this update
            if (timeSinceLastUpdate < this.speakingStateThrottleMs) {
                // Schedule a delayed update if one isn't already pending
                if (!this.pendingSpeakingStateUpdate) {
                    this.pendingSpeakingStateUpdate = true;
                    const delay = this.speakingStateThrottleMs - timeSinceLastUpdate;
                    setTimeout(() => {
                        this.pendingSpeakingStateUpdate = false;
                        this.broadcastSpeakingState();
                    }, delay);
                }
                return;
            }
            
            // Reset pending flag
            this.pendingSpeakingStateUpdate = false;
            this.lastSpeakingStateUpdate = now;
            
            const response = await fetch(`/api/prayer-room/room/${this.roomId}/speaking-state`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    is_speaking: this.isSpeaking
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
                
        } catch (error) {
            console.error('Error broadcasting speaking state:', error);
            // Reset pending flag on error so we can retry
            this.pendingSpeakingStateUpdate = false;
        }
    }

    setupWebRTCSignaling() {
        try {
            if (!this.roomId) return;
            
            console.log('Setting up WebRTC signaling with SimplePeer...');
            
            // Set up polling for WebRTC signals
            this.setupSignalPolling();
            
            console.log('WebRTC signaling setup complete');
            
        } catch (error) {
            console.error('Error setting up WebRTC signaling:', error);
        }
    }

    setupSignalPolling() {
        // Poll for WebRTC offers and answers every 500ms for faster connection
        this.signalPollInterval = setInterval(() => {
            this.checkForWebRTCSignals();
        }, 500); // Reduced from 2000ms to 500ms for faster signaling
    }

    async checkForWebRTCSignals() {
        try {
            if (!this.roomId) return;
            
            // Check for WebRTC offers
            const offersResponse = await fetch(`/api/prayer-room/room/${this.roomId}/webrtc-offers`, {
                credentials: 'include'
            });
            if (offersResponse.ok) {
                const offers = await offersResponse.json();
                for (const offer of offers) {
                    if (offer.to_user === this.userId) {
                        await this.handleWebRTCOffer(offer);
                    }
                }
            }
            
            // Check for WebRTC answers
            const answersResponse = await fetch(`/api/prayer-room/room/${this.roomId}/webrtc-answers`, {
                credentials: 'include'
            });
            if (answersResponse.ok) {
                const answers = await answersResponse.json();
                for (const answer of answers) {
                    if (answer.to_user === this.userId) {
                        await this.handleWebRTCAnswer(answer);
                    }
                }
            }
            
            // Check for WebRTC candidates
            const candidatesResponse = await fetch(`/api/prayer-room/room/${this.roomId}/webrtc-candidates`, {
                credentials: 'include'
            });
            if (candidatesResponse.ok) {
                const candidates = await candidatesResponse.json();
                for (const candidate of candidates) {
                    if (candidate.to_user === this.userId) {
                        await this.handleWebRTCCandidate(candidate);
                    }
                }
            }
            
        } catch (error) {
            console.error('Error checking for WebRTC signals:', error);
        }
    }

    async createPeerConnection(participantId, participantData) {
        try {
            console.log(`🔗 Creating peer connection with ${participantId}`);
            
            // Don't create connection with ourselves
            if (participantId === this.userId) {
                console.log(`🔗 Skipping self-connection with ${participantId}`);
                return;
            }
            
            // Check if we already have a connection with this participant
            if (this.peers.has(participantId)) {
                console.log(`🔗 Peer connection already exists with ${participantId}`);
                return;
            }
            
            console.log(`🔗 Creating SimplePeer instance for ${participantId} with local stream:`, this.localStream);
            
            // Create SimplePeer instance as initiator with ultra-low latency configuration
            const peer = new SimplePeer({
                initiator: true, // We initiate the connection
                stream: this.localStream,
                trickle: true, // Enable trickle ICE for faster connection
                // Ultra-low latency WebRTC configuration
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ],
                    iceCandidatePoolSize: 0, // Disable candidate pooling for faster connection
                    bundlePolicy: 'max-bundle',
                    rtcpMuxPolicy: 'require',
                    // Ultra-low latency settings
                    iceTransportPolicy: 'all',
                    iceConnectionReceivingTimeout: 5000, // 5 second timeout
                    iceBackupCandidatePairPingInterval: 2500 // 2.5 second ping interval
                },
                // Ultra-low latency constraints
                constraints: {
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: false,
                    voiceActivityDetection: false // Disable VAD for lower latency
                },
                // Low latency options
                objectMode: false,
                channelConfig: {
                    ordered: false, // Disable ordering for lower latency
                    maxRetransmits: 0 // No retransmits for lower latency
                },
                // Additional low latency settings
                sdpTransform: (sdp) => {
                    // Optimize SDP for low latency
                    return sdp
                        .replace(/a=fmtp:111 minptime=10;useinbandfec=1/g, 'a=fmtp:111 minptime=5;useinbandfec=0')
                        .replace(/a=fmtp:9 minptime=10;useinbandfec=1/g, 'a=fmtp:9 minptime=5;useinbandfec=0');
                }
            });
            
            console.log(`🔗 SimplePeer instance created for ${participantId}:`, peer);
            
            // Store the peer connection
            this.peers.set(participantId, peer);
            
            // Set up peer event handlers
            this.setupPeerEventHandlers(peer, participantId);
            
            console.log(`🔗 Peer connection created with ${participantId}`);
            
        } catch (error) {
            console.error(`🔗 Error creating peer connection with ${participantId}:`, error);
        }
    }

    async sendSignal(participantId, signalData) {
        try {
            if (!this.roomId || !this.userId) return;
            
            console.log(`📡 Sending signal to ${participantId}:`, signalData.type);
            
            const signalType = signalData.type;
            let endpoint, requestBody;
            
            // Prepare the request body with correct field names based on signal type
            requestBody = {
                to_user: participantId
            };
            
            if (signalType === 'offer') {
                endpoint = 'webrtc-offer';
                requestBody.offer = signalData;
            } else if (signalType === 'answer') {
                endpoint = 'webrtc-answer';
                requestBody.answer = signalData;
            } else if (signalType === 'candidate') {
                endpoint = 'webrtc-candidate';
                requestBody.candidate = signalData;
            } else {
                console.warn(`📡 Unknown signal type: ${signalType}`);
                return;
            }
            
            console.log(`📡 Request body for ${signalType}:`, requestBody);
            
            const response = await fetch(`/api/prayer-room/room/${this.roomId}/${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify(requestBody)
            });
            
            if (response.ok) {
                console.log(`📡 WebRTC ${signalType} sent successfully to ${participantId}`);
            } else {
                const errorText = await response.text();
                console.error(`📡 Failed to send WebRTC ${signalType}:`, errorText);
            }
            
        } catch (error) {
            console.error('📡 Error sending WebRTC signal:', error);
        }
    }
    
    async handleWebRTCOffer(offer) {
        try {
            console.log('📡 Handling WebRTC offer from:', offer.from_user);
            
            // Create a more unique signal ID to prevent duplicates
            // Use offer content hash + timestamp + user ID for better uniqueness
            const offerContent = JSON.stringify(offer.offer);
            const contentHash = offerContent.length + offerContent.slice(0, 50); // Simple hash
            const signalId = `${offer.from_user}-${contentHash}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            
            console.log(`📡 Generated signal ID: ${signalId}`);
            
            if (this.processedSignals.has(signalId)) {
                console.log(`📡 Duplicate offer detected for ${offer.from_user}, ignoring`);
                return;
            }
            
            // Check if we already have a connection with this user
            if (this.peers.has(offer.from_user)) {
                console.log(`📡 Peer connection already exists for ${offer.from_user}, cleaning up old connection`);
                const existingPeer = this.peers.get(offer.from_user);
                if (existingPeer) {
                    existingPeer.destroy();
                }
                this.peers.delete(offer.from_user);
            }
            
            this.processedSignals.add(signalId);
            
            // Clean up old signals if we have too many
            this.cleanupProcessedSignals();
            
            // Create a new peer connection for this offer with ultra-low latency configuration
            const peer = new SimplePeer({
                initiator: false,
                stream: this.localStream,
                trickle: true, // Enable trickle ICE for faster connection
                // Ultra-low latency WebRTC configuration
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ],
                    iceCandidatePoolSize: 0, // Disable candidate pooling for faster connection
                    bundlePolicy: 'max-bundle',
                    rtcpMuxPolicy: 'require',
                    // Ultra-low latency settings
                    iceTransportPolicy: 'all',
                    iceConnectionReceivingTimeout: 5000, // 5 second timeout
                    iceBackupCandidatePairPingInterval: 2500 // 2.5 second ping interval
                },
                // Ultra-low latency constraints
                constraints: {
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: false,
                    voiceActivityDetection: false // Disable VAD for lower latency
                },
                // Low latency options
                objectMode: false,
                channelConfig: {
                    ordered: false, // Disable ordering for lower latency
                    maxRetransmits: 0 // No retransmits for lower latency
                },
                // Additional low latency settings
                sdpTransform: (sdp) => {
                    // Optimize SDP for low latency
                    return sdp
                        .replace(/a=fmtp:111 minptime=10;useinbandfec=1/g, 'a=fmtp:111 minptime=5;useinbandfec=0')
                        .replace(/a=fmtp:9 minptime=10;useinbandfec=1/g, 'a=fmtp:9 minptime=5;useinbandfec=0');
                }
            });
            
            console.log('📡 SimplePeer instance created for incoming offer:', peer);
            
            // Store the peer connection
            this.peers.set(offer.from_user, peer);
            
            // Set up peer event handlers
            this.setupPeerEventHandlers(peer, offer.from_user);
            
            // Handle the incoming offer
            peer.signal(offer.offer);
            
        } catch (error) {
            console.error('📡 Error handling WebRTC offer:', error);
        }
    }

    async handleWebRTCAnswer(answer) {
        try {
            console.log('📡 Handling WebRTC answer from:', answer.from_user);
            
            // Create a more unique signal ID to prevent duplicates
            // Use answer content hash + timestamp + user ID for better uniqueness
            const answerContent = JSON.stringify(answer.answer);
            const contentHash = answerContent.length + answerContent.slice(0, 50); // Simple hash
            const signalId = `${answer.from_user}-answer-${contentHash}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            
            console.log(`📡 Generated answer signal ID: ${signalId}`);
            
            if (this.processedSignals.has(signalId)) {
                console.log(`📡 Duplicate answer detected for ${answer.from_user}, ignoring`);
                return;
            }
            
            this.processedSignals.add(signalId);
            
            // Clean up old signals if we have too many
            this.cleanupProcessedSignals();
            
            const peer = this.peers.get(answer.from_user);
            if (peer) {
                peer.signal(answer.answer);
            } else {
                console.warn('No peer connection found for answer from:', answer.from_user);
            }
            
        } catch (error) {
            console.error('Error handling WebRTC answer:', error);
        }
    }

    async handleWebRTCCandidate(candidate) {
        try {
            console.log('📡 Handling WebRTC candidate from:', candidate.from_user);
            
            // Create a unique signal ID to prevent duplicates
            const candidateContent = JSON.stringify(candidate.candidate);
            const contentHash = candidateContent.length + candidateContent.slice(0, 50);
            const signalId = `${candidate.from_user}-candidate-${contentHash}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            
            console.log(`📡 Generated candidate signal ID: ${signalId}`);
            
            if (this.processedSignals.has(signalId)) {
                console.log(`📡 Duplicate candidate detected for ${candidate.from_user}, ignoring`);
                return;
            }
            
            this.processedSignals.add(signalId);
            
            // Clean up old signals if we have too many
            this.cleanupProcessedSignals();
            
            const peer = this.peers.get(candidate.from_user);
            if (peer) {
                peer.signal(candidate.candidate);
            } else {
                console.warn('No peer connection found for candidate from:', candidate.from_user);
            }
            
        } catch (error) {
            console.error('Error handling WebRTC candidate:', error);
        }
    }

    setupPeerEventHandlers(peer, participantId) {
        // Handle incoming signal (offer/answer)
        peer.on('signal', (data) => {
            console.log(`📡 Sending signal to ${participantId}:`, data.type);
            this.sendSignal(participantId, data);
        });
        
        // Handle incoming stream
        peer.on('stream', (stream) => {
            console.log(`🎵 Received stream from ${participantId}:`, stream);
            console.log(`🎵 Stream tracks:`, stream.getTracks());
            console.log(`🎵 Stream active:`, stream.active);
            this.handleRemoteStream(participantId, stream);
        });
        
        // Handle connection established
        peer.on('connect', () => {
            console.log(`✅ Peer connection established with ${participantId}`);
            this.updateParticipantConnectionStatus(participantId, 'connected');
        });
        
        // Handle connection errors with detailed logging
        peer.on('error', (err) => {
            console.error(`❌ Peer connection error with ${participantId}:`, err);
            console.error(`❌ Error details:`, {
                name: err.name,
                message: err.message,
                stack: err.stack
            });
            
            // Check if this is an intentional close (don't handle as error)
            if (peer._intentionallyClosing) {
                console.log(`👋 Intentional close for ${participantId}, ignoring error`);
                return;
            }
            
            // Check if this is an expected disconnection (user-initiated abort)
            if (err.name === 'OperationError' && err.message.includes('User-Initiated Abort')) {
                console.log(`👋 Expected disconnection for ${participantId} (user left or connection closed)`);
                this.updateParticipantConnectionStatus(participantId, 'disconnected');
                // Don't attempt reconnection for expected disconnections
                return;
            }
            
            // Handle InvalidStateError (signaling state issues)
            if (err.name === 'InvalidStateError' && err.message.includes('setRemoteDescription')) {
                console.log(`⚠️ Signaling state error for ${participantId}: ${err.message}`);
                console.log(`🔄 Attempting to recover from signaling state error...`);
                
                // Try to recover by recreating the connection
                this.handleSignalingStateError(participantId, err);
                return;
            }
            
            // Only attempt reconnection for unexpected errors
            this.updateParticipantConnectionStatus(participantId, 'error');
            this.handleConnectionError(participantId, err);
        });
        
        // Handle connection close
        peer.on('close', () => {
            console.log(`🔌 Peer connection closed with ${participantId}`);
            this.updateParticipantConnectionStatus(participantId, 'disconnected');
            this.peers.delete(participantId);
        });
        
        // Enhanced ICE connection state monitoring
        if (peer._pc) {
            peer._pc.addEventListener('iceconnectionstatechange', () => {
                const state = peer._pc.iceConnectionState;
                console.log(`🧊 ICE connection state changed for ${participantId}: ${state}`);
                
                switch (state) {
                    case 'connected':
                        console.log(`✅ ICE connected with ${participantId}`);
                        this.updateParticipantConnectionStatus(participantId, 'connected');
                        break;
                    case 'disconnected':
                        console.log(`⚠️ ICE disconnected with ${participantId}`);
                        this.updateParticipantConnectionStatus(participantId, 'disconnected');
                        break;
                    case 'failed':
                        console.error(`❌ ICE connection failed with ${participantId}`);
                        this.updateParticipantConnectionStatus(participantId, 'failed');
                        // Only attempt ICE restart for unexpected failures
                        this.handleICEConnectionFailure(participantId);
                        break;
                    case 'closed':
                        console.log(`🔌 ICE connection closed with ${participantId}`);
                        this.updateParticipantConnectionStatus(participantId, 'closed');
                        break;
                    case 'checking':
                        console.log(`🔍 ICE checking connection with ${participantId}`);
                        this.updateParticipantConnectionStatus(participantId, 'checking');
                        break;
                    case 'completed':
                        console.log(`✅ ICE connection completed with ${participantId}`);
                        this.updateParticipantConnectionStatus(participantId, 'connected');
                        break;
                }
            });
            
            // Monitor ICE gathering state
            peer._pc.addEventListener('icegatheringstatechange', () => {
                const state = peer._pc.iceGatheringState;
                console.log(`🧊 ICE gathering state for ${participantId}: ${state}`);
            });
            
            // Monitor connection state
            peer._pc.addEventListener('connectionstatechange', () => {
                const state = peer._pc.connectionState;
                console.log(`🔗 Connection state for ${participantId}: ${state}`);
                
                switch (state) {
                    case 'connected':
                        console.log(`✅ Connection established with ${participantId}`);
                        this.updateParticipantConnectionStatus(participantId, 'connected');
                        break;
                    case 'disconnected':
                        console.log(`⚠️ Connection disconnected with ${participantId}`);
                        this.updateParticipantConnectionStatus(participantId, 'disconnected');
                        break;
                    case 'failed':
                        console.error(`❌ Connection failed with ${participantId}`);
                        this.updateParticipantConnectionStatus(participantId, 'failed');
                        this.handleConnectionFailure(participantId);
                        break;
                    case 'closed':
                        console.log(`🔌 Connection closed with ${participantId}`);
                        this.updateParticipantConnectionStatus(participantId, 'closed');
                        break;
                    case 'connecting':
                        console.log(`🔗 Connecting to ${participantId}...`);
                        this.updateParticipantConnectionStatus(participantId, 'connecting');
                        break;
                }
            });
        }
    }

    // Helper method to update participant connection status in UI
    updateParticipantConnectionStatus(participantId, status) {
        try {
            const participantElement = document.querySelector(`[data-user-id="${participantId}"]`);
            if (participantElement) {
                // Remove existing status classes
                participantElement.classList.remove('connected', 'disconnected', 'error', 'failed', 'closed');
                // Add new status class
                participantElement.classList.add(status);
                
                // Update status indicator if it exists
                const statusIndicator = participantElement.querySelector('.connection-status');
                if (statusIndicator) {
                    statusIndicator.textContent = status;
                    statusIndicator.className = `connection-status ${status}`;
                }
                
                console.log(`📊 Updated connection status for ${participantId}: ${status}`);
            }
        } catch (error) {
            console.error(`Error updating connection status for ${participantId}:`, error);
        }
    }

    // Handle general connection errors
    handleConnectionError(participantId, error) {
        console.error(`🔧 Handling connection error for ${participantId}:`, error);
        
        // Attempt to reconnect after a delay
        setTimeout(() => {
            this.attemptReconnection(participantId);
        }, 3000);
    }

    // Handle ICE connection failures specifically
    handleICEConnectionFailure(participantId) {
        console.error(`🧊 ICE connection failed for ${participantId}, attempting recovery...`);
        
        // Try to restart ICE
        const peer = this.peers.get(participantId);
        if (peer && peer._pc) {
            try {
                peer._pc.restartIce();
                console.log(`🔄 ICE restart initiated for ${participantId}`);
            } catch (error) {
                console.error(`❌ Failed to restart ICE for ${participantId}:`, error);
                this.attemptReconnection(participantId);
            }
        } else {
            this.attemptReconnection(participantId);
        }
    }

    // Handle general connection failures
    handleConnectionFailure(participantId) {
        console.error(`🔗 Connection failed for ${participantId}, attempting reconnection...`);
        this.attemptReconnection(participantId);
    }

    // Attempt to reconnect to a participant
    async attemptReconnection(participantId) {
        try {
            console.log(`🔄 Attempting reconnection to ${participantId}...`);
            
            // Clean up existing connection
            const existingPeer = this.peers.get(participantId);
            if (existingPeer) {
                existingPeer.destroy();
                this.peers.delete(participantId);
            }
            
            // Wait a moment before reconnecting
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Check if participant is still in the room
            const response = await fetch(`/api/prayer-room/${this.roomId}/participants`, {
                credentials: 'include'
            });
            if (!response.ok) {
                console.error(`Failed to fetch participants for reconnection: ${response.status}`);
                return;
            }
            
            const data = await response.json();
            const participants = data.participants || [];
            const participant = participants.find(p => p.user_id === participantId);
            
            if (!participant) {
                console.log(`👋 Participant ${participantId} no longer in room, skipping reconnection`);
                return;
            }
            
            // Create new connection
            await this.createPeerConnection(participantId, participant);
            console.log(`✅ Reconnection attempt completed for ${participantId}`);
            
        } catch (error) {
            console.error(`❌ Reconnection failed for ${participantId}:`, error);
        }
    }

    // Clean up peer connection gracefully
    cleanupPeerConnection(participantId) {
        try {
            console.log(`🧹 Cleaning up peer connection for ${participantId}`);
            
            const peer = this.peers.get(participantId);
            if (peer) {
                // Mark as intentionally closing to avoid error handling
                peer._intentionallyClosing = true;
                
                // Destroy the peer connection
                peer.destroy();
                this.peers.delete(participantId);
                
                // Update UI status
                this.updateParticipantConnectionStatus(participantId, 'disconnected');
                
                console.log(`✅ Peer connection cleaned up for ${participantId}`);
            }
        } catch (error) {
            console.error(`❌ Error cleaning up peer connection for ${participantId}:`, error);
        }
    }

    // Handle signaling state errors (InvalidStateError)
    async handleSignalingStateError(participantId, error) {
        try {
            console.log(`🔧 Handling signaling state error for ${participantId}:`, error.message);
            
            // Clean up the problematic connection
            this.cleanupPeerConnection(participantId);
            
            // Wait a moment before recreating
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Check if participant is still in the room
            const response = await fetch(`/api/prayer-room/${this.roomId}/participants`, {
                credentials: 'include'
            });
            if (!response.ok) {
                console.error(`Failed to fetch participants for signaling recovery: ${response.status}`);
                return;
            }
            
            const data = await response.json();
            const participants = data.participants || [];
            const participant = participants.find(p => p.user_id === participantId);
            
            if (!participant) {
                console.log(`👋 Participant ${participantId} no longer in room, skipping signaling recovery`);
                return;
            }
            
            // Create a fresh connection
            console.log(`🔄 Creating fresh connection for ${participantId} after signaling error`);
            await this.createPeerConnection(participantId, participant);
            
        } catch (error) {
            console.error(`❌ Error handling signaling state error for ${participantId}:`, error);
        }
    }

    async sendWebRTCOffer(toUser, offer) {
        try {
            const response = await fetch(`/api/prayer-room/room/${this.roomId}/webrtc-offer`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    to_user: toUser,
                    offer: offer
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
        } catch (error) {
            console.error('Error sending WebRTC offer:', error);
        }
    }

    async sendWebRTCAnswer(toUser, answer) {
        try {
            const response = await fetch(`/api/prayer-room/room/${this.roomId}/webrtc-answer`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    to_user: toUser,
                    answer: answer
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
        } catch (error) {
            console.error('Error sending WebRTC answer:', error);
        }
    }

    async sendICECandidate(toUser, candidate) {
        try {
            // ICE candidates are handled directly between peers
            // No need to store in Firestore for now
            console.log('ICE candidate sent directly to peer:', toUser);
        } catch (error) {
            console.error('Error sending ICE candidate:', error);
        }
    }

    handleRemoteStream(participantId, stream) {
        try {
            console.log(`🎵 Handling remote stream from ${participantId}`, stream);
            
            // Validate the remote stream
            if (!this.validateAudioStream(stream, `remote participant ${participantId}`)) {
                console.warn(`🎵 Invalid remote stream from ${participantId}`);
                return;
            }
            
            const audioTracks = stream.getAudioTracks();
            console.log(`🎵 Audio tracks found:`, audioTracks.length);
            
            // Remove existing audio element if it exists
            const existingAudio = document.getElementById(`audio-${participantId}`);
            if (existingAudio) {
                existingAudio.remove();
                console.log(`🎵 Removed existing audio element for ${participantId}`);
            }
            
                    // Create audio element for remote stream with ultra-low latency settings
                    const audioElement = document.createElement('audio');
                    audioElement.srcObject = stream;
                    audioElement.autoplay = true;
                    audioElement.playsInline = true; // Important for mobile
                    audioElement.id = `audio-${participantId}`;
                    audioElement.volume = 0.8; // Set default volume
                    audioElement.controls = false; // Hide controls
                    audioElement.muted = false; // Ensure not muted
                    
                    // Ultra-low latency audio settings
                    audioElement.preload = 'none'; // Don't preload for faster connection
                    audioElement.crossOrigin = 'anonymous'; // Enable CORS for better performance
                    
                    // Optimize for low latency playback
                    audioElement.addEventListener('loadstart', () => {
                        console.log(`🎵 Audio load started for ${participantId}`);
                    });
                    
                    audioElement.addEventListener('loadeddata', () => {
                        console.log(`🎵 Audio data loaded for ${participantId}`);
                        // Try to play immediately when data is loaded
                        audioElement.play().catch(error => {
                            console.warn(`🎵 Auto-play failed for ${participantId}:`, error);
                        });
                    });
            
            // Add to a dedicated audio container or body
            let audioContainer = document.getElementById('audioContainer');
            if (!audioContainer) {
                audioContainer = document.createElement('div');
                audioContainer.id = 'audioContainer';
                audioContainer.style.display = 'none'; // Hide the container
                document.body.appendChild(audioContainer);
            }
            
            audioContainer.appendChild(audioElement);
            console.log(`🎵 Audio element added to container for ${participantId}`);
            
                    // Try to play the audio immediately with optimized settings
                    const playAudio = async () => {
                        try {
                            // Set audio context to low latency mode if available
                            if (this.audioContext && this.audioContext.state === 'running') {
                                // Optimize audio context for low latency
                                this.audioContext.suspend().then(() => {
                                    this.audioContext.resume();
                                });
                            }
                            
                            // Play immediately without waiting
                            const playPromise = audioElement.play();
                            
                            if (playPromise !== undefined) {
                                await playPromise;
                                console.log(`🎵 Audio playing successfully for ${participantId}`);
                            } else {
                                console.log(`🎵 Audio playing for ${participantId} (no promise)`);
                            }
                            
                        } catch (error) {
                            console.error(`🎵 Failed to play audio for ${participantId}:`, error);
                            
                            // Retry with user interaction fallback
                            setTimeout(() => {
                                audioElement.play().catch(e => {
                                    console.error(`🎵 Retry play failed for ${participantId}:`, e);
                                });
                            }, 100); // Very short delay for retry
                        }
                    };
                    
                    // Play immediately
                    playAudio();
            
        } catch (error) {
            console.error('🎵 Error handling remote stream:', error);
        }
    }

    // Method to validate and manage audio tracks
    validateAudioStream(stream, source = 'unknown') {
        try {
            console.log(`🔍 Validating audio stream from ${source}:`, stream);
            
            if (!stream) {
                console.error(`🔍 No stream provided from ${source}`);
                return false;
            }
            
            if (!stream.active) {
                console.warn(`🔍 Stream is not active from ${source}`);
                return false;
            }
            
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length === 0) {
                console.warn(`🔍 No audio tracks found in stream from ${source}`);
                return false;
            }
            
            console.log(`🔍 Found ${audioTracks.length} audio track(s) from ${source}`);
            
            audioTracks.forEach((track, index) => {
                console.log(`🔍 Audio track ${index} from ${source}:`, {
                    id: track.id,
                    kind: track.kind,
                    enabled: track.enabled,
                    muted: track.muted,
                    readyState: track.readyState,
                    label: track.label,
                    settings: track.getSettings()
                });
                
                // Ensure track is enabled
                if (!track.enabled) {
                    console.log(`🔍 Enabling audio track ${index} from ${source}`);
                    track.enabled = true;
                }
            });
            
            return true;
            
        } catch (error) {
            console.error(`🔍 Error validating audio stream from ${source}:`, error);
            return false;
        }
    }

    // Method to handle audio autoplay issues (optimized for speed)
    async enableAudioPlayback() {
        try {
            // Use existing audio context if available, otherwise create a minimal one
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            // Resume if suspended (non-blocking)
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume().catch(error => {
                    console.warn('🔊 Audio context resume failed:', error);
                });
            }
            
            console.log('🔊 Audio playback enabled');
        } catch (error) {
            console.error('🔊 Error enabling audio playback:', error);
        }
    }

    // Advanced Audio Processing Methods
    async initializeAdvancedAudioProcessing() {
        try {
            console.log('🎛️ Initializing advanced audio processing...');
            
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            // Resume audio context (non-blocking)
            if (this.audioContext.state === 'suspended') {
                this.audioContext.resume().catch(error => {
                    console.warn('🎛️ Audio context resume failed:', error);
                });
            }
            
            // Create audio processing chain (non-blocking)
            this.setupAudioProcessingChain().catch(error => {
                console.warn('🎛️ Audio processing chain setup failed:', error);
            });
            
            // Initialize voice activity detection (non-blocking)
            setTimeout(() => {
                this.setupAdvancedVoiceActivityDetection();
            }, 100);
            
            // Start audio quality monitoring (non-blocking)
            setTimeout(() => {
                this.startAudioQualityMonitoring();
            }, 200);
            
            console.log('🎛️ Advanced audio processing initialized');
            
        } catch (error) {
            console.error('🎛️ Error initializing advanced audio processing:', error);
        }
    }

    async setupAudioProcessingChain() {
        try {
            if (!this.localStream || !this.audioContext) return;
            
            // Get the audio track
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (!audioTrack) return;
            
            // Create media stream source
            const source = this.audioContext.createMediaStreamSource(this.localStream);
            
            // Create audio processing nodes
            this.gainController = this.audioContext.createGain();
            this.audioAnalyser = this.audioContext.createAnalyser();
            
            // Configure analyser for better frequency analysis
            this.audioAnalyser.fftSize = 2048;
            this.audioAnalyser.smoothingTimeConstant = 0.8;
            
            // Create noise suppression using Web Audio API
            this.noiseSuppressor = this.createNoiseSuppressor();
            
            // Create echo cancellation
            this.echoCanceller = this.createEchoCanceller();
            
            // Create audio enhancer
            this.audioEnhancer = this.createAudioEnhancer();
            
            // Connect the audio processing chain
            source.connect(this.gainController);
            this.gainController.connect(this.noiseSuppressor);
            this.noiseSuppressor.connect(this.echoCanceller);
            this.echoCanceller.connect(this.audioEnhancer);
            this.audioEnhancer.connect(this.audioAnalyser);
            
            // Create destination for processed audio
            const destination = this.audioContext.createMediaStreamDestination();
            this.audioEnhancer.connect(destination);
            
            // Replace the original stream with processed stream
            this.localStream = destination.stream;
            
            console.log('🎛️ Audio processing chain created');
            
        } catch (error) {
            console.error('🎛️ Error setting up audio processing chain:', error);
        }
    }

    createNoiseSuppressor() {
        try {
            // Create a high-pass filter to remove low-frequency noise
            const highPassFilter = this.audioContext.createBiquadFilter();
            highPassFilter.type = 'highpass';
            highPassFilter.frequency.value = 80; // Remove frequencies below 80Hz
            highPassFilter.Q.value = 1;
            
            // Create a low-pass filter to remove high-frequency noise
            const lowPassFilter = this.audioContext.createBiquadFilter();
            lowPassFilter.type = 'lowpass';
            lowPassFilter.frequency.value = 8000; // Remove frequencies above 8kHz
            lowPassFilter.Q.value = 1;
            
            // Create a notch filter for common noise frequencies
            const notchFilter = this.audioContext.createBiquadFilter();
            notchFilter.type = 'notch';
            notchFilter.frequency.value = 60; // Remove 60Hz hum
            notchFilter.Q.value = 30;
            
            // Connect filters in series
            highPassFilter.connect(lowPassFilter);
            lowPassFilter.connect(notchFilter);
            
            return highPassFilter;
            
        } catch (error) {
            console.error('🎛️ Error creating noise suppressor:', error);
            return this.audioContext.createGain(); // Fallback to simple gain
        }
    }

    createEchoCanceller() {
        try {
            // Create a dynamic range compressor to reduce echo
            const compressor = this.audioContext.createDynamicsCompressor();
            compressor.threshold.value = -24;
            compressor.knee.value = 30;
            compressor.ratio.value = 12;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.25;
            
            return compressor;
            
        } catch (error) {
            console.error('🎛️ Error creating echo canceller:', error);
            return this.audioContext.createGain(); // Fallback to simple gain
        }
    }

    createAudioEnhancer() {
        try {
            // Create a multi-band equalizer for voice enhancement
            const eq = this.audioContext.createBiquadFilter();
            eq.type = 'peaking';
            eq.frequency.value = 1000; // Enhance voice frequencies around 1kHz
            eq.gain.value = 3; // Boost by 3dB
            eq.Q.value = 1;
            
            // Create a gentle compressor for consistent volume
            const compressor = this.audioContext.createDynamicsCompressor();
            compressor.threshold.value = -20;
            compressor.knee.value = 20;
            compressor.ratio.value = 4;
            compressor.attack.value = 0.01;
            compressor.release.value = 0.1;
            
            eq.connect(compressor);
            return eq;
            
        } catch (error) {
            console.error('🎛️ Error creating audio enhancer:', error);
            return this.audioContext.createGain(); // Fallback to simple gain
        }
    }

    setupAdvancedVoiceActivityDetection() {
        try {
            if (!this.audioAnalyser) return;
            
            // Prevent multiple detection loops from running simultaneously
            if (this.voiceActivityDetectionActive) {
                console.log('🎤 Voice activity detection already active, skipping advanced setup');
                return;
            }
            
            this.voiceActivityDetectionActive = true;
            
            const bufferLength = this.audioAnalyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            const detectVoiceActivity = () => {
                // Stop if detection is no longer active
                if (!this.voiceActivityDetectionActive) {
                    return;
                }
                
                this.audioAnalyser.getByteFrequencyData(dataArray);
                
                // Calculate RMS (Root Mean Square) for voice detection
                let sum = 0;
                for (let i = 0; i < bufferLength; i++) {
                    sum += dataArray[i] * dataArray[i];
                }
                const rms = Math.sqrt(sum / bufferLength);
                
                // Advanced voice activity detection
                const voiceThreshold = this.calculateDynamicThreshold(dataArray);
                const isCurrentlySpeaking = rms > voiceThreshold;
                
                if (isCurrentlySpeaking !== this.isSpeaking) {
                    this.isSpeaking = isCurrentlySpeaking;
                    this.broadcastSpeakingState();
                    
                    // Update UI with speaking indicator
                    this.updateSpeakingIndicator(this.isSpeaking);
                }
                
                // Continue monitoring
                requestAnimationFrame(detectVoiceActivity);
            };
            
            detectVoiceActivity();
            console.log('🎤 Advanced voice activity detection started');
            
        } catch (error) {
            console.error('🎤 Error setting up voice activity detection:', error);
            this.voiceActivityDetectionActive = false;
        }
    }

    calculateDynamicThreshold(dataArray) {
        try {
            // Calculate dynamic threshold based on frequency analysis
            const voiceFrequencies = dataArray.slice(85, 340); // ~1kHz to ~4kHz range
            const avgVoiceLevel = voiceFrequencies.reduce((a, b) => a + b, 0) / voiceFrequencies.length;
            
            // Adaptive threshold based on background noise
            const backgroundNoise = dataArray.slice(0, 85).reduce((a, b) => a + b, 0) / 85;
            const dynamicThreshold = Math.max(avgVoiceLevel * 0.3, backgroundNoise * 2);
            
            return Math.min(dynamicThreshold, 50); // Cap at reasonable level
            
        } catch (error) {
            console.error('🎤 Error calculating dynamic threshold:', error);
            return this.voiceActivityThreshold * 100; // Fallback to static threshold
        }
    }

    startAudioQualityMonitoring() {
        try {
            if (!this.audioAnalyser) return;
            
            const monitorQuality = () => {
                const bufferLength = this.audioAnalyser.frequencyBinCount;
                const dataArray = new Uint8Array(bufferLength);
                this.audioAnalyser.getByteFrequencyData(dataArray);
                
                // Calculate audio quality metrics
                const quality = this.calculateAudioQuality(dataArray);
                this.connectionQuality = quality;
                
                // Adapt bitrate based on quality
                if (this.adaptiveBitrate) {
                    this.adaptBitrateBasedOnQuality(quality);
                }
                
                // Update UI with quality indicator
                this.updateAudioQualityIndicator(quality);
                
                // Continue monitoring
                setTimeout(monitorQuality, 1000); // Check every second
            };
            
            monitorQuality();
            console.log('📊 Audio quality monitoring started');
            
        } catch (error) {
            console.error('📊 Error starting audio quality monitoring:', error);
        }
    }

    calculateAudioQuality(dataArray) {
        try {
            // Calculate signal-to-noise ratio
            const signal = dataArray.slice(85, 340).reduce((a, b) => a + b, 0) / 255;
            const noise = dataArray.slice(0, 85).reduce((a, b) => a + b, 0) / 255;
            const snr = signal / (noise + 0.1); // Add small value to avoid division by zero
            
            // Determine quality level
            if (snr > 3) return 'excellent';
            if (snr > 2) return 'good';
            if (snr > 1) return 'fair';
            return 'poor';
            
        } catch (error) {
            console.error('📊 Error calculating audio quality:', error);
            return 'unknown';
        }
    }

    adaptBitrateBasedOnQuality(quality) {
        try {
            // Adjust audio constraints based on quality
            const audioTracks = this.localStream.getAudioTracks();
            if (audioTracks.length === 0) return;
            
            const track = audioTracks[0];
            
            // Get current constraints to avoid conflicts
            const currentConstraints = track.getConstraints();
            console.log('🎛️ Current constraints:', currentConstraints);
            
            // Create new constraints based on quality, but only change what's necessary
            let newConstraints = {};
            
            switch (quality) {
                case 'excellent':
                    // Use highest quality settings (only if supported)
                    newConstraints = {
                        sampleRate: { ideal: 48000 },
                        channelCount: { ideal: 1 },
                        echoCancellation: { ideal: true },
                        noiseSuppression: { ideal: true },
                        autoGainControl: { ideal: true }
                    };
                    break;
                case 'good':
                    // Use balanced settings
                    newConstraints = {
                        sampleRate: { ideal: 44100 },
                        channelCount: { ideal: 1 },
                        echoCancellation: { ideal: true },
                        noiseSuppression: { ideal: true },
                        autoGainControl: { ideal: true }
                    };
                    break;
                case 'fair':
                case 'poor':
                    // Use conservative settings for better reliability
                    newConstraints = {
                        sampleRate: { ideal: 22050 },
                        channelCount: { ideal: 1 },
                        echoCancellation: { ideal: true },
                        noiseSuppression: { ideal: true },
                        autoGainControl: { ideal: true }
                    };
                    break;
            }
            
            // Only apply constraints if they're different from current ones
            const constraintsChanged = JSON.stringify(newConstraints) !== JSON.stringify(currentConstraints);
            
            if (constraintsChanged) {
                track.applyConstraints(newConstraints).then(() => {
                    console.log(`🎛️ Successfully adapted bitrate for ${quality} quality`);
                }).catch(error => {
                    console.warn(`🎛️ Failed to apply ${quality} quality constraints:`, error);
                    
                    // Fallback to basic constraints if advanced ones fail
                    const fallbackConstraints = {
                        echoCancellation: { ideal: true },
                        noiseSuppression: { ideal: true },
                        autoGainControl: { ideal: true }
                    };
                    
                    track.applyConstraints(fallbackConstraints).catch(fallbackError => {
                        console.warn('🎛️ Fallback constraints also failed:', fallbackError);
                    });
                });
            }
            
        } catch (error) {
            console.error('🎛️ Error adapting bitrate:', error);
        }
    }

    updateAudioQualityIndicator(quality) {
        try {
            const qualityIndicator = document.getElementById('audioQualityIndicator');
            if (!qualityIndicator) return;
            
            // Update quality indicator color and text
            qualityIndicator.className = `audio-quality-indicator ${quality}`;
            qualityIndicator.textContent = quality.charAt(0).toUpperCase() + quality.slice(1);
            
        } catch (error) {
            console.error('📊 Error updating audio quality indicator:', error);
        }
    }

    updateSpeakingIndicator(isSpeaking) {
        try {
            // Update speaking indicator in participant list
            const participantElement = document.querySelector(`[data-user-id="${this.userId}"]`);
            if (participantElement) {
                const speakingIndicator = participantElement.querySelector('.speaking-indicator');
                const isMuted = participantElement.classList.contains('muted');
                
                if (speakingIndicator) {
                    // Only show speaking indicator if speaking and not muted
                    speakingIndicator.style.display = (isSpeaking && !isMuted) ? 'inline' : 'none';
                }
                
                // Update speaking class only if not muted
                if (isSpeaking && !isMuted) {
                    participantElement.classList.add('speaking');
                } else {
                    participantElement.classList.remove('speaking');
                }
            }
            
        } catch (error) {
            console.error('🎤 Error updating speaking indicator:', error);
        }
    }

    updateAllSpeakingIndicators() {
        try {
            // Update speaking indicators for all participants based on their current mute status
            const participantElements = document.querySelectorAll('.participant');
            participantElements.forEach(element => {
                const speakingIndicator = element.querySelector('.speaking-indicator');
                const isMuted = element.classList.contains('muted');
                const isSpeaking = element.classList.contains('speaking');
                
                if (speakingIndicator) {
                    // Only show speaking indicator if speaking and not muted
                    speakingIndicator.style.display = (isSpeaking && !isMuted) ? 'inline' : 'none';
                }
                
                // Update speaking class only if not muted
                if (isSpeaking && !isMuted) {
                    element.classList.add('speaking');
                } else {
                    element.classList.remove('speaking');
                }
            });
        } catch (error) {
            console.error('🎤 Error updating all speaking indicators:', error);
        }
    }

    // Enable adaptive bitrate (can be called by user if needed)
    enableAdaptiveBitrate() {
        try {
            console.log('🎛️ Enabling adaptive bitrate...');
            this.adaptiveBitrate = true;
            
            // Start monitoring if not already started
            if (!this.audioQualityMonitor) {
                this.startAudioQualityMonitoring();
            }
            
            console.log('🎛️ Adaptive bitrate enabled');
        } catch (error) {
            console.error('🎛️ Error enabling adaptive bitrate:', error);
        }
    }

    // Disable adaptive bitrate (default state)
    disableAdaptiveBitrate() {
        try {
            console.log('🎛️ Disabling adaptive bitrate...');
            this.adaptiveBitrate = false;
            console.log('🎛️ Adaptive bitrate disabled');
        } catch (error) {
            console.error('🎛️ Error disabling adaptive bitrate:', error);
        }
    }

    // Multi-Device Session Management
    async checkForExistingSession() {
        try {
            console.log('📱 Checking for existing device sessions...');
            
            // Generate unique device ID
            this.currentDeviceId = this.generateDeviceId();
            
            // Check if user already has an active session
            const response = await fetch(`/api/prayer-room/${this.roomId}/check-session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    user_id: this.userId,
                    device_id: this.currentDeviceId,
                    device_info: this.getDeviceInfo()
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.has_existing_session) {
                    console.log('📱 Existing session detected, showing conflict resolution dialog');
                    this.showDeviceConflictDialog(data.existing_device_info);
                    return true;
                }
            }
            
            // Register this device session
            await this.registerDeviceSession();
            return false;
            
        } catch (error) {
            console.error('📱 Error checking for existing session:', error);
            return false;
        }
    }

    generateDeviceId() {
        try {
            // Generate a unique device ID based on browser fingerprint
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillText('Device fingerprint', 2, 2);
            
            const fingerprint = [
                navigator.userAgent,
                navigator.language,
                screen.width + 'x' + screen.height,
                new Date().getTimezoneOffset(),
                canvas.toDataURL()
            ].join('|');
            
            // Create a simple hash
            let hash = 0;
            for (let i = 0; i < fingerprint.length; i++) {
                const char = fingerprint.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32-bit integer
            }
            
            return 'device_' + Math.abs(hash).toString(36);
            
        } catch (error) {
            console.error('📱 Error generating device ID:', error);
            return 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }
    }

    getDeviceInfo() {
        try {
            return {
                user_agent: navigator.userAgent,
                platform: navigator.platform,
                language: navigator.language,
                screen_resolution: `${screen.width}x${screen.height}`,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('📱 Error getting device info:', error);
            return {
                user_agent: 'Unknown',
                platform: 'Unknown',
                language: 'Unknown',
                screen_resolution: 'Unknown',
                timezone: 'Unknown',
                timestamp: new Date().toISOString()
            };
        }
    }

    showDeviceConflictDialog(existingDeviceInfo) {
        try {
            console.log('📱 Showing device conflict dialog');
            
            // Create modal for device conflict resolution
            const modal = document.createElement('div');
            modal.className = 'device-conflict-modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <div class="modal-header">
                        <h3>📱 Device Conflict Detected</h3>
                    </div>
                    <div class="modal-body">
                        <p>You're already connected to this prayer room from another device:</p>
                        <div class="device-info">
                            <p><strong>Device:</strong> ${existingDeviceInfo.platform || 'Unknown'}</p>
                            <p><strong>Browser:</strong> ${this.parseUserAgent(existingDeviceInfo.user_agent)}</p>
                            <p><strong>Connected:</strong> ${new Date(existingDeviceInfo.timestamp).toLocaleString()}</p>
                        </div>
                        <p>What would you like to do?</p>
                    </div>
                    <div class="modal-footer">
                        <button id="keepExistingSession" class="btn btn-secondary">Keep Existing Session</button>
                        <button id="switchToNewDevice" class="btn btn-primary">Switch to This Device</button>
                    </div>
                </div>
            `;
            
            document.body.appendChild(modal);
            
            // Add event listeners
            document.getElementById('keepExistingSession').addEventListener('click', () => {
                this.handleKeepExistingSession();
                document.body.removeChild(modal);
            });
            
            document.getElementById('switchToNewDevice').addEventListener('click', () => {
                this.handleSwitchToNewDevice();
                document.body.removeChild(modal);
            });
            
        } catch (error) {
            console.error('📱 Error showing device conflict dialog:', error);
        }
    }

    parseUserAgent(userAgent) {
        try {
            if (userAgent.includes('Chrome')) return 'Chrome';
            if (userAgent.includes('Firefox')) return 'Firefox';
            if (userAgent.includes('Safari')) return 'Safari';
            if (userAgent.includes('Edge')) return 'Edge';
            return 'Unknown Browser';
        } catch (error) {
            return 'Unknown Browser';
        }
    }

    async handleKeepExistingSession() {
        try {
            console.log('📱 User chose to keep existing session');
            alert('You will remain connected on your other device. This session will be closed.');
            window.location.href = '/prayers';
        } catch (error) {
            console.error('📱 Error handling keep existing session:', error);
        }
    }

    async handleSwitchToNewDevice() {
        try {
            console.log('📱 User chose to switch to new device');
            await this.disconnectExistingSession();
            await this.registerDeviceSession();
            console.log('📱 Successfully switched to new device');
        } catch (error) {
            console.error('📱 Error handling switch to new device:', error);
        }
    }

    async disconnectExistingSession() {
        try {
            const response = await fetch(`/api/prayer-room/${this.roomId}/disconnect-session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: this.userId })
            });
            
            if (response.ok) {
                console.log('📱 Successfully disconnected existing session');
            }
        } catch (error) {
            console.error('📱 Error disconnecting existing session:', error);
        }
    }

    async registerDeviceSession() {
        try {
            const response = await fetch(`/api/prayer-room/${this.roomId}/register-session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: this.userId,
                    device_id: this.currentDeviceId,
                    device_info: this.getDeviceInfo()
                })
            });
            
            if (response.ok) {
                console.log('📱 Successfully registered device session');
            }
        } catch (error) {
            console.error('📱 Error registering device session:', error);
        }
    }

    // Method to initiate connections with existing participants
    async initiateConnectionsWithParticipants() {
        try {
            if (!this.localStream) {
                console.log('No local stream available for initiating connections');
                return;
            }
            
            // Get current participants via API
            const response = await fetch(`/api/prayer-room/${this.roomId}/participants`, {
                credentials: 'include'
            });
            if (!response.ok) {
                console.error('Failed to fetch participants:', await response.text());
                return;
            }
            
            const data = await response.json();
            const participants = data.participants || [];
            
            for (const participant of participants) {
                if (participant.user_id !== this.userId) {
                    await this.createPeerConnection(participant.user_id, participant);
                }
            }
            
            console.log('Initiated connections with all participants');
            
        } catch (error) {
            console.error('Error initiating connections with participants:', error);
        }
    }


    // Helper method to get current participants
    async getCurrentParticipants() {
        try {
            const response = await fetch(`/api/prayer-room/${this.roomId}/participants`, {
                credentials: 'include'
            });
            const data = await response.json();
            return data.participants || [];
        } catch (error) {
            console.error('Error getting current participants:', error);
            return [];
        }
    }

    // Host Controls for Managing Participants
    async muteParticipant(participantId) {
        try {
            if (!this.isHost) {
                console.warn('Only host can mute participants');
                return;
            }
            
            // Get current participant data to determine current mute state
            const participants = await this.getCurrentParticipants();
            const participant = participants.find(p => p.user_id === participantId);
            
            if (!participant) {
                console.error(`Participant ${participantId} not found`);
                this.showError('Participant not found');
                return;
            }
            
            const currentMuteState = participant.is_muted || false;
            const newMuteState = !currentMuteState;
            
            console.log(`🔇 Host ${newMuteState ? 'muting' : 'unmuting'} participant: ${participantId}`);
            
            const response = await fetch(`/api/prayer-room/${this.roomId}/mute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    user_id: participantId,
                    is_muted: newMuteState
                })
            });
            
            if (response.ok) {
                console.log(`✅ Successfully ${newMuteState ? 'muted' : 'unmuted'} participant: ${participantId}`);
                // Refresh participants to update UI
                this.loadParticipants();
                // Update speaking indicators for all participants
                this.updateAllSpeakingIndicators();
            } else {
                const error = await response.text();
                console.error(`❌ Failed to ${newMuteState ? 'mute' : 'unmute'} participant: ${error}`);
                this.showError(`Failed to ${newMuteState ? 'mute' : 'unmute'} participant`);
            }
                
        } catch (error) {
            console.error('Error muting participant:', error);
            this.showError('Failed to mute participant');
        }
    }

    async unmuteParticipant(participantId) {
        try {
            if (!this.isHost) {
                console.warn('Only host can unmute participants');
                return;
            }
            
            console.log(`🔊 Host unmuting participant: ${participantId}`);
            
            const response = await fetch(`/api/prayer-room/${this.roomId}/mute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    user_id: participantId,
                    is_muted: false
                })
            });
            
            if (response.ok) {
                console.log(`✅ Successfully unmuted participant: ${participantId}`);
                // Refresh participants to update UI
                this.loadParticipants();
                // Update speaking indicators for all participants
                this.updateAllSpeakingIndicators();
            } else {
                const error = await response.text();
                console.error(`❌ Failed to unmute participant: ${error}`);
                this.showError('Failed to unmute participant');
            }
                
        } catch (error) {
            console.error('Error unmuting participant:', error);
            this.showError('Failed to unmute participant');
        }
    }

    async removeParticipant(participantId) {
        try {
            if (!this.isHost) {
                console.warn('Only host can remove participants');
                return;
            }
            
            // Confirm removal
            const confirmed = confirm(`Are you sure you want to remove this participant from the prayer room?`);
            if (!confirmed) {
                return;
            }
            
            console.log(`👋 Host removing participant: ${participantId}`);
            
            const response = await fetch(`/api/prayer-room/${this.roomId}/remove`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    user_id: participantId
                })
            });
            
            if (response.ok) {
                console.log(`✅ Successfully removed participant: ${participantId}`);
                // Clean up peer connection
                this.cleanupPeerConnection(participantId);
                // Refresh participants to update UI
                this.loadParticipants();
            } else {
                const error = await response.text();
                console.error(`❌ Failed to remove participant: ${error}`);
                this.showError('Failed to remove participant');
            }
                
        } catch (error) {
            console.error('Error removing participant:', error);
            this.showError('Failed to remove participant');
        }
    }

    // Clean up old processed signals to prevent memory issues
    cleanupProcessedSignals() {
        try {
            if (this.processedSignals.size > this.maxProcessedSignals) {
                console.log(`🧹 Cleaning up processed signals: ${this.processedSignals.size} -> ${this.maxProcessedSignals / 2}`);
                // Keep only the most recent half
                const signalsArray = Array.from(this.processedSignals);
                const keepCount = Math.floor(this.maxProcessedSignals / 2);
                this.processedSignals.clear();
                
                // Keep the most recent signals (assuming they're added chronologically)
                signalsArray.slice(-keepCount).forEach(signal => {
                    this.processedSignals.add(signal);
                });
            }
        } catch (error) {
            console.error('🧹 Error cleaning up processed signals:', error);
        }
    }
}

// Initialize when DOM is loaded
// Mobile Chat Expansion Functions
function expandMobileChat() {
    const chatPanel = document.getElementById('chatPanel');
    const fullscreenBtn = document.getElementById('mobileChatExpandBtn');
    const backBtn = document.getElementById('mobileChatBackBtn');
    
    if (chatPanel) {
        chatPanel.classList.add('mobile-expanded');
        document.body.classList.add('chat-expanded');
        // Prevent body scroll when chat is expanded
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.width = '100%';
        document.body.style.height = '100%';
        
        // Toggle button visibility
        if (fullscreenBtn) fullscreenBtn.style.display = 'none';
        if (backBtn) backBtn.style.display = 'flex';
        
        // Focus on chat input for better UX
        const chatInput = document.getElementById('chatInput');
        if (chatInput) {
            setTimeout(() => chatInput.focus(), 300);
        }
        
        // Scroll to bottom when expanding
        setTimeout(() => {
            scrollChatToBottom();
        }, 100);
    }
}

function collapseMobileChat() {
    const chatPanel = document.getElementById('chatPanel');
    const fullscreenBtn = document.getElementById('mobileChatExpandBtn');
    const backBtn = document.getElementById('mobileChatBackBtn');
    
    if (chatPanel) {
        chatPanel.classList.remove('mobile-expanded');
        document.body.classList.remove('chat-expanded');
        // Restore body scroll
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
        document.body.style.position = '';
        document.body.style.width = '';
        document.body.style.height = '';
        
        // Toggle button visibility
        if (fullscreenBtn) fullscreenBtn.style.display = 'flex';
        if (backBtn) backBtn.style.display = 'none';
    }
}

// Handle escape key to collapse mobile chat
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        const chatPanel = document.getElementById('chatPanel');
        if (chatPanel && chatPanel.classList.contains('mobile-expanded')) {
            collapseMobileChat();
        }
    }
});

// Improved chat scrolling function
function scrollChatToBottom() {
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
        console.log('Chat scrolled to bottom, position:', chatMessages.scrollTop);
    }
}

// Auto-expand chat on mobile when user clicks on chat input
function setupMobileChatAutoExpand() {
    const chatInput = document.getElementById('chatInput');
    if (chatInput && window.innerWidth <= 768) {
        chatInput.addEventListener('focus', () => {
            const chatPanel = document.getElementById('chatPanel');
            if (chatPanel && !chatPanel.classList.contains('mobile-expanded')) {
                expandMobileChat();
            }
        });
    }
}

// Setup mobile chat button event listeners
function setupMobileChatButtons() {
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const backBtn = document.getElementById('backBtn');
    
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            expandMobileChat();
        });
    }
    
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            collapseMobileChat();
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Extract room ID from URL and set it globally
    const urlParams = new URLSearchParams(window.location.search);
    window.roomId = urlParams.get('room');
    
    // Initialize prayer room service
    window.prayerRoomService = new PrayerRoomService();
    
    // Create shorter alias for easier access
    window.prayerRoom = window.prayerRoomService;
    
    // Setup mobile chat auto-expand
    setupMobileChatAutoExpand();
    
    // Setup mobile chat buttons
    setupMobileChatButtons();
});
