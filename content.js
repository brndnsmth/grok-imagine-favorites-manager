/**
 * Grok Imagine Favorites Manager - Content Script
 * Handles media extraction and unfavorite operations on grok.com
 */

// Constants
const SELECTORS = {
  CARD: '[role="listitem"] .relative.group\\/media-post-masonry-card',
  IMAGE: 'img[alt*="Generated"]',
  VIDEO: 'video[src*="generated_video"]',
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
      } else if (action.startsWith('unsave')) {
        handleUnsave(action);
      }
    } catch (error) {
      console.error('Error handling action:', error);
      ProgressModal.hide();
      
      // Only show alert if not cancelled
      if (!error.message.includes('cancelled')) {
        alert(`Error: ${error.message}`);
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
 * Checks if a video URL exists by creating a video element and testing load
 * @param {string} url - The video URL to check
 * @returns {Promise<boolean>}
 */
function checkVideoExists(url) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    
    const timeout = setTimeout(() => {
      video.src = '';
      resolve(false);
    }, 3000); // 3 second timeout
    
    video.onloadedmetadata = () => {
      clearTimeout(timeout);
      video.src = '';
      resolve(true);
    };
    
    video.onerror = () => {
      clearTimeout(timeout);
      video.src = '';
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
  
  const seenPostIds = new Set();
  let lastCardCount = 0;
  let unchangedCount = 0;
  const maxUnchangedAttempts = 5;
  
  // Get viewport height for relative scrolling
  const viewportHeight = window.innerHeight;
  console.log(`Viewport height: ${viewportHeight}px`);
  
  while (unchangedCount < maxUnchangedAttempts) {
    // Check for cancellation
    if (ProgressModal.isCancelled()) {
      console.log('Collection cancelled by user');
      throw new Error('Operation cancelled by user');
    }
    
    // Collect post IDs from currently visible items
    const items = document.querySelectorAll(SELECTORS.LIST_ITEM);
    items.forEach((item) => {
      const hasVideo = item.querySelector(SELECTORS.VIDEO);
      const hasImage = item.querySelector(SELECTORS.IMAGE);
      
      // Apply filter function
      if (filterFn(hasVideo, hasImage)) {
        let postId = null;
        
        // The post ID is always from the image URL, not the video URL
        // The video ID is just for the generated video asset
        const img = item.querySelector(SELECTORS.IMAGE);
        if (img && img.src) {
          // Try to extract UUID from different URL patterns:
          // Pattern 1: https://imagine-public.x.ai/imagine-public/images/{uuid}.png
          // Pattern 2: https://assets.grok.com/users/.../{uuid}/content
          const match = img.src.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
          if (match && match[1]) {
            postId = match[1];
          }
        }
        
        if (postId) {
          seenPostIds.add(postId);
        }
      }
    });
    
    const currentCardCount = items.length;
    console.log(`Current cards: ${currentCardCount}, Collected IDs: ${seenPostIds.size}, Last: ${lastCardCount}`);
    
    const scrollProgress = Math.min(80, (unchangedCount / maxUnchangedAttempts) * 80);
    ProgressModal.update(scrollProgress, `Collecting items... Found ${seenPostIds.size} so far`);
    
    if (currentCardCount === lastCardCount) {
      unchangedCount++;
      console.log(`No new cards loaded (${unchangedCount}/${maxUnchangedAttempts})`);
    } else {
      unchangedCount = 0;
      lastCardCount = currentCardCount;
      console.log(`New cards found! Total collected: ${seenPostIds.size}`);
    }
    
    // Scroll down by viewport height
    const currentScroll = scrollContainer.scrollTop;
    const newScroll = currentScroll + viewportHeight;
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
  
  const postIds = Array.from(seenPostIds);
  console.log(`Finished! Total post IDs collected: ${postIds.length}`);
  return postIds;
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
  
  let lastCardCount = 0;
  let unchangedCount = 0;
  const maxUnchangedAttempts = 5;
  const seenCards = new Set();
  
  // Get viewport height for relative scrolling
  const viewportHeight = window.innerHeight;
  console.log(`Viewport height: ${viewportHeight}px`);
  
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
    console.log(`Current cards in DOM: ${currentCardCount}, Total unique seen: ${totalUnique}, Last: ${lastCardCount}`);
    
    // Check for cancellation
    if (ProgressModal.isCancelled()) {
      console.log('Scroll loading cancelled by user');
      throw new Error('Operation cancelled by user');
    }
    
    const scrollProgress = Math.min(80, (unchangedCount / maxUnchangedAttempts) * 80);
    ProgressModal.update(scrollProgress, `Loading favorites... Found ${totalUnique} items so far`);
    
    if (currentCardCount === lastCardCount) {
      unchangedCount++;
      console.log(`No new cards loaded (${unchangedCount}/${maxUnchangedAttempts})`);
    } else {
      unchangedCount = 0;
      lastCardCount = currentCardCount;
      console.log(`New cards found! Total unique: ${totalUnique}`);
    }
    
    // Scroll down by viewport height
    const currentScroll = scrollContainer.scrollTop;
    const newScroll = currentScroll + viewportHeight;
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
  
  const videoIds = [];
  const seen = new Set();
  let lastCardCount = 0;
  let unchangedCount = 0;
  const maxUnchangedAttempts = 5;
  
  const viewportHeight = window.innerHeight;
  console.log(`Viewport height: ${viewportHeight}px`);
  
  while (unchangedCount < maxUnchangedAttempts) {
    // Check for cancellation
    if (ProgressModal.isCancelled()) {
      console.log('Collection cancelled by user');
      throw new Error('Operation cancelled by user');
    }
    
    // Collect video IDs from currently visible cards
    const cards = document.querySelectorAll(SELECTORS.CARD);
    for (const card of cards) {
      const video = card.querySelector(SELECTORS.VIDEO);
      if (video && video.src) {
        const url = video.src.split('?')[0];
        if (!seen.has(url) && url.includes('generated_video.mp4')) {
          seen.add(url);
          
          // Check if HD version already exists
          const hdUrl = video.src.replace('generated_video.mp4', 'generated_video_hd.mp4');
          const hdExists = await checkVideoExists(hdUrl);
          
          if (!hdExists) {
            const videoId = extractVideoId(video.src);
            if (videoId) {
              videoIds.push(videoId);
            }
          }
        }
      }
    }
    
    const currentCardCount = cards.length;
    console.log(`Current cards: ${currentCardCount}, Videos to upscale: ${videoIds.length}, Last: ${lastCardCount}`);
    
    const scrollProgress = Math.min(10, (unchangedCount / maxUnchangedAttempts) * 10);
    ProgressModal.update(scrollProgress, `Collecting videos... Found ${videoIds.length} to upscale`);
    
    if (currentCardCount === lastCardCount) {
      unchangedCount++;
      console.log(`No new cards loaded (${unchangedCount}/${maxUnchangedAttempts})`);
    } else {
      unchangedCount = 0;
      lastCardCount = currentCardCount;
      console.log(`New cards found! Videos to upscale: ${videoIds.length}`);
    }
    
    // Scroll down by viewport height
    const currentScroll = scrollContainer.scrollTop;
    const newScroll = currentScroll + viewportHeight;
    scrollContainer.scrollTop = newScroll;
    console.log(`Scrolled from ${currentScroll} to ${scrollContainer.scrollTop}`);
    
    // Wait for content to load
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  
  // Scroll back to top
  console.log('Scrolling back to top');
  scrollContainer.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log(`Finished! Total videos to upscale: ${videoIds.length}`);
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
  
  const media = [];
  const seen = new Set();
  let lastCardCount = 0;
  let unchangedCount = 0;
  const maxUnchangedAttempts = 5;
  
  // Get viewport height for relative scrolling
  const viewportHeight = window.innerHeight;
  console.log(`Viewport height: ${viewportHeight}px`);
  
  while (unchangedCount < maxUnchangedAttempts) {
    // Check for cancellation
    if (ProgressModal.isCancelled()) {
      console.log('Scroll and collect cancelled by user');
      throw new Error('Operation cancelled by user');
    }
    
    // Collect media from currently visible cards
    const currentCardCount = document.querySelectorAll(SELECTORS.CARD).length;
    await collectMediaFromVisibleCards(type, media, seen, media.length, currentCardCount);
    
    console.log(`Current cards: ${currentCardCount}, Collected media: ${media.length}, Last: ${lastCardCount}`);
    
    // Update progress with collected media count (more accurate than card count)
    const scrollProgress = Math.min(80, (unchangedCount / maxUnchangedAttempts) * 80);
    ProgressModal.update(scrollProgress, `Collecting media... Found ${media.length} items so far`);
    
    if (currentCardCount === lastCardCount) {
      unchangedCount++;
      console.log(`No new cards loaded (${unchangedCount}/${maxUnchangedAttempts})`);
    } else {
      unchangedCount = 0;
      lastCardCount = currentCardCount;
      console.log(`New cards found! Collected: ${media.length}`);
    }
    
    // Scroll down by viewport height
    const currentScroll = scrollContainer.scrollTop;
    const newScroll = currentScroll + viewportHeight;
    scrollContainer.scrollTop = newScroll;
    console.log(`Scrolled from ${currentScroll} to ${scrollContainer.scrollTop}`);
    
    // Wait for content to load
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  
  // Check for cancellation before final collection
  if (ProgressModal.isCancelled()) {
    console.log('Scroll and collect cancelled by user');
    throw new Error('Operation cancelled by user');
  }
  
  // One final collection pass
  const finalCardCount = document.querySelectorAll(SELECTORS.CARD).length;
  await collectMediaFromVisibleCards(type, media, seen, media.length, finalCardCount);
  
  // Scroll back to top
  console.log('Scrolling back to top');
  scrollContainer.scrollTop = 0;
  await new Promise(resolve => setTimeout(resolve, 500));
  
  console.log(`Finished! Total media collected: ${media.length}`);
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
      const url = img.src.split('?')[0];
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
    alert('No videos found that need upscaling.');
    return;
  }
  
  ProgressModal.update(10, `Found ${videosToUpscale.length} videos to upscale`);
  
  let successCount = 0;
  let skipCount = 0;
  
  for (let i = 0; i < videosToUpscale.length; i++) {
    // Check for cancellation
    if (ProgressModal.isCancelled()) {
      console.log(`Upscale operation cancelled at video ${i + 1}`);
      ProgressModal.hide();
      alert(`Operation cancelled. ${successCount} of ${videosToUpscale.length} videos were upscaled.`);
      return;
    }
    
    const videoId = videosToUpscale[i];
    const progress = 10 + ((i / videosToUpscale.length) * 90);
    ProgressModal.update(progress, `Upscaling video ${i + 1}/${videosToUpscale.length}... (may take ~30s)`);
    
    const upscaled = await upscaleVideo(videoId);
    if (upscaled) {
      successCount++;
      console.log(`Successfully upscaled video ${i + 1}`);
      // Wait for upscale to complete
      await new Promise(resolve => setTimeout(resolve, TIMING.UPSCALE_TIMEOUT));
    } else {
      skipCount++;
      console.log(`Skipped video ${i + 1}`);
    }
  }
  
  ProgressModal.hide();
  alert(`Finished! Successfully upscaled ${successCount} videos${skipCount > 0 ? `, ${skipCount} skipped or already HD` : ''}. Refresh to see changes.`);
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
  
  // Send to background script for download
  chrome.runtime.sendMessage({ 
    action: 'startDownloads', 
    media 
  }, (response) => {
    if (chrome.runtime.lastError) {
      ProgressModal.hide();
      throw new Error(chrome.runtime.lastError.message);
    }
    
    if (response && response.success) {
      ProgressModal.update(100, `Started downloading ${media.length} items. Check extension popup for progress.`);
      setTimeout(() => ProgressModal.hide(), 2000);
    } else {
      ProgressModal.hide();
      throw new Error('Failed to start downloads');
    }
  });
}

/**
 * Handles unfavorite operations
 * @param {string} type - Type of unfavorite operation
 */
function handleUnsave(type) {
  if (type === 'unsaveBoth') {
    handleUnsaveBoth();
  } else if (type === 'unsaveImages') {
    handleUnsaveImages();
  } else if (type === 'unsaveVideos') {
    handleUnsaveVideos();
  }
}

/**
 * Handles unfavoriting items with both video and image using API calls
 */
async function handleUnsaveBoth() {
  // Scroll and collect post IDs for ALL items (images and videos)
  ProgressModal.show('Unfavoriting All Items', 'Loading all favorites...');
  
  const postIds = await scrollAndCollectPostIds((hasVideo, hasImage) => {
    return hasImage; // Unfavorite all items (all items have images)
  });
  
  console.log(`Found ${postIds.length} items to unfavorite`);
  
  if (postIds.length === 0) {
    ProgressModal.hide();
    alert('No items found.');
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
      alert(`Operation cancelled. ${successCount} of ${postIds.length} items were unfavorited.`);
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
  alert(`Finished! Successfully unfavorited ${successCount} items${failCount > 0 ? `, ${failCount} failed` : ''}. Refresh to see changes.`);
}

/**
 * Handles unfavoriting single image items using API calls
 */
async function handleUnsaveImages() {
  // Scroll and collect post IDs for image-only items
  ProgressModal.show('Unfavoriting Single Images', 'Loading all favorites...');
  
  const postIds = await scrollAndCollectPostIds((hasVideo, hasImage) => {
    return !hasVideo && hasImage;
  });
  
  console.log(`Found ${postIds.length} items with single images only`);
  
  if (postIds.length === 0) {
    ProgressModal.hide();
    alert('No single image items found.');
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
      alert(`Operation cancelled. ${successCount} of ${postIds.length} items were unfavorited.`);
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
  alert(`Finished! Successfully unfavorited ${successCount} items${failCount > 0 ? `, ${failCount} failed` : ''}. Refresh to see changes.`);
}

/**
 * Handles unfavoriting video items using API calls
 */
async function handleUnsaveVideos() {
  // Scroll and collect post IDs for video items (with or without images)
  ProgressModal.show('Unfavoriting Videos', 'Loading all favorites...');
  
  const postIds = await scrollAndCollectPostIds((hasVideo, hasImage) => {
    return hasVideo; // Any item with a video
  });
  
  console.log(`Found ${postIds.length} items with videos`);
  
  if (postIds.length === 0) {
    ProgressModal.hide();
    alert('No video items found.');
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
      alert(`Operation cancelled. ${successCount} of ${postIds.length} items were unfavorited.`);
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
  alert(`Finished! Successfully unfavorited ${successCount} items${failCount > 0 ? `, ${failCount} failed` : ''}. Refresh to see changes.`);
}
