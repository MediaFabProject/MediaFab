import {
    buildNormalMediaCommand,
    filterExternalSubtitlesByLanguage,
} from '../panel/command-builder.mjs';
import { getMMEProviderIdentity } from '../panel/metadata-links.mjs';
import {
    DEFAULT_PARAMOUNTPLUS_SETTINGS,
    buildParamountPlusArguments,
    normalizeParamountPlusSettings,
} from './paramountplus-settings.mjs';
import {
    DEFAULT_BBC_IPLAYER_SETTINGS,
    buildBBCIPlayerCommand,
    normalizeBBCIPlayerSettings,
} from './bbc-iplayer-settings.mjs';

export const MULTI_MODE_STORAGE_KEY = 'multi_mode_settings';

export const DEFAULT_MULTI_MODE_SETTINGS = Object.freeze({
    destination: '',
    container: 'mkv',
    videoMode: '1080',
    audioMode: 'best',
    subtitleMode: 'all',
    useShakaPackager: true,
    externalSubtitles: true,
    keepDownloaderLog: false,
    additionalArguments: '',
    paramountplus: DEFAULT_PARAMOUNTPLUS_SETTINGS,
    bbciplayer: DEFAULT_BBC_IPLAYER_SETTINGS,
    metadata: {
        enabled: false,
        getter: 'lpmaeg',
        detailLink: '',
        projectFolder: '',
    },
    companion: {
        enabled: false,
        projectFolder: '',
        destination: '',
        closeTerminalOnComplete: false,
    },
});

const VIDEO_SELECTORS = Object.freeze({
    '2160': 'res=3840*:for=best',
    '1080': 'res=1920*:for=best',
    '720': 'res=1280*:for=best',
});

export function normalizeMultiModeSettings(value = {}) {
    const {
        simultaneousJobs: _legacySimultaneousJobs,
        filenameTemplate: _legacyFilenameTemplate,
        ...supportedValues
    } = value;
    const metadata = value.metadata || {};
    const companion = value.companion || {};
    return {
        ...DEFAULT_MULTI_MODE_SETTINGS,
        ...supportedValues,
        useShakaPackager: value.useShakaPackager !== false,
        externalSubtitles: value.externalSubtitles !== false,
        keepDownloaderLog: value.keepDownloaderLog === true,
        paramountplus: normalizeParamountPlusSettings(value.paramountplus),
        bbciplayer: normalizeBBCIPlayerSettings(value.bbciplayer),
        metadata: {
            ...DEFAULT_MULTI_MODE_SETTINGS.metadata,
            ...metadata,
            getter: metadata.getter === 'mme' ? 'mme' : 'lpmaeg',
            enabled: metadata.enabled === true,
        },
        companion: {
            ...DEFAULT_MULTI_MODE_SETTINGS.companion,
            ...companion,
            enabled: companion.enabled === true,
            closeTerminalOnComplete: companion.closeTerminalOnComplete === true,
        },
    };
}

export function useSharedMetadataSettings(value, getter, config = {}) {
    return normalizeMultiModeSettings({
        ...value,
        metadata: {
            ...config,
            getter: getter === 'mme' ? 'mme' : 'lpmaeg',
        },
    });
}

export function buildDownloaderArguments(settings) {
    const normalized = normalizeMultiModeSettings(settings);
    const args = ['-M', `format=${normalized.container}`];

    if (!normalized.keepDownloaderLog) {
        args.push('--no-log');
    }
    if (VIDEO_SELECTORS[normalized.videoMode]) {
        args.push('-sv', VIDEO_SELECTORS[normalized.videoMode]);
    }

    if (normalized.audioMode === 'none') {
        args.push('-da', 'all');
    } else {
        args.push('-sa', normalized.audioMode);
    }

    if (normalized.subtitleMode === 'none') {
        args.push('-ds', 'all');
    } else if (normalized.subtitleMode === 'english') {
        args.push('-ss', 'lang=en:for=best');
    } else {
        args.push('-ss', normalized.subtitleMode);
    }

    return args;
}

function shellQuote(value) {
    const text = String(value);
    return /^[A-Za-z0-9_./:=+-]+$/.test(text)
        ? text
        : `'${text.replaceAll("'", "'\"'\"'")}'`;
}

export function formatDownloaderArgumentPreview(settings) {
    const normalized = normalizeMultiModeSettings(settings);
    const generatedOptions = buildDownloaderArguments(normalized);
    if (normalized.useShakaPackager) {
        generatedOptions.unshift('--use-shaka-packager');
    }
    const generated = generatedOptions.map(shellQuote).join(' ');
    const additional = String(settings?.additionalArguments || '').trim();
    return additional ? `${generated} ${additional}` : generated;
}

export function quoteShellArgument(value) {
    return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function buildQueueAdditionalArguments(job) {
    const generated = (job.downloaderArguments || []).map(shellQuote).join(' ');
    const extra = String(job.additionalArguments || '').trim();
    return [
        generated,
        extra,
        `--save-dir ${quoteShellArgument(job.outputDirectory)}`,
    ].filter(Boolean).join(' ');
}

export function createCrunchyrollExistingEpisodeGuard(job, command) {
    const destination = String(job.outputDirectory || '').trim();
    const identity = getMMEProviderIdentity(
        job.playbackUrl,
        job.provider === 'amazon-prime' ? (job.detailUrl || job.amazonEpisodeIdentity?.detailUrl) : '',
    );
    if (!identity || !destination) {
        return command;
    }
    const safeIdentity = identity.id.replace(/[^a-z0-9_-]/gi, '');
    if (!safeIdentity) return command;
    const videoExtensions = [
        '3gp', 'avi', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4',
        'mpeg', 'mpg', 'mts', 'ts', 'webm', 'wmv',
    ];
    const predicates = videoExtensions
        .map((extension) => `-iname ${quoteShellArgument(`*${safeIdentity}*.${extension}`)}`)
        .join(' -o ');
    return [
        '() {',
        'emulate -L zsh;',
        'local mediafab_existing_episode;',
        `mediafab_existing_episode=$(find ${quoteShellArgument(destination)} -type f \\( ${predicates} \\) -print -quit 2>/dev/null);`,
        'if [[ -n "$mediafab_existing_episode" ]]; then',
        'printf \'%s\\n\' "MediaFab note: Queue skipped existing episode: $mediafab_existing_episode";',
        'else',
        `${command};`,
        'fi;',
        '}',
    ].join(' ');
}

function canonicalAmazonPrimeEpisodeUrl(value) {
    try {
        const parsed = new URL(value);
        const host = /(^|\.)(?:primevideo\.com|amazon\.(?:ae|ca|cn|com|de|eg|es|fr|in|it|nl|pl|sa|se|sg|co\.jp|co\.uk|com\.au|com\.be|com\.br|com\.mx|com\.tr))$/i;
        const match = parsed.pathname.match(/\/(?:region\/([^/]+)\/)?detail\/([A-Z0-9]+)(?:\/|$)/i);
        return host.test(parsed.hostname) && match
            ? `https://www.primevideo.com/region/${match[1] || 'na'}/detail/${match[2].toUpperCase()}`
            : '';
    } catch {
        return '';
    }
}

export function resolveAmazonPrimeQueueEpisode(job, capture = null) {
    if (job?.provider !== 'amazon-prime') {
        return '';
    }
    const identity = job.amazonEpisodeIdentity;
    const detailUrl = canonicalAmazonPrimeEpisodeUrl(job.detailUrl);
    const identityUrl = canonicalAmazonPrimeEpisodeUrl(identity?.detailUrl);
    const identifiers = [identity?.gti, identity?.compactGTI, identity?.playbackID]
        .map((value) => String(value || '').trim()).filter(Boolean);
    if (!detailUrl || detailUrl !== identityUrl || identifiers.length === 0) {
        throw new Error('Amazon Prime metadata handoff refused: the queued playback is not tied unambiguously to one episode detail URL.');
    }
    const captured = capture?.amazonEpisodeIdentity;
    const capturedUrl = canonicalAmazonPrimeEpisodeUrl(captured?.detailUrl);
    if (captured?.status !== 'resolved' || !capturedUrl || capturedUrl !== detailUrl) {
        throw new Error('Amazon Prime metadata handoff refused: the captured playback did not match the queued episode detail URL.');
    }
    return detailUrl;
}

export function buildQueueMediaCommand(job, capture, {
    executableName = 'N_m3u8DL-RE',
    useSingleQuotes = false,
} = {}) {
    const manifest = capture?.manifest || {};
    const keys = (capture?.keys || []).filter((key) => key?.kid && key?.k);
    const keyString = keys.map((key) => `--key ${key.kid}:${key.k}`).join(' ');
    const capturedSubtitles = job.externalSubtitles ? (capture?.subtitles || []) : [];
    const selectedSubtitles = job.subtitleMode === 'english'
        ? filterExternalSubtitlesByLanguage(capturedSubtitles, 'en')
        : capturedSubtitles;
    const amazonEpisodeDetailUrl = resolveAmazonPrimeQueueEpisode(job, capture);
    const explicitMetadataDetailLink = job.detailLinkIsOverride ? job.detailUrl : '';
    const command = buildNormalMediaCommand({
        metadata: {
            url: manifest.url,
            headers: manifest.headers || {},
            subtitles: selectedSubtitles,
            isPublicMedia: keys.length === 0,
            isHlsPlaylistFallback: manifest.type === 'HLS_PLAYLIST',
            pageUrl: job.playbackUrl,
            amazonEpisodeDetailUrl,
            amazonEpisodeIdentity: job.amazonEpisodeIdentity || null,
            maxContentPeriodId: manifest.maxContentPeriodId || null,
            maxContentPeriodIds: manifest.maxContentPeriodIds || [],
            maxContentDurationSeconds: manifest.maxContentDurationSeconds || null,
            maxVideoTracks: manifest.maxVideoTracks || [],
            maxAudioTracks: manifest.maxAudioTracks || [],
        },
        keyString,
        useSingleQuotes,
        executableName,
        useShakaPackager: job.useShakaPackager !== false,
        additionalArguments: buildQueueAdditionalArguments(job),
        metadataGetterType: job.metadata?.getter || 'lpmaeg',
        metadataGetterConfig: {
            ...(job.metadata || { enabled: false }),
            detailLink: explicitMetadataDetailLink || job.detailUrl || '',
            preferDetailLinkOverride: Boolean(explicitMetadataDetailLink),
        },
        outputDirectory: job.outputDirectory,
    });
    if (command.startsWith('MediaFab command unavailable:')) {
        throw new Error(command.replace(/^MediaFab command unavailable:\s*/, ''));
    }
    return createCrunchyrollExistingEpisodeGuard(job, command);
}

export function buildQueueLocalCommand(job) {
    if (job?.provider !== 'bbciplayer' || job?.executionMode !== 'local-command') {
        throw new Error('This Queue Mode item does not use a local command backend.');
    }
    return buildBBCIPlayerCommand(job.sourceUrl || job.playbackUrl, job.outputDirectory, job.bbciplayer);
}

export function createDirectLinkCatalog(url) {
    const parsed = new URL(url);
    return {
        provider: parsed.hostname,
        seriesTitle: parsed.hostname,
        discovery: 'direct-link',
        seasons: [{
            id: 'provided-link',
            number: null,
            title: 'Provided link',
            episodes: [{
                id: `direct:${parsed.href}`,
                seasonNumber: null,
                episodeNumber: null,
                title: 'Provided episode link',
                playbackUrl: parsed.href,
                detailUrl: parsed.href,
                selected: true,
            }],
        }],
    };
}

export function createManualLinkCatalog(values) {
    const entries = values.map((value) => {
        const explicit = value && typeof value === 'object';
        const playbackValue = explicit ? value.playbackUrl : value;
        const detailValue = explicit ? String(value.detailUrl || '').trim() : String(value || '').trim();
        return {
            playbackUrl: new URL(String(playbackValue || '').trim()),
            detailUrl: detailValue ? new URL(detailValue) : null,
            explicit,
        };
    });
    if (entries.length === 0 || entries.some(({ playbackUrl, detailUrl }) =>
        !['http:', 'https:'].includes(playbackUrl.protocol)
        || (detailUrl && !['http:', 'https:'].includes(detailUrl.protocol)))) {
        throw new TypeError('Manual playing-page and detail links must be public http(s) URLs.');
    }
    const suppliedDetails = entries
        .map((entry, index) => entry.detailUrl ? { index, href: entry.detailUrl.href } : null)
        .filter(Boolean);
    const sharedDetailForIndex = (index) => {
        if (!suppliedDetails.length) return '';
        const preceding = [...suppliedDetails].reverse().find((detail) => detail.index <= index);
        return (preceding || suppliedDetails[0]).href;
    };
    return {
        provider: 'manual',
        seriesTitle: 'Manual Queue',
        discovery: 'manual-links',
        seasons: [{
            id: 'manual-links',
            number: 1,
            title: 'Manual episode links',
            episodes: entries.map((entry, index) => {
                const url = entry.playbackUrl;
                return ({
                id: `manual:${index}:${url.href}`,
                provider: /(^|\.)crunchyroll\.com$/i.test(url.hostname)
                    ? 'crunchyroll'
                    : /(^|\.)disneyplus\.com$/i.test(url.hostname)
                        ? 'disneyplus'
                        : /(^|\.)pbskids\.org$/i.test(url.hostname)
                            ? 'pbs-kids'
                            : 'manual',
                seasonNumber: 1,
                episodeNumber: index + 1,
                title: `Episode link ${index + 1}`,
                playbackUrl: url.href,
                detailUrl: entry.explicit ? sharedDetailForIndex(index) : url.href,
                suppliedDetailUrl: entry.detailUrl?.href || '',
                detailLinkIsOverride: entry.explicit && Boolean(sharedDetailForIndex(index)),
                selected: true,
            }); }),
        }],
    };
}

export function getSelectedEpisodes(catalog) {
    return (catalog?.seasons || []).flatMap((season) =>
        (season.episodes || []).filter((episode) => episode.selected)
    );
}

export function setAllEpisodesSelected(catalog, selected) {
    for (const season of catalog?.seasons || []) {
        for (const episode of season.episodes || []) {
            episode.selected = selected;
        }
    }
    return catalog;
}

export function setSeasonSelected(catalog, seasonId, selected) {
    const season = (catalog?.seasons || []).find((candidate) => candidate.id === seasonId);
    for (const episode of season?.episodes || []) {
        episode.selected = selected;
    }
    return catalog;
}

export function getSelectionState(episodes = []) {
    const selectedCount = episodes.filter((episode) => episode.selected).length;
    return {
        checked: episodes.length > 0 && selectedCount === episodes.length,
        indeterminate: selectedCount > 0 && selectedCount < episodes.length,
        selectedCount,
        totalCount: episodes.length,
    };
}

export function buildBatchJobs(catalog, settings) {
    const normalized = normalizeMultiModeSettings(settings);
    const selectedEpisodes = getSelectedEpisodes(catalog);
    if (catalog?.provider === 'paramountplus' && catalog?.mediaKind === 'series' && catalog?.externalBackend) {
        if (selectedEpisodes.length === 0) return [];
        const totalEpisodes = (catalog.seasons || []).reduce(
            (total, season) => total + (season.episodes || []).length,
            0,
        );
        const wanted = selectedEpisodes.length === totalEpisodes
            ? ''
            : selectedEpisodes.map((episode) =>
                `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`
            ).join(',');
        return [{
            id: `${Date.now()}-0-paramountplus-series`,
            provider: 'paramountplus',
            seriesTitle: catalog.seriesTitle,
            seasonNumber: null,
            episodeNumber: null,
            title: selectedEpisodes.length === totalEpisodes
                ? catalog.seriesTitle
                : `${selectedEpisodes.length} selected episodes`,
            playbackUrl: catalog.sourceUrl,
            detailUrl: catalog.sourceUrl,
            sourceUrl: catalog.sourceUrl,
            executionMode: 'external-backend',
            backendId: 'paramountplus',
            backendArguments: buildParamountPlusArguments({ ...normalized.paramountplus, wanted }),
            amazonEpisodeIdentity: null,
            destination: normalized.destination,
            outputDirectory: normalized.destination,
            downloaderArguments: buildDownloaderArguments(normalized),
            additionalArguments: normalized.additionalArguments,
            useShakaPackager: normalized.useShakaPackager,
            externalSubtitles: normalized.externalSubtitles,
            subtitleMode: normalized.subtitleMode,
            metadata: {
                ...normalized.metadata,
                enabled: normalized.metadata.enabled && normalized.metadata.getter === 'mme',
            },
            closeTerminalOnComplete: normalized.companion.closeTerminalOnComplete,
            status: 'waiting',
        }];
    }
    return selectedEpisodes.map((episode, index) => {
        const job = {
            id: `${Date.now()}-${index}-${episode.id}`,
            provider: episode.provider || catalog.provider,
            seriesTitle: catalog.seriesTitle,
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
            title: episode.title,
            playbackUrl: episode.playbackUrl,
            detailUrl: episode.detailUrl || normalized.metadata.detailLink || episode.playbackUrl,
            detailLinkIsOverride: episode.detailLinkIsOverride === true,
            sourceUrl: episode.sourceUrl || episode.playbackUrl,
            executionMode: episode.executionMode || 'browser-capture',
            backendId: episode.backendId || '',
            backendArguments: episode.executionMode === 'external-backend'
                ? buildParamountPlusArguments(normalized.paramountplus)
                : [],
            bbciplayer: episode.executionMode === 'local-command'
                ? { ...normalized.bbciplayer }
                : null,
            amazonEpisodeIdentity: episode.amazonEpisodeIdentity
                ? { ...episode.amazonEpisodeIdentity, asins: [...(episode.amazonEpisodeIdentity.asins || [])] }
                : null,
            destination: normalized.destination,
            outputDirectory: normalized.destination,
            downloaderArguments: buildDownloaderArguments(normalized),
            additionalArguments: normalized.additionalArguments,
            useShakaPackager: normalized.useShakaPackager,
            externalSubtitles: normalized.externalSubtitles,
            subtitleMode: normalized.subtitleMode,
            metadata: episode.executionMode === 'local-command'
                ? { ...normalized.metadata, enabled: false }
                : episode.executionMode === 'external-backend'
                ? { ...normalized.metadata, enabled: normalized.metadata.enabled && normalized.metadata.getter === 'mme' }
                : { ...normalized.metadata },
            backendHandlesMetadata: episode.executionMode === 'local-command',
            closeTerminalOnComplete: normalized.companion.closeTerminalOnComplete,
            status: 'waiting',
        };
        return job;
    });
}
