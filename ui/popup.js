// ui/popup.js
class PopupController {
    constructor() {
        this.recordingStatus = {
            isRecording: false,
            isPaused: false,
            startTime: null
        };
        this.timer = null;

        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.checkRecordingStatus();
        await this.loadRecentRecordings();
    }

    setupEventListeners() {
        // Control buttons
        document.getElementById('start-btn')?.addEventListener('click', () => this.startRecording());
        document.getElementById('pause-btn')?.addEventListener('click', () => this.pauseRecording());
        document.getElementById('resume-btn')?.addEventListener('click', () => this.resumeRecording());
        document.getElementById('stop-btn')?.addEventListener('click', () => this.stopRecording());

        // Dashboard button
        document.getElementById('open-dashboard')?.addEventListener('click', () => {
            chrome.tabs.create({ url: chrome.runtime.getURL('ui/dashboard.html') });
        });
    }

    async checkRecordingStatus() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'GET_RECORDING_STATUS'
            });

            if (response.success) {
                this.updateUI(response);
            }
        } catch (error) {
            console.error('Failed to check recording status:', error);
        }
    }

    async startRecording() {
        try {
            this.showMessage('Starting recording...', 'info');

            const options = {
                includeScreen: document.getElementById('include-screen').checked,
                includeAudio: document.getElementById('include-audio').checked,
                includeSystemAudio: document.getElementById('include-system-audio').checked
            };

            if (!options.includeScreen && !options.includeAudio) {
                this.showMessage('Please select at least one recording option', 'error');
                return;
            }

            const response = await chrome.runtime.sendMessage({
                action: 'START_RECORDING',
                data: options
            });

            if (response.success) {
                this.showMessage('Recording started! Use the on-screen widget for controls.', 'success');
                this.recordingStatus = {
                    isRecording: true,
                    isPaused: false,
                    startTime: response.startTime
                };
                this.updateUI(this.recordingStatus);
                this.startTimer();
            } else {
                throw new Error(response.error || 'Failed to start recording');
            }
        } catch (error) {
            console.error('Start recording failed:', error);
            this.showMessage(error.message, 'error');
        }
    }

    async pauseRecording() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'PAUSE_RECORDING'
            });

            if (response.success) {
                this.showMessage('Recording paused', 'success');
                this.recordingStatus.isPaused = true;
                this.updateUI(this.recordingStatus);
                this.stopTimer();
            } else {
                throw new Error(response.error || 'Failed to pause recording');
            }
        } catch (error) {
            console.error('Pause recording failed:', error);
            this.showMessage(error.message, 'error');
        }
    }

    async resumeRecording() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'RESUME_RECORDING'
            });

            if (response.success) {
                this.showMessage('Recording resumed', 'success');
                this.recordingStatus.isPaused = false;
                this.updateUI(this.recordingStatus);
                this.startTimer();
            } else {
                throw new Error(response.error || 'Failed to resume recording');
            }
        } catch (error) {
            console.error('Resume recording failed:', error);
            this.showMessage(error.message, 'error');
        }
    }

    async stopRecording() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'STOP_RECORDING'
            });

            if (response.success) {
                this.showMessage('Recording stopped. Processing...', 'success');
                this.recordingStatus = {
                    isRecording: false,
                    isPaused: false,
                    startTime: null
                };
                this.updateUI(this.recordingStatus);
                this.stopTimer();

                // Reload recordings after a delay
                setTimeout(() => this.loadRecentRecordings(), 2000);
            } else {
                throw new Error(response.error || 'Failed to stop recording');
            }
        } catch (error) {
            console.error('Stop recording failed:', error);
            this.showMessage(error.message, 'error');
        }
    }

    updateUI(status) {
        const statusDot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');
        const startBtn = document.getElementById('start-btn');
        const pauseBtn = document.getElementById('pause-btn');
        const resumeBtn = document.getElementById('resume-btn');
        const stopBtn = document.getElementById('stop-btn');

        if (status.isRecording) {
            if (status.isPaused) {
                statusDot.className = 'status-dot paused';
                statusText.textContent = 'Recording Paused';
                startBtn.style.display = 'none';
                pauseBtn.style.display = 'none';
                resumeBtn.style.display = 'block';
                stopBtn.style.display = 'block';
            } else {
                statusDot.className = 'status-dot recording';
                statusText.textContent = 'Recording Active';
                startBtn.style.display = 'none';
                pauseBtn.style.display = 'block';
                resumeBtn.style.display = 'none';
                stopBtn.style.display = 'block';
            }

            if (status.startTime) {
                this.recordingStatus.startTime = status.startTime;
                this.startTimer();
            }
        } else {
            statusDot.className = 'status-dot';
            statusText.textContent = 'Ready to Record';
            startBtn.style.display = 'block';
            pauseBtn.style.display = 'none';
            resumeBtn.style.display = 'none';
            stopBtn.style.display = 'none';

            document.getElementById('recording-time').textContent = '00:00';
        }
    }

    startTimer() {
        this.stopTimer();

        const updateTime = () => {
            if (this.recordingStatus.startTime) {
                const elapsed = Math.floor((Date.now() - new Date(this.recordingStatus.startTime).getTime()) / 1000);
                const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
                const seconds = (elapsed % 60).toString().padStart(2, '0');
                document.getElementById('recording-time').textContent = `${minutes}:${seconds}`;
            }
        };

        updateTime();
        this.timer = setInterval(updateTime, 1000);
    }

    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async loadRecentRecordings() {
        const recordingsList = document.getElementById('recordings-list');

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'GET_RECORDINGS'
            });

            if (response.success) {
                const recordings = response.recordings.slice(0, 5); // Show last 5

                if (recordings.length === 0) {
                    recordingsList.innerHTML = `
                        <div class="empty-state">
                            No recordings yet.<br>Start your first recording!
                        </div>
                    `;
                } else {
                    recordingsList.innerHTML = recordings.map(recording => `
                        <div class="recording-item">
                            <div class="recording-title">
                                ${this.escapeHtml(recording.title || 'Untitled Recording')}
                                ${recording.isLocal ? '<span style="color: #f59e0b; font-size: 10px;">● LOCAL</span>' : ''}
                            </div>
                            <div class="recording-meta">
                                <span>${this.formatDate(recording.startTime || recording.createdAt)}</span>
                                <span>${this.formatDuration(recording.duration)}</span>
                                <span>${this.formatFileSize(recording.fileSize)}</span>
                            </div>
                        </div>
                    `).join('');
                }
            } else {
                throw new Error(response.error || 'Failed to load recordings');
            }
        } catch (error) {
            console.error('Failed to load recordings:', error);
            recordingsList.innerHTML = `
                <div class="empty-state">
                    Failed to load recordings
                </div>
            `;
        }
    }

    showMessage(message, type = 'info') {
        const container = document.getElementById('message-container');
        const messageEl = document.createElement('div');

        messageEl.className = type === 'error' ? 'error' :
            type === 'success' ? 'success' :
                'info';
        messageEl.textContent = message;

        container.innerHTML = '';
        container.appendChild(messageEl);

        // Auto-hide after 5 seconds
        setTimeout(() => {
            if (container.contains(messageEl)) {
                container.removeChild(messageEl);
            }
        }, 5000);
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
            return 'Yesterday';
        } else if (diffDays < 7) {
            return date.toLocaleDateString([], { weekday: 'short' });
        } else {
            return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
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

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize popup controller
document.addEventListener('DOMContentLoaded', () => {
    new PopupController();
});