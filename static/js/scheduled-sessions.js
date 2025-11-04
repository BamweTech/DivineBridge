/**
 * Scheduled Sessions - RSVP System
 * Modern glassmorphic UI with smooth animations
 */

class ScheduledSessionsManager {
    constructor() {
        this.sessions = [];
        this.currentFilter = 'all';
        this.currentSort = 'soonest';
        this.activeDropdown = null;
    }
    
    async init() {
        this.setupTabs();
        await this.loadSessions();
        this.setupEventListeners();
    }
    
    setupTabs() {
        const tabButtons = document.querySelectorAll('.session-tab-btn');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                // Update active state
                tabButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Switch content
                const tab = btn.dataset.tab;
                if (tab === 'live') {
                    document.getElementById('liveTab').classList.add('active');
                    document.getElementById('upcomingTab').classList.remove('active');
                } else if (tab === 'upcoming') {
                    document.getElementById('liveTab').classList.remove('active');
                    document.getElementById('upcomingTab').classList.add('active');
                    
                    // Load scheduled sessions if not already loaded
                    if (this.sessions.length === 0) {
                        this.loadSessions();
                    }
                }
            });
        });
    }
    
    async loadSessions(filter = 'all', sort = 'soonest') {
        const container = document.getElementById('scheduledSessionsList');
        if (!container) return;
        
        // Show loading state
        container.innerHTML = `
            <div class="sessions-loading">
                <div class="loading-spinner"></div>
            </div>
        `;
        
        try {
            const response = await fetch(
                `/api/prayer-room/public-scheduled-sessions?time=${filter}&sort=${sort}&limit=20`,
                { credentials: 'include' }
            );
            
            if (!response.ok) {
                throw new Error('Failed to load sessions');
            }
            
            const data = await response.json();
            this.sessions = data.sessions || [];
            this.currentFilter = filter;
            this.currentSort = sort;
            
            this.renderSessions();
            
        } catch (error) {
            console.error('Error loading scheduled sessions:', error);
            container.innerHTML = `
                <div class="no-sessions">
                    <svg class="no-sessions-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    <h3>Unable to load sessions</h3>
                    <p>Please try again later</p>
                </div>
            `;
        }
    }
    
    renderSessions() {
        const container = document.getElementById('scheduledSessionsList');
        if (!container) return;
        
        if (this.sessions.length === 0) {
            container.innerHTML = `
                <div class="no-sessions">
                    <svg class="no-sessions-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                    </svg>
                    <h3>No Upcoming Sessions</h3>
                    <p>Be the first to schedule a prayer session!</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = this.sessions.map(session => this.createSessionCard(session)).join('');
        
        // Attach event listeners
        this.attachSessionEventListeners();
    }
    
    createSessionCard(session) {
        const scheduledDate = new Date(session.scheduled_time * 1000);
        const now = new Date();
        const isToday = scheduledDate.toDateString() === now.toDateString();
        const isTomorrow = scheduledDate.toDateString() === new Date(now.getTime() + 86400000).toDateString();
        
        let dateDisplay = scheduledDate.toLocaleString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
        
        if (isToday) {
            dateDisplay = 'Today at ' + scheduledDate.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit'
            });
        } else if (isTomorrow) {
            dateDisplay = 'Tomorrow at ' + scheduledDate.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit'
            });
        }
        
        const totalRsvps = session.total_rsvps || 0;
        const userRsvpStatus = session.user_rsvp_status;
        
        let rsvpButtonHtml = '';
        if (userRsvpStatus) {
            const statusText = userRsvpStatus === 'going' ? '✓ Going' : 
                             userRsvpStatus === 'maybe' ? '🤔 Maybe' : 
                             '👋 Interested';
            rsvpButtonHtml = `
                <button class="rsvp-btn rsvp-btn-success" onclick="scheduledSessions.showRsvpDropdown(event, '${session.scheduled_room_id}', '${userRsvpStatus}')">
                    ${statusText} <span style="margin-left: 4px;">▾</span>
                </button>
            `;
        } else {
            rsvpButtonHtml = `
                <button class="rsvp-btn rsvp-btn-primary" onclick="scheduledSessions.showRsvpDropdown(event, '${session.scheduled_room_id}')">
                    I'm Interested 👋
                </button>
            `;
        }
        
        return `
            <div class="session-card" data-session-id="${session.scheduled_room_id}">
                <div class="session-header">
                    <div class="session-title-section">
                        <div class="session-title">
                            <svg class="session-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                            </svg>
                            ${this.escapeHtml(session.room_name)}
                        </div>
                        <div class="session-host">
                            Hosted by ${this.escapeHtml(session.host_name)}
                        </div>
                    </div>
                    <div class="session-badge">Public</div>
                </div>
                
                <div class="session-meta">
                    <div class="meta-item">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        <strong>${dateDisplay}</strong>
                    </div>
                </div>
                
                ${session.room_description ? `
                    <div class="session-description">
                        ${this.escapeHtml(session.room_description)}
                    </div>
                ` : ''}
                
                <div class="session-rsvp-section">
                    <div class="rsvp-stats">
                        <div class="rsvp-stat">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
                            </svg>
                            <span class="count">${totalRsvps}</span>
                            <span>${totalRsvps === 1 ? 'person' : 'people'} interested</span>
                        </div>
                    </div>
                    
                    <div class="rsvp-buttons">
                        ${rsvpButtonHtml}
                    </div>
                </div>
            </div>
        `;
    }
    
    showRsvpDropdown(event, sessionId, currentStatus = null) {
        event.stopPropagation();
        const button = event.target.closest('button');
        
        // Close existing dropdown
        if (this.activeDropdown) {
            this.activeDropdown.remove();
            this.activeDropdown = null;
        }
        
        // Create dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'rsvp-dropdown';
        dropdown.innerHTML = `
            <div class="rsvp-option ${currentStatus === 'going' ? 'active' : ''}" data-status="going">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                Going
            </div>
            <div class="rsvp-option ${currentStatus === 'maybe' ? 'active' : ''}" data-status="maybe">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                Maybe
            </div>
            <div class="rsvp-option ${currentStatus === 'interested' ? 'active' : ''}" data-status="interested">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"></path>
                </svg>
                Interested
            </div>
            ${currentStatus ? `
                <hr style="margin: 8px 0; border: none; border-top: 1px solid rgba(0,0,0,0.05);">
                <div class="rsvp-option" data-status="remove">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                    Remove RSVP
                </div>
            ` : ''}
        `;
        
        // Position dropdown
        const buttonRect = button.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.bottom = `${window.innerHeight - buttonRect.top + 8}px`;
        dropdown.style.right = `${window.innerWidth - buttonRect.right}px`;
        
        document.body.appendChild(dropdown);
        this.activeDropdown = dropdown;
        
        // Add click handlers
        dropdown.querySelectorAll('.rsvp-option').forEach(option => {
            option.addEventListener('click', () => {
                const status = option.dataset.status;
                if (status === 'remove') {
                    this.removeRsvp(sessionId);
                } else {
                    this.rsvpToSession(sessionId, status);
                }
                dropdown.remove();
                this.activeDropdown = null;
            });
        });
        
        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', (e) => {
                if (!dropdown.contains(e.target) && e.target !== button) {
                    dropdown.remove();
                    this.activeDropdown = null;
                }
            }, { once: true });
        }, 0);
    }
    
    async rsvpToSession(sessionId, status) {
        try {
            const response = await fetch(`/api/prayer-room/scheduled-session/${sessionId}/rsvp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    rsvp_status: status,
                    reminder_1hour: true,
                    reminder_live: true
                })
            });
            
            if (response.status === 401) {
                window.location.href = '/login?redirect=' + encodeURIComponent('/prayer-room');
                return;
            }
            
            if (!response.ok) {
                throw new Error('Failed to RSVP');
            }
            
            const data = await response.json();
            
            // Show success toast
            this.showToast('✓ RSVP confirmed! You\'ll get reminders before the session.', 'success');
            
            // Update the session in our list
            const session = this.sessions.find(s => s.scheduled_room_id === sessionId);
            if (session) {
                session.user_rsvp_status = status;
                session.rsvp_count = data.rsvp_count;
                session.total_rsvps = data.total_rsvps;
            }
            
            // Re-render
            this.renderSessions();
            
        } catch (error) {
            console.error('Error RSVPing to session:', error);
            this.showToast('Failed to RSVP. Please try again.', 'error');
        }
    }
    
    async removeRsvp(sessionId) {
        try {
            const response = await fetch(`/api/prayer-room/scheduled-session/${sessionId}/rsvp`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error('Failed to remove RSVP');
            }
            
            // Show success toast
            this.showToast('RSVP removed', 'info');
            
            // Update the session
            const session = this.sessions.find(s => s.scheduled_room_id === sessionId);
            if (session) {
                session.user_rsvp_status = null;
                session.total_rsvps = Math.max(0, session.total_rsvps - 1);
            }
            
            // Re-render
            this.renderSessions();
            
        } catch (error) {
            console.error('Error removing RSVP:', error);
            this.showToast('Failed to remove RSVP. Please try again.', 'error');
        }
    }
    
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `session-toast toast-${type}`;
        
        let icon = '';
        if (type === 'success') {
            icon = '<svg class="toast-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        } else if (type === 'error') {
            icon = '<svg class="toast-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        } else {
            icon = '<svg class="toast-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
        }
        
        toast.innerHTML = `
            ${icon}
            <div class="toast-message">${message}</div>
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
    
    setupEventListeners() {
        // Close dropdown on escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.activeDropdown) {
                this.activeDropdown.remove();
                this.activeDropdown = null;
            }
        });
    }
    
    attachSessionEventListeners() {
        // Add any additional event listeners to session cards here
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
}

// Initialize on page load
let scheduledSessions;
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        scheduledSessions = new ScheduledSessionsManager();
        scheduledSessions.init();
    });
} else {
    scheduledSessions = new ScheduledSessionsManager();
    scheduledSessions.init();
}

