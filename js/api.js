/**
 * Grok Imagine Favorites Manager - API Layer
 */

var Api = {
  /**
   * Request deep analysis for a post from the background script
   * Returns a Promise that resolves to an array of media objects [{url, id, type}]
   */
  endpoints: {
    analysis: 'https://grok.com/rest/app-chat/conversations',
    unlike: 'https://grok.com/rest/media/post/unlike'
  },

  /**
   * Request deep analysis for a post from the background script
   * Returns a Promise that resolves to an array of media objects [{url, id, type}]
   */
  async requestAnalysis(postId, postUrl) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'analyzePost', postId, url: postUrl }, response => {
        if (chrome.runtime.lastError) {
          return reject(chrome.runtime.lastError);
        }
        if (response && response.success) {
          resolve(response.data || []);
        } else {
          reject(new Error(response?.error || 'Unknown analysis error'));
        }
      });
    });
  },

  /**
   * Unlikes a post by ID
   */
  async unlikePost(postId) {
    try {
      const response = await fetch(this.endpoints.unlike, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: postId })
      });
      return response.ok;
    } catch (e) {
      console.error('[Api] Unlike Failed:', e);
      return false;
    }
  },

  /**
   * Send collected media list to background script to start downloads
   */
  startDownloads(mediaList) {
    if (!mediaList || mediaList.length === 0) return;
    chrome.runtime.sendMessage({ action: 'startDownloads', media: mediaList });
  }
};

window.Api = Api;
