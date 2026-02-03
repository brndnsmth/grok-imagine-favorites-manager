/**
 * Grok Imagine Favorites Manager - Content Script (Entry Point)
 */

console.log('[GrokManager] Content script initialized.');

// Initialize simple modules map for debugging if needed
window.GrokModules = {
  Scanner: window.MediaScanner,
  Classifier: window.ItemClassifier,
  Api: window.Api,
  UI: window.ProgressModal,
  Utils: window.Utils
};

/**
 * Message listener for actions from popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action } = request;

  if (action === 'ping') {
    // Basic connectivity check
    if (window.ProgressModal) {
      sendResponse({ loaded: true });
    } else {
      // Retry logic often handles this, but good to be explicit
      sendResponse({ loaded: false });
    }
    return true;
  }

  if (action === 'cancelOperation') {
    if (window.ProgressModal) window.ProgressModal.cancel();
    chrome.storage.local.set({ activeOperation: false });
    sendResponse({ success: true });
    return;
  }

  // Handle Main Actions
  (async () => {
    try {
      chrome.storage.local.set({ activeOperation: true });

      if (action.startsWith('save')) {
        await handleSaveFlow(action);
      } else if (action === 'upscaleVideos') {
        await handleUpscaleFlow();
      } else if (action === 'unsaveAll') {
        await handleUnsaveFlow();
      }
    } catch (error) {
      console.error('[GrokManager] Error handling action:', error);
      if (window.ProgressModal) window.ProgressModal.hide();
      if (!error.message.includes('cancelled')) {
        alert(`Error: ${error.message}`);
      }
    } finally {
      chrome.storage.local.set({ activeOperation: false });
    }
  })();

  // Return true to indicate async response (though we handled it inside async IIFE)
  return true;
});

/**
 * High-level flow for saving media
 */
async function handleSaveFlow(type) {
  try {
    if (!window.ProgressModal) {
      throw new Error('UI Module not loaded. Please refresh the page.');
    }
    window.ProgressModal.show('Collecting Favorites', 'Scanning page...');

    // Delegate core work to MediaScanner
    const mediaList = await window.MediaScanner.scan(type);

    if (mediaList.length === 0) {
      throw new Error('No media found.');
    }

    window.ProgressModal.update(100, `Found ${mediaList.length} items. Starting downloads...`);

    // Send work to background script
    window.Api.startDownloads(mediaList);

  } catch (error) {
    if (error.message === 'Operation cancelled by user') {
      window.ProgressModal.hide();
      return;
    }
    console.error('[GrokManager] Save flow error:', error);
    throw error;
  } finally {
    if (window.ProgressModal) {
      setTimeout(() => window.ProgressModal.remove(), 2500);
    }
  }
}

/**
 * High-level flow for unsaving all items
 */
async function handleUnsaveFlow() {
  try {
    if (!window.ProgressModal) {
      throw new Error('UI Module not loaded. Please refresh the page.');
    }
    const confirmUnsave = confirm('WARNING: This will remove ALL likes/favorites from the current list.\n\nAre you sure you want to continue?');
    if (!confirmUnsave) return;

    window.ProgressModal.show('Unfavoriting All Items', 'Starting sweep...');

    // Delegate core work to MediaScanner
    const processedCount = await window.MediaScanner.unsaveAll();

    window.ProgressModal.update(100, `Done! Unfavorited ${processedCount} items.`);

    await window.Utils.sleep(1000);
    alert(`Finished! ${processedCount} items were removed.\nThe page will now refresh.`);
    window.location.reload();

  } catch (error) {
    if (error.message === 'Operation cancelled by user') {
      window.ProgressModal.hide();
      return;
    }
    console.error('[GrokManager] Unsave flow error:', error);
    throw error;
  } finally {
    if (window.ProgressModal) {
      window.ProgressModal.remove();
    }
  }
}

/**
 * High-level flow for upscaling videos
 */
async function handleUpscaleFlow() {
  try {
    if (!window.ProgressModal) {
      throw new Error('UI Module not loaded. Please refresh the page.');
    }
    window.ProgressModal.show('Upscaling Videos', 'Scanning for videos...');

    // 1. Scan for videos ONLY
    const mediaList = await window.MediaScanner.scan('saveVideos');
    const videos = mediaList.filter(m => m.url.includes('.mp4') && m.id);

    if (videos.length === 0) {
      throw new Error('No videos found to upscale.');
    }

    window.ProgressModal.update(0, `Found ${videos.length} videos. Requesting upscales...`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < videos.length; i++) {
      if (window.ProgressModal.isCancelled()) break;

      const video = videos[i];
      window.ProgressModal.updateSubStatus(`Requesting upscale for ${video.id}...`);

      const success = await window.Api.requestUpscale(video.id);
      if (success) successCount++;
      else failCount++;

      const progress = ((i + 1) / videos.length) * 100;
      window.ProgressModal.update(progress, `Processed ${i + 1}/${videos.length} (Success: ${successCount})`);

      // Small delay to be polite to the API
      await window.Utils.sleep(500);
    }

    if (window.ProgressModal.isCancelled()) {
      window.ProgressModal.hide();
      return;
    }

    await window.Utils.sleep(1000);
    alert(`Finished! Requested upscale for ${successCount} videos${failCount > 0 ? `, ${failCount} failed` : ''}.`);

  } catch (error) {
    if (error.message === 'Operation cancelled by user') {
      window.ProgressModal.hide();
      return;
    }
    console.error('[GrokManager] Upscale flow error:', error);
    throw error;
  } finally {
    if (window.ProgressModal) {
      window.ProgressModal.remove();
    }
  }
}
