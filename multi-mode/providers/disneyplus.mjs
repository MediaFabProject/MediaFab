const DISNEY_PLUS_HOSTS = new Set(['disneyplus.com', 'www.disneyplus.com']);
const DISNEY_PLUS_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:browse\/entity-|play\/)[0-9a-f-]+(?:\/|$)/i;

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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

function extractNextData(page) {
    const match = String(page || '').match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!match) {
        return {};
    }
    try {
        const value = JSON.parse(decodeHtml(match[1]));
        return value && typeof value === 'object' ? value : {};
    } catch {
        return {};
    }
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

function contentBlock(main, type) {
    return main.find((item) => cleanText(item?._type) === type) || {};
}

function metaContent(block, key) {
    return (block?.metaTags || []).find((item) =>
        ['property', 'name', 'itemProp'].some((field) => cleanText(item?.[field]).toLowerCase() === key.toLowerCase())
    )?.content || '';
}

function imageSource(block) {
    if (!block || typeof block !== 'object') {
        return '';
    }
    for (const key of ['xxlargeImage', 'xlargeImage', 'largeImage', 'defaultImage', 'mediumImage', 'smallImage']) {
        const source = cleanText(block[key]?.source);
        if (source) {
            return source.startsWith('//') ? `https:${source}` : source;
        }
    }
    return '';
}

function ripcutImageUrl(block, width = 1920, aspectRatio = '1.78') {
    if (!block || typeof block !== 'object') {
        return '';
    }
    for (const key of ['xxlargeImage', 'xlargeImage', 'largeImage', 'defaultImage', 'mediumImage', 'smallImage']) {
        const imageId = cleanText(block[key]?.ripcutId || block[key]?.imageId);
        if (imageId) {
            return `https://disney.images.edge.bamgrid.com/ripcut-delivery/v2/variant/disney/${imageId}/compose?aspectRatio=${aspectRatio}&format=webp&width=${width}`;
        }
    }
    return '';
}

function episodeRecords(block) {
    const groups = Array.isArray(block?.seoSeasons) ? [...block.seoSeasons] : [];
    if (Array.isArray(block?.episodes) && block.episodes.length > 0) {
        groups.push({ episodes: block.episodes });
    }
    const records = new Map();
    for (const group of groups) {
        for (const card of Array.isArray(group?.episodes) ? group.episodes : []) {
            const match = cleanText(card?.title).match(/^S(\d+)\s*:\s*E(\d+)\s+(.+)$/i);
            const id = cleanText(card?._id);
            if (!match || !id) {
                continue;
            }
            const seasonNumber = Number.parseInt(match[1], 10);
            const episodeNumber = Number.parseInt(match[2], 10);
            const identity = `${seasonNumber}:${episodeNumber}:${id}`;
            records.set(identity, {
                id,
                seasonNumber,
                episodeNumber,
                title: cleanText(match[3]),
                description: cleanText(card?.metadata?.summary),
                thumbnailUrl: imageSource(card?.imageVariants) || ripcutImageUrl(card?.imageVariants),
                playbackUrl: `https://www.disneyplus.com/play/${id}`,
                detailUrl: `https://www.disneyplus.com/play/${id}`,
                selected: true,
            });
        }
    }
    return [...records.values()].sort((left, right) =>
        left.seasonNumber - right.seasonNumber || left.episodeNumber - right.episodeNumber
    );
}

function releaseYears(value) {
    const years = cleanText(value).match(/\b(?:19|20)\d{2}\b/g) || [];
    return years;
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
        throw new Error(`Disney+ catalogue request failed (${response.status}).`);
    }
    return response.text();
}

export async function discoverDisneyPlusCatalog(url) {
    if (!DISNEY_PLUS_HOSTS.has(url.hostname.toLowerCase()) || !DISNEY_PLUS_PATH.test(url.pathname)) {
        throw new Error('Enter a Disney+ series entity or episode /play/ link.');
    }
    const page = await requestPage(url.href);
    const data = extractNextData(page);
    const mainValue = nestedValue(data, ['props', 'pageProps', 'stitchDocument', 'mainContent']);
    const main = Array.isArray(mainValue) ? mainValue.filter((item) => item && typeof item === 'object') : [];
    const episodesBlock = contentBlock(main, 'Episodes');
    const details = contentBlock(main, 'MediaDetails');
    const hero = contentBlock(main, 'DetailEntityHero');
    const metadata = contentBlock(main, 'Metadata');
    const episodes = episodeRecords(episodesBlock);
    const seriesTitle = cleanText(episodesBlock.seriesTitle || details.title || metaContent(metadata, 'og:title'))
        .replace(/\s*\|\s*(?:Watch (?:Full Episodes|Now|on Disney\+)|Disney\+).*$/i, '');
    if (!seriesTitle || episodes.length === 0) {
        throw new Error('Disney+ did not expose a public series and episode guide for this link. It may be a movie rather than a series.');
    }

    const grouped = new Map();
    for (const episode of episodes) {
        if (!grouped.has(episode.seasonNumber)) {
            grouped.set(episode.seasonNumber, {
                id: `disneyplus-season-${episode.seasonNumber}`,
                number: episode.seasonNumber,
                title: `Season ${episode.seasonNumber}`,
                episodes: [],
            });
        }
        grouped.get(episode.seasonNumber).episodes.push(episode);
    }
    const seasons = [...grouped.values()].sort((left, right) => left.number - right.number);
    const release = cleanText(details.release || hero.releaseYear);
    const years = releaseYears(release);
    const contentRating = (details.ratings || [])
        .map((item) => cleanText(item?.image?.alt))
        .find(Boolean)
        || (hero.detailIcons || []).map((item) => cleanText(item?.alt)).find((item) => /^[A-Z0-9-]+$/.test(item))
        || '';
    const socialImage = cleanText(metaContent(metadata, 'og:image'));
    return {
        provider: 'disneyplus',
        seriesTitle,
        seriesDescription: cleanText(details.summary || hero.synopsisText || metaContent(metadata, 'description')),
        seriesPosterUrl: socialImage || imageSource(hero.backgroundImage),
        seriesYear: years[0] || '',
        seriesGenres: Array.isArray(hero.genres || details.genres) ? (hero.genres || details.genres).map(cleanText).filter(Boolean) : [],
        seriesContentRating: contentRating,
        seriesSeasonCount: seasons.length,
        seriesEpisodeCount: episodes.length,
        sourceUrl: cleanText(metaContent(metadata, 'og:url')) || url.href,
        discovery: 'provider-adapter',
        seasons,
    };
}

export const disneyPlusAdapter = {
    id: 'disneyplus',

    matches(url) {
        return DISNEY_PLUS_HOSTS.has(url.hostname.toLowerCase())
            && DISNEY_PLUS_PATH.test(url.pathname);
    },

    async discover(url) {
        return discoverDisneyPlusCatalog(url);
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
