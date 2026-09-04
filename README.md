# Amazon Book Market Scanner

A Chrome extension that turns your own Amazon browsing into book-market
intelligence: niche competition level, title patterns, recurring themes,
an opportunity score per book, and rule-based original title concepts.

## What this actually is (read before using)

There is **no public Amazon API** that hands out live bestseller rank,
review counts, or category data for arbitrary niches — the official
Product Advertising API requires an active Associates account with sales
history and still doesn't expose category rank the way most people expect.

So this extension takes the only honest path to genuinely live data: it
reads the Amazon page **you are actually looking at** in your browser —
search results, category/bestseller listings, and individual product
pages — and extracts what's rendered there. Nothing is fetched in the
background, nothing is fabricated, and nothing is scraped while you're
not looking at the page.

Practical consequences of that:
- **Best Sellers Rank (BSR), publisher, and publication date** only exist
  on individual product pages, not search listings. Scan a listing page
  first to find candidates, then click into product pages to enrich them.
- **"Live"** means "as of the page you scanned," shown with a timestamp —
  not a continuously updating feed.
- **Trend detection** compares your scan of a niche today against a saved
  scan of the same niche from a previous day. The first time you scan a
  niche, the dashboard says so plainly instead of inventing a trend.
- **Title Intelligence / Idea Generator** is template-based recombination
  of patterns actually detected in your scraped titles (colon structures,
  "X-Day" plans, recurring keywords) — it is not an LLM (the extension
  has no model access) and it never copies an existing title or subtitle.
- Any field that isn't available on the page you scanned is shown as
  **"Not available"**, never guessed.

Amazon's page markup changes periodically, so some selectors may need
occasional updates if scanning starts returning empty results — see
"Extending it" below.

## Install (Chrome, unpacked / dev mode)
1. Unzip this folder somewhere permanent.
2. Go to `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `amazon-book-scanner` folder.
4. The extension icon appears in your toolbar.

## Use
1. Go to Amazon and search or browse to a books category
   (e.g. search "gut health books", or Browse → Books → Best Sellers →
   Health, Fitness & Dieting).
2. Click the extension icon, type a **niche label** (e.g. "Gut Health") —
   this groups everything you scan under that name.
   On Amazon regional stores such as Amazon.co.uk or Amazon.de, opening the
   popup grants the extension access to that current tab before scanning.
3. Click **Scan This Page**. Repeat on additional result pages to capture
   more books (duplicates are merged automatically by ASIN).
   For launch opportunities, first open Amazon's **Hot New Releases** page
   for the relevant book category and scan it; those titles are tagged as
   new releases in the dashboard.
4. Click into individual product pages and scan those too, to add BSR,
   publisher, and publication date to books you've already captured.
5. Click **Open Dashboard** for the full analysis: market snapshot,
   ranked table with Opportunity Scores, title pattern analysis,
   recurring keywords, competition level, gap finder, and the idea
   generator.
6. Come back and re-scan the same niche label on a later day to unlock
   the trend comparison panel.
7. Use **Export Report** on the dashboard to download a Markdown report.

## Recommended research pass
1. Scan the category's Hot New Releases page.
2. Scan two or more search-result pages for your niche.
3. Open the strongest 10–20 candidates individually and scan them to add
   their visible BSR, publisher, date, and category-rank data.
4. Open the dashboard to compare opportunity signals, patterns, recurring
   topics, gaps, and original concept recommendations. These are evidence
   from your scanned sample, not a guarantee of sales or profitability.

## Opportunity Score, explained
Each book gets a 0–100 score built from whatever signals were actually
captured (hover the score in the dashboard table for the exact
breakdown):
- Star rating — up to 25 pts
- Review count, log-scaled as an engagement proxy — up to 25 pts
- Amazon Best Sellers Rank, log-scaled (product-page data only) — up to 25 pts
- Best Seller / #1 Best Seller badge — up to 15 pts
- Recency of publication (product-page data only) — up to 10 pts

Missing signals score 0 for that factor rather than being estimated —
so a book you've only seen on a listing page (no BSR/pub date yet) will
score lower until you visit its product page, and the breakdown tooltip
tells you why.

## Files
- `manifest.json` — MV3 manifest
- `content.js` — scrapes the current Amazon listing or product page
- `common.js` — shared storage + analysis engine (scoring, pattern
  detection, keyword extraction, gap finder, title concept generator)
- `background.js` — minimal service worker (storage init only)
- `popup.html/css/js` — quick-capture popup
- `dashboard.html/css/js` — full analysis dashboard (opens in a new tab)

## Extending it
- **Selectors**: `content.js` uses multiple fallback selectors plus
  regex over visible text for resilience, but Amazon changes markup
  often. If scans start returning 0 books, open DevTools on the Amazon
  page and check what changed.
- **Niche keyword categories / stopwords**: edit `STOPWORDS` and the
  scoring weights at the top of `common.js`.
- **Title patterns**: add entries to `TITLE_PATTERNS` in `common.js`.
- **Opportunity Score weights**: adjust `computeOpportunityScore()` in
  `common.js`.

## A note on responsible use
This only reads pages you personally visit and click "scan" on — it
doesn't run in the background or crawl Amazon automatically. Keep it
that way: don't wire it up to automated mass-crawling, and be mindful
of Amazon's Terms of Service if you plan to use this for anything
beyond personal research.
