import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
    DEFAULT_MULTI_MODE_SETTINGS,
    normalizeMultiModeSettings,
    useSharedMetadataSettings,
    buildDownloaderArguments,
    buildQueueMediaCommand,
    buildQueueLocalCommand,
    createCrunchyrollExistingEpisodeGuard,
    quoteShellArgument,
    formatDownloaderArgumentPreview,
    createDirectLinkCatalog,
    createManualLinkCatalog,
    getSelectedEpisodes,
    getSelectionState,
    setAllEpisodesSelected,
    buildBatchJobs,
} from '../multi-mode/core.mjs';
import {
    MultiModeCaptureOwnership,
    hasRequiredProtectedHeaders,
    isCrunchyrollProtectedManifest,
    mergeCaptureHeaders,
    prepareManifestForDispatch,
} from '../multi-mode/capture-state.mjs';
import { discoverProviderCatalog, getRegisteredProviderIds } from '../multi-mode/providers/registry.mjs';
import { crunchyrollAdapter, discoverCrunchyrollCatalog } from '../multi-mode/providers/crunchyroll.mjs';
import { disneyPlusAdapter, discoverDisneyPlusCatalog } from '../multi-mode/providers/disneyplus.mjs';
import { discoverHBOMaxCatalog, hboMaxAdapter } from '../multi-mode/providers/hbo-max.mjs';
import { bbcIPlayerAdapter, discoverBBCIPlayerCatalog } from '../multi-mode/providers/bbc-iplayer.mjs';
import { buildBBCIPlayerCommand } from '../multi-mode/bbc-iplayer-settings.mjs';
import { discoverPBSKidsCatalog, pbsKidsAdapter } from '../multi-mode/providers/pbs-kids.mjs';
import {
    getBroadwayHDDetailLink,
    getCrunchyrollDetailLink,
    resolveLPMAEGDetailLink,
    resolveMMEDetailLink,
} from '../panel/metadata-links.mjs';
import { buildNormalMediaCommand, quoteCommandValue } from '../panel/command-builder.mjs';
import { createSubtitleRetentionCommand, getSelectedSubtitleLanguage } from '../panel/command-builder.mjs';
import {
    buildParamountPlusArguments,
    getParamountPlusPageTitle,
    isParamountPlusPage,
} from '../multi-mode/paramountplus-settings.mjs';

const contentScriptSource = readFileSync(new URL('../content_script.js', import.meta.url), 'utf8');

test('defaults mirror the requested visible Queue Mode media preferences', () => {
    const settings = normalizeMultiModeSettings();
    assert.equal(settings.container, 'mkv');
    assert.equal(settings.videoMode, '1080');
    assert.equal(settings.audioMode, 'best');
    assert.equal(settings.subtitleMode, 'all');
    assert.equal(settings.useShakaPackager, true);
    assert.equal(settings.externalSubtitles, true);
    assert.equal(settings.keepDownloaderLog, false);
    assert.deepEqual(settings.companion, {
        enabled: false,
        projectFolder: '',
        destination: '',
        closeTerminalOnComplete: false,
    });
    assert.equal('simultaneousJobs' in settings, false);
    assert.equal('filenameTemplate' in settings, false);
    assert.deepEqual(buildDownloaderArguments(settings), [
        '-M', 'format=mkv', '--no-log', '-sv', 'res=1920*:for=best',
        '-sa', 'best', '-ss', 'all',
    ]);
    assert.deepEqual(buildDownloaderArguments({ ...settings, subtitleMode: 'english' }), [
        '-M', 'format=mkv', '--no-log', '-sv', 'res=1920*:for=best',
        '-sa', 'best', '-ss', 'lang=en:for=best',
    ]);
    assert.match(formatDownloaderArgumentPreview(settings), /^--use-shaka-packager /);
});

test('MediaFab Queue Mode Companion settings are normalized without changing downloader options', () => {
    const settings = normalizeMultiModeSettings({
        companion: { enabled: true, projectFolder: '/Applications/MediaFab Queue Mode Companion' },
    });
    assert.deepEqual(settings.companion, {
        enabled: true,
        projectFolder: '/Applications/MediaFab Queue Mode Companion',
        destination: '',
        closeTerminalOnComplete: false,
    });
    assert.deepEqual(buildDownloaderArguments(settings), buildDownloaderArguments(DEFAULT_MULTI_MODE_SETTINGS));
});

test('Queue refreshes the selected getter together with its matching shared configuration', () => {
    const refreshed = useSharedMetadataSettings({
        ...DEFAULT_MULTI_MODE_SETTINGS,
        metadata: {
            enabled: true,
            getter: 'lpmaeg',
            projectFolder: '/Users/test/Live Performance Metadata and Extras Getter',
        },
    }, 'mme', {
        enabled: true,
        detailLink: '',
        projectFolder: '/Users/test/Media Metadata and Extras Getter',
    });
    assert.equal(refreshed.metadata.getter, 'mme');
    assert.equal(refreshed.metadata.projectFolder, '/Users/test/Media Metadata and Extras Getter');
    const [job] = buildBatchJobs(
        createManualLinkCatalog([{
            playbackUrl: 'https://www.crunchyroll.com/watch/GE00362087ENUS/example',
            detailUrl: 'https://www.crunchyroll.com/series/GW4HM7WQ5/example',
        }]),
        { ...refreshed, destination: '/tmp/Queue Output' },
    );
    const command = buildQueueMediaCommand(job, {
        manifest: { type: 'DASH', url: 'https://cdn.example.test/manifest.mpd', headers: {} },
        keys: [{ kid: 'aa', k: 'bb' }],
    });
    assert.match(command, /media_metadata_and_extras_getter\.py/);
    assert.doesNotMatch(command, /live_performance_metadata_and_extras_getter\.py/);
    assert.match(command, /--detail-link 'https:\/\/www\.crunchyroll\.com\/series\/GW4HM7WQ5\/example'/);
    assert.match(command, /--media-folder "\$mediafab_media_file"/);
});

test('legacy Queue Mode path templates are discarded', () => {
    const settings = normalizeMultiModeSettings({
        filenameTemplate: '{series}/Season {season2}/{series} - S{season2}E{episode2} - {title}',
    });
    assert.equal('filenameTemplate' in settings, false);
});

test('legacy simultaneous-job settings are discarded because batches are sequential', () => {
    assert.equal('simultaneousJobs' in normalizeMultiModeSettings({ simultaneousJobs: 10 }), false);
});

test('selection helpers support select all and build isolated jobs', () => {
    const catalog = createDirectLinkCatalog('https://example.test/episode/1');
    assert.equal(getSelectedEpisodes(catalog).length, 1);
    setAllEpisodesSelected(catalog, false);
    assert.deepEqual(getSelectionState(catalog.seasons[0].episodes), {
        checked: false,
        indeterminate: false,
        selectedCount: 0,
        totalCount: 1,
    });
    setAllEpisodesSelected(catalog, true);
    const settings = {
        ...DEFAULT_MULTI_MODE_SETTINGS,
        destination: '/tmp/media',
    };
    const jobs = buildBatchJobs(catalog, settings);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].detailUrl, 'https://example.test/episode/1');
    assert.equal(jobs[0].outputDirectory, '/tmp/media');
    assert.equal(jobs[0].closeTerminalOnComplete, false);
    assert.equal('saveName' in jobs[0], false);
    assert.deepEqual(jobs[0].downloaderArguments, buildDownloaderArguments(settings));
});

test('Queue Mode passes the close-Terminal preference to every queued job', () => {
    const settings = {
        ...DEFAULT_MULTI_MODE_SETTINGS,
        companion: {
            ...DEFAULT_MULTI_MODE_SETTINGS.companion,
            closeTerminalOnComplete: true,
        },
    };
    const [job] = buildBatchJobs(createDirectLinkCatalog('https://example.test/episode/1'), settings);
    assert.equal(job.closeTerminalOnComplete, true);
});

test('Paramount+ renders real seasons and episodes while keeping one external backend job', async () => {
    const source = 'https://www.paramountplus.com/shows/legends-of-the-hidden-temple/?tracking=ignored';
    const showPage = `
        <meta property="og:title" content="Legends of the Hidden Temple - Watch on Paramount Plus">
        <meta property="og:image" content="https://images.example/show.jpg">
        <div class="about__header-title">Legends of the Hidden Temple</div>
        <div class="about__header-description">Temple adventures.</div>
        <span class="about__metadata-title">Year</span><span>1993</span>
        <span class="about__metadata-title">Seasons</span><span>2</span>
        <span class="about__metadata-title">Rating</span><span>TV-Y7</span>
        <span class="about__metadata-title">Genre</span><span>Kids &amp; Family</span>
        <option value="1">Season 1</option><option value="2">Season 2</option>`;
    const episode = (season, number, id, title) => `
        <div class="episode">
          <a href="/shows/video/${id}/">
            <abbr class="seNum" title="Season ${season}">S${season}</abbr>
            <abbr class="epNum" title="Episode ${number}">E${number}</abbr>
            <div class="epTitle">${title}</div>
            <div class="ep__copy">Description for ${title}</div>
          </a>
        </div>`;
    const responses = new Map([
        ['https://www.paramountplus.com/shows/legends-of-the-hidden-temple/', showPage],
        ['https://www.paramountplus.com/browse/all/', `var collectionConfig = ${JSON.stringify([
            { title: 'All+Shows+A-Z', model: 'shows', token: 'public-token' },
        ])};`],
        ['https://www.paramountplus.com/carousels/collections/configItems/shows/public-token/offset/0/limit/20/', JSON.stringify({
            result: {
                orientation: 'portrait', total: 1, data: [{
                    alt: 'Legends of the Hidden Temple', orientation: 'portrait',
                    thumb: 'https://images.example/w300-q60/temple-poster.jpg',
                }],
            },
        })],
        ['https://www.paramountplus.com/shows/legends-of-the-hidden-temple/episodes/1/',
            episode(1, 1, 'one', 'The Map') + episode(1, 2, 'two', 'The Temple')],
        ['https://www.paramountplus.com/shows/legends-of-the-hidden-temple/episodes/2/',
            episode(2, 1, 'three', 'The Return')],
    ]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => ({
        ok: responses.has(String(url)),
        status: responses.has(String(url)) ? 200 : 404,
        text: async () => responses.get(String(url)) || '',
        json: async () => JSON.parse(responses.get(String(url)) || '{}'),
    });
    let catalog;
    try {
        catalog = await discoverProviderCatalog(source);
    } finally {
        globalThis.fetch = originalFetch;
    }
    assert.equal(catalog.provider, 'paramountplus');
    assert.equal(catalog.externalBackend, true);
    assert.equal(catalog.seriesTitle, 'Legends of the Hidden Temple');
    assert.equal(catalog.seriesPosterUrl, 'https://images.example/w1400-q90/temple-poster.jpg');
    assert.equal(catalog.seriesArtworkShape, 'portrait');
    assert.equal(catalog.seasons.length, 2);
    assert.equal(catalog.seasons[0].episodes.length, 2);
    assert.equal(catalog.seasons[1].episodes[0].title, 'The Return');
    assert.equal(catalog.seriesEpisodeCount, 3);

    catalog.seasons[0].episodes[1].selected = false;

    const [job] = buildBatchJobs(catalog, {
        ...DEFAULT_MULTI_MODE_SETTINGS,
        destination: '/tmp/Paramount Queue',
        metadata: {
            enabled: true,
            getter: 'mme',
            projectFolder: '/tmp/MME',
        },
    });
    assert.equal(job.executionMode, 'external-backend');
    assert.equal(job.backendId, 'paramountplus');
    assert.equal(job.outputDirectory, '/tmp/Paramount Queue');
    assert.equal(job.sourceUrl, 'https://www.paramountplus.com/shows/legends-of-the-hidden-temple/');
    assert.equal(job.metadata.enabled, true);
    assert.equal(job.metadata.getter, 'mme');
    assert.deepEqual(job.backendArguments.slice(0, 8), [
        '--quality', '1080', '--range', 'SDR', '--lang', 'orig', '--s-lang', 'en',
    ]);
    const wantedIndex = job.backendArguments.indexOf('--wanted');
    assert.ok(wantedIndex >= 0);
    assert.equal(job.backendArguments[wantedIndex + 1], 'S01E01,S02E01');
    assert.equal(buildBatchJobs(catalog, {
        ...DEFAULT_MULTI_MODE_SETTINGS,
    }).length, 1);
});

test('Paramount+ settings produce structured public media arguments without private backend controls', () => {
    const args = buildParamountPlusArguments({
        quality: '2160', range: 'DV,HDR10,SDR', subtitleLanguage: 'en',
        wanted: 'S01-S03', forcedSubtitles: false, adaptiveWorkers: true,
    });
    assert.deepEqual(args.slice(0, 6), ['--quality', '2160', '--range', 'DV,HDR10,SDR', '--lang', 'orig']);
    assert.ok(args.includes('--wanted'));
    assert.ok(args.includes('--adaptive-workers'));
    assert.ok(!args.includes('--forced-subs'));
    for (const forbidden of ['--proxy', '--remote', '--cdm', '--profile', '--output', '--postscript']) {
        assert.ok(!args.includes(forbidden));
    }
    assert.equal(isParamountPlusPage('https://www.paramountplus.com/shows/example/'), true);
});

test('Paramount+ movie video URLs use the page title instead of the generic video slug', () => {
    const url = 'https://www.paramountplus.com/movies/video/6QE2xkf21fv_5lVwo9oYtGPaQ5KWCnYb/';
    assert.equal(getParamountPlusPageTitle(url, 'The Addams Family - Watch on Paramount+'), 'The Addams Family');
    assert.equal(getParamountPlusPageTitle(url), 'Paramount+ Movie');
});

test('Queue Mode passes the common destination without pre-creating a series folder', () => {
    const watchUrl = 'https://www.crunchyroll.com/watch/GE00362091ENUS/episode-three';
    const [job] = buildBatchJobs(createManualLinkCatalog([watchUrl]), {
        ...DEFAULT_MULTI_MODE_SETTINGS,
        destination: '/tmp/May I Ask for One Final Thing',
    });
    assert.equal(job.outputDirectory, '/tmp/May I Ask for One Final Thing');
    assert.equal('filenameTemplate' in job, false);
    assert.equal('saveName' in job, false);
});

test('multiple Queue jobs retain per-item detail links in one selected destination', () => {
    const catalogUrl = 'https://www.crunchyroll.com/series/GW4HM7WQ5/example';
    const catalog = createManualLinkCatalog([
        { playbackUrl: 'https://www.crunchyroll.com/watch/GE00362087ENUS/one', detailUrl: catalogUrl },
        { playbackUrl: 'https://www.crunchyroll.com/watch/GE00362091ENUS/two', detailUrl: '' },
    ]);
    const jobs = buildBatchJobs(catalog, {
        ...DEFAULT_MULTI_MODE_SETTINGS,
        destination: '/tmp/Common Destination',
        metadata: { enabled: true, getter: 'mme', projectFolder: '/tmp/MME' },
    });
    assert.equal(jobs.length, 2);
    assert.deepEqual(jobs.map((job) => job.playbackUrl), [
        'https://www.crunchyroll.com/watch/GE00362087ENUS/one',
        'https://www.crunchyroll.com/watch/GE00362091ENUS/two',
    ]);
    assert.deepEqual(new Set(jobs.map((job) => job.detailUrl)), new Set([catalogUrl]));
    assert.deepEqual(new Set(jobs.map((job) => job.outputDirectory)), new Set(['/tmp/Common Destination']));
    assert.ok(jobs.every((job) => !job.outputDirectory.includes('Manual Queue')));
});

test('manual episode links create an unlimited provider-independent queue catalogue', () => {
    const catalog = createManualLinkCatalog([
        'https://www.crunchyroll.com/watch/GE00362091ENUS/episode-three',
        'https://video.example.test/episodes/four',
        'https://another.example.test/play/five',
        'https://www.disneyplus.com/browse/entity-d010d071-99c7-4821-90f9-ab03ec144cc9',
    ]);
    assert.equal(catalog.discovery, 'manual-links');
    assert.equal(catalog.seasons[0].episodes.length, 4);
    assert.equal(catalog.seasons[0].episodes[0].provider, 'crunchyroll');
    assert.equal(catalog.seasons[0].episodes[1].provider, 'manual');
    assert.equal(catalog.seasons[0].episodes[2].episodeNumber, 3);
    assert.equal(catalog.seasons[0].episodes[3].provider, 'disneyplus');
    assert.throws(() => createManualLinkCatalog(['file:///tmp/video']), /http\(s\)/);
});

test('manual Queue items keep individual detail fields and share one link within a contiguous series group', () => {
    const catalog = createManualLinkCatalog([
        { playbackUrl: 'https://video.example.test/show-a/episode-1', detailUrl: '' },
        { playbackUrl: 'https://video.example.test/show-a/episode-2', detailUrl: 'https://details.example.test/show-a' },
        { playbackUrl: 'https://video.example.test/show-a/episode-3', detailUrl: '' },
        { playbackUrl: 'https://video.example.test/show-b/episode-1', detailUrl: 'https://details.example.test/show-b' },
        { playbackUrl: 'https://video.example.test/show-b/episode-2', detailUrl: '' },
    ]);
    const episodes = catalog.seasons[0].episodes;
    assert.deepEqual(episodes.map((episode) => episode.detailUrl), [
        'https://details.example.test/show-a',
        'https://details.example.test/show-a',
        'https://details.example.test/show-a',
        'https://details.example.test/show-b',
        'https://details.example.test/show-b',
    ]);
    assert.deepEqual(episodes.map((episode) => episode.suppliedDetailUrl), [
        '', 'https://details.example.test/show-a', '', 'https://details.example.test/show-b', '',
    ]);
});

test('normal English subtitle selector is recognized for separately captured playlists', () => {
    assert.equal(getSelectedSubtitleLanguage('-M format=mkv -ss lang=en:for=best'), 'en');
    assert.equal(getSelectedSubtitleLanguage('--select-subtitle="lang=en-US:for=best"'), 'en-us');
    assert.equal(getSelectedSubtitleLanguage('-ss all'), '');
});

test('Amazon signed manifest dollar segments reach the downloader literally', () => {
    const manifestUrl = 'https://example.amazon.pv-cdn.net/dm/3$0CioIAhoFZW5fVVM/manifest.mpd?encoding=segmentBase';
    const quotedUrl = quoteCommandValue(manifestUrl);
    assert.match(quotedUrl, /3\\\$0CioIAhoFZW5fVVM/);
    assert.equal(
        execFileSync('/bin/zsh', ['-c', `printf %s ${quotedUrl}`], { encoding: 'utf8' }),
        manifestUrl,
    );

    const command = buildNormalMediaCommand({
        metadata: {
            url: manifestUrl,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                Referer: 'https://www.primevideo.com/',
                Origin: 'https://www.primevideo.com',
            },
            subtitles: [],
            isPublicMedia: false,
            pageUrl: 'https://www.primevideo.com/detail/example',
        },
    });
    assert.match(command, /N_m3u8DL-RE "https:\/\/example\.amazon\.pv-cdn\.net\/dm\/3\\\$0Cio/);
});

test('normal Disney English subtitle arguments keep only English captured playlists', () => {
    const command = buildNormalMediaCommand({
        metadata: {
            url: 'https://cdn.example.test/manifest.mpd',
            headers: {},
            subtitles: [
                { url: 'https://media.dssott.com/subtitles/en/master.m3u8', language: 'en-US', playlist: true },
                { url: 'https://media.dssott.com/subtitles/da/master.m3u8', language: 'da', playlist: true },
                { url: 'https://media.dssott.com/subtitles/fr/master.m3u8', language: 'fr-FR', playlist: true },
            ],
            isPublicMedia: false,
            pageUrl: 'https://www.disneyplus.com/browse/entity/example',
        },
        additionalArguments: '-M format=mkv -ss lang=en:for=best --save-dir /tmp/DisneyPlus',
    });

    assert.match(command, /subtitles\/en\/master\.m3u8/);
    assert.doesNotMatch(command, /subtitles\/da\/master\.m3u8/);
    assert.doesNotMatch(command, /subtitles\/fr\/master\.m3u8/);
    assert.match(command, /en\.srt/);
});

test('Disney+ HLS falls back to its best available video instead of selecting audio only', () => {
    const command = buildNormalMediaCommand({
        metadata: {
            type: 'HLS_MASTER',
            url: 'https://vod.media.dssott.com/example/master.m3u8?r=720',
            headers: {},
            subtitles: [],
            isPublicMedia: false,
            pageUrl: 'https://www.disneyplus.com/play/ad5f6c58-8513-4de1-8420-350ce867ffdd',
        },
        additionalArguments: '-M format=mkv -sv res="1920*":for=best -sa best',
    });

    assert.doesNotMatch(command, /res=1920/);
    assert.match(command, /-M format=mkv -sa best -sv best/);
});

test('Crunchyroll corrects a detected audio and video timeline offset before metadata', () => {
    const crunchyroll = buildNormalMediaCommand({
        metadata: {
            type: 'DASH',
            url: 'https://www.crunchyroll.com/playback/v2/manifest/GE00362087ENUS/cenc/dash/manifest.mpd',
            headers: {},
            subtitles: [],
            isPublicMedia: false,
            pageUrl: 'https://www.crunchyroll.com/watch/GE00362087ENUS/example',
        },
        additionalArguments: '-M format=mkv --save-dir /tmp/Crunchyroll',
    });
    const generic = buildNormalMediaCommand({
        metadata: {
            type: 'DASH',
            url: 'https://cdn.example.test/manifest.mpd',
            headers: {},
            subtitles: [],
            isPublicMedia: false,
            pageUrl: 'https://example.test/watch',
        },
        additionalArguments: '-M format=mkv --save-dir /tmp/Other',
    });

    assert.match(crunchyroll, /ffprobe[^&]+-select_streams v:0/);
    assert.match(crunchyroll, /ffprobe[^&]+-select_streams a:0/);
    assert.match(crunchyroll, /ffmpeg[^&]+-itsoffset "\$mediafab_video_offset"/);
    assert.doesNotMatch(generic, /mediafab_video_offset|\.mediafab-sync/);
});

test('Queue Mode sends each capture through the shared normal command builder', () => {
    const watchUrl = 'https://www.crunchyroll.com/watch/GE00362091ENUS/episode-three';
    const catalog = createManualLinkCatalog([{
        playbackUrl: watchUrl,
        detailUrl: 'https://www.crunchyroll.com/series/GW4HM7WQ5/example-series',
    }]);
    const [job] = buildBatchJobs(catalog, {
        ...DEFAULT_MULTI_MODE_SETTINGS,
        destination: '/tmp/Queue Output',
        metadata: {
            enabled: true,
            getter: 'mme',
            detailLink: '',
            projectFolder: '/Applications/MME',
        },
    });
    const command = buildQueueMediaCommand(job, {
        manifest: {
            type: 'DASH',
            url: 'https://www.crunchyroll.com/playback/v2/manifest/GE00362091ENUS/cenc/dash/manifest.mpd',
            headers: {
                Authorization: 'Bearer fresh',
                Cookie: 'session=one',
                Referer: watchUrl,
            },
        },
        keys: [{ kid: 'aa', k: 'bb' }, { kid: 'cc', k: 'dd' }],
        subtitles: [{
            url: 'https://cdn.example.test/subtitles/en.vtt',
            language: 'en',
            headers: { Referer: watchUrl },
        }],
    }, {
        executableName: 'N_m3u8DL-RE',
        useSingleQuotes: false,
    });
    assert.match(command, /N_m3u8DL-RE "https:\/\/www\.crunchyroll\.com\/playback/);
    assert.match(command, /-H "Authorization: Bearer fresh"/);
    assert.match(command, /--key aa:bb --key cc:dd --use-shaka-packager/);
    assert.match(command, /-M format=mkv --no-log/);
    assert.equal((command.match(/--use-shaka-packager/g) || []).length, 1);
    assert.match(command, /curl --fail --location/);
    assert.match(command, /media_metadata_and_extras_getter\.py/);
    assert.match(command, /--detail-link 'https:\/\/www\.crunchyroll\.com\/series\/GW4HM7WQ5\/example-series'/);
    assert.match(command, /--save-dir '\/tmp\/Queue Output'/);
    assert.match(command, /--save-name "mediafab-crunchyroll-GE00362091ENUS-/);
    assert.match(command, /-ds all/);
    assert.doesNotMatch(command, /(?:^|\s)-ss all(?:\s|$)/);
    assert.doesNotMatch(command, /Queue Output\/Manual Queue\/S01/);
    assert.match(command, /--media-folder "\$mediafab_media_file"/);
    assert.match(command, /MediaFab note: Complete\. Output is ready\./);
});

test('Queue Mode preserves playing-page identity in its per-item metadata handoff', () => {
    const watchUrl = 'https://www.crunchyroll.com/watch/G9DUE3QXP/prepare-for-the-interview';
    const command = buildQueueMediaCommand({
        provider: 'crunchyroll',
        playbackUrl: watchUrl,
        detailUrl: watchUrl,
        outputDirectory: '/tmp/Queue Output',
        downloaderArguments: ['-M', 'format=mkv'],
        externalSubtitles: false,
        useShakaPackager: true,
        metadata: { enabled: true, getter: 'mme', projectFolder: '/Applications/MME' },
    }, {
        manifest: { type: 'DASH', url: 'https://cdn.example.test/manifest.mpd', headers: {} },
        keys: [{ kid: 'aa', k: 'bb' }],
    });

    assert.match(command, new RegExp(`--detail-link '${watchUrl}'`));
    assert.match(command, /--save-name "mediafab-crunchyroll-G9DUE3QXP-/);
    assert.match(command, /--media-folder "\$mediafab_media_file"/);
});

test('Queue English subtitle mode keeps only English captured HLS playlists', () => {
    const command = buildQueueMediaCommand({
        provider: 'manual',
        playbackUrl: 'https://www.disneyplus.com/browse/entity-example',
        detailUrl: 'https://www.disneyplus.com/browse/entity-example',
        outputDirectory: '/tmp/DisneyPlus',
        downloaderArguments: ['-M', 'format=mkv', '-ss', 'lang=en:for=best'],
        subtitleMode: 'english',
        externalSubtitles: true,
        useShakaPackager: true,
        metadata: { enabled: false },
    }, {
        manifest: { type: 'DASH', url: 'https://cdn.example.test/manifest.mpd', headers: {} },
        keys: [{ kid: 'aa', k: 'bb' }],
        subtitles: [
            { url: 'https://media.dssott.com/subtitles/en/master.m3u8', language: 'en-US', playlist: true },
            { url: 'https://media.dssott.com/subtitles/da/master.m3u8', language: 'da', playlist: true },
            { url: 'https://media.dssott.com/subtitles/fr/master.m3u8', language: 'fr-FR', playlist: true },
        ],
    });

    assert.match(command, /subtitles\/en\/master\.m3u8/);
    assert.doesNotMatch(command, /subtitles\/da\/master\.m3u8/);
    assert.doesNotMatch(command, /subtitles\/fr\/master\.m3u8/);
    assert.match(command, /en\.srt/);
    assert.doesNotMatch(command, /en_us\.srt/);
});

test('Crunchyroll Queue skips only a filename carrying the exact provider identity', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'mediafab-existing-episode-'));
    const episodeFolder = path.join(folder, 'SPY x FAMILY (2022-2025)', 'S01');
    mkdirSync(episodeFolder, { recursive: true });
    writeFileSync(path.join(episodeFolder, 'mediafab-crunchyroll-GE00362087ENUS-complete.mkv'), 'existing');
    const marker = path.join(folder, 'downloader-ran');
    const command = createCrunchyrollExistingEpisodeGuard({
        provider: 'crunchyroll',
        playbackUrl: 'https://www.crunchyroll.com/watch/GE00362087ENUS/secure-a-wife',
        seriesTitle: 'SPY x FAMILY',
        seasonNumber: 1,
        episodeNumber: 2,
        outputDirectory: folder,
    }, `touch ${quoteShellArgument(marker)}`);

    const output = execFileSync('/bin/zsh', ['-c', command], { encoding: 'utf8' });
    assert.match(output, /Queue skipped existing episode:/);
    assert.equal(existsSync(marker), false);
});

test('Crunchyroll Queue runs normally when the selected episode does not exist', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'mediafab-new-episode-'));
    const marker = path.join(folder, 'downloader-ran');
    const command = createCrunchyrollExistingEpisodeGuard({
        provider: 'crunchyroll',
        playbackUrl: 'https://www.crunchyroll.com/watch/GE00362091ENUS/new-episode',
        seriesTitle: 'SPY x FAMILY',
        seasonNumber: 1,
        episodeNumber: 3,
        outputDirectory: folder,
    }, `touch ${quoteShellArgument(marker)}`);

    execFileSync('/bin/zsh', ['-c', command]);
    assert.equal(existsSync(marker), true);
});

test('a stale S01E01 from another show is never claimed without the Disney episode UUID', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'mediafab-existing-disney-episode-'));
    const episodeFolder = path.join(folder, 'Bluey Tunes (2026)', 'S01');
    mkdirSync(episodeFolder, { recursive: true });
    writeFileSync(path.join(episodeFolder, 'S01E01 Bluey Tunes - Taxi.mkv'), 'existing');
    const marker = path.join(folder, 'downloader-ran');
    const command = createCrunchyrollExistingEpisodeGuard({
        provider: 'disneyplus',
        playbackUrl: 'https://www.disneyplus.com/play/ad5f6c58-8513-4de1-8420-350ce867ffdd',
        seriesTitle: 'Bluey Tunes',
        seasonNumber: 1,
        episodeNumber: 1,
        outputDirectory: folder,
    }, `touch ${quoteShellArgument(marker)}`);

    const output = execFileSync('/bin/zsh', ['-c', command], { encoding: 'utf8' });
    assert.doesNotMatch(output, /Queue skipped existing episode:/);
    assert.equal(existsSync(marker), true);
});

test('a failed captured subtitle does not prevent the normal MME handoff', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'mediafab-subtitle-handoff-'));
    const project = path.join(folder, 'MME');
    mkdirSync(path.join(project, 'Launchers'), { recursive: true });
    writeFileSync(
        path.join(project, 'Launchers', 'media_metadata_and_extras_getter.py'),
        'from pathlib import Path\nPath(__file__).parents[2].joinpath("mme-ran").write_text("yes")\n',
    );
    const command = buildNormalMediaCommand({
        metadata: {
            url: 'https://cdn.example.test/manifest.mpd',
            headers: {},
            subtitles: [{ url: 'http://127.0.0.1:1/missing.vtt', language: 'en', headers: {} }],
            isPublicMedia: true,
            pageUrl: 'https://provider.example/episode/1',
        },
        executableName: path.join(folder, 'fake-downloader'),
        metadataGetterType: 'mme',
        metadataGetterConfig: {
            enabled: true,
            detailLink: 'https://provider.example/episode/1',
            projectFolder: project,
        },
        outputDirectory: folder,
    });

    writeFileSync(path.join(folder, 'fake-downloader'), `#!/bin/zsh\nprintf media > '${folder}/completed.mkv'\n`);
    chmodSync(path.join(folder, 'fake-downloader'), 0o700);

    execFileSync('/bin/zsh', ['-c', command], { stdio: 'pipe' });
    assert.equal(readFileSync(path.join(folder, 'mme-ran'), 'utf8'), 'yes');
    assert.match(command, /continuing to the metadata handoff/);
    assert.doesNotMatch(command, /subtitle_log"; return 1/);
});

test('Disney+ ignores individual VTT segments and captures subtitle playlists instead', () => {
    assert.match(contentScriptSource, /isDisneyPlusPage/);
    assert.match(contentScriptSource, /media\\\.dssott\\\.com/);
    assert.match(contentScriptSource, /segmentedVttPattern/);
    assert.match(contentScriptSource, /isIncompleteDisneySegment[\s\S]*?!isIncompleteDisneySegment/);
    assert.match(contentScriptSource, /subtitlePlaylistPattern/);
    assert.match(contentScriptSource, /TYPE=SUBTITLES/);
    assert.match(contentScriptSource, /playlist: isSubtitlePlaylistUrl\(resolvedUrl\)/);
});

test('a captured HLS subtitle playlist is merged into one complete SRT', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'mediafab-hls-subtitles-'));
    const cueBlock = (startIndex, offsetSeconds) => Array.from({ length: 55 }, (_, index) => {
        const cue = startIndex + index;
        const start = offsetSeconds + index * 0.1;
        const end = start + 0.08;
        const time = (value) => `00:00:${value.toFixed(3).padStart(6, '0')}`;
        return `${cue}\n${time(start)} --> ${time(end)}\nDialogue ${cue}\n`;
    }).join('\n');
    writeFileSync(path.join(folder, 'segment0.vtt'), `WEBVTT\n\n${cueBlock(1, 0)}`);
    writeFileSync(path.join(folder, 'segment1.vtt'), `WEBVTT\n\n${cueBlock(56, 0)}`);
    writeFileSync(path.join(folder, 'subtitles.m3u8'), [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-TARGETDURATION:6',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXTINF:6.0,',
        'segment0.vtt',
        '#EXTINF:6.0,',
        'segment1.vtt',
        '#EXT-X-ENDLIST',
        '',
    ].join('\n'));
    const playlistUrl = new URL(`file://${path.join(folder, 'subtitles.m3u8')}`).href;
    const command = buildNormalMediaCommand({
        metadata: {
            url: 'https://cdn.example.test/manifest.mpd',
            headers: {},
            subtitles: [{
                url: playlistUrl,
                language: 'en',
                playlist: true,
                headers: { Referer: 'https://www.disneyplus.com/', Cookie: 'session=one' },
            }],
            isPublicMedia: true,
            pageUrl: 'https://www.disneyplus.com/browse/entity/example',
        },
        executableName: '/usr/bin/true',
        outputDirectory: folder,
    });

    const execution = execFileSync('/bin/zsh', ['-c', command], { encoding: 'utf8' });
    assert.ok(existsSync(path.join(folder, 'en.srt')), execution);
    const merged = readFileSync(path.join(folder, 'en.srt'), 'utf8');
    assert.ok((merged.match(/-->/g) || []).length >= 100);
    assert.match(merged, /Dialogue 1/);
    assert.match(merged, /Dialogue 110/);
    assert.match(command, /ffmpeg[^&]+subtitles\.m3u8[^&]+en\.srt/);
    const remoteCommand = buildNormalMediaCommand({
        metadata: {
            url: 'https://cdn.example.test/manifest.mpd',
            headers: {},
            subtitles: [{
                url: 'https://cdn.example.test/subtitles/en/playlist.m3u8?token=fresh',
                language: 'en',
                playlist: true,
                headers: { Referer: 'https://www.disneyplus.com/', Cookie: 'session=one' },
            }],
            isPublicMedia: true,
            pageUrl: 'https://www.disneyplus.com/browse/entity/example',
        },
        executableName: '/usr/bin/true',
        outputDirectory: folder,
    });
    assert.match(remoteCommand, /-headers \$'Referer: https:\/\/www\.disneyplus\.com\/\\r\\nCookie: session=one\\r\\n'/);
});

test('subtitle retention keeps one full track and removes copies and forced signs', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'wvp2-subtitles-'));
    const makeSrt = (count, prefix) => Array.from({ length: count }, (_, index) => [
        String(index + 1),
        `00:00:${String(index % 60).padStart(2, '0')},000 --> 00:00:${String((index + 1) % 60).padStart(2, '0')},000`,
        `${prefix} ${index + 1}`,
        '',
    ].join('\n')).join('\n');
    const full = makeSrt(450, 'Dialogue');
    writeFileSync(path.join(folder, 'en_us.srt'), full);
    writeFileSync(path.join(folder, 'en_us.02.srt'), makeSrt(25, 'Sign'));
    writeFileSync(path.join(folder, 'en_us.03.srt'), full);

    const command = createSubtitleRetentionCommand(
        ['en_us.srt', 'en_us.02.srt', 'en_us.03.srt'],
        folder,
    );
    execFileSync('/bin/zsh', ['-c', command]);

    assert.deepEqual(readdirSync(folder), ['en_us.srt']);
    assert.equal(readFileSync(path.join(folder, 'en_us.srt'), 'utf8'), full);
});

test('subtitle retention drops a lone signs-only track', () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'wvp2-forced-subtitle-'));
    const forced = Array.from({ length: 20 }, (_, index) => [
        String(index + 1),
        '00:00:00,000 --> 00:00:01,000',
        `Sign ${index + 1}`,
        '',
    ].join('\n')).join('\n');
    writeFileSync(path.join(folder, 'en_us.srt'), forced);

    execFileSync('/bin/zsh', ['-c', createSubtitleRetentionCommand(['en_us.srt'], folder)]);

    assert.deepEqual(readdirSync(folder), []);
});

test('shared normal builder preserves the public HLS fallback behavior', () => {
    const command = buildNormalMediaCommand({
        metadata: {
            url: 'https://cdn.example.test/media.m3u8',
            headers: { Referer: 'https://example.test/watch' },
            subtitles: [],
            isPublicMedia: true,
            isHlsPlaylistFallback: true,
            pageUrl: 'https://example.test/watch',
        },
        executableName: 'N_m3u8DL-RE',
        useShakaPackager: true,
        additionalArguments: '-M format=mkv --no-log -sv res=1920*:for=best -sa best -ss all',
        metadataGetterConfig: { enabled: false },
    });
    assert.doesNotMatch(command, /--use-shaka-packager/);
    assert.doesNotMatch(command, /res=1920/);
    assert.match(command, /-M format=mkv --no-log -sa best -ss all -sv best/);
});

test('argument preview includes generated and explicitly supplied options', () => {
    const preview = formatDownloaderArgumentPreview({
        ...DEFAULT_MULTI_MODE_SETTINGS,
        additionalArguments: '--thread-count 2',
    });
    assert.match(preview, /format=mkv/);
    assert.match(preview, /--no-log/);
    assert.match(preview, /--thread-count 2$/);
});

test('capture ownership isolates tabs and rejects late navigation cleanup', () => {
    let now = 1000;
    const ownership = new MultiModeCaptureOwnership(() => now++);
    ownership.register({ tabId: 7, jobId: 'job-a', navigationId: 'nav-a', pageUrl: 'https://example.test/a' });
    ownership.register({ tabId: 8, jobId: 'job-b', navigationId: 'nav-b', pageUrl: 'https://example.test/b' });
    ownership.arm(7, 'https://example.test/a');
    ownership.arm(8, 'https://example.test/b');
    ownership.recordManifest(7, { type: 'HLS_PLAYLIST', url: 'https://cdn.test/a/child.m3u8' });
    ownership.recordManifest(7, { type: 'HLS_MASTER', url: 'https://cdn.test/a/master.m3u8' });
    ownership.recordManifest(8, { type: 'DASH', url: 'https://cdn.test/b/manifest.mpd' });
    ownership.recordSubtitle(7, { url: 'https://cdn.test/a/en.vtt', language: 'en' });

    const ready = ownership.createReadyCapture(7, { keys: [{ kid: '01', k: '02' }] });
    assert.equal(ready.jobId, 'job-a');
    assert.equal(ready.capture.manifest.url, 'https://cdn.test/a/master.m3u8');
    assert.equal(ready.capture.subtitles.length, 1);
    assert.equal(ownership.bestManifest(8).url, 'https://cdn.test/b/manifest.mpd');
    assert.equal(ownership.release(7, 'stale-navigation'), false);
    assert.equal(ownership.release(7, 'nav-a'), true);
});

test('subtitles observed after launch are marked as late job updates', () => {
    const ownership = new MultiModeCaptureOwnership(() => 1000);
    ownership.register({ tabId: 2, jobId: 'job', navigationId: 'nav', pageUrl: 'https://example.test' });
    ownership.arm(2, 'https://example.test');
    ownership.recordManifest(2, { type: 'DASH', url: 'https://cdn.test/manifest.mpd' });
    ownership.createReadyCapture(2);
    const result = ownership.recordSubtitle(2, { url: 'https://cdn.test/fr.vtt', language: 'fr' });
    assert.equal(result.added, true);
    assert.equal(result.late, true);
});

test('a protected capture can retain its result until the manifest arrives', () => {
    const ownership = new MultiModeCaptureOwnership(() => 1000);
    const state = ownership.register({ tabId: 3, jobId: 'job', navigationId: 'nav', pageUrl: 'https://example.test' });
    ownership.arm(3, 'https://example.test');
    ownership.markProtected(3);
    state.protectedResult = { keys: [{ kid: 'aa', k: 'bb' }], pssh: 'pssh' };
    assert.equal(ownership.createReadyCapture(3, state.protectedResult), null);
    ownership.recordManifest(3, { type: 'DASH', url: 'https://cdn.test/manifest.mpd' });
    const ready = ownership.createReadyCapture(3, state.protectedResult);
    assert.deepEqual(ready.capture.keys, [{ kid: 'aa', k: 'bb' }]);
    assert.equal(ready.capture.pssh, 'pssh');
});

test('protected capture keys are paired only with a manifest carrying the same PSSH', () => {
    const ownership = new MultiModeCaptureOwnership(() => 1000);
    ownership.register({ tabId: 13, jobId: 'job', navigationId: 'nav', pageUrl: 'https://www.crunchyroll.com/watch/TEST' });
    ownership.arm(13, 'https://www.crunchyroll.com/watch/TEST');
    ownership.markProtected(13);
    ownership.recordManifest(13, {
        type: 'DASH', url: 'https://www.crunchyroll.com/playback/old/cenc/manifest.mpd',
        psshValues: ['old-pssh'], headers: { Authorization: 'old', Cookie: 'old', Referer: 'https://www.crunchyroll.com/watch/TEST' },
    });
    ownership.recordManifest(13, {
        type: 'DASH', url: 'https://www.crunchyroll.com/playback/current/cenc/manifest.mpd',
        psshValues: ['current-pssh'], headers: { Authorization: 'current', Cookie: 'current', Referer: 'https://www.crunchyroll.com/watch/TEST' },
    });
    const ready = ownership.createReadyCapture(13, {
        keys: [{ kid: 'aa', k: 'bb' }], pssh: 'current-pssh',
    });
    assert.equal(ready.capture.manifest.url, 'https://www.crunchyroll.com/playback/current/cenc/manifest.mpd');

    const mismatch = new MultiModeCaptureOwnership(() => 1000);
    mismatch.register({ tabId: 14, jobId: 'job', navigationId: 'nav', pageUrl: 'https://example.test/watch' });
    mismatch.arm(14, 'https://example.test/watch');
    mismatch.markProtected(14);
    mismatch.recordManifest(14, { type: 'DASH', url: 'https://cdn.test/old.mpd', psshValues: ['old-pssh'] });
    assert.equal(mismatch.createReadyCapture(14, { keys: [{ kid: 'aa', k: 'bb' }], pssh: 'new-pssh' }), null);
});

test('protected captures cannot launch without a usable content key', () => {
    const ownership = new MultiModeCaptureOwnership(() => 1000);
    ownership.register({ tabId: 5, jobId: 'job', navigationId: 'nav', pageUrl: 'https://example.test/watch' });
    ownership.arm(5, 'https://example.test/watch');
    ownership.markProtected(5);
    ownership.recordManifest(5, { type: 'DASH', url: 'https://cdn.test/manifest.mpd' });
    assert.equal(ownership.createReadyCapture(5, { keys: [] }), null);
    assert.equal(ownership.get(5).readySent, false);
});

test('Crunchyroll cenc manifests are identified before the public-media timer can win', () => {
    assert.equal(isCrunchyrollProtectedManifest(
        'https://www.crunchyroll.com/playback/v2/manifest/GE00362091ENUS/static/title/enus/cenc/dash/manifest.mpd',
    ), true);
    assert.equal(isCrunchyrollProtectedManifest(
        'https://www.crunchyroll.com/playback/v2/manifest/GE00362091ENUS/static/title/enus/clear/hls/master.m3u8',
    ), false);
    assert.equal(isCrunchyrollProtectedManifest('https://cdn.example.test/cenc/manifest.mpd'), false);
});

test('manifest retries accumulate newer headers without losing earlier values', () => {
    assert.deepEqual(
        mergeCaptureHeaders(
            { Accept: '*/*', Authorization: 'old-token' },
            { authorization: 'fresh-token', Cookie: 'session=one' },
        ),
        { Accept: '*/*', authorization: 'fresh-token', Cookie: 'session=one' },
    );
});

test('Crunchyroll dispatch uses the exact watch page as Referer and requires complete headers', () => {
    const watchUrl = 'https://www.crunchyroll.com/watch/GE00362091ENUS/episode-title';
    const manifest = {
        type: 'DASH',
        url: 'https://www.crunchyroll.com/playback/v2/manifest/GE00362091ENUS/manifest.mpd?token=fresh',
        headers: { Authorization: 'Bearer fresh', Cookie: 'session=one' },
    };
    assert.equal(hasRequiredProtectedHeaders(manifest, watchUrl), false);
    const prepared = prepareManifestForDispatch(manifest, watchUrl);
    assert.equal(prepared.headers.Referer, watchUrl);
    assert.equal(hasRequiredProtectedHeaders(prepared, watchUrl), true);

    const ownership = new MultiModeCaptureOwnership(() => 1000);
    ownership.register({ tabId: 6, jobId: 'job', navigationId: 'nav', pageUrl: watchUrl });
    ownership.arm(6, watchUrl);
    ownership.markProtected(6);
    ownership.recordManifest(6, prepared);
    const ready = ownership.createReadyCapture(6, { keys: [{ kid: 'aa', k: 'bb' }] });
    assert.equal(ready.capture.manifest.headers.Referer, watchUrl);
    assert.deepEqual(ready.capture.keys, [{ kid: 'aa', k: 'bb' }]);
});

test('a registered capture ignores stale requests until the new navigation begins', () => {
    const ownership = new MultiModeCaptureOwnership(() => 1000);
    ownership.register({ tabId: 4, jobId: 'new-job', navigationId: 'new-nav', pageUrl: 'https://example.test/new' });
    assert.equal(ownership.recordManifest(4, { type: 'DASH', url: 'https://cdn.test/old.mpd' }), null);
    ownership.arm(4, 'https://example.test/new');
    ownership.recordManifest(4, { type: 'DASH', url: 'https://cdn.test/new.mpd' });
    assert.equal(ownership.bestManifest(4).url, 'https://cdn.test/new.mpd');
});

test('automatic providers keep catalogue discovery inside the extension', async () => {
    assert.deepEqual(getRegisteredProviderIds(), [
        'amazon-prime',
        'bbciplayer',
        'crunchyroll',
        'disneyplus',
        'max',
        'pbs-kids',
        'paramountplus',
    ]);
    const adapterSource = readFileSync(new URL('../multi-mode/providers/crunchyroll.mjs', import.meta.url), 'utf8');
    assert.match(adapterSource, /async function discoverCrunchyrollCatalog/);
    assert.doesNotMatch(adapterSource, /companion\.request\('discover_provider'/);
    assert.equal(await discoverProviderCatalog('https://example.test/series/GTEST'), null);
    assert.equal(crunchyrollAdapter.matches(new URL('https://www.crunchyroll.com/en-gb/series/GTEST')), true);
    assert.equal(disneyPlusAdapter.matches(new URL('https://www.disneyplus.com/browse/entity-2e025d27-260e-48ce-a038-c87707de8e9e')), true);
    assert.equal(hboMaxAdapter.matches(new URL('https://www.hbomax.com/show/9f4a2d0c-1111-4222-8333-abcdefabcdef')), true);
    assert.equal(bbcIPlayerAdapter.matches(new URL('https://www.bbc.co.uk/iplayer/episodes/b006m8dq')), true);
    assert.equal(pbsKidsAdapter.matches(new URL('https://pbskids.org/videos/wild-kratts')), true);
    assert.equal(pbsKidsAdapter.matches(new URL('https://pbskids.org/videos/playlist/wild-kratts-full-episodes/1385807')), true);
    assert.equal(pbsKidsAdapter.matches(new URL('https://pbskids.org/videos/watch/wild-kratts-full-episodes/1385807/duck-duck-loon/2756856')), true);
});

test('BBC iPlayer discovery uses public episode PIDs and the normal Queue picker shape', async () => {
    const originalFetch = globalThis.fetch;
    const brandPid = 'b006m8dq';
    const episodePids = ['m002abc1', 'm002abc2'];
    const brand = { pid: brandPid, type: 'brand', title: 'Example BBC Programme' };
    const records = {
        [brandPid]: brand,
        [episodePids[0]]: {
            pid: episodePids[0], type: 'episode', media_type: 'audio_video', position: 1,
            title: 'Episode One', medium_synopsis: 'The first episode.', first_broadcast_date: '2026-01-01',
            parent: { programme: { pid: 'p000s001', type: 'series', title: 'Series 1', position: 1, parent: { programme: brand } } },
        },
        [episodePids[1]]: {
            pid: episodePids[1], type: 'episode', media_type: 'audio_video', position: 2,
            title: 'Episode Two', medium_synopsis: 'The second episode.', first_broadcast_date: '2026-01-08',
            parent: { programme: { pid: 'p000s001', type: 'series', title: 'Series 1', position: 1, parent: { programme: brand } } },
        },
    };
    const catalogue = `<meta property="og:image" content="https://img.test/bbc.jpg">
        <div data-bbc-result="p000s009">Season 9</div>
        <a href="/iplayer/episode/${episodePids[0]}/episode-one">Episode One</a>
        <a href="/iplayer/episode/${episodePids[1]}/episode-two">Episode Two</a>`;
    globalThis.fetch = async (input) => {
        const url = String(input);
        const match = url.match(/\/programmes\/([a-z0-9]{8})\.json$/i);
        const body = match ? JSON.stringify({ programme: records[match[1]] }) : catalogue;
        return { ok: Boolean(match ? records[match[1]] : url === `https://www.bbc.co.uk/iplayer/episodes/${brandPid}`), status: 200, async text() { return body; } };
    };
    try {
        const catalog = await discoverBBCIPlayerCatalog(new URL(`https://www.bbc.co.uk/iplayer/episodes/${brandPid}`));
        assert.equal(catalog.provider, 'bbciplayer');
        assert.equal(catalog.seriesTitle, 'Example BBC Programme');
        assert.equal(catalog.seriesPosterUrl, 'https://img.test/bbc.jpg');
        assert.equal(catalog.seriesEpisodeCount, 2);
        assert.deepEqual(catalog.seasons[0].episodes.map((episode) => [episode.episodeNumber, episode.title]), [[1, 'Episode One'], [2, 'Episode Two']]);
        const jobs = buildBatchJobs(catalog, {
            ...DEFAULT_MULTI_MODE_SETTINGS,
            destination: '/tmp/BBC iPlayer',
            bbciplayer: { projectFolder: '/Applications/iPlayer Getter', quality: 'hd', subtitles: true },
            metadata: { enabled: true, getter: 'mme', projectFolder: '/tmp/MME' },
        });
        assert.equal(jobs.length, 2);
        assert.ok(jobs.every((job) => job.executionMode === 'local-command'));
        assert.ok(jobs.every((job) => job.metadata.enabled === false && job.backendHandlesMetadata));
        const command = buildQueueLocalCommand(jobs[0]);
        assert.match(command, /bbc_iplayer_tool\.py/);
        assert.match(command, /--quality 'hd'/);
        assert.match(command, /--download "\$mediafab_bbc_queue"/);
        assert.match(command, new RegExp(episodePids[0]));
        assert.doesNotMatch(command, /media_metadata_and_extras_getter\.py/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('BBC iPlayer normal command requires an exact episode link and preserves the selected destination', () => {
    const command = buildBBCIPlayerCommand(
        'https://www.bbc.co.uk/iplayer/episode/m002abc1/example',
        '/Users/test/Downloads/BBC iPlayer',
        { projectFolder: '/Users/test/iPlayer Media and Extras Getter', quality: 'sd', subtitles: false },
    );
    assert.match(command, /--output '\/Users\/test\/Downloads\/BBC iPlayer'/);
    assert.match(command, /--no-subtitles/);
    assert.throws(
        () => buildBBCIPlayerCommand('https://www.bbc.co.uk/iplayer/episodes/b006m8dq', '/tmp/BBC', { projectFolder: '/tmp/iPlayer' }),
        /exact \/iplayer\/episode\//,
    );
});

test('extension-owned HBO Max discovery builds the normal season and episode picker with exact UUID playback links', async () => {
    const originalFetch = globalThis.fetch;
    const showId = '9f4a2d0c-1111-4222-8333-abcdefabcdef';
    const episodes = [
        {
            hbomaxId: 'ep-one', episodeNumber: 1,
            episodeUrl: '/video/watch/11111111-1111-4111-8111-111111111111',
            title: { full: 'First Episode' }, summary: { full: 'The first story.' },
            images: { default: 'https://img.test/one.jpg' },
        },
        {
            hbomaxId: 'ep-two', episodeNumber: 2,
            episodeUrl: '/video/watch/22222222-2222-4222-8222-222222222222',
            title: { full: 'Second Episode' }, summary: { full: 'The second story.' },
            images: { default: 'https://img.test/two.jpg' },
        },
    ];
    const record = {
        hbomaxId: showId,
        title: { full: 'Example Max Series' },
        summary: { full: 'A complete example series.' },
        images: { 'cover-artwork': 'https://img.test/poster.jpg' },
        releaseYear: 2025,
        localizedRating: { classifier: 'TV-14' },
        genres: ['Drama'],
        seasons: [{ seasonNumber: 1, numberOfEpisodes: 2, episodes }],
    };
    const page = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: { pageProps: { mappedData: { show: JSON.stringify(record) } } },
    })}</script>`;
    globalThis.fetch = async (input) => ({
        ok: String(input) === `https://www.hbomax.com/show/${showId}`,
        status: 200,
        async text() { return page; },
    });
    try {
        const catalog = await discoverHBOMaxCatalog(new URL(`https://www.hbomax.com/show/${showId}`));
        assert.equal(catalog.provider, 'max');
        assert.equal(catalog.seriesTitle, 'Example Max Series');
        assert.equal(catalog.seriesPosterUrl, 'https://img.test/poster.jpg');
        assert.equal(catalog.seriesSeasonCount, 1);
        assert.equal(catalog.seriesEpisodeCount, 2);
        assert.deepEqual(catalog.seasons[0].episodes.map((episode) => [
            episode.episodeNumber, episode.title, episode.playbackUrl, episode.detailUrl,
        ]), [
            [1, 'First Episode', 'https://play.hbomax.com/video/watch/11111111-1111-4111-8111-111111111111', `https://www.hbomax.com/show/${showId}`],
            [2, 'Second Episode', 'https://play.hbomax.com/video/watch/22222222-2222-4222-8222-222222222222', `https://www.hbomax.com/show/${showId}`],
        ]);
        const jobs = buildBatchJobs(catalog, {
            ...DEFAULT_MULTI_MODE_SETTINGS,
            destination: '/tmp/HBO Max',
            metadata: { enabled: true, getter: 'mme', projectFolder: '/tmp/MME' },
        });
        assert.equal(jobs.length, 2);
        assert.equal(jobs[0].detailUrl, catalog.seasons[0].episodes[0].detailUrl);
        assert.equal(jobs[1].detailUrl, catalog.seasons[0].episodes[1].detailUrl);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('extension-owned Crunchyroll discovery builds the series and episode catalogue', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    const payloads = new Map([
        ['token', { access_token: 'test-token', expires_in: 3600 }],
        ['/content/v2/cms/objects/GSERIES', { data: [{
            title: 'Test Show',
            description: 'A test series.',
            images: { poster_tall: [[{ source: 'https://img.test/poster.jpg', width: 600, height: 900 }]] },
            series_metadata: { series_launch_year: 2024, tenant_categories: ['Anime'] },
        }] }],
        ['/content/v2/cms/series/GSERIES', { data: [{ title: 'Test Show', series_launch_year: 2024 }] }],
        ['/content/v2/cms/series/GSERIES/seasons', { data: [{
            id: 'SEASON1', season_number: 1, title: 'Season 1', versions: [{ guid: 'SEASON1', original: true }],
        }] }],
        ['/content/v2/cms/seasons/SEASON1/episodes', { data: [{
            id: 'EPISODE1', episode_number: 1, title: 'Pilot', slug_title: 'pilot',
            duration_ms: 1_440_000,
            versions: [{ guid: 'EPISODE1', audio_locale: 'en-US' }],
            images: { thumbnail: [[{ source: 'https://img.test/episode.jpg', width: 640, height: 360 }]] },
        }] }],
    ]);
    globalThis.fetch = async (input, options = {}) => {
        requests.push({ input: String(input), options });
        const url = String(input);
        const key = url.includes('/auth/v1/token')
            ? 'token'
            : [...payloads.keys()]
                .filter((candidate) => candidate !== 'token')
                .sort((left, right) => right.length - left.length)
                .find((candidate) => url.includes(candidate));
        return {
            ok: Boolean(key),
            status: key ? 200 : 404,
            async json() { return payloads.get(key); },
        };
    };
    try {
        const catalog = await discoverCrunchyrollCatalog(new URL('https://www.crunchyroll.com/series/GSERIES/test-show'));
        assert.equal(catalog.seriesTitle, 'Test Show');
        assert.equal(catalog.seasons[0].episodes[0].playbackUrl, 'https://www.crunchyroll.com/watch/EPISODE1/pilot');
        assert.equal(catalog.seriesPosterUrl, 'https://img.test/poster.jpg');
        assert.ok(requests.every((request) => request.options.headers.Accept === 'application/json'));
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('extension-owned Disney+ discovery builds every public season and episode', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    const first = {
        _id: 'ad5f6c58-8513-4de1-8420-350ce867ffdd',
        title: 'S1:E1 Taxi',
        imageVariants: { defaultImage: { ripcutId: 'thumb-one' } },
        metadata: { summary: 'Description for Taxi.' },
    };
    const second = {
        _id: 'a1e78cb3-2704-4fa2-bf6a-ef0de2d3a233',
        title: 'S2:E1 Grannies',
        imageVariants: { defaultImage: { source: 'https://img.test/grannies.webp' } },
        metadata: { summary: 'Description for Grannies.' },
    };
    const data = { props: { pageProps: { stitchDocument: { mainContent: [
        {
            _type: 'DetailEntityHero', releaseYear: '2024 - Present',
            synopsisText: 'A Disney series.', genres: ['Animation', 'Family'],
            detailIcons: [{ alt: 'TV-Y' }],
            backgroundImage: { defaultImage: { source: 'https://img.test/backdrop.webp' } },
        },
        { _type: 'MediaDetails', title: 'Test Disney Show', summary: 'The full series summary.', release: '2024 - Present' },
        {
            _type: 'Episodes', seriesTitle: 'Test Disney Show', episodes: [second],
            seoSeasons: [{ seasonId: 'one', seasonName: 'Season 1', episodes: [first] }],
        },
        { _type: 'Metadata', metaTags: [
            { property: 'og:title', content: 'Test Disney Show | Watch Full Episodes | Disney+' },
            { property: 'og:image', content: 'https://img.test/social.webp' },
            { property: 'og:url', content: 'https://www.disneyplus.com/browse/entity-2e025d27-260e-48ce-a038-c87707de8e9e' },
        ] },
    ] } } } };
    globalThis.fetch = async (input, options) => {
        requests.push({ input: String(input), options });
        return {
            ok: true,
            status: 200,
            async text() {
                return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`;
            },
        };
    };
    try {
        const catalog = await discoverDisneyPlusCatalog(new URL(
            'https://www.disneyplus.com/browse/entity-2e025d27-260e-48ce-a038-c87707de8e9e'
        ));
        assert.equal(catalog.provider, 'disneyplus');
        assert.equal(catalog.seriesTitle, 'Test Disney Show');
        assert.equal(catalog.seriesPosterUrl, 'https://img.test/social.webp');
        assert.equal(catalog.seriesSeasonCount, 2);
        assert.equal(catalog.seriesEpisodeCount, 2);
        assert.equal(catalog.seasons[0].episodes[0].playbackUrl, 'https://www.disneyplus.com/play/ad5f6c58-8513-4de1-8420-350ce867ffdd');
        assert.match(catalog.seasons[0].episodes[0].thumbnailUrl, /thumb-one/);
        assert.equal(catalog.seasons[1].episodes[0].thumbnailUrl, 'https://img.test/grannies.webp');
        assert.equal(requests[0].options.credentials, 'omit');
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('extension-owned PBS KIDS discovery resolves every supported link to the current full-episode guide', async () => {
    const originalFetch = globalThis.fetch;
    const property = {
        slug: 'wild-kratts',
        title: 'Wild Kratts',
        mezzanine: [{ url: 'https://img.test/wild-kratts-card.jpg' }],
    };
    const entries = [
        {
            id: '2756856', slug: 'duck-duck-loon', title: 'Duck, Duck, Loon!', videoType: 'fullEpisode',
            mediaManagerAsset: { duration: 1585, description_short: 'A baby loon needs help.' },
            properties: [property],
        },
        {
            id: '2703471', slug: 'butternut-tree', title: 'Butternut Tree', videoType: 'fullEpisode',
            mediaManagerAsset: { duration: 1585, description_short: 'The brothers find a rare seedling.' },
            properties: [property],
        },
    ];
    const collection = {
        id: '1385807', slug: 'wild-kratts-full-episodes', entries, properties: [property],
    };
    const nextPage = (props) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: props } })}</script>`;
    const watchPage = (entry, seasonNumber, episodeNumber) => nextPage({
        videoData: {
            ...entry,
            mediaManagerAsset: {
                ...entry.mediaManagerAsset,
                season_number: seasonNumber,
                episode_number: episodeNumber,
                images: [{ profile: 'asset-kids-mezzanine1-16x9', image: `https://img.test/${entry.id}.png` }],
            },
        },
        videoDescription: entry.mediaManagerAsset.description_short,
        contextData: { id: collection.id, slug: collection.slug },
        pageProperty: property,
    });
    const pages = new Map([
        ['https://pbskids.org/videos/wild-kratts', nextPage({
            pageDescription: 'A wildlife adventure series.',
            pageProperty: property,
            pageData: { bodyContentModules: [{ heading: 'Episodes', collection: [collection] }] },
        })],
        ['https://pbskids.org/videos/playlist/wild-kratts-full-episodes/1385807', nextPage({
            collectionData: collection,
            pageProperty: property,
        })],
        ['https://pbskids.org/videos/watch/wild-kratts-full-episodes/1385807/duck-duck-loon/2756856', watchPage(entries[0], 7, 17)],
        ['https://pbskids.org/videos/watch/wild-kratts-full-episodes/1385807/butternut-tree/2703471', watchPage(entries[1], 7, 16)],
    ]);
    globalThis.fetch = async (input, options) => ({
        ok: pages.has(String(input)),
        status: pages.has(String(input)) ? 200 : 404,
        async text() { return pages.get(String(input)) || ''; },
        options,
    });
    try {
        for (const input of [
            'https://pbskids.org/videos/wild-kratts',
            'https://pbskids.org/videos/playlist/wild-kratts-full-episodes/1385807',
            'https://pbskids.org/videos/watch/wild-kratts-full-episodes/1385807/duck-duck-loon/2756856',
        ]) {
            const catalog = await discoverPBSKidsCatalog(new URL(input));
            assert.equal(catalog.provider, 'pbs-kids');
            assert.equal(catalog.seriesTitle, 'Wild Kratts');
            assert.equal(catalog.seriesPosterUrl, 'https://img.test/wild-kratts-card.jpg');
            assert.equal(catalog.seriesArtworkShape, 'landscape');
            assert.equal(catalog.seriesSeasonCount, 1);
            assert.equal(catalog.seriesEpisodeCount, 2);
            assert.deepEqual(
                catalog.seasons[0].episodes.map((episode) => [episode.episodeNumber, episode.title]),
                [[16, 'Butternut Tree'], [17, 'Duck, Duck, Loon!']],
            );
            assert.equal(
                catalog.seasons[0].episodes[1].playbackUrl,
                'https://pbskids.org/videos/watch/wild-kratts-full-episodes/1385807/duck-duck-loon/2756856',
            );
        }
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('metadata handoff prioritizes a current Crunchyroll episode and preserves other-provider manual links', () => {
    const crunchyroll = 'https://www.crunchyroll.com/watch/GE00362087ENUS/episode-title';
    const localizedCrunchyroll = 'https://www.crunchyroll.com/en-gb/watch/GE00362087ENUS/episode-title';
    const broadwayHD = 'https://www.broadwayhd.com/video/12345';
    assert.equal(getCrunchyrollDetailLink(crunchyroll), crunchyroll);
    assert.equal(getCrunchyrollDetailLink(localizedCrunchyroll), localizedCrunchyroll);
    assert.equal(getCrunchyrollDetailLink('https://www.crunchyroll.com/series/GTEST/show'), '');
    assert.equal(getBroadwayHDDetailLink(broadwayHD), broadwayHD);
    assert.equal(resolveMMEDetailLink({ detailLink: '' }, crunchyroll), crunchyroll);
    assert.equal(resolveLPMAEGDetailLink({ detailLink: '' }, broadwayHD), broadwayHD);
    assert.equal(resolveMMEDetailLink({ detailLink: 'https://www.crunchyroll.com/series/GTEST/show' }, crunchyroll), crunchyroll);
    assert.equal(
        resolveMMEDetailLink({
            detailLink: 'https://manual.example/item',
            preferDetailLinkOverride: true,
        }, 'https://provider.example/play/1'),
        'https://manual.example/item',
    );
});

test('Queue Mode keeps a separately supplied per-item detail link as an explicit override', () => {
    const catalog = createManualLinkCatalog([{
        playbackUrl: 'https://provider.example/play/1',
        detailUrl: 'https://provider.example/detail/1',
    }]);
    const [job] = buildBatchJobs(catalog, {
        ...DEFAULT_MULTI_MODE_SETTINGS,
        destination: '/tmp/MediaFab',
        metadata: { enabled: true, getter: 'mme', projectFolder: '/tmp/MME', detailLink: '' },
    });
    assert.equal(job.detailLinkIsOverride, true);
    const command = buildQueueMediaCommand(job, {
        manifest: { url: 'https://cdn.example/media.m3u8', headers: {}, type: 'HLS_PLAYLIST' },
        keys: [],
        subtitles: [],
    });
    assert.match(command, /--detail-link 'https:\/\/provider\.example\/detail\/1'/);
});
