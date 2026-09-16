const PBS_KIDS_HOSTS = new Set(['pbskids.org', 'www.pbskids.org']);
const PBS_KIDS_PATH = /^\/videos\/(?:playlist\/[^/]+\/\d+|watch\/[^/]+\/\d+\/[^/]+\/\d+|(?!playlist(?:\/|$)|watch(?:\/|$))[^/]+)\/?$/i;

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

function extractNextData(page) {
    const match = String(page || '').match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) {
        throw new Error('PBS KIDS page did not expose its public catalogue data.');
    }
    try {
        const value = JSON.parse(decodeHtml(match[1]));
        if (value && typeof value === 'object') {
            return value;
        }
    } catch {
        // Report one provider-specific error below.
    }
    throw new Error('PBS KIDS public catalogue data was invalid.');
}

function nestedValue(value, path) {
    let current = value;
    for (const step of path) {
        if (current == null || typeof current !== 'object') {
            return undefined;
        }
        current = current[step];
    }
    return current;
}

function pageProps(data) {
    const value = nestedValue(data, ['props', 'pageProps']);
    return value && typeof value === 'object' ? value : {};
}

function mergeObjects(first, second) {
    const output = first && typeof first === 'object' ? { ...first } : {};
    if (second && typeof second === 'object') {
        for (const [key, value] of Object.entries(second)) {
            if (value != null && value !== '' && (!Array.isArray(value) || value.length > 0)) {
                output[key] = value;
            }
        }
    }
    return output;
}

function firstText(...values) {
    return values.map(cleanText).find(Boolean) || '';
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

function routeParts(url) {
    let match = url.pathname.replace(/\/$/, '').match(/^\/videos\/watch\/([^/]+)\/(\d+)\/([^/]+)\/(\d+)$/i);
    if (match) {
        return {
            kind: 'watch',
            collectionSlug: match[1],
            collectionId: match[2],
            videoSlug: match[3],
            videoId: match[4],
        };
    }
    match = url.pathname.replace(/\/$/, '').match(/^\/videos\/playlist\/([^/]+)\/(\d+)$/i);
    if (match) {
        return { kind: 'playlist', collectionSlug: match[1], collectionId: match[2] };
    }
    match = url.pathname.replace(/\/$/, '').match(/^\/videos\/([^/]+)$/i);
    return { kind: 'series', seriesSlug: match?.[1] || '' };
}

function canonicalPageUrl(value) {
    const url = value instanceof URL ? value : new URL(value);
    return `https://pbskids.org${url.pathname.replace(/\/$/, '')}`;
}

function episodesCollection(props) {
    const modules = nestedValue(props, ['pageData', 'bodyContentModules']);
    for (const module of Array.isArray(modules) ? modules : []) {
        if (!module || typeof module !== 'object' || cleanText(module.heading).toLowerCase() !== 'episodes') {
            continue;
        }
        const collections = Array.isArray(module.collection) ? module.collection : [];
        const collection = collections.find((item) => item && typeof item === 'object');
        if (collection) {
            return collection;
        }
    }
    return {};
}

function collectionFromProps(props, route) {
    if (route.kind === 'playlist' && props.collectionData && typeof props.collectionData === 'object') {
        return props.collectionData;
    }
    return route.kind === 'series' ? episodesCollection(props) : {};
}

function propertyFromProps(props) {
    const pageProperty = props.pageProperty && typeof props.pageProperty === 'object' ? props.pageProperty : {};
    for (const source of [props.videoData, props.collectionData]) {
        const property = Array.isArray(source?.properties)
            ? source.properties.find((item) => item && typeof item === 'object')
            : null;
        if (property) {
            return mergeObjects(pageProperty, property);
        }
    }
    const collection = episodesCollection(props);
    const property = Array.isArray(collection.properties)
        ? collection.properties.find((item) => item && typeof item === 'object')
        : null;
    return property ? mergeObjects(pageProperty, property) : pageProperty;
}

function firstAssetUrl(value) {
    for (const item of Array.isArray(value) ? value : []) {
        const url = firstText(item?.url, item?.its_url);
        if (url) {
            return url;
        }
    }
    return '';
}

function preferredEpisodeImage(value) {
    const images = Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
    for (const profile of ['asset-kids-mezzanine1-16x9', 'asset-kids-mezzanine-16x9']) {
        const match = images.find((item) => cleanText(item.profile) === profile);
        if (cleanText(match?.image)) {
            return cleanText(match.image);
        }
    }
    return cleanText(images.find((item) => cleanText(item.image))?.image);
}

function episodeRecord(entry, full, props, watchUrl) {
    const merged = mergeObjects(entry, full);
    const media = mergeObjects(entry?.mediaManagerAsset, full?.mediaManagerAsset);
    const durationSeconds = integer(media.duration);
    const airDateSeconds = integer(media.premiered_on || entry?.mediaManagerAsset?.premiered_on);
    return {
        id: cleanText(merged.id),
        seasonNumber: integer(media.season_number),
        episodeNumber: integer(media.episode_number),
        title: firstText(media.title, merged.title),
        description: firstText(props.videoDescription, media.description_short, media.description_long),
        thumbnailUrl: preferredEpisodeImage(media.images),
        durationMinutes: durationSeconds > 0 ? Math.max(1, Math.round(durationSeconds / 60)) : 0,
        airDate: airDateSeconds > 0 ? new Date(airDateSeconds * 1000).toISOString().slice(0, 10) : '',
        playbackUrl: watchUrl,
        detailUrl: watchUrl,
        selected: true,
    };
}

async function requestPage(url) {
    const response = await fetch(url, {
        headers: {
            Accept: 'text/html,application/xhtml+xml',
            'User-Agent': 'Mozilla/5.0',
        },
        credentials: 'omit',
        cache: 'no-store',
    });
    if (!response.ok) {
        throw new Error(`PBS KIDS catalogue request failed (${response.status}).`);
    }
    return response.text();
}

export async function discoverPBSKidsCatalog(url) {
    if (!PBS_KIDS_HOSTS.has(url.hostname.toLowerCase()) || !PBS_KIDS_PATH.test(url.pathname)) {
        throw new Error('Enter a PBS KIDS series, full-episode playlist, or episode watch link.');
    }

    const pages = new Map();
    const load = async (value) => {
        const key = canonicalPageUrl(value);
        if (!pages.has(key)) {
            pages.set(key, requestPage(key).then((page) => pageProps(extractNextData(page))));
        }
        return pages.get(key);
    };

    const normalized = canonicalPageUrl(url);
    const route = routeParts(new URL(normalized));
    const initial = await load(normalized);
    let property = propertyFromProps(initial);
    const seriesSlug = firstText(property.slug, route.seriesSlug);
    if (!seriesSlug) {
        throw new Error('PBS KIDS did not identify the parent series for this link.');
    }
    const seriesUrl = `https://pbskids.org/videos/${seriesSlug}`;
    const seriesProps = route.kind === 'series' ? initial : await load(seriesUrl);
    property = mergeObjects(propertyFromProps(seriesProps), property);

    let collection = collectionFromProps(initial, route);
    if (Object.keys(collection).length === 0) {
        collection = episodesCollection(seriesProps);
    }
    if (Object.keys(collection).length === 0 && route.kind === 'watch') {
        const context = initial.contextData && typeof initial.contextData === 'object' ? initial.contextData : {};
        const collectionSlug = firstText(context.slug, route.collectionSlug);
        const collectionId = firstText(context.id, route.collectionId);
        if (collectionSlug && collectionId) {
            const playlistProps = await load(`https://pbskids.org/videos/playlist/${collectionSlug}/${collectionId}`);
            collection = collectionFromProps(playlistProps, { kind: 'playlist' });
        }
    }

    const entries = (Array.isArray(collection.entries) ? collection.entries : [])
        .filter((entry) => entry && typeof entry === 'object' && cleanText(entry.videoType) === 'fullEpisode');
    const currentVideo = route.kind === 'watch' && initial.videoData && typeof initial.videoData === 'object'
        ? initial.videoData
        : {};
    if (cleanText(currentVideo.id) && !entries.some((entry) => cleanText(entry.id) === cleanText(currentVideo.id))) {
        entries.push(currentVideo);
    }

    const collectionSlug = firstText(collection.slug, route.collectionSlug);
    const collectionId = firstText(collection.id, route.collectionId);
    const currentId = cleanText(currentVideo.id);
    const records = await mapWithConcurrency(entries, 6, async (entry) => {
        const videoId = cleanText(entry.id);
        const slug = cleanText(entry.slug);
        const watchUrl = collectionSlug && collectionId && slug && videoId
            ? `https://pbskids.org/videos/watch/${collectionSlug}/${collectionId}/${slug}/${videoId}`
            : '';
        let props = videoId === currentId ? initial : {};
        let full = videoId === currentId ? currentVideo : {};
        if (!cleanText(full.id) && watchUrl) {
            try {
                props = await load(watchUrl);
                full = props.videoData && typeof props.videoData === 'object' ? props.videoData : {};
            } catch {
                // Keep the collection entry; unnumbered records are filtered below.
            }
        }
        return episodeRecord(entry, full, props, watchUrl);
    });

    const unique = new Map();
    for (const record of records) {
        if (record.id && record.playbackUrl && record.seasonNumber > 0 && record.episodeNumber > 0) {
            unique.set(record.id, record);
        }
    }
    const episodes = [...unique.values()].sort((left, right) =>
        left.seasonNumber - right.seasonNumber || left.episodeNumber - right.episodeNumber
    );
    if (episodes.length === 0) {
        throw new Error('PBS KIDS returned no currently available numbered full episodes.');
    }

    const grouped = new Map();
    for (const episode of episodes) {
        if (!grouped.has(episode.seasonNumber)) {
            grouped.set(episode.seasonNumber, {
                id: `pbs-kids-season-${episode.seasonNumber}`,
                number: episode.seasonNumber,
                title: `Season ${episode.seasonNumber}`,
                episodes: [],
            });
        }
        grouped.get(episode.seasonNumber).episodes.push(episode);
    }
    const seasons = [...grouped.values()].sort((left, right) => left.number - right.number);
    const seriesTitle = firstText(property.title, seriesProps.pageProperty?.title);
    if (!seriesTitle) {
        throw new Error('PBS KIDS did not expose the series title.');
    }
    return {
        provider: 'pbs-kids',
        seriesTitle,
        seriesDescription: cleanText(seriesProps.pageDescription),
        seriesPosterUrl: firstAssetUrl(property.mezzanine),
        seriesArtworkShape: 'landscape',
        seriesYear: '',
        seriesGenres: [],
        seriesContentRating: '',
        seriesSeasonCount: seasons.length,
        seriesEpisodeCount: episodes.length,
        sourceUrl: seriesUrl,
        discovery: 'provider-adapter',
        seasons,
    };
}

export const pbsKidsAdapter = {
    id: 'pbs-kids',

    matches(url) {
        return PBS_KIDS_HOSTS.has(url.hostname.toLowerCase())
            && PBS_KIDS_PATH.test(url.pathname);
    },

    async discover(url) {
        return discoverPBSKidsCatalog(url);
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
