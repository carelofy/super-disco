// common.js — shared storage helpers and analysis engine.
// Loaded as a plain script (not a module) in both popup.html and dashboard.html.

const STORAGE_KEY = "bookScannerState";

function nicheKeyFromLabel(label) {
  return label.trim().toLowerCase().replace(/\s+/g, "-");
}

async function getState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || { niches: {}, activeNiche: null };
}

async function setState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
}

async function ensureNiche(label) {
  const state = await getState();
  const key = nicheKeyFromLabel(label);
  if (!state.niches[key]) {
    state.niches[key] = {
      label: label.trim(),
      createdAt: new Date().toISOString(),
      lastScanAt: null,
      books: {},
      snapshots: [],
      scans: []
    };
  }
  state.activeNiche = key;
  await setState(state);
  return key;
}

async function recordScan(nicheKey, scan) {
  const state = await getState();
  const niche = state.niches[nicheKey];
  if (!niche) return;
  niche.scans = Array.isArray(niche.scans) ? niche.scans : [];
  niche.scans.push({
    at: new Date().toISOString(),
    pageType: scan.pageType,
    listingKind: scan.listingKind || null,
    url: scan.url || null,
    bookCount: scan.bookCount || 0
  });
  niche.scans = niche.scans.slice(-100);
  await setState(state);
}

async function mergeBooksIntoNiche(nicheKey, books) {
  const state = await getState();
  const niche = state.niches[nicheKey];
  if (!niche) return;
  const now = new Date().toISOString();
  books.forEach(b => {
    const existing = niche.books[b.asin] || {};
    const sources = [...new Set([...(existing.sources || (existing.source ? [existing.source] : [])), b.source].filter(Boolean))];
    niche.books[b.asin] = {
      ...existing,
      ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== null && v !== undefined)),
      firstSeenAt: existing.firstSeenAt || now,
      lastSeenAt: now,
      sources,
      wasNewRelease: existing.wasNewRelease || b.source === "new-release"
    };
  });
  niche.lastScanAt = now;
  await setState(state);
}

async function listNiches() {
  const state = await getState();
  return Object.entries(state.niches).map(([key, n]) => ({
    key, label: n.label, bookCount: Object.keys(n.books).length, lastScanAt: n.lastScanAt
  }));
}

async function getNiche(nicheKey) {
  const state = await getState();
  return state.niches[nicheKey] || null;
}

async function deleteNiche(nicheKey) {
  const state = await getState();
  delete state.niches[nicheKey];
  if (state.activeNiche === nicheKey) state.activeNiche = null;
  await setState(state);
}

// ---------------- ANALYSIS ENGINE ----------------

const STOPWORDS = new Set(["the","a","an","of","to","and","for","in","on","your","you","how","with","is","that","this","from","or","by","as","it","be","are","at","its","our","their","new","complete","guide","book"]);

function tokenizeTitle(title) {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function extractKeywords(books, topN = 12) {
  const freq = {};
  books.forEach(b => {
    tokenizeTitle(b.title).forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  });
  return Object.entries(freq)
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

const TITLE_PATTERNS = [
  { name: "How-to opener", test: t => /^how to\b/i.test(t) },
  { name: '"The ___ Method"', test: t => /\bthe\s+.+\s+method\b/i.test(t) },
  { name: '"The ___ Diet"', test: t => /\bthe\s+.+\s+diet\b/i.test(t) },
  { name: "Complete/Ultimate guide", test: t => /\b(complete|ultimate)\s+guide\b/i.test(t) },
  { name: "Numbered plan (e.g. 30-Day)", test: t => /\b\d+[\-\s](day|week|minute|step)s?\b/i.test(t) },
  { name: "Step-by-step framing", test: t => /step[\-\s]by[\-\s]step/i.test(t) },
  { name: "For beginners / for X", test: t => /\bfor\s+(beginners|women|men|kids|dummies)\b/i.test(t) },
  { name: "Title: Subtitle structure", test: t => /:\s*\S/.test(t) },
  { name: "Question-form title", test: t => /\?\s*$/.test(t.trim()) }
];

function analyzeTitlePatterns(books) {
  const counts = TITLE_PATTERNS.map(p => ({
    name: p.name,
    count: books.filter(b => p.test(b.title || "")).length
  })).filter(p => p.count > 0);
  counts.sort((a, b) => b.count - a.count);
  return counts;
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function computeOpportunityScore(book, nicheStats) {
  const breakdown = [];
  let score = 0;

  // Rating (0-25)
  if (typeof book.rating === "number") {
    const pts = Math.round((book.rating / 5) * 25);
    score += pts;
    breakdown.push({ factor: "Star rating", points: pts, note: `${book.rating}/5` });
  } else {
    breakdown.push({ factor: "Star rating", points: 0, note: "Not available" });
  }

  // Review count, log-scaled as an engagement/velocity proxy (0-25)
  if (typeof book.reviewCount === "number") {
    const capped = Math.min(book.reviewCount, 20000);
    const pts = Math.round((Math.log10(capped + 1) / Math.log10(20001)) * 25);
    score += pts;
    breakdown.push({ factor: "Review count (engagement proxy)", points: pts, note: `${book.reviewCount.toLocaleString()} reviews` });
  } else {
    breakdown.push({ factor: "Review count (engagement proxy)", points: 0, note: "Not available" });
  }

  // Best Seller Rank, log-scaled inverse (0-25) — only from product-page data
  if (typeof book.bsrOverall === "number") {
    const pts = Math.round(Math.max(0, 25 - (Math.log10(book.bsrOverall + 1) / Math.log10(2000000)) * 25));
    score += pts;
    breakdown.push({ factor: "Amazon Best Sellers Rank", points: pts, note: `#${book.bsrOverall.toLocaleString()} in Books` });
  } else {
    breakdown.push({ factor: "Amazon Best Sellers Rank", points: 0, note: "Not available (visit the product page to capture this)" });
  }

  // Badge bonus (0-15)
  if (book.badge) {
    const pts = /^#1/.test(book.badge) ? 15 : 8;
    score += pts;
    breakdown.push({ factor: "Best Seller badge", points: pts, note: book.badge });
  } else {
    breakdown.push({ factor: "Best Seller badge", points: 0, note: "None shown" });
  }

  // Recency (0-10) — only if a real publication date was captured
  if (book.pubDate) {
    const days = (Date.now() - new Date(book.pubDate).getTime()) / 86400000;
    let pts = 0;
    if (!isNaN(days)) {
      if (days < 180) pts = 10;
      else if (days < 365) pts = 7;
      else if (days < 730) pts = 4;
      else pts = 1;
    }
    score += pts;
    breakdown.push({ factor: "Recency", points: pts, note: book.pubDate });
  } else {
    breakdown.push({ factor: "Recency", points: 0, note: "Not available (visit the product page to capture this)" });
  }

  return { score: Math.min(100, score), breakdown };
}

function computeCompetitionLevel(books) {
  const ratings = books.map(b => b.rating).filter(n => typeof n === "number");
  const reviews = books.map(b => b.reviewCount).filter(n => typeof n === "number");
  const medRating = median(ratings);
  const medReviews = median(reviews);
  const badgedCount = books.filter(b => b.badge).length;

  let signalScore = 0;
  if (medReviews !== null) {
    if (medReviews > 3000) signalScore += 3;
    else if (medReviews > 800) signalScore += 2;
    else if (medReviews > 150) signalScore += 1;
  }
  if (medRating !== null && medRating >= 4.5) signalScore += 1;
  if (badgedCount >= 2) signalScore += 1;
  if (books.length >= 15) signalScore += 1;

  let level;
  if (signalScore >= 5) level = "Highly Competitive";
  else if (signalScore >= 3) level = "Moderate Competition";
  else if (signalScore >= 1) level = "Low Competition";
  else level = "Insufficient data to classify";

  return { level, medRating, medReviews, badgedCount, sampleSize: books.length };
}

function findGaps(books, keywords) {
  // Heuristic only, based purely on this scanned sample — explicitly not
  // real Amazon search-volume/demand data, which this extension has no access to.
  const gaps = [];
  keywords.forEach(({ word, count }) => {
    const matching = books.filter(b => tokenizeTitle(b.title).includes(word));
    const reviews = matching.map(b => b.reviewCount).filter(n => typeof n === "number");
    const avgReviews = reviews.length ? reviews.reduce((a, b) => a + b, 0) / reviews.length : null;
    if (count <= 2) {
      gaps.push({
        theme: word,
        occurrences: count,
        avgReviews,
        note: "Appears rarely in this scanned sample — could indicate lower competition, or simply low interest. Not validated against real search-demand data."
      });
    }
  });
  return gaps.slice(0, 8);
}

function generateTitleConcepts(nicheLabel, keywords, patterns) {
  const topKeywords = keywords.slice(0, 6).map(k => k.word);
  const hooks = [
    w => `The ${cap(w)} Reset`,
    w => `Rethinking ${cap(w)}`,
    w => `${cap(w)}, Simplified`,
    w => `The Everyday ${cap(w)} Method`,
    w => `Beyond ${cap(w)}`
  ];
  const subtitleTemplates = [
    w => `A practical guide to making ${w} sustainable`,
    w => `What actually works, without the overwhelm`,
    w => `A clear path through the noise on ${w}`,
    w => `Small, realistic changes that add up`,
    w => `An honest look at ${w} for real life`
  ];

  if (topKeywords.length === 0) {
    return [];
  }

  const dominantPattern = patterns[0]?.name || null;

  return topKeywords.slice(0, 5).map((kw, i) => {
    const hookFn = hooks[i % hooks.length];
    const subFn = subtitleTemplates[i % subtitleTemplates.length];
    return {
      title: hookFn(kw),
      subtitle: subFn(kw),
      targetNiche: nicheLabel,
      targetReader: `Readers researching ${kw} within ${nicheLabel}`,
      corePromise: `A grounded, non-hype take on ${kw}, built around what recurs across current top performers.`,
      whyAttractive: dominantPattern
        ? `Matches a structural pattern seen repeatedly in this niche's top performers: ${dominantPattern}.`
        : `Built around "${kw}", a recurring theme across the scanned top performers in this niche.`,
      inspiredByTrend: `Keyword "${kw}" appeared ${keywords.find(k => k.word === kw)?.count || "multiple"} times across scanned titles in "${nicheLabel}".`
    };
  });
}

function cap(w) {
  return w.charAt(0).toUpperCase() + w.slice(1);
}

function compareSnapshots(prev, current) {
  if (!prev) return null;
  return {
    prevAt: prev.at,
    bookCountDelta: current.bookCount - prev.bookCount,
    avgRatingDelta: prev.avgRating !== null && current.avgRating !== null
      ? +(current.avgRating - prev.avgRating).toFixed(2) : null,
    avgReviewsDelta: prev.avgReviews !== null && current.avgReviews !== null
      ? Math.round(current.avgReviews - prev.avgReviews) : null
  };
}

function upsertDailySnapshot(niche) {
  const books = Object.values(niche.books);
  const snap = buildSnapshot(books);
  const today = snap.at.slice(0, 10);
  const lastIdx = niche.snapshots.length - 1;
  if (lastIdx >= 0 && niche.snapshots[lastIdx].at.slice(0, 10) === today) {
    niche.snapshots[lastIdx] = snap;
  } else {
    niche.snapshots.push(snap);
  }
  return niche;
}

function buildSnapshot(books) {
  const ratings = books.map(b => b.rating).filter(n => typeof n === "number");
  const reviews = books.map(b => b.reviewCount).filter(n => typeof n === "number");
  return {
    at: new Date().toISOString(),
    bookCount: books.length,
    avgRating: ratings.length ? +(ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : null,
    avgReviews: reviews.length ? Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length) : null
  };
}
