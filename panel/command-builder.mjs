import {
    createLPMAEGHandoffCommand,
    createMMEHandoffCommand,
    createCrunchyrollDownloadMarkerCommand,
    createCrunchyrollMediaResolutionCommand,
    createProviderIdentitySaveNameArgument,
    getMMEProviderIdentity,
    removeSaveNameArgument,
} from './metadata-links.mjs';

export function quoteCommandValue(value, useSingleQuotes = false) {
    const text = String(value);
    if (useSingleQuotes) {
        return `'${text.replaceAll("'", "'\"'\"'")}'`;
    }
    return `"${text
        .replaceAll('\\', '\\\\')
        .replaceAll('"', '\\"')
        .replaceAll('$', '\\$')
        .replaceAll('`', '\\`')}"`;
}

export function formatHeaders(headers, option, quoteChar, _safeQuoteChar) {
    const useSingleQuotes = quoteChar === "'";
    return Object.entries(headers || {}).map(
        ([key, value]) => `${option} ${quoteCommandValue(`${key}: ${value}`, useSingleQuotes)}`
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

export function useBestAvailableHlsVideoSelector(additionalArgs) {
    return `${removeIncompatibleHlsVideoSelector(additionalArgs)} -sv best`.trim();
}

function isMaxPage(value) {
    try {
        return /(^|\.)(?:max\.com|hbomax\.com)$/i.test(new URL(value).hostname);
    } catch {
        return false;
    }
}

function isDisneyPlusPage(value) {
    try {
        return /(^|\.)disneyplus\.com$/i.test(new URL(value).hostname);
    } catch {
        return false;
    }
}

function isCrunchyrollPage(value) {
    try {
        return /(^|\.)crunchyroll\.com$/i.test(new URL(value).hostname);
    } catch {
        return false;
    }
}

function isHlsManifest(metadata) {
    return /^HLS_/i.test(String(metadata?.type || ''))
        || /\.m3u8(?:[?#]|$)/i.test(String(metadata?.url || ''));
}

function normalizedKeyId(value) {
    return String(value || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
}

function capturedKeyIds(keyString) {
    return new Set([...String(keyString || '').matchAll(/--key\s+([a-f0-9-]+):/gi)]
        .map((match) => normalizedKeyId(match[1]))
        .filter(Boolean));
}

function removeDownloaderSelectors(argumentsText, options) {
    const names = options.join('|');
    return String(argumentsText || '')
        .replace(new RegExp(`(?:^|\\s)(?:${names})(?:\\s+|=)(?:"[^"]*"|'[^']*'|\\S+)`, 'gi'), ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

function maxRequestedVideoWidth(argumentsText) {
    const selector = String(argumentsText || '').match(
        /(?:^|\s)(?:-sv|--select-video)(?:\s+|=)(?:"([^"]*)"|'([^']*)'|(\S+))/i,
    );
    const value = selector ? (selector[1] || selector[2] || selector[3] || '') : '';
    return Number(value.match(/(?:^|:)res=(\d+)/i)?.[1]) || Number.POSITIVE_INFINITY;
}

function maxRequestedAudioLanguage(argumentsText) {
    const selector = String(argumentsText || '').match(
        /(?:^|\s)(?:-sa|--select-audio)(?:\s+|=)(?:"([^"]*)"|'([^']*)'|(\S+))/i,
    );
    const value = selector ? (selector[1] || selector[2] || selector[3] || '') : '';
    return value.match(/(?:^|:)lang=([a-z]{2,3}(?:-[a-z0-9]+)?)/i)?.[1]?.toLowerCase() || '';
}

export function createMaxTrackArguments(metadata, keyString, additionalArguments, useSingleQuotes = false) {
    if (!isMaxPage(metadata?.pageUrl)) {
        return { arguments: additionalArguments, error: '' };
    }
    const periodId = String(metadata.maxContentPeriodId || '');
    const keys = capturedKeyIds(keyString);
    if (!periodId || keys.size === 0) {
        return {
            arguments: additionalArguments,
            error: 'Max programme keys and its protected content period have not been paired yet. Restart this title from its Play action and wait for the protected capture.',
        };
    }

    const requestedWidth = maxRequestedVideoWidth(additionalArguments);
    const videoTracks = (metadata.maxVideoTracks || [])
        .filter((track) => keys.has(normalizedKeyId(track.keyId)) && Number(track.width) > 0)
        .sort((left, right) => Number(right.width) - Number(left.width));
    const videoTrack = videoTracks.find((track) => Number(track.width) <= requestedWidth)
        || videoTracks[videoTracks.length - 1];
    if (!videoTrack) {
        return {
            arguments: additionalArguments,
            error: 'Max returned audio keys but no key for any programme video tier. Restart playback so MediaFab can capture the matching video key.',
        };
    }

    const audioDisabled = /(?:^|\s)(?:-da|--drop-audio)(?:\s+|=)(?:["']?all["']?)(?=\s|$)/i.test(additionalArguments);
    const requestedLanguage = maxRequestedAudioLanguage(additionalArguments);
    let audioTracks = (metadata.maxAudioTracks || []).filter((track) =>
        !track.descriptive && keys.has(normalizedKeyId(track.keyId))
    );
    if (requestedLanguage) {
        const matchingLanguage = audioTracks.filter((track) =>
            String(track.language || '').toLowerCase().startsWith(requestedLanguage)
        );
        if (matchingLanguage.length > 0) {
            audioTracks = matchingLanguage;
        }
    }
    const audioTrack = audioTracks[0];
    if (!audioDisabled && !audioTrack) {
        return {
            arguments: additionalArguments,
            error: 'Max did not provide a keyed normal audio track for the protected programme.',
        };
    }

    let rewritten = removeDownloaderSelectors(additionalArguments, [
        '-sv', '--select-video', '-sa', '--select-audio', '-da', '--drop-audio',
    ]);
    const periodPattern = `^${periodId.replace(/[^a-z0-9_-]/gi, '')}$`;
    const videoSelector = `period=${periodPattern}:res=^${Number(videoTrack.width)}x:for=best`;
    rewritten = `${rewritten} -sv ${quoteCommandValue(videoSelector, useSingleQuotes)}`.trim();
    if (audioDisabled) {
        rewritten = `${rewritten} -da all`;
    } else {
        const ids = audioTrack.representationIds
            .map((id) => String(id).replace(/[^a-z0-9_-]/gi, ''))
            .filter(Boolean);
        const audioSelector = `period=${periodPattern}:id=^(${ids.join('|')})$:for=best`;
        rewritten = `${rewritten} -sa ${quoteCommandValue(audioSelector, useSingleQuotes)}`;
    }
    return { arguments: rewritten.trim(), error: '' };
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

export function createCrunchyrollTimelineCorrectionCommand() {
    return [
        '() {',
        'emulate -L zsh;',
        'local mediafab_video_pts mediafab_audio_pts mediafab_video_offset mediafab_extension mediafab_corrected;',
        'mediafab_video_pts=$(ffprobe -v error -select_streams v:0 -read_intervals \'%+#1\' -show_entries packet=pts_time -of csv=p=0 "$mediafab_media_file" | sed -n \'1p\');',
        'mediafab_audio_pts=$(ffprobe -v error -select_streams a:0 -read_intervals \'%+#1\' -show_entries packet=pts_time -of csv=p=0 "$mediafab_media_file" | sed -n \'1p\');',
        '[[ "$mediafab_video_pts" == <->(|.<->) && "$mediafab_audio_pts" == <->(|.<->) ]] || return 0;',
        'awk -v video="$mediafab_video_pts" -v audio="$mediafab_audio_pts" \'BEGIN { difference = video - audio; if (difference < 0) difference = -difference; exit !(difference >= 0.250 && difference <= 30.000) }\' || return 0;',
        'mediafab_video_offset=$(awk -v video="$mediafab_video_pts" -v audio="$mediafab_audio_pts" \'BEGIN { printf "%.6f", audio - video }\');',
        'mediafab_extension="${mediafab_media_file:e:l}";',
        '[[ "$mediafab_extension" == (mkv|mp4|mov|m4v) ]] || return 0;',
        'mediafab_corrected=$(mktemp "${mediafab_media_file:h}/.mediafab-sync.XXXXXX.${mediafab_extension}") || return 1;',
        'if ffmpeg -hide_banner -loglevel error -nostats -y -itsoffset "$mediafab_video_offset" -i "$mediafab_media_file" -i "$mediafab_media_file" -map 0:v -map \'1:a?\' -map \'1:s?\' -map \'1:d?\' -map \'1:t?\' -map_metadata 1 -map_chapters 1 -c copy -avoid_negative_ts disabled "$mediafab_corrected"; then',
        'mv -- "$mediafab_corrected" "$mediafab_media_file";',
        'else',
        'rm -f -- "$mediafab_corrected";',
        'return 1;',
        'fi;',
        '}',
    ].join(' ');
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
    const useBestAvailableHlsVideo = metadata.isHlsPlaylistFallback
        || (isDisneyPlusPage(metadata.pageUrl) && isHlsManifest(metadata));
    let commandArgs = useBestAvailableHlsVideo
        ? useBestAvailableHlsVideoSelector(additionalArguments)
        : additionalArguments;
    const maxTrackSelection = createMaxTrackArguments(metadata, keyString, commandArgs, useSingleQuotes);
    if (maxTrackSelection.error) {
        return `MediaFab command unavailable: ${maxTrackSelection.error}`;
    }
    commandArgs = maxTrackSelection.arguments;
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
    const usesResolvedMMEHandoff = metadataGetterConfig.enabled && metadataGetterType === 'mme';
    const needsResolvedMediaFile = usesResolvedMMEHandoff || isCrunchyrollPage(metadata.pageUrl);
    const providerIdentity = usesResolvedMMEHandoff
        ? getMMEProviderIdentity(metadata.pageUrl, metadata.amazonEpisodeDetailUrl)
        : null;
    if (providerIdentity) {
        commandArgs = removeSaveNameArgument(commandArgs);
    }
    const temporarySaveNameArgument = providerIdentity
        ? createProviderIdentitySaveNameArgument(metadata.pageUrl, metadata.amazonEpisodeDetailUrl)
        : '';
    const videoCommand = [
        executableName,
        quoteCommandValue(metadata.url, useSingleQuotes),
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
            : createMMEHandoffCommand(
                metadataGetterConfig,
                resolvedOutputDirectory,
                metadata.pageUrl,
                metadata.amazonEpisodeDetailUrl,
            ))
        : '';
    const command = [
        needsResolvedMediaFile ? createCrunchyrollDownloadMarkerCommand(resolvedOutputDirectory) : '',
        videoCommand,
        needsResolvedMediaFile ? createCrunchyrollMediaResolutionCommand(resolvedOutputDirectory) : '',
        isCrunchyrollPage(metadata.pageUrl) ? createCrunchyrollTimelineCorrectionCommand() : '',
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
    return needsResolvedMediaFile
        ? `() { emulate -L zsh; ${command} }`
        : command;
}
