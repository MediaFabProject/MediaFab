import {
    buildNormalMediaCommand,
    filterExternalSubtitlesByLanguage,
} from '../panel/command-builder.mjs';

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

function escapeFindPatternLiteral(value) {
    return String(value).replace(/[\\*?[\]]/g, '\\$&');
}

export function createCrunchyrollExistingEpisodeGuard(job, command) {
    const seasonNumber = Number(job.seasonNumber);
    const episodeNumber = Number(job.episodeNumber);
    const seriesTitle = String(job.seriesTitle || '').trim();
    const destination = String(job.outputDirectory || '').trim();
    if (!['crunchyroll', 'disneyplus'].includes(job.provider)
        || !Number.isInteger(seasonNumber) || seasonNumber <= 0
        || !Number.isInteger(episodeNumber) || episodeNumber <= 0
        || !seriesTitle || !destination) {
        return command;
    }
    const position = `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
    const filenamePrefix = `${position} ${escapeFindPatternLiteral(seriesTitle)} - *`;
    const videoExtensions = [
        '3gp', 'avi', 'flv', 'm2ts', 'm4v', 'mkv', 'mov', 'mp4',
        'mpeg', 'mpg', 'mts', 'ts', 'webm', 'wmv',
    ];
    const predicates = videoExtensions
        .map((extension) => `-iname ${quoteShellArgument(`${filenamePrefix}.${extension}`)}`)
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
    const command = buildNormalMediaCommand({
        metadata: {
            url: manifest.url,
            headers: manifest.headers || {},
            subtitles: selectedSubtitles,
            isPublicMedia: keys.length === 0,
            isHlsPlaylistFallback: manifest.type === 'HLS_PLAYLIST',
            pageUrl: job.playbackUrl,
        },
        keyString,
        useSingleQuotes,
        executableName,
        useShakaPackager: job.useShakaPackager !== false,
        additionalArguments: buildQueueAdditionalArguments(job),
        metadataGetterType: job.metadata?.getter || 'lpmaeg',
        metadataGetterConfig: {
            ...(job.metadata || { enabled: false }),
            detailLink: job.detailUrl || job.metadata?.detailLink || '',
        },
        outputDirectory: job.outputDirectory,
    });
    return createCrunchyrollExistingEpisodeGuard(job, command);
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
    const urls = values.map((value) => new URL(String(value).trim()));
    if (urls.length === 0 || urls.some((url) => !['http:', 'https:'].includes(url.protocol))) {
        throw new TypeError('Manual episode links must be public http(s) URLs.');
    }
    return {
        provider: 'manual',
        seriesTitle: 'Manual Queue',
        discovery: 'manual-links',
        seasons: [{
            id: 'manual-links',
            number: 1,
            title: 'Manual episode links',
            episodes: urls.map((url, index) => ({
                id: `manual:${index}:${url.href}`,
                provider: /(^|\.)crunchyroll\.com$/i.test(url.hostname)
                    ? 'crunchyroll'
                    : /(^|\.)disneyplus\.com$/i.test(url.hostname)
                        ? 'disneyplus'
                        : 'manual',
                seasonNumber: 1,
                episodeNumber: index + 1,
                title: `Episode link ${index + 1}`,
                playbackUrl: url.href,
                detailUrl: url.href,
                selected: true,
            })),
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
    return getSelectedEpisodes(catalog).map((episode, index) => {
        const job = {
            id: `${Date.now()}-${index}-${episode.id}`,
            provider: episode.provider || catalog.provider,
            seriesTitle: catalog.seriesTitle,
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber,
            title: episode.title,
            playbackUrl: episode.playbackUrl,
            detailUrl: episode.detailUrl || normalized.metadata.detailLink || episode.playbackUrl,
            destination: normalized.destination,
            outputDirectory: normalized.destination,
            downloaderArguments: buildDownloaderArguments(normalized),
            additionalArguments: normalized.additionalArguments,
            useShakaPackager: normalized.useShakaPackager,
            externalSubtitles: normalized.externalSubtitles,
            subtitleMode: normalized.subtitleMode,
            metadata: { ...normalized.metadata },
            closeTerminalOnComplete: normalized.companion.closeTerminalOnComplete,
            status: 'waiting',
        };
        return job;
    });
}
