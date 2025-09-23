// dashboard.js - Recording Dashboard Logic

class RecordingDashboard {
    constructor() {
        this.recordings = [];
        this.filteredRecordings = [];
        this.currentFilter = 'all';
        this.currentUser = null;
        this.authToken = null;

        this.init();
    }

    async init() {
        await this.loadAuthState();

        if (!this.authToken) {
            this.redirectToLogin();
            return;
        }

        await this.loadUserData();
        this.setupEventListeners();
        await this.loadRecordings();
    }

    async loadAuthState() {
        try {
            const result = await chrome.storage.local.get(['authToken', 'currentUser']);
            this.authToken = result.authToken;
            this.currentUser = result.currentUser;
        } catch (error) {
            console.error('Failed to load auth state:', error);
        }
    }

    redirectToLogin() {
        document.body.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; height: 100vh; text-align: center;">
                <div>
                    <h2>Authentication Required</h2>
                    <p>Please sign in through the extension popup to access your recordings.</p>
                    <button onclick="window.close()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer;">
                        Close Window
                    </button>
                </div>
            </div>
        `;
    }

    async loadUserData() {
        if (!this.currentUser) return;

        const userAvatar = document.getElementById('user-avatar');
        const userName = document.getElementById('user-name');
        const userEmail = document.getElementById('user-email');

        // Set user avatar (initials)
        const initials = this.currentUser.profile?.firstName?.[0] || this.currentUser.email[0];
        userAvatar.textContent = initials.toUpperCase();

        // Set user info
        userName.textContent = this.currentUser.profile?.firstName
            ? `${this.currentUser.profile.firstName} ${this.currentUser.profile.lastName || ''}`.trim()
            : this.currentUser.email.split('@')[0];

        userEmail.textContent = this.currentUser.email;
    }

    setupEventListeners() {
        // Search functionality
        document.getElementById('search-input').addEventListener('input', (e) => {
            this.filterRecordings(e.target.value);
        });

        // Filter buttons
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentFilter = e.target.dataset.filter;
                this.filterRecordings();
            });
        });

        // Delete modal
        document.getElementById('confirm-delete').addEventListener('click', () => {
            this.confirmDelete();
        });

        // Close modals on backdrop click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.style.display = 'none';
                }
            });
        });
    }

    async loadRecordings() {
        try {
            // Load from local storage first
            const localData = await chrome.storage.local.get(['recordings', 'localRecordings']);
            const serverRecordings = localData.recordings || [];
            const localRecordings = localData.localRecordings || [];

            // Combine recordings
            this.recordings = [...serverRecordings, ...localRecordings]
                .sort((a, b) => new Date(b.startTime || b.createdAt) - new Date(a.startTime || a.createdAt));

            // Try to fetch latest from server
            try {
                const response = await fetch('http://localhost:3000/api/recordings', {
                    headers: {
                        'Authorization': `Bearer ${this.authToken}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.recordings) {
                        // Update recordings with server data
                        const serverRecordings = data.recordings;
                        const localRecordings = localData.localRecordings || [];

                        this.recordings = [...serverRecordings, ...localRecordings]
                            .sort((a, b) => new Date(b.startTime || b.createdAt) - new Date(a.startTime || a.createdAt));

                        // Update local storage
                        await chrome.storage.local.set({ recordings: serverRecordings });
                    }
                }
            } catch (fetchError) {
                console.warn('Could not fetch from server, using local data:', fetchError);
            }

            this.updateStatistics();
            this.filterRecordings();

        } catch (error) {
            console.error('Failed to load recordings:', error);
            this.showError('Failed to load recordings');
        }
    }

    updateStatistics() {
        const totalRecordings = this.recordings.length;
        const totalDuration = this.recordings.reduce((sum, r) => sum + (r.duration || 0), 0);
        const totalSize = this.recordings.reduce((sum, r) => sum + (r.fileSize || 0), 0);

        // Count recordings from this month
        const now = new Date();
        const thisMonth = this.recordings.filter(r => {
            const recordingDate = new Date(r.startTime || r.createdAt);
            return recordingDate.getMonth() === now.getMonth() &&
                recordingDate.getFullYear() === now.getFullYear();
        }).length;

        document.getElementById('total-recordings').textContent = totalRecordings;
        document.getElementById('total-duration').textContent = this.formatDuration(totalDuration);
        document.getElementById('total-size').textContent = this.formatFileSize(totalSize);
        document.getElementById('this-month').textContent = thisMonth;
    }

    filterRecordings(searchQuery = '') {
        let filtered = [...this.recordings];

        // Apply status filter
        if (this.currentFilter !== 'all') {
            filtered = filtered.filter(recording => {
                switch (this.currentFilter) {
                    case 'synced':
                        return !recording.isLocal && !recording.needsSync;
                    case 'local':
                        return recording.isLocal;
                    case 'pending':
                        return recording.needsSync;
                    default:
                        return true;
                }
            });
        }

        // Apply search filter
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(recording =>
                (recording.title || '').toLowerCase().includes(query) ||
                (recording.url || '').toLowerCase().includes(query) ||
                this.formatDate(recording.startTime || recording.createdAt).toLowerCase().includes(query)
            );
        }

        this.filteredRecordings = filtered;
        this.renderRecordings();
    }

    renderRecordings() {
        const container = document.getElementById('recordings-container');

        if (this.filteredRecordings.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div style="font-size: 3rem; margin-bottom: 1rem;">📹</div>
                    <h3>No recordings found</h3>
                    <p>Start recording meetings to see them here</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="recordings-grid">
                ${this.filteredRecordings.map(recording => this.renderRecordingCard(recording)).join('')}
            </div>
        `;
    }

    renderRecordingCard(recording) {
        const status = this.getRecordingStatus(recording);
        const statusClass = `status-${status}`;
        const statusText = status.charAt(0).toUpperCase() + status.slice(1);

        return `
            <div class="recording-card" data-recording-id="${recording.id}">
                <div class="recording-header">
                    <div>
                        <div class="recording-title">${this.escapeHtml(recording.title || 'Untitled Recording')}</div>
                        ${recording.url ? `<a href="${recording.url}" class="recording-url" target="_blank">${this.truncateUrl(recording.url)}</a>` : ''}
                    </div>
                    <span class="recording-status ${statusClass}">${statusText}</span>
                </div>
                
                <div class="recording-meta">
                    <div class="meta-item">
                        📅 ${this.formatDate(recording.startTime || recording.createdAt)}
                    </div>
                    <div class="meta-item">
                        ⏱️ ${this.formatDuration(recording.duration)}
                    </div>
                    <div class="meta-item">
                        💾 ${this.formatFileSize(recording.fileSize)}
                    </div>
                    ${recording.mimeType ? `<div class="meta-item">🎬 ${recording.mimeType.split('/')[1]}</div>` : ''}
                </div>

                <div class="recording-actions">
                    <button class="btn btn-primary" onclick="dashboard.viewDetails('${recording.id}')">
                        Details
                    </button>
                    ${!recording.isLocal ? `
                        <a href="${this.getDownloadUrl(recording)}" class="btn btn-secondary" target="_blank">
                            Download
                        </a>
                    ` : ''}
                    ${recording.needsSync ? `
                        <button class="btn btn-primary" onclick="dashboard.syncRecording('${recording.id}')">
                            Sync
                        </button>
                    ` : ''}
                    <button class="btn btn-danger" onclick="dashboard.deleteRecording('${recording.id}', '${this.escapeHtml(recording.title || 'Untitled Recording')}')">
                        Delete
                    </button>
                </div>
            </div>
        `;
    }

    getRecordingStatus(recording) {
        if (recording.needsSync) return 'pending';
        if (recording.isLocal) return 'local';
        return 'synced';
    }

    getDownloadUrl(recording) {
        return `http://localhost:3000/api/recordings/${recording.id}/download`;
    }

    async viewDetails(recordingId) {
        const recording = this.recordings.find(r => r.id === recordingId);
        if (!recording) return;

        const detailsHtml = `
            <div style="display: grid; gap: 1rem;">
                <div>
                    <strong>Title:</strong><br>
                    ${this.escapeHtml(recording.title || 'Untitled Recording')}
                </div>
                
                ${recording.url ? `
                    <div>
                        <strong>URL:</strong><br>
                        <a href="${recording.url}" target="_blank" style="color: #667eea;">${recording.url}</a>
                    </div>
                ` : ''}
                
                <div>
                    <strong>Recorded:</strong><br>
                    ${this.formatDate(recording.startTime || recording.createdAt)}
                </div>
                
                <div>
                    <strong>Duration:</strong><br>
                    ${this.formatDuration(recording.duration)}
                </div>
                
                <div>
                    <strong>File Size:</strong><br>
                    ${this.formatFileSize(recording.fileSize)}
                </div>
                
                ${recording.mimeType ? `
                    <div>
                        <strong>Format:</strong><br>
                        ${recording.mimeType}
                    </div>
                ` : ''}
                
                <div>
                    <strong>Status:</strong><br>
                    <span class="recording-status status-${this.getRecordingStatus(recording)}">
                        ${this.getRecordingStatus(recording).charAt(0).toUpperCase() + this.getRecordingStatus(recording).slice(1)}
                    </span>
                </div>
                
                ${recording.endTime ? `
                    <div>
                        <strong>Ended:</strong><br>
                        ${this.formatDate(recording.endTime)}
                    </div>
                ` : ''}
            </div>
        `;

        document.getElementById('recording-details').innerHTML = detailsHtml;
        document.getElementById('details-modal').style.display = 'block';
    }

    async syncRecording(recordingId) {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'syncRecordings'
            });

            if (response.success) {
                this.showMessage('success', 'Recording synced successfully');
                await this.loadRecordings();
            } else {
                throw new Error(response.error || 'Sync failed');
            }
        } catch (error) {
            console.error('Sync error:', error);
            this.showMessage('error', 'Failed to sync recording');
        }
    }

    deleteRecording(recordingId, recordingTitle) {
        document.getElementById('delete-recording-title').textContent = recordingTitle;
        document.getElementById('delete-modal').style.display = 'block';
        document.getElementById('confirm-delete').dataset.recordingId = recordingId;
    }

    async confirmDelete() {
        const recordingId = document.getElementById('confirm-delete').dataset.recordingId;
        const recording = this.recordings.find(r => r.id === recordingId);

        if (!recording) return;

        try {
            if (recording.isLocal) {
                // Delete from local storage
                const localData = await chrome.storage.local.get(['localRecordings']);
                const localRecordings = localData.localRecordings || [];
                const updatedLocal = localRecordings.filter(r => r.id !== recordingId);
                await chrome.storage.local.set({ localRecordings: updatedLocal });
            } else {
                // Delete from server
                const response = await fetch(`http://localhost:3000/api/recordings/${recordingId}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${this.authToken}`
                    }
                });

                if (!response.ok) {
                    throw new Error('Failed to delete recording from server');
                }

                // Also remove from local storage
                const localData = await chrome.storage.local.get(['recordings']);
                const recordings = localData.recordings || [];
                const updatedRecordings = recordings.filter(r => r.id !== recordingId);
                await chrome.storage.local.set({ recordings: updatedRecordings });
            }

            // Update local state
            this.recordings = this.recordings.filter(r => r.id !== recordingId);
            this.updateStatistics();
            this.filterRecordings();

            this.showMessage('success', 'Recording deleted successfully');
            document.getElementById('delete-modal').style.display = 'none';

        } catch (error) {
            console.error('Delete error:', error);
            this.showMessage('error', 'Failed to delete recording');
        }
    }

    showMessage(type, message) {
        // Create toast notification
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            color: white;
            z-index: 9999;
            font-weight: 500;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            ${type === 'success' ? 'background: #10b981;' : 'background: #ef4444;'}
        `;
        toast.textContent = message;

        document.body.appendChild(toast);

        // Remove after 5 seconds
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 5000);
    }

    showError(message) {
        const container = document.getElementById('recordings-container');
        container.innerHTML = `
            <div style="text-align: center; color: #ef4444; padding: 2rem;">
                <div style="font-size: 2rem; margin-bottom: 1rem;">⚠️</div>
                <h3>Error Loading Recordings</h3>
                <p>${message}</p>
                <button onclick="dashboard.loadRecordings()" style="margin-top: 1rem; padding: 0.5rem 1rem; background: #667eea; color: white; border: none; border-radius: 6px; cursor: pointer;">
                    Try Again
                </button>
            </div>
        `;
    }

    // Utility functions
    formatDate(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffTime = now - date;
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return 'Today ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            return 'Yesterday ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays < 7) {
            return date.toLocaleDateString([], { weekday: 'long' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
    }

    formatDuration(seconds) {
        if (!seconds) return '0s';
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    }

    formatFileSize(bytes) {
        if (!bytes) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    truncateUrl(url) {
        if (url.length > 50) {
            return url.substring(0, 47) + '...';
        }
        return url;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Global functions for modal control
function closeDeleteModal() {
    document.getElementById('delete-modal').style.display = 'none';
}

function closeDetailsModal() {
    document.getElementById('details-modal').style.display = 'none';
}

// Initialize dashboard when DOM is loaded
let dashboard;
document.addEventListener('DOMContentLoaded', () => {
    dashboard = new RecordingDashboard();
});