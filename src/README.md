# Weblang Selector & Translator (Browser Extension)

Chrome MV3 extension that lets you drag-select words on any page and shows a floating popup with client-side translation using Chrome's on-device Translator API. No backend.

## Load for development

1. Open Chrome and go to `chrome://extensions/`.
2. Enable Developer mode.
3. Click "Load unpacked" and select this `browser-extension` folder.
4. Hold Alt/Option and drag across words to select; a popup appears with translation.

## Notes

- Uses the on-device Translator API if available in your Chrome version. Otherwise shows "Translation not available." No network fallback is implemented.
- The content script wraps visible text nodes into clickable spans and handles drag-selection across contiguous words.
- Styling is mostly inline to reduce conflicts with site CSS.

### Activation modifier

- To avoid interfering with normal page interactions (e.g., links), selection only activates when holding Alt/Option. Clicks without Alt/Option will behave normally.

## Files

- `manifest.json` — MV3 manifest
- `content.js` — selection logic, popup UI, translation
- `service-worker.js` — reserved for future features
- `styles.css` — minimal markers

## Optional Icons

Add an `icons/` folder with `icon16.png`, `icon48.png`, `icon128.png` and update `manifest.json` if desired.
