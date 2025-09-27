// services/storage-manager.js
export class StorageManager {
    constructor() {
        this.STORAGE_KEYS = {
            RECORDINGS: 'recordings',
            LOCAL_RECORDINGS: 'localRecordings',
            SETTINGS: 'settings',
            API_CONFIG: 'apiConfig'
        };
    }

    async initialize() {
        try {
            const defaultSettings = {
                videoQuality: 'medium',
                audioQuality: 'medium',
                autoUpload: true,
                notifications: true,
                theme: 'system'
            };

            const existingSettings = await this.getSettings();
            if (!existingSettings) {
                await chrome.storage.local.set({
                    [this.STORAGE_KEYS.SETTINGS]: defaultSettings
                });
            }

            // Initialize empty recordings arrays if not present
            const { recordings, localRecordings } = await chrome.storage.local.get([
                this.STORAGE_KEYS.RECORDINGS,
                this.STORAGE_KEYS.LOCAL_RECORDINGS
            ]);

            if (!recordings) {
                await chrome.storage.local.set({ [this.STORAGE_KEYS.RECORDINGS]: [] });
            }

            if (!localRecordings) {
                await chrome.storage.local.set({ [this.STORAGE_KEYS.LOCAL_RECORDINGS]: [] });
            }

            console.log('StorageManager: Initialized successfully');
        } catch (error) {
            console.error('StorageManager: Initialization failed:', error);
        }
    }

    async getSettings() {
        try {
            const result = await chrome.storage.local.get([this.STORAGE_KEYS.SETTINGS]);
            return result[this.STORAGE_KEYS.SETTINGS];
        } catch (error) {
            console.error('StorageManager: Failed to get settings:', error);
            return null;
        }
    }

    async updateSettings(newSettings) {
        try {
            const currentSettings = await this.getSettings() || {};
            const updatedSettings = { ...currentSettings, ...newSettings };

            await chrome.storage.local.set({
                [this.STORAGE_KEYS.SETTINGS]: updatedSettings
            });

            console.log('StorageManager: Settings updated:', updatedSettings);
            return updatedSettings;
        } catch (error) {
            console.error('StorageManager: Failed to update settings:', error);
            throw error;
        }
    }

    async getApiConfig() {
        try {
            const result = await chrome.storage.local.get([this.STORAGE_KEYS.API_CONFIG]);
            return result[this.STORAGE_KEYS.API_CONFIG];
        } catch (error) {
            console.error('StorageManager: Failed to get API config:', error);
            return null;
        }
    }

    async updateApiConfig(config) {
        try {
            await chrome.storage.local.set({
                [this.STORAGE_KEYS.API_CONFIG]: config
            });

            console.log('StorageManager: API config updated');
        } catch (error) {
            console.error('StorageManager: Failed to update API config:', error);
            throw error;
        }
    }

    async getRecordings() {
        try {
            const result = await chrome.storage.local.get([
                this.STORAGE_KEYS.RECORDINGS,
                this.STORAGE_KEYS.LOCAL_RECORDINGS
            ]);

            const cloudRecordings = result[this.STORAGE_KEYS.RECORDINGS] || [];
            const localRecordings = result[this.STORAGE_KEYS.LOCAL_RECORDINGS] || [];

            // Combine and sort by date (most recent first)
            const allRecordings = [...cloudRecordings, ...localRecordings]
                .sort((a, b) => new Date(b.startTime || b.createdAt) - new Date(a.startTime || a.createdAt));

            return allRecordings;
        } catch (error) {
            console.error('StorageManager: Failed to get recordings:', error);
            return [];
        }
    }

    async getRecording(id) {
        try {
            const recordings = await this.getRecordings();
            return recordings.find(r => r.id === id);
        } catch (error) {
            console.error('StorageManager: Failed to get recording:', error);
            return null;
        }
    }

    async addRecording(recording) {
        try {
            const result = await chrome.storage.local.get([this.STORAGE_KEYS.RECORDINGS]);
            const recordings = result[this.STORAGE_KEYS.RECORDINGS] || [];

            // Add new recording to the beginning
            recordings.unshift(recording);

            // Keep only the last 100 recordings
            const trimmedRecordings = recordings.slice(0, 100);

            await chrome.storage.local.set({
                [this.STORAGE_KEYS.RECORDINGS]: trimmedRecordings
            });

            console.log('StorageManager: Recording added:', recording.id);
            return recording;
        } catch (error) {
            console.error('StorageManager: Failed to add recording:', error);
            throw error;
        }
    }

    async addLocalRecording(recording) {
        try {
            const result = await chrome.storage.local.get([this.STORAGE_KEYS.LOCAL_RECORDINGS]);
            const localRecordings = result[this.STORAGE_KEYS.LOCAL_RECORDINGS] || [];

            // Add new recording to the beginning
            localRecordings.unshift(recording);

            // Keep only the last 50 local recordings (they're larger)
            const trimmedRecordings = localRecordings.slice(0, 50);

            await chrome.storage.local.set({
                [this.STORAGE_KEYS.LOCAL_RECORDINGS]: trimmedRecordings
            });

            console.log('StorageManager: Local recording added:', recording.id);
            return recording;
        } catch (error) {
            console.error('StorageManager: Failed to add local recording:', error);
            throw error;
        }
    }

    async deleteRecording(id) {
        try {
            // Try to delete from cloud recordings first
            const cloudResult = await chrome.storage.local.get([this.STORAGE_KEYS.RECORDINGS]);
            const cloudRecordings = cloudResult[this.STORAGE_KEYS.RECORDINGS] || [];
            const updatedCloudRecordings = cloudRecordings.filter(r => r.id !== id);

            if (updatedCloudRecordings.length < cloudRecordings.length) {
                await chrome.storage.local.set({
                    [this.STORAGE_KEYS.RECORDINGS]: updatedCloudRecordings
                });
                console.log('StorageManager: Cloud recording deleted:', id);
                return true;
            }

            // Try to delete from local recordings
            const localResult = await chrome.storage.local.get([this.STORAGE_KEYS.LOCAL_RECORDINGS]);
            const localRecordings = localResult[this.STORAGE_KEYS.LOCAL_RECORDINGS] || [];
            const updatedLocalRecordings = localRecordings.filter(r => r.id !== id);

            if (updatedLocalRecordings.length < localRecordings.length) {
                await chrome.storage.local.set({
                    [this.STORAGE_KEYS.LOCAL_RECORDINGS]: updatedLocalRecordings
                });
                console.log('StorageManager: Local recording deleted:', id);
                return true;
            }

            console.warn('StorageManager: Recording not found for deletion:', id);
            return false;
        } catch (error) {
            console.error('StorageManager: Failed to delete recording:', error);
            throw error;
        }
    }

    async syncPendingRecordings() {
        try {
            const result = await chrome.storage.local.get([this.STORAGE_KEYS.LOCAL_RECORDINGS]);
            const localRecordings = result[this.STORAGE_KEYS.LOCAL_RECORDINGS] || [];

            const pendingRecordings = localRecordings.filter(r => r.needsSync);

            if (pendingRecordings.length === 0) {
                return { success: true, synced: 0 };
            }

            console.log(`StorageManager: Syncing ${pendingRecordings.length} pending recordings`);

            const { ApiService } = await import('./api-service.js');
            const apiService = new ApiService();

            let syncedCount = 0;
            const updatedLocalRecordings = [...localRecordings];

            for (const recording of pendingRecordings) {
                try {
                    // Convert blob data back to blob for upload
                    const response = await fetch(recording.blob);
                    const blob = await response.blob();

                    // Remove blob from metadata
                    const { blob: _, ...metadata } = recording;

                    const uploadResult = await apiService.uploadRecording(blob, metadata);

                    if (uploadResult.success) {
                        // Update the local recording to mark as synced
                        const recordingIndex = updatedLocalRecordings.findIndex(r => r.id === recording.id);
                        if (recordingIndex !== -1) {
                            updatedLocalRecordings[recordingIndex] = {
                                ...uploadResult.recording,
                                needsSync: false,
                                isLocal: false
                            };
                            delete updatedLocalRecordings[recordingIndex].blob;
                        }

                        // Also add to cloud recordings
                        await this.addRecording(uploadResult.recording);

                        syncedCount++;
                    }
                } catch (error) {
                    console.error('StorageManager: Failed to sync recording:', recording.id, error);
                }
            }

            // Update local recordings
            await chrome.storage.local.set({
                [this.STORAGE_KEYS.LOCAL_RECORDINGS]: updatedLocalRecordings
            });

            console.log(`StorageManager: Successfully synced ${syncedCount} recordings`);
            return { success: true, synced: syncedCount };

        } catch (error) {
            console.error('StorageManager: Failed to sync recordings:', error);
            return { success: false, error: error.message };
        }
    }

    async getStorageUsage() {
        try {
            const recordings = await this.getRecordings();

            const stats = {
                totalRecordings: recordings.length,
                cloudRecordings: recordings.filter(r => !r.isLocal).length,
                localRecordings: recordings.filter(r => r.isLocal).length,
                pendingSyncRecordings: recordings.filter(r => r.needsSync).length,
                totalSize: recordings.reduce((sum, r) => sum + (r.fileSize || 0), 0),
                totalDuration: recordings.reduce((sum, r) => sum + (r.duration || 0), 0)
            };

            return stats;
        } catch (error) {
            console.error('StorageManager: Failed to get storage usage:', error);
            return null;
        }
    }

    async clearExpiredRecordings(maxAge = 30) {
        try {
            const recordings = await this.getRecordings();
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - maxAge);

            const expiredRecordings = recordings.filter(r => {
                const recordingDate = new Date(r.startTime || r.createdAt);
                return recordingDate < cutoffDate && r.isLocal;
            });

            for (const recording of expiredRecordings) {
                await this.deleteRecording(recording.id);
            }

            console.log(`StorageManager: Cleared ${expiredRecordings.length} expired recordings`);
            return { success: true, cleared: expiredRecordings.length };
        } catch (error) {
            console.error('StorageManager: Failed to clear expired recordings:', error);
            return { success: false, error: error.message };
        }
    }
}