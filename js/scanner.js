/**
 * Grok Imagine Favorites Manager - Media Scanner
 */

var MediaScanner = {
  /**
   * Scans the page, scrolls, and collects all available media
   * Returns a list of media objects {url, filename}
   */
  async scan(type) {


    // Dynamic Scroll Container Detection (ported from main branch)
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
      console.log('[Scanner] Found best scroll container:', scrollContainer);
    }

    const allMediaData = new Map(); // URL -> {url, filename}
    const complexPostsToAnalyze = []; // List of {id, url}
    const processedPostIds = new Set();

    // Phase 1: Scroll and Identify
    let unchangedScrollCount = 0;
    const scrollIncrement = window.innerHeight / 2;
    let lastScrollHeight = scrollContainer.scrollHeight;

    // We use a combination of idle (no new items) and scroll height checks
    while (unchangedScrollCount < window.CONFIG.MAX_IDLE_SCROLLS) {
      if (window.ProgressModal.isCancelled()) throw new Error('Operation cancelled by user');

      const cards = document.querySelectorAll(window.SELECTORS.CARD);

      for (let idx = 0; idx < cards.length; idx++) {
        const card = cards[idx];
        const postData = window.Utils.extractPostDataFromElement(card);

        if (!postData) continue;

        // If we haven't added this unique variation to our queues yet
        if (!processedPostIds.has(postData.id)) {
          processedPostIds.add(postData.id);

          // Force ALL items to go through deep analysis to get signed URLs
          // The previous "Static Image" optimization resulted in AccessDenied XML errors for expired/invalid paths
          complexPostsToAnalyze.push(postData);
        }
      }

      const currentCount = processedPostIds.size;
      window.ProgressModal.update(30, `Scanning... Identified ${currentCount} unique items`);

      // Main Branch Strategy: Half-viewport scroll
      scrollContainer.scrollTop += scrollIncrement;

      await window.Utils.sleep(window.CONFIG.SCROLL_DELAY_MS);

      // Check if we've reached the bottom
      const newScrollHeight = scrollContainer.scrollHeight;
      if (newScrollHeight === lastScrollHeight) {
        unchangedScrollCount++;
        console.log(`[Scanner] Scroll height unchanged (${unchangedScrollCount}/${window.CONFIG.MAX_IDLE_SCROLLS})`);

        // "Wiggle" if stuck (keep this useful addition)
        if (unchangedScrollCount > 1) {
          window.scrollBy(0, -100);
          await window.Utils.sleep(300);
          window.scrollBy(0, 100);
        }
      } else {
        unchangedScrollCount = 0;
        lastScrollHeight = newScrollHeight;
      }
    }

    // Phase 2: Deep Analysis for Complex Items

    for (let i = 0; i < complexPostsToAnalyze.length; i++) {
      if (window.ProgressModal.isCancelled()) break;

      const { id, url } = complexPostsToAnalyze[i];
      window.ProgressModal.update(50 + ((i / complexPostsToAnalyze.length) * 40), `Analyzing Item ${i + 1}/${complexPostsToAnalyze.length}...`);
      window.ProgressModal.updateSubStatus(`Opening analysis tab for ${id}...`);

      try {
        const results = await window.Api.requestAnalysis(id, url);
        if (Array.isArray(results)) {
          results.forEach(item => {
            if (item.url) {
              const ext = item.type === 'video' ? 'mp4' : 'jpg';
              const filename = `${item.id}.${ext}`;
              if (!allMediaData.has(item.url)) {
                allMediaData.set(item.url, { url: item.url, filename, id: item.id });
              }
            }
          });
        }
      } catch (e) {
        console.error(`[Scanner] ❌ Analysis failed for ${id}:`, e);
      }

      await window.Utils.sleep(window.CONFIG.ANALYSIS_DELAY_MS);
    }

    // Filter results based on requested type
    let finalResults = Array.from(allMediaData.values());

    if (type === 'saveImages') {
      finalResults = finalResults.filter(item => !item.filename.toLowerCase().endsWith('.mp4'));
    } else if (type === 'saveVideos') {
      finalResults = finalResults.filter(item => item.filename.toLowerCase().endsWith('.mp4'));
    }

    return finalResults;
  },

  /**
   * Unfavorites all items found on the page
   */
  async unsaveAll() {
    console.log('[Scanner] Starting unsave sweep...');

    let scrollContainer = document.documentElement;
    const possibleContainers = [document.querySelector('main'), document.querySelector('.overflow-y-auto')]
      .filter(el => el !== null);
    if (possibleContainers.length) scrollContainer = possibleContainers[0];

    let totalProcessed = 0;
    const processedIds = new Set();
    let unchangedCount = 0;
    let lastScrollHeight = 0;

    while (!window.ProgressModal.isCancelled()) {
      const cards = document.querySelectorAll(window.SELECTORS.LIST_ITEM);
      let actedOnThisTurn = 0;

      for (let i = 0; i < cards.length; i++) {
        if (window.ProgressModal.isCancelled()) break;
        const card = cards[i];

        // 1. Physical Click (Try this first as it's most robust)
        const unsaveBtn = card.querySelector(window.SELECTORS.UNSAVE_BUTTON);
        let clicked = false;

        if (unsaveBtn) {
          try {
            unsaveBtn.click();
            clicked = true;
            actedOnThisTurn++;
            totalProcessed++;
            await window.Utils.sleep(300); // Wait for UI update
          } catch (e) { }
        }

        // 2. API Fallback (Only if we can identify the ID and haven't clicked)
        const postData = window.Utils.extractPostDataFromElement(card);
        if (postData && postData.id && !processedIds.has(postData.id)) {
          processedIds.add(postData.id);
          // If button click didn't happen (or failed), try API logic
          // But note: if button clicked, we still add ID to processed to avoid double counting
          if (!clicked) {
            await window.Api.unlikePost(postData.id);
            actedOnThisTurn++;
            totalProcessed++;
            await window.Utils.sleep(window.CONFIG.UNFAVORITE_DELAY_MS || 200);
          }
        }

        window.ProgressModal.update(Math.min(98, totalProcessed * 2), `Unfavorited ${totalProcessed} items...`);
      }

      // Scroll logic
      const currentScrollHeight = scrollContainer.scrollHeight;
      if (currentScrollHeight === lastScrollHeight) unchangedCount++;
      else { unchangedCount = 0; lastScrollHeight = currentScrollHeight; }

      // Exit if no actions taken and scroll didn't change (end of list)
      if (actedOnThisTurn === 0 && unchangedCount >= 2) break;

      scrollContainer.scrollTop += window.innerHeight / 2;
      await window.Utils.sleep(window.CONFIG.SCROLL_DELAY_MS);
    }

    return totalProcessed;
  }
};

window.MediaScanner = MediaScanner;
