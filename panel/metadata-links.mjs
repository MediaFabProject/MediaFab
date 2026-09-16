function getMatchingPageUrl(pageUrl, hosts, pathPattern) {
    try {
        const parsed = new URL(pageUrl);
        if (hosts.has(parsed.hostname.toLowerCase()) && pathPattern.test(parsed.pathname)) {
            return parsed.href;
        }
    } catch {
        // A non-page URL cannot be used as a metadata detail link.
    }
    return '';
}

export function getBroadwayHDDetailLink(pageUrl) {
    return getMatchingPageUrl(
        pageUrl,
        new Set(['broadwayhd.com', 'www.broadwayhd.com']),
        /^\/video\/\d+\/?$/,
    );
}

export function getCrunchyrollDetailLink(pageUrl) {
    return getMatchingPageUrl(
        pageUrl,
        new Set(['crunchyroll.com', 'www.crunchyroll.com']),
        /(?:^|\/)watch\/[A-Z0-9]+(?:\/|$)/i,
    );
}

export function getCrunchyrollWatchId(pageUrl) {
    if (!getCrunchyrollDetailLink(pageUrl)) {
        return '';
    }
    const match = new URL(pageUrl).pathname.match(/(?:^|\/)watch\/([A-Z0-9]+)(?:\/|$)/i);
    return match ? match[1].toUpperCase() : '';
}

export function getDisneyPlusEpisodeDetailLink(pageUrl) {
    return getMatchingPageUrl(
        pageUrl,
        new Set(['disneyplus.com', 'www.disneyplus.com']),
        /(?:^|\/)play\/[0-9a-f-]+(?:\/|$)/i,
    );
}

export function getMaxEpisodeDetailLink(pageUrl) {
    return getMatchingPageUrl(
        pageUrl,
        new Set(['max.com', 'www.max.com', 'hbomax.com', 'www.hbomax.com', 'play.hbomax.com']),
        /(?:^|\/)video\/watch\/[0-9a-f-]+(?:\/|$)/i,
    );
}

export function getMaxCanonicalMetadataLink(pageUrl) {
    return getMatchingPageUrl(
        pageUrl,
        new Set(['max.com', 'www.max.com', 'hbomax.com', 'www.hbomax.com']),
        /(?:^|\/)(?:show|movie)\/[0-9a-f-]{36}(?:\/|$)/i,
    );
}

export function getParamountPlusEpisodeDetailLink(pageUrl) {
    return getMatchingPageUrl(
        pageUrl,
        new Set(['paramountplus.com', 'www.paramountplus.com']),
        /^\/(?:shows|movies)\/video\/[^/]+\/?$/i,
    );
}

export function getBBCIPlayerEpisodeDetailLink(pageUrl) {
    return getMatchingPageUrl(
        pageUrl,
        new Set(['bbc.co.uk', 'www.bbc.co.uk']),
        /^\/iplayer\/episode\/[a-z0-9]+(?:\/|$)/i,
    );
}

export function getNetflixTitleDetailLink(pageUrl) {
    return getMatchingPageUrl(
        pageUrl,
        new Set(['netflix.com', 'www.netflix.com']),
        /^\/(?:title|watch)\/\d+(?:\/|$)/i,
    );
}

export function getPBSKidsEpisodeDetailLink(pageUrl) {
    return getMatchingPageUrl(
        pageUrl,
        new Set(['pbskids.org', 'www.pbskids.org']),
        /^\/videos\/watch\/[^/]+\/\d+\/[^/]+\/\d+\/?$/i,
    );
}

export function isAmazonPrimeVideoPage(pageUrl) {
    try {
        return /(^|\.)(?:primevideo\.com|amazon\.(?:ae|ca|cn|com|de|eg|es|fr|in|it|nl|pl|sa|se|sg|co\.jp|co\.uk|com\.au|com\.be|com\.br|com\.mx|com\.tr))$/i
            .test(new URL(pageUrl).hostname);
    } catch {
        return false;
    }
}

export function getAmazonPrimeEpisodeDetailLink(detailUrl) {
    try {
        const parsed = new URL(detailUrl);
        if (!isAmazonPrimeVideoPage(parsed.href)) {
            return '';
        }
        const match = parsed.pathname.match(/\/(?:region\/([^/]+)\/)?detail\/([A-Z0-9]+)(?:\/|$)/i);
        return match
            ? `https://www.primevideo.com/region/${match[1] || 'na'}/detail/${match[2].toUpperCase()}`
            : '';
    } catch {
        return '';
    }
}

export function createCrunchyrollTemporarySaveNameArgument(pageUrl, additionalArgs, quoteChar) {
    const watchId = getCrunchyrollWatchId(pageUrl);
    if (!watchId || /(?:^|\s)--save-name(?:\s+|=)/.test(String(additionalArgs || ''))) {
        return '';
    }
    return `--save-name "crunchyroll-${watchId}-\${mediafab_download_marker:t}"`;
}

function providerIdentity(pageUrl = '', amazonEpisodeDetailUrl = '') {
    const candidates = [
        [getCrunchyrollDetailLink(pageUrl), /\/watch\/([A-Z0-9]+)(?:\/|$)/i, 'crunchyroll'],
        [getDisneyPlusEpisodeDetailLink(pageUrl), /\/play\/([0-9a-f-]+)(?:\/|$)/i, 'disneyplus'],
        [getMaxEpisodeDetailLink(pageUrl), /\/video\/watch\/([0-9a-f-]+)(?:\/|$)/i, 'max'],
        [getParamountPlusEpisodeDetailLink(pageUrl), /\/(?:shows|movies)\/video\/([^/]+)(?:\/|$)/i, 'paramountplus'],
        [getPBSKidsEpisodeDetailLink(pageUrl), /\/videos\/watch\/[^/]+\/\d+\/[^/]+\/(\d+)(?:\/|$)/i, 'pbskids'],
        [getBBCIPlayerEpisodeDetailLink(pageUrl), /\/iplayer\/episode\/([a-z0-9]+)(?:\/|$)/i, 'bbciplayer'],
        [getNetflixTitleDetailLink(pageUrl), /\/(?:title|watch)\/(\d+)(?:\/|$)/i, 'netflix'],
        [getAmazonPrimeEpisodeDetailLink(amazonEpisodeDetailUrl) || getAmazonPrimeEpisodeDetailLink(pageUrl), /\/detail\/([A-Z0-9]+)(?:\/|$)/i, 'primevideo'],
    ];
    for (const [url, pattern, provider] of candidates) {
        const match = String(url || '').match(pattern);
        if (match) {
            return { provider, id: match[1] };
        }
    }
    return null;
}

export function getMMEProviderIdentity(pageUrl = '', amazonEpisodeDetailUrl = '') {
    return providerIdentity(pageUrl, amazonEpisodeDetailUrl);
}

export function removeSaveNameArgument(additionalArgs = '') {
    return String(additionalArgs)
        .replace(/(?:^|\s)--save-name(?:\s+|=)(?:"[^"]*"|'[^']*'|\S+)/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

export function createProviderIdentitySaveNameArgument(
    pageUrl,
    amazonEpisodeDetailUrl,
    markerExpression = '${mediafab_download_marker:t}',
) {
    const identity = providerIdentity(pageUrl, amazonEpisodeDetailUrl);
    if (!identity) {
        return '';
    }
    const safeId = identity.id.replace(/[^a-z0-9_-]/gi, '');
    return safeId
        ? `--save-name "mediafab-${identity.provider}-${safeId}-${markerExpression}"`
        : '';
}

export function resolveLPMAEGDetailLink(config, pageUrl = '') {
    return config.detailLink || getBroadwayHDDetailLink(pageUrl) || getHttpPageUrl(pageUrl);
}

function getHttpPageUrl(pageUrl) {
    try {
        const parsed = new URL(pageUrl);
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch {
        return '';
    }
}

export function resolveMMEDetailLink(config, pageUrl = '', amazonEpisodeDetailUrl = '') {
    const override = config.preferDetailLinkOverride ? getHttpPageUrl(config.detailLink) : '';
    if (override) {
        return override;
    }
    if (isAmazonPrimeVideoPage(pageUrl)) {
        return getAmazonPrimeEpisodeDetailLink(amazonEpisodeDetailUrl)
            || getAmazonPrimeEpisodeDetailLink(pageUrl)
            || getHttpPageUrl(pageUrl);
    }
    const maxPlayback = getMaxEpisodeDetailLink(pageUrl);
    if (maxPlayback) {
        // Prefer the public show URL when capture has resolved it, but do not
        // block a normal download while that asynchronous lookup is pending.
        // Media Metadata and Extras Getter can resolve the current Max player
        // page itself, and the optional detail-link field remains an override.
        return getMaxCanonicalMetadataLink(config.detailLink) || maxPlayback;
    }
    return getCrunchyrollDetailLink(pageUrl)
        || getDisneyPlusEpisodeDetailLink(pageUrl)
        || getParamountPlusEpisodeDetailLink(pageUrl)
        || getPBSKidsEpisodeDetailLink(pageUrl)
        || getBBCIPlayerEpisodeDetailLink(pageUrl)
        || getNetflixTitleDetailLink(pageUrl)
        || getHttpPageUrl(pageUrl)
        || getHttpPageUrl(config.detailLink);
}

function shellQuote(value) {
    return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

function joinOutputPath(outputDirectory, filename) {
    return outputDirectory === '.' ? filename : `${outputDirectory.replace(/[\\/]+$/, '')}/${filename}`;
}

export function createCrunchyrollDownloadMarkerCommand(outputDirectory) {
    const markerTemplate = joinOutputPath(outputDirectory, '.widevineproxy2-download.XXXXXX');
    return [
        `mkdir -p ${shellQuote(outputDirectory)}`,
        `mediafab_download_marker=$(mktemp ${shellQuote(markerTemplate)})`,
        `trap 'rm -f -- "$mediafab_download_marker"' EXIT`,
    ].join(' && ');
}

export function createCrunchyrollMediaResolutionCommand(outputDirectory) {
    const extensions = [
        '*.3gp', '*.avi', '*.flv', '*.m2ts', '*.m4v', '*.mkv', '*.mov', '*.mp4',
        '*.mpeg', '*.mpg', '*.mts', '*.ts', '*.webm', '*.wmv',
    ];
    const predicates = extensions.map((extension) => `-iname ${shellQuote(extension)}`).join(' -o ');
    const findCommand = [
        'find', shellQuote(outputDirectory), '-maxdepth 1', '-type f',
        '\\(', predicates, '\\)', '-newer "$mediafab_download_marker"', '-print',
    ].join(' ');
    return [
        `mediafab_media_files=("\${(@f)\$(${findCommand})}")`,
        'if (( ${#mediafab_media_files[@]} != 1 )); then printf \'%s\\n\' \'MediaFab note: Could not identify exactly one newly completed video for the metadata handoff.\' >&2; false; else mediafab_media_file="${mediafab_media_files[1]}"; fi',
    ].join(' && ');
}

export function createMMEHandoffCommand(config, outputDirectory, pageUrl = '', amazonEpisodeDetailUrl = '') {
    const resolvedAmazonEpisodeUrl = isAmazonPrimeVideoPage(pageUrl)
        ? getAmazonPrimeEpisodeDetailLink(amazonEpisodeDetailUrl)
        : '';
    const launcherPath = `${config.projectFolder.replace(/[\\/]+$/, '')}/Launchers/media_metadata_and_extras_getter.py`;
    const handoff = [
        'python3',
        shellQuote(launcherPath),
        '--handoff',
        '--detail-link', shellQuote(resolveMMEDetailLink(config, pageUrl, resolvedAmazonEpisodeUrl)),
        '--media-folder', '"$mediafab_media_file"',
        '--skip-existing',
    ].join(' ');
    return `if [[ -f "$mediafab_media_file" ]]; then ${handoff}; else printf '%s\\n' 'MediaFab note: Metadata handoff skipped because the final completed media file no longer exists.' >&2; false; fi`;
}

export function createLPMAEGHandoffCommand(config, outputDirectory, pageUrl = '') {
    const launcherPath = `${config.projectFolder.replace(/[\\/]+$/, '')}/Launchers/live_performance_metadata_and_extras_getter.py`;
    return [
        'python3',
        shellQuote(launcherPath),
        '--handoff',
        '--detail-link', shellQuote(resolveLPMAEGDetailLink(config, pageUrl)),
        '--media-folder', shellQuote(outputDirectory),
        '--skip-existing',
    ].join(' ');
}
