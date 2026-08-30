import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createLPMAEGHandoffCommand,
    createMMEHandoffCommand,
    createCrunchyrollDownloadMarkerCommand,
    createCrunchyrollMediaResolutionCommand,
    createCrunchyrollTemporarySaveNameArgument,
    getCrunchyrollDetailLink,
    getDisneyPlusEpisodeDetailLink,
    resolveLPMAEGDetailLink,
    resolveMMEDetailLink,
} from '../panel/metadata-links.mjs';


const WATCH_URL = 'https://www.crunchyroll.com/watch/GE00362087ENUS/episode-title';
const SERIES_URL = 'https://www.crunchyroll.com/series/GW4HM7WQ5/show-title';
const DISNEY_EPISODE_URL = 'https://www.disneyplus.com/play/ad5f6c58-8513-4de1-8420-350ce867ffdd';

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

test('current Crunchyroll watch page overrides a stored Crunchyroll series link', () => {
    const config = { detailLink: SERIES_URL, projectFolder: '/Users/test/MME' };
    assert.equal(resolveMMEDetailLink(config, WATCH_URL), WATCH_URL);
    const command = createMMEHandoffCommand(config, '.', WATCH_URL);
    assert.match(command, new RegExp(`--detail-link '${WATCH_URL}'`));
    assert.doesNotMatch(command, new RegExp(SERIES_URL));
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

test('Crunchyroll series page is not automatically treated as an episode detail link', () => {
    assert.equal(getCrunchyrollDetailLink(SERIES_URL), '');
    assert.equal(resolveMMEDetailLink({ detailLink: '' }, SERIES_URL), '');
    assert.equal(
        resolveMMEDetailLink({ detailLink: 'https://provider.example/detail/1' }, 'https://provider.example/play/1'),
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
