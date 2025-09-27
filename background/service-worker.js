// background/service-worker.js
import { RecordingManager } from '../services/recording-manager.js';
import { StorageManager } from '../services/storage-manager.js';
import { ApiService } from '../services/api-service.js';

class BackgroundService {
    constructor() {
        this.recordingManager = new RecordingManager();
        this.storageManager = new StorageManager();
        this.apiService = new ApiService();

        this.init();
    }

    init() {
        // Listen for extension installation
        chrome.runtime.onInstalled.addListener(this.handleInstall.bind(this));

        // Listen for messages from content scripts and popup
        chrome.runtime.onMessage.addListener(this.handleMessage.bind(this));

        // Listen for tab updates to inject content scripts
        chrome.tabs.onUpdated.addListener(this.handleTabUpdate.bind(this));

        console.log('Meeting Recorder Pro: Background service initialized');
    }

    async handleInstall(details) {
        if (details.reason === 'install') {
            // Initialize default settings
            await this.storageManager.initialize();

            // Set up badge
            chrome.action.setBadgeText({ text: '' });
            chrome.action.setBadgeBackgroundColor({ color: '#4F46E5' });

            console.log('Meeting Recorder Pro: Extension installed');
        }
    }

    async handleMessage(request, sender, sendResponse) {
        try {
            const { action, data } = request;

            switch (action) {
                case 'START_RECORDING':
                    return await this.startRecording(data);

                case 'STOP_RECORDING':
                    return await this.stopRecording();

                case 'PAUSE_RECORDING':
                    return await this.pauseRecording();

                case 'RESUME_RECORDING':
                    return await this.resumeRecording();

                case 'GET_RECORDING_STATUS':
                    return this.getRecordingStatus();

                case 'GET_RECORDINGS':
                    return await this.getRecordings();

                case 'DELETE_RECORDING':
                    return await this.deleteRecording(data.id);

                case 'SYNC_RECORDINGS':
                    return await this.syncRecordings();

                case 'UPDATE_SETTINGS':
                    return await this.updateSettings(data);

                case 'GET_SETTINGS':
                    return await this.getSettings();

                default:
                    console.warn('Unknown action:', action);
                    return { success: false, error: 'Unknown action' };
            }
        } catch (error) {
            console.error('Background service error:', error);
            return { success: false, error: error.message };
        }
    }

    async handleTabUpdate(tabId, changeInfo, tab) {
        // Inject content script into meeting platforms
        if (changeInfo.status === 'complete' && tab.url) {
            const meetingPlatforms = [
                'meet.google.com',
                'zoom.us',
                'teams.microsoft.com',
                'webex.com'
            ];

            const isMeetingPlatform = meetingPlatforms.some(domain =>
                tab.url.includes(domain)
            );

            if (isMeetingPlatform) {
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId },
                        files: ['content/meeting-detector.js']
                    });
                } catch (error) {
                    console.warn('Could not inject meeting detector:', error);
                }
            }
        }
    }

    async startRecording(options = {}) {
        try {
            const result = await this.recordingManager.startRecording(options);

            if (result.success) {
                // Update badge
                chrome.action.setBadgeText({ text: 'REC' });
                chrome.action.setBadgeBackgroundColor({ color: '#EF4444' });

                // Notify all tabs
                await this.notifyAllTabs('RECORDING_STARTED', {
                    startTime: new Date().toISOString()
                });

                // Show notification
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon48.png',
                    title: 'Recording Started',
                    message: 'Meeting recording has begun'
                });
            }

            return result;
        } catch (error) {
            console.error('Failed to start recording:', error);
            return { success: false, error: error.message };
        }
    }

    async stopRecording() {
        try {
            const result = await this.recordingManager.stopRecording();

            if (result.success) {
                // Reset badge
                chrome.action.setBadgeText({ text: '' });

                // Notify all tabs
                await this.notifyAllTabs('RECORDING_STOPPED');

                // Show notification
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon48.png',
                    title: 'Recording Stopped',
                    message: 'Processing and uploading your recording...'
                });
            }

            return result;
        } catch (error) {
            console.error('Failed to stop recording:', error);
            return { success: false, error: error.message };
        }
    }

    async pauseRecording() {
        try {
            const result = await this.recordingManager.pauseRecording();

            if (result.success) {
                // Update badge
                chrome.action.setBadgeText({ text: '||' });

                // Notify all tabs
                await this.notifyAllTabs('RECORDING_PAUSED');
            }

            return result;
        } catch (error) {
            console.error('Failed to pause recording:', error);
            return { success: false, error: error.message };
        }
    }

    async resumeRecording() {
        try {
            const result = await this.recordingManager.resumeRecording();

            if (result.success) {
                // Update badge
                chrome.action.setBadgeText({ text: 'REC' });

                // Notify all tabs
                await this.notifyAllTabs('RECORDING_RESUMED');
            }

            return result;
        } catch (error) {
            console.error('Failed to resume recording:', error);
            return { success: false, error: error.message };
        }
    }

    getRecordingStatus() {
        return this.recordingManager.getStatus();
    }

    async getRecordings() {
        try {
            const localRecordings = await this.storageManager.getRecordings();
            const settings = await this.storageManager.getSettings();

            // Fetch from API if authenticated
            if (settings.apiKey) {
                try {
                    const cloudRecordings = await this.apiService.getRecordings();
                    return {
                        success: true,
                        recordings: [...cloudRecordings, ...localRecordings.filter(r => r.isLocal)]
                    };
                } catch (error) {
                    console.warn('Could not fetch cloud recordings:', error);
                }
            }

            return { success: true, recordings: localRecordings };
        } catch (error) {
            console.error('Failed to get recordings:', error);
            return { success: false, error: error.message };
        }
    }

    async deleteRecording(recordingId) {
        try {
            // Delete from local storage
            await this.storageManager.deleteRecording(recordingId);

            // Delete from API if not local
            const recording = await this.storageManager.getRecording(recordingId);
            if (recording && !recording.isLocal) {
                await this.apiService.deleteRecording(recordingId);
            }

            return { success: true };
        } catch (error) {
            console.error('Failed to delete recording:', error);
            return { success: false, error: error.message };
        }
    }

    async syncRecordings() {
        try {
            const result = await this.storageManager.syncPendingRecordings();

            if (result.synced > 0) {
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon48.png',
                    title: 'Sync Complete',
                    message: `${result.synced} recording(s) synced successfully`
                });
            }

            return result;
        } catch (error) {
            console.error('Failed to sync recordings:', error);
            return { success: false, error: error.message };
        }
    }

    async updateSettings(newSettings) {
        try {
            await this.storageManager.updateSettings(newSettings);
            return { success: true };
        } catch (error) {
            console.error('Failed to update settings:', error);
            return { success: false, error: error.message };
        }
    }

    async getSettings() {
        try {
            const settings = await this.storageManager.getSettings();
            return { success: true, settings };
        } catch (error) {
            console.error('Failed to get settings:', error);
            return { success: false, error: error.message };
        }
    }

    async notifyAllTabs(action, data = {}) {
        try {
            const tabs = await chrome.tabs.query({});

            for (const tab of tabs) {
                try {
                    await chrome.tabs.sendMessage(tab.id, { action, data });
                } catch (error) {
                    // Tab might not have content script injected
                    console.debug(`Could not notify tab ${tab.id}:`, error.message);
                }
            }
        } catch (error) {
            console.error('Failed to notify tabs:', error);
        }
    }
}

// Initialize background service
new BackgroundService();