import { amazonPrimeAdapter } from './amazon-prime.mjs';
import { bbcIPlayerAdapter } from './bbc-iplayer.mjs';
import { crunchyrollAdapter } from './crunchyroll.mjs';
import { disneyPlusAdapter } from './disneyplus.mjs';
import { hboMaxAdapter } from './hbo-max.mjs';
import { pbsKidsAdapter } from './pbs-kids.mjs';
import { paramountPlusAdapter } from './paramountplus.mjs';

const adapters = [
    amazonPrimeAdapter,
    bbcIPlayerAdapter,
    crunchyrollAdapter,
    disneyPlusAdapter,
    hboMaxAdapter,
    pbsKidsAdapter,
    paramountPlusAdapter,
];
const playbackAdapters = [amazonPrimeAdapter, crunchyrollAdapter, disneyPlusAdapter, hboMaxAdapter, pbsKidsAdapter];

export function registerProviderAdapter(adapter) {
    if (!adapter?.id || typeof adapter.matches !== 'function' || typeof adapter.discover !== 'function') {
        throw new TypeError('A provider adapter needs id, matches(), and discover().');
    }
    adapters.push(adapter);
}

export function getRegisteredProviderIds() {
    return adapters.map((adapter) => adapter.id);
}

export async function discoverProviderCatalog(url) {
    const parsed = new URL(url);
    const adapter = adapters.find((candidate) => candidate.matches(parsed));
    if (!adapter) {
        return null;
    }
    return adapter.discover(parsed);
}

export async function activateProviderPlayback(providerId, tabId) {
    const adapter = playbackAdapters.find((candidate) => candidate.id === providerId);
    return typeof adapter?.activate === 'function' ? adapter.activate(tabId) : null;
}
