// services/recording-manager.js
export class RecordingManager {
    constructor() {
        this.isRecording = false;
        this.isPaused = false;
        this.startTime = null;
        this.pausedTime = 0;
        this.mediaRecorder = null;
        this.stream = null;
        this.recordingData = [];
        this.offscreenDocument = null;
    }

    async startRecording(options = {}) {
        try {
            if (this.isRecording) {
                throw new Error('Recording already in progress');
            }

            console.log('RecordingManager: Starting recording with options:', options);

            // Ensure offscreen document is available
            await this.ensureOffscreenDocument();

            // Reset state
            this.recordingData = [];
            this.pausedTime = 0;
            this.startTime = new Date();

            // Send recording start message to offscreen document
            const result = await chrome.runtime.sendMessage({
                target: 'offscreen',
                action: 'START_CAPTURE',
                options: {
                    includeScreen: options.includeScreen || false,
                    includeAudio: options.includeAudio || false,
                    includeSystemAudio: options.includeSystemAudio || false,
                    videoQuality: options.videoQuality || 'medium',
                    audioQuality: options.audioQuality || 'medium'
                }
            });

            if (result && result.success) {
                this.isRecording = true;
                this.isPaused = false;

                console.log('RecordingManager: Recording started successfully');
                return { success: true, startTime: this.startTime.toISOString() };
            } else {
                throw new Error(result?.error || 'Failed to start recording');
            }

        } catch (error) {
            console.error('RecordingManager: Failed to start recording:', error);
            this.cleanup();
            return { success: false, error: error.message };
        }
    }

    async stopRecording() {
        try {
            if (!this.isRecording) {
                throw new Error('No recording in progress');
            }

            console.log('RecordingManager: Stopping recording');

            // Send stop message to offscreen document
            await chrome.runtime.sendMessage({
                target: 'offscreen',
                action: 'STOP_CAPTURE'
            });

            this.isRecording = false;
            this.isPaused = false;

            console.log('RecordingManager: Recording stopped');
            return { success: true };

        } catch (error) {
            console.error('RecordingManager: Failed to stop recording:', error);
            this.cleanup();
            return { success: false, error: error.message };
        }
    }

    async pauseRecording() {
        try {
            if (!this.isRecording || this.isPaused) {
                throw new Error('No active recording to pause');
            }

            console.log('RecordingManager: Pausing recording');

            // Send pause message to offscreen document
            await chrome.runtime.sendMessage({
                target: 'offscreen',
                action: 'PAUSE_CAPTURE'
            });

            this.isPaused = true;

            console.log('RecordingManager: Recording paused');
            return { success: true };

        } catch (error) {
            console.error('RecordingManager: Failed to pause recording:', error);
            return { success: false, error: error.message };
        }
    }

    async resumeRecording() {
        try {
            if (!this.isRecording || !this.isPaused) {
                throw new Error('No paused recording to resume');
            }

            console.log('RecordingManager: Resuming recording');

            // Send resume message to offscreen document
            await chrome.runtime.sendMessage({
                target: 'offscreen',
                action: 'RESUME_CAPTURE'
            });

            this.isPaused = false;

            console.log('RecordingManager: Recording resumed');
            return { success: true };

        } catch (error) {
            console.error('RecordingManager: Failed to resume recording:', error);
            return { success: false, error: error.message };
        }
    }

    getStatus() {
        return {
            success: true,
            isRecording: this.isRecording,
            isPaused: this.isPaused,
            startTime: this.startTime ? this.startTime.toISOString() : null,
            duration: this.getDuration()
        };
    }

    getDuration() {
        if (!this.startTime) return 0;

        const now = this.isRecording ? new Date() : this.startTime;
        return Math.floor((now - this.startTime) / 1000) - this.pausedTime;
    }

    async ensureOffscreenDocument() {
        try {
            // Check if offscreen document already exists
            const existingContexts = await chrome.runtime.getContexts({
                contextTypes: ['OFFSCREEN_DOCUMENT']
            });

            if (existingContexts.length === 0) {
                console.log('RecordingManager: Creating offscreen document');

                await chrome.offscreen.createDocument({
                    url: 'ui/offscreen.html',
                    reasons: ['USER_MEDIA'],
                    justification: 'Recording meeting audio and video'
                });

                // Wait for offscreen document to initialize
                await new Promise(resolve => setTimeout(resolve, 1000));
                console.log('RecordingManager: Offscreen document created');
            }
        } catch (error) {
            console.error('RecordingManager: Failed to create offscreen document:', error);
            throw new Error('Failed to initialize recording system');
        }
    }

    async handleRecordingData(data) {
        try {
            console.log('RecordingManager: Processing recording data');

            const { blob, mimeType, size } = data;
            const endTime = new Date();
            const duration = this.getDuration();

            // Get current tab information
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const currentTab = tabs[0];

            const metadata = {
                title: this.extractMeetingTitle(currentTab),
                url: currentTab?.url || '',
                duration,
                startTime: this.startTime.toISOString(),
                endTime: endTime.toISOString(),
                fileSize: size,
                mimeType
            };

            console.log('RecordingManager: Recording metadata:', metadata);

            // Import storage manager dynamically to avoid circular dependencies
            const { StorageManager } = await import('./storage-manager.js');
            const storageManager = new StorageManager();

            // Try to upload to cloud first, fallback to local storage
            const { ApiService } = await import('./api-service.js');
            const apiService = new ApiService();

            try {
                const uploadResult = await apiService.uploadRecording(blob, metadata);

                if (uploadResult.success) {
                    // Store metadata in local storage
                    await storageManager.addRecording(uploadResult.recording);

                    // Show success notification
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'icons/icon48.png',
                        title: 'Recording Saved',
                        message: `Meeting recording uploaded successfully (${this.formatFileSize(size)})`
                    });
                } else {
                    throw new Error('Upload failed');
                }
            } catch (uploadError) {
                console.warn('RecordingManager: Upload failed, saving locally:', uploadError);

                // Save locally with sync pending
                const localRecording = {
                    id: `local-${Date.now()}`,
                    ...metadata,
                    isLocal: true,
                    needsSync: true,
                    blob: blob // Store blob for later sync
                };

                await storageManager.addLocalRecording(localRecording);

                // Show local save notification
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon48.png',
                    title: 'Recording Saved Locally',
                    message: 'Upload failed. Recording saved locally and will sync when connection is restored.'
                });
            }

            this.cleanup();
            console.log('RecordingManager: Recording processing completed');

        } catch (error) {
            console.error('RecordingManager: Error processing recording:', error);

            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: 'Recording Error',
                message: 'Failed to save recording. Please try again.'
            });
        }
    }

    extractMeetingTitle(tab) {
        if (!tab) return 'Meeting Recording';

        // Extract meaningful title from meeting platforms
        const { title, url } = tab;

        if (url.includes('meet.google.com')) {
            return title.replace(' - Google Meet', '') || 'Google Meet';
        } else if (url.includes('zoom.us')) {
            return title.replace('Zoom Meeting', 'Zoom Meeting') || 'Zoom Meeting';
        } else if (url.includes('teams.microsoft.com')) {
            return title.replace(' | Microsoft Teams', '') || 'Microsoft Teams Meeting';
        } else if (url.includes('webex.com')) {
            return title.replace(' - Cisco Webex', '') || 'Webex Meeting';
        }

        // Generic title cleanup
        const cleanTitle = title
            .replace(/^Meeting -, /, '')
            .replace(/ - [^-]*$/, '')
            .trim();

        return cleanTitle || 'Meeting Recording';
    }

    formatFileSize(bytes) {
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 Bytes';

        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
    }

    cleanup() {
        this.isRecording = false;
        this.isPaused = false;
        this.startTime = null;
        this.pausedTime = 0;
        this.recordingData = [];
        this.mediaRecorder = null;
        this.stream = null;
    }
}