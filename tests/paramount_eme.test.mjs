import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contentScript = readFileSync(new URL('../content_script.js', import.meta.url), 'utf8');
const background = readFileSync(new URL('../background.js', import.meta.url), 'utf8');
const cdm = readFileSync(new URL('../lib/cdm.js', import.meta.url), 'utf8');

test('Paramount+ uses the shared original-request re-signing path', () => {
    assert.match(background, /const originalChallenge = Util\.b64\.decode\(request\.challenge\)/);
    assert.match(background, /session\.getLicenseChallenge\(originalChallenge/);
    assert.match(cdm, /delete signedMessage\.oemcryptoCoreMessage/);
    assert.match(contentScript, /event\.stopImmediatePropagation\(\);/);
    assert.match(contentScript, /thisArg\.dispatchEvent\(new MediaKeyMessageEvent/);
});

test('the failed Paramount+-specific duplicate-challenge experiment is absent', () => {
    assert.doesNotMatch(contentScript, /isParamountPlusPage|isParamountLicenseRequest|paramountChallengesProcessed/);
    assert.doesNotMatch(contentScript, /Paramount\+ must receive its original browser-CDM challenge/);
    assert.doesNotMatch(background, /isParamountPlusPageUrl|using the original challenge/);
});
