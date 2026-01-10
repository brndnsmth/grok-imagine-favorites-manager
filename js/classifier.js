/**
 * Grok Imagine Favorites Manager - Item Classifier
 */

var ItemClassifier = {
  TYPES: {
    STATIC_IMAGE: 'STATIC_IMAGE',
    VIDEO_COMPLEX: 'VIDEO_COMPLEX'
  },

  /**
   * Classifies a media card based on its DOM structure
   */
  classify(card, index = '?') {
    const img = card.querySelector(window.SELECTORS.IMAGE);
    const video = card.querySelector(window.SELECTORS.VIDEO);
    const playIcon = card.querySelector(window.SELECTORS.PLAY_ICON);
    const hasDuration = card.innerText.match(/\d+:\d+/);

    // Strict criteria for "Static Image":
    // Must have an image, MUST NOT have video, play icon, or duration text.
    const isStrictlyImage = img && !video && !playIcon && !hasDuration;
    
    const classification = isStrictlyImage ? this.TYPES.STATIC_IMAGE : this.TYPES.VIDEO_COMPLEX;

    // Detailed diagnostic logging (one-to-one with card, no duplicates)
    // Detailed diagnostic logging (removed for production)

    return {
      type: classification,
      details: {
        hasImage: !!img,
        hasVideo: !!video,
        hasPlayIcon: !!playIcon,
        hasDuration: !!hasDuration
      }
    };
  }
};

window.ItemClassifier = ItemClassifier;
