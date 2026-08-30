import test from 'node:test';
import assert from 'node:assert/strict';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { buildNormalMediaCommand } from '../panel/command-builder.mjs';
import {
    buildBatchJobs,
    buildQueueMediaCommand,
    createManualLinkCatalog,
    DEFAULT_MULTI_MODE_SETTINGS,
} from '../multi-mode/core.mjs';

function createAuditFixture() {
    const root = mkdtempSync(path.join(tmpdir(), 'mediafab-handoff-audit-'));
    const output = path.join(root, 'output');
    const mme = path.join(root, 'MME');
    const lpmaeg = path.join(root, 'LPMAEG');
    mkdirSync(output);
    mkdirSync(path.join(mme, 'Launchers'), { recursive: true });
    mkdirSync(path.join(lpmaeg, 'Launchers'), { recursive: true });

    const downloader = path.join(root, 'fake-downloader');
    writeFileSync(downloader, `#!/bin/zsh
save_dir="$PWD"
save_name="manifest_audit"
while (( $# > 0 )); do
  case "$1" in
    --save-dir) save_dir="$2"; shift 2 ;;
    --save-dir=*) save_dir="\${1#--save-dir=}"; shift ;;
    --save-name) save_name="$2"; shift 2 ;;
    --save-name=*) save_name="\${1#--save-name=}"; shift ;;
    *) shift ;;
  esac
done
mkdir -p -- "$save_dir"
printf 'media' > "$save_dir/$save_name.mkv"
`, 'utf8');
    chmodSync(downloader, 0o700);

    const recorder = `from pathlib import Path
import json, sys
Path(__file__).resolve().parents[2].joinpath("handoff-args.json").write_text(json.dumps(sys.argv[1:]))
`;
    writeFileSync(path.join(mme, 'Launchers', 'media_metadata_and_extras_getter.py'), recorder, 'utf8');
    writeFileSync(path.join(lpmaeg, 'Launchers', 'live_performance_metadata_and_extras_getter.py'), recorder, 'utf8');
    return { root, output, mme, lpmaeg, downloader };
}

function run(command, cwd) {
    return spawnSync('/bin/zsh', ['-c', command], { cwd, encoding: 'utf8' });
}

test('Crunchyroll resolves the newly completed media and hands its exact path to MME', () => {
    const fixture = createAuditFixture();
    const watchUrl = 'https://www.crunchyroll.com/watch/GE00362087ENUS/example';
    const command = buildNormalMediaCommand({
        metadata: {
            url: 'https://cdn.example.test/manifest.mpd',
            headers: {},
            subtitles: [],
            isPublicMedia: true,
            pageUrl: watchUrl,
        },
        executableName: fixture.downloader,
        additionalArguments: `-M format=mkv --no-log --save-dir '${fixture.output}'`,
        metadataGetterType: 'mme',
        metadataGetterConfig: { enabled: true, detailLink: '', projectFolder: fixture.mme },
        outputDirectory: fixture.output,
    });

    const result = run(command, fixture.root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const args = JSON.parse(readFileSync(path.join(fixture.root, 'handoff-args.json'), 'utf8'));
    assert.equal(args[args.indexOf('--detail-link') + 1], watchUrl);
    const mediaPath = args[args.indexOf('--media-folder') + 1];
    assert.equal(path.dirname(mediaPath), fixture.output);
    assert.match(path.basename(mediaPath), /^crunchyroll-GE00362087ENUS-/);
    assert.ok(existsSync(mediaPath));
});

test('Queue executes the same Crunchyroll media and MME handoff chain one job at a time', () => {
    const fixture = createAuditFixture();
    const watchUrl = 'https://www.crunchyroll.com/watch/G9DUE3QXP/example';
    const [job] = buildBatchJobs(createManualLinkCatalog([watchUrl]), {
        ...DEFAULT_MULTI_MODE_SETTINGS,
        destination: fixture.output,
        externalSubtitles: false,
        metadata: { enabled: true, getter: 'mme', detailLink: '', projectFolder: fixture.mme },
    });
    const command = buildQueueMediaCommand(job, {
        manifest: { type: 'DASH', url: 'https://cdn.example.test/manifest.mpd', headers: {} },
        keys: [{ kid: 'aa', k: 'bb' }],
        subtitles: [],
    }, { executableName: fixture.downloader });

    const result = run(command, fixture.root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const args = JSON.parse(readFileSync(path.join(fixture.root, 'handoff-args.json'), 'utf8'));
    assert.equal(args[args.indexOf('--detail-link') + 1], watchUrl);
    const mediaPath = args[args.indexOf('--media-folder') + 1];
    assert.equal(path.dirname(mediaPath), fixture.output);
    assert.match(path.basename(mediaPath), /^crunchyroll-G9DUE3QXP-/);
});

test('a normal Disney-style handoff passes the selected output directory to MME', () => {
    const fixture = createAuditFixture();
    const detailUrl = 'https://www.disneyplus.com/browse/entity/example';
    const command = buildNormalMediaCommand({
        metadata: {
            url: 'https://cdn.example.test/manifest.mpd',
            headers: {},
            subtitles: [],
            isPublicMedia: true,
            pageUrl: detailUrl,
        },
        executableName: fixture.downloader,
        additionalArguments: `-M format=mkv --save-dir '${fixture.output}'`,
        metadataGetterType: 'mme',
        metadataGetterConfig: { enabled: true, detailLink: detailUrl, projectFolder: fixture.mme },
        outputDirectory: fixture.output,
    });

    const result = run(command, fixture.root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const args = JSON.parse(readFileSync(path.join(fixture.root, 'handoff-args.json'), 'utf8'));
    assert.equal(args[args.indexOf('--detail-link') + 1], detailUrl);
    assert.equal(args[args.indexOf('--media-folder') + 1], fixture.output);
    assert.ok(existsSync(path.join(fixture.output, 'manifest_audit.mkv')));
});

test('Queue executes a Disney playing-page handoff through the shared normal command chain', () => {
    const fixture = createAuditFixture();
    const detailUrl = 'https://www.disneyplus.com/play/ad5f6c58-8513-4de1-8420-350ce867ffdd';
    const [job] = buildBatchJobs(createManualLinkCatalog([detailUrl]), {
        ...DEFAULT_MULTI_MODE_SETTINGS,
        destination: fixture.output,
        externalSubtitles: false,
        metadata: { enabled: true, getter: 'mme', detailLink: detailUrl, projectFolder: fixture.mme },
    });
    const command = buildQueueMediaCommand(job, {
        manifest: { type: 'DASH', url: 'https://cdn.example.test/manifest.mpd', headers: {} },
        keys: [{ kid: 'aa', k: 'bb' }],
        subtitles: [],
    }, { executableName: fixture.downloader });

    const result = run(command, fixture.root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(job.provider, 'disneyplus');
    const args = JSON.parse(readFileSync(path.join(fixture.root, 'handoff-args.json'), 'utf8'));
    assert.equal(args[args.indexOf('--detail-link') + 1], detailUrl);
    const mediaPath = args[args.indexOf('--media-folder') + 1];
    assert.equal(path.dirname(mediaPath), fixture.output);
    assert.equal(path.basename(mediaPath), 'manifest_audit.mkv');
    assert.ok(existsSync(mediaPath));
});

test('Disney sidecars are attached to the newly completed media when older videos exist', () => {
    const fixture = createAuditFixture();
    const detailUrl = 'https://www.disneyplus.com/browse/entity/example';
    writeFileSync(path.join(fixture.output, 'older-download.mkv'), 'older media', 'utf8');
    const subtitleSource = path.join(fixture.root, 'english.srt');
    writeFileSync(subtitleSource, Array.from({ length: 120 }, (_, index) => [
        String(index + 1),
        `00:00:${String(index % 60).padStart(2, '0')},000 --> 00:00:${String(index % 60).padStart(2, '0')},500`,
        `Caption ${index + 1}`,
        '',
    ].join('\n')).join('\n'), 'utf8');
    const command = buildNormalMediaCommand({
        metadata: {
            url: 'https://cdn.example.test/manifest.mpd',
            headers: {},
            subtitles: [{ url: `file://${subtitleSource}`, language: 'en' }],
            isPublicMedia: true,
            pageUrl: detailUrl,
        },
        executableName: fixture.downloader,
        additionalArguments: `-M format=mkv -ss lang=en:for=best --save-dir '${fixture.output}'`,
        metadataGetterType: 'mme',
        metadataGetterConfig: { enabled: true, detailLink: detailUrl, projectFolder: fixture.mme },
        outputDirectory: fixture.output,
    });

    const result = run(command, fixture.root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(existsSync(path.join(fixture.output, 'manifest_audit.en.srt')));
    assert.equal(existsSync(path.join(fixture.output, 'en.srt')), false);
    assert.ok(existsSync(path.join(fixture.output, 'older-download.mkv')));
});

test('BroadwayHD uses the same completed chain with the LPMAEG launcher', () => {
    const fixture = createAuditFixture();
    const detailUrl = 'https://www.broadwayhd.com/video/12345';
    const command = buildNormalMediaCommand({
        metadata: {
            url: 'https://cdn.example.test/manifest.mpd',
            headers: {},
            subtitles: [],
            isPublicMedia: true,
            pageUrl: detailUrl,
        },
        executableName: fixture.downloader,
        additionalArguments: `-M format=mkv --save-dir '${fixture.output}'`,
        metadataGetterType: 'lpmaeg',
        metadataGetterConfig: { enabled: true, detailLink: '', projectFolder: fixture.lpmaeg },
        outputDirectory: fixture.output,
    });

    const result = run(command, fixture.root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const args = JSON.parse(readFileSync(path.join(fixture.root, 'handoff-args.json'), 'utf8'));
    assert.equal(args[args.indexOf('--detail-link') + 1], detailUrl);
    assert.equal(args[args.indexOf('--media-folder') + 1], fixture.output);
});

test('a failed downloader blocks subtitles, metadata, and false completion', () => {
    const fixture = createAuditFixture();
    writeFileSync(fixture.downloader, '#!/bin/zsh\nexit 17\n', 'utf8');
    chmodSync(fixture.downloader, 0o700);
    const command = buildNormalMediaCommand({
        metadata: {
            url: 'https://cdn.example.test/manifest.mpd',
            headers: {},
            subtitles: [],
            isPublicMedia: true,
            pageUrl: 'https://www.disneyplus.com/browse/entity/example',
        },
        executableName: fixture.downloader,
        metadataGetterType: 'mme',
        metadataGetterConfig: {
            enabled: true,
            detailLink: 'https://www.disneyplus.com/browse/entity/example',
            projectFolder: fixture.mme,
        },
        outputDirectory: fixture.output,
    });

    const result = run(command, fixture.root);
    assert.equal(result.status, 17);
    assert.equal(existsSync(path.join(fixture.root, 'handoff-args.json')), false);
    assert.doesNotMatch(result.stdout, /Complete\. Output is ready/);
});
