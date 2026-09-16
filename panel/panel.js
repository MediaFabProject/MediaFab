import { AsyncLocalStorage, DeviceManager, RemoteCDMManager, SettingsManager, Util } from "../lib/util.js";
import {
    getBroadwayHDDetailLink,
    getCrunchyrollDetailLink,
    resolveLPMAEGDetailLink,
    resolveMMEDetailLink,
    createLPMAEGHandoffCommand,
    createMMEHandoffCommand,
    createCrunchyrollDownloadMarkerCommand,
    createCrunchyrollMediaResolutionCommand,
    createCrunchyrollTemporarySaveNameArgument,
} from "./metadata-links.mjs";
import { buildNormalMediaCommand } from "./command-builder.mjs";
import { CompanionClient } from "../multi-mode/companion.mjs";
import {
    buildParamountPlusArguments,
    getParamountPlusPageTitle,
    isParamountPlusPage,
    mountParamountPlusSettings,
    normalizeParamountPlusSettings,
} from "../multi-mode/paramountplus-settings.mjs";
import {
    buildBBCIPlayerCommand,
    isBBCIPlayerEpisodePage,
    mountBBCIPlayerSettings,
    normalizeBBCIPlayerSettings,
} from "../multi-mode/bbc-iplayer-settings.mjs";

const key_container = document.getElementById('key-container');
const mediafab_companion_enabled = document.getElementById('mediafab-companion-enabled');
const mediafab_companion_project_folder = document.getElementById('mediafab-companion-project-folder');
const mediafab_companion_destination = document.getElementById('mediafab-companion-destination');
const mediafab_companion_status = document.getElementById('mediafab-companion-status');
const mediafabCompanion = new CompanionClient();
let mediafabCompanionConnected = false;
let connectedMediaFabCompanionFolder = '';
let activeParamountPlusUrl = '';
let activeParamountPlusTitle = '';
let paramountPlusSettings = normalizeParamountPlusSettings();
let bbcIPlayerSettings = normalizeBBCIPlayerSettings();
let activeBBCIPlayerUrl = '';
let activeBBCIPlayerTitle = '';

function buildParamountPlusNormalArguments(settings) {
    return buildParamountPlusArguments({
        ...settings,
        wanted: '',
        latestEpisode: false,
        language: settings.language === 'orig' ? '' : settings.language,
        downloadProcesses: settings.downloadProcesses === '1' ? '' : settings.downloadProcesses,
        downloads: settings.downloads === '1' ? '' : settings.downloads,
    });
}

// BBC iPlayer normal mode must remain usable even when a later asynchronous
// popup initialization step fails. Function declarations are hoisted, and the
// deferred module runs after the panel markup has been parsed.
document.getElementById('bbc-iplayer-normal-run').addEventListener('click', runBBCIPlayerNormal);

// ================ Main ================
document.getElementById('open-multi-mode').addEventListener('click', async () => {
    const multiModeUrl = new URL(chrome.runtime.getURL('multi-mode/index.html'));
    await chrome.tabs.create({ url: multiModeUrl.href });
    window.close();
});

const enabled = document.getElementById('enabled');
enabled.addEventListener('change', async function (){
    await SettingsManager.setEnabled(enabled.checked);
});

const toggle = document.getElementById('darkModeToggle');
toggle.addEventListener('change', async () => {
    SettingsManager.setDarkMode(toggle.checked);
    await SettingsManager.saveDarkMode(toggle.checked);
});

const wvd_select = document.getElementById('wvd_select');
wvd_select.addEventListener('change', async function (){
    if (wvd_select.checked) {
        await SettingsManager.saveSelectedDeviceType("WVD");
    }
});

const remote_select = document.getElementById('remote_select');
remote_select.addEventListener('change', async function (){
    if (remote_select.checked) {
        await SettingsManager.saveSelectedDeviceType("REMOTE");
    }
});

const export_button = document.getElementById('exportLogs');
export_button.addEventListener('click', async function() {
    const allStored = await AsyncLocalStorage.getStorage(null);
    const logs = Object.fromEntries(Object.entries(allStored).filter(
        ([, value]) => value && typeof value === 'object' && (value.type === 'WIDEVINE' || value.type === 'CLEARKEY' || value.type === 'PUBLIC')
    ));
    SettingsManager.downloadFile(new Blob([JSON.stringify(logs)], { type: "application/json;charset=utf-8" }), "logs.json");
});

const clear_logs = document.getElementById('clearLogs');
clear_logs.addEventListener('click', async function() {
    await SettingsManager.clearStoredLogs();
});
// ======================================

// ================ Widevine Device ================
const fileInput = document.getElementById('fileInput');
fileInput.addEventListener('click', () => {
    if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
        chrome.runtime.sendMessage({ type: "OPEN_PICKER_WVD_MOBILE" });
    } else {
        chrome.runtime.sendMessage({ type: "OPEN_PICKER_WVD" });
    }
    window.close();
});

const remove = document.getElementById('remove');
remove.addEventListener('click', async function() {
    await DeviceManager.removeSelectedWidevineDevice();
    wvd_combobox.innerHTML = '';
    await DeviceManager.loadSetAllWidevineDevices();
    const selected_option = wvd_combobox.options[wvd_combobox.selectedIndex];
    if (selected_option) {
        await DeviceManager.saveSelectedWidevineDevice(selected_option.text);
    } else {
        await DeviceManager.removeSelectedWidevineDeviceKey();
    }
});

const download = document.getElementById('download');
download.addEventListener('click', async function() {
    const widevine_device = await DeviceManager.getSelectedWidevineDevice();
    SettingsManager.downloadFile(
        Util.b64.decode(await DeviceManager.loadWidevineDevice(widevine_device)),
        widevine_device + ".wvd"
    )
});

const wvd_combobox = document.getElementById('wvd-combobox');
wvd_combobox.addEventListener('change', async function() {
    await DeviceManager.saveSelectedWidevineDevice(wvd_combobox.options[wvd_combobox.selectedIndex].text);
});
// =================================================

// ================ Remote CDM ================
document.getElementById('remoteInput').addEventListener('click', () => {
    if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
        chrome.runtime.sendMessage({ type: "OPEN_PICKER_REMOTE_MOBILE" });
    } else {
        chrome.runtime.sendMessage({ type: "OPEN_PICKER_REMOTE" });
    }
    window.close();
});

const remote_remove = document.getElementById('remoteRemove');
remote_remove.addEventListener('click', async function() {
    await RemoteCDMManager.removeSelectedRemoteCDM();
    remote_combobox.innerHTML = '';
    await RemoteCDMManager.loadSetAllRemoteCDMs();
    const selected_option = remote_combobox.options[remote_combobox.selectedIndex];
    if (selected_option) {
        await RemoteCDMManager.saveSelectedRemoteCDM(selected_option.text);
    } else {
        await RemoteCDMManager.removeSelectedRemoteCDMKey();
    }
});

const remote_download = document.getElementById('remoteDownload');
remote_download.addEventListener('click', async function() {
    const remote_cdm = await RemoteCDMManager.getSelectedRemoteCDM();
    SettingsManager.downloadFile(
        await RemoteCDMManager.loadRemoteCDM(remote_cdm),
        remote_cdm + ".json"
    )
});

const remote_combobox = document.getElementById('remote-combobox');
remote_combobox.addEventListener('change', async function() {
    await RemoteCDMManager.saveSelectedRemoteCDM(remote_combobox.options[remote_combobox.selectedIndex].text);
});
// ============================================

// ================ Command Options ================
const use_shaka = document.getElementById('use-shaka');
use_shaka.addEventListener('change', async function (){
    await SettingsManager.saveUseShakaPackager(use_shaka.checked);
});

const use_single_quotes = document.getElementById('use-single-quotes');
use_single_quotes.addEventListener('change', async function (){
    await SettingsManager.saveUseSingleQuotes(use_single_quotes.checked);
});

const downloader_name = document.getElementById('downloader-name');
downloader_name.addEventListener('input', async function (){
    await SettingsManager.saveExecutableName(downloader_name.value);
});

const downloader_args = document.getElementById('downloader-args');
downloader_args.addEventListener('input', async function (){
    await SettingsManager.saveAdditionalArguments(downloader_args.value);
    await refreshGeneratedCommands();
});
// =================================================

// ================ Metadata Getter Handoff ================
const metadata_getter_type = document.getElementById('metadata-getter-type');
const metadata_getter_enabled = document.getElementById('metadata-getter-enabled');
const metadata_getter_detail_link = document.getElementById('metadata-getter-detail-link');
const metadata_getter_project_folder = document.getElementById('metadata-getter-project-folder');
const metadata_getter_status = document.getElementById('metadata-getter-status');
const metadata_getter_description = document.getElementById('metadata-getter-description');

function getMMEValidationMessage(config, pageUrl = '') {
    if (!config.enabled) {
        return '';
    }

    if (isParamountPlusPage(pageUrl)) {
        return config.projectFolder.startsWith('/')
            ? ''
            : 'Enter Media Metadata and Extras Getter’s absolute project-folder path.';
    }

    try {
        const parsed = new URL(resolveMMEDetailLink({
            ...config,
            preferDetailLinkOverride: Boolean(config.detailLink),
        }, pageUrl));
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return 'Open a supported provider page or enter an optional detail-link override.';
        }
    } catch {
        return 'Open a supported provider page or enter an optional detail-link override.';
    }

    if (!config.projectFolder.startsWith('/')) {
        return 'Enter Media Metadata and Extras Getter’s absolute project-folder path.';
    }

    return '';
}

function currentMetadataGetterConfig() {
    return {
        enabled: metadata_getter_enabled.checked,
        detailLink: metadata_getter_detail_link.value.trim(),
        projectFolder: metadata_getter_project_folder.value.trim(),
    };
}

function getLPMAEGValidationMessage(config, pageUrl = '') {
    if (!config.enabled) {
        return '';
    }

    try {
        const parsed = new URL(resolveLPMAEGDetailLink(config, pageUrl));
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return 'Enter a public http(s) detail link.';
        }
    } catch {
        return 'Enter a public http(s) detail link.';
    }

    if (!config.projectFolder.startsWith('/')) {
        return 'Enter Live Performance Metadata and Extras Getter’s absolute project-folder path.';
    }

    return '';
}

async function getActivePageUrl() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        return tabs[0]?.url || '';
    } catch {
        return '';
    }
}

async function getStoredMetadataGetterConfig(type) {
    return type === 'mme'
        ? SettingsManager.getMMEConfig()
        : SettingsManager.getLPMAEGConfig();
}

async function saveStoredMetadataGetterConfig(type, config) {
    if (type === 'mme') {
        await SettingsManager.saveMMEConfig(config);
    } else {
        await SettingsManager.saveLPMAEGConfig(config);
    }
}

async function refreshMetadataGetterStatus() {
    const type = metadata_getter_type.value;
    const config = currentMetadataGetterConfig();
    const activePageUrl = await getActivePageUrl();
    const isParamountPlus = isParamountPlusPage(activePageUrl);
    const autoDetailLink = type === 'lpmaeg'
        ? getBroadwayHDDetailLink(activePageUrl) || activePageUrl
        : resolveMMEDetailLink({ ...config, detailLink: '' }, activePageUrl);
    const validationMessage = type === 'mme'
        ? getMMEValidationMessage(config, activePageUrl)
        : getLPMAEGValidationMessage(config, activePageUrl);
    const isLivePerformance = type === 'lpmaeg';

    metadata_getter_status.className = 'handoff-status';
    metadata_getter_description.textContent = isParamountPlus
        ? 'Paramount+ automatically hands Media Metadata and Extras Getter the open page URL and each exact final media file.'
        : isLivePerformance
        ? 'Uses the current page after this command completes. Add a detail-link override only when needed.'
        : 'Uses the current page after this command completes. Add a detail-link override only when needed.';
    metadata_getter_detail_link.placeholder = autoDetailLink
        ? 'Optional override for the current page'
        : 'Optional detail-link override';
    metadata_getter_project_folder.placeholder = isLivePerformance
        ? '/Users/you/Live-Performance-Metadata-and-Extras-Getter'
        : '/Users/you/Media-Metadata-and-Extras-Getter';

    if (!config.enabled) {
        metadata_getter_status.textContent = 'Off';
        return;
    }
    if (validationMessage) {
        metadata_getter_status.classList.add('is-warning');
        metadata_getter_status.textContent = validationMessage;
        return;
    }

    metadata_getter_status.classList.add('is-ready');
    metadata_getter_status.textContent = isParamountPlus
        ? 'Ready — no separate detail link is needed.'
        : 'Ready — runs after the completed download, subtitles, and cleanup.';
}

async function refreshParamountPlusNormalMode() {
    let activeTab = {};
    try {
        [activeTab = {}] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch {
        activeTab = {};
    }
    const pageUrl = activeTab.url || '';
    activeParamountPlusUrl = isParamountPlusPage(pageUrl) ? pageUrl : '';
    const active = Boolean(activeParamountPlusUrl);
    activeParamountPlusTitle = active
        ? getParamountPlusPageTitle(activeParamountPlusUrl, activeTab.title || '')
        : '';
    document.getElementById('paramountplus-normal-card').hidden = !active;
    document.getElementById('metadata-getter-detail-link-fields').hidden = active;
    document.getElementById('paramountplus-normal-metadata-note').hidden = !active;
    if (!active) return;
    if (metadata_getter_type.value !== 'mme') {
        metadata_getter_type.value = 'mme';
        await SettingsManager.saveSelectedMetadataGetter('mme');
        await loadSelectedMetadataGetterConfig();
    }
    await refreshParamountPlusNormalStatus();
}

async function refreshParamountPlusNormalStatus(message = '', warning = false) {
    const status = document.getElementById('paramountplus-normal-status');
    const button = document.getElementById('paramountplus-normal-run');
    const config = currentMediaFabCompanionConfig();
    let error = !config.enabled ? 'Enable the Companion below.' : mediaFabCompanionValidationMessage(config);
    const mme = currentMetadataGetterConfig();
    if (!error && mme.enabled && !mme.projectFolder.startsWith('/')) error = 'Enter Media Metadata and Extras Getter’s absolute project-folder path.';
    status.className = 'handoff-status';
    if (error || warning) status.classList.add('is-warning'); else status.classList.add('is-ready');
    status.textContent = message || error || '';
    button.disabled = Boolean(error) || !activeParamountPlusUrl;
}

async function runParamountPlusNormal() {
    const button = document.getElementById('paramountplus-normal-run');
    button.disabled = true;
    button.textContent = 'Starting…';
    try {
        const companionConfig = currentMediaFabCompanionConfig();
        const metadata = currentMetadataGetterConfig();
        await mediafabCompanion.request('preflight_external_backends', {
            backendIds: ['paramountplus'], destination: companionConfig.destination,
            companionFolder: companionConfig.projectFolder,
            jobs: [{ backendId: 'paramountplus', sourceUrl: activeParamountPlusUrl,
                outputDirectory: companionConfig.destination,
                backendArguments: buildParamountPlusNormalArguments(paramountPlusSettings),
                metadata: { ...metadata, getter: 'mme' } }],
        });
        await mediafabCompanion.request('launch_external_single', {
            userInitiated: true, companionFolder: companionConfig.projectFolder,
            job: { provider: 'paramountplus', backendId: 'paramountplus', executionMode: 'external-backend',
                seriesTitle: activeParamountPlusTitle || getParamountPlusPageTitle(activeParamountPlusUrl), sourceUrl: activeParamountPlusUrl,
                outputDirectory: companionConfig.destination,
                backendArguments: buildParamountPlusNormalArguments(paramountPlusSettings),
                metadata: { ...metadata, getter: 'mme' } },
        });
        await refreshParamountPlusNormalStatus('Started Paramount+ in Terminal.');
        return;
    } catch (error) {
        await refreshParamountPlusNormalStatus(`Could not start Paramount+ — ${error.message}`, true);
    } finally {
        button.textContent = 'Run';
        if (!document.getElementById('paramountplus-normal-status').textContent) {
            await refreshParamountPlusNormalStatus();
        }
    }
}

async function refreshBBCIPlayerNormalMode() {
    let activeTab = {};
    try {
        [activeTab = {}] = await chrome.tabs.query({ active: true, currentWindow: true });
    } catch {
        activeTab = {};
    }
    activeBBCIPlayerUrl = isBBCIPlayerEpisodePage(activeTab.url || '') ? activeTab.url : '';
    activeBBCIPlayerTitle = String(activeTab.title || 'BBC iPlayer').replace(/\s*[-|].*BBC iPlayer.*$/i, '').trim();
    document.getElementById('bbc-iplayer-normal-card').hidden = !activeBBCIPlayerUrl;
    await refreshBBCIPlayerNormalStatus();
}

async function activateBBCIPlayerNormalModeFromPage(pageUrl) {
    if (!isBBCIPlayerEpisodePage(pageUrl)) return false;
    activeBBCIPlayerUrl = pageUrl;
    document.getElementById('bbc-iplayer-normal-card').hidden = false;
    await refreshBBCIPlayerNormalStatus();
    return true;
}

async function refreshBBCIPlayerNormalStatus(message = '', warning = false) {
    const status = document.getElementById('bbc-iplayer-normal-status');
    const button = document.getElementById('bbc-iplayer-normal-run');
    const companion = currentMediaFabCompanionConfig();
    let error = !companion.enabled ? 'Enable the Companion below.' : mediaFabCompanionValidationMessage(companion);
    if (!error && !bbcIPlayerSettings.projectFolder.startsWith('/')) {
        error = 'Enter iPlayer Media and Extras Getter’s absolute project-folder path.';
    }
    status.className = 'handoff-status';
    if (error || warning) status.classList.add('is-warning'); else status.classList.add('is-ready');
    status.textContent = message || error || '';
    button.disabled = !activeBBCIPlayerUrl;
}

async function runBBCIPlayerNormal() {
    const button = document.getElementById('bbc-iplayer-normal-run');
    button.disabled = true;
    button.textContent = 'Starting…';
    try {
        await refreshBBCIPlayerNormalStatus('Starting BBC iPlayer…');
        const companion = currentMediaFabCompanionConfig();
        const companionError = !companion.enabled
            ? 'Enable the Companion below.'
            : mediaFabCompanionValidationMessage(companion);
        if (companionError) throw new Error(companionError);
        const command = buildBBCIPlayerCommand(
            activeBBCIPlayerUrl,
            companion.destination,
            bbcIPlayerSettings,
        );
        const capturedAtMs = Date.now();
        await mediafabCompanion.request('preflight', {
            companionFolder: companion.projectFolder,
            destination: companion.destination,
            executableName: 'python3',
        });
        await mediafabCompanion.request('launch_single', {
            userInitiated: true,
            companionFolder: companion.projectFolder,
            executableName: 'python3',
            outputDirectory: companion.destination,
            title: activeBBCIPlayerTitle || 'BBC iPlayer',
            capture: { capturedAtMs },
            command,
        });
        await refreshBBCIPlayerNormalStatus('Started BBC iPlayer in Terminal.');
    } catch (error) {
        await refreshBBCIPlayerNormalStatus(`Could not start BBC iPlayer — ${error.message}`, true);
    } finally {
        button.textContent = 'Run';
        button.disabled = false;
        await refreshBBCIPlayerNormalStatus(
            document.getElementById('bbc-iplayer-normal-status').textContent,
            document.getElementById('bbc-iplayer-normal-status').classList.contains('is-warning'),
        );
    }
}

async function loadSelectedMetadataGetterConfig() {
    const config = await getStoredMetadataGetterConfig(metadata_getter_type.value);
    metadata_getter_enabled.checked = config.enabled;
    metadata_getter_detail_link.value = config.detailLink;
    metadata_getter_project_folder.value = config.projectFolder;
    await refreshMetadataGetterStatus();
}

async function saveSelectedMetadataGetterConfigAndRefresh() {
    await saveStoredMetadataGetterConfig(metadata_getter_type.value, currentMetadataGetterConfig());
    await refreshMetadataGetterStatus();
    await refreshGeneratedCommands();
    await refreshParamountPlusNormalStatus();
}

metadata_getter_type.addEventListener('change', async () => {
    await SettingsManager.saveSelectedMetadataGetter(metadata_getter_type.value);
    await loadSelectedMetadataGetterConfig();
    await refreshGeneratedCommands();
});
metadata_getter_enabled.addEventListener('change', saveSelectedMetadataGetterConfigAndRefresh);
metadata_getter_detail_link.addEventListener('input', saveSelectedMetadataGetterConfigAndRefresh);
metadata_getter_project_folder.addEventListener('input', saveSelectedMetadataGetterConfigAndRefresh);
document.getElementById('metadata-getter-clear-link').addEventListener('click', async () => {
    metadata_getter_detail_link.value = '';
    await saveSelectedMetadataGetterConfigAndRefresh();
});
document.getElementById('metadata-getter-clear-setup').addEventListener('click', async () => {
    metadata_getter_project_folder.value = '';
    await saveSelectedMetadataGetterConfigAndRefresh();
});
// ========================================================

// ================ MediaFab Companion ================
function currentMediaFabCompanionConfig() {
    return {
        enabled: mediafab_companion_enabled.checked,
        projectFolder: mediafab_companion_project_folder.value.trim(),
        destination: mediafab_companion_destination.value.trim(),
    };
}

function normalizedFolder(value) {
    return String(value || '').replace(/\/+$/, '');
}

function mediaFabCompanionValidationMessage(config = currentMediaFabCompanionConfig()) {
    if (!config.enabled) {
        return '';
    }
    if (!config.projectFolder.startsWith('/')) {
        return 'Enter MediaFab Companion’s absolute folder path.';
    }
    if (!config.destination.startsWith('/')) {
        return 'Enter an absolute normal download destination.';
    }
    if (!mediafabCompanionConnected) {
        return 'MediaFab Companion is unavailable.';
    }
    if (connectedMediaFabCompanionFolder
        && normalizedFolder(config.projectFolder) !== normalizedFolder(connectedMediaFabCompanionFolder)) {
        return 'This folder does not match the installed MediaFab Companion. Reinstall it from this folder.';
    }
    return '';
}

function refreshMediaFabCompanionStatus(message = '', kind = '') {
    const config = currentMediaFabCompanionConfig();
    mediafab_companion_status.className = 'handoff-status';
    if (!config.enabled) {
        mediafab_companion_status.textContent = 'Off — commands remain available to copy manually; Run buttons are disabled.';
        refreshNormalCompanionRunButtons();
        return;
    }
    const validationMessage = mediaFabCompanionValidationMessage(config);
    if (validationMessage) {
        mediafab_companion_status.classList.add('is-warning');
        mediafab_companion_status.textContent = validationMessage;
        refreshNormalCompanionRunButtons();
        return;
    }
    mediafab_companion_status.classList.add(kind === 'warning' ? 'is-warning' : 'is-ready');
    mediafab_companion_status.textContent = message || 'Ready — click Run beside a captured command to open only that command in Terminal.';
    refreshNormalCompanionRunButtons();
}

function refreshNormalCompanionRunButtons() {
    const config = currentMediaFabCompanionConfig();
    const validationMessage = mediaFabCompanionValidationMessage(config);
    for (const button of key_container.querySelectorAll('.companion-run-button')) {
        const alreadyLaunched = button.dataset.launched === 'true';
        const companionAvailable = config.enabled && !validationMessage;
        button.hidden = !companionAvailable;
        button.disabled = alreadyLaunched || !companionAvailable;
        button.title = alreadyLaunched
            ? 'This captured command was already started.'
            : !config.enabled
                ? 'Enable Optional Companion to run this command.'
                : validationMessage || 'Run this command with MediaFab Companion.';
    }
}

async function runCapturedCommandWithCompanion({ result, select, command, keyString, button }) {
    const config = currentMediaFabCompanionConfig();
    const validationMessage = mediaFabCompanionValidationMessage(config);
    if (!config.enabled || validationMessage) {
        refreshMediaFabCompanionStatus(validationMessage, 'warning');
        return;
    }

    button.disabled = true;
    button.textContent = 'Starting…';
    refreshMediaFabCompanionStatus('Starting the selected captured command…');
    try {
        const launchCommand = await createCommand(select.value, keyString, config.destination);
        if (/ setup incomplete: /i.test(launchCommand)
            || launchCommand.startsWith('MediaFab command unavailable:')) {
            throw new Error(launchCommand);
        }
        command.value = launchCommand;
        const isBBCIPlayer = isBBCIPlayerEpisodePage(result.url);
        const executableName = isBBCIPlayer ? 'python3' : await SettingsManager.getExecutableName();
        let title = 'Media download';
        const amazonEpisode = result.amazonEpisodeIdentity;
        if (amazonEpisode?.status === 'resolved') {
            const position = amazonEpisode.seasonNumber > 0 && amazonEpisode.episodeNumber > 0
                ? `S${String(amazonEpisode.seasonNumber).padStart(2, '0')}E${String(amazonEpisode.episodeNumber).padStart(2, '0')}`
                : '';
            title = [
                amazonEpisode.seriesTitle || 'Amazon Prime Video',
                position,
                amazonEpisode.episodeTitle || amazonEpisode.compactGTI,
            ].filter(Boolean).join(' — ');
        } else if (isBBCIPlayer) {
            title = activeBBCIPlayerTitle || 'BBC iPlayer';
        } else {
            try {
                title = new URL(result.url).hostname;
            } catch {
                // Keep the generic title when the captured page URL is unavailable.
            }
        }
        await mediafabCompanion.request('launch_single', {
            capture: { capturedAtMs: Number(result.timestamp) * 1000 },
            userInitiated: true,
            command: launchCommand,
            title,
            outputDirectory: config.destination,
            executableName,
            companionFolder: config.projectFolder,
        });
        button.dataset.launched = 'true';
        refreshMediaFabCompanionStatus('Started that command in Terminal.');
    } catch (error) {
        refreshMediaFabCompanionStatus(`Could not start this command — ${error.message}`, 'warning');
    } finally {
        button.textContent = 'Run';
        refreshNormalCompanionRunButtons();
    }
}

async function saveMediaFabCompanionConfigAndRefresh() {
    await SettingsManager.saveMediaFabCompanionConfig(currentMediaFabCompanionConfig());
    refreshMediaFabCompanionStatus();
    await refreshParamountPlusNormalStatus();
    await refreshBBCIPlayerNormalStatus();
}

mediafab_companion_enabled.addEventListener('change', saveMediaFabCompanionConfigAndRefresh);
mediafab_companion_project_folder.addEventListener('input', saveMediaFabCompanionConfigAndRefresh);
mediafab_companion_destination.addEventListener('input', saveMediaFabCompanionConfigAndRefresh);
document.getElementById('mediafab-companion-clear-setup').addEventListener('click', async () => {
    mediafab_companion_project_folder.value = '';
    mediafab_companion_destination.value = '';
    await saveMediaFabCompanionConfigAndRefresh();
});

async function initializeMediaFabCompanion() {
    const config = await SettingsManager.getMediaFabCompanionConfig();
    mediafab_companion_enabled.checked = config.enabled;
    mediafab_companion_project_folder.value = config.projectFolder;
    mediafab_companion_destination.value = config.destination;
    mediafabCompanion.onEvent((message) => {
        if (message.type === 'connection') {
            mediafabCompanionConnected = message.connected;
            if (!message.connected) {
                connectedMediaFabCompanionFolder = '';
            }
            refreshMediaFabCompanionStatus();
        }
    });
    try {
        const hello = await mediafabCompanion.request('hello', { protocolVersion: 1 });
        mediafabCompanionConnected = true;
        connectedMediaFabCompanionFolder = hello.projectFolder || '';
    } catch {
        mediafabCompanionConnected = false;
        connectedMediaFabCompanionFolder = '';
    }
    refreshMediaFabCompanionStatus();
}

// ====================================================

// ================ Collapsible Sections ================
function setCollapsibleSectionState(card, collapsed) {
    const button = card.querySelector('.collapse-toggle');
    const sectionTitle = card.querySelector('h2').textContent;
    card.classList.toggle('is-collapsed', collapsed);
    button.textContent = collapsed ? 'Show' : 'Hide';
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', `${collapsed ? 'Show' : 'Hide'} ${sectionTitle}`);
}

async function initializeCollapsibleSections() {
    const savedState = await SettingsManager.getPanelSectionState();
    for (const card of document.querySelectorAll('[data-collapsible-section]')) {
        const sectionName = card.dataset.collapsibleSection;
        setCollapsibleSectionState(card, savedState[sectionName] === true);
        card.querySelector('.collapse-toggle').addEventListener('click', async () => {
            const collapsed = !card.classList.contains('is-collapsed');
            setCollapsibleSectionState(card, collapsed);
            const currentState = await SettingsManager.getPanelSectionState();
            await SettingsManager.savePanelSectionState({
                ...currentState,
                [sectionName]: collapsed,
            });
        });
    }
}
// =======================================================

// ================ Keys ================
const clear = document.getElementById('clear');
clear.addEventListener('click', async function() {
    chrome.runtime.sendMessage({ type: "CLEAR" });
    key_container.innerHTML = "";
});

function formatHeaders(headers, option, quoteChar, safeQuoteChar) {
    return Object.entries(headers || {}).map(
        ([key, value]) => `${option} ${quoteChar}${key}: ${String(value).replaceAll(quoteChar, safeQuoteChar)}${quoteChar}`
    ).join(' ');
}

function getOutputDirectory(additionalArgs) {
    const saveDirMatch = String(additionalArgs || '').match(
        /(?:^|\s)--save-dir(?:\s+|=)(?:"([^"]+)"|'([^']+)'|(\S+))/
    );

    return saveDirMatch ? (saveDirMatch[1] || saveDirMatch[2] || saveDirMatch[3]) : '.';
}

function removeIncompatibleHlsVideoSelector(additionalArgs) {
    // A media playlist exposes one basic stream rather than resolution-labelled
    // variants. Keep all user options except an explicit video selector that
    // would otherwise exclude that one stream.
    return String(additionalArgs || '')
        .replace(/(?:^|\s)(?:-sv|--select-video)(?:\s+|=)(?:"[^"]*"|'[^']*'|\S+)/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function joinOutputPath(outputDirectory, filename) {
    return outputDirectory === '.' ? filename : `${outputDirectory.replace(/[\\/]+$/, '')}/${filename}`;
}

const languageCodeAliases = {
    ara: 'ar', bul: 'bg', cat: 'ca', ces: 'cs', chi: 'zh', cze: 'cs', dan: 'da',
    deu: 'de', dut: 'nl', ell: 'el', eng: 'en', fin: 'fi', fra: 'fr', fre: 'fr',
    ger: 'de', gre: 'el', heb: 'he', hin: 'hi', hrv: 'hr', hun: 'hu', ind: 'id',
    ita: 'it', jpn: 'ja', kor: 'ko', msa: 'ms', nld: 'nl', nor: 'no', pol: 'pl',
    por: 'pt', ron: 'ro', rum: 'ro', rus: 'ru', slk: 'sk', slo: 'sk', spa: 'es',
    srp: 'sr', swe: 'sv', tha: 'th', tur: 'tr', ukr: 'uk', vie: 'vi', zho: 'zh',
};

function normalizeSubtitleLanguage(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const normalized = value.trim().replace(/_/g, '-').toLowerCase();
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalized)) {
        return null;
    }

    const [primary, ...subtags] = normalized.split('-');
    return [languageCodeAliases[primary] || primary, ...subtags].join('-');
}

function getSubtitleLanguage(subtitle) {
    const capturedLanguage = normalizeSubtitleLanguage(subtitle.language);
    if (capturedLanguage) {
        return capturedLanguage;
    }

    try {
        const parsed = new URL(subtitle.url);
        for (const key of [
            'language', 'lang', 'locale', 'srclang', 'subtitle_language', 'subtitleLanguage',
            'languageCode', 'language_code', 'localeCode', 'locale_code', 'iso', 'isoCode', 'iso_code',
        ]) {
            const language = normalizeSubtitleLanguage(parsed.searchParams.get(key));
            if (language) {
                return language;
            }
        }

        const nonLanguagePathTokens = new Set([
            'api', 'caption', 'captions', 'dtt', 'dfxp', 'manifest', 'master', 'mpd',
            'srt', 'sub', 'subs', 'subtitle', 'subtitles', 'track', 'tracks', 'ttml', 'vtt',
        ]);
        const pathLanguageMatches = [...decodeURIComponent(parsed.pathname).matchAll(
            /(?:^|[._/-])([a-z]{2,3}(?:[-_][a-z0-9]{2,8})?)(?=[._/-]|$)/gi
        )].reverse();
        for (const match of pathLanguageMatches) {
            const language = normalizeSubtitleLanguage(match[1]);
            if (language && !nonLanguagePathTokens.has(language)) {
                return language;
            }
        }
    } catch {
        // An invalid URL cannot produce a usable language hint.
    }

    return 'und';
}

function createSubtitleSpinnerFunction() {
    return [
        'mediafab_subtitle_spinner() {',
        'local pid="$1" message="$2" frame_index=0 frame;',
        'while kill -0 "$pid" 2>/dev/null; do',
        'case $((frame_index % 4)) in 0) frame="|" ;; 1) frame="/" ;; 2) frame="-" ;; *) frame="\\\\" ;; esac;',
        'printf "\\rMediaFab note: %s %s" "$message" "$frame";',
        'frame_index=$((frame_index + 1)); sleep 0.1;',
        'done;',
        'printf "\\r\\033[K";',
        '}',
    ].join(' ');
}

function isSubtitleFileUrl(value) {
    return /\.(?:srt|vtt|webvtt|dtt|ttml|dfxp|ass|ssa)(?:[?#]|$)/i.test(value || '');
}

function getSubtitleAssetIdentity(subtitle) {
    try {
        const parsed = new URL(subtitle.url);
        const match = parsed.pathname.match(
            /^(.*)\/(?:srt|vtt|webvtt)\/(.+)-\d{10,}\.(?:srt|vtt|webvtt)$/i
        );
        return match ? `${parsed.origin}${match[1]}/${match[2]}` : subtitle.url;
    } catch {
        return subtitle.url;
    }
}

function getSubtitlePreference(subtitle) {
    if (subtitle.observedDirectly) {
        return 100;
    }
    return /\.(?:vtt|webvtt)(?:[?#]|$)/i.test(subtitle.url) ? 10
        : /\.srt(?:[?#]|$)/i.test(subtitle.url) ? 9
            : 0;
}

function getUniqueSubtitleFiles(subtitles) {
    const selected = new Map();
    for (const subtitle of subtitles || []) {
        if (!subtitle?.url || !isSubtitleFileUrl(subtitle.url)) {
            continue;
        }

        const assetIdentity = subtitle.contentIdentity
            ? `content:${subtitle.contentIdentity}`
            : getSubtitleAssetIdentity(subtitle);
        const existing = selected.get(assetIdentity);
        if (!existing || getSubtitlePreference(subtitle) > getSubtitlePreference(existing)) {
            selected.set(assetIdentity, subtitle);
        }
    }
    return [...selected.values()];
}

function getSubtitleSidecarNames(subtitles) {
    const uniqueSubtitles = getUniqueSubtitleFiles(subtitles);
    const languageOccurrences = new Map();
    return uniqueSubtitles.map((subtitle) => {
        const language = getSubtitleLanguage(subtitle);
        const jellyfinLanguage = language.replaceAll('-', '_');
        const occurrence = (languageOccurrences.get(language) || 0) + 1;
        languageOccurrences.set(language, occurrence);

        return occurrence === 1
            ? `${jellyfinLanguage}.srt`
            : `${jellyfinLanguage}.${String(occurrence).padStart(2, '0')}.srt`;
    });
}

function createExternalSubtitleCommands(subtitles, outputDirectory, quoteChar, safeQuoteChar) {
    const uniqueSubtitles = getUniqueSubtitleFiles(subtitles);
    const subtitleNames = getSubtitleSidecarNames(subtitles);

    return uniqueSubtitles.map((subtitle, index) => {
        const subtitleName = subtitleNames[index];
        const temporaryFile = joinOutputPath(outputDirectory, `.${subtitleName}.vtt`);
        const outputFile = joinOutputPath(outputDirectory, subtitleName);
        const headers = formatHeaders(subtitle.headers, '-H', quoteChar, safeQuoteChar);
        const sourceIsSrt = /\.srt(?:[?#]|$)/i.test(subtitle.url);

        const curlCommand = [
            'curl --fail --location --silent --show-error --connect-timeout 20 --max-time 120',
            headers,
            `--output ${quoteChar}${sourceIsSrt ? outputFile : temporaryFile}${quoteChar}`,
            `${quoteChar}${subtitle.url}${quoteChar}`,
        ].filter(Boolean).join(' ');
        const downloadCommand = [
            curlCommand,
            sourceIsSrt ? '' : '&&',
            sourceIsSrt ? '' : `ffmpeg -hide_banner -loglevel error -nostats -y -i ${quoteChar}${temporaryFile}${quoteChar} ${quoteChar}${outputFile}${quoteChar}`,
            sourceIsSrt ? '' : '&&',
            sourceIsSrt ? '' : `rm -f ${quoteChar}${temporaryFile}${quoteChar}`,
        ].filter(Boolean).join(' ');

        const subtitleCount = uniqueSubtitles.length;
        const statusMessage = `Downloading... (${index + 1}/${subtitleCount})`;
        const logFile = joinOutputPath(outputDirectory, `.${subtitleName}.download.log`);
        return [
            '() {',
            'emulate -L zsh;',
            'setopt no_monitor;',
            `local mediafab_subtitle_log=${quoteChar}${logFile}${quoteChar} mediafab_subtitle_job;`,
            `( ${downloadCommand} ) > "$mediafab_subtitle_log" 2>&1 &`,
            'mediafab_subtitle_job=$!;',
            `mediafab_subtitle_spinner "$mediafab_subtitle_job" ${quoteChar}${statusMessage}${quoteChar};`,
            'if wait "$mediafab_subtitle_job"; then rm -f "$mediafab_subtitle_log"; else printf \'%s\\n\' \'MediaFab warning: A separately captured subtitle failed; continuing to the metadata handoff.\' >&2; cat "$mediafab_subtitle_log" >&2; rm -f "$mediafab_subtitle_log";',
            `rm -f ${quoteChar}${temporaryFile}${quoteChar} ${quoteChar}${outputFile}${quoteChar};`,
            'typeset -g mediafab_subtitle_failures=$(( ${mediafab_subtitle_failures:-0} + 1 )); return 0; fi;',
            '}',
        ].join(' ');
    });
}

function createSubtitleStatusCommand(subtitleCount, quoteChar) {
    const scopeNote = 'MediaFab note: If above reported 0 subtitle streams above, that count only reflects manifest tracks. This fork also checks separately observed subtitle requests.';
    const resultNote = subtitleCount > 0
        ? `MediaFab note: ${subtitleCount} ${subtitleCount === 1 ? 'subtitle' : 'subtitles'} found. Downloading...`
        : 'MediaFab note: No separately captured subtitle files were found.';
    return `printf '\\n%s\\n\\n%s\\n\\n' ${quoteChar}${scopeNote}${quoteChar} ${quoteChar}${resultNote}${quoteChar}`;
}

function createSubtitleCompletionCommand(subtitleCount, quoteChar) {
    if (subtitleCount === 0) {
        return '';
    }
    return `if (( \${mediafab_subtitle_failures:-0} == 0 )); then printf '%s\\n\\n' ${quoteChar}MediaFab note: subtitle(s) completed downloading.${quoteChar}; else printf '%s\\n\\n' ${quoteChar}MediaFab warning: \${mediafab_subtitle_failures} separately captured subtitle(s) failed; metadata processing will continue.${quoteChar}; fi`;
}

function createSubtitleSidecarNamingCommand(subtitleNames, outputDirectory, quoteChar, resolvedMediaFile = false) {
    if (subtitleNames.length === 0) {
        return '';
    }

    const serializedNames = subtitleNames.map((name) => `${quoteChar}${name}${quoteChar}`).join(' ');
    return [
        '() {',
        'emulate -L zsh;',
        `local mediafab_output_dir=${quoteChar}${outputDirectory}${quoteChar};`,
        'local -a mediafab_video_files mediafab_subtitle_names;',
        resolvedMediaFile
            ? 'mediafab_video_files=("$mediafab_media_file");'
            : 'mediafab_video_files=("${(@f)$(find "$mediafab_output_dir" -maxdepth 1 -type f \\( -iname "*.3gp" -o -iname "*.avi" -o -iname "*.flv" -o -iname "*.m2ts" -o -iname "*.m4v" -o -iname "*.mkv" -o -iname "*.mov" -o -iname "*.mp4" -o -iname "*.mpeg" -o -iname "*.mpg" -o -iname "*.mts" -o -iname "*.ts" -o -iname "*.webm" -o -iname "*.wmv" \\) -print)}");',
        '(( ${#mediafab_video_files[@]} == 1 )) && [[ -n "${mediafab_video_files[1]:-}" ]] || return 0;',
        `mediafab_subtitle_names=(${serializedNames});`,
        'local mediafab_video_stem="${mediafab_video_files[1]%.*}" mediafab_subtitle_name mediafab_subtitle mediafab_target;',
        'for mediafab_subtitle_name in "${mediafab_subtitle_names[@]}"; do',
        'mediafab_subtitle="${mediafab_output_dir}/${mediafab_subtitle_name}";',
        '[[ -f "$mediafab_subtitle" ]] || continue;',
        'mediafab_target="${mediafab_video_stem}.${mediafab_subtitle_name}";',
        '[[ -e "$mediafab_target" ]] || mv "$mediafab_subtitle" "$mediafab_target";',
        'done;',
        '}',
    ].join(' ');
}

function createWorkDirectoryCleanupCommand(outputDirectory, quoteChar) {
    const workDirectoryPatterns = [
        'master-*_*????-??-??_??-??-??',
        'manifest-*_*????-??-??_??-??-??',
    ];
    return [
        'find',
        `${quoteChar}${outputDirectory}${quoteChar}`,
        '-maxdepth 1',
        '-type d',
        '\\(',
        workDirectoryPatterns.map((pattern) => `-name ${quoteChar}${pattern}${quoteChar}`).join(' -o '),
        '\\)',
        '-prune -exec rm -rf {} +',
    ].join(' ');
}

function createCompletionCommand(quoteChar) {
    return `printf '\\n%s\\n' ${quoteChar}MediaFab note: Complete. Output is ready.${quoteChar}`;
}

function createLPMAEGStartCommand(config, quoteChar) {
    return config.enabled
        ? `printf '%s\\n\\n' ${quoteChar}MediaFab note: Downloading your metadata and extras...${quoteChar}`
        : '';
}

function createMMEStartCommand(config, quoteChar) {
    return config.enabled
        ? `printf '%s\\n\\n' ${quoteChar}MediaFab note: Downloading your media metadata and extras...${quoteChar}`
        : '';
}

async function createCommand(json, key_string = '', outputDirectory = null) {
    const metadata = JSON.parse(json);
    if (isBBCIPlayerEpisodePage(metadata.pageUrl)) {
        try {
            return buildBBCIPlayerCommand(
                metadata.pageUrl,
                outputDirectory || currentMediaFabCompanionConfig().destination,
                bbcIPlayerSettings,
            );
        } catch (error) {
            return `BBC iPlayer setup incomplete: ${error.message}`;
        }
    }
    const useSingleQuotes = await SettingsManager.getUseSingleQuotes();
    const executableName = await SettingsManager.getExecutableName();
    const useShakaPackager = await SettingsManager.getUseShakaPackager();
    const additionalArgs = await SettingsManager.getAdditionalArguments();
    const metadataGetterType = await SettingsManager.getSelectedMetadataGetter();
    const metadataGetterConfig = await getStoredMetadataGetterConfig(metadataGetterType);
    if (metadataGetterType === 'mme') {
        const explicitOverride = Boolean(metadataGetterConfig.detailLink);
        if (!explicitOverride) {
            metadataGetterConfig.detailLink = metadata.maxMetadataDetailUrl
                || metadata.disneyMetadataDetailUrl
                || '';
        }
        metadataGetterConfig.preferDetailLinkOverride = Boolean(metadataGetterConfig.detailLink);
    }
    const metadataGetterValidationMessage = metadataGetterType === 'lpmaeg'
        ? getLPMAEGValidationMessage(metadataGetterConfig, metadata.pageUrl)
        : getMMEValidationMessage(metadataGetterConfig, metadata.pageUrl);
    if (metadataGetterValidationMessage) {
        const getterName = metadataGetterType === 'lpmaeg' ? 'Live Performance Metadata and Extras Getter' : 'Media Metadata and Extras Getter';
        return `${getterName} setup incomplete: ${metadataGetterValidationMessage}`;
    }
    return buildNormalMediaCommand({
        metadata,
        keyString: key_string,
        useSingleQuotes,
        executableName,
        useShakaPackager,
        additionalArguments: additionalArgs,
        metadataGetterType,
        metadataGetterConfig,
        outputDirectory,
    });
}

function formatStreamDuration(durationSeconds) {
    const totalSeconds = Math.round(Number(durationSeconds));
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
        return 'Not available';
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

async function refreshGeneratedCommands() {
    for (const logContainer of key_container.querySelectorAll('.log-container')) {
        const command = logContainer.querySelector('#command');
        const manifest = logContainer.querySelector('#manifest');
        const keys = logContainer.querySelector('.key-copy input');

        if (command && manifest) {
            command.value = await createCommand(manifest.value, keys?.value || '');
        }
    }
}

async function appendLog(result) {
    if (isBBCIPlayerEpisodePage(result.url)) {
        // BBC iPlayer is downloaded only through its dedicated getter card.
        // Do not expose the intercepted clear manifest as an N_m3u8DL-RE job.
        await activateBBCIPlayerNormalModeFromPage(result.url);
        return;
    }
    const maxEpisodeId = String(result.url || '').match(
        /^https?:\/\/(?:www\.|play\.)?(?:hbo)?max\.com\/video\/watch\/([0-9a-f-]{36})(?:\/|$)/i,
    )?.[1]?.toLowerCase() || '';
    const protectedPssh = result.type === 'PUBLIC' ? '' : String(result.pssh_data || '');
    if (protectedPssh) {
        const priorCapture = [...key_container.querySelectorAll('.log-container')]
            .find((entry) => entry.dataset.capturePssh === protectedPssh);
        priorCapture?.remove();
    }
    if (maxEpisodeId) {
        const existing = key_container.querySelector(`[data-max-episode-id="${maxEpisodeId}"]`);
        if (existing?.dataset.protected === 'true' && result.type === 'PUBLIC') {
            return;
        }
        existing?.remove();
    }
    const isPublicMedia = result.type === 'PUBLIC';
    const key_string = isPublicMedia ? '' : (result.keys || []).map(key => `--key ${key.kid}:${key.k}`).join(' ');
    const date = new Date(result.timestamp * 1000);
    const date_string = date.toLocaleString();

    const logContainer = document.createElement('div');
    logContainer.classList.add('log-container');
    if (protectedPssh) logContainer.dataset.capturePssh = protectedPssh;
    if (maxEpisodeId) {
        logContainer.dataset.maxEpisodeId = maxEpisodeId;
        logContainer.dataset.protected = String(!isPublicMedia);
    }
    logContainer.innerHTML = `
        <button class="toggleButton">+</button>
        <div class="expandableDiv collapsed">
            <div class="always-visible key-detail-row">
                <span class="key-detail-label">URL${isPublicMedia ? '' : '<span class="protected-sparkle" title="Protected stream — keys captured" aria-label="Protected stream — keys captured">✦</span>'}</span><input type="text" class="text-box" value="${result.url}">
            </div>
            ${isPublicMedia ? `<div class="expanded-only key-detail-row" hidden>
                <span class="key-detail-label">Stream</span><input type="text" class="text-box" value="Public — no DRM keys required">
            </div>
            <div class="expanded-only key-detail-row" hidden>
                <span class="key-detail-label">Duration</span><input type="text" class="text-box" value="${formatStreamDuration(result.durationSeconds)}">
            </div>` : `<div class="expanded-only key-detail-row" hidden>
                <span class="key-detail-label">PSSH</span><input type="text" class="text-box" value="${result.pssh_data}">
            </div>
            <div class="expanded-only key-detail-row key-copy" hidden>
                <span class="key-detail-label">Keys</span><input type="text" class="text-box" value="${key_string}">
            </div>`}
            <div class="expanded-only key-detail-row" hidden>
                <span class="key-detail-label">Date</span><input type="text" class="text-box" value="${date_string}">
            </div>
            ${(result.manifests || []).length > 0 ? `<div class="expanded-only key-detail-row manifest-copy" hidden>
                <span class="key-detail-label">Manifest</span><select id="manifest" class="text-box"></select>
            </div>
            <div class="expanded-only key-detail-row command-copy" hidden>
                <a href="#" title="Click to copy">Command</a><input type="text" id="command" class="text-box"><button type="button" class="companion-run-button" title="Run this command with MediaFab Companion" hidden disabled>Run</button>
            </div>` : ''}
        </div>`;

    const keyCopy = logContainer.querySelector('.key-copy');
    if (keyCopy) {
        keyCopy.addEventListener('click', () => {
            navigator.clipboard.writeText(key_string);
        });
    }

    if ((result.manifests || []).length > 0) {
        const command = logContainer.querySelector('#command');

        const select = logContainer.querySelector("#manifest");
        select.addEventListener('change', async () => {
            command.value = await createCommand(select.value, key_string);
        });
        result.manifests.forEach((manifest) => {
            const option = new Option(
                `[${manifest.type}] ${manifest.url}`,
                JSON.stringify({
                    ...manifest,
                    subtitles: result.subtitles || [],
                    pageUrl: result.url,
                    maxMetadataDetailUrl: result.maxMetadataDetailUrl || '',
                    disneyMetadataDetailUrl: result.disneyMetadataDetailUrl || '',
                    amazonEpisodeDetailUrl: result.amazonEpisodeIdentity?.detailUrl || '',
                    amazonEpisodeIdentity: result.amazonEpisodeIdentity || null,
                    isPublicMedia,
                })
            );
            select.add(option);
        });
        command.value = await createCommand(select.value, key_string);

        const manifest_copy = logContainer.querySelector('.manifest-copy');
        manifest_copy.addEventListener('click', () => {
            navigator.clipboard.writeText(JSON.parse(select.value).url);
        });

        const command_copy = logContainer.querySelector('.command-copy');
        command_copy.addEventListener('click', (event) => {
            if (event.target.closest('.companion-run-button')) {
                return;
            }
            navigator.clipboard.writeText(command.value);
        });

        const companionRunButton = logContainer.querySelector('.companion-run-button');
        companionRunButton.addEventListener('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await runCapturedCommandWithCompanion({
                result,
                select,
                command,
                keyString: key_string,
                button: companionRunButton,
            });
        });
    }

    const toggleButtons = logContainer.querySelector('.toggleButton');
    const expandedRows = logContainer.querySelectorAll('.expanded-only');
    toggleButtons.addEventListener('click', function () {
        const expandableDiv = this.nextElementSibling;
        if (expandableDiv.classList.contains('collapsed')) {
            toggleButtons.innerHTML = "-";
            expandableDiv.classList.remove('collapsed');
            expandableDiv.classList.add('expanded');
            expandedRows.forEach((row) => { row.hidden = false; });
        } else {
            toggleButtons.innerHTML = "+";
            expandableDiv.classList.remove('expanded');
            expandableDiv.classList.add('collapsed');
            expandedRows.forEach((row) => { row.hidden = true; });
        }
    });

    key_container.appendChild(logContainer);
    refreshNormalCompanionRunButtons();
}

chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName === 'local') {
        for (const [key, values] of Object.entries(changes)) {
            const log = values.newValue;
            if (log && (log.type === 'WIDEVINE' || log.type === 'CLEARKEY' || log.type === 'PUBLIC')) {
                await appendLog(log);
            }
        }
    }
});

function checkLogs() {
    chrome.runtime.sendMessage({ type: "GET_LOGS" }, (response) => {
        if (response) {
            response.forEach(async (result) => {
                await appendLog(result);
            });
        }
    });
}

document.addEventListener('DOMContentLoaded', async function () {
    await initializeCollapsibleSections();
    await initializeMediaFabCompanion();
    enabled.checked = await SettingsManager.getEnabled();
    SettingsManager.setDarkMode(await SettingsManager.getDarkMode());
    use_shaka.checked = await SettingsManager.getUseShakaPackager();
    use_single_quotes.checked = await SettingsManager.getUseSingleQuotes();
    downloader_name.value = await SettingsManager.getExecutableName();
    downloader_args.value = await SettingsManager.getAdditionalArguments();
    metadata_getter_type.value = await SettingsManager.getSelectedMetadataGetter();
    await loadSelectedMetadataGetterConfig();
    paramountPlusSettings = normalizeParamountPlusSettings(await SettingsManager.getParamountPlusSettings());
    bbcIPlayerSettings = normalizeBBCIPlayerSettings(await SettingsManager.getBBCIPlayerSettings());
    mountBBCIPlayerSettings(
        document.getElementById('bbc-iplayer-normal-settings-fields'),
        bbcIPlayerSettings,
        async (next) => {
            bbcIPlayerSettings = normalizeBBCIPlayerSettings(next);
            await SettingsManager.saveBBCIPlayerSettings(bbcIPlayerSettings);
            await refreshBBCIPlayerNormalStatus();
        },
    );
    mountParamountPlusSettings(
        document.getElementById('paramountplus-normal-settings-fields'),
        paramountPlusSettings,
        async (next) => {
            paramountPlusSettings = normalizeParamountPlusSettings(next);
            document.getElementById('paramountplus-normal-preview').textContent = buildParamountPlusNormalArguments(paramountPlusSettings).join(' ');
            await SettingsManager.saveParamountPlusSettings(paramountPlusSettings);
        },
        { hiddenKeys: ['wanted', 'latestEpisode'] },
    );
    document.getElementById('paramountplus-normal-preview').textContent = buildParamountPlusNormalArguments(paramountPlusSettings).join(' ');
    document.getElementById('paramountplus-normal-run').addEventListener('click', runParamountPlusNormal);
    await refreshParamountPlusNormalMode();
    await refreshBBCIPlayerNormalMode();
    SettingsManager.setSelectedDeviceType(await SettingsManager.getSelectedDeviceType());
    await DeviceManager.loadSetAllWidevineDevices();
    await DeviceManager.selectWidevineDevice(await DeviceManager.getSelectedWidevineDevice());
    await RemoteCDMManager.loadSetAllRemoteCDMs();
    await RemoteCDMManager.selectRemoteCDM(await RemoteCDMManager.getSelectedRemoteCDM());
    checkLogs();
});
// ======================================
