// content/content-script.js
class RecorderWidget {
    constructor() {
        this.widget = null;
        this.isRecording = false;
        this.isPaused = false;
        this.startTime = null;
        this.timer = null;
        this.isMinimized = false;

        this.init();
    }

    init() {
        this.createWidget();
        this.setupMessageListener();
        this.checkRecordingStatus();
    }

    createWidget() {
        // Remove existing widget if present
        if (this.widget) {
            this.widget.remove();
        }

        this.widget = document.createElement('div');
        this.widget.id = 'meeting-recorder-widget';
        this.widget.className = 'recorder-widget';

        this.widget.innerHTML = `
            <div class="widget-header" id="widget-header">
                <div class="widget-brand">
                    <div class="brand-icon">🎥</div>
                    <span class="brand-text">Recorder</span>
                </div>
                <div class="widget-actions">
                    <button class="minimize-btn" id="minimize-btn" title="Minimize">−</button>
                </div>
            </div>
            
            <div class="widget-content" id="widget-content">
                <div class="recording-status" id="recording-status">
                    <div class="status-indicator" id="status-indicator">
                        <div class="status-dot"></div>
                        <span class="status-text">Ready to Record</span>
                    </div>
                    <div class="recording-time" id="recording-time">00:00</div>
                </div>
                
                <div class="widget-controls">
                    <button class="control-btn start-btn" id="start-btn" title="Start Recording">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="12" cy="12" r="10"/>
                        </svg>
                    </button>
                    
                    <button class="control-btn pause-btn" id="pause-btn" title="Pause Recording" style="display: none;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="4" width="4" height="16"/>
                            <rect x="14" y="4" width="4" height="16"/>
                        </svg>
                    </button>
                    
                    <button class="control-btn resume-btn" id="resume-btn" title="Resume Recording" style="display: none;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5,3 19,12 5,21"/>
                        </svg>
                    </button>
                    
                    <button class="control-btn stop-btn" id="stop-btn" title="Stop Recording" style="display: none;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="6" width="12" height="12"/>
                        </svg>
                    </button>
                </div>
                
                <div class="widget-settings" id="widget-settings">
                    <div class="setting-group">
                        <label class="setting-item">
                            <input type="checkbox" id="record-screen" checked>
                            <span class="checkmark"></span>
                            <span class="setting-label">Screen</span>
                        </label>
                        <label class="setting-item">
                            <input type="checkbox" id="record-audio" checked>
                            <span class="checkmark"></span>
                            <span class="setting-label">Audio</span>
                        </label>
                        <label class="setting-item">
                            <input type="checkbox" id="record-system-audio">
                            <span class="checkmark"></span>
                            <span class="setting-label">System</span>
                        </label>
                    </div>
                </div>
            </div>
        `;

        // Make widget draggable
        this.makeDraggable();

        // Setup event listeners
        this.setupEventListeners();

        // Add to page
        document.body.appendChild(this.widget);

        // Position widget
        this.positionWidget();
    }

    makeDraggable() {
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        const header = this.widget.querySelector('#widget-header');

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.minimize-btn')) return;

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            const rect = this.widget.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);

            this.widget.style.cursor = 'grabbing';
            header.style.cursor = 'grabbing';
        });

        const handleMouseMove = (e) => {
            if (!isDragging) return;

            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            const newLeft = Math.max(0, Math.min(window.innerWidth - this.widget.offsetWidth, startLeft + deltaX));
            const newTop = Math.max(0, Math.min(window.innerHeight - this.widget.offsetHeight, startTop + deltaY));

            this.widget.style.left = newLeft + 'px';
            this.widget.style.top = newTop + 'px';
            this.widget.style.right = 'auto';
            this.widget.style.bottom = 'auto';
        };

        const handleMouseUp = () => {
            isDragging = false;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);

            this.widget.style.cursor = 'default';
            header.style.cursor = 'grab';
        };
    }

    setupEventListeners() {
        // Control buttons
        const startBtn = this.widget.querySelector('#start-btn');
        const pauseBtn = this.widget.querySelector('#pause-btn');
        const resumeBtn = this.widget.querySelector('#resume-btn');
        const stopBtn = this.widget.querySelector('#stop-btn');
        const minimizeBtn = this.widget.querySelector('#minimize-btn');

        startBtn?.addEventListener('click', () => this.startRecording());
        pauseBtn?.addEventListener('click', () => this.pauseRecording());
        resumeBtn?.addEventListener('click', () => this.resumeRecording());
        stopBtn?.addEventListener('click', () => this.stopRecording());
        minimizeBtn?.addEventListener('click', () => this.toggleMinimize());

        // Prevent widget from interfering with page interactions
        this.widget.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        this.widget.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            const { action, data } = message;

            switch (action) {
                case 'RECORDING_STARTED':
                    this.updateRecordingState(true, false, data.startTime);
                    break;

                case 'RECORDING_STOPPED':
                    this.updateRecordingState(false, false);
                    break;

                case 'RECORDING_PAUSED':
                    this.updateRecordingState(true, true);
                    break;

                case 'RECORDING_RESUMED':
                    this.updateRecordingState(true, false);
                    break;
            }

            sendResponse({ success: true });
        });
    }

    async checkRecordingStatus() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'GET_RECORDING_STATUS'
            });

            if (response.success && response.isRecording) {
                this.updateRecordingState(
                    response.isRecording,
                    response.isPaused,
                    response.startTime
                );
            }
        } catch (error) {
            console.debug('Could not check recording status:', error);
        }
    }

    async startRecording() {
        const recordScreen = this.widget.querySelector('#record-screen').checked;
        const recordAudio = this.widget.querySelector('#record-audio').checked;
        const recordSystemAudio = this.widget.querySelector('#record-system-audio').checked;

        if (!recordScreen && !recordAudio) {
            this.showError('Please select at least one recording option');
            return;
        }

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'START_RECORDING',
                data: {
                    includeScreen: recordScreen,
                    includeAudio: recordAudio,
                    includeSystemAudio: recordSystemAudio
                }
            });

            if (!response.success) {
                throw new Error(response.error || 'Failed to start recording');
            }
        } catch (error) {
            console.error('Failed to start recording:', error);
            this.showError(error.message);
        }
    }

    async pauseRecording() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'PAUSE_RECORDING'
            });

            if (!response.success) {
                throw new Error(response.error || 'Failed to pause recording');
            }
        } catch (error) {
            console.error('Failed to pause recording:', error);
            this.showError(error.message);
        }
    }

    async resumeRecording() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'RESUME_RECORDING'
            });

            if (!response.success) {
                throw new Error(response.error || 'Failed to resume recording');
            }
        } catch (error) {
            console.error('Failed to resume recording:', error);
            this.showError(error.message);
        }
    }

    async stopRecording() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'STOP_RECORDING'
            });

            if (!response.success) {
                throw new Error(response.error || 'Failed to stop recording');
            }
        } catch (error) {
            console.error('Failed to stop recording:', error);
            this.showError(error.message);
        }
    }

    updateRecordingState(isRecording, isPaused, startTime = null) {
        this.isRecording = isRecording;
        this.isPaused = isPaused;

        if (startTime) {
            this.startTime = new Date(startTime);
        }

        // Update UI
        const startBtn = this.widget.querySelector('#start-btn');
        const pauseBtn = this.widget.querySelector('#pause-btn');
        const resumeBtn = this.widget.querySelector('#resume-btn');
        const stopBtn = this.widget.querySelector('#stop-btn');
        const statusText = this.widget.querySelector('.status-text');
        const statusIndicator = this.widget.querySelector('#status-indicator');

        if (isRecording) {
            startBtn.style.display = 'none';
            stopBtn.style.display = 'flex';

            if (isPaused) {
                pauseBtn.style.display = 'none';
                resumeBtn.style.display = 'flex';
                statusText.textContent = 'Paused';
                statusIndicator.className = 'status-indicator paused';
                this.stopTimer();
            } else {
                pauseBtn.style.display = 'flex';
                resumeBtn.style.display = 'none';
                statusText.textContent = 'Recording';
                statusIndicator.className = 'status-indicator recording';
                this.startTimer();
            }

            // Disable settings while recording
            this.widget.querySelector('#widget-settings').style.opacity = '0.5';
            this.widget.querySelector('#widget-settings').style.pointerEvents = 'none';
        } else {
            startBtn.style.display = 'flex';
            pauseBtn.style.display = 'none';
            resumeBtn.style.display = 'none';
            stopBtn.style.display = 'none';
            statusText.textContent = 'Ready to Record';
            statusIndicator.className = 'status-indicator ready';

            // Enable settings
            this.widget.querySelector('#widget-settings').style.opacity = '1';
            this.widget.querySelector('#widget-settings').style.pointerEvents = 'auto';

            this.stopTimer();
            this.widget.querySelector('#recording-time').textContent = '00:00';
        }
    }

    startTimer() {
        this.stopTimer(); // Clear existing timer

        const updateTimer = () => {
            if (this.startTime) {
                const elapsed = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
                const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
                const seconds = (elapsed % 60).toString().padStart(2, '0');
                this.widget.querySelector('#recording-time').textContent = `${minutes}:${seconds}`;
            }
        };

        updateTimer();
        this.timer = setInterval(updateTimer, 1000);
    }

    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    toggleMinimize() {
        const content = this.widget.querySelector('#widget-content');
        const minimizeBtn = this.widget.querySelector('#minimize-btn');

        this.isMinimized = !this.isMinimized;

        if (this.isMinimized) {
            content.style.display = 'none';
            minimizeBtn.textContent = '+';
            minimizeBtn.title = 'Expand';
            this.widget.classList.add('minimized');
        } else {
            content.style.display = 'block';
            minimizeBtn.textContent = '−';
            minimizeBtn.title = 'Minimize';
            this.widget.classList.remove('minimized');
        }
    }

    positionWidget() {
        // Position in top-right corner by default
        this.widget.style.top = '20px';
        this.widget.style.right = '20px';
        this.widget.style.zIndex = '2147483647'; // Maximum z-index
    }

    showError(message) {
        // Create temporary error notification
        const errorEl = document.createElement('div');
        errorEl.className = 'recorder-error-toast';
        errorEl.textContent = message;
        errorEl.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #EF4444;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            z-index: 2147483648;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            animation: slideDown 0.3s ease-out;
        `;

        document.body.appendChild(errorEl);

        setTimeout(() => {
            errorEl.style.animation = 'slideUp 0.3s ease-out forwards';
            setTimeout(() => errorEl.remove(), 300);
        }, 3000);
    }

    destroy() {
        this.stopTimer();
        if (this.widget) {
            this.widget.remove();
        }
    }
}

// Initialize widget when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new RecorderWidget();
    });
} else {
    new RecorderWidget();
}