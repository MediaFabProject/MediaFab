const CRUNCHYROLL_HOSTS = new Set(['crunchyroll.com', 'www.crunchyroll.com']);
const CRUNCHYROLL_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:series|watch)\/[A-Z0-9]+(?:\/|$)/i;
const API_ROOT = 'https://www.crunchyroll.com/content/v2/cms';
const TOKEN_URL = 'https://www.crunchyroll.com/auth/v1/token';
const LOCALE = 'en-US';
let cachedToken = '';
let cachedTokenExpiresAt = 0;

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function integer(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function dataList(payload) {
    return Array.isArray(payload?.data) ? payload.data.filter((item) => item && typeof item === 'object') : [];
}

function firstData(payload) {
    return dataList(payload)[0] || {};
}

function flattenObjects(value) {
    if (Array.isArray(value)) {
        return value.flatMap(flattenObjects);
    }
    return value && typeof value === 'object' ? [value] : [];
}

function largestImage(images, ...types) {
    const candidates = types.flatMap((type) => flattenObjects(images?.[type]));
    candidates.sort((left, right) => integer(right.width) * integer(right.height) - integer(left.width) * integer(left.height));
    return cleanText(candidates[0]?.source);
}

function thumbnailImage(images) {
    const candidates = flattenObjects(images?.thumbnail).filter((item) => integer(item.width) > 0);
    const preferred = candidates.filter((item) => integer(item.width) <= 640);
    const usable = preferred.length > 0 ? preferred : candidates;
    usable.sort((left, right) => integer(right.width) * integer(right.height) - integer(left.width) * integer(left.height));
    return cleanText(usable[0]?.source);
}

function preferredVersionId(versions, fallback = '', preferOriginal = false) {
    const items = Array.isArray(versions) ? versions.filter((item) => item && typeof item === 'object') : [];
    if (preferOriginal) {
        const original = items.find((item) => item.original === true);
        if (original?.guid) {
            return cleanText(original.guid);
        }
    }
    const english = items.find((item) => cleanText(item.audio_locale) === LOCALE);
    return cleanText(english?.guid) || fallback;
}

function displayedSeasonNumber(season) {
    const displayNumber = integer(season?.season_display_number);
    if (displayNumber > 0) {
        return displayNumber;
    }
    for (const value of [season?.slug_title, season?.title, season?.season_title]) {
        const match = cleanText(value).match(/(?:^|\b)season[\s_-]*(\d+)(?:\b|$)/i);
        if (match) {
            return integer(match[1]);
        }
    }
    return 0;
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        method: options.method || 'GET',
        headers: { Accept: 'application/json', ...(options.headers || {}) },
        body: options.body,
        credentials: 'omit',
        cache: 'no-store',
    });
    if (!response.ok) {
        throw new Error(`Crunchyroll catalogue request failed (${response.status}).`);
    }
    const payload = await response.json();
    return payload && typeof payload === 'object' ? payload : {};
}

async function anonymousToken() {
    if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) {
        return cachedToken;
    }
    const body = new URLSearchParams({
        grant_type: 'client_id',
        client_id: 'cr_web',
        device_id: crypto.randomUUID(),
        device_type: 'Chrome on OS X',
        device_name: 'Chrome',
    });
    const payload = await requestJson(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    cachedToken = cleanText(payload.access_token);
    if (!cachedToken) {
        throw new Error('Crunchyroll did not return an anonymous catalogue token.');
    }
    cachedTokenExpiresAt = Date.now() + integer(payload.expires_in, 3600) * 1000;
    return cachedToken;
}

export async function discoverCrunchyrollCatalog(url) {
    const match = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(series|watch)\/([A-Z0-9]+)(?:\/|$)/i);
    if (!match) {
        throw new Error('Enter a Crunchyroll series or watch link.');
    }
    const token = await anonymousToken();
    const apiGet = async (path) => {
        const endpoint = new URL(`${API_ROOT}/${path}`);
        endpoint.searchParams.set('locale', LOCALE);
        return requestJson(endpoint.href, { headers: { Authorization: `Bearer ${token}` } });
    };

    const kind = match[1].toLowerCase();
    const identifier = match[2].toUpperCase();
    let seriesId = identifier;
    let episodeDetail = {};
    if (kind === 'watch') {
        episodeDetail = firstData(await apiGet(`episodes/${identifier}`));
        if (Object.keys(episodeDetail).length === 0) {
            episodeDetail = firstData(await apiGet(`objects/${identifier}`))?.episode_metadata || {};
        }
        seriesId = cleanText(episodeDetail.series_id);
        if (!seriesId) {
            throw new Error('Crunchyroll did not identify the series for this watch link.');
        }
    }

    const seriesObject = firstData(await apiGet(`objects/${seriesId}`));
    const seriesDetail = firstData(await apiGet(`series/${seriesId}`));
    const seriesNested = seriesObject.series_metadata || {};
    const seriesTitle = cleanText(seriesObject.title || seriesDetail.title || episodeDetail.series_title);
    if (!seriesTitle) {
        throw new Error('Crunchyroll series metadata was not found.');
    }

    const grouped = new Map();
    const seenPositions = new Set();
    const rawSeasons = dataList(await apiGet(`series/${seriesId}/seasons`));
    for (const [index, season] of rawSeasons.entries()) {
        const seasonNumber = displayedSeasonNumber(season)
            || integer(season.season_number)
            || integer(season.season_sequence_number)
            || index + 1;
        const seasonId = preferredVersionId(season.versions, cleanText(season.id), true);
        if (!seasonId) {
            continue;
        }
        if (!grouped.has(seasonNumber)) {
            grouped.set(seasonNumber, {
                id: `crunchyroll-season-${seasonNumber}`,
                number: seasonNumber,
                title: cleanText(season.title || season.season_title) || `Season ${seasonNumber}`,
                episodes: [],
            });
        }
        for (const episode of dataList(await apiGet(`seasons/${seasonId}/episodes`))) {
            const episodeNumber = integer(episode.episode_number);
            const position = `${seasonNumber}:${episodeNumber}`;
            if (episodeNumber <= 0 || seenPositions.has(position)) {
                continue;
            }
            const episodeId = preferredVersionId(episode.versions, cleanText(episode.id));
            if (!episodeId) {
                continue;
            }
            const slug = cleanText(episode.slug_title);
            const watchUrl = `https://www.crunchyroll.com/watch/${episodeId}${slug ? `/${slug}` : ''}`;
            const durationMs = integer(episode.duration_ms);
            const airDate = cleanText(episode.episode_air_date);
            grouped.get(seasonNumber).episodes.push({
                id: `crunchyroll:${episodeId}`,
                seasonNumber,
                episodeNumber,
                title: cleanText(episode.title) || `Episode ${episodeNumber}`,
                description: cleanText(episode.description),
                thumbnailUrl: thumbnailImage(episode.images),
                durationMinutes: durationMs > 0 ? Math.max(1, Math.round(durationMs / 60000)) : 0,
                airDate: /^\d{4}-\d{2}-\d{2}/.test(airDate) ? airDate.slice(0, 10) : '',
                playbackUrl: watchUrl,
                detailUrl: watchUrl,
                selected: true,
            });
            seenPositions.add(position);
        }
    }
    const seasons = [...grouped.values()].sort((left, right) => left.number - right.number);
    seasons.forEach((season) => season.episodes.sort((left, right) => left.episodeNumber - right.episodeNumber));
    if (!seasons.some((season) => season.episodes.length > 0)) {
        throw new Error('Crunchyroll returned no numbered episodes for this series.');
    }
    const maturityRatings = seriesDetail.maturity_ratings || seriesNested.maturity_ratings;
    return {
        provider: 'crunchyroll',
        seriesId,
        seriesTitle,
        seriesDescription: cleanText(seriesObject.description),
        seriesPosterUrl: largestImage(seriesObject.images, 'poster_tall'),
        seriesYear: integer(seriesDetail.series_launch_year || seriesNested.series_launch_year),
        seriesGenres: Array.isArray(seriesNested.tenant_categories)
            ? seriesNested.tenant_categories.map(cleanText).filter(Boolean)
            : [],
        seriesContentRating: Array.isArray(maturityRatings)
            ? cleanText(maturityRatings[0])
            : cleanText(maturityRatings),
        seriesSeasonCount: seasons.length,
        seriesEpisodeCount: seasons.reduce((total, season) => total + season.episodes.length, 0),
        sourceUrl: `${url.origin}${url.pathname.replace(/\/$/, '')}`,
        seasons,
    };
}

export const crunchyrollAdapter = {
    id: 'crunchyroll',

    matches(url) {
        return CRUNCHYROLL_HOSTS.has(url.hostname.toLowerCase())
            && CRUNCHYROLL_PATH.test(url.pathname);
    },

    async discover(url) {
        return discoverCrunchyrollCatalog(url);
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
