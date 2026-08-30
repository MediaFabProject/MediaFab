import { crunchyrollAdapter } from './crunchyroll.mjs';
import { disneyPlusAdapter } from './disneyplus.mjs';

const adapters = [crunchyrollAdapter, disneyPlusAdapter];
const playbackAdapters = [crunchyrollAdapter, disneyPlusAdapter];

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
