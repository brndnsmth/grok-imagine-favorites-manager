/**
 * Grok Imagine Favorites Manager - Background Service Worker
 * Handles download operations and Deep Analysis via Network Interception (God Mode)
 */

// Constants
const DOWNLOAD_CONFIG = {
  RATE_LIMIT_MS: 1000,
  FOLDER: 'grok-imagine'
};

// Global map to track analysis requests
const activeAnalysis = new Map();

/**
 * Handles messages from content script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startDownloads') {
    handleDownloads(request.media)
      .then(() => sendResponse({ success: true }))
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

// proxyLogInternal listener removed

  if (request.action === 'analyzePost') {
    analyzePostInTab(request.postId, request.url)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(error => {
        console.error('Analysis error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

/**
 * Opens a background tab, injects network sniffer, interacts, captures URLs
 */
async function analyzePostInTab(postId, postUrl) {
  let tabId = null;
  const collectedMedia = new Set(); // Use Set for uniqueness

  try {
    const targetUrl = postUrl || `https://grok.com/imagine/post/${postId}`;

    const tab = await chrome.tabs.create({ url: targetUrl, active: false });
    tabId = tab.id;

    // Wait for load
    await new Promise(resolve => {
        const listener = (tid, changeInfo) => {
            if (tid === tabId && changeInfo.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(resolve, 500); 
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 8000);
    });

    // --- INJECT SNIFFER (MAIN WORLD) ---
    await chrome.scripting.executeScript({
        target: { tabId },
        func: networkSniffer,
        world: 'MAIN'
    });
    await new Promise(r => setTimeout(r, 200));

    // --- STEP 1: COLLECT VIDEO ASSETS ---
    const vResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: scrapeAndIntercept,
      args: ['video']
    });
    if (vResults && vResults[0] && vResults[0].result) {
        vResults[0].result.forEach(u => collectedMedia.add(u));
    }

    // --- STEP 2: SWITCH TO IMAGE/VARIATIONS TAB ---
    await chrome.scripting.executeScript({
      target: { tabId },
      func: switchTab
    });
    await new Promise(r => setTimeout(r, 500));

    // --- STEP 3: COLLECT IMAGE ASSETS (AND ANY NEW TRAFFIC) ---
    const iResults = await chrome.scripting.executeScript({
        target: { tabId },
        func: scrapeAndIntercept,
        args: ['image']
    });
    if (iResults && iResults[0] && iResults[0].result) {
        iResults[0].result.forEach(u => collectedMedia.add(u));
    }
    
    // Cleanup
    chrome.tabs.remove(tabId);
    
    // Map URLs to formatted objects
    return Array.from(collectedMedia)
        .filter(url => url && url.length > 5)
        .map(url => {
            const id = extractPostIdFromUrl(url) || postId;
            const type = url.includes('.mp4') ? 'video' : 'image';
            return { url, id, type };
        });

  } catch (e) {
    if (tabId) chrome.tabs.remove(tabId);
    throw e;
  }
}

// Utility for background
function extractPostIdFromUrl(url) {
    if (!url) return null;
    const pathMatch = url.match(/\/(?:generated|post|status|imagine\/post)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (pathMatch && pathMatch[1]) return pathMatch[1].toLowerCase();

    const allMatches = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig);
    if (allMatches && allMatches.length > 0) {
      return allMatches[allMatches.length - 1].toLowerCase();
    }
    return null;
}

/**
 * SNIFFER - Runs in MAIN world, overrides fetch/XHR to leak URLs to DOM
 */
function networkSniffer() {
    // Hidden data exchange element
    let relay = document.getElementById('grok-sniffer-relay');
    if (!relay) {
        relay = document.createElement('div');
        relay.id = 'grok-sniffer-relay';
        relay.style.display = 'none';
        document.body.appendChild(relay);
    }

    const pushUrl = (url) => {
        if (!url) return;
        if (typeof url !== 'string') {
            if (url instanceof URL) url = url.href;
            else if (url instanceof Request) url = url.url;
        }
        
        // Check for interesting extensions
        if (url.includes('.mp4') || url.includes('.jpg') || url.includes('.png') || url.includes('.webp') || url.includes('blob:')) {

            let current = [];
            try { current = JSON.parse(relay.dataset.collectedUrls || '[]'); } catch(e){}
            if (!current.includes(url)) {
                current.push(url);
                relay.dataset.collectedUrls = JSON.stringify(current);
                relay.setAttribute('data-timestamp', Date.now());
            }
        }
    };

    // Hook fetch
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
        const [resource, config] = args;
        pushUrl(resource);
        return originalFetch(...args);
    };

    // Hook XHR
    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        pushUrl(url);
        return originalOpen.apply(this, [method, url, ...rest]);
    };
    

}

/**
 * SCRAPER - Runs in ISOLATED world, clicks button and watches relay
 */
async function scrapeAndIntercept(mode) {
    const relay = document.getElementById('grok-sniffer-relay');

    if (!relay) {
        return [];
    }


    // Reset collected urls
    relay.dataset.collectedUrls = '[]';
    
    // Helper to find button
    const findBtn = () => {
        const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        return btns.find(b => {
            const label = (b.ariaLabel || "").toLowerCase();
            const text = (b.innerText || "").toLowerCase();
            const title = (b.title || "").toLowerCase();
            const isDownload = 
                label.includes('download') || text.includes('download') || title.includes('download') ||
                label.includes('ダウンロード') || text.includes('ダウンロード') || title.includes('ダウンロード') ||
                label.includes('保存') || text.includes('保存') || title.includes('保存');
            return isDownload && !text.includes('upscale') && !label.includes('upscale');
        });
    };

    // 1. Wait for Button (Hydration/Render check) - Max 1.5s
    let dlBtn = findBtn();
    if (!dlBtn) {
        for (let i = 0; i < 15; i++) { // 100ms * 15 = 1.5s
            await new Promise(r => setTimeout(r, 100));
            dlBtn = findBtn();
            if (dlBtn) break;
        }
    }
    
    let buttonFound = false;
    if (dlBtn) {
        dlBtn.click();
        buttonFound = true;
    }

    // 2. Wait for Network Idle (Dynamic Exit)
    // Use Time-based loop to handle background tab throttling (setTimeout becomes 1000ms in inactive tabs)
    const startTime = Date.now();
    let firstDiscoveryTime = null;
    let idleStartTime = null;
    let lastCount = 0;
    
    // Max wait 4 seconds (safe wall-clock time)
    while (Date.now() - startTime < 4000) {
        // Wait 100ms (or 1000ms if throttled)
        await new Promise(r => setTimeout(r, 100));
        
        // Check current results
        let currentCount = 0;
        try {
            const current = JSON.parse(relay.dataset.collectedUrls || '[]');
            currentCount = current.length;
        } catch(e) {}

        const elapsed = Date.now() - startTime;

        // Log occasionally (every ~500ms approx) - REMOVED


        // If we have items...
        if (currentCount > 0) {
            // First time detection
            if (!firstDiscoveryTime) {
                firstDiscoveryTime = Date.now();
            }

            // And count hasn't changed since last tick
            if (currentCount === lastCount) {
                if (!idleStartTime) idleStartTime = Date.now();
                
                const idleDuration = Date.now() - idleStartTime;
                // If quiet for 600ms, exit
                if (idleDuration >= 600) {
                    break;
                }
            } else {
                // Count changed, reset idle timer
                idleStartTime = null;
            }
        } else {
            // 0 items
            idleStartTime = null; 
            
            // If button was found and 2s passed, timeout early
            if (buttonFound && elapsed >= 2000) {
                 break;
            }
            // If button NOT found, wait shorter (1.5s)
            if (!buttonFound && elapsed >= 1500) {
                 break;
            }
        }
        lastCount = currentCount;
    }

    let results = [];
    try {
        results = JSON.parse(relay.dataset.collectedUrls || '[]');
    } catch(e) {}
    
    return results;
}

function switchTab() {
    const candidates = Array.from(document.querySelectorAll('[role="tab"], button'));
    for (const el of candidates) {
        const txt = (el.innerText || "").toLowerCase();
        const label = (el.ariaLabel || "").toLowerCase();
        const isImage = 
            txt.includes('image') || label.includes('image') || 
            txt.includes('version') || label.includes('version') ||
            txt.includes('variations') || label.includes('variations') ||
            txt.includes('画像') || label.includes('画像') ||
            txt.includes('バリエーション') || label.includes('バリエーション');

        if (isImage) {
            el.click();
            return;
        }
    }
}

/**
 * Standard Download Logic
 */
async function handleDownloads(media) {
  if (!Array.isArray(media) || media.length === 0) throw new Error('No media provided');
  await chrome.storage.local.set({ totalDownloads: media.length, downloadProgress: {} });
  media.forEach((item, index) => {
    setTimeout(() => { 
        downloadFile(item); 
    }, index * DOWNLOAD_CONFIG.RATE_LIMIT_MS);
  });
}

function downloadFile(item) {
  if (!item.url || !item.filename) return;
  chrome.downloads.download({ 
    url: item.url, 
    filename: `${DOWNLOAD_CONFIG.FOLDER}/${item.filename}`,
    saveAs: false
  });
}

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state) return;
  chrome.storage.local.get(['downloadProgress'], (result) => {
    const progress = result.downloadProgress || {};
    if (delta.state.current === 'complete') progress[delta.id] = 'complete';
    else if (delta.state.current === 'interrupted') progress[delta.id] = 'failed';
    chrome.storage.local.set({ downloadProgress: progress });
  });
});
