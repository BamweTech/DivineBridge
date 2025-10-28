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
        this.iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ];
        
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
            
            // Initialize UI
            this.initializeUI();
            
            // Join the room
            await this.joinRoom();
            
            // Load initial data
            await this.loadChatMessages();
            await this.loadParticipants();
            
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
            const response = await fetch(`/api/prayer-room/${this.roomId}/participants`);
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
            
        } catch (error) {
            this.updateParticipants([]);
        }
        
            // Set up polling for real-time updates if Firestore listeners fail
            if (!this.participantPollingInterval) {
                this.participantPollingInterval = setInterval(() => {
                    this.loadParticipants();
                }, 3000); // Poll every 3 seconds for faster updates
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
        
        participantsContainer.innerHTML = '';
        
        if (participants && participants.length > 0) {
            participants.forEach(participant => {
                const participantEl = document.createElement('div');
                participantEl.className = 'participant';
                participantEl.setAttribute('data-user-id', participant.user_id);
                
                // Add speaking class if participant is speaking
                if (participant.is_speaking) {
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
                            ${participant.is_speaking ? '<span class="speaking-indicator">Speaking</span>' : ''}
                            ${participant.is_muted ? '<span class="mute-indicator">🔇</span>' : ''}
                        </div>
                    </div>
                    ${this.isHost && !participant.is_host ? `
                        <div class="participant-actions">
                            <button class="action-btn mute-btn" onclick="prayerRoom.muteParticipant('${participant.user_id}')" title="Mute">
                                <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"></path><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
                            </button>
                            <button class="action-btn remove-btn" onclick="prayerRoom.removeParticipant('${participant.user_id}')" title="Remove">
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
            
            // Request microphone permission with improved constraints
            console.log('🎤 Requesting microphone permission...');
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000,
                    channelCount: 1,
                    // Add additional constraints for better compatibility
                    latency: 0.01, // Low latency
                    googEchoCancellation: true,
                    googAutoGainControl: true,
                    googNoiseSuppression: true,
                    googHighpassFilter: true,
                    googTypingNoiseDetection: true,
                    googAudioMirroring: false
                },
                video: false
            });
            
            console.log('🎤 Microphone permission granted, stream obtained:', this.localStream);
            console.log('🎤 Local stream tracks:', this.localStream.getTracks());
            console.log('🎤 Local stream active:', this.localStream.active);
            
            // Validate the local stream
            if (!this.validateAudioStream(this.localStream, 'local microphone')) {
                throw new Error('Invalid audio stream from microphone');
            }
            
            // Enable audio playback first
            await this.enableAudioPlayback();
            
            // Initialize WebRTC with SimplePeer now that we have a local stream
            await this.initializeWebRTC();
            
            // Initiate connections with existing participants
            await this.initiateConnectionsWithParticipants();
            
            // Update UI
            this.isAudioEnabled = true;
            this.updateAudioControls();
            
            console.log('🎤 Successfully joined audio');
            
        } catch (error) {
            console.error('🎤 Error joining audio:', error);
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
            
            // Leave room via API
            await fetch(`/api/prayer-room/leave/${this.roomId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    user_id: this.userId
                })
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
                body: JSON.stringify({
                    user_id: this.userId,
                    user_name: this.userName,
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
            const response = await fetch(`/api/prayer-room/${this.roomId}/chat`);
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
        chatMessages.scrollTop = chatMessages.scrollHeight;
        console.log('Chat display updated, scroll position:', chatMessages.scrollTop);
    }
    
    setupRealtimeListeners() {
        // Note: We're using API endpoints instead of direct Firestore access
        // This avoids permission issues and provides better error handling
        console.log('Using API-based polling instead of direct Firestore listeners');
        
        // Set up polling for participants and chat
        this.setupParticipantPolling();
        this.setupChatPolling();
    }
    
    setupChatPolling() {
        // Poll for new chat messages every 5 seconds
        this.chatPollInterval = setInterval(() => {
            this.loadChatMessages();
        }, 5000);
    }
    
    setupParticipantPolling() {
        // Poll for participant changes every 5 seconds
        this.participantPollInterval = setInterval(async () => {
            try {
                console.log("Polling for participants...");
                const db = firebase.firestore();
                const roomDoc = await db.collection('prayer_rooms').doc(this.roomId).get();
                if (roomDoc.exists) {
                    const data = roomDoc.data();
                    console.log("Polled room data:", data);
                    this.updateParticipants(data.participants || []);
                } else {
                    console.log("Room document not found during polling");
                }
            } catch (error) {
                console.error("Error polling for participants:", error);
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
        
        const bufferLength = this.audioAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        const checkVoiceActivity = () => {
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
        // Poll for WebRTC offers and answers every 2 seconds
        this.signalPollInterval = setInterval(() => {
            this.checkForWebRTCSignals();
        }, 2000);
    }

    async checkForWebRTCSignals() {
        try {
            if (!this.roomId) return;
            
            // Check for WebRTC offers
            const offersResponse = await fetch(`/api/prayer-room/room/${this.roomId}/webrtc-offers`);
            if (offersResponse.ok) {
                const offers = await offersResponse.json();
                for (const offer of offers) {
                    if (offer.to_user === this.userId) {
                        await this.handleWebRTCOffer(offer);
                    }
                }
            }
            
            // Check for WebRTC answers
            const answersResponse = await fetch(`/api/prayer-room/room/${this.roomId}/webrtc-answers`);
            if (answersResponse.ok) {
                const answers = await answersResponse.json();
                for (const answer of answers) {
                    if (answer.to_user === this.userId) {
                        await this.handleWebRTCAnswer(answer);
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
            
            // Create SimplePeer instance as initiator with improved configuration
            const peer = new SimplePeer({
                initiator: true, // We initiate the connection
                stream: this.localStream,
                trickle: false,
                // Add WebRTC configuration for better audio handling
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                },
                // Ensure audio tracks are properly handled
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
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
            
            console.log(`Sending WebRTC signal to ${participantId}:`, signalData.type);
            
            const signalType = signalData.type;
            const endpoint = signalType === 'offer' ? 'webrtc-offer' : 'webrtc-answer';
            
            const response = await fetch(`/api/prayer-room/room/${this.roomId}/${endpoint}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    to_user: participantId,
                    [signalType]: signalData
                })
            });
            
            if (response.ok) {
                console.log(`WebRTC ${signalType} sent successfully to ${participantId}`);
            } else {
                console.error(`Failed to send WebRTC ${signalType}:`, await response.text());
            }
            
        } catch (error) {
            console.error('Error sending WebRTC signal:', error);
        }
    }
    
    async handleWebRTCOffer(offer) {
        try {
            console.log('📡 Handling WebRTC offer from:', offer.from_user);
            
            // Create a new peer connection for this offer with improved configuration
            const peer = new SimplePeer({
                initiator: false,
                stream: this.localStream,
                trickle: false,
                // Add WebRTC configuration for better audio handling
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                },
                // Ensure audio tracks are properly handled
                offerToReceiveAudio: true,
                offerToReceiveVideo: false
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
            console.log('Handling WebRTC answer from:', answer.from_user);
            
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
        });
        
        // Handle connection errors
        peer.on('error', (err) => {
            console.error(`❌ Peer connection error with ${participantId}:`, err);
        });
        
        // Handle connection close
        peer.on('close', () => {
            console.log(`🔌 Peer connection closed with ${participantId}`);
            this.peers.delete(participantId);
        });
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
            
            // Create audio element for remote stream with improved settings
            const audioElement = document.createElement('audio');
            audioElement.srcObject = stream;
            audioElement.autoplay = true;
            audioElement.playsInline = true; // Important for mobile
            audioElement.id = `audio-${participantId}`;
            audioElement.volume = 0.8; // Set default volume
            audioElement.controls = false; // Hide controls
            audioElement.muted = false; // Ensure not muted
            
            // Add event listeners for debugging and handling
            audioElement.addEventListener('loadedmetadata', () => {
                console.log(`🎵 Audio metadata loaded for ${participantId}`);
                console.log(`🎵 Audio duration:`, audioElement.duration);
            });
            
            audioElement.addEventListener('canplay', () => {
                console.log(`🎵 Audio can play for ${participantId}`);
            });
            
            audioElement.addEventListener('play', () => {
                console.log(`🎵 Audio started playing for ${participantId}`);
            });
            
            audioElement.addEventListener('pause', () => {
                console.log(`🎵 Audio paused for ${participantId}`);
            });
            
            audioElement.addEventListener('error', (e) => {
                console.error(`🎵 Audio error for ${participantId}:`, e);
                console.error(`🎵 Audio error details:`, {
                    error: audioElement.error,
                    networkState: audioElement.networkState,
                    readyState: audioElement.readyState
                });
            });
            
            audioElement.addEventListener('volumechange', () => {
                console.log(`🎵 Volume changed for ${participantId}:`, audioElement.volume);
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
            
            // Try to play the audio with user interaction fallback
            const playAudio = async () => {
                try {
                    await audioElement.play();
                    console.log(`🎵 Audio playing successfully for ${participantId}`);
                } catch (error) {
                    console.error(`🎵 Failed to play audio for ${participantId}:`, error);
                    // If autoplay fails, try again after a short delay
                    setTimeout(() => {
                        audioElement.play().catch(e => {
                            console.error(`🎵 Retry play failed for ${participantId}:`, e);
                        });
                    }, 1000);
                }
            };
            
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

    // Method to handle audio autoplay issues
    async enableAudioPlayback() {
        try {
            // Create a temporary audio context to enable audio playback
            const tempAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            if (tempAudioContext.state === 'suspended') {
                await tempAudioContext.resume();
            }
            console.log('🔊 Audio playback enabled');
        } catch (error) {
            console.error('🔊 Error enabling audio playback:', error);
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
            const response = await fetch(`/api/prayer-room/${this.roomId}/participants`);
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


    // Host Controls for Managing Participants
    async muteParticipant(participantId) {
        try {
            if (!this.isHost) {
                console.warn('Only host can mute participants');
                return;
            }
            
            // Note: Host controls are now handled via API endpoints
            console.log('Muting participant via API endpoint (not implemented yet)');
                
        } catch (error) {
            console.error('Error muting participant:', error);
        }
    }

    async unmuteParticipant(participantId) {
        try {
            if (!this.isHost) {
                console.warn('Only host can unmute participants');
                return;
            }
            
            // Note: Host controls are now handled via API endpoints
            console.log('Unmuting participant via API endpoint (not implemented yet)');
                
        } catch (error) {
            console.error('Error unmuting participant:', error);
        }
    }

    async removeParticipant(participantId) {
        try {
            if (!this.isHost) {
                console.warn('Only host can remove participants');
                return;
            }
            
            // Note: Host controls are now handled via API endpoints
            console.log('Removing participant via API endpoint (not implemented yet)');
                
        } catch (error) {
            console.error('Error removing participant:', error);
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Extract room ID from URL and set it globally
    const urlParams = new URLSearchParams(window.location.search);
    window.roomId = urlParams.get('room');
    
    // Initialize prayer room service
    window.prayerRoomService = new PrayerRoomService();
});
