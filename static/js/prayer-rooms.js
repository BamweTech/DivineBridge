/**
 * Prayer Rooms Directory JavaScript
 * Handles room discovery, creation, and management
 */

class PrayerRoomsDirectory {
    constructor() {
        this.rooms = [];
        this.currentUser = null;
        this.init();
    }

    async init() {
        console.log('Initializing Prayer Rooms Directory...');
        
        // Check authentication
        await this.checkAuth();
        
        // Load active rooms
        await this.loadActiveRooms();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Set up real-time updates
        this.setupRealtimeUpdates();
        
        console.log('Prayer Rooms Directory initialized successfully');
    }

    async checkAuth() {
        try {
            // First, wait for Firebase to be initialized (if it exists)
            if (typeof firebase !== 'undefined' && firebase.auth) {
                // Wait for Firebase auth state to be ready
                const firebaseUser = await new Promise((resolve) => {
                    let resolved = false;
                    
                    // Check if user is already available (fast path)
                    const currentUser = firebase.auth().currentUser;
                    if (currentUser) {
                        resolved = true;
                        resolve(currentUser);
                        return;
                    }
                    
                    // Wait for auth state change
                    const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
                        if (!resolved) {
                            resolved = true;
                            unsubscribe();
                            resolve(user);
                        }
                    });
                    
                    // Timeout after 3 seconds
                    setTimeout(() => {
                        if (!resolved) {
                            resolved = true;
                            unsubscribe();
                            resolve(null);
                        }
                    }, 3000);
                });
                
                if (firebaseUser) {
                    this.currentUser = {
                        uid: firebaseUser.uid,
                        email: firebaseUser.email,
                        displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Anonymous'
                    };
                    console.log('✅ User authenticated via Firebase:', this.currentUser.email);
                    return; // Firebase auth is the source of truth
                }
            }
            
            // Fallback to session-based auth check
            const response = await fetch('/api/auth/status', {
                method: 'GET',
                credentials: 'include'
            });
            
            if (response.ok) {
                const userData = await response.json();
                if (userData.authenticated) {
                    this.currentUser = userData.user;
                    console.log('✅ User authenticated via session:', this.currentUser);
                } else {
                    console.log('ℹ️ User not authenticated - will prompt for login only when performing authenticated actions');
                    this.currentUser = null;
                }
            } else {
                console.log('ℹ️ Auth check returned non-OK status - will prompt for login when needed');
                this.currentUser = null;
            }
        } catch (error) {
            console.error('⚠️ Auth check failed:', error);
            this.currentUser = null;
            // Don't redirect on error - let the page load normally
            // User will be prompted to login when trying to perform authenticated actions
        }
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
                        unsubscribe(); // Unsubscribe immediately
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
                
                // Timeout after 5 seconds (increased from 2)
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
                console.warn('⚠️ No Firebase user found - user may need to sign in');
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
                    break; // Success
                } catch (error) {
                    retries++;
                    if (retries < maxRetries) {
                        console.warn(`⚠️ Token fetch failed (attempt ${retries}/${maxRetries}), retrying...`, error);
                        await new Promise(resolve => setTimeout(resolve, 1000 * retries)); // Exponential backoff
                    } else {
                        console.error('❌ Failed to get Firebase ID token after all retries:', error);
                        throw error;
                    }
                }
            }
            
            if (token) {
                if (forceRefresh) {
                    console.log('✅ Firebase ID token refreshed for user:', user.email);
                } else {
                    console.log('✅ Firebase ID token obtained for user:', user.email);
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
         * This prevents the "login loop" after deployments
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
                console.log('✅ Using Firebase ID token for request');
            } else {
                console.log('⚠️ No Firebase token, using session authentication');
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
            
            if (!idToken) {
                console.warn('⚠️ makeAuthenticatedRequest: No Firebase ID token available - request may fail');
            } else {
                console.log('✅ makeAuthenticatedRequest: Firebase ID token obtained, making request to:', url);
            }
            
            let response = await makeRequest(idToken);
            
            // If 401, try refreshing the token
            if (response.status === 401) {
                console.log('⚠️ 401 error on', url, '- attempting token refresh...');
                
                // Force refresh the Firebase token
                idToken = await this.getFirebaseIdToken(true);
                
                if (idToken) {
                    // Retry with fresh token
                    console.log('🔄 Retrying request with refreshed token...');
                    response = await makeRequest(idToken);
                    
                    if (response.status === 401) {
                        // Still 401 after refresh - user needs to login
                        console.log('❌ Still unauthorized after token refresh for:', url);
                        const errorText = await response.text().catch(() => '');
                        console.error('❌ 401 Error response:', errorText);
                        return { success: false, needsLogin: true };
                    } else {
                        console.log('✅ Request succeeded after token refresh');
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

    async loadActiveRooms() {
        try {
            const response = await fetch('/api/prayer-room/rooms');
            const data = await response.json();
            
            if (data.rooms) {
                this.rooms = data.rooms;
                this.renderRooms();
            } else {
                this.showNoRooms();
            }
        } catch (error) {
            console.error('Error loading rooms:', error);
            this.showError('Failed to load rooms');
        }
    }

    async loadMyRooms() {
        try {
            console.log('Loading user rooms...');
            
            const result = await this.makeAuthenticatedRequest('/api/prayer-room/my-rooms', {
                method: 'GET'
            });
            
            if (result.success) {
                this.displayMyRooms(result.data.rooms || []);
            } else if (result.needsLogin) {
                console.log('❌ Authentication required for loading user rooms');
                // Don't redirect - just show empty state
                this.displayMyRooms([]);
            } else {
                console.error('Failed to load user rooms:', result.error);
                this.displayMyRooms([]);
            }
        } catch (error) {
            console.error('Error loading user rooms:', error);
            this.displayMyRooms([]);
        }
    }

    async loadMyScheduledRooms() {
        try {
            console.log('Loading scheduled rooms...');
            
            const result = await this.makeAuthenticatedRequest('/api/prayer-room/my-scheduled-rooms', {
                method: 'GET'
            });
            
            if (result.success) {
                this.displayScheduledRooms(result.data.scheduled_rooms || []);
            } else if (result.needsLogin) {
                console.log('❌ Authentication required for loading scheduled rooms');
                // Don't redirect - just show empty state
                this.displayScheduledRooms([]);
            } else {
                console.error('Failed to load scheduled rooms:', result.error);
                this.displayScheduledRooms([]);
            }
        } catch (error) {
            console.error('Error loading scheduled rooms:', error);
            this.displayScheduledRooms([]);
        }
    }

    displayMyRooms(rooms) {
        const roomsContainer = document.getElementById('myRoomsList');
        if (!roomsContainer) return;
        
        if (rooms.length === 0) {
            roomsContainer.innerHTML = `
                <div class="no-rooms">
                    <p>You haven't created any rooms yet.</p>
                    <p>Create your first prayer room to get started!</p>
                </div>
            `;
            return;
        }
        
        roomsContainer.innerHTML = rooms.map(room => {
            const createdDate = new Date(room.created_at * 1000).toLocaleDateString();
            const lastActivity = room.last_activity ? new Date(room.last_activity * 1000).toLocaleDateString() : 'Never';
            const isActive = room.is_active ? 'Active' : 'Ended';
            const statusClass = room.is_active ? 'active' : 'ended';
            
            return `
                <div class="room-item">
                    <div class="room-info">
                        <h3>${room.room_name}</h3>
                        <p class="room-description">${room.room_description || 'No description'}</p>
                        <div class="room-meta">
                            <span class="room-privacy ${room.room_privacy}">${room.room_privacy}</span>
                            <span class="room-status ${statusClass}">${isActive}</span>
                            <span class="room-date">Created: ${createdDate}</span>
                            <span class="room-activity">Last activity: ${lastActivity}</span>
                        </div>
                    </div>
                    <div class="room-actions">
                        ${room.is_active ? 
                            `<button class="btn btn-primary" onclick="joinRoom('${room.room_id}', '${room.room_privacy}')">
                                Join Room
                            </button>` :
                            `<button class="btn btn-secondary" onclick="reopenRoom('${room.room_id}')">
                                Reopen Room
                            </button>`
                        }
                        ${room.room_code ? 
                            `<button class="btn btn-outline" onclick="copyRoomCode('${room.room_code}')">
                                Copy Code
                            </button>` : ''
                        }
                    </div>
                </div>
            `;
        }).join('');
    }

    displayScheduledRooms(scheduledRooms) {
        const scheduledContainer = document.getElementById('scheduledRoomsList');
        if (!scheduledContainer) return;
        
        if (scheduledRooms.length === 0) {
            scheduledContainer.innerHTML = `
                <div class="no-rooms">
                    <p>You don't have any scheduled rooms.</p>
                    <p>Schedule a prayer room to plan ahead!</p>
                </div>
            `;
            return;
        }
        
        scheduledContainer.innerHTML = scheduledRooms.map(room => {
            // scheduled_time is stored as UTC timestamp, JavaScript Date automatically converts to local time
            const scheduledDate = new Date(room.scheduled_time * 1000);
            const isUpcoming = scheduledDate > new Date();
            const statusClass = isUpcoming ? 'upcoming' : 'past';
            const statusText = isUpcoming ? 'Upcoming' : 'Past';
            
            // Format date in user's local timezone with better formatting
            const dateDisplay = scheduledDate.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            
            return `
                <div class="room-item">
                    <div class="room-info">
                        <h3>${room.room_name}</h3>
                        <p class="room-description">${room.room_description || 'No description'}</p>
                        <div class="room-meta">
                            <span class="room-privacy ${room.room_privacy}">${room.room_privacy}</span>
                            <span class="room-status ${statusClass}">${statusText}</span>
                            <span class="room-date">Scheduled: ${dateDisplay}</span>
                        </div>
                    </div>
                    <div class="room-actions">
                        ${isUpcoming ? 
                            `<button class="btn btn-primary" onclick="editScheduledRoom('${room.scheduled_room_id}', '${this.escapeHtml(room.room_name)}', '${this.escapeHtml(room.room_description || '')}', '${room.scheduled_time}', '${room.room_privacy}', ${room.is_recurring ? 'true' : 'false'}, '${room.recurrence_pattern || ''}', '${(room.recurrence_days || []).join(',')}', '${room.recurrence_end_date || ''}')">
                                Edit
                            </button>
                            <button class="btn btn-outline" onclick="shareScheduledRoom('${room.scheduled_room_id}', '${this.escapeHtml(room.room_name)}', '${room.scheduled_time}', '${room.room_code || ''}', '${room.room_privacy}')">
                                Share
                            </button>
                            <button class="btn btn-danger" onclick="cancelScheduledRoom('${room.scheduled_room_id}')">
                                Cancel
                            </button>` :
                            `<div class="room-action-group">
                                <button class="btn btn-secondary" onclick="reopenRoom('${room.room_id || room.scheduled_room_id}')">
                                    Reopen
                                </button>
                                <button class="btn btn-danger" onclick="deleteRoom('${room.room_id || room.scheduled_room_id}', '${this.escapeHtml(room.room_name)}')">
                                    Delete
                                </button>
                            </div>`
                        }
                    </div>
                </div>
            `;
        }).join('');
    }

    renderRooms() {
        const roomsList = document.getElementById('roomsList');
        
        if (this.rooms.length === 0) {
            this.showNoRooms();
            return;
        }

        roomsList.innerHTML = this.rooms.map(room => `
            <div class="room-card">
                <div class="room-header">
                    <h4 class="room-title">${room.room_name}</h4>
                    <div class="room-status">
                        <div class="status-dot"></div>
                        <span class="status-text">Live</span>
                    </div>
                </div>
                <div class="room-info">
                    <div class="room-detail">
                        <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                        <span>${room.participant_count} participant${room.participant_count !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="room-detail">
                        <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        <span>${room.host_name}</span>
                    </div>
                    <div class="room-detail">
                        <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            ${room.room_privacy === 'private' ? 
                                '<path d="M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2z"></path><rect x="7" y="7" width="10" height="5" rx="2" ry="2"></rect>' :
                                '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>'
                            }
                        </svg>
                        <span>${room.room_privacy === 'private' ? 'Private' : 'Public'}</span>
                    </div>
                </div>
                ${room.room_description ? `<div class="room-description">${room.room_description}</div>` : ''}
                <div class="room-actions">
                    <button class="btn-join" onclick="joinRoom('${room.room_id}', '${room.room_privacy}')">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 16px; height: 16px; margin-right: 8px;">
                            <path d="M10.59 13.41C11 13.8 11 14.44 10.59 14.83C10.2 15.22 9.56 15.22 9.17 14.83L5.58 11.24C4.8 10.46 4.8 9.19 5.58 8.41L9.17 4.82C9.56 4.43 10.2 4.43 10.59 4.82C11 5.21 11 5.85 10.59 6.24L7.41 9.41H20C20.55 9.41 21 9.86 21 10.41C21 10.96 20.55 11.41 20 11.41H7.41L10.59 14.59C11 14.98 11 15.62 10.59 16.01Z"/>
                        </svg>
                        Join Room
                    </button>
                </div>
            </div>
        `).join('');
    }

    showNoRooms() {
        const roomsList = document.getElementById('roomsList');
        roomsList.innerHTML = `
            <div class="no-rooms-message">
                <p>No active prayer rooms at the moment.</p>
                <p>Be the first to create one!</p>
            </div>
        `;
    }

    showError(message) {
        const roomsList = document.getElementById('roomsList');
        roomsList.innerHTML = `
            <div class="error-state">
                <p>❌ ${message}</p>
                <button onclick="location.reload()">Retry</button>
            </div>
        `;
    }

    async reopenRoom(originalRoomId) {
        try {
            console.log('Reopening room:', originalRoomId);
            
            const result = await this.makeAuthenticatedRequest('/api/prayer-room/reopen-room', {
                method: 'POST',
                body: JSON.stringify({
                    original_room_id: originalRoomId
                })
            });
            
            if (result.success) {
                // Show room code for private rooms
                if (result.data.room_code) {
                    alert(`Room reopened successfully!\n\nRoom Code: ${result.data.room_code}\n\nShare this code with others to let them join your private room.`);
                } else {
                    alert('Room reopened successfully!');
                }
                
                // Redirect to the reopened room with room code if it's a private room
                let redirectUrl = `/prayer-room/join?room=${result.data.room_id}&name=${encodeURIComponent(result.data.room_name)}`;
                if (result.data.room_code) {
                    redirectUrl += `&code=${result.data.room_code}`;
                }
                window.location.href = redirectUrl;
            } else if (result.needsLogin) {
                alert('Please log in to reopen this room.');
                window.location.href = '/login?redirect=' + encodeURIComponent('/prayer-room');
            } else {
                alert('Failed to reopen room: ' + (result.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error reopening room:', error);
            alert('Failed to reopen room. Please try again.');
        }
    }

    async cancelScheduledRoom(scheduledRoomId) {
        try {
            console.log('Canceling scheduled room:', scheduledRoomId);
            
            const result = await this.makeAuthenticatedRequest(`/api/prayer-room/scheduled-room/${scheduledRoomId}`, {
                method: 'DELETE'
            });
            
            if (result.success) {
                alert('Scheduled room canceled successfully!');
                // Reload the scheduled rooms
                this.loadMyScheduledRooms();
            } else if (result.needsLogin) {
                alert('Please log in to cancel this scheduled room.');
                window.location.href = '/login?redirect=' + encodeURIComponent('/prayer-room');
            } else {
                alert('Failed to cancel scheduled room: ' + (result.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error canceling scheduled room:', error);
            alert('Failed to cancel scheduled room. Please try again.');
        }
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) { // Less than 1 minute
            return 'Just now';
        } else if (diff < 3600000) { // Less than 1 hour
            const minutes = Math.floor(diff / 60000);
            return `${minutes}m ago`;
        } else if (diff < 86400000) { // Less than 1 day
            const hours = Math.floor(diff / 3600000);
            return `${hours}h ago`;
        } else {
            return date.toLocaleDateString();
        }
    }
    
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    setupEventListeners() {
        // Create room form
        const createRoomForm = document.getElementById('createRoomForm');
        if (createRoomForm) {
            createRoomForm.addEventListener('submit', (e) => this.handleCreateRoom(e));
        }

        // Join room form
        const joinRoomForm = document.getElementById('joinRoomForm');
        if (joinRoomForm) {
            joinRoomForm.addEventListener('submit', (e) => this.handleJoinRoom(e));
        }

        // Schedule form
        const scheduleForm = document.getElementById('scheduleForm');
        if (scheduleForm) {
            scheduleForm.addEventListener('submit', (e) => {
                console.log('Form submission event triggered!');
                console.log('Form element:', e.target);
                console.log('Form data before processing:', new FormData(e.target));
                this.handleScheduleRoom(e);
            });
        }

        // Modal close on outside click
        window.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.hideAllModals();
            }
        });
    }

    async handleCreateRoom(e) {
        e.preventDefault();

        const formData = new FormData(e.target);
        const roomName = formData.get('room_name');
        const roomPrivacy = formData.get('room_privacy');
        
        // Basic validation
        if (roomName && roomName.length > 50) {
            alert('Room name must be 50 characters or less');
            return;
        }
        
        const roomData = {
            room_name: roomName,
            room_description: formData.get('room_description'),
            room_privacy: roomPrivacy
        };

        try {
            // Make the authenticated request with automatic retry on 401
            const result = await this.makeAuthenticatedRequest('/api/prayer-room/create', {
                method: 'POST',
                body: JSON.stringify(roomData)
            });
            
            if (result.success) {
                // Show room code for private rooms
                if (result.data.room_code) {
                    alert(`Room created successfully!\n\nRoom Code: ${result.data.room_code}\n\nShare this code with others to let them join your private room.`);
                }
                
                // Redirect to the created room
                window.location.href = `/prayer-room/join?room=${result.data.room_id}&name=${encodeURIComponent(roomData.room_name)}`;
            } else if (result.needsLogin) {
                // User needs to login
                console.log('❌ Authentication required, redirecting to login');
                window.location.href = '/login?redirect=' + encodeURIComponent('/prayer-room');
            } else {
                alert('Failed to create room: ' + (result.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error creating room:', error);
            alert('Failed to create room. Please try again.');
        }
    }

    async handleJoinRoom(e) {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const roomCodeValue = formData.get('joinRoomCode');
        
        // Handle null/undefined values and empty strings
        if (!roomCodeValue || typeof roomCodeValue !== 'string') {
            alert('Please enter a room code');
            return;
        }
        
        const roomCode = roomCodeValue.trim().toUpperCase();
        
        if (!roomCode) {
            alert('Please enter a room code');
            return;
        }

        try {
            // First, find the room by code
            const response = await fetch(`/api/prayer-room/find-by-code/${roomCode}`);
            const result = await response.json();
            
            if (response.ok && result.room_id) {
                // Redirect to the room with the room code for validation
                window.location.href = `/prayer-room/join?room=${result.room_id}&code=${roomCode}`;
            } else {
                alert('Room not found. Please check the room code.');
            }
        } catch (error) {
            console.error('Error finding room:', error);
            alert('Failed to find room. Please try again.');
        }
    }

    async handleScheduleRoom(e) {
        console.log('handleScheduleRoom called!');
        console.log('Event:', e);
        console.log('Event target:', e.target);
        e.preventDefault();

        // Using Firebase ID token for persistent authentication across deployments

        const formData = new FormData(e.target);
        const roomName = formData.get('room_name');
        
        console.log('Form data debug:', {
            roomName: roomName,
            description: formData.get('description'),
            scheduledDateTime: formData.get('scheduledDateTime'),
            allFormData: Array.from(formData.entries())
        });
        
        // Validate room name length
        if (roomName && roomName.length > 50) {
            alert('Room name must be 50 characters or less');
            return;
        }
        
        // Get recurring data
        const isRecurring = formData.get('is_recurring') === 'on';
        const recurrenceDays = [];
        
        if (isRecurring) {
            // Get all checked days
            formData.getAll('recurrence_days').forEach(day => {
                recurrenceDays.push(parseInt(day));
            });
        }
        
        // Get user's timezone offset in minutes
        const timezoneOffset = new Date().getTimezoneOffset();
        
        const scheduleData = {
            room_name: roomName,
            room_description: formData.get('room_description'),
            scheduled_time: formData.get('scheduled_time'),
            timezone_offset: timezoneOffset, // Send timezone offset to backend
            room_privacy: formData.get('room_privacy') || 'public',
            is_recurring: isRecurring
        };
        
        // Add recurring data if applicable
        if (isRecurring) {
            scheduleData.recurrence_pattern = formData.get('recurrence_pattern');
            scheduleData.recurrence_days = recurrenceDays;
            
            const endDate = formData.get('recurrence_end_date');
            if (endDate) {
                scheduleData.recurrence_end_date = endDate;
            }
        }
        
        console.log('Schedule data being sent:', scheduleData);

        try {
            // Check if we're editing an existing scheduled room
            const isEditing = window.editingScheduledRoomId;
            const url = isEditing ? 
                `/api/prayer-room/update-scheduled-room/${window.editingScheduledRoomId}` : 
                '/api/prayer-room/schedule';
            const method = isEditing ? 'PUT' : 'POST';
            
            // Make the authenticated request with automatic retry on 401
            const result = await this.makeAuthenticatedRequest(url, {
                method: method,
                body: JSON.stringify(scheduleData)
            });
            
            if (result.success) {
                if (isEditing) {
                    alert('Scheduled room updated successfully!');
                    // Clear the editing state
                    window.editingScheduledRoomId = null;
                    // Reset the submit button text
                    const submitBtn = document.querySelector('#scheduleRoomModal .btn-primary');
                    if (submitBtn) {
                        submitBtn.textContent = 'Schedule Room';
                    }
                } else {
                    alert('Room scheduled successfully!');
                }
                this.hideScheduleModal();
                // Refresh the scheduled rooms list
                this.loadMyScheduledRooms();
            } else if (result.needsLogin) {
                // User needs to login
                console.log('❌ Authentication required, redirecting to login');
                window.location.href = '/login?redirect=' + encodeURIComponent('/prayer-room');
            } else {
                alert(`Failed to ${isEditing ? 'update' : 'schedule'} room: ` + (result.error || 'Unknown error'));
            }
        } catch (error) {
            console.error(`Error ${isEditing ? 'updating' : 'scheduling'} room:`, error);
            alert(`Failed to ${isEditing ? 'update' : 'schedule'} room. Please try again.`);
        }
    }

    setupRealtimeUpdates() {
        // Set up periodic refresh of rooms list
        setInterval(() => {
            this.loadActiveRooms();
        }, 30000); // Refresh every 30 seconds
    }

    hideAllModals() {
        document.getElementById('createRoomModal').style.display = 'none';
        document.getElementById('joinRoomModal').style.display = 'none';
        document.getElementById('scheduleModal').style.display = 'none';
    }

    hideScheduleModal() {
        const modal = document.getElementById('scheduleModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }
}

// Global functions for modal management
function showCreateRoomModal() {
    // Using global authentication system - no page load redirect
    // Modal opens for all users, auth is checked when submitting
    document.getElementById('createRoomModal').style.display = 'block';
}

function hideCreateRoomModal() {
    document.getElementById('createRoomModal').style.display = 'none';
}

function hideScheduleModal() {
    document.getElementById('scheduleModal').style.display = 'none';
}

function showJoinRoomModal() {
    document.getElementById('joinRoomModal').style.display = 'block';
}

function hideJoinRoomModal() {
    document.getElementById('joinRoomModal').style.display = 'none';
}

function showScheduleModal() {
    // Using global authentication system - no page load redirect
    // Modal opens for all users, auth is checked when submitting
    document.getElementById('scheduleModal').style.display = 'block';
}

function hideMyRoomsModal() {
    document.getElementById('myRoomsModal').style.display = 'none';
}

function reopenRoom(originalRoomId) {
    if (!originalRoomId) {
        alert('Room ID not found');
        return;
    }
    
    const prayerRoomsDirectory = window.prayerRoomsDirectory;
    if (!prayerRoomsDirectory) {
        alert('Prayer rooms directory not initialized');
        return;
    }
    
    prayerRoomsDirectory.reopenRoom(originalRoomId);
}

function cancelScheduledRoom(scheduledRoomId) {
    if (!scheduledRoomId) {
        alert('Scheduled room ID not found');
        return;
    }
    
    const confirmed = confirm('Are you sure you want to cancel this scheduled room?');
    if (!confirmed) return;
    
    const prayerRoomsDirectory = window.prayerRoomsDirectory;
    if (!prayerRoomsDirectory) {
        alert('Prayer rooms directory not initialized');
        return;
    }
    
    prayerRoomsDirectory.cancelScheduledRoom(scheduledRoomId);
}

function switchMyRoomsTab(tabName) {
    // Update tab buttons
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => button.classList.remove('active'));
    
    const activeButton = document.querySelector(`[onclick="switchMyRoomsTab('${tabName}')"]`);
    if (activeButton) {
        activeButton.classList.add('active');
    }
    
    // Update tab content
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(content => content.classList.remove('active'));
    
    const activeContent = document.getElementById(tabName === 'created' ? 'createdRoomsTab' : 'scheduledRoomsTab');
    if (activeContent) {
        activeContent.classList.add('active');
    }
}

async function showMyRooms() {
    // Check if user is authenticated
    const prayerRoomsDirectory = window.prayerRoomsDirectory;
    
    // First check class property
    if (prayerRoomsDirectory && prayerRoomsDirectory.currentUser) {
        // User is authenticated, proceed
    } else if (typeof firebase !== 'undefined' && firebase.auth) {
        // Check Firebase auth directly as fallback
        const firebaseUser = firebase.auth().currentUser;
        if (firebaseUser) {
            // Update the directory's currentUser
            if (prayerRoomsDirectory) {
                prayerRoomsDirectory.currentUser = {
                    uid: firebaseUser.uid,
                    email: firebaseUser.email,
                    displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Anonymous'
                };
            }
            console.log('✅ User authenticated via Firebase (fallback check):', firebaseUser.email);
        } else {
            // Wait for auth state change (might be initializing)
            const user = await new Promise((resolve) => {
                let resolved = false;
                const unsubscribe = firebase.auth().onAuthStateChanged((user) => {
                    if (!resolved) {
                        resolved = true;
                        unsubscribe();
                        resolve(user);
                    }
                });
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        unsubscribe();
                        resolve(null);
                    }
                }, 2000);
            });
            
            if (user && prayerRoomsDirectory) {
                prayerRoomsDirectory.currentUser = {
                    uid: user.uid,
                    email: user.email,
                    displayName: user.displayName || user.email?.split('@')[0] || 'Anonymous'
                };
                console.log('✅ User authenticated via Firebase (after wait):', user.email);
            } else {
                console.log('User not authenticated, redirecting to login');
                window.location.href = '/login?redirect=' + encodeURIComponent('/prayer-room');
                return;
            }
        }
    } else {
        console.log('User not authenticated, redirecting to login');
        window.location.href = '/login?redirect=' + encodeURIComponent('/prayer-room');
        return;
    }
    
    // Check if My Rooms modal exists
    const myRoomsModal = document.getElementById('myRoomsModal');
    if (!myRoomsModal) {
        console.error('My Rooms modal not found in template');
        alert('My Rooms functionality is not available yet. Please check back later.');
        return;
    }
    
    // Show the My Rooms modal
    myRoomsModal.style.display = 'block';
    
    // Load both user's rooms and scheduled rooms
    prayerRoomsDirectory.loadMyRooms();
    prayerRoomsDirectory.loadMyScheduledRooms();
}

function hideMyRoomsModal() {
    const modal = document.getElementById('myRoomsModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function showTab(tabId) {
    // Hide all tab contents
    const tabContents = document.querySelectorAll('.tab-content');
    tabContents.forEach(content => content.classList.remove('active'));
    
    // Remove active class from all tab buttons
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => button.classList.remove('active'));
    
    // Show selected tab content
    const selectedTab = document.getElementById(tabId);
    if (selectedTab) {
        selectedTab.classList.add('active');
    }
    
    // Add active class to clicked tab button
    const clickedButton = event.target;
    clickedButton.classList.add('active');
}

function joinRoom(roomId, roomPrivacy = 'public') {
    if (roomPrivacy === 'private') {
        // For private rooms, show the join modal to enter room code
        showJoinRoomModal();
        // Store the room ID for later use
        window.joinRoomId = roomId;
    } else {
        // For public rooms, join directly
        window.location.href = `/prayer-room/join?room=${roomId}`;
    }
}

async function reopenRoom(roomId) {
    if (!confirm('Are you sure you want to reopen this room as a live session?')) {
        return;
    }
    
    const prayerRoomsDirectory = window.prayerRoomsDirectory;
    if (!prayerRoomsDirectory) {
        alert('Prayer rooms directory not initialized');
        return;
    }
    
    // Use the class method which handles authentication properly
    await prayerRoomsDirectory.reopenRoom(roomId);
}

async function cancelScheduledRoom(scheduledRoomId, roomName = '') {
    const confirmMessage = roomName ? 
        `Are you sure you want to cancel the scheduled room "${roomName}"?` :
        'Are you sure you want to cancel this scheduled room?';
        
    if (!confirm(confirmMessage)) {
        return;
    }
    
    const prayerRoomsDirectory = window.prayerRoomsDirectory;
    if (!prayerRoomsDirectory) {
        alert('Prayer rooms directory not initialized');
        return;
    }
    
    // Use the class method which handles authentication properly
    await prayerRoomsDirectory.cancelScheduledRoom(scheduledRoomId);
}

function copyRoomCode(roomCode) {
    if (!roomCode) {
        alert('No room code available');
        return;
    }
    
    navigator.clipboard.writeText(roomCode).then(() => {
        alert('Room code copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy room code:', err);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = roomCode;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            alert('Room code copied to clipboard!');
        } catch (err) {
            alert('Failed to copy room code. Please copy manually: ' + roomCode);
        }
        document.body.removeChild(textArea);
    });
}

function deleteRoom(roomId, roomName) {
    if (confirm(`Are you sure you want to delete the room "${roomName}"? This action cannot be undone.`)) {
        fetch(`/api/prayer-room/delete-room/${roomId}`, {
            method: 'DELETE',
            credentials: 'include'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert('Room deleted successfully!');
                // Reload the rooms
                const prayerRoomsDirectory = window.prayerRoomsDirectory;
                if (prayerRoomsDirectory) {
                    prayerRoomsDirectory.loadMyRooms();
                }
            } else {
                alert('Failed to delete room: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error deleting room:', error);
            alert('Failed to delete room. Please try again.');
        });
    }
}

function deleteScheduledRoom(scheduledRoomId, roomName) {
    if (confirm(`Are you sure you want to delete the scheduled room "${roomName}"? This action cannot be undone.`)) {
        fetch(`/api/prayer-room/scheduled-room/${scheduledRoomId}`, {
            method: 'DELETE',
            credentials: 'include'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert('Scheduled room deleted successfully!');
                // Reload the scheduled rooms
                const prayerRoomsDirectory = window.prayerRoomsDirectory;
                if (prayerRoomsDirectory) {
                    prayerRoomsDirectory.loadMyScheduledRooms();
                }
            } else {
                alert('Failed to delete scheduled room: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error deleting scheduled room:', error);
            alert('Failed to delete scheduled room. Please try again.');
        });
    }
}

function editScheduledRoom(scheduledRoomId, roomName, roomDescription, scheduledTime, roomPrivacy, isRecurring = false, recurrencePattern = '', recurrenceDays = '', recurrenceEndDate = '') {
    // Convert timestamp to datetime-local format
    const scheduledDate = new Date(scheduledTime * 1000);
    const localDateTime = scheduledDate.toISOString().slice(0, 16);
    
    // Pre-fill the schedule form
    document.getElementById('scheduleRoomName').value = roomName;
    document.getElementById('scheduleRoomDescription').value = roomDescription;
    document.getElementById('scheduleDateTime').value = localDateTime;
    const privacyField = document.getElementById('schedulePrivacy');
    if (privacyField) {
        privacyField.value = roomPrivacy;
    }
    
    // Show the schedule modal
    document.getElementById('scheduleModal').style.display = 'block';
    
    // Store the scheduled room ID for updating
    window.editingScheduledRoomId = scheduledRoomId;
    
    // Change the submit button text
    const submitBtn = document.querySelector('#scheduleModal .btn.primary');
    if (submitBtn) {
        submitBtn.textContent = 'Update Scheduled Room';
    }
    
    // Handle recurring options
    const recurringCheckbox = document.getElementById('scheduleIsRecurring');
    const recurringPatternSelect = document.getElementById('recurrencePattern');
    const recurrenceDaysSection = document.getElementById('recurrenceDaysSection');
    const recurrenceEndInput = document.getElementById('recurrenceEndDate');
    
    if (recurringCheckbox) {
        recurringCheckbox.checked = !!isRecurring;
    }
    
    const recurringOptions = document.getElementById('recurringOptions');
    if (recurringOptions) {
        recurringOptions.style.display = isRecurring ? 'block' : 'none';
    }
    
    if (isRecurring) {
        if (recurringPatternSelect) {
            recurringPatternSelect.value = recurrencePattern || 'weekly';
        }
        
        if (recurrenceEndInput && recurrenceEndDate) {
            // Expect recurrenceEndDate as ISO string, convert to date input format
            try {
                const endDate = new Date(recurrenceEndDate);
                recurrenceEndInput.value = endDate.toISOString().slice(0, 10);
            } catch (e) {
                console.warn('Unable to parse recurrence end date:', recurrenceEndDate);
            }
        } else if (recurrenceEndInput) {
            recurrenceEndInput.value = '';
        }
        
        if (recurrenceDaysSection) {
            const dayCheckboxes = recurrenceDaysSection.querySelectorAll('input[type="checkbox"]');
            const selectedDays = (recurrenceDays || '').split(',').filter(Boolean).map(n => parseInt(n, 10));
            dayCheckboxes.forEach(cb => {
                const dayVal = parseInt(cb.value, 10);
                cb.checked = selectedDays.includes(dayVal);
            });
        }
        
        if (typeof toggleRecurrenceDays === 'function') {
            toggleRecurrenceDays();
        }
    } else {
        if (recurringPatternSelect) recurringPatternSelect.value = 'weekly';
        if (recurrenceEndInput) recurrenceEndInput.value = '';
        if (recurrenceDaysSection) {
            const dayCheckboxes = recurrenceDaysSection.querySelectorAll('input[type="checkbox"]');
            dayCheckboxes.forEach(cb => { cb.checked = false; });
        }
    }
}

function shareScheduledRoom(scheduledRoomId, roomName, scheduledTime, roomCode, roomPrivacy) {
    const scheduledDate = new Date(scheduledTime * 1000);
    const formattedDate = scheduledDate.toLocaleString();
    
    // Create shareable content
    const shareText = `Join me for a prayer session: "${roomName}"\n📅 ${formattedDate}\n${roomPrivacy === 'private' ? `🔐 Room Code: ${roomCode}` : '🌐 Public Room'}\n\nJoin at: ${window.location.origin}/api/prayer-room/join-scheduled/${scheduledRoomId}`;
    
    // Create share data
    const shareData = {
        title: `Prayer Session: ${roomName}`,
        text: shareText,
        url: `${window.location.origin}/api/prayer-room/join-scheduled/${scheduledRoomId}`
    };
    
    // Try to use native sharing API first
    if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        navigator.share(shareData)
            .then(() => {
                console.log('Successfully shared scheduled room');
            })
            .catch((error) => {
                console.error('Error sharing:', error);
                // Fallback to copy to clipboard
                fallbackShare(shareText);
            });
    } else {
        // Fallback to copy to clipboard
        fallbackShare(shareText);
    }
}

function fallbackShare(shareText) {
    // Copy to clipboard
    navigator.clipboard.writeText(shareText).then(() => {
        alert('Prayer session details copied to clipboard! You can now share it with others.');
    }).catch(err => {
        console.error('Failed to copy to clipboard:', err);
        // Show the text in a modal for manual copying
        showShareModal(shareText);
    });
}

function showShareModal(shareText) {
    // Create a simple modal to display the share text
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    `;
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: white;
        padding: 20px;
        border-radius: 10px;
        max-width: 500px;
        width: 90%;
        max-height: 80%;
        overflow-y: auto;
    `;
    
    modalContent.innerHTML = `
        <h3>Share Prayer Session</h3>
        <p>Copy the text below to share this prayer session:</p>
        <textarea readonly style="width: 100%; height: 200px; margin: 10px 0; padding: 10px; border: 1px solid #ccc; border-radius: 5px;">${shareText}</textarea>
        <div style="text-align: right;">
            <button onclick="this.closest('.share-modal').remove()" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">Close</button>
        </div>
    `;
    
    modal.className = 'share-modal';
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Auto-select the text
    const textarea = modalContent.querySelector('textarea');
    textarea.select();
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.prayerRoomsDirectory = new PrayerRoomsDirectory();
});
