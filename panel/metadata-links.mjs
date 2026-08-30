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

export function createCrunchyrollTemporarySaveNameArgument(pageUrl, additionalArgs, quoteChar) {
    const watchId = getCrunchyrollWatchId(pageUrl);
    if (!watchId || /(?:^|\s)--save-name(?:\s+|=)/.test(String(additionalArgs || ''))) {
        return '';
    }
    return `--save-name "crunchyroll-${watchId}-\${mediafab_download_marker:t}"`;
}

export function resolveLPMAEGDetailLink(config, pageUrl = '') {
    return config.detailLink || getBroadwayHDDetailLink(pageUrl);
}

export function resolveMMEDetailLink(config, pageUrl = '') {
    return getCrunchyrollDetailLink(pageUrl) || getDisneyPlusEpisodeDetailLink(pageUrl) || config.detailLink;
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

export function createMMEHandoffCommand(config, outputDirectory, pageUrl = '') {
    const launcherPath = `${config.projectFolder.replace(/[\\/]+$/, '')}/Launchers/media_metadata_and_extras_getter.py`;
    const mediaFolder = (getCrunchyrollDetailLink(pageUrl) || getDisneyPlusEpisodeDetailLink(pageUrl))
        ? '"$mediafab_media_file"'
        : shellQuote(outputDirectory);
    return [
        'python3',
        shellQuote(launcherPath),
        '--handoff',
        '--detail-link', shellQuote(resolveMMEDetailLink(config, pageUrl)),
        '--media-folder', mediaFolder,
        '--skip-existing',
    ].join(' ');
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
