// content.js - Content Script for Meeting Detection and Context

class MeetingDetector {
    constructor() {
        this.meetingPlatforms = {
            'zoom.us': { name: 'Zoom', selector: '.meeting-title, .meeting-topic' },
            'meet.google.com': { name: 'Google Meet', selector: '[data-meeting-title], .google-meet-title' },
            'teams.microsoft.com': { name: 'Microsoft Teams', selector: '[data-tid="meeting-title"], .meeting-title' },
            'webex.com': { name: 'Webex', selector: '.meeting-info-title, .meeting-title' },
            'gotomeeting.com': { name: 'GoToMeeting', selector: '.meeting-title, .session-title' },
            'bluejeans.com': { name: 'BlueJeans', selector: '.meeting-title, .room-title' }
        };

        this.isDetected = false;
        this.currentMeeting = null;
        this.participants = new Set();
        this.recordingIndicator = null;

        this.init();
    }

    init() {
        this.detectMeetingPlatform();
        this.setupMeetingObserver();
        this.setupParticipantObserver();
        this.injectRecordingIndicator();

        // Listen for messages from background script
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            console.log('Content script received message:', request.action);

            switch (request.action) {
                case 'getMeetingContext':
                    sendResponse(this.getMeetingContext());
                    break;
                case 'updateRecordingStatus':
                    console.log('Updating recording status:', request.isRecording);
                    this.updateRecordingIndicator(request.isRecording);
                    sendResponse({ success: true });
                    break;
                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        });

        // Check if recording is already active on page load
        this.checkRecordingStatus();
    }

    async checkRecordingStatus() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'getRecordingStatus'
            });

            if (response && response.isRecording) {
                console.log('Recording is already active, showing indicator');
                this.updateRecordingIndicator(true);
            }
        } catch (error) {
            console.error('Failed to check recording status:', error);
        }
    }

    detectMeetingPlatform() {
        const hostname = window.location.hostname;
        const platform = Object.keys(this.meetingPlatforms).find(key =>
            hostname.includes(key) || hostname.includes(key.replace('.com', ''))
        );

        if (platform) {
            this.currentMeeting = {
                platform: this.meetingPlatforms[platform].name,
                url: window.location.href,
                title: this.extractMeetingTitle(this.meetingPlatforms[platform].selector),
                startTime: new Date(),
                participants: []
            };
            this.isDetected = true;

            console.log('Meeting detected:', this.currentMeeting);
        }
    }

    extractMeetingTitle(selector) {
        try {
            const elements = document.querySelectorAll(selector);
            for (const element of elements) {
                if (element && element.textContent.trim()) {
                    return element.textContent.trim();
                }
            }

            // Fallback: try to extract from page title
            const pageTitle = document.title;
            if (pageTitle && !pageTitle.includes('Loading') && !pageTitle.includes('Joining')) {
                return pageTitle;
            }

            return 'Meeting'; // Final fallback
        } catch (error) {
            console.error('Error extracting meeting title:', error);
            return 'Meeting';
        }
    }

    setupMeetingObserver() {
        // Observe DOM changes to detect when meeting title becomes available
        const observer = new MutationObserver((mutations) => {
            if (this.isDetected && this.currentMeeting) {
                const platform = Object.keys(this.meetingPlatforms).find(key =>
                    window.location.hostname.includes(key)
                );

                if (platform) {
                    const newTitle = this.extractMeetingTitle(this.meetingPlatforms[platform].selector);
                    if (newTitle && newTitle !== this.currentMeeting.title) {
                        this.currentMeeting.title = newTitle;
                        console.log('Meeting title updated:', newTitle);
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    setupParticipantObserver() {
        // Platform-specific participant detection
        const hostname = window.location.hostname;

        if (hostname.includes('zoom.us')) {
            this.observeZoomParticipants();
        } else if (hostname.includes('meet.google.com')) {
            this.observeGoogleMeetParticipants();
        } else if (hostname.includes('teams.microsoft.com')) {
            this.observeTeamsParticipants();
        }
    }

    observeZoomParticipants() {
        const observer = new MutationObserver(() => {
            const participantElements = document.querySelectorAll(
                '.participants-item-name, .participants-li-name, [data-testid="participant-name"]'
            );

            const currentParticipants = new Set();
            participantElements.forEach(element => {
                const name = element.textContent.trim();
                if (name && name !== 'You') {
                    currentParticipants.add(name);
                }
            });

            if (currentParticipants.size !== this.participants.size) {
                this.participants = currentParticipants;
                this.updateMeetingParticipants();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    observeGoogleMeetParticipants() {
        const observer = new MutationObserver(() => {
            const participantElements = document.querySelectorAll(
                '[data-participant-name], .participant-name, [aria-label*="participant"]'
            );

            const currentParticipants = new Set();
            participantElements.forEach(element => {
                const name = element.textContent?.trim() || element.getAttribute('aria-label');
                if (name && !name.includes('You') && !name.includes('yourself')) {
                    currentParticipants.add(name);
                }
            });

            if (currentParticipants.size !== this.participants.size) {
                this.participants = currentParticipants;
                this.updateMeetingParticipants();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    observeTeamsParticipants() {
        const observer = new MutationObserver(() => {
            const participantElements = document.querySelectorAll(
                '[data-tid="roster-participant-name"], .participant-name, .roster-participant-name'
            );

            const currentParticipants = new Set();
            participantElements.forEach(element => {
                const name = element.textContent.trim();
                if (name && name !== 'You' && !name.includes('(You)')) {
                    currentParticipants.add(name);
                }
            });

            if (currentParticipants.size !== this.participants.size) {
                this.participants = currentParticipants;
                this.updateMeetingParticipants();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
    }

    updateMeetingParticipants() {
        if (this.currentMeeting) {
            this.currentMeeting.participants = Array.from(this.participants);
            console.log('Participants updated:', this.currentMeeting.participants);
        }
    }

    getMeetingContext() {
        return {
            isInMeeting: this.isDetected,
            meeting: this.currentMeeting,
            url: window.location.href,
            title: document.title,
            participants: Array.from(this.participants)
        };
    }

    injectRecordingIndicator() {
        // Remove existing indicator if any
        const existingIndicator = document.getElementById('meeting-recorder-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }

        // Create recording indicator element
        const indicator = document.createElement('div');
        indicator.id = 'meeting-recorder-indicator';
        indicator.innerHTML = `
            <div class="pulse-dot"></div>
            <span class="recording-text">Recording</span>
        `;

        indicator.style.cssText = `
            position: fixed !important;
            top: 20px !important;
            right: 20px !important;
            z-index: 999999 !important;
            background: #dc2626 !important;
            color: white !important;
            padding: 12px 20px !important;
            border-radius: 25px !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            font-size: 14px !important;
            font-weight: 600 !important;
            display: none !important;
            align-items: center !important;
            gap: 10px !important;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3) !important;
            border: 2px solid rgba(255,255,255,0.2) !important;
            backdrop-filter: blur(10px) !important;
            transition: all 0.3s ease !important;
            pointer-events: none !important;
        `;

        // Add CSS for pulsing animation
        const style = document.createElement('style');
        style.textContent = `
            #meeting-recorder-indicator .pulse-dot {
                width: 10px !important;
                height: 10px !important;
                background: white !important;
                border-radius: 50% !important;
                animation: meeting-recorder-pulse 1.5s infinite !important;
            }
            
            @keyframes meeting-recorder-pulse {
                0%, 100% { 
                    opacity: 1 !important;
                    transform: scale(1) !important;
                }
                50% { 
                    opacity: 0.3 !important;
                    transform: scale(0.8) !important;
                }
            }
            
            #meeting-recorder-indicator:hover {
                transform: scale(1.05) !important;
                box-shadow: 0 6px 25px rgba(0,0,0,0.4) !important;
            }
        `;

        document.head.appendChild(style);
        document.body.appendChild(indicator);
        this.recordingIndicator = indicator;

        console.log('Recording indicator injected');
    }

    updateRecordingIndicator(isRecording) {
        console.log('updateRecordingIndicator called with:', isRecording);

        const indicator = document.getElementById('meeting-recorder-indicator');
        if (!indicator) {
            console.warn('Recording indicator not found, re-injecting...');
            this.injectRecordingIndicator();
            return;
        }

        if (isRecording) {
            console.log('Showing recording indicator');
            indicator.style.display = 'flex';

            // Add a slight delay and force a repaint
            setTimeout(() => {
                indicator.style.opacity = '1';
                indicator.style.transform = 'translateY(0)';
            }, 100);

            // Also update the page title to indicate recording
            if (!document.title.includes('🔴')) {
                document.title = '🔴 ' + document.title;
            }
        } else {
            console.log('Hiding recording indicator');
            indicator.style.display = 'none';

            // Remove recording indicator from title
            if (document.title.includes('🔴 ')) {
                document.title = document.title.replace('🔴 ', '');
            }
        }
    }
}

// Initialize meeting detector
console.log('Initializing meeting detector...');
const meetingDetector = new MeetingDetector();