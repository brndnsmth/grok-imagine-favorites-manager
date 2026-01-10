/**
 * Grok Imagine Favorites Manager - Media Scanner
 */

var MediaScanner = {
  /**
   * Scans the page, scrolls, and collects all available media
   * Returns a list of media objects {url, filename}
   */
  async scan(type) {

    
    let scrollContainer = document.documentElement;
    const possibleContainers = [ document.querySelector('main'), document.querySelector('.overflow-y-auto') ]
      .filter(el => el !== null);
    if (possibleContainers.length) scrollContainer = possibleContainers[0];

    const allMediaData = new Map(); // URL -> {url, filename}
    const complexPostsToAnalyze = []; // List of {id, url}
    const processedPostIds = new Set();
    const processedCardElements = new WeakSet(); // Track card DOM elements for logging

    // Phase 1: Scroll and Identify
    let attempts = 0;
    while (attempts < window.CONFIG.SCROLL_ATTEMPTS) {
      if (window.ProgressModal.isCancelled()) throw new Error('Operation cancelled by user');
      
      const cards = document.querySelectorAll(window.SELECTORS.CARD);
      let newItemsFound = 0;

      for (let idx = 0; idx < cards.length; idx++) {
        const card = cards[idx];
        const postData = window.Utils.extractPostDataFromElement(card);
        
        if (!postData) continue;

        // Skip logging if this specific card element was already scanned in a previous attempt
        if (!processedCardElements.has(card)) {
          const classification = window.ItemClassifier.classify(card, idx);
          processedCardElements.add(card);

          // If we haven't added this unique variation to our queues yet
          if (!processedPostIds.has(postData.id)) {
            processedPostIds.add(postData.id);

            if (classification.type === window.ItemClassifier.TYPES.STATIC_IMAGE) {
              // For static images, we still use the UUID for the direct URL
              const uuid = window.Utils.extractPostId(postData.id);
              const staticUrl = `https://imagine-public.x.ai/imagine-public/images/${uuid}.jpg?cache=1&dl=1`;
              allMediaData.set(staticUrl, { url: staticUrl, filename: `${uuid}.jpg` });
              newItemsFound++;
            } else {
              complexPostsToAnalyze.push(postData);
              newItemsFound++;
            }
          }
        }
      }

      window.ProgressModal.update(30, `Scanning... Identified ${processedPostIds.size} unique items`);
      
      scrollContainer.scrollTop += window.innerHeight;
      await window.Utils.sleep(window.CONFIG.SCROLL_DELAY_MS);
      attempts++;
    }

    // Phase 2: Deep Analysis for Complex Items
    // Phase 2: Deep Analysis for Complex Items
    
    for (let i = 0; i < complexPostsToAnalyze.length; i++) {
      if (window.ProgressModal.isCancelled()) break;
      
      const { id, url } = complexPostsToAnalyze[i];
      window.ProgressModal.update(50 + ((i / complexPostsToAnalyze.length) * 40), `Analyzing Item ${i+1}/${complexPostsToAnalyze.length}...`);
      window.ProgressModal.updateSubStatus(`Opening analysis tab for ${id}...`);

      try {
        const results = await window.Api.requestAnalysis(id, url);
        if (Array.isArray(results)) {
          results.forEach(item => {
            if (item.url) {
              const ext = item.type === 'video' ? 'mp4' : 'jpg';
              const filename = `${item.id}.${ext}`;
              if (!allMediaData.has(item.url)) {
                allMediaData.set(item.url, { url: item.url, filename });
              }
            }
          });
        }
      } catch (e) {
        console.error(`[Scanner] ❌ Analysis failed for ${id}:`, e);
      }
      
      await window.Utils.sleep(window.CONFIG.ANALYSIS_DELAY_MS);
    }

    return Array.from(allMediaData.values());
  }
};

window.MediaScanner = MediaScanner;
