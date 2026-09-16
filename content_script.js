(async () => {
    const isDisneyPlusPage = /(^|\.)disneyplus\.com$/i.test(window.location.hostname)
        || /^https?:\/\/[^/]*\.?disneyplus\.com\//i.test(document.referrer || '');
    const amazonPrimeHostPattern = /(^|\.)(?:primevideo\.com|amazon\.(?:ae|ca|cn|com|de|eg|es|fr|in|it|nl|pl|sa|se|sg|co\.jp|co\.uk|com\.au|com\.be|com\.br|com\.mx|com\.tr))$/i;
    const isAmazonPrimeVideoPage = amazonPrimeHostPattern.test(window.location.hostname)
        || (() => {
            try {
                return amazonPrimeHostPattern.test(new URL(document.referrer || '').hostname);
            } catch {
                return false;
            }
        })();
    const maxHostPattern = /(^|\.)(?:max\.com|hbomax\.com)$/i;
    const isMaxVideoPage = maxHostPattern.test(window.location.hostname)
        || (() => {
            try {
                return maxHostPattern.test(new URL(document.referrer || '').hostname);
            } catch {
                return false;
            }
        })();
    const usesOnMessageInterception = isMaxVideoPage;

    const proxy = (object, method, handler) => {
        const original = object[method];
        if (typeof original !== "function")
            return;

        Object.defineProperty(object, method, {
            value: new Proxy(original, { apply: handler }),
            configurable: true,
            writable: true
        });
    };

    const b64 = {
        decode: s => Uint8Array.from(atob(s), c => c.charCodeAt(0)),
        encode: b => btoa(String.fromCharCode(...new Uint8Array(b)))
    };

    const getManifestType = (text) => {
        const lower = text.toLowerCase();
        if (lower.includes('<mpd') && lower.includes('</mpd>')) {
            return "DASH";
        } else if (lower.includes('#extm3u')) {
            if (lower.includes('#ext-x-stream-inf')) {
                return "HLS_MASTER";
            } else {
                return "HLS_PLAYLIST";
            }
        } else if (lower.includes('<smoothstreamingmedia') && lower.includes('</smoothstreamingmedia>')) {
            return "MSS";
        }
    }

    const getManifestPsshValues = (text) => [...String(text || '').matchAll(
        /<(?:[a-z0-9_-]+:)?pssh\b[^>]*>([\s\S]*?)<\/(?:[a-z0-9_-]+:)?pssh>/gi,
    )].map((match) => match[1].replace(/\s+/g, '')).filter(Boolean);

    const subtitleContextPattern = /subtitle|subtitles|caption|captions|closed.?caption|\bcc\b/i;
    // Only follow a directly downloadable subtitle sidecar. Network requests
    // whose URL merely mentions "subtitle" are often API/metadata endpoints,
    // not a subtitle file that curl can save and ffmpeg can convert.
    const subtitleFilePattern = /\.(?:srt|vtt|webvtt|dtt|ttml|dfxp|ass|ssa)(?:[?#]|$)/i;
    const subtitlePlaylistPattern = /\.m3u8(?:[?#]|$)/i;
    const segmentedVttPattern = /(?:^|\/)seg_?\d+\.vtt(?:[?#]|$)/i;
    const languageKeys = [
        "language", "lang", "locale", "srclang", "subtitle_language", "subtitleLanguage",
        "languageCode", "language_code", "localeCode", "locale_code", "iso", "isoCode", "iso_code",
    ];
    const languageTextKeys = ["label", "title", "name", "displayName", "display_name"];
    const languageCodeAliases = {
        ara: "ar", bul: "bg", cat: "ca", ces: "cs", chi: "zh", cze: "cs", dan: "da",
        deu: "de", dut: "nl", ell: "el", eng: "en", fin: "fi", fra: "fr", fre: "fr",
        ger: "de", gre: "el", heb: "he", hin: "hi", hrv: "hr", hun: "hu", ind: "id",
        ita: "it", jpn: "ja", kor: "ko", msa: "ms", nld: "nl", nor: "no", pol: "pl",
        por: "pt", ron: "ro", rum: "ro", rus: "ru", slk: "sk", slo: "sk", spa: "es",
        srp: "sr", swe: "sv", tha: "th", tur: "tr", ukr: "uk", vie: "vi", zho: "zh",
    };
    const nonLanguagePathTokens = new Set([
        "api", "caption", "captions", "dtt", "dfxp", "manifest", "master", "mpd",
        "srt", "sub", "subs", "subtitle", "subtitles", "track", "tracks", "ttml", "vtt",
    ]);

    const normalizeLanguage = (value) => {
        if (typeof value !== "string") {
            return null;
        }

        const normalized = value.trim().replace(/_/g, "-").toLowerCase();
        if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(normalized)) {
            return null;
        }

        const [primary, ...subtags] = normalized.split("-");
        return [languageCodeAliases[primary] || primary, ...subtags].join("-");
    };

    const getLanguageFromText = (value) => {
        const directLanguage = normalizeLanguage(value);
        if (directLanguage) {
            return directLanguage;
        }

        if (typeof value !== "string") {
            return null;
        }

        const normalized = value.toLowerCase();
        const namedLanguages = [
            ["english", "en"], ["french", "fr"], ["spanish", "es"], ["german", "de"],
            ["italian", "it"], ["portuguese", "pt"], ["japanese", "ja"], ["korean", "ko"],
            ["chinese", "zh"], ["russian", "ru"], ["arabic", "ar"], ["dutch", "nl"],
            ["swedish", "sv"], ["norwegian", "no"], ["danish", "da"], ["finnish", "fi"],
            ["polish", "pl"], ["turkish", "tr"], ["ukrainian", "uk"], ["hebrew", "he"],
            ["greek", "el"], ["romanian", "ro"], ["czech", "cs"], ["hungarian", "hu"],
            ["bulgarian", "bg"], ["croatian", "hr"], ["serbian", "sr"], ["slovak", "sk"],
            ["vietnamese", "vi"], ["thai", "th"], ["indonesian", "id"], ["malay", "ms"],
        ];
        for (const [name, code] of namedLanguages) {
            if (normalized.includes(name)) {
                if (code === "en") {
                    if (/\b(?:gb|uk|british|great britain)\b/.test(normalized)) {
                        return "en-gb";
                    }
                    if (/\b(?:us|usa|american)\b/.test(normalized)) {
                        return "en-us";
                    }
                }
                if (code === "pt" && /\b(?:br|brazil|brazilian)\b/.test(normalized)) {
                    return "pt-br";
                }
                return code;
            }
        }

        const languageMatch = normalized.match(/\b([a-z]{2,3}(?:[-_][a-z0-9]{2,8})?)\b/i);
        if (languageMatch) {
            return normalizeLanguage(languageMatch[1]);
        }

        return null;
    };

    const getLanguageFromUrl = (value) => {
        try {
            const parsed = new URL(value, window.location.href);

            for (const key of languageKeys) {
                const language = getLanguageFromText(parsed.searchParams.get(key));
                if (language) {
                    return language;
                }
            }

            const pathLanguageMatches = [...decodeURIComponent(parsed.pathname).matchAll(
                /(?:^|[._/-])([a-z]{2,3}(?:[-_][a-z0-9]{2,8})?)(?=[._/-]|$)/gi
            )].reverse();
            for (const match of pathLanguageMatches) {
                const language = normalizeLanguage(match[1]);
                if (language && !nonLanguagePathTokens.has(match[1].toLowerCase())) {
                    return language;
                }
            }
        } catch {
            // Ignore malformed URLs; they are not usable command inputs.
        }

        return null;
    };

    const isSubtitleFileUrl = (value) => subtitleFilePattern.test(value || "");
    const isSubtitlePlaylistUrl = (value) => subtitlePlaylistPattern.test(value || "");
    const isSubtitleAssetUrl = (value) => isSubtitleFileUrl(value) || isSubtitlePlaylistUrl(value);
    const isDisneyPlusSubtitleUrl = (value) => {
        if (isDisneyPlusPage) {
            return true;
        }
        try {
            return /(^|\.)media\.dssott\.com$/i.test(new URL(value, window.location.href).hostname);
        } catch {
            return false;
        }
    };

    const addSubtitleCandidate = (
        candidates,
        url,
        language = null,
        sourceUrl = window.location.href,
        observedDirectly = false
    ) => {
        if (!url || typeof url !== "string") {
            return;
        }

        let resolvedUrl;
        try {
            resolvedUrl = new URL(url, sourceUrl).href;
        } catch {
            return;
        }

        if (!isSubtitleAssetUrl(resolvedUrl)) {
            return;
        }

        const existing = candidates.get(resolvedUrl);
        const resolvedLanguage = getLanguageFromText(language) || getLanguageFromUrl(resolvedUrl);
        if (!existing
            || (!existing.language && resolvedLanguage)
            || (observedDirectly && !existing.observedDirectly)) {
            candidates.set(resolvedUrl, {
                url: resolvedUrl,
                language: resolvedLanguage || existing?.language || null,
                observedDirectly: observedDirectly || existing?.observedDirectly || false,
                playlist: isSubtitlePlaylistUrl(resolvedUrl),
            });
        }
    };

    const getObjectLanguage = (value) => {
        for (const key of languageKeys) {
            const language = getLanguageFromText(value?.[key]);
            if (language) {
                return language;
            }
        }

        for (const key of languageTextKeys) {
            const language = getLanguageFromText(value?.[key]);
            if (language) {
                return language;
            }
        }

        return null;
    };

    const extractSubtitleUrlsFromJson = (
        value,
        candidates,
        sourceUrl,
        inheritedLanguage = null,
        subtitleContext = false
    ) => {
        if (Array.isArray(value)) {
            value.forEach((item) => extractSubtitleUrlsFromJson(item, candidates, sourceUrl, inheritedLanguage, subtitleContext));
            return;
        }

        if (!value || typeof value !== "object") {
            return;
        }

        const language = getObjectLanguage(value) || inheritedLanguage;
        const objectContext = subtitleContext || subtitleContextPattern.test(
            [value.type, value.kind, value.role, value.label, value.name].filter(Boolean).join(" ")
        );

        for (const [key, item] of Object.entries(value)) {
            const keyContext = objectContext || subtitleContextPattern.test(key);
            if (typeof item === "string" && /url|uri|src|href|file|link/i.test(key)) {
                if (keyContext && isSubtitleAssetUrl(item)) {
                    addSubtitleCandidate(candidates, item, language, sourceUrl);
                }
                continue;
            }

            extractSubtitleUrlsFromJson(item, candidates, sourceUrl, language, keyContext);
        }
    };

    const extractSubtitleUrlsFromText = (text, sourceUrl, candidates) => {
        const hlsMediaRegex = /#EXT-X-MEDIA:([^\r\n]+)/gi;
        for (const match of text.matchAll(hlsMediaRegex)) {
            const attributes = match[1];
            if (!/TYPE=SUBTITLES/i.test(attributes)) {
                continue;
            }

            const uriMatch = attributes.match(/(?:^|,)URI=(?:"([^"]+)"|([^,]+))/i);
            const languageMatch = attributes.match(/(?:^|,)LANGUAGE=(?:"([^"]+)"|([^,]+))/i);
            if (uriMatch) {
                try {
                    addSubtitleCandidate(candidates, uriMatch[1] || uriMatch[2], languageMatch?.[1] || languageMatch?.[2], sourceUrl);
                } catch {
                    // Ignore a malformed playlist URI.
                }
            }
        }

        const dashAdaptationSetRegex = /<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi;
        for (const match of text.matchAll(dashAdaptationSetRegex)) {
            const attributes = match[1];
            const content = match[2];
            if (!/contentType=["']text["']|mimeType=["'][^"']*(?:ttml|vtt|subtitle)|codecs=["'][^"']*(?:stpp|wvtt)/i.test(attributes)) {
                continue;
            }

            const languageMatch = attributes.match(/\blang=["']([^"']+)["']/i);
            const baseUrlMatch = content.match(/<BaseURL>([^<]+)<\/BaseURL>/i);
            if (baseUrlMatch) {
                try {
                    addSubtitleCandidate(candidates, baseUrlMatch[1], languageMatch?.[1], sourceUrl);
                } catch {
                    // Ignore a malformed MPD BaseURL.
                }
            }
        }
    };

    async function emitSubtitleIfNeeded(url, body) {
        const candidates = new Map();
        let sourceUrl = url;
        try {
            sourceUrl = new URL(url, window.location.href).href;
        } catch {
            // addSubtitleCandidate will reject unusable URL values below.
        }

        // JW Player uses VTT as an image-sprite index for preview thumbnails.
        // It has VTT timing syntax but is not a subtitle track.
        if (isImageSpriteVtt(sourceUrl, body)) {
            return;
        }

        const directSubtitleContentIdentity = isSubtitleFileUrl(sourceUrl)
            ? getSubtitleContentIdentity(body)
            : null;

        const isIncompleteDisneySegment = isDisneyPlusSubtitleUrl(sourceUrl)
            && segmentedVttPattern.test(sourceUrl);
        if (url && isSubtitleFileUrl(url) && !isIncompleteDisneySegment) {
            addSubtitleCandidate(candidates, url, null, sourceUrl, true);
        }

        if (body) {
            extractSubtitleUrlsFromText(body, sourceUrl, candidates);
            try {
                extractSubtitleUrlsFromJson(JSON.parse(body), candidates, sourceUrl);
            } catch {
                // Non-JSON responses are handled by the playlist/text parsers above.
            }
        }

        for (const candidate of candidates.values()) {
            await emitAndWaitForResponse("SUBTITLE", JSON.stringify({
                ...candidate,
                sourceUrl,
                contentIdentity: candidate.observedDirectly && candidate.url === sourceUrl
                    ? directSubtitleContentIdentity
                    : null,
            }));
        }
    }

    function isImageSpriteVtt(url, body) {
        return /\/strips\//i.test(url || '')
            || /\.(?:jpe?g|png|webp)#xywh=/i.test(body || '');
    }

    function getSubtitleContentIdentity(body) {
        if (typeof body !== 'string' || body.length === 0 || body.length > 1_000_000) {
            return null;
        }

        // Compare cue text rather than container formatting: the same track
        // often appears once as SRT and once as WEBVTT with different timing
        // punctuation and cue numbering.
        const normalized = body
            .replace(/\r/g, '')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line
                && !/^\uFEFF?WEBVTT/i.test(line)
                && !/^X-TIMESTAMP-MAP/i.test(line)
                && !/^\d+$/.test(line)
                && !/-->/.test(line)
            )
            .join('\n');
        if (!normalized) {
            return null;
        }

        let hash = 0x811c9dc5;
        for (let index = 0; index < normalized.length; index += 1) {
            hash ^= normalized.charCodeAt(index);
            hash = Math.imul(hash, 0x01000193);
        }
        return `fnv1a-${(hash >>> 0).toString(16)}-${normalized.length}`;
    }

    const getManifestDurationSeconds = (text, manifestType) => {
        if (manifestType === 'HLS_MASTER') {
            return null;
        }

        if (manifestType === 'HLS_PLAYLIST') {
            const durations = [...text.matchAll(/#EXTINF:([0-9]+(?:\.[0-9]+)?)/gi)]
                .map((match) => Number.parseFloat(match[1]));
            const total = durations.reduce((sum, duration) => sum + duration, 0);
            return total > 0 ? Math.round(total) : null;
        }

        if (manifestType === 'DASH') {
            const duration = text.match(/\bmediaPresentationDuration=["']P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?["']/i);
            if (duration) {
                const [, days = '0', hours = '0', minutes = '0', seconds = '0'] = duration;
                return Math.round(Number(days) * 86400 + Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds));
            }
        }

        if (manifestType === 'MSS') {
            const root = text.match(/<SmoothStreamingMedia\b([^>]*)>/i)?.[1] || '';
            const duration = root.match(/\bDuration=["'](\d+)["']/i)?.[1];
            const timeScale = root.match(/\bTimeScale=["'](\d+)["']/i)?.[1] || '10000000';
            if (duration && Number(timeScale) > 0) {
                return Math.round(Number(duration) / Number(timeScale));
            }
        }

        return null;
    };

    const getHlsMasterDurationSeconds = async (text, sourceUrl) => {
        const lines = text.split(/\r?\n/);
        const variantUrls = [];
        for (let index = 0; index < lines.length; index += 1) {
            if (!/^#EXT-X-STREAM-INF:/i.test(lines[index])) {
                continue;
            }
            const uri = lines.slice(index + 1).find((line) => line.trim() && !line.startsWith('#'));
            if (uri) {
                variantUrls.push(new URL(uri.trim(), sourceUrl).href);
            }
        }

        for (const variantUrl of variantUrls) {
            try {
                const response = await fetch(variantUrl, { credentials: 'include' });
                if (!response.ok) {
                    continue;
                }
                const duration = getManifestDurationSeconds(await response.text(), 'HLS_PLAYLIST');
                if (duration) {
                    return duration;
                }
            } catch {
                // Try the next variant, or leave the duration unavailable.
            }
        }
        return null;
    };

    const getDetectedManifestDuration = async (text, manifestType, sourceUrl) => {
        const directDuration = getManifestDurationSeconds(text, manifestType);
        return directDuration || (manifestType === 'HLS_MASTER'
            ? getHlsMasterDurationSeconds(text, sourceUrl)
            : null);
    };

    const capturedDirectVideoUrls = new Set();

    const emitDirectVideoIfNeeded = async (url) => {
        if (!url || capturedDirectVideoUrls.has(url)) {
            return;
        }

        try {
            const resolvedUrl = new URL(url, window.location.href).href;
            if (!new URL(resolvedUrl).pathname.toLowerCase().endsWith('.mp4')) {
                return;
            }
            capturedDirectVideoUrls.add(resolvedUrl);
            await emitAndWaitForResponse("DIRECT_VIDEO", JSON.stringify({ url: resolvedUrl }));
        } catch {
            // Ignore non-URL values such as a MediaSource blob URL.
        }
    };

    const inspectVideoElement = (video) => {
        emitDirectVideoIfNeeded(video.currentSrc || video.src);
        video.querySelectorAll?.('source[src]').forEach((source) => emitDirectVideoIfNeeded(source.src));
    };

    const inspectDirectVideoSources = (node) => {
        if (!(node instanceof Element)) {
            return;
        }
        if (node instanceof HTMLVideoElement) {
            inspectVideoElement(node);
        }
        node.querySelectorAll?.('video').forEach(inspectVideoElement);
        if (node instanceof HTMLSourceElement && node.parentElement instanceof HTMLVideoElement) {
            emitDirectVideoIfNeeded(node.src);
        }
    };

    new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes') {
                inspectDirectVideoSources(mutation.target);
            } else {
                mutation.addedNodes.forEach(inspectDirectVideoSources);
            }
        }
    }).observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src'],
    });

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('video').forEach(inspectVideoElement);
    });

    function emitAndWaitForResponse(type, data) {
        return new Promise((resolve) => {
            const requestId = Math.random().toString(16).substring(2, 9);
            const responseHandler = (event) => {
                const { detail } = event;
                if (detail.substring(0, 7) === requestId) {
                    document.removeEventListener('responseReceived', responseHandler);
                    resolve(detail.substring(7));
                }
            };
            document.addEventListener('responseReceived', responseHandler);
            const requestEvent = new CustomEvent('response', {
                detail: {
                    type: type,
                    body: data,
                    requestId: requestId,
                }
            });
            document.dispatchEvent(requestEvent);
        });
    }

    let lastMaxMetadataLink = '';
    let observedMaxMetadataLink = '';

    const canonicalMaxShowUrl = (value) => {
        try {
            const parsed = new URL(String(value || ''), location.href);
            if (!maxHostPattern.test(parsed.hostname)) return '';
            const match = parsed.pathname.match(/(?:^|\/)(show|movie)\/([0-9a-f-]{36})(?:\/|$)/i);
            return match ? `https://www.hbomax.com/${match[1].toLowerCase()}/${match[2].toLowerCase()}` : '';
        } catch {
            return '';
        }
    };

    const resolveMaxMetadataLink = () => {
        if (!isMaxVideoPage) return '';
        const direct = new Set([
            location.href,
            document.referrer,
            document.querySelector('link[rel="canonical"]')?.href,
            document.querySelector('meta[property="og:url"]')?.content,
        ].map(canonicalMaxShowUrl).filter(Boolean));
        if (direct.size === 1) return [...direct][0];
        if (observedMaxMetadataLink) return observedMaxMetadataLink;

        const episodeId = location.pathname.match(/(?:^|\/)video\/watch\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
        if (!episodeId) return '';
        const nearby = new Set();
        for (const script of document.scripts) {
            const text = script.textContent || '';
            const identityIndex = text.toLowerCase().indexOf(episodeId.toLowerCase());
            if (identityIndex < 0) continue;
            const candidates = [...text.matchAll(/(?:https?:\\?\/\\?\/[^"'\s\\]+)?\\?\/(show|movie)\\?\/([0-9a-f-]{36})/gi)]
                .map((match) => ({
                    url: `https://www.hbomax.com/${match[1].toLowerCase()}/${match[2].toLowerCase()}`,
                    distance: Math.abs((match.index || 0) - identityIndex),
                }))
                .sort((left, right) => left.distance - right.distance);
            if (candidates[0]) nearby.add(candidates[0].url);
        }
        return nearby.size === 1 ? [...nearby][0] : '';
    };

    const emitMaxMetadataLink = () => {
        const detailUrl = resolveMaxMetadataLink();
        if (!detailUrl || detailUrl === lastMaxMetadataLink) return;
        lastMaxMetadataLink = detailUrl;
        emitAndWaitForResponse('MAX_METADATA_LINK', detailUrl).catch(() => {});
    };

    const observeMaxMetadataPayload = (payload) => {
        if (!isMaxVideoPage || typeof payload !== 'string' || payload.length < 20) return;
        const episodeId = location.pathname.match(/(?:^|\/)video\/watch\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
        if (!episodeId) return;
        const lower = payload.toLowerCase();
        const identityIndex = lower.indexOf(episodeId.toLowerCase());
        if (identityIndex < 0) return;
        const candidates = [];
        for (const match of payload.matchAll(/(?:https?:\\?\/\\?\/[^"'\s\\]+)?\\?\/(show|movie)\\?\/([0-9a-f-]{36})/gi)) {
            candidates.push({
                url: `https://www.hbomax.com/${match[1].toLowerCase()}/${match[2].toLowerCase()}`,
                distance: Math.abs((match.index || 0) - identityIndex),
            });
        }
        for (const match of payload.matchAll(/["'](?:showId|seriesId|show_id|series_id)["']\s*:\s*["']([0-9a-f-]{36})["']/gi)) {
            candidates.push({
                url: `https://www.hbomax.com/show/${match[1].toLowerCase()}`,
                distance: Math.abs((match.index || 0) - identityIndex),
            });
        }
        candidates.sort((left, right) => left.distance - right.distance);
        if (!candidates[0]) return;
        const closestDistance = candidates[0].distance;
        const closest = new Set(candidates
            .filter((candidate) => candidate.distance === closestDistance)
            .map((candidate) => candidate.url));
        if (closest.size !== 1) return;
        observedMaxMetadataLink = [...closest][0];
        emitMaxMetadataLink();
    };

    if (isMaxVideoPage) {
        emitMaxMetadataLink();
        document.addEventListener('DOMContentLoaded', emitMaxMetadataLink, { once: true });
        const maxMetadataTimer = setInterval(emitMaxMetadataLink, 2000);
        setTimeout(() => clearInterval(maxMetadataTimer), 30000);
    }

    let lastDisneyMetadataLink = '';

    const canonicalDisneyEntityUrl = (value) => {
        try {
            const parsed = new URL(String(value || ''), location.href);
            if (!/(^|\.)disneyplus\.com$/i.test(parsed.hostname)) return '';
            const match = parsed.pathname.match(/\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?browse\/entity-([0-9a-f-]{36})(?:\/|$)/i);
            return match ? `https://www.disneyplus.com/browse/entity-${match[1].toLowerCase()}` : '';
        } catch {
            return '';
        }
    };

    const resolveDisneyMetadataLink = () => {
        if (!isDisneyPlusPage) return '';
        const direct = new Set([
            location.href,
            document.referrer,
            document.querySelector('link[rel="canonical"]')?.href,
            document.querySelector('meta[property="og:url"]')?.content,
        ].map(canonicalDisneyEntityUrl).filter(Boolean));
        if (direct.size === 1) return [...direct][0];

        const playId = location.pathname.match(/\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?play\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
        if (!playId) return '';
        const nearby = new Set();
        for (const script of document.scripts) {
            const text = script.textContent || '';
            const identityIndex = text.toLowerCase().indexOf(playId.toLowerCase());
            if (identityIndex < 0) continue;
            const candidates = [...text.matchAll(/(?:\\?\/)?browse\\?\/entity-([0-9a-f-]{36})/gi)]
                .map((match) => ({
                    url: `https://www.disneyplus.com/browse/entity-${match[1].toLowerCase()}`,
                    distance: Math.abs((match.index || 0) - identityIndex),
                }))
                .sort((left, right) => left.distance - right.distance);
            if (candidates[0]) nearby.add(candidates[0].url);
        }
        return nearby.size === 1 ? [...nearby][0] : '';
    };

    const emitDisneyMetadataLink = () => {
        const detailUrl = resolveDisneyMetadataLink();
        if (!detailUrl || detailUrl === lastDisneyMetadataLink) return;
        lastDisneyMetadataLink = detailUrl;
        emitAndWaitForResponse('DISNEY_METADATA_LINK', detailUrl).catch(() => {});
    };

    if (isDisneyPlusPage) {
        emitDisneyMetadataLink();
        document.addEventListener('DOMContentLoaded', emitDisneyMetadataLink, { once: true });
        const disneyMetadataTimer = setInterval(emitDisneyMetadataLink, 2000);
        setTimeout(() => clearInterval(disneyMetadataTimer), 30000);
    }

    let amazonHydrationSignature = '';
    let amazonEpisodeIndex = null;
    let lastAmazonEpisodeIdentity = '';
    let currentAmazonEpisodeIdentity = null;
    const pendingAmazonPlaybackObservations = [];

    const canonicalAmazonEpisodeUrl = (value) => {
        try {
            const parsed = new URL(String(value || '').replaceAll('\\u0026', '&'), location.href);
            const match = parsed.pathname.match(/\/(?:region\/([^/]+)\/)?detail\/([A-Z0-9]+)(?:\/|$)/i);
            return match
                ? `https://www.primevideo.com/region/${match[1] || 'na'}/detail/${match[2].toUpperCase()}`
                : '';
        } catch {
            return '';
        }
    };

    const amazonPrimaryPlayback = (action) => {
        for (const item of Array.isArray(action?.primaryActions) ? action.primaryActions : []) {
            const playback = item?.payload?.playback;
            if (String(item?.actionType || '').toUpperCase() === 'PLAY'
                && playback && typeof playback === 'object' && playback.isTrailer !== true) {
                return playback;
            }
        }
        return {};
    };

    const buildAmazonEpisodeIndex = () => {
        if (!isAmazonPrimeVideoPage) {
            return null;
        }
        const script = document.getElementById('dv-web-page-hydration-data');
        const signature = script?.textContent || '';
        if (!signature) {
            return null;
        }
        if (amazonEpisodeIndex && signature === amazonHydrationSignature) {
            return amazonEpisodeIndex;
        }
        try {
            const page = JSON.parse(signature);
            const btf = page?.init?.preparations?.body?.btf?.state || {};
            const details = btf?.detail?.detail || {};
            const selves = btf?.self || {};
            const actions = btf?.action?.btf || {};
            const headerDetails = page?.init?.preparations?.body?.atf?.state?.detail?.headerDetail || {};
            const header = Object.values(headerDetails).find((value) => value && typeof value === 'object') || {};
            const seriesTitle = String(header.parentTitle || header.title || '')
                .replace(/\s*-?\s*Season\s+\d+\s*$/i, '').trim();
            const seasonNumber = Number.parseInt(header.seasonNumber, 10) || 0;
            const ids = Array.isArray(btf?.episodeList?.cardTitleIds)
                ? btf.episodeList.cardTitleIds
                : Object.keys(details);
            const aliases = new Map();
            const records = [];
            const addAlias = (value, record) => {
                const normalized = String(value || '').trim().toUpperCase();
                if (!normalized) {
                    return;
                }
                if (!aliases.has(normalized)) {
                    aliases.set(normalized, new Set());
                }
                aliases.get(normalized).add(record);
            };
            for (const rawGti of ids) {
                const gti = String(rawGti || '').trim();
                const detail = details[gti] || {};
                const self = selves[gti] || {};
                if (String(detail.titleType || '').toLowerCase() !== 'episode') {
                    continue;
                }
                const detailUrl = canonicalAmazonEpisodeUrl(self.link);
                const compactGTI = String(self.compactGTI || detailUrl.match(/\/detail\/([A-Z0-9]+)/i)?.[1] || '').trim();
                const asins = Array.isArray(self.asins) ? self.asins.map(String).filter(Boolean) : [];
                const playback = amazonPrimaryPlayback(actions[gti]);
                const playbackID = String(playback.playbackID || gti).trim();
                if (!gti || !compactGTI || !detailUrl) {
                    continue;
                }
                const record = {
                    status: 'resolved',
                    gti,
                    compactGTI,
                    asins,
                    playbackID,
                    detailUrl,
                    seriesTitle,
                    seasonNumber: Number.parseInt(detail.seasonNumber, 10) || seasonNumber,
                    episodeNumber: Number.parseInt(detail.episodeNumber, 10) || Number.parseInt(self.sequenceNumber, 10) || 0,
                    episodeTitle: String(detail.title || '').trim(),
                };
                records.push(record);
                [gti, compactGTI, playbackID, ...asins].forEach((value) => addAlias(value, record));
            }
            amazonHydrationSignature = signature;
            amazonEpisodeIndex = { aliases, records };
            return amazonEpisodeIndex;
        } catch (error) {
            console.debug('MediaFab could not read Prime Video episode hydration.', error);
            return null;
        }
    };

    const emitAmazonEpisodeIdentity = (record) => {
        currentAmazonEpisodeIdentity = record;
        const serialized = JSON.stringify(record);
        if (serialized === lastAmazonEpisodeIdentity) {
            return;
        }
        lastAmazonEpisodeIdentity = serialized;
        emitAndWaitForResponse('AMAZON_PLAYBACK_IDENTITY', serialized).catch(() => {});
    };

    const amazonIdentityValues = (requestUrl, requestBody = null) => {
        const values = new Set();
        const identityKeys = /^(?:asin|asins|titleid|titleids|playbackid|gti|compactgti|catalogid)$/i;
        const add = (value) => {
            if (Array.isArray(value)) {
                value.forEach(add);
            } else if (typeof value === 'string' || typeof value === 'number') {
                values.add(String(value).trim().toUpperCase());
            }
        };
        try {
            const parsed = new URL(requestUrl, location.href);
            for (const [key, value] of parsed.searchParams) {
                if (identityKeys.test(key)) {
                    add(value);
                }
            }
            const pathId = parsed.pathname.match(/\/detail\/([A-Z0-9]+)/i)?.[1];
            if (pathId) {
                add(pathId);
            }
        } catch {
            // The body may still contain the selected identity.
        }
        const walk = (value, depth = 0) => {
            if (depth > 10 || value == null) {
                return;
            }
            if (Array.isArray(value)) {
                value.forEach((item) => walk(item, depth + 1));
                return;
            }
            if (typeof value === 'object') {
                for (const [key, item] of Object.entries(value)) {
                    if (identityKeys.test(key)) {
                        add(item);
                    } else {
                        walk(item, depth + 1);
                    }
                }
            }
        };
        if (requestBody && typeof requestBody === 'object' && !(requestBody instanceof URLSearchParams)) {
            walk(requestBody);
        } else if (requestBody != null) {
            const text = String(requestBody);
            try {
                walk(JSON.parse(text));
            } catch {
                try {
                    for (const [key, value] of new URLSearchParams(text)) {
                        if (identityKeys.test(key)) {
                            add(value);
                        }
                    }
                } catch {
                    // Ignore non-structured request bodies.
                }
            }
        }
        return values;
    };

    const observeAmazonPlaybackIdentity = (requestUrl, requestBody = null, force = false) => {
        if (!isAmazonPrimeVideoPage) {
            return false;
        }
        const playbackRequest = /(?:getplaybackresources|playback|\/cdp\/catalog\/)/i.test(String(requestUrl || ''));
        if (!force && !playbackRequest) {
            return false;
        }
        const index = buildAmazonEpisodeIndex();
        if (!index) {
            pendingAmazonPlaybackObservations.push([requestUrl, requestBody, force]);
            return false;
        }
        const observedValues = amazonIdentityValues(requestUrl, requestBody);
        const candidates = new Set();
        for (const value of observedValues) {
            index.aliases.get(value)?.forEach((record) => candidates.add(record));
        }
        if (candidates.size === 1) {
            emitAmazonEpisodeIdentity([...candidates][0]);
            return true;
        }
        if (playbackRequest && observedValues.size > 0) {
            emitAmazonEpisodeIdentity({ status: 'unresolved' });
        }
        return false;
    };

    const refreshAmazonEpisodeIdentity = () => {
        if (!buildAmazonEpisodeIndex()) {
            return;
        }
        observeAmazonPlaybackIdentity(location.href, null, true);
        const pending = pendingAmazonPlaybackObservations.splice(0);
        pending.forEach(([url, body, force]) => observeAmazonPlaybackIdentity(url, body, force));
    };

    if (Boolean(isAmazonPrimeVideoPage)) {
        document.addEventListener('click', (event) => {
            const link = event.target?.closest?.('a[href*="/detail/"]');
            if (link?.href) {
                observeAmazonPlaybackIdentity(link.href, null, true);
            }
        }, true);
        new MutationObserver(refreshAmazonEpisodeIdentity).observe(document.documentElement, {
            childList: true,
            subtree: true,
        });
        document.addEventListener('DOMContentLoaded', refreshAmazonEpisodeIdentity, { once: true });
    }

    const mediaKeysServerCertificates = new WeakMap();
    const sessionMediaKeys = new WeakMap();
    const sessionServerCertificates = new WeakMap();
    const wrappedMessageListeners = new WeakMap();
    const providerOnMessageListeners = new WeakMap();

    const copyBytes = (value) => {
        if (value instanceof ArrayBuffer) {
            return new Uint8Array(value.slice(0));
        }
        if (ArrayBuffer.isView(value)) {
            return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
        }
        return new Uint8Array(value);
    };

    const getServerCertificate = (session) => {
        const mediaKeys = sessionMediaKeys.get(session);
        return (mediaKeys && mediaKeysServerCertificates.get(mediaKeys))
            || sessionServerCertificates.get(session)
            || null;
    };

    if (typeof MediaKeys !== 'undefined') {
        proxy(MediaKeys.prototype, 'setServerCertificate', async (target, thisArg, args) => {
            const result = await target.apply(thisArg, args);
            mediaKeysServerCertificates.set(thisArg, copyBytes(args[0]));
            return result;
        });

        proxy(MediaKeys.prototype, 'createSession', (target, thisArg, args) => {
            const session = target.apply(thisArg, args);
            sessionMediaKeys.set(session, thisArg);
            return session;
        });
    }

    if (usesOnMessageInterception && typeof MediaKeySession !== 'undefined'
        && typeof MediaKeyMessageEvent !== 'undefined') {
        let descriptorOwner = MediaKeySession.prototype;
        let onMessageDescriptor = null;
        while (descriptorOwner && !onMessageDescriptor) {
            onMessageDescriptor = Object.getOwnPropertyDescriptor(descriptorOwner, 'onmessage');
            descriptorOwner = Object.getPrototypeOf(descriptorOwner);
        }
        if (typeof onMessageDescriptor?.get === 'function'
            && typeof onMessageDescriptor?.set === 'function') {
            try {
                Object.defineProperty(MediaKeySession.prototype, 'onmessage', {
                    configurable: true,
                    enumerable: onMessageDescriptor.enumerable,
                    get() {
                        return providerOnMessageListeners.get(this)?.original
                            || onMessageDescriptor.get.call(this);
                    },
                    set(listener) {
                        if (!listener) {
                            providerOnMessageListeners.delete(this);
                            onMessageDescriptor.set.call(this, listener);
                            return;
                        }
                        const session = this;
                        const wrapped = async function(event) {
                            const isTrustedMessage = event instanceof MediaKeyMessageEvent && event.isTrusted;
                            const messageBytes = isTrustedMessage ? copyBytes(event.message) : null;
                            if (isTrustedMessage && messageBytes.byteLength > 2) {
                                event.stopImmediatePropagation();
                                event.preventDefault();

                                let challenge = messageBytes;
                                try {
                                    const serverCertificate = getServerCertificate(session);
                                    const payload = JSON.stringify({
                                        challenge: b64.encode(messageBytes),
                                        serverCertificate: serverCertificate ? b64.encode(serverCertificate) : null,
                                    });
                                    const replacement = await emitAndWaitForResponse('REQUEST', payload);
                                    if (typeof replacement === 'string' && replacement) {
                                        challenge = b64.decode(replacement);
                                    }
                                } catch (error) {
                                    console.debug('MediaFab challenge replacement failed; preserving playback.', error);
                                }

                                session.dispatchEvent(new MediaKeyMessageEvent('message', {
                                    messageType: event.messageType,
                                    message: copyBytes(challenge).buffer,
                                }));
                                return;
                            }
                            if (typeof listener === 'object' && typeof listener.handleEvent === 'function') {
                                return listener.handleEvent.call(listener, event);
                            }
                            return listener.call(this, event);
                        };
                        providerOnMessageListeners.set(this, { original: listener, wrapped });
                        onMessageDescriptor.set.call(this, wrapped);
                    },
                });
            } catch (error) {
                console.debug('MediaFab could not install the provider onmessage interceptor.', error);
            }
        }
    }

    if (typeof EventTarget !== 'undefined') {
        proxy(EventTarget.prototype, 'addEventListener', (target, thisArg, args) => {
            const [type, listener] = args;
            if (thisArg == null || typeof MediaKeySession === 'undefined'
                || !(thisArg instanceof MediaKeySession)
                || typeof MediaKeyMessageEvent === 'undefined'
                || type !== "message" || !listener
                || !['function', 'object'].includes(typeof listener)) {
                return target.apply(thisArg, args);
            }

            let targetListeners = wrappedMessageListeners.get(thisArg);
            if (!targetListeners) {
                targetListeners = new WeakMap();
                wrappedMessageListeners.set(thisArg, targetListeners);
            }
            let wrapped = targetListeners.get(listener);
            if (!wrapped) {
                wrapped = async function(event) {
                    const isTrustedMessage = event instanceof MediaKeyMessageEvent && event.isTrusted;
                    const messageBytes = isTrustedMessage ? copyBytes(event.message) : null;

                    if (isTrustedMessage && messageBytes.byteLength > 2) {
                        if (!isAmazonPrimeVideoPage) {
                            // Stop the native event synchronously, before waiting on the
                            // extension round trip. Otherwise later page listeners can
                            // send the browser challenge before the replacement exists.
                            event.stopImmediatePropagation();
                            event.preventDefault();
                        }

                        let challenge = messageBytes;
                        try {
                            const serverCertificate = getServerCertificate(thisArg);
                            const payload = JSON.stringify({
                                challenge: b64.encode(messageBytes),
                                serverCertificate: serverCertificate ? b64.encode(serverCertificate) : null,
                            });
                            const replacement = await emitAndWaitForResponse("REQUEST", payload);
                            if (typeof replacement === "string" && replacement) {
                                challenge = b64.decode(replacement);
                            }
                        } catch (error) {
                            console.debug("MediaFab challenge replacement failed; preserving playback.", error);
                        }

                        if (isAmazonPrimeVideoPage) {
                            // Amazon must receive its original trusted event. Replace only
                            // the event's challenge property, matching upstream property mode.
                            try {
                                Object.defineProperty(event, "message", {
                                    configurable: true,
                                    get: () => copyBytes(challenge).buffer,
                                });
                            } catch (error) {
                                console.debug("MediaFab Amazon property replacement failed; preserving the original challenge.", error);
                            }

                            if (typeof listener === 'object' && typeof listener.handleEvent === 'function') {
                                return listener.handleEvent.call(listener, event);
                            }
                            return listener.call(this, event);
                        }

                        thisArg.dispatchEvent(new MediaKeyMessageEvent("message", {
                            messageType: event.messageType,
                            message: copyBytes(challenge).buffer
                        }));
                        return;
                    }

                    if (typeof listener === 'object' && typeof listener.handleEvent === 'function') {
                        return listener.handleEvent.call(listener, event);
                    }
                    return listener.call(this, event);
                };
                targetListeners.set(listener, wrapped);
            }
            args[1] = wrapped;
            return target.apply(thisArg, args);
        });

        proxy(EventTarget.prototype, 'removeEventListener', (target, thisArg, args) => {
            const [type, listener] = args;
            if (type === 'message' && listener && typeof MediaKeySession !== 'undefined'
                && thisArg instanceof MediaKeySession) {
                args[1] = wrappedMessageListeners.get(thisArg)?.get(listener) || listener;
            }
            return target.apply(thisArg, args);
        });
    }

    if (typeof MediaKeySession !== 'undefined') {
        proxy(MediaKeySession.prototype, 'update', async (target, thisArg, args) => {
            if (thisArg == null || !(thisArg instanceof MediaKeySession)) {
                return target.apply(thisArg, args);
            }

            let certificateHandled = false;
            try {
                const inspection = await emitAndWaitForResponse("CERTIFICATE", b64.encode(args[0]));
                const prefix = "CERTIFICATE:";
                if (typeof inspection === "string" && inspection.startsWith(prefix)) {
                    sessionServerCertificates.set(thisArg, b64.decode(inspection.slice(prefix.length)));
                    certificateHandled = true;
                }
            } catch (error) {
                console.debug("MediaFab service-certificate inspection failed.", error);
            }
            if (!certificateHandled) {
                await emitAndWaitForResponse("RESPONSE", b64.encode(args[0]));
            }

            try {
                return await target.apply(thisArg, args);
            } catch (e) {
                // The browser CDM may reject the replacement-device response.
            }
        });
    }

    proxy(XMLHttpRequest.prototype,  "open", (target, thisArg, args) => {
        const [method, url] = args;

        thisArg.requestMethod = method.toUpperCase();
        thisArg.requestURL = url;

        return target.apply(thisArg, args);
    });

    proxy(XMLHttpRequest.prototype, "send", (target, thisArg, args) => {
        observeAmazonPlaybackIdentity(thisArg.requestURL, args[0]);
        thisArg.addEventListener("readystatechange", async () => {
            if (thisArg.readyState !== 4) {
                return;
            }

            let body = null;
            switch (thisArg.responseType) {
                case "":
                case "text":
                    body = thisArg.responseText ?? thisArg.response;
                    break;

                case "json":
                    body = typeof thisArg.response === 'string' ? thisArg.response : JSON.stringify(thisArg.response);
                    break;

                case "arraybuffer":
                    if (thisArg.response && thisArg.response.byteLength > 0 && thisArg.response.byteLength < 1_000_000) {
                        const arr = new Uint8Array(thisArg.response);
                        const decoder = new TextDecoder('utf-8', { fatal: false });
                        body = arr.length <= 2000
                            ? decoder.decode(arr)
                            : decoder.decode(arr.slice(0, 1000)) + decoder.decode(arr.slice(-1000));
                    }
                    break;

                case "blob":
                    if (thisArg.response.type.startsWith('text/') || thisArg.response.type.includes('xml') || thisArg.response.type.includes('json') || thisArg.response.size < 100_000) {
                        body = await thisArg.response.text();
                    }
                    break;

                case "document":
                    if (thisArg.response?.documentElement) {
                        body = new XMLSerializer().serializeToString(thisArg.response);
                    }
                    break;
            }

            if (body) {
                observeMaxMetadataPayload(body);
                const manifest_type = getManifestType(body);
                if (manifest_type) {
                    console.log("WVP2 FOUND MANIFEST", manifest_type, thisArg.responseURL);
                    await emitAndWaitForResponse("MANIFEST", JSON.stringify({
                        url: thisArg.responseURL,
                        type: manifest_type,
                        durationSeconds: await getDetectedManifestDuration(body, manifest_type, thisArg.responseURL),
                        psshValues: getManifestPsshValues(body),
                        amazonEpisodeIdentity: currentAmazonEpisodeIdentity,
                    }));
                }

                await emitSubtitleIfNeeded(thisArg.responseURL, body);
            }
        });

        return target.apply(thisArg, args);
    });

    proxy(window, "fetch", async (target, thisArg, args) => {
        const request = args[0];
        const requestUrl = typeof request === 'string' ? request : request?.url;
        observeAmazonPlaybackIdentity(requestUrl, args[1]?.body);
        if (isAmazonPrimeVideoPage && request instanceof Request && args[1]?.body == null) {
            request.clone().text().then((body) => {
                if (body) {
                    observeAmazonPlaybackIdentity(requestUrl, body);
                }
            }).catch(() => {});
        }
        const response = await target.apply(thisArg, args);

        try {
            if (response) {
                const url = response.url || (typeof request === "string" ? request : request?.url);
                response.clone().text().then(async (text) => {
                    observeMaxMetadataPayload(text);
                    const manifest_type = getManifestType(text);
                    if (manifest_type && url) {
                        await emitAndWaitForResponse("MANIFEST", JSON.stringify({
                            url,
                            type: manifest_type,
                            durationSeconds: await getDetectedManifestDuration(text, manifest_type, url),
                            psshValues: getManifestPsshValues(text),
                            amazonEpisodeIdentity: currentAmazonEpisodeIdentity,
                        }));
                    }
                    await emitSubtitleIfNeeded(url, text);
                }).catch((err) => console.debug("Manifest response extraction failed:", err));
            }
        } catch (err) {
            console.debug("Manifest intercept failed:", err);
        }

        return response;
    });
})();
