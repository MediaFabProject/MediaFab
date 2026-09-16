const PARAMOUNT_PLUS_HOSTS = new Set(['paramountplus.com', 'www.paramountplus.com']);

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
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

function htmlText(value) {
    return cleanText(decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ')));
}

function firstMatch(value, pattern) {
    const match = String(value || '').match(pattern);
    return decodeHtml(match?.[1] || '').trim();
}

function textBetween(value, start, end) {
    const match = String(value || '').match(new RegExp(`${start}([\\s\\S]*?)${end}`, 'i'));
    return match?.[1] || '';
}

function escapePattern(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function metaContent(page, name) {
    return firstMatch(
        page,
        new RegExp(`<meta[^>]+(?:name|property)=["']${escapePattern(name)}["'][^>]+content=["']([^"']*)`, 'i'),
    );
}

function canonicalUrl(value) {
    const url = value instanceof URL ? new URL(value.href) : new URL(value);
    url.hash = '';
    url.search = '';
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
    return url.href;
}

function titleFromPath(url) {
    const segments = url.pathname.split('/').filter(Boolean);
    const typeIndex = segments.findIndex((segment) => ['shows', 'movies'].includes(segment.toLowerCase()));
    const slug = typeIndex >= 0 ? segments[typeIndex + 1] : '';
    return String(slug || 'Paramount+ title')
        .split('-')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function aboutValue(page, label) {
    return htmlText(firstMatch(
        page,
        new RegExp(`<span class=["']about__metadata-title["']>${escapePattern(label)}<\\/span>\\s*(?:<span[^>]*>|<a[^>]*>)([^<]+)`, 'i'),
    ));
}

function integer(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function durationMinutes(value) {
    const match = cleanText(value).match(/(?:(\d+)H\s*)?(?:(\d+)M)?/i);
    return match && (match[1] || match[2]) ? integer(match[1]) * 60 + integer(match[2]) : 0;
}

function highResolutionEpisodeImage(value) {
    return cleanText(value).replace(/\/_x\/w\d+\//i, '/_x/w1920/');
}

function trackingValue(page, key) {
    return firstMatch(page, new RegExp(`${escapePattern(key)}["']?\\s*:\\s*["']?([^,}"']+)`, 'i'));
}

function highResolutionPoster(value) {
    return cleanText(value).replace(/\/w\d+-q\d+\//i, '/w1400-q90/');
}

function catalogItems(payload) {
    let parsed = payload;
    if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch { return { items: [], total: 0 }; }
    }
    const result = parsed && typeof parsed === 'object' ? parsed.result : null;
    if (!result || typeof result !== 'object') return { items: [], total: 0 };
    const orientation = cleanText(result.orientation);
    return {
        items: (Array.isArray(result.data) ? result.data : [])
            .filter((item) => item && typeof item === 'object')
            .map((item) => ({ ...item, _catalogOrientation: orientation })),
        total: integer(result.total),
    };
}

async function paramountSeriesPoster(title, showId) {
    try {
        const catalogPage = await requestPage('https://www.paramountplus.com/browse/all/');
        const rawConfig = firstMatch(catalogPage, /var\s+collectionConfig\s*=\s*(\[[\s\S]*?\]);/i);
        const configs = JSON.parse(rawConfig);
        const config = (Array.isArray(configs) ? configs : []).find((item) =>
            item && typeof item === 'object'
            && cleanText(decodeURIComponent(String(item.title || '').replaceAll('+', ' '))).toLowerCase() === 'all shows a-z'
        );
        const model = cleanText(config?.model);
        const token = cleanText(config?.token);
        if (!model || !token) return '';
        const endpoint = `https://www.paramountplus.com/carousels/collections/configItems/${encodeURIComponent(model)}/${encodeURIComponent(token)}`;
        const targetTitle = cleanText(title).toLowerCase();
        const targetSortTitle = targetTitle.replace(/^(?:a|an|the)\s+/, '');
        const targetId = cleanText(showId);
        const matchingPoster = (items) => {
            for (const item of items) {
                const itemIds = [item.id, item.showSeriesId, item.content_id, item.contentId].map(cleanText);
                const identityMatches = targetId
                    ? itemIds.includes(targetId)
                    : cleanText(item.alt).toLowerCase() === targetTitle;
                const orientation = cleanText(item.orientation || item._catalogOrientation).toLowerCase();
                if (!identityMatches || orientation !== 'portrait') continue;
                const poster = cleanText(item.thumb || item.filepathPromoTilePosterImage);
                if (poster) return highResolutionPoster(poster);
            }
            return '';
        };
        const pageAt = async (offset) => {
            const response = await fetch(`${endpoint}/offset/${offset}/limit/20/`, {
                headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store',
            });
            if (!response.ok) return { items: [], total: 0 };
            return catalogItems(await response.json());
        };
        const first = await pageAt(0);
        let poster = matchingPoster(first.items);
        if (poster || first.items.length === 0) return poster;
        const pageSize = first.items.length;
        let low = 1;
        let high = Math.max(0, Math.ceil(first.total / pageSize) - 1);
        while (low <= high) {
            const pageNumber = Math.floor((low + high) / 2);
            const page = await pageAt(pageNumber * pageSize);
            if (page.items.length === 0) break;
            poster = matchingPoster(page.items);
            if (poster) return poster;
            const firstTitle = cleanText(page.items[0]?.alt).toLowerCase().replace(/^(?:a|an|the)\s+/, '');
            const lastTitle = cleanText(page.items.at(-1)?.alt).toLowerCase().replace(/^(?:a|an|the)\s+/, '');
            if (targetSortTitle < firstTitle) high = pageNumber - 1;
            else if (targetSortTitle > lastTitle) low = pageNumber + 1;
            else break;
        }
    } catch {
        // The title page still supplies a usable landscape fallback.
    }
    return '';
}

function titleSpecificLandscape(page) {
    return firstMatch(page, /(https:\/\/[^"'\s,]*w3200[^"'\s,]*)/i)
        || firstMatch(page, /<img[^>]+src=["']([^"']+lok_[^"']*hero_landscape[^"']*)["']/i);
}

function episodeRecord(block, showUrl, tracking = '') {
    const link = firstMatch(block, /href=["']([^"']*\/shows\/video\/[^"']+\/?)["']/i);
    const tracked = decodeHtml(tracking).match(/\|S(\d+)\|Ep(\d+)\|([^|]*)\|([^|]*)\|\|/i);
    const seasonNumber = integer(tracked?.[1])
        || integer(firstMatch(block, /<abbr[^>]+(?:title=["']Season\s+|class=["']seNum["'][^>]*>S)(\d+)/i));
    const episodeNumber = integer(tracked?.[2])
        || integer(firstMatch(block, /<abbr[^>]+(?:title=["']Episode\s+|class=["']epNum["'][^>]*>E)(\d+)/i));
    if (!link || seasonNumber <= 0 || episodeNumber <= 0) {
        return null;
    }
    let title = htmlText(textBetween(block, '<div class=["\']meta-wrapper title-shorten["\']>', '<\\/div>'));
    title = title.replace(/\bS\d+\s*E\d+\b/i, '').trim();
    title ||= htmlText(textBetween(block, '<div class=["\']epTitle["\']>', '<\\/div>'));
    title ||= cleanText(tracked?.[4]);
    const description = htmlText(
        textBetween(block, '<div class=["\']description-wrapper[^>]*>', '<\\/div>')
        || textBetween(block, '<div class=["\']ep__copy[^>]*>', '<\\/div>'),
    );
    const image = firstMatch(block, /(?:data-src|src)=["']([^"']+thumbnails\.cbsig\.net[^"']+)["']/i);
    const duration = firstMatch(block, /itemprop=["']duration["']\s+content=["']([^"']+)["']/i);
    const date = firstMatch(block, /<time[^>]+datetime=["'](\d{4}-\d{2}-\d{2})/i);
    const playbackUrl = new URL(link, showUrl).href;
    const id = firstMatch(block, /vilynx-id=["']([^"']+)["']/i)
        || firstMatch(playbackUrl, /\/video\/([^/]+)\//i);
    return {
        id: `paramountplus:${id || `${seasonNumber}:${episodeNumber}`}`,
        provider: 'paramountplus',
        seasonNumber,
        episodeNumber,
        title: title || `Episode ${episodeNumber}`,
        description,
        thumbnailUrl: highResolutionEpisodeImage(image),
        durationMinutes: durationMinutes(duration),
        airDate: date,
        playbackUrl,
        detailUrl: playbackUrl,
        sourceUrl: playbackUrl,
        executionMode: 'external-backend',
        backendId: 'paramountplus',
        selected: true,
    };
}

function parseEpisodeCards(page, showUrl) {
    const records = [];
    for (const match of String(page || '').matchAll(/(<article[^>]*class=["'][^"']*\bgrid-view-item\b[^"']*["'][^>]*>[\s\S]*?<\/article>)/gi)) {
        const block = match[1];
        const tracking = firstMatch(block, /data-tracking=["']([^"']+)["']/i);
        const record = episodeRecord(block, showUrl, tracking);
        if (record) records.push(record);
    }
    if (records.length === 0) {
        for (const block of String(page || '').split(/<div class=["']episode["']>/i).slice(1)) {
            const record = episodeRecord(block, showUrl);
            if (record) records.push(record);
        }
    }
    const unique = new Map(records.map((record) => [`${record.seasonNumber}:${record.episodeNumber}`, record]));
    return [...unique.values()].sort((left, right) =>
        left.seasonNumber - right.seasonNumber || left.episodeNumber - right.episodeNumber
    );
}

function seasonNumbers(page) {
    const numbers = new Set();
    for (const match of String(page || '').matchAll(/(?:data-value|<option\s+value)=["'](\d+)["']/gi)) {
        const number = integer(match[1]);
        if (number > 0) numbers.add(number);
    }
    const count = integer(aboutValue(page, 'Seasons'));
    for (let number = 1; number <= count; number += 1) numbers.add(number);
    return [...numbers].sort((left, right) => left - right);
}

async function requestPage(url) {
    const response = await fetch(url, {
        headers: { Accept: 'text/html,application/xhtml+xml' },
        credentials: 'omit',
        cache: 'no-store',
    });
    if (!response.ok) {
        throw new Error(`Paramount+ catalogue request failed (${response.status}).`);
    }
    return response.text();
}

async function mapWithConcurrency(values, limit, mapper) {
    const results = new Array(values.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, Math.max(1, values.length)) }, async () => {
        while (nextIndex < values.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await mapper(values[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}

function parentShowUrl(page, sourceUrl) {
    const candidates = [
        firstMatch(page, /player\.baseUrl\s*=\s*["']([^"']+)["']/i),
        firstMatch(page, /<a[^>]+href=["'](\/shows\/[^/"']+\/)["'][^>]*aa-link=["']show header/i),
    ];
    const key = firstMatch(page, /CBS\.Registry\.Show\s*=\s*\{[\s\S]*?["']key["']\s*:\s*["']([^"']+)/i);
    if (key) candidates.push(`/shows/${key}/`);
    for (const candidate of candidates.filter(Boolean)) {
        const resolved = new URL(candidate, sourceUrl);
        const match = resolved.pathname.match(/^\/shows\/([^/]+)\//i);
        if (match && match[1].toLowerCase() !== 'video') {
            return `${resolved.origin}/shows/${match[1]}/`;
        }
    }
    return '';
}

async function discoverSeries(inputUrl) {
    let showUrl = canonicalUrl(inputUrl);
    let page = await requestPage(showUrl);
    if (/^\/shows\/video\//i.test(inputUrl.pathname)) {
        showUrl = parentShowUrl(page, showUrl);
        if (!showUrl) throw new Error('Paramount+ did not identify the parent series for this episode.');
        page = await requestPage(showUrl);
    }
    const seriesTitle = htmlText(textBetween(page, '<div class=["\']about__header-title["\']>', '<\\/div>'))
        || metaContent(page, 'og:title').replace(/\s+-\s+.*$/, '')
        || titleFromPath(new URL(showUrl));
    const numbers = seasonNumbers(page);
    if (numbers.length === 0) numbers.push(1);
    const pages = await mapWithConcurrency(numbers, 4, async (number) => {
        const seasonUrl = `${showUrl.replace(/\/+$/, '')}/episodes/${number}/`;
        return requestPage(seasonUrl);
    });
    const episodes = pages.flatMap((seasonPage) => parseEpisodeCards(seasonPage, showUrl));
    const unique = new Map(episodes.map((episode) => [`${episode.seasonNumber}:${episode.episodeNumber}`, episode]));
    const grouped = new Map();
    for (const episode of [...unique.values()].sort((left, right) =>
        left.seasonNumber - right.seasonNumber || left.episodeNumber - right.episodeNumber
    )) {
        if (!grouped.has(episode.seasonNumber)) {
            grouped.set(episode.seasonNumber, {
                id: `paramountplus-season-${episode.seasonNumber}`,
                number: episode.seasonNumber,
                title: `Season ${episode.seasonNumber}`,
                episodes: [],
            });
        }
        grouped.get(episode.seasonNumber).episodes.push(episode);
    }
    const seasons = [...grouped.values()];
    if (seasons.length === 0) {
        throw new Error('Paramount+ returned no numbered episodes for this series.');
    }
    const genre = aboutValue(page, 'Genre');
    const poster = await paramountSeriesPoster(seriesTitle, trackingValue(page, 'showSeriesId'));
    const landscape = titleSpecificLandscape(page);
    const episodeArtwork = [...unique.values()].map((episode) => episode.thumbnailUrl).find(Boolean) || '';
    return {
        provider: 'paramountplus',
        mediaKind: 'series',
        seriesTitle,
        seriesDescription: htmlText(textBetween(page, '<div class=["\']about__header-description["\']>', '<\\/div>'))
            || metaContent(page, 'description'),
        seriesPosterUrl: poster || landscape || episodeArtwork,
        seriesArtworkShape: poster ? 'portrait' : 'landscape',
        seriesYear: integer(aboutValue(page, 'Year')),
        seriesContentRating: aboutValue(page, 'Rating'),
        seriesGenres: genre ? [genre] : [],
        seriesSeasonCount: seasons.length,
        seriesEpisodeCount: [...unique.values()].length,
        sourceUrl: showUrl,
        discovery: 'provider-adapter',
        externalBackend: true,
        seasons,
    };
}

function movieCatalog(url) {
    const sourceUrl = canonicalUrl(url);
    const title = titleFromPath(url);
    return {
        provider: 'paramountplus',
        mediaKind: 'movie',
        seriesTitle: title,
        discovery: 'provider-adapter',
        externalBackend: true,
        sourceUrl,
        seasons: [{
            id: 'paramountplus-movie',
            number: null,
            title: 'Movie',
            episodes: [{
                id: `paramountplus:${sourceUrl}`,
                provider: 'paramountplus',
                seasonNumber: null,
                episodeNumber: null,
                title,
                playbackUrl: sourceUrl,
                detailUrl: sourceUrl,
                sourceUrl,
                executionMode: 'external-backend',
                backendId: 'paramountplus',
                selected: true,
            }],
        }],
    };
}

export const paramountPlusAdapter = {
    id: 'paramountplus',

    matches(url) {
        return PARAMOUNT_PLUS_HOSTS.has(url.hostname.toLowerCase())
            && /^\/(?:shows|movies)\//i.test(url.pathname);
    },

    async discover(url) {
        return /^\/movies\//i.test(url.pathname) ? movieCatalog(url) : discoverSeries(url);
    },
};
