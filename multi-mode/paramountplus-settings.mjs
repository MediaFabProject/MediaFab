export const DEFAULT_PARAMOUNTPLUS_SETTINGS = Object.freeze({
    quality: '1080', range: 'SDR', bestAvailable: true,
    videoCodec: '', audioCodec: '', videoBitrate: '', audioBitrate: '',
    videoBitrateRange: '', audioBitrateRange: '', channels: '', noAtmos: false,
    language: 'orig', videoLanguage: '', audioLanguage: '', subtitleLanguage: 'en',
    requireAudio: '', requireVideo: '', requireSubtitles: '', exactLanguage: false,
    forcedSubtitles: false, forcedSubtitleLanguage: '', subtitleFormat: '',
    wanted: '', latestEpisode: false, splitAudio: false, mergeVideo: false,
    noSubtitles: false, skipSubtitleErrors: false, noAudio: false,
    noChapters: false, noVideo: false, noAttachments: false,
    audioDescription: false, noProxyDownload: false, noFolder: false,
    noSource: false, repack: false, realVideoBitrate: false,
    realAudioBitrate: false, workers: '', adaptiveWorkers: false,
    downloadProcesses: '1', downloads: '1', continueDownloads: false,
    speedLimit: '', slow: '', tag: '',
});

export function normalizeParamountPlusSettings(value = {}) {
    const merged = { ...DEFAULT_PARAMOUNTPLUS_SETTINGS, ...(value || {}) };
    for (const key of Object.keys(DEFAULT_PARAMOUNTPLUS_SETTINGS)) {
        merged[key] = typeof DEFAULT_PARAMOUNTPLUS_SETTINGS[key] === 'boolean'
            ? merged[key] === true : String(merged[key] ?? '').trim();
    }
    return merged;
}

function addValue(args, flag, value) {
    if (String(value || '').trim()) args.push(flag, String(value).trim());
}

export function buildParamountPlusArguments(value = {}) {
    const s = normalizeParamountPlusSettings(value);
    const args = [];
    for (const [key, flag] of [
        ['quality','--quality'], ['range','--range'], ['videoCodec','--vcodec'], ['audioCodec','--acodec'],
        ['videoBitrate','--vbitrate'], ['audioBitrate','--abitrate'], ['videoBitrateRange','--vbitrate-range'],
        ['audioBitrateRange','--abitrate-range'], ['channels','--channels'], ['language','--lang'],
        ['videoLanguage','--v-lang'], ['audioLanguage','--a-lang'], ['subtitleLanguage','--s-lang'],
        ['requireAudio','--require-audio'], ['requireVideo','--require-video'], ['requireSubtitles','--require-subs'],
        ['forcedSubtitleLanguage','--forced-s-lang'], ['subtitleFormat','--sub-format'], ['wanted','--wanted'],
        ['workers','--workers'], ['downloadProcesses','--download-processes'], ['downloads','--downloads'],
        ['speedLimit','--speed-limit'], ['slow','--slow'], ['tag','--tag'],
    ]) addValue(args, flag, s[key]);
    for (const [key, flag] of Object.entries({
        bestAvailable:'--best-available', noAtmos:'--noatmos', exactLanguage:'--exact-lang',
        forcedSubtitles:'--forced-subs', latestEpisode:'--latest-episode', splitAudio:'--split-audio',
        mergeVideo:'--merge-video', noSubtitles:'--no-subs', skipSubtitleErrors:'--skip-subtitle-errors',
        noAudio:'--no-audio', noChapters:'--no-chapters', noVideo:'--no-video', noAttachments:'--no-attachments',
        audioDescription:'--audio-description', noProxyDownload:'--no-proxy-download', noFolder:'--no-folder',
        noSource:'--no-source', repack:'--repack', realVideoBitrate:'--real-video-bitrate',
        realAudioBitrate:'--real-audio-bitrate', adaptiveWorkers:'--adaptive-workers',
        continueDownloads:'--continue-downloads',
    })) if (s[key]) args.push(flag);
    return args;
}

export function isParamountPlusPage(value) {
    try {
        const url = new URL(value);
        return /(^|\.)paramountplus\.com$/i.test(url.hostname) && /^\/(?:shows|movies)\//i.test(url.pathname);
    } catch { return false; }
}

export function getParamountPlusPageTitle(value, documentTitle = '') {
    try {
        const url = new URL(value);
        const parts = url.pathname.split('/').filter(Boolean);
        const marker = parts.findIndex((part) => ['shows', 'movies'].includes(part.toLowerCase()));
        const slug = marker >= 0 ? parts[marker + 1] : '';
        if (!slug || slug.toLowerCase() === 'video') {
            const pageTitle = String(documentTitle || '')
                .replace(/\s*[|–—-]\s*(?:watch\s+.*?\s+(?:on\s+)?)?paramount(?:\+|\s+plus).*$/i, '')
                .trim();
            if (pageTitle && !/^paramount(?:\+|\s+plus)$/i.test(pageTitle)) return pageTitle;
            return parts[marker]?.toLowerCase() === 'movies' ? 'Paramount+ Movie' : 'Paramount+';
        }
        return String(slug || 'Paramount+')
            .split('-').filter(Boolean)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    } catch { return 'Paramount+'; }
}

const SELECTS = [
    ['quality','Video quality',[['2160','2160p'],['1080','1080p'],['720','720p'],['','Best available resolution']]],
    ['range','Video range',[['SDR','SDR'],['HDR10','HDR10'],['DV','Dolby Vision'],['HDR10,SDR','HDR10 + SDR'],['DV,HDR10,SDR','DV + HDR10 + SDR']]],
    ['videoCodec','Video codec',[['','Any'],['H.264','H.264'],['H.265','H.265']]],
    ['audioCodec','Audio codec',[['','Any'],['AAC','AAC'],['EC3','Dolby Digital Plus'],['AAC,EC3','AAC + Dolby Digital Plus']]],
    ['subtitleFormat','Subtitle format',[['','Source/default'],['original','Original'],['SRT','SRT'],['VTT','VTT']]],
];
const TEXTS = [
    ['language','Video/audio languages','orig'], ['videoLanguage','Video language override',''],
    ['audioLanguage','Audio language override',''], ['subtitleLanguage','Subtitle languages','en'],
    ['wanted','Episodes/seasons wanted (blank = all)','S01-S03 or S01E01-S02E03'],
    ['channels','Audio channels','e.g. 2 or 5.1'], ['videoBitrate','Video bitrate kbps',''],
    ['audioBitrate','Audio bitrate kbps',''], ['videoBitrateRange','Video bitrate range','6000-7000'],
    ['audioBitrateRange','Audio bitrate range','128-256'], ['requireAudio','Required audio languages',''],
    ['requireVideo','Required video languages',''], ['requireSubtitles','Required subtitle languages',''],
    ['forcedSubtitleLanguage','Forced subtitle languages',''], ['workers','Workers',''],
    ['downloadProcesses','Download processes','1'], ['downloads','Concurrent tracks','1'],
    ['speedLimit','Speed limit','e.g. 5M or off'], ['slow','Delay between titles','e.g. 20-40'], ['tag','Filename group tag',''],
];
const CHECKS = [
    ['bestAvailable','Use best available when an exact choice is unavailable'], ['latestEpisode','Only the latest episode'],
    ['forcedSubtitles','Include forced subtitles'], ['exactLanguage','Require exact language variants'],
    ['noAtmos','Exclude Dolby Atmos'], ['audioDescription','Include audio-description tracks'],
    ['splitAudio','Separate file per audio codec'], ['mergeVideo','Mux selected video tracks together'],
    ['noSubtitles','Do not download subtitles'], ['skipSubtitleErrors','Continue after subtitle errors'],
    ['noAudio','Do not download audio'], ['noVideo','Do not download video'], ['noChapters','Do not download chapters'],
    ['noAttachments','Do not download/mux artwork and attachments'], ['realVideoBitrate','Probe actual video bitrate'],
    ['realAudioBitrate','Probe actual audio bitrate'], ['adaptiveWorkers','Adaptive workers'],
    ['continueDownloads','Resume incomplete downloads'], ['noProxyDownload','Use proxy only for authentication/licensing'],
    ['noFolder','Do not create show folders'], ['noSource','Do not add source tag'], ['repack','Add REPACK tag'],
];

const TYPICAL_SELECTS = new Set(['quality', 'range', 'videoCodec', 'audioCodec']);
const TYPICAL_TEXTS = new Set(['language', 'subtitleLanguage', 'wanted']);
const TYPICAL_CHECKS = new Set([
    'bestAvailable', 'latestEpisode', 'noAtmos', 'noSubtitles', 'continueDownloads',
]);

export function mountParamountPlusSettings(container, initial, onChange, { hiddenKeys = [] } = {}) {
    container.replaceChildren();
    const settings = normalizeParamountPlusSettings(initial);
    const hidden = new Set(hiddenKeys);
    const typicalGrid = document.createElement('div'); typicalGrid.className = 'option-grid paramountplus-option-grid';
    const advancedGrid = document.createElement('div'); advancedGrid.className = 'option-grid paramountplus-option-grid';
    for (const [key, label, options] of SELECTS) {
        if (hidden.has(key)) continue;
        const box = document.createElement('div'); const l = document.createElement('label'); l.textContent = label;
        const input = document.createElement('select'); input.dataset.paramountplusSetting = key;
        for (const [value, text] of options) { const o = document.createElement('option'); o.value = value; o.textContent = text; input.append(o); }
        input.value = settings[key]; box.append(l, input);
        (TYPICAL_SELECTS.has(key) ? typicalGrid : advancedGrid).append(box);
    }
    for (const [key, label, placeholder] of TEXTS) {
        if (hidden.has(key)) continue;
        const box = document.createElement('div'); const l = document.createElement('label'); l.textContent = label;
        const input = document.createElement('input'); input.type = 'text'; input.placeholder = placeholder; input.value = settings[key]; input.dataset.paramountplusSetting = key;
        box.append(l, input);
        (TYPICAL_TEXTS.has(key) ? typicalGrid : advancedGrid).append(box);
    }
    const typicalChecks = document.createElement('div'); typicalChecks.className = 'check-grid paramountplus-check-grid';
    const advancedChecks = document.createElement('div'); advancedChecks.className = 'check-grid paramountplus-check-grid';
    for (const [key, label] of CHECKS) {
        if (hidden.has(key)) continue;
        const l = document.createElement('label'); l.className = 'check-control'; const input = document.createElement('input');
        input.type = 'checkbox'; input.checked = settings[key]; input.dataset.paramountplusSetting = key;
        l.append(input, document.createTextNode(` ${label}`));
        (TYPICAL_CHECKS.has(key) ? typicalChecks : advancedChecks).append(l);
    }
    const advanced = document.createElement('div');
    advanced.className = 'paramountplus-advanced-settings';
    advanced.hidden = true;
    advanced.append(advancedGrid, advancedChecks);
    const advancedButton = document.createElement('button');
    advancedButton.type = 'button';
    advancedButton.className = 'secondary paramountplus-advanced-toggle';
    advancedButton.textContent = 'Advanced';
    advancedButton.setAttribute('aria-expanded', 'false');
    advancedButton.addEventListener('click', () => {
        advanced.hidden = !advanced.hidden;
        advancedButton.textContent = advanced.hidden ? 'Advanced' : 'Hide Advanced';
        advancedButton.setAttribute('aria-expanded', String(!advanced.hidden));
    });
    container.append(typicalGrid, typicalChecks, advancedButton, advanced);
    const emit = () => {
        const next = { ...settings };
        for (const input of container.querySelectorAll('[data-paramountplus-setting]')) {
            next[input.dataset.paramountplusSetting] = input.type === 'checkbox' ? input.checked : input.value;
        }
        onChange(normalizeParamountPlusSettings(next));
    };
    container.addEventListener('input', emit); container.addEventListener('change', emit);
}
