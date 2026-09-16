import { SettingsManager } from '../lib/util.js';
import {
    MULTI_MODE_STORAGE_KEY,
    DEFAULT_MULTI_MODE_SETTINGS,
    normalizeMultiModeSettings,
    useSharedMetadataSettings,
    formatDownloaderArgumentPreview,
    createManualLinkCatalog,
    getSelectedEpisodes,
    getSelectionState,
    setAllEpisodesSelected,
    setSeasonSelected,
    buildBatchJobs,
    buildQueueMediaCommand,
    buildQueueLocalCommand,
} from './core.mjs';
import { discoverProviderCatalog, activateProviderPlayback } from './providers/registry.mjs';
import { CompanionClient } from './companion.mjs';
import {
    buildParamountPlusArguments,
    mountParamountPlusSettings,
    normalizeParamountPlusSettings,
} from './paramountplus-settings.mjs';
import {
    mountBBCIPlayerSettings,
    normalizeBBCIPlayerSettings,
} from './bbc-iplayer-settings.mjs';

const elements = Object.fromEntries([
    'companion-status', 'darkModeToggle', 'source-link', 'load-link', 'load-status', 'manual-link-list',
    'add-manual-link', 'use-manual-links', 'select-all',
    'catalogue-summary', 'catalogue', 'destination', 'browse-destination',
    'container', 'video-mode', 'audio-mode', 'subtitle-mode',
    'use-shaka-packager', 'external-subtitles', 'keep-downloader-log', 'additional-arguments', 'argument-preview',
    'metadata-enabled', 'metadata-getter', 'metadata-detail-link', 'metadata-project-folder',
    'clear-metadata-link', 'clear-metadata-setup', 'metadata-description', 'metadata-status',
    'mediafab-companion-project-folder', 'close-terminal-on-complete',
    'clear-mediafab-companion-setup', 'mediafab-companion-config-status',
    'start-selected', 'pause-queue', 'cancel-current',
    'retry-failed', 'queue-body',
    'standard-media-options-card', 'paramountplus-options-card', 'paramountplus-settings-fields',
    'paramountplus-argument-preview', 'metadata-detail-link-fields', 'paramountplus-metadata-link-note',
    'bbc-iplayer-options-card', 'bbc-iplayer-settings-fields', 'metadata-card',
].map((id) => [id, document.getElementById(id)]));

const companion = new CompanionClient();
let settings = normalizeMultiModeSettings(DEFAULT_MULTI_MODE_SETTINGS);
let catalog = null;
let queueJobs = [];
let companionConnected = false;
let connectedCompanionFolder = '';
let queuePaused = false;
let manualLinkValues = [{ playbackUrl: '', detailUrl: '' }];
let workerTabId = Number.NaN;
let activeCapture = null;
let captureTimeout = null;

const CAPTURE_TIMEOUT_MS = 120 * 1000;
const QUEUE_SECTION_STATE_KEY = 'mediafab_queue_section_state';

function setStatus(element, message, kind = '') {
    element.textContent = message;
    element.className = 'status-line';
    if (kind) {
        element.classList.add(`is-${kind}`);
    }
}

function setCompanionStatus(message, kind) {
    elements['companion-status'].className = `connection-status is-${kind}`;
    elements['companion-status'].innerHTML = '<span></span>';
    elements['companion-status'].append(document.createTextNode(` ${message}`));
}

async function getSharedMetadataConfig(type) {
    return type === 'mme' ? SettingsManager.getMMEConfig() : SettingsManager.getLPMAEGConfig();
}

async function saveSharedMetadataConfig() {
    const config = {
        enabled: settings.metadata.enabled,
        detailLink: settings.metadata.detailLink,
        projectFolder: settings.metadata.projectFolder,
    };
    await SettingsManager.saveSelectedMetadataGetter(settings.metadata.getter);
    if (settings.metadata.getter === 'mme') {
        await SettingsManager.saveMMEConfig(config);
    } else {
        await SettingsManager.saveLPMAEGConfig(config);
    }
}

async function saveSharedCompanionConfig() {
    await SettingsManager.saveMediaFabCompanionConfig(settings.companion);
}

async function loadSettings() {
    const stored = await chrome.storage.local.get([MULTI_MODE_STORAGE_KEY]);
    const paramountplus = await SettingsManager.getParamountPlusSettings();
    const bbciplayer = await SettingsManager.getBBCIPlayerSettings();
    const getter = await SettingsManager.getSelectedMetadataGetter();
    const metadata = await getSharedMetadataConfig(getter);
    const companionConfig = await SettingsManager.getMediaFabCompanionConfig();
    return useSharedMetadataSettings({
        ...DEFAULT_MULTI_MODE_SETTINGS,
        ...(stored[MULTI_MODE_STORAGE_KEY] || {}),
        companion: companionConfig,
        paramountplus,
        bbciplayer,
    }, getter, metadata);
}

async function refreshSharedMetadataSettings() {
    const getter = await SettingsManager.getSelectedMetadataGetter();
    const metadata = await getSharedMetadataConfig(getter);
    settings = useSharedMetadataSettings(settings, getter, metadata);
    writeSettingsToForm();
}

async function saveSettings({ syncMetadata = false, syncCompanion = false } = {}) {
    settings = normalizeMultiModeSettings(settings);
    await chrome.storage.local.set({ [MULTI_MODE_STORAGE_KEY]: settings });
    await SettingsManager.saveParamountPlusSettings(settings.paramountplus);
    await SettingsManager.saveBBCIPlayerSettings(settings.bbciplayer);
    if (syncMetadata) {
        await saveSharedMetadataConfig();
    }
    if (syncCompanion) {
        await saveSharedCompanionConfig();
    }
}

function readSettingsFromForm() {
    settings = normalizeMultiModeSettings({
        ...settings,
        destination: elements.destination.value.trim(),
        container: elements.container.value,
        videoMode: elements['video-mode'].value,
        audioMode: elements['audio-mode'].value,
        subtitleMode: elements['subtitle-mode'].value,
        useShakaPackager: elements['use-shaka-packager'].checked,
        externalSubtitles: elements['external-subtitles'].checked,
        keepDownloaderLog: elements['keep-downloader-log'].checked,
        additionalArguments: elements['additional-arguments'].value.trim(),
        metadata: {
            enabled: elements['metadata-enabled'].checked,
            getter: elements['metadata-getter'].value,
            detailLink: elements['metadata-detail-link'].value.trim(),
            projectFolder: elements['metadata-project-folder'].value.trim(),
        },
        companion: {
            enabled: settings.companion.enabled,
            projectFolder: elements['mediafab-companion-project-folder'].value.trim(),
            destination: settings.companion.destination,
            closeTerminalOnComplete: elements['close-terminal-on-complete'].checked,
        },
    });
}

function writeSettingsToForm() {
    elements.destination.value = settings.destination;
    elements.container.value = settings.container;
    elements['video-mode'].value = settings.videoMode;
    elements['audio-mode'].value = settings.audioMode;
    elements['subtitle-mode'].value = settings.subtitleMode;
    elements['use-shaka-packager'].checked = settings.useShakaPackager;
    elements['external-subtitles'].checked = settings.externalSubtitles;
    elements['keep-downloader-log'].checked = settings.keepDownloaderLog;
    elements['additional-arguments'].value = settings.additionalArguments;
    elements['metadata-enabled'].checked = settings.metadata.enabled;
    elements['metadata-getter'].value = settings.metadata.getter;
    elements['metadata-detail-link'].value = settings.metadata.detailLink;
    elements['metadata-project-folder'].value = settings.metadata.projectFolder;
    elements['mediafab-companion-project-folder'].value = settings.companion.projectFolder;
    elements['close-terminal-on-complete'].checked = settings.companion.closeTerminalOnComplete;
    updateSettingsPresentation();
}

function updateSettingsPresentation() {
    const isParamountPlus = catalog?.provider === 'paramountplus';
    const isBBCIPlayer = catalog?.provider === 'bbciplayer';
    elements['standard-media-options-card'].hidden = isParamountPlus || isBBCIPlayer;
    elements['paramountplus-options-card'].hidden = !isParamountPlus;
    elements['bbc-iplayer-options-card'].hidden = !isBBCIPlayer;
    elements['metadata-card'].hidden = isBBCIPlayer;
    elements['metadata-detail-link-fields'].hidden = isParamountPlus;
    elements['paramountplus-metadata-link-note'].hidden = !isParamountPlus;
    elements['paramountplus-argument-preview'].textContent = buildParamountPlusArguments(settings.paramountplus).join(' ');
    elements['argument-preview'].textContent = formatDownloaderArgumentPreview(settings);
    const isLPMAEG = settings.metadata.getter === 'lpmaeg';
    elements['metadata-description'].textContent = isLPMAEG
        ? 'Uses each queued episode’s public detail-page link after its media and subtitles complete. BroadwayHD video links remain automatic.'
        : 'Runs for each completed item after its media, subtitles, naming, and cleanup finish, before Queue Mode advances.';
    elements['metadata-project-folder'].placeholder = isLPMAEG
        ? '/Users/you/Live-Performance-Metadata-and-Extras-Getter'
        : '/Users/you/Media-Metadata-and-Extras-Getter';
    refreshMetadataStatus();
    refreshCompanionConfigurationStatus();
    refreshStartAvailability();
}

function normalizedFolder(value) {
    return String(value || '').replace(/\/+$/, '');
}

function companionConfigurationError() {
    if (!settings.companion.projectFolder.startsWith('/')) {
        return 'Enter MediaFab Companion’s absolute folder path.';
    }
    if (!companionConnected) {
        return 'MediaFab Companion is unavailable.';
    }
    if (connectedCompanionFolder && normalizedFolder(settings.companion.projectFolder) !== normalizedFolder(connectedCompanionFolder)) {
        return 'This folder does not match the installed MediaFab Companion. Reinstall it from this folder.';
    }
    return '';
}

function refreshCompanionConfigurationStatus() {
    const error = companionConfigurationError();
    if (error) {
        setStatus(elements['mediafab-companion-config-status'], error, 'warning');
        return;
    }
    setStatus(elements['mediafab-companion-config-status'], 'Ready — required Queue Mode handoff is available.', 'ready');
}

function refreshMetadataStatus() {
    if (!settings.metadata.enabled) {
        setStatus(elements['metadata-status'], 'Off');
        return;
    }
    if (!settings.metadata.projectFolder.startsWith('/')) {
        setStatus(
            elements['metadata-status'],
            `Enter ${settings.metadata.getter === 'mme' ? 'Media Metadata and Extras Getter' : 'Live Performance Metadata and Extras Getter'}’s absolute project-folder path.`,
            'warning'
        );
        return;
    }
    if (catalog?.provider === 'paramountplus') {
        if (settings.metadata.getter !== 'mme') {
            setStatus(elements['metadata-status'], 'Paramount+ handoff requires Media Metadata and Extras Getter.', 'warning');
            return;
        }
    }
    setStatus(
        elements['metadata-status'],
        settings.metadata.getter === 'mme'
            ? 'Ready — runs after each item completes and before Queue Mode advances.'
            : 'Ready — included in each episode’s normal extension command.',
        'ready',
    );
}

function refreshStartAvailability() {
    const hasSelected = getSelectedEpisodes(catalog).length > 0;
    const hasRunnableSource = ['provider-adapter', 'manual-links'].includes(catalog?.discovery);
    elements['start-selected'].disabled = !(
        hasSelected && hasRunnableSource && companionConnected
        && !companionConfigurationError()
    );
}

function setQueueCollapsibleState(card, collapsed) {
    const button = card.querySelector('.collapse-toggle');
    const title = card.querySelector('h2').textContent;
    card.classList.toggle('is-collapsed', collapsed);
    button.textContent = collapsed ? 'Show' : 'Hide';
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', `${collapsed ? 'Show' : 'Hide'} ${title}`);
}

async function initializeQueueCollapsibles() {
    const stored = await chrome.storage.local.get([QUEUE_SECTION_STATE_KEY]);
    const state = stored[QUEUE_SECTION_STATE_KEY] || {};
    for (const card of document.querySelectorAll('[data-queue-collapsible]')) {
        const name = card.dataset.queueCollapsible;
        setQueueCollapsibleState(card, state[name] === true);
        card.querySelector('.collapse-toggle').addEventListener('click', async () => {
            const collapsed = !card.classList.contains('is-collapsed');
            setQueueCollapsibleState(card, collapsed);
            const latest = await chrome.storage.local.get([QUEUE_SECTION_STATE_KEY]);
            await chrome.storage.local.set({
                [QUEUE_SECTION_STATE_KEY]: {
                    ...(latest[QUEUE_SECTION_STATE_KEY] || {}),
                    [name]: collapsed,
                },
            });
        });
    }
}

function renderManualLinks() {
    elements['manual-link-list'].replaceChildren();
    manualLinkValues.forEach((value, index) => {
        const row = document.createElement('div');
        row.className = 'manual-link-row';
        const fields = document.createElement('div');
        fields.className = 'manual-link-fields';
        const playbackInput = document.createElement('input');
        playbackInput.type = 'url';
        playbackInput.placeholder = `Media playing-page link ${index + 1}`;
        playbackInput.autocomplete = 'off';
        playbackInput.value = value.playbackUrl;
        playbackInput.addEventListener('input', () => {
            manualLinkValues[index].playbackUrl = playbackInput.value;
        });
        const detailInput = document.createElement('input');
        detailInput.type = 'url';
        detailInput.placeholder = `Metadata detail link ${index + 1} (optional when shared)`;
        detailInput.autocomplete = 'off';
        detailInput.value = value.detailUrl;
        detailInput.addEventListener('input', () => {
            manualLinkValues[index].detailUrl = detailInput.value;
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'secondary';
        remove.textContent = 'Delete';
        remove.addEventListener('click', () => {
            manualLinkValues.splice(index, 1);
            if (manualLinkValues.length === 0) {
                manualLinkValues.push({ playbackUrl: '', detailUrl: '' });
            }
            renderManualLinks();
        });
        fields.append(playbackInput, detailInput);
        row.append(fields, remove);
        elements['manual-link-list'].append(row);
    });
}

function useManualLinks() {
    const links = manualLinkValues
        .map((value) => ({ playbackUrl: value.playbackUrl.trim(), detailUrl: value.detailUrl.trim() }))
        .filter((value) => value.playbackUrl);
    if (links.length === 0) {
        setStatus(elements['load-status'], 'Enter at least one episode playing-page link.', 'warning');
        return;
    }
    try {
        catalog = createManualLinkCatalog(links);
        renderCatalogue();
        setStatus(elements['load-status'], `Loaded ${links.length} manual media link(s).`, 'ready');
    } catch (error) {
        setStatus(elements['load-status'], error.message, 'error');
    }
}

async function resolveWorkerTab() {
    if (Number.isInteger(workerTabId)) {
        try {
            const tab = await chrome.tabs.get(workerTabId);
            if (!tab.url?.startsWith(chrome.runtime.getURL(''))) {
                return tab;
            }
        } catch {
            workerTabId = Number.NaN;
        }
    }

    const tab = await chrome.tabs.create({ url: 'about:blank', active: true });
    if (!Number.isInteger(tab?.id)) {
        throw new Error('Queue Mode could not create its dedicated browser tab.');
    }
    workerTabId = tab.id;
    return tab;
}

function clearCaptureTimers() {
    if (captureTimeout) {
        clearTimeout(captureTimeout);
        captureTimeout = null;
    }
}

async function releaseActiveCapture({ next = true } = {}) {
    const capture = activeCapture;
    clearCaptureTimers();
    activeCapture = null;
    if (capture) {
        try {
            await chrome.runtime.sendMessage({
                type: 'MULTI_MODE_END_CAPTURE',
                tabId: capture.tabId,
                navigationId: capture.navigationId,
            });
        } catch {
            // Closing the capture tab also releases ownership in the background.
        }
    }
    if (next) {
        await advanceCaptureLane();
    }
}

function activeDownloadCount() {
    return queueJobs.filter((job) => job.status === 'downloading').length;
}

async function retryActiveCapture(job, navigationId) {
    if (activeCapture?.navigationId !== navigationId || job.status !== 'capturing') {
        return;
    }
    job.captureAttempts = Number(job.captureAttempts || 0) + 1;
    job.status = 'waiting';
    job.captureStatus = `Retrying this episode automatically (attempt ${job.captureAttempts + 1})`;
    renderQueue();
    await releaseActiveCapture({ next: false });
    setTimeout(() => advanceCaptureLane(), 1000);
}

function requestAutomaticPlayback(job, navigationId, tabId) {
    activateProviderPlayback(job.provider, tabId).then((response) => {
        if (activeCapture?.navigationId !== navigationId || job.status !== 'capturing') {
            return;
        }
        if (response?.activated) {
            job.captureStatus = 'Playback requested; waiting for a fresh manifest';
            renderQueue();
            return;
        }
        job.captureStatus = 'Retrying this episode automatically';
        renderQueue();
        setTimeout(() => requestAutomaticPlayback(job, navigationId, tabId), 2000);
    }).catch(() => {
        if (activeCapture?.navigationId !== navigationId || job.status !== 'capturing') {
            return;
        }
        job.captureStatus = 'Retrying this episode automatically';
        renderQueue();
        setTimeout(() => requestAutomaticPlayback(job, navigationId, tabId), 2000);
    });
}

async function advanceCaptureLane() {
    if (queuePaused || activeCapture || activeDownloadCount() >= 1) {
        return;
    }
    const job = queueJobs.find((candidate) => candidate.status === 'waiting');
    if (!job) {
        return;
    }

    if (job.executionMode === 'external-backend') {
        job.status = 'launching';
        job.captureStatus = 'Starting the locally configured backend';
        renderQueue();
        try {
            const response = await companion.request('launch_external_job', {
                jobId: job.id,
                backendId: job.backendId,
            });
            job.status = 'downloading';
            job.captureStatus = 'No browser capture needed';
            job.downloadStatus = response.message || 'Starting';
            job.subtitleStatus = job.subtitleMode === 'none' ? 'Off' : 'Handled by backend';
            job.metadataStatus = job.metadata.enabled ? 'Included in this item' : 'Off';
        } catch (error) {
            job.status = 'failed';
            job.captureStatus = `Failed: ${error.message}`;
            if (error.pauseQueue) {
                queuePaused = true;
                elements['pause-queue'].textContent = 'Resume queue';
            }
        }
        renderQueue();
        return;
    }

    if (job.executionMode === 'local-command') {
        job.status = 'launching';
        job.captureStatus = 'Starting iPlayer Media and Extras Getter';
        renderQueue();
        try {
            const capturedAtMs = Date.now();
            const response = await companion.request('launch_job', {
                jobId: job.id,
                capture: { capturedAtMs },
                command: buildQueueLocalCommand(job),
            });
            job.status = 'downloading';
            job.captureStatus = `Launched in ${response.launchDelayMs} ms`;
            job.downloadStatus = 'Starting';
            job.subtitleStatus = job.bbciplayer?.subtitles === false ? 'Off' : 'Included in command';
            job.metadataStatus = 'Included in command';
        } catch (error) {
            job.status = 'failed';
            job.captureStatus = `Failed: ${error.message}`;
            if (error.pauseQueue) {
                queuePaused = true;
                elements['pause-queue'].textContent = 'Resume queue';
            }
        }
        renderQueue();
        return;
    }

    try {
        const worker = await resolveWorkerTab();
        const navigationId = `${job.id}:${crypto.randomUUID()}`;
        activeCapture = { jobId: job.id, navigationId, tabId: worker.id };
        job.status = 'capturing';
        job.captureStatus = 'Opening in the active capture tab';
        renderQueue();

        const registered = await chrome.runtime.sendMessage({
            type: 'MULTI_MODE_BEGIN_CAPTURE',
            tabId: worker.id,
            jobId: job.id,
            navigationId,
            pageUrl: job.playbackUrl,
            amazonEpisodeIdentity: job.amazonEpisodeIdentity,
        });
        if (!registered?.ok) {
            throw new Error('The extension background did not accept capture ownership.');
        }
        await chrome.tabs.update(worker.id, { url: job.playbackUrl, active: true });
        job.captureStatus = 'Waiting for playback and a fresh manifest';
        renderQueue();

        requestAutomaticPlayback(job, navigationId, worker.id);

        captureTimeout = setTimeout(async () => {
            if (activeCapture?.navigationId !== navigationId) {
                return;
            }
            if (job.provider === 'amazon-prime') {
                await retryActiveCapture(job, navigationId);
            } else {
                job.status = 'failed';
                job.captureStatus = 'Timed out waiting for playback';
                renderQueue();
                await releaseActiveCapture();
            }
        }, CAPTURE_TIMEOUT_MS);
    } catch (error) {
        job.status = 'failed';
        job.captureStatus = `Failed: ${error.message}`;
        renderQueue();
        await releaseActiveCapture();
    }
}

function formatEpisodeNumber(episode) {
    if (episode.seasonNumber == null || episode.episodeNumber == null) {
        return 'Link';
    }
    return `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`;
}

function safeImageUrl(value) {
    try {
        const parsed = new URL(String(value || ''));
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch {
        return '';
    }
}

function applySeriesArtworkShape(poster, overview, shape) {
    const isLandscape = shape === 'landscape';
    poster.classList.toggle('is-landscape', isLandscape);
    overview.classList.toggle('has-landscape-poster', isLandscape);
}

function renderSeriesOverview() {
    if (!catalog || catalog.discovery !== 'provider-adapter') {
        return null;
    }

    const overview = document.createElement('article');
    overview.className = 'series-overview';
    const posterUrl = safeImageUrl(catalog.seriesPosterUrl);
    if (posterUrl) {
        overview.classList.add('has-poster');
        const poster = document.createElement('img');
        poster.className = 'series-poster';
        poster.alt = `${catalog.seriesTitle} poster`;
        poster.referrerPolicy = 'no-referrer';
        applySeriesArtworkShape(poster, overview, catalog.seriesArtworkShape);
        poster.addEventListener('load', () => {
            if (poster.naturalWidth > 0 && poster.naturalHeight > 0) {
                applySeriesArtworkShape(
                    poster,
                    overview,
                    poster.naturalWidth > poster.naturalHeight ? 'landscape' : 'portrait',
                );
            }
        });
        poster.src = posterUrl;
        overview.append(poster);
    }

    const copy = document.createElement('div');
    copy.className = 'series-overview-copy';
    const title = document.createElement('h3');
    title.textContent = catalog.seriesTitle;
    copy.append(title);

    const facts = [
        catalog.seriesYear || '',
        catalog.seriesContentRating || '',
        catalog.seriesSeasonCount ? `${catalog.seriesSeasonCount} season${catalog.seriesSeasonCount === 1 ? '' : 's'}` : '',
        catalog.seriesEpisodeCount ? `${catalog.seriesEpisodeCount} episode${catalog.seriesEpisodeCount === 1 ? '' : 's'}` : '',
        ...(Array.isArray(catalog.seriesGenres) ? catalog.seriesGenres : []),
    ].filter(Boolean);
    if (facts.length) {
        const factLine = document.createElement('p');
        factLine.className = 'series-facts';
        factLine.textContent = facts.join(' · ');
        copy.append(factLine);
    }
    if (catalog.seriesDescription) {
        const description = document.createElement('p');
        description.className = 'series-description';
        description.textContent = catalog.seriesDescription;
        copy.append(description);
    }
    overview.append(copy);
    return overview;
}

function renderCatalogue() {
    elements.catalogue.replaceChildren();
    const seasons = catalog?.seasons || [];
    const episodes = seasons.flatMap((season) => season.episodes || []);
    const selection = getSelectionState(episodes);
    elements['select-all'].disabled = episodes.length === 0;
    elements['select-all'].checked = selection.checked;
    elements['select-all'].indeterminate = selection.indeterminate;
    elements['catalogue-summary'].textContent = catalog
        ? `${catalog.seriesTitle} · ${seasons.length} section(s) · ${selection.selectedCount} of ${selection.totalCount} selected`
        : 'No media loaded';

    if (episodes.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'catalogue-empty';
        empty.textContent = 'Loaded seasons and episodes will appear here.';
        elements.catalogue.append(empty);
        refreshMetadataStatus();
        refreshStartAvailability();
        return;
    }

    const seriesOverview = renderSeriesOverview();
    if (seriesOverview) {
        elements.catalogue.append(seriesOverview);
    }

    for (const season of seasons) {
        const seasonElement = document.createElement('div');
        seasonElement.className = 'season';
        const seasonState = getSelectionState(season.episodes);
        const seasonHeader = document.createElement('div');
        seasonHeader.className = 'season-header';
        const seasonLabel = document.createElement('label');
        seasonLabel.className = 'check-control';
        const seasonCheckbox = document.createElement('input');
        seasonCheckbox.type = 'checkbox';
        seasonCheckbox.checked = seasonState.checked;
        seasonCheckbox.indeterminate = seasonState.indeterminate;
        seasonCheckbox.addEventListener('change', () => {
            setSeasonSelected(catalog, season.id, seasonCheckbox.checked);
            renderCatalogue();
        });
        seasonLabel.append(seasonCheckbox, document.createTextNode(` ${season.title || `Season ${season.number}`}`));
        const count = document.createElement('span');
        count.className = 'season-count';
        count.textContent = `${seasonState.selectedCount}/${seasonState.totalCount} selected`;
        seasonHeader.append(seasonLabel, count);
        seasonElement.append(seasonHeader);

        for (const episode of season.episodes) {
            const row = document.createElement('div');
            row.className = 'episode-row';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'queue-check';
            checkbox.checked = episode.selected;
            checkbox.addEventListener('change', () => {
                episode.selected = checkbox.checked;
                renderCatalogue();
            });
            let thumbnail = null;
            if (catalog.discovery === 'provider-adapter') {
                row.classList.add('has-thumbnail');
                const thumbnailUrl = safeImageUrl(episode.thumbnailUrl);
                thumbnail = document.createElement(thumbnailUrl ? 'img' : 'span');
                thumbnail.className = thumbnailUrl ? 'episode-thumbnail' : 'episode-thumbnail-placeholder';
                if (thumbnailUrl) {
                    thumbnail.src = thumbnailUrl;
                    thumbnail.alt = '';
                    thumbnail.loading = 'lazy';
                    thumbnail.referrerPolicy = 'no-referrer';
                }
            }
            const number = document.createElement('span');
            number.className = 'episode-number';
            number.textContent = formatEpisodeNumber(episode);
            const title = document.createElement('span');
            title.className = 'episode-title';
            title.textContent = episode.title;
            if (episode.description) {
                title.title = episode.description;
            }
            const detail = document.createElement('span');
            detail.className = 'detail-link';
            detail.title = episode.detailUrl || 'No detail link';
            detail.textContent = episode.detailUrl || 'No detail link';
            row.append(checkbox);
            if (thumbnail) {
                row.append(thumbnail);
            }
            row.append(number, title, detail);
            seasonElement.append(row);
        }
        elements.catalogue.append(seasonElement);
    }
    refreshMetadataStatus();
    refreshStartAvailability();
}

function renderQueue() {
    elements['queue-body'].replaceChildren();
    if (queueJobs.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 5;
        cell.className = 'empty-cell';
        cell.textContent = 'No jobs queued.';
        row.append(cell);
        elements['queue-body'].append(row);
        return;
    }
    for (const job of queueJobs) {
        const row = document.createElement('tr');
        row.dataset.jobId = job.id;
        const mediaCell = document.createElement('td');
        const title = document.createElement('div');
        title.className = 'job-title';
        title.textContent = `${formatEpisodeNumber(job)} · ${job.title}`;
        const series = document.createElement('div');
        series.className = 'job-subtitle';
        series.textContent = job.seriesTitle;
        mediaCell.append(title, series);
        const capture = document.createElement('td');
        capture.textContent = job.captureStatus || job.status;
        const download = document.createElement('td');
        download.textContent = job.downloadStatus || 'Waiting';
        const subtitles = document.createElement('td');
        subtitles.textContent = job.subtitleStatus || (job.externalSubtitles ? 'Waiting' : 'Off');
        const metadata = document.createElement('td');
        metadata.textContent = job.backendHandlesMetadata
            ? (job.metadataStatus || 'Included in command')
            : job.executionMode === 'external-backend'
            ? (job.metadataStatus || (job.metadata.enabled ? 'Waiting for Media Metadata and Extras Getter' : 'Off'))
            : job.metadata.enabled ? (job.metadataStatus || 'Waiting') : 'Off';
        row.append(mediaCell, capture, download, subtitles, metadata);
        elements['queue-body'].append(row);
    }
}

async function loadLink() {
    let parsed;
    try {
        parsed = new URL(elements['source-link'].value.trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('unsupported protocol');
        }
    } catch {
        setStatus(elements['load-status'], 'Enter a valid public http(s) series or episode link.', 'error');
        return;
    }

    elements['load-link'].disabled = true;
    setStatus(elements['load-status'], 'Looking for seasons and episodes…');
    try {
        catalog = await discoverProviderCatalog(parsed.href);
        if (catalog) {
            catalog.discovery = 'provider-adapter';
            if (catalog.provider === 'paramountplus') {
                const mme = await SettingsManager.getMMEConfig();
                settings.metadata = { ...mme, getter: 'mme' };
                await SettingsManager.saveSelectedMetadataGetter('mme');
                writeSettingsToForm();
            }
            setStatus(elements['load-status'], `Loaded ${catalog.seriesTitle}.`, 'ready');
        } else {
            catalog = null;
            manualLinkValues = [{ playbackUrl: parsed.href, detailUrl: '' }];
            renderManualLinks();
            setStatus(
                elements['load-status'],
                `${parsed.hostname} does not support automatic catalogue loading yet. Its link was placed in the manual queue below.`,
                'warning'
            );
        }
        renderCatalogue();
    } catch (error) {
        catalog = null;
        renderCatalogue();
        setStatus(elements['load-status'], error.message || 'The provider catalogue could not be loaded.', 'error');
    } finally {
        elements['load-link'].disabled = false;
    }
}

async function startSelected() {
    // Queue tabs can stay open while the normal popup changes the selected
    // getter. Refresh both the getter and its paired configuration immediately
    // before building jobs so one metadata getter can never be combined with
    // the other metadata getter's folder,
    // or vice versa.
    await refreshSharedMetadataSettings();
    readSettingsFromForm();
    await saveSettings({ syncMetadata: true, syncCompanion: true });
    if (!['provider-adapter', 'manual-links'].includes(catalog?.discovery)) {
        setStatus(elements['load-status'], 'Load a supported catalogue or use manual episode links first.', 'warning');
        return;
    }
    const jobs = buildBatchJobs(catalog, settings);
    if (jobs.length === 0) {
        setStatus(elements['load-status'], 'Select at least one episode first.', 'warning');
        return;
    }
    if (!settings.destination.startsWith('/')) {
        setStatus(elements['load-status'], 'Choose an absolute destination before starting.', 'warning');
        return;
    }
    if (jobs.some((job) => job.metadata.enabled) && !settings.metadata.projectFolder.startsWith('/')) {
        setStatus(
            elements['load-status'],
            `Enter ${settings.metadata.getter === 'mme' ? 'Media Metadata and Extras Getter' : 'Live Performance Metadata and Extras Getter'}’s absolute project-folder path before starting.`,
            'warning',
        );
        return;
    }
    if (catalog?.provider === 'paramountplus' && settings.metadata.enabled && settings.metadata.getter !== 'mme') {
        setStatus(elements['load-status'], 'Paramount+ metadata handoff requires Media Metadata and Extras Getter.', 'warning');
        return;
    }
    const companionError = companionConfigurationError();
    if (companionError) {
        setStatus(
            elements['load-status'],
            companionError,
            'warning',
        );
        return;
    }

    elements['start-selected'].disabled = true;
    try {
        const executableName = await SettingsManager.getExecutableName();
        const browserJobs = jobs.filter((job) => job.executionMode === 'browser-capture');
        const externalBackendIds = [...new Set(jobs
            .filter((job) => job.executionMode === 'external-backend')
            .map((job) => job.backendId))];
        if (browserJobs.length > 0) {
            await companion.request('preflight', {
                destination: settings.destination,
                executableName,
                companionFolder: settings.companion.projectFolder,
            });
        }
        if (externalBackendIds.length > 0) {
            await companion.request('preflight_external_backends', {
                backendIds: externalBackendIds,
                jobs: jobs.filter((job) => job.executionMode === 'external-backend'),
                destination: settings.destination,
                companionFolder: settings.companion.projectFolder,
            });
        }
        const response = await companion.request('prepare_batch', {
            jobs,
        });
        queueJobs = response.jobs || jobs;
        renderQueue();
        const queueAction = jobs.every((job) => job.executionMode !== 'browser-capture')
            ? 'The first local job is starting now.'
            : 'The capture lane is opening the first waiting link now.';
        setStatus(elements['load-status'], `${jobs.length} job(s) accepted. ${queueAction}`, 'ready');
        await advanceCaptureLane();
    } catch (error) {
        setStatus(elements['load-status'], error.message, 'error');
    } finally {
        refreshStartAvailability();
    }
}

function updateJobFromEvent(message) {
    const job = queueJobs.find((candidate) => candidate.id === message.jobId);
    if (!job) {
        return;
    }
    Object.assign(job, message.changes || {});
    if (job.backendHandlesMetadata && ['completed', 'skipped'].includes(job.status)) {
        job.metadataStatus = job.status === 'completed' ? 'Complete' : 'Already present';
        job.subtitleStatus = job.bbciplayer?.subtitles === false
            ? 'Off'
            : job.status === 'completed' ? 'Complete' : 'Already present';
    }
    renderQueue();
    if (job.status === 'failed') {
        queuePaused = true;
        elements['pause-queue'].textContent = 'Resume queue';
        setStatus(
            elements['load-status'],
            `${job.title || 'Episode'} failed. Queue paused before opening another episode.`,
            'error',
        );
        companion.request('pause_queue').catch(() => {});
        return;
    }
    if (['waiting', 'completed', 'skipped', 'cancelled'].includes(job.status)) {
        advanceCaptureLane();
    }
}

async function handleCaptureReady(message) {
    const job = queueJobs.find((candidate) => candidate.id === message.jobId);
    if (!job || !activeCapture || activeCapture.jobId !== message.jobId
        || activeCapture.navigationId !== message.navigationId
        || job.status === 'downloading' || job.status === 'completed') {
        return;
    }
    if (captureTimeout) {
        clearTimeout(captureTimeout);
        captureTimeout = null;
    }
    job.captureStatus = 'Dispatching';
    renderQueue();
    try {
        const command = buildQueueMediaCommand(job, message.capture, {
            executableName: await SettingsManager.getExecutableName(),
            useSingleQuotes: await SettingsManager.getUseSingleQuotes(),
        });
        const response = await companion.request('launch_job', {
            jobId: job.id,
            capture: message.capture,
            command,
        });
        job.status = 'downloading';
        job.captureStatus = `Launched in ${response.launchDelayMs} ms`;
        job.downloadStatus = 'Starting';
        job.subtitleStatus = job.externalSubtitles ? 'Included in command' : 'Off';
        job.metadataStatus = job.metadata.enabled ? 'Included in command' : 'Off';
        await releaseActiveCapture();
    } catch (error) {
        job.status = 'failed';
        job.captureStatus = `Failed: ${error.message}`;
        if (error.pauseQueue) {
            queuePaused = true;
            elements['pause-queue'].textContent = 'Resume queue';
            setStatus(elements['load-status'], error.message, 'error');
            await releaseActiveCapture({ next: false });
        } else {
            await releaseActiveCapture();
        }
    }
    renderQueue();
}

function bindEvents() {
    elements.darkModeToggle.addEventListener('change', async () => {
        SettingsManager.setDarkMode(elements.darkModeToggle.checked);
        await SettingsManager.saveDarkMode(elements.darkModeToggle.checked);
    });
    elements['load-link'].addEventListener('click', loadLink);
    elements['source-link'].addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            loadLink();
        }
    });
    elements['add-manual-link'].addEventListener('click', () => {
        manualLinkValues.push({ playbackUrl: '', detailUrl: '' });
        renderManualLinks();
        elements['manual-link-list'].lastElementChild?.querySelector('input')?.focus();
    });
    elements['use-manual-links'].addEventListener('click', useManualLinks);
    elements['select-all'].addEventListener('change', () => {
        setAllEpisodesSelected(catalog, elements['select-all'].checked);
        renderCatalogue();
    });

    const mediaSettingIds = [
        'destination', 'container', 'video-mode', 'audio-mode',
        'subtitle-mode', 'use-shaka-packager', 'external-subtitles', 'keep-downloader-log', 'additional-arguments',
    ];
    for (const id of mediaSettingIds) {
        elements[id].addEventListener('input', async () => {
            readSettingsFromForm();
            writeSettingsToForm();
            await saveSettings();
        });
    }

    elements['metadata-enabled'].addEventListener('change', async () => {
        readSettingsFromForm();
        updateSettingsPresentation();
        await saveSettings({ syncMetadata: true });
    });
    elements['metadata-detail-link'].addEventListener('input', async () => {
        readSettingsFromForm();
        updateSettingsPresentation();
        await saveSettings({ syncMetadata: true });
    });
    elements['metadata-project-folder'].addEventListener('input', async () => {
        readSettingsFromForm();
        updateSettingsPresentation();
        await saveSettings({ syncMetadata: true });
    });
    elements['metadata-getter'].addEventListener('change', async () => {
        readSettingsFromForm();
        const shared = await getSharedMetadataConfig(elements['metadata-getter'].value);
        settings.metadata = {
            ...shared,
            getter: elements['metadata-getter'].value,
        };
        writeSettingsToForm();
        await saveSettings({ syncMetadata: true });
    });
    elements['clear-metadata-link'].addEventListener('click', async () => {
        elements['metadata-detail-link'].value = '';
        readSettingsFromForm();
        updateSettingsPresentation();
        await saveSettings({ syncMetadata: true });
    });
    elements['clear-metadata-setup'].addEventListener('click', async () => {
        elements['metadata-project-folder'].value = '';
        readSettingsFromForm();
        updateSettingsPresentation();
        await saveSettings({ syncMetadata: true });
    });

    elements['mediafab-companion-project-folder'].addEventListener('input', async () => {
        readSettingsFromForm();
        updateSettingsPresentation();
        await saveSettings({ syncCompanion: true });
    });
    elements['close-terminal-on-complete'].addEventListener('change', async () => {
        readSettingsFromForm();
        await saveSettings({ syncCompanion: true });
    });
    elements['clear-mediafab-companion-setup'].addEventListener('click', async () => {
        elements['mediafab-companion-project-folder'].value = '';
        readSettingsFromForm();
        updateSettingsPresentation();
        await saveSettings({ syncCompanion: true });
    });

    elements['browse-destination'].addEventListener('click', async () => {
        try {
            const response = await companion.request('choose_destination', { current: settings.destination });
            if (response.path) {
                elements.destination.value = response.path;
                readSettingsFromForm();
                updateSettingsPresentation();
                await saveSettings();
            }
        } catch (error) {
            setStatus(elements['load-status'], error.message, 'error');
        }
    });

    elements['start-selected'].addEventListener('click', startSelected);
    elements['pause-queue'].addEventListener('click', async () => {
        queuePaused = !queuePaused;
        elements['pause-queue'].textContent = queuePaused ? 'Resume queue' : 'Pause queue';
        try {
            if (queuePaused && activeCapture) {
                const job = queueJobs.find((candidate) => candidate.id === activeCapture.jobId);
                if (job?.status === 'capturing') {
                    job.status = 'waiting';
                    job.captureStatus = 'Paused before capture';
                    renderQueue();
                }
                await releaseActiveCapture({ next: false });
            }
            await companion.request(queuePaused ? 'pause_queue' : 'resume_queue');
            if (!queuePaused) {
                await advanceCaptureLane();
            }
        } catch (error) {
            setStatus(elements['load-status'], error.message, 'error');
        }
    });
    elements['cancel-current'].addEventListener('click', async () => {
        const job = queueJobs.find((candidate) => ['capturing', 'downloading'].includes(candidate.status));
        if (job) {
            if (activeCapture?.jobId === job.id) {
                await releaseActiveCapture({ next: false });
            }
            await companion.request('cancel_jobs', { jobIds: [job.id] });
            await advanceCaptureLane();
        }
    });
    elements['retry-failed'].addEventListener('click', async () => {
        const jobIds = queueJobs.filter((job) => job.status === 'failed').map((job) => job.id);
        if (jobIds.length > 0) {
            await companion.request('retry_jobs', { jobIds });
        }
    });

    companion.onEvent((message) => {
        if (message.type === 'connection') {
            companionConnected = message.connected;
            setCompanionStatus(
                message.connected ? `MediaFab Companion ${message.message}` : `MediaFab Companion unavailable — ${message.message}`,
                message.connected ? 'connecting' : 'error'
            );
            refreshCompanionConfigurationStatus();
            refreshStartAvailability();
        } else if (message.type === 'job_update') {
            updateJobFromEvent(message);
        }
    });

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'MULTI_MODE_CAPTURE_READY') {
            handleCaptureReady(message);
        }
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync' && changes.dark_mode) {
            SettingsManager.setDarkMode(changes.dark_mode.newValue === true);
        }
    });
}

async function initialize() {
    bindEvents();
    await initializeQueueCollapsibles();
    renderManualLinks();
    SettingsManager.setDarkMode(await SettingsManager.getDarkMode());
    settings = await loadSettings();
    mountParamountPlusSettings(elements['paramountplus-settings-fields'], settings.paramountplus, async (next) => {
        settings.paramountplus = normalizeParamountPlusSettings(next);
        updateSettingsPresentation();
        await saveSettings();
    });
    mountBBCIPlayerSettings(elements['bbc-iplayer-settings-fields'], settings.bbciplayer, async (next) => {
        settings.bbciplayer = normalizeBBCIPlayerSettings(next);
        updateSettingsPresentation();
        await saveSettings();
    });
    writeSettingsToForm();
    renderCatalogue();
    renderQueue();
    companion.connect();
    try {
        const hello = await companion.request('hello', { protocolVersion: 1 });
        companionConnected = true;
        connectedCompanionFolder = hello.projectFolder || '';
        setCompanionStatus(`MediaFab Companion ${hello.version || 'ready'}`, 'ready');
    } catch (error) {
        companionConnected = false;
        connectedCompanionFolder = '';
        setCompanionStatus(`MediaFab Companion unavailable — ${error.message}`, 'error');
    }
    refreshCompanionConfigurationStatus();
    refreshStartAvailability();
}

initialize();
