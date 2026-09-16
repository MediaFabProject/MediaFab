const MAX_HOSTS = new Set(['hbomax.com', 'www.hbomax.com', 'play.hbomax.com']);
const MAX_ID = /(?:[0-9a-f]{8}-[0-9a-f-]{27}|PROM\d+)/i;

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function integer(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function contentId(value) {
    const matches = cleanText(value).match(new RegExp(MAX_ID.source, 'ig'));
    return matches?.at(-1) || '';
}

function titleValue(item) {
    const title = item?.title && typeof item.title === 'object' ? item.title : {};
    return cleanText(title.full || title.short);
}

function extractNextData(page) {
    const match = String(page || '').match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) throw new Error('HBO Max did not expose its public catalogue data.');
    try {
        return JSON.parse(match[1].replace(/&quot;/gi, '"').replace(/&amp;/gi, '&'));
    } catch {
        throw new Error('HBO Max returned invalid public catalogue data.');
    }
}

function mappedValues(data) {
    const mapped = data?.props?.pageProps?.mappedData;
    if (!mapped || typeof mapped !== 'object') return [];
    return Object.values(mapped).map((value) => {
        if (typeof value === 'string' && value.trimStart().startsWith('{')) {
            try { return JSON.parse(value); } catch { return value; }
        }
        return value;
    });
}

function contentRecord(data) {
    return mappedValues(data)
        .filter((value) => value && typeof value === 'object'
            && cleanText(value.hbomaxId)
            && value.title && typeof value.title === 'object'
            && value.images && typeof value.images === 'object')
        .sort((left, right) => Number(Boolean(right.seasons)) - Number(Boolean(left.seasons))
            || JSON.stringify(right).length - JSON.stringify(left).length)[0] || {};
}

async function requestPage(url) {
    const response = await fetch(url, {
        headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'Mozilla/5.0' },
        credentials: 'omit',
        cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HBO Max catalogue request failed (${response.status}).`);
    return response.text();
}

function publicUrl(value) {
    const parsed = value instanceof URL ? value : new URL(value);
    return `https://www.hbomax.com${parsed.pathname}`;
}

async function completeSeriesRecord(record, sourceUrl) {
    const seasons = Array.isArray(record.seasons) ? record.seasons : [];
    const expected = seasons.reduce((total, season) => total + integer(season?.numberOfEpisodes), 0);
    const present = seasons.reduce((total, season) => total + (Array.isArray(season?.episodes) ? season.episodes.length : 0), 0);
    const incomplete = seasons.some((season) => integer(season?.seasonNumber) > 0 && !season?.episodes?.length);
    if (!seasons.length || (present >= expected && !incomplete)) return record;
    const firstUrl = seasons.flatMap((season) => season?.episodes || [])
        .map((episode) => cleanText(episode?.episodeUrl)).find(Boolean);
    if (!firstUrl) return record;
    try {
        const richer = contentRecord(extractNextData(await requestPage(new URL(firstUrl, sourceUrl).href)));
        const richerCount = (richer.seasons || []).reduce(
            (total, season) => total + (Array.isArray(season?.episodes) ? season.episodes.length : 0), 0,
        );
        return richerCount > present ? { ...record, ...richer } : record;
    } catch {
        return record;
    }
}

function episodeRecord(episode, seasonNumber, showUrl) {
    const episodeId = contentId(episode?.episodeUrl) || contentId(episode?.hbomaxId);
    const episodeNumber = integer(episode?.episodeNumber);
    if (!episodeId || !seasonNumber || !episodeNumber) return null;
    const summary = episode?.summary && typeof episode.summary === 'object' ? episode.summary : {};
    const images = episode?.images && typeof episode.images === 'object' ? episode.images : {};
    const playbackUrl = `https://play.hbomax.com/video/watch/${episodeId}`;
    return {
        id: `max:${episodeId}`,
        provider: 'max',
        seasonNumber,
        episodeNumber,
        title: titleValue(episode) || `Episode ${episodeNumber}`,
        description: cleanText(summary.full || summary.short),
        thumbnailUrl: cleanText(images.default || images['cover-artwork-horizontal']),
        playbackUrl,
        detailUrl: showUrl,
        catalogUrl: showUrl,
        selected: true,
    };
}

export async function discoverHBOMaxCatalog(url) {
    if (!MAX_HOSTS.has(url.hostname.toLowerCase()) || !/^\/show\/[0-9a-f-]{36}(?:\/|$)/i.test(url.pathname)) {
        throw new Error('Enter an HBO Max /show/ link so Queue Mode can load the complete episode guide.');
    }
    const showUrl = publicUrl(url).replace(/\/+$/, '');
    let record = contentRecord(extractNextData(await requestPage(showUrl)));
    if (!record || !titleValue(record)) throw new Error('HBO Max did not identify this public show catalogue.');
    record = await completeSeriesRecord(record, showUrl);
    const seasons = (Array.isArray(record.seasons) ? record.seasons : [])
        .map((season) => {
            const number = integer(season?.seasonNumber);
            const episodes = (Array.isArray(season?.episodes) ? season.episodes : [])
                .map((episode) => episodeRecord(episode, number, showUrl))
                .filter(Boolean)
                .sort((left, right) => left.episodeNumber - right.episodeNumber);
            return number && episodes.length ? {
                id: `max-season-${number}`,
                number,
                title: `Season ${number}`,
                episodes,
            } : null;
        })
        .filter(Boolean)
        .sort((left, right) => left.number - right.number);
    if (!seasons.length) throw new Error('HBO Max returned no numbered episodes for this show.');
    const images = record.images && typeof record.images === 'object' ? record.images : {};
    const summary = record.summary && typeof record.summary === 'object' ? record.summary : {};
    return {
        provider: 'max',
        mediaKind: 'series',
        seriesTitle: titleValue(record),
        seriesDescription: cleanText(summary.full || summary.short),
        seriesPosterUrl: cleanText(images['cover-artwork'] || images['default-wide']),
        seriesArtworkShape: cleanText(images['cover-artwork']) ? 'portrait' : 'landscape',
        seriesYear: integer(record.releaseYear),
        seriesContentRating: cleanText(record.localizedRating?.classifier),
        seriesGenres: Array.isArray(record.genres) ? record.genres.map(cleanText).filter(Boolean) : [],
        seriesSeasonCount: seasons.length,
        seriesEpisodeCount: seasons.reduce((total, season) => total + season.episodes.length, 0),
        sourceUrl: showUrl,
        discovery: 'provider-adapter',
        seasons,
    };
}

export const hboMaxAdapter = {
    id: 'max',
    matches(url) {
        return MAX_HOSTS.has(url.hostname.toLowerCase()) && /^\/show\/[0-9a-f-]{36}(?:\/|$)/i.test(url.pathname);
    },
    discover: discoverHBOMaxCatalog,
    async activate(tabId) {
        return chrome.tabs.sendMessage(tabId, { type: 'MULTI_MODE_ACTIVATE_PLAYBACK', provider: 'max' });
    },
};
