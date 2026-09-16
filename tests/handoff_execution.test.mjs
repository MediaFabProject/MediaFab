import test from 'node:test';
import assert from 'node:assert/strict';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { buildNormalMediaCommand } from '../panel/command-builder.mjs';
import { buildBBCIPlayerCommand } from '../multi-mode/bbc-iplayer-settings.mjs';
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
import json, sys, time
root = Path(__file__).resolve().parents[2]
detail = sys.argv[sys.argv.index("--detail-link") + 1]
with root.joinpath("handoff-events.txt").open("a") as stream:
    stream.write(f"begin:{detail}\\n")
time.sleep(0.05)
with root.joinpath("handoff-calls.jsonl").open("a") as stream:
    stream.write(json.dumps(sys.argv[1:]) + "\\n")
with root.joinpath("handoff-events.txt").open("a") as stream:
    stream.write(f"end:{detail}\\n")
`;
    writeFileSync(path.join(mme, 'Launchers', 'media_metadata_and_extras_getter.py'), recorder, 'utf8');
    writeFileSync(path.join(lpmaeg, 'Launchers', 'live_performance_metadata_and_extras_getter.py'), recorder, 'utf8');
    return { root, output, mme, lpmaeg, downloader };
}

function run(command, cwd) {
    return spawnSync('/bin/zsh', ['-c', command], { cwd, encoding: 'utf8' });
}

function handoffCalls(root) {
    return readFileSync(path.join(root, 'handoff-calls.jsonl'), 'utf8')
        .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
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
    const [args] = handoffCalls(fixture.root);
    assert.equal(args[args.indexOf('--detail-link') + 1], watchUrl);
    const mediaPath = args[args.indexOf('--media-folder') + 1];
    assert.equal(path.dirname(mediaPath), fixture.output);
    assert.match(path.basename(mediaPath), /^mediafab-crunchyroll-GE00362087ENUS-/);
    assert.ok(existsSync(mediaPath));
});

test('Queue invokes MME for the completed Crunchyroll item before the command completes', () => {
    const fixture = createAuditFixture();
    const watchUrl = 'https://www.crunchyroll.com/watch/G9DUE3QXP/example';
    const seriesUrl = 'https://www.crunchyroll.com/series/GW4HM7WQ5/example';
    const [job] = buildBatchJobs(createManualLinkCatalog([{ playbackUrl: watchUrl, detailUrl: seriesUrl }]), {
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
    const [args] = handoffCalls(fixture.root);
    assert.equal(args[args.indexOf('--detail-link') + 1], seriesUrl);
    const handedMedia = args[args.indexOf('--media-folder') + 1];
    assert.ok(existsSync(handedMedia));
    assert.equal(path.dirname(handedMedia), fixture.output);
    const created = readdirSync(fixture.output);
    assert.equal(created.length, 1);
    assert.match(created[0], /^mediafab-crunchyroll-G9DUE3QXP-/);
});

test('a normal Disney-style handoff passes the exact completed video to MME', () => {
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
    const [args] = handoffCalls(fixture.root);
    assert.equal(args[args.indexOf('--detail-link') + 1], detailUrl);
    assert.equal(args[args.indexOf('--media-folder') + 1], path.join(fixture.output, 'manifest_audit.mkv'));
    assert.ok(existsSync(path.join(fixture.output, 'manifest_audit.mkv')));
});

test('Queue preserves Disney episode identity in its immediate exact-file handoff', () => {
    const fixture = createAuditFixture();
    const detailUrl = 'https://www.disneyplus.com/play/ad5f6c58-8513-4de1-8420-350ce867ffdd';
    const catalogUrl = 'https://www.disneyplus.com/browse/entity-0bb4a9fa-3c44-4a0a-b4ff-28d930fdb999';
    const [job] = buildBatchJobs(createManualLinkCatalog([{ playbackUrl: detailUrl, detailUrl: catalogUrl }]), {
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
    assert.equal(job.provider, 'disneyplus');
    const [args] = handoffCalls(fixture.root);
    assert.equal(args[args.indexOf('--detail-link') + 1], catalogUrl);
    assert.ok(existsSync(args[args.indexOf('--media-folder') + 1]));
    const created = readdirSync(fixture.output);
    assert.equal(created.length, 1);
    assert.match(created[0], /^mediafab-disneyplus-ad5f6c58-8513-4de1-8420-350ce867ffdd-/);
});

test('Queue preserves PBS KIDS identity in its immediate exact-file handoff', () => {
    const fixture = createAuditFixture();
    const detailUrl = 'https://pbskids.org/videos/watch/wild-kratts-full-episodes/1385807/duck-duck-loon/2756856';
    const catalogUrl = 'https://pbskids.org/videos/wild-kratts';
    const [job] = buildBatchJobs(createManualLinkCatalog([{ playbackUrl: detailUrl, detailUrl: catalogUrl }]), {
        ...DEFAULT_MULTI_MODE_SETTINGS,
        destination: fixture.output,
        externalSubtitles: false,
        metadata: { enabled: true, getter: 'mme', detailLink: '', projectFolder: fixture.mme },
    });
    const command = buildQueueMediaCommand(job, {
        manifest: { type: 'HLS_MASTER', url: 'https://cdn.example.test/master.m3u8', headers: {} },
        keys: [],
        subtitles: [],
    }, { executableName: fixture.downloader });

    const result = run(command, fixture.root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(job.provider, 'pbs-kids');
    const [args] = handoffCalls(fixture.root);
    assert.equal(args[args.indexOf('--detail-link') + 1], catalogUrl);
    assert.ok(existsSync(args[args.indexOf('--media-folder') + 1]));
    const created = readdirSync(fixture.output);
    assert.equal(created.length, 1);
    assert.match(created[0], /^mediafab-pbskids-2756856-/);
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
    const [args] = handoffCalls(fixture.root);
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
    assert.equal(existsSync(path.join(fixture.root, 'handoff-calls.jsonl')), false);
    assert.doesNotMatch(result.stdout, /Complete\. Output is ready/);
});

test('a two-item queue awaits each MME handoff before advancing to the next item', () => {
    const fixture = createAuditFixture();
    const urls = [
        'https://www.crunchyroll.com/watch/GE00362087ENUS/first',
        'https://www.crunchyroll.com/watch/GE00362091ENUS/second',
    ];
    const jobs = buildBatchJobs(createManualLinkCatalog(urls), {
        ...DEFAULT_MULTI_MODE_SETTINGS,
        destination: fixture.output,
        externalSubtitles: false,
        metadata: { enabled: true, getter: 'mme', detailLink: '', projectFolder: fixture.mme },
    });
    const commands = jobs.map((job, index) => buildQueueMediaCommand(job, {
        manifest: { type: 'DASH', url: `https://cdn.example.test/${index + 1}.mpd`, headers: {} },
        keys: [{ kid: `aa${index}`, k: `bb${index}` }],
        subtitles: [],
    }, { executableName: fixture.downloader }));
    const advance = `printf '%s\\n' queue-advance >> '${path.join(fixture.root, 'handoff-events.txt')}'`;
    const result = run(`${commands[0]} && ${advance} && ${commands[1]}`, fixture.root);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const calls = handoffCalls(fixture.root);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((args) => args[args.indexOf('--detail-link') + 1]), urls);
    assert.ok(calls.every((args) => existsSync(args[args.indexOf('--media-folder') + 1])));
    assert.deepEqual(
        readFileSync(path.join(fixture.root, 'handoff-events.txt'), 'utf8').trim().split('\n'),
        [`begin:${urls[0]}`, `end:${urls[0]}`, 'queue-advance', `begin:${urls[1]}`, `end:${urls[1]}`],
    );
});

test('BBC iPlayer invokes the required getter with one exact PID queue and selected output', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mediafab-bbc-getter-'));
    const project = path.join(root, 'iPlayer Getter');
    const output = path.join(root, 'BBC Output');
    mkdirSync(project);
    mkdirSync(output);
    writeFileSync(path.join(project, 'settings.json'), '{}\n');
    writeFileSync(path.join(project, 'bbc_iplayer_tool.py'), `from pathlib import Path
import json, sys
args = sys.argv[1:]
queue = Path(args[args.index("--download") + 1])
Path(${JSON.stringify(root)}).joinpath("bbc-call.json").write_text(json.dumps({"args": args, "queue": queue.read_text()}))
`);
    const episodeUrl = 'https://www.bbc.co.uk/iplayer/episode/m002abc1/example';
    const command = buildBBCIPlayerCommand(episodeUrl, output, {
        projectFolder: project,
        quality: 'hd',
        subtitles: true,
    });
    const result = run(command, root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const call = JSON.parse(readFileSync(path.join(root, 'bbc-call.json'), 'utf8'));
    assert.equal(call.queue.trim(), episodeUrl);
    assert.equal(call.args[call.args.indexOf('--output') + 1], output);
    assert.equal(call.args[call.args.indexOf('--quality') + 1], 'hd');
    assert.equal(call.args.includes('--no-subtitles'), false);
    assert.match(result.stdout, /Start downloading\.\.\.Vid/);
    assert.match(result.stdout, /Complete\. Output is ready/);
});
