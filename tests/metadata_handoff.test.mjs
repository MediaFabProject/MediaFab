import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createLPMAEGHandoffCommand,
    createMMEHandoffCommand,
    createCrunchyrollDownloadMarkerCommand,
    createCrunchyrollMediaResolutionCommand,
    createCrunchyrollTemporarySaveNameArgument,
    createProviderIdentitySaveNameArgument,
    getCrunchyrollDetailLink,
    getDisneyPlusEpisodeDetailLink,
    getMaxCanonicalMetadataLink,
    getPBSKidsEpisodeDetailLink,
    resolveLPMAEGDetailLink,
    resolveMMEDetailLink,
} from '../panel/metadata-links.mjs';


const WATCH_URL = 'https://www.crunchyroll.com/watch/GE00362087ENUS/episode-title';
const SERIES_URL = 'https://www.crunchyroll.com/series/GW4HM7WQ5/show-title';
const DISNEY_EPISODE_URL = 'https://www.disneyplus.com/play/ad5f6c58-8513-4de1-8420-350ce867ffdd';
const PBS_KIDS_EPISODE_URL = 'https://pbskids.org/videos/watch/wild-kratts-full-episodes/1385807/duck-duck-loon/2756856';

test('Crunchyroll watch page becomes the Media Metadata and Extras Getter detail link', () => {
    const command = createMMEHandoffCommand({
        detailLink: '',
        projectFolder: '/Users/test/Media Metadata and Extras Getter',
    }, '/Volumes/Media/Show', WATCH_URL);

    assert.match(command, new RegExp(`--detail-link '${WATCH_URL}'`));
    assert.match(command, /--media-folder "\$mediafab_media_file"/);
    const marker = createCrunchyrollDownloadMarkerCommand('/Volumes/Media/Show');
    const resolution = createCrunchyrollMediaResolutionCommand('/Volumes/Media/Show');
    assert.match(marker, /mktemp '\/Volumes\/Media\/Show\/\.widevineproxy2-download\.XXXXXX'/);
    assert.match(resolution, /-newer "\$mediafab_download_marker"/);
    assert.match(resolution, /mediafab_media_file="\$\{mediafab_media_files\[1\]\}"/);
    assert.equal(
        createCrunchyrollTemporarySaveNameArgument(WATCH_URL, '-M format=mkv', "'"),
        '--save-name "crunchyroll-GE00362087ENUS-${mediafab_download_marker:t}"',
    );
    assert.equal(
        createCrunchyrollTemporarySaveNameArgument(WATCH_URL, '--save-name mine', "'"),
        '',
    );
});

test('the optional individual detail link deliberately overrides the current page', () => {
    const config = { detailLink: SERIES_URL, projectFolder: '/Users/test/MME', preferDetailLinkOverride: true };
    assert.equal(resolveMMEDetailLink(config, WATCH_URL), SERIES_URL);
    const command = createMMEHandoffCommand(config, '.', WATCH_URL);
    assert.match(command, new RegExp(`--detail-link '${SERIES_URL}'`));
});

test('Disney+ play page becomes an exact-file MME episode handoff', () => {
    assert.equal(getDisneyPlusEpisodeDetailLink(DISNEY_EPISODE_URL), DISNEY_EPISODE_URL);
    assert.equal(
        resolveMMEDetailLink({ detailLink: 'https://www.disneyplus.com/browse/entity-series' }, DISNEY_EPISODE_URL),
        DISNEY_EPISODE_URL,
    );
    const command = createMMEHandoffCommand({
        detailLink: '',
        projectFolder: '/Users/test/MME',
    }, '/Volumes/Media/Disney', DISNEY_EPISODE_URL);
    assert.match(command, new RegExp(`--detail-link '${DISNEY_EPISODE_URL}'`));
    assert.match(command, /--media-folder "\$mediafab_media_file"/);
});

test('PBS KIDS watch page becomes an exact-file MME episode handoff', () => {
    assert.equal(getPBSKidsEpisodeDetailLink(PBS_KIDS_EPISODE_URL), PBS_KIDS_EPISODE_URL);
    assert.equal(
        resolveMMEDetailLink({ detailLink: 'https://manual.example/series' }, PBS_KIDS_EPISODE_URL),
        PBS_KIDS_EPISODE_URL,
    );
    const command = createMMEHandoffCommand({
        detailLink: '',
        projectFolder: '/Users/test/MME',
    }, '/Volumes/Media/PBS KIDS', PBS_KIDS_EPISODE_URL);
    assert.match(command, new RegExp(`--detail-link '${PBS_KIDS_EPISODE_URL}'`));
    assert.match(command, /--media-folder "\$mediafab_media_file"/);
});

test('HBO Max prefers its canonical show link but never requires a manual detail-link override', () => {
    const player = 'https://play.hbomax.com/video/watch/9f4a2d0c-1111-4222-8333-abcdefabcdef';
    const detail = 'https://www.hbomax.com/show/11111111-2222-4333-8444-555555555555';
    assert.equal(resolveMMEDetailLink({ detailLink: '' }, player), player);
    const command = createMMEHandoffCommand({
        detailLink: detail, projectFolder: '/Users/test/MME',
    }, '/Volumes/Media/HBO Max', player);
    assert.match(command, new RegExp(`--detail-link '${detail}'`));
    assert.doesNotMatch(command, new RegExp(player));
    assert.match(command, /--media-folder "\$mediafab_media_file"/);
    assert.match(createProviderIdentitySaveNameArgument(player, ''), /max-9f4a2d0c-1111-4222-8333-abcdefabcdef/);
});

test('HBO Max accepts a canonical movie page for an automatic metadata handoff', () => {
    const player = 'https://play.hbomax.com/video/watch/ec4b60ac-0a79-447e-8816-c775bf645acc';
    const movie = 'https://www.hbomax.com/movie/fad09d13-9973-4de6-9387-8698ba6ef4cf';
    assert.equal(getMaxCanonicalMetadataLink(movie), movie);
    assert.equal(resolveMMEDetailLink({
        detailLink: movie,
        preferDetailLinkOverride: true,
    }, player), movie);
});

test('Amazon Prime metadata uses its current provider page when captured episode identity is unavailable', () => {
    const page = 'https://www.primevideo.com/detail/B0SERIES123/example';
    const canonicalPage = 'https://www.primevideo.com/region/na/detail/B0SERIES123';
    assert.equal(resolveMMEDetailLink({ detailLink: '' }, page), canonicalPage);
    const command = createMMEHandoffCommand({
        detailLink: '', projectFolder: '/Users/test/MME',
    }, '/Volumes/Media/Prime', page);
    assert.match(command, new RegExp(`--detail-link '${canonicalPage}'`));
    assert.match(createProviderIdentitySaveNameArgument(page, ''), /primevideo-B0SERIES123/);
});

test('provider identities are forced into completed names before metadata runs', () => {
    const cases = [
        ['https://www.crunchyroll.com/watch/GE00362087ENUS/title', '', 'crunchyroll-GE00362087ENUS'],
        ['https://www.disneyplus.com/play/ad5f6c58-8513-4de1-8420-350ce867ffdd', '', 'disneyplus-ad5f6c58-8513-4de1-8420-350ce867ffdd'],
        ['https://www.max.com/video/watch/9f4a2d0c-1111-4222-8333-abcdefabcdef', '', 'max-9f4a2d0c-1111-4222-8333-abcdefabcdef'],
        ['https://www.paramountplus.com/shows/video/6QE2xkf21fv_5lVwo9oYtGPaQ5KWCnYb/', '', 'paramountplus-6QE2xkf21fv_5lVwo9oYtGPaQ5KWCnYb'],
        ['https://pbskids.org/videos/watch/wild-kratts-full-episodes/1385807/duck-duck-loon/2756856', '', 'pbskids-2756856'],
        ['https://www.bbc.co.uk/iplayer/episode/m002abcd/example', '', 'bbciplayer-m002abcd'],
        ['https://www.netflix.com/watch/81234567', '', 'netflix-81234567'],
        ['https://www.primevideo.com/detail/B0SERIES123', 'https://www.primevideo.com/detail/B0EPISODE45', 'primevideo-B0EPISODE45'],
    ];
    for (const [pageUrl, primeEpisodeUrl, expected] of cases) {
        const argument = createProviderIdentitySaveNameArgument(pageUrl, primeEpisodeUrl);
        assert.match(argument, new RegExp(`mediafab-${expected}-`));
        assert.match(argument, /\$\{mediafab_download_marker:t\}/);
        assert.doesNotMatch(argument, /S\d+E\d+|runtime|duration|timestamp/i);
    }
});

test('Crunchyroll series page is not automatically treated as an episode detail link', () => {
    assert.equal(getCrunchyrollDetailLink(SERIES_URL), '');
    assert.equal(resolveMMEDetailLink({ detailLink: '' }, SERIES_URL), SERIES_URL);
    assert.equal(
        resolveMMEDetailLink({
            detailLink: 'https://provider.example/detail/1',
            preferDetailLinkOverride: true,
        }, 'https://provider.example/play/1'),
        'https://provider.example/detail/1',
    );
});

test('BroadwayHD automatic LPMAEG behavior and manual precedence remain unchanged', () => {
    const broadwayHD = 'https://www.broadwayhd.com/video/12345';
    assert.equal(resolveLPMAEGDetailLink({ detailLink: '' }, broadwayHD), broadwayHD);
    assert.equal(
        resolveLPMAEGDetailLink({ detailLink: 'https://manual.example/performance' }, broadwayHD),
        'https://manual.example/performance',
    );
    const command = createLPMAEGHandoffCommand({ detailLink: '', projectFolder: '/Users/test/LPMAEG' }, '.', broadwayHD);
    assert.match(command, new RegExp(`--detail-link '${broadwayHD}'`));
});
