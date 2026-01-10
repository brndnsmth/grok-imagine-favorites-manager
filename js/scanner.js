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
      console.log(`[Scanner] Scroll attempt ${attempts + 1}: Found ${cards.length} cards in DOM`);
      let newItemsFound = 0;

      for (let idx = 0; idx < cards.length; idx++) {
        const card = cards[idx];
        const postData = window.Utils.extractPostDataFromElement(card);
        
        if (!postData) {
            console.warn(`[Scanner] Failed to extract data from card index ${idx}`, card);
            continue;
        }

        // Skip logging if this specific card element was already scanned in a previous attempt
        if (!processedCardElements.has(card)) {
          const classification = window.ItemClassifier.classify(card, idx);
          processedCardElements.add(card);

          // If we haven't added this unique variation to our queues yet
          if (!processedPostIds.has(postData.id)) {
            console.log(`[Scanner] New item found: ${postData.id} (Type: ${classification.type})`);
            processedPostIds.add(postData.id);

            if (classification.type === window.ItemClassifier.TYPES.STATIC_IMAGE) {
              // For static images, we still use the UUID for the direct URL
              const uuid = window.Utils.extractPostId(postData.id);
              const staticUrl = `https://imagine-public.x.ai/imagine-public/images/${uuid}.jpg?cache=1&dl=1`;
              console.log(`[Scanner] Adding static image: ${uuid} -> ${staticUrl}`);
              allMediaData.set(staticUrl, { url: staticUrl, filename: `${uuid}.jpg` });
              newItemsFound++;
            } else {
              complexPostsToAnalyze.push(postData);
              newItemsFound++;
            }
          } else {
             // console.log(`[Scanner] Skipping duplicate: ${postData.id}`);
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
    console.log(`[Scanner] Phase 2 start. Processing ${complexPostsToAnalyze.length} complex items.`);
    
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
      console.log(`[Scanner] Finished processing item ${i+1}/${complexPostsToAnalyze.length}`);
      
      await window.Utils.sleep(window.CONFIG.ANALYSIS_DELAY_MS);
    }

    // Filter results based on requested type
    let finalResults = Array.from(allMediaData.values());
    console.log(`[Scanner] Total collected before filter: ${finalResults.length} items (Action: ${type})`);

    if (type === 'saveImages') {
      finalResults = finalResults.filter(item => !item.filename.toLowerCase().endsWith('.mp4'));
    } else if (type === 'saveVideos') {
      finalResults = finalResults.filter(item => item.filename.toLowerCase().endsWith('.mp4'));
    }

    console.log(`[Scanner] Final results after filter: ${finalResults.length} items`);
    return finalResults;
  },

  /**
   * Unfavorites all items found on the page
   */
  async unsaveAll() {
    console.log('[Scanner] Starting unsave sweep...');
    
    let scrollContainer = document.documentElement;
    const possibleContainers = [ document.querySelector('main'), document.querySelector('.overflow-y-auto') ]
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
                } catch(e) {}
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
