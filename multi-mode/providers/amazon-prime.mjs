const PRIME_VIDEO_HOST = /(^|\.)(?:primevideo\.com|amazon\.(?:ae|ca|cn|com|de|eg|es|fr|in|it|nl|pl|sa|se|sg|co\.jp|co\.uk|com\.au|com\.be|com\.br|com\.mx|com\.tr))$/i;
const PRIME_DETAIL_PATH = /\/(?:region\/([^/]+)\/)?detail\/([A-Z0-9]+)(?:\/|$)/i;

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function integer(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function decodeHtml(value) {
    return String(value || '')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function extractAmazonPrimeHydration(page) {
    const match = String(page || '').match(
        /<script[^>]+id=["']dv-web-page-hydration-data["'][^>]*>([\s\S]*?)<\/script>/i,
    );
    if (!match) {
        throw new Error('Prime Video did not expose its public catalogue data.');
    }
    try {
        const value = JSON.parse(decodeHtml(match[1]));
        if (value && typeof value === 'object') {
            return value;
        }
    } catch {
        // Report one provider-specific error below.
    }
    throw new Error('Prime Video public catalogue data was invalid.');
}

function primeState(page, scope) {
    const state = page?.init?.preparations?.body?.[scope]?.state;
    return state && typeof state === 'object' ? state : {};
}

function firstDetail(state, bucket) {
    const values = state?.detail?.[bucket];
    return values && typeof values === 'object'
        ? Object.values(values).find((value) => value && typeof value === 'object') || {}
        : {};
}

export function canonicalAmazonPrimeDetailUrl(value) {
    try {
        const parsed = new URL(decodeHtml(value).replaceAll('\\u0026', '&'), 'https://www.primevideo.com');
        const match = parsed.pathname.match(PRIME_DETAIL_PATH);
        if (!match) {
            return '';
        }
        return `https://www.primevideo.com/region/${match[1] || 'na'}/detail/${match[2].toUpperCase()}`;
    } catch {
        return '';
    }
}

function primaryPlayback(action) {
    for (const item of Array.isArray(action?.primaryActions) ? action.primaryActions : []) {
        if (cleanText(item?.actionType).toUpperCase() !== 'PLAY') {
            continue;
        }
        const playback = item?.payload?.playback;
        if (playback && typeof playback === 'object' && playback.isTrailer !== true) {
            return playback;
        }
    }
    return {};
}

export function amazonPrimeEpisodeRecords(page, seasonNumber) {
    const btf = primeState(page, 'btf');
    const details = btf?.detail?.detail || {};
    const selves = btf?.self || {};
    const actions = btf?.action?.btf || {};
    const ids = Array.isArray(btf?.episodeList?.cardTitleIds)
        ? btf.episodeList.cardTitleIds
        : Object.keys(details);
    const output = [];
    for (const rawGti of ids) {
        const gti = cleanText(rawGti);
        const detail = details[gti] || {};
        const self = selves[gti] || {};
        if (cleanText(detail.titleType).toLowerCase() !== 'episode') {
            continue;
        }
        const episodeNumber = integer(detail.episodeNumber) || integer(self.sequenceNumber);
        const detailUrl = canonicalAmazonPrimeDetailUrl(self.link);
        const compactGTI = cleanText(self.compactGTI) || detailUrl.match(/\/detail\/([A-Z0-9]+)/i)?.[1] || '';
        const asins = Array.isArray(self.asins) ? self.asins.map(cleanText).filter(Boolean) : [];
        const playback = primaryPlayback(actions[gti]);
        const playbackID = cleanText(playback.playbackID);
        const playbackUrl = canonicalAmazonPrimeDetailUrl(playback.playbackURL) === detailUrl
            ? new URL(decodeHtml(playback.playbackURL).replaceAll('\\u0026', '&'), 'https://www.primevideo.com').href
            : `${detailUrl}?autoplay=1`;
        if (!gti || !compactGTI || !detailUrl || !episodeNumber || !cleanText(detail.title)) {
            continue;
        }
        output.push({
            provider: 'amazon-prime',
            id: gti,
            seasonNumber,
            episodeNumber,
            title: cleanText(detail.title),
            description: cleanText(detail.synopsis),
            thumbnailUrl: cleanText(detail?.images?.packshot),
            durationMinutes: Math.max(0, Math.round((integer(detail.duration) || integer(playback.runTime)) / 60)),
            airDate: cleanText(detail.releaseDate),
            playbackUrl,
            detailUrl,
            amazonEpisodeIdentity: {
                gti,
                compactGTI,
                asins,
                playbackID: playbackID || gti,
                detailUrl,
            },
            selected: true,
        });
    }
    return output;
}

function seasonLinks(page, fallbackUrl) {
    const atf = primeState(page, 'atf');
    const links = new Map();
    for (const choices of Object.values(atf.seasons || {})) {
        for (const choice of Array.isArray(choices) ? choices : []) {
            const number = integer(choice?.sequenceNumber);
            const link = canonicalAmazonPrimeDetailUrl(choice?.seasonLink);
            if (number && link) {
                links.set(number, link);
            }
        }
    }
    if (links.size === 0) {
        links.set(integer(firstDetail(atf, 'headerDetail').seasonNumber) || 1, fallbackUrl);
    }
    return [...links.entries()].sort(([left], [right]) => left - right);
}

async function requestPage(url) {
    const response = await fetch(url, {
        headers: { Accept: 'text/html,application/xhtml+xml' },
        credentials: 'include',
        cache: 'no-store',
    });
    if (!response.ok) {
        throw new Error(`Prime Video catalogue request failed (${response.status}).`);
    }
    return response.text();
}

function stripSeason(value) {
    return cleanText(value).replace(/\s*-?\s*Season\s+\d+\s*$/i, '');
}

export async function discoverAmazonPrimeCatalog(url) {
    if (!PRIME_VIDEO_HOST.test(url.hostname) || !PRIME_DETAIL_PATH.test(url.pathname)) {
        throw new Error('Enter a Prime Video series, season, or episode /detail/ link.');
    }
    const requestedUrl = canonicalAmazonPrimeDetailUrl(url.href);
    const initialPage = extractAmazonPrimeHydration(await requestPage(requestedUrl));
    const links = seasonLinks(initialPage, requestedUrl);
    const seasonPages = await Promise.all(links.map(async ([number, link]) => [
        number,
        link === requestedUrl ? initialPage : extractAmazonPrimeHydration(await requestPage(link)),
        link,
    ]));
    const episodes = seasonPages.flatMap(([number, page]) => amazonPrimeEpisodeRecords(page, number));
    const identities = new Map();
    for (const episode of episodes) {
        const prior = identities.get(episode.id);
        if (prior && prior.detailUrl !== episode.detailUrl) {
            throw new Error(`Prime Video exposed conflicting detail links for episode ${episode.id}.`);
        }
        identities.set(episode.id, episode);
    }
    const uniqueEpisodes = [...identities.values()].sort((left, right) =>
        left.seasonNumber - right.seasonNumber || left.episodeNumber - right.episodeNumber
    );
    if (uniqueEpisodes.length === 0) {
        throw new Error('Prime Video did not expose a public episode guide for this link.');
    }

    const firstHeader = firstDetail(primeState(seasonPages[0][1], 'atf'), 'headerDetail');
    const seriesTitle = cleanText(firstHeader.parentTitle) || stripSeason(firstHeader.title);
    if (!seriesTitle) {
        throw new Error('Prime Video did not identify the series for this link.');
    }
    const grouped = new Map();
    for (const episode of uniqueEpisodes) {
        if (!grouped.has(episode.seasonNumber)) {
            grouped.set(episode.seasonNumber, {
                id: `amazon-prime-season-${episode.seasonNumber}`,
                number: episode.seasonNumber,
                title: `Season ${episode.seasonNumber}`,
                episodes: [],
            });
        }
        grouped.get(episode.seasonNumber).episodes.push(episode);
    }
    const images = firstHeader.images && typeof firstHeader.images === 'object' ? firstHeader.images : {};
    return {
        provider: 'amazon-prime',
        seriesTitle,
        seriesDescription: cleanText(firstHeader.synopsis),
        seriesPosterUrl: cleanText(images.packshot || images.heroshot),
        seriesArtworkShape: images.packshot ? 'portrait' : 'landscape',
        seriesYear: cleanText(firstHeader.releaseYear),
        seriesGenres: (Array.isArray(firstHeader.genres) ? firstHeader.genres : [])
            .map((item) => cleanText(item?.text || item)).filter(Boolean),
        seriesContentRating: cleanText(firstHeader?.ratingBadge?.displayText),
        seriesSeasonCount: grouped.size,
        seriesEpisodeCount: uniqueEpisodes.length,
        sourceUrl: seasonPages[0]?.[2] || requestedUrl,
        discovery: 'provider-adapter',
        seasons: [...grouped.values()],
    };
}

export const amazonPrimeAdapter = {
    id: 'amazon-prime',

    matches(url) {
        return PRIME_VIDEO_HOST.test(url.hostname) && PRIME_DETAIL_PATH.test(url.pathname);
    },

    async discover(url) {
        return discoverAmazonPrimeCatalog(url);
    },

    async activate(tabId) {
        for (let attempt = 0; attempt < 60; attempt += 1) {
            try {
                const response = await chrome.tabs.sendMessage(tabId, {
                    type: 'MULTI_MODE_ACTIVATE_PLAYBACK',
                    provider: this.id,
                });
                if (response?.activated || response?.requiresUser) {
                    return response;
                }
            } catch {
                // The content script is not ready during early navigation.
            }
            await delay(500);
        }
        return { activated: false, requiresUser: true };
    },
};
