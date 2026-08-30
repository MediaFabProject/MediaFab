import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../panel/panel.html', import.meta.url), 'utf8');
const queue = readFileSync(new URL('../multi-mode/index.html', import.meta.url), 'utf8');
const queueCss = readFileSync(new URL('../multi-mode/mediafab-queue-theme.css', import.meta.url), 'utf8');
const panelCss = readFileSync(new URL('../panel/mediafab-theme.css', import.meta.url), 'utf8');
const background = readFileSync(new URL('../background.js', import.meta.url), 'utf8');
const util = readFileSync(new URL('../lib/util.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const originalReadme = readFileSync(new URL('../original-readme.md', import.meta.url), 'utf8');
const statusBadge = readFileSync(new URL('../images/badges/status-garden.svg', import.meta.url), 'utf8');

test('MediaFab is the visible extension name and normal Companion settings follow metadata', () => {
    assert.equal(manifest.name, 'MediaFab');
    assert.match(panel, /<title>MediaFab<\/title>/);
    assert.ok(panel.indexOf('Metadata and Extras Getter') < panel.indexOf('Optional Companion'));
    assert.match(panel, /id="mediafab-companion-enabled"/);
    assert.match(panel, /id="mediafab-companion-project-folder"/);
    assert.match(panel, /id="mediafab-companion-destination"/);
});

test('MediaFab uses its own permanent Firefox identity', () => {
    assert.equal(manifest.browser_specific_settings.gecko.id, 'mediafab@mediafab');
});

test('MediaFab branding is shared by the README, popup, Queue Mode, and manifest', () => {
    assert.match(readme, /images\/mediafab-logo-green-lavender-light\.png/);
    assert.match(panel, /images\/mediafab-icon-green-lavender-light-128\.png/);
    assert.match(queue, /images\/mediafab-icon-green-lavender-light-128\.png/);
    assert.equal(manifest.icons['128'], 'images/mediafab-icon-green-lavender-light-128.png');
    assert.equal(manifest.action.default_icon['128'], 'images/mediafab-icon-green-lavender-light-128.png');
    assert.deepEqual(manifest.action.theme_icons, [
        {
            light: 'images/mediafab-icon-green-lavender-light-16.png',
            dark: 'images/mediafab-icon-green-lavender-light-16.png',
            size: 16,
        },
        {
            light: 'images/mediafab-icon-green-lavender-light-32.png',
            dark: 'images/mediafab-icon-green-lavender-light-32.png',
            size: 32,
        },
    ]);
    assert.match(panel, /rel="icon"[^>]+mediafab-favicon-green-lavender-light-32\.png/);
    assert.match(queue, /rel="icon"[^>]+mediafab-favicon-green-lavender-light-32\.png/);
    assert.match(panel, /href="mediafab-theme\.css\?v=12"/);
    assert.match(queue, /href="mediafab-queue-theme\.css\?v=15"/);
    assert.equal((util.match(/images\/mediafab-icon-green-lavender-light-16\.png/g) || []).length, 2);
    assert.equal((util.match(/images\/mediafab-icon-green-lavender-light-128\.png/g) || []).length, 2);
    assert.doesNotMatch(util, /images\/legacy-media-(?:toolbar|mark)-/);
});

test('MediaFab uses the green and lavender palette in both light and dark interfaces', () => {
    for (const css of [panelCss, queueCss]) {
        assert.match(css, /--accent: #587958;/);
        assert.match(css, /--lavender: #8e87b4;/);
        assert.match(css, /\.dark-mode \{/);
        assert.match(css, /--accent: #abcca5;/);
        assert.match(css, /--lavender: #be8cc9;/);
        assert.doesNotMatch(css, /#1677e8|#4a9cff|#9c2cff|#009cf2/i);
    }
    assert.match(statusBadge, /#ABCCA5/);
    assert.match(statusBadge, /#C3BAD9/);
    assert.match(statusBadge, /#BE8CC9/);
    assert.match(statusBadge, /#7EA874/);
    assert.match(panelCss, /\.settings-card \{ border-top-color: var\(--lavender\); \}/);
    assert.match(panelCss, /\.device-card \{ background: var\(--sage-surface-gradient\); border-top-color: var\(--sage\); \}/);
    assert.match(panelCss, /--orchid-surface-gradient: linear-gradient/);
    assert.match(queueCss, /\.media-options-card, \.processing-card \{ border-top-color: var\(--orchid\); \}/);
    assert.match(queueCss, /\.catalogue-card, \.metadata-card \{ border-top-color: var\(--lavender\); \}/);
    for (const css of [panelCss, queueCss]) {
        assert.match(css, /Vibrant green-lavender garden depth pass/);
        assert.match(css, /--lavender-surface-gradient: linear-gradient/);
        assert.match(css, /#c588e1/i);
        assert.match(css, /--shadow: 0 1[678]px/);
        assert.match(css, /Liquid glass over a full-palette blotch layer/);
        assert.match(css, /body::before/);
        assert.match(css, /backdrop-filter: blur\(24px\) saturate\(150%\)/);
        assert.match(css, /text-shadow: none/);
    }
});

test('archived README separates current fork additions from the labeled upstream original', () => {
    assert.ok(originalReadme.indexOf('# MediaFab Fork Additions') < originalReadme.indexOf('\n---\n'));
    assert.ok(originalReadme.indexOf('# Original WidevineProxy2 README') > originalReadme.indexOf('\n---\n'));
    assert.ok(originalReadme.indexOf('\n# WidevineProxy2\n') > originalReadme.indexOf('# Original WidevineProxy2 README'));
});

test('main README documents the public workflow without publishing internal development guides', () => {
    assert.match(readme, /How N_m3u8DL-RE Fits Into the Workflow/);
    assert.match(readme, /Protected records have a sparkle icon/);
    assert.match(readme, /A separate public\s+detail link is not needed when using this mode/);
    assert.match(readme, /MediaFab Queue Mode Companion is a separate local application and is not\s+included in this repository/);
    assert.match(readme, /Firefox Temporary Installation/);
    assert.doesNotMatch(readme, /Firefox Persistent Installation/);
    assert.match(readme, /MediaFab has not been tested on Chrome/);
    assert.doesNotMatch(readme, /adapter contract|Companion development guide/);
    assert.equal(existsSync(new URL('../multi-mode/providers/README.md', import.meta.url)), false);
    assert.equal(existsSync(new URL('../MediaFab Queue Mode Companion/README.md', import.meta.url)), false);
});

test('Queue source entry cards are independently collapsible and remembered by script', () => {
    const queueScript = readFileSync(new URL('../multi-mode/multi-mode.js', import.meta.url), 'utf8');
    assert.match(queue, /data-queue-collapsible="series-link"/);
    assert.match(queue, /data-queue-collapsible="episode-links"/);
    assert.match(queue, /Load a Series from a Link Mode/);
    assert.match(queueScript, /seriesPosterUrl/);
    assert.match(queueScript, /episode\.thumbnailUrl/);
    assert.match(queue, /Manual Queue Creation Mode/);
    assert.match(queueScript, /mediafab_queue_section_state/);
    assert.match(queue, /data-queue-collapsible="catalogue"/);
    assert.match(queue, /<h2>Seasons and Episodes<\/h2>[\s\S]*?class="collapse-toggle secondary"/);
});

test('Queue offers an English-only full subtitle setting', () => {
    assert.match(queue, /<option value="english">English full subtitles only<\/option>/);
});

test('Queue Mode exposes the shared popup dark mode beside Companion status', () => {
    const queueScript = readFileSync(new URL('../multi-mode/multi-mode.js', import.meta.url), 'utf8');
    assert.match(queue, /id="companion-status"[\s\S]*?for="darkModeToggle"/);
    assert.match(queue, /id="darkModeToggle"/);
    assert.match(queueScript, /SettingsManager\.saveDarkMode\(elements\.darkModeToggle\.checked\)/);
    assert.match(queueScript, /SettingsManager\.setDarkMode\(changes\.dark_mode\.newValue === true\)/);
});

test('Queue series artwork and information are aligned entirely to the left', () => {
    assert.match(queueCss, /\.series-overview \{[^}]*text-align: left;/);
    assert.match(queueCss, /\.series-overview\.has-poster \{[^}]*align-items: start;[^}]*justify-items: start;/);
    assert.match(queueCss, /\.series-overview-copy \{[^}]*align-self: start;[^}]*text-align: left;/);
});

test('Queue places Companion beside metadata and keeps Processing full width below it', () => {
    assert.match(queue, /<p class="eyebrow">Settings<\/p><h2>Media Options<\/h2>/);
    assert.match(queue, /<p class="eyebrow">Execution<\/p><h2>Processing<\/h2>/);
    assert.match(queue, /<section class="card companion-card">/);
    assert.match(queue, /<p class="eyebrow">Configure<\/p><h2>Required Companion<\/h2>/);
    assert.match(queue, /Required for Queue Mode/);
    assert.doesNotMatch(queue, /id="mediafab-companion-enabled"/);
    assert.match(queue, /id="close-terminal-on-complete"/);
    assert.ok(queue.indexOf('<h2>Required Companion</h2>') < queue.indexOf('<h2>Processing</h2>'));
    assert.match(queueCss, /\.processing-card, \.queue-card \{ grid-column: 1 \/ -1; \}/);
    assert.doesNotMatch(queueCss, /\.companion-card, \.queue-card \{ grid-column: 1 \/ -1; \}/);
});

test('normal Companion launch is explicit per captured command and never dispatched by the background', () => {
    assert.doesNotMatch(background, /launch_single|maybeLaunchNormalCapture|normalCompanion/);
    assert.match(panel, /Nothing opens in Terminal until you click Run\./);
    assert.match(panelCss, /\.command-copy \.companion-run-button/);
    const panelScript = readFileSync(new URL('../panel/panel.js', import.meta.url), 'utf8');
    assert.match(panelScript, /class="companion-run-button"/);
    assert.match(panelScript, /runCapturedCommandWithCompanion/);
    assert.match(panelScript, /mediafabCompanion\.request\('launch_single'/);
    assert.match(panelScript, /userInitiated: true/);
    assert.match(panelScript, /capturedAtMs: Number\(result\.timestamp\) \* 1000/);
    assert.doesNotMatch(panelScript, /capture: \{ capturedAtMs: Date\.now\(\) \}/);
    assert.match(panelScript, /button\.hidden = !companionAvailable/);
    assert.match(panelScript, /class="companion-run-button"[^>]*hidden disabled>Run<\/button>/);
});

test('Queue creates a dedicated worker tab instead of selecting an existing user tab', () => {
    const queueScript = readFileSync(new URL('../multi-mode/multi-mode.js', import.meta.url), 'utf8');
    assert.match(queueScript, /chrome\.tabs\.create\(\{ url: 'about:blank', active: true \}\)/);
    assert.doesNotMatch(queueScript, /tabs\.find\(\(candidate\)/);
});

test('extension-owned Crunchyroll discovery retains the provider request identity', () => {
    assert.ok(manifest.permissions.includes('webRequestBlocking'));
    assert.match(background, /crunchyrollCatalogueRequestFilter/);
    assert.match(background, /mediaFabExtensionOrigin/);
    assert.match(background, /User-Agent', value: 'Crunchyroll\/1\.8\.0'/);
});

test('Live Queue has no nonfunctional row-selection controls', () => {
    const queueScript = readFileSync(new URL('../multi-mode/multi-mode.js', import.meta.url), 'utf8');
    assert.doesNotMatch(queue, /<th><\/th>/);
    assert.doesNotMatch(queueScript, /queueSelected/);
    assert.match(queue, /id="cancel-current"[^>]*>Cancel current<\/button>/);
    assert.match(queueScript, /'start-selected', 'pause-queue', 'cancel-current'/);
    assert.doesNotMatch(queueScript, /cancel-selected/);
    assert.match(queueScript, /job\.status === 'failed'[\s\S]*?queuePaused = true;[\s\S]*?Queue paused before opening another episode/);
    assert.match(queueScript, /\['waiting', 'completed', 'skipped', 'cancelled'\]\.includes\(job\.status\)/);
});
