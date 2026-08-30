import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('../manifest.json'));
const background = read('../background.js');
const content = read('../content_script.js');
const cdm = read('../lib/cdm.js');
const remote = read('../lib/remote_cdm.js');

test('MediaFab re-signs the browser request and strips outgoing OEMCrypto data', () => {
    assert.match(cdm, /SignedMessage\.decode\(new Uint8Array\(messageBytes\)\)/);
    assert.match(cdm, /delete signedMessage\.oemcryptoCoreMessage/);
    assert.match(cdm, /const licenseRequest = LicenseRequest\.decode\(signedMessage\.msg\)/);
    assert.match(cdm, /signedMessage\.msg = this\._rawLicenseRequest/);
    assert.match(cdm, /SignedMessage\.encode\(signedMessage\)\.finish\(\)/);
    assert.doesNotMatch(background, /createLicenseRequest\(LicenseType\.STREAMING/);
});

test('response HMAC includes OEMCrypto data before the signed license body', () => {
    const oemIndex = cdm.indexOf('hmac.update(Util.utf8.decode(signedLicense.oemcryptoCoreMessage))');
    const bodyIndex = cdm.indexOf('hmac.update(Util.utf8.decode(signedLicense.msg))');
    assert.ok(oemIndex > -1);
    assert.ok(bodyIndex > oemIndex);
});

test('service certificates cover explicit, session-message, and ArrayBuffer paths', () => {
    assert.match(content, /MediaKeys\.prototype, 'setServerCertificate'/);
    assert.match(content, /value instanceof ArrayBuffer/);
    assert.match(content, /ArrayBuffer\.isView\(value\)/);
    assert.match(content, /emitAndWaitForResponse\("CERTIFICATE"/);
    assert.match(content, /inspection\.startsWith\(prefix\)/);
    assert.match(background, /SignedMessage\.MessageType\.SERVICE_CERTIFICATE/);
    assert.match(remote, /set_service_certificate/);
});

test('the trusted browser event is stopped before the asynchronous replacement request', () => {
    const stopIndex = content.indexOf('event.stopImmediatePropagation();');
    const requestIndex = content.indexOf('await emitAndWaitForResponse("REQUEST", payload)');
    assert.ok(stopIndex > -1);
    assert.ok(requestIndex > stopIndex);
    assert.match(content, /removeEventListener/);
    assert.match(content, /wrappedMessageListeners/);
});

test('interception scripts are registered only while MediaFab is enabled', () => {
    assert.ok(manifest.permissions.includes('scripting'));
    assert.deepEqual(manifest.content_scripts, []);
    assert.match(background, /chrome\.scripting\.registerContentScripts/);
    assert.match(background, /chrome\.scripting\.unregisterContentScripts/);
    assert.match(background, /await SettingsManager\.getEnabled\(\)/);
    assert.match(background, /message_proxy\.js/);
    assert.match(background, /content_script\.js/);
});

test('cached keys never make a fresh local or remote request return early', () => {
    const challengeRegion = background.slice(
        background.indexOf('async function generateChallenge('),
        background.indexOf('async function parseLicense('),
    );
    const remoteRegion = background.slice(
        background.indexOf('async function generateChallengeRemote('),
        background.indexOf('async function parseLicenseRemote('),
    );
    for (const region of [challengeRegion, remoteRegion]) {
        const cachedBlock = region.slice(region.indexOf('if (existingLog)'), region.indexOf('const selected_'));
        assert.doesNotMatch(cachedBlock, /return;/);
    }
});

test('ClearKey identity uses key IDs and manifest inspection accepts broader request shapes', () => {
    assert.match(background, /kids: clearkey\["keys"\]\.map\(key => key\.kid\)/);
    assert.match(content, /if \(thisArg\.readyState !== 4\)/);
    assert.doesNotMatch(content, /thisArg\.requestMethod !== "GET"/);
    assert.match(content, /const url = response\.url \|\|/);
});
