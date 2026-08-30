const HOST_NAME = 'org.mediafabproject.queue_mode_companion';

export class CompanionClient {
    constructor() {
        this.port = null;
        this.pending = new Map();
        this.listeners = new Set();
        this.nextRequestId = 1;
        this.disconnectMessage = '';
    }

    connect() {
        if (this.port) {
            return;
        }
        try {
            this.port = chrome.runtime.connectNative(HOST_NAME);
            this.port.onMessage.addListener((message) => this.handleMessage(message));
            this.port.onDisconnect.addListener(() => {
                this.disconnectMessage = chrome.runtime.lastError?.message || 'Companion disconnected.';
                this.port = null;
                for (const { reject } of this.pending.values()) {
                    reject(new Error(this.disconnectMessage));
                }
                this.pending.clear();
                this.emit({ type: 'connection', connected: false, message: this.disconnectMessage });
            });
            this.emit({ type: 'connection', connected: true, message: 'Connecting…' });
        } catch (error) {
            this.disconnectMessage = error.message;
            this.emit({ type: 'connection', connected: false, message: error.message });
        }
    }

    onEvent(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    emit(message) {
        for (const listener of this.listeners) {
            listener(message);
        }
    }

    handleMessage(message) {
        if (message?.requestId && this.pending.has(message.requestId)) {
            const pending = this.pending.get(message.requestId);
            this.pending.delete(message.requestId);
            if (message.ok === false) {
                const error = new Error(message.error || 'Companion request failed.');
                error.pauseQueue = message.pauseQueue === true;
                pending.reject(error);
            } else {
                pending.resolve(message);
            }
            return;
        }
        this.emit(message);
    }

    request(type, payload = {}) {
        this.connect();
        if (!this.port) {
            return Promise.reject(new Error(this.disconnectMessage || 'Companion is not connected.'));
        }
        const requestId = String(this.nextRequestId++);
        return new Promise((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
            this.port.postMessage({ type, requestId, ...payload });
        });
    }
}
