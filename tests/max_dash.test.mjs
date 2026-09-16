import test from 'node:test';
import assert from 'node:assert/strict';

import { inspectMaxDashManifest, selectMaxManifestForKeys } from '../multi-mode/max-dash.mjs';
import { createMaxTrackArguments } from '../panel/command-builder.mjs';

const fixture = `
<MPD xmlns:cenc="urn:mpeg:cenc:2013">
  <Period id="ad" duration="PT1M">
    <AdaptationSet contentType="video" maxWidth="1920"><Representation id="ad-video" width="1920"/></AdaptationSet>
  </Period>
  <Period id="programme-42" duration="PT1H45M26S">
    <AdaptationSet contentType="audio" lang="en-US">
      <ContentProtection cenc:default_KID="010059ae-ffe3-f149-53c5-0edbe560719f"/>
      <Representation id="a2"/>
    </AdaptationSet>
    <AdaptationSet contentType="audio" lang="en-US">
      <ContentProtection cenc:default_KID="010059ae-ffe3-f149-53c5-0edbe560719f"/>
      <Accessibility value="1"/><Role value="alternate"/><Representation id="a3"/>
    </AdaptationSet>
    <AdaptationSet contentType="video" maxWidth="1024">
      <ContentProtection cenc:default_KID="010121e8-ae9c-8a85-967d-26fa72a06758"/>
      <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"><cenc:pssh>PROGRAMME_PSSH</cenc:pssh></ContentProtection>
      <Representation id="v6" width="1024"/>
    </AdaptationSet>
    <AdaptationSet contentType="video" maxWidth="1280">
      <ContentProtection cenc:default_KID="0102cfb1-5e94-cd48-562d-28faad7eb77f"/>
      <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"><cenc:pssh>PROGRAMME_PSSH</cenc:pssh></ContentProtection>
      <Representation id="v0" width="1280"/>
    </AdaptationSet>
  </Period>
</MPD>`;

test('Max DASH inspection chooses the long protected programme instead of clear ad periods', () => {
    const inspected = inspectMaxDashManifest(fixture);
    assert.equal(inspected.maxContentPeriodId, 'programme-42');
    assert.equal(inspected.maxContentDurationSeconds, 6326);
    assert.deepEqual(inspected.psshValues, ['PROGRAMME_PSSH']);
    assert.deepEqual(inspected.maxVideoTracks.map((track) => track.width), [1024, 1280]);
    assert.equal(inspected.maxAudioTracks.find((track) => track.representationIds.includes('a2')).descriptive, false);
    assert.equal(inspected.maxAudioTracks.find((track) => track.representationIds.includes('a3')).descriptive, true);
});

test('Max joins every protected movie period under the first protected Period ID', () => {
    const protectedPeriod = fixture.match(/<Period id="programme-42"[\s\S]*?<\/Period>/)[0];
    const first = protectedPeriod
        .replace('id="programme-42"', 'id="programme-first"')
        .replace('duration="PT1H45M26S"', 'duration="PT10M"');
    const second = protectedPeriod
        .replace('id="programme-42"', 'id="programme-second"')
        .replace('duration="PT1H45M26S"', 'duration="PT20M"');
    const stitched = `<MPD>${first}<Period id="clear-ad" duration="PT40M"></Period>${second}</MPD>`;

    const inspected = inspectMaxDashManifest(stitched);
    assert.equal(inspected.maxContentPeriodId, 'programme-first');
    assert.deepEqual(inspected.maxContentPeriodIds, ['programme-first', 'programme-second']);
    assert.equal(inspected.maxContentDurationSeconds, 1800);
});

test('Max command selection requires keyed programme video and excludes descriptive audio', () => {
    const inspected = inspectMaxDashManifest(fixture);
    const selected = createMaxTrackArguments(
        { pageUrl: 'https://play.hbomax.com/video/example', ...inspected },
        '--key 010059aeffe3f14953c50edbe560719f:audio --key 010121e8ae9c8a85967d26fa72a06758:video',
        '-M format=mkv -sv res="1920*":for=best -sa best -ds all',
    );
    assert.equal(selected.error, '');
    assert.match(selected.arguments, /period=\^programme-42\\\$/);
    assert.match(selected.arguments, /res=\^1024x/);
    assert.match(selected.arguments, /id=\^\(a2\)\\\$/);
    assert.doesNotMatch(selected.arguments, /1920|a3|Alternate/);

    const missingVideo = createMaxTrackArguments(
        { pageUrl: 'https://play.hbomax.com/video/example', ...inspected },
        '--key 010059aeffe3f14953c50edbe560719f:audio',
        '-sv best -sa best',
    );
    assert.match(missingVideo.error, /no key for any programme video tier/i);
});

test('Max pairs by captured video key and keeps only the newest signed manifest', () => {
    const inspected = inspectMaxDashManifest(fixture);
    const older = {
        url: 'https://gcp.prd.media.h264.io/gcs/asset/dash.mpd?pid=older',
        ...inspected,
        psshValues: ['MPD_PSSH_DOES_NOT_EQUAL_LICENSE_PSSH'],
    };
    const newest = {
        url: 'https://akm.prd.media.h264.io/gcs/asset/dash.mpd?pid=newest',
        ...inspected,
        psshValues: ['ANOTHER_MPD_PSSH'],
    };

    assert.deepEqual(
        selectMaxManifestForKeys([older, newest], [
            { kid: '010121e8-ae9c-8a85-967d-26fa72a06758', k: 'video-key' },
            { kid: '010059aeffe3f14953c50edbe560719f', k: 'audio-key' },
        ]),
        [newest],
    );
    assert.deepEqual(
        selectMaxManifestForKeys([older, newest], [
            { kid: '010059aeffe3f14953c50edbe560719f', k: 'audio-key-only' },
        ]),
        [],
    );
});
