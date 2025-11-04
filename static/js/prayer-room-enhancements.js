/**
 * PRAYER ROOM - MOBILE ENHANCEMENTS
 * Phase 1 + 2 JavaScript Implementation
 * Supports all new UI features
 */

(function() {
    'use strict';

    // ========================================
    // CONFIGURATION
    // ========================================
    
    const CONFIG = {
        AVATAR_COLORS: [
            ['#667eea', '#764ba2'],
            ['#f093fb', '#f5576c'],
            ['#4facfe', '#00f2fe'],
            ['#43e97b', '#38f9d7'],
            ['#fa709a', '#fee140'],
            ['#30cfd0', '#330867'],
            ['#a8edea', '#fed6e3'],
            ['#ff9a9e', '#fecfef'],
            ['#ffecd2', '#fcb69f'],
            ['#ff6e7f', '#bfe9ff']
        ],
        TYPING_TIMEOUT: 3000,
        TOAST_DURATION: 3000,
        HAPTIC_ENABLED: true
    };

    // ========================================
    // AVATAR SYSTEM
    // ========================================
    
    const AvatarSystem = {
        /**
         * Generate initials from name
         */
        getInitials(name) {
            if (!name) return '?';
            const parts = name.trim().split(' ');
            if (parts.length === 1) {
                return parts[0].substring(0, 2).toUpperCase();
            }
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        },

        /**
         * Generate consistent color index from user ID
         */
        getColorIndex(userId) {
            if (!userId) return 0;
            let hash = 0;
            for (let i = 0; i < userId.length; i++) {
                hash = userId.charCodeAt(i) + ((hash << 5) - hash);
            }
            return Math.abs(hash) % CONFIG.AVATAR_COLORS.length;
        },

        /**
         * Create avatar element
         */
        create(name, userId, size = 'medium') {
            const initials = this.getInitials(name);
            const colorIndex = this.getColorIndex(userId);
            const colors = CONFIG.AVATAR_COLORS[colorIndex];
            
            const avatar = document.createElement('div');
            avatar.className = size === 'small' ? 'message-avatar' : 'participant-avatar';
            avatar.style.background = `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 100%)`;
            avatar.textContent = initials;
            avatar.setAttribute('data-user-id', userId);
            avatar.setAttribute('data-color-index', colorIndex);
            
            return avatar;
        },

        /**
         * Add avatar to participant card
         */
        addToParticipant(participantElement, name, userId) {
            // Check if avatar already exists
            if (participantElement.querySelector('.participant-avatar')) {
                return;
            }

            const avatar = this.create(name, userId, 'medium');
            
            // Insert at the beginning of participant element
            participantElement.insertBefore(avatar, participantElement.firstChild);

            // Wrap participant name and status in info container if not already wrapped
            const nameElement = participantElement.querySelector('.participant-name');
            if (nameElement && !nameElement.parentElement.classList.contains('participant-info')) {
                const infoContainer = document.createElement('div');
                infoContainer.className = 'participant-info';
                nameElement.parentNode.insertBefore(infoContainer, nameElement);
                infoContainer.appendChild(nameElement);
                
                // Move any status elements
                const statusElements = participantElement.querySelectorAll('.participant-status, .role-badge');
                statusElements.forEach(el => infoContainer.appendChild(el));
            }
        },

        /**
         * Add avatar to message
         */
        addToMessage(messageElement, senderName, senderId, isOwn = false) {
            if (isOwn || messageElement.querySelector('.message-avatar')) {
                return;
            }

            const avatar = this.create(senderName, senderId, 'small');
            messageElement.insertBefore(avatar, messageElement.firstChild);
        }
    };

    // ========================================
    // CHAT BUBBLE SYSTEM
    // ========================================
    
    const ChatBubbleSystem = {
        currentUserId: null,

        /**
         * Initialize system with current user ID
         */
        init(userId) {
            this.currentUserId = userId;
            console.log('[ChatBubbles] Initialized with user ID:', userId);
        },

        /**
         * Transform message to bubble style
         */
        transformMessage(messageElement, senderId, senderName) {
            if (!messageElement || messageElement.classList.contains('bubble-transformed')) {
                return;
            }

            const isOwn = senderId === this.currentUserId;
            
            // Add bubble classes
            messageElement.classList.add(isOwn ? 'message-own' : 'message-other');
            messageElement.classList.add('bubble-transformed');

            // Create wrapper if message text exists
            const messageText = messageElement.textContent?.trim();
            if (messageText && !messageElement.querySelector('.message-content')) {
                const content = document.createElement('div');
                content.className = 'message-content';
                content.textContent = messageText;
                messageElement.textContent = '';
                messageElement.appendChild(content);
            }

            // Add sender name for other messages
            if (!isOwn && senderName) {
                let senderLabel = messageElement.querySelector('.message-sender');
                if (!senderLabel) {
                    senderLabel = document.createElement('div');
                    senderLabel.className = 'message-sender';
                    senderLabel.textContent = senderName;
                    messageElement.insertBefore(senderLabel, messageElement.firstChild);
                }
            }

            // Add avatar
            if (!isOwn) {
                AvatarSystem.addToMessage(messageElement, senderName, senderId, isOwn);
            }

            // Add timestamp and status
            this.addMetadata(messageElement, isOwn);
        },

        /**
         * Add message metadata (timestamp, status)
         */
        addMetadata(messageElement, isOwn) {
            // Check if metadata already exists
            if (messageElement.querySelector('.message-meta')) {
                return;
            }

            const meta = document.createElement('div');
            meta.className = 'message-meta';

            // Add timestamp
            const time = document.createElement('span');
            time.className = 'message-time';
            time.textContent = this.getFormattedTime(new Date());
            meta.appendChild(time);

            // Add read status for own messages
            if (isOwn) {
                const status = document.createElement('span');
                status.className = 'message-status status-sent';
                meta.appendChild(status);
            }

            messageElement.appendChild(meta);
        },

        /**
         * Format timestamp
         */
        getFormattedTime(date) {
            const now = new Date();
            const diff = now - date;
            
            // Less than 1 minute
            if (diff < 60000) {
                return 'Just now';
            }
            
            // Less than 1 hour
            if (diff < 3600000) {
                const minutes = Math.floor(diff / 60000);
                return `${minutes}m ago`;
            }
            
            // Today
            if (date.toDateString() === now.toDateString()) {
                return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            }
            
            // This week
            const daysDiff = Math.floor(diff / 86400000);
            if (daysDiff < 7) {
                return date.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
            }
            
            // Older
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        },

        /**
         * Update message status
         */
        updateStatus(messageElement, status) {
            const statusElement = messageElement.querySelector('.message-status');
            if (statusElement) {
                statusElement.className = `message-status status-${status}`;
            }
        },

        /**
         * Transform all existing messages
         */
        transformAllMessages() {
            const messages = document.querySelectorAll('.message, .chat-message');
            console.log(`[ChatBubbles] Transforming ${messages.length} messages`);
            
            messages.forEach(msg => {
                const senderId = msg.getAttribute('data-sender-id') || msg.getAttribute('data-user-id');
                const senderName = msg.getAttribute('data-sender-name') || 'Unknown';
                this.transformMessage(msg, senderId, senderName);
            });
        }
    };

    // ========================================
    // TYPING INDICATOR
    // ========================================
    
    const TypingIndicator = {
        activeTypers: new Set(),
        indicatorElement: null,
        typingTimeout: null,

        /**
         * Initialize typing indicator
         */
        init() {
            this.createIndicator();
        },

        /**
         * Create indicator element
         */
        createIndicator() {
            if (this.indicatorElement) return;

            const indicator = document.createElement('div');
            indicator.className = 'typing-indicator';
            indicator.style.display = 'none';
            indicator.innerHTML = `
                <span class="typing-name"></span>
                <div class="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            `;
            this.indicatorElement = indicator;
        },

        /**
         * Show typing indicator
         */
        show(userName) {
            if (!this.indicatorElement) return;

            this.activeTypers.add(userName);
            this.updateDisplay();

            // Auto-hide after timeout
            clearTimeout(this.typingTimeout);
            this.typingTimeout = setTimeout(() => {
                this.hide(userName);
            }, CONFIG.TYPING_TIMEOUT);
        },

        /**
         * Hide typing indicator
         */
        hide(userName) {
            this.activeTypers.delete(userName);
            this.updateDisplay();
        },

        /**
         * Update display based on active typers
         */
        updateDisplay() {
            if (!this.indicatorElement) return;

            const chatMessages = document.getElementById('chatMessages');
            if (!chatMessages) return;

            if (this.activeTypers.size === 0) {
                if (this.indicatorElement.parentNode) {
                    this.indicatorElement.remove();
                }
                return;
            }

            // Update text
            const nameElement = this.indicatorElement.querySelector('.typing-name');
            if (this.activeTypers.size === 1) {
                nameElement.textContent = `${Array.from(this.activeTypers)[0]} is typing`;
            } else if (this.activeTypers.size === 2) {
                const names = Array.from(this.activeTypers);
                nameElement.textContent = `${names[0]} and ${names[1]} are typing`;
            } else {
                nameElement.textContent = `${this.activeTypers.size} people are typing`;
            }

            // Append to chat if not already there
            if (!this.indicatorElement.parentNode) {
                chatMessages.appendChild(this.indicatorElement);
                this.indicatorElement.style.display = 'flex';
                
                // Scroll to show indicator
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        }
    };

    // ========================================
    // AUDIO WAVE ANIMATION
    // ========================================
    
    const AudioWaveSystem = {
        /**
         * Create wave indicator
         */
        create() {
            const container = document.createElement('div');
            container.className = 'speaking-indicator';
            
            for (let i = 0; i < 5; i++) {
                const bar = document.createElement('div');
                bar.className = 'wave-bar';
                bar.style.setProperty('--i', i);
                container.appendChild(bar);
            }
            
            return container;
        },

        /**
         * Add waves to participant
         */
        addToParticipant(participantElement) {
            // Remove any existing indicator
            const existing = participantElement.querySelector('.speaking-indicator');
            if (existing) {
                existing.remove();
            }

            const waves = this.create();
            participantElement.appendChild(waves);
        },

        /**
         * Remove waves from participant
         */
        removeFromParticipant(participantElement) {
            const waves = participantElement.querySelector('.speaking-indicator');
            if (waves) {
                waves.remove();
            }
        }
    };

    // ========================================
    // HAPTIC FEEDBACK
    // ========================================
    
    const HapticFeedback = {
        enabled: CONFIG.HAPTIC_ENABLED,

        /**
         * Check if vibration is supported
         */
        isSupported() {
            return 'vibrate' in navigator;
        },

        /**
         * Trigger light haptic
         */
        light() {
            if (this.enabled && this.isSupported()) {
                navigator.vibrate(10);
            }
        },

        /**
         * Trigger medium haptic
         */
        medium() {
            if (this.enabled && this.isSupported()) {
                navigator.vibrate(20);
            }
        },

        /**
         * Trigger heavy haptic
         */
        heavy() {
            if (this.enabled && this.isSupported()) {
                navigator.vibrate(30);
            }
        },

        /**
         * Trigger success pattern
         */
        success() {
            if (this.enabled && this.isSupported()) {
                navigator.vibrate([10, 20, 10]);
            }
        },

        /**
         * Trigger error pattern
         */
        error() {
            if (this.enabled && this.isSupported()) {
                navigator.vibrate([20, 10, 20, 10, 20]);
            }
        }
    };

    // ========================================
    // TOAST NOTIFICATIONS
    // ========================================
    
    const ToastSystem = {
        /**
         * Show toast notification
         */
        show(message, icon = '👋', duration = CONFIG.TOAST_DURATION) {
            const toast = document.createElement('div');
            toast.className = 'toast-notification';
            toast.innerHTML = `
                <div class="toast-icon">${icon}</div>
                <div class="toast-content">${message}</div>
            `;

            document.body.appendChild(toast);

            // Auto dismiss
            setTimeout(() => {
                this.hide(toast);
            }, duration);

            // Haptic feedback
            HapticFeedback.light();
        },

        /**
         * Hide toast notification
         */
        hide(toast) {
            toast.classList.add('toast-hide');
            setTimeout(() => {
                toast.remove();
            }, 300);
        },

        /**
         * Show participant joined notification
         */
        participantJoined(name) {
            this.show(`<strong>${name}</strong> joined the prayer room`, '👋');
        },

        /**
         * Show participant left notification
         */
        participantLeft(name) {
            this.show(`<strong>${name}</strong> left the prayer room`, '👋');
        }
    };

    // ========================================
    // SKELETON LOADERS
    // ========================================
    
    const SkeletonLoader = {
        /**
         * Create participant skeleton
         */
        createParticipantSkeleton() {
            const skeleton = document.createElement('div');
            skeleton.className = 'skeleton-participant';
            skeleton.innerHTML = `
                <div class="skeleton skeleton-avatar"></div>
                <div class="skeleton-participant-info">
                    <div class="skeleton skeleton-name"></div>
                    <div class="skeleton skeleton-status"></div>
                </div>
            `;
            return skeleton;
        },

        /**
         * Create message skeleton
         */
        createMessageSkeleton(isOwn = false) {
            const skeleton = document.createElement('div');
            skeleton.className = `skeleton-message ${isOwn ? 'skeleton-own' : ''}`;
            
            if (!isOwn) {
                skeleton.innerHTML = `
                    <div class="skeleton skeleton-message-avatar"></div>
                    <div class="skeleton skeleton-message-bubble"></div>
                `;
            } else {
                skeleton.innerHTML = `
                    <div class="skeleton skeleton-message-bubble"></div>
                `;
            }
            
            return skeleton;
        },

        /**
         * Show participant skeletons
         */
        showParticipantSkeletons(count = 3) {
            const list = document.getElementById('participantsList');
            if (!list) return;

            // Clear existing skeletons
            this.clearSkeletons(list);

            // Add new skeletons
            for (let i = 0; i < count; i++) {
                list.appendChild(this.createParticipantSkeleton());
            }
        },

        /**
         * Show message skeletons
         */
        showMessageSkeletons(count = 3) {
            const chatMessages = document.getElementById('chatMessages');
            if (!chatMessages) return;

            // Clear existing skeletons
            this.clearSkeletons(chatMessages);

            // Add new skeletons (mix of own and other)
            for (let i = 0; i < count; i++) {
                chatMessages.appendChild(this.createMessageSkeleton(i % 2 === 1));
            }
        },

        /**
         * Clear all skeletons from container
         */
        clearSkeletons(container) {
            const skeletons = container.querySelectorAll('[class*="skeleton-"]');
            skeletons.forEach(s => s.remove());
        }
    };

    // ========================================
    // ENHANCED EMPTY STATES
    // ========================================
    
    const EmptyState = {
        /**
         * Show empty chat state
         */
        showEmptyChat() {
            const chatMessages = document.getElementById('chatMessages');
            if (!chatMessages) return;

            // Check if already showing
            if (chatMessages.querySelector('.empty-chat-state')) return;

            const emptyState = document.createElement('div');
            emptyState.className = 'empty-chat-state';
            emptyState.innerHTML = `
                <div class="empty-icon">🙏</div>
                <h3>Start the Conversation</h3>
                <p>Share prayers, encouragement, and support with others</p>
                <div class="quick-messages">
                    <button onclick="document.getElementById('chatInput').value='🙏 Please pray for...'; document.getElementById('chatInput').focus();">
                        🙏 Send a prayer
                    </button>
                    <button onclick="document.getElementById('chatInput').value='✨ I want to share...'; document.getElementById('chatInput').focus();">
                        ✨ Share testimony
                    </button>
                    <button onclick="document.getElementById('chatInput').value='💚 God bless you!'; document.getElementById('chatInput').focus();">
                        💚 Encourage others
                    </button>
                </div>
            `;

            chatMessages.appendChild(emptyState);
        },

        /**
         * Hide empty chat state
         */
        hideEmptyChat() {
            const emptyState = document.querySelector('.empty-chat-state');
            if (emptyState) {
                emptyState.remove();
            }
        },

        /**
         * Show no participants state
         */
        showNoParticipants() {
            const list = document.getElementById('participantsList');
            if (!list) return;

            // Check if already showing
            if (list.querySelector('.no-participants')) return;

            const emptyState = document.createElement('div');
            emptyState.className = 'no-participants';
            emptyState.innerHTML = `
                <div class="no-participants-icon">👥</div>
                <p class="no-participants-text">
                    Waiting for others to join...<br>
                    Share the room code to invite people!
                </p>
            `;

            list.appendChild(emptyState);
        },

        /**
         * Hide no participants state
         */
        hideNoParticipants() {
            const emptyState = document.querySelector('.no-participants');
            if (emptyState) {
                emptyState.remove();
            }
        }
    };

    // ========================================
    // INITIALIZATION AND INTEGRATION
    // ========================================
    
    const EnhancementManager = {
        initialized: false,
        currentUserId: null,

        /**
         * Initialize all enhancements
         */
        init(userId) {
            if (this.initialized) return;

            console.log('[Enhancements] Initializing...', { userId });
            
            this.currentUserId = userId;
            
            // Initialize subsystems
            ChatBubbleSystem.init(userId);
            TypingIndicator.init();
            
            // Setup observers
            this.observeMessages();
            this.observeParticipants();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Transform existing content
            this.enhanceExistingContent();
            
            this.initialized = true;
            console.log('[Enhancements] Initialized successfully');
        },

        /**
         * Observe messages for changes
         */
        observeMessages() {
            const chatMessages = document.getElementById('chatMessages');
            if (!chatMessages) return;

            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1 && (node.classList.contains('message') || node.classList.contains('chat-message'))) {
                            const senderId = node.getAttribute('data-sender-id') || node.getAttribute('data-user-id');
                            const senderName = node.getAttribute('data-sender-name') || 'Unknown';
                            ChatBubbleSystem.transformMessage(node, senderId, senderName);
                        }
                    });
                });

                // Update empty state
                const hasMessages = chatMessages.querySelectorAll('.message, .chat-message').length > 0;
                if (hasMessages) {
                    EmptyState.hideEmptyChat();
                } else {
                    EmptyState.showEmptyChat();
                }
            });

            observer.observe(chatMessages, { childList: true, subtree: true });
        },

        /**
         * Observe participants for changes
         */
        observeParticipants() {
            const participantsList = document.getElementById('participantsList');
            if (!participantsList) return;

            const observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === 1 && node.classList.contains('participant')) {
                            const userId = node.getAttribute('data-user-id') || node.getAttribute('data-participant-id');
                            const userName = node.querySelector('.participant-name')?.textContent || 'Unknown';
                            
                            // Add avatar
                            AvatarSystem.addToParticipant(node, userName, userId);
                            
                            // Check if speaking
                            if (node.classList.contains('speaking')) {
                                AudioWaveSystem.addToParticipant(node);
                            }
                        }
                    });
                });

                // Update empty state
                const hasParticipants = participantsList.querySelectorAll('.participant').length > 0;
                if (hasParticipants) {
                    EmptyState.hideNoParticipants();
                } else {
                    EmptyState.showNoParticipants();
                }
            });

            observer.observe(participantsList, { childList: true, subtree: true });

            // Also observe class changes for speaking state
            const classObserver = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        const node = mutation.target;
                        if (node.classList.contains('speaking')) {
                            AudioWaveSystem.addToParticipant(node);
                        } else {
                            AudioWaveSystem.removeFromParticipant(node);
                        }
                    }
                });
            });

            participantsList.querySelectorAll('.participant').forEach((participant) => {
                classObserver.observe(participant, { attributes: true });
            });
        },

        /**
         * Setup event listeners
         */
        setupEventListeners() {
            // Add haptic feedback to buttons
            document.addEventListener('click', (e) => {
                const button = e.target.closest('button, .mobile-tab-btn, .control-btn');
                if (button) {
                    HapticFeedback.light();
                }
            });

            // Tab switches
            document.addEventListener('click', (e) => {
                const tab = e.target.closest('.mobile-tab-btn');
                if (tab) {
                    HapticFeedback.medium();
                }
            });

            // Send message
            const sendBtn = document.getElementById('sendBtn');
            if (sendBtn) {
                sendBtn.addEventListener('click', () => {
                    HapticFeedback.medium();
                });
            }

            // Join audio success
            const joinBtn = document.querySelector('.join-audio-btn');
            if (joinBtn) {
                joinBtn.addEventListener('click', () => {
                    HapticFeedback.success();
                });
            }
        },

        /**
         * Enhance existing content
         */
        enhanceExistingContent() {
            // Transform existing messages
            ChatBubbleSystem.transformAllMessages();

            // Add avatars to existing participants
            const participants = document.querySelectorAll('.participant');
            participants.forEach(p => {
                const userId = p.getAttribute('data-user-id') || p.getAttribute('data-participant-id');
                const userName = p.querySelector('.participant-name')?.textContent || 'Unknown';
                AvatarSystem.addToParticipant(p, userName, userId);

                // Add waves if speaking
                if (p.classList.contains('speaking')) {
                    AudioWaveSystem.addToParticipant(p);
                }
            });

            // Show empty states if needed
            const chatMessages = document.getElementById('chatMessages');
            const hasMessages = chatMessages?.querySelectorAll('.message, .chat-message').length > 0;
            if (!hasMessages) {
                EmptyState.showEmptyChat();
            }

            const participantsList = document.getElementById('participantsList');
            const hasParticipants = participantsList?.querySelectorAll('.participant').length > 0;
            if (!hasParticipants) {
                EmptyState.showNoParticipants();
            }
        }
    };

    // ========================================
    // GLOBAL EXPORTS
    // ========================================
    
    // Expose to global scope
    window.PrayerRoomEnhancements = {
        init: (userId) => EnhancementManager.init(userId),
        avatars: AvatarSystem,
        chatBubbles: ChatBubbleSystem,
        typing: TypingIndicator,
        audioWaves: AudioWaveSystem,
        haptics: HapticFeedback,
        toast: ToastSystem,
        skeleton: SkeletonLoader,
        emptyState: EmptyState
    };

    // Auto-initialize on DOMContentLoaded if user ID is available
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            // Wait for main prayer room script to set user ID
            setTimeout(() => {
                if (window.currentUserId) {
                    EnhancementManager.init(window.currentUserId);
                }
            }, 100);
        });
    }

    console.log('[Enhancements] Module loaded');

})();

