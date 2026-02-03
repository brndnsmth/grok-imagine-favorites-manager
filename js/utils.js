/**
 * Grok Imagine Favorites Manager - Utilities
 */

var Utils = {
  /**
   * Extract UUID from a URL
   */
  extractPostId(url) {
    if (!url) return null;
    // 1. Priority: Look for ID after specific path markers
    const pathMatch = url.match(/\/(?:generated|post|status|imagine\/post)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (pathMatch && pathMatch[1]) return pathMatch[1].toLowerCase();

    // 2. Fallback: Get ALL UUIDs and pick the LAST one (Assets URLs: /users/[UserID]/generated/[PostID]/...)
    const allMatches = url.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig);
    if (allMatches && allMatches.length > 0) {
      return allMatches[allMatches.length - 1].toLowerCase();
    }
    return null;
  },

  /**
   * Extract Post Data {id, url, isFallback} from a card element
   */
  extractPostDataFromElement(element) {
    try {
      // 1. Priority: Find links with post ID
      const links = element.querySelectorAll('a');
      for (const link of links) {
        if (!link.href || link.href.includes('/profile/')) continue;
        
        const match = link.href.match(/\/(?:post|status|imagine\/post)\/([0-9a-f-]{36}|[0-9a-f]{8,})/i);
        if (match) {
          const uuid = match[1].toLowerCase();
          const urlObj = new URL(link.href);
          // Create a unique key using UUID + query params (to distinguish variations)
          const uniqueId = uuid + urlObj.search; 
          
          return {
            id: uniqueId,
            url: link.href, // Preserve the full URL including ?index=...
            isFallback: false
          };
        }
      }

      // 2. Fallback: Extract ID from image source
      const img = element.querySelector(window.SELECTORS.IMAGE);
      if (img && img.src) {
        const id = this.extractPostId(img.src);
        if (id) {
          console.debug(`[Utils] ℹ️ Using fallback ID from IMG SRC: ${id}`);
          return {
            id,
            url: `${window.location.origin}/imagine/post/${id}`,
            isFallback: true
          };
        }
      }

      return null;
    } catch (e) {
      console.error('[Utils] Error extracting data from element:', e);
      return null;
    }
  },

  /**
   * Sleep for specified duration
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};

window.Utils = Utils;
