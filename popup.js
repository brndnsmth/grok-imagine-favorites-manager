/**
 * Grok Imagine Favorites Manager - Popup Script
 * Handles UI interactions and message passing
 */

// Constants
const UPDATE_INTERVAL = 1000; // Update progress every second
const PROGRESS_CLEAR_DELAY = 5000; // Clear progress after 5 seconds

/**
 * Initialize event listeners when DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
  // Download actions
  document.getElementById('saveImages').addEventListener('click', () => sendAction('saveImages'));
  document.getElementById('saveVideos').addEventListener('click', () => sendAction('saveVideos'));
  document.getElementById('saveBoth').addEventListener('click', () => sendAction('saveBoth'));
  document.getElementById('upscaleVideos').addEventListener('click', () => sendAction('upscaleVideos'));
  
  // Manage actions
document.getElementById('unsaveBoth').addEventListener('click', () => sendAction('unsaveBoth'));
document.getElementById('unsaveImages').addEventListener('click', () => sendAction('unsaveImages'));
document.getElementById('unsaveVideos').addEventListener('click', () => sendAction('unsaveVideos'));  // Utility actions
  document.getElementById('viewDownloads').addEventListener('click', openDownloadsPage);
  document.getElementById('downloadSettings').addEventListener('click', openDownloadSettings);
  document.getElementById('cancelOperation').addEventListener('click', cancelCurrentOperation);
  
  // Start progress tracking
  setInterval(updateProgress, UPDATE_INTERVAL);
  updateProgress();
  
  // Check for active operations
  checkActiveOperation();
});

/**
 * Sends action message to content script
 * @param {string} action - Action to perform
 */
function sendAction(action) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) {
      console.error('No active tab found');
      return;
    }
    
    chrome.tabs.sendMessage(tabs[0].id, { action }, (response) => {
      if (chrome.runtime.lastError) {
        // Silently ignore - content script will handle the action
        // Error is expected when message is sent but no response needed
        return;
      }
    });
  });
}

/**
 * Opens Chrome downloads page in new tab
 */
function openDownloadsPage() {
  chrome.tabs.create({ url: 'chrome://downloads/' });
}

/**
 * Opens the browser's downloads settings page so the user can disable
 * "Ask where to save each file before downloading" which forces prompts.
 */
function openDownloadSettings() {
  chrome.tabs.create({ url: 'chrome://settings/downloads' });
}

/**
 * Cancels the current operation running in the content script
 */
function cancelCurrentOperation() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) {
      console.error('No active tab found');
      return;
    }
    
    chrome.tabs.sendMessage(tabs[0].id, { action: 'cancelOperation' }, (response) => {
      if (chrome.runtime.lastError) {
        // Silently ignore - operation may have already completed
        return;
      }
      if (response && response.success) {
        document.getElementById('cancelOperation').style.display = 'none';
        chrome.storage.local.set({ activeOperation: false });
      }
    });
  });
}

/**
 * Checks if there's an active operation and shows/hides cancel button
 */
function checkActiveOperation() {
  chrome.storage.local.get(['activeOperation'], (result) => {
    const cancelBtn = document.getElementById('cancelOperation');
    if (result.activeOperation) {
      cancelBtn.style.display = 'block';
    } else {
      cancelBtn.style.display = 'none';
    }
  });
  
  // Check periodically
  setInterval(() => {
    chrome.storage.local.get(['activeOperation'], (result) => {
      const cancelBtn = document.getElementById('cancelOperation');
      if (result.activeOperation) {
        cancelBtn.style.display = 'block';
      } else {
        cancelBtn.style.display = 'none';
      }
    });
  }, 1000);
}

/**
 * Updates download progress display
 */
function updateProgress() {
  chrome.storage.local.get(['totalDownloads', 'downloadProgress'], (result) => {
    const total = result.totalDownloads || 0;
    const progress = result.downloadProgress || {};
    const completed = Object.values(progress).filter(s => s === 'complete').length;
    
    const progressElement = document.getElementById('progress');
    const progressText = document.getElementById('progressText');
    
    if (total > 0) {
      progressElement.style.display = 'block';
      progressText.textContent = `${completed} of ${total} downloads complete`;
      
      // Clear progress after all complete
      if (completed === total) {
        setTimeout(() => {
          chrome.storage.local.remove(['totalDownloads', 'downloadProgress']);
          progressElement.style.display = 'none';
        }, PROGRESS_CLEAR_DELAY);
      }
    } else {
      progressElement.style.display = 'none';
    }
  });
}
