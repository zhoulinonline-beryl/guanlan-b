import { sectorReasons, stockAdvice } from "./analytics.js";

const app = document.querySelector("#app");
let stockChartPointer = null;
let skipAdvisorFocusRestoreOnce = false;
let advisorAbortController = null;
let advisorStreamTimer = null;
let advisorStreamRunId = 0;
const state = {
  page: "home",
  window: 5,
  sectorSort: "mainNet",
  sectorPage: 1,
  sectorSearch: "",
  sectorSearchDraft: "",
  sectorStockIndexLoading: false,
  sectorStockIndexReady: false,
  indices: [],
  sectors: [],
  sectorNews: {},
  sectorNewsLoading: false,
  stocksBySector: new Map(),
  recommendations: [],
  recommendMeta: null,
  advisorContexts: [],
  advisorMessages: [
    { role: "assistant", content: "说股票或板块，直接给我代码/名称和你的持仓情况。我会按偏激进短线思路给结论、价位和风控。" }
  ],
  advisorInput: "",
  advisorLoading: false,
  advisorComposing: false,
  advisorStreaming: false,
  settings: null,
  settingsDraft: null,
  settingsLoading: false,
  settingsSaving: false,
  portfolioText: "",
  portfolioRows: [],
  portfolioSummary: null,
  portfolioParser: "",
  portfolioSavedAt: "",
  portfolioLoading: false,
  ocrLoading: false,
  ocrProgress: "",
  selectedSectorId: "",
  modalPortfolioUpdate: false,
  modalSectorId: "",
  modalStockSort: "mainFlow",
  modalStock: null,
  modalIndex: null,
  loading: true,
  stockLoading: false,
  recLoading: false,
  error: "",
  updatedAt: ""
};

const sectorPageSize = 9;
const homeRefreshMs = 60_000;
const recommendRefreshMs = 15 * 60_000;
const cnMarketClosedDates2026 = new Set([
  "2026-01-01", "2026-01-02", "2026-01-03",
  "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
  "2026-04-04", "2026-04-05", "2026-04-06",
  "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
  "2026-06-19", "2026-06-20", "2026-06-21",
  "2026-09-25", "2026-09-26", "2026-09-27",
  "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"
]);
let sectorStockIndexQueueRunning = false;
let pendingAutoRefresh = new Set();

const icons = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>`,
  radar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><circle cx="12" cy="12" r="4"/></svg>`,
  list: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 0 0-15-6.7L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 15 6.7l3-2.7"/><path d="M21 21v-5h-5"/></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-.4-1.1 1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.1-.4 1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 .4 1.1 1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.2.38.6.6 1 .6h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1 .6Z"/></svg>`,
  chat: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8"/><path d="M8 13h5"/></svg>`,
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>`
};

function update(patch) {
  if (Object.prototype.hasOwnProperty.call(patch, "advisorInput") && patch.advisorInput === "") {
    skipAdvisorFocusRestoreOnce = true;
  }
  Object.assign(state, patch);
  render();
}

function captureAdvisorFocus() {
  const input = document.querySelector("[data-advisor-input]");
  if (!input || document.activeElement !== input) return null;
  return {
    value: input.value,
    start: input.selectionStart,
    end: input.selectionEnd,
    composing: state.advisorComposing
  };
}

function restoreAdvisorFocus(snapshot) {
  if (!snapshot || state.page !== "discussion") return;
  requestAnimationFrame(() => {
    const input = document.querySelector("[data-advisor-input]");
    if (!input) return;
    input.value = snapshot.value;
    state.advisorInput = snapshot.value;
    input.focus({ preventScroll: true });
    const start = Number.isFinite(snapshot.start) ? snapshot.start : input.value.length;
    const end = Number.isFinite(snapshot.end) ? snapshot.end : start;
    try {
      input.setSelectionRange(start, end);
    } catch {
      input.setSelectionRange(input.value.length, input.value.length);
    }
    state.advisorComposing = snapshot.composing;
  });
}

function focusAdvisorInput({ preserve = true } = {}) {
  if (state.page !== "discussion") return;
  requestAnimationFrame(() => {
    const input = document.querySelector("[data-advisor-input]");
    if (!input) return;
    const start = preserve && Number.isFinite(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = preserve && Number.isFinite(input.selectionEnd) ? input.selectionEnd : start;
    input.focus({ preventScroll: true });
    try {
      input.setSelectionRange(start, end);
    } catch {
      // Safari can throw while IME is composing; focus itself is enough.
    }
  });
}

function keepAdvisorInputFocused() {
  focusAdvisorInput({ preserve: true });
  setTimeout(() => focusAdvisorInput({ preserve: true }), 0);
}

function scrollChatToBottom({ smooth = false } = {}) {
  if (state.page !== "discussion") return;
  requestAnimationFrame(() => {
    const thread = document.querySelector(".chat-thread");
    if (!thread) return;
    thread.scrollTo({
      top: thread.scrollHeight,
      behavior: smooth ? "smooth" : "auto"
    });
  });
}

function fmt(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "--";
  if (!Number.isFinite(Number(value))) return "--";
  return Number(value).toFixed(digits);
}

function money(value) {
  if (value === null || value === undefined || value === "") return "--";
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  if (Math.abs(n) >= 100_000_000) return `${fmt(n / 100_000_000, 2)}亿`;
  if (Math.abs(n) >= 10_000) return `${fmt(n / 10_000, 1)}万`;
  return fmt(n, 0);
}

function pctClass(value) {
  return Number(value) > 0 ? "up" : Number(value) < 0 ? "down" : "flat";
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function selectedSector() {
  return state.sectors.find((sector) => sector.id === state.selectedSectorId) || state.sectors[0];
}

function sectorStocks(sectorId = state.selectedSectorId) {
  return state.stocksBySector.get(sectorId) || [];
}

function findStock(code) {
  const pools = [...state.stocksBySector.values(), state.recommendations];
  return pools.flat().find((item) => item.code === code);
}

function asStockFromPortfolio(row) {
  return {
    ...(row.quote || {}),
    code: row.code,
    name: row.quote?.name || row.name || row.code,
    price: row.quote?.price,
    pct: row.quote?.pct,
    amount: row.quote?.amount,
    turnover: row.quote?.turnover,
    score: 0,
    mainFlow: null,
    mainFlowPct: null,
    candles: []
  };
}

const sectorSorts = {
  mainNet: { label: "主力净额", hint: "按主力净额降序" },
  mainNetPct: { label: "主力占比", hint: "按主力净额占成交额比例降序" },
  mainInSpeed: { label: "流入速度", hint: "按超大单/大单正向分量占成交额降序" },
  mainOutSpeed: { label: "离场速度", hint: "按超大单/大单负向分量占成交额降序" }
};

const stockSorts = {
  mainFlow: { label: "主力净额", hint: "按成分股主力净额降序" },
  mainFlowPct: { label: "主力占比", hint: "按成分股主力占比降序" },
  mainInSpeed: { label: "流入速度", hint: "按成分股主力流入速度降序" },
  mainOutSpeed: { label: "离场速度", hint: "按成分股主力离场速度降序" }
};

function sortByMainForce(sectors, mode = state.sectorSort) {
  return [...sectors].sort((a, b) => {
    const field = sectorSorts[mode] ? mode : "mainNet";
    const aValue = Number(a[field]);
    const bValue = Number(b[field]);
    const aHasFlow = Number.isFinite(aValue);
    const bHasFlow = Number.isFinite(bValue);
    if (aHasFlow && bHasFlow) return bValue - aValue;
    if (aHasFlow) return -1;
    if (bHasFlow) return 1;
    return Number(b.attackScore || 0) - Number(a.attackScore || 0);
  });
}

function sortByMainNet(sectors) {
  return [...sectors].sort((a, b) => {
    const aHasFlow = a.mainNet !== null && a.mainNet !== undefined && Number.isFinite(Number(a.mainNet));
    const bHasFlow = b.mainNet !== null && b.mainNet !== undefined && Number.isFinite(Number(b.mainNet));
    if (aHasFlow && bHasFlow) return Number(b.mainNet) - Number(a.mainNet);
    if (aHasFlow) return -1;
    if (bHasFlow) return 1;
    return Number(b.attackScore || 0) - Number(a.attackScore || 0);
  });
}

function normalizeSearchText(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, "");
}

function sectorSearchResults() {
  const keyword = normalizeSearchText(state.sectorSearch);
  if (!keyword) return [];
  const direct = state.sectors
    .filter((sector) => normalizeSearchText(`${sector.name}${sector.code}${sector.id}`).includes(keyword))
    .map((sector) => ({ sector, matchedBy: "板块名称", stock: null }));
  const bySectorId = new Map(direct.map((item) => [item.sector.id, item]));
  for (const [sectorId, stocks] of state.stocksBySector.entries()) {
    const sector = state.sectors.find((item) => item.id === sectorId);
    if (!sector || bySectorId.has(sectorId)) continue;
    const stock = stocks.find((item) => normalizeSearchText(`${item.name}${item.code}`).includes(keyword));
    if (stock) bySectorId.set(sectorId, { sector, matchedBy: "股票名称", stock });
  }
  return [...bySectorId.values()].sort((a, b) => Number(b.sector.mainNet || 0) - Number(a.sector.mainNet || 0)).slice(0, 12);
}

function sectorSearchSuggestions(value = state.sectorSearchDraft) {
  const keyword = normalizeSearchText(value);
  if (!keyword) return [];
  const bySectorId = new Map();
  for (const sector of state.sectors) {
    const sectorText = normalizeSearchText(`${sector.name}${sector.code}${sector.id}`);
    if (sectorText.includes(keyword)) {
      bySectorId.set(sector.id, { sector, matchedBy: "板块", stock: null, score: 3 });
    }
  }
  for (const [sectorId, stocks] of state.stocksBySector.entries()) {
    const sector = state.sectors.find((item) => item.id === sectorId);
    if (!sector) continue;
    const stock = stocks.find((item) => normalizeSearchText(`${item.name}${item.code}`).includes(keyword));
    if (!stock) continue;
    const current = bySectorId.get(sectorId);
    if (!current || current.score < 4) {
      bySectorId.set(sectorId, { sector, matchedBy: "股票", stock, score: 4 });
    }
  }
  return [...bySectorId.values()]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Number(b.sector.mainNet || 0) - Number(a.sector.mainNet || 0);
    })
    .slice(0, 8);
}

function applySectorSearch(value) {
  const next = String(value || "").trim();
  update({ sectorSearch: next, sectorSearchDraft: value, sectorPage: 1 });
  ensureSectorStockIndex();
  loadSectorNewsForTop();
}

function updateSectorSearchDraftStatus(value) {
  const status = document.querySelector(".sector-search-status");
  if (!status) return;
  const draft = String(value || "").trim();
  const active = state.sectorSearch.trim();
  if (draft && draft !== active) {
    const count = sectorSearchSuggestions(draft).length;
    status.textContent = count
      ? `候选「${draft}」：找到 ${count} 个方向，点候选或按回车确认`
      : state.sectorStockIndexLoading ? "正在补齐股票匹配索引..." : "暂无候选，可换股票名/板块名";
  } else if (active) {
    const count = sectorSearchResults().length;
    status.textContent = `搜索「${active}」：${count ? `命中 ${count} 个板块` : state.sectorStockIndexLoading ? "正在通过股票名称匹配板块..." : "暂无匹配板块"}`;
  } else {
    status.textContent = state.sectorStockIndexReady ? "可按板块名、股票名或代码搜索，回车确认后过滤板块" : "股票到板块索引后台加载中，不影响行情浏览";
  }
}

function renderSectorSearchSuggestions(value = state.sectorSearchDraft) {
  const box = document.querySelector(".sector-search-suggestions");
  if (!box) return;
  const draft = String(value || "").trim();
  const active = state.sectorSearch.trim();
  const suggestions = draft && draft !== active ? sectorSearchSuggestions(draft) : [];
  box.hidden = !suggestions.length;
  box.innerHTML = suggestions.map((item) => `
    <button data-action="apply-search-suggestion" data-search-value="${escapeHtml(item.stock?.name || item.sector.name)}">
      <strong>${item.sector.name}</strong>
      <span>${item.matchedBy}${item.stock ? ` · ${item.stock.name} ${item.stock.code}` : ""} · 主力 ${money(item.sector.mainNet)}</span>
    </button>
  `).join("");
}

function homeSectorPageInfo(sectors = state.sectors) {
  const searchItems = sectorSearchResults();
  const sorted = searchItems.length ? searchItems.map((item) => item.sector) : sortByMainForce(sectors);
  const pageCount = Math.max(1, Math.ceil(sorted.length / sectorPageSize));
  const current = Math.min(Math.max(1, Number(state.sectorPage) || 1), pageCount);
  const start = (current - 1) * sectorPageSize;
  return {
    sorted,
    pageCount,
    current,
    start,
    items: sorted.slice(start, start + sectorPageSize),
    searchItems
  };
}

function sortStocks(stocks, mode = state.modalStockSort) {
  const field = stockSorts[mode] ? mode : "mainFlow";
  return [...stocks].sort((a, b) => {
    const av = Number(a[field]);
    const bv = Number(b[field]);
    const ah = Number.isFinite(av);
    const bh = Number.isFinite(bv);
    if (ah && bh) return bv - av;
    if (ah) return -1;
    if (bh) return 1;
    return Number(b.score || 0) - Number(a.score || 0);
  });
}

function bottomStocks(stocks) {
  return [...stocks]
    .filter((stock) => Number.isFinite(Number(stock.mainFlow)))
    .sort((a, b) => Number(a.mainFlow) - Number(b.mainFlow))
    .slice(0, 10);
}

function opportunityStocks(stocks) {
  return [...stocks]
    .filter((stock) => Number(stock.pct) >= -2 && Number(stock.pct) <= 8)
    .map((stock) => {
      const flow = Math.max(-10, Math.min(22, Number(stock.mainFlow || 0) / 100_000_000 * 2.2));
      const pctScore = Number(stock.pct) > 5 ? 6 - (Number(stock.pct) - 5) * 2 : Number(stock.pct) >= 0 ? 8 : 3;
      const speed = Math.max(0, Math.min(12, Number(stock.mainInSpeed || 0) * 1.2));
      const leavePenalty = Math.max(0, Math.min(14, Number(stock.mainOutSpeed || 0) * 1.4));
      return { ...stock, buyScore: Number(stock.score || 0) * 0.42 + flow + pctScore + speed - leavePenalty };
    })
    .sort((a, b) => b.buyScore - a.buyScore)
    .slice(0, 5);
}

function recommendationOpportunityScore(stock) {
  const score = Number(stock.buyOpportunityScore ?? stock.recScore ?? stock.buyScore ?? stock.score);
  return Number.isFinite(score) ? score : 0;
}

function topRecommendations(stocks = state.recommendations) {
  return [...stocks]
    .map((stock) => ({ ...stock, buyOpportunityScore: recommendationOpportunityScore(stock) }))
    .sort((a, b) => recommendationOpportunityScore(b) - recommendationOpportunityScore(a))
    .slice(0, 20);
}

function hasOpenOverlay() {
  return Boolean(state.modalStock || state.modalIndex || state.modalSectorId || state.modalPortfolioUpdate);
}

function chinaMarketNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now);
  const get = (type) => parts.find((item) => item.type === type)?.value || "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const weekday = get("weekday");
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return { date, weekday, minutes };
}

function isAshareTradingAutoRefreshTime(now = new Date()) {
  const market = chinaMarketNow(now);
  if (market.weekday === "Sat" || market.weekday === "Sun") return false;
  if (cnMarketClosedDates2026.has(market.date)) return false;
  const inMorning = market.minutes >= 9 * 60 + 15 && market.minutes <= 11 * 60 + 30;
  const inAfternoon = market.minutes >= 13 * 60 && market.minutes <= 15 * 60;
  return inMorning || inAfternoon;
}

function requestAutoRefresh(scope = "home") {
  if (!isAshareTradingAutoRefreshTime()) return;
  if (hasOpenOverlay()) {
    pendingAutoRefresh.add(scope);
    return;
  }
  pendingAutoRefresh.delete(scope);
  if (scope === "home" && state.page === "home") {
    loadSectors({ silent: true, clearStockCache: true, deferForOverlay: true });
  }
  if (scope === "recommend" && state.page === "recommend") {
    state.recommendations = [];
    loadRecommendations({ force: true });
  }
}

function flushDeferredAutoRefresh() {
  if (!pendingAutoRefresh.size || hasOpenOverlay()) return;
  const scopes = [...pendingAutoRefresh];
  pendingAutoRefresh.clear();
  scopes.forEach((scope) => requestAutoRefresh(scope));
}

function showToast(message) {
  let toast = document.querySelector("#toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
}

async function copyText(value, label = "内容") {
  const text = String(value || "").trim();
  if (!text) return;
  const fallbackCopy = () => {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand("copy");
    input.remove();
    if (!ok) throw new Error("fallback copy failed");
  };
  try {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        fallbackCopy();
      }
    } else {
      fallbackCopy();
    }
    showToast(`已复制${label}：${text}`);
  } catch {
    showToast("复制失败，请手动选择名称");
  }
}

function closeTopOverlay() {
  if (state.modalPortfolioUpdate && (state.ocrLoading || state.portfolioLoading)) return;
  if (state.modalStock) {
    stockChartPointer = null;
    update({ modalStock: null });
  } else if (state.modalIndex) {
    update({ modalIndex: null });
  } else if (state.modalSectorId) {
    update({ modalSectorId: "" });
  } else if (state.modalPortfolioUpdate) {
    update({ modalPortfolioUpdate: false });
  }
  setTimeout(() => flushDeferredAutoRefresh(), 120);
}

async function api(path) {
  const res = await fetch(path, { cache: "no-store" });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "行情接口异常");
  return json;
}

async function loadSectors({ silent = false, clearStockCache = false, deferForOverlay = false } = {}) {
  if (clearStockCache) state.stocksBySector.clear();
  if (!silent) update({ loading: true, error: "" });
  try {
    const [indexJson, sectorJson] = await Promise.all([
      api("/api/indices"),
      api(`/api/sectors?window=${state.window}`)
    ]);
    if (deferForOverlay && hasOpenOverlay()) {
      pendingAutoRefresh.add("home");
      if (!silent) update({ loading: false });
      return;
    }
    update({
      indices: indexJson.data,
      sectors: sectorJson.data,
      selectedSectorId: state.selectedSectorId || sectorJson.data[0]?.id || "",
      sectorPage: Math.min(state.sectorPage, Math.max(1, Math.ceil(sectorJson.data.length / sectorPageSize))),
      sectorStockIndexReady: false,
      sectorStockIndexLoading: false,
      updatedAt: sectorJson.updatedAt,
      loading: false,
      error: ""
    });
    loadSectorNewsForTop();
    setTimeout(() => ensureSectorStockIndex(), 0);
    if (state.page === "sector") loadStocks(state.selectedSectorId);
    if (state.page === "recommend") loadRecommendations();
  } catch (error) {
    update({ loading: false, error: error.message });
  }
}

async function loadSectorNewsForTop() {
  const sectors = homeSectorPageInfo().items;
  const names = sectors.map((sector) => sector.name).filter((name) => !state.sectorNews[name]);
  if (!names.length) return;
  update({ sectorNewsLoading: true });
  for (const name of names) {
    try {
      const json = await api(`/api/sector-news?names=${encodeURIComponent(name)}`);
      state.sectorNews = { ...state.sectorNews, ...json.data };
      render();
    } catch {
      // 单个板块新闻失败不阻塞其它板块和主行情。
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  update({ sectorNewsLoading: false });
}

async function loadStocks(sectorId) {
  if (!sectorId || state.stocksBySector.has(sectorId)) return;
  update({ stockLoading: true, error: "" });
  try {
    const json = await api(`/api/stocks?board=${sectorId}&window=${state.window}`);
    state.stocksBySector.set(sectorId, json.data);
    update({ stockLoading: false, updatedAt: json.updatedAt });
  } catch (error) {
    update({ stockLoading: false, error: error.message });
  }
}

async function ensureSectorStockIndex() {
  if (sectorStockIndexQueueRunning || state.sectorStockIndexReady || !state.sectors.length) return;
  sectorStockIndexQueueRunning = true;
  update({ sectorStockIndexLoading: true });
  try {
    const visibleIds = new Set(homeSectorPageInfo().items.map((sector) => sector.id));
    const sectors = sortByMainForce(state.sectors).sort((a, b) => {
      if (visibleIds.has(a.id) && !visibleIds.has(b.id)) return -1;
      if (!visibleIds.has(a.id) && visibleIds.has(b.id)) return 1;
      return 0;
    });
    for (const sector of sectors) {
      if (!state.stocksBySector.has(sector.id)) {
        try {
          const json = await api(`/api/stocks?board=${sector.id}&window=${state.window}`);
          state.stocksBySector.set(sector.id, json.data);
        } catch {
          state.stocksBySector.set(sector.id, []);
        }
      }
      if (state.sectorSearch) render();
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    update({ sectorStockIndexLoading: false, sectorStockIndexReady: true });
  } finally {
    sectorStockIndexQueueRunning = false;
  }
}

async function openStock(code) {
  const portfolioRow = state.portfolioRows.find((item) => item.code === code);
  const stock = portfolioRow ? asStockFromPortfolio(portfolioRow) : findStock(code);
  if (!stock) return;
  stockChartPointer = null;
  update({ modalStock: { ...stock, candles: [], news: [], newsLoading: true, newsError: "" } });
  const newsName = encodeURIComponent(stock.name || "");
  const [klineResult, newsResult] = await Promise.allSettled([
    api(`/api/kline?code=${stock.code}&market=${stock.market}`),
    api(`/api/news?code=${stock.code}&name=${newsName}`)
  ]);
  if (state.modalStock?.code !== stock.code) return;
  const nextStock = { ...state.modalStock, newsLoading: false };
  let updatedAt = state.updatedAt;
  if (klineResult.status === "fulfilled") {
    nextStock.candles = klineResult.value.data.klines;
    updatedAt = klineResult.value.updatedAt;
  } else {
    update({ error: klineResult.reason?.message || "K 线数据获取失败" });
  }
  if (newsResult.status === "fulfilled") {
    nextStock.news = newsResult.value.data || [];
  } else {
    nextStock.news = [];
    nextStock.newsError = newsResult.reason?.message || "新闻获取失败";
  }
  update({ modalStock: nextStock, updatedAt });
}

async function openIndex(symbol) {
  const index = state.indices.find((item) => item.id === symbol);
  if (!index) return;
  update({ modalIndex: { ...index, klines: [], loading: true, error: "" } });
  try {
    const json = await api(`/api/index-kline?symbol=${encodeURIComponent(symbol)}`);
    update({ modalIndex: { ...index, klines: json.data.klines, loading: false, error: "" }, updatedAt: json.updatedAt });
  } catch (error) {
    update({ modalIndex: { ...index, klines: [], loading: false, error: error.message } });
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

async function recognizePositionImage(file) {
  update({ ocrLoading: true, portfolioLoading: true, portfolioRows: [], portfolioSummary: null, portfolioParser: "", ocrProgress: "正在上传图片给 Kimi 识别..." });
  try {
    const imageData = await fileToDataUrl(file);
    update({ ocrProgress: "图片已读取，Kimi 正在识别名称、成本价和持有数量..." });
    const res = await fetch("/api/holdings/import-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageData })
    });
    update({ ocrProgress: "识别完成，正在保存持股并刷新操作建议..." });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "Kimi 识别失败");
    applyPortfolioPayload(json.data, json.updatedAt, "Kimi 已更新并保存我的持股");
    setTimeout(() => {
      if (!state.ocrLoading && state.modalPortfolioUpdate) update({ modalPortfolioUpdate: false });
    }, 700);
  } catch (error) {
    update({ ocrLoading: false, portfolioLoading: false, ocrProgress: error.message });
  }
}

async function analyzePortfolioText(textOverride = null) {
  const liveText = textOverride ?? document.querySelector("[data-portfolio-text]")?.value;
  if (liveText !== undefined) state.portfolioText = liveText;
  update({ portfolioLoading: true, error: "" });
  try {
    const res = await fetch("/api/holdings/import-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: state.portfolioText })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "仓位分析失败");
    const payload = Array.isArray(json.data) ? { rows: json.data, summary: null, parser: "rules" } : json.data || {};
    applyPortfolioPayload(payload, json.updatedAt, payload.rows?.length ? "文本已解析并保存为我的持股" : state.ocrProgress);
    if (payload.rows?.length) {
      setTimeout(() => {
        if (!state.portfolioLoading && state.modalPortfolioUpdate) update({ modalPortfolioUpdate: false });
      }, 700);
    }
  } catch (error) {
    update({ portfolioLoading: false, error: error.message });
  }
}

function applyPortfolioPayload(payload = {}, updatedAt = "", progress = "") {
  update({
    portfolioRows: payload.rows || [],
    portfolioSummary: payload.summary || null,
    portfolioParser: payload.parser || "",
    portfolioSavedAt: payload.savedAt || state.portfolioSavedAt,
    portfolioLoading: false,
    ocrLoading: false,
    ocrProgress: progress,
    updatedAt: updatedAt || state.updatedAt
  });
}

async function loadHoldings({ silent = false } = {}) {
  if (!silent) update({ portfolioLoading: true, error: "" });
  try {
    const json = await api("/api/holdings");
    applyPortfolioPayload(json.data, json.updatedAt, silent ? state.ocrProgress : "");
  } catch (error) {
    update({ portfolioLoading: false, error: error.message });
  }
}

async function clearHoldings() {
  update({ portfolioLoading: true, error: "" });
  try {
    const res = await fetch("/api/holdings", { method: "DELETE" });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "清空持股失败");
    update({
      portfolioText: "",
      portfolioRows: [],
      portfolioSummary: null,
      portfolioParser: "",
      portfolioSavedAt: json.data?.savedAt || "",
      portfolioLoading: false,
      ocrProgress: "已清空本地保存的持股",
      updatedAt: json.updatedAt
    });
  } catch (error) {
    update({ portfolioLoading: false, error: error.message });
  }
}

async function loadRecommendations({ force = false } = {}) {
  update({ recLoading: true, error: "" });
  try {
    const json = await api(`/api/recommendations${force ? "?force=1" : ""}`);
    update({
      recommendations: json.data || [],
      recommendMeta: {
        status: json.status,
        error: json.error,
        refreshedAt: json.refreshedAt,
        nextRefreshAt: json.nextRefreshAt
      },
      recLoading: false,
      updatedAt: json.updatedAt || state.updatedAt
    });
  } catch (error) {
    update({ recLoading: false, error: error.message });
  }
}

async function loadSettings() {
  update({ settingsLoading: true, error: "" });
  try {
    const json = await api("/api/settings");
    update({ settings: json.data, settingsDraft: { ...json.data, kimiApiKey: "" }, settingsLoading: false, updatedAt: json.updatedAt || state.updatedAt });
  } catch (error) {
    update({ settingsLoading: false, error: error.message });
  }
}

async function saveSettings() {
  const draft = state.settingsDraft || {};
  update({ settingsSaving: true, error: "" });
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kimiApiUrl: draft.kimiApiUrl,
        kimiModel: draft.kimiModel,
        kimiVisionModel: draft.kimiVisionModel,
        advisorModel: draft.advisorModel,
        advisorRole: draft.advisorRole,
        advisorStyle: draft.advisorStyle,
        marketDataSource: draft.marketDataSource,
        kimiApiKey: draft.kimiApiKey || "",
        useCache: draft.useCache
      })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "保存设置失败");
    update({ settings: json.data, settingsDraft: { ...json.data, kimiApiKey: "" }, settingsSaving: false, updatedAt: json.updatedAt || state.updatedAt });
    showToast("设置已保存");
  } catch (error) {
    update({ settingsSaving: false, error: error.message });
  }
}

async function sendAdvisorMessage(contentOverride = "") {
  if (state.advisorLoading || state.advisorStreaming) {
    interruptAdvisorOutput();
    return;
  }
  const content = (contentOverride || document.querySelector("[data-advisor-input]")?.value || state.advisorInput || "").trim();
  if (!content) {
    focusAdvisorInput();
    return;
  }
  const nextMessages = [...state.advisorMessages, { role: "user", content }];
  update({ advisorMessages: nextMessages, advisorInput: "", advisorLoading: true, error: "" });
  scrollChatToBottom({ smooth: true });
  focusAdvisorInput({ preserve: false });
  advisorAbortController = new AbortController();
  try {
    const res = await fetch("/api/advisor-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: nextMessages, contexts: state.advisorContexts }),
      signal: advisorAbortController.signal
    });
    const json = await res.json();
    if (!json.ok) {
      const error = new Error(json.error || "观澜理财师回复失败");
      error.advisorLog = json.log || null;
      throw error;
    }
    const streamingMessages = [...nextMessages, { ...json.data, content: "", streaming: true }];
    advisorAbortController = null;
    update({
      advisorMessages: streamingMessages,
      advisorLoading: false,
      updatedAt: json.updatedAt || state.updatedAt
    });
    scrollChatToBottom({ smooth: true });
    focusAdvisorInput();
    streamAdvisorReply(streamingMessages.length - 1, json.data.content || "");
  } catch (error) {
    advisorAbortController = null;
    if (error.name === "AbortError") {
      update({
        advisorMessages: [...nextMessages, { role: "assistant", content: "已中断模型请求。", interrupted: true }],
        advisorLoading: false,
        advisorStreaming: false,
        error: ""
      });
      scrollChatToBottom({ smooth: true });
      focusAdvisorInput();
      return;
    }
    update({
      advisorMessages: [...nextMessages, { role: "assistant", content: advisorFailureMessage(error, error.advisorLog) }],
      advisorLoading: false,
      error: error.message
    });
    scrollChatToBottom({ smooth: true });
    focusAdvisorInput();
  }
}

function streamAdvisorReply(index, fullText) {
  clearTimeout(advisorStreamTimer);
  advisorStreamRunId += 1;
  const runId = advisorStreamRunId;
  const text = String(fullText || "");
  if (!text) {
    state.advisorMessages[index] = { ...state.advisorMessages[index], content: "没有拿到有效回复。", streaming: false };
    render();
    scrollChatToBottom();
    return;
  }
  state.advisorStreaming = true;
  let offset = 0;
  const step = () => {
    if (runId !== advisorStreamRunId || !state.advisorStreaming) return;
    const chunkSize = /[，。；：、\n]/.test(text[offset] || "") ? 1 : 2;
    offset = Math.min(text.length, offset + chunkSize);
    const nextContent = text.slice(0, offset);
    state.advisorMessages[index] = {
      ...state.advisorMessages[index],
      content: nextContent,
      streaming: offset < text.length
    };
    const target = document.querySelector(`[data-chat-content="${index}"]`);
    if (target) {
      target.innerHTML = `${formatChatText(nextContent)}${offset < text.length ? `<span class="typing-cursor"></span>` : ""}`;
      scrollChatToBottom({ smooth: true });
    }
    if (offset < text.length) {
      advisorStreamTimer = setTimeout(step, 24);
      return;
    }
    advisorStreamTimer = null;
    state.advisorStreaming = false;
    render();
    scrollChatToBottom();
    focusAdvisorInput();
  };
  step();
}

function interruptAdvisorOutput() {
  if (advisorAbortController) {
    advisorAbortController.abort();
    advisorAbortController = null;
  }
  advisorStreamRunId += 1;
  clearTimeout(advisorStreamTimer);
  advisorStreamTimer = null;
  const messages = [...state.advisorMessages];
  const index = messages.findIndex((item) => item.streaming);
  if (index >= 0) {
    messages[index] = {
      ...messages[index],
      content: `${messages[index].content || ""}\n\n> 已中断输出。`,
      streaming: false,
      interrupted: true
    };
  }
  update({
    advisorMessages: messages,
    advisorLoading: false,
    advisorStreaming: false,
    error: ""
  });
  scrollChatToBottom({ smooth: true });
  focusAdvisorInput();
}

function clearAdvisorChat() {
  update({
    advisorInput: "",
    advisorContexts: [],
    advisorMessages: [
      { role: "assistant", content: "说股票或板块，直接给我代码/名称和你的持仓情况。我会按偏激进短线思路给结论、价位和风控。" }
    ]
  });
}

function compactCandleForContext(item) {
  return {
    day: item.day,
    open: Number(item.open),
    high: Number(item.high),
    low: Number(item.low),
    close: Number(item.close),
    volume: Number(item.volume || 0)
  };
}

function buildStockDiscussionContext(stock) {
  const advice = stockAdvice(stock);
  const latest = advice.latest || {};
  const levels = advice.levels || {};
  const news = (stock.news || []).slice(0, 3).map((item) => ({
    title: item.title || "",
    link: item.link || "",
    source: item.source || "",
    pubDate: item.pubDate || item.date || (item.time ? new Date(item.time).toISOString() : ""),
    kind: item.kind || "新闻",
    tone: item.tone || "中性观察",
    reason: item.reason || item.impact || "",
    advice: item.advice || ""
  }));
  return {
    type: "stock-detail",
    createdAt: new Date().toISOString(),
    stock: {
      name: stock.name || "",
      code: stock.code || "",
      market: stock.market || "",
      sectorName: stockSectorName(stock),
      price: Number(stock.price ?? latest.close),
      change: Number(stock.change || 0),
      pct: Number(stock.pct || 0),
      open: Number(stock.open ?? latest.open),
      high: Number(stock.high ?? latest.high),
      low: Number(stock.low ?? latest.low),
      prevClose: Number(stock.prevClose || 0),
      amount: Number(stock.amount || 0),
      volume: Number(stock.volume ?? latest.volume ?? 0),
      turnover: Number(stock.turnover || 0),
      mainFlow: Number(stock.mainFlow || 0),
      mainFlowPct: Number(stock.mainFlowPct || 0),
      mainInSpeed: Number(stock.mainInSpeed || 0),
      mainOutSpeed: Number(stock.mainOutSpeed || 0),
      score: Number(stock.score || 0),
      quoteSource: stock.quoteSource || stock.source || ""
    },
    advice: {
      action: advice.action,
      position: advice.position,
      summary: advice.summary,
      plan: advice.plan,
      risk: advice.risk,
      checks: advice.checks || [],
      levels: {
        pullbackBuy: Number(levels.pullbackBuy),
        breakoutBuy: Number(levels.breakoutBuy),
        stopLoss: Number(levels.stopLoss),
        firstTarget: Number(levels.firstTarget),
        secondTarget: Number(levels.secondTarget),
        support: Number(levels.support),
        resistance: Number(levels.resistance)
      },
      latest: {
        close: Number(latest.close),
        ma5: Number(latest.ma5),
        ma10: Number(latest.ma10),
        ma20: Number(latest.ma20),
        dif: Number(latest.dif),
        dea: Number(latest.dea),
        macdHist: Number(latest.macdHist),
        sar: Number(latest.sar),
        bollUpper: Number(latest.bollUpper),
        bollMid: Number(latest.bollMid),
        bollLower: Number(latest.bollLower)
      },
      explanation: advice.explanation || {}
    },
    candles: (stock.candles || []).slice(-45).map(compactCandleForContext),
    news
  };
}

function stockDiscussionReady(stock) {
  return Boolean(stock?.candles?.length && !stock.newsLoading);
}

function stockDiscussionPendingText(stock) {
  if (!stock?.candles?.length && stock?.newsLoading) return "K线和新闻政策仍在加载，完成后可加入讨论。";
  if (!stock?.candles?.length) return "K线数据仍在加载，完成后可加入讨论。";
  if (stock?.newsLoading) return "新闻政策仍在加载，完成后可加入讨论。";
  return "";
}

function joinStockDiscussion() {
  const stock = state.modalStock;
  if (!stock) return;
  if (!stockDiscussionReady(stock)) {
    showToast(stockDiscussionPendingText(stock) || "详情数据加载完成后才能加入讨论");
    return;
  }
  const context = buildStockDiscussionContext(stock);
  const prompt = [
    `已带入 ${stock.name}（${stock.code}）的详情页上下文：报价、K线、MACD、SAR、BOLL、操作计划和政策/新闻 Top3。`,
    "",
    "你可能想问：",
    `1. ${stock.name} 现在能不能买或加仓？`,
    "2. 如果已经持有，今天/明天怎么做T，什么价位出多少、接多少？",
    "3. 新闻政策有没有形成真实催化，还是只适合观察？",
    "4. 当前最关键的止损、减仓和突破触发位是什么？",
    "",
    "你直接问一个方向，我会按这份上下文继续。"
  ].join("\n");
  const contexts = [
    context,
    ...state.advisorContexts.filter((item) => item?.stock?.code !== stock.code)
  ].slice(0, 4);
  stockChartPointer = null;
  update({
    page: "discussion",
    modalStock: null,
    modalSectorId: "",
    modalIndex: null,
    modalPortfolioUpdate: false,
    advisorContexts: contexts,
    advisorMessages: [...state.advisorMessages, { role: "assistant", content: prompt }],
    advisorInput: ""
  });
  showToast(`已加入讨论：${stock.name}`);
  setTimeout(() => focusAdvisorInput({ preserve: false }), 60);
}

function buildRecommendationReason(stock, advice) {
  const mainText = stock.mainFlow === null || stock.mainFlow === undefined ? `板块雷达分 ${fmt(stock.sectorScore, 1)}` : `主力净额 ${money(stock.mainFlow)}`;
  return `${stock.sectorName} 方向靠前，${mainText}；个股进攻分 ${fmt(stock.score, 1)}，${advice.action}，${advice.plan}`;
}

function shell(content) {
  const sector = selectedSector();
  const titles = {
    home: ["全景雷达", "主要指数、板块行情、主力方向与雷达解释合并呈现"],
    recommend: ["股票推荐", "主力方向明显且适合当下建仓的跨板块候选"],
    portfolio: ["我的持股", "上传截图更新持股，持久化保存后结合板块、行情与新闻政策给出操作建议"],
    discussion: ["个股讨论", "和观澜理财师讨论股票、板块与短线交易计划"],
    settings: ["设置", "模型、AK 与缓存策略"]
  };
  const [title, subtitle] = titles[state.page];
  return `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark"><img src="./assets/guanlan-icon.png" alt="" /></span>
          <span class="brand-copy"><strong>观澜</strong><small>A Stock Radar</small></span>
        </div>
        <nav class="nav">
          ${navButton("home", "全景雷达", icons.radar)}
          ${navButton("recommend", "股票推荐", icons.home)}
          ${navButton("portfolio", "我的持股", icons.list)}
          ${navButton("discussion", "个股讨论", icons.chat)}
          ${navButton("settings", "设置", icons.settings)}
        </nav>
        <div class="market-clock">
          <span class="dot-live"></span>
          <div><strong>实时行情</strong><small>${state.updatedAt ? new Date(state.updatedAt).toLocaleString("zh-CN") : "等待同步"}</small></div>
        </div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div>
            <div class="page-title">${title}</div>
            <div class="page-subtitle">${subtitle}</div>
          </div>
          <div class="controls">
            <div class="segmented" aria-label="分析窗口">
              <button class="${state.window === 3 ? "active" : ""}" data-window="3">3日</button>
              <button class="${state.window === 5 ? "active" : ""}" data-window="5">5日</button>
            </div>
            <button class="ghost" data-action="refresh" title="刷新行情">${icons.refresh}刷新</button>
          </div>
        </header>
        ${state.error ? `<div class="ticker-alert">行情源连接失败：${state.error}</div>` : ""}
        <div class="content">${state.loading ? loadingView() : content}</div>
      </main>
      ${sectorModal()}
      ${stockModal()}
      ${indexModal()}
      ${portfolioUpdateModal()}
    </div>
  `;
}

function navButton(page, label, icon) {
  return `<button class="${state.page === page ? "active" : ""}" data-page="${page}">${icon}<span>${label}</span></button>`;
}

function loadingView() {
  return `<div class="panel empty"><span class="loader"></span> 正在同步真实 A 股行情...</div>`;
}

function sparkline(values = [], positive, fallback = {}) {
  const series = buildSparkSeries(values, fallback);
  const min = Math.min(...series);
  const max = Math.max(...series);
  const points = series.map((value, index) => {
    const x = (index / (series.length - 1)) * 180;
    const y = 36 - ((value - min) / Math.max(0.01, max - min)) * 30;
    return `${x},${y}`;
  }).join(" ");
  const color = positive ? "#ff4d57" : "#00b070";
  const area = `0,42 ${points} 180,42`;
  return `
    <svg class="spark" viewBox="0 0 180 42" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 34 H180" stroke="rgba(100,120,135,0.32)" stroke-width="1" />
      <polyline points="${area}" fill="${positive ? "rgba(255,77,87,0.12)" : "rgba(0,176,112,0.12)"}" stroke="none" />
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="180" cy="${points.split(" ").at(-1)?.split(",")[1] || 21}" r="2.8" fill="${color}" />
    </svg>
  `;
}

function buildSparkSeries(values = [], fallback = {}) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (clean.length >= 2 && Math.max(...clean) !== Math.min(...clean)) return clean;
  const current = Number(fallback.index);
  const pct = Number(fallback.pct);
  if (Number.isFinite(current) && current > 0 && Number.isFinite(pct)) {
    const start = current / (1 + pct / 100 || 1);
    const wiggle = Math.max(0.001, Math.abs(pct) / 100);
    return [start, start * (1 + wiggle * 0.18), start * (1 - wiggle * 0.12), start * (1 + pct / 100 * 0.56), current];
  }
  return [0.98, 1.01, 0.99, 1.02, 1];
}

function homePage() {
  const sectors = state.sectors;
  const pageInfo = homeSectorPageInfo(sectors);
  const homeSectors = pageInfo.sorted;
  const pagedSectors = pageInfo.items;
  const searchKeyword = state.sectorSearch.trim();
  const draftKeyword = state.sectorSearchDraft.trim();
  const hasUnsubmittedSearch = draftKeyword && draftKeyword !== searchKeyword;
  const draftSuggestions = hasUnsubmittedSearch ? sectorSearchSuggestions(draftKeyword) : [];
  const displaySearchKeyword = escapeHtml(searchKeyword);
  const displayDraftKeyword = escapeHtml(draftKeyword);
  const hot = sectors.filter((sector) => sector.pct > 0).length;
  const top = homeSectors[0];
  const flowValues = sectors.map((sector) => sector.mainNet).filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  const flow = flowValues.length ? flowValues.reduce((sum, value) => sum + Number(value), 0) : null;
  const amount = sectors.reduce((sum, sector) => sum + Number(sector.amount || 0), 0);
  return `
    <div class="section-head first-section"><h2>A 股大盘</h2><span class="hint">点击指数卡片查看最近 2 周趋势、量能与短线状态</span></div>
    <section class="grid index-grid">${state.indices.map(indexCard).join("")}</section>
    <section class="quote-strip">
      <div><span>上涨板块</span><strong class="up">${hot}/${sectors.length}</strong></div>
      <div><span>雷达首位</span><strong>${top?.name || "--"}</strong></div>
      <div><span>板块成交额</span><strong>${money(amount)}</strong></div>
      <div><span>主力净额</span><strong class="${pctClass(flow)}">${money(flow)}</strong></div>
    </section>
    <div class="section-head sector-toolbar">
      <div>
        <h2>板块行情与雷达解释</h2>
        <span class="hint">${sectorSorts[state.sectorSort]?.hint || "按主力资金排序"}，前排板块显示最近 1 天新闻/政策 Top3</span>
      </div>
      <div class="sort-tabs" aria-label="板块排序">
        ${Object.entries(sectorSorts).map(([key, item]) => `<button class="${state.sectorSort === key ? "active" : ""}" data-sector-sort="${key}">${item.label}</button>`).join("")}
      </div>
    </div>
    <section class="sector-search-panel">
      <div class="search-box">
        <input type="search" data-sector-search placeholder="搜板块或股票，例如 有色金属、华泰证券" value="${escapeHtml(state.sectorSearchDraft)}" />
        <button class="ghost mini-search-btn" data-action="submit-sector-search">搜索</button>
        ${state.sectorSearchDraft || state.sectorSearch ? `<button class="icon-btn" data-action="clear-sector-search" title="清空搜索">${icons.close}</button>` : ""}
      </div>
      <div class="sector-search-status">
        ${hasUnsubmittedSearch ? `候选「${displayDraftKeyword}」：${draftSuggestions.length ? `找到 ${draftSuggestions.length} 个方向，点候选或按回车确认` : state.sectorStockIndexLoading ? "正在补齐股票匹配索引..." : "暂无候选，可换股票名/板块名"}` : searchKeyword ? `搜索「${displaySearchKeyword}」：${pageInfo.searchItems.length ? `命中 ${pageInfo.searchItems.length} 个板块` : state.sectorStockIndexLoading ? "正在通过股票名称匹配板块..." : "暂无匹配板块"}` : state.sectorStockIndexReady ? "可按板块名、股票名或代码搜索，回车确认后过滤板块" : "股票到板块索引后台加载中，不影响行情浏览"}
      </div>
      <div class="sector-search-results sector-search-suggestions" ${hasUnsubmittedSearch && draftSuggestions.length ? "" : "hidden"}>
          ${draftSuggestions.map((item) => `
            <button data-action="apply-search-suggestion" data-search-value="${escapeHtml(item.stock?.name || item.sector.name)}">
              <strong>${item.sector.name}</strong>
              <span>${item.matchedBy}${item.stock ? ` · ${item.stock.name} ${item.stock.code}` : ""} · 主力 ${money(item.sector.mainNet)}</span>
            </button>
          `).join("")}
      </div>
      ${searchKeyword && pageInfo.searchItems.length ? `
        <div class="sector-search-results">
          ${pageInfo.searchItems.map((item) => `
            <button data-sector="${item.sector.id}">
              <strong>${item.sector.name}</strong>
              <span>${item.matchedBy}${item.stock ? ` · ${item.stock.name} ${item.stock.code}` : ""}</span>
            </button>
          `).join("")}
        </div>
      ` : ""}
    </section>
    <section class="grid sector-grid">${pagedSectors.map(sectorCard).join("")}</section>
    ${sectorPagination(pageInfo)}
  `;
}

function sectorPagination(pageInfo) {
  if (pageInfo.pageCount <= 1) return "";
  return `
    <div class="pager sector-pager">
      <button class="ghost" data-sector-page="prev" ${pageInfo.current <= 1 ? "disabled" : ""}>上一页</button>
      <span>第 ${pageInfo.current} / ${pageInfo.pageCount} 页 · 共 ${pageInfo.sorted.length} 个板块 · 每页 ${sectorPageSize} 条</span>
      <button class="ghost" data-sector-page="next" ${pageInfo.current >= pageInfo.pageCount ? "disabled" : ""}>下一页</button>
    </div>
  `;
}

function indexCard(index) {
  return `
    <article class="card index-card" data-index="${index.id}" title="查看 ${index.name} 两周趋势">
      <div class="index-card-head">
        <div>
          <div class="index-name">${index.name}</div>
          <div class="stock-code">${index.code}</div>
        </div>
        <div class="pct ${pctClass(index.pct)}">${index.pct > 0 ? "+" : ""}${fmt(index.pct)}%</div>
      </div>
      <div class="index-price ${pctClass(index.change)}">${fmt(index.price)}</div>
      <div class="quote-grid">
        <span>涨跌 <b class="${pctClass(index.change)}">${index.change > 0 ? "+" : ""}${fmt(index.change)}</b></span>
        <span>成交 ${money(index.amount)}</span>
        <span>高 ${fmt(index.high)}</span>
        <span>低 ${fmt(index.low)}</span>
      </div>
    </article>
  `;
}

function indexModal() {
  if (!state.modalIndex) return `<div class="overlay" id="indexOverlay"></div>`;
  const index = state.modalIndex;
  const analysis = indexAnalysis(index);
  return `
    <div class="overlay open" id="indexOverlay">
      <div class="shade" data-close></div>
      <section class="drawer index-drawer" role="dialog" aria-modal="true">
        <header class="drawer-head index-drawer-head">
          <div>
            <div class="page-title">${index.name} <span class="stock-code">${index.code}</span></div>
            <div class="page-subtitle">最近 2 周趋势 · ${analysis.summary}</div>
          </div>
          <button class="icon-btn" data-close title="关闭">${icons.close}</button>
        </header>
        <div class="drawer-body">
          <section class="broker-quote index-quote">
            <div class="broker-main-price">
              <span>${index.name}</span>
              <strong class="${pctClass(index.pct)}">${fmt(index.price)}</strong>
              <em class="${pctClass(index.pct)}">${index.change > 0 ? "+" : ""}${fmt(index.change)} / ${index.pct > 0 ? "+" : ""}${fmt(index.pct)}%</em>
            </div>
            <div class="broker-quote-grid">
              ${quoteCell("今开", fmt(index.open))}
              ${quoteCell("最高", fmt(index.high), "up")}
              ${quoteCell("最低", fmt(index.low), "down")}
              ${quoteCell("昨收", fmt(index.prevClose))}
              ${quoteCell("成交额", money(index.amount))}
              ${quoteCell("成交量", fmt(index.volume, 0))}
              ${quoteCell("两周涨跌", `${analysis.trendPct > 0 ? "+" : ""}${fmt(analysis.trendPct)}%`, pctClass(analysis.trendPct))}
              ${quoteCell("趋势状态", analysis.state, analysis.stateClass)}
            </div>
          </section>
          <section class="index-detail-grid">
            <div class="index-chart-panel">
              <div class="chart-toolbar">
                <span>日线走势</span>
                <b>${index.loading ? "同步中" : `${analysis.days} 个交易日`}</b>
              </div>
              <div class="index-chart-wrap">
                ${index.loading ? `<div class="chart-loading"><span class="loader"></span> 同步指数日线...</div>` : ""}
                ${index.error ? `<div class="chart-loading down">${index.error}</div>` : ""}
                <canvas id="indexChart"></canvas>
              </div>
            </div>
            <aside class="panel index-analysis">
              <div class="stock-action">
                <span>盘面判断</span>
                <strong class="${analysis.stateClass}">${analysis.state}</strong>
                <small>${analysis.summary}</small>
              </div>
              <div class="detail-metrics index-stat-grid">
                ${metricItem("两周涨跌", `${analysis.trendPct > 0 ? "+" : ""}${fmt(analysis.trendPct)}%`, pctClass(analysis.trendPct))}
                ${metricItem("区间振幅", `${fmt(analysis.amplitude)}%`)}
                ${metricItem("上涨天数", `${analysis.upDays}/${analysis.days}`)}
                ${metricItem("量能均值", money(analysis.avgAmount))}
                ${metricItem("区间高点", fmt(analysis.high), "up")}
                ${metricItem("区间低点", fmt(analysis.low), "down")}
              </div>
              <ul class="reason-list index-reasons">
                ${analysis.reasons.map((reason) => `<li>${reason}</li>`).join("")}
              </ul>
            </aside>
          </section>
          <section class="index-days">
            ${analysis.rows.map((row) => `
              <div>
                <span>${row.day.slice(5)}</span>
                <b class="${pctClass(row.pct)}">${row.pct > 0 ? "+" : ""}${fmt(row.pct)}%</b>
                <small>${fmt(row.close)}</small>
              </div>
            `).join("")}
          </section>
        </div>
      </section>
    </div>
  `;
}

function indexAnalysis(index) {
  const rows = (index.klines || []).filter((row) => Number.isFinite(Number(row.close))).slice(-10);
  if (!rows.length) {
    return {
      rows: [],
      days: 0,
      trendPct: 0,
      amplitude: 0,
      avgAmount: index.amount,
      high: index.high,
      low: index.low,
      upDays: 0,
      state: index.loading ? "数据同步" : "等待日线",
      stateClass: "flat",
      summary: index.loading ? "正在同步真实指数日线" : "暂未取得最近两周日线，先参考实时指数报价",
      reasons: ["实时行情已同步，日线源短暂不可用时会自动保留当前报价。"]
    };
  }
  const first = rows[0];
  const last = rows.at(-1);
  const high = Math.max(...rows.map((row) => row.high));
  const low = Math.min(...rows.map((row) => row.low));
  const trendPct = first.close ? ((last.close - first.close) / first.close) * 100 : 0;
  const amplitude = low ? ((high - low) / low) * 100 : 0;
  const avgAmount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0) / rows.length;
  const avgClose = rows.reduce((sum, row) => sum + row.close, 0) / rows.length;
  const upDays = rows.filter((row) => Number(row.pct) > 0 || row.close >= row.open).length;
  const recent = rows.slice(-3);
  const recentUp = recent.filter((row) => row.close >= row.open).length;
  let state = "震荡整理";
  let stateClass = "flat";
  if (trendPct >= 2 && last.close >= avgClose && recentUp >= 2) {
    state = "短线偏强";
    stateClass = "up";
  } else if (trendPct <= -2 && last.close < avgClose) {
    state = "短线转弱";
    stateClass = "down";
  }
  const summary = `${rows[0].day.slice(5)} 至 ${last.day.slice(5)} 累计${trendPct >= 0 ? "上涨" : "下跌"} ${fmt(Math.abs(trendPct))}%，${state === "短线偏强" ? "指数保持在两周均价上方，风险偏好回暖" : state === "短线转弱" ? "指数跌破两周均价，需观察承接力度" : "多空拉锯明显，等待方向选择"}`;
  const reasons = [
    `区间高低点为 ${fmt(high)} / ${fmt(low)}，振幅 ${fmt(amplitude)}%，可观察是否突破区间上沿。`,
    `最近 ${rows.length} 个交易日上涨 ${upDays} 天，短线连续性${upDays >= rows.length / 2 ? "尚可" : "偏弱"}。`,
    `日均成交额约 ${money(avgAmount)}，若后续放量站上均价，进攻信号会更清晰。`
  ];
  return { rows, days: rows.length, trendPct, amplitude, avgAmount, high, low, upDays, state, stateClass, summary, reasons };
}

function sectorCard(sector) {
  const reasons = sectorReasons({ ...sector, stocks: sectorStocks(sector.id) }).slice(0, 2);
  const news = state.sectorNews[sector.name] || [];
  return `
    <article class="card sector-card" data-sector="${sector.id}" title="查看 ${sector.name} TOP 10 推荐">
      <div class="sector-top">
        <div><div class="sector-name">${sector.name}</div><div class="sector-index">${sector.code} · ${fmt(sector.index)}</div></div>
        <div class="pct ${pctClass(sector.pct)}">${sector.pct > 0 ? "+" : ""}${fmt(sector.pct)}%</div>
      </div>
      ${sparkline(sector.history, sector.pct >= 0, sector)}
      <div class="quote-grid">
        <span>成交 ${money(sector.amount)}</span>
        <span>主力 <b class="${pctClass(sector.mainNet)}">${money(sector.mainNet)}</b></span>
        <span>主力占比 <b class="${pctClass(sector.mainNetPct)}">${fmt(sector.mainNetPct)}%</b></span>
        <span>流入速度 <b class="up">${fmt(sector.mainInSpeed)}%</b></span>
        <span>离场速度 <b class="down">${fmt(sector.mainOutSpeed)}%</b></span>
        <span>涨跌家 ${sector.upCount || 0}/${sector.downCount || 0}</span>
      </div>
      <div class="signal-row"><div class="scorebar"><span style="width:${sector.attackScore}%"></span></div><strong>${fmt(sector.attackScore, 1)}</strong></div>
      <ul class="sector-reasons">
        ${reasons.map((reason) => `<li>${reason}</li>`).join("")}
      </ul>
      <div class="sector-news">
        <div class="sector-news-title"><span>新闻政策 Top3</span><small>${state.sectorNewsLoading && !news.length ? "同步中" : "近 1 天"}</small></div>
        ${news.length ? news.slice(0, 3).map((item) => `
          <a href="${item.link}" target="_blank" rel="noreferrer">
            <b>${item.title}</b>
            <span>${item.impact}</span>
            ${item.advice ? `<span>${item.advice}</span>` : ""}
            <small>${item.source}${item.pubDate ? ` · ${new Date(item.pubDate).toLocaleDateString("zh-CN")}` : ""}</small>
          </a>
        `).join("") : `<p>${state.sectorNewsLoading ? "正在抓取该板块新闻政策..." : "近 1 天暂未抓取到匹配新闻政策。"}</p>`}
      </div>
      <div class="sector-card-foot"><span>点击查看 ${sector.name} TOP 10 · ${sectorSorts[state.sectorSort]?.label || "主力资金"}排序 · ${sector.source || "行情源"}</span><span>${icons.arrow}</span></div>
    </article>
  `;
}

function sectorModal() {
  if (!state.modalSectorId) return `<div class="overlay" id="sectorOverlay"></div>`;
  const sector = state.sectors.find((item) => item.id === state.modalSectorId) || selectedSector();
  const stocks = sectorStocks(sector?.id);
  const sortedTop = sortStocks(stocks).slice(0, 10);
  const bottoms = bottomStocks(stocks);
  const opportunities = opportunityStocks(stocks);
  const reasons = sector ? sectorReasons({ ...sector, stocks }).slice(0, 3) : [];
  return `
    <div class="overlay open" id="sectorOverlay">
      <div class="shade" data-close></div>
      <section class="drawer sector-drawer" role="dialog" aria-modal="true">
        <header class="drawer-head">
          <div>
            <div class="page-title">${sector?.name || "板块"} 股票雷达</div>
            <div class="page-subtitle">${stockSorts[state.modalStockSort]?.hint || "按成分股主力资金排序"} · 板块主力 ${money(sector?.mainNet)} · 主力占比 ${fmt(sector?.mainNetPct)}%</div>
          </div>
          <button class="icon-btn" data-close title="关闭">${icons.close}</button>
        </header>
        <div class="drawer-body">
          <section class="quote-strip sector-modal-strip">
            <div><span>板块指数</span><strong>${fmt(sector?.index)}</strong></div>
            <div><span>涨跌幅</span><strong class="${pctClass(sector?.pct)}">${Number(sector?.pct) > 0 ? "+" : ""}${fmt(sector?.pct)}%</strong></div>
            <div><span>成交额</span><strong>${money(sector?.amount)}</strong></div>
            <div><span>离场速度</span><strong class="down">${fmt(sector?.mainOutSpeed)}%</strong></div>
          </section>
          <section class="panel sector-modal-reasons">
            <ul class="reason-list">${reasons.map((reason) => `<li>${reason}</li>`).join("")}</ul>
          </section>
          ${state.stockLoading && !stocks.length ? loadingView() : stocks.length ? `
            <section class="sector-stock-toolbar">
              <div>
                <h2>当前最有机会买入 TOP 5</h2>
                <span class="hint">综合主力净额、流入速度、离场速度、涨跌位置和雷达分</span>
              </div>
              <div class="sort-tabs" aria-label="Top10排序">
                ${Object.entries(stockSorts).map(([key, item]) => `<button class="${state.modalStockSort === key ? "active" : ""}" data-stock-sort="${key}">${item.label}</button>`).join("")}
              </div>
            </section>
            ${opportunityCards(opportunities)}
            <div class="section-head"><h2>${stockSorts[state.modalStockSort]?.label || "主力资金"} TOP 10</h2><span class="hint">${stockSorts[state.modalStockSort]?.hint || ""}</span></div>
            ${stockTable(sortedTop, { rankLabel: "TOP" })}
            <div class="section-head"><h2>主力净额 Bottom 10</h2><span class="hint">按主力净额升序，观察资金离场和弱势拖累</span></div>
            ${stockTable(bottoms, { rankLabel: "BOTTOM" })}
          ` : `<div class="panel empty">正在加载 ${sector?.name || "该板块"} 股票雷达...</div>`}
        </div>
      </section>
    </div>
  `;
}

function opportunityCards(stocks) {
  if (!stocks.length) return `<div class="panel empty">暂无符合当前建仓过滤条件的股票。</div>`;
  return `
    <section class="grid opportunity-grid">
      ${stocks.map((stock, index) => `
        <article class="card opportunity-card" data-stock="${stock.code}">
          <div class="opportunity-rank">#${index + 1} · 买入机会分 ${fmt(stock.buyScore, 1)}</div>
          <div class="opportunity-name"><strong>${stock.name}</strong><span>${stock.code}</span></div>
          <div class="quote-grid">
            <span>现价 ${fmt(stock.price)}</span>
            <span>涨跌 <b class="${pctClass(stock.pct)}">${stock.pct > 0 ? "+" : ""}${fmt(stock.pct)}%</b></span>
            <span>主力 <b class="${pctClass(stock.mainFlow)}">${money(stock.mainFlow)}</b></span>
            <span>流入速度 <b class="up">${fmt(stock.mainInSpeed)}%</b></span>
          </div>
        </article>
      `).join("")}
    </section>
  `;
}

function radarPage() {
  const sector = selectedSector();
  const ranked = state.sectors;
  return `
    <section class="grid two-col">
      <div>
        <div class="section-head"><h2>资金可能进攻方向</h2><span class="hint">不是买卖承诺，只做盘面观察</span></div>
        <div class="radar-list">
          ${ranked.map((item, index) => `
            <article class="card direction-item ${item.id === sector?.id ? "active" : ""}" data-sector="${item.id}">
              <div>
                <div class="direction-rank">#${index + 1} · 雷达分 ${fmt(item.attackScore, 1)} · 主力 ${money(item.mainNet)}</div>
                <div class="sector-name">${item.name}</div>
                <div class="quote-grid compact"><span>成交 ${money(item.amount)}</span><span>涨跌家 ${item.upCount || 0}/${item.downCount || 0}</span></div>
              </div>
              <div class="pct ${pctClass(item.pct)}">${item.pct > 0 ? "+" : ""}${fmt(item.pct)}%</div>
            </article>
          `).join("")}
        </div>
      </div>
      <aside class="panel">
        <div class="section-head" style="margin-top:0"><h2>${sector?.name || "--"} 解释</h2><button class="primary" data-page="sector">${icons.arrow}TOP 10</button></div>
        <ul class="reason-list">${sector ? sectorReasons({ ...sector, stocks: sectorStocks(sector.id) }).map((reason) => `<li>${reason}</li>`).join("") : ""}</ul>
      </aside>
    </section>
  `;
}

function sectorPage() {
  const sector = selectedSector();
  const stocks = sectorStocks(sector?.id);
  return `
    <div class="section-head">
      <h2>${sector?.name || "--"} TOP 10 股票推荐</h2>
      <div class="controls">
        <select data-select-sector>
          ${state.sectors.map((item) => `<option value="${item.id}" ${item.id === sector?.id ? "selected" : ""}>${item.name}</option>`).join("")}
        </select>
        <button class="ghost" data-page="home">全景雷达</button>
      </div>
    </div>
    ${state.stockLoading ? loadingView() : stocks.length ? stockTable(stocks) : `<div class="panel empty">点击刷新或切换板块加载真实成分股。</div>`}
  `;
}

function recommendPage() {
  const meta = state.recommendMeta || {};
  const recommendations = topRecommendations();
  return `
    <div class="section-head first-section">
      <h2>股票推荐 Top20</h2>
      <span class="hint">后台每 15 分钟全板块扫描一次，按买入机会分倒序筛选主力方向明显且技术面允许建仓的候选</span>
    </div>
    <section class="quote-strip recommend-strip">
      <div><span>Top20候选</span><strong>${recommendations.length}只</strong></div>
      <div><span>后台状态</span><strong>${meta.status === "running" ? "扫描中" : meta.status === "error" ? "异常" : "已就绪"}</strong></div>
      <div><span>上次扫描</span><strong>${meta.refreshedAt ? new Date(meta.refreshedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "--"}</strong></div>
      <div><span>下次刷新</span><strong>${meta.nextRefreshAt ? new Date(meta.nextRefreshAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "15分钟内"}</strong></div>
    </section>
    ${meta.error ? `<div class="panel empty down">${meta.error}</div>` : ""}
    ${state.recLoading ? loadingView() : recommendations.length ? recommendationList(recommendations) : `<div class="panel empty">后台推荐池正在生成，稍后会自动刷新；也可以点击顶部刷新立即重算。</div>`}
  `;
}

function discussionPage() {
  return `
    <section class="discussion-layout">
      <div class="panel discussion-panel">
        <div class="discussion-head">
          <div>
            <h2>观澜理财师</h2>
            <span>默认 Kimi 2.5 · 偏激进 · 简约直接</span>
          </div>
          <button class="ghost" data-action="clear-advisor-chat">清空对话</button>
        </div>
        <div class="chat-thread">
          ${state.advisorMessages.map((message, index) => `
            <div class="chat-message ${message.role}">
              <span>${message.role === "user" ? "你" : "观澜理财师"}</span>
              <div class="chat-bubble" data-chat-content="${index}">${formatChatText(message.content)}${message.streaming ? `<span class="typing-cursor"></span>` : ""}</div>
              ${advisorChoicePanel(message, index)}
            </div>
          `).join("")}
          ${state.advisorLoading ? `<div class="chat-message assistant"><span>观澜理财师</span><div class="chat-bubble"><span class="loader"></span> 正在判断...</div></div>` : ""}
        </div>
        <div class="chat-inputbar">
          <textarea data-advisor-input placeholder="输入股票、代码或板块，例如：工业富联现在适合做T吗？半导体明天能追吗？">${escapeHtml(state.advisorInput)}</textarea>
          <button class="${state.advisorLoading || state.advisorStreaming ? "danger" : "primary"}" data-action="send-advisor-message">${state.advisorLoading || state.advisorStreaming ? "中断" : "发送"}</button>
        </div>
      </div>
    </section>
  `;
}

function cleanAdvisorChoiceText(text = "") {
  return String(text || "")
    .replace(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g, "$1")
    .replace(/^[\s>*-]+/, "")
    .replace(/^\d+[.)、]\s*/, "")
    .replace(/^[A-Da-d][.)、]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function advisorChoiceOptions(message = {}) {
  if (message.role !== "assistant" || message.streaming) return [];
  const text = String(message.content || "");
  const hasChoiceIntent = /(你可能想问|请选择|选择.*方向|你想.*(看|问|分析|讨论)|需要我.*(继续|按|帮你)|要不要|是否需要|下一步|我可以继续)/.test(text);
  if (!hasChoiceIntent) return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const options = [];
  let collecting = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("|") || /^[-:|\s]+$/.test(line)) continue;
    if (/(你可能想问|请选择|选择.*方向|你想.*(看|问|分析|讨论)|我可以继续|下一步)/.test(line)) {
      collecting = true;
      continue;
    }
    const optionMatch = line.match(/^(?:\d+[.)、]|[A-Da-d][.)、]|[-*])\s+(.{3,})$/);
    if (collecting && optionMatch) {
      const option = cleanAdvisorChoiceText(optionMatch[1]);
      if (option && !options.includes(option)) options.push(option);
    }
    if (collecting && options.length >= 8) break;
  }
  if (options.length < 2) {
    const questions = [...text.matchAll(/([^。！？\n]{4,90}[？?])/g)]
      .map((match) => cleanAdvisorChoiceText(match[1]))
      .filter((item) => item && !options.includes(item));
    options.push(...questions);
  }
  return options
    .filter((item) => !/^(结论|风险|逻辑|策略|操作建议)[:：]/.test(item))
    .slice(0, 6);
}

function advisorChoicePanel(message, index) {
  const options = advisorChoiceOptions(message);
  if (options.length < 2) return "";
  return `
    <div class="advisor-choice-panel" data-choice-panel="${index}">
      <div class="advisor-choice-head">
        <span>快速回复</span>
        <small>可多选</small>
      </div>
      <div class="advisor-choice-list">
        ${options.map((option, optionIndex) => `
          <div class="advisor-choice-token" role="button" tabindex="-1" data-choice-option data-choice-message="${index}" data-choice-text="${escapeHtml(option)}" aria-pressed="false">
            <i>${optionIndex + 1}</i>
            <span>${escapeHtml(option)}</span>
          </div>
        `).join("")}
      </div>
      <div class="advisor-choice-actions">
        <button class="ghost" tabindex="-1" data-action="fill-advisor-choices" data-choice-message="${index}">填入输入框</button>
        <button class="primary" tabindex="-1" data-action="send-advisor-choices" data-choice-message="${index}">发送选择</button>
      </div>
    </div>
  `;
}

function selectedAdvisorChoices(messageIndex) {
  return [...document.querySelectorAll(`[data-choice-option][data-choice-message="${messageIndex}"].selected`)]
    .map((item) => item.dataset.choiceText || item.value || "")
    .filter(Boolean);
}

function advisorChoicesReplyText(choices = []) {
  if (!choices.length) return "";
  return `我选择：\n${choices.map((item, index) => `${index + 1}. ${item}`).join("\n")}\n请按这些方向继续分析。`;
}

function advisorFailureMessage(error, log) {
  const lines = [`调用失败：${error.message || error}`];
  if (log) {
    lines.push("", "### 完整调用失败日志", "```json", JSON.stringify(log, null, 2), "```");
  }
  return lines.join("\n");
}

function formatChatText(text = "") {
  return renderMarkdown(text);
}

const emojiShortcodes = {
  ":rocket:": "🚀",
  ":fire:": "🔥",
  ":warning:": "⚠️",
  ":bulb:": "💡",
  ":chart_up:": "📈",
  ":chart_down:": "📉",
  ":money:": "💰",
  ":check:": "✅",
  ":x:": "❌",
  ":eyes:": "👀"
};

function renderEmojiShortcodes(text = "") {
  return String(text).replace(/:(rocket|fire|warning|bulb|chart_up|chart_down|money|check|x|eyes):/g, (match) => emojiShortcodes[match] || match);
}

function renderInlineMarkdown(text = "") {
  return renderEmojiShortcodes(escapeHtml(text))
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, `<a href="$2" target="_blank" rel="noreferrer">$1</a>`);
}

function renderMarkdown(text = "") {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let listType = "";
  let codeOpen = false;
  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = "";
    }
  };
  const openList = (type) => {
    if (listType === type) return;
    closeList();
    listType = type;
    html.push(`<${type}>`);
  };
  const isTableSeparator = (line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
  const isTableRow = (line) => line.trim().includes("|") && !line.trim().startsWith("```");
  const tableCells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.trimEnd();
    if (line.trim().startsWith("```")) {
      closeList();
      if (codeOpen) {
        html.push("</code></pre>");
        codeOpen = false;
      } else {
        html.push("<pre><code>");
        codeOpen = true;
      }
      continue;
    }
    if (codeOpen) {
      html.push(`${escapeHtml(rawLine)}\n`);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      html.push(`<h${heading[1].length + 3}>${renderInlineMarkdown(heading[2])}</h${heading[1].length + 3}>`);
      continue;
    }
    const unorderedItem = line.match(/^[-*]\s+(.+)$/);
    if (unorderedItem) {
      openList("ul");
      html.push(`<li>${renderInlineMarkdown(unorderedItem[1])}</li>`);
      continue;
    }
    const orderedItem = line.match(/^\d+[.)]\s+(.+)$/);
    if (orderedItem) {
      openList("ol");
      html.push(`<li>${renderInlineMarkdown(orderedItem[1])}</li>`);
      continue;
    }
    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      closeList();
      html.push(`<blockquote>${renderInlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }
    if (isTableRow(line) && isTableSeparator(lines[i + 1] || "")) {
      closeList();
      const headers = tableCells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i]) && lines[i].trim()) {
        rows.push(tableCells(lines[i]));
        i += 1;
      }
      i -= 1;
      html.push("<div class=\"markdown-table-wrap\"><table><thead><tr>");
      headers.forEach((cell) => html.push(`<th>${renderInlineMarkdown(cell)}</th>`));
      html.push("</tr></thead><tbody>");
      rows.forEach((row) => {
        html.push("<tr>");
        headers.forEach((_, index) => html.push(`<td>${renderInlineMarkdown(row[index] || "")}</td>`));
        html.push("</tr>");
      });
      html.push("</tbody></table></div>");
      continue;
    }
    closeList();
    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }
  closeList();
  if (codeOpen) html.push("</code></pre>");
  return html.join("");
}

function settingsPage() {
  const draft = state.settingsDraft || state.settings || {};
  const modelOptions = ["moonshot-v1-auto", "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"];
  const advisorOptions = ["kimi-k2.5", "moonshot-v1-auto", "moonshot-v1-32k", "moonshot-v1-128k"];
  const visionOptions = ["moonshot-v1-8k-vision-preview", "moonshot-v1-32k-vision-preview"];
  const marketSourceOptions = [
    ["auto", "自动兜底（推荐）", "腾讯、东方财富、新浪/搜狐按接口类型自动选择，失败后继续尝试其它源。"],
    ["tencent", "优先腾讯行情", "个股报价和 K 线优先使用腾讯，失败后自动兜底。"],
    ["eastmoney", "优先东方财富", "板块资金、成分股、K 线优先使用东方财富，失败后自动兜底。"],
    ["sina", "优先新浪/搜狐", "报价和 K 线优先新浪，板块优先搜狐，失败后自动兜底。"]
  ];
  if (state.settingsLoading && !state.settings) return loadingView();
  return `
    <section class="settings-layout">
      <div class="panel settings-panel">
        <div class="settings-summary">
          <span>AK ${draft.hasKimiApiKey ? "已配置" : "未配置"}</span>
          <span>行情源 ${marketSourceOptions.find(([key]) => key === (draft.marketDataSource || "auto"))?.[1] || "自动兜底"}</span>
          <span>缓存 ${draft.useCache !== false ? "开启" : "关闭"}</span>
        </div>
        <section class="settings-section">
          <div class="settings-section-title">
            <h2>调用模型</h2>
            <span>设置 Kimi/Moonshot 模型与 API。</span>
          </div>
          <label class="setting-row">
            <span><strong>文本模型</strong><small>新闻、推荐、持股分析</small></span>
            <select data-setting="kimiModel">
              ${modelOptions.map((item) => `<option value="${item}" ${draft.kimiModel === item ? "selected" : ""}>${item}</option>`).join("")}
            </select>
          </label>
          <label class="setting-row">
            <span><strong>OCR 模型</strong><small>识别持股截图</small></span>
            <select data-setting="kimiVisionModel">
              ${visionOptions.map((item) => `<option value="${item}" ${draft.kimiVisionModel === item ? "selected" : ""}>${item}</option>`).join("")}
            </select>
          </label>
          <label class="setting-row">
            <span><strong>API 地址</strong><small>Chat Completions</small></span>
            <input data-setting="kimiApiUrl" value="${escapeHtml(draft.kimiApiUrl || "")}" placeholder="https://api.moonshot.cn/v1/chat/completions" />
          </label>
          <label class="setting-row">
            <span><strong>Kimi AK</strong><small>留空则保留原 AK</small></span>
            <input type="password" data-setting="kimiApiKey" value="${escapeHtml(draft.kimiApiKey || "")}" placeholder="${draft.hasKimiApiKey ? `已保存 ${draft.kimiApiKeyMasked}` : "请输入 Moonshot/Kimi API Key"}" autocomplete="off" />
          </label>
        </section>
        <section class="settings-section">
          <div class="settings-section-title">
            <h2>行情数据源</h2>
            <span>手动选择优先源，失败后仍自动兜底。</span>
          </div>
          <label class="setting-row">
            <span><strong>优先数据源</strong><small>${marketSourceOptions.find(([key]) => key === (draft.marketDataSource || "auto"))?.[2] || marketSourceOptions[0][2]}</small></span>
            <select data-setting="marketDataSource">
              ${marketSourceOptions.map(([key, label]) => `<option value="${key}" ${(draft.marketDataSource || "auto") === key ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
        </section>
        <section class="settings-section">
          <div class="settings-section-title">
            <h2>观澜理财师</h2>
            <span>控制个股讨论的角色、模型和回答风格。</span>
          </div>
          <label class="setting-row">
            <span><strong>理财师模型</strong><small>个股/板块对话</small></span>
            <select data-setting="advisorModel">
              ${advisorOptions.map((item) => `<option value="${item}" ${draft.advisorModel === item ? "selected" : ""}>${item}</option>`).join("")}
            </select>
          </label>
          <label class="setting-row setting-row-wide">
            <span><strong>角色定义</strong><small>智能体身份</small></span>
            <textarea data-setting="advisorRole" rows="5">${escapeHtml(draft.advisorRole || "")}</textarea>
          </label>
          <label class="setting-row setting-row-wide">
            <span><strong>对话风格</strong><small>激进程度与篇幅</small></span>
            <textarea data-setting="advisorStyle" rows="4">${escapeHtml(draft.advisorStyle || "")}</textarea>
          </label>
        </section>
        <section class="settings-section">
          <div class="settings-section-title">
            <h2>缓存策略</h2>
            <span>复用历史行情、新闻和模型结果。</span>
          </div>
          <label class="setting-row toggle-row">
            <span>
              <strong>使用缓存</strong>
              <small>降低等待和调用成本</small>
            </span>
            <input type="checkbox" data-setting="useCache" ${draft.useCache !== false ? "checked" : ""} />
          </label>
        </section>
        <div class="settings-actions">
          <button class="primary" data-action="save-settings" ${state.settingsSaving ? "disabled" : ""}>${state.settingsSaving ? "应用中..." : "保存并应用"}</button>
        </div>
      </div>
    </section>
  `;
}

function portfolioPage() {
  const summary = state.portfolioSummary;
  return `
    <section class="portfolio-action-bar">
      <div>
        <strong>持股操作</strong>
        <span>${state.portfolioSavedAt ? `最近更新 ${new Date(state.portfolioSavedAt).toLocaleString("zh-CN")}` : "尚未保存持股"}</span>
      </div>
      <div class="controls">
        <button class="primary" data-action="open-portfolio-update">${icons.list}更新持股</button>
        <button class="ghost" data-action="reload-portfolio">刷新建议</button>
        <button class="ghost danger" data-action="clear-portfolio">清空持股</button>
      </div>
    </section>
    <section class="portfolio-hero">
      ${portfolioSummaryView(summary)}
    </section>
    <section class="panel portfolio-advice-panel">
      <div class="section-head first-section portfolio-advice-head">
        <div>
          <h2>持股诊断</h2>
          <span class="hint">结合实时行情、板块强弱、新闻政策和最近10天交易数据</span>
        </div>
      </div>
      ${state.portfolioLoading && !state.modalPortfolioUpdate ? loadingView() : state.portfolioRows.length ? portfolioResult(state.portfolioRows, state.portfolioSummary) : `<div class="empty">点击“更新持股”上传截图后，这里会显示持股诊断和每只股票做T建议。</div>`}
    </section>
  `;
}

function portfolioUpdateModal() {
  if (!state.modalPortfolioUpdate) return `<div class="overlay" id="portfolioUpdateOverlay"></div>`;
  const busy = state.ocrLoading || state.portfolioLoading;
  return `
    <div class="overlay open" id="portfolioUpdateOverlay">
      <div class="shade" data-close></div>
      <section class="mini-dialog portfolio-update-dialog" role="dialog" aria-modal="true">
        <div class="drawer-head">
          <div class="drawer-title-group">
            <div class="page-title">更新持股</div>
            <div class="page-subtitle">上传截图后自动识别、保存，并触发当前持股分析</div>
          </div>
          <button class="icon-btn" data-close title="关闭" ${busy ? "disabled" : ""}>${icons.close}</button>
        </div>
        <div class="portfolio-update-body">
          <label class="upload-box upload-box-large ${busy ? "is-loading" : ""}">
            <input type="file" accept="image/*" data-position-image ${busy ? "disabled" : ""} />
            <strong>${busy ? "正在处理持股截图" : "上传持股截图"}</strong>
            <span>${state.ocrProgress || "Kimi 将识别股票名称、成本价和持有数量；完成后浮层会自动关闭。"}</span>
          </label>
          <div class="upload-progress ${busy ? "active" : ""}">
            <span></span>
          </div>
          <textarea class="ocr-textarea compact-textarea" data-portfolio-text placeholder="兜底导入：也可以粘贴 持股名称 / 持有数量 / 成本价，再点击保存并分析。" ${busy ? "disabled" : ""}>${state.portfolioText}</textarea>
          <div class="controls">
            <button class="primary" data-action="analyze-portfolio" ${busy ? "disabled" : ""}>保存并分析</button>
            <button class="ghost" data-close ${busy ? "disabled" : ""}>取消</button>
          </div>
        </div>
      </section>
    </div>
  `;
}

function portfolioResult(rows, summary) {
  return `
    <div class="portfolio-list">
      ${rows.map((row) => `
        <article class="portfolio-card card" data-stock="${row.code}">
          <div class="portfolio-head">
            <div><strong>${row.quote?.name || row.name || row.code}</strong><span>${row.sector?.name ? `${row.sector.name} · 雷达分 ${fmt(row.sector.attackScore, 1)}` : row.code || ""}</span></div>
            <div class="${pctClass(row.quote?.pct)}">现价 ${fmt(row.quote?.price)} · ${row.quote?.pct > 0 ? "+" : ""}${fmt(row.quote?.pct)}%</div>
          </div>
          <div class="detail-metrics">
            ${metricItem("持有数量", row.qty ? `${row.qty}股` : "--")}
            ${metricItem("成本价", fmt(row.cost))}
            ${metricItem("当前价", fmt(row.quote?.price), pctClass(row.quote?.pct))}
            ${metricItem("浮动盈亏", row.pnlPct === null ? "--" : `${row.pnlPct > 0 ? "+" : ""}${fmt(row.pnlPct)}%`, pctClass(row.pnlPct))}
          </div>
          <div class="stock-action compact-action">
            <span>操作建议</span>
            <strong>${row.advice.action}</strong>
            <small>${row.advice.plan} ${row.advice.risk} ${row.newsAdvice || ""}</small>
          </div>
          ${portfolioTAdvice(row.tAdvice)}
          ${portfolioCatalystLine(row)}
        </article>
      `).join("")}
    </div>
  `;
}

function portfolioTAdvice(advice = {}) {
  if (!advice) return "";
  return `
    <div class="portfolio-t-box">
      <div class="portfolio-t-head">
        <span>近10日做T · ${advice.pulse?.label || "波动策略"}</span>
        <strong>${advice.action || "--"}</strong>
      </div>
      <div class="portfolio-aggressive">
        <span>激进度</span>
        <b style="--score:${Math.max(0, Math.min(100, Number(advice.aggressiveScore || 0)))}%"></b>
        <strong>${fmt(advice.aggressiveScore, 0)}</strong>
      </div>
      <div class="portfolio-t-levels">
        <span>低吸 <b>${fmt(advice.lowBuy)}</b></span>
        <span>高抛 <b>${fmt(advice.highSell)}</b></span>
        <span>止损 <b>${fmt(advice.stopLoss)}</b></span>
        <span>机动仓 <b>${advice.position || "--"}</b></span>
      </div>
      <p>${advice.plan || ""}</p>
      ${portfolioTOrders(advice.orders)}
      <small>${advice.reason || ""}${advice.pulse?.detail ? ` ${advice.pulse.detail}。` : ""}</small>
    </div>
  `;
}

function portfolioTOrders(orders = []) {
  if (!orders.length) return `<div class="portfolio-t-orders empty-orders">暂无可执行股数，先观察价格触发。</div>`;
  return `
    <div class="portfolio-t-orders">
      ${orders.map((order) => `
        <div class="t-order ${order.side === "买入" || order.side === "买回" ? "buy" : order.side === "止损" ? "risk" : "sell"}">
          <span>${order.side}</span>
          <strong>${fmt(order.price)} · ${order.qty || 0}股</strong>
          <small>${order.note || ""}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function portfolioCatalystLine(row = {}) {
  const stockNews = row.news?.[0];
  const policyNews = row.policyNews?.[0];
  if (!stockNews && !policyNews) return "";
  return `
    <div class="portfolio-catalysts">
      ${stockNews ? portfolioCatalystLink("个股", stockNews) : ""}
      ${policyNews ? portfolioCatalystLink("政策", policyNews) : ""}
    </div>
  `;
}

function portfolioCatalystLink(label, item = {}) {
  return `
    <a href="${item.url || item.link || "#"}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">
      <span>${label}</span>
      <strong>${item.title || "相关新闻"}</strong>
    </a>
  `;
}

function newsTimeLabel(item = {}) {
  if (item.pubDate) return ` · ${item.pubDate}`;
  if (!item.time) return "";
  const time = Number(item.time);
  if (!Number.isFinite(time)) return ` · ${item.time}`;
  return ` · ${new Date(time).toLocaleDateString("zh-CN")}`;
}

function portfolioSummaryView(summary) {
  if (!summary) return "";
  const strongest = summary.strongest;
  const weakest = summary.weakest;
  return `
    <section class="portfolio-summary card">
      <div class="portfolio-summary-head">
        <div>
          <span>组合总结</span>
          <strong class="${pctClass(summary.totalPnlPct)}">${summary.tone || "等待分析"}</strong>
        </div>
        <small>${state.portfolioParser?.includes("kimi") ? "Kimi 识别 + 持久化持股" : "本地持股 + 实时行情"}</small>
      </div>
      <div class="detail-metrics portfolio-summary-metrics">
        ${metricItem("持仓数量", `${summary.count || 0}只`)}
        ${metricItem("当前市值", money(summary.totalMarketValue))}
        ${metricItem("浮动盈亏", money(summary.totalPnl), pctClass(summary.totalPnl))}
        ${metricItem("盈亏比例", summary.totalPnlPct === null || summary.totalPnlPct === undefined ? "--" : `${summary.totalPnlPct > 0 ? "+" : ""}${fmt(summary.totalPnlPct)}%`, pctClass(summary.totalPnlPct))}
      </div>
      <p>${summary.suggestion || "建议等待持仓数据补齐后再统一判断。"}</p>
      <div class="portfolio-summary-tags">
        <span>盈利 ${summary.winners || 0} 只</span>
        <span>亏损 ${summary.losers || 0} 只</span>
        ${strongest ? `<span>最强 ${strongest.name || strongest.code} ${money(strongest.pnl)}</span>` : ""}
        ${weakest ? `<span>最弱 ${weakest.name || weakest.code} ${money(weakest.pnl)}</span>` : ""}
      </div>
    </section>
  `;
}

function recommendationList(stocks) {
  return `
    <div class="recommend-list">
      ${stocks.map((stock, index) => {
        const levels = stock.advice?.levels || {};
        const analysis = stock.analysis || [];
        return `
          <article class="card recommend-card" data-stock="${stock.code}">
            <div class="recommend-card-head">
              <div>
                <span class="rank-badge">#${index + 1}</span>
                <strong>${stock.name}</strong>
                <small>${stock.code} · ${stock.sectorName}</small>
              </div>
              <div class="recommend-score">
                <span>买入机会分</span>
                <b>${fmt(recommendationOpportunityScore(stock), 1)}</b>
              </div>
            </div>
            <div class="recommend-metrics">
              ${metricItem("现价", fmt(stock.price))}
              ${metricItem("涨跌幅", `${stock.pct > 0 ? "+" : ""}${fmt(stock.pct)}%`, pctClass(stock.pct))}
              ${metricItem("主力净额", money(stock.mainFlow), pctClass(stock.mainFlow))}
              ${metricItem("主力占比", `${fmt(stock.mainFlowPct)}%`, pctClass(stock.mainFlowPct))}
              ${metricItem("技术分", `${stock.technicalScore >= 0 ? "+" : ""}${fmt(stock.technicalScore, 1)}`, pctClass(stock.technicalScore))}
              ${metricItem("建议仓位", stock.advice?.position || "--")}
              ${metricItem("操作", stock.advice?.action || "--")}
            </div>
            <div class="recommend-action">
              <div><span>回踩买点</span><strong>${fmt(levels.pullbackBuy)}</strong></div>
              <div><span>突破触发</span><strong>${fmt(levels.breakoutBuy)}</strong></div>
              <div><span>止损</span><strong class="down">${fmt(levels.stopLoss)}</strong></div>
              <div><span>目标一</span><strong class="up">${fmt(levels.firstTarget)}</strong></div>
            </div>
            <p class="recommend-reason">${stock.reason || "后台正在补充分析。"}</p>
            <ul class="recommend-analysis">
              ${analysis.length ? analysis.map((item) => `<li>${item}</li>`).join("") : `<li>${stock.advice?.plan || "等待后台补齐操作计划。"}</li><li>${stock.advice?.risk || "等待后台补齐风险条件。"}</li>`}
            </ul>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function stockTable(stocks, { rankLabel = "TOP" } = {}) {
  return `
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>排名</th><th>股票</th><th>现价</th><th>涨跌幅</th><th>成交额</th><th>换手</th><th>主力净额</th><th>主力占比</th><th>流入速度</th><th>离场速度</th><th>雷达分</th></tr></thead>
        <tbody>
          ${stocks.map((stock, index) => `
            <tr data-stock="${stock.code}">
              <td><strong>${rankLabel === "BOTTOM" ? "B" : "#"}${index + 1}</strong></td>
              <td><div class="stock-name">${stock.name}</div><div class="stock-code">${stock.code}</div></td>
              <td>${fmt(stock.price)}</td>
              <td class="${pctClass(stock.pct)}">${stock.pct > 0 ? "+" : ""}${fmt(stock.pct)}%</td>
              <td>${money(stock.amount)}</td>
              <td>${fmt(stock.turnover)}%</td>
              <td class="${pctClass(stock.mainFlow)}">${money(stock.mainFlow)}</td>
              <td class="${pctClass(stock.mainFlowPct)}">${fmt(stock.mainFlowPct)}%</td>
              <td class="up">${fmt(stock.mainInSpeed)}%</td>
              <td class="down">${fmt(stock.mainOutSpeed)}%</td>
              <td><strong>${fmt(stock.score, 1)}</strong></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function stockModal() {
  if (!state.modalStock) return `<div class="overlay" id="stockOverlay"></div>`;
  const stock = state.modalStock;
  const advice = stockAdvice(stock);
  const discussionReady = stockDiscussionReady(stock);
  const discussionHint = stockDiscussionPendingText(stock);
  return `
    <div class="overlay open" id="stockOverlay">
      <div class="shade" data-close></div>
      <section class="drawer" role="dialog" aria-modal="true">
        <header class="drawer-head">
          <div class="drawer-title-group">
            <div class="stock-title-line">
              <div class="page-title">${stock.name} <span class="stock-code">${stock.code}</span></div>
              <div class="stock-title-actions">
                <button class="ghost title-copy-btn" data-action="copy-stock-name" data-copy-value="${escapeHtml(stock.name || "")}" title="复制股票名称">${icons.copy}<span>复制名称</span></button>
                <button class="ghost title-copy-btn ${discussionReady ? "" : "is-disabled"}" data-action="join-stock-discussion" title="${discussionReady ? "带入详情数据并进入个股讨论" : escapeHtml(discussionHint)}" ${discussionReady ? "" : "disabled"}>${icons.chat}<span>${discussionReady ? "加入讨论" : "数据加载中"}</span></button>
              </div>
            </div>
            <div class="page-subtitle">${advice.summary}</div>
            ${discussionReady ? "" : `<div class="stock-discussion-hint"><span class="loader"></span>${discussionHint}</div>`}
          </div>
          <div class="drawer-actions">
            <button class="icon-btn" data-close title="关闭">${icons.close}</button>
          </div>
        </header>
        <div class="drawer-body">
          ${stockDetailView(stock, advice)}
        </div>
      </section>
    </div>
  `;
}

function stockDetailView(stock, advice) {
  const latest = advice.latest || {};
  const levels = advice.levels || {};
  return `
    <section class="broker-quote">
      <div class="broker-main-price">
        <span>${stock.name || ""} ${stock.code}</span>
        <strong class="${pctClass(stock.pct)}">${fmt(stock.price)}</strong>
        <em class="${pctClass(stock.pct)}">${stock.pct > 0 ? "+" : ""}${fmt(stock.change || 0)} / ${stock.pct > 0 ? "+" : ""}${fmt(stock.pct)}%</em>
      </div>
      <div class="broker-quote-grid">
        ${quoteCell("今开", fmt(stock.open ?? latest.open))}
        ${quoteCell("最高", fmt(stock.high ?? latest.high), "up")}
        ${quoteCell("最低", fmt(stock.low ?? latest.low), "down")}
        ${quoteCell("昨收", fmt(stock.prevClose))}
        ${quoteCell("成交额", money(stock.amount))}
        ${quoteCell("成交量", fmt(stock.volume ?? latest.volume, 0))}
        ${quoteCell("换手率", `${fmt(stock.turnover)}%`)}
        ${quoteCell("振幅", `${fmt(stock.amplitude)}%`)}
        ${quoteCell("市盈率", fmt(stock.pe))}
        ${quoteCell("市净率", fmt(stock.pb))}
        ${quoteCell("总市值", money(stock.totalMarketCap))}
        ${quoteCell("流通市值", money(stock.floatMarketCap))}
      </div>
    </section>
    ${stockProfileView(stock, advice)}
    <section class="stock-detail-grid">
      <div class="stock-chart-stack">
        <div class="stock-action stock-action-banner">
          <span>操作建议</span>
          <strong>${advice.action}</strong>
          <small>${advice.plan}</small>
        </div>
        ${adviceExplanationView(advice)}
        ${stockNewsPolicyView(stock)}
        <div class="chart-wrap interactive-chart">
          ${stockChartLegend()}
          <canvas id="stockChart"></canvas>
          <div class="chart-tip" id="stockChartTip" aria-hidden="true"></div>
        </div>
      </div>
      <aside class="stock-side panel">
        <div class="detail-metrics">
          ${metricItem("现价", fmt(stock.price), pctClass(stock.pct))}
          ${metricItem("涨跌幅", `${stock.pct > 0 ? "+" : ""}${fmt(stock.pct)}%`, pctClass(stock.pct))}
          ${metricItem("建议仓位", advice.position)}
          ${metricItem("雷达分", fmt(stock.score, 1))}
          ${metricItem("成交额", money(stock.amount))}
          ${metricItem("换手", `${fmt(stock.turnover)}%`)}
        </div>
        <div class="trade-plan">
          <div><span>回踩关注</span><b>${fmt(levels.pullbackBuy)}</b></div>
          <div><span>突破触发</span><b>${fmt(levels.breakoutBuy)}</b></div>
          <div><span>止损线</span><b class="down">${fmt(levels.stopLoss)}</b></div>
          <div><span>目标一</span><b class="up">${fmt(levels.firstTarget)}</b></div>
          <div><span>目标二</span><b class="up">${fmt(levels.secondTarget)}</b></div>
          <div><span>风控</span><b>${advice.risk}</b></div>
        </div>
      </aside>
    </section>
    <section class="grid stock-data-grid">
      ${indicatorCard("K线", advice.checks?.[0]?.value, `开 ${fmt(latest.open)} / 高 ${fmt(latest.high)} / 低 ${fmt(latest.low)} / 收 ${fmt(latest.close)}`)}
      ${indicatorCard("均线", `MA5 ${fmt(latest.ma5)}`, `MA10 ${fmt(latest.ma10)} / MA20 ${fmt(latest.ma20)}`)}
      ${indicatorCard("MACD", advice.checks?.[1]?.value, `DIF ${fmt(latest.dif, 3)} / DEA ${fmt(latest.dea, 3)} / 柱 ${fmt(latest.macdHist, 3)}`)}
      ${indicatorCard("SAR", advice.checks?.[2]?.value, `SAR ${fmt(latest.sar)}，${advice.checks?.[2]?.value || "--"}`)}
      ${indicatorCard("BOLL", advice.checks?.[3]?.value, `上 ${fmt(latest.bollUpper)} / 中 ${fmt(latest.bollMid)} / 下 ${fmt(latest.bollLower)}`)}
      ${indicatorCard("主力", money(stock.mainFlow), `主力占比 ${fmt(stock.mainFlowPct)}% / 量 ${fmt(latest.volume, 0)}`)}
    </section>
  `;
}

function stockSectorName(stock) {
  if (stock.sectorName) return stock.sectorName;
  for (const [sectorId, stocks] of state.stocksBySector.entries()) {
    if (!stocks.some((item) => item.code === stock.code)) continue;
    return state.sectors.find((sector) => sector.id === sectorId)?.name || "";
  }
  return "";
}

function stockProfileView(stock, advice) {
  const sectorName = stockSectorName(stock);
  const marketCap = Number(stock.floatMarketCap || stock.totalMarketCap || stock.marketCap);
  const pe = Number(stock.pe);
  const pb = Number(stock.pb);
  const turnover = Number(stock.turnover);
  const mainFlow = Number(stock.mainFlow);
  const mainFlowPct = Number(stock.mainFlowPct);
  const score = Number(stock.score);
  const scaleText = Number.isFinite(marketCap)
    ? marketCap >= 100_000_000_000 ? "大市值权重"
      : marketCap >= 30_000_000_000 ? "中大市值核心"
      : marketCap >= 8_000_000_000 ? "中等市值弹性"
      : "小市值高弹性"
    : "市值分层待确认";
  const valuationText = Number.isFinite(pe) && pe > 0
    ? pe < 20 ? "估值偏低"
      : pe < 45 ? "估值中性"
      : "估值偏高"
    : Number.isFinite(pb) && pb > 0 ? `PB ${fmt(pb)}，以市净率观察` : "估值数据不足";
  const liquidityText = Number.isFinite(turnover)
    ? turnover >= 8 ? "换手活跃，短线博弈强"
      : turnover >= 3 ? "换手适中，承接可观察"
      : "换手偏低，需关注成交放大"
    : "换手数据待确认";
  const flowText = Number.isFinite(mainFlow)
    ? mainFlow > 0 ? `主力净流入 ${money(mainFlow)}，资金偏主动`
      : mainFlow < 0 ? `主力净流出 ${money(mainFlow)}，资金偏谨慎`
      : "主力资金暂时均衡"
    : "主力资金数据待同步";
  const radarText = Number.isFinite(score)
    ? score >= 75 ? "雷达分较强，适合重点跟踪"
      : score >= 58 ? "雷达分中等偏上，等待共振确认"
      : "雷达分一般，先控制观察仓"
    : "雷达分待同步";
  const summary = `${stock.name || stock.code}${sectorName ? ` 属于 ${sectorName} 方向` : ""}，当前定位为${scaleText}；${liquidityText}，${flowText}${Number.isFinite(mainFlowPct) ? `，主力占比 ${fmt(mainFlowPct)}%` : ""}。结合技术面，${advice.action}，${advice.plan}`;
  const tags = [
    sectorName ? `方向：${sectorName}` : "方向：待识别",
    `市值：${scaleText}`,
    `估值：${valuationText}`,
    `流动性：${liquidityText}`,
    `资金：${flowText}`,
    `雷达：${radarText}`
  ];
  return `
    <section class="stock-profile panel">
      <div class="stock-profile-head">
        <div>
          <span>股票说明</span>
          <strong>${stock.name || stock.code} 的雷达画像</strong>
        </div>
        <small>${stock.quoteSource === "tencent" ? "腾讯行情" : stock.source || "实时行情"} · ${sectorName || "全市场匹配"}</small>
      </div>
      <p>${summary}</p>
      <div class="stock-profile-tags">
        ${tags.map((tag) => `<span>${tag}</span>`).join("")}
      </div>
    </section>
  `;
}

function stockNewsPolicyView(stock) {
  const news = (stock.news || []).slice(0, 3);
  if (stock.newsLoading) {
    return `
      <section class="stock-news-panel">
        <div class="stock-news-head">
          <div><span>政策/新闻 Top3</span><strong>正在同步近 1 天消息</strong></div>
          <small>优先匹配 ${stock.name || stock.code} 的政策、资金和公司事件。</small>
        </div>
        <div class="stock-news-empty">新闻源同步中，先以 K 线、MACD、SAR、BOLL 的共振结果作为主判断。</div>
      </section>
    `;
  }
  if (!news.length) {
    return `
      <section class="stock-news-panel">
        <div class="stock-news-head">
          <div><span>政策/新闻 Top3</span><strong>近 1 天暂无强相关消息</strong></div>
          <small>${stock.newsError || "当前未抓取到可引用的实时新闻。"} </small>
        </div>
        <div class="stock-news-empty">操作建议：消息面暂不构成新增买卖理由，继续以量价位置、主力净额和指标共振确认。</div>
      </section>
    `;
  }
  return `
    <section class="stock-news-panel">
      <div class="stock-news-head">
        <div><span>政策/新闻 Top3</span><strong>消息面辅助决策</strong></div>
        <small>按相关性、政策属性和发布时间排序，点击标题查看来源。</small>
      </div>
      <div class="stock-news-cards">
        ${news.map((item, index) => `
          <article class="stock-news-card">
            <div class="stock-news-rank">${index + 1}</div>
            <div class="stock-news-content">
              <a href="${item.link}" target="_blank" rel="noreferrer">${item.title}</a>
              <div class="stock-news-meta">
                <span>${item.kind || "新闻"} · ${item.tone || "中性观察"}</span>
                <span>${item.source || "新闻源"}</span>
                <span>${item.time ? new Date(item.time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "近 1 天"}</span>
              </div>
              <p>${item.reason || item.impact || "关注该消息是否改变市场对公司短线预期。"}</p>
              <strong>${item.advice || "建议结合技术指标确认，不单独依据消息面追涨杀跌。"}</strong>
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function adviceExplanationView(advice) {
  const explanation = advice.explanation || {};
  const why = explanation.why || [];
  const playbook = explanation.playbook || [];
  const diagnostics = explanation.diagnostics || [];
  return `
    <section class="advice-explain">
      <div class="advice-explain-head">
        <div><span>建议说明</span><strong>${explanation.scoreLabel || "等待技术共振"}</strong></div>
        <div><span>仓位节奏</span><strong>${advice.position || "--"}</strong></div>
        <div><span>失效条件</span><strong>${advice.risk || "--"}</strong></div>
      </div>
      <div class="advice-explain-grid">
        <div>
          <h3>为什么</h3>
          <ul>${why.map((item) => `<li>${item}</li>`).join("") || "<li>等待 K 线、MACD、SAR、BOLL 数据补齐。</li>"}</ul>
        </div>
        <div>
          <h3>怎么做</h3>
          <ul>${playbook.map((item) => `<li>${item}</li>`).join("") || "<li>暂不执行，等待数据确认。</li>"}</ul>
        </div>
        <div>
          <h3>风险检查</h3>
          <ul>${diagnostics.map((item) => `<li>${item}</li>`).join("") || "<li>暂无足够指标。</li>"}</ul>
        </div>
      </div>
      <div class="advice-invalid">${explanation.invalidation || advice.risk || ""}</div>
    </section>
  `;
}

function quoteCell(label, value, className = "") {
  return `<div><span>${label}</span><b class="${className}">${value}</b></div>`;
}

function metricItem(label, value, className = "") {
  return `<div><span>${label}</span><strong class="${className}">${value}</strong></div>`;
}

function indicatorCard(title, value, detail) {
  return `<article class="card indicator-card"><span>${title}</span><strong>${value || "--"}</strong><small>${detail || "--"}</small></article>`;
}

function stockChartLegend() {
  const items = [
    { className: "k-up", label: "红K", text: "收盘高于开盘" },
    { className: "k-down", label: "绿K", text: "收盘低于开盘" },
    { className: "boll-upper", label: "BOLL上/下轨", text: "压力与支撑边界" },
    { className: "boll-mid", label: "BOLL中轨", text: "趋势均衡线" },
    { className: "sar", label: "SAR", text: "止损/反转参考点" }
  ];
  return `
    <div class="stock-chart-legend" aria-label="K BOLL SAR 图例">
      ${items.map((item) => `
        <span class="${item.className}">
          <i></i>
          <b>${item.label}</b>
          <em>${item.text}</em>
        </span>
      `).join("")}
    </div>
  `;
}

function drawStockChart(stock) {
  const canvas = document.querySelector("#stockChart");
  if (!canvas || !stock.candles?.length) return;
  const tip = document.querySelector("#stockChartTip");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const advice = stockAdvice(stock);
  const candles = stock.candles.slice(-72);
  const offset = stock.candles.length - candles.length;
  const boll = advice.boll.slice(offset);
  const sar = advice.sar.slice(offset);
  const hist = advice.macd.hist.slice(offset);
  const dif = advice.macd.dif.slice(offset);
  const dea = advice.macd.dea.slice(offset);
  const pad = { l: 48, r: 58, t: 48, b: 32 };
  const mainH = rect.height * 0.66;
  const macdTop = mainH + 24;
  const highs = candles.map((c) => c.high).concat(boll.map((b) => b.upper), sar);
  const lows = candles.map((c) => c.low).concat(boll.map((b) => b.lower), sar);
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const xStep = (rect.width - pad.l - pad.r) / candles.length;
  const y = (value) => pad.t + (max - value) / Math.max(0.01, max - min) * (mainH - pad.t - 10);
  const chartLeft = pad.l;
  const chartRight = rect.width - pad.r;
  const chartBottom = mainH - 10;
  ctx.fillStyle = "#09131c";
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.strokeStyle = "#1d3344";
  ctx.fillStyle = "#6f8494";
  ctx.font = "11px system-ui";
  ctx.textAlign = "left";
  ctx.fillText("价格", chartRight + 7, 16);
  for (let i = 0; i < 5; i += 1) {
    const yy = pad.t + i * (mainH - pad.t - 10) / 4;
    const price = max - (max - min) * i / 4;
    ctx.beginPath();
    ctx.moveTo(chartLeft, yy);
    ctx.lineTo(chartRight, yy);
    ctx.stroke();
    ctx.fillStyle = "#6f8494";
    ctx.font = "11px system-ui";
    ctx.textAlign = "left";
    ctx.fillText(fmt(price), chartRight + 7, yy + 4);
  }
  candles.forEach((c, i) => {
    const x = pad.l + i * xStep + xStep / 2;
    const up = c.close >= c.open;
    ctx.strokeStyle = up ? "#ff4d57" : "#00b070";
    ctx.fillStyle = up ? "#ff4d57" : "#00b070";
    ctx.beginPath();
    ctx.moveTo(x, y(c.high));
    ctx.lineTo(x, y(c.low));
    ctx.stroke();
    const bodyY = Math.min(y(c.open), y(c.close));
    const bodyH = Math.max(2, Math.abs(y(c.open) - y(c.close)));
    ctx.fillRect(x - xStep * 0.3, bodyY, Math.max(2, xStep * 0.6), bodyH);
  });
  drawLine(ctx, boll.map((b) => b.upper), "#f2b84b", y, pad.l, xStep);
  drawLine(ctx, boll.map((b) => b.mid), "#54a3ff", y, pad.l, xStep);
  drawLine(ctx, boll.map((b) => b.lower), "#f2b84b", y, pad.l, xStep);
  ctx.fillStyle = "#d184ff";
  sar.forEach((value, i) => {
    const x = pad.l + i * xStep + xStep / 2;
    ctx.beginPath();
    ctx.arc(x, y(value), 2.1, 0, Math.PI * 2);
    ctx.fill();
  });
  const hMax = Math.max(...hist.map(Math.abs), 0.01);
  const zero = macdTop + 62;
  ctx.strokeStyle = "#1d3344";
  ctx.beginPath();
  ctx.moveTo(pad.l, zero);
  ctx.lineTo(chartRight, zero);
  ctx.stroke();
  hist.forEach((value, i) => {
    const x = pad.l + i * xStep + xStep * 0.25;
    const barH = value / hMax * 48;
    ctx.fillStyle = value >= 0 ? "#ff4d57" : "#00b070";
    ctx.fillRect(x, zero - Math.max(0, barH), Math.max(1, xStep * 0.5), Math.abs(barH));
  });
  const macdY = (value) => zero - value / hMax * 34;
  drawLine(ctx, dif, "#54a3ff", macdY, pad.l, xStep);
  drawLine(ctx, dea, "#f2b84b", macdY, pad.l, xStep);
  const labelEvery = Math.max(1, Math.ceil(candles.length / 6));
  ctx.fillStyle = "#6f8494";
  ctx.font = "11px system-ui";
  ctx.textAlign = "center";
  candles.forEach((c, i) => {
    if (i % labelEvery && i !== candles.length - 1) return;
    const x = pad.l + i * xStep + xStep / 2;
    ctx.fillText(String(c.day || "").slice(5), x, chartBottom + 18);
  });
  const pointer = normalizeStockPointer(stockChartPointer, rect, pad, mainH, candles.length);
  if (pointer) {
    const index = Math.max(0, Math.min(candles.length - 1, Math.round((pointer.x - pad.l - xStep / 2) / xStep)));
    const candle = candles[index];
    const px = pad.l + index * xStep + xStep / 2;
    const pointerPrice = max - ((pointer.y - pad.t) / Math.max(1, mainH - pad.t - 10)) * (max - min);
    ctx.save();
    ctx.strokeStyle = "rgba(218, 230, 238, 0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(px, pad.t);
    ctx.lineTo(px, zero + 58);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(chartLeft, pointer.y);
    ctx.lineTo(chartRight, pointer.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(84, 163, 255, 0.18)";
    ctx.fillRect(chartRight + 5, pointer.y - 11, pad.r - 8, 20);
    ctx.fillStyle = "#dce8ef";
    ctx.textAlign = "left";
    ctx.font = "11px system-ui";
    ctx.fillText(fmt(pointerPrice), chartRight + 9, pointer.y + 4);
    ctx.restore();
    updateStockChartTip(tip, pointer, candle, pointerPrice, boll[index], sar[index], rect);
  } else if (tip) {
    tip.classList.remove("show");
  }
  drawChartLineLegend(ctx, pad.l, 18, [
    { color: "#ff4d57", label: "红K 多方" },
    { color: "#00b070", label: "绿K 空方" },
    { color: "#f2b84b", label: "BOLL上/下轨" },
    { color: "#54a3ff", label: "BOLL中轨" },
    { color: "#d184ff", label: "SAR反转点", dot: true }
  ]);
  drawChartLineLegend(ctx, pad.l, macdTop + 12, [
    { color: "#54a3ff", label: "DIF" },
    { color: "#f2b84b", label: "DEA" },
    { color: "#ff4d57", label: "MACD红柱" },
    { color: "#00b070", label: "MACD绿柱" }
  ]);
}

function drawChartLineLegend(ctx, x, y, items) {
  ctx.save();
  ctx.font = "11px system-ui";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let cursor = x;
  items.forEach((item) => {
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = 2;
    if (item.dot) {
      for (let i = 0; i < 3; i += 1) {
        ctx.beginPath();
        ctx.arc(cursor + 4 + i * 7, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      ctx.moveTo(cursor, y);
      ctx.lineTo(cursor + 22, y);
      ctx.stroke();
    }
    ctx.fillStyle = "#aebfca";
    ctx.fillText(item.label, cursor + 28, y);
    cursor += 28 + ctx.measureText(item.label).width + 14;
  });
  ctx.restore();
}

function normalizeStockPointer(pointer, rect, pad, mainH, candleCount) {
  if (!pointer || !candleCount) return null;
  const minX = pad.l;
  const maxX = rect.width - pad.r;
  const minY = pad.t;
  const maxY = mainH - 10;
  if (pointer.x < minX || pointer.x > maxX || pointer.y < minY || pointer.y > maxY) return null;
  return {
    x: Math.max(minX, Math.min(maxX, pointer.x)),
    y: Math.max(minY, Math.min(maxY, pointer.y))
  };
}

function updateStockChartTip(tip, pointer, candle, price, boll, sar, rect) {
  if (!tip || !candle) return;
  const left = pointer.x > rect.width * 0.62 ? pointer.x - 172 : pointer.x + 12;
  const top = pointer.y > rect.height * 0.52 ? pointer.y - 122 : pointer.y + 12;
  tip.style.left = `${Math.max(8, Math.min(rect.width - 164, left))}px`;
  tip.style.top = `${Math.max(8, Math.min(rect.height - 118, top))}px`;
  tip.innerHTML = `
    <b>${candle.day}</b>
    <span>X 日期：${candle.day}</span>
    <span>Y 价格：${fmt(price)}</span>
    <span>开 ${fmt(candle.open)} 高 ${fmt(candle.high)}</span>
    <span>低 ${fmt(candle.low)} 收 ${fmt(candle.close)}</span>
    <span>BOLL ${fmt(boll?.upper)} / ${fmt(boll?.mid)} / ${fmt(boll?.lower)}</span>
    <span>SAR ${fmt(sar)}</span>
  `;
  tip.classList.add("show");
}

function drawLine(ctx, values, color, y, left, step) {
  if (!values.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  values.forEach((value, i) => {
    const x = left + i * step + step / 2;
    const yy = y(value);
    if (i === 0) ctx.moveTo(x, yy);
    else ctx.lineTo(x, yy);
  });
  ctx.stroke();
}

function drawIndexChart(index) {
  const canvas = document.querySelector("#indexChart");
  const rows = (index?.klines || []).filter((row) => Number.isFinite(Number(row.close))).slice(-10);
  if (!canvas || !rows.length) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const pad = { l: 48, r: 18, t: 24, b: 34 };
  const max = Math.max(...rows.map((row) => row.high));
  const min = Math.min(...rows.map((row) => row.low));
  const xStep = (rect.width - pad.l - pad.r) / Math.max(1, rows.length - 1);
  const y = (value) => pad.t + (max - value) / Math.max(0.01, max - min) * (rect.height - pad.t - pad.b);
  ctx.fillStyle = "#09131c";
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.strokeStyle = "#1d3344";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i += 1) {
    const yy = pad.t + i * (rect.height - pad.t - pad.b) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, yy);
    ctx.lineTo(rect.width - pad.r, yy);
    ctx.stroke();
    ctx.fillStyle = "#647887";
    ctx.font = "11px system-ui";
    ctx.fillText(fmt(max - (max - min) * i / 4), 8, yy + 4);
  }
  const points = rows.map((row, index) => ({
    x: pad.l + index * xStep,
    y: y(row.close),
    row
  }));
  const gradient = ctx.createLinearGradient(0, pad.t, 0, rect.height - pad.b);
  gradient.addColorStop(0, "rgba(255, 77, 87, 0.24)");
  gradient.addColorStop(1, "rgba(84, 163, 255, 0.02)");
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.lineTo(points.at(-1).x, rect.height - pad.b);
  ctx.lineTo(points[0].x, rect.height - pad.b);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = Number(rows.at(-1).close) >= Number(rows[0].close) ? "#ff4d57" : "#00b070";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  const avgClose = rows.reduce((sum, row) => sum + row.close, 0) / rows.length;
  ctx.strokeStyle = "#f2b84b";
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(pad.l, y(avgClose));
  ctx.lineTo(rect.width - pad.r, y(avgClose));
  ctx.stroke();
  ctx.setLineDash([]);
  points.forEach((point) => {
    const up = point.row.close >= point.row.open;
    ctx.fillStyle = up ? "#ff4d57" : "#00b070";
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = "#9fb0bd";
  ctx.font = "12px system-ui";
  ctx.fillText("两周收盘趋势", pad.l, 16);
  ctx.fillStyle = "#f2b84b";
  ctx.fillText("两周均价", rect.width - 86, Math.max(16, y(avgClose) - 7));
  rows.forEach((row, index) => {
    if (index % 2 && index !== rows.length - 1) return;
    const x = pad.l + index * xStep;
    ctx.fillStyle = "#647887";
    ctx.font = "11px system-ui";
    ctx.fillText(row.day.slice(5), Math.min(rect.width - 52, x - 16), rect.height - 12);
  });
}

function render() {
  const advisorFocus = skipAdvisorFocusRestoreOnce ? null : captureAdvisorFocus();
  skipAdvisorFocusRestoreOnce = false;
  if (state.page === "radar" || state.page === "sector") state.page = "home";
  const pages = { home: homePage, recommend: recommendPage, portfolio: portfolioPage, discussion: discussionPage, settings: settingsPage };
  app.innerHTML = shell(pages[state.page]());
  if (state.modalStock) requestAnimationFrame(() => drawStockChart(state.modalStock));
  if (state.modalIndex) requestAnimationFrame(() => drawIndexChart(state.modalIndex));
  if (advisorFocus) restoreAdvisorFocus(advisorFocus);
  else focusAdvisorInput();
  scrollChatToBottom();
}

app.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("[data-choice-option], [data-action='fill-advisor-choices'], [data-action='send-advisor-choices']")) return;
  event.preventDefault();
});

app.addEventListener("click", (event) => {
  if (event.target.closest(".sector-news a")) return;
  if (event.target.closest("[data-action='clear-sector-search']")) {
    update({ sectorSearch: "", sectorSearchDraft: "", sectorPage: 1 });
    loadSectorNewsForTop();
    return;
  }
  if (event.target.closest("[data-action='submit-sector-search']")) {
    applySectorSearch(state.sectorSearchDraft);
    return;
  }
  const suggestion = event.target.closest("[data-action='apply-search-suggestion']");
  if (suggestion) {
    applySectorSearch(suggestion.dataset.searchValue || state.sectorSearchDraft);
    return;
  }
  const copyTarget = event.target.closest("[data-action='copy-stock-name']");
  if (copyTarget) {
    copyText(copyTarget.dataset.copyValue || state.modalStock?.name || "", "股票名称");
    return;
  }
  if (event.target.closest("[data-action='join-stock-discussion']")) {
    joinStockDiscussion();
    return;
  }
  const page = event.target.closest("[data-page]")?.dataset.page;
  const sectorId = event.target.closest("[data-sector]")?.dataset.sector;
  const stockCode = event.target.closest("[data-stock]")?.dataset.stock;
  const indexSymbol = event.target.closest("[data-index]")?.dataset.index;
  const sectorSort = event.target.closest("[data-sector-sort]")?.dataset.sectorSort;
  const sectorPageAction = event.target.closest("[data-sector-page]")?.dataset.sectorPage;
  const stockSort = event.target.closest("[data-stock-sort]")?.dataset.stockSort;
  if (page) {
    update({ page });
    if (page === "recommend") loadRecommendations();
    if (page === "portfolio") loadHoldings();
    if (page === "settings") loadSettings();
  }
  if (sectorId) {
    update({ selectedSectorId: sectorId, modalSectorId: sectorId });
    loadStocks(sectorId);
  }
  if (indexSymbol) openIndex(indexSymbol);
  if (stockCode) openStock(stockCode);
  if (sectorSort) {
    update({ sectorSort, sectorPage: 1 });
    loadSectorNewsForTop();
  }
  if (sectorPageAction) {
    const pageInfo = homeSectorPageInfo();
    const nextPage = sectorPageAction === "next" ? pageInfo.current + 1 : pageInfo.current - 1;
    update({ sectorPage: Math.min(pageInfo.pageCount, Math.max(1, nextPage)) });
    loadSectorNewsForTop();
  }
  if (stockSort) update({ modalStockSort: stockSort });
  const closeTarget = event.target.closest("[data-close]");
  if (closeTarget) {
    closeTopOverlay();
  }
  if (event.target.closest("[data-action='refresh']")) {
    state.recommendations = [];
    state.sectorStockIndexReady = false;
    state.sectorStockIndexLoading = false;
    loadSectors({ clearStockCache: true });
    if (state.page === "recommend") setTimeout(() => loadRecommendations({ force: true }), 0);
  }
  if (event.target.closest("[data-action='analyze-portfolio']")) analyzePortfolioText();
  if (event.target.closest("[data-action='open-portfolio-update']")) update({ modalPortfolioUpdate: true, ocrProgress: "" });
  if (event.target.closest("[data-action='reload-portfolio']")) loadHoldings();
  if (event.target.closest("[data-action='clear-portfolio']")) clearHoldings();
  if (event.target.closest("[data-action='save-settings']")) saveSettings();
  if (event.target.closest("[data-action='send-advisor-message']")) sendAdvisorMessage();
  if (event.target.closest("[data-action='clear-advisor-chat']")) clearAdvisorChat();
  const choiceOption = event.target.closest("[data-choice-option]");
  if (choiceOption) {
    const selected = !choiceOption.classList.contains("selected");
    choiceOption.classList.toggle("selected", selected);
    choiceOption.setAttribute("aria-pressed", selected ? "true" : "false");
    keepAdvisorInputFocused();
    return;
  }
  const fillChoices = event.target.closest("[data-action='fill-advisor-choices']");
  if (fillChoices) {
    const choices = selectedAdvisorChoices(fillChoices.dataset.choiceMessage);
    const text = advisorChoicesReplyText(choices);
    if (!text) {
      showToast("先选择一个或多个问题");
      keepAdvisorInputFocused();
      return;
    }
    skipAdvisorFocusRestoreOnce = true;
    update({ advisorInput: text });
    setTimeout(() => {
      const input = document.querySelector("[data-advisor-input]");
      if (!input) return;
      input.value = text;
      state.advisorInput = text;
      input.focus({ preventScroll: true });
      input.setSelectionRange(text.length, text.length);
    }, 0);
    return;
  }
  const sendChoices = event.target.closest("[data-action='send-advisor-choices']");
  if (sendChoices) {
    const choices = selectedAdvisorChoices(sendChoices.dataset.choiceMessage);
    const text = advisorChoicesReplyText(choices);
    if (!text) {
      showToast("先选择一个或多个问题");
      keepAdvisorInputFocused();
      return;
    }
    sendAdvisorMessage(text);
    return;
  }
  const win = event.target.closest("[data-window]")?.dataset.window;
  if (win) {
    state.window = Number(win);
    state.sectorPage = 1;
    state.recommendations = [];
    state.sectorStockIndexReady = false;
    state.sectorStockIndexLoading = false;
    loadSectors({ clearStockCache: true });
    if (state.page === "recommend") setTimeout(() => loadRecommendations({ force: true }), 0);
  }
});

app.addEventListener("change", (event) => {
  if (event.target.matches("[data-select-sector]")) {
    update({ selectedSectorId: event.target.value });
    loadStocks(event.target.value);
  }
  if (event.target.matches("[data-position-image]") && event.target.files?.[0]) {
    recognizePositionImage(event.target.files[0]);
  }
  if (event.target.matches("[data-setting]")) {
    const key = event.target.dataset.setting;
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    state.settingsDraft = { ...(state.settingsDraft || {}), [key]: value };
    render();
  }
});

app.addEventListener("input", (event) => {
  if (event.target.matches("[data-portfolio-text]")) {
    state.portfolioText = event.target.value;
  }
  if (event.target.matches("[data-sector-search]")) {
    state.sectorSearchDraft = event.target.value;
    updateSectorSearchDraftStatus(event.target.value);
    renderSectorSearchSuggestions(event.target.value);
  }
  if (event.target.matches("[data-setting]")) {
    const key = event.target.dataset.setting;
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    state.settingsDraft = { ...(state.settingsDraft || {}), [key]: value };
  }
  if (event.target.matches("[data-advisor-input]")) {
    state.advisorInput = event.target.value;
  }
});

app.addEventListener("compositionstart", (event) => {
  if (event.target.matches("[data-advisor-input]")) {
    state.advisorComposing = true;
  }
});

app.addEventListener("compositionend", (event) => {
  if (event.target.matches("[data-advisor-input]")) {
    state.advisorComposing = false;
    state.advisorInput = event.target.value;
  }
});

app.addEventListener("keydown", (event) => {
  if (event.target.matches("[data-sector-search]") && event.key === "Enter") {
    event.preventDefault();
    applySectorSearch(event.target.value);
  }
  if (event.target.matches("[data-advisor-input]") && event.key === "Enter" && !event.shiftKey) {
    if (event.isComposing || state.advisorComposing) return;
    if (state.advisorLoading || state.advisorStreaming) return;
    event.preventDefault();
    sendAdvisorMessage();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && hasOpenOverlay()) {
    event.preventDefault();
    closeTopOverlay();
  }
});

app.addEventListener("pointermove", (event) => {
  const canvas = event.target.closest("#stockChart");
  if (!canvas || !state.modalStock) return;
  const rect = canvas.getBoundingClientRect();
  stockChartPointer = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
  drawStockChart(state.modalStock);
});

app.addEventListener("pointerleave", (event) => {
  if (!event.target.closest("#stockChart") || !state.modalStock) return;
  stockChartPointer = null;
  drawStockChart(state.modalStock);
}, true);

window.addEventListener("resize", () => {
  if (state.modalStock) drawStockChart(state.modalStock);
  if (state.modalIndex) drawIndexChart(state.modalIndex);
});

render();
loadSectors();
setInterval(() => requestAutoRefresh("home"), homeRefreshMs);
setInterval(() => requestAutoRefresh("recommend"), recommendRefreshMs);
