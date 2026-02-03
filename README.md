# Grok Imagine Favorites Manager

A modern Chrome extension to download and manage your favorited Grok Imagine images and videos.

<img width="337" height="597" alt="Screenshot 2025-11-19 at 11 57 57 AM" src="https://github.com/user-attachments/assets/a42e7456-3100-4935-972f-6548c974049d" />

<img width="408" height="257" alt="Screenshot 2025-11-17 at 10 23 38 AM" src="https://github.com/user-attachments/assets/51ac09e1-8973-4cf3-a5e7-034677b62cdf" />

---

## ⚠️ IMPORTANT DISCLAIMER - READ BEFORE USE ⚠️

**USE AT YOUR OWN RISK. THIS IS AN UNOFFICIAL, THIRD-PARTY TOOL.**

- **NOT AFFILIATED** with Grok, X, or any official entities
- **NO WARRANTY** - This extension is provided "AS IS" without any guarantees
- **NO RESPONSIBILITY** - The developer is not responsible for:
  - Data loss or corruption
  - Account issues or bans
  - API changes breaking functionality
  - Any damages or issues arising from use
- **BREAKING CHANGES EXPECTED** - Grok Imagine is constantly evolving. This extension may break at any time as the platform updates its interface, API endpoints, or policies
- **EXPERIMENTAL SOFTWARE** - Features may be unstable or incomplete
- **YOUR RESPONSIBILITY** - By using this extension, you acknowledge and accept all risks

**If you cannot accept these terms, do not use this extension.**

---

## Features

- Download all images and/or videos from your favorites with automatic scrolling
- Upscale standard videos to HD quality with fast parallel requests
- Unfavorite all items at once
- Automatic filename matching (videos use image names)
- On-screen progress modal with live updates
- Cancel operations at any time
- API-based unfavoriting for reliability

## Installation

### Step 1: Clone the Repository

First, clone this repository to your local machine:

```bash
git clone https://github.com/brndnsmth/grok-imagine-favorites-manager.git
```

This will create a folder called `grok-imagine-favorites-manager` containing all the extension files.

Alternatively, you can download the repository as a ZIP file:
1. Go to https://github.com/brndnsmth/grok-imagine-favorites-manager
2. Click the green "Code" button
3. Select "Download ZIP"
4. Extract the ZIP file to a folder on your computer

### Step 2: Load the Extension in Chrome

1. Open Google Chrome
2. Navigate to `chrome://extensions/` (or go to Menu → Extensions → Manage Extensions)
3. Enable **Developer mode** by toggling the switch in the top-right corner
4. Click the **"Load unpacked"** button that appears
5. Navigate to and select the `grok-imagine-favorites-manager` folder you cloned/downloaded
6. The extension should now appear in your extensions list

### Step 3: Pin the Extension (Optional but Recommended)

1. Click the puzzle piece icon in Chrome's toolbar (Extensions menu)
2. Find "Grok Imagine Favorites Manager" in the list
3. Click the pin icon next to it
4. The extension icon will now appear in your toolbar for easy access

## Usage

1. Log in to your account
2. Navigate to https://grok.com/imagine/favorites
3. Click the extension icon
4. Choose your desired action

The extension will automatically scroll and load all favorites before processing.

### Available Actions

**Download:**
- **Download All Media** - Downloads both images and videos (videos named to match images)
- **Download Images Only** - Downloads only images
- **Download Videos Only** - Downloads only videos (named to match images)

*Note: Video downloads only capture the most recently generated video. If you've regenerated a video multiple times, only the latest version will be downloaded.*

**Video Tools:**
- **Upscale Videos to HD** - Requests upscaling for all standard videos to HD quality (requests are staggered and complete in background)

*Note: Upscaling only applies to the most recently generated video. Previous video versions cannot be upscaled through this tool.*

<img width="402" height="299" alt="Screenshot 2025-11-18 at 4 12 40 PM" src="https://github.com/user-attachments/assets/d86954d1-8cc9-4f37-a7d1-63e171937144" />

<img width="406" height="302" alt="Screenshot 2025-11-18 at 4 12 48 PM" src="https://github.com/user-attachments/assets/73f260ed-7795-40f0-a1e9-c1db95dcdf1d" />

**Manage:**
- **Unfavorite All** - Removes all favorites from your collection

**Utilities:**
- **Cancel Current Operation** - Stops any running download or unfavorite operation
- **Open Downloads Folder** - Opens Chrome downloads page
- **Open Download Settings** - Opens Chrome download settings

## Files

- `manifest.json` - Extension configuration
- `popup.html` - Extension popup UI
- `popup.js` - Popup logic and event handlers
- `content.js` - Page interaction, media extraction, and unfavorite operations
- `background.js` - Download management and rate limiting

## Downloads Location

Files are saved to your default Chrome downloads folder in a `grok-imagine/` subdirectory.

Videos are automatically named to match their corresponding image files (using the image UUID/filename).

## Technical Details & Credits

### Recent Improvements

Special thanks to **[masamunet](https://github.com/masamunet)** for significant core contributions:

* **"Universal Sweep" Logic:** Overhauled the unfavorite system to fix issues where video items were skipped. The logic now uses a two-pronged approach: a physical click on the "Unsave" button followed by a sequential API backup for 100% reliability.
* **Deep ID Extraction:** Implemented `findAllUUIDsInElement` to scan all attributes for Post IDs. This ensures the original Post ID is captured even when the video UUID differs (common with regenerated videos).
* **Sequential Processing:** Shifted from "batch" processing to an `await` flow to prevent race conditions and ensure every item is processed before moving to the next.
* **Reliable High-Quality Downloads:** Fixed logic to ensure "Images Only" and "Videos Only" filters work strictly as intended without mixed content, while always grabbing the highest resolution available.

### System details

- Downloads are rate-limited to approximately 3 per second to avoid browser issues
- Unfavorite requests are delayed by 150ms between calls
- Upscale requests are staggered with 300ms delays and run in parallel
- Progress tracking displays in an on-screen modal with visual progress bar
- Content script automatically scrolls to load all lazy-loaded content

## Important Notes

- **⚠️ Grok Imagine is constantly changing** - This extension may break with platform updates
- The extension works on https://grok.com/imagine/favorites
- No manual scrolling needed - the extension handles it automatically
- Video filenames automatically match their corresponding image names for easy pairing
- **Only the most recently generated video is processed** - Earlier video versions are not accessible
- Keep the tab open while operations run to ensure completion
- Progress is shown in an on-screen modal with cancellation option
- Unfavorite operations work by calling `/rest/media/post/unlike` with the post id
- Upscale requests are sent to `/rest/media/video/upscale` and complete in the background

## Support

This extension is designed specifically for Grok Imagine favorites management. **The Grok platform is actively developed and frequently changes.** If features stop working, the extension will need updates to match new DOM structures, API endpoints, or workflows. Check the repository for updates or open an issue if you encounter problems.