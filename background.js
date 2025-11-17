/**
 * Grok Imagine Favorites Manager - Background Service Worker
 * Handles download operations and progress tracking
 */

// Constants
const DOWNLOAD_CONFIG = {
  RATE_LIMIT_MS: 300, // ~3 downloads per second
  FOLDER: 'grok-imagine'
};

/**
 * Handles messages from content script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startDownloads') {
    handleDownloads(request.media)
      .then(() => sendResponse({ success: true }))
      .catch(error => {
        console.error('Download error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }
});

/**
 * Processes download queue with rate limiting
 * @param {Array} media - Array of media objects to download
 * @returns {Promise<void>}
 */
async function handleDownloads(media) {
  if (!Array.isArray(media) || media.length === 0) {
    throw new Error('No media provided for download');
  }
  
  // Initialize download tracking
  await chrome.storage.local.set({ 
    totalDownloads: media.length,
    downloadProgress: {}
  });
  
  // Queue downloads with rate limiting
  media.forEach((item, index) => {
    setTimeout(() => {
      downloadFile(item);
    }, index * DOWNLOAD_CONFIG.RATE_LIMIT_MS);
  });
}

/**
 * Downloads a single file
 * @param {Object} item - Media item with url and filename
 */
function downloadFile(item) {
  if (!item.url || !item.filename) {
    console.error('Invalid download item:', item);
    return;
  }
  
  chrome.downloads.download({ 
    url: item.url, 
    filename: `${DOWNLOAD_CONFIG.FOLDER}/${item.filename}`,
    saveAs: false
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error('Download failed:', chrome.runtime.lastError);
    }
  });
}

/**
 * Tracks download state changes
 */
chrome.downloads.onChanged.addListener((delta) => {
  if (!delta.state) return;
  
  chrome.storage.local.get(['downloadProgress'], (result) => {
    const progress = result.downloadProgress || {};
    
    if (delta.state.current === 'complete') {
      progress[delta.id] = 'complete';
    } else if (delta.state.current === 'interrupted') {
      progress[delta.id] = 'failed';
    }
    
    chrome.storage.local.set({ downloadProgress: progress });
  });
});
