const BBC_HOSTS = new Set(['bbc.co.uk', 'www.bbc.co.uk']);
const PID = '[a-z0-9]{8}';

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function positiveInteger(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function requestText(url, accept = 'text/html,application/xhtml+xml') {
    const response = await fetch(url, {
        headers: { Accept: accept, 'User-Agent': 'Mozilla/5.0' },
        credentials: 'omit', cache: 'no-store',
    });
    if (!response.ok) throw new Error(`BBC iPlayer catalogue request failed (${response.status}).`);
    return response.text();
}

async function programme(pid) {
    try {
        return JSON.parse(await requestText(`https://www.bbc.co.uk/programmes/${pid}.json`, 'application/json')).programme;
    } catch {
        throw new Error(`BBC iPlayer returned invalid programme data for ${pid}.`);
    }
}

function findBrand(item) {
    let current = item;
    for (let index = 0; index < 6 && current; index += 1) {
        if (current.type === 'brand' && current.pid && current.title) {
            return { pid: cleanText(current.pid).toLowerCase(), title: cleanText(current.title) };
        }
        current = current.parent?.programme;
    }
    return null;
}

function episodePid(url) {
    return url.pathname.match(new RegExp(`^/iplayer/episode/(${PID})(?:/|$)`, 'i'))?.[1]?.toLowerCase() || '';
}

function showPid(url) {
    return url.pathname.match(new RegExp(`^/iplayer/episodes/(${PID})(?:/|$)`, 'i'))?.[1]?.toLowerCase() || '';
}

function decodeHtml(value) {
    return String(value || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
}

function pagePids(page) {
    const pids = [];
    // Generic data-pid/data-bbc-result attributes are also used for series
    // slices and navigation containers. Only accept an actual episode URL or
    // an explicitly typed episode record.
    const pattern = new RegExp(`(?:href|url)=["'][^"']*/iplayer/episode/(${PID})(?:/[^"']*)?["']|"episode"\\s*:\\s*\\{\\s*"id"\\s*:\\s*"(${PID})"`, 'ig');
    for (const match of String(page || '').matchAll(pattern)) {
        const pid = match.slice(1).find(Boolean)?.toLowerCase();
        if (pid && pid !== 'trailers' && !pids.includes(pid)) pids.push(pid);
    }
    return pids;
}

async function cataloguePages(brandPid) {
    const base = `https://www.bbc.co.uk/iplayer/episodes/${brandPid}`;
    const first = await requestText(base);
    const urls = [base];
    for (const match of first.matchAll(/href="([^"]+)"/gi)) {
        const candidate = new URL(decodeHtml(match[1]), base);
        const seriesIds = candidate.searchParams.getAll('seriesId');
        if (candidate.pathname.startsWith(`/iplayer/episodes/${brandPid}`)
            && seriesIds.some((value) => value.startsWith(`${brandPid}-structural-`))) {
            candidate.searchParams.delete('page');
            if (!urls.includes(candidate.href)) urls.push(candidate.href);
        }
    }
    const pages = [{ url: base, text: first }];
    for (const url of urls.slice(1)) pages.push({ url, text: await requestText(url) });
    for (const page of [...pages]) {
        const numbers = [...page.text.matchAll(/[?&]page=(\d+)/gi)].map((match) => positiveInteger(match[1]));
        for (let number = 2; number <= Math.max(1, ...numbers); number += 1) {
            const paged = new URL(page.url);
            paged.searchParams.set('page', String(number));
            pages.push({ url: paged.href, text: await requestText(paged.href) });
        }
    }
    return pages;
}

async function mapWithConcurrency(values, limit, mapper) {
    const results = new Array(values.length);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
        while (next < values.length) {
            const index = next++;
            results[index] = await mapper(values[index]);
        }
    });
    await Promise.all(workers);
    return results;
}

export async function discoverBBCIPlayerCatalog(url) {
    if (!BBC_HOSTS.has(url.hostname.toLowerCase())) {
        throw new Error('Enter a BBC iPlayer series or episode link.');
    }
    const directEpisodePid = episodePid(url);
    let brand;
    if (directEpisodePid) brand = findBrand(await programme(directEpisodePid));
    else {
        const directShowPid = showPid(url);
        if (directShowPid) {
            const item = await programme(directShowPid);
            brand = item?.type === 'brand' ? { pid: directShowPid, title: cleanText(item.title) } : findBrand(item);
        }
    }
    if (!brand) throw new Error('BBC iPlayer did not identify the parent programme for this link.');
    const pages = await cataloguePages(brand.pid);
    const structuralPositions = new Map();
    const structuralPattern = new RegExp(`${brand.pid}-structural-(\\d+)-(${PID})`, 'ig');
    for (const page of pages) {
        for (const match of page.text.matchAll(structuralPattern)) {
            structuralPositions.set(match[2].toLowerCase(), positiveInteger(match[1]));
        }
    }
    const pids = [...new Set(pages.flatMap((page) => pagePids(page.text)))];
    if (!pids.length) throw new Error('BBC iPlayer did not return any currently available episodes.');
    const records = (await mapWithConcurrency(pids, 3, programme)).filter(Boolean);
    const grouped = new Map();
    for (const item of records) {
        if (!['episode', 'clip'].includes(item.type) || !['audio_video', 'video'].includes(item.media_type)) continue;
        const parent = item.parent?.programme || {};
        const titleSeason = cleanText(parent.title).match(/^Series\s+(\d+)$/i)?.[1];
        const seasonNumber = parent.type === 'series'
            ? positiveInteger(parent.position) || structuralPositions.get(cleanText(parent.pid).toLowerCase()) || positiveInteger(titleSeason)
            : 0;
        const episodeNumber = positiveInteger(item.position);
        const groupTitle = cleanText(parent.type === 'series' ? parent.title : 'Specials') || 'Specials';
        const groupKey = seasonNumber ? `season-${seasonNumber}` : `group-${groupTitle.toLowerCase()}`;
        if (!grouped.has(groupKey)) grouped.set(groupKey, {
            id: `bbciplayer-${groupKey}`,
            number: seasonNumber || null,
            title: seasonNumber ? `Season ${seasonNumber}` : groupTitle,
            episodes: [],
        });
        const playbackUrl = `https://www.bbc.co.uk/iplayer/episode/${item.pid}`;
        grouped.get(groupKey).episodes.push({
            id: `bbciplayer:${item.pid}`,
            provider: 'bbciplayer',
            seasonNumber: seasonNumber || null,
            episodeNumber: episodeNumber || null,
            title: cleanText(item.title) || item.pid,
            description: cleanText(item.medium_synopsis || item.short_synopsis),
            airDate: cleanText(item.first_broadcast_date).slice(0, 10),
            playbackUrl,
            detailUrl: playbackUrl,
            sourceUrl: playbackUrl,
            executionMode: 'local-command',
            selected: true,
        });
    }
    const seasons = [...grouped.values()].sort((left, right) => (left.number || 9999) - (right.number || 9999));
    for (const season of seasons) season.episodes.sort((left, right) => (left.episodeNumber || 9999) - (right.episodeNumber || 9999));
    const firstPage = pages[0]?.text || '';
    const poster = decodeHtml(firstPage.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] || '');
    return {
        provider: 'bbciplayer',
        mediaKind: 'series',
        seriesTitle: brand.title,
        seriesPosterUrl: poster,
        seriesArtworkShape: 'landscape',
        seriesSeasonCount: seasons.length,
        seriesEpisodeCount: seasons.reduce((total, season) => total + season.episodes.length, 0),
        sourceUrl: `https://www.bbc.co.uk/iplayer/episodes/${brand.pid}`,
        discovery: 'provider-adapter',
        seasons,
    };
}

export const bbcIPlayerAdapter = {
    id: 'bbciplayer',
    matches(url) {
        return BBC_HOSTS.has(url.hostname.toLowerCase())
            && new RegExp(`^/iplayer/episode(?:s)?/${PID}(?:/|$)`, 'i').test(url.pathname);
    },
    discover: discoverBBCIPlayerCatalog,
};
