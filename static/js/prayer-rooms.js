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
            const response = await fetch('/api/auth/status', {
                method: 'GET',
                credentials: 'include'
            });
            
            if (response.ok) {
                const userData = await response.json();
                if (userData.authenticated) {
                    this.currentUser = userData.user;
                    console.log('User authenticated:', this.currentUser);
                } else {
                    console.log('User not authenticated');
                    // Redirect to login if needed
                    if (window.location.pathname !== '/login') {
                        window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
                    }
                }
            } else {
                console.log('User not authenticated');
                // Redirect to login if needed
                if (window.location.pathname !== '/login') {
                    window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname);
                }
            }
        } catch (error) {
            console.error('Auth check failed:', error);
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
            scheduleForm.addEventListener('submit', (e) => this.handleScheduleRoom(e));
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
        const hostName = this.currentUser.displayName || this.currentUser.name || 'Anonymous';
        
        // Validate room name length
        if (roomName && roomName.length > 50) {
            alert('Room name must be 50 characters or less');
            return;
        }
        
        // Validate host name length
        if (hostName && hostName.length > 30) {
            alert('Host name must be 30 characters or less');
            return;
        }
        
        const roomData = {
            room_name: roomName,
            room_description: formData.get('room_description'),
            room_privacy: roomPrivacy,
            host_id: this.currentUser.uid,
            host_name: hostName
        };

        try {
            const response = await fetch('/api/prayer-room/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(roomData)
            });

            const result = await response.json();
            
            if (response.ok) {
                // Show room code for private rooms
                if (result.room_code) {
                    alert(`Room created successfully!\n\nRoom Code: ${result.room_code}\n\nShare this code with others to let them join your private room.`);
                }
                
                // Redirect to the created room
                window.location.href = `/prayer-room/join?room=${result.room_id}&name=${encodeURIComponent(roomData.room_name)}`;
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
        const roomCode = formData.get('joinRoomCode').trim().toUpperCase();
        
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
        e.preventDefault();

        const formData = new FormData(e.target);
        const roomName = formData.get('scheduleRoomName');
        const hostName = this.currentUser.displayName || this.currentUser.name || 'Anonymous';
        
        // Validate room name length
        if (roomName && roomName.length > 50) {
            alert('Room name must be 50 characters or less');
            return;
        }
        
        // Validate host name length
        if (hostName && hostName.length > 30) {
            alert('Host name must be 30 characters or less');
            return;
        }
        
        const scheduleData = {
            room_name: roomName,
            description: formData.get('description'),
            scheduled_time: formData.get('scheduleDateTime'),
            host_id: this.currentUser.uid,
            host_name: hostName
        };

        try {
            const response = await fetch('/api/prayer-room/schedule', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(scheduleData)
            });

            const result = await response.json();
            
            if (response.ok) {
                alert('Room scheduled successfully!');
                this.hideScheduleModal();
                // Refresh the page or update UI
                location.reload();
            } else {
                alert('Failed to schedule room: ' + (result.error || 'Unknown error'));
            }
        } catch (error) {
            console.error('Error scheduling room:', error);
            alert('Failed to schedule room. Please try again.');
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
}

// Global functions for modal management
function showCreateRoomModal() {
    // Check authentication before showing the modal
    const prayerRoomsDirectory = window.prayerRoomsDirectory;
    if (!prayerRoomsDirectory || !prayerRoomsDirectory.currentUser) {
        alert('Please log in to create a prayer room');
        return;
    }
    
    document.getElementById('createRoomModal').style.display = 'block';
}

function hideCreateRoomModal() {
    document.getElementById('createRoomModal').style.display = 'none';
}

function showJoinRoomModal() {
    document.getElementById('joinRoomModal').style.display = 'block';
}

function hideJoinRoomModal() {
    document.getElementById('joinRoomModal').style.display = 'none';
}

function showScheduleModal() {
    // Check authentication before showing the modal
    const prayerRoomsDirectory = window.prayerRoomsDirectory;
    if (!prayerRoomsDirectory || !prayerRoomsDirectory.currentUser) {
        alert('Please log in to schedule a prayer room');
        return;
    }
    
    document.getElementById('scheduleModal').style.display = 'block';
}

function hideScheduleModal() {
    document.getElementById('scheduleModal').style.display = 'none';
}

function showMyRooms() {
    // TODO: Implement my rooms functionality
    alert('My Rooms feature coming soon!');
}

function joinRoom(roomId, roomPrivacy = 'public') {
    if (roomPrivacy === 'private') {
        // For private rooms, show the join modal to enter room code
        showJoinRoomModal();
    } else {
        // For public rooms, join directly
        window.location.href = `/prayer-room/join?room=${roomId}`;
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.prayerRoomsDirectory = new PrayerRoomsDirectory();
});
