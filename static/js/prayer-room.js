// Prayer Room JavaScript
class PrayerRoomService {
    constructor() {
        this.roomId = null;
        this.userId = null;
        this.userName = null;
        this.isHost = false;
        this.isMuted = false;
        this.isAudioEnabled = false;
        this.muteStateSyncing = false; // Track if mute state is being synced
        this.muteDebounceTimeout = null; // For debouncing mute clicks
        this.trackEnabledCheckInterval = null; // Interval for checking track enabled state
        this.stateValidationInterval = null; // Interval for validating state consistency
        this.peers = new Map();
        this.localStream = null;
        this.simplePeer = null;
        this.firestore = null;
        this.chatMessages = [];
        
        // Track expanded participants to preserve state across updates
        this.expandedParticipantIds = new Set();
        
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
        
        // Audio connection retry tracking
        this.audioConnectionRetries = 0;
        this.maxAudioRetries = 3;
        this.audioRetryDelay = 2000; // Start with 2 seconds
        this.isRetryingAudio = false;
        
        // Participants filtering
        this.participantsFilter = {
            searchQuery: '',
            activeTab: 'all' // 'all' or 'speakers'
        };
        this.allParticipants = []; // Store all participants for filtering
        
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
        const participantsSearch = document.getElementById('participantsSearch');
        const participantsTabAll = document.getElementById('participantsTabAll');
        const participantsTabSpeakers = document.getElementById('participantsTabSpeakers');
        
        // Search functionality
        if (participantsSearch) {
            participantsSearch.addEventListener('input', (e) => {
                this.filterParticipants(e.target.value);
            });
        }
        
        // Tab functionality
        if (participantsTabAll) {
            participantsTabAll.addEventListener('click', () => {
                this.setParticipantsTab('all');
            });
        }
        
        if (participantsTabSpeakers) {
            participantsTabSpeakers.addEventListener('click', () => {
                this.setParticipantsTab('speakers');
            });
        }
        
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
                // Add class to body for CSS styling when keyboard appears
                document.body.classList.add('chat-input-focused');
                
                // Scroll chat to bottom when input is focused
                setTimeout(() => {
                    scrollChatToBottom();
                }, 100);
                
                // Use visual viewport API for Teams-like keyboard handling
                if (window.visualViewport) {
                    const handleViewportResize = () => {
                        const viewport = window.visualViewport;
                        const chatMessages = document.getElementById('chatMessages');
                        const chatInputContainer = document.querySelector('.chat-input-container');
                        
                        if (chatMessages && chatInputContainer) {
                            // Calculate keyboard height
                            const keyboardHeight = window.innerHeight - viewport.height;
                            
                            if (keyboardHeight > 0) {
                                // Input stays fixed at bottom (directly above keyboard - minimal gap)
                                const inputHeight = chatInputContainer.offsetHeight || 60;
                                const headerOffset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--mobile-header-offset')) || 176;
                                
                                // Calculate available height for messages (viewport - header - input)
                                const availableHeight = viewport.height - headerOffset - inputHeight;
                                
                                // Set messages container height to fill available space above input
                                chatMessages.style.height = `${availableHeight}px`;
                                chatMessages.style.maxHeight = `${availableHeight}px`;
                                chatMessages.style.paddingBottom = `${inputHeight + 10}px`; // Reduced padding - closer to input
                                
                                // Ensure input stays fixed at bottom (directly above keyboard)
                                chatInputContainer.style.bottom = '0px';
                                chatInputContainer.style.position = 'fixed';
                                chatInputContainer.style.zIndex = '200';
                                
                                // Ensure input is always visible
                                chatInputContainer.style.visibility = 'visible';
                                chatInputContainer.style.opacity = '1';
                                chatInputContainer.style.display = 'flex';
                                
                                // Scroll to bottom to show latest messages above typing bar
                                setTimeout(() => {
                                    scrollChatToBottom();
                                }, 150);
                            } else {
                                // Keyboard closed - reset to normal
                                chatMessages.style.height = '';
                                chatMessages.style.maxHeight = '';
                                chatMessages.style.paddingBottom = '';
                            }
                        }
                    };
                    
                    // Initial adjustment
                    handleViewportResize();
                    
                    window.visualViewport.addEventListener('resize', handleViewportResize);
                    window.visualViewport.addEventListener('scroll', handleViewportResize);
                    
                    // Clean up on blur
                    const cleanup = () => {
                        window.visualViewport.removeEventListener('resize', handleViewportResize);
                        window.visualViewport.removeEventListener('scroll', handleViewportResize);
                        
                        // Reset styles
                        const chatMessages = document.getElementById('chatMessages');
                        if (chatMessages) {
                            chatMessages.style.height = '';
                            chatMessages.style.maxHeight = '';
                            chatMessages.style.paddingBottom = '';
                        }
                    };
                    
                    chatInput.addEventListener('blur', cleanup, { once: true });
                }
            });
            
            // Improved blur handling
            chatInput.addEventListener('blur', () => {
                // Small delay to allow button clicks
                setTimeout(() => {
                    // Only remove focus class if not clicking send button
                    const sendBtn = document.getElementById('sendBtn');
                    if (!sendBtn || !sendBtn.matches(':active')) {
                        // Remove focus class when keyboard closes
                        document.body.classList.remove('chat-input-focused');
                        
                        // Reset chat messages padding
                        const chatMessages = document.getElementById('chatMessages');
                        if (chatMessages) {
                            chatMessages.style.paddingBottom = '';
                        }
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
            
            // Load chat messages (initial snapshot via REST)
            await this.loadChatMessages();

            // Note: subscribeRTDBChat() is called inside initRTDB() above —
            // do NOT call it again here or every message will appear twice.

            // Notify the SFU layer (sfu-client.js) that the room is ready.
            // The template listener sets window.__sfuClientActive = true immediately,
            // so any subsequent joinAudio() call will skip the P2P mesh.
            document.dispatchEvent(new CustomEvent('prayerRoomJoined', {
                detail: {
                    roomId:      this.roomId,
                    userId:      this.userId,
                    userName:    this.userName,
                    isSpeaker:   this.participantRole === 'speaker',
                    firebaseAuth: window.firebaseAuthInstance ?? null,
                },
            }));

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

        // Check if user is host
        this.isHost = data.host_id === this.userId;
        
        // Update UI immediately after setting isHost to hide/show correct buttons
        this.updateRoleUI();
        this.updateAudioControls();

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
                }, 500); // Poll every 500ms for faster updates
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
                }, 2000);
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

    subscribeFirestoreChat() {
        // Single source of truth for chat — mirrors exactly what the mobile app does.
        // Both platforms listen to the Firestore 'chat_messages' collection so all
        // messages are visible regardless of which client sent them.
        if (!firebase.firestore) return;
        if (!this.chatMessages) this.chatMessages = [];

        const db = firebase.firestore();
        this._firestoreChatUnsub = db.collection('chat_messages')
            .where('room_id', '==', this.roomId)
            .orderBy('timestamp', 'asc')
            .limitToLast(100)
            .onSnapshot((snapshot) => {
                snapshot.docChanges().forEach((change) => {
                    if (change.type !== 'added') return;
                    const data = change.doc.data();
                    const ts = data.timestamp;
                    const msgTimestamp = ts?.toMillis?.()
                        ?? (typeof ts === 'number' ? ts : Date.now());
                    const msg = {
                        id: change.doc.id,
                        user_id: data.user_id,
                        user_name: data.user_name,
                        message: data.message,
                        timestamp: msgTimestamp,
                        status: 'sent',
                    };
                    // Deduplicate against optimistic messages
                    const existingIndex = this.chatMessages.findIndex((m) =>
                        (m.id === msg.id) ||
                        (m.tempId && m.user_id === msg.user_id &&
                         Math.abs((typeof m.timestamp === 'number' ? m.timestamp : Date.now()) - msgTimestamp) < 2000 &&
                         m.message === msg.message)
                    );
                    if (existingIndex !== -1) {
                        this.chatMessages[existingIndex] = {
                            ...this.chatMessages[existingIndex], ...msg, tempId: undefined,
                        };
                    } else {
                        this.chatMessages.push(msg);
                    }
                    this.updateChatDisplay();
                });
            }, (err) => {
                console.warn('[chat] Firestore listener error:', err);
            });
    }

    subscribeRTDBChat() {
        if (!this.rtdb || !this.rtdbRefs.chat) return;
        
        // Ensure chatMessages array exists
        if (!this.chatMessages) {
            this.chatMessages = [];
        }
        
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
                (m.tempId && m.user_id === msg.user_id && Math.abs((m.timestamp instanceof Date ? m.timestamp.getTime() : (typeof m.timestamp === 'number' ? m.timestamp : new Date(m.timestamp).getTime())) - msgTimestamp) < 2000 && m.message === msg.message)
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
            
            // Ensure array is not cleared
            console.log('RTDB chat message received, total messages:', this.chatMessages.length);
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
        
        // Store all participants for filtering
        this.allParticipants = Array.isArray(participants) ? participants : [];
        
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
                    const userId = p.getAttribute('data-user-id');
                    if (userId) {
                        this.expandedParticipantIds.delete(userId);
                    }
                    p.classList.remove('expanded');
                });
            };
            // Use a small delay to allow card click handlers to fire first
            document.addEventListener('click', (e) => {
                setTimeout(() => {
                    this.participantClickOutsideHandler(e);
                }, 10);
            });
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
        
        // 4. Filter participants based on search and tab
        const filteredParticipants = this.getFilteredParticipants(participantList);
        
        // 5. Save expanded state before clearing (preserve expanded participants)
        const currentlyExpanded = participantsContainer.querySelectorAll('.participant.expanded');
        currentlyExpanded.forEach(el => {
            const userId = el.getAttribute('data-user-id');
            if (userId) {
                this.expandedParticipantIds.add(userId);
            }
        });
        
        // 6. Render participants list
        participantsContainer.innerHTML = '';
        if (filteredParticipants.length > 0) {
            filteredParticipants.forEach(participant => {
                const participantRole = participant.role || 'listener';
                const requestedSpeaker = participant.requested_role === 'speaker';
                const participantEl = document.createElement('div');
                participantEl.className = `participant ${participantRole === 'speaker' ? 'role-speaker' : 'role-listener'}`;
                participantEl.setAttribute('data-user-id', participant.user_id);
                
                if (participant.is_speaking && !participant.is_muted && participantRole === 'speaker') {
                    participantEl.classList.add('speaking');
                }
                // Add muted class to participant element for styling
                if (participant.is_muted) {
                    participantEl.classList.add('muted');
                    console.log(`🔇 Adding muted class to participant ${participant.user_name}`);
                } else {
                    participantEl.classList.remove('muted');
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
                // Always show muted badge if participant is muted
                if (participant.is_muted) {
                    badges.push('<span class="mute-indicator" style="display: inline-block !important; visibility: visible !important; opacity: 1 !important;">Muted</span>');
                    console.log(`🔇 Participant ${participant.user_name} is muted - adding muted badge`);
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
                
                // Restore expanded state if this participant was expanded before
                if (this.expandedParticipantIds.has(participant.user_id)) {
                    participantEl.classList.add('expanded');
                }
                
                // Add click handler for expand/collapse (only for host)
                if (this.isHost && controls.length > 0) {
                    participantEl.addEventListener('click', (e) => {
                        // Don't toggle if clicking on controls or action buttons
                        if (e.target.closest('.participant-controls') || e.target.closest('.participant-action')) {
                            return;
                        }
                        
                        // Stop event propagation to prevent click-outside handler from firing
                        e.stopPropagation();
                        e.preventDefault();
                        
                        // Close other expanded participants first
                        const allParticipants = participantsContainer.querySelectorAll('.participant.expanded');
                        allParticipants.forEach(p => {
                            if (p !== participantEl) {
                                const otherUserId = p.getAttribute('data-user-id');
                                if (otherUserId) {
                                    this.expandedParticipantIds.delete(otherUserId);
                                }
                                p.classList.remove('expanded');
                            }
                        });
                        
                        // Toggle this participant
                        const isCurrentlyExpanded = participantEl.classList.contains('expanded');
                        if (isCurrentlyExpanded) {
                            participantEl.classList.remove('expanded');
                            this.expandedParticipantIds.delete(participant.user_id);
                        } else {
                            participantEl.classList.add('expanded');
                            this.expandedParticipantIds.add(participant.user_id);
                        }
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
        
        this.updateAudioControls();
        this.updateRoleUI();
        this.updateStageArea(participantList);
        
        // Update participant count badge immediately
        this.updateParticipantBadge(participantList.length);
    }
    
    updateParticipantBadge(count) {
        const badge = document.getElementById('participantCountBadge');
        if (badge) {
            badge.textContent = count;
        }
    }
    
    getFilteredParticipants(participants = []) {
        let filtered = [...participants];
        
        // Filter by tab (all or speakers)
        if (this.participantsFilter.activeTab === 'speakers') {
            filtered = filtered.filter(p => (p.role || 'listener') === 'speaker');
        }
        
        // Filter by search query
        if (this.participantsFilter.searchQuery.trim()) {
            const query = this.participantsFilter.searchQuery.toLowerCase().trim();
            filtered = filtered.filter(p => {
                const name = (p.user_name || '').toLowerCase();
                return name.includes(query);
            });
        }
        
        return filtered;
    }
    
    filterParticipants(searchQuery) {
        this.participantsFilter.searchQuery = searchQuery;
        // Re-render with filtered participants
        this.updateParticipants(this.allParticipants);
    }
    
    setParticipantsTab(tab) {
        if (tab !== 'all' && tab !== 'speakers') {
            return;
        }
        
        this.participantsFilter.activeTab = tab;
        
        // Update tab buttons
        const tabAll = document.getElementById('participantsTabAll');
        const tabSpeakers = document.getElementById('participantsTabSpeakers');
        
        if (tabAll && tabSpeakers) {
            if (tab === 'all') {
                tabAll.classList.add('active');
                tabSpeakers.classList.remove('active');
            } else {
                tabAll.classList.remove('active');
                tabSpeakers.classList.add('active');
            }
        }
        
        // Re-render with filtered participants
        this.updateParticipants(this.allParticipants);
    }
    
    updateStageArea(participants = []) {
        const speakersGrid = document.getElementById('speakersGrid');
        if (!speakersGrid) {
            return;
        }
        
        // Filter only speakers
        const speakers = participants.filter(p => (p.role || 'listener') === 'speaker');
        
        speakersGrid.innerHTML = '';
        
        if (speakers.length === 0) {
            speakersGrid.innerHTML = '<div class="no-speakers">No speakers on stage</div>';
            return;
        }
        
        speakers.forEach(speaker => {
            const speakerTile = document.createElement('div');
            speakerTile.className = 'speaker-tile';
            if (speaker.is_speaking && !speaker.is_muted) {
                speakerTile.classList.add('active');
            }
            speakerTile.setAttribute('data-user-id', speaker.user_id);
            
            const truncatedName = this.truncateName(speaker.user_name, 20);
            const initials = truncatedName.charAt(0).toUpperCase();
            
            speakerTile.innerHTML = `
                <div class="participant-avatar" style="background: ${speaker.is_host ? 'linear-gradient(135deg, #3b82f6, #8b5cf6)' : 'linear-gradient(135deg, #3b82f6, #8b5cf6)'}">
                    ${initials}
                </div>
                <div class="participant-name">${this.escapeHtml(truncatedName)}</div>
                ${speaker.is_host ? '<div class="host-badge" style="margin-top: 8px;">Host</div>' : ''}
            `;
            
            speakersGrid.appendChild(speakerTile);
        });
    }
    
    async joinAudio(retryAttempt = 0, startUnmuted = false) {
        try {
            // SFU mode: audio/video is handled by sfu-client.js + the mediasoup SFU.
            // Skip the entire P2P mesh setup when the SFU client is active.
            if (window.__sfuClientActive) {
                this.isAudioEnabled = true;
                this.updateAudioControls();
                return;
            }

            // Prevent multiple simultaneous join attempts (but allow retries)
            if (this.isRetryingAudio && retryAttempt === 0) {
                console.log('🎤 Audio join already in progress, skipping...');
                return;
            }
            
            console.log(`🎤 Joining audio${retryAttempt > 0 ? ` (retry ${retryAttempt}/${this.maxAudioRetries})` : ''}...`);
            
            if (!this.roomId) {
                throw new Error('Room ID not available. Please refresh the page and try again.');
            }
            
            // Update UI immediately for instant feedback (only on first attempt)
            if (retryAttempt === 0) {
                this.isAudioEnabled = true;
                this.updateAudioControls();
            }
            
            // Set retry flag only on first attempt
            if (retryAttempt === 0) {
                this.isRetryingAudio = true;
            }
            
            // Check if getUserMedia is available
            let getUserMediaFn = null;
            
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                // Modern API
                getUserMediaFn = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
            } else {
                // Check for legacy getUserMedia
                const legacyGetUserMedia = navigator.getUserMedia || 
                                          navigator.webkitGetUserMedia || 
                                          navigator.mozGetUserMedia || 
                                          navigator.msGetUserMedia;
                
                if (!legacyGetUserMedia) {
                    throw new Error('getUserMedia is not supported in this browser. Please use a modern browser like Chrome, Firefox, or Safari.');
                }
                
                // Check if we're on HTTPS or localhost
                if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
                    throw new Error('Microphone access requires HTTPS. Please use a secure connection (https://) or localhost.');
                }
                
                // Wrap legacy API to return a Promise
                getUserMediaFn = (constraints) => {
                    return new Promise((resolve, reject) => {
                        legacyGetUserMedia.call(navigator, constraints, resolve, reject);
                    });
                };
            }
            
            // Request microphone permission with enhanced noise suppression
            console.log('🎤 Requesting microphone permission...');
            
            // Try with full constraints first, then fallback to simpler constraints if needed
            let constraints = {
                audio: {
                    // Core audio processing - these are critical for quality
                    echoCancellation: true,        // Required: Remove echo
                    noiseSuppression: true,        // Required: Remove background noise
                    autoGainControl: true,         // Required: Normalize volume levels
                    
                    // Audio quality settings (use ideal to allow fallback)
                    sampleRate: { ideal: 48000 },  // Higher sample rate for better quality
                    channelCount: { ideal: 1 },    // Mono is sufficient for voice
                    
                    // Latency optimization (use ideal to allow fallback)
                    latency: { ideal: 0.01 },      // 10ms latency target
                    
                    // Google-specific enhanced audio processing (Chrome/Edge) - optional
                    googEchoCancellation: true,
                    googAutoGainControl: true,
                    googNoiseSuppression: true,
                    googHighpassFilter: true,       // Remove low-frequency noise
                    googTypingNoiseDetection: true, // Detect and suppress typing
                    googAudioMirroring: false,
                    googDAEchoCancellation: true,   // Domain-specific echo cancellation
                    googNoiseReduction: true,       // Additional noise reduction
                    googEchoCancellation2: true,    // Enhanced echo cancellation
                    googNoiseSuppression2: true,    // Enhanced noise suppression
                    googAutoGainControl2: true      // Enhanced auto gain control
                },
                video: false
            };
            
            try {
                this.localStream = await getUserMediaFn(constraints);
            } catch (constraintError) {
                // If constraints fail, try with minimal constraints
                if (constraintError.name === 'OverconstrainedError' || constraintError.name === 'ConstraintNotSatisfiedError') {
                    console.warn('⚠️ Advanced constraints not supported, falling back to basic constraints:', constraintError);
                    try {
                        constraints = {
                            audio: {
                                echoCancellation: true,
                                noiseSuppression: true,
                                autoGainControl: true
                            },
                            video: false
                        };
                        this.localStream = await getUserMediaFn(constraints);
                    } catch (basicError) {
                        // If basic constraints also fail, try absolute minimal (for mobile)
                        console.warn('⚠️ Basic constraints failed, trying minimal constraints for mobile:', basicError);
                        constraints = {
                            audio: true,  // Minimal constraint - just request audio
                            video: false
                        };
                        this.localStream = await getUserMediaFn(constraints);
                    }
                } else if (constraintError.name === 'NotAllowedError' || constraintError.name === 'PermissionDeniedError') {
                    // Permission denied - provide helpful error message
                    console.error('❌ Microphone permission denied:', constraintError);
                    throw new Error('Microphone permission denied. Please allow microphone access in your browser settings and try again.');
                } else if (constraintError.name === 'NotFoundError' || constraintError.name === 'DevicesNotFoundError') {
                    // No microphone found
                    console.error('❌ No microphone found:', constraintError);
                    throw new Error('No microphone found. Please connect a microphone and try again.');
                } else {
                    // Re-throw other errors
                    throw constraintError;
                }
            }
            
            console.log('🎤 Microphone permission granted, stream obtained:', this.localStream);
            
            // Validate stream exists
            if (!this.localStream) {
                throw new Error('No audio stream received from microphone');
            }
            
            // Check for audio tracks
            const audioTracks = this.localStream.getAudioTracks();
            if (!audioTracks || audioTracks.length === 0) {
                throw new Error('No audio tracks found in microphone stream');
            }
            
            // Wait a moment for stream to become active (some browsers need time)
            let attempts = 0;
            while (!this.localStream.active && attempts < 10) {
                await new Promise(resolve => setTimeout(resolve, 100));
                attempts++;
            }
            
            // Final validation
            if (!this.localStream.active) {
                console.warn('⚠️ Stream not active after waiting, but continuing anyway');
            }
            
            // Ensure audio is enabled now that we have the stream
            this.isAudioEnabled = true;
            
            // Initialize mute state from server (check if user was previously muted)
            // Unless we're explicitly starting unmuted (e.g., from toggleMute for hosts)
            if (!startUnmuted) {
                await this.initializeMuteStateFromServer();
            } else {
                console.log('🎤 Starting audio unmuted (requested by caller)');
                this.isMuted = false;
            }
            
            // Monitor local audio track for mute/unmute events
            const localTrack = audioTracks[0];
            if (localTrack) {
                console.log('🎤 Local audio track:', {
                    id: localTrack.id,
                    label: localTrack.label,
                    enabled: localTrack.enabled,
                    muted: localTrack.muted,
                    readyState: localTrack.readyState
                });
                
                // Listen for hardware mute events (track.muted - read-only)
                localTrack.addEventListener('unmute', () => {
                    console.log('✅ Your microphone is now producing audio');
                });
                
                localTrack.addEventListener('mute', () => {
                    console.warn('⚠️ Your microphone stopped producing audio (track.muted = true)');
                    this.showError('Your microphone stopped working. Check if another app is using it.');
                });
                
                // Listen for enabled state changes (track.enabled - can be changed externally)
                localTrack.addEventListener('ended', () => {
                    console.warn('⚠️ Audio track ended');
                    this.isAudioEnabled = false;
                    this.updateAudioControls();
                });
                
                // Monitor enabled state changes (if track is disabled externally)
                let lastEnabledState = localTrack.enabled;
                const checkEnabledState = () => {
                    if (localTrack.enabled !== lastEnabledState) {
                        console.log(`🔧 Track enabled state changed: ${lastEnabledState} → ${localTrack.enabled}`);
                        lastEnabledState = localTrack.enabled;
                        
                        // Sync local state with track state
                        if (localTrack.enabled !== !this.isMuted) {
                            console.warn(`⚠️ Track enabled (${localTrack.enabled}) doesn't match mute state (${this.isMuted}), syncing...`);
                            this.isMuted = !localTrack.enabled;
                            this.updateAudioControls();
                        }
                    }
                };
                
                // Check enabled state periodically (every 500ms)
                this.trackEnabledCheckInterval = setInterval(checkEnabledState, 500);
                
                if (localTrack.muted) {
                    console.error('❌ Your microphone track is muted! It won\'t send audio.');
                    this.showError('Microphone not working. Close other apps using the mic and refresh.');
                }
                
                // Apply mute state from server/local state to track
                localTrack.enabled = !this.isMuted;
                console.log(`🔇 Applied mute state to track: enabled=${localTrack.enabled}, isMuted=${this.isMuted}`);
            } else {
                throw new Error('No audio track found in microphone stream');
            }
            
            // Ensure audio is enabled flag is set
            this.isAudioEnabled = true;
            
            // CRITICAL: Hide join audio button FIRST before updating controls
            const joinAudioBtn = document.getElementById('joinAudioBtn');
            const muteBtn = document.getElementById('muteBtn');
            
            if (joinAudioBtn) {
                joinAudioBtn.style.setProperty('display', 'none', 'important');
                joinAudioBtn.classList.add('hidden');
                joinAudioBtn.setAttribute('aria-hidden', 'true');
            }
            
            if (muteBtn) {
                muteBtn.style.setProperty('display', 'inline-flex', 'important');
                muteBtn.classList.remove('hidden');
                muteBtn.removeAttribute('aria-hidden');
            }
            
            // Update UI to show mute button now that stream is active
            this.updateAudioControls();
            console.log('🎤 Audio controls updated after stream obtained');
            
            // Final verification - ensure only one button is visible
            if (joinAudioBtn && muteBtn) {
                setTimeout(() => {
                    const joinVisible = joinAudioBtn.style.display !== 'none' && !joinAudioBtn.classList.contains('hidden');
                    const muteVisible = muteBtn.style.display !== 'none' && !muteBtn.classList.contains('hidden');
                    
                    if (joinVisible && muteVisible) {
                        console.error('❌ BOTH buttons visible after join! Forcing join audio to hide...');
                        joinAudioBtn.style.setProperty('display', 'none', 'important');
                        joinAudioBtn.classList.add('hidden');
                        joinAudioBtn.setAttribute('aria-hidden', 'true');
                    }
                }, 100); // Small delay to ensure DOM updates
            }
            
            // Start lightweight initialization immediately
            console.log('🎤 Starting fast initialization...');
            
            // Enable audio playback (non-blocking)
            this.enableAudioPlayback().catch(error => {
                console.warn('⚠️ Audio playback initialization failed:', error);
            });
            
            // Initialize WebRTC first (most critical for voice)
            try {
                await this.loadIceConfig();
            } catch (iceError) {
                console.warn('⚠️ ICE config loading failed, continuing with defaults:', iceError);
            }
            
            try {
                await this.initializeWebRTC();
                console.log('🎤 WebRTC initialized successfully');
                
                // Add stream to any existing peer connections that were created before audio was joined
                this.addStreamToExistingPeers().catch(error => {
                    console.error('❌ Error adding stream to existing peers:', error);
                });
                
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
            } catch (webrtcError) {
                console.error('❌ WebRTC initialization failed:', webrtcError);
                // Don't throw - allow audio to work even if WebRTC setup has issues
                // The stream is still valid and can be used
            }
            
            console.log('🎤 Audio join process initiated successfully');
            
            // Reset retry counter on success
            this.audioConnectionRetries = 0;
            this.isRetryingAudio = false;
            
        } catch (error) {
            console.error('🎤 Error joining audio:', error);
            this.isRetryingAudio = false;
            
            // Reset audio state if this was the first attempt (not a retry)
            if (retryAttempt === 0) {
                this.isAudioEnabled = false;
                this.updateAudioControls();
            }
            
            // Check if we should retry
            if (retryAttempt < this.maxAudioRetries) {
                const delay = this.audioRetryDelay * Math.pow(2, retryAttempt);
                console.log(`🔄 Retrying audio connection in ${delay}ms (attempt ${retryAttempt + 1}/${this.maxAudioRetries})`);
                
                // Show retry notification
                this.showAudioRetryNotification(retryAttempt + 1, this.maxAudioRetries, delay);
                
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, delay));
                
                // Retry the connection
                return this.joinAudio(retryAttempt + 1);
            } else {
                // Max retries reached - reset audio state and show error
                console.error(`❌ Max audio retries (${this.maxAudioRetries}) reached. Resetting audio state.`);
                this.handleAudioConnectionFailure(error);
            }
        }
    }
    
    handleAudioConnectionFailure(error) {
        // Reset audio state
        this.isAudioEnabled = false;
        this.isMuted = false;
        this.audioConnectionRetries = 0;
        this.isRetryingAudio = false; // Reset retry flag to allow new attempts
        this.muteStateSyncing = false; // Reset mute sync flag
        
        // Clean up track enabled check interval
        if (this.trackEnabledCheckInterval) {
            clearInterval(this.trackEnabledCheckInterval);
            this.trackEnabledCheckInterval = null;
        }
        
        // Clean up state validation interval
        if (this.stateValidationInterval) {
            clearInterval(this.stateValidationInterval);
            this.stateValidationInterval = null;
        }
        
        // Clean up any existing stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        // Clean up processed stream if it exists
        if (this.processedStream) {
            this.processedStream.getTracks().forEach(track => track.stop());
            this.processedStream = null;
        }
        
        // Update UI to show "Join Audio" button
        this.updateAudioControls();
        
        // Get user-friendly error message
        const errorMessage = this.getAudioErrorMessage(error);
        
        // Show persistent error notification with retry button
        this.showAudioErrorNotification(errorMessage);
    }
    
    getAudioErrorMessage(error) {
        const errorName = error.name || error.toString();
        const errorMessage = error.message || error.toString();
        
        // Check for specific error messages first
        if (errorMessage.includes('not supported')) {
            return errorMessage;
        }
        
        if (errorMessage.includes('HTTPS') || errorMessage.includes('secure connection')) {
            return errorMessage;
        }
        
        if (errorName.includes('NotAllowedError') || errorName.includes('PermissionDeniedError')) {
            return 'Microphone permission denied. Please allow microphone access in your browser settings and try again.';
        } else if (errorName.includes('NotFoundError') || errorName.includes('DevicesNotFoundError')) {
            return 'No microphone found. Please connect a microphone and try again.';
        } else if (errorName.includes('NotReadableError') || errorName.includes('TrackStartError')) {
            return 'Microphone is being used by another app. Please close other apps using the microphone and try again.';
        } else if (errorName.includes('OverconstrainedError') || errorName.includes('ConstraintNotSatisfiedError')) {
            return 'Microphone settings not supported. Using basic audio settings instead.';
        } else if (errorName.includes('AbortError')) {
            return 'Microphone access was interrupted. Please try again.';
        } else if (errorName.includes('Network')) {
            return 'Network error. Please check your internet connection and try again.';
        } else {
            return errorMessage || 'Failed to connect to audio. Please check your microphone permissions and try again.';
        }
    }
    
    showAudioRetryNotification(attempt, maxAttempts, delayMs) {
        const delaySeconds = Math.ceil(delayMs / 1000);
        const message = `Retrying audio connection... (${attempt}/${maxAttempts}) - ${delaySeconds}s`;
        this.showToast(message, 'info', 2000);
    }
    
    showAudioErrorNotification(message) {
        // Create a persistent error notification with retry button
        const existingNotification = document.getElementById('audio-error-notification');
        if (existingNotification) {
            existingNotification.remove();
        }
        
        const notification = document.createElement('div');
        notification.id = 'audio-error-notification';
        notification.className = 'audio-error-notification';
        notification.innerHTML = `
            <div class="audio-error-content">
                <div class="audio-error-icon">⚠️</div>
                <div class="audio-error-text">
                    <div class="audio-error-title">Audio Connection Failed</div>
                    <div class="audio-error-message">${this.escapeHtml(message)}</div>
                </div>
                <button class="audio-error-retry-btn" id="audioErrorRetryBtn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <polyline points="1 20 1 14 7 14"></polyline>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                    Rejoin Audio
                </button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Add retry button handler
        const retryBtn = document.getElementById('audioErrorRetryBtn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                notification.remove();
                this.joinAudio(0); // Start fresh retry
            });
        }
        
        // Auto-dismiss after 10 seconds (user can still click retry)
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.opacity = '0';
                notification.style.transition = 'opacity 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }
        }, 10000);
    }
    
    showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10000;
            animation: slideInRight 0.3s ease;
            max-width: 400px;
            font-weight: 500;
            font-size: 14px;
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
    
    async toggleMute() {
        // Prevent multiple simultaneous mute operations
        if (this.muteStateSyncing) {
            console.log('🔇 Mute operation already in progress, ignoring click');
            return;
        }
        
        // If audio is not enabled, user should use "Join Audio" button instead
        // Don't auto-enable audio from mute button - this was causing issues
        if (!this.isAudioEnabled) {
            console.log('🎤 Audio not enabled. Please use "Join Audio" button first.');
            this.showToast('Please click "Join Audio" to enable your microphone first.', 'info');
            return;
        }
        
        // Clear any pending debounce timeout (for future debouncing if needed)
        if (this.muteDebounceTimeout) {
            clearTimeout(this.muteDebounceTimeout);
            this.muteDebounceTimeout = null;
        }
        
        // Toggle mute state
        const newMuteState = !this.isMuted;
        
        // Update local state immediately for responsive UI
        this.isMuted = newMuteState;
        
        // Apply mute state to all audio tracks (including processed stream)
        this.applyMuteStateToTracks(newMuteState);
        
        // Update UI (single update point - removed redundant update)
        this.updateAudioControls();
        
        // Notify server (with error handling and retry)
        this.notifyMuteStatus(newMuteState).catch(error => {
            console.error('Failed to sync mute state:', error);
            // Show user feedback
            this.showToast(`Failed to ${newMuteState ? 'mute' : 'unmute'}. Please try again.`, 'error');
            // Rollback local state on failure
            this.isMuted = !newMuteState;
            this.applyMuteStateToTracks(!newMuteState);
            this.updateAudioControls();
        });
    }
    
    applyMuteStateToTracks(isMuted) {
        // Apply mute state to all audio tracks in the stream
        if (!this.localStream) {
            console.warn('⚠️ No local stream available to mute/unmute');
            return;
        }
        
        const audioTracks = this.localStream.getAudioTracks();
        if (audioTracks.length === 0) {
            console.warn('⚠️ No audio tracks found in stream');
            return;
        }
        
        const expectedEnabled = !isMuted;
        
        audioTracks.forEach((track, index) => {
            const wasEnabled = track.enabled;
            track.enabled = expectedEnabled;
            
            console.log(`🔇 Track ${index}: enabled=${track.enabled} (was ${wasEnabled}, mute=${isMuted})`);
            
            // Validate the change succeeded (track.enabled should equal expectedEnabled)
            if (track.enabled !== expectedEnabled) {
                console.error(`❌ Failed to ${isMuted ? 'mute' : 'unmute'} track ${index}: enabled=${track.enabled}, expected=${expectedEnabled}`);
            }
        });
        
        // Also update processed stream if it exists (from audio processing chain)
        if (this.processedStream) {
            const processedTracks = this.processedStream.getAudioTracks();
            processedTracks.forEach((track, index) => {
                const wasEnabled = track.enabled;
                track.enabled = expectedEnabled;
                console.log(`🔇 Processed track ${index}: enabled=${track.enabled} (was ${wasEnabled}, mute=${isMuted})`);
            });
        }
    }
    
    updateAudioControls() {
        const joinAudioBtn = document.getElementById('joinAudioBtn');
        const muteBtn = document.getElementById('muteBtn');
        const controlButtons = document.querySelector('.header-actions .control-buttons');
        
        console.log('🔧 updateAudioControls called:', {
            isAudioEnabled: this.isAudioEnabled,
            isMuted: this.isMuted,
            joinAudioBtn: !!joinAudioBtn,
            muteBtn: !!muteBtn,
            participantRole: this.participantRole,
            isHost: this.isHost
        });
        
        if (!joinAudioBtn || !muteBtn) {
            console.warn('⚠️ Missing audio control buttons:', { joinAudioBtn: !!joinAudioBtn, muteBtn: !!muteBtn });
            return;
        }

        // Set data attribute on container for CSS targeting
        if (controlButtons) {
            controlButtons.setAttribute('data-audio-enabled', this.isAudioEnabled ? 'true' : 'false');
        }

        // CRITICAL: Always ensure only one button is visible at a time
        // Use multiple methods to ensure hiding works
        // Hosts now use the same flow as regular users - show Join Audio when not enabled
        
        // If audio is enabled (microphone is active), show mute button regardless of role (including hosts)
        if (this.isAudioEnabled) {
            // CRITICAL: Hide join audio button using MULTIPLE methods
            joinAudioBtn.style.setProperty('display', 'none', 'important');
            joinAudioBtn.style.setProperty('visibility', 'hidden', 'important');
            joinAudioBtn.style.setProperty('opacity', '0', 'important');
            joinAudioBtn.style.setProperty('pointer-events', 'none', 'important');
            joinAudioBtn.classList.add('hidden');
            joinAudioBtn.setAttribute('aria-hidden', 'true');
            
            // Show mute button
            muteBtn.style.setProperty('display', 'inline-flex', 'important');
            muteBtn.style.setProperty('visibility', 'visible', 'important');
            muteBtn.style.setProperty('opacity', '1', 'important');
            muteBtn.style.setProperty('pointer-events', 'auto', 'important');
            muteBtn.classList.remove('hidden');
            muteBtn.removeAttribute('aria-hidden');
            
            // Update mute button state
            this.updateMuteButtonState(muteBtn);
        } else {
            // Audio not enabled - show join button, hide mute button
            // CRITICAL: Hide mute button using MULTIPLE methods
            muteBtn.style.setProperty('display', 'none', 'important');
            muteBtn.style.setProperty('visibility', 'hidden', 'important');
            muteBtn.style.setProperty('opacity', '0', 'important');
            muteBtn.style.setProperty('pointer-events', 'none', 'important');
            muteBtn.classList.add('hidden');
            muteBtn.setAttribute('aria-hidden', 'true');
            
            // Show join button for all users (including hosts)
            joinAudioBtn.style.setProperty('display', 'inline-flex', 'important');
            joinAudioBtn.style.setProperty('visibility', 'visible', 'important');
            joinAudioBtn.style.setProperty('opacity', '1', 'important');
            joinAudioBtn.style.setProperty('pointer-events', 'auto', 'important');
            joinAudioBtn.classList.remove('hidden');
            joinAudioBtn.removeAttribute('aria-hidden');
        }
        
        // Final verification - ensure only one button is visible
        setTimeout(() => {
            const joinVisible = joinAudioBtn.style.display !== 'none' && 
                               !joinAudioBtn.classList.contains('hidden') &&
                               joinAudioBtn.style.visibility !== 'hidden';
            const muteVisible = muteBtn.style.display !== 'none' && 
                               !muteBtn.classList.contains('hidden') &&
                               muteBtn.style.visibility !== 'hidden';
            
            if (joinVisible && muteVisible) {
                console.error('❌ BOTH buttons visible! Forcing join audio to hide...');
                joinAudioBtn.style.setProperty('display', 'none', 'important');
                joinAudioBtn.style.setProperty('visibility', 'hidden', 'important');
                joinAudioBtn.classList.add('hidden');
            }
        }, 50);
        
        console.log('🔧 Audio controls updated:', {
            joinAudioDisplay: joinAudioBtn.style.display,
            joinAudioVisibility: joinAudioBtn.style.visibility,
            joinAudioHidden: joinAudioBtn.classList.contains('hidden'),
            muteDisplay: muteBtn.style.display,
            muteVisibility: muteBtn.style.visibility,
            muteHidden: muteBtn.classList.contains('hidden'),
            isAudioEnabled: this.isAudioEnabled,
            isMuted: this.isMuted
        });

        this.updateRoleUI();
    }
    
    updateMuteButtonState(muteBtn) {
        if (!muteBtn) return;
        
        // Mute button should only be visible when audio is enabled
        // If audio is not enabled, this function shouldn't be called
        // (Join Audio button should be shown instead)
        
        if (this.isMuted) {
            muteBtn.classList.add('muted');
            muteBtn.setAttribute('aria-pressed', 'true');
            muteBtn.setAttribute('aria-label', 'Unmute microphone');
            muteBtn.setAttribute('title', 'Unmute microphone');
        } else {
            muteBtn.classList.remove('muted');
            muteBtn.setAttribute('aria-pressed', 'false');
            muteBtn.setAttribute('aria-label', 'Mute microphone');
            muteBtn.setAttribute('title', 'Mute microphone');
        }
    }
    
    async notifyMuteStatus(isMuted) {
        // Use the new self-mute endpoint (works for all users, not just host)
        if (this.muteStateSyncing) {
            console.warn('⚠️ Mute status sync already in progress, skipping duplicate request');
            return;
        }
        
        this.muteStateSyncing = true;
        
        try {
            const response = await fetch(`/api/prayer-room/${this.roomId}/self-mute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    is_muted: isMuted
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData?.error || `HTTP ${response.status}`);
            }
            
            const result = await response.json();
            console.log(`✅ Mute status synced to server: ${isMuted}`);
            
            // Validate server response matches local state
            if (result?.is_muted !== isMuted) {
                console.warn(`⚠️ Server mute state (${result?.is_muted}) doesn't match local state (${isMuted}), syncing...`);
                // Sync local state to server state (server is source of truth)
                this.isMuted = result.is_muted ?? isMuted;
                this.applyMuteStateToTracks(this.isMuted);
                this.updateAudioControls();
            }
            
            return result;
            
        } catch (error) {
            console.error('❌ Error updating mute status:', error);
            throw error; // Re-throw for caller to handle
        } finally {
            this.muteStateSyncing = false;
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
            // Clean up intervals
            if (this.trackEnabledCheckInterval) {
                clearInterval(this.trackEnabledCheckInterval);
                this.trackEnabledCheckInterval = null;
            }
            
            if (this.stateValidationInterval) {
                clearInterval(this.stateValidationInterval);
                this.stateValidationInterval = null;
            }
            
            // Clear debounce timeout
            if (this.muteDebounceTimeout) {
                clearTimeout(this.muteDebounceTimeout);
                this.muteDebounceTimeout = null;
            }
            
            // Reset mute state
            this.muteStateSyncing = false;
            
            // Stop local stream
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => track.stop());
            }
            
            // Stop processed stream if it exists
            if (this.processedStream) {
                this.processedStream.getTracks().forEach(track => track.stop());
                this.processedStream = null;
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
            
            // Detach RTDB chat listener
            if (this.rtdbRefs && this.rtdbRefs.chat) {
                this.rtdbRefs.chat.off('child_added');
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
            // Flask REST → writes to Firestore (persistence) + RTDB (delivery).
            // The RTDB child_added listener in subscribeRTDBChat() delivers
            // the message back in real-time on all clients.
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
        // Ensure chatMessages array exists
        if (!this.chatMessages) {
            this.chatMessages = [];
        }
        
        // Show loading skeletons on first load only
        if (this.chatMessages.length === 0) {
            this.showLoadingSkeletons(3);
        }
        
        // Preserve ALL existing messages (not just optimistic ones)
        const existingMessages = [...(this.chatMessages || [])];
        const optimisticMessages = existingMessages.filter(m => m.tempId);
        
        try {
            const response = await fetch(`/api/prayer-room/${this.roomId}/chat`, {
                credentials: 'include'
            });
            if (!response.ok) {
                console.warn('Chat fetch not ok, preserving current messages');
                return; // keep current UI on transient HTTP errors
            }
            const data = await response.json();
            
            console.log('Chat messages loaded from server:', data.messages ? data.messages.length : 0, 'existing:', existingMessages.length);
            
            if (data && data.success && Array.isArray(data.messages)) {
                // Merge server messages with existing messages, avoiding duplicates
                const serverMessages = data.messages.map(msg => ({
                    id: msg.id || msg.message_id,
                    user_id: msg.user_id,
                    user_name: msg.user_name,
                    message: msg.message,
                    timestamp: msg.timestamp ? (typeof msg.timestamp === 'number' ? msg.timestamp : new Date(msg.timestamp).getTime()) : Date.now(),
                    message_type: msg.message_type,
                    status: 'sent'
                }));
                
                // Merge: start with existing messages, add server messages that don't exist
                const mergedMessages = [...existingMessages];
                serverMessages.forEach(serverMsg => {
                    const existingIndex = mergedMessages.findIndex(m => 
                        (m.id === serverMsg.id) || 
                        (m.tempId && m.user_id === serverMsg.user_id && Math.abs((m.timestamp instanceof Date ? m.timestamp.getTime() : (typeof m.timestamp === 'number' ? m.timestamp : new Date(m.timestamp).getTime())) - serverMsg.timestamp) < 2000 && m.message === serverMsg.message)
                    );
                    
                    if (existingIndex === -1) {
                        // New message, add it
                        mergedMessages.push(serverMsg);
                    } else {
                        // Existing message, update optimistic message with real data if needed
                        const existingMsg = mergedMessages[existingIndex];
                        if (existingMsg.tempId) {
                            mergedMessages[existingIndex] = {
                                ...existingMsg,
                                ...serverMsg,
                                tempId: undefined
                            };
                        }
                        // If message already has real ID, keep it as is
                    }
                });
                
                this.chatMessages = mergedMessages;
                console.log('Chat messages array after merge:', this.chatMessages.length);
                this.updateChatDisplay();
            } else {
                console.warn('Chat payload invalid or unsuccessful, preserving current messages');
                // Do not clear UI on bad payloads - keep existing messages
                if (existingMessages.length > 0) {
                    this.chatMessages = existingMessages;
                    this.updateChatDisplay();
                }
            }
            
        } catch (error) {
            console.warn('Chat load error, preserving current messages:', error);
            // Do not clear UI on errors - preserve existing messages
            if (existingMessages.length > 0) {
                this.chatMessages = existingMessages;
            }
        }
        
        // Polling is managed centrally by setupChatPolling via addPollingInterval('chat', ...)
    }
    
    updateChatDisplay() {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) {
            console.error('Chat messages container not found in updateChatDisplay');
            return;
        }
        
        // Ensure chatMessages array exists
        if (!this.chatMessages) {
            this.chatMessages = [];
        }
        
        console.log('Updating chat display with messages:', this.chatMessages.length);
        
        // Clear loading skeletons
        const skeletons = chatMessages.querySelectorAll('.message-skeleton');
        skeletons.forEach(s => s.remove());
        
        // Signal that we're updating to prevent MutationObserver interference
        if (typeof window.chatUpdateInProgress === 'function') {
            window.chatUpdateInProgress();
        }
        
        // Save current scroll position before clearing
        const wasNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 100;
        const savedScrollTop = chatMessages.scrollTop;
        
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
            
            console.log('Chat messages rendered successfully, total:', this.chatMessages.length);
            
            // Scroll to bottom after rendering (only if user is near bottom or it's mobile)
            requestAnimationFrame(() => {
                setTimeout(() => {
                    const chatMessagesEl = document.getElementById('chatMessages');
                    if (chatMessagesEl) {
                        // On mobile, always scroll to bottom
                        if (window.innerWidth <= 768) {
                            scrollChatToBottom();
                        } else {
                            // On desktop, only scroll if user was near bottom before update
                            if (wasNearBottom) {
                                scrollChatToBottom();
                            } else {
                                // Restore scroll position if user was reading older messages
                                chatMessagesEl.scrollTop = savedScrollTop;
                            }
                        }
                    }
                }, 50);
            });
        } else {
            console.log('No chat messages - chat container is empty');
            // Don't show empty state - just leave it empty
        }
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
    
    async addStreamToExistingPeers() {
        // Recreate peer connections with the stream instead of trying to add tracks
        // This is more reliable with SimplePeer which handles streams best at creation time
        if (!this.localStream) {
            console.warn('[WebRTC] Cannot add stream to peers: no local stream available');
            return;
        }
        
        console.log(`[WebRTC] Recreating ${this.peers.size} peer connection(s) with audio stream`);
        
        // Collect participant IDs that need to be recreated
        const participantsToRecreate = [];
        
        this.peers.forEach((peer, participantId) => {
            try {
                if (peer._pc && peer._pc.getSenders) {
                    const senders = peer._pc.getSenders();
                    const hasAudio = senders.some(sender => sender.track?.kind === 'audio');
                    
                    if (!hasAudio) {
                        console.log(`[WebRTC] Peer ${participantId} missing audio, will recreate connection`);
                        participantsToRecreate.push(participantId);
                    } else {
                        console.log(`[WebRTC] Peer ${participantId} already has audio track`);
                    }
                } else {
                    // If we can't check senders, assume we need to recreate
                    console.log(`[WebRTC] Cannot check senders for ${participantId}, will recreate connection`);
                    participantsToRecreate.push(participantId);
                }
            } catch (error) {
                console.error(`[WebRTC] Error checking peer ${participantId}:`, error);
                // On error, recreate to be safe
                participantsToRecreate.push(participantId);
            }
        });
        
        // Recreate connections for participants without audio
        // Use for...of loop to properly handle async operations
        for (const participantId of participantsToRecreate) {
            try {
                console.log(`🔄 [WebRTC] Recreating peer connection for ${participantId} with audio stream`);
                
                // Clean up the old connection
                this.cleanupPeerConnection(participantId);
                
                // Wait longer for cleanup to complete and allow remote peer to detect disconnection
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Double-check that the peer was actually removed
                if (this.peers.has(participantId)) {
                    console.warn(`[WebRTC] Peer ${participantId} still exists after cleanup, skipping recreation`);
                    continue;
                }
                
                // Determine if we should initiate (same logic as before)
                const isInitiator = this.userId < participantId;
                
                // Create new connection with stream
                await this.createPeerConnection(participantId, isInitiator);
                
                // Wait a bit for the connection to establish before moving to next
                await new Promise(resolve => setTimeout(resolve, 200));
                
                console.log(`✅ [WebRTC] Successfully recreated peer connection for ${participantId}`);
            } catch (error) {
                console.error(`❌ [WebRTC] Error recreating peer connection for ${participantId}:`, error);
            }
        }
        
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
                
                // Process any queued candidates now that the connection is ready
                // Wait a bit for the remote description to be set
                setTimeout(() => {
                    this.processQueuedCandidates(fromUser);
                }, 100);
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
            
            // Process any queued candidates now that the connection is ready
            // Wait a bit for the remote description to be set
            setTimeout(() => {
                this.processQueuedCandidates(fromUser);
            }, 100);

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
                    try {
                        peer.signal(candidate.candidate);
                        console.log(`✅ Added candidate to peer connection for ${candidate.from_user}`);
                    } catch (error) {
                        console.warn(`⚠️ Failed to add candidate to peer connection for ${candidate.from_user}:`, error);
                        // Queue for retry if signaling fails
                        this.queueCandidateForLater(candidate);
                    }
                } else {
                    // Peer connection exists but not ready yet - queue the candidate
                    console.log(`📡 Peer connection for ${candidate.from_user} not ready yet, queuing candidate`);
                    this.queueCandidateForLater(candidate);
                }
            } else {
                // No peer connection yet - this is normal, candidates can arrive before connection is created
                console.log(`📡 No peer connection yet for ${candidate.from_user}, queuing candidate (this is normal)`);
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

    // NOTE: Duplicate handleRemoteStream removed — the canonical implementation is above at line ~4162

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
            
            // Start adaptive noise gate adjustment (non-blocking)
            setTimeout(() => {
                this.startAdaptiveNoiseGate();
            }, 150);
            
            // Start audio quality monitoring (non-blocking)
            setTimeout(() => {
                this.startAudioQualityMonitoring();
            }, 200);
            
            // Start state validation (non-blocking)
            setTimeout(() => {
                this.startStateValidation();
            }, 500);
            
            console.log('🎛️ Advanced audio processing initialized');
            
        } catch (error) {
            console.error('🎛️ Error initializing advanced audio processing:', error);
        }
    }

    async setupAudioProcessingChain() {
        try {
            if (!this.localStream || !this.audioContext) {
                console.warn('🎛️ Cannot setup audio processing: missing stream or context');
                return;
            }
            
            // Get the audio track
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (!audioTrack) {
                console.warn('🎛️ No audio track found in stream');
                return;
            }
            
            // CRITICAL: Preserve current mute state before processing
            const currentMuteState = this.isMuted;
            const originalTrackEnabled = audioTrack.enabled;
            
            console.log(`🎛️ Preserving mute state before processing: isMuted=${currentMuteState}, track.enabled=${originalTrackEnabled}`);
            
            // Store original stream for fallback
            const originalStream = this.localStream;
            
            // Create media stream source
            const source = this.audioContext.createMediaStreamSource(this.localStream);
            
            // Create audio processing nodes
            this.gainController = this.audioContext.createGain();
            this.gainController.gain.value = 1.0; // Start at unity gain
            
            this.audioAnalyser = this.audioContext.createAnalyser();
            
            // Configure analyser for better frequency analysis
            this.audioAnalyser.fftSize = 2048;
            this.audioAnalyser.smoothingTimeConstant = 0.7; // Slightly less smoothing for better detection
            
            // Create noise suppression using Web Audio API
            this.noiseSuppressor = this.createNoiseSuppressor();
            
            // Create echo cancellation
            this.echoCanceller = this.createEchoCanceller();
            
            // Create audio enhancer
            this.audioEnhancer = this.createAudioEnhancer();
            
            // Connect the audio processing chain
            // Source -> Gain -> Noise Suppressor -> Echo Canceller -> Enhancer -> Analyser
            source.connect(this.gainController);
            this.gainController.connect(this.noiseSuppressor);
            this.noiseSuppressor.connect(this.echoCanceller);
            this.echoCanceller.connect(this.audioEnhancer);
            
            // Connect enhancer to analyser for monitoring (parallel, not in chain)
            this.audioEnhancer.connect(this.audioAnalyser);
            
            // Create destination for processed audio
            const destination = this.audioContext.createMediaStreamDestination();
            this.audioEnhancer.connect(destination);
            
            // Store processed stream reference
            this.processedStream = destination.stream;
            
            // Replace the original stream with processed stream
            const processedTracks = destination.stream.getAudioTracks();
            if (processedTracks.length > 0) {
                // CRITICAL: Apply preserved mute state to processed tracks
                processedTracks.forEach(processedTrack => {
                    processedTrack.enabled = !currentMuteState; // Apply mute state
                    console.log(`🎛️ Applied mute state to processed track: enabled=${processedTrack.enabled}, isMuted=${currentMuteState}`);
                });
                
                // Replace stream
                this.localStream = destination.stream;
                
                // Update all peer connections with new stream
                this.updatePeerConnectionsWithProcessedStream();
                
                // Verify mute state is preserved
                const verifyTracks = this.localStream.getAudioTracks();
                const allTracksMatchState = verifyTracks.every(track => track.enabled === !currentMuteState);
                
                if (!allTracksMatchState) {
                    console.error('❌ Mute state not properly applied to processed tracks!');
                    // Force apply mute state again
                    this.applyMuteStateToTracks(currentMuteState);
                } else {
                    console.log('✅ Mute state successfully preserved in processed stream');
                }
                
                console.log('🎛️ Audio processing chain created and applied with mute state preserved');
            } else {
                console.warn('🎛️ No audio tracks in processed stream, using original');
            }
            
        } catch (error) {
            console.error('🎛️ Error setting up audio processing chain:', error);
            // Fallback: continue with original stream
            console.log('🎛️ Falling back to original stream without processing');
            // Ensure mute state is still applied
            this.applyMuteStateToTracks(this.isMuted);
        }
    }
    
    updatePeerConnectionsWithProcessedStream() {
        // Update all existing peer connections with the processed stream
        if (!this.localStream) return;
        
        const audioTracks = this.localStream.getAudioTracks();
        if (audioTracks.length === 0) return;
        
        // CRITICAL: Preserve mute state when replacing tracks
        const muteState = this.isMuted;
        
        Object.values(this.peers).forEach(peer => {
            if (peer.connection && peer.connection.getSenders) {
                const senders = peer.connection.getSenders();
                const audioSender = senders.find(sender => 
                    sender.track && sender.track.kind === 'audio'
                );
                
                if (audioSender && audioSender.replaceTrack) {
                    // Ensure track has correct mute state before replacing
                    const trackToReplace = audioTracks[0];
                    trackToReplace.enabled = !muteState;
                    
                    audioSender.replaceTrack(trackToReplace).catch(error => {
                        console.warn('🎛️ Error replacing track in peer connection:', error);
                    });
                }
            }
        });
    }
    
    async initializeMuteStateFromServer() {
        try {
            // Load participants to get current mute state from server
            const response = await fetch(`/api/prayer-room/${this.roomId}/participants`, {
                method: 'GET',
                credentials: 'include'
            });
            
            if (response.ok) {
                const data = await response.json();
                const participants = data.participants || [];
                
                // Find current user's participant data
                const currentUserParticipant = participants.find(p => p.user_id === this.userId);
                
                if (currentUserParticipant && currentUserParticipant.hasOwnProperty('is_muted')) {
                    const serverMuteState = currentUserParticipant.is_muted || false;
                    
                    // Sync local state with server state
                    if (this.isMuted !== serverMuteState) {
                        console.log(`🔄 Syncing mute state from server: local=${this.isMuted}, server=${serverMuteState}`);
                        this.isMuted = serverMuteState;
                        
                        // Apply mute state to tracks
                        this.applyMuteStateToTracks(serverMuteState);
                        
                        // Update UI
                        this.updateAudioControls();
                        
                        console.log(`✅ Mute state initialized from server: ${serverMuteState ? 'muted' : 'unmuted'}`);
                    } else {
                        console.log(`✅ Mute state already in sync: ${serverMuteState ? 'muted' : 'unmuted'}`);
                    }
                } else {
                    console.log('ℹ️ No mute state found on server, using default (unmuted)');
                }
            } else {
                console.warn('⚠️ Failed to load participants to initialize mute state');
            }
        } catch (error) {
            console.error('❌ Error initializing mute state from server:', error);
            // Continue with default state (unmuted)
        }
    }

    createNoiseSuppressor() {
        try {
            // Create a gain node for overall control
            const inputGain = this.audioContext.createGain();
            inputGain.gain.value = 1.0;
            
            // Create a high-pass filter to remove low-frequency noise (rumble, wind, etc.)
            const highPassFilter = this.audioContext.createBiquadFilter();
            highPassFilter.type = 'highpass';
            highPassFilter.frequency.value = 100; // Increased from 80Hz - better noise removal
            highPassFilter.Q.value = 0.7; // Slightly gentler slope
            
            // Create a low-pass filter to remove high-frequency noise (hiss, static)
            const lowPassFilter = this.audioContext.createBiquadFilter();
            lowPassFilter.type = 'lowpass';
            lowPassFilter.frequency.value = 7000; // Reduced from 8kHz - focus on voice range
            lowPassFilter.Q.value = 0.7; // Slightly gentler slope
            
            // Create notch filters for common noise frequencies
            const notch60Hz = this.audioContext.createBiquadFilter();
            notch60Hz.type = 'notch';
            notch60Hz.frequency.value = 60; // Remove 60Hz electrical hum
            notch60Hz.Q.value = 30;
            
            const notch50Hz = this.audioContext.createBiquadFilter();
            notch50Hz.type = 'notch';
            notch50Hz.frequency.value = 50; // Remove 50Hz electrical hum (EU/Asia)
            notch50Hz.Q.value = 30;
            
            // Create a bandpass filter to focus on voice frequencies (300Hz - 3400Hz)
            const voiceBandpass = this.audioContext.createBiquadFilter();
            voiceBandpass.type = 'bandpass';
            voiceBandpass.frequency.value = 1850; // Center of voice range
            voiceBandpass.Q.value = 0.5; // Wide band for natural sound
            
            // Create an adaptive noise gate
            const noiseGate = this.audioContext.createDynamicsCompressor();
            noiseGate.threshold.value = -50; // Lower threshold for better noise gating
            noiseGate.knee.value = 5; // Sharp knee for noise gate effect
            noiseGate.ratio.value = 20; // High ratio = gate effect
            noiseGate.attack.value = 0.001; // Fast attack
            noiseGate.release.value = 0.1; // Quick release
            
            // Connect filters in series for optimal noise reduction
            inputGain.connect(highPassFilter);
            highPassFilter.connect(notch60Hz);
            notch60Hz.connect(notch50Hz);
            notch50Hz.connect(lowPassFilter);
            lowPassFilter.connect(voiceBandpass);
            voiceBandpass.connect(noiseGate);
            
            // Store reference for dynamic adjustment
            this.noiseGateNode = noiseGate;
            this.voiceBandpassNode = voiceBandpass;
            
            console.log('🎛️ Enhanced noise suppressor created with adaptive gating');
            return inputGain;
            
        } catch (error) {
            console.error('🎛️ Error creating noise suppressor:', error);
            return this.audioContext.createGain(); // Fallback to simple gain
        }
    }

    createEchoCanceller() {
        try {
            // Create a multi-stage compressor for better echo reduction
            const compressor1 = this.audioContext.createDynamicsCompressor();
            compressor1.threshold.value = -30; // Lower threshold
            compressor1.knee.value = 10; // Sharper knee
            compressor1.ratio.value = 8; // Moderate ratio
            compressor1.attack.value = 0.001; // Very fast attack to catch echoes
            compressor1.release.value = 0.15; // Quick release
            
            // Second stage compressor for fine-tuning
            const compressor2 = this.audioContext.createDynamicsCompressor();
            compressor2.threshold.value = -20;
            compressor2.knee.value = 5;
            compressor2.ratio.value = 4;
            compressor2.attack.value = 0.003;
            compressor2.release.value = 0.1;
            
            // Connect compressors in series
            compressor1.connect(compressor2);
            
            // Store reference for dynamic adjustment
            this.echoCompressor1 = compressor1;
            this.echoCompressor2 = compressor2;
            
            console.log('🎛️ Enhanced echo canceller created with multi-stage compression');
            return compressor1;
            
        } catch (error) {
            console.error('🎛️ Error creating echo canceller:', error);
            return this.audioContext.createGain(); // Fallback to simple gain
        }
    }

    createAudioEnhancer() {
        try {
            // Create a multi-band equalizer for voice enhancement
            // Boost frequencies where human voice is strongest (300Hz - 3400Hz)
            const eqLow = this.audioContext.createBiquadFilter();
            eqLow.type = 'peaking';
            eqLow.frequency.value = 500; // Lower voice frequencies
            eqLow.gain.value = 2; // Slight boost
            eqLow.Q.value = 1;
            
            const eqMid = this.audioContext.createBiquadFilter();
            eqMid.type = 'peaking';
            eqMid.frequency.value = 1500; // Mid voice frequencies (most important)
            eqMid.gain.value = 4; // Stronger boost for clarity
            eqMid.Q.value = 1.5;
            
            const eqHigh = this.audioContext.createBiquadFilter();
            eqHigh.type = 'peaking';
            eqHigh.frequency.value = 3000; // Higher voice frequencies
            eqHigh.gain.value = 2; // Slight boost
            eqHigh.Q.value = 1;
            
            // Create a gentle compressor for consistent volume
            const compressor = this.audioContext.createDynamicsCompressor();
            compressor.threshold.value = -18; // Slightly lower threshold
            compressor.knee.value = 15; // Softer knee
            compressor.ratio.value = 3; // Gentler ratio for natural sound
            compressor.attack.value = 0.005; // Quick attack
            compressor.release.value = 0.08; // Quick release
            
            // Connect EQ bands in series, then to compressor
            eqLow.connect(eqMid);
            eqMid.connect(eqHigh);
            eqHigh.connect(compressor);
            
            // Store references for dynamic adjustment
            this.eqLow = eqLow;
            this.eqMid = eqMid;
            this.eqHigh = eqHigh;
            this.enhancerCompressor = compressor;
            
            console.log('🎛️ Enhanced audio enhancer created with multi-band EQ');
            return eqLow;
            
        } catch (error) {
            console.error('🎛️ Error creating audio enhancer:', error);
            return this.audioContext.createGain(); // Fallback to simple gain
        }
    }
    
    startAdaptiveNoiseGate() {
        if (!this.audioAnalyser || !this.noiseGateNode) {
            console.warn('🎛️ Cannot start adaptive noise gate: missing analyser or gate node');
            return;
        }
        
        // Prevent multiple instances
        if (this.adaptiveNoiseGateActive) {
            return;
        }
        
        this.adaptiveNoiseGateActive = true;
        const bufferLength = this.audioAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        let backgroundNoiseLevel = 0;
        let samplesCollected = 0;
        const calibrationSamples = 30; // Collect 30 samples (about 1 second) to calibrate
        
        const adjustNoiseGate = () => {
            if (!this.adaptiveNoiseGateActive || !this.noiseGateNode) {
                return;
            }
            
            this.audioAnalyser.getByteFrequencyData(dataArray);
            
            // Calculate average noise level in low frequencies (background noise)
            const noiseFreqRange = dataArray.slice(0, Math.floor(bufferLength * 0.1)); // First 10% of frequencies
            const currentNoiseLevel = noiseFreqRange.reduce((a, b) => a + b, 0) / noiseFreqRange.length;
            
            // Calibration phase: collect samples to determine baseline noise
            if (samplesCollected < calibrationSamples) {
                backgroundNoiseLevel = (backgroundNoiseLevel * samplesCollected + currentNoiseLevel) / (samplesCollected + 1);
                samplesCollected++;
                
                // Set initial gate threshold based on calibration
                if (samplesCollected === calibrationSamples) {
                    const threshold = Math.max(-50, -30 - (backgroundNoiseLevel / 2));
                    this.noiseGateNode.threshold.value = threshold;
                    console.log(`🎛️ Noise gate calibrated: background=${backgroundNoiseLevel.toFixed(1)}, threshold=${threshold.toFixed(1)}dB`);
                }
            } else {
                // Adaptive adjustment: adjust gate threshold based on current noise
                const noiseChange = currentNoiseLevel - backgroundNoiseLevel;
                
                // If noise increased significantly, lower threshold (more aggressive gating)
                if (noiseChange > 5) {
                    const newThreshold = Math.max(-60, this.noiseGateNode.threshold.value - 2);
                    this.noiseGateNode.threshold.value = newThreshold;
                }
                // If noise decreased, raise threshold (less aggressive gating)
                else if (noiseChange < -5) {
                    const newThreshold = Math.min(-30, this.noiseGateNode.threshold.value + 1);
                    this.noiseGateNode.threshold.value = newThreshold;
                }
                
                // Update background noise level slowly (exponential moving average)
                backgroundNoiseLevel = backgroundNoiseLevel * 0.95 + currentNoiseLevel * 0.05;
            }
            
            // Continue monitoring
            requestAnimationFrame(adjustNoiseGate);
        };
        
        // Start monitoring
        adjustNoiseGate();
        console.log('🎛️ Adaptive noise gate started');
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

    startStateValidation() {
        // Prevent multiple validation intervals
        if (this.stateValidationInterval) {
            return;
        }
        
        // Validate state consistency every 2 seconds
        this.stateValidationInterval = setInterval(() => {
            this.validateMuteState();
        }, 2000);
        
        console.log('✅ State validation started');
    }
    
    validateMuteState() {
        // Only validate if audio is enabled
        if (!this.isAudioEnabled || !this.localStream) {
            return;
        }
        
        const audioTracks = this.localStream.getAudioTracks();
        if (audioTracks.length === 0) {
            return;
        }
        
        // Check if track enabled state matches mute state
        const expectedEnabled = !this.isMuted;
        let stateMismatch = false;
        
        audioTracks.forEach((track, index) => {
            if (track.enabled !== expectedEnabled) {
                console.warn(`⚠️ State mismatch detected on track ${index}: expected enabled=${expectedEnabled}, actual=${track.enabled}, isMuted=${this.isMuted}`);
                stateMismatch = true;
            }
        });
        
        // Also check processed stream if it exists
        if (this.processedStream) {
            const processedTracks = this.processedStream.getAudioTracks();
            processedTracks.forEach((track, index) => {
                if (track.enabled !== expectedEnabled) {
                    console.warn(`⚠️ State mismatch detected on processed track ${index}: expected enabled=${expectedEnabled}, actual=${track.enabled}`);
                    stateMismatch = true;
                }
            });
        }
        
        // If mismatch detected, sync state
        if (stateMismatch) {
            console.log('🔧 Correcting state mismatch...');
            this.applyMuteStateToTracks(this.isMuted);
            this.updateAudioControls();
        }
        
        // Validate UI state matches mute state
        const muteBtn = document.getElementById('muteBtn');
        if (muteBtn) {
            const uiShowsMuted = muteBtn.classList.contains('muted');
            if (uiShowsMuted !== this.isMuted) {
                console.warn(`⚠️ UI state mismatch: UI shows muted=${uiShowsMuted}, actual isMuted=${this.isMuted}`);
                // Sync UI (updateAudioControls will handle ARIA attributes)
                this.updateAudioControls();
            }
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

    updateRoleUI() {
        const requestBtn = document.getElementById('requestSpeakerBtn');
        const requestStatus = document.getElementById('requestSpeakerStatus');
        const joinAudioBtn = document.getElementById('joinAudioBtn');
        const muteBtn = document.getElementById('muteBtn');
        const joinText = joinAudioBtn ? joinAudioBtn.querySelector('.join-text') : null;

        // Hosts can now use the same audio controls as regular users
        // They'll see "Join Audio" when audio is not enabled, just like other participants
        // Only hide the "Request to Speak" button for hosts (they don't need to request)
        if (this.isHost) {
            if (requestBtn) {
                requestBtn.style.display = 'none';
            }
            if (requestStatus) {
                requestStatus.textContent = 'You are the host. Click "Join Audio" to enable your microphone.';
            }
            // Don't return early - let hosts use the same audio flow as regular users
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

