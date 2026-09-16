async function processMessage(detail) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: detail.type,
            body: detail.body,
        }, (response) => {
            if (chrome.runtime.lastError) {
                return reject(chrome.runtime.lastError);
            }
            resolve(response);
        });
    })
}

document.addEventListener('response', async (event) => {
    const { detail } = event;
    const responseData = await processMessage(detail);
    const responseEvent = new CustomEvent('responseReceived', {
        detail: detail.requestId.concat(responseData)
    });
    document.dispatchEvent(responseEvent);
});

function findMultiModePlaybackControl() {
    const roots = [document];
    for (let index = 0; index < roots.length; index += 1) {
        const root = roots[index];
        const video = root.querySelector?.('video');
        if (video) {
            return { video };
        }
        const button = root.querySelector?.([
            'button[aria-label*="play" i]',
            'button[title*="play" i]',
            '[role="button"][aria-label*="play" i]',
            '[data-testid*="play" i]',
        ].join(','));
        if (button) {
            return { button };
        }
        root.querySelectorAll?.('*').forEach((element) => {
            if (element.shadowRoot) {
                roots.push(element.shadowRoot);
            }
        });
    }
    return {};
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const playbackHosts = {
        'amazon-prime': /(^|\.)(?:primevideo\.com|amazon\.(?:ae|ca|cn|com|de|eg|es|fr|in|it|nl|pl|sa|se|sg|co\.jp|co\.uk|com\.au|com\.be|com\.br|com\.mx|com\.tr))$/i,
        crunchyroll: /(^|\.)crunchyroll\.com$/i,
        disneyplus: /(^|\.)disneyplus\.com$/i,
        max: /(^|\.)(?:hbomax\.com|max\.com)$/i,
        'pbs-kids': /(^|\.)pbskids\.org$/i,
    };
    const expectedHost = playbackHosts[message?.provider];
    if (message?.type !== 'MULTI_MODE_ACTIVATE_PLAYBACK' || !expectedHost) {
        return false;
    }
    if (!expectedHost.test(location.hostname)) {
        sendResponse({ activated: false, requiresUser: true });
        return false;
    }

    (async () => {
        const control = findMultiModePlaybackControl();
        if (control.video) {
            if (!control.video.paused) {
                sendResponse({ activated: true, action: 'already-playing' });
                return;
            }
            try {
                await control.video.play();
                sendResponse({ activated: true, action: 'video-play' });
                return;
            } catch {
                // The browser or provider may require a user gesture before playback.
            }
        }
        if (control.button) {
            control.button.click();
            sendResponse({ activated: true, action: 'play-control' });
            return;
        }
        sendResponse({ activated: false, requiresUser: true });
    })();
    return true;
});
