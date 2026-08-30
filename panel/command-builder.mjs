import {
    createLPMAEGHandoffCommand,
    createMMEHandoffCommand,
    createCrunchyrollDownloadMarkerCommand,
    createCrunchyrollMediaResolutionCommand,
    createCrunchyrollTemporarySaveNameArgument,
    getCrunchyrollDetailLink,
} from './metadata-links.mjs';

export function formatHeaders(headers, option, quoteChar, safeQuoteChar) {
    return Object.entries(headers || {}).map(
        ([key, value]) => `${option} ${quoteChar}${key}: ${String(value).replaceAll(quoteChar, safeQuoteChar)}${quoteChar}`
    ).join(' ');
}

export function getOutputDirectory(additionalArgs) {
    const saveDirMatch = String(additionalArgs || '').match(
        /(?:^|\s)--save-dir(?:\s+|=)(?:"([^"]+)"|'([^']+)'|(\S+))/
    );
    return saveDirMatch ? (saveDirMatch[1] || saveDirMatch[2] || saveDirMatch[3]) : '.';
}

export function removeIncompatibleHlsVideoSelector(additionalArgs) {
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

export function filterExternalSubtitlesByLanguage(subtitles, language = '') {
    const wanted = normalizeSubtitleLanguage(language);
    if (!wanted) {
        return [...(subtitles || [])];
    }
    return (subtitles || [])
        .filter((subtitle) => {
            const actual = getSubtitleLanguage(subtitle);
            return actual === wanted || actual.startsWith(`${wanted}-`);
        })
        .map((subtitle) => ({ ...subtitle, language: wanted }));
}

export function getSelectedSubtitleLanguage(additionalArguments = '') {
    const match = String(additionalArguments).match(
        /(?:^|\s)(?:-ss|--select-subtitle)(?:\s+|=)(?:"([^"]*)"|'([^']*)'|(\S+))/i
    );
    const selector = match ? (match[1] || match[2] || match[3] || '') : '';
    const languageMatch = selector.match(/(?:^|:)lang=([a-z]{2,3}(?:[-_][a-z0-9]{2,8})?)(?::|$)/i);
    return languageMatch ? normalizeSubtitleLanguage(languageMatch[1]) : '';
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

function isSubtitlePlaylistUrl(value) {
    return /\.m3u8(?:[?#]|$)/i.test(value || '');
}

function isSubtitleAssetUrl(value) {
    return isSubtitleFileUrl(value) || isSubtitlePlaylistUrl(value);
}

function formatFfmpegHeaders(headers) {
    const lines = Object.entries(headers || {})
        .filter(([key, value]) => key && value != null)
        .map(([key, value]) => `${key}: ${String(value)}`);
    if (lines.length === 0) {
        return '';
    }
    const escaped = `${lines.join('\r\n')}\r\n`
        .replaceAll('\\', '\\\\')
        .replaceAll("'", "\\'")
        .replaceAll('\r', '\\r')
        .replaceAll('\n', '\\n');
    return `-headers $'${escaped}'`;
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
    if (subtitle.playlist || isSubtitlePlaylistUrl(subtitle.url)) {
        return 200;
    }
    if (subtitle.observedDirectly) {
        return 100;
    }
    return /\.(?:vtt|webvtt)(?:[?#]|$)/i.test(subtitle.url) ? 10
        : /\.srt(?:[?#]|$)/i.test(subtitle.url) ? 9
            : 0;
}

function getUniqueSubtitleFiles(subtitles) {
    const directlyObservedLanguages = new Set((subtitles || [])
        .filter((subtitle) => subtitle?.observedDirectly && subtitle?.contentIdentity)
        .map((subtitle) => getSubtitleLanguage(subtitle)));
    const selected = new Map();
    for (const subtitle of subtitles || []) {
        if (!subtitle?.url || !isSubtitleAssetUrl(subtitle.url)) {
            continue;
        }
        if (!subtitle.observedDirectly
            && directlyObservedLanguages.has(getSubtitleLanguage(subtitle))) {
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
        const ffmpegHeaders = /^https?:/i.test(subtitle.url)
            ? formatFfmpegHeaders(subtitle.headers)
            : '';
        const sourceIsSrt = /\.srt(?:[?#]|$)/i.test(subtitle.url);
        const sourceIsPlaylist = subtitle.playlist || isSubtitlePlaylistUrl(subtitle.url);
        const curlCommand = [
            'curl --fail --location --silent --show-error --connect-timeout 20 --max-time 120',
            headers,
            `--output ${quoteChar}${sourceIsSrt ? outputFile : temporaryFile}${quoteChar}`,
            `${quoteChar}${subtitle.url}${quoteChar}`,
        ].filter(Boolean).join(' ');
        const downloadCommand = sourceIsPlaylist
            ? [
                'ffmpeg -hide_banner -loglevel error -nostats -y',
                ffmpegHeaders,
                '-allowed_extensions ALL',
                `-i ${quoteChar}${subtitle.url}${quoteChar}`,
                `${quoteChar}${outputFile}${quoteChar}`,
            ].filter(Boolean).join(' ')
            : [
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
    return subtitleCount === 0
        ? ''
        : `if (( \${mediafab_subtitle_failures:-0} == 0 )); then printf '%s\\n\\n' ${quoteChar}MediaFab note: subtitle(s) completed downloading.${quoteChar}; else printf '%s\\n\\n' ${quoteChar}MediaFab warning: \${mediafab_subtitle_failures} separately captured subtitle(s) failed; metadata processing will continue.${quoteChar}; fi`;
}

export function createSubtitleRetentionCommand(subtitleNames, outputDirectory, quoteChar = '"') {
    const groups = new Map();
    for (const name of subtitleNames) {
        const canonicalName = name.replace(/\.\d{2}(?=\.srt$)/i, '');
        if (!groups.has(canonicalName)) {
            groups.set(canonicalName, []);
        }
        groups.get(canonicalName).push(name);
    }
    const commands = [];
    for (const [canonicalName, names] of groups) {
        const serializedNames = names.map((name) => `${quoteChar}${name}${quoteChar}`).join(' ');
        commands.push([
            '() {',
            'emulate -L zsh;',
            `local mediafab_output_dir=${quoteChar}${outputDirectory}${quoteChar};`,
            `local mediafab_canonical=${quoteChar}${canonicalName}${quoteChar};`,
            `local -a mediafab_candidates=(${serializedNames});`,
            'local mediafab_name mediafab_file mediafab_keep="" mediafab_cues=0 mediafab_max_cues=-1;',
            'for mediafab_name in "${mediafab_candidates[@]}"; do',
            'mediafab_file="${mediafab_output_dir}/${mediafab_name}";',
            '[[ -f "$mediafab_file" ]] || continue;',
            'mediafab_cues=$(grep -c -- "-->" "$mediafab_file" 2>/dev/null || printf 0);',
            'if (( mediafab_cues > mediafab_max_cues )); then mediafab_keep="$mediafab_file"; mediafab_max_cues=$mediafab_cues; fi;',
            'done;',
            'if [[ -n "$mediafab_keep" ]] && (( mediafab_max_cues >= 100 )); then',
            'for mediafab_name in "${mediafab_candidates[@]}"; do mediafab_file="${mediafab_output_dir}/${mediafab_name}"; [[ "$mediafab_file" == "$mediafab_keep" ]] || rm -f -- "$mediafab_file"; done;',
            'mediafab_file="${mediafab_output_dir}/${mediafab_canonical}";',
            'if [[ "$mediafab_keep" != "$mediafab_file" ]]; then rm -f -- "$mediafab_file"; mv -- "$mediafab_keep" "$mediafab_file"; fi;',
            'else',
            'for mediafab_name in "${mediafab_candidates[@]}"; do rm -f -- "${mediafab_output_dir}/${mediafab_name}"; done;',
            'fi;',
            '}',
        ].join(' '));
    }
    return commands.join(' && ');
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

function createMetadataStartCommand(type, config, quoteChar) {
    if (!config.enabled) {
        return '';
    }
    const message = type === 'lpmaeg'
        ? 'MediaFab note: Downloading your metadata and extras...'
        : 'MediaFab note: Downloading your media metadata and extras...';
    return `printf '%s\\n\\n' ${quoteChar}${message}${quoteChar}`;
}

export function buildNormalMediaCommand({
    metadata,
    keyString = '',
    useSingleQuotes = false,
    executableName = 'N_m3u8DL-RE',
    useShakaPackager = true,
    additionalArguments = '',
    metadataGetterType = 'lpmaeg',
    metadataGetterConfig = { enabled: false, detailLink: '', projectFolder: '' },
    outputDirectory = null,
}) {
    const quoteChar = useSingleQuotes ? "'" : '"';
    const safeQuoteChar = useSingleQuotes ? '"' : "'";
    const headerString = formatHeaders(metadata.headers, '-H', quoteChar, safeQuoteChar);
    let commandArgs = metadata.isHlsPlaylistFallback
        ? removeIncompatibleHlsVideoSelector(additionalArguments)
        : additionalArguments;
    const requestedSubtitleLanguage = getSelectedSubtitleLanguage(commandArgs);
    const subtitles = requestedSubtitleLanguage
        ? filterExternalSubtitlesByLanguage(metadata.subtitles || [], requestedSubtitleLanguage)
        : (metadata.subtitles || []);
    const selectedExternalSubtitles = getUniqueSubtitleFiles(subtitles);
    if (selectedExternalSubtitles.length > 0) {
        commandArgs = String(commandArgs)
            .replace(/(?:^|\s)(?:-ss|--select-subtitle|--drop-subtitle|-ds)(?:\s+|=)(?:"[^"]*"|'[^']*'|\S+)/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();
        commandArgs = `${commandArgs} -ds all`.trim();
    }
    const resolvedOutputDirectory = outputDirectory || getOutputDirectory(commandArgs);
    const usesAutomaticCrunchyrollHandoff = metadataGetterConfig.enabled
        && metadataGetterType === 'mme'
        && Boolean(getCrunchyrollDetailLink(metadata.pageUrl));
    const usesResolvedMMEHandoff = metadataGetterConfig.enabled
        && metadataGetterType === 'mme';
    const temporarySaveNameArgument = usesAutomaticCrunchyrollHandoff
        ? createCrunchyrollTemporarySaveNameArgument(metadata.pageUrl, commandArgs, quoteChar)
        : '';
    const videoCommand = [
        executableName,
        `${quoteChar}${metadata.url}${quoteChar}`,
        headerString,
        keyString,
        !metadata.isPublicMedia && useShakaPackager ? '--use-shaka-packager' : '',
        temporarySaveNameArgument,
        commandArgs,
    ].filter(Boolean).join(' ');
    const subtitleCommands = createExternalSubtitleCommands(
        subtitles,
        resolvedOutputDirectory,
        quoteChar,
        safeQuoteChar,
    );
    const subtitleCount = subtitleCommands.length;
    const subtitleNames = getSubtitleSidecarNames(subtitles);
    const metadataHandoff = metadataGetterConfig.enabled
        ? (metadataGetterType === 'lpmaeg'
            ? createLPMAEGHandoffCommand(metadataGetterConfig, resolvedOutputDirectory, metadata.pageUrl)
            : createMMEHandoffCommand(metadataGetterConfig, resolvedOutputDirectory, metadata.pageUrl))
        : '';
    const command = [
        usesResolvedMMEHandoff ? createCrunchyrollDownloadMarkerCommand(resolvedOutputDirectory) : '',
        videoCommand,
        usesResolvedMMEHandoff ? createCrunchyrollMediaResolutionCommand(resolvedOutputDirectory) : '',
        createSubtitleStatusCommand(subtitleCount, quoteChar),
        subtitleCommands.length > 0 ? 'mediafab_subtitle_failures=0' : '',
        subtitleCommands.length > 0 ? createSubtitleSpinnerFunction() : '',
        ...subtitleCommands,
        createSubtitleCompletionCommand(subtitleCount, quoteChar),
        createSubtitleRetentionCommand(subtitleNames, resolvedOutputDirectory, quoteChar),
        createSubtitleSidecarNamingCommand(
            subtitleNames,
            resolvedOutputDirectory,
            quoteChar,
            usesResolvedMMEHandoff,
        ),
        createWorkDirectoryCleanupCommand(resolvedOutputDirectory, quoteChar),
        createMetadataStartCommand(metadataGetterType, metadataGetterConfig, quoteChar),
        metadataHandoff,
        createCompletionCommand(quoteChar),
    ].filter(Boolean).join(' && ');
    return usesResolvedMMEHandoff
        ? `() { emulate -L zsh; ${command} }`
        : command;
}
