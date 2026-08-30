import "./lib/protobuf.min.js";
import "./lib/license_protocol.min.js";
const { SignedMessage, LicenseRequest, License } = protobuf.roots.default.license_protocol;

import "./lib/forge.min.js";

import { Session } from "./lib/cdm.js";
import { DeviceManager, SettingsManager, AsyncLocalStorage, RemoteCDMManager, IconManager, Util } from "./lib/util.js";
import { WidevineDevice } from "./lib/device.js";
import { RemoteCdm } from "./lib/remote_cdm.js";
import {
    MultiModeCaptureOwnership,
    isCrunchyrollProtectedManifest,
    mergeCaptureHeaders,
    prepareManifestForDispatch,
} from "./multi-mode/capture-state.mjs";

const MEDIAFAB_CONTENT_SCRIPTS = [
    {
        id: "MEDIAFAB_ISOLATED",
        matches: ["<all_urls>"],
        js: ["message_proxy.js"],
        runAt: "document_start",
        world: "ISOLATED",
        allFrames: true,
    },
    {
        id: "MEDIAFAB_MAIN",
        matches: ["<all_urls>"],
        js: ["content_script.js"],
        runAt: "document_start",
        world: "MAIN",
        allFrames: true,
    },
];
let contentScriptRegistrationPromise = null;

async function syncContentScriptRegistration() {
    if (!chrome.scripting) {
        throw new Error("This browser does not support enabled-only content-script registration.");
    }
    if (contentScriptRegistrationPromise) {
        return contentScriptRegistrationPromise;
    }
    contentScriptRegistrationPromise = (async () => {
        const registered = await chrome.scripting.getRegisteredContentScripts();
        const registeredIds = new Set(registered.map((script) => script.id));
        const mediaFabIds = MEDIAFAB_CONTENT_SCRIPTS.map((script) => script.id);
        if (await SettingsManager.getEnabled()) {
            const missing = MEDIAFAB_CONTENT_SCRIPTS.filter((script) => !registeredIds.has(script.id));
            const existing = MEDIAFAB_CONTENT_SCRIPTS.filter((script) => registeredIds.has(script.id));
            if (missing.length) {
                await chrome.scripting.registerContentScripts(missing);
            }
            if (existing.length) {
                await chrome.scripting.updateContentScripts(existing);
            }
        } else {
            const activeIds = mediaFabIds.filter((id) => registeredIds.has(id));
            if (activeIds.length) {
                await chrome.scripting.unregisterContentScripts({ ids: activeIds });
            }
        }
    })().finally(() => {
        contentScriptRegistrationPromise = null;
    });
    return contentScriptRegistrationPromise;
}


let manifests = new Map();
let subtitles = new Map();
let requests = new Map();
let sessions = new Map();
let logs = [];
const subtitleCaptureWindowMs = 60 * 1000;
// Give an HLS master a moment to expose a media playlist and its duration
// before presenting the single public-media entry.
const publicManifestCaptureDelayMs = 3000;
let protectedPages = new Map();
let queuedPublicManifests = new Map();
let capturedPublicManifests = new Set();
let jwMasterRecoveries = new Map();
const multiModeCaptures = new MultiModeCaptureOwnership();
const multiModePublicTimers = new Map();
const multiModeProtectedTimers = new Map();
const multiModeProtectedSettleMs = 1250;
const mediaFabExtensionOrigin = new URL(chrome.runtime.getURL('/')).origin;
const crunchyrollCatalogueRequestFilter = {
    urls: [
        'https://www.crunchyroll.com/auth/v1/token*',
        'https://www.crunchyroll.com/content/v2/cms/*',
    ],
};
function isMediaFabExtensionRequest(details) {
    return [details.initiator, details.originUrl, details.documentUrl]
        .some((value) => {
            try {
                return typeof value === 'string' && new URL(value).origin === mediaFabExtensionOrigin;
            } catch {
                return false;
            }
        });
}

function useCrunchyrollCatalogueUserAgent(details) {
    if (!isMediaFabExtensionRequest(details)) {
        return {};
    }
    const requestHeaders = [...(details.requestHeaders || [])];
    const userAgent = requestHeaders.find((header) => header.name.toLowerCase() === 'user-agent');
    if (userAgent) {
        userAgent.value = 'Crunchyroll/1.8.0';
    } else {
        requestHeaders.push({ name: 'User-Agent', value: 'Crunchyroll/1.8.0' });
    }
    return { requestHeaders };
}

chrome.webRequest.onBeforeSendHeaders.addListener(
    useCrunchyrollCatalogueUserAgent,
    crunchyrollCatalogueRequestFilter,
    ['blocking', 'requestHeaders', chrome.webRequest.OnSendHeadersOptions.EXTRA_HEADERS].filter(Boolean),
);

function sendMultiModeEvent(message) {
    try {
        const pending = chrome.runtime.sendMessage(message);
        if (pending?.catch) {
            pending.catch(() => {});
        }
    } catch {
        // The Queue Mode control page may have been closed between capture events.
    }
}

function clearMultiModePublicTimer(tabId) {
    const timer = multiModePublicTimers.get(tabId);
    if (timer) {
        clearTimeout(timer);
        multiModePublicTimers.delete(tabId);
    }
}

function clearMultiModeProtectedTimer(tabId) {
    const timer = multiModeProtectedTimers.get(tabId);
    if (timer) {
        clearTimeout(timer);
        multiModeProtectedTimers.delete(tabId);
    }
}

function dispatchMultiModeCaptureReady(tabId) {
    const state = multiModeCaptures.get(tabId);
    if (!state || state.readySent) {
        return;
    }
    const selected = multiModeCaptures.bestManifest(tabId);
    if (selected) {
        multiModeCaptures.recordManifest(tabId, prepareManifestForDispatch(
            selected,
            state.pageUrl,
            requests.get(selected.url) || {},
        ));
    }
    const ready = multiModeCaptures.createReadyCapture(tabId, state.protectedResult || {});
    if (ready) {
        sendMultiModeEvent({ type: "MULTI_MODE_CAPTURE_READY", ...ready });
    }
}

function scheduleMultiModeProtectedCapture(tabId) {
    if (multiModeProtectedTimers.has(tabId)) {
        return;
    }
    multiModeProtectedTimers.set(tabId, setTimeout(() => {
        multiModeProtectedTimers.delete(tabId);
        dispatchMultiModeCaptureReady(tabId);
    }, multiModeProtectedSettleMs));
}

function emitMultiModeCaptureReady(tabId, protectedResult = null) {
    clearMultiModePublicTimer(tabId);
    const state = multiModeCaptures.get(tabId);
    if (state && protectedResult) {
        state.protectedResult = protectedResult;
    }
    if (state?.protected) {
        scheduleMultiModeProtectedCapture(tabId);
    } else {
        dispatchMultiModeCaptureReady(tabId);
    }
}

function recordMultiModeManifest(tabId, manifest) {
    if (isCrunchyrollProtectedManifest(manifest?.url)) {
        markMultiModeProtected(tabId);
    }
    const state = multiModeCaptures.recordManifest(tabId, manifest);
    if (!state || state.readySent) {
        return;
    }
    if (state.protected) {
        if (state.protectedResult) {
            emitMultiModeCaptureReady(tabId);
        }
        return;
    }
    clearMultiModePublicTimer(tabId);
    const delayMs = manifest.type === "HLS_PLAYLIST"
        ? 600
        : (manifest.type === "DASH" || manifest.type === "MSS" ? 1500 : 100);
    multiModePublicTimers.set(tabId, setTimeout(() => {
        multiModePublicTimers.delete(tabId);
        const current = multiModeCaptures.get(tabId);
        if (current && !current.protected && !current.readySent) {
            emitMultiModeCaptureReady(tabId);
        }
    }, delayMs));
}

function markMultiModeProtected(tabId) {
    if (multiModeCaptures.markProtected(tabId)) {
        clearMultiModePublicTimer(tabId);
    }
}

function getManifestTypeFromUrl(url) {
    try {
        const pathname = new URL(url).pathname.toLowerCase();
        if (pathname.endsWith(".m3u8")) {
            return "HLS_PLAYLIST";
        }
        if (pathname.endsWith(".mpd")) {
            return "DASH";
        }
        // A Smooth Streaming manifest ends at `*.ism/Manifest`. Do not match
        // the `.ts` chunks that happen to live beneath the same `.ism` path.
        if (/\.ism\/manifest$/i.test(pathname)) {
            return "MSS";
        }
    } catch {
        // A malformed URL cannot be a usable media manifest.
    }
    return null;
}

function addManifest(tabUrl, manifest) {
    if (!tabUrl) {
        return;
    }

    const elements = manifests.get(tabUrl) || [];
    const existing = elements.find((element) => element.url === manifest.url);
    if (existing) {
        existing.headers = manifest.headers || existing.headers;
        existing.durationSeconds = manifest.durationSeconds || existing.durationSeconds || null;
        // The URL-only network observer sees every HLS file as a playlist.
        // Preserve the body-aware HLS master classification when it arrives.
        if (manifest.type === "HLS_MASTER" || existing.type !== "HLS_MASTER") {
            existing.type = manifest.type || existing.type;
        }
    } else {
        elements.push(manifest);
        manifests.set(tabUrl, elements);
    }
}

function getLongestManifestDuration(tabUrl) {
    return (manifests.get(tabUrl) || []).reduce((longest, manifest) =>
        Math.max(longest, Number(manifest.durationSeconds) || 0), 0
    ) || null;
}

function getHlsMediaIdentity(url) {
    try {
        return new URL(url).pathname.match(/\/media\/([^/]+)\//i)?.[1] || null;
    } catch {
        return null;
    }
}

function getHlsPlaylistBitrate(url) {
    try {
        const filename = new URL(url).pathname.split('/').pop() || '';
        return Number(filename.match(/=(\d+)\.m3u8$/i)?.[1]) || 0;
    } catch {
        return 0;
    }
}

async function recoverJwPlayerMaster(tabUrl, mediaId, headers, tabId = -1) {
    const identity = `${tabUrl}\n${mediaId}`;
    if (!jwMasterRecoveries.has(identity)) {
        jwMasterRecoveries.set(identity, (async () => {
            try {
                const response = await fetch(`https://cdn.jwplayer.com/v2/media/${encodeURIComponent(mediaId)}`);
                if (!response.ok) {
                    return false;
                }
                const metadata = await response.json();
                const item = metadata?.playlist?.[0];
                const masterUrl = item?.sources?.find((source) =>
                    source?.type === 'application/vnd.apple.mpegurl' && typeof source.file === 'string'
                )?.file;
                if (!masterUrl) {
                    return false;
                }

                addManifest(tabUrl, {
                    type: 'HLS_MASTER',
                    url: masterUrl,
                    durationSeconds: Number(item.duration) || null,
                    headers: headers || {},
                });
                queuePublicManifest(tabUrl, {
                    type: 'HLS_MASTER',
                    url: masterUrl,
                    durationSeconds: Number(item.duration) || null,
                    headers: headers || {},
                }, tabId);
                return true;
            } catch {
                return false;
            }
        })());
    }
    const recovered = await jwMasterRecoveries.get(identity);
    if (!recovered) {
        jwMasterRecoveries.delete(identity);
    }
    return recovered;
}

function queuePublicManifest(tabUrl, manifest, tabId = -1) {
    if (!tabUrl || !manifest?.url) {
        return;
    }

    const identity = `${tabUrl}\n${manifest.url}`;
    if (capturedPublicManifests.has(identity) || queuedPublicManifests.has(identity)) {
        return;
    }

    const observedAt = Date.now();
    const timer = setTimeout(async () => {
        queuedPublicManifests.delete(identity);
        if (protectedPages.get(tabUrl) >= observedAt || capturedPublicManifests.has(identity)) {
            return;
        }

        const currentManifests = manifests.get(tabUrl) || [];
        const currentManifest = currentManifests.find((element) => element.url === manifest.url) || manifest;
        // A master playlist is the usable public entry. Its child playlists
        // are not separate videos and can carry stream-selection restrictions.
        if (currentManifest.type === "HLS_PLAYLIST"
            && currentManifests.some((element) => element.type === "HLS_MASTER")) {
            return;
        }

        const mediaIdentity = getHlsMediaIdentity(currentManifest.url);
        const isHlsPlaylistFallback = currentManifest.type === "HLS_PLAYLIST" && !currentManifests.some(
            (element) => element.type === "HLS_MASTER"
        );
        if (isHlsPlaylistFallback && mediaIdentity) {
            // JW Player's CDN child playlists contain no rendition list. Its
            // public media record supplies the master, so the user's existing
            // resolution preference can choose the closest available quality.
            if (await recoverJwPlayerMaster(tabUrl, mediaIdentity, currentManifest.headers, tabId)) {
                return;
            }
        }
        if (isHlsPlaylistFallback && mediaIdentity) {
            const currentBitrate = getHlsPlaylistBitrate(currentManifest.url);
            const hasHigherBitrateSibling = currentManifests.some((element) =>
                element.type === "HLS_PLAYLIST"
                && getHlsMediaIdentity(element.url) === mediaIdentity
                && getHlsPlaylistBitrate(element.url) > currentBitrate
            );
            if (hasHigherBitrateSibling) {
                return;
            }
        }

        const log = {
            type: "PUBLIC",
            url: tabUrl,
            timestamp: Math.floor(Date.now() / 1000),
            durationSeconds: getLongestManifestDuration(tabUrl),
            manifests: [{
                ...currentManifest,
                isHlsPlaylistFallback,
                headers: requests.get(currentManifest.url) || currentManifest.headers || {},
            }],
            subtitles: getSubtitlesNearTime(tabUrl, Date.now())
        };
        capturedPublicManifests.add(identity);
        logs.push(log);
        await AsyncLocalStorage.setStorage({[`public:${encodeURIComponent(identity)}`]: log});
        IconManager.setNotificationIcon();
    }, publicManifestCaptureDelayMs);
    queuedPublicManifests.set(identity, timer);
}

function markPageProtected(tabUrl) {
    if (!tabUrl) {
        return;
    }
    protectedPages.set(tabUrl, Date.now());
}

function getSubtitleIdentity(subtitle) {
    try {
        const url = new URL(subtitle.url);
        // Signed CDN URLs for the same sidecar can be requested more than once
        // with fresh query values. Keep the latest usable request, rather than
        // emitting multiple downloads for the same file.
        return `${url.origin}${url.pathname}`;
    } catch {
        return subtitle.url;
    }
}

function getSubtitlesNearTime(tabUrl, timestampMs) {
    return (subtitles.get(tabUrl) || []).filter((subtitle) =>
        Math.abs((subtitle.capturedAt || 0) - timestampMs) <= subtitleCaptureWindowMs
    );
}

function observeManifestRequest(details) {
    const type = getManifestTypeFromUrl(details.url);
    if (!type || details.tabId < 0) {
        return;
    }

    SettingsManager.getEnabled().then(async (enabled) => {
        if (!enabled) {
            return;
        }

        let tabUrl = "";
        try {
            // Match the top-level page URL used by the content-script path,
            // even when a player makes its media request from an iframe.
            tabUrl = (await chrome.tabs.get(details.tabId)).url || "";
        } catch {
            tabUrl = details.documentUrl || details.initiator || "";
        }
        if (!tabUrl) {
            return;
        }

        const manifest = {
            type,
            url: details.url,
            headers: requests.get(details.url) || {},
        };
        addManifest(tabUrl, manifest);
        queuePublicManifest(tabUrl, manifest, details.tabId);
        recordMultiModeManifest(details.tabId, manifest);
    }).catch(() => {
        // A request can outlive the extension's service worker state.
    });
}

chrome.webRequest.onBeforeSendHeaders.addListener(
    function(details) {
        if (details.method === "GET") {
            const headers = (details.requestHeaders || [])
                .filter(item => !(
                    item.name.startsWith('sec-ch-ua') ||
                    item.name.startsWith('Sec-Fetch') ||
                    item.name.startsWith('Accept-') ||
                    item.name.startsWith('Host') ||
                    item.name === "Connection"
                )).reduce((acc, item) => {
                    acc[item.name] = item.value;
                    return acc;
                }, {});
            requests.set(details.url, mergeCaptureHeaders(requests.get(details.url), headers));
            // Native media playback does not necessarily use fetch or XHR, so
            // observe playlist requests here as well as in the page hooks.
            observeManifestRequest(details);
        }
    },
    {urls: ["<all_urls>"]},
    ['requestHeaders', chrome.webRequest.OnSendHeadersOptions.EXTRA_HEADERS].filter(Boolean)
);

async function parseClearKey(body, sendResponse, tab_url, tab_id = -1) {
    markPageProtected(tab_url);
    markMultiModeProtected(tab_id);
    const clearkey = JSON.parse(atob(body));

    const formatted_keys = clearkey["keys"].map(key => ({
        ...key,
        kid: Util.bytesToHex(Util.b64.decode(key.kid.replace(/-/g, "+").replace(/_/g, "/") + "==")),
        k: Util.bytesToHex(Util.b64.decode(key.k.replace(/-/g, "+").replace(/_/g, "/") + "=="))
    }));
    const pssh_data = btoa(JSON.stringify({kids: clearkey["keys"].map(key => key.kid)}));

    const existingLog = logs.find(log => log.pssh_data === pssh_data);
    if (existingLog) {
        console.log("[WidevineProxy2]", `KEYS_ALREADY_RETRIEVED: ${pssh_data}`);
        emitMultiModeCaptureReady(tab_id, { keys: existingLog.keys || formatted_keys, pssh: pssh_data });
        sendResponse();
        return;
    }

    console.log("[WidevineProxy2]", "CLEARKEY KEYS", formatted_keys, tab_url);
    const log = {
        type: "CLEARKEY",
        pssh_data: pssh_data,
        keys: formatted_keys,
        url: tab_url,
        timestamp: Math.floor(Date.now() / 1000),
        manifests: manifests.has(tab_url) ? manifests.get(tab_url) : [],
        subtitles: getSubtitlesNearTime(tab_url, Date.now())
    }
    logs.push(log);

    await AsyncLocalStorage.setStorage({[pssh_data]: log});
    emitMultiModeCaptureReady(tab_id, { keys: formatted_keys, pssh: pssh_data });
    subtitles.delete(tab_url);
    sendResponse();
}

function parseChallengePayload(body) {
    try {
        const parsed = JSON.parse(body);
        if (parsed && typeof parsed.challenge === "string") {
            return {
                challenge: parsed.challenge,
                serverCertificate: typeof parsed.serverCertificate === "string"
                    ? parsed.serverCertificate
                    : null,
            };
        }
    } catch {
        // Backward compatibility with a page injected before an extension reload.
    }
    return { challenge: body, serverCertificate: null };
}

async function generateChallenge(body, sendResponse, tab_id = -1) {
    const request = parseChallengePayload(body);
    const originalChallenge = Util.b64.decode(request.challenge);
    const signed_message = SignedMessage.decode(originalChallenge);
    const license_request = LicenseRequest.decode(signed_message.msg);
    const pssh_data = license_request.contentId.widevinePsshData.psshData[0];

    if (!pssh_data) {
        console.log("[WidevineProxy2]", "NO_PSSH_DATA_IN_CHALLENGE");
        sendResponse(request.challenge);
        return;
    }

    const pssh = Session.psshDataToPsshBoxB64(pssh_data);
    const existingLog = logs.find(log => log.pssh_data === pssh);
    if (existingLog) {
        console.log("[WidevineProxy2]", `KEYS_ALREADY_RETRIEVED: ${Util.b64.encode(pssh_data)}`);
        markMultiModeProtected(tab_id);
        emitMultiModeCaptureReady(tab_id, { keys: existingLog.keys || [], pssh });
        // A cached result can satisfy Queue Mode, but the fresh browser
        // request must still be intercepted and replaced.
    }

    const selected_device_name = await DeviceManager.getSelectedWidevineDevice();
    if (!selected_device_name) {
        sendResponse(request.challenge);
        return;
    }

    const device_b64 = await DeviceManager.loadWidevineDevice(selected_device_name);
    const widevine_device = new WidevineDevice(Util.b64.decode(device_b64).buffer);

    const private_key = `-----BEGIN RSA PRIVATE KEY-----${Util.b64.encode(widevine_device.private_key)}-----END RSA PRIVATE KEY-----`;
    const session = new Session(
        {
            privateKey: private_key,
            identifierBlob: widevine_device.client_id_bytes,
            deviceType: widevine_device.type
        },
        undefined
    );

    if (request.serverCertificate) {
        await session.setServiceCertificate(Util.b64.decode(request.serverCertificate));
    }
    const result = session.getLicenseChallenge(originalChallenge, Boolean(request.serverCertificate));
    if (!result) {
        sendResponse(request.challenge);
        return;
    }
    sessions.set(Util.b64.encode(result.requestId), session);

    sendResponse(Util.b64.encode(result.licenseRequest));
}

async function parseLicense(body, sendResponse, tab_url, tab_id = -1) {
    markPageProtected(tab_url);
    markMultiModeProtected(tab_id);
    const license = Util.b64.decode(body);
    const signed_license_message = SignedMessage.decode(license);

    if (signed_license_message.type !== SignedMessage.MessageType.LICENSE) {
        sendResponse();
        return;
    }

    const license_obj = License.decode(signed_license_message.msg);
    const loaded_request_id = Util.b64.encode(license_obj.id.requestId);

    if (!sessions.has(loaded_request_id)) {
        sendResponse();
        return;
    }

    const loadedSession = sessions.get(loaded_request_id);
    const keys = await loadedSession.parseLicense(license);
    const pssh = loadedSession.getPSSH();

    console.log("[WidevineProxy2]", "KEYS", JSON.stringify(keys), tab_url);
    const log = {
        type: "WIDEVINE",
        pssh_data: pssh,
        keys: keys,
        url: tab_url,
        timestamp: Math.floor(Date.now() / 1000),
        manifests: manifests.has(tab_url) ? manifests.get(tab_url) : [],
        subtitles: getSubtitlesNearTime(tab_url, Date.now())
    }
    logs.push(log);
    await AsyncLocalStorage.setStorage({[pssh]: log});
    IconManager.setNotificationIcon();
    emitMultiModeCaptureReady(tab_id, { keys, pssh });

    subtitles.delete(tab_url);
    sessions.delete(loaded_request_id);
    sendResponse();
}

async function generateChallengeRemote(body, sendResponse, tab_id = -1) {
    const request = parseChallengePayload(body);
    const signed_message = SignedMessage.decode(Util.b64.decode(request.challenge));
    const license_request = LicenseRequest.decode(signed_message.msg);
    const pssh_data = license_request.contentId.widevinePsshData.psshData[0];

    if (!pssh_data) {
        console.log("[WidevineProxy2]", "NO_PSSH_DATA_IN_CHALLENGE");
        sendResponse(request.challenge);
        return;
    }

    const pssh = Session.psshDataToPsshBoxB64(pssh_data);

    const existingLog = logs.find(log => log.pssh_data === pssh);
    if (existingLog) {
        console.log("[WidevineProxy2]", `KEYS_ALREADY_RETRIEVED: ${Util.b64.encode(pssh_data)}`);
        markMultiModeProtected(tab_id);
        emitMultiModeCaptureReady(tab_id, { keys: existingLog.keys || [], pssh });
        // A cached result can satisfy Queue Mode, but the fresh browser
        // request must still be intercepted and replaced.
    }

    const selected_remote_cdm_name = await RemoteCDMManager.getSelectedRemoteCDM();
    if (!selected_remote_cdm_name) {
        sendResponse(request.challenge);
        return;
    }

    const selected_remote_cdm = JSON.parse(await RemoteCDMManager.loadRemoteCDM(selected_remote_cdm_name));
    const remote_cdm = RemoteCdm.from_object(selected_remote_cdm);

    const session_id = await remote_cdm.open();
    if (request.serverCertificate) {
        await remote_cdm.set_service_certificate(session_id, request.serverCertificate);
    }
    const challenge_b64 = await remote_cdm.get_license_challenge(session_id, pssh, true);

    const signed_challenge_message = SignedMessage.decode(Util.b64.decode(challenge_b64));
    const challenge_message = LicenseRequest.decode(signed_challenge_message.msg);

    sessions.set(Util.b64.encode(challenge_message.contentId.widevinePsshData.requestId), {
        id: session_id,
        pssh: pssh
    });
    sendResponse(challenge_b64);
}

async function parseLicenseRemote(body, sendResponse, tab_url, tab_id = -1) {
    markPageProtected(tab_url);
    markMultiModeProtected(tab_id);
    const license = Util.b64.decode(body);
    const signed_license_message = SignedMessage.decode(license);

    if (signed_license_message.type !== SignedMessage.MessageType.LICENSE) {
        sendResponse();
        return;
    }

    const license_obj = License.decode(signed_license_message.msg);
    const loaded_request_id = Util.b64.encode(license_obj.id.requestId);

    if (!sessions.has(loaded_request_id)) {
        sendResponse();
        return;
    }

    const session_id = sessions.get(loaded_request_id);

    const selected_remote_cdm_name = await RemoteCDMManager.getSelectedRemoteCDM();
    if (!selected_remote_cdm_name) {
        sendResponse();
        return;
    }

    const selected_remote_cdm = JSON.parse(await RemoteCDMManager.loadRemoteCDM(selected_remote_cdm_name));
    const remote_cdm = RemoteCdm.from_object(selected_remote_cdm);

    await remote_cdm.parse_license(session_id.id, body);
    const returned_keys = await remote_cdm.get_keys(session_id.id, "CONTENT");
    await remote_cdm.close(session_id.id);

    if (returned_keys.length === 0) {
        sendResponse();
        return;
    }

    const keys = returned_keys.map(({ key, key_id }) => ({ k: key, kid: key_id }));

    console.log("[WidevineProxy2]", "KEYS", JSON.stringify(keys), tab_url);
    const log = {
        type: "WIDEVINE",
        pssh_data: session_id.pssh,
        keys: keys,
        url: tab_url,
        timestamp: Math.floor(Date.now() / 1000),
        manifests: manifests.has(tab_url) ? manifests.get(tab_url) : [],
        subtitles: getSubtitlesNearTime(tab_url, Date.now())
    }
    logs.push(log);
    await AsyncLocalStorage.setStorage({[session_id.pssh]: log});
    emitMultiModeCaptureReady(tab_id, { keys, pssh: session_id.pssh });

    subtitles.delete(tab_url);
    sessions.delete(loaded_request_id);
    sendResponse();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        const tab_url = sender.tab ? sender.tab.url : null;
        const tab_id = sender.tab?.id ?? -1;

        switch (message.type) {
            case "MULTI_MODE_BEGIN_CAPTURE":
                multiModeCaptures.register({
                    tabId: Number(message.tabId),
                    jobId: message.jobId,
                    navigationId: message.navigationId,
                    pageUrl: message.pageUrl,
                });
                sendResponse({ ok: true });
                break;
            case "MULTI_MODE_END_CAPTURE":
                clearMultiModePublicTimer(Number(message.tabId));
                clearMultiModeProtectedTimer(Number(message.tabId));
                sendResponse({
                    ok: multiModeCaptures.release(Number(message.tabId), message.navigationId),
                });
                break;
            case "REQUEST":
                if (!await SettingsManager.getEnabled()) {
                    sendResponse(message.body);
                    manifests.clear();
                    subtitles.clear();
                    return;
                }

                // An EME challenge is definitive protected-playback activity.
                // Mark it before the license round trip so a slow server cannot
                // briefly publish the same manifest as a public stream.
                markPageProtected(tab_url);
                markMultiModeProtected(tab_id);

                try {
                    JSON.parse(atob(message.body));
                    sendResponse(message.body);
                    return;
                } catch {
                    if (message.body) {
                        try {
                            const device_type = await SettingsManager.getSelectedDeviceType();
                            switch (device_type) {
                                case "WVD":
                                    await generateChallenge(message.body, sendResponse, tab_id);
                                    return;
                                case "REMOTE":
                                    await generateChallengeRemote(message.body, sendResponse, tab_id);
                                    return;
                            }
                        } catch (error) {
                            throw error;
                        }
                    }
                }
                break;

            case "CERTIFICATE": {
                try {
                    const certificateMessage = SignedMessage.decode(Util.b64.decode(message.body));
                    if (certificateMessage.type === SignedMessage.MessageType.SERVICE_CERTIFICATE
                        && certificateMessage.msg) {
                        sendResponse(`CERTIFICATE:${Util.b64.encode(certificateMessage.msg)}`);
                    } else {
                        sendResponse("NOT_CERTIFICATE");
                    }
                } catch {
                    sendResponse("NOT_CERTIFICATE");
                }
                return;
            }

            case "RESPONSE":
                if (!await SettingsManager.getEnabled()) {
                    sendResponse(message.body);
                    manifests.clear();
                    subtitles.clear();
                    return;
                }

                try {
                    await parseClearKey(message.body, sendResponse, tab_url, tab_id);
                    return;
                } catch (e) {
                    const device_type = await SettingsManager.getSelectedDeviceType();
                    switch (device_type) {
                        case "WVD":
                            await parseLicense(message.body, sendResponse, tab_url, tab_id);
                            break;
                        case "REMOTE":
                            await parseLicenseRemote(message.body, sendResponse, tab_url, tab_id);
                            break;
                    }
                    return;
                }
            case "GET_LOGS":
                sendResponse(logs);
                break;
            case "OPEN_PICKER_WVD":
                chrome.windows.create({
                    url: 'picker/wvd/filePicker.html',
                    type: 'popup',
                    width: 300,
                    height: 200,
                });
                break;
            case "OPEN_PICKER_WVD_MOBILE":
                chrome.tabs.create({
                    url: chrome.runtime.getURL("picker/wvd/filePicker.html")
                });
                break;
            case "OPEN_PICKER_REMOTE":
                chrome.windows.create({
                    url: 'picker/remote/filePicker.html',
                    type: 'popup',
                    width: 300,
                    height: 200,
                });
                break;
            case "OPEN_PICKER_REMOTE_MOBILE":
                chrome.tabs.create({
                    url: chrome.runtime.getURL("picker/remote/filePicker.html")
                });
                break;
            case "CLEAR":
                logs = [];
                manifests.clear();
                subtitles.clear();
                protectedPages.clear();
                queuedPublicManifests.forEach((timer) => clearTimeout(timer));
                queuedPublicManifests.clear();
                capturedPublicManifests.clear();
                jwMasterRecoveries.clear();
                multiModePublicTimers.forEach((timer) => clearTimeout(timer));
                multiModePublicTimers.clear();
                multiModeProtectedTimers.forEach((timer) => clearTimeout(timer));
                multiModeProtectedTimers.clear();
                multiModeCaptures.clear();
                IconManager.setDefaultIcon();
                break;
            case "MANIFEST":
                const parsed = JSON.parse(message.body);
                const element = {
                    type: parsed.type,
                    url: parsed.url,
                    durationSeconds: parsed.durationSeconds || null,
                    headers: requests.has(parsed.url) ? requests.get(parsed.url) : [],
                };
                addManifest(tab_url, element);
                queuePublicManifest(tab_url, element, tab_id);
                recordMultiModeManifest(tab_id, element);
                sendResponse();
                break;
            case "DIRECT_VIDEO":
                const directVideo = JSON.parse(message.body);
                const directVideoElement = {
                    type: "DIRECT_MP4",
                    url: directVideo.url,
                    headers: requests.has(directVideo.url) ? requests.get(directVideo.url) : {},
                };
                addManifest(tab_url, directVideoElement);
                queuePublicManifest(tab_url, directVideoElement, tab_id);
                recordMultiModeManifest(tab_id, directVideoElement);
                sendResponse();
                break;
            case "SUBTITLE":
                const subtitleData = JSON.parse(message.body);
                const subtitleElement = {
                    url: subtitleData.url,
                    language: subtitleData.language || null,
                    playlist: subtitleData.playlist === true,
                    observedDirectly: subtitleData.observedDirectly === true,
                    contentIdentity: subtitleData.contentIdentity || null,
                    capturedAt: Date.now(),
                    headers: requests.has(subtitleData.url)
                        ? requests.get(subtitleData.url)
                        : (requests.has(subtitleData.sourceUrl) ? requests.get(subtitleData.sourceUrl) : []),
                };

                if (!subtitles.has(tab_url)) {
                    subtitles.set(tab_url, [subtitleElement]);
                } else {
                    let elements = subtitles.get(tab_url);
                    const existingSubtitle = elements.find(
                        e => getSubtitleIdentity(e) === getSubtitleIdentity(subtitleElement)
                    );
                    if (!existingSubtitle) {
                        elements.push(subtitleElement);
                        subtitles.set(tab_url, elements);
                    } else {
                        existingSubtitle.url = subtitleElement.url;
                        existingSubtitle.headers = subtitleElement.headers;
                        existingSubtitle.language = subtitleElement.language || existingSubtitle.language;
                        existingSubtitle.playlist ||= subtitleElement.playlist;
                        existingSubtitle.observedDirectly ||= subtitleElement.observedDirectly;
                        existingSubtitle.contentIdentity ||= subtitleElement.contentIdentity;
                        existingSubtitle.capturedAt = subtitleElement.capturedAt;
                    }
                }
                const multiModeSubtitle = multiModeCaptures.recordSubtitle(tab_id, subtitleElement);
                if (multiModeSubtitle.added && multiModeSubtitle.late) {
                    sendMultiModeEvent({
                        type: "MULTI_MODE_SUBTITLE_FOUND",
                        jobId: multiModeSubtitle.state.jobId,
                        navigationId: multiModeSubtitle.state.navigationId,
                        subtitle: subtitleElement,
                    });
                }
                sendResponse();
                break;
        }
    })();
    return true;
});

chrome.runtime.onSuspend.addListener(() => {
    IconManager.setDefaultIcon();
});

chrome.tabs.onRemoved.addListener((tabId) => {
    clearMultiModePublicTimer(tabId);
    clearMultiModeProtectedTimer(tabId);
    multiModeCaptures.release(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const state = multiModeCaptures.get(tabId);
    if (state && changeInfo.status === "loading") {
        clearMultiModePublicTimer(tabId);
        clearMultiModeProtectedTimer(tabId);
        multiModeCaptures.arm(tabId, changeInfo.url || tab.url || state.pageUrl);
    }
});

chrome.runtime.onInstalled.addListener(() => {
    syncContentScriptRegistration().catch((error) => console.error("[MediaFab] Script registration failed:", error));
});

chrome.runtime.onStartup.addListener(() => {
    syncContentScriptRegistration().catch((error) => console.error("[MediaFab] Script registration failed:", error));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "sync" && Object.prototype.hasOwnProperty.call(changes, "enabled")) {
        syncContentScriptRegistration().catch((error) => console.error("[MediaFab] Script registration failed:", error));
    }
});

syncContentScriptRegistration().catch((error) => console.error("[MediaFab] Script registration failed:", error));
