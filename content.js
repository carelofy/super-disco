// content.js — reads only what's already rendered on the Amazon page the
// user is currently viewing. No network calls of its own, no bypassing of
// any access control, no automated crawling — it acts once per user click.

function cleanText(t) {
  return (t || "").replace(/\s+/g, " ").trim();
}

function parseNumber(str) {
  if (!str) return null;
  const cleaned = str.replace(/[^0-9.]/g, "");
  return cleaned ? parseFloat(cleaned) : null;
}

function detectPageType() {
  const path = location.pathname;
  if (/^\/(dp|gp\/product)\//.test(path)) return "product";
  if (path === "/s" || /\/s\b|best-sellers|bestsellers|new-releases|zgbs/i.test(path)) return "listing";
  return "unknown";
}

function detectListingKind() {
  const text = `${location.pathname} ${document.title}`.toLowerCase();
  if (/new-releases|hot new releases/.test(text)) return "new-release";
  if (/best-sellers|bestsellers|best seller/.test(text)) return "best-seller";
  if (location.pathname === "/s") return "search";
  return "category";
}

// ---------- LISTING (search / category / bestseller) PAGE ----------

function scrapeListing(listingKind) {
  const items = Array.from(document.querySelectorAll([
    'div[data-component-type="s-search-result"][data-asin]',
    'div.s-result-item[data-asin]',
    'div[data-asin]:not([data-asin=""])',
    '[id^="gridItem_"][data-asin]'
  ].join(",")));
  const books = [];
  const seen = new Set();

  items.forEach(item => {
    const asin = item.getAttribute("data-asin");
    if (!asin || seen.has(asin)) return;

    // Must look like a book result — skip sponsored widgets / unrelated cards with no title link
    const titleEl = item.querySelector("h2 a span, h2 span, [data-cy='title-recipe'] h2, .a-size-medium.a-color-base.a-text-normal, .a-size-base-plus.a-color-base.a-text-normal, .p13n-sc-truncate");
    const title = cleanText(titleEl ? titleEl.textContent : "");
    if (!title) return;

    seen.add(asin);

    const linkEl = item.querySelector("h2 a[href], a.a-link-normal[href*='/dp/'], a.a-link-normal[href*='/gp/product/']");
    const url = linkEl ? new URL(linkEl.getAttribute("href"), location.origin).href.split("?")[0] : null;

    // Author — Amazon book cards usually show "by <Author>" in a secondary row
    let author = null;
    const byMatch = item.innerText.match(/\bby\s+([A-Z][^\n|]{2,60})/);
    if (byMatch) author = cleanText(byMatch[1].split(/\s{2,}|\|/)[0]);

    // Rating
    const ratingEl = item.querySelector('i.a-icon-star-small span.a-icon-alt, i.a-icon-star span.a-icon-alt, span[aria-label*="out of 5 stars"]');
    let rating = null;
    if (ratingEl) {
      const m = (ratingEl.textContent || ratingEl.getAttribute("aria-label") || "").match(/([\d.]+)\s+out of 5/);
      if (m) rating = parseFloat(m[1]);
    }

    // Review count
    let reviewCount = null;
    const reviewEl = item.querySelector('a[href*="customerReviews"] span, span.a-size-base.s-underline-text, span[aria-label$="ratings"], span[aria-label$="rating"]');
    if (reviewEl) {
      reviewCount = parseNumber(reviewEl.textContent || reviewEl.getAttribute("aria-label"));
    }

    // Price
    const priceEl = item.querySelector(".a-price .a-offscreen");
    const price = priceEl ? cleanText(priceEl.textContent) : null;

    // Format (Kindle / Paperback / Hardcover / Audiobook) — best-effort from visible format chips
    let format = null;
    const formatEl = item.querySelector('a.a-size-base.a-link-normal, .a-row .a-button-text');
    const formatMatch = item.innerText.match(/\b(Kindle|Paperback|Hardcover|Audiobook|Audio CD|Board Book|Spiral-bound)\b/);
    if (formatMatch) format = formatMatch[1];

    // Best Seller badge
    let badge = null;
    const badgeEl = item.querySelector(".a-badge-text");
    if (badgeEl) {
      const b = cleanText(badgeEl.textContent);
      if (/best seller/i.test(b)) badge = b;
    }

    // Image
    const imgEl = item.querySelector("img.s-image, img[data-image-latency='s-product-image']");
    const image = imgEl ? imgEl.src : null;

    const rankText = cleanText(item.querySelector(".zg-bdg-text, .a-badge-text")?.textContent);
    const rankMatch = rankText.match(/#\s*([\d,]+)/);
    const pageRank = rankMatch ? parseInt(rankMatch[1].replace(/,/g, ""), 10) : null;

    books.push({
      asin, title, author, rating, reviewCount, price, format, badge, image, url,
      source: listingKind,
      pageRank,
      scannedAt: new Date().toISOString()
    });
  });

  return books;
}

// ---------- PRODUCT DETAIL PAGE ----------

function scrapeProduct() {
  const asinMatch = location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
  const asin = asinMatch ? asinMatch[1] : null;
  if (!asin) return null;

  const title = cleanText(document.querySelector("#productTitle")?.textContent);
  if (!title) return null;

  const author = cleanText(
    document.querySelector("#bylineInfo")?.textContent ||
    document.querySelector(".author a")?.textContent
  ).replace(/^by\s+/i, "") || null;

  let rating = null;
  const ratingText = document.querySelector("#acrPopover")?.getAttribute("title") ||
    document.querySelector('span[data-hook="rating-out-of-text"]')?.textContent || "";
  const ratingMatch = ratingText.match(/([\d.]+)\s+out of 5/);
  if (ratingMatch) rating = parseFloat(ratingMatch[1]);

  let reviewCount = null;
  const reviewText = document.querySelector("#acrCustomerReviewText")?.textContent || "";
  const reviewMatch = reviewText.match(/([\d,]+)/);
  if (reviewMatch) reviewCount = parseNumber(reviewMatch[1]);

  const priceEl = document.querySelector("#kindle-price, .a-price .a-offscreen, #price, #buybox .a-price .a-offscreen");
  const price = priceEl ? cleanText(priceEl.textContent) : null;

  // Scan the whole page's visible text for detail-bullet style facts —
  // resilient to Amazon's frequent markup changes for this section.
  const bodyText = document.body.innerText || "";

  let bsrOverall = null;
  const bsrOverallMatch = bodyText.match(/#([\d,]+)\s+in\s+Books/i);
  if (bsrOverallMatch) bsrOverall = parseInt(bsrOverallMatch[1].replace(/,/g, ""), 10);

  const bsrCategories = [];
  const categoryRankRegex = /#([\d,]+)\s+in\s+([A-Za-z0-9&,'\-\/ ]{3,60}?)(?:\s*\(Books\))?(?=\n|#|$)/g;
  let cm;
  while ((cm = categoryRankRegex.exec(bodyText)) !== null) {
    const cat = cleanText(cm[2]);
    if (/^Books$/i.test(cat)) continue; // already captured as bsrOverall
    bsrCategories.push({ rank: parseInt(cm[1].replace(/,/g, ""), 10), category: cat });
    if (bsrCategories.length >= 5) break;
  }

  let pubDate = null;
  const pubMatch = bodyText.match(/Publication date\s*[:\u200e]*\s*([A-Za-z]+ \d{1,2}, \d{4})/);
  if (pubMatch) pubDate = pubMatch[1];

  let publisher = null;
  const pubHouseMatch = bodyText.match(/Publisher\s*[:\u200e]*\s*([^\n;]+?)(?:;|\n|$)/);
  if (pubHouseMatch) publisher = cleanText(pubHouseMatch[1]).slice(0, 80);

  let format = null;
  const formatMatch = bodyText.match(/\b(Kindle Edition|Paperback|Hardcover|Audiobook|Audio CD|Board Book|Spiral-bound)\b/);
  if (formatMatch) format = formatMatch[1];

  const badgeEl = document.querySelector(".badge-text, #zeitgeistBadge_feature_div .a-badge-text");
  const badge = badgeEl ? cleanText(badgeEl.textContent) : null;

  return {
    asin, title, author, rating, reviewCount, price, format, badge,
    bsrOverall, bsrCategories, pubDate, publisher,
    url: location.href.split("?")[0],
    source: "product",
    scannedAt: new Date().toISOString()
  };
}

function scanCurrentPage() {
  const pageType = detectPageType();
  if (pageType === "listing") {
    const listingKind = detectListingKind();
    return { pageType, listingKind, books: scrapeListing(listingKind) };
  }
  if (pageType === "product") {
    const book = scrapeProduct();
    return { pageType, books: book ? [book] : [] };
  }
  return { pageType, books: [] };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "SCAN_AMAZON_PAGE") {
    try {
      sendResponse({ ok: true, data: scanCurrentPage() });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  }
  return true;
});
