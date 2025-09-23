class PopupController {
    constructor() {
        this.isRecording = false;
        this.recordingTimer = null;
        this.startTime = null;
        this.authToken = null;
        this.currentUser = null;

        this.init();
    }

    async init() {
        await this.loadAuthState();
        this.setupEventListeners();
        this.setupTabs();

        if (this.authToken) {
            await this.loadUserData();
            this.showApp();
            await this.loadRecordings();
            await this.checkRecordingStatus();
        } else {
            this.showAuth();
        }
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

    setupEventListeners() {
        // Authentication
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLogin();
            });
        }

        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                this.handleLogout();
            });
        }

        // Recording controls
        const startBtn = document.getElementById('start-recording');
        if (startBtn) {
            startBtn.addEventListener('click', () => {
                this.startRecording();
            });
        }

        const stopBtn = document.getElementById('stop-recording');
        if (stopBtn) {
            stopBtn.addEventListener('click', () => {
                this.stopRecording();
            });
        }

        // Dashboard and sync
        const dashboardBtn = document.getElementById('open-dashboard');
        if (dashboardBtn) {
            dashboardBtn.addEventListener('click', () => {
                chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
            });
        }

        const syncBtn = document.getElementById('sync-recordings');
        if (syncBtn) {
            syncBtn.addEventListener('click', () => {
                this.syncRecordings();
            });
        }

        // Settings
        this.setupSettingsListeners();
    }

    setupTabs() {
        const tabs = document.querySelectorAll('.nav-tab');
        const contents = document.querySelectorAll('.tab-content');

        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // Remove active class from all tabs and contents
                tabs.forEach(t => t.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));

                // Add active class to clicked tab and corresponding content
                tab.classList.add('active');
                const targetTab = tab.dataset.tab;
                const targetContent = document.getElementById(`${targetTab}-tab`);
                if (targetContent) {
                    targetContent.classList.add('active');
                }

                // Load data for specific tabs
                if (targetTab === 'recordings') {
                    this.loadRecordings();
                }
            });
        });
    }

    setupSettingsListeners() {
        const audioQuality = document.getElementById('audio-quality');
        const videoQuality = document.getElementById('video-quality');
        const autoUpload = document.getElementById('auto-upload');

        if (!audioQuality || !videoQuality || !autoUpload) return;

        // Load current settings
        chrome.storage.local.get(['settings']).then(result => {
            const settings = result.settings || {};
            audioQuality.value = settings.audioQuality || 'medium';
            videoQuality.value = settings.videoQuality || 'medium';
            autoUpload.checked = settings.autoUpload !== false;
        });

        // Save settings on change
        [audioQuality, videoQuality, autoUpload].forEach(element => {
            element.addEventListener('change', () => {
                const settings = {
                    audioQuality: audioQuality.value,
                    videoQuality: videoQuality.value,
                    autoUpload: autoUpload.checked
                };
                chrome.storage.local.set({ settings });
            });
        });
    }

    async handleLogin() {
        const emailEl = document.getElementById('email');
        const passwordEl = document.getElementById('password');
        const loginButton = document.getElementById('login-form')?.querySelector('button');
        const loginText = document.getElementById('login-text');
        const loginSpinner = document.getElementById('login-spinner');
        const errorDiv = document.getElementById('auth-error');

        if (!emailEl || !passwordEl || !loginButton) {
            console.error('Login form elements not found');
            return;
        }

        const email = emailEl.value;
        const password = passwordEl.value;

        // Show loading state
        loginButton.disabled = true;
        if (loginText) loginText.textContent = 'Signing in...';
        if (loginSpinner) loginSpinner.style.display = 'block';
        if (errorDiv) errorDiv.style.display = 'none';

        try {
            const response = await fetch('http://localhost:3000/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (data.success) {
                // Store auth data
                this.authToken = data.accessToken;
                this.currentUser = data.user;

                await chrome.storage.local.set({
                    authToken: this.authToken,
                    currentUser: this.currentUser
                });

                // Show success and switch to app
                this.showMessage('success', 'Login successful!');
                setTimeout(() => {
                    this.showApp();
                    this.loadRecordings();
                }, 1000);

            } else {
                throw new Error(data.message || 'Login failed');
            }

        } catch (error) {
            console.error('Login error:', error);
            if (errorDiv) {
                errorDiv.textContent = error.message || 'Login failed. Please try again.';
                errorDiv.style.display = 'block';
            }
        } finally {
            // Reset button state
            loginButton.disabled = false;
            if (loginText) loginText.textContent = 'Sign In';
            if (loginSpinner) loginSpinner.style.display = 'none';
        }
    }

    async handleLogout() {
        try {
            // Clear local storage
            await chrome.storage.local.remove(['authToken', 'currentUser']);

            // Notify background script
            chrome.runtime.sendMessage({
                target: 'background',
                action: 'logout'
            });

            // Reset state
            this.authToken = null;
            this.currentUser = null;

            // Show auth section
            this.showAuth();

        } catch (error) {
            console.error('Logout error:', error);
        }
    }

    async loadUserData() {
        if (!this.currentUser) return;

        const userAvatar = document.getElementById('user-avatar');
        const userName = document.getElementById('user-name');
        const userEmail = document.getElementById('user-email');

        if (userAvatar && userName && userEmail) {
            // Set user avatar (initials)
            const initials = this.currentUser.profile?.firstName?.[0] || this.currentUser.email[0];
            userAvatar.textContent = initials.toUpperCase();

            // Set user info
            userName.textContent = this.currentUser.profile?.firstName
                ? `${this.currentUser.profile.firstName} ${this.currentUser.profile.lastName || ''}`.trim()
                : this.currentUser.email.split('@')[0];

            userEmail.textContent = this.currentUser.email;
        }
    }

    async startRecording() {
        try {
            console.log('PopupController: Starting recording...');

            const includeScreenEl = document.getElementById('include-screen');
            const includeAudioEl = document.getElementById('include-audio');
            const includeSystemAudioEl = document.getElementById('include-system-audio');

            if (!includeScreenEl || !includeAudioEl || !includeSystemAudioEl) {
                console.error('Recording option elements not found');
                this.showMessage('error', 'Recording options not found. Please refresh the extension.');
                return;
            }

            const includeScreen = includeScreenEl.checked;
            const includeAudio = includeAudioEl.checked;
            const includeSystemAudio = includeSystemAudioEl.checked;

            if (!includeScreen && !includeAudio) {
                this.showMessage('error', 'Please select at least one recording source.');
                return;
            }

            // Get quality settings
            const settings = await chrome.storage.local.get(['settings']);
            const currentSettings = settings.settings || {};

            const options = {
                includeScreen,
                includeAudio,
                includeSystemAudio,
                videoQuality: currentSettings.videoQuality || 'medium',
                audioQuality: currentSettings.audioQuality || 'medium'
            };

            console.log('PopupController: Recording options:', options);

            // FIXED: Send message with proper format to background script
            const response = await chrome.runtime.sendMessage({
                target: 'background',  // Explicitly target background script
                action: 'startRecording',
                options
            });

            console.log('PopupController: Background response:', response);

            if (response && response.success) {
                this.isRecording = true;
                this.startTime = new Date();
                this.showRecordingState();
                this.startTimer();
                this.showMessage('success', 'Recording started successfully!');

                console.log('PopupController: Recording UI updated');
            } else {
                throw new Error(response?.error || 'Failed to start recording');
            }

        } catch (error) {
            console.error('PopupController: Recording start error:', error);
            this.showMessage('error', error.message || 'Failed to start recording');
        }
    }

    async stopRecording() {
        try {
            console.log('PopupController: Stopping recording...');

            // FIXED: Send message with proper format to background script
            const response = await chrome.runtime.sendMessage({
                target: 'background',  // Explicitly target background script
                action: 'stopRecording'
            });

            console.log('PopupController: Stop recording response:', response);

            if (response && response.success) {
                this.isRecording = false;
                this.stopTimer();
                this.showRecordingSetup();
                this.showMessage('success', 'Recording stopped. Processing and uploading...');

                console.log('PopupController: Recording stopped, UI updated');

                // Reload recordings after a delay to show the new recording
                setTimeout(() => {
                    this.loadRecordings();
                }, 3000);
            } else {
                throw new Error(response?.error || 'Failed to stop recording');
            }

        } catch (error) {
            console.error('PopupController: Recording stop error:', error);
            this.showMessage('error', error.message || 'Failed to stop recording');
        }
    }

    async checkRecordingStatus() {
        try {
            // FIXED: Send message with proper format to background script
            const response = await chrome.runtime.sendMessage({
                target: 'background',  // Explicitly target background script
                action: 'getRecordingStatus'
            });

            console.log('PopupController: Recording status check:', response);

            if (response && response.isRecording) {
                this.isRecording = true;
                this.startTime = new Date(response.startTime);
                this.showRecordingState();
                this.startTimer();
                console.log('PopupController: Found active recording, updated UI');
            }
        } catch (error) {
            console.error('PopupController: Failed to check recording status:', error);
        }
    }

    startTimer() {
        const timerEl = document.getElementById('recording-timer');
        if (!timerEl) return;

        this.recordingTimer = setInterval(() => {
            if (this.startTime) {
                const elapsed = Math.floor((new Date() - this.startTime) / 1000);
                const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
                const seconds = (elapsed % 60).toString().padStart(2, '0');
                timerEl.textContent = `${minutes}:${seconds}`;
            }
        }, 1000);
    }

    stopTimer() {
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }
    }

    async loadRecordings() {
        const recordingsList = document.getElementById('recordings-list');
        if (!recordingsList) return;

        recordingsList.innerHTML = '<div style="text-align: center; color: #6b7280; font-size: 12px; padding: 20px;">Loading recordings...</div>';

        try {
            // Load from local storage first for immediate display
            const localData = await chrome.storage.local.get(['recordings', 'localRecordings']);
            const recordings = localData.recordings || [];
            const localRecordings = localData.localRecordings || [];

            // Combine and sort by date
            const allRecordings = [...recordings, ...localRecordings]
                .sort((a, b) => new Date(b.startTime || b.createdAt) - new Date(a.startTime || a.createdAt))
                .slice(0, 10); // Show only last 10

            if (allRecordings.length === 0) {
                recordingsList.innerHTML = `
                    <div style="text-align: center; color: #6b7280; font-size: 12px; padding: 20px;">
                        No recordings yet.<br>Start your first recording!
                    </div>
                `;
                return;
            }

            // Render recordings
            recordingsList.innerHTML = allRecordings.map(recording => `
                <div class="recording-item">
                    <div class="recording-title">
                        ${this.truncateText(recording.title || 'Untitled Recording', 40)}
                        ${recording.isLocal ? '<span style="color: #f59e0b; font-size: 10px;">● LOCAL</span>' : ''}
                        ${recording.needsSync ? '<span style="color: #ef4444; font-size: 10px;">● SYNC PENDING</span>' : ''}
                    </div>
                    <div class="recording-meta">
                        ${this.formatDate(recording.startTime || recording.createdAt)} • 
                        ${this.formatDuration(recording.duration)} • 
                        ${this.formatFileSize(recording.fileSize)}
                    </div>
                </div>
            `).join('');

            // Try to fetch latest from server
            if (this.authToken) {
                this.fetchRecordingsFromServer();
            }

        } catch (error) {
            console.error('Failed to load recordings:', error);
            recordingsList.innerHTML = `
                <div style="text-align: center; color: #ef4444; font-size: 12px; padding: 20px;">
                    Failed to load recordings
                </div>
            `;
        }
    }

    async fetchRecordingsFromServer() {
        try {
            const response = await fetch('http://localhost:3000/api/recordings', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.recordings) {
                    // Update local storage with server data
                    await chrome.storage.local.set({ recordings: data.recordings });
                    // Reload the display
                    this.loadRecordings();
                }
            }
        } catch (error) {
            console.error('Failed to fetch recordings from server:', error);
        }
    }

    async syncRecordings() {
        const syncButton = document.getElementById('sync-recordings');
        if (!syncButton) return;

        const originalText = syncButton.textContent;

        syncButton.textContent = 'Syncing...';
        syncButton.disabled = true;

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'syncRecordings'
            });

            if (response && response.success) {
                this.showMessage('success', `Synced ${response.synced} recordings`);
                await this.loadRecordings();
            } else {
                throw new Error(response?.error || 'Sync failed');
            }
        } catch (error) {
            console.error('Sync error:', error);
            this.showMessage('error', 'Sync failed. Please try again.');
        } finally {
            syncButton.textContent = originalText;
            syncButton.disabled = false;
        }
    }

    showAuth() {
        const authSection = document.getElementById('auth-section');
        const appSection = document.getElementById('app-section');

        if (authSection) authSection.style.display = 'block';
        if (appSection) appSection.style.display = 'none';

        // Clear form
        const emailEl = document.getElementById('email');
        const passwordEl = document.getElementById('password');
        const errorDiv = document.getElementById('auth-error');

        if (emailEl) emailEl.value = '';
        if (passwordEl) passwordEl.value = '';
        if (errorDiv) errorDiv.style.display = 'none';
    }

    showApp() {
        const authSection = document.getElementById('auth-section');
        const appSection = document.getElementById('app-section');

        if (authSection) authSection.style.display = 'none';
        if (appSection) appSection.style.display = 'block';

        this.loadUserData();
    }

    showRecordingSetup() {
        const setupEl = document.getElementById('recording-setup');
        const activeEl = document.getElementById('recording-active');

        if (setupEl) setupEl.style.display = 'block';
        if (activeEl) activeEl.style.display = 'none';
    }

    showRecordingState() {
        const setupEl = document.getElementById('recording-setup');
        const activeEl = document.getElementById('recording-active');

        if (setupEl) setupEl.style.display = 'none';
        if (activeEl) activeEl.style.display = 'block';
    }

    showMessage(type, message) {
        const messageDiv = document.getElementById('recording-message');
        if (!messageDiv) return;

        messageDiv.className = type === 'success' ? 'success-message' : 'error-message';
        messageDiv.textContent = message;
        messageDiv.style.display = 'block';

        setTimeout(() => {
            messageDiv.style.display = 'none';
        }, 5000);
    }

    // Utility functions
    truncateText(text, maxLength) {
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    formatDuration(seconds) {
        if (!seconds) return '0s';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    }

    formatFileSize(bytes) {
        if (!bytes) return '0 B';
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new PopupController();
});