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
        this.webRTCInitialized = false;
        
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
        
        // Connection retry tracking
        this.connectionRetries = new Map(); // participantId -> retry count
        this.maxRetries = 3;
        this.retryDelay = 2000; // Start with 2 seconds
        
        // WebSocket for real-time communication
        this.socket = null;
        this.wsConnected = false;
        this.wsFallbackMode = false; // Use REST when WS fails
        
        // Firebase Realtime Database (RTDB) for near real-time signaling/chat
        this.rtdb = null;
        this.useRTDB = true; // Prefer RTDB over WebSocket; REST remains fallback
        this.rtdbRefs = {
            signalsRoot: null,
            mySignals: null,
            chat: null,
            presence: null
        };
        
        // Track initiator role per peer to gate answer handling
        // REMOVED: Replaced by deterministic initiator selection
        // this.peerInitiators = new Map();
        
        // Track last applied SDP per peer to dedupe duplicate answers
        // REMOVED: Simpler deduplication will be used
        // this.lastAppliedAnswer = new Map();
        this.pendingCandidates = new Map(); // Buffer candidates until connection is ready
        
        // Performance optimizations
        this.isPageVisible = true;
        this.pollingIntervals = new Map(); // Track all polling intervals
        this.chatVirtualization = {
            enabled: false,
            visibleStart: 0,
            visibleEnd: 50,
            itemHeight: 40
        };

        // Role & permissions
        this.participantRole = null;
        this.pendingSpeakerRequest = false;
        this.maxSpeakers = 20;
        this.currentSpeakerCount = 0;
        
        // Message reactions storage
        this.messageReactions = new Map();
        
        // @ Mentions state
        this.mentionState = {
            start: -1,
            query: '',
            selectedIndex: -1
        };
        
        this.init();
    }
    
    async getFirebaseIdToken(forceRefresh = false) {
        /**
         * Get Firebase ID token for authenticated requests
         * This ensures auth persists across deployments
         * 
         * @param {boolean} forceRefresh - Force token refresh (useful after 401 errors)
         */
        try {
            if (typeof firebase === 'undefined' || !firebase.auth) {
                console.warn('⚠️ Firebase not initialized');
                return null;
            }
            
            // Wait for Firebase auth state to be ready (increased timeout to 5 seconds)
            const user = await new Promise((resolve) => {
                let resolved = false;
                const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
                    if (!resolved) {
                        resolved = true;
                        unsubscribe();
                        resolve(user);
                    }
                });
                
                // Check if user is already available (faster path)
                const currentUser = firebase.auth().currentUser;
                if (currentUser && !resolved) {
                    resolved = true;
                    unsubscribe();
                    resolve(currentUser);
                }
                
                // Timeout after 5 seconds
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        unsubscribe();
                        console.warn('⚠️ Firebase auth state check timed out');
                        resolve(null);
                    }
                }, 5000);
            });
            
            if (!user) {
                console.warn('⚠️ No Firebase user found');
                return null;
            }
            
            // Get token with retry logic for network errors
            let token = null;
            let retries = 0;
            const maxRetries = 3;
            
            while (retries < maxRetries && !token) {
                try {
                    token = await Promise.race([
                        user.getIdToken(forceRefresh),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Token fetch timeout')), 5000)
                        )
                    ]);
                    break;
                } catch (error) {
                    retries++;
                    if (retries < maxRetries) {
                        console.warn(`⚠️ Token fetch failed (attempt ${retries}/${maxRetries}), retrying...`, error);
                        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
                    } else {
                        console.error('❌ Failed to get Firebase ID token after all retries:', error);
                        throw error;
                    }
                }
            }
            
            return token;
        } catch (error) {
            console.error('❌ Error getting Firebase ID token:', error);
            return null;
        }
    }

    async makeAuthenticatedRequest(url, options = {}) {
        /**
         * Make an authenticated request with automatic token refresh on 401
         * This prevents authentication failures after deployments
         * 
         * @param {string} url - The URL to request
         * @param {object} options - Fetch options (method, body, etc.)
         * @returns {object} - { success: boolean, data: object, error: string, needsLogin: boolean }
         */
        
        // Helper to make the actual request
        const makeRequest = async (idToken) => {
            const headers = {
                'Content-Type': 'application/json',
                ...options.headers
            };
            
            if (idToken) {
                headers['Authorization'] = `Bearer ${idToken}`;
            }
            
            return await fetch(url, {
                ...options,
                headers,
                credentials: 'include' // Always include session cookies
            });
        };
        
        try {
            // First attempt: Get token (cached)
            let idToken = await this.getFirebaseIdToken(false);
            let response = await makeRequest(idToken);
            
            // If 401, try refreshing the token
            if (response.status === 401) {
                console.log('⚠️ 401 error, attempting token refresh...');
                
                // Force refresh the Firebase token
                idToken = await this.getFirebaseIdToken(true);
                
                if (idToken) {
                    // Retry with fresh token
                    console.log('🔄 Retrying request with refreshed token...');
                    response = await makeRequest(idToken);
                    
                    if (response.status === 401) {
                        // Still 401 after refresh - user needs to login
                        console.log('❌ Still unauthorized after token refresh');
                        return { success: false, needsLogin: true };
                    }
                } else {
                    // No Firebase user - needs to login
                    console.log('❌ No Firebase user available for token refresh');
                    return { success: false, needsLogin: true };
                }
            }
            
            // Parse response
            const result = await response.json();
            
            if (response.ok) {
                return { success: true, data: result };
            } else {
                return { success: false, error: result.error || 'Unknown error' };
            }
            
        } catch (error) {
            console.error('❌ Request error:', error);
            return { success: false, error: error.message };
        }
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
            
            // Disable Socket.IO path; prefer RTDB + HTTP
            this.wsFallbackMode = true;
            
            // Initialize RTDB (if available) for signals/chat/presence
            // MOVED: This is now called from joinPrayerRoom() after userId is confirmed
            // await this.initializeRealtimeDB();
            
            // Set up performance optimizations
            this.setupPerformanceOptimizations();
            
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
        
        // Set up polling listeners (chat) – RTDB will override if available
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
        const requestSpeakerBtn = document.getElementById('requestSpeakerBtn');
        const participantsList = document.getElementById('participantsList');
        
        if (joinAudioBtn) {
            joinAudioBtn.addEventListener('click', () => this.joinAudio());
        }
        
        if (requestSpeakerBtn) {
            requestSpeakerBtn.addEventListener('click', () => this.toggleSpeakerRequest());
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
            chatSendBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Send button clicked');
                this.sendChatMessage();
            });
        } else {
            console.warn('Send button not found in DOM');
        }
        
        // Enhanced chat input setup with all features
        const chatInput = document.getElementById('chatInput');
        const chatInputCounter = document.getElementById('chatInputCounter');
        const emojiPickerBtn = document.getElementById('emojiPickerBtn');
        
        // Store functions for reuse
        const adjustHeight = () => {
            if (chatInput) {
                chatInput.style.height = 'auto';
                const newHeight = Math.min(chatInput.scrollHeight, 120);
                chatInput.style.height = newHeight + 'px';
            }
        };
        
        const updateCounter = () => {
            if (chatInputCounter && chatInput) {
                const length = chatInput.value.length;
                const maxLength = chatInput.maxLength || 1000;
                chatInputCounter.textContent = `${length}/${maxLength}`;
                
                chatInputCounter.className = 'chat-input-counter';
                if (length > maxLength * 0.9) {
                    chatInputCounter.classList.add('warning');
                }
                if (length >= maxLength) {
                    chatInputCounter.classList.add('error');
                }
            }
        };
        
        if (chatInput) {
            // Initial setup
            adjustHeight();
            updateCounter();
            
            // Enhanced keyboard handling for mobile
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.sendChatMessage();
                    adjustHeight();
                    updateCounter();
                    // Keep focus on input for quick typing
                    setTimeout(() => {
                        if (chatInput) chatInput.focus();
                    }, 50);
                }
            });
            
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            });
            
            // Auto-resize on input
            chatInput.addEventListener('input', () => {
                adjustHeight();
                updateCounter();
                
                // Auto-scroll when typing (with debounce)
                clearTimeout(this.chatScrollTimeout);
                this.chatScrollTimeout = setTimeout(() => {
                    scrollChatToBottom();
                }, 100);
            });
            
            // Enhanced focus handling for mobile
            chatInput.addEventListener('focus', () => {
                // Scroll chat to bottom when input is focused
                setTimeout(() => {
                    scrollChatToBottom();
                    // Ensure input is visible above keyboard
                    if (window.innerWidth <= 768) {
                        setTimeout(() => {
                            chatInput.scrollIntoView({ behavior: 'smooth', block: 'end' });
                        }, 300);
                    }
                }, 100);
            });
            
            // Improved blur handling
            chatInput.addEventListener('blur', () => {
                // Small delay to allow button clicks
                setTimeout(() => {
                    // Only remove focus class if not clicking send button
                    const sendBtn = document.getElementById('sendBtn');
                    if (!sendBtn || !sendBtn.matches(':active')) {
                        // Input lost focus naturally
                    }
                }, 100);
            });
            
            // Prevent zoom on iOS when focusing
            if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
                chatInput.addEventListener('touchstart', () => {
                    // Ensure font-size is 16px to prevent zoom
                    if (parseInt(window.getComputedStyle(chatInput).fontSize) < 16) {
                        chatInput.style.fontSize = '16px';
                    }
                });
            }
            
            // Long-press for message actions (will be added to message bubbles)
            this.setupLongPressActions();
        }
        
        // Emoji picker button
        if (emojiPickerBtn && chatInput) {
            emojiPickerBtn.addEventListener('click', () => {
                // Simple emoji picker - insert common emojis
                const emojis = ['🙏', '❤️', '✨', '💚', '🙌', '😊', '🎉', '🌟', '💫', '🔥'];
                const emoji = emojis[Math.floor(Math.random() * emojis.length)];
                const cursorPos = chatInput.selectionStart;
                const textBefore = chatInput.value.substring(0, cursorPos);
                const textAfter = chatInput.value.substring(cursorPos);
                chatInput.value = textBefore + emoji + textAfter;
                chatInput.focus();
                chatInput.setSelectionRange(cursorPos + emoji.length, cursorPos + emoji.length);
                adjustHeight();
                updateCounter();
                
                // Haptic feedback
                if (navigator.vibrate) {
                    navigator.vibrate(5);
                }
            });
        }
        
        // Pull-to-refresh setup
        this.setupPullToRefresh();
        
        // Typing indicator setup
        this.setupTypingIndicator();
        
        // @ Mentions setup
        this.setupMentions();
        
        // Initialize reactions
        this.initReactions();
        
        // Set up event delegation for participant action buttons (dynamically created)
        if (participantsList) {
            participantsList.addEventListener('click', (e) => {
                this.handleParticipantAction(e);
            });
        }
        
        // Set up request speaker button
        if (requestSpeakerBtn) {
            requestSpeakerBtn.addEventListener('click', () => {
                this.toggleSpeakerRequest();
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
            
            // Initialize RTDB now that we have a confirmed userId
            await this.initializeRealtimeDB();

            // Update UI to show user info
            this.updateUserInfo();
            
            // Join the room via API with authentication
            const joinData = {
                user_id: this.userId,
                user_name: this.userName
            };
            
            // Add room code for private rooms
            if (typeof window.roomCode !== 'undefined' && window.roomCode !== null) {
                joinData.room_code = String(window.roomCode).trim();
            }
            
            const result = await this.makeAuthenticatedRequest(`/api/prayer-room/join/${this.roomId}`, {
                method: 'POST',
                body: JSON.stringify(joinData)
            });
            
            if (!result.success) {
                if (result.needsLogin) {
                    this.showError('Please log in to join the prayer room. Redirecting to login...');
                    setTimeout(() => {
                        window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
                    }, 2000);
                    return;
                }
                throw new Error(result.error || 'Failed to join room');
            }
            
            const data = result.data;
            if (typeof data.max_speakers === 'number') {
                this.maxSpeakers = data.max_speakers;
            }
            
            // Update room info
            this.updateRoomInfo(data);
            
            // Load chat messages
            await this.loadChatMessages();

            // Initialize WebRTC signaling even if user hasn't joined audio yet
            this.initializeWebRTC().catch(err => {
                console.warn('WebRTC initialization warning:', err);
            });
            
        } catch (error) {
            console.error('Error joining room:', error);
            this.showError('Failed to join room: ' + error.message);
        }
    }
    
    updateRoomInfo(data) {
        if (typeof data.max_speakers === 'number') {
            this.maxSpeakers = data.max_speakers;
        }

        // Update room name
        const roomNameEl = document.querySelector('.prayer-room-title');
        if (roomNameEl) {
            const truncatedRoomName = this.truncateName(data.room_name || 'Prayer Room', 50);
            roomNameEl.textContent = truncatedRoomName;
            roomNameEl.title = data.room_name || 'Prayer Room'; // Show full name on hover
        }
        
        // Check if user is host
        this.isHost = data.host_id === this.userId;

        // Update participants
        this.updateParticipants(data.participants || []);
    }
    
    async loadParticipants() {
        try {
            // Background load (no visible loading text)
            
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
                
                if (typeof data.max_speakers === 'number') {
                    this.maxSpeakers = data.max_speakers;
                }

                this.updateParticipants(data.participants || []);
            } else {
                this.updateParticipants([]);
            }
            
            // Set up polling for real-time updates if Firestore listeners fail
            if (!this.participantPollingInterval) {
                this.participantPollingInterval = setInterval(() => {
                    this.loadParticipants();
                }, 1000); // Poll every 1 second for real-time updates
            }
            
        } catch (error) {
            if (error.name === 'AbortError') {
                console.warn('Participants request timed out, will retry...');
            } else {
                console.error('Error loading participants:', error);
            }
            // Ensure any transient indicators are cleared silently
            this.hideParticipantsLoading && this.hideParticipantsLoading();
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
    
    hideParticipantsLoading() {
        const participantsContainer = document.getElementById('participantsList');
        if (participantsContainer) {
            const loadingEl = participantsContainer.querySelector('.loading-participants');
            if (loadingEl) {
                loadingEl.remove();
            }
        }
    }

    async initializeRealtimeDB() {
        try {
            if (!this.useRTDB) return;
            
            // Critical validation: Ensure IDs are valid before building RTDB paths
            if (!this.roomId || typeof this.roomId !== 'string' || !this.roomId.trim()) {
                console.warn('⚠️ RTDB disabled: Invalid or missing roomId.');
                this.useRTDB = false;
                return;
            }
            if (!this.userId || typeof this.userId !== 'string' || !this.userId.trim()) {
                console.warn('⚠️ RTDB disabled: Invalid or missing userId.');
                this.useRTDB = false;
                return;
            }

            console.log('[RTDB] Checking Firebase RTDB availability...');
            console.log('[RTDB] firebase object:', typeof firebase);
            console.log('[RTDB] firebase.database:', typeof firebase.database);
            console.log('[RTDB] firebase.app():', firebase.app ? firebase.app() : 'not available');
            
            if (firebase.app && firebase.app()) {
                const app = firebase.app();
                console.log('[RTDB] Firebase app options:', app.options);
                console.log('[RTDB] databaseURL in config:', app.options.databaseURL);
            }
            
            if (!firebase.database || typeof firebase.database !== 'function') {
                console.error('❌ Firebase RTDB not available!');
                console.error('❌ firebase.database type:', typeof firebase.database);
                console.error('❌ Using REST polling (slower connections)');
                console.error('❌ Check that firebase-database-compat.js is loaded');
                this.rtdb = null;
                return;
            }
            
            console.log('🔥 Initializing Firebase Realtime Database for fast signaling...');
            this.rtdb = firebase.database();
            console.log('[RTDB] Database object created:', this.rtdb);
            console.log('[RTDB] Database ref method available:', typeof this.rtdb.ref);
            if (!this.roomId) return;
            
            // Prepare references
            this.rtdbRefs.signalsRoot = this.rtdb.ref(`/rooms/${this.roomId}/signals`);
            this.rtdbRefs.mySignals = this.rtdbRefs.signalsRoot.child(this.userId);
            this.rtdbRefs.chat = this.rtdb.ref(`/rooms/${this.roomId}/chat`);
            this.rtdbRefs.presence = this.rtdb.ref(`/rooms/${this.roomId}/presence/${this.userId}`);
            console.log(`[RTDB] My signals path: ${this.rtdbRefs.mySignals.toString()}`);
            
            // Presence (best-effort)
            const presencePayload = { uid: this.userId, online: true, ts: firebase.database.ServerValue.TIMESTAMP, name: this.userName || '' };
            this.rtdbRefs.presence.set(presencePayload).catch(() => {});
            if (this.rtdbRefs.presence.onDisconnect) {
                this.rtdbRefs.presence.onDisconnect().remove().catch(() => {});
            }
            
            // Attach listeners
            this.subscribeRTDBChat();
            this.subscribeRTDBSignals();
        } catch (e) {
            console.warn('Failed to initialize RTDB, falling back to HTTP:', e);
            this.rtdb = null;
        }
    }

    subscribeRTDBChat() {
        if (!this.rtdb || !this.rtdbRefs.chat) return;
        // Load recent and stream new messages
        this.rtdbRefs.chat.limitToLast(200).on('child_added', (snap) => {
            const val = snap.val();
            if (!val) return;
            
            const msgId = snap.key;
            const msgTimestamp = val.timestamp ? (typeof val.timestamp === 'number' ? val.timestamp : new Date(val.timestamp).getTime()) : Date.now();
            
            // Normalize to existing message structure
            const msg = {
                id: msgId,
                user_id: val.user_id,
                user_name: val.user_name,
                message: val.message,
                timestamp: msgTimestamp,
                status: 'sent'
            };
            
            // Check if we already have this message (optimistic update or duplicate)
            const existingIndex = this.chatMessages.findIndex(m => 
                (m.id === msgId) || 
                (m.tempId && m.user_id === msg.user_id && Math.abs((m.timestamp instanceof Date ? m.timestamp.getTime() : m.timestamp) - msgTimestamp) < 2000 && m.message === msg.message)
            );
            
            if (existingIndex !== -1) {
                // Update existing optimistic message with real data
                this.chatMessages[existingIndex] = {
                    ...this.chatMessages[existingIndex],
                    ...msg,
                    tempId: undefined
                };
            } else {
                // New message from another user
                this.chatMessages.push(msg);
            }
            
            this.updateChatDisplay();
        });
    }

    subscribeRTDBSignals() {
        if (!this.rtdb || !this.rtdbRefs.signalsRoot) return;
        if (!this.userId) return;
        console.log('[RTDB] Subscribing to signals...');
        const myPath = this.rtdbRefs.signalsRoot.child(this.userId);
        myPath.on('child_added', async (snap) => {
            console.log('[RTDB] Received a signal via child_added');
            const val = snap.val();
            if (!val || !val.type) return;
            try {
                if (val.type === 'offer') {
                    await this.handleWebRTCOffer({ from_user: val.from_user, offer: val.data });
                } else if (val.type === 'answer') {
                    await this.handleWebRTCAnswer({ from_user: val.from_user, answer: val.data });
                } else if (val.type === 'candidate') {
                    await this.handleWebRTCCandidate({ from_user: val.from_user, candidate: val.data });
                }
            } finally {
                // Clean up processed signal to prevent reprocessing
                myPath.child(snap.key).remove().catch(() => {});
            }
        });
    }

    // Utility function to truncate names
    truncateName(name, maxLength = 30) {
        if (!name) return 'Anonymous';
        if (name.length <= maxLength) return name;
        return name.substring(0, maxLength - 3) + '...';
    }

    updateParticipants(participants = []) {
        const participantsContainer = document.getElementById('participantsList');
        if (!participantsContainer) {
            return;
        }
        
        // Setup click-outside handler once (only for host)
        if (this.isHost && !this.participantClickOutsideHandler) {
            this.participantClickOutsideHandler = (e) => {
                // Don't close if clicking on participant card or controls
                const clickedParticipant = e.target.closest('.participant');
                const clickedControls = e.target.closest('.participant-controls');
                
                if (clickedParticipant || clickedControls) {
                    return;
                }
                
                // Close all expanded participants
                const expandedParticipants = participantsContainer.querySelectorAll('.participant.expanded');
                expandedParticipants.forEach(p => {
                    p.classList.remove('expanded');
                });
            };
            // Use capture phase to ensure it fires before other handlers
            document.addEventListener('click', this.participantClickOutsideHandler, true);
        }
        
        // Remove loading indicator
        this.hideParticipantsLoading();
        
        const participantList = Array.isArray(participants) ? participants : [];
        const currentParticipantIds = participantList.map(p => p.user_id);
        const existingPeerIds = Array.from(this.peers.keys());
        
        // 1. Clean up connections for participants who have left
        existingPeerIds.forEach(peerId => {
            if (!currentParticipantIds.includes(peerId)) {
                console.log(`🧹 Participant ${peerId} left, cleaning up peer connection`);
                this.cleanupPeerConnection(peerId);
            }
        });
        
        // 2. Create connections for new participants and update mute states for existing ones
        if (this.localStream && participantList.length) {
            participantList.forEach(participant => {
                const participantId = participant.user_id;
                
                // Update mute state for existing audio elements
                if (participantId !== this.userId) {
                    const audioElement = document.getElementById(`audio-${participantId}`);
                    if (audioElement) {
                        audioElement.muted = participant.is_muted || false;
                    }
                }
                
                // Don't connect to self or existing peers
                if (participantId !== this.userId && !this.peers.has(participantId)) {
                    // **Deterministic Initiator Logic**
                    // The user with the lexicographically smaller ID is the initiator.
                    const isInitiator = this.userId < participantId;
                    console.log(`[WebRTC] Evaluating connection with ${participantId}. Am I the initiator? ${isInitiator}`);
                    
                    if (isInitiator) {
                        console.log(`[WebRTC] I am the initiator for ${participantId}. Creating peer connection.`);
                        this.createPeerConnection(participantId, true); // true for initiator
                    } else {
                        console.log(`[WebRTC] I am not the initiator for ${participantId}. I will wait for an offer.`);
                    }
                }
            });
        }
        
        // 3. Track roles, speaker counts, and self state
        let speakerCount = 0;
        let myRole = this.participantRole || 'listener';
        let pendingRequest = this.pendingSpeakerRequest || false;
        
        participantList.forEach(participant => {
            const role = participant.role || 'listener';
            if (role === 'speaker') {
                speakerCount += 1;
            }
            
            if (participant.user_id === this.userId) {
                myRole = role;
                pendingRequest = participant.requested_role === 'speaker';
            }
        });
        
        this.participantRole = myRole;
        this.pendingSpeakerRequest = pendingRequest;
        this.currentSpeakerCount = speakerCount;
        
        if (this.participantRole !== 'speaker') {
            this.enforceListenerMute();
        }
        
        // 4. Render participants list
        participantsContainer.innerHTML = '';
        if (participantList.length > 0) {
            participantList.forEach(participant => {
                const participantRole = participant.role || 'listener';
                const requestedSpeaker = participant.requested_role === 'speaker';
                const participantEl = document.createElement('div');
                participantEl.className = `participant ${participantRole === 'speaker' ? 'role-speaker' : 'role-listener'}`;
                participantEl.setAttribute('data-user-id', participant.user_id);
                
                if (participant.is_speaking && !participant.is_muted && participantRole === 'speaker') {
                    participantEl.classList.add('speaking');
                }
                if (participant.is_muted) {
                    participantEl.classList.add('muted');
                }
                if (requestedSpeaker) {
                    participantEl.classList.add('requested-speaker');
                }
                
                const truncatedName = this.truncateName(participant.user_name);
                const badges = [];
                badges.push(participantRole === 'speaker'
                    ? '<span class="role-badge speaker">Speaker</span>'
                    : '<span class="role-badge listener">Listener</span>');
                
                if (participant.is_host) {
                    badges.push('<span class="host-badge">Host</span>');
                }
                if (requestedSpeaker) {
                    badges.push('<span class="request-badge">Requested</span>');
                }
                if (participant.is_speaking && !participant.is_muted && participantRole === 'speaker') {
                    badges.push('<span class="speaking-indicator">Speaking</span>');
                }
                if (participant.is_muted) {
                    badges.push('<span class="mute-indicator">Muted</span>');
                }
                
                const controls = [];
                if (this.isHost && !participant.is_host) {
                    if (participantRole === 'speaker') {
                        controls.push(`<button class="participant-action stage-btn" data-action="demote" data-user-id="${participant.user_id}">Make Listener</button>`);
                    } else {
                        controls.push(`<button class="participant-action stage-btn" data-action="promote" data-user-id="${participant.user_id}">Make Speaker</button>`);
                    }
                    
                    controls.push(`<button class="participant-action mute-toggle" data-action="mute-toggle" data-user-id="${participant.user_id}">${participant.is_muted ? 'Unmute' : 'Mute'}</button>`);
                    controls.push(`<button class="participant-action remove-btn" data-action="remove" data-user-id="${participant.user_id}">Remove</button>`);
                } else if (participant.user_id === this.userId && participantRole === 'speaker' && !participant.is_host) {
                    controls.push(`<button class="participant-action stage-btn" data-action="demote-self" data-user-id="${participant.user_id}">Leave Stage</button>`);
                }
                
                // Pill layout: avatar + name + roles in one row
                const infoRow = `<div class="participant-info-row">
                    <div class="participant-avatar">
                        ${truncatedName.charAt(0).toUpperCase()}
                    </div>
                    <div class="participant-details">
                        <div class="participant-name" title="${participant.user_name}">
                            ${truncatedName}
                        </div>
                        <div class="participant-status">
                            ${badges.join(' ')}
                        </div>
                    </div>
                </div>`;
                
                participantEl.innerHTML = `
                    ${infoRow}
                    ${controls.length ? `<div class="participant-controls">${controls.join('')}</div>` : ''}
                `;
                
                // Add click handler for expand/collapse (only for host)
                if (this.isHost && controls.length > 0) {
                    // Use a flag to prevent double-firing
                    let isToggling = false;
                    
                    participantEl.addEventListener('click', (e) => {
                        // Don't toggle if clicking on controls or action buttons
                        if (e.target.closest('.participant-controls') || e.target.closest('.participant-action')) {
                            return;
                        }
                        
                        // Prevent double-firing
                        if (isToggling) return;
                        isToggling = true;
                        
                        // Stop event propagation to prevent click-outside handler from firing immediately
                        e.stopPropagation();
                        
                        // Use setTimeout to allow the toggle to complete before click-outside handler can interfere
                        setTimeout(() => {
                            // Close other expanded participants
                            const allParticipants = participantsContainer.querySelectorAll('.participant.expanded');
                            allParticipants.forEach(p => {
                                if (p !== participantEl) {
                                    p.classList.remove('expanded');
                                }
                            });
                            
                            // Toggle this participant
                            const isCurrentlyExpanded = participantEl.classList.contains('expanded');
                            if (isCurrentlyExpanded) {
                                participantEl.classList.remove('expanded');
                            } else {
                                participantEl.classList.add('expanded');
                            }
                            
                            isToggling = false;
                        }, 0);
                    });
                }
                
                participantsContainer.appendChild(participantEl);
            });
            
            // Scroll to bottom to show latest participants (with justify-content: flex-end, this shows newest at bottom)
            requestAnimationFrame(() => {
                participantsContainer.scrollTop = participantsContainer.scrollHeight;
            });
        } else {
            participantsContainer.innerHTML = '<div class="no-participants">No participants yet</div>';
        }
        
        // Update participant count
        const participantCountText = document.getElementById('participantCountText');
        if (participantCountText) {
            const count = participantList.length;
            participantCountText.textContent = count === 1 ? '1 participant' : `${count} participants`;
        }
        
        this.updateSpeakerSlotDisplay();
        this.updateAudioControls();
        this.updateRoleUI();
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
            
            // Request microphone permission with enhanced noise suppression
            console.log('🎤 Requesting microphone permission...');
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    // Core audio processing - these are critical for quality
                    echoCancellation: true,        // Required: Remove echo
                    noiseSuppression: true,        // Required: Remove background noise
                    autoGainControl: true,         // Required: Normalize volume levels
                    
                    // Audio quality settings
                    sampleRate: { ideal: 48000 },  // Higher sample rate for better quality
                    channelCount: 1,               // Mono is sufficient for voice
                    
                    // Latency optimization
                    latency: { ideal: 0.01 },      // 10ms latency target
                    
                    // Google-specific enhanced audio processing (Chrome/Edge)
                    googEchoCancellation: true,
                    googAutoGainControl: true,
                    googNoiseSuppression: true,
                    googHighpassFilter: true,       // Remove low-frequency noise
                    googTypingNoiseDetection: true, // Detect and suppress typing
                    googAudioMirroring: false,
                    googDAEchoCancellation: true,   // Domain-specific echo cancellation
                    googNoiseReduction: true        // Additional noise reduction
                },
                video: false
            });
            
            console.log('🎤 Microphone permission granted, stream obtained:', this.localStream);
            
            // Quick validation
            if (!this.localStream || !this.localStream.active) {
                throw new Error('Invalid audio stream from microphone');
            }
            
            // Monitor local audio track for mute/unmute events
            const localTrack = this.localStream.getAudioTracks()[0];
            if (localTrack) {
                console.log('🎤 Local audio track:', {
                    id: localTrack.id,
                    label: localTrack.label,
                    enabled: localTrack.enabled,
                    muted: localTrack.muted,
                    readyState: localTrack.readyState
                });
                
                localTrack.addEventListener('unmute', () => {
                    console.log('✅ Your microphone is now producing audio');
                });
                
                localTrack.addEventListener('mute', () => {
                    console.warn('⚠️ Your microphone stopped producing audio (track.muted = true)');
                    this.showError('Your microphone stopped working. Check if another app is using it.');
                });
                
                if (localTrack.muted) {
                    console.error('❌ Your microphone track is muted! It won\'t send audio.');
                    this.showError('Microphone not working. Close other apps using the mic and refresh.');
                }
            }
            
            // Start lightweight initialization immediately
            console.log('🎤 Starting fast initialization...');
            
            // Enable audio playback (non-blocking)
            this.enableAudioPlayback().catch(error => {
                console.warn('⚠️ Audio playback initialization failed:', error);
            });
            
            // Initialize WebRTC first (most critical for voice)
            await this.loadIceConfig();
            this.initializeWebRTC().then(() => {
                console.log('🎤 WebRTC initialized successfully');
                
                // Add stream to any existing peer connections that were created before audio was joined
                this.addStreamToExistingPeers();
                
                // If there was a pending offer, handle it now that the stream is ready
                if (this.pendingOffer) {
                    console.log('[WebRTC] Handling pending offer...');
                    this.handleWebRTCOffer(this.pendingOffer);
                    this.pendingOffer = null; // Clear the pending offer
                }

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
            muteBtn: !!muteBtn,
            participantRole: this.participantRole
        });
        
        if (!joinAudioBtn || !muteBtn) {
            return;
        }

        if (this.participantRole !== 'speaker') {
            // Listeners always see the join button; mute control hidden
            joinAudioBtn.style.display = 'flex';
            muteBtn.style.display = 'none';
            return;
        }
        
        if (this.isAudioEnabled) {
            // Show mute button, hide join audio button
            joinAudioBtn.style.display = 'none';
            muteBtn.style.display = 'flex';
            
            // Update mute button state
            if (this.isMuted) {
                muteBtn.classList.add('muted');
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

        this.updateRoleUI();
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
        
        // Haptic feedback
        if (navigator.vibrate) {
            navigator.vibrate(10);
        }
        
        // Clear input immediately
        chatInput.value = '';
        this.adjustInputHeight(chatInput);
        
        // Create optimistic message
        const tempId = 'temp_' + Date.now();
        const user = firebase.auth().currentUser;
        const optimisticMessage = {
            tempId: tempId,
            user_id: user ? user.uid : this.userId,
            user_name: this.userName || (user && user.displayName) || 'Anonymous',
            message: message,
            timestamp: Date.now(),
            status: 'sending'
        };
        
        // Add optimistic message immediately
        if (!this.chatMessages) {
            this.chatMessages = [];
        }
        this.chatMessages.push(optimisticMessage);
        this.updateChatDisplay();
        
        try {
            // Prefer RTDB if available
            if (this.useRTDB && this.rtdb && this.rtdbRefs.chat) {
                const messageRef = this.rtdbRefs.chat.push({
                    user_id: user ? user.uid : this.userId,
                    user_name: this.userName || (user && user.displayName) || 'Anonymous',
                    message,
                    timestamp: firebase.database.ServerValue.TIMESTAMP
                });
                
                // Update optimistic message with real ID and status
                const optimisticIndex = this.chatMessages.findIndex(m => m.tempId === tempId);
                if (optimisticIndex !== -1) {
                    this.chatMessages[optimisticIndex] = {
                        ...this.chatMessages[optimisticIndex],
                        id: messageRef.key,
                        status: 'sent',
                        tempId: undefined
                    };
                    this.updateChatDisplay();
                }
                
                console.log('Chat message sent via RTDB');
                return;
            }
            
            // REST fallback
            const response = await fetch(`/api/prayer-room/${this.roomId}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    message: message
                })
            });
            
            const data = await response.json();
            if (data.success) {
                // Update optimistic message status
                const optimisticIndex = this.chatMessages.findIndex(m => m.tempId === tempId);
                if (optimisticIndex !== -1) {
                    this.chatMessages[optimisticIndex] = {
                        ...this.chatMessages[optimisticIndex],
                        id: data.message_id || tempId,
                        status: 'sent',
                        tempId: undefined
                    };
                    this.updateChatDisplay();
                }
                // Message will be updated via real-time listener
            } else {
                // Remove failed message
                this.chatMessages = this.chatMessages.filter(m => m.tempId !== tempId);
                this.updateChatDisplay();
                this.showErrorMessage('Failed to send message. Please try again.');
            }
            
        } catch (error) {
            console.error('Error sending chat message:', error);
            // Remove failed optimistic message
            this.chatMessages = this.chatMessages.filter(m => m.tempId !== tempId);
            this.updateChatDisplay();
            this.showErrorMessage('Failed to send message. Please check your connection.');
        }
    }
    
    adjustInputHeight(input) {
        if (!input) {
            input = document.getElementById('chatInput');
        }
        if (!input) return;
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    }
    
    showErrorMessage(message) {
        // Simple toast notification
        const toast = document.createElement('div');
        toast.style.cssText = 'position: fixed; top: 80px; left: 50%; transform: translateX(-50%); background: #ef4444; color: white; padding: 12px 20px; border-radius: 8px; z-index: 10000; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    
    async loadChatMessages() {
        // Show loading skeletons on first load
        if (!this.chatMessages || this.chatMessages.length === 0) {
            this.showLoadingSkeletons(3);
        }
        
        // Preserve optimistic messages
        const optimisticMessages = (this.chatMessages || []).filter(m => m.tempId);
        
        try {
            const response = await fetch(`/api/prayer-room/${this.roomId}/chat`, {
                credentials: 'include'
            });
            if (!response.ok) {
                console.warn('Chat fetch not ok, preserving current messages');
                return; // keep current UI on transient HTTP errors
            }
            const data = await response.json();
            
            console.log('Chat messages loaded:', data);
            
            if (data && data.success && Array.isArray(data.messages)) {
                // Merge server messages with optimistic messages, avoiding duplicates
                const serverMessages = data.messages.map(msg => ({
                    id: msg.id || msg.message_id,
                    user_id: msg.user_id,
                    user_name: msg.user_name,
                    message: msg.message,
                    timestamp: msg.timestamp ? (typeof msg.timestamp === 'number' ? msg.timestamp : new Date(msg.timestamp).getTime()) : Date.now(),
                    message_type: msg.message_type,
                    status: 'sent'
                }));
                
                // Merge: keep optimistic messages, add server messages that don't exist
                const mergedMessages = [...optimisticMessages];
                serverMessages.forEach(serverMsg => {
                    const exists = mergedMessages.some(m => 
                        (m.id === serverMsg.id) || 
                        (m.tempId && m.user_id === serverMsg.user_id && Math.abs((m.timestamp instanceof Date ? m.timestamp.getTime() : (typeof m.timestamp === 'number' ? m.timestamp : new Date(m.timestamp).getTime())) - serverMsg.timestamp) < 2000 && m.message === serverMsg.message)
                    );
                    if (!exists) {
                        mergedMessages.push(serverMsg);
                    }
                });
                
                this.chatMessages = mergedMessages;
                console.log('Chat messages array:', this.chatMessages);
                this.updateChatDisplay();
            } else {
                console.warn('Chat payload invalid or unsuccessful, preserving current messages');
                // Do not clear UI on bad payloads - keep optimistic messages
                if (optimisticMessages.length > 0) {
                    this.chatMessages = optimisticMessages;
                    this.updateChatDisplay();
                }
            }
            
        } catch (error) {
            console.warn('Chat load error, preserving current messages:', error);
            // Do not clear UI on errors
        }
        
        // Polling is managed centrally by setupChatPolling via addPollingInterval('chat', ...)
    }
    
    updateChatDisplay() {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) {
            console.error('Chat messages container not found in updateChatDisplay');
            return;
        }
        
        console.log('Updating chat display with messages:', this.chatMessages ? this.chatMessages.length : 0);
        
        // Clear loading skeletons
        const skeletons = chatMessages.querySelectorAll('.message-skeleton');
        skeletons.forEach(s => s.remove());
        
        // Signal that we're updating to prevent MutationObserver interference
        if (typeof window.chatUpdateInProgress === 'function') {
            window.chatUpdateInProgress();
        }
        
        chatMessages.innerHTML = '';
        
        if (this.chatMessages && this.chatMessages.length > 0) {
            console.log('Rendering chat messages...');
            
            // Sort messages by timestamp to ensure correct order
            const sortedMessages = [...this.chatMessages].sort((a, b) => {
                const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : (typeof a.timestamp === 'number' ? a.timestamp : new Date(a.timestamp).getTime());
                const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : (typeof b.timestamp === 'number' ? b.timestamp : new Date(b.timestamp).getTime());
                return timeA - timeB;
            });
            
            // Group messages by date and sender
            const groupedMessages = this.groupMessagesByDateAndSender(sortedMessages);
            
            groupedMessages.forEach((group, groupIndex) => {
                // Add date divider if needed
                if (group.dateDivider) {
                    const dateDivider = document.createElement('div');
                    dateDivider.className = 'date-divider';
                    dateDivider.innerHTML = `
                        <div class="date-divider-line"></div>
                        <div class="date-divider-text">${group.dateDivider}</div>
                        <div class="date-divider-line"></div>
                    `;
                    chatMessages.appendChild(dateDivider);
                }
                
                // Create message group container
                const messageGroup = document.createElement('div');
                messageGroup.className = 'message-group';
                
                group.messages.forEach((message, msgIndex) => {
                    const messageEl = document.createElement('div');
                    
                    // Check if it's a system notification
                    if (message.message_type === 'system_notification') {
                        messageEl.className = 'message system-notification';
                        messageEl.innerHTML = `
                            <div class="message-bubble">
                                <div class="system-message">
                                    <div class="system-icon">⚠️</div>
                                    <div class="system-text">${this.escapeHtml(message.message)}</div>
                                </div>
                            </div>
                        `;
                        chatMessages.appendChild(messageEl);
                        return;
                    }
                    
                    // Check if this is the current user's message
                    const isOwnMessage = message.user_id === this.userId;
                    messageEl.className = `message ${isOwnMessage ? 'message-own' : 'message-other'}`;
                    
                    // Format timestamp
                    const messageDate = new Date(message.timestamp);
                    const timeString = messageDate.toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true
                    });
                    
                    // Get message status
                    const status = message.status || (message.tempId ? 'sending' : 'sent');
                    const statusIcon = this.getMessageStatusIcon(status, isOwnMessage);
                    
                    // Check if should show sender name (first message in group)
                    const showSender = msgIndex === 0;
                    
                    // Get message ID for reactions
                    const messageId = message.id || message.tempId || `msg_${groupIndex}_${msgIndex}_${Date.now()}`;
                    messageEl.dataset.messageId = messageId;
                    
                    // Get reactions for this message
                    const reactions = this.getMessageReactions(messageId);
                    const reactionsHtml = this.renderReactions(messageId, reactions, isOwnMessage);
                    
                    // Process message content for mentions
                    const processedContent = this.processMentions(message.message);
                    
                    messageEl.innerHTML = `
                        <div class="message-bubble">
                            ${!isOwnMessage && showSender ? `<div class="message-sender">${this.escapeHtml(message.user_name)}</div>` : ''}
                            <div class="message-content">${processedContent}</div>
                            ${reactionsHtml}
                            <div class="message-time">
                                ${timeString}
                                ${isOwnMessage ? `<span class="message-status ${status}">${statusIcon}</span>` : ''}
                            </div>
                        </div>
                    `;
                    
                    // Add reaction click handlers
                    messageEl.querySelectorAll('.message-reaction').forEach(reactionEl => {
                        reactionEl.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const emoji = reactionEl.dataset.emoji;
                            this.toggleReaction(messageId, emoji);
                        });
                    });
                    
                    // Add long-press/touch for reaction picker
                    const messageBubble = messageEl.querySelector('.message-bubble');
                    
                    // Desktop: right-click
                    messageBubble.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        this.showReactionPicker(messageEl, e);
                    });
                    
                    // Mobile: long-press
                    let longPressTimer = null;
                    messageBubble.addEventListener('touchstart', (e) => {
                        longPressTimer = setTimeout(() => {
                            e.preventDefault();
                            this.showReactionPicker(messageEl, e);
                            if (navigator.vibrate) {
                                navigator.vibrate(50);
                            }
                        }, 500);
                    });
                    
                    messageBubble.addEventListener('touchend', () => {
                        if (longPressTimer) {
                            clearTimeout(longPressTimer);
                            longPressTimer = null;
                        }
                    });
                    
                    messageBubble.addEventListener('touchmove', () => {
                        if (longPressTimer) {
                            clearTimeout(longPressTimer);
                            longPressTimer = null;
                        }
                    });
                    
                    messageGroup.appendChild(messageEl);
                });
                
                chatMessages.appendChild(messageGroup);
            });
            
            console.log('Chat messages rendered successfully');
        } else {
            console.log('No chat messages - chat container is empty');
            // Don't show empty state - just leave it empty
        }
        
        // Scroll to bottom after rendering
        requestAnimationFrame(() => {
            setTimeout(() => {
                scrollChatToBottom();
            }, 50);
        });
    }
    
    groupMessagesByDateAndSender(messages) {
        if (!messages || messages.length === 0) return [];
        
        const groups = [];
        let currentGroup = null;
        let lastDate = null;
        let lastSenderId = null;
        
        messages.forEach((message, index) => {
            const messageDate = new Date(message.timestamp);
            const dateKey = messageDate.toDateString();
            const isNewDate = lastDate !== dateKey;
            const isNewSender = lastSenderId !== message.user_id;
            
            // Add date divider if new date
            if (isNewDate) {
                const dateLabel = this.formatDateLabel(messageDate);
                // Push previous group if exists
                if (currentGroup && currentGroup.messages.length > 0) {
                    groups.push(currentGroup);
                }
                // Start new group with date divider
                currentGroup = {
                    dateDivider: dateLabel,
                    messages: []
                };
                lastDate = dateKey;
                lastSenderId = null; // Reset sender when new date
            } else if (!currentGroup) {
                // First message, no date divider needed
                currentGroup = { messages: [] };
            }
            
            // Start new message group if new sender (within same date)
            if (isNewSender && !isNewDate) {
                if (currentGroup && currentGroup.messages.length > 0) {
                    groups.push(currentGroup);
                }
                currentGroup = {
                    messages: []
                };
            }
            
            currentGroup.messages.push(message);
            lastSenderId = message.user_id;
        });
        
        // Push final group
        if (currentGroup && currentGroup.messages.length > 0) {
            groups.push(currentGroup);
        }
        
        return groups;
    }
    
    formatDateLabel(date) {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        if (date.toDateString() === today.toDateString()) {
            return 'Today';
        } else if (date.toDateString() === yesterday.toDateString()) {
            return 'Yesterday';
        } else {
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
        }
    }
    
    getMessageStatusIcon(status, isOwnMessage) {
        if (!isOwnMessage) return '';
        
        switch (status) {
            case 'sending':
                return '<svg class="message-status-icon" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="1.5"/></svg>';
            case 'sent':
                return '<svg class="message-status-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>';
            case 'delivered':
                return '<svg class="message-status-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>';
            case 'read':
                return '<svg class="message-status-icon" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>';
            default:
                return '';
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    showLoadingSkeletons(count = 3) {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;
        
        // Clear existing content
        chatMessages.innerHTML = '';
        
        for (let i = 0; i < count; i++) {
            const skeleton = document.createElement('div');
            skeleton.className = 'message-skeleton';
            skeleton.innerHTML = `
                <div class="message-skeleton-avatar"></div>
                <div class="message-skeleton-content">
                    <div class="message-skeleton-line"></div>
                    <div class="message-skeleton-line"></div>
                    <div class="message-skeleton-line"></div>
                </div>
            `;
            chatMessages.appendChild(skeleton);
        }
    }
    
    setupLongPressActions() {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;
        
        let longPressTimer = null;
        let longPressTarget = null;
        
        const handleLongPress = (e) => {
            const messageBubble = e.target.closest('.message-bubble');
            if (!messageBubble) return;
            
            const messageEl = e.target.closest('.message');
            if (!messageEl) return;
            
            longPressTarget = messageEl;
            longPressTimer = setTimeout(() => {
                this.showMessageContextMenu(messageEl, e);
                if (navigator.vibrate) {
                    navigator.vibrate(50);
                }
            }, 500);
        };
        
        const cancelLongPress = () => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
            longPressTarget = null;
        };
        
        chatMessages.addEventListener('touchstart', handleLongPress);
        chatMessages.addEventListener('touchend', cancelLongPress);
        chatMessages.addEventListener('touchmove', cancelLongPress);
        chatMessages.addEventListener('mousedown', handleLongPress);
        chatMessages.addEventListener('mouseup', cancelLongPress);
        chatMessages.addEventListener('mouseleave', cancelLongPress);
    }
    
    showMessageContextMenu(messageEl, event) {
        // Remove existing menu
        const existingMenu = document.querySelector('.message-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }
        
        const isOwnMessage = messageEl.classList.contains('message-own');
        const menu = document.createElement('div');
        menu.className = 'message-context-menu';
        
        menu.innerHTML = `
            <div class="message-context-menu-item" data-action="copy">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                Copy
            </div>
            ${isOwnMessage ? `
            <div class="message-context-menu-item danger" data-action="delete">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                Delete
            </div>
            ` : ''}
        `;
        
        // Position menu
        const rect = messageEl.getBoundingClientRect();
        menu.style.left = `${rect.left}px`;
        menu.style.top = `${rect.top - 10}px`;
        
        document.body.appendChild(menu);
        
        // Handle menu actions
        menu.querySelectorAll('.message-context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                
                if (action === 'copy') {
                    const messageContent = messageEl.querySelector('.message-content')?.textContent || '';
                    navigator.clipboard.writeText(messageContent).then(() => {
                        this.showSuccessMessage('Message copied!');
                    });
                } else if (action === 'delete') {
                    // TODO: Implement delete message
                    this.showSuccessMessage('Delete feature coming soon!');
                }
                
                menu.remove();
            });
        });
        
        // Close menu on outside click
        setTimeout(() => {
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }, { once: true });
        }, 100);
    }
    
    setupPullToRefresh() {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;
        
        let startY = 0;
        let isPulling = false;
        let pullDistance = 0;
        
        const pullToRefresh = document.createElement('div');
        pullToRefresh.className = 'pull-to-refresh';
        pullToRefresh.innerHTML = `
            <svg class="pull-to-refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            <div class="pull-to-refresh-text">Pull to refresh</div>
        `;
        chatMessages.insertBefore(pullToRefresh, chatMessages.firstChild);
        
        chatMessages.addEventListener('touchstart', (e) => {
            if (chatMessages.scrollTop === 0) {
                startY = e.touches[0].clientY;
                isPulling = true;
            }
        });
        
        chatMessages.addEventListener('touchmove', (e) => {
            if (!isPulling) return;
            
            const currentY = e.touches[0].clientY;
            pullDistance = currentY - startY;
            
            if (pullDistance > 0 && chatMessages.scrollTop === 0) {
                e.preventDefault();
                if (pullDistance > 60) {
                    pullToRefresh.classList.add('active');
                } else {
                    pullToRefresh.classList.remove('active');
                }
            }
        });
        
        chatMessages.addEventListener('touchend', () => {
            if (isPulling && pullDistance > 60) {
                pullToRefresh.classList.add('active');
                this.loadChatMessages();
                setTimeout(() => {
                    pullToRefresh.classList.remove('active');
                }, 1000);
            }
            isPulling = false;
            pullDistance = 0;
        });
    }
    
    setupTypingIndicator() {
        // Typing indicator will be shown when RTDB detects typing events
        // For now, we'll add a simple implementation
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;
        
        // This will be enhanced when RTDB typing events are implemented
        this.typingUsers = new Set();
    }
    
    showTypingIndicator(userName) {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;
        
        // Remove existing typing indicator
        const existing = chatMessages.querySelector('.typing-indicator');
        if (existing) {
            existing.remove();
        }
        
        const typingEl = document.createElement('div');
        typingEl.className = 'typing-indicator';
        typingEl.innerHTML = `
            <div class="typing-indicator-bubble">
                <span class="typing-indicator-text">${this.escapeHtml(userName)} is typing</span>
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        `;
        
        chatMessages.appendChild(typingEl);
        scrollChatToBottom();
    }
    
    hideTypingIndicator() {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;
        
        const typingEl = chatMessages.querySelector('.typing-indicator');
        if (typingEl) {
            typingEl.remove();
        }
    }
    
    showSuccessMessage(message) {
        const toast = document.createElement('div');
        toast.style.cssText = 'position: fixed; top: 80px; left: 50%; transform: translateX(-50%); background: #10b981; color: white; padding: 12px 20px; border-radius: 8px; z-index: 10000; font-size: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }
    
    // ===== MESSAGE REACTIONS =====
    initReactions() {
        // Initialize reactions storage (in-memory, can be enhanced with backend)
        if (!this.messageReactions) {
            this.messageReactions = new Map();
        }
    }
    
    getMessageReactions(messageId) {
        if (!this.messageReactions) {
            this.initReactions();
        }
        return this.messageReactions.get(messageId) || {};
    }
    
    toggleReaction(messageId, emoji) {
        if (!this.messageReactions) {
            this.initReactions();
        }
        
        const reactions = this.getMessageReactions(messageId);
        if (!reactions[emoji]) {
            reactions[emoji] = [];
        }
        
        const userId = this.userId;
        const userIndex = reactions[emoji].indexOf(userId);
        
        if (userIndex > -1) {
            // Remove reaction
            reactions[emoji].splice(userIndex, 1);
            if (reactions[emoji].length === 0) {
                delete reactions[emoji];
            }
        } else {
            // Add reaction
            reactions[emoji].push(userId);
        }
        
        this.messageReactions.set(messageId, reactions);
        this.updateChatDisplay();
        
        // Haptic feedback
        if (navigator.vibrate) {
            navigator.vibrate(10);
        }
    }
    
    renderReactions(messageId, reactions, isOwnMessage) {
        const reactionEmojis = Object.keys(reactions);
        if (reactionEmojis.length === 0) {
            return '';
        }
        
        const reactionsHtml = reactionEmojis.map(emoji => {
            const userIds = reactions[emoji];
            const count = userIds.length;
            const hasUserReaction = userIds.includes(this.userId);
            
            return `
                <div class="message-reaction ${hasUserReaction ? 'own-reaction' : ''}" data-emoji="${emoji}">
                    <span class="message-reaction-emoji">${emoji}</span>
                    <span class="message-reaction-count">${count}</span>
                </div>
            `;
        }).join('');
        
        return `<div class="message-reactions">${reactionsHtml}</div>`;
    }
    
    showReactionPicker(messageEl, event) {
        // Remove existing picker
        const existingPicker = document.querySelector('.message-reaction-picker');
        if (existingPicker) {
            existingPicker.remove();
        }
        
        const messageBubble = messageEl.querySelector('.message-bubble');
        const picker = document.createElement('div');
        picker.className = 'message-reaction-picker';
        
        const reactions = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '✨'];
        picker.innerHTML = reactions.map(emoji => 
            `<button class="reaction-picker-btn" data-emoji="${emoji}">${emoji}</button>`
        ).join('');
        
        // Position picker
        const rect = messageBubble.getBoundingClientRect();
        picker.style.left = `${rect.left}px`;
        picker.style.bottom = `${window.innerHeight - rect.top + 8}px`;
        
        document.body.appendChild(picker);
        
        // Handle reaction selection
        picker.querySelectorAll('.reaction-picker-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const emoji = btn.dataset.emoji;
                const messageId = messageEl.dataset.messageId;
                this.toggleReaction(messageId, emoji);
                picker.remove();
                
                // Haptic feedback
                if (navigator.vibrate) {
                    navigator.vibrate(10);
                }
            });
        });
        
        // Close picker on outside click
        setTimeout(() => {
            document.addEventListener('click', function closePicker() {
                picker.remove();
                document.removeEventListener('click', closePicker);
            }, { once: true });
        }, 100);
    }
    
    // ===== @ MENTIONS =====
    setupMentions() {
        const chatInput = document.getElementById('chatInput');
        const mentionAutocomplete = document.getElementById('mentionAutocomplete');
        
        if (!chatInput || !mentionAutocomplete) return;
        
        chatInput.addEventListener('input', (e) => {
            const value = chatInput.value;
            const cursorPos = chatInput.selectionStart;
            
            // Find @ symbol before cursor
            const textBeforeCursor = value.substring(0, cursorPos);
            const lastAtIndex = textBeforeCursor.lastIndexOf('@');
            
            if (lastAtIndex !== -1) {
                // Check if there's a space after @ (meaning mention is complete)
                const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
                if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
                    this.mentionState.start = lastAtIndex;
                    this.mentionState.query = textAfterAt.toLowerCase();
                    
                    // Show autocomplete
                    this.showMentionAutocomplete(this.mentionState.query, this.mentionState.start);
                    this.mentionState.selectedIndex = -1;
                    return;
                }
            }
            
            // Hide autocomplete
            mentionAutocomplete.classList.remove('active');
            this.mentionState.start = -1;
            this.mentionState.query = '';
        });
        
        chatInput.addEventListener('keydown', (e) => {
            if (!mentionAutocomplete.classList.contains('active')) return;
            
            const items = mentionAutocomplete.querySelectorAll('.mention-autocomplete-item');
            if (items.length === 0) return;
            
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                this.mentionState.selectedIndex = Math.min(this.mentionState.selectedIndex + 1, items.length - 1);
                this.updateMentionSelection(items, this.mentionState.selectedIndex);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                this.mentionState.selectedIndex = Math.max(this.mentionState.selectedIndex - 1, -1);
                this.updateMentionSelection(items, this.mentionState.selectedIndex);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                if (this.mentionState.selectedIndex >= 0 && items[this.mentionState.selectedIndex]) {
                    items[this.mentionState.selectedIndex].click();
                }
            } else if (e.key === 'Escape') {
                mentionAutocomplete.classList.remove('active');
            }
        });
        
        // Close autocomplete on blur (with delay to allow clicks)
        chatInput.addEventListener('blur', () => {
            setTimeout(() => {
                if (document.activeElement !== mentionAutocomplete) {
                    mentionAutocomplete.classList.remove('active');
                }
            }, 200);
        });
    }
    
    showMentionAutocomplete(query, startPos) {
        const mentionAutocomplete = document.getElementById('mentionAutocomplete');
        if (!mentionAutocomplete) return;
        
        // Get participants
        const participants = this.getParticipantsForMentions();
        
        // Filter by query
        const filtered = participants.filter(p => 
            p.name.toLowerCase().includes(query) || 
            p.userName.toLowerCase().includes(query)
        );
        
        if (filtered.length === 0) {
            mentionAutocomplete.classList.remove('active');
            return;
        }
        
        mentionAutocomplete.innerHTML = filtered.map((participant, index) => {
            const initials = participant.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            return `
                <div class="mention-autocomplete-item" data-user-id="${participant.userId}" data-user-name="${this.escapeHtml(participant.name)}" data-index="${index}">
                    <div class="mention-autocomplete-item-avatar">${initials}</div>
                    <div class="mention-autocomplete-item-name">${this.escapeHtml(participant.name)}</div>
                    <div class="mention-autocomplete-item-username">@${this.escapeHtml(participant.userName)}</div>
                </div>
            `;
        }).join('');
        
        // Add click handlers
        mentionAutocomplete.querySelectorAll('.mention-autocomplete-item').forEach(item => {
            item.addEventListener('click', () => {
                this.insertMention(item.dataset.userName, startPos, query.length);
                mentionAutocomplete.classList.remove('active');
            });
        });
        
        mentionAutocomplete.classList.add('active');
        this.mentionState.selectedIndex = -1;
    }
    
    updateMentionSelection(items, index) {
        items.forEach((item, i) => {
            item.classList.toggle('selected', i === index);
        });
    }
    
    insertMention(userName, startPos, queryLength) {
        const chatInput = document.getElementById('chatInput');
        if (!chatInput) return;
        
        const value = chatInput.value;
        const beforeMention = value.substring(0, startPos);
        const afterMention = value.substring(startPos + 1 + queryLength); // +1 for @
        
        chatInput.value = beforeMention + `@${userName} ` + afterMention;
        
        // Set cursor position after mention
        const newPos = startPos + userName.length + 2; // +2 for @ and space
        chatInput.setSelectionRange(newPos, newPos);
        chatInput.focus();
        
        // Trigger input event to update counter
        chatInput.dispatchEvent(new Event('input'));
        
        // Haptic feedback
        if (navigator.vibrate) {
            navigator.vibrate(5);
        }
    }
    
    getParticipantsForMentions() {
        // Get participants from current participants list
        const participants = [];
        
        if (this.participants && Array.isArray(this.participants)) {
            this.participants.forEach(p => {
                if (p.user_id !== this.userId) { // Don't include self
                    participants.push({
                        userId: p.user_id,
                        name: p.user_name || 'Anonymous',
                        userName: p.user_name ? p.user_name.toLowerCase().replace(/\s+/g, '') : 'anonymous'
                    });
                }
            });
        }
        
        return participants;
    }
    
    processMentions(text) {
        if (!text) return '';
        
        // Find @mentions in text and wrap them
        const mentionRegex = /@(\w+(?:\s+\w+)*)/g;
        const processed = this.escapeHtml(text).replace(mentionRegex, (match, name) => {
            return `<span class="mention">${match}</span>`;
        });
        
        return processed;
    }
    
    setupRealtimeListeners() {
        // If RTDB is active, we'll attach RTDB listeners instead of polling
        if (this.useRTDB && this.rtdb) {
            console.log('Using Firebase RTDB for real-time chat/signaling');
            this.subscribeRTDBChat();
            this.subscribeRTDBSignals();
            return;
        }
        
        // Fallback: API polling
        console.log('Using API-based polling instead of direct Firestore listeners');
        this.setupChatPolling();
    }
    
    setupChatPolling() {
        // If RTDB is active, skip polling
        if (this.useRTDB && this.rtdb) {
            return;
        }
        // Only set up polling if WebSocket is not connected or in fallback mode
        if (!this.wsConnected || this.wsFallbackMode) {
            // Poll for new chat messages every 5 seconds
            const intervalId = setInterval(() => {
                if (this.isPageVisible) {
                    this.loadChatMessages();
                }
            }, 5000);
            this.addPollingInterval('chat', intervalId);
        }
    }
    
    setupParticipantPolling() {
        // Poll for participant changes every 5 seconds using Firestore directly
        // This is a fallback if REST API polling fails
        if (this.participantPollInterval) {
            clearInterval(this.participantPollInterval);
        }
        
        // Skip if RTDB is active (participant updates handled via Firestore snapshot listeners)
        if (this.useRTDB && this.rtdb) {
            return;
        }
        
        // Only set up polling if WebSocket is not connected or in fallback mode
        if (!this.wsConnected || this.wsFallbackMode) {
            this.removePollingInterval('participants');
            
            const intervalId = setInterval(async () => {
                if (this.isPageVisible) {
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
                }
            }, 5000);
            this.addPollingInterval('participants', intervalId);
        }
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
            
            // Set up WebRTC signaling
            this.setupWebRTCSignaling();
            
            // Trigger an immediate participant check to start connections
            this.loadParticipants();
            
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
            // Only set speaking to true if not muted
            this.isSpeaking = !this.isMuted && average > this.voiceActivityThreshold;
            
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
            
            // Use WebSocket if available and connected, otherwise fall back to REST
            if (this.socket && this.wsConnected && !this.wsFallbackMode) {
                this.socket.emit('speaking_state', {
                    room_id: this.roomId,
                    is_speaking: this.isSpeaking
                });
                console.log('Speaking state sent via WebSocket');
                return;
            }
            
            // REST fallback
            const response = await fetch(`/api/prayer-room/room/${this.roomId}/speaking-state`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
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
        // Only set up polling if RTDB is not active AND WebSocket is not connected
        if (this.useRTDB && this.rtdb) {
            console.log('✅ Using Firebase RTDB for real-time signaling (fast)');
            return; // RTDB is active, no need for polling
        }
        
        if (!this.wsConnected || this.wsFallbackMode) {
            console.log('⚠️ Using REST polling for WebRTC signals (200ms interval)');
            console.log('⚠️ RTDB not active, using fallback');
            
            // Poll for WebRTC signals every 200ms for near real-time connection
            const intervalId = setInterval(() => {
                if (this.isPageVisible) {
                    this.checkForWebRTCSignals();
                }
            }, 200); // Optimized for real-time conversation
            this.addPollingInterval('signals', intervalId);
        }
    }

    async checkForWebRTCSignals() {
        try {
            if (!this.roomId) return;
            
            // OPTIMIZATION: Fetch all signal types in parallel instead of sequentially
            // This reduces total latency from (3 * network_time) to (1 * network_time)
            const [offersResponse, answersResponse, candidatesResponse] = await Promise.all([
                fetch(`/api/prayer-room/room/${this.roomId}/webrtc-offers`, { credentials: 'include' }),
                fetch(`/api/prayer-room/room/${this.roomId}/webrtc-answers`, { credentials: 'include' }),
                fetch(`/api/prayer-room/room/${this.roomId}/webrtc-candidates`, { credentials: 'include' })
            ]);
            
            // Process offers
            if (offersResponse.ok) {
                const offers = await offersResponse.json();
                for (const offer of offers) {
                    if (offer.to_user === this.userId) {
                        await this.handleWebRTCOffer(offer);
                    }
                }
            }
            
            // Process answers
            if (answersResponse.ok) {
                const answers = await answersResponse.json();
                for (const answer of answers) {
                    if (answer.to_user === this.userId) {
                        await this.handleWebRTCAnswer(answer);
                    }
                }
            }
            
            // Process candidates
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

    async createPeerConnection(participantId, isInitiator) {
        try {
            const startTime = performance.now();
            console.log(`[WebRTC] Creating peer connection for ${participantId}. Initiator: ${isInitiator}`);
            console.log(`[WebRTC] Local stream available: ${!!this.localStream}, Active: ${this.localStream?.active}`);
            
            if (this.peers.has(participantId)) {
                console.warn(`[WebRTC] Peer connection already exists for ${participantId}. Aborting creation.`);
                return;
            }
            
            // Critical: Check if we have an active local stream
            if (!this.localStream || !this.localStream.active) {
                console.error(`[WebRTC] Cannot create peer connection for ${participantId}: No active local stream!`);
                console.error(`[WebRTC] User must join audio before connecting to peers.`);
                return;
            }
            
            // Verify the stream has audio tracks
            const audioTracks = this.localStream.getAudioTracks();
            if (audioTracks.length === 0) {
                console.error(`[WebRTC] Local stream has no audio tracks!`);
                return;
            }
            console.log(`[WebRTC] Local stream has ${audioTracks.length} audio track(s), enabled: ${audioTracks[0].enabled}`);
            
            // Log local stream details before creating peer
            console.log(`[WebRTC] Creating SimplePeer with stream:`, {
                streamId: this.localStream.id,
                audioTracks: this.localStream.getAudioTracks().map(t => ({
                    id: t.id,
                    enabled: t.enabled,
                    muted: t.muted,
                    readyState: t.readyState
                }))
            });
            
            // Optimize ICE configuration for better TURN utilization
            // Prioritize TURN servers and increase candidate pool for better connectivity
            const turnCount = this.iceServers.filter(s => 
                s.urls && (typeof s.urls === 'string' ? s.urls.includes('turn:') : 
                (Array.isArray(s.urls) && s.urls.some(u => u.includes('turn:'))))
            ).length;
            console.log(`[WebRTC] ICE Config: ${this.iceServers.length} servers (${turnCount} TURN, ${this.iceServers.length - turnCount} STUN)`);
            
            const optimizedConfig = {
                iceServers: this.iceServers,
                iceCandidatePoolSize: 20, // Increased from 10 for better TURN discovery
                iceTransportPolicy: 'all' // Try both relay (TURN) and direct connections
            };
            
            const peer = new SimplePeer({
                initiator: isInitiator,
                stream: this.localStream,
                trickle: true,
                config: optimizedConfig
            });
            
            // Add connection quality monitoring
            this.setupConnectionMonitoring(peer, participantId);
            
            this.peers.set(participantId, peer);
            
            // Store connection start time for timing measurement
            if (!this.connectionTimings) {
                this.connectionTimings = new Map();
            }
            this.connectionTimings.set(participantId, startTime);
            
            this.setupPeerEventHandlers(peer, participantId);
            
            const creationTime = performance.now() - startTime;
            console.log(`✅ [WebRTC] Peer connection created for ${participantId} in ${creationTime.toFixed(1)}ms`);
            
        } catch (error) {
            console.error(`[WebRTC] Error creating peer connection for ${participantId}:`, error);
        }
    }
    
    addStreamToExistingPeers() {
        // Add the local stream to any existing peer connections that don't have it
        if (!this.localStream) {
            console.warn('[WebRTC] Cannot add stream to peers: no local stream available');
            return;
        }
        
        console.log(`[WebRTC] Adding stream to ${this.peers.size} existing peer(s)`);
        
        this.peers.forEach((peer, participantId) => {
            try {
                if (peer._pc && peer._pc.getSenders) {
                    const senders = peer._pc.getSenders();
                    const hasAudio = senders.some(sender => sender.track?.kind === 'audio');
                    
                    if (!hasAudio) {
                        console.log(`[WebRTC] Adding audio track to existing peer ${participantId}`);
                        this.localStream.getAudioTracks().forEach(track => {
                            peer.addTrack(track, this.localStream);
                        });
                    } else {
                        console.log(`[WebRTC] Peer ${participantId} already has audio track`);
                    }
                }
            } catch (error) {
                console.error(`[WebRTC] Error adding stream to peer ${participantId}:`, error);
            }
        });
        
        // CRITICAL FIX: Create peer connections with participants who don't have connections yet
        // This handles the case where user joined audio AFTER other participants joined the room
        this.connectToExistingParticipants();
    }
    
    async connectToExistingParticipants() {
        // Fetch current participants and create connections if needed
        try {
            console.log('[WebRTC] 🔍 Checking for participants without peer connections...');
            
            const response = await fetch(`/api/prayer-room/${this.roomId}/participants`, {
                credentials: 'include'
            });
            
            const data = await response.json();
            
            if (data.success && data.participants) {
                let connectionsCreated = 0;
                
                data.participants.forEach(participant => {
                    const participantId = participant.user_id;
                    
                    // Skip self and existing peers
                    if (participantId === this.userId || this.peers.has(participantId)) {
                        return;
                    }
                    
                    // Determine if we should initiate (same logic as updateParticipants)
                    const isInitiator = this.userId < participantId;
                    
                    if (isInitiator) {
                        console.log(`[WebRTC] ✨ Creating peer connection with ${participantId} (I am initiator)`);
                        this.createPeerConnection(participantId, true);
                        connectionsCreated++;
                    } else {
                        console.log(`[WebRTC] ⏳ Waiting for ${participantId} to initiate connection`);
                    }
                });
                
                if (connectionsCreated > 0) {
                    console.log(`[WebRTC] ✅ Created ${connectionsCreated} new peer connection(s)`);
                } else {
                    console.log('[WebRTC] ℹ️ No new peer connections needed');
                }
            }
        } catch (error) {
            console.error('[WebRTC] Error fetching participants for connection:', error);
        }
    }

    setupPeerEventHandlers(peer, participantId) {
        // Handle the 'signal' event - this is fired when SimplePeer generates SDP offer/answer or ICE candidates
        peer.on('signal', async (data) => {
            console.log(`📡 [WebRTC] Signal generated for ${participantId}:`, data.type);
            await this.sendSignal(participantId, data);
        });

        // Handle incoming media stream from the remote peer
        peer.on('stream', (stream) => {
            console.log(`🎵 [WebRTC] Received remote stream from ${participantId}`);
            console.log(`🎵 Stream details:`, {
                id: stream.id,
                active: stream.active,
                audioTracks: stream.getAudioTracks().length,
                videoTracks: stream.getVideoTracks().length
            });
            
            // Log audio track details
            stream.getAudioTracks().forEach((track, index) => {
                console.log(`🎵 Audio track ${index}:`, {
                    id: track.id,
                    kind: track.kind,
                    enabled: track.enabled,
                    muted: track.muted,
                    readyState: track.readyState,
                    label: track.label
                });
                
                // Monitor for unmute events
                track.addEventListener('unmute', () => {
                    console.log(`✅ Remote audio track from ${participantId} is now UNMUTED and producing audio!`);
                });
                
                track.addEventListener('mute', () => {
                    console.warn(`⚠️ Remote audio track from ${participantId} became MUTED (stopped producing audio)`);
                });
                
                // Warn if track is muted (no audio being produced)
                if (track.muted) {
                    console.warn(`⚠️ Remote audio track from ${participantId} is muted (not producing audio)!
                    
Possible causes:
- Another app is using their microphone (Zoom, Teams, Discord, Skype)
- Browser doesn't have OS-level microphone permission
- Microphone was disconnected/changed during session
- Using virtual audio device with issues (OBS, Loopback, etc.)

Ask them to:
1. Close all other apps that might use the microphone
2. Completely close and reopen their browser
3. Check System Preferences/Settings → Privacy → Microphone
4. Try a different microphone if available
5. Refresh the page

Listening for unmute event...`);
                }
            });
            
            this.handleRemoteStream(participantId, stream);
        });

        // Handle successful connection
        peer.on('connect', () => {
            // Log total connection time
            if (this.connectionTimings && this.connectionTimings.has(participantId)) {
                const totalTime = performance.now() - this.connectionTimings.get(participantId);
                console.log(`✅ [WebRTC] Connected to ${participantId} in ${totalTime.toFixed(0)}ms`);
                this.connectionTimings.delete(participantId);
            } else {
                console.log(`✅ [WebRTC] Connected to ${participantId}`);
            }
            
            // Clear retry count on successful connection
            if (this.connectionRetries.has(participantId)) {
                console.log(`✅ Connection successful after ${this.connectionRetries.get(participantId)} retries`);
                this.connectionRetries.delete(participantId);
            }
            
            // Process any queued ICE candidates for this peer
            this.processQueuedCandidates(participantId);
        });

        // Handle peer disconnection
        peer.on('close', () => {
            console.log(`🔌 [WebRTC] Connection closed with ${participantId}`);
            this.cleanupPeerConnection(participantId);
        });

        // Handle errors
        peer.on('error', (err) => {
            console.error(`❌ [WebRTC] Error with ${participantId}:`, err);
            
            // Handle specific error types
            if (err.code === 'ERR_CONNECTION_FAILURE' || err.message?.includes('Connection failed')) {
                console.log(`🔄 [WebRTC] Connection failure with ${participantId}, will retry...`);
                this.retryConnection(participantId);
            } else if (err.message && err.message.includes('InvalidStateError')) {
                this.handleSignalingStateError(participantId, err);
            } else {
                // For other errors, clean up and let the system retry naturally
                console.warn(`⚠️ [WebRTC] Unhandled error with ${participantId}, cleaning up`);
                this.cleanupPeerConnection(participantId);
            }
        });
    }

    setupConnectionMonitoring(peer, participantId) {
        /**
         * Monitor WebRTC connection quality and ICE candidate usage
         * Tracks when TURN relay is being used vs direct connections
         */
        if (!peer._pc) {
            // Wait for peer connection to be created
            setTimeout(() => this.setupConnectionMonitoring(peer, participantId), 100);
            return;
        }
        
        const pc = peer._pc;
        
        // Monitor ICE connection state changes
        pc.addEventListener('iceconnectionstatechange', () => {
            const state = pc.iceConnectionState;
            console.log(`🔌 [WebRTC] ICE connection state for ${participantId}: ${state}`);
            
            if (state === 'connected' || state === 'completed') {
                // Check which candidates are being used
                pc.getStats().then(stats => {
                    let relayCandidates = 0;
                    let hostCandidates = 0;
                    let srflxCandidates = 0;
                    
                    stats.forEach(report => {
                        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                            const localCandidate = stats.get(report.localCandidateId);
                            
                            if (localCandidate) {
                                if (localCandidate.candidateType === 'relay') relayCandidates++;
                                else if (localCandidate.candidateType === 'host') hostCandidates++;
                                else if (localCandidate.candidateType === 'srflx') srflxCandidates++;
                            }
                        }
                    });
                    
                    if (relayCandidates > 0) {
                        console.log(`✅ [WebRTC] Using TURN relay for ${participantId} (${relayCandidates} relay candidate(s))`);
                        this.connectionQuality = 'good'; // TURN ensures connectivity
                    } else if (hostCandidates > 0) {
                        console.log(`✅ [WebRTC] Direct connection for ${participantId} (${hostCandidates} host candidate(s))`);
                        this.connectionQuality = 'excellent'; // Direct is best
                    } else if (srflxCandidates > 0) {
                        console.log(`✅ [WebRTC] NAT traversal via STUN for ${participantId} (${srflxCandidates} srflx candidate(s))`);
                        this.connectionQuality = 'good';
                    }
                }).catch(err => {
                    console.warn(`[WebRTC] Could not get connection stats for ${participantId}:`, err);
                });
            } else if (state === 'failed' || state === 'disconnected') {
                console.warn(`⚠️ [WebRTC] ICE connection ${state} for ${participantId}`);
                this.connectionQuality = 'poor';
            }
        });
        
        // Monitor ICE gathering state
        pc.addEventListener('icegatheringstatechange', () => {
            const state = pc.iceGatheringState;
            console.log(`🔍 [WebRTC] ICE gathering state for ${participantId}: ${state}`);
        });
        
        // Monitor connection state
        pc.addEventListener('connectionstatechange', () => {
            const state = pc.connectionState;
            console.log(`📡 [WebRTC] Connection state for ${participantId}: ${state}`);
        });
    }

    handleRemoteStream(participantId, stream) {
        try {
            console.log(`🎵 Setting up audio for participant ${participantId}`);
            
            // Validate stream
            if (!stream) {
                console.error(`🎵 No stream provided for ${participantId}`);
                return;
            }
            
            if (!stream.active) {
                console.error(`🎵 Stream is not active for ${participantId}`);
                return;
            }
            
            const audioTracks = stream.getAudioTracks();
            if (audioTracks.length === 0) {
                console.error(`🎵 No audio tracks in stream from ${participantId}`);
                return;
            }
            
            console.log(`🎵 Valid stream with ${audioTracks.length} audio track(s) from ${participantId}`);
            
            // Remove existing audio element if it exists
            const existingAudio = document.getElementById(`audio-${participantId}`);
            if (existingAudio) {
                console.log(`🎵 Removing existing audio element for ${participantId}`);
                existingAudio.srcObject = null;
                existingAudio.remove();
            }
            
            // Create new audio element
            const audioElement = document.createElement('audio');
            audioElement.id = `audio-${participantId}`;
            audioElement.autoplay = true;
            audioElement.playsInline = true;
            audioElement.controls = false;
            audioElement.volume = 1.0;
            
            // IMPORTANT: Don't mute initially - let updateParticipantAudioMuteState handle it
            audioElement.muted = false;
            
            // Attach stream before appending to DOM
            audioElement.srcObject = stream;
            
            // Add event listeners for debugging
            audioElement.addEventListener('loadedmetadata', () => {
                console.log(`🎵 Audio metadata loaded for ${participantId}`);
            });
            
            audioElement.addEventListener('canplay', () => {
                console.log(`🎵 Audio can play for ${participantId}`);
            });
            
            audioElement.addEventListener('playing', () => {
                console.log(`✅ Audio is playing for ${participantId}`);
            });
            
            audioElement.addEventListener('pause', () => {
                console.warn(`⚠️ Audio paused for ${participantId}`);
            });
            
            audioElement.addEventListener('error', (e) => {
                console.error(`❌ Audio error for ${participantId}:`, e);
            });
            
            // Append to DOM
            document.body.appendChild(audioElement);
            console.log(`🎵 Audio element created and attached to DOM for ${participantId}`);
            
            // Try to play
            const playPromise = audioElement.play();
            
            if (playPromise !== undefined) {
                playPromise
                    .then(() => {
                        console.log(`✅ Audio playback started successfully for ${participantId}`);
                        
                        // Now check mute state after playback started
                        this.updateParticipantAudioMuteState(participantId);
                    })
                    .catch(err => {
                        console.error(`❌ Audio playback failed for ${participantId}:`, err);
                        
                        if (err.name === 'NotAllowedError') {
                            console.error(`🔇 Browser blocked autoplay. User must interact with page first.`);
                            this.showError('Click anywhere on the page to enable audio playback');
                            
                            // Try again on next user interaction
                            document.addEventListener('click', () => {
                                audioElement.play().then(() => {
                                    console.log(`✅ Audio started after user interaction for ${participantId}`);
                                }).catch(e => console.error(`Still failed:`, e));
                            }, { once: true });
                        }
                    });
            }
            
        } catch (error) {
            console.error(`❌ Error handling remote stream for ${participantId}:`, error);
        }
    }

    async updateParticipantAudioMuteState(participantId) {
        try {
            // Get current participant data to check mute state
            const participants = await this.getCurrentParticipants();
            const participant = participants.find(p => p.user_id === participantId);
            
            if (participant) {
                const audioElement = document.getElementById(`audio-${participantId}`);
                if (audioElement) {
                    // Mute the audio element if participant is muted
                    audioElement.muted = participant.is_muted || false;
                    console.log(`🔇 Audio element for ${participantId} muted: ${audioElement.muted}`);
                }
            }
        } catch (error) {
            console.error(`Error updating audio mute state for ${participantId}:`, error);
        }
    }

    muteRemoteParticipantAudio(participantId, shouldMute) {
        const audioElement = document.getElementById(`audio-${participantId}`);
        if (audioElement) {
            audioElement.muted = shouldMute;
            console.log(`🔇 ${shouldMute ? 'Muted' : 'Unmuted'} audio for participant ${participantId}`);
        } else {
            console.warn(`Audio element not found for participant ${participantId}`);
        }
    }

    async retryConnection(participantId) {
        try {
            // Get current retry count
            const retryCount = this.connectionRetries.get(participantId) || 0;
            
            if (retryCount >= this.maxRetries) {
                console.error(`❌ Max retries (${this.maxRetries}) reached for ${participantId}. Giving up.`);
                this.connectionRetries.delete(participantId);
                this.cleanupPeerConnection(participantId);
                this.showError(`Unable to connect to participant. They may have network issues.`);
                return;
            }
            
            // Increment retry count
            this.connectionRetries.set(participantId, retryCount + 1);
            
            // Calculate exponential backoff delay
            const delay = this.retryDelay * Math.pow(2, retryCount);
            console.log(`🔄 Retry attempt ${retryCount + 1}/${this.maxRetries} for ${participantId} in ${delay}ms`);
            
            // Clean up existing connection
            this.cleanupPeerConnection(participantId);
            
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Check if participant is still in the room
            const participants = await this.getCurrentParticipants();
            const stillInRoom = participants.some(p => p.user_id === participantId);
            
            if (!stillInRoom) {
                console.log(`👋 Participant ${participantId} left during retry, aborting`);
                this.connectionRetries.delete(participantId);
                return;
            }
            
            // Determine who should initiate
            const isInitiator = this.userId < participantId;
            
            if (isInitiator) {
                console.log(`🔄 Recreating connection as initiator for ${participantId}`);
                await this.createPeerConnection(participantId, true);
            } else {
                console.log(`🔄 Waiting for new offer from ${participantId}`);
                // Non-initiator waits for the initiator to retry
            }
            
        } catch (error) {
            console.error(`❌ Error retrying connection for ${participantId}:`, error);
            this.connectionRetries.delete(participantId);
        }
    }

    cleanupPeerConnection(participantId) {
        try {
            console.log(`🧹 Cleaning up peer connection for ${participantId}`);
            
            // Get the peer connection
            const peer = this.peers.get(participantId);
            
            if (peer) {
                // Destroy the peer connection
                peer.destroy();
                console.log(`🧹 Peer destroyed for ${participantId}`);
            }
            
            // Remove from peers map
            this.peers.delete(participantId);
            
            // Remove the audio element
            const audioElement = document.getElementById(`audio-${participantId}`);
            if (audioElement) {
                audioElement.srcObject = null;
                audioElement.remove();
                console.log(`🧹 Audio element removed for ${participantId}`);
            }
            
            // Clean up any pending candidates for this user
            if (this.pendingCandidates && this.pendingCandidates.has(participantId)) {
                this.pendingCandidates.delete(participantId);
                console.log(`🧹 Pending candidates cleared for ${participantId}`);
            }
            
            console.log(`✅ Peer connection cleanup complete for ${participantId}`);
            
        } catch (error) {
            console.error(`🧹 Error cleaning up peer connection for ${participantId}:`, error);
        }
    }

    async sendSignal(participantId, signalData) {
        try {
            if (!this.roomId || !this.userId) return;
            
            console.log(`📡 Sending signal to ${participantId}:`, signalData.type);
            
            // Prefer RTDB if available
            if (this.useRTDB && this.rtdb && this.rtdbRefs.signalsRoot) {
                // Critical validation: Ensure participantId is valid for RTDB path
                if (!participantId || typeof participantId !== 'string' || !participantId.trim()) {
                    console.error('RTDB sendSignal failed: Invalid participantId', participantId);
                    return;
                }
                const user = firebase.auth().currentUser;
                await this.rtdbRefs.signalsRoot.child(participantId).push({
                    from_user: user ? user.uid : this.userId,
                    type: signalData.type,
                    data: signalData,
                    timestamp: firebase.database.ServerValue.TIMESTAMP
                });
                console.log(`📡 WebRTC ${signalData.type} sent via RTDB to ${participantId}`);
                return;
            }
            
            // REST fallback
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
            const fromUser = offer.from_user;
            console.log(`[WebRTC] Received offer from: ${fromUser}`);

            // If we are the initiator, we shouldn't get an offer. This indicates a race condition.
            const areWeInitiator = this.userId < fromUser;
            if (areWeInitiator) {
                console.warn(`[WebRTC] Ignoring offer from ${fromUser} because I am the designated initiator.`);
                return;
            }

            // Ensure we have a local stream before accepting an offer.
            // If not, it means the current user hasn't joined audio yet.
            if (!this.localStream) {
                console.log(`[WebRTC] Received an offer but local audio is not ready. Joining audio first.`);
                // The `joinAudio` function will get the stream and then set up connections.
                // We need to make sure the offer is handled after the stream is acquired.
                this.pendingOffer = offer; // Store the offer
                await this.joinAudio(); // This will now handle the pending offer
                return;
            }

            if (this.peers.has(fromUser)) {
                console.warn(`[WebRTC] Existing peer found for ${fromUser} while handling offer. Cleaning up old one.`);
                this.cleanupPeerConnection(fromUser);
            }

            // Create a non-initiator peer to accept the offer
            console.log(`[WebRTC] Creating responding peer for ${fromUser}.`);
            this.createPeerConnection(fromUser, false); // false = not an initiator
            
            const peer = this.peers.get(fromUser);
            if (peer) {
                peer.signal(offer.offer);
                console.log(`[WebRTC] Applied offer from ${fromUser}.`);
            } else {
                 console.error(`[WebRTC] Failed to create peer for offer from ${fromUser}.`);
            }
            
        } catch (error) {
            console.error('[WebRTC] Error handling WebRTC offer:', error);
        }
    }

    async handleWebRTCAnswer(answer) {
        try {
            const fromUser = answer.from_user;
            console.log(`[WebRTC] Received answer from: ${fromUser}`);

            const peer = this.peers.get(fromUser);
            if (!peer) {
                console.warn(`[WebRTC] No peer connection found for answer from: ${fromUser}. Ignoring.`);
                return;
            }

            // Only the initiator should process an answer
            const amIInitiator = this.userId < fromUser;
            if (!amIInitiator) {
                console.warn(`[WebRTC] Ignoring answer from ${fromUser} because I am not the initiator.`);
                return;
            }
            
            // Check signaling state to avoid "stable" state errors
            if (peer._pc && peer._pc.signalingState === 'stable') {
                console.warn(`[WebRTC] Ignoring answer from ${fromUser} because signaling state is already 'stable'.`);
                return;
            }

            peer.signal(answer.answer);
            console.log(`[WebRTC] Applied answer from ${fromUser}.`);

        } catch (error) {
            console.error('[WebRTC] Error handling WebRTC answer:', error);
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
                // Add candidate if peer connection is ready
                if (peer._pc && peer._pc.remoteDescription) {
                    peer.signal(candidate.candidate);
                } else {
                    this.queueCandidateForLater(candidate);
                }
            } else {
                console.warn('No peer connection found for candidate from:', candidate.from_user);
                // Queue the candidate for when the peer connection is created
                this.queueCandidateForLater(candidate);
            }
            
        } catch (error) {
            console.error('Error handling WebRTC candidate:', error);
        }
    }
    
    queueCandidateForLater(candidate) {
        // Initialize candidate queue if it doesn't exist
        if (!this.pendingCandidates) {
            this.pendingCandidates = new Map();
        }
        
        // Add candidate to queue for this user
        if (!this.pendingCandidates.has(candidate.from_user)) {
            this.pendingCandidates.set(candidate.from_user, []);
        }
        
        this.pendingCandidates.get(candidate.from_user).push(candidate.candidate);
        console.log(`📡 Queued candidate for ${candidate.from_user}, queue size: ${this.pendingCandidates.get(candidate.from_user).length}`);
    }
    
    processQueuedCandidates(userId) {
        if (!this.pendingCandidates || !this.pendingCandidates.has(userId)) {
            return;
        }
        
        const peer = this.peers.get(userId);
        if (!peer) {
            return;
        }
        
        const queuedCandidates = this.pendingCandidates.get(userId);
        console.log(`📡 Processing ${queuedCandidates.length} queued candidates for ${userId}`);
        
        // Process all queued candidates
        queuedCandidates.forEach(candidate => {
            try {
                peer.signal(candidate);
            } catch (error) {
                console.error(`❌ Error processing queued candidate for ${userId}:`, error);
            }
        });
        
        // Clear the queue for this user
        this.pendingCandidates.delete(userId);
    }
    
    // Method to handle signaling state errors (InvalidStateError)
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
            await this.createPeerConnection(participantId, true);
            
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
                    await this.createPeerConnection(participant.user_id, true);
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
                
                // Actually mute/unmute the audio element for this participant
                this.muteRemoteParticipantAudio(participantId, newMuteState);
                
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

    async loadIceConfig() {
        const maxRetries = 3;
        const retryDelay = 1000; // 1 second
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // Add timeout to fetch request
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
                
                const res = await fetch(`/api/prayer-room/ice-config`, { 
                    credentials: 'include',
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!res.ok) {
                    if (attempt < maxRetries - 1) {
                        console.warn(`ICE config fetch failed (attempt ${attempt + 1}/${maxRetries}), retrying...`);
                        await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
                        continue;
                    }
                    console.warn('ICE config fetch failed after all retries, using defaults');
                    return;
                }
                
                const data = await res.json();
                if (data && Array.isArray(data.iceServers) && data.iceServers.length > 0) {
                    this.iceServers = data.iceServers;
                    console.log('✅ ICE servers loaded:', this.iceServers.length, 'servers');
                    return; // Success
                } else {
                    console.warn('ICE config returned empty servers, using defaults');
                    return;
                }
            } catch (e) {
                if (e.name === 'AbortError') {
                    console.warn(`ICE config fetch timed out (attempt ${attempt + 1}/${maxRetries})`);
                } else {
                    console.warn(`Failed to load ICE config (attempt ${attempt + 1}/${maxRetries}):`, e);
                }
                
                if (attempt < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
                } else {
                    console.warn('Failed to load ICE config after all retries, using defaults');
                }
            }
        }
    }
    
    initializeWebSocket() {
        try {
            // Wait a bit for Socket.IO script to load
            setTimeout(() => {
                if (typeof io === 'undefined') {
                    console.warn('Socket.IO not available, using REST fallback');
                    this.wsFallbackMode = true;
                    return;
                }
                
                console.log('Socket.IO script loaded, initializing connection...');
                this.setupSocketIO();
            }, 500); // Increased timeout to ensure script loads
        } catch (error) {
            console.error('Failed to initialize WebSocket:', error);
            this.wsFallbackMode = true;
        }
    }
    
    setupSocketIO() {
        try {
            
            this.socket = io({
                transports: ['websocket', 'polling'],
                upgrade: true,
                rememberUpgrade: true
            });
            
            this.socket.on('connect', () => {
                console.log('🔌 WebSocket connected');
                this.wsConnected = true;
                this.wsFallbackMode = false;
                
                // Join the room via WebSocket
                if (this.roomId) {
                    this.socket.emit('join_room', { room_id: this.roomId });
                }
            });
            
            this.socket.on('disconnect', () => {
                console.log('🔌 WebSocket disconnected');
                this.wsConnected = false;
                this.wsFallbackMode = true;
            });
            
            this.socket.on('webrtc_signal', (data) => {
                this.handleWebSocketSignal(data);
            });
            
            this.socket.on('chat_message', (data) => {
                this.handleWebSocketChatMessage(data);
            });
            
            this.socket.on('speaking_state', (data) => {
                this.handleWebSocketSpeakingState(data);
            });
            
            this.socket.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.wsFallbackMode = true;
            });
            
        } catch (error) {
            console.error('Failed to initialize WebSocket:', error);
            this.wsFallbackMode = true;
        }
    }
    
    handleWebSocketSignal(data) {
        try {
            const { from_user, to_user, type, data: signalData } = data;
            
            if (to_user !== this.userId) return;
            
            console.log(`📡 WebSocket signal received: ${type} from ${from_user}`);
            
            if (type === 'offer') {
                this.handleWebRTCOffer({
                    from_user,
                    offer: signalData
                });
            } else if (type === 'answer') {
                this.handleWebRTCAnswer({
                    from_user,
                    answer: signalData
                });
            } else if (type === 'candidate') {
                this.handleWebRTCCandidate({
                    from_user,
                    candidate: signalData
                });
            }
        } catch (error) {
            console.error('Error handling WebSocket signal:', error);
        }
    }
    
    handleWebSocketChatMessage(data) {
        try {
            const { user_id, user_name, message, timestamp } = data;
            
            // Add to chat messages
            this.chatMessages.push({
                user_id,
                user_name,
                message,
                timestamp: new Date(timestamp)
            });
            
            // Update display
            this.updateChatDisplay();
            
        } catch (error) {
            console.error('Error handling WebSocket chat message:', error);
        }
    }
    
    handleWebSocketSpeakingState(data) {
        try {
            const { user_id, is_speaking } = data;
            
            // Update participant speaking state
            const participantElement = document.querySelector(`[data-user-id="${user_id}"]`);
            if (participantElement) {
                if (is_speaking) {
                    participantElement.classList.add('speaking');
                } else {
                    participantElement.classList.remove('speaking');
                }
                
                // Update speaking indicator
                const speakingIndicator = participantElement.querySelector('.speaking-indicator');
                if (speakingIndicator) {
                    speakingIndicator.style.display = is_speaking ? 'inline' : 'none';
                }
            }
            
        } catch (error) {
            console.error('Error handling WebSocket speaking state:', error);
        }
    }
    
    setupPerformanceOptimizations() {
        // Page visibility change detection
        document.addEventListener('visibilitychange', () => {
            this.isPageVisible = !document.hidden;
            console.log(`📊 Page visibility changed: ${this.isPageVisible ? 'visible' : 'hidden'}`);
            
            if (this.isPageVisible) {
                this.resumePolling();
            } else {
                this.pausePolling();
            }
        });
        
        // Window focus/blur detection
        window.addEventListener('focus', () => {
            this.isPageVisible = true;
            this.resumePolling();
        });
        
        window.addEventListener('blur', () => {
            this.isPageVisible = false;
            this.pausePolling();
        });
    }
    
    pausePolling() {
        console.log('📊 Pausing polling for performance');
        // Pause all polling intervals
        for (const [name, intervalId] of this.pollingIntervals.entries()) {
            clearInterval(intervalId);
            this.pollingIntervals.delete(name);
        }
    }
    
    resumePolling() {
        console.log('📊 Resuming polling');
        // Only resume if RTDB is not active AND WebSocket is not connected
        if (this.useRTDB && this.rtdb) {
            console.log('📊 RTDB is active, skipping REST polling resume');
            return;
        }
        
        if (!this.wsConnected || this.wsFallbackMode) {
            this.setupSignalPolling();
            this.setupParticipantPolling();
            this.setupChatPolling();
        }
    }
    
    addPollingInterval(name, intervalId) {
        this.pollingIntervals.set(name, intervalId);
    }
    
    removePollingInterval(name) {
        const intervalId = this.pollingIntervals.get(name);
        if (intervalId) {
            clearInterval(intervalId);
            this.pollingIntervals.delete(name);
        }
    }

    updateSpeakerSlotDisplay() {
        const indicator = document.getElementById('speakerSlotCount');
        if (!indicator) {
            return;
        }

        const max = this.maxSpeakers || 0;
        const count = Math.min(this.currentSpeakerCount, max);
        indicator.textContent = `${count}/${max}`;
    }

    updateRoleUI() {
        const requestBtn = document.getElementById('requestSpeakerBtn');
        const requestStatus = document.getElementById('requestSpeakerStatus');
        const roleIndicator = document.getElementById('roleIndicator');
        const joinAudioBtn = document.getElementById('joinAudioBtn');
        const muteBtn = document.getElementById('muteBtn');
        const joinText = joinAudioBtn ? joinAudioBtn.querySelector('.join-text') : null;

        if (roleIndicator) {
            roleIndicator.textContent = this.participantRole === 'speaker' ? 'Speaker' : 'Listener';
        }

        if (requestBtn) {
            if (this.participantRole === 'speaker') {
                requestBtn.style.display = 'none';
            } else {
                requestBtn.style.display = 'inline-flex';
                requestBtn.dataset.state = this.pendingSpeakerRequest ? 'pending' : 'idle';
                requestBtn.textContent = this.pendingSpeakerRequest ? 'Cancel Request' : 'Request to Speak';
                requestBtn.disabled = false;
            }
        }

        if (requestStatus) {
            if (this.participantRole === 'speaker') {
                requestStatus.textContent = 'You are on stage as a speaker.';
            } else if (this.pendingSpeakerRequest) {
                requestStatus.textContent = 'Request sent. Waiting for host approval.';
            } else if (this.currentSpeakerCount >= this.maxSpeakers) {
                requestStatus.textContent = 'Speaker slots are full. Request to join the queue.';
            } else {
                requestStatus.textContent = 'Listening mode. Request if you would like to speak.';
            }
        }

        if (muteBtn) {
            if (this.participantRole !== 'speaker') {
                muteBtn.style.display = 'none';
            } else if (this.isAudioEnabled) {
                muteBtn.style.display = 'flex';
            }
        }

        if (joinText) {
            if (this.participantRole === 'speaker') {
                joinText.textContent = this.isAudioEnabled ? 'Rejoin Audio' : 'Join Audio';
            } else {
                joinText.textContent = this.isAudioEnabled ? 'Listening' : 'Join Audio';
            }
        }
    }

    enforceListenerMute() {
        if (!this.localStream) {
            return;
        }
        let changed = false;
        this.localStream.getAudioTracks().forEach(track => {
            if (track.enabled) {
                track.enabled = false;
                changed = true;
            }
        });
        if (changed) {
            this.isMuted = true;
        }
    }

    async toggleSpeakerRequest() {
        if (!this.roomId || this.participantRole === 'speaker') {
            return;
        }

        const requestBtn = document.getElementById('requestSpeakerBtn');
        if (requestBtn) {
            requestBtn.disabled = true;
        }

        const action = this.pendingSpeakerRequest ? 'cancel' : 'request';
        try {
            const result = await this.makeAuthenticatedRequest(`/api/prayer-room/room/${this.roomId}/request-speaker`, {
                method: 'POST',
                body: JSON.stringify({ action })
            });

            if (result.success && result.data) {
                if (typeof result.data.max_speakers === 'number') {
                    this.maxSpeakers = result.data.max_speakers;
                }
                this.updateParticipants(result.data.participants || []);
            } else if (result.error) {
                this.showError(result.error);
            }
        } catch (error) {
            console.error('Error requesting speaker role:', error);
            this.showError('Unable to update speaker request. Please try again.');
        } finally {
            if (requestBtn) {
                requestBtn.disabled = false;
            }
        }
    }

    handleParticipantAction(event) {
        const button = event.target.closest('.participant-action');
        if (!button) {
            return;
        }

        const action = button.dataset.action;
        const userId = button.dataset.userId;
        if (!action || !userId) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        switch (action) {
            case 'promote':
                this.promoteParticipant(userId);
                break;
            case 'demote':
                this.demoteParticipant(userId);
                break;
            case 'demote-self':
                this.demoteParticipant(userId);
                break;
            case 'mute-toggle':
                this.muteParticipant(userId);
                break;
            case 'remove':
                this.removeParticipant(userId);
                break;
            default:
                break;
        }
    }

    async promoteParticipant(userId) {
        try {
            const result = await this.makeAuthenticatedRequest(`/api/prayer-room/room/${this.roomId}/promote-speaker`, {
                method: 'POST',
                body: JSON.stringify({ user_id: userId })
            });

            if (result.success && result.data) {
                if (typeof result.data.max_speakers === 'number') {
                    this.maxSpeakers = result.data.max_speakers;
                }
                this.updateParticipants(result.data.participants || []);
            } else if (result.error) {
                this.showError(result.error);
            }
        } catch (error) {
            console.error('Error promoting participant:', error);
            this.showError('Unable to promote participant.');
        }
    }

    async demoteParticipant(userId) {
        try {
            const result = await this.makeAuthenticatedRequest(`/api/prayer-room/room/${this.roomId}/demote-speaker`, {
                method: 'POST',
                body: JSON.stringify({ user_id: userId })
            });

            if (result.success && result.data) {
                if (typeof result.data.max_speakers === 'number') {
                    this.maxSpeakers = result.data.max_speakers;
                }
                this.updateParticipants(result.data.participants || []);
            } else if (result.error) {
                this.showError(result.error);
            }
        } catch (error) {
            console.error('Error demoting participant:', error);
            this.showError('Unable to demote participant.');
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
        // Teams-like: Smooth scroll with proper timing
        requestAnimationFrame(() => {
            // Force scroll to bottom
            chatMessages.scrollTop = chatMessages.scrollHeight;
            
            // Double-check after delays to ensure we're at bottom (handles dynamic content)
            setTimeout(() => {
                chatMessages.scrollTop = chatMessages.scrollHeight;
                setTimeout(() => {
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }, 100);
            }, 50);
        });
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

