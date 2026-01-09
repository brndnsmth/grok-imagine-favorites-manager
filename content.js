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
  IMAGE: ['imagine-public.x.ai', 'assets.grok.com', 'grok.com']
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
    const cancelBtn = document.getElementById('grok-cancel-button');
    if (cancelBtn) {
      cancelBtn.textContent = 'Cancelling...';
      cancelBtn.disabled = true;
      cancelBtn.style.opacity = '0.5';
    }

    // Ensure the modal is removed after a short delay
    setTimeout(() => {
      this.remove();
    }, 1000);
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
    const cleanLast = last.split('?')[0];

    // Prefer a UUID-like segment anywhere in the path (common in these assets).
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    let baseName = '';
    let ext = isVideo ? '.mp4' : '.png';

    // Search for UUID
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i].split('?')[0];
      if (uuidRe.test(seg)) {
        if (i === segments.length - 1) {
          // UUID is the last segment (e.g., imagine-public)
          baseName = seg;
          console.log(`[FILENAME] UUID found as last segment: ${baseName}`);
        } else {
          // UUID is a parent directory (e.g., assets.grok.com)
          // Combine UUID with last segment to ensure uniqueness
          const suffix = cleanLast.replace(/\.[a-zA-Z0-9]{1,5}$/, '');
          baseName = `${seg}_${suffix}`;
          console.log(`[FILENAME] UUID parent + suffix: ${baseName}`);
        }
        
        const lastExtMatch = cleanLast.match(/(\.[a-zA-Z0-9]{1,5})$/);
        ext = lastExtMatch ? lastExtMatch[1] : ext;
        const result = `${baseName}${ext}`;
        console.log(`[FILENAME] Final (UUID-based): ${result} for ${url}`);
        return result;
      }
    }

    // Fallback logic
    if (/\.[a-zA-Z0-9]{1,5}$/.test(cleanLast)) {
      console.log(`[FILENAME] No UUID, using last segment: ${cleanLast}`);
      return cleanLast;
    }

    if (fallbackBase) {
      const result = `${fallbackBase}${ext}`;
      console.log(`[FILENAME] Using fallbackBase: ${result}`);
      return result;
    }

    const lastResort = `${isVideo ? 'video' : 'image'}_${Date.now()}${ext}`;
    console.log(`[FILENAME] Last resort: ${lastResort}`);
    return lastResort;
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
  if (!imgSrc) return null;
  try {
    // Priority: Explicit generation/post paths
    const patterns = [
      /\/generated\/([0-9a-f-]{36})/i,
      /\/post\/([0-9a-f-]{36})/i,
      /\/users\/[0-9a-f-]{36}\/([0-9a-f-]{36})/i
    ];

    for (const pattern of patterns) {
      const match = imgSrc.match(pattern);
      if (match && match[1]) return match[1].toLowerCase();
    }

    // Fallback: Last UUID in path
    const uuids = imgSrc.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi);
    return uuids ? uuids[uuids.length - 1].toLowerCase() : null;
  } catch (e) {
    return null;
  }
}

/**
 * Robustly extracts Post ID (UUID) from a media card element.
 * Prioritizes links (<a>) and then image sources.
 * @param {HTMLElement} element - The card or list item element
 * @returns {string|null} The UUID if found, otherwise null
 */
function extractPostIdFromElement(element) {
  try {
    // 1. Check direct links within the card (highest priority)
    const links = element.querySelectorAll('a[href*="/post/"], a[href*="/status/"]');
    for (const link of links) {
      const match = link.href.match(/\/(?:post|status)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if (match) return match[1].toLowerCase();
    }

    // 2. Fallback to image source
    const img = element.querySelector(SELECTORS.IMAGE);
    if (img && img.src) {
      const id = extractPostId(img.src);
      if (id) return id.toLowerCase();
    }

    // 3. Fallback to any UUID in the text or attributes
    const listItem = element.closest(SELECTORS.LIST_ITEM) || element;
    const text = listItem.innerText || "";
    const uuidMatch = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidMatch) return uuidMatch[0].toLowerCase();

    return null;
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
 * Generates a unique filename using Post ID and URL hash if necessary.
 * @param {string} url - The media URL
 * @param {string|null} postId - The extracted Post ID
 * @param {boolean} isVideo - Whether the media is a video
 * @returns {string} A unique filename
 */
function generateUniqueFilename(url, postId, isVideo) {
  const ext = isVideo ? '.mp4' : '.jpg';
  
  if (postId) {
    return `${postId}${ext}`;
  }
  
  // If no Post ID, use a hash of the URL to ensure stability across scrolls
  const urlWithoutParams = url.split('?')[0];
  const hash = simpleHash(urlWithoutParams);
  const base = extractBaseName(urlWithoutParams) || 'media';
  
  return `${base}_${hash}${ext}`;
}

/**
 * A simple string hashing function (DJB2) for stable filenames
 */
function simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Checks if URL matches any of the valid patterns
 * @param {string} url - URL to validate
 * @param {string[]} patterns - Array of URL patterns to match
 * @returns {boolean}
 */
function isValidUrl(url, patterns) {
  if (!url || typeof url !== 'string') return false;
  // Exclude obviously wrong files like XML
  if (url.toLowerCase().endsWith('.xml') || url.includes('Error')) return false;
  
  const hasValidPattern = patterns.some(pattern => url.includes(pattern));
  const hasValidExt = /\.(jpg|jpeg|png|webp|mp4|webm)$/i.test(url.split('?')[0]);
  const isImaginePublic = url.includes('imagine-public.x.ai/imagine-public/images/');
  
  return hasValidPattern && (hasValidExt || isImaginePublic);
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
  let unchangedScrollCount = 0;
  const maxUnchangedScrollAttempts = 3; // If scroll height doesn't change 3 times, we're at the bottom

  // Scroll to top first to ensure we capture everything
  console.log('Scrolling to top before collection...');
  scrollContainer.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Initialize previousScrollHeight AFTER scrolling to top and waiting
  let previousScrollHeight = scrollContainer.scrollHeight;
  console.log(`Initial scroll height: ${previousScrollHeight}`);

  // Get viewport height for relative scrolling
  const viewportHeight = window.innerHeight;
  const scrollIncrement = Math.floor(viewportHeight / 2); // Scroll by HALF viewport to avoid skipping items
  console.log(`Viewport height: ${viewportHeight}px, Scroll increment: ${scrollIncrement}px`);

  while (unchangedScrollCount < maxUnchangedScrollAttempts) {
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

    const currentScrollHeight = scrollContainer.scrollHeight;
    console.log(`Current cards: ${cards.length}, Videos in view: ${videosInBatch}, Images in view: ${imagesInBatch}, Total collected: ${allItemsData.size}, ScrollHeight: ${currentScrollHeight}`);

    // Log a sample of what we're detecting
    if (allItemsData.size <= 10) {
      console.log('Sample of detected items:', Array.from(allItemsData.entries()).slice(0, 5).map(([id, data]) => ({
        id: id.substring(0, 8) + '...',
        hasVideo: data.hasVideo,
        hasImage: data.hasImage
      })));
    }

    // Check if scroll height has changed (means more content loaded)
    if (currentScrollHeight === previousScrollHeight) {
      unchangedScrollCount++;
      console.log(`Scroll height unchanged (${unchangedScrollCount}/${maxUnchangedScrollAttempts})`);
    } else {
      unchangedScrollCount = 0;
      previousScrollHeight = currentScrollHeight;
      console.log(`Scroll height increased, continuing...`);
    }

    const scrollProgress = Math.min(80, (scrollContainer.scrollTop / currentScrollHeight) * 80);
    ProgressModal.update(scrollProgress, `Collecting items... Found ${allItemsData.size} so far`);

    // Scroll down by HALF viewport height to avoid skipping items in virtual scroll
    const currentScroll = scrollContainer.scrollTop;
    const newScroll = currentScroll + scrollIncrement;
    scrollContainer.scrollTop = newScroll;
    console.log(`Scrolled from ${currentScroll} to ${scrollContainer.scrollTop}`);

    // Wait for content to load
    await new Promise(resolve => setTimeout(resolve, 2000));
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
  const maxUnchangedAttempts = 5;
  const seenCards = new Set();

  // Scroll to top first to ensure we capture everything
  console.log('Scrolling to top before loading...');
  scrollContainer.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 500));

  // Get viewport height for relative scrolling
  const viewportHeight = window.innerHeight;
  const scrollIncrement = Math.floor(viewportHeight / 2); // Scroll by HALF viewport to avoid skipping items
  console.log(`Viewport height: ${viewportHeight}px, Scroll increment: ${scrollIncrement}px`);

  while (unchangedCount < maxUnchangedAttempts) {
    // Track unique cards (use image src as identifier to handle virtual scrolling)
    const cards = document.querySelectorAll(SELECTORS.CARD);
    cards.forEach(card => {
      const img = card.querySelector(SELECTORS.IMAGE);
      if (img && img.src) {
        seenCards.add(img.src);
      }
    });

    const currentCardCount = cards.length;
    const totalUnique = seenCards.size;
    console.log(`Current cards in DOM: ${currentCardCount}, Total unique seen: ${totalUnique}, Last unique: ${lastUniqueCount}`);

    // Check for cancellation
    if (ProgressModal.isCancelled()) {
      console.log('Scroll loading cancelled by user');
      throw new Error('Operation cancelled by user');
    }

    const scrollProgress = Math.min(80, (unchangedCount / maxUnchangedAttempts) * 80);
    ProgressModal.update(scrollProgress, `Loading favorites... Found ${totalUnique} items so far`);

    if (totalUnique === lastUniqueCount) {
      unchangedCount++;
      console.log(`No new unique items found (${unchangedCount}/${maxUnchangedAttempts})`);
    } else {
      unchangedCount = 0;
      lastUniqueCount = totalUnique;
      console.log(`New unique items found! Total: ${totalUnique}`);
    }

    // Scroll down by HALF viewport height to avoid skipping items in virtual scroll
    const currentScroll = scrollContainer.scrollTop;
    const newScroll = currentScroll + scrollIncrement;
    scrollContainer.scrollTop = newScroll;
    console.log(`Scrolled from ${currentScroll} to ${scrollContainer.scrollTop}`);

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
  let unchangedScrollCount = 0;
  const maxUnchangedScrollAttempts = 3; // If scroll height doesn't change 3 times, we're at the bottom

  // Scroll to top first to ensure we capture everything
  console.log('Scrolling to top before collection...');
  scrollContainer.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Initialize previousScrollHeight AFTER scrolling to top and waiting
  let previousScrollHeight = scrollContainer.scrollHeight;
  console.log(`Initial scroll height: ${previousScrollHeight}`);

  const viewportHeight = window.innerHeight;
  const scrollIncrement = Math.floor(viewportHeight / 2); // Scroll by HALF viewport to avoid skipping items
  console.log(`Viewport height: ${viewportHeight}px, Scroll increment: ${scrollIncrement}px`);

  while (unchangedScrollCount < maxUnchangedScrollAttempts) {
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

    const currentCardCount = cards.length;
    const currentUniqueCount = videoData.size;
    const currentScrollHeight = scrollContainer.scrollHeight;
    console.log(`Current cards: ${currentCardCount}, Videos found: ${currentUniqueCount}, ScrollHeight: ${currentScrollHeight}`);

    // Check if scroll height has changed (means more content loaded)
    if (currentScrollHeight === previousScrollHeight) {
      unchangedScrollCount++;
      console.log(`Scroll height unchanged (${unchangedScrollCount}/${maxUnchangedScrollAttempts})`);
    } else {
      unchangedScrollCount = 0;
      previousScrollHeight = currentScrollHeight;
      console.log(`Scroll height increased, continuing...`);
    }

    const scrollProgress = Math.min(50, (scrollContainer.scrollTop / currentScrollHeight) * 50);
    ProgressModal.update(scrollProgress, `Collecting videos... Found ${currentUniqueCount} so far`);

    // Scroll down by HALF viewport height to avoid skipping items in virtual scroll
    const currentScroll = scrollContainer.scrollTop;
    const newScroll = currentScroll + scrollIncrement;
    scrollContainer.scrollTop = newScroll;
    console.log(`Scrolled from ${currentScroll} to ${scrollContainer.scrollTop}`);

    // Wait for content to load - increased for better reliability
    await new Promise(resolve => setTimeout(resolve, 2000));
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
  let unchangedScrollCount = 0;
  const maxUnchangedScrollAttempts = 3; // If scroll height doesn't change 3 times, we're at the bottom

  // Scroll to top first to ensure we capture everything
  console.log('Scrolling to top before collection...');
  scrollContainer.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Initialize previousScrollHeight AFTER scrolling to top and waiting
  let previousScrollHeight = scrollContainer.scrollHeight;
  console.log(`Initial scroll height: ${previousScrollHeight}`);

  // Get viewport height for relative scrolling
  const viewportHeight = window.innerHeight;
  const scrollIncrement = Math.floor(viewportHeight / 2); // Scroll by HALF viewport to avoid skipping items
  console.log(`Viewport height: ${viewportHeight}px, Scroll increment: ${scrollIncrement}px`);

  while (unchangedScrollCount < maxUnchangedScrollAttempts) {
    // Check for cancellation
    if (ProgressModal.isCancelled()) {
      console.log('Scroll and collect cancelled by user');
      throw new Error('Operation cancelled by user');
    }

    // Collect ALL media from currently visible cards
    const cards = document.querySelectorAll(SELECTORS.CARD);

    for (const card of cards) {
      const postId = extractPostIdFromElement(card);
      
      // 1. Process Video (Do this first to identify video-only/video-dominant cards)
      let hasVideoInCard = false;
      let videoId = null;
      // 1. Process Video
      if (type === 'saveVideos' || type === 'saveBoth') {
        const video = card.querySelector(SELECTORS.VIDEO);
        const hasVideo = !!(video && video.src);
        if (hasVideo) {
          hasVideoInCard = true;
          const videoUrl = video.src;
          videoId = extractVideoId(videoUrl);
          
          console.log(`[DEBUG] Video found in card:`, {
            videoId,
            videoUrl,
            cardPostId: postId
          });

          if (isValidUrl(videoUrl, [])) { // Video matches assets.grok.com via isValidUrl inner logic
            if (!allMediaData.has(videoUrl)) {
              const filename = generateUniqueFilename(videoUrl, postId || videoId, true);
              allMediaData.set(videoUrl, { url: videoUrl, filename, isVideo: true });
              console.log(`[DEBUG] Collected video: ${videoUrl}`);
            }
          }
        }
      }

      // 2. Process Image
      if (type === 'saveImages' || type === 'saveBoth') {
        const img = card.querySelector(SELECTORS.IMAGE);
        console.log(`[DEBUG] Image element search:`, img ? 'Found' : 'Not Found');
        
        if (img && img.src) {
          const originalUrl = img.src.split('?')[0].replace(/\/cdn-cgi\/image\/[^\/]*\//, '/');
          const assetIdFromImg = extractPostId(originalUrl);
          
          console.log(`[DEBUG] Image processing:`, {
            originalUrl,
            assetIdFromImg,
            cardPostId: postId,
            hasVideoInCard,
            videoId
          });
          
          let imageUrl = originalUrl;
          const isPreview = originalUrl.includes('preview_image') || originalUrl.includes('thumbnail');
          
          // CRITICAL DECISION LOGIC
          if (assetIdFromImg) {
            // Determine which ID to use for the HQ bucket
            // In mixed media, often the image assetId is what's valid at imagine-public
            const hqUrl = `https://imagine-public.x.ai/imagine-public/images/${assetIdFromImg}.jpg?cache=1&dl=1`;
            
            if (hasVideoInCard && isPreview) {
               console.log(`[DEBUG] Skipping suspected video thumbnail: ${originalUrl}`);
               imageUrl = null;
            } else {
               imageUrl = hqUrl;
               console.log(`[DEBUG] Target set to High-Quality Image: ${imageUrl}`);
            }
          } else {
            console.log(`[DEBUG] No UUID in image src. Found image is likely UI/preview only: ${originalUrl}`);
            imageUrl = null;
          }

          if (imageUrl && isValidUrl(imageUrl, URL_PATTERNS.IMAGE)) {
            if (!allMediaData.has(imageUrl)) {
              // Use Asset ID or Post ID for filename
              const filename = generateUniqueFilename(imageUrl, assetIdFromImg || postId, false);
              allMediaData.set(imageUrl, { url: imageUrl, filename, isVideo: false });
              console.log(`[DEBUG] Successfully collected image for download: ${imageUrl}`);
            } else {
              console.log(`[DEBUG] Image URL already in collection: ${imageUrl}`);
            }
          } else if (imageUrl) {
            console.log(`[DEBUG] Image URL rejected by isValidUrl: ${imageUrl}`);
          }
        }
      }
    }

    const currentScrollHeight = scrollContainer.scrollHeight;
    console.log(`Current cards: ${cards.length}, Total media collected: ${allMediaData.size}, ScrollHeight: ${currentScrollHeight}`);

    // Check if scroll height has changed (means more content loaded)
    if (currentScrollHeight === previousScrollHeight) {
      unchangedScrollCount++;
      console.log(`Scroll height unchanged (${unchangedScrollCount}/${maxUnchangedScrollAttempts})`);
    } else {
      unchangedScrollCount = 0;
      previousScrollHeight = currentScrollHeight;
      console.log(`Scroll height increased, continuing...`);
    }

    const scrollProgress = Math.min(60, (scrollContainer.scrollTop / currentScrollHeight) * 60);
    ProgressModal.update(scrollProgress, `Collecting media... Found ${allMediaData.size} items so far`);

    // Scroll down by HALF viewport height to avoid skipping items in virtual scroll
    const currentScroll = scrollContainer.scrollTop;
    const newScroll = currentScroll + scrollIncrement;
    scrollContainer.scrollTop = newScroll;
    console.log(`Scrolled from ${currentScroll} to ${scrollContainer.scrollTop}`);

    // Wait for content to load
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Now process the collected media
  console.log('Processing collected media...');
  ProgressModal.update(70, 'Processing collected media...');

  // No need to check HD videos separate from collection

  // Final Step: Prepare uniquely named media array
  const media = [];
  const usedFilenames = new Map(); // filename -> count

  for (const [url, data] of allMediaData) {
    let finalFilename = data.filename;
    
    if (usedFilenames.has(finalFilename)) {
      const count = usedFilenames.get(finalFilename) + 1;
      usedFilenames.set(finalFilename, count);
      
      const extIdx = finalFilename.lastIndexOf('.'); // Find last dot
      const base = finalFilename.substring(0, extIdx);
      const ext = finalFilename.substring(extIdx);
      finalFilename = `${base}_${count}${ext}`;
    } else {
      usedFilenames.set(finalFilename, 1);
    }

    media.push({ url, filename: finalFilename });
  }

  ProgressModal.update(85, `Ready to download ${media.length} items`);

  // Scroll back to top
  console.log('Scrolling back to top');
  ProgressModal.update(90, 'Scrolling back to top...');
  scrollContainer.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 500));

  console.log(`Finished! Total media to download: ${media.length}`);
  return media;
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

  try {
    // Check if we're on the favorites page
    const cards = document.querySelectorAll(SELECTORS.CARD);
    if (cards.length === 0) {
      throw new Error('No media cards found. Make sure you are on the favorites page.');
    }

    // Show progress modal and scroll to collect all media
    ProgressModal.show('Collecting Favorites', 'Scrolling to load all items...');
    const media = await scrollAndCollectMedia(type);

    if (media.length === 0) {
      throw new Error('No media found matching the selected criteria.');
    }

    ProgressModal.update(100, `Found ${media.length} items to download`);

    // Send to background script for download
    chrome.runtime.sendMessage({
      action: 'startDownloads',
      media
    });
  } catch (error) {
    if (error.message !== 'Operation cancelled by user') {
      alert(`Error: ${error.message}`);
    }
    console.error('handleSave error:', error);
  } finally {
    // Ensure the modal is removed after starting or failing
    setTimeout(() => {
      ProgressModal.remove();
    }, 2000);
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

