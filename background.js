// background.js - Fixed version with proper message routing and recording indicators
const API_BASE_URL = 'http://localhost:3000/api';

class RecordingManager {
    constructor() {
        this.isRecording = false;
        this.currentRecording = null;
        this.recordingData = [];
        this.startTime = null;
        this.offscreenReady = false;
    }

    async startRecording(options = {}) {
        try {
            if (this.isRecording) {
                throw new Error('Recording already in progress');
            }

            console.log('RecordingManager: Starting recording with options:', options);

            // Ensure offscreen document exists and is ready
            await this.ensureOffscreenDocument();

            this.isRecording = true;
            this.startTime = new Date();
            this.recordingData = [];

            // Update extension badge
            chrome.action.setBadgeText({ text: 'REC' });
            chrome.action.setBadgeBackgroundColor({ color: '#ff0000' });

            // Notify all tabs about recording status FIRST
            await this.notifyTabsRecordingStatus(true);

            // Start recording through offscreen document
            const message = {
                target: 'offscreen',
                action: 'startCapture',
                options: {
                    includeScreen: options.includeScreen || false,
                    includeAudio: options.includeAudio || false,
                    includeSystemAudio: options.includeSystemAudio || false,
                    videoQuality: options.videoQuality || 'medium',
                    audioQuality: options.audioQuality || 'medium'
                }
            };

            // Broadcast message to offscreen document
            this.sendToOffscreen(message);

            console.log('RecordingManager: Recording started successfully');
            return { success: true, message: 'Recording started' };

        } catch (error) {
            console.error('Failed to start recording:', error);
            this.isRecording = false;
            chrome.action.setBadgeText({ text: '' });
            // Make sure to hide indicators on error
            await this.notifyTabsRecordingStatus(false);
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
            this.sendToOffscreen({
                target: 'offscreen',
                action: 'stopCapture'
            });

            this.isRecording = false;

            // Clear badge
            chrome.action.setBadgeText({ text: '' });

            // Notify all tabs about recording status
            await this.notifyTabsRecordingStatus(false);

            console.log('RecordingManager: Recording stopped successfully');
            return { success: true, message: 'Recording stopped' };

        } catch (error) {
            console.error('Failed to stop recording:', error);
            return { success: false, error: error.message };
        }
    }

    // Add method to notify all tabs about recording status
    async notifyTabsRecordingStatus(isRecording) {
        try {
            console.log(`RecordingManager: Notifying all tabs - recording: ${isRecording}`);
            const tabs = await chrome.tabs.query({});

            for (const tab of tabs) {
                try {
                    // Send message to content script
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'updateRecordingStatus',
                        isRecording: isRecording
                    });
                    console.log(`RecordingManager: Notified tab ${tab.id}`);
                } catch (error) {
                    // Ignore errors for tabs that don't have the content script
                    console.log(`Could not notify tab ${tab.id}:`, error.message);
                }
            }
        } catch (error) {
            console.error('Failed to notify tabs:', error);
        }
    }

    sendToOffscreen(message) {
        // Use chrome.runtime.sendMessage with a target identifier
        chrome.runtime.sendMessage(message).catch(error => {
            console.error('Failed to send message to offscreen:', error);
        });
    }

    async ensureOffscreenDocument() {
        const existingContexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });

        if (existingContexts.length === 0) {
            try {
                await chrome.offscreen.createDocument({
                    url: 'offscreen.html',
                    reasons: ['USER_MEDIA'],
                    justification: 'Recording meeting audio and video'
                });

                // Wait for offscreen document to initialize
                await new Promise(resolve => setTimeout(resolve, 2000));

            } catch (error) {
                console.error('Failed to create offscreen document:', error);
                throw error;
            }
        }

        this.offscreenReady = true;
    }

    async handleRecordingComplete(recordingData) {
        try {
            console.log('RecordingManager: Handling recording completion');
            const endTime = new Date();
            const duration = Math.round((endTime - this.startTime) / 1000);

            // Convert base64 to blob
            const recordingBlob = await fetch(recordingData.blob).then(r => r.blob());

            // Get current tab info for context
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const currentTab = tabs[0];

            // Prepare metadata
            const metadata = {
                title: currentTab?.title || 'Untitled Meeting',
                url: currentTab?.url || '',
                duration: duration,
                startTime: this.startTime.toISOString(),
                endTime: endTime.toISOString(),
                fileSize: recordingData.size,
                mimeType: recordingData.mimeType
            };

            console.log('RecordingManager: Recording metadata:', metadata);

            // Upload to backend
            const uploadResult = await this.uploadRecording(recordingBlob, metadata);

            if (uploadResult.success) {
                // Store in local storage for offline access
                await this.storeRecordingMetadata(uploadResult.data);

                // Notify user of successful upload
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon48.png',
                    title: 'Recording Saved',
                    message: `Meeting recording uploaded successfully (${this.formatFileSize(recordingData.size)})`
                });
            } else {
                // Store locally if upload fails
                await this.storeRecordingLocally(recordingBlob, metadata);

                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon48.png',
                    title: 'Recording Saved Locally',
                    message: 'Upload failed. Recording saved locally and will sync when connection is restored.'
                });
            }

        } catch (error) {
            console.error('Error handling recording completion:', error);
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: 'Recording Error',
                message: 'Failed to save recording. Please try again.'
            });
        }
    }

    async uploadRecording(blob, metadata) {
        try {
            // Get auth token
            const authData = await chrome.storage.local.get(['authToken']);
            if (!authData.authToken) {
                throw new Error('User not authenticated');
            }

            // Create form data
            const formData = new FormData();
            formData.append('recording', blob, `meeting-${Date.now()}.webm`);
            formData.append('metadata', JSON.stringify(metadata));

            const response = await fetch(`${API_BASE_URL}/recordings/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authData.authToken}`
                },
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.statusText}`);
            }

            const result = await response.json();
            return { success: true, data: result };

        } catch (error) {
            console.error('Upload error:', error);
            return { success: false, error: error.message };
        }
    }

    async storeRecordingMetadata(recording) {
        try {
            const { recordings = [] } = await chrome.storage.local.get(['recordings']);
            recordings.unshift(recording);
            const trimmedRecordings = recordings.slice(0, 100);
            await chrome.storage.local.set({ recordings: trimmedRecordings });
        } catch (error) {
            console.error('Failed to store recording metadata:', error);
        }
    }

    async storeRecordingLocally(blob, metadata) {
        try {
            const base64Data = await this.blobToBase64(blob);

            const localRecording = {
                ...metadata,
                id: `local-${Date.now()}`,
                isLocal: true,
                data: base64Data,
                needsSync: true
            };

            const { localRecordings = [] } = await chrome.storage.local.get(['localRecordings']);
            localRecordings.unshift(localRecording);
            const trimmedRecordings = localRecordings.slice(0, 10);
            await chrome.storage.local.set({ localRecordings: trimmedRecordings });
        } catch (error) {
            console.error('Failed to store recording locally:', error);
        }
    }

    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    formatFileSize(bytes) {
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 Byte';
        const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }
}

// Initialize recording manager
const recordingManager = new RecordingManager();

// Handle messages from popup and offscreen document
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request.action, 'from:', sender.tab ? 'tab' : 'extension');

    // Handle messages from offscreen document (these have no target)
    if (!request.target) {
        switch (request.action) {
            case 'captureStarted':
                console.log('Capture started successfully');
                sendResponse({ success: true });
                break;

            case 'captureError':
                console.error('Capture error from offscreen:', request.error);
                recordingManager.isRecording = false;
                chrome.action.setBadgeText({ text: '' });
                // Notify tabs to hide recording indicators
                recordingManager.notifyTabsRecordingStatus(false);
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon48.png',
                    title: 'Recording Error',
                    message: request.error
                });
                sendResponse({ success: true });
                break;

            case 'recordingComplete':
                console.log('Recording complete received');
                recordingManager.handleRecordingComplete(request.data);
                sendResponse({ success: true });
                break;

            case 'recordingError':
                console.error('Recording error from offscreen:', request.error);
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon48.png',
                    title: 'Recording Error',
                    message: request.error
                });
                sendResponse({ success: true });
                break;
        }
        return;
    }

    // Handle messages from popup - FIXED: Accept both with and without target
    if (request.target === 'background' || (!request.target && request.action)) {
        switch (request.action) {
            case 'startRecording':
                console.log('Background: Handling startRecording request');
                recordingManager.startRecording(request.options)
                    .then(result => {
                        console.log('Start recording result:', result);
                        sendResponse(result);
                    })
                    .catch(error => {
                        console.error('Start recording error:', error);
                        sendResponse({ success: false, error: error.message });
                    });
                return true; // Async response

            case 'stopRecording':
                console.log('Background: Handling stopRecording request');
                recordingManager.stopRecording()
                    .then(result => {
                        console.log('Stop recording result:', result);
                        sendResponse(result);
                    })
                    .catch(error => {
                        console.error('Stop recording error:', error);
                        sendResponse({ success: false, error: error.message });
                    });
                return true; // Async response

            case 'getRecordingStatus':
                const status = {
                    isRecording: recordingManager.isRecording,
                    startTime: recordingManager.startTime
                };
                console.log('Background: Returning recording status:', status);
                sendResponse(status);
                break;

            case 'syncRecordings':
                syncPendingRecordings()
                    .then(result => sendResponse(result))
                    .catch(error => sendResponse({ success: false, error: error.message }));
                return true; // Async response

            case 'logout':
                chrome.storage.local.remove(['authToken']);
                chrome.action.setBadgeText({ text: '' });
                recordingManager.notifyTabsRecordingStatus(false);
                sendResponse({ success: true });
                break;

            default:
                console.warn('Background: Unknown action:', request.action);
                sendResponse({ success: false, error: 'Unknown action' });
        }
    }
});

// Sync pending local recordings when connection is restored
async function syncPendingRecordings() {
    try {
        const { localRecordings = [] } = await chrome.storage.local.get(['localRecordings']);
        const pendingRecordings = localRecordings.filter(r => r.needsSync);

        if (pendingRecordings.length === 0) {
            return { success: true, synced: 0 };
        }

        let syncedCount = 0;

        for (const recording of pendingRecordings) {
            try {
                const blob = await fetch(recording.data).then(r => r.blob());

                const uploadResult = await recordingManager.uploadRecording(blob, {
                    title: recording.title,
                    url: recording.url,
                    duration: recording.duration,
                    startTime: recording.startTime,
                    endTime: recording.endTime,
                    fileSize: recording.fileSize,
                    mimeType: recording.mimeType
                });

                if (uploadResult.success) {
                    recording.needsSync = false;
                    recording.isLocal = false;
                    recording.data = null;
                    Object.assign(recording, uploadResult.data);
                    syncedCount++;
                }
            } catch (error) {
                console.error('Failed to sync recording:', recording.id, error);
            }
        }

        await chrome.storage.local.set({ localRecordings });
        return { success: true, synced: syncedCount };

    } catch (error) {
        console.error('Sync error:', error);
        return { success: false, error: error.message };
    }
}

// Handle extension installation
chrome.runtime.onInstalled.addListener(async () => {
    console.log('Meeting Recorder Extension installed');

    // Initialize storage
    chrome.storage.local.set({
        recordings: [],
        localRecordings: [],
        settings: {
            audioQuality: 'high',
            videoQuality: 'medium',
            autoUpload: true
        }
    });
});