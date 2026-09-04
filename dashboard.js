const nicheSelect = document.getElementById("nicheSelect");
const emptyState = document.getElementById("emptyState");
const content = document.getElementById("content");

let currentNicheKey = null;
let currentBooks = [];
let sortState = { col: "opportunityScore", dir: "desc" };

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function naOr(val, fmt) {
  if (val === null || val === undefined || val === "") return '<span class="na">Not available</span>';
  return fmt ? fmt(val) : val;
}

async function loadNicheList() {
  const niches = await listNiches();
  nicheSelect.innerHTML = "";
  if (niches.length === 0) {
    emptyState.classList.remove("hidden");
    content.classList.add("hidden");
    return null;
  }
  emptyState.classList.add("hidden");
  content.classList.remove("hidden");

  niches.forEach(n => {
    const opt = document.createElement("option");
    opt.value = n.key;
    opt.textContent = `${n.label} (${n.bookCount})`;
    nicheSelect.appendChild(opt);
  });

  const state = await getState();
  const preferred = state.activeNiche && niches.some(n => n.key === state.activeNiche)
    ? state.activeNiche : niches[0].key;
  nicheSelect.value = preferred;
  return preferred;
}

async function loadNicheData(key) {
  currentNicheKey = key;
  const niche = await getNiche(key);
  if (!niche) return;

  currentBooks = Object.values(niche.books);
  const keywords = extractKeywords(currentBooks);
  const patterns = analyzeTitlePatterns(currentBooks);
  const competition = computeCompetitionLevel(currentBooks);
  const gaps = findGaps(currentBooks, keywords);

  currentBooks = currentBooks.map(b => ({
    ...b,
    _opportunity: computeOpportunityScore(b, competition)
  }));

  renderSnapshot(niche, competition);
  renderTrend(niche);
  renderTable();
  renderPatterns(patterns);
  renderKeywords(keywords);
  renderCompetition(competition, currentBooks);
  renderGaps(gaps);
  document.getElementById("ideasPanel").innerHTML = "";

  document.getElementById("ideasPanel").dataset.niche = niche.label;
  document.getElementById("ideasPanel").dataset.ready = "1";
  window._dashState = { niche, keywords, patterns };
}

function renderSnapshot(niche, competition) {
  const withScores = currentBooks;
  const top = [...withScores].sort((a, b) => b._opportunity.score - a._opportunity.score)[0];
  const ratings = withScores.map(b => b.rating).filter(n => typeof n === "number");
  const avgRating = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2) : null;

  const statusClass = competition.level.startsWith("Highly") ? "status-highly"
    : competition.level.startsWith("Moderate") ? "status-moderate"
    : competition.level.startsWith("Low") ? "status-low" : "";

  const bestRank = withScores
    .map(b => b.bsrOverall)
    .filter(n => typeof n === "number")
    .sort((a, b) => a - b)[0];
  const newReleaseCount = withScores.filter(b => b.wasNewRelease).length;
  const releaseScans = (niche.scans || []).filter(s => s.listingKind === "new-release").length;

  document.getElementById("snapshot").innerHTML = `
    <div class="snap-item"><div class="snap-label">Niche</div><div class="snap-value">${escapeHtml(niche.label)}</div></div>
    <div class="snap-item"><div class="snap-label">Market status</div><div class="snap-value ${statusClass}">${competition.level}</div></div>
    <div class="snap-item"><div class="snap-label">Top book</div><div class="snap-value" style="font-size:13px">${top ? escapeHtml(top.title).slice(0, 60) : "—"}</div></div>
    <div class="snap-item"><div class="snap-label">Best BSR found</div><div class="snap-value">${bestRank ? "#" + bestRank.toLocaleString() : "Not available"}</div></div>
    <div class="snap-item"><div class="snap-label">New releases tracked</div><div class="snap-value">${newReleaseCount}</div></div>
    <div class="snap-item"><div class="snap-label">New-release scans</div><div class="snap-value">${releaseScans}</div></div>
    <div class="snap-item"><div class="snap-label">Avg rating</div><div class="snap-value">${avgRating || "Not available"}</div></div>
    <div class="snap-item"><div class="snap-label">Books scanned</div><div class="snap-value">${withScores.length}</div></div>
    <div class="snap-item"><div class="snap-label">Last scan</div><div class="snap-value" style="font-size:13px">${fmtTime(niche.lastScanAt)}</div></div>
    <div class="snap-item"><div class="snap-label">Data retrieved</div><div class="snap-value" style="font-size:13px">Live from pages you scanned</div></div>
  `;
}

function renderTrend(niche) {
  const el = document.getElementById("trend");
  const snaps = niche.snapshots || [];
  if (snaps.length < 2) {
    el.innerHTML = `<div class="panel-title">Trend vs. previous scan</div>
      <p class="trend-empty">No historical data yet for this niche — this becomes available after you scan it again on a different day.</p>`;
    return;
  }
  const prev = snaps[snaps.length - 2];
  const curr = snaps[snaps.length - 1];
  const delta = compareSnapshots(prev, curr);
  el.innerHTML = `
    <div class="panel-title">Trend vs. previous scan (${fmtTime(prev.at)})</div>
    <div class="stat-line"><span class="k">Books tracked</span><span>${curr.bookCount} (${delta.bookCountDelta >= 0 ? "+" : ""}${delta.bookCountDelta})</span></div>
    <div class="stat-line"><span class="k">Avg rating</span><span>${curr.avgRating ?? "Not available"} (${delta.avgRatingDelta === null ? "—" : (delta.avgRatingDelta >= 0 ? "+" : "") + delta.avgRatingDelta})</span></div>
    <div class="stat-line"><span class="k">Avg reviews</span><span>${curr.avgReviews ?? "Not available"} (${delta.avgReviewsDelta === null ? "—" : (delta.avgReviewsDelta >= 0 ? "+" : "") + delta.avgReviewsDelta})</span></div>
  `;
}

function scoreClass(score) {
  if (score >= 65) return "score-high";
  if (score >= 35) return "score-mid";
  return "score-low";
}

function renderTable() {
  const tbody = document.getElementById("booksTbody");
  const sorted = sortBooks(currentBooks, sortState.col, sortState.dir);
  document.getElementById("rankedCount").textContent = `(${sorted.length})`;

  tbody.innerHTML = sorted.map(b => `
    <tr>
      <td class="title-cell">${b.url ? `<a href="${b.url}" target="_blank" rel="noopener">${escapeHtml(b.title)}</a>` : escapeHtml(b.title)}</td>
      <td>${b.author ? escapeHtml(b.author) : '<span class="na">Not available</span>'}</td>
      <td>${b.rating != null ? b.rating.toFixed(1) : '<span class="na">Not available</span>'}</td>
      <td>${b.reviewCount != null ? b.reviewCount.toLocaleString() : '<span class="na">Not available</span>'}</td>
      <td>${b.price ? escapeHtml(b.price) : '<span class="na">Not available</span>'}</td>
      <td>${b.format ? escapeHtml(b.format) : '<span class="na">Not available</span>'}</td>
      <td>${b.bsrOverall != null ? "#" + b.bsrOverall.toLocaleString() : '<span class="na">Not available</span>'}</td>
      <td>${b.pageRank != null && b.wasNewRelease ? "#" + b.pageRank.toLocaleString() : '<span class="na">Not available</span>'}</td>
      <td>${b.wasNewRelease ? "New release" : escapeHtml(b.source || "listing")}</td>
      <td>${b.badge ? `<span class="badge-tag">${escapeHtml(b.badge)}</span>` : '<span class="na">None</span>'}</td>
      <td><span class="score-pill ${scoreClass(b._opportunity.score)}" title="${b._opportunity.breakdown.map(x => x.factor + ': ' + x.points + ' (' + x.note + ')').join(' | ')}">${b._opportunity.score}</span></td>
    </tr>
  `).join("");
}

function sortBooks(books, col, dir) {
  const factor = dir === "asc" ? 1 : -1;
  return [...books].sort((a, b) => {
    let av, bv;
    if (col === "opportunityScore") { av = a._opportunity.score; bv = b._opportunity.score; }
    else { av = a[col]; bv = b[col]; }
    if (av === null || av === undefined) av = -Infinity;
    if (bv === null || bv === undefined) bv = -Infinity;
    if (typeof av === "string") return av.localeCompare(bv) * factor;
    return (av - bv) * factor;
  });
}

document.querySelectorAll("th[data-sort]").forEach(th => {
  th.addEventListener("click", () => {
    const col = th.dataset.sort;
    if (sortState.col === col) sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
    else { sortState.col = col; sortState.dir = "desc"; }
    renderTable();
  });
});

function renderPatterns(patterns) {
  const el = document.getElementById("patternsPanel");
  if (patterns.length === 0) {
    el.innerHTML = '<p class="disclaimer">No recurring title structures detected yet — scan more books.</p>';
    return;
  }
  el.innerHTML = patterns.map(p => `
    <div class="pattern-row"><span>${escapeHtml(p.name)}</span><span class="count-badge">${p.count}</span></div>
  `).join("");
}

function renderKeywords(keywords) {
  const el = document.getElementById("keywordsPanel");
  if (keywords.length === 0) {
    el.innerHTML = '<p class="disclaimer">Not enough titles yet to find recurring themes.</p>';
    return;
  }
  el.innerHTML = keywords.map(k => `
    <div class="keyword-row"><span>${escapeHtml(k.word)}</span><span class="count-badge">${k.count}×</span></div>
  `).join("");
}

function renderCompetition(competition, books) {
  const prices = books.map(b => b.price).filter(Boolean);
  const el = document.getElementById("competitionPanel");
  el.innerHTML = `
    <div class="stat-line"><span class="k">Sample size scanned</span><span>${competition.sampleSize}</span></div>
    <div class="stat-line"><span class="k">Median rating</span><span>${competition.medRating ?? "Not available"}</span></div>
    <div class="stat-line"><span class="k">Median review count</span><span>${competition.medReviews != null ? competition.medReviews.toLocaleString() : "Not available"}</span></div>
    <div class="stat-line"><span class="k">Books with Best Seller badge</span><span>${competition.badgedCount}</span></div>
    <div class="stat-line"><span class="k">Price range seen</span><span>${prices.length ? prices.slice(0, 3).join(", ") + (prices.length > 3 ? "…" : "") : "Not available"}</span></div>
  `;
}

function renderGaps(gaps) {
  const el = document.getElementById("gapsPanel");
  if (gaps.length === 0) {
    el.innerHTML = '<p class="disclaimer">No clear low-occurrence themes found yet in this sample.</p>';
    return;
  }
  el.innerHTML = gaps.map(g => `
    <div class="gap-row"><span>${escapeHtml(g.theme)} <span class="count-badge">(${g.occurrences}×)</span></span>
    <span>${g.avgReviews != null ? Math.round(g.avgReviews).toLocaleString() + " avg reviews" : "Not available"}</span></div>
  `).join("");
}

document.getElementById("generateIdeas").addEventListener("click", () => {
  if (!window._dashState) return;
  const { niche, keywords, patterns } = window._dashState;
  const ideas = generateTitleConcepts(niche.label, keywords, patterns);
  const el = document.getElementById("ideasPanel");
  if (ideas.length === 0) {
    el.innerHTML = '<p class="disclaimer">Not enough scanned titles yet to generate grounded concepts. Scan more books first.</p>';
    return;
  }
  el.innerHTML = ideas.map(idea => `
    <div class="idea-card">
      <div class="idea-title">${escapeHtml(idea.title)}</div>
      <div class="idea-subtitle">${escapeHtml(idea.subtitle)}</div>
      <div class="idea-meta">
        <div><b>Target niche:</b> ${escapeHtml(idea.targetNiche)}</div>
        <div><b>Target reader:</b> ${escapeHtml(idea.targetReader)}</div>
        <div><b>Core promise:</b> ${escapeHtml(idea.corePromise)}</div>
        <div><b>Why attractive:</b> ${escapeHtml(idea.whyAttractive)}</div>
        <div><b>Inspired by:</b> ${escapeHtml(idea.inspiredByTrend)}</div>
      </div>
    </div>
  `).join("");
});

document.getElementById("deleteBtn").addEventListener("click", async () => {
  if (!currentNicheKey) return;
  if (!confirm("Delete all scanned data for this niche? This can't be undone.")) return;
  await deleteNiche(currentNicheKey);
  const next = await loadNicheList();
  if (next) await loadNicheData(next);
});

document.getElementById("exportBtn").addEventListener("click", async () => {
  if (!currentNicheKey) return;
  const niche = await getNiche(currentNicheKey);
  const md = buildMarkdownReport(niche, currentBooks);
  const blob = new Blob([md], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nicheKeyFromLabel(niche.label)}-report.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

function buildMarkdownReport(niche, books) {
  const lines = [];
  lines.push(`# Amazon Book Market Report — ${niche.label}`);
  lines.push(`_Generated ${new Date().toLocaleString()} from live scans captured ${fmtTime(niche.lastScanAt)}_\n`);
  lines.push(`## Ranked Books\n`);
  lines.push(`| Title | Author | Rating | Reviews | BSR | New-release rank | Source | Opportunity |`);
  lines.push(`|---|---|---|---|---|---|---|---|`);
  sortBooks(books, "opportunityScore", "desc").forEach(b => {
    lines.push(`| ${b.title.replace(/\|/g, "-")} | ${b.author || "N/A"} | ${b.rating ?? "N/A"} | ${b.reviewCount ?? "N/A"} | ${b.bsrOverall ? "#" + b.bsrOverall : "N/A"} | ${b.wasNewRelease && b.pageRank ? "#" + b.pageRank : "N/A"} | ${b.wasNewRelease ? "New release" : (b.source || "listing")} | ${b._opportunity.score} |`);
  });
  lines.push(`\n_All fields marked N/A were not available on the scanned page(s). Nothing here is estimated or fabricated._`);
  return lines.join("\n");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

nicheSelect.addEventListener("change", () => loadNicheData(nicheSelect.value));

(async function start() {
  const key = await loadNicheList();
  if (key) await loadNicheData(key);
})();
