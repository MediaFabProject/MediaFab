const WIDEVINE_SCHEME = 'edef8ba9-79d6-4ace-a3c8-27dcd51d21ed';

export function parseIsoDurationSeconds(value) {
    const match = String(value || '').match(
        /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i,
    );
    if (!match) {
        return 0;
    }
    return Number(match[1] || 0) * 86400
        + Number(match[2] || 0) * 3600
        + Number(match[3] || 0) * 60
        + Number(match[4] || 0);
}

function attribute(attributes, name) {
    return String(attributes || '').match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'))?.[1] || '';
}

function normalizedKeyId(value) {
    return String(value || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
}

export function selectProtectedDashManifestForKeys(
    manifests,
    keys,
    { periodField = 'contentPeriodId', videoTracksField = 'videoTracks' } = {},
) {
    const capturedKeyIds = new Set((Array.isArray(keys) ? keys : [])
        .map((key) => normalizedKeyId(key?.kid || key?.key_id))
        .filter(Boolean));
    if (capturedKeyIds.size === 0) {
        return [];
    }

    const matching = (Array.isArray(manifests) ? manifests : []).filter((manifest) =>
        manifest?.[periodField]
        && Array.isArray(manifest[videoTracksField])
        && manifest[videoTracksField].some((track) => capturedKeyIds.has(normalizedKeyId(track?.keyId)))
    );

    // A provider can request the same asset more than once with a freshly
    // signed URL. The newest matching manifest represents the current play.
    return matching.length > 0 ? [matching[matching.length - 1]] : [];
}

export function selectMaxManifestForKeys(manifests, keys) {
    return selectProtectedDashManifestForKeys(manifests, keys, {
        periodField: 'maxContentPeriodId',
        videoTracksField: 'maxVideoTracks',
    });
}

function representations(body) {
    return [...String(body || '').matchAll(/<Representation\b([^>]*)>/gi)].map((match) => ({
        id: attribute(match[1], 'id'),
        width: Number(attribute(match[1], 'width')) || 0,
    })).filter((item) => item.id);
}

function adaptationSets(periodBody, contentType) {
    return [...String(periodBody || '').matchAll(/<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi)]
        .filter((match) => attribute(match[1], 'contentType').toLowerCase() === contentType)
        .map((match) => ({ attributes: match[1], body: match[2] }));
}

function widevinePsshValues(periodBody) {
    const values = [];
    const protectionPattern = new RegExp(
        `<ContentProtection\\b(?=[^>]*schemeIdUri=["'][^"']*${WIDEVINE_SCHEME})[^>]*>([\\s\\S]*?)<\\/ContentProtection>`,
        'gi',
    );
    for (const protection of String(periodBody || '').matchAll(protectionPattern)) {
        for (const pssh of protection[1].matchAll(/<(?:[a-z0-9_-]+:)?pssh\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_-]+:)?pssh>/gi)) {
            const value = pssh[1].replace(/\s+/g, '');
            if (value && !values.includes(value)) {
                values.push(value);
            }
        }
    }
    return values;
}

function keyIdForAdaptationSet(attributes, body) {
    return normalizedKeyId(
        `${attributes} ${body}`.match(/\b(?:cenc:)?default_KID=["']([^"']+)["']/i)?.[1],
    );
}

function isDescriptiveAudio(attributes, body) {
    const source = `${attributes} ${body}`;
    return /<Accessibility\b[^>]*value=["']1["']/i.test(source)
        || /<Role\b[^>]*value=["'](?:alternate|description|commentary)["']/i.test(source);
}

export function inspectProtectedDashManifest(text) {
    const candidates = [];
    for (const period of String(text || '').matchAll(/<Period\b([^>]*)>([\s\S]*?)<\/Period>/gi)) {
        const id = attribute(period[1], 'id');
        const durationSeconds = parseIsoDurationSeconds(attribute(period[1], 'duration'));
        const psshValues = widevinePsshValues(period[2]);
        const videoSets = adaptationSets(period[2], 'video');
        if (!id || psshValues.length === 0 || videoSets.length === 0) {
            continue;
        }

        const videoTracks = videoSets.map((set) => {
            const items = representations(set.body);
            return {
                keyId: keyIdForAdaptationSet(set.attributes, set.body),
                width: Math.max(Number(attribute(set.attributes, 'maxWidth')) || 0, ...items.map((item) => item.width)),
                representationIds: items.map((item) => item.id),
            };
        }).filter((track) => track.keyId && track.width > 0);

        const audioTracks = adaptationSets(period[2], 'audio').map((set) => ({
            keyId: keyIdForAdaptationSet(set.attributes, set.body),
            language: attribute(set.attributes, 'lang'),
            representationIds: representations(set.body).map((item) => item.id),
            descriptive: isDescriptiveAudio(set.attributes, set.body),
        })).filter((track) => track.keyId && track.representationIds.length > 0);

        candidates.push({
            contentPeriodId: id,
            contentPeriodIds: [id],
            contentDurationSeconds: durationSeconds,
            psshValues,
            videoTracks,
            audioTracks,
        });
    }

    // Max stitches a title into several encrypted periods separated by clear
    // ad periods. N_m3u8DL-RE joins encrypted periods with the same key family
    // under the first protected Period ID, so selecting the longest individual
    // period produces no matching stream. Group matching protected periods and
    // retain that first ID while summing the complete programme duration.
    const groups = new Map();
    for (const candidate of candidates) {
        const videoKeys = [...new Set(candidate.videoTracks.map((track) => track.keyId))].sort();
        const audioKeys = [...new Set(candidate.audioTracks.map((track) => track.keyId))].sort();
        const signature = `${videoKeys.join(',')}|${audioKeys.join(',')}`;
        let group = groups.get(signature);
        if (!group) {
            group = {
                contentPeriodId: candidate.contentPeriodId,
                contentPeriodIds: [],
                contentDurationSeconds: 0,
                psshValues: [],
                videoTracks: [],
                audioTracks: [],
            };
            groups.set(signature, group);
        }
        group.contentPeriodIds.push(candidate.contentPeriodId);
        group.contentDurationSeconds += candidate.contentDurationSeconds;
        for (const pssh of candidate.psshValues) {
            if (!group.psshValues.includes(pssh)) group.psshValues.push(pssh);
        }
        for (const track of candidate.videoTracks) {
            const existing = group.videoTracks.find((item) => item.keyId === track.keyId);
            if (!existing) {
                group.videoTracks.push({ ...track, representationIds: [...track.representationIds] });
            } else {
                existing.width = Math.max(existing.width, track.width);
                existing.representationIds = [...new Set(existing.representationIds.concat(track.representationIds))];
            }
        }
        for (const track of candidate.audioTracks) {
            const existing = group.audioTracks.find((item) =>
                item.keyId === track.keyId
                && item.language === track.language
                && item.descriptive === track.descriptive
            );
            if (!existing) {
                group.audioTracks.push({ ...track, representationIds: [...track.representationIds] });
            } else {
                existing.representationIds = [...new Set(existing.representationIds.concat(track.representationIds))];
            }
        }
    }

    return [...groups.values()].sort((left, right) =>
        right.contentDurationSeconds - left.contentDurationSeconds
    )[0] || null;
}

export function inspectMaxDashManifest(text) {
    const inspected = inspectProtectedDashManifest(text);
    return inspected ? {
        maxContentPeriodId: inspected.contentPeriodId,
        maxContentPeriodIds: inspected.contentPeriodIds,
        maxContentDurationSeconds: inspected.contentDurationSeconds,
        psshValues: inspected.psshValues,
        maxVideoTracks: inspected.videoTracks,
        maxAudioTracks: inspected.audioTracks,
    } : null;
}
