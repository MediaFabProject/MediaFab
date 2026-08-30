const MANIFEST_PRIORITY = Object.freeze({
    HLS_MASTER: 50,
    DASH: 40,
    MSS: 40,
    DIRECT_MP4: 35,
    HLS_PLAYLIST: 20,
});

function headerNameMatches(left, right) {
    return String(left).toLowerCase() === String(right).toLowerCase();
}

export function mergeCaptureHeaders(existing = {}, incoming = {}) {
    const merged = { ...(existing || {}) };
    for (const [name, value] of Object.entries(incoming || {})) {
        const priorName = Object.keys(merged).find((candidate) => headerNameMatches(candidate, name));
        if (priorName && priorName !== name) {
            delete merged[priorName];
        }
        if (value != null && value !== '') {
            merged[name] = value;
        }
    }
    return merged;
}

export function hasUsableContentKeys(keys = []) {
    return keys.some((key) => key?.kid && key?.k);
}

export function isCrunchyrollProtectedManifest(url) {
    try {
        const parsed = new URL(url);
        return /(^|\.)crunchyroll\.com$/i.test(parsed.hostname)
            && parsed.pathname.startsWith('/playback/')
            && parsed.pathname.split('/').includes('cenc');
    } catch {
        return false;
    }
}

export function prepareManifestForDispatch(manifest, pageUrl, latestHeaders = {}) {
    if (!manifest) {
        return null;
    }
    const prepared = {
        ...manifest,
        headers: mergeCaptureHeaders(manifest.headers, latestHeaders),
    };
    try {
        const page = new URL(pageUrl);
        const media = new URL(prepared.url);
        const isCrunchyrollWatch = /(^|\.)crunchyroll\.com$/i.test(page.hostname)
            && /\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?watch\/[^/]+/i.test(page.pathname);
        const isCrunchyrollManifest = /(^|\.)crunchyroll\.com$/i.test(media.hostname)
            && media.pathname.startsWith('/playback/');
        const hasReferer = Object.keys(prepared.headers).some((name) => headerNameMatches(name, 'referer'));
        if (isCrunchyrollWatch && isCrunchyrollManifest && !hasReferer) {
            prepared.headers.Referer = page.href;
        }
    } catch {
        // Keep the browser-observed values when either URL is malformed.
    }
    return prepared;
}

export function hasRequiredProtectedHeaders(manifest, pageUrl) {
    if (!manifest) {
        return false;
    }
    try {
        const page = new URL(pageUrl);
        const media = new URL(manifest.url);
        const isCrunchyrollWatch = /(^|\.)crunchyroll\.com$/i.test(page.hostname)
            && /\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?watch\/[^/]+/i.test(page.pathname);
        const isCrunchyrollManifest = /(^|\.)crunchyroll\.com$/i.test(media.hostname)
            && media.pathname.startsWith('/playback/');
        if (!isCrunchyrollWatch || !isCrunchyrollManifest) {
            return true;
        }
        const names = Object.keys(manifest.headers || {}).map((name) => name.toLowerCase());
        return ['authorization', 'cookie', 'referer'].every((name) => names.includes(name));
    } catch {
        return false;
    }
}

export class MultiModeCaptureOwnership {
    constructor(now = () => Date.now()) {
        this.now = now;
        this.byTabId = new Map();
    }

    register({ tabId, jobId, navigationId, pageUrl }) {
        if (!Number.isInteger(tabId) || tabId < 0) {
            throw new TypeError('A Queue Mode capture needs a browser tab ID.');
        }
        if (!jobId || !navigationId) {
            throw new TypeError('A Queue Mode capture needs job and navigation IDs.');
        }
        const state = {
            tabId,
            jobId: String(jobId),
            navigationId: String(navigationId),
            pageUrl: String(pageUrl || ''),
            registeredAtMs: this.now(),
            armed: false,
            protected: false,
            readySent: false,
            manifests: new Map(),
            subtitles: new Map(),
        };
        this.byTabId.set(tabId, state);
        return state;
    }

    arm(tabId, pageUrl) {
        const state = this.get(tabId);
        if (!state) {
            return null;
        }
        state.pageUrl = String(pageUrl || state.pageUrl || '');
        state.armed = true;
        state.protected = false;
        state.readySent = false;
        state.manifests.clear();
        state.subtitles.clear();
        delete state.protectedResult;
        return state;
    }

    get(tabId) {
        return this.byTabId.get(tabId) || null;
    }

    clear() {
        this.byTabId.clear();
    }

    release(tabId, navigationId = null) {
        const state = this.get(tabId);
        if (!state || (navigationId && state.navigationId !== String(navigationId))) {
            return false;
        }
        this.byTabId.delete(tabId);
        return true;
    }

    markProtected(tabId) {
        const state = this.get(tabId);
        if (state?.armed) {
            state.protected = true;
        }
        return state?.armed ? state : null;
    }

    recordManifest(tabId, manifest) {
        const state = this.get(tabId);
        if (!state?.armed || !manifest?.url) {
            return null;
        }
        const existing = state.manifests.get(manifest.url) || {};
        state.manifests.set(manifest.url, {
            ...existing,
            ...manifest,
            headers: mergeCaptureHeaders(existing.headers, manifest.headers),
            capturedAtMs: this.now(),
        });
        return state;
    }

    recordSubtitle(tabId, subtitle) {
        const state = this.get(tabId);
        if (!state?.armed || !subtitle?.url) {
            return { state: null, added: false, late: false };
        }
        const identity = subtitle.contentIdentity || subtitle.url;
        const added = !state.subtitles.has(identity);
        state.subtitles.set(identity, {
            ...(state.subtitles.get(identity) || {}),
            ...subtitle,
            capturedAtMs: this.now(),
        });
        return { state, added, late: state.readySent };
    }

    bestManifest(tabId) {
        const state = this.get(tabId);
        if (!state) {
            return null;
        }
        return [...state.manifests.values()].sort((left, right) =>
            (MANIFEST_PRIORITY[right.type] || 0) - (MANIFEST_PRIORITY[left.type] || 0)
                || right.capturedAtMs - left.capturedAtMs
        )[0] || null;
    }

    createReadyCapture(tabId, { keys = [], pssh = null } = {}) {
        const state = this.get(tabId);
        const manifest = this.bestManifest(tabId);
        if (!state || !manifest
            || (state.protected && (!hasUsableContentKeys(keys) || !hasRequiredProtectedHeaders(manifest, state.pageUrl)))) {
            return null;
        }
        state.readySent = true;
        return {
            jobId: state.jobId,
            navigationId: state.navigationId,
            capture: {
                capturedAtMs: this.now(),
                pageUrl: state.pageUrl,
                manifest,
                keys,
                pssh,
                subtitles: [...state.subtitles.values()],
            },
        };
    }
}
