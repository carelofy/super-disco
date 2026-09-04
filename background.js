// background.js — minimal service worker. Storage writes happen directly
// from popup.js / dashboard.js via chrome.storage; this just seeds defaults.

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get("bookScannerState");
  if (!existing.bookScannerState) {
    await chrome.storage.local.set({
      bookScannerState: { niches: {}, activeNiche: null }
    });
  }
});
