export const DEFAULT_BBC_IPLAYER_SETTINGS = Object.freeze({
    projectFolder: '',
    quality: 'sd',
    subtitles: true,
});

const QUALITY_VALUES = new Set(['fhd', 'hd', 'sd', 'web', 'mobile']);

export function normalizeBBCIPlayerSettings(value = {}) {
    return {
        projectFolder: String(value.projectFolder || '').trim(),
        quality: QUALITY_VALUES.has(value.quality) ? value.quality : DEFAULT_BBC_IPLAYER_SETTINGS.quality,
        subtitles: value.subtitles !== false,
    };
}

export function isBBCIPlayerEpisodePage(value) {
    try {
        const url = new URL(value);
        return /(^|\.)bbc\.co\.uk$/i.test(url.hostname)
            && /^\/iplayer\/episode\/[a-z0-9]{8}(?:\/|$)/i.test(url.pathname);
    } catch {
        return false;
    }
}

function shellQuote(value) {
    return `'${String(value).replaceAll("'", "'\"'\"'")}'`;
}

export function buildBBCIPlayerCommand(sourceUrl, destination, settings) {
    const normalized = normalizeBBCIPlayerSettings(settings);
    if (!isBBCIPlayerEpisodePage(sourceUrl)) {
        throw new Error('BBC iPlayer needs an exact /iplayer/episode/ link for this item.');
    }
    if (!normalized.projectFolder.startsWith('/')) {
        throw new Error('Enter iPlayer Media and Extras Getter’s absolute project-folder path.');
    }
    if (!String(destination || '').startsWith('/')) {
        throw new Error('Choose an absolute destination folder.');
    }
    const project = normalized.projectFolder.replace(/\/+$/, '');
    const launcher = `${project}/bbc_iplayer_tool.py`;
    const settingsFile = `${project}/settings.json`;
    return [
        '() {',
        'emulate -L zsh;',
        'local mediafab_bbc_queue;',
        'mediafab_bbc_queue=$(mktemp /tmp/mediafab-bbc-iplayer.XXXXXX);',
        'trap \'rm -f -- "$mediafab_bbc_queue"\' EXIT;',
        `printf '%s\\n' ${shellQuote(sourceUrl)} > "$mediafab_bbc_queue";`,
        'printf \'%s\\n\\n\' \'MediaFab note: Getting BBC iPlayer media...\';',
        // MediaFab Companion recognizes this standard phase marker and then
        // renders the BBC tool's carriage-return percentage updates normally.
        'printf \'%s\\n\' \'Start downloading...Vid\';',
        'python3', shellQuote(launcher),
        '--settings', shellQuote(settingsFile),
        '--output', shellQuote(destination),
        '--quality', shellQuote(normalized.quality),
        normalized.subtitles ? '' : '--no-subtitles',
        '--download', '"$mediafab_bbc_queue";',
        'printf \'\\n%s\\n\' \'MediaFab note: Complete. Output is ready.\';',
        '}',
    ].filter(Boolean).join(' ');
}

export function mountBBCIPlayerSettings(container, settings, onChange) {
    let current = normalizeBBCIPlayerSettings(settings);
    container.replaceChildren();
    const fields = [
        ['text', 'iPlayer Media and Extras Getter Folder', 'projectFolder'],
        ['select', 'Video quality', 'quality'],
        ['checkbox', 'Save BBC subtitles', 'subtitles'],
    ];
    for (const [type, labelText, key] of fields) {
        const wrapper = document.createElement('div');
        wrapper.className = type === 'checkbox' ? 'check-control' : '';
        const label = document.createElement('label');
        label.textContent = labelText;
        let input;
        if (type === 'select') {
            input = document.createElement('select');
            for (const [value, text] of [
                ['fhd', 'Full HD (up to 1080p)'], ['hd', 'HD (up to 720p)'],
                ['sd', 'Standard definition (up to 576p)'], ['web', 'Web (up to 432p)'],
                ['mobile', 'Mobile (up to 288p)'],
            ]) input.add(new Option(text, value));
            input.value = current[key];
        } else {
            input = document.createElement('input');
            input.type = type;
            if (type === 'checkbox') input.checked = current[key];
            else {
                input.value = current[key];
                input.placeholder = '/Users/you/iPlayer Media and Extras Getter';
            }
        }
        input.addEventListener(type === 'text' ? 'input' : 'change', () => {
            current = normalizeBBCIPlayerSettings({
                ...current,
                [key]: type === 'checkbox' ? input.checked : input.value,
            });
            onChange(current);
        });
        if (type === 'checkbox') {
            label.prepend(input, document.createTextNode(' '));
            wrapper.append(label);
        } else {
            wrapper.append(label, input);
        }
        container.append(wrapper);
    }
}
