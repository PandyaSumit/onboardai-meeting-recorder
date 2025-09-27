// services/api-service.js
export class ApiService {
    constructor() {
        this.baseURL = this.getApiBaseURL();
        this.defaultHeaders = {
            'Content-Type': 'application/json'
        };
    }

    getApiBaseURL() {
        // Use environment-specific API URL
        if (typeof chrome !== 'undefined' && chrome.runtime) {
            const manifest = chrome.runtime.getManifest();
            const isDev = manifest.key === undefined; // Development builds don't have a key
            return isDev ? 'http://localhost:3000/api' : 'https://api.meetingrecorder.com';
        }
        return 'http://localhost:3000/api';
    }

    async getAuthHeaders() {
        try {
            const { StorageManager } = await import('./storage-manager.js');
            const storageManager = new StorageManager();
            const apiConfig = await storageManager.getApiConfig();

            if (apiConfig && apiConfig.apiKey) {
                return {
                    ...this.defaultHeaders,
                    'Authorization': `Bearer ${apiConfig.apiKey}`
                };
            }
        } catch (error) {
            console.warn('ApiService: Could not get auth headers:', error);
        }

        return this.defaultHeaders;
    }

    async makeRequest(endpoint, options = {}) {
        try {
            const url = `${this.baseURL}${endpoint}`;
            const headers = await this.getAuthHeaders();

            const requestOptions = {
                ...options,
                headers: {
                    ...headers,
                    ...options.headers
                }
            };

            console.log(`ApiService: Making ${requestOptions.method || 'GET'} request to ${endpoint}`);

            const response = await fetch(url, requestOptions);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API Error ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            console.log(`ApiService: Request to ${endpoint} successful`);
            return data;

        } catch (error) {
            console.error(`ApiService: Request to ${endpoint} failed:`, error);
            throw error;
        }
    }

    async uploadRecording(blob, metadata) {
        try {
            const formData = new FormData();

            // Create filename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `meeting-${timestamp}.webm`;

            formData.append('recording', blob, filename);
            formData.append('metadata', JSON.stringify(metadata));

            const headers = await this.getAuthHeaders();
            delete headers['Content-Type']; // Let browser set content-type for FormData

            const response = await fetch(`${this.baseURL}/recordings/upload`, {
                method: 'POST',
                headers,
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Upload failed: ${response.status} ${errorText}`);
            }

            const result = await response.json();

            if (result.success) {
                console.log('ApiService: Recording uploaded successfully:', result.recording.id);
                return { success: true, recording: result.recording };
            } else {
                throw new Error(result.message || 'Upload failed');
            }

        } catch (error) {
            console.error('ApiService: Upload failed:', error);
            return { success: false, error: error.message };
        }
    }

    async getRecordings(limit = 50, offset = 0) {
        try {
            const data = await this.makeRequest(`/recordings?limit=${limit}&offset=${offset}`);
            return data.recordings || [];
        } catch (error) {
            console.error('ApiService: Failed to get recordings:', error);
            throw error;
        }
    }

    async getRecording(id) {
        try {
            const data = await this.makeRequest(`/recordings/${id}`);
            return data.recording;
        } catch (error) {
            console.error('ApiService: Failed to get recording:', error);
            throw error;
        }
    }

    async deleteRecording(id) {
        try {
            await this.makeRequest(`/recordings/${id}`, {
                method: 'DELETE'
            });
            console.log('ApiService: Recording deleted successfully:', id);
            return { success: true };
        } catch (error) {
            console.error('ApiService: Failed to delete recording:', error);
            return { success: false, error: error.message };
        }
    }

    async updateRecording(id, updates) {
        try {
            const data = await this.makeRequest(`/recordings/${id}`, {
                method: 'PATCH',
                body: JSON.stringify(updates)
            });
            console.log('ApiService: Recording updated successfully:', id);
            return { success: true, recording: data.recording };
        } catch (error) {
            console.error('ApiService: Failed to update recording:', error);
            return { success: false, error: error.message };
        }
    }

    async authenticateUser(credentials) {
        try {
            const data = await this.makeRequest('/auth/login', {
                method: 'POST',
                body: JSON.stringify(credentials)
            });

            if (data.success && data.accessToken) {
                // Store API configuration
                const { StorageManager } = await import('./storage-manager.js');
                const storageManager = new StorageManager();

                await storageManager.updateApiConfig({
                    apiKey: data.accessToken,
                    user: data.user,
                    expiresAt: data.expiresAt
                });

                console.log('ApiService: User authenticated successfully');
                return { success: true, user: data.user };
            } else {
                throw new Error(data.message || 'Authentication failed');
            }
        } catch (error) {
            console.error('ApiService: Authentication failed:', error);
            return { success: false, error: error.message };
        }
    }

    async logoutUser() {
        try {
            await this.makeRequest('/auth/logout', {
                method: 'POST'
            });

            // Clear local API configuration
            const { StorageManager } = await import('./storage-manager.js');
            const storageManager = new StorageManager();
            await storageManager.updateApiConfig(null);

            console.log('ApiService: User logged out successfully');
            return { success: true };
        } catch (error) {
            console.error('ApiService: Logout failed:', error);
            return { success: false, error: error.message };
        }
    }

    async validateApiKey() {
        try {
            const data = await this.makeRequest('/auth/validate');
            return { success: true, valid: data.valid, user: data.user };
        } catch (error) {
            console.error('ApiService: API key validation failed:', error);
            return { success: false, valid: false };
        }
    }

    async getStorageQuota() {
        try {
            const data = await this.makeRequest('/user/quota');
            return {
                success: true,
                quota: data.quota
            };
        } catch (error) {
            console.error('ApiService: Failed to get storage quota:', error);
            return { success: false, error: error.message };
        }
    }

    async generateDownloadUrl(recordingId) {
        try {
            const data = await this.makeRequest(`/recordings/${recordingId}/download-url`);
            return { success: true, downloadUrl: data.downloadUrl };
        } catch (error) {
            console.error('ApiService: Failed to generate download URL:', error);
            return { success: false, error: error.message };
        }
    }

    // Health check endpoint
    async checkApiHealth() {
        try {
            const data = await this.makeRequest('/health');
            return { success: true, healthy: data.status === 'ok' };
        } catch (error) {
            console.error('ApiService: Health check failed:', error);
            return { success: false, healthy: false };
        }
    }
}