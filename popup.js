const nicheInput = document.getElementById("nicheInput");
const pageStatus = document.getElementById("pageStatus");
const scanBtn = document.getElementById("scanBtn");
const scanResult = document.getElementById("scanResult");
const bookCountEl = document.getElementById("bookCount");
const lastScanEl = document.getElementById("lastScan");

let activeTabId = null;
let activeNicheKey = null;

function isAmazonUrl(url) {
  try {
    // Matches Amazon retail domains such as amazon.com, amazon.co.uk,
    // amazon.de and their www/mobile subdomains, but not lookalike hosts.
    return /(^|\.)amazon\.[a-z.]+$/i.test(new URL(url).hostname);
  } catch (_) {
    return false;
  }
}

function scanTab(tabId, callback) {
  chrome.tabs.sendMessage(tabId, { type: "SCAN_AMAZON_PAGE" }, (response) => {
    if (!chrome.runtime.lastError && response) {
      callback(response);
      return;
    }

    chrome.scripting.executeScript(
      { target: { tabId }, files: ["content.js"] },
      () => {
        if (chrome.runtime.lastError) {
          callback({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        chrome.tabs.sendMessage(tabId, { type: "SCAN_AMAZON_PAGE" }, (retry) => {
          callback(retry || { ok: false, error: chrome.runtime.lastError?.message || "No response from page" });
        });
      }
    );
  });
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

async function refreshNicheSummary() {
  const label = nicheInput.value.trim();
  if (!label) {
    bookCountEl.textContent = "0";
    lastScanEl.textContent = "—";
    return;
  }
  const key = nicheKeyFromLabel(label);
  const niche = await getNiche(key);
  if (niche) {
    bookCountEl.textContent = String(Object.keys(niche.books).length);
    lastScanEl.textContent = fmtTime(niche.lastScanAt);
  } else {
    bookCountEl.textContent = "0";
    lastScanEl.textContent = "—";
  }
}

async function init() {
  const state = await getState();
  if (state.activeNiche && state.niches[state.activeNiche]) {
    nicheInput.value = state.niches[state.activeNiche].label;
  }
  await refreshNicheSummary();

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab || !tab.url || !isAmazonUrl(tab.url)) {
    pageStatus.textContent = "Not an Amazon retail page. Open an Amazon search, bestseller, or book page to scan.";
    scanBtn.disabled = true;
    return;
  }
  activeTabId = tab.id;

  scanTab(tab.id, (response) => {
    if (!response.ok) {
      pageStatus.textContent = "Couldn't read this page. Reload the Amazon page, wait for results to appear, then reopen the extension.";
      scanBtn.disabled = true;
      return;
    }
    describePageType(response.data.pageType, response.data.books.length);
  });
}

function describeCurrentPage(tabId) {
  scanTab(tabId, (response) => {
    if (response && response.ok) {
      describePageType(response.data.pageType, response.data.books.length);
    } else {
      pageStatus.textContent = "Couldn't read this page. Try reloading it.";
      scanBtn.disabled = true;
    }
  });
}

function describePageType(pageType, count) {
  if (pageType === "listing") {
    pageStatus.textContent = `Search/category page detected — ${count} book${count === 1 ? "" : "s"} visible.`;
    scanBtn.disabled = count === 0;
  } else if (pageType === "product") {
    pageStatus.textContent = count ? "Product page detected — ready to capture full details." : "Product page, but couldn't read the title.";
    scanBtn.disabled = count === 0;
  } else {
    pageStatus.textContent = "This doesn't look like a book search or product page.";
    scanBtn.disabled = true;
  }
}

scanBtn.addEventListener("click", async () => {
  const label = nicheInput.value.trim();
  if (!label) {
    pageStatus.textContent = "Enter a niche label first (e.g. Gut Health).";
    return;
  }
  scanBtn.disabled = true;
  scanBtn.textContent = "Scanning…";

  const nicheKey = await ensureNiche(label);
  activeNicheKey = nicheKey;

  scanTab(activeTabId, async (response) => {
    scanBtn.disabled = false;
    scanBtn.textContent = "Scan This Page";

    if (!response || !response.ok || response.data.books.length === 0) {
      scanResult.textContent = "No books found on this page.";
      scanResult.classList.remove("hidden");
      return;
    }

    await mergeBooksIntoNiche(nicheKey, response.data.books);
    await recordScan(nicheKey, {
      pageType: response.data.pageType,
      listingKind: response.data.listingKind,
      url: response.data.books[0]?.url || null,
      bookCount: response.data.books.length
    });

    const state = await getState();
    const niche = state.niches[nicheKey];
    upsertDailySnapshot(niche);
    await setState(state);

    const sourceName = response.data.listingKind ? response.data.listingKind.replace("-", " ") : response.data.pageType;
    scanResult.textContent = `Captured ${response.data.books.length} book(s) from this ${sourceName} page.`;
    scanResult.classList.remove("hidden");
    await refreshNicheSummary();
  });
});

nicheInput.addEventListener("change", refreshNicheSummary);

document.getElementById("openDashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

init();
