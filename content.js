/**
 * Grok Imagine Favorites Manager - Content Script
 * Handles media extraction and unfavorite operations on grok.com
 */

// Constants
const SELECTORS = {
  CARD: '[role="listitem"] .relative.group\\/media-post-masonry-card',
  IMAGE: 'img[alt*="Generated"]',
  VIDEO: 'video[src*="generated_video"]',
  VIDEO_INDICATOR: 'svg[data-icon="play"]', // Play button overlay indicates video
  UNSAVE_BUTTON: 'button[aria-label="Unsave"]',
  LIST_ITEM: '[role="listitem"]'
};

const URL_PATTERNS = {
  IMAGE: ['imagine-public.x.ai', 'grok.com']
};

const TIMING = {
  NAVIGATION_DELAY: 500,
  UNFAVORITE_DELAY: 150, // Reduced since we're using API calls
  POST_LOAD_DELAY: 1000,
  POST_UNFAVORITE_DELAY: 1000,
  UPSCALE_TIMEOUT: 30000 // 30 seconds for upscale processing
};

const API = {
  UNLIKE_ENDPOINT: 'https://grok.com/rest/media/post/unlike',
  UPSCALE_ENDPOINT: 'https://grok.com/rest/media/video/upscale'
};

/**
 * Makes an API call to unlike/unfavorite a post
 * @param {string} postId - The post ID to unlike
 * @returns {Promise<boolean>} - True if successful
 */
async function unlikePost(postId) {
  try {
    const response = await fetch(API.UNLIKE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
      },
      credentials: 'include',
      body: JSON.stringify({ id: postId })
    });

    return response.ok;
  } catch (error) {
    console.error(`Failed to unlike post ${postId}:`, error);
    return false;
  }
}

/**
 * Attempts to upscale a video by its video ID
 * @param {string} videoId - The video ID to upscale
 * @returns {Promise<boolean>} - True if upscale request was accepted
 */
async function upscaleVideo(videoId) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMING.UPSCALE_TIMEOUT);

    const response = await fetch(API.UPSCALE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': '*/*',
      },
      credentials: 'include',
      body: JSON.stringify({ videoId }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    // Silently fail as requested - upscale may not be available for all videos
    console.log(`Upscale attempt for ${videoId} did not succeed:`, error.message);
    return false;
  }
}

/**
 * Extracts video ID from video URL
 * @param {string} videoUrl - The video URL
 * @returns {string|null} - The video ID or null
 */
function extractVideoId(videoUrl) {
  try {
    // URL format: https://assets.grok.com/users/.../generated/{videoId}/generated_video.mp4
    const match = videoUrl.match(/\/generated\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

/**
 * Progress modal manager
 */
const ProgressModal = {
  modal: null,
  cancelled: false,

  create() {
    if (this.modal) return;

    this.modal = document.createElement('div');
    this.modal.id = 'grok-favorites-progress-modal';
    this.modal.innerHTML = `
      <div style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        backdrop-filter: blur(4px);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      ">
        <div style="
          background: #1a1a1a;
          border: 1px solid #2a2a2a;
          border-radius: 16px;
          padding: 32px;
          min-width: 400px;
          max-width: 500px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        ">
          <div style="
            font-size: 20px;
            font-weight: 600;
            color: #e5e5e5;
            margin-bottom: 8px;
          " id="grok-progress-title">Processing...</div>
          
          <div style="
            font-size: 14px;
            color: #888;
            margin-bottom: 20px;
          " id="grok-progress-subtitle">Please wait</div>
          
          <div style="
            background: #0a0a0a;
            border-radius: 8px;
            height: 8px;
            overflow: hidden;
            margin-bottom: 16px;
          ">
            <div style="
              background: linear-gradient(90deg, #3b82f6, #8b5cf6);
              height: 100%;
              width: 0%;
              transition: width 0.3s ease;
              border-radius: 8px;
            " id="grok-progress-bar"></div>
          </div>
          
          <div style="
            font-size: 13px;
            color: #a0a0a0;
            line-height: 1.6;
            margin-bottom: 12px;
          " id="grok-progress-details">Starting...</div>
          
          <div style="
            font-size: 12px;
            color: #fbbf24;
            background: rgba(251, 191, 36, 0.1);
            border: 1px solid rgba(251, 191, 36, 0.2);
            border-radius: 6px;
            padding: 8px 12px;
            margin-bottom: 16px;
            line-height: 1.4;
          ">
            ⚠️ Do not navigate away or close this tab
          </div>
          
          <button id="grok-cancel-button" style="
            width: 100%;
            padding: 10px 16px;
            background: #2a1a1a;
            border: 1px solid #4a2a2a;
            border-radius: 8px;
            color: #ff6b6b;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s ease;
            font-family: inherit;
          " onmouseover="this.style.background='#3a1a1a'; this.style.borderColor='#5a2a2a'" onmouseout="this.style.background='#2a1a1a'; this.style.borderColor='#4a2a2a'">
            Cancel Operation
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(this.modal);

    // Add cancel button event listener
    document.getElementById('grok-cancel-button').addEventListener('click', () => {
      this.cancel();
    });
  },

  show(title, subtitle = '') {
    this.cancelled = false;
    this.create();
    this.modal.style.display = 'flex';
    document.getElementById('grok-progress-title').textContent = title;
    document.getElementById('grok-progress-subtitle').textContent = subtitle;
    document.getElementById('grok-progress-bar').style.width = '0%';
    document.getElementById('grok-progress-details').textContent = 'Starting...';

    // Reset cancel button state
    const cancelBtn = document.getElementById('grok-cancel-button');
    cancelBtn.style.display = 'block';
    cancelBtn.textContent = 'Cancel Operation';
    cancelBtn.disabled = false;
    cancelBtn.style.opacity = '1';
    cancelBtn.style.cursor = 'pointer';
  },

  update(progress, details) {
    if (!this.modal) return;
    const percentage = Math.min(100, Math.max(0, progress));
    document.getElementById('grok-progress-bar').style.width = `${percentage}%`;
    document.getElementById('grok-progress-details').textContent = details;
  },

  cancel() {
    this.cancelled = true;
    this.update(0, 'Cancelling operation...');
    document.getElementById('grok-cancel-button').textContent = 'Cancelling...';
    document.getElementById('grok-cancel-button').disabled = true;
    document.getElementById('grok-cancel-button').style.opacity = '0.5';
    document.getElementById('grok-cancel-button').style.cursor = 'not-allowed';
  },

  isCancelled() {
    return this.cancelled;
  },

  hide() {
    if (this.modal) {
      this.modal.style.display = 'none';
    }
    this.cancelled = false;
  },

  remove() {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
    this.cancelled = false;
  }
};

/**
 * Message listener for actions from popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action } = request;

  // Handle ping to check if content script is loaded
  if (action === 'ping') {
    sendResponse({ loaded: true });
    return true;
  }

  if (action === 'cancelOperation') {
    ProgressModal.cancel();
    chrome.storage.local.set({ activeOperation: false });
    sendResponse({ success: true });
    return;
  }

  (async () => {
    try {
      // Mark operation as active
      chrome.storage.local.set({ activeOperation: true });

      if (action === 'upscaleVideos') {
        await handleUpscale();
      } else if (action.startsWith('save')) {
        await handleSave(action);
      } else if (action === 'unsaveAll') {
        await handleUnsaveAll();
      }
    } catch (error) {
      console.error('Error handling action:', error);
      ProgressModal.hide();

      // Show refresh prompt for both errors and cancellations
      if (error.message.includes('cancelled')) {
        const shouldRefresh = confirm('Operation cancelled.\n\nClick OK to refresh the page.');
        if (shouldRefresh) {
          window.location.reload();
        }
      } else {
        const shouldRefresh = confirm(`Error: ${error.message}\n\nClick OK to refresh the page.`);
        if (shouldRefresh) {
          window.location.reload();
        }
      }
    } finally {
      // Mark operation as inactive
      chrome.storage.local.set({ activeOperation: false });
    }
  })();
});

/**
 * Determine a sensible filename for a URL. If the final path segment has an extension, use it.
 * If the final segment is a generic endpoint (e.g. "content"), look for a UUID segment earlier
 * in the path and use that as the base name. If nothing found, fall back to a timestamped name.
 * @param {string} url
 * @param {string|null} fallbackBase - optional base name to use if no UUID found
 * @param {boolean} isVideo
 * @returns {string} filename with extension
 */
function determineFilename(url, fallbackBase = null, isVideo = false) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments.length ? segments[segments.length - 1] : '';

    // Prefer a UUID-like segment anywhere in the path (common in these assets).
    // If found, use it as the base name and adopt the last segment's extension if present,
    // otherwise fall back to a sensible extension (.mp4/.png).
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      if (uuidRe.test(seg)) {
        // determine extension: prefer last segment's extension if any
        const lastExtMatch = (segments[segments.length - 1] || '').match(/(\.[a-zA-Z0-9]{1,5})$/);
        const ext = lastExtMatch ? lastExtMatch[1] : (isVideo ? '.mp4' : '.png');
        return `${seg}${ext}`;
      }
    }

    // If no UUID found, but last segment contains an extension, return it directly
    if (/\.[a-zA-Z0-9]{1,5}$/.test(last)) {
      return last;
    }

    // Use fallbackBase if provided
    if (fallbackBase) {
      const ext = isVideo ? '.mp4' : '.png';
      return `${fallbackBase}${ext}`;
    }

    // If last is not just 'content', use it (append extension)
    if (last && last.toLowerCase() !== 'content') {
      const ext = isVideo ? '.mp4' : '.png';
      return `${last}${ext}`;
    }

    // Last resort: timestamped filename
    const ext = isVideo ? '.mp4' : '.png';
    return `${isVideo ? 'video' : 'image'}_${Date.now()}${ext}`;
  } catch (e) {
    const ext = isVideo ? '.mp4' : '.png';
    return `${isVideo ? 'video' : 'image'}_${Date.now()}${ext}`;
  }
}

/**
 * Extracts post ID from image URL in masonry view
 * @param {string} imgSrc
 * @returns {string|null}
 */
function extractPostId(imgSrc) {
  try {
    const match = imgSrc.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return match ? match[1] : null;
  } catch (e) {
    return null;
  }
}

/**
 * Extracts the base filename without extension from a URL
 * @param {string} url - The image URL
 * @returns {string} Base filename without extension
 */
function extractBaseName(url) {
  const filename = url.substring(url.lastIndexOf('/') + 1);
  return filename.replace(/\.(png|jpg|jpeg)$/i, '');
}

/**
 * Checks if URL matches any of the valid patterns
 * @param {string} url - URL to validate
 * @param {string[]} patterns - Array of URL patterns to match
 * @returns {boolean}
 */
function isValidUrl(url, patterns) {
  return patterns.some(pattern => url.includes(pattern));
}

/**
 * Checks if a video URL exists using a HEAD request (lightweight)
 * @param {string} url - The video URL to check
 * @returns {Promise<boolean>}
 */
async function checkVideoExistsHTTP(url) {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      credentials: 'include'
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Checks if a video URL exists by creating a video element and testing load
 * @param {string} url - The video URL to check
 * @returns {Promise<boolean>}
 */
function checkVideoExists(url) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';

    const cleanup = () => {
      // Remove event listeners to prevent memory leaks
      video.onloadedmetadata = null;
      video.onerror = null;
      video.src = '';
      video.load(); // Force release of resources
      // Don't keep reference to video element
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve(false);
    }, 3000); // 3 second timeout

    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      cleanup();
      resolve(true);
    };

    video.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      resolve(false);
    };

    video.src = url;
  });
}

/**
 * Scrolls and collects all post IDs from the page
 * @param {Function} filterFn - Function to filter items (receives hasVideo, hasImage)
 * @returns {Promise<Array<string>>} Array of post IDs
 */
async function scrollAndCollectPostIds(filterFn) {
  console.log('Starting scroll to collect post IDs...');

  // Find the scrollable container
  let scrollContainer = document.documentElement;
  const possibleContainers = [
    document.querySelector('main'),
    document.querySelector('[role="main"]'),
    document.querySelector('.overflow-y-auto'),
    document.querySelector('.overflow-auto'),
    ...Array.from(document.querySelectorAll('div')).filter(el => {
      const style = window.getComputedStyle(el);
      return style.overflowY === 'auto' || style.overflowY === 'scroll';
    })
  ].filter(el => el !== null);

  if (possibleContainers.length > 0) {
    scrollContainer = possibleContainers.reduce((tallest, current) => {
      return current.scrollHeight > tallest.scrollHeight ? current : tallest;
    });
    console.log('Found custom scroll container:', scrollContainer);
  }

  // First, collect ALL item data while scrolling (don't filter yet)
  const allItemsData = new Map(); // Map of postId -> { hasVideo, hasImage }
  let unchangedItemCount = 0;
  let previousItemCount = 0;
  const maxUnchangedAttempts = 10; // More attempts for large collections with virtual scrolling

  // Scroll to top first to ensure we capture everything
  console.log('Scrolling to top before collection...');
  scrollContainer.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Get total scroll height for progress calculation
  let totalScrollHeight = scrollContainer.scrollHeight;
  console.log(`Initial scroll height: ${totalScrollHeight}`);

  // Get viewport height for relative scrolling
  const viewportHeight = window.innerHeight;
  const scrollIncrement = Math.floor(viewportHeight * 0.4); // Scroll by 40% of viewport
  console.log(`Viewport height: ${viewportHeight}px, Scroll increment: ${scrollIncrement}px`);

  // Track if we've reached the actual bottom
  let reachedBottom = false;
  let bottomReachCount = 0;
  const maxBottomAttempts = 5;

  while (!reachedBottom || unchangedItemCount < maxUnchangedAttempts) {
    // Check for cancellation
    if (ProgressModal.isCancelled()) {
      console.log('Collection cancelled by user');
      throw new Error('Operation cancelled by user');
    }

    // Collect ALL items and their metadata (video/image presence)
    const cards = document.querySelectorAll(SELECTORS.CARD);
    let videosInBatch = 0;
    let imagesInBatch = 0;

    cards.forEach((card) => {
      // Extract post ID from image (every post has an image)
      let postId = null;
      const img = card.querySelector(SELECTORS.IMAGE);
      if (img && img.src) {
        const match = img.src.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        if (match && match[1]) {
          postId = match[1];
        }
      }

      // Check if this post has a video by looking for video element with matching UUID
      let hasVideo = false;
      const video = card.querySelector(SELECTORS.VIDEO);
      if (video && video.src && postId) {
        const videoMatch = video.src.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        if (videoMatch && videoMatch[1] === postId) {
          hasVideo = true;
          videosInBatch++;
        }
      }

      const hasImage = !!img;

      if (hasImage) imagesInBatch++;

      // Store the item data - track if we've EVER seen a video for this post
      if (postId) {
        const existing = allItemsData.get(postId);
        if (existing) {
          // If we've seen this post before, keep video=true if either occurrence had a video
          allItemsData.set(postId, {
            hasVideo: existing.hasVideo || hasVideo,
            hasImage: existing.hasImage || hasImage
          });
          if (hasVideo && !existing.hasVideo) {
            console.log(`Post ${postId.substring(0, 8)}... NOW detected as having video`);
          }
        } else {
          allItemsData.set(postId, { hasVideo, hasImage });
        }
      }
    });

    const currentItemCount = allItemsData.size;
    const currentScrollTop = scrollContainer.scrollTop;
    const currentScrollHeight = scrollContainer.scrollHeight;
    const maxScrollTop = currentScrollHeight - scrollContainer.clientHeight;
    
    console.log(`Cards in DOM: ${cards.length}, Videos in view: ${videosInBatch}, Images in view: ${imagesInBatch}, Total collected: ${currentItemCount}, ScrollTop: ${currentScrollTop}/${maxScrollTop}`);

    // Log a sample of what we're detecting
    if (allItemsData.size <= 10) {
      console.log('Sample of detected items:', Array.from(allItemsData.entries()).slice(0, 5).map(([id, data]) => ({
        id: id.substring(0, 8) + '...',
        hasVideo: data.hasVideo,
        hasImage: data.hasImage
      })));
    }

    // Check if we found new items
    if (currentItemCount === previousItemCount) {
      unchangedItemCount++;
      console.log(`No new items found (${unchangedItemCount}/${maxUnchangedAttempts})`);
    } else {
      unchangedItemCount = 0;
      previousItemCount = currentItemCount;
      console.log(`Found new items! Total: ${currentItemCount}`);
    }

    // Check if we've reached the bottom of the scrollable area
    const isAtBottom = currentScrollTop >= maxScrollTop - 100; // 100px tolerance
    if (isAtBottom) {
      bottomReachCount++;
      console.log(`At bottom of scroll (${bottomReachCount}/${maxBottomAttempts})`);
      if (bottomReachCount >= maxBottomAttempts && unchangedItemCount >= 3) {
        reachedBottom = true;
        console.log('Confirmed at bottom - no more content to load');
      }
    } else {
      bottomReachCount = 0;
    }

    const scrollProgress = Math.min(80, (currentScrollTop / Math.max(1, maxScrollTop)) * 80);
    ProgressModal.update(scrollProgress, `Collecting items... Found ${currentItemCount} so far`);

    // If we've been at the bottom with no new content for a while, stop
    if (reachedBottom && unchangedItemCount >= maxUnchangedAttempts) {
      console.log('Stopping: reached bottom and no new items found');
      break;
    }

    // Scroll down
    const newScroll = currentScrollTop + scrollIncrement;
    scrollContainer.scrollTop = newScroll;
    console.log(`Scrolled from ${currentScrollTop} to ${scrollContainer.scrollTop}`);

    // Update total scroll height (it may grow as content loads)
    totalScrollHeight = currentScrollHeight;

    // Wait for content to load
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  // Now filter the collected items based on the filter function
  console.log('Filtering collected items...');
  const filteredPostIds = [];
  for (const [postId, { hasVideo, hasImage }] of allItemsData) {
    if (filterFn(hasVideo, hasImage)) {
      filteredPostIds.push(postId);
    }
  }

  console.log(`Total items collected: ${allItemsData.size}, After filtering: ${filteredPostIds.length}`);
  ProgressModal.update(85, `Filtered to ${filteredPostIds.length} items...`);

  // Scroll back to top
  console.log('Scrolling back to top');
  ProgressModal.update(90, 'Scrolling back to top...');
  scrollContainer.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 500));

  console.log(`Finished! Total post IDs collected: ${filteredPostIds.length}`);
  return filteredPostIds;
}

/**
 * Scrolls down the page to load all lazy-loaded content
 * @returns {Promise<void>}
 */
async function scrollToLoadAll() {
  console.log('Starting scroll to load all content...');

  ProgressModal.update(0, 'Finding scrollable container...');

  // Find the scrollable container
  let scrollContainer = document.documentElement;
  const possibleContainers = [
    document.querySelector('main'),
    document.querySelector('[role="main"]'),
    document.querySelector('.overflow-y-auto'),
    document.querySelector('.overflow-auto'),
    ...Array.from(document.querySelectorAll('div')).filter(el => {
      const style = window.getComputedStyle(el);
      return style.overflowY === 'auto' || style.overflowY === 'scroll';
    })
  ].filter(el => el !== null);

  if (possibleContainers.length > 0) {
    scrollContainer = possibleContainers.reduce((tallest, current) => {
      return current.scrollHeight > tallest.scrollHeight ? current : tallest;
    });
    console.log('Found custom scroll container:', scrollContainer);
  }

  let lastUniqueCount = 0;
  let unchangedCount = 0;
  const maxUnchangedAttempts = 10; // More attempts for large collections
  const seenCards = new Set();

  // Scroll to top first to ensure we capture everything
  console.log('Scrolling to top before loading...');
  scrollContainer.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 500));

  // Get viewport height for relative scrolling
  const viewportHeight = window.innerHeight;
  const scrollIncrement = Math.floor(viewportHeight * 0.4); // Scroll by 40% of viewport
  console.log(`Viewport height: ${viewportHeight}px, Scroll increment: ${scrollIncrement}px`);

  // Track if we've reached the actual bottom
  let reachedBottom = false;
  let bottomReachCount = 0;
  const maxBottomAttempts = 5;

  while (!reachedBottom || unchangedCount < maxUnchangedAttempts) {
    // Track unique cards (use image src as identifier to handle virtual scrolling)
    const cards = document.querySelectorAll(SELECTORS.CARD);
    cards.forEach(card => {
      const img = card.querySelector(SELECTORS.IMAGE);
      if (img && img.src) {
        seenCards.add(img.src);
      }
    });

    const totalUnique = seenCards.size;
    const currentScrollTop = scrollContainer.scrollTop;
    const currentScrollHeight = scrollContainer.scrollHeight;
    const maxScrollTop = currentScrollHeight - scrollContainer.clientHeight;
    
    console.log(`Cards in DOM: ${cards.length}, Total unique seen: ${totalUnique}, ScrollTop: ${currentScrollTop}/${maxScrollTop}`);

    // Check for cancellation
    if (ProgressModal.isCancelled()) {
      console.log('Scroll loading cancelled by user');
      throw new Error('Operation cancelled by user');
    }

    if (totalUnique === lastUniqueCount) {
      unchangedCount++;
      console.log(`No new unique items found (${unchangedCount}/${maxUnchangedAttempts})`);
    } else {
      unchangedCount = 0;
      lastUniqueCount = totalUnique;
      console.log(`New unique items found! Total: ${totalUnique}`);
    }

    // Check if we've reached the bottom of the scrollable area
    const isAtBottom = currentScrollTop >= maxScrollTop - 100; // 100px tolerance
    if (isAtBottom) {
      bottomReachCount++;
      console.log(`At bottom of scroll (${bottomReachCount}/${maxBottomAttempts})`);
      if (bottomReachCount >= maxBottomAttempts && unchangedCount >= 3) {
        reachedBottom = true;
        console.log('Confirmed at bottom - no more content to load');
      }
    } else {
      bottomReachCount = 0;
    }

    const scrollProgress = Math.min(80, (currentScrollTop / Math.max(1, maxScrollTop)) * 80);
    ProgressModal.update(scrollProgress, `Loading favorites... Found ${totalUnique} items so far`);

    // If we've been at the bottom with no new content for a while, stop
    if (reachedBottom && unchangedCount >= maxUnchangedAttempts) {
      console.log('Stopping: reached bottom and no new items found');
      break;
    }

    // Scroll down
    const newScroll = currentScrollTop + scrollIncrement;
    scrollContainer.scrollTop = newScroll;
    console.log(`Scrolled from ${currentScrollTop} to ${scrollContainer.scrollTop}`);

    // Wait for content to load
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  // Scroll back to top
  console.log('Scrolling back to top');
  ProgressModal.update(90, 'Scrolling back to top...');
  scrollContainer.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 500));

  const finalCount = seenCards.size;
  console.log(`Finished! Total unique items loaded: ${finalCount}`);
  ProgressModal.update(100, `Loaded ${finalCount} total items`);
}

/**
 * Scrolls and collects video IDs that need upscaling (no HD version exists)
 * @returns {Promise<Array<string>>} Array of video IDs to upscale
 */
async function scrollAndCollectVideosForUpscale() {
  console.log('Starting scroll to collect videos for upscaling...');

  // Find the scrollable container
  let scrollContainer = document.documentElement;
  const possibleContainers = [
    document.querySelector('main'),
    document.querySelector('[role="main"]'),
    document.querySelector('.overflow-y-auto'),
    document.querySelector('.overflow-auto'),
    ...Array.from(document.querySelectorAll('div')).filter(el => {
      const style = window.getComputedStyle(el);
      return style.overflowY === 'auto' || style.overflowY === 'scroll';
    })
  ].filter(el => el !== null);

  if (possibleContainers.length > 0) {
    scrollContainer = possibleContainers.reduce((tallest, current) => {
      return current.scrollHeight > tallest.scrollHeight ? current : tallest;
    });
    console.log('Found custom scroll container:', scrollContainer);
  }

  // First pass: collect all video URLs and IDs while scrolling
  const videoData = new Map(); // Map of videoId -> video URL
  const seenUrls = new Set();
  let unchangedVideoCount = 0;
  let previousVideoCount = 0;
  const maxUnchangedAttempts = 10; // More attempts for large collections with virtual scrolling

  // Scroll to top first to ensure we capture everything
  console.log('Scrolling to top before collection...');
  scrollContainer.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Get total scroll height for progress calculation
  let totalScrollHeight = scrollContainer.scrollHeight;
  console.log(`Initial scroll height: ${totalScrollHeight}`);

  const viewportHeight = window.innerHeight;
  const scrollIncrement = Math.floor(viewportHeight * 0.4); // Scroll by 40% of viewport
  console.log(`Viewport height: ${viewportHeight}px, Scroll increment: ${scrollIncrement}px`);

  // Track if we've reached the actual bottom
  let reachedBottom = false;
  let bottomReachCount = 0;
  const maxBottomAttempts = 5;

  while (!reachedBottom || unchangedVideoCount < maxUnchangedAttempts) {
    // Check for cancellation
    if (ProgressModal.isCancelled()) {
      console.log('Collection cancelled by user');
      throw new Error('Operation cancelled by user');
    }

    // Collect video URLs and IDs from currently visible cards (no async operations)
    const cards = document.querySelectorAll(SELECTORS.CARD);
    for (const card of cards) {
      const video = card.querySelector(SELECTORS.VIDEO);
      if (video && video.src) {
        const url = video.src.split('?')[0];
        // Only process standard (non-HD) video URLs
        if (!seenUrls.has(url) && url.includes('generated_video.mp4') && !url.includes('generated_video_hd.mp4')) {
          seenUrls.add(url);
          const videoId = extractVideoId(video.src);
          if (videoId) {
            videoData.set(videoId, url);
          }
        }
      }
    }

    const currentVideoCount = videoData.size;
    const currentScrollTop = scrollContainer.scrollTop;
    const currentScrollHeight = scrollContainer.scrollHeight;
    const maxScrollTop = currentScrollHeight - scrollContainer.clientHeight;
    
    console.log(`Cards in DOM: ${cards.length}, Videos found: ${currentVideoCount}, ScrollTop: ${currentScrollTop}/${maxScrollTop}`);

    // Check if we found new videos
    if (currentVideoCount === previousVideoCount) {
      unchangedVideoCount++;
      console.log(`No new videos found (${unchangedVideoCount}/${maxUnchangedAttempts})`);
    } else {
      unchangedVideoCount = 0;
      previousVideoCount = currentVideoCount;
      console.log(`Found new videos! Total: ${currentVideoCount}`);
    }

    // Check if we've reached the bottom of the scrollable area
    const isAtBottom = currentScrollTop >= maxScrollTop - 100; // 100px tolerance
    if (isAtBottom) {
      bottomReachCount++;
      console.log(`At bottom of scroll (${bottomReachCount}/${maxBottomAttempts})`);
      if (bottomReachCount >= maxBottomAttempts && unchangedVideoCount >= 3) {
        reachedBottom = true;
        console.log('Confirmed at bottom - no more content to load');
      }
    } else {
      bottomReachCount = 0;
    }

    const scrollProgress = Math.min(50, (currentScrollTop / Math.max(1, maxScrollTop)) * 50);
    ProgressModal.update(scrollProgress, `Collecting videos... Found ${currentVideoCount} so far`);

    // If we've been at the bottom with no new content for a while, stop
    if (reachedBottom && unchangedVideoCount >= maxUnchangedAttempts) {
      console.log('Stopping: reached bottom and no new videos found');
      break;
    }

    // Scroll down
    const newScroll = currentScrollTop + scrollIncrement;
    scrollContainer.scrollTop = newScroll;
    console.log(`Scrolled from ${currentScrollTop} to ${scrollContainer.scrollTop}`);

    // Update total scroll height (it may grow as content loads)
    totalScrollHeight = currentScrollHeight;

    // Wait for content to load
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  // Scroll back to top
  console.log('Scrolling back to top');
  scrollContainer.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 500));

  console.log(`Finished scrolling! Total videos found: ${videoData.size}`);
  ProgressModal.update(50, `Checking which videos need upscaling...`);

  // Second pass: check which videos need upscaling (async operations after scrolling)
  const videoIds = [];
  let checkedCount = 0;
  const totalVideos = videoData.size;

  for (const [videoId, videoUrl] of videoData) {
    // Check for cancellation
    if (ProgressModal.isCancelled()) {
      console.log('HD check cancelled by user');
      throw new Error('Operation cancelled by user');
    }

    // Check if HD version already exists using lightweight HEAD request
    const hdUrl = videoUrl.replace('generated_video.mp4', 'generated_video_hd.mp4');
    const hdExists = await checkVideoExistsHTTP(hdUrl);

    if (!hdExists) {
      videoIds.push(videoId);
      console.log(`Video ${videoId} needs upscaling`);
    } else {
      console.log(`HD already exists for video ${videoId}, skipping`);
    }

    checkedCount++;
    const checkProgress = 50 + ((checkedCount / totalVideos) * 50);
    ProgressModal.update(checkProgress, `Checked ${checkedCount}/${totalVideos} videos - ${videoIds.length} need upscaling`);
  }

  console.log(`Finished! Total videos to upscale: ${videoIds.length} out of ${totalVideos} total`);
  return videoIds;
}

/**
 * Scrolls down the page to load all lazy-loaded content and collects media
 * @param {string} type - Type of download (saveImages, saveVideos, saveBoth)
 * @returns {Promise<Array>} Array of media items
 */
async function scrollAndCollectMedia(type) {
  console.log('Starting scroll to load and collect all content...');

  // Check for cancellation at start
  if (ProgressModal.isCancelled()) {
    console.log('Scroll and collect cancelled by user');
    throw new Error('Operation cancelled by user');
  }

  // Find the scrollable container
  let scrollContainer = document.documentElement;
  const possibleContainers = [
    document.querySelector('main'),
    document.querySelector('[role="main"]'),
    document.querySelector('.overflow-y-auto'),
    document.querySelector('.overflow-auto'),
    ...Array.from(document.querySelectorAll('div')).filter(el => {
      const style = window.getComputedStyle(el);
      return style.overflowY === 'auto' || style.overflowY === 'scroll';
    })
  ].filter(el => el !== null);

  if (possibleContainers.length > 0) {
    scrollContainer = possibleContainers.reduce((tallest, current) => {
      return current.scrollHeight > tallest.scrollHeight ? current : tallest;
    });
    console.log('Found custom scroll container:', scrollContainer);
  }

  // First, collect ALL media data while scrolling (don't process yet)
  const allMediaData = new Map(); // Map of url -> { url, filename, isVideo, isHD }
  let unchangedMediaCount = 0;
  let previousMediaCount = 0;
  const maxUnchangedAttempts = 10; // More attempts for large collections with virtual scrolling

  // Scroll to top first to ensure we capture everything
  console.log('Scrolling to top before collection...');
  scrollContainer.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Get total scroll height and viewport for progress calculation
  let totalScrollHeight = scrollContainer.scrollHeight;
  console.log(`Initial scroll height: ${totalScrollHeight}`);

  // Get viewport height for relative scrolling
  const viewportHeight = window.innerHeight;
  // Use smaller scroll increments for better capture with virtual scrolling
  const scrollIncrement = Math.floor(viewportHeight * 0.4); // Scroll by 40% of viewport
  console.log(`Viewport height: ${viewportHeight}px, Scroll increment: ${scrollIncrement}px`);

  // Track if we've reached the actual bottom
  let reachedBottom = false;
  let bottomReachCount = 0;
  const maxBottomAttempts = 5;

  while (!reachedBottom || unchangedMediaCount < maxUnchangedAttempts) {
    // Check for cancellation
    if (ProgressModal.isCancelled()) {
      console.log('Scroll and collect cancelled by user');
      throw new Error('Operation cancelled by user');
    }

    // Collect ALL media from currently visible cards
    const cards = document.querySelectorAll(SELECTORS.CARD);

    for (const card of cards) {
      let imageName = null;

      // Extract image
      const img = card.querySelector(SELECTORS.IMAGE);
      if (img && img.src) {
        const url = img.src.split('?')[0].replace(/\/cdn-cgi\/image\/[^\/]*\//, '/');

        if (isValidUrl(url, URL_PATTERNS.IMAGE)) {
          const filename = determineFilename(url, null, false);
          imageName = extractBaseName(url);

          // Store image data
          if (!allMediaData.has(url)) {
            allMediaData.set(url, { url: url, filename, isVideo: false, isHD: false });
          }
        }
      }

      // Extract video
      const video = card.querySelector(SELECTORS.VIDEO);
      if (video && video.src) {
        const url = video.src.split('?')[0];

        if (!allMediaData.has(url)) {
          const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const filename = (imageName && uuidRe.test(imageName)) ? `${imageName}.mp4` : determineFilename(url, imageName || null, true);

          // Store video data
          allMediaData.set(url, { url: video.src, filename, isVideo: true, isHD: false });

          // Also track potential HD version URL
          if (url.includes('generated_video.mp4')) {
            const hdUrl = video.src.replace('generated_video.mp4', 'generated_video_hd.mp4');
            const hdFilename = filename.replace(/(\.[^.]+)$/, '-HD$1');

            if (!allMediaData.has(hdUrl)) {
              allMediaData.set(hdUrl, { url: hdUrl, filename: hdFilename, isVideo: true, isHD: true });
            }
          }
        }
      }
    }

    const currentMediaCount = allMediaData.size;
    const currentScrollTop = scrollContainer.scrollTop;
    const currentScrollHeight = scrollContainer.scrollHeight;
    const maxScrollTop = currentScrollHeight - scrollContainer.clientHeight;
    
    console.log(`Cards in DOM: ${cards.length}, Total media collected: ${currentMediaCount}, ScrollTop: ${currentScrollTop}/${maxScrollTop}`);

    // Check if we found new media
    if (currentMediaCount === previousMediaCount) {
      unchangedMediaCount++;
      console.log(`No new media found (${unchangedMediaCount}/${maxUnchangedAttempts})`);
    } else {
      unchangedMediaCount = 0;
      previousMediaCount = currentMediaCount;
      console.log(`Found ${currentMediaCount - previousMediaCount} new items! Total: ${currentMediaCount}`);
    }

    // Check if we've reached the bottom of the scrollable area
    const isAtBottom = currentScrollTop >= maxScrollTop - 100; // 100px tolerance
    if (isAtBottom) {
      bottomReachCount++;
      console.log(`At bottom of scroll (${bottomReachCount}/${maxBottomAttempts})`);
      if (bottomReachCount >= maxBottomAttempts && unchangedMediaCount >= 3) {
        reachedBottom = true;
        console.log('Confirmed at bottom - no more content to load');
      }
    } else {
      bottomReachCount = 0;
    }

    // Update progress based on scroll position and media count
    const scrollProgress = Math.min(60, (currentScrollTop / Math.max(1, maxScrollTop)) * 60);
    ProgressModal.update(scrollProgress, `Collecting media... Found ${currentMediaCount} items so far`);

    // If we've been at the bottom with no new content for a while, stop
    if (reachedBottom && unchangedMediaCount >= maxUnchangedAttempts) {
      console.log('Stopping: reached bottom and no new media found');
      break;
    }

    // Scroll down
    const newScroll = currentScrollTop + scrollIncrement;
    scrollContainer.scrollTop = newScroll;
    console.log(`Scrolled from ${currentScrollTop} to ${scrollContainer.scrollTop}`);

    // Update total scroll height (it may grow as content loads)
    totalScrollHeight = scrollContainer.scrollHeight;

    // Wait for content to load - longer wait to ensure virtual scroll updates
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  // Now filter and process the collected media based on type
  console.log('Processing collected media...');
  ProgressModal.update(70, 'Processing collected media...');

  const media = [];
  const hdVideosToCheck = []; // Collect HD videos to check separately

  for (const [url, data] of allMediaData) {
    // Handle HD videos separately - queue them for checking
    if (data.isHD && data.isVideo) {
      hdVideosToCheck.push({ url, data });
      continue;
    }

    // Filter based on type
    const shouldInclude =
      (type === 'saveImages' && !data.isVideo) ||
      (type === 'saveVideos' && data.isVideo) ||
      (type === 'saveBoth');

    if (shouldInclude) {
      media.push({ url: data.url, filename: data.filename });
    }
  }

  // Now check HD videos asynchronously (after main collection)
  console.log(`Checking ${hdVideosToCheck.length} HD videos...`);
  let hdCheckedCount = 0;

  for (const { url, data } of hdVideosToCheck) {
    // Check for cancellation
    if (ProgressModal.isCancelled()) {
      console.log('HD check cancelled by user');
      throw new Error('Operation cancelled by user');
    }

    const hdExists = await checkVideoExists(url);
    if (hdExists) {
      const shouldInclude =
        (type === 'saveVideos' || type === 'saveBoth');

      if (shouldInclude) {
        media.push({ url: data.url, filename: data.filename });
      }
    }

    hdCheckedCount++;
    const checkProgress = 70 + ((hdCheckedCount / hdVideosToCheck.length) * 15);
    ProgressModal.update(checkProgress, `Checked ${hdCheckedCount}/${hdVideosToCheck.length} HD videos...`);
  }

  console.log(`Total media collected: ${allMediaData.size}, After filtering: ${media.length}`);
  ProgressModal.update(85, `Filtered to ${media.length} items...`);

  // Scroll back to top
  console.log('Scrolling back to top');
  ProgressModal.update(90, 'Scrolling back to top...');
  scrollContainer.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 500));

  console.log(`Finished! Total media to download: ${media.length}`);
  return media;
}

/**
 * Collects media from currently loaded cards
 * @param {string} type - Type of download
 * @param {Array} media - Array to add media to
 * @param {Set} seen - Set of already seen URLs
 * @param {number} currentIndex - Current card index for progress
 * @param {number} totalCards - Total cards for progress
 */
async function collectMediaFromVisibleCards(type, media, seen, currentIndex = 0, totalCards = 0) {
  const cards = document.querySelectorAll(SELECTORS.CARD);

  for (const card of cards) {
    let imageName = null;

    // Extract image
    const img = card.querySelector(SELECTORS.IMAGE);
    if (img && img.src) {
      const url = img.src.split('?')[0].replace(/\/cdn-cgi\/image\/[^\/]*\//, '/');
      const filename = determineFilename(url, null, false);
      imageName = extractBaseName(url);

      if ((type === 'saveImages' || type === 'saveBoth') &&
        !seen.has(url) &&
        isValidUrl(url, URL_PATTERNS.IMAGE)) {
        seen.add(url);
        media.push({ url: img.src, filename });
      }
    }

    // Extract video
    if (type === 'saveVideos' || type === 'saveBoth' || shouldUpscale) {
      const video = card.querySelector(SELECTORS.VIDEO);
      if (video && video.src) {
        const url = video.src.split('?')[0];
        if (!seen.has(url)) {
          seen.add(url);

          const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          const filename = (imageName && uuidRe.test(imageName)) ? `${imageName}.mp4` : determineFilename(url, imageName || null, true);

          media.push({ url: video.src, filename });

          // Check for HD version
          if (url.includes('generated_video.mp4')) {
            const hdUrl = video.src.replace('generated_video.mp4', 'generated_video_hd.mp4');
            const hdFilename = filename.replace(/(\.[^.]+)$/, '-HD$1');

            if (!seen.has(hdUrl)) {
              const hdExists = await checkVideoExists(hdUrl);
              if (hdExists) {
                seen.add(hdUrl);
                media.push({ url: hdUrl, filename: hdFilename });
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Handles video upscaling without downloading
 */
async function handleUpscale() {
  console.log('Starting handleUpscale');

  // Check if we're on the favorites page
  const cards = document.querySelectorAll(SELECTORS.CARD);
  if (cards.length === 0) {
    throw new Error('No media cards found. Make sure you are on the favorites page.');
  }

  ProgressModal.show('Upscaling Videos', 'This may take several minutes...');

  // Scroll and collect videos to upscale
  const videosToUpscale = await scrollAndCollectVideosForUpscale();

  if (videosToUpscale.length === 0) {
    ProgressModal.hide();
    const shouldRefresh = confirm('No videos found that need upscaling.\n\nClick OK to refresh the page.');
    if (shouldRefresh) {
      window.location.reload();
    }
    return;
  }

  ProgressModal.update(10, `Found ${videosToUpscale.length} videos to upscale`);

  let successCount = 0;
  let skipCount = 0;
  const STAGGER_DELAY = 300; // 300ms delay between requests

  // Start all upscale requests with staggered delays
  const upscalePromises = [];
  for (let i = 0; i < videosToUpscale.length; i++) {
    // Check for cancellation before starting each request
    if (ProgressModal.isCancelled()) {
      console.log(`Upscale operation cancelled at video ${i + 1}`);
      ProgressModal.hide();
      const shouldRefresh = confirm(`Operation cancelled. ${successCount} of ${videosToUpscale.length} videos were requested for upscale.\n\nClick OK to refresh the page.`);
      if (shouldRefresh) {
        window.location.reload();
      }
      return;
    }

    const videoId = videosToUpscale[i];
    const videoIndex = i + 1;

    // Create a promise that delays, then makes the request
    const upscalePromise = (async () => {
      // Stagger the request
      await new Promise(resolve => setTimeout(resolve, i * STAGGER_DELAY));

      // Check for cancellation before making the request
      if (ProgressModal.isCancelled()) {
        return { success: false, cancelled: true };
      }

      const progress = 10 + ((videoIndex / videosToUpscale.length) * 90);
      ProgressModal.update(progress, `Requesting upscale ${videoIndex}/${videosToUpscale.length}...`);

      const upscaled = await upscaleVideo(videoId);
      if (upscaled) {
        successCount++;
        console.log(`Successfully requested upscale for video ${videoIndex}`);
        return { success: true, cancelled: false };
      } else {
        skipCount++;
        console.log(`Failed to upscale video ${videoIndex}`);
        return { success: false, cancelled: false };
      }
    })();

    upscalePromises.push(upscalePromise);
  }

  // Wait for all requests to complete
  await Promise.all(upscalePromises);

  // Final check for cancellation
  if (ProgressModal.isCancelled()) {
    ProgressModal.hide();
    const shouldRefresh = confirm(`Operation cancelled. ${successCount} of ${videosToUpscale.length} videos were requested for upscale.\n\nClick OK to refresh the page.`);
    if (shouldRefresh) {
      window.location.reload();
    }
    return;
  }

  ProgressModal.hide();
  const shouldRefresh = confirm(`Finished! Successfully requested upscale for ${successCount} videos${skipCount > 0 ? `, ${skipCount} failed` : ''}.\n\nUpscaling will complete in the background.\n\nClick OK to refresh the page now (required before next operation).`);
  chrome.storage.local.set({ activeOperation: false });
  if (shouldRefresh) {
    window.location.reload();
  }
}

/**
 * Handles media download requests
 * @param {string} type - Type of download (saveImages, saveVideos, saveBoth)
 */
async function handleSave(type) {
  console.log(`Starting handleSave with type: ${type}`);

  // Check if we're on the favorites page
  const cards = document.querySelectorAll(SELECTORS.CARD);
  if (cards.length === 0) {
    throw new Error('No media cards found. Make sure you are on the favorites page.');
  }

  // Show progress modal and scroll to collect all media
  ProgressModal.show('Collecting Favorites', 'Scrolling to load all items...');
  const media = await scrollAndCollectMedia(type);

  if (media.length === 0) {
    ProgressModal.hide();
    throw new Error('No media found matching the selected criteria.');
  }

  ProgressModal.update(100, `Found ${media.length} items to download`);

  // Hide modal and show refresh prompt BEFORE sending download message
  ProgressModal.hide();

  const shouldRefresh = confirm(`Ready to download ${media.length} items!\n\nDownloads will start after you close this dialog. Check extension popup for progress.\n\nClick OK to refresh the page now, or Cancel to stay (refresh required before next operation).`);

  // Send to background script for download
  chrome.runtime.sendMessage({
    action: 'startDownloads',
    media
  });

  if (shouldRefresh) {
    window.location.reload();
  }
}

/**
 * Handles unfavorite all operation
 */
async function handleUnsaveAll() {
  ProgressModal.show('Unfavoriting All Items', 'Collecting all media...');

  // Collect ALL media just like download does
  const allMedia = await scrollAndCollectMedia('saveBoth');

  console.log(`Collected ${allMedia.length} total media files`);

  // Extract unique post IDs from IMAGE URLs only (post ID = image UUID, not video UUID)
  // For older posts, videos have different UUIDs than their images
  // URL patterns:
  //   - https://assets.grok.com/users/{userId}/{postId}/content
  //   - https://assets.grok.com/users/{userId}/generated/{postId}/preview_image.jpg
  //   - https://imagine-public.x.ai/imagine-public/images/{postId}.png
  const postIdsSet = new Set();
  for (const item of allMedia) {
    // Only extract UUID from image URLs (skip videos)
    if (!item.url.includes('generated_video')) {
      let postId = null;

      // Try pattern 1 & 2: UUID before /content or /preview_image.jpg
      let match = item.url.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(content|preview_image\.jpg)/i);
      if (match && match[1]) {
        postId = match[1];
      } else {
        // Try pattern 3: UUID in /images/{uuid}.png
        match = item.url.match(/\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|jpg|jpeg)/i);
        if (match && match[1]) {
          postId = match[1];
        }
      }

      if (postId) {
        console.log(`Found image URL: ${item.url} -> Post ID: ${postId}`);
        postIdsSet.add(postId);
      } else {
        console.log(`Image URL but couldn't extract post ID: ${item.url}`);
      }
    }
  }

  const postIds = Array.from(postIdsSet);
  console.log(`Found ${postIds.length} unique posts to unfavorite:`, postIds);

  if (postIds.length === 0) {
    ProgressModal.hide();
    const shouldRefresh = confirm('No items found.\n\nClick OK to refresh the page.');
    if (shouldRefresh) {
      window.location.reload();
    }
    return;
  }

  const estimatedTime = Math.ceil(postIds.length * TIMING.UNFAVORITE_DELAY / 1000);
  ProgressModal.update(0, `Found ${postIds.length} items. Starting unfavorite process (${estimatedTime}s)...`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < postIds.length; i++) {
    // Check for cancellation
    if (ProgressModal.isCancelled()) {
      console.log(`Unfavorite operation cancelled at item ${i + 1}`);
      ProgressModal.hide();
      const shouldRefresh = confirm(`Operation cancelled. ${successCount} of ${postIds.length} items were unfavorited.\n\nClick OK to refresh the page.`);
      if (shouldRefresh) {
        window.location.reload();
      }
      return;
    }

    try {
      const success = await unlikePost(postIds[i]);
      if (success) {
        successCount++;
        console.log(`Unfavorited item ${i + 1} of ${postIds.length}`);
      } else {
        failCount++;
        console.warn(`Failed to unfavorite item ${i + 1}`);
      }

      const progress = ((i + 1) / postIds.length) * 100;
      ProgressModal.update(progress, `Unfavorited ${successCount} of ${postIds.length} items`);

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, TIMING.UNFAVORITE_DELAY));
    } catch (error) {
      failCount++;
      console.error(`Failed to unfavorite item ${i + 1}:`, error);
    }
  }

  ProgressModal.hide();
  const shouldRefresh = confirm(`Finished! Successfully unfavorited ${successCount} items${failCount > 0 ? `, ${failCount} failed` : ''}.\n\nClick OK to refresh the page now (required to see changes and before next operation).`);
  if (shouldRefresh) {
    window.location.reload();
  }
}

