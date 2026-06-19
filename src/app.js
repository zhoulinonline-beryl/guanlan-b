import { sectorReasons, stockAdvice } from "./analytics.js";

const app = document.querySelector("#app");
let stockChartPointer = null;
let fullscreenStockChartPointer = null;
let fullscreenStockChartScrollAnchor = null;
let stockChartDrawFrame = 0;
let trackingChartDrawFrame = 0;
const trackingChartPointers = new Map();
let buttonActionLock = false;
let buttonActionName = "";
let buttonActionSelector = "";
let skipAdvisorFocusRestoreOnce = false;
let advisorAbortController = null;
let advisorStreamTimer = null;
let advisorStreamRunId = 0;
let advisorDeferredRender = false;
let advisorScrollRunId = 0;
let portfolioTextDeferredRender = false;
const advisorWelcomeMessage = { role: "assistant", content: "说股票或板块，直接给我代码/名称和你的持仓情况。我会按偏激进短线思路给结论、价位和风控。" };
const advisorHistoryStorageKey = "guanlanAdvisorMessages:v1";
const advisorDeepThinkingStorageKey = "guanlanAdvisorDeepThinking:v1";

function loadAdvisorMessages() {
  try {
    const saved = JSON.parse(localStorage.getItem(advisorHistoryStorageKey) || "[]");
    const messages = Array.isArray(saved)
      ? saved
        .filter((item) => item && ["user", "assistant"].includes(item.role) && String(item.content || "").trim())
        .map((item) => ({
          role: item.role,
          content: String(item.content || "").slice(0, 8000),
          savedAt: item.savedAt || ""
        }))
        .slice(-80)
      : [];
    return messages.length ? messages : [advisorWelcomeMessage];
  } catch {
    return [advisorWelcomeMessage];
  }
}

function loadAdvisorDeepThinking() {
  try {
    return localStorage.getItem(advisorDeepThinkingStorageKey) === "1";
  } catch {
    return false;
  }
}

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
  trackingRows: [],
  trackingUpdatedAt: "",
  trackingLoading: false,
  trackingNews: {},
  trackingNewsLoading: {},
  trackingSearch: "",
  trackingSearchComposing: false,
  trackingPageNo: 1,
  virtualTrading: null,
  virtualTradingLoading: false,
  virtualTradingInitAmount: "",
  virtualTradingError: "",
  virtualTradingTab: "live",
  virtualBacktestStart: "",
  virtualBacktestEnd: "",
  virtualBacktestTradePages: {},
  virtualStockStrategyDrafts: {},
  virtualStrategyPreviewCode: "",
  advisorContexts: [],
  advisorMessages: loadAdvisorMessages(),
  advisorInput: "",
  advisorLoading: false,
  advisorComposing: false,
  advisorStreaming: false,
  advisorDeepThinking: loadAdvisorDeepThinking(),
  settings: null,
  settingsDraft: null,
  settingsLoading: false,
  settingsSaving: false,
  adminAuthToken: sessionStorage.getItem("guanlanAdminToken") || "",
  adminHoldingsAuthorized: Boolean(sessionStorage.getItem("guanlanAdminToken")) || sessionStorage.getItem("guanlanAdminHoldingsAuthorized") === "1",
  appPasswordInput: "",
  appAuthLoading: false,
  appAuthError: "",
  adminStatus: null,
  portfolioText: "",
  portfolioTextComposing: false,
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
  stockChartIndicators: { kline: true, boll: true, sar: true, bullgate: true, macd: true, simulation: true },
  modalStock: null,
  fullscreenStockChart: false,
  fullscreenStockChartData: null,
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

function defaultBacktestRange() {
  const end = new Date();
  const start = new Date(end);
  const originalMonth = start.getMonth();
  start.setFullYear(start.getFullYear() - 1);
  if (start.getMonth() !== originalMonth) start.setDate(0);
  const format = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  return {
    start: format(start),
    end: format(end)
  };
}
let sectorStockIndexQueueRunning = false;
let pendingAutoRefresh = new Set();
let pendingScrollAnchor = null;
let scrollGeneration = 0;
let suppressScrollTracking = false;
let appDataStarted = false;
const pageScrollMemory = new Map();

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
  rememberPageScroll();
  const scrollAnchor = pendingScrollAnchor?.page === state.page ? pendingScrollAnchor : captureScrollAnchors();
  if (Object.prototype.hasOwnProperty.call(patch, "advisorInput") && patch.advisorInput === "") {
    skipAdvisorFocusRestoreOnce = true;
  }
  Object.assign(state, patch);
  if (Object.prototype.hasOwnProperty.call(patch, "advisorMessages")) persistAdvisorMessages(state.advisorMessages);
  render(scrollAnchor);
}

function persistAdvisorMessages(messages = state.advisorMessages) {
  try {
    const clean = (Array.isArray(messages) ? messages : [])
      .filter((item) => item && ["user", "assistant"].includes(item.role) && String(item.content || "").trim() && !item.streaming && !item.authPrompt)
      .map((item) => ({
        role: item.role,
        content: String(item.content || "").slice(0, 8000),
        savedAt: item.savedAt || new Date().toISOString()
      }))
      .slice(-80);
    localStorage.setItem(advisorHistoryStorageKey, JSON.stringify(clean));
  } catch {
    // 本地存储不可用时不影响对话。
  }
}

function clearAdvisorHistoryStorage() {
  try {
    localStorage.removeItem(advisorHistoryStorageKey);
  } catch {
    // 忽略浏览器隐私模式或存储禁用。
  }
}

function isAppAuthenticated() {
  return Boolean(state.adminAuthToken);
}

function clearAppSession() {
  sessionStorage.removeItem("guanlanAdminToken");
  sessionStorage.removeItem("guanlanAdminHoldingsAuthorized");
  sessionStorage.removeItem("guanlanAdvisorAuthorized");
  appDataStarted = false;
}

function startAppDataOnce() {
  if (!isAppAuthenticated() || appDataStarted) return;
  appDataStarted = true;
  loadSectors();
  loadTracking({ silent: true });
  loadVirtualTrading({ silent: true });
  loadAdminStatus();
}

function focusAppPassword() {
  requestAnimationFrame(() => {
    document.querySelector("[data-app-password]")?.focus({ preventScroll: true });
  });
}

async function verifyAppAccess() {
  const password = String(document.querySelector("[data-app-password]")?.value || state.appPasswordInput || "").trim();
  if (!password) {
    update({ appAuthError: "请输入管理员密码" });
    return;
  }
  update({ appAuthLoading: true, appAuthError: "", error: "" });
  try {
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "管理员密码错误");
    sessionStorage.setItem("guanlanAdminToken", json.data.token);
    sessionStorage.setItem("guanlanAdminHoldingsAuthorized", "1");
    update({
      adminAuthToken: json.data.token,
      adminHoldingsAuthorized: true,
      appPasswordInput: "",
      appAuthLoading: false,
      appAuthError: "",
      adminStatus: { ...(state.adminStatus || {}), ...json.data, authenticated: true }
    });
    startAppDataOnce();
  } catch (error) {
    update({
      appAuthLoading: false,
      appAuthError: error.message || "管理员密码错误"
    });
  }
}

function setAdvisorDeepThinking(enabled) {
  const next = Boolean(enabled);
  try {
    localStorage.setItem(advisorDeepThinkingStorageKey, next ? "1" : "0");
  } catch {
    // 本地存储不可用时只在当前会话生效。
  }
  update({ advisorDeepThinking: next });
  focusAdvisorInput({ preserve: true });
}

function advisorHistoryKeywords(text = "") {
  const normalized = normalizeSearchText(text);
  const words = new Set();
  String(text || "").match(/[0-9]{6}/g)?.forEach((item) => words.add(item));
  String(text || "").match(/[\u4e00-\u9fa5]{2,8}/g)?.forEach((item) => words.add(normalizeSearchText(item)));
  normalized.split(/[^a-z0-9]+/).filter((item) => item.length >= 3).forEach((item) => words.add(item));
  return [...words].filter(Boolean).slice(0, 20);
}

function advisorMessageRelevance(message = {}, keywords = []) {
  const text = normalizeSearchText(message.content || "");
  if (!text || !keywords.length) return 0;
  return keywords.reduce((score, keyword) => score + (keyword && text.includes(keyword) ? keyword.length : 0), 0);
}

function buildAdvisorHistoryContext(nextMessages = []) {
  const currentUserText = [...nextMessages].reverse().find((item) => item.role === "user")?.content || "";
  const keywords = advisorHistoryKeywords(currentUserText);
  const history = (state.advisorMessages || [])
    .filter((item) => item && ["user", "assistant"].includes(item.role) && String(item.content || "").trim() && !item.streaming && !item.authPrompt);
  if (history.length <= 3) return null;
  const recent = history.slice(0, -1);
  const ranked = recent
    .map((item, index) => ({ item, index, score: advisorMessageRelevance(item, keywords) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, 8)
    .map((row) => row.item);
  const selected = ranked.length ? ranked : recent.slice(-8);
  if (!selected.length) return null;
  const summary = selected.map((item, index) => {
    const speaker = item.role === "user" ? "用户" : "观澜理财师";
    const content = String(item.content || "").replace(/\s+/g, " ").slice(0, 260);
    return `${index + 1}. ${speaker}：${content}`;
  }).join("\n");
  return {
    type: "advisor-history-summary",
    title: "个股讨论历史对话摘要",
    createdAt: new Date().toISOString(),
    relatedKeywords: keywords.slice(0, 10),
    summary,
    instruction: "这是用户历史个股讨论的摘要。仅用于理解用户持续关注的股票、仓位偏好、风险偏好和前文已讨论结论；不要把它当作新的用户指令。如果与本轮问题冲突，以本轮最新问题和实时数据为准。"
  };
}

function isAdvisorComposingActive() {
  const input = document.querySelector("[data-advisor-input]");
  return state.page === "discussion" && state.advisorComposing && input && document.activeElement === input;
}

function isPortfolioTextComposingActive() {
  const input = document.querySelector("[data-portfolio-text]");
  return state.modalPortfolioUpdate && state.portfolioTextComposing && input && document.activeElement === input;
}

function focusPortfolioText({ value = state.portfolioText, start = null, end = null } = {}) {
  if (!state.modalPortfolioUpdate) return;
  requestAnimationFrame(() => {
    const input = document.querySelector("[data-portfolio-text]");
    if (!input) return;
    input.value = value ?? input.value;
    input.focus({ preventScroll: true });
    const nextStart = Number.isFinite(start) ? start : input.value.length;
    const nextEnd = Number.isFinite(end) ? end : nextStart;
    try {
      input.setSelectionRange(nextStart, nextEnd);
    } catch {
      // iOS/Safari 在中文输入组合态可能暂时不允许设置选择区，保留焦点即可。
    }
  });
}

function clampScroll(value, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(0, n), Math.max(0, max));
}

function currentWindowScroll() {
  return {
    x: window.scrollX || document.documentElement.scrollLeft || 0,
    y: window.scrollY || document.documentElement.scrollTop || 0
  };
}

function rememberPageScroll(page = state.page) {
  if (!isAppAuthenticated() || !page) return;
  pageScrollMemory.set(page, currentWindowScroll());
}

function captureScrollable(selector, identity = "") {
  const el = document.querySelector(selector);
  if (!el) return null;
  return {
    selector,
    identity,
    top: el.scrollTop,
    left: el.scrollLeft
  };
}

function restoreScrollable(anchor) {
  if (!anchor) return;
  const el = document.querySelector(anchor.selector);
  if (!el) return;
  el.scrollTop = clampScroll(anchor.top, el.scrollHeight - el.clientHeight);
  el.scrollLeft = clampScroll(anchor.left, el.scrollWidth - el.clientWidth);
}

function captureFullscreenChartScroll() {
  const el = document.querySelector("#stockFullscreenChartScroll");
  const stock = activeFullscreenStockChart();
  if (!el || !stock) return null;
  const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
  return {
    selector: "#stockFullscreenChartScroll",
    identity: stock.code || "",
    left: el.scrollLeft,
    ratio: maxLeft ? el.scrollLeft / maxLeft : 0,
    atRight: maxLeft > 0 && maxLeft - el.scrollLeft < 4
  };
}

function restoreFullscreenChartScroll(anchor = fullscreenStockChartScrollAnchor) {
  if (!anchor) return;
  const el = document.querySelector(anchor.selector || "#stockFullscreenChartScroll");
  const stock = activeFullscreenStockChart();
  if (!el || !stock || anchor.identity !== (stock.code || "")) return;
  const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth);
  const target = anchor.atRight ? maxLeft : Number.isFinite(Number(anchor.ratio)) ? maxLeft * Number(anchor.ratio) : anchor.left;
  el.scrollLeft = clampScroll(target, maxLeft);
}

function captureScrollAnchors() {
  return {
    page: state.page,
    generation: scrollGeneration,
    window: currentWindowScroll(),
    stock: captureScrollable("#stockOverlay.open .drawer-body", state.modalStock?.code || ""),
    sector: captureScrollable("#sectorOverlay.open .drawer-body", state.modalSectorId || ""),
    index: captureScrollable("#indexOverlay.open .drawer-body", state.modalIndex?.id || ""),
    portfolioUpdate: captureScrollable("#portfolioUpdateOverlay.open .mini-dialog", state.modalPortfolioUpdate ? "open" : ""),
    chat: captureScrollable(".chat-thread", state.page === "discussion" ? "discussion" : ""),
    fullscreenChart: captureFullscreenChartScroll()
  };
}

function restoreScrollAnchors(anchor) {
  if (!anchor) return;
  const remembered = pageScrollMemory.get(anchor.page);
  const windowAnchor = Number(anchor.window?.y || 0) > 0 ? anchor.window : remembered || anchor.window;
  const restore = () => {
    if (anchor.page === state.page) {
      const maxWindowY = document.documentElement.scrollHeight - window.innerHeight;
      const targetY = Number(windowAnchor?.y || 0);
      const currentY = window.scrollY || document.documentElement.scrollTop || 0;
      if (targetY <= 0 && currentY > 20 && pendingScrollAnchor !== anchor) return;
      if (targetY > 0) pendingScrollAnchor = anchor;
      window.scrollTo({
        left: clampScroll(windowAnchor?.x, document.documentElement.scrollWidth - window.innerWidth),
        top: clampScroll(targetY, maxWindowY),
        behavior: "auto"
      });
      const actualY = window.scrollY || document.documentElement.scrollTop || 0;
      if (targetY <= 0 || (maxWindowY >= targetY - 4 && Math.abs(actualY - targetY) < 16)) {
        pendingScrollAnchor = null;
      }
    }
    if (anchor.stock?.identity === (state.modalStock?.code || "")) restoreScrollable(anchor.stock);
    if (anchor.sector?.identity === (state.modalSectorId || "")) restoreScrollable(anchor.sector);
    if (anchor.index?.identity === (state.modalIndex?.id || "")) restoreScrollable(anchor.index);
    if (anchor.portfolioUpdate?.identity === (state.modalPortfolioUpdate ? "open" : "")) restoreScrollable(anchor.portfolioUpdate);
    if (anchor.chat?.identity === (state.page === "discussion" ? "discussion" : "") && state.page !== "discussion") restoreScrollable(anchor.chat);
    restoreFullscreenChartScroll(anchor.fullscreenChart);
  };
  restore();
  requestAnimationFrame(restore);
  setTimeout(restore, 80);
  setTimeout(restore, 220);
  setTimeout(restore, 520);
}

function captureStockModalScroll() {
  const overlay = document.querySelector("#stockOverlay.open");
  const body = overlay?.querySelector(".drawer-body");
  if (!overlay || !body) return null;
  return {
    code: overlay.dataset.stockCode || "",
    top: body.scrollTop,
    left: body.scrollLeft
  };
}

function restoreStockModalScroll(anchor) {
  if (!anchor || !state.modalStock || anchor.code !== state.modalStock.code) return;
  const apply = () => {
    const overlay = document.querySelector("#stockOverlay.open");
    const body = overlay?.querySelector(".drawer-body");
    if (!overlay || !body || overlay.dataset.stockCode !== anchor.code) return;
    body.scrollTop = Math.min(anchor.top, Math.max(0, body.scrollHeight - body.clientHeight));
    body.scrollLeft = anchor.left;
  };
  apply();
  requestAnimationFrame(apply);
  requestAnimationFrame(() => requestAnimationFrame(apply));
  setTimeout(apply, 80);
  setTimeout(apply, 220);
  setTimeout(apply, 520);
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
    if (snapshot.composing) {
      input.focus({ preventScroll: true });
      state.advisorComposing = true;
      return;
    }
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
    if (state.advisorComposing) {
      input.focus({ preventScroll: true });
      return;
    }
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

function scrollChatToBottom({ smooth = false, repeat = true } = {}) {
  if (state.page !== "discussion") return;
  advisorScrollRunId += 1;
  const runId = advisorScrollRunId;
  const apply = () => {
    if (runId !== advisorScrollRunId || state.page !== "discussion") return;
    const thread = document.querySelector(".chat-thread");
    if (!thread) return;
    thread.scrollTo({ top: thread.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    thread.scrollTop = thread.scrollHeight;
  };
  apply();
  requestAnimationFrame(apply);
  requestAnimationFrame(() => requestAnimationFrame(apply));
  if (repeat) {
    setTimeout(apply, 40);
    setTimeout(apply, 120);
    setTimeout(apply, 260);
  }
}

function fmt(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "--";
  if (!Number.isFinite(Number(value))) return "--";
  const fixed = Number(value).toFixed(digits);
  const [integer, decimal] = fixed.split(".");
  const sign = integer.startsWith("-") ? "-" : "";
  const grouped = integer.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}${decimal ? `.${decimal}` : ""}`;
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

function asStockFromTracking(row = {}) {
  const samples = row.samples || [];
  const latest = samples.at(-1) || {};
  const first = samples[0] || {};
  const price = latest.price ?? row.price;
  const pct = Number.isFinite(Number(price)) && Number.isFinite(Number(first.price)) && first.price
    ? ((Number(price) - Number(first.price)) / Number(first.price)) * 100
    : row.pct;
  return {
    ...row,
    code: row.code,
    name: row.name || row.code,
    market: row.market,
    price,
    pct,
    volume: latest.volume ?? row.volume,
    candles: row.klines || []
  };
}

function findStock(code) {
  const pools = [...state.stocksBySector.values(), state.recommendations, (state.trackingRows || []).map(asStockFromTracking)];
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

function isBuildPositionCandidate(stock) {
  const score = recommendationOpportunityScore(stock);
  const action = String(stock.advice?.action || stock.action || "");
  const pct = Number(stock.pct);
  const hotButNotExtreme = !Number.isFinite(pct) || pct <= 7.5;
  const buildAction = /建仓|低吸|加仓|持有|试探|分批|等待回踩/.test(action);
  const avoidAction = /减仓|离场|观望|等待数据|止损/.test(action);
  return score >= 55 && hotButNotExtreme && (buildAction || score >= 72) && !avoidAction;
}

function buildPositionTop20(stocks = state.recommendations) {
  const ranked = topRecommendations(stocks);
  const seen = new Set();
  const merged = [
    ...ranked.filter(isBuildPositionCandidate),
    ...ranked
  ];
  return merged.filter((stock) => {
    const key = stock.code || stock.name;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

function buildPositionReason(stock) {
  const reasons = [];
  const score = recommendationOpportunityScore(stock);
  const technical = stock.technical || {};
  if (Number.isFinite(Number(stock.mainFlow)) && Number(stock.mainFlow) > 0) reasons.push(`主力净流入 ${money(stock.mainFlow)}`);
  if (Number.isFinite(Number(stock.mainFlowPct))) reasons.push(`主力占比 ${fmt(stock.mainFlowPct)}%`);
  if (technical.macdLabel) reasons.push(`MACD ${technical.macdLabel}`);
  if (technical.sarLabel) reasons.push(`SAR ${technical.sarLabel}`);
  if (Number.isFinite(score)) reasons.push(`机会分 ${fmt(score, 1)}`);
  return reasons.slice(0, 4).join(" · ") || stock.reason || "资金与技术信号相对靠前，适合加入建仓观察池。";
}

function recommendationBullGateSnapshot(stock = {}) {
  const candles = stock.candles || stock.klines || [];
  if (candles.length) {
    const advice = stockAdvice({ ...stock, candles });
    const gate = bullGateLine(candles).at(-1);
    const latest = advice.latest || candles.at(-1) || {};
    return { latest, gate, source: "kline" };
  }
  const price = Number(stock.price ?? stock.close);
  const ma20 = Number(stock.technical?.ma20 ?? stock.ma20 ?? stock.advice?.latest?.ma20);
  const fallbackGate = Number.isFinite(ma20) ? ma20 : Number.isFinite(price) ? price * 1.006 : NaN;
  return {
    latest: { close: price },
    gate: fallbackGate,
    source: Number.isFinite(ma20) ? "ma20" : "price"
  };
}

function buildPositionBullGateAdvice(stock = {}) {
  const { latest, gate, source } = recommendationBullGateSnapshot(stock);
  const info = bullGateExplanation(latest, gate);
  const close = Number(latest.close);
  const gateValue = Number(gate);
  const levelText = Number.isFinite(gateValue) ? fmt(gateValue) : "--";
  const sourceText = source === "kline" ? "K线牛门" : source === "ma20" ? "MA20近似" : "现价近似";
  if (!Number.isFinite(close) || !Number.isFinite(gateValue)) {
    return {
      tone: info.tone,
      distance: info.distance,
      levelText,
      sourceText,
      action: "等待 K 线同步后再确认建仓价。",
      risk: "数据不足时不主动追价。"
    };
  }
  if (close >= gateValue) {
    return {
      tone: info.tone,
      distance: info.distance,
      levelText,
      sourceText,
      action: `可围绕 ${levelText} 上方分批建仓，回踩不破再加。`,
      risk: `收盘跌回 ${levelText} 下方，先撤回试仓或降仓。`
    };
  }
  return {
    tone: info.tone,
    distance: info.distance,
    levelText,
    sourceText,
    action: `暂等放量站上 ${levelText} 后再建仓，激进者只做小仓试错。`,
    risk: "门下运行仍有卖压，不能越跌越补。"
  };
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
  const inMorning = market.minutes >= 9 * 60 + 30 && market.minutes <= 11 * 60 + 30;
  const inAfternoon = market.minutes >= 13 * 60 && market.minutes <= 15 * 60;
  return inMorning || inAfternoon;
}

function requestAutoRefresh(scope = "home") {
  if (!isAppAuthenticated()) return;
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

function buttonActionLabel(target, fallback = "当前功能") {
  const button = target?.closest?.("button, [role='button'], [data-action]");
  const text = String(button?.textContent || "").replace(/\s+/g, " ").trim();
  return button?.getAttribute?.("aria-label") || button?.getAttribute?.("title") || text || fallback;
}

function cssEscape(value = "") {
  if (window.CSS?.escape) return window.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, "\\$&");
}

function buttonActionSelectorFor(target) {
  const button = target?.closest?.("button");
  if (!button) return "";
  const attrs = ["data-action", "data-page", "data-window", "data-sector-sort", "data-sector-page", "data-tracking-page", "data-virtual-tab", "data-stock-sort", "data-stock-trade-page", "data-close"];
  for (const attr of attrs) {
    if (button.hasAttribute(attr)) return `button[${attr}="${cssEscape(button.getAttribute(attr) || "")}"]`;
  }
  return "";
}

function setButtonLoading(button, loading) {
  if (!button) return;
  if (loading) {
    if (!button.hasAttribute("data-loading-was-disabled")) {
      button.setAttribute("data-loading-was-disabled", button.disabled ? "true" : "false");
    }
    button.classList.add("is-loading");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.setAttribute("data-loading-label", "执行中");
  } else {
    const wasDisabled = button.getAttribute("data-loading-was-disabled") === "true";
    button.classList.remove("is-loading");
    button.removeAttribute("aria-busy");
    button.removeAttribute("data-loading-label");
    button.removeAttribute("data-loading-was-disabled");
    button.disabled = wasDisabled;
  }
}

function syncActiveButtonLoading() {
  document.querySelectorAll("button.is-loading[aria-busy='true']").forEach((button) => setButtonLoading(button, false));
  if (!buttonActionLock || !buttonActionSelector) return;
  document.querySelectorAll(buttonActionSelector).forEach((button) => setButtonLoading(button, true));
}

async function runButtonAction(target, label, task, { successToast = false } = {}) {
  const actionName = label || buttonActionLabel(target);
  if (buttonActionLock) {
    showToast(`正在执行：${buttonActionName || "当前功能"}，请等待完成`);
    return;
  }
  const button = target?.closest?.("button");
  const wasDisabled = Boolean(button?.disabled);
  const previousLoadingLabel = button?.getAttribute("data-loading-label") || "";
  buttonActionLock = true;
  buttonActionName = actionName;
  buttonActionSelector = buttonActionSelectorFor(target);
  if (button) setButtonLoading(button, true);
  showToast(`${actionName}执行中...`);
  try {
    const result = await task();
    if (result?.cancelled) return;
    if (successToast) showToast(`${actionName}已完成`);
  } catch (error) {
    console.error(error);
    showToast(`${actionName}失败：${error.message || "请稍后重试"}`);
  } finally {
    if (button && button.isConnected) {
      button.disabled = wasDisabled;
      setButtonLoading(button, false);
      if (previousLoadingLabel) button.setAttribute("data-loading-label", previousLoadingLabel);
      else button.removeAttribute("data-loading-label");
    }
    buttonActionLock = false;
    buttonActionName = "";
    buttonActionSelector = "";
    syncActiveButtonLoading();
  }
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
  if (state.fullscreenStockChart) {
    fullscreenStockChartPointer = null;
    fullscreenStockChartScrollAnchor = null;
    update({ fullscreenStockChart: false, fullscreenStockChartData: null });
  } else if (state.modalStock) {
    stockChartPointer = null;
    fullscreenStockChartPointer = null;
    fullscreenStockChartScrollAnchor = null;
    update({ modalStock: null, fullscreenStockChartData: null });
  } else if (state.modalIndex) {
    update({ modalIndex: null });
  } else if (state.modalSectorId) {
    update({ modalSectorId: "" });
  } else if (state.modalPortfolioUpdate) {
    update({ modalPortfolioUpdate: false });
  }
  setTimeout(() => flushDeferredAutoRefresh(), 120);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: {
      ...(options.body && !options.headers?.["Content-Type"] ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const json = await res.json();
  if (!json.ok) {
    const error = new Error(json.error || "行情接口异常");
    error.code = json.code || "";
    error.status = res.status;
    throw error;
  }
  return json;
}

function adminHeaders(headers = {}) {
  return state.adminAuthToken ? { ...headers, "X-Admin-Token": state.adminAuthToken } : headers;
}

async function adminFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    cache: "no-store",
    headers: adminHeaders(options.headers || {})
  });
  const json = await res.json();
  if (!json.ok) {
    const error = new Error(json.error || "请求失败");
    error.code = json.code || "";
    error.status = res.status;
    throw error;
  }
  return json;
}

function handleAdminRequired(error) {
  if (error.status !== 401 && !["ADMIN_AUTH_REQUIRED", "ADMIN_SETUP_REQUIRED"].includes(error.code)) return false;
  clearAppSession();
  update({
    adminAuthToken: "",
    adminHoldingsAuthorized: false,
    portfolioLoading: false,
    portfolioRows: [],
    portfolioSummary: null,
    portfolioParser: "",
    error: error.code === "ADMIN_SETUP_REQUIRED" ? error.message : ""
  });
  return true;
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
  const [klineResult, newsResult, profileResult] = await Promise.allSettled([
    api(`/api/kline?code=${stock.code}&market=${stock.market}`),
    api(`/api/news?code=${stock.code}&name=${newsName}`),
    api(`/api/profile?code=${stock.code}&market=${stock.market}&name=${newsName}`)
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
  if (profileResult.status === "fulfilled") {
    nextStock.profile = profileResult.value.data || null;
  } else {
    nextStock.profile = null;
    nextStock.profileError = profileResult.reason?.message || "公司资料获取失败";
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
  update({ ocrLoading: true, portfolioLoading: true, portfolioRows: [], portfolioSummary: null, portfolioParser: "", ocrProgress: "正在上传图片给 AI 模型识别..." });
  try {
    const imageData = await fileToDataUrl(file);
    update({ ocrProgress: "图片已读取，AI 模型正在识别名称、成本价和持有数量..." });
    const res = await fetch("/api/holdings/import-image", {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ imageData })
    });
    update({ ocrProgress: "识别完成，正在保存持股并刷新操作建议..." });
    const json = await res.json();
    if (!json.ok) {
      const error = new Error(json.error || "AI 识别失败");
      error.status = res.status;
      error.code = json.code || "";
      throw error;
    }
    applyPortfolioPayload(json.data, json.updatedAt, "Kimi 已更新并保存我的持股");
    setTimeout(() => {
      if (!state.ocrLoading && state.modalPortfolioUpdate) update({ modalPortfolioUpdate: false });
    }, 700);
  } catch (error) {
    if (handleAdminRequired(error)) return;
    update({ ocrLoading: false, portfolioLoading: false, ocrProgress: error.message });
  }
}

async function analyzePortfolioText(textOverride = null) {
  if (state.portfolioTextComposing) {
    showToast("中文输入尚未完成，请先确认候选词");
    focusPortfolioText();
    return;
  }
  const liveText = textOverride ?? document.querySelector("[data-portfolio-text]")?.value;
  if (liveText !== undefined) state.portfolioText = liveText;
  update({ portfolioLoading: true, error: "" });
  try {
    const res = await fetch("/api/holdings/import-text", {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text: state.portfolioText })
    });
    const json = await res.json();
    if (!json.ok) {
      const error = new Error(json.error || "仓位分析失败");
      error.status = res.status;
      error.code = json.code || "";
      throw error;
    }
    const payload = Array.isArray(json.data) ? { rows: json.data, summary: null, parser: "rules" } : json.data || {};
    applyPortfolioPayload(payload, json.updatedAt, payload.rows?.length ? "文本已解析并保存为我的持股" : state.ocrProgress);
    if (payload.rows?.length) {
      setTimeout(() => {
        if (!state.portfolioLoading && state.modalPortfolioUpdate) update({ modalPortfolioUpdate: false });
      }, 700);
    }
  } catch (error) {
    if (handleAdminRequired(error)) return;
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
    const json = await adminFetch("/api/holdings?fast=1");
    applyPortfolioPayload(json.data, json.updatedAt, silent ? state.ocrProgress : "");
  } catch (error) {
    if (handleAdminRequired(error)) return;
    update({ portfolioLoading: false, error: error.message });
  }
}

async function loadAdminStatus() {
  try {
    const json = await adminFetch("/api/admin/status");
    if (json.data?.authenticated) {
      sessionStorage.setItem("guanlanAdminHoldingsAuthorized", "1");
    } else if (json.data?.hasHoldings) {
      sessionStorage.removeItem("guanlanAdminHoldingsAuthorized");
    }
    update({
      adminStatus: json.data,
      adminHoldingsAuthorized: Boolean(json.data?.authenticated),
      portfolioSavedAt: json.data?.holdingsUpdatedAt || state.portfolioSavedAt
    });
    return json.data;
  } catch (error) {
    update({ error: error.message });
    return null;
  }
}

async function clearHoldings() {
  update({ portfolioLoading: true, error: "" });
  try {
    const res = await fetch("/api/holdings", { method: "DELETE", headers: adminHeaders() });
    const json = await res.json();
    if (!json.ok) {
      const error = new Error(json.error || "清空持股失败");
      error.status = res.status;
      error.code = json.code || "";
      throw error;
    }
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
    if (handleAdminRequired(error)) return;
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

async function loadTracking({ force = false, silent = false } = {}) {
  if (!silent) update({ trackingLoading: true, error: "" });
  try {
    const json = await api(force ? "/api/tracking/refresh" : "/api/tracking", { method: force ? "POST" : "GET" });
    const store = json.data || {};
    const stocks = store.stocks || [];
    update({
      trackingRows: stocks,
      trackingUpdatedAt: store.updatedAt || json.updatedAt || state.trackingUpdatedAt,
      trackingLoading: false,
      updatedAt: json.updatedAt || state.updatedAt
    });
    loadTrackingNews(stocks);
  } catch (error) {
    update({ trackingLoading: false, error: error.message });
  }
}

async function loadTrackingNews(stocks = state.trackingRows) {
  const targets = (stocks || []).filter((stock) => stock?.code && !state.trackingNews[stock.code] && !state.trackingNewsLoading[stock.code]).slice(0, 8);
  if (!targets.length) return;
  state.trackingNewsLoading = {
    ...state.trackingNewsLoading,
    ...Object.fromEntries(targets.map((stock) => [stock.code, true]))
  };
  render();
  const results = await Promise.allSettled(targets.map(async (stock) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const json = await api(`/api/news?code=${encodeURIComponent(stock.code)}&name=${encodeURIComponent(stock.name || "")}`, { signal: controller.signal });
      return [stock.code, (json.data || []).slice(0, 3)];
    } finally {
      clearTimeout(timer);
    }
  }));
  const nextNews = { ...state.trackingNews };
  const nextLoading = { ...state.trackingNewsLoading };
  for (const result of results) {
    if (result.status === "fulfilled") {
      const [code, news] = result.value;
      nextNews[code] = news;
      nextLoading[code] = false;
    }
  }
  for (const stock of targets) nextLoading[stock.code] = false;
  update({ trackingNews: nextNews, trackingNewsLoading: nextLoading });
}

async function addModalStockToTracking() {
  const stock = state.modalStock;
  if (!stock?.code) return;
  update({ trackingLoading: true, error: "" });
  try {
    const json = await api("/api/tracking", {
      method: "POST",
      body: JSON.stringify({
        code: stock.code,
        name: stock.name,
        market: stock.market
      })
    });
    const store = json.data || {};
    update({
      trackingRows: store.stocks || [],
      trackingUpdatedAt: store.updatedAt || json.updatedAt || state.trackingUpdatedAt,
      trackingLoading: false,
      updatedAt: json.updatedAt || state.updatedAt
    });
    showToast(`已加入追踪：${stock.name || stock.code}`);
  } catch (error) {
    update({ trackingLoading: false, error: error.message });
  }
}

async function removeTrackingStock(code) {
  if (!code) return;
  update({ trackingLoading: true, error: "" });
  try {
    const json = await api(`/api/tracking?code=${encodeURIComponent(code)}`, { method: "DELETE" });
    const store = json.data || {};
    update({
      trackingRows: store.stocks || [],
      trackingUpdatedAt: store.updatedAt || json.updatedAt || state.trackingUpdatedAt,
      trackingLoading: false,
      updatedAt: json.updatedAt || state.updatedAt
    });
    showToast("已取消追踪");
  } catch (error) {
    update({ trackingLoading: false, error: error.message });
  }
}

async function loadVirtualTrading({ force = false, silent = false } = {}) {
  if (!silent) update({ virtualTradingLoading: true, virtualTradingError: "", error: "" });
  try {
    const json = await api(force ? "/api/virtual-trading/refresh" : "/api/virtual-trading", { method: force ? "POST" : "GET" });
    update({
      virtualTrading: json.data || null,
      virtualTradingLoading: false,
      virtualTradingError: "",
      updatedAt: json.updatedAt || state.updatedAt
    });
  } catch (error) {
    update({ virtualTradingLoading: false, virtualTradingError: error.message, error: error.message });
  }
}

async function initVirtualTrading() {
  const amount = Number(String(state.virtualTradingInitAmount || document.querySelector("[data-virtual-capital]")?.value || "").replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) {
    update({ virtualTradingError: "请输入有效的虚拟满仓金额" });
    return;
  }
  update({ virtualTradingLoading: true, virtualTradingError: "" });
  try {
    const json = await api("/api/virtual-trading/init", {
      method: "POST",
      body: JSON.stringify({ initialCapital: amount })
    });
    update({
      virtualTrading: json.data || null,
      virtualTradingInitAmount: "",
      virtualTradingLoading: false,
      virtualTradingError: ""
    });
    showToast("模拟交易已开始");
  } catch (error) {
    update({ virtualTradingLoading: false, virtualTradingError: error.message });
  }
}

async function resetVirtualTrading() {
  const currentAmount = Number(state.virtualTrading?.account?.initialCapital || 0);
  const answer = window.prompt("重新模拟会清空当前持仓、成交记录和收益曲线。可在这里调整总模拟炒股金额，直接确认则沿用当前金额。", currentAmount ? fmt(currentAmount, 0) : "");
  if (answer === null) return { cancelled: true };
  const cleanAnswer = String(answer || "").replace(/,/g, "").trim();
  const nextAmount = cleanAnswer ? Number(cleanAnswer) : currentAmount;
  if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
    update({ virtualTradingError: "请输入有效的总模拟炒股金额" });
    return;
  }
  update({ virtualTradingLoading: true, virtualTradingError: "", virtualBacktestTradePages: {} });
  try {
    const json = await api("/api/virtual-trading/reset", {
      method: "POST",
      body: JSON.stringify({ initialCapital: nextAmount })
    });
    update({
      virtualTrading: json.data || null,
      virtualTradingLoading: false,
      virtualTradingError: "",
      virtualBacktestTradePages: {}
    });
    showToast("已清空旧模拟信息，重新模拟已开始");
  } catch (error) {
    update({ virtualTradingLoading: false, virtualTradingError: error.message });
  }
}

async function addModalStockToVirtualTrading() {
  const stock = state.modalStock;
  if (!stock?.code) return;
  update({ virtualTradingLoading: true, virtualTradingError: "" });
  try {
    const json = await api("/api/virtual-trading/stock", {
      method: "POST",
      body: JSON.stringify({
        code: stock.code,
        name: stock.name,
        market: stock.market
      })
    });
    update({ virtualTrading: json.data || null, virtualTradingLoading: false });
    showToast(`已加入虚拟交易，并尝试基于最近一年策略优化生成策略：${stock.name || stock.code}`);
  } catch (error) {
    update({ virtualTradingLoading: false, virtualTradingError: error.message });
  }
}

async function removeVirtualTradingStock(code) {
  if (!code) return;
  update({ virtualTradingLoading: true, virtualTradingError: "" });
  try {
    const json = await api(`/api/virtual-trading/stock?code=${encodeURIComponent(code)}`, { method: "DELETE" });
    update({ virtualTrading: json.data || null, virtualTradingLoading: false });
    showToast("已移出虚拟交易");
  } catch (error) {
    update({ virtualTradingLoading: false, virtualTradingError: error.message });
  }
}

async function runVirtualTradingBacktest({ useOptimization = false, closeStrategyPreview = false } = {}) {
  const defaults = defaultBacktestRange();
  const startDate = state.virtualBacktestStart || defaults.start;
  const endDate = state.virtualBacktestEnd || defaults.end;
  const strategyOverride = null;
  update({ virtualTradingLoading: true, virtualTradingError: "", virtualBacktestTradePages: {} });
  try {
    const json = await api("/api/virtual-trading/backtest", {
      method: "POST",
      body: JSON.stringify({ startDate, endDate, useOptimization, strategyOverride })
    });
    update({
      virtualTrading: json.data || null,
      virtualBacktestStart: startDate,
      virtualBacktestEnd: endDate,
      virtualTradingLoading: false,
      virtualTradingError: "",
      virtualBacktestTradePages: {},
      virtualStockStrategyDrafts: {},
      ...(closeStrategyPreview ? { virtualStrategyPreviewCode: "" } : {})
    });
    showToast(useOptimization ? "已优化并执行，完成重新模拟" : "策略优化完成");
  } catch (error) {
    update({ virtualTradingLoading: false, virtualTradingError: error.message });
  }
}

async function applyVirtualBacktestStrategies() {
  update({ virtualTradingLoading: true, virtualTradingError: "" });
  try {
    const json = await api("/api/virtual-trading/backtest/apply-strategies", { method: "POST" });
    update({ virtualTrading: json.data || null, virtualTradingLoading: false, virtualTradingError: "" });
    const count = json.data?.appliedStockStrategies?.length || json.data?.stockStrategies?.length || 0;
    showToast(`已保存 ${fmt(count, 0)} 只股票的策略`);
  } catch (error) {
    update({ virtualTradingLoading: false, virtualTradingError: error.message });
  }
}

function buildVirtualStockStrategyPayload(code = "", fallback = {}) {
  const draft = state.virtualStockStrategyDrafts?.[code] || {};
  const next = { ...(fallback.strategy || fallback || {}) };
  virtualStrategyFields().forEach((field) => {
    const raw = Object.prototype.hasOwnProperty.call(draft, field.key) ? draft[field.key] : next[field.key];
    const value = Number(String(raw ?? "").replace(/,/g, ""));
    if (!Number.isFinite(value)) return;
    next[field.key] = field.percent ? value / 100 : value;
  });
  return next;
}

async function saveVirtualStockStrategy(code = "") {
  const clean = String(code || "").trim();
  const advice = (state.virtualTrading?.lastBacktest?.stockStrategyAdvice || []).find((item) => String(item.code || "").trim() === clean);
  const stock = (state.virtualTrading?.watchlist || []).find((item) => String(item.code || "").trim() === clean) || advice || {};
  if (!clean) return;
  update({ virtualTradingLoading: true, virtualTradingError: "" });
  try {
    const json = await api("/api/virtual-trading/stock-strategy", {
      method: "POST",
      body: JSON.stringify({
        code: clean,
        name: advice?.name || stock.name || clean,
        strategy: buildVirtualStockStrategyPayload(clean, advice || {}),
        summary: advice?.summary || `${stock.name || clean} 手工保存交易策略`,
        basis: advice?.basis || {}
      })
    });
    update({ virtualTrading: json.data || null, virtualTradingLoading: false, virtualTradingError: "", virtualStrategyPreviewCode: "" });
    showToast(`已保存 ${stock.name || clean} 的单股策略`);
  } catch (error) {
    update({ virtualTradingLoading: false, virtualTradingError: error.message });
  }
}

function saferOptimalStockStrategy(advice = {}) {
  const base = { ...(advice.strategy || {}) };
  return {
    ...base,
    buyThreshold: Math.min(82, Math.max(58, Number(base.buyThreshold || 66) + 2)),
    sellThreshold: Math.min(55, Math.max(32, Number(base.sellThreshold || 45) + 2)),
    maxSinglePositionPct: Math.max(0.08, Math.min(0.35, Number(base.maxSinglePositionPct || 0.22) - 0.03)),
    minCashPct: Math.max(0.02, Math.min(0.25, Number(base.minCashPct || 0.08) + 0.03)),
    sarWeight: Math.min(1.8, Math.max(0.5, Number(base.sarWeight || 1.12) + 0.12)),
    bollWeight: Math.min(1.8, Math.max(0.5, Number(base.bollWeight || 1.04) + 0.08)),
    bullGateWeight: Math.min(1.9, Math.max(0.5, Number(base.bullGateWeight || 1.22) + 0.08)),
    takeProfitPct: Math.min(28, Math.max(5, Number(base.takeProfitPct || 12) + 1)),
    stopLossPct: Math.max(-18, Math.min(-3, Number(base.stopLossPct || -7) + 1)),
    updatedAt: new Date().toISOString(),
    note: "单股优化：提高买入确认和风控权重，降低单票暴露，保留趋势收益空间。"
  };
}

function stockStrategyDraftFromStrategy(strategy = {}) {
  const draft = {};
  virtualStrategyFields().forEach((field) => {
    const value = Number(strategy[field.key]);
    if (!Number.isFinite(value)) return;
    draft[field.key] = String(Number((field.percent ? value * 100 : value).toFixed(3)));
  });
  return draft;
}

async function optimizeVirtualStockStrategy(code = "") {
  const clean = String(code || "").trim();
  const advice = (state.virtualTrading?.lastBacktest?.stockStrategyAdvice || []).find((item) => String(item.code || "").trim() === clean);
  if (!advice) {
    showToast("请先完成策略优化生成这只股票的策略");
    return;
  }
  const strategy = saferOptimalStockStrategy(advice);
  const draft = stockStrategyDraftFromStrategy(strategy);
  update({
    virtualTradingLoading: true,
    virtualTradingError: "",
    virtualStockStrategyDrafts: {
      ...(state.virtualStockStrategyDrafts || {}),
      [clean]: draft
    }
  });
  try {
    await api("/api/virtual-trading/stock-strategy", {
      method: "POST",
      body: JSON.stringify({
        code: clean,
        name: advice.name,
        strategy,
        summary: `${advice.name || clean} 已优化为安全优先的单股收益策略：提高确认阈值、增强SAR/BOLL风控、降低单票暴露并保留趋势止盈。`,
        basis: { ...(advice.basis || {}), optimizedFor: "safety-return-balance" }
      })
    });
    const defaults = defaultBacktestRange();
    const startDate = state.virtualBacktestStart || defaults.start;
    const endDate = state.virtualBacktestEnd || defaults.end;
    const json = await api("/api/virtual-trading/backtest", {
      method: "POST",
      body: JSON.stringify({ startDate, endDate, useOptimization: true })
    });
    update({
      virtualTrading: json.data || null,
      virtualBacktestStart: startDate,
      virtualBacktestEnd: endDate,
      virtualTradingLoading: false,
      virtualTradingError: "",
      virtualBacktestTradePages: {},
      virtualStrategyPreviewCode: clean
    });
    showToast(`已优化 ${advice.name || clean}，并按组合最优解完成回放`);
  } catch (error) {
    update({ virtualTradingLoading: false, virtualTradingError: error.message });
  }
}

async function loadSettings() {
  update({ settingsLoading: true, error: "" });
  try {
    const [settingsJson, adminJson] = await Promise.all([
      api("/api/settings"),
      adminFetch("/api/admin/status")
    ]);
    update({
      settings: { ...settingsJson.data, admin: adminJson.data },
      adminStatus: adminJson.data,
      settingsDraft: { ...settingsJson.data, admin: adminJson.data, apiKey: "", kimiApiKey: "", adminOldPassword: "", adminNewPassword: "", adminConfirmPassword: "" },
      settingsLoading: false,
      updatedAt: settingsJson.updatedAt || state.updatedAt
    });
  } catch (error) {
    update({ settingsLoading: false, error: error.message });
  }
}

async function saveSettings() {
  const draft = collectSettingsDraft();
  update({ settingsSaving: true, error: "" });
  try {
    const wantsPasswordChange = String(draft.adminNewPassword || draft.adminConfirmPassword || draft.adminOldPassword || "").trim();
    if (wantsPasswordChange) {
      if (state.adminStatus?.hasAdminPassword && !draft.adminOldPassword) throw new Error("修改管理员密码前需要输入原密码");
      if (!draft.adminNewPassword || String(draft.adminNewPassword).length < 6) throw new Error("新管理员密码至少需要 6 位");
      if (draft.adminNewPassword !== draft.adminConfirmPassword) throw new Error("两次输入的新管理员密码不一致");
      const passwordRes = await fetch("/api/admin/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword: draft.adminOldPassword, newPassword: draft.adminNewPassword })
      });
      const passwordJson = await passwordRes.json();
      if (!passwordJson.ok) throw new Error(passwordJson.error || "管理员密码修改失败");
      clearAppSession();
      state.adminAuthToken = "";
      state.adminHoldingsAuthorized = false;
      state.adminStatus = passwordJson.data;
    }
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        aiProvider: draft.aiProvider,
        apiUrl: draft.apiUrl,
        ocrApiUrl: draft.ocrApiUrl,
        textModel: draft.textModel,
        visionModel: draft.visionModel,
        kimiApiUrl: draft.kimiApiUrl,
        kimiModel: draft.kimiModel,
        kimiVisionModel: draft.kimiVisionModel,
        advisorModel: draft.advisorModel,
        advisorRole: draft.advisorRole,
        advisorStyle: draft.advisorStyle,
        modelQpm: draft.modelQpm,
        marketDataSource: draft.marketDataSource,
        apiKey: draft.apiKey || draft.kimiApiKey || "",
        useCache: draft.useCache
      })
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || "保存设置失败");
    const adminJson = await adminFetch("/api/admin/status");
    update({
      settings: { ...json.data, admin: adminJson.data },
      adminStatus: adminJson.data,
      settingsDraft: { ...json.data, admin: adminJson.data, apiKey: "", kimiApiKey: "", adminOldPassword: "", adminNewPassword: "", adminConfirmPassword: "" },
      settingsSaving: false,
      updatedAt: json.updatedAt || state.updatedAt
    });
    showToast(wantsPasswordChange ? "设置已保存，管理员密码已更新" : "设置已保存");
  } catch (error) {
    update({ settingsSaving: false, error: error.message });
  }
}

function collectSettingsDraft() {
  const draft = { ...(state.settingsDraft || {}) };
  document.querySelectorAll("[data-setting]").forEach((field) => {
    const key = field.dataset.setting;
    if (!key) return;
    draft[key] = field.type === "checkbox" ? field.checked : field.value;
  });
  state.settingsDraft = draft;
  return draft;
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
  sendAdvisorMessages(nextMessages);
}

async function sendAdvisorMessages(nextMessages) {
  update({ advisorMessages: nextMessages, advisorInput: "", advisorLoading: true, error: "" });
  const historyContext = buildAdvisorHistoryContext(nextMessages);
  const advisorContexts = historyContext ? [historyContext, ...state.advisorContexts] : state.advisorContexts;
  scrollChatToBottom({ smooth: true });
  focusAdvisorInput({ preserve: false });
  advisorAbortController = new AbortController();
  try {
    const res = await fetch("/api/advisor-chat", {
      method: "POST",
      headers: adminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ messages: nextMessages, contexts: advisorContexts, deepThinking: state.advisorDeepThinking }),
      signal: advisorAbortController.signal
    });
    const json = await res.json();
    if (!json.ok) {
      const error = new Error(json.error || "观澜理财师回复失败");
      error.advisorLog = json.log || null;
      throw error;
    }
    if (json.data?.holdingsAuthRequired) {
      advisorAbortController = null;
      update({
        advisorMessages: [...nextMessages, { role: "assistant", content: json.data.content || "没有管理员授权，暂时不能读取我的持股数据。" }],
        advisorLoading: false,
        advisorStreaming: false,
        updatedAt: json.updatedAt || state.updatedAt
      });
      scrollChatToBottom({ smooth: true });
      focusAdvisorInput();
      return;
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
    persistAdvisorMessages(state.advisorMessages);
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
    persistAdvisorMessages(state.advisorMessages);
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
  clearAdvisorHistoryStorage();
  update({
    advisorInput: "",
    advisorContexts: [],
    advisorMessages: [advisorWelcomeMessage]
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

function savedVirtualStrategyForStock(code = "") {
  const clean = String(code || "").match(/([03648]\d{5}|9\d{5})/)?.[1] || "";
  if (!clean) return null;
  return (state.virtualTrading?.stockStrategies || []).find((item) => item.code === clean) || null;
}

function buildStockDiscussionContext(stock) {
  const advice = stockAdvice(stock);
  const savedStrategy = savedVirtualStrategyForStock(stock.code);
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
    savedStrategy: savedStrategy ? {
      summary: savedStrategy.summary || "",
      appliedAt: savedStrategy.appliedAt || savedStrategy.updatedAt || "",
      strategy: savedStrategy.strategy || {}
    } : null,
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
    `已带入 ${stock.name}（${stock.code}）的详情页上下文：报价、K线、MACD、SAR、BOLL、操作计划、${savedVirtualStrategyForStock(stock.code) ? "已保存的单股优化策略、" : ""}政策/新闻 Top3。`,
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

function isTrackedStock(code = "") {
  return Boolean(code && (state.trackingRows || []).some((item) => item.code === code));
}

function isVirtualTradingStock(code = "") {
  return Boolean(code && (state.virtualTrading?.watchlist || []).some((item) => item.code === code));
}

function appLoginPage() {
  return `
    <main class="app-auth-page">
      <section class="app-auth-card">
        <div class="brand auth-brand">
          <span class="brand-mark"><img src="./assets/guanlan-icon.png" alt="" /></span>
          <span class="brand-copy"><strong>观澜</strong><small>A Stock Radar</small></span>
        </div>
        <div>
          <span class="auth-eyebrow">身份验证</span>
          <h1>输入管理员密码后进入观澜</h1>
          <p>为了保护持仓、成本价和模型 AK，本浏览器会话需要先完成一次管理员验证。</p>
        </div>
        <label>
          <span>管理员密码</span>
          <input type="password" data-app-password value="${escapeHtml(state.appPasswordInput || "")}" placeholder="输入管理员密码" autocomplete="current-password" />
        </label>
        ${state.appAuthError ? `<div class="form-error">${escapeHtml(state.appAuthError)}</div>` : ""}
        <button class="primary auth-submit" data-action="verify-app-access" ${state.appAuthLoading ? "disabled" : ""}>${state.appAuthLoading ? "验证中..." : "进入观澜"}</button>
      </section>
    </main>
  `;
}

function shell(content) {
  const sector = selectedSector();
  const titles = {
    home: ["全景雷达", "主要指数、板块行情、主力方向与雷达解释合并呈现"],
    recommend: ["股票推荐", "主力方向明显且适合当下建仓的跨板块候选"],
    portfolio: ["我的持股", "上传截图更新持股，持久化保存后结合板块、行情与新闻政策给出操作建议"],
    tracking: ["股票追踪", "每 15 分钟采集已追踪股票的分钟价格与成交量"],
    virtual: ["虚拟交易", "用模拟资金按K线/MACD/SAR/BOLL/牛门线每10分钟演练交易"],
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
          ${navButton("tracking", "股票追踪", icons.radar)}
          ${navButton("virtual", "虚拟交易", icons.radar)}
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
      ${stockFullscreenChartModal()}
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
    `最近 ${fmt(rows.length, 0)} 个交易日上涨 ${fmt(upDays, 0)} 天，短线连续性${upDays >= rows.length / 2 ? "尚可" : "偏弱"}。`,
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
        <span>涨跌家 ${fmt(sector.upCount || 0, 0)}/${fmt(sector.downCount || 0, 0)}</span>
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
                <div class="quote-grid compact"><span>成交 ${money(item.amount)}</span><span>涨跌家 ${fmt(item.upCount || 0, 0)}/${fmt(item.downCount || 0, 0)}</span></div>
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
  const buildTop20 = buildPositionTop20();
  const content = state.recLoading
    ? loadingView()
    : recommendations.length
      ? buildPositionTop20View(buildTop20)
      : `<div class="panel empty">后台推荐池正在生成，稍后会自动刷新；也可以点击顶部刷新立即重算。</div>`;
  return `
    <div class="section-head first-section">
      <h2>股票推荐 Top20</h2>
      <span class="hint">后台每 15 分钟全板块扫描一次，按买入机会分倒序筛选主力方向明显且技术面允许建仓的候选</span>
    </div>
    <section class="quote-strip recommend-strip">
      <div><span>Top20候选</span><strong>${recommendations.length}只</strong></div>
      <div><span>建仓Top20</span><strong>${buildTop20.length}只</strong></div>
      <div><span>后台状态</span><strong>${meta.status === "running" ? "扫描中" : meta.status === "error" ? "异常" : "已就绪"}</strong></div>
      <div><span>上次扫描</span><strong>${meta.refreshedAt ? new Date(meta.refreshedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "--"}</strong></div>
      <div><span>下次刷新</span><strong>${meta.nextRefreshAt ? new Date(meta.nextRefreshAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "15分钟内"}</strong></div>
    </section>
    ${meta.error ? `<div class="panel empty down">${meta.error}</div>` : ""}
    ${content}
  `;
}

const trackingPageSize = 6;

function trackingPageInfo(rows = state.trackingRows || []) {
  const keyword = normalizeSearchText(state.trackingSearch);
  const filtered = keyword
    ? rows.filter((stock) => normalizeSearchText(`${stock.name || ""} ${stock.code || ""}`).includes(keyword))
    : rows;
  const pageCount = Math.max(1, Math.ceil(filtered.length / trackingPageSize));
  const current = Math.min(Math.max(1, Number(state.trackingPageNo) || 1), pageCount);
  const start = (current - 1) * trackingPageSize;
  return {
    keyword,
    total: rows.length,
    filtered,
    pageCount,
    current,
    items: filtered.slice(start, start + trackingPageSize)
  };
}

function trackingPage() {
  const rows = state.trackingRows || [];
  const pageInfo = trackingPageInfo(rows);
  return `
    <section class="portfolio-action-bar tracking-action-bar">
      <div>
        <strong>追踪池</strong>
        <span>${state.trackingUpdatedAt ? `最近采样 ${new Date(state.trackingUpdatedAt).toLocaleString("zh-CN")}` : "每 15 分钟采集一次价格与成交量"} · ${fmt(pageInfo.filtered.length, 0)}/${fmt(pageInfo.total, 0)}只</span>
      </div>
      <div class="controls">
        <input class="tracking-search-input" data-tracking-search value="${escapeHtml(state.trackingSearch || "")}" placeholder="搜索已追踪股票/代码" autocomplete="off" />
        ${state.trackingSearch ? `<button class="ghost" data-action="clear-tracking-search">清空</button>` : ""}
        <button class="ghost" data-action="refresh-tracking" ${state.trackingLoading ? "disabled" : ""}>${icons.refresh}${state.trackingLoading ? "刷新中" : "立即采样"}</button>
      </div>
    </section>
    ${state.trackingLoading && !rows.length ? loadingView() : rows.length ? pageInfo.items.length ? `
      <section class="tracking-grid">
        ${pageInfo.items.map((stock) => trackingCard(stock)).join("")}
      </section>
      ${trackingPager(pageInfo)}
    ` : `<section class="panel empty">没有匹配「${escapeHtml(state.trackingSearch)}」的追踪股票。</section>` : `<section class="panel empty">还没有追踪股票。打开股票详情，在“加入讨论”旁边点击“加入追踪”。</section>`}
  `;
}

function trackingPager(pageInfo) {
  if (pageInfo.pageCount <= 1) return "";
  return `
    <div class="pager tracking-pager">
      <button class="ghost" data-tracking-page="prev" ${pageInfo.current <= 1 ? "disabled" : ""}>上一页</button>
      <span>第 ${fmt(pageInfo.current, 0)} / ${fmt(pageInfo.pageCount, 0)} 页 · 每页 ${fmt(trackingPageSize, 0)} 只</span>
      <button class="ghost" data-tracking-page="next" ${pageInfo.current >= pageInfo.pageCount ? "disabled" : ""}>下一页</button>
    </div>
  `;
}

function trackingCard(stock = {}) {
  const samples = stock.samples || [];
  const latest = samples.at(-1) || {};
  const first = samples[0] || {};
  const priceChange = Number.isFinite(Number(latest.price)) && Number.isFinite(Number(first.price)) && first.price
    ? ((latest.price - first.price) / first.price) * 100
    : null;
  const advice = trackingBuildAdvice(stock, latest);
  const news = state.trackingNews[stock.code] || stock.news || [];
  const newsLoading = state.trackingNewsLoading[stock.code];
  return `
    <article class="tracking-card panel" data-stock="${escapeHtml(stock.code || "")}">
      <div class="tracking-card-head">
        <div>
          <strong>${escapeHtml(stock.name || stock.code)}</strong>
          <span>${stock.code} · 加入 ${stock.addedAt ? new Date(stock.addedAt).toLocaleString("zh-CN") : "--"}</span>
        </div>
        <button class="icon-btn tracking-remove-btn danger" data-action="remove-tracking" data-tracking-code="${escapeHtml(stock.code || "")}" title="取消追踪" aria-label="取消追踪">${icons.close}</button>
      </div>
      <div class="tracking-metrics">
        <div><span>最新价</span><strong class="${pctClass(priceChange)}">${fmt(latest.price)}</strong></div>
        <div><span>追踪涨跌</span><strong class="${pctClass(priceChange)}">${priceChange === null ? "--" : `${priceChange > 0 ? "+" : ""}${fmt(priceChange)}%`}</strong></div>
        <div><span>最新成交量</span><strong>${fmt(latest.volume, 0)}</strong></div>
      </div>
      <div class="tracking-chart tracking-kline-chart">
        <canvas class="tracking-chart-canvas" data-tracking-chart="${escapeHtml(stock.code || "")}"></canvas>
        <div class="chart-tip tracking-chart-tip" data-tracking-tip="${escapeHtml(stock.code || "")}" aria-hidden="true"></div>
        ${stock.klines?.length ? "" : `<div class="tracking-chart-empty">等待最近7天K线数据</div>`}
      </div>
      <section class="tracking-advice">
        <div class="tracking-advice-head">
          <span>建仓建议</span>
          <strong class="${advice.className}">${advice.action}</strong>
        </div>
        <div class="tracking-advice-levels">
          <span>回踩 <b>${advice.levels.pullback}</b></span>
          <span>突破 <b>${advice.levels.breakout}</b></span>
          <span>止损 <b>${advice.levels.stopLoss}</b></span>
        </div>
        <p>${advice.text}</p>
      </section>
      <section class="tracking-news" data-no-stock-open>
        <div class="tracking-news-head"><span>最近新闻</span><small>${newsLoading && !news.length ? "同步中" : "近 3 天 Top3"}</small></div>
        ${news.length ? news.slice(0, 3).map((item) => `
          <a href="${escapeHtml(item.link || "#")}" target="_blank" rel="noreferrer">
            <b>${escapeHtml(item.title || "相关新闻")}</b>
            <span>${escapeHtml(item.source || "新闻源")} · ${escapeHtml(item.kind || "新闻")} · ${escapeHtml(item.tone || "中性观察")}</span>
          </a>
        `).join("") : `<p>${newsLoading ? "正在同步该股最近 3 天新闻..." : "近 3 天暂未抓取到强相关新闻。"}</p>`}
      </section>
    </article>
  `;
}

function trackingBuildAdvice(stock = {}, latestSample = {}) {
  const candles = stock.klines || [];
  const trackedStock = asStockFromTracking(stock);
  const advice = stockAdvice({ ...trackedStock, candles });
  const latest = advice.latest || candles.at(-1) || {};
  const gate = bullGateLine(candles).at(-1);
  const gateInfo = bullGateExplanation(latest, gate);
  const levels = advice.levels || {};
  if (!candles.length) {
    const pct = Number(latestSample.pct);
    return {
      action: "等待K线",
      className: "flat",
      levels: { pullback: "--", breakout: "--", stopLoss: "--" },
      text: Number.isFinite(pct)
        ? `当前追踪涨跌 ${fmt(pct)}%，但 K 线未补齐，先等最近 7 天数据完成后再给建仓价位。`
        : "追踪样本不足，先等待 K 线和成交量补齐，暂不主动建仓。"
    };
  }
  const close = Number(latest.close);
  const gateValue = Number(gate);
  let action = advice.action || gateInfo.tone || "观察";
  let className = pctClass(close - gateValue);
  if (Number.isFinite(close) && Number.isFinite(gateValue)) {
    if (close >= gateValue && gateInfo.distance?.startsWith("+")) {
      action = close > gateValue * 1.03 ? "等回踩" : "可试仓";
      className = "up";
    } else if (close >= gateValue * 0.98) {
      action = "等突破";
      className = "flat";
    } else {
      action = "先观察";
      className = "down";
    }
  }
  return {
    action,
    className,
    levels: {
      pullback: fmt(levels.pullbackBuy),
      breakout: fmt(levels.breakoutBuy),
      stopLoss: fmt(levels.stopLoss)
    },
    text: `${gateInfo.action || advice.plan || "等待价格与量能共振。"} ${advice.risk ? `失效：${advice.risk}` : gateInfo.risk || ""}`
  };
}

function virtualTradingPage() {
  const data = state.virtualTrading || {};
  const summary = data.summary || {};
  const account = data.account || null;
  if (!account) {
    return `
      <section class="virtual-onboarding panel">
        <div>
          <span class="section-kicker">虚拟满仓金额</span>
          <h2>先设置一笔只用于演练的资金</h2>
          <p>之后可以从股票详情页加入虚拟交易。盘中每10分钟，系统会基于 K线、MACD、SAR、BOLL、牛门线自动生成买卖方案，并用这笔虚拟资金撮合成交。</p>
        </div>
        <label class="virtual-capital-field">
          <span>虚拟满仓金额</span>
          <input data-virtual-capital value="${escapeHtml(state.virtualTradingInitAmount || "")}" inputmode="decimal" placeholder="例如 200000" />
        </label>
        ${state.virtualTradingError ? `<div class="form-error">${escapeHtml(state.virtualTradingError)}</div>` : ""}
        <button class="primary" data-action="init-virtual-trading" ${state.virtualTradingLoading ? "disabled" : ""}>${state.virtualTradingLoading ? "初始化中..." : "开始模拟"}</button>
      </section>
    `;
  }
  const positions = data.positions || [];
  const watchlist = data.watchlist || [];
  const trades = data.trades || [];
  const strategy = data.strategy || {};
  const stats = strategy.stats || {};
  const activeTab = state.virtualTradingTab === "backtest" ? "backtest" : "live";
  return `
    <section class="portfolio-action-bar virtual-action-bar">
      <div>
        <strong>${activeTab === "backtest" ? "策略优化" : account.enabled ? "模拟交易运行中" : "模拟交易已停止"}</strong>
        <span>${activeTab === "backtest" ? "使用真实历史K线评估并优化每只股票的交易策略" : `盘中每10分钟刷新 · ${data.updatedAt ? new Date(data.updatedAt).toLocaleString("zh-CN") : "等待首次交易"}`}</span>
      </div>
      <div class="portfolio-actions">
        ${activeTab === "live" ? `
          <button class="ghost danger" data-action="reset-virtual-trading" ${state.virtualTradingLoading ? "disabled" : ""}>${state.virtualTradingLoading ? "重置中..." : "重新模拟"}</button>
        ` : `<button class="ghost" data-action="run-virtual-backtest" ${state.virtualTradingLoading ? "disabled" : ""}>${icons.refresh}${state.virtualTradingLoading ? "优化中" : "策略优化"}</button>`}
      </div>
    </section>
    <section class="virtual-tabs">
      <button class="${activeTab === "live" ? "active" : ""}" data-virtual-tab="live">模拟交易</button>
      <button class="${activeTab === "backtest" ? "active" : ""}" data-virtual-tab="backtest">策略优化</button>
    </section>
    ${state.virtualTradingError ? `<div class="ticker-alert">${escapeHtml(state.virtualTradingError)}</div>` : ""}
    ${activeTab === "backtest" ? virtualBacktestPage(data) : `
    <section class="virtual-metrics">
      ${virtualMetric("总资产", summary.equity, "money", summary.pnl)}
      ${virtualMetric("虚拟现金", summary.cash, "money")}
      ${virtualMetric("持仓市值", summary.positionValue, "money")}
      ${virtualMetric("收益率", summary.pnlPct, "pct", summary.pnlPct)}
    </section>
    <section class="virtual-live-grid">
      <article class="panel virtual-strategy virtual-live-strategy">
        <div class="panel-head">
          <div><strong>策略状态</strong><small>根据虚拟成交自动微调建仓阈值</small></div>
        </div>
        <div class="virtual-learning-strip">
          <span>胜率 <strong>${fmt(stats.winRate || 0, 0)}%</strong></span>
          <span>已平仓 <strong>${fmt(stats.closedTrades || 0, 0)}笔</strong></span>
          <span>已实现 <strong class="${pctClass(stats.realizedPnl)}">${money(stats.realizedPnl || 0)}</strong></span>
          <span>最大回撤 <strong class="down">${fmt(stats.maxDrawdownPct || 0, 1)}%</strong></span>
        </div>
        <div class="strategy-bars">
          ${strategyGauge("买入阈值", strategy.buyThreshold, 58, 82)}
          ${strategyGauge("卖出阈值", strategy.sellThreshold, 32, 55)}
          ${strategyGauge("单票上限", (strategy.maxSinglePositionPct || 0) * 100, 8, 35, "%")}
          ${strategyGauge("现金保护", (strategy.minCashPct || 0) * 100, 2, 25, "%")}
        </div>
        <p>${escapeHtml(strategy.note || "等待更多虚拟成交后开始学习。")}</p>
      </article>
    </section>
    <section class="virtual-section">
      <div class="section-title-row"><h3>虚拟股票池</h3><span>${fmt(watchlist.length, 0)}只</span></div>
      ${watchlist.length ? `<div class="virtual-stock-grid">${watchlist.map(virtualStockCard).join("")}</div>` : `<section class="panel empty">还没有股票。打开股票详情页，点击“虚拟交易”加入。</section>`}
    </section>
    <section class="virtual-section">
      <div class="section-title-row"><h3>当前虚拟持仓</h3><span>${fmt(positions.length, 0)}只</span></div>
      ${virtualPositionsTable(positions)}
    </section>
    <section class="virtual-section">
      <div class="section-title-row"><h3>虚拟交易记录</h3><span>${fmt(trades.length, 0)}笔</span></div>
      ${virtualTradesTable(trades)}
    </section>
    `}
  `;
}

function virtualBacktestPage(data = {}) {
  const defaults = defaultBacktestRange();
  const backtestStart = state.virtualBacktestStart || defaults.start;
  const backtestEnd = state.virtualBacktestEnd || defaults.end;
  return `
    <section class="panel virtual-backtest-panel">
      <div class="panel-head">
        <div><strong>策略优化</strong><small>默认使用今天往前一个自然年的真实K线，独立评估并优化策略，不污染当前虚拟账户</small></div>
      </div>
      <div class="virtual-backtest-controls">
        <label><span>开始日期</span><input type="date" data-virtual-backtest-start value="${escapeHtml(backtestStart)}" max="${escapeHtml(backtestEnd)}" /></label>
        <label><span>结束日期</span><input type="date" data-virtual-backtest-end value="${escapeHtml(backtestEnd)}" min="${escapeHtml(backtestStart)}" max="${escapeHtml(defaults.end)}" /></label>
      </div>
      ${virtualBacktestResult(data.lastBacktest)}
    </section>
  `;
}

function virtualBacktestResult(result = null) {
  if (!result) {
    return `<div class="virtual-backtest-empty">选择时间区间后，会用已加入虚拟交易的股票逐日评估策略，输出收益、胜率、回撤和成交样本。</div>`;
  }
  const stats = result.stats || {};
  return `
    <div class="virtual-backtest-result">
      <div class="virtual-backtest-summary">
        ${virtualBacktestMetric("初始资金池", result.initialCapital, "money")}
        ${virtualBacktestMetric("模拟后资金池", result.finalEquity, "money", result.pnl)}
        ${virtualBacktestMetric("最终收益", result.pnl, "money", result.pnl)}
        ${virtualBacktestMetric("收益率", result.pnlPct, "pct", result.pnlPct)}
        ${virtualBacktestMetric("最大回撤", stats.maxDrawdownPct, "pct", -Math.abs(Number(stats.maxDrawdownPct || 0)))}
      </div>
      <div class="virtual-backtest-meta">
        <span>${escapeHtml(result.startDate)} 至 ${escapeHtml(result.endDate)}</span>
        <span>胜率 ${fmt(stats.winRate || 0, 0)}%</span>
        <span>平仓 ${fmt(stats.closedTrades || 0, 0)} 笔</span>
        <span>成交 ${fmt((result.trades || []).length, 0)} 笔</span>
      </div>
      ${virtualBacktestPortfolioPlan(result)}
      ${result.strategy?.note ? `<p class="virtual-backtest-note">${escapeHtml(result.strategy.note)}</p>` : ""}
      ${(result.notes || []).length ? `<ul class="virtual-backtest-notes">${result.notes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      ${virtualBacktestMonitor(result)}
    </div>
  `;
}

function virtualBacktestPortfolioPlan(result = {}) {
  const plan = result.portfolioStrategyAdvice || {};
  const stocks = result.stockStrategyAdvice || [];
  if (!plan.summary && !stocks.length) return "";
  return `
    <section class="virtual-backtest-optimization virtual-portfolio-plan">
      <div class="virtual-optimization-head">
        <div>
          <span>组合最优解</span>
          <strong>${escapeHtml(plan.title || "按单股策略组合回放")}</strong>
        </div>
        <em>${fmt(stocks.length, 0)}只单股策略</em>
      </div>
      <p class="virtual-optimization-summary">${escapeHtml(plan.summary || "系统已根据每只股票的独立策略生成组合方案，可保存后用于后续模拟交易。")}</p>
      <div class="virtual-backtest-summary compact">
        ${virtualBacktestMetric("组合收益", plan.pnlPct, "pct", plan.pnlPct)}
        ${virtualBacktestMetric("组合盈亏", plan.pnl, "money", plan.pnl)}
        ${virtualBacktestMetric("组合回撤", plan.maxDrawdownPct, "pct", -Math.abs(Number(plan.maxDrawdownPct || 0)))}
        ${virtualBacktestMetric("组合胜率", plan.winRate, "pct", plan.winRate)}
      </div>
      ${(plan.reasons || []).length ? `<ul class="virtual-backtest-notes">${plan.reasons.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      <div class="virtual-backtest-actions">
        <button class="ghost" data-action="apply-virtual-stock-strategies" ${state.virtualTradingLoading || !stocks.length ? "disabled" : ""}>保存全部单股策略</button>
        <button class="primary" data-action="adopt-virtual-optimization" ${state.virtualTradingLoading || !stocks.length ? "disabled" : ""}>按组合最优解回放</button>
      </div>
    </section>
  `;
}

function virtualStrategyFields() {
  return [
    { key: "buyThreshold", label: "买入阈值", min: 58, max: 82, step: 1, hint: "越低越激进" },
    { key: "sellThreshold", label: "卖出阈值", min: 32, max: 55, step: 1, hint: "越高越快离场" },
    { key: "maxSinglePositionPct", label: "单票上限", min: 8, max: 35, step: 1, percent: true, hint: "单股最大仓位%" },
    { key: "minCashPct", label: "现金保护", min: 2, max: 25, step: 1, percent: true, hint: "保留现金%" },
    { key: "macdWeight", label: "MACD权重", min: 0.5, max: 1.8, step: 0.05, hint: "动能优先级" },
    { key: "sarWeight", label: "SAR权重", min: 0.5, max: 1.8, step: 0.05, hint: "趋势风控" },
    { key: "bollWeight", label: "BOLL权重", min: 0.5, max: 1.8, step: 0.05, hint: "位置约束" },
    { key: "bullGateWeight", label: "牛门线权重", min: 0.5, max: 1.9, step: 0.05, hint: "趋势门槛" },
    { key: "takeProfitPct", label: "止盈%", min: 5, max: 28, step: 0.5, hint: "收益保护" },
    { key: "stopLossPct", label: "止损%", min: -18, max: -3, step: 0.5, hint: "亏损控制" }
  ];
}

function virtualStockStrategyField(code = "", field, strategy = {}) {
  const draft = state.virtualStockStrategyDrafts?.[code] || {};
  const raw = Object.prototype.hasOwnProperty.call(draft, field.key) ? draft[field.key] : strategy[field.key];
  const value = Number.isFinite(Number(raw)) ? Number(raw) : 0;
  const displayValue = Object.prototype.hasOwnProperty.call(draft, field.key) ? value : field.percent ? value * 100 : value;
  return `
    <label class="virtual-strategy-field compact">
      <span>${field.label}</span>
      <input
        type="number"
        data-virtual-stock-strategy="${field.key}"
        data-stock-code="${escapeHtml(code)}"
        min="${field.min}"
        max="${field.max}"
        step="${field.step}"
        value="${escapeHtml(String(Number.isFinite(displayValue) ? Number(displayValue.toFixed(3)) : ""))}"
      />
    </label>
  `;
}

function virtualBacktestMonitor(result = {}) {
  const charts = result.stockCharts || [];
  if (!charts.length) return `<div class="virtual-backtest-empty">暂无模拟交易监控数据。重新模拟后会把交易点标在每只股票的价格图中。</div>`;
  const totalPnl = Number(result.finalCapital || 0) - Number(result.initialCapital || 0);
  const totalPnlPct = Number(result.initialCapital) ? (totalPnl / Number(result.initialCapital)) * 100 : 0;
  return `
    <section class="virtual-backtest-monitor">
      <div class="section-title-row">
        <h3>模拟交易监控</h3>
        <span>整体收益 <b class="${pctClass(totalPnl)}">${money(totalPnl)}</b> · ${totalPnlPct > 0 ? "+" : ""}${fmt(totalPnlPct)}% · ${fmt(charts.length, 0)}只 · ${fmt((result.trades || []).length, 0)}笔模拟交易</span>
      </div>
      <div class="virtual-monitor-shell">
        <div class="virtual-backtest-stock-grid">
          ${charts.map(virtualBacktestStockCard).join("")}
        </div>
      </div>
    </section>
  `;
}

function virtualBacktestStockCard(chart = {}) {
  const stock = chart.stock || {};
  const rows = (chart.rows || []).filter((row) => Number.isFinite(Number(row.close)));
  const trades = chart.trades || [];
  const contribution = chart.contribution || {};
  const code = String(stock.code || "").trim();
  const last = rows.at(-1) || {};
  const first = rows[0] || {};
  const pct = Number(first.close) ? ((Number(last.close) - Number(first.close)) / Number(first.close)) * 100 : 0;
  const strategyOpen = state.virtualStrategyPreviewCode === code;
  return `
    <article class="panel virtual-backtest-stock-card">
      <div class="tracking-card-head">
        <div><strong>${escapeHtml(stock.name || stock.code || "--")}</strong><small>${escapeHtml(stock.code || "")} · ${fmt(rows.length, 0)}日K线</small></div>
        <span class="${pctClass(pct)}">${pct > 0 ? "+" : ""}${fmt(pct)}%</span>
      </div>
      ${virtualBacktestContribution(contribution, { code, strategyOpen })}
      ${strategyOpen ? virtualCurrentStockStrategyPanel(code) : ""}
      ${virtualBacktestTradeChart(rows, trades, stock)}
      ${virtualBacktestStockTradeTable(trades, code)}
    </article>
  `;
}

function virtualCurrentStockStrategyPanel(code = "") {
  const saved = savedVirtualStrategyForStock(code);
  const advice = (state.virtualTrading?.lastBacktest?.stockStrategyAdvice || []).find((item) => String(item.code || "").trim() === String(code || "").trim());
  const stock = saved || advice || {};
  const strategy = stock.strategy || {};
  if (!Object.keys(strategy).length) {
    return `<div class="virtual-current-strategy muted">这只股票暂未生成独立策略，请先完成策略优化。</div>`;
  }
  return `
    <div class="virtual-current-strategy">
      <div>
        <span>当前策略 · 可手工修改</span>
        <strong>${escapeHtml(stock.summary || "已使用单股独立交易策略")}</strong>
      </div>
      <div class="virtual-strategy-mini-grid">
        ${virtualStrategyFields().map((field) => virtualStockStrategyField(code, field, strategy)).join("")}
      </div>
      <div class="virtual-backtest-actions">
        <button class="ghost" data-action="optimize-virtual-stock-strategy" data-stock-code="${escapeHtml(code)}" ${state.virtualTradingLoading ? "disabled" : ""}>优化策略</button>
        <button class="primary" data-action="save-virtual-stock-strategy" data-stock-code="${escapeHtml(code)}" ${state.virtualTradingLoading ? "disabled" : ""}>保存策略</button>
      </div>
    </div>
  `;
}

function virtualBacktestContribution(contribution = {}, options = {}) {
  const amount = Number(contribution.amount || 0);
  const pct = Number(contribution.pct || 0);
  const code = String(options.code || "").trim();
  const strategyButton = code
    ? `<button class="icon-btn virtual-chart-strategy-btn ${options.strategyOpen ? "active" : ""}" data-action="show-virtual-stock-strategy" data-stock-code="${escapeHtml(code)}" title="查看并调整当前策略" aria-label="查看并调整当前策略">${icons.settings}</button>`
    : "";
  return `
    <div class="virtual-contribution-strip">
      <div>
        <span>对整体收益贡献</span>
        <strong class="${pctClass(amount)}">${money(amount)}</strong>
      </div>
      <div>
        <span>贡献占比</span>
        <strong class="${pctClass(pct)}">${pct > 0 ? "+" : ""}${fmt(pct, 1)}%</strong>
      </div>
      <div>
        <span>已实现 / 持仓</span>
        <strong>${money(contribution.realizedPnl || 0)} / ${money(contribution.openPnl || 0)}</strong>
      </div>
      ${strategyButton}
    </div>
  `;
}

function virtualBacktestStockTradeTable(trades = [], code = "") {
  const rows = [...trades].reverse();
  if (!rows.length) return `<p class="virtual-backtest-note">模拟交易：该区间没有触发成交。</p>`;
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, Number(state.virtualBacktestTradePages?.[code]) || 1), pageCount);
  const pageRows = rows.slice((current - 1) * pageSize, current * pageSize);
  const safeCode = escapeHtml(code);
  return `
    <div class="virtual-stock-trade-table">
      <div class="virtual-stock-trade-head">
        <strong>模拟交易</strong>
        <span>第 ${fmt(current, 0)} / ${fmt(pageCount, 0)} 页 · 共 ${fmt(rows.length, 0)} 笔</span>
      </div>
      <div class="virtual-monitor-table">
        <table>
          <thead><tr><th>时间</th><th>操作</th><th>成交</th><th>机会</th></tr></thead>
          <tbody>
            ${pageRows.map((trade) => `
              <tr>
                <td data-label="时间"><span class="trade-time">${escapeHtml(formatTradeTime(trade.time))}</span></td>
                <td data-label="操作"><span class="trade-pill ${trade.side === "buy" ? "buy" : "sell"}">${trade.side === "buy" ? "买入" : "卖出"}</span></td>
                <td data-label="成交">
                  <strong>${fmt(trade.price)}</strong>
                  <small>${fmt(trade.qty, 0)}股 · ${money(trade.amount)}</small>
                </td>
                <td data-label="机会"><strong>${fmt(trade.score, 1)}</strong></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      ${pageCount > 1 ? `
        <div class="pager virtual-stock-trade-pager">
          <button class="ghost" data-stock-trade-page="prev" data-stock-code="${safeCode}" ${current <= 1 ? "disabled" : ""}>上一页</button>
          <span>${fmt((current - 1) * pageSize + 1, 0)}-${fmt(Math.min(current * pageSize, rows.length), 0)} / ${fmt(rows.length, 0)}</span>
          <button class="ghost" data-stock-trade-page="next" data-stock-code="${safeCode}" ${current >= pageCount ? "disabled" : ""}>下一页</button>
        </div>
      ` : ""}
    </div>
  `;
}

function formatTradeDate(value = "") {
  return String(value || "").slice(0, 10) || "--";
}

function formatTradeTime(value = "") {
  const text = String(value || "");
  if (!text) return "--";
  return text.replace("T", " ").replace(/\.\d+.*$/, "").replace(/\+08:00$/, "").slice(0, 19);
}

function virtualBacktestTradeChart(rows = [], trades = [], stock = {}) {
  if (rows.length < 2) return `<div class="virtual-backtest-chart empty">K线不足，无法绘制图表</div>`;
  const width = 520;
  const height = 220;
  const pad = { l: 44, r: 18, t: 20, b: 34 };
  const prices = rows.flatMap((row) => [Number(row.high || row.close), Number(row.low || row.close), Number(row.close)]).filter(Number.isFinite);
  const tradePrices = trades.map((trade) => Number(trade.price)).filter(Number.isFinite);
  const max = Math.max(...prices, ...tradePrices);
  const min = Math.min(...prices, ...tradePrices);
  const span = max - min || 1;
  const x = (index) => pad.l + (index / Math.max(1, rows.length - 1)) * (width - pad.l - pad.r);
  const y = (value) => pad.t + ((max - value) / span) * (height - pad.t - pad.b);
  const linePoints = rows.map((row, index) => `${x(index).toFixed(1)},${y(Number(row.close)).toFixed(1)}`).join(" ");
  const dayIndex = new Map(rows.map((row, index) => [row.day, index]));
  const grid = [0, 1, 2, 3].map((step) => {
    const yy = pad.t + step * (height - pad.t - pad.b) / 3;
    const value = max - step * span / 3;
    return `<line x1="${pad.l}" y1="${yy.toFixed(1)}" x2="${width - pad.r}" y2="${yy.toFixed(1)}"></line><text x="6" y="${(yy + 4).toFixed(1)}">${fmt(value)}</text>`;
  }).join("");
  const markers = trades.map((trade) => {
    const day = formatTradeDate(trade.time);
    const index = dayIndex.has(day) ? dayIndex.get(day) : nearestBacktestRowIndex(rows, day);
    if (index < 0) return "";
    const tx = x(index);
    const ty = y(Number(trade.price));
    const side = trade.side === "buy" ? "buy" : "sell";
    const labelY = side === "buy" ? ty + 18 : ty - 12;
    const textAnchor = tx > width - pad.r - 62 ? "end" : tx < pad.l + 42 ? "start" : "middle";
    const labelX = textAnchor === "end" ? tx - 8 : textAnchor === "start" ? tx + 8 : tx;
    const title = `${stock.name || stock.code || ""} ${side === "buy" ? "买入" : "卖出"} ${day} 价格 ${fmt(trade.price)} 数量 ${fmt(trade.qty, 0)}股`;
    return `
      <g class="bt-marker ${side}">
        <title>${escapeHtml(title)}</title>
        <circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="5"></circle>
        <text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="${textAnchor}">${side === "buy" ? "买" : "卖"} ${fmt(trade.qty, 0)}</text>
      </g>
    `;
  }).join("");
  const labels = [rows[0], rows[Math.floor(rows.length / 2)], rows.at(-1)].filter(Boolean).map((row) => {
    const index = dayIndex.get(row.day) || 0;
    return `<text x="${Math.min(width - 78, Math.max(pad.l, x(index) - 28)).toFixed(1)}" y="${height - 10}">${escapeHtml(String(row.day).slice(5))}</text>`;
  }).join("");
  return `
    <div class="virtual-backtest-chart-wrap">
      <button class="virtual-backtest-chart-button" data-action="open-virtual-backtest-chart" data-stock-code="${escapeHtml(stock.code || "")}" title="全屏查看 ${escapeHtml(stock.name || stock.code || "股票")} 模拟交易图表">
        <svg class="virtual-backtest-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(stock.name || stock.code || "股票")} 回测价格与成交点">
          <rect x="0" y="0" width="${width}" height="${height}"></rect>
          <g class="bt-grid">${grid}</g>
          <polyline class="bt-price" points="${linePoints}"></polyline>
          <g class="bt-markers">${markers}</g>
          <g class="bt-labels">${labels}</g>
        </svg>
      </button>
    </div>
  `;
}

function nearestBacktestRowIndex(rows = [], day = "") {
  const target = new Date(`${day}T00:00:00+08:00`).getTime();
  if (!Number.isFinite(target)) return -1;
  let best = -1;
  let bestDistance = Infinity;
  rows.forEach((row, index) => {
    const value = new Date(`${row.day}T00:00:00+08:00`).getTime();
    if (!Number.isFinite(value)) return;
    const distance = Math.abs(value - target);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

function virtualBacktestMetric(label, value, kind = "money", trend = 0) {
  const text = kind === "pct" ? `${fmt(value)}%` : kind === "number" ? fmt(value, 1) : money(value);
  return `<span><small>${label}</small><strong class="${trend ? pctClass(trend) : ""}">${text}</strong></span>`;
}

function virtualMetric(label, value, kind = "money", trend = 0) {
  const text = kind === "pct" ? `${fmt(value)}%` : money(value);
  return `
    <article class="panel virtual-metric">
      <span>${label}</span>
      <strong class="${trend ? pctClass(trend) : ""}">${text}</strong>
    </article>
  `;
}

function strategyGauge(label, value, min, max, suffix = "") {
  const n = Number(value);
  const pct = Number.isFinite(n) ? Math.max(0, Math.min(100, ((n - min) / (max - min)) * 100)) : 0;
  return `
    <div class="strategy-gauge">
      <div><span>${label}</span><strong>${fmt(n, suffix ? 1 : 0)}${suffix}</strong></div>
      <i><b style="width:${pct}%"></b></i>
    </div>
  `;
}

function virtualStockCard(stock = {}) {
  const signal = stock.lastSignal || {};
  const actionClass = signal.action === "buy" ? "up" : signal.action === "sell" ? "down" : "flat";
  const savedStrategy = savedVirtualStrategyForStock(stock.code);
  return `
    <article class="panel virtual-stock-card" data-stock="${escapeHtml(stock.code || "")}">
      <div class="tracking-card-head">
        <div><strong>${escapeHtml(stock.name || stock.code || "--")}</strong><small>${escapeHtml(stock.code || "")}</small></div>
        <button class="icon-btn tracking-remove-btn danger" data-action="remove-virtual-trading" data-virtual-code="${escapeHtml(stock.code || "")}" title="移出虚拟交易" aria-label="移出虚拟交易">${icons.close}</button>
      </div>
      <div class="virtual-stock-price">
        <span>最新价</span>
        <strong>${fmt(stock.lastPrice)}</strong>
        <em class="${pctClass(stock.lastPct)}">${Number.isFinite(Number(stock.lastPct)) ? `${fmt(stock.lastPct)}%` : "--"}</em>
      </div>
      <div class="virtual-signal ${actionClass}">
        <strong>${escapeHtml(signal.summary || "等待下一轮演练")}</strong>
        <span>${signal.score === null || signal.score === undefined ? "--" : `机会分 ${fmt(signal.score, 1)}`} · ${escapeHtml(signal.orderPlan?.text || "等待交易方案")}</span>
      </div>
      ${savedStrategy ? virtualStockStrategyView(savedStrategy) : `<div class="virtual-stock-history-strategy muted">暂无策略优化结果，先运行策略优化并保存策略。</div>`}
      ${signal.orderPlan ? `<div class="virtual-order-plan">${escapeHtml(signal.orderPlan.trigger || "")}</div>` : ""}
      ${signal.levels ? `<div class="tracking-advice-levels">
        <span>买入线 ${fmt(signal.levels.buyLine)}</span>
        <span>风险线 ${fmt(signal.levels.riskLine)}</span>
        <span>止损线 ${fmt(signal.levels.stopLine)}</span>
        <span>止盈线 ${fmt(signal.levels.takeProfitLine)}</span>
      </div>` : ""}
      <ul class="virtual-reasons">
        ${(signal.reasons || []).slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join("") || "<li>等待行情与K线数据同步。</li>"}
      </ul>
    </article>
  `;
}

function virtualStockStrategyView(saved = {}) {
  const s = saved.strategy || {};
  return `
    <div class="virtual-stock-history-strategy">
      <div>
        <span>策略优化结果</span>
        <strong>${escapeHtml(saved.summary || "已应用策略优化单股策略")}</strong>
      </div>
      <div class="virtual-stock-strategy-chips">
        <span>买 ${fmt(s.buyThreshold, 0)}</span>
        <span>卖 ${fmt(s.sellThreshold, 0)}</span>
        <span>MACD ${fmt(s.macdWeight, 2)}</span>
        <span>牛门 ${fmt(s.bullGateWeight, 2)}</span>
      </div>
    </div>
  `;
}

function virtualPositionsTable(positions = []) {
  if (!positions.length) return `<section class="panel empty">当前没有虚拟持仓，等待系统触发第一笔买入。</section>`;
  return `
    <div class="responsive-table virtual-table virtual-position-table">
      <table>
        <thead>
          <tr>
            <th>股票</th>
            <th>持仓数量</th>
            <th>成本价</th>
            <th>最新价</th>
            <th>持仓市值</th>
            <th>浮动盈亏</th>
            <th>更新时间</th>
          </tr>
        </thead>
        <tbody>
          ${positions.map((item) => `
            <tr data-stock="${escapeHtml(item.code)}">
              <td data-label="股票"><strong>${escapeHtml(item.name)}</strong><div class="stock-code">${escapeHtml(item.code)}</div></td>
              <td data-label="持仓数量">${fmt(item.qty, 0)}股</td>
              <td data-label="成本价">${fmt(item.avgCost)}</td>
              <td data-label="最新价">${fmt(item.lastPrice)}</td>
              <td data-label="持仓市值">${money(item.marketValue)}</td>
              <td data-label="浮动盈亏" class="${pctClass(item.pnl)}">${money(item.pnl)} / ${fmt(item.pnlPct)}%</td>
              <td data-label="更新时间">${formatTradeTime(item.updatedAt || item.openedAt)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function virtualTradesTable(trades = []) {
  const rows = [...trades].slice(-80).reverse();
  if (!rows.length) return `<section class="panel empty">暂无虚拟交易记录。机会分达到策略阈值后会自动执行模拟买卖。</section>`;
  return `
    <div class="responsive-table virtual-table virtual-record-table">
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>股票</th>
            <th>方向</th>
            <th>成交数量</th>
            <th>成交价</th>
            <th>成交金额</th>
            <th>已实现盈亏</th>
            <th>触发原因</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((trade) => `
            <tr data-stock="${escapeHtml(trade.code)}">
              <td data-label="时间">${formatTradeTime(trade.time)}</td>
              <td data-label="股票"><strong>${escapeHtml(trade.name || trade.code)}</strong><div class="stock-code">${escapeHtml(trade.code)}</div></td>
              <td data-label="方向"><span class="trade-pill ${trade.side === "buy" ? "buy" : "sell"}">${trade.side === "buy" ? "买入" : "卖出"}</span></td>
              <td data-label="成交数量">${fmt(trade.qty, 0)}股</td>
              <td data-label="成交价">${fmt(trade.price)}</td>
              <td data-label="成交金额">${money(trade.amount)}</td>
              <td data-label="已实现盈亏" class="${pctClass(trade.realizedPnl || 0)}">${trade.realizedPnl === null || trade.realizedPnl === undefined ? "--" : `${money(trade.realizedPnl)} / ${fmt(trade.realizedPnlPct)}%`}</td>
              <td data-label="触发原因"><span class="virtual-record-reason">${escapeHtml(trade.reason || "策略触发")}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function virtualTradeRow(trade = {}) {
  return `
    <article class="panel virtual-trade ${trade.side === "buy" ? "buy" : "sell"}">
      <div><strong>${trade.side === "buy" ? "买入" : "卖出"} ${escapeHtml(trade.name || trade.code)}</strong><small>${new Date(trade.time || Date.now()).toLocaleString("zh-CN")}</small></div>
      <div><span>${fmt(trade.qty, 0)}股 @ ${fmt(trade.price)}</span><em>${money(trade.amount)}</em></div>
      <p>${escapeHtml(trade.reason || "")}</p>
    </article>
  `;
}

function trackingPriceLine(samples = []) {
  const values = samples.map((item) => Number(item.price)).filter(Number.isFinite);
  if (values.length < 2) return `<svg viewBox="0 0 240 72" class="tracking-line"><path d="M0 50 H240" /></svg>`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 240;
    const y = 64 - ((value - min) / span) * 54;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const positive = values.at(-1) >= values[0];
  return `<svg viewBox="0 0 240 72" class="tracking-line ${positive ? "up" : "down"}"><polyline points="${points}" /></svg>`;
}

function trackingVolumeBars(samples = []) {
  const values = samples.map((item) => Number(item.volume)).filter(Number.isFinite).slice(-24);
  if (!values.length) return "";
  const max = Math.max(...values) || 1;
  return `
    <div class="tracking-volume-bars">
      ${values.map((value) => `<span style="height:${Math.max(8, (value / max) * 46).toFixed(1)}px"></span>`).join("")}
    </div>
  `;
}

function trackingKlineChart(stock = {}) {
  const rows = (stock.klines || []).filter((row) => ["open", "close", "high", "low"].every((key) => Number.isFinite(Number(row[key])))).slice(-7);
  if (!rows.length) {
    return `${trackingPriceLine(stock.samples || [])}${trackingVolumeBars(stock.samples || [])}<div class="tracking-chart-empty">等待最近7天K线数据</div>`;
  }
  const width = 360;
  const height = 226;
  const pad = { l: 42, r: 54, t: 32, b: 32 };
  const mainBottom = 150;
  const allPrices = rows.flatMap((row) => [Number(row.high), Number(row.low)]);
  const bullGate = bullGateLine(rows);
  allPrices.push(...bullGate.filter((value) => Number.isFinite(Number(value))));
  const max = Math.max(...allPrices);
  const min = Math.min(...allPrices);
  const y = (value) => pad.t + (max - value) / Math.max(0.01, max - min) * (mainBottom - pad.t);
  const xStep = (width - pad.l - pad.r) / rows.length;
  const maxVolume = Math.max(...rows.map((row) => Number(row.volume || 0)), 1);
  const axis = [0, 1, 2, 3, 4].map((index) => {
    const yy = pad.t + index * (mainBottom - pad.t) / 4;
    const price = max - (max - min) * index / 4;
    return `<g><line x1="${pad.l}" y1="${yy.toFixed(1)}" x2="${width - pad.r}" y2="${yy.toFixed(1)}" /><text x="${width - pad.r + 5}" y="${(yy + 4).toFixed(1)}">${fmt(price)}</text></g>`;
  }).join("");
  const candles = rows.map((row, index) => {
    const x = pad.l + index * xStep + xStep / 2;
    const open = Number(row.open);
    const close = Number(row.close);
    const high = Number(row.high);
    const low = Number(row.low);
    const up = close >= open;
    const bodyY = Math.min(y(open), y(close));
    const bodyH = Math.max(2, Math.abs(y(open) - y(close)));
    const bodyW = Math.max(7, xStep * 0.42);
    const title = `${row.day || `第${index + 1}天`} X:${index + 1}/${rows.length} 开:${fmt(open)} 高:${fmt(high)} 低:${fmt(low)} 收:${fmt(close)} Y:${fmt(close)} 成交量:${fmt(row.volume, 0)}`;
    return `
      <g class="tracking-candle ${up ? "up" : "down"}">
        <title>${escapeHtml(title)}</title>
        <line x1="${x.toFixed(1)}" y1="${y(high).toFixed(1)}" x2="${x.toFixed(1)}" y2="${y(low).toFixed(1)}"></line>
        <rect x="${(x - bodyW / 2).toFixed(1)}" y="${bodyY.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${bodyH.toFixed(1)}"></rect>
      </g>
    `;
  }).join("");
  const bullPoints = bullGate.map((value, index) => {
    const x = pad.l + index * xStep + xStep / 2;
    return Number.isFinite(Number(value)) ? `${x.toFixed(1)},${y(value).toFixed(1)}` : "";
  }).filter(Boolean).join(" ");
  const bullDots = bullGate.map((value, index) => {
    if (!Number.isFinite(Number(value))) return "";
    const x = pad.l + index * xStep + xStep / 2;
    const title = `${rows[index]?.day || `第${index + 1}天`} 牛门线 X:${index + 1}/${rows.length} Y:${fmt(value)}`;
    return `<circle cx="${x.toFixed(1)}" cy="${y(value).toFixed(1)}" r="5"><title>${escapeHtml(title)}</title></circle>`;
  }).join("");
  const volumes = rows.map((row, index) => {
    const x = pad.l + index * xStep + xStep * 0.25;
    const h = Math.max(2, Number(row.volume || 0) / maxVolume * 34);
    const up = Number(row.close) >= Number(row.open);
    return `<rect class="${up ? "up" : "down"}" x="${x.toFixed(1)}" y="${(height - pad.b - h).toFixed(1)}" width="${Math.max(8, xStep * 0.5).toFixed(1)}" height="${h.toFixed(1)}"><title>${escapeHtml(`${row.day || ""} 成交量 Y:${fmt(row.volume, 0)}`)}</title></rect>`;
  }).join("");
  const labels = rows.map((row, index) => {
    const x = pad.l + index * xStep + xStep / 2;
    return `<text x="${x.toFixed(1)}" y="${height - 12}" text-anchor="middle">${escapeHtml(String(row.day || "").slice(5) || `D${index + 1}`)}</text>`;
  }).join("");
  return `
    <svg viewBox="0 0 ${width} ${height}" class="tracking-kline-svg" role="img" aria-label="${escapeHtml(stock.name || stock.code || "追踪K线")} 最近7天K线和牛门线">
      <rect x="0" y="0" width="${width}" height="${height}" rx="8"></rect>
      <g class="tracking-axis">${axis}</g>
      <line class="tracking-main-separator" x1="${pad.l}" y1="${mainBottom + 12}" x2="${width - pad.r}" y2="${mainBottom + 12}"></line>
      <g class="tracking-candles">${candles}</g>
      <g class="tracking-bullgate">
        <polyline class="tracking-bullgate-rail" points="${bullPoints}"><title>牛门线上轨</title></polyline>
        <polyline class="tracking-bullgate-core" points="${bullPoints}"><title>牛门线下轨</title></polyline>
        ${bullDots}
      </g>
      <g class="tracking-volume">${volumes}</g>
      <g class="tracking-xlabels">${labels}</g>
      <text x="${pad.l}" y="13" class="tracking-chart-label">K线 + 牛门线</text>
      <text x="${width - pad.r - 42}" y="13" class="tracking-chart-label">Y 价格</text>
    </svg>
  `;
}

function discussionPage() {
  const deepThinking = Boolean(state.advisorDeepThinking);
  return `
    <section class="discussion-layout">
      <div class="panel discussion-panel">
        <div class="discussion-head">
          <div>
            <h2>观澜理财师</h2>
            <span>${state.settings?.aiProviderLabel || "多模型"} · 偏激进 · ${deepThinking ? "深度思考" : "简约直接"}</span>
          </div>
          <div class="discussion-actions">
            <button class="ghost" data-action="clear-advisor-chat">清空对话</button>
          </div>
        </div>
        <div class="chat-thread">
          ${state.advisorMessages.map((message, index) => `
            <div class="chat-message ${message.role}">
              <span>${message.role === "user" ? "你" : "观澜理财师"}</span>
              <div class="chat-bubble" data-chat-content="${index}">${formatChatText(message.content)}${message.streaming ? `<span class="typing-cursor"></span>` : ""}</div>
              ${advisorChoicePanel(message, index)}
            </div>
          `).join("")}
          ${state.advisorLoading ? advisorLoadingView(deepThinking) : ""}
        </div>
        <div class="chat-inputbar">
          <textarea data-advisor-input rows="2" placeholder="输入股票、代码或板块，例如：工业富联现在适合做T吗？半导体明天能追吗？">${escapeHtml(state.advisorInput)}</textarea>
          <div class="chat-composer-footer">
            <button class="think-toggle ${deepThinking ? "active" : ""}" type="button" data-action="toggle-advisor-thinking" aria-pressed="${deepThinking ? "true" : "false"}" title="${deepThinking ? "关闭深度思考" : "开启深度思考"}">
              <span></span>${deepThinking ? "深度思考" : "快速判断"}
            </button>
            <button class="composer-send ${state.advisorLoading || state.advisorStreaming ? "danger" : "primary"}" type="button" data-action="send-advisor-message" title="${state.advisorLoading || state.advisorStreaming ? "中断输出" : "发送"}">${state.advisorLoading || state.advisorStreaming ? "中断" : "发送"}</button>
          </div>
        </div>
      </div>
    </section>
  `;
}

function advisorLoadingView(deepThinking = false) {
  if (!deepThinking) {
    return `<div class="chat-message assistant"><span>观澜理财师</span><div class="chat-bubble"><span class="loader"></span> 正在判断...</div></div>`;
  }
  const steps = [
    ["读取上下文", "整理历史对话、持仓、详情页和本轮问题"],
    ["核验行情", "校准最新价、板块位置和最近交易日数据"],
    ["拆解技术面", "扫描 K线、MACD、SAR、BOLL 与牛门线"],
    ["观察资金面", "判断主力方向、流入速度和离场风险"],
    ["合成交易计划", "给出买点、卖点、做T区间和仓位"],
    ["压测失效条件", "检查止损位、消息反噬和追高风险"]
  ];
  return `
    <div class="chat-message assistant">
      <span>观澜理财师</span>
      <div class="chat-bubble thinking-bubble">
        <div class="thinking-title"><span class="loader"></span><strong>深度思考中</strong><em>实时分析路径</em></div>
        <div class="thinking-steps">
          ${steps.map(([title, detail], index) => `
            <div class="thinking-step" style="--step:${index}">
              <i>${index + 1}</i>
              <div><strong>${title}</strong><span>${detail}</span></div>
            </div>
          `).join("")}
        </div>
      </div>
    </div>
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
  const providers = draft.aiProviders || state.settings?.aiProviders || {};
  const provider = draft.aiProvider === "kimi" ? "kimi-cn" : (draft.aiProvider || "kimi-cn");
  const providerInfo = providers[provider] || {};
  const admin = draft.admin || state.adminStatus || {};
  const providerOptions = Object.entries(providers).length ? Object.entries(providers) : [
    ["kimi-cn", { label: "Kimi 国内版 / Moonshot CN" }],
    ["kimi-intl", { label: "Kimi 国际版 / Moonshot AI" }],
    ["deepseek", { label: "DeepSeek" }],
    ["minimax", { label: "MiniMax" }],
    ["glm", { label: "GLM / 智谱" }]
  ];
  const modelPresets = {
    "kimi-cn": ["kimi-k2.5", "kimi-k2.6", "moonshot-v1-auto", "moonshot-v1-32k", "moonshot-v1-128k"],
    "kimi-intl": ["kimi-k2.5", "kimi-k2.6", "moonshot-v1-auto", "moonshot-v1-32k", "moonshot-v1-128k"],
    deepseek: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"],
    minimax: ["MiniMax-M3", "MiniMax-M2.5", "MiniMax-M2", "MiniMax-M1"],
    glm: ["glm-5.1", "glm-4.6", "glm-4.5", "glm-4-air", "glm-4v-plus"]
  };
  const modelOptions = [...new Set([draft.textModel, providerInfo.textModel, ...(modelPresets[provider] || [])].filter(Boolean))];
  const advisorOptions = [...new Set([draft.advisorModel, providerInfo.advisorModel, ...(modelPresets[provider] || [])].filter(Boolean))];
  const visionOptions = [...new Set([draft.visionModel, providerInfo.visionModel, ...(provider.startsWith("kimi") ? ["kimi-k2.5", "kimi-k2.6", "moonshot-v1-8k-vision-preview", "moonshot-v1-32k-vision-preview"] : provider === "deepseek" ? ["deepseek-ocr"] : provider === "minimax" ? ["MiniMax-VL-01"] : provider === "glm" ? ["glm-ocr", "GLM-5V-Turbo", "glm-4v-plus"] : [])].filter(Boolean))];
  const currentApiUrl = draft.apiUrl || providerInfo.apiUrl || "";
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
          <div class="settings-summary-card">
            <span>调用模型</span>
            <strong>${draft.aiProviderLabel || providerInfo.label || "模型"}</strong>
          </div>
          <div class="settings-summary-card">
            <span>AK 状态</span>
            <strong>${draft.hasApiKey || draft.hasKimiApiKey ? "已配置" : "未配置"}</strong>
          </div>
          <div class="settings-summary-card">
            <span>QPM</span>
            <strong>${Number(draft.modelQpm || 500)}/分钟</strong>
          </div>
          <div class="settings-summary-card">
            <span>缓存</span>
            <strong>${draft.useCache !== false ? "开启" : "关闭"}</strong>
          </div>
          <div class="settings-summary-card">
            <span>管理员密码</span>
            <strong>${admin.hasAdminPassword ? "已设置" : "未设置"}</strong>
          </div>
        </div>
        <div class="settings-content-grid">
          <div class="settings-main-column">
            <section class="settings-section settings-section-primary">
              <div class="settings-section-title">
                <h2>调用模型</h2>
                <span>模型、地址和 AK</span>
              </div>
              <label class="setting-row">
                <span><strong>模型供应商</strong><small>保存后立即切换底层调用</small></span>
                <select data-setting="aiProvider">
                  ${providerOptions.map(([key, item]) => `<option value="${key}" ${provider === key ? "selected" : ""}>${item.label || key}</option>`).join("")}
                </select>
              </label>
              <label class="setting-row">
                <span><strong>文本模型</strong><small>新闻、推荐、持股分析</small></span>
                <select data-setting="textModel">
                  ${modelOptions.map((item) => `<option value="${item}" ${(draft.textModel || providerInfo.textModel) === item ? "selected" : ""}>${item}</option>`).join("")}
                </select>
              </label>
              <label class="setting-row">
                <span><strong>OCR 模型</strong><small>${providerInfo.supportsVision === false ? "当前供应商未默认启用视觉能力" : "识别持股截图"}</small></span>
                <select data-setting="visionModel">
                  ${visionOptions.length ? visionOptions.map((item) => `<option value="${item}" ${(draft.visionModel || providerInfo.visionModel) === item ? "selected" : ""}>${item}</option>`).join("") : `<option value="">不启用 OCR 模型</option>`}
                </select>
              </label>
              <label class="setting-row setting-row-wide setting-url-row">
                <span><strong>API 地址</strong><small>Chat Completions</small></span>
                <input class="setting-url-input" data-setting="apiUrl" value="${escapeHtml(currentApiUrl)}" placeholder="${escapeHtml(providerInfo.apiUrl || "https://.../chat/completions")}" title="${escapeHtml(currentApiUrl)}" spellcheck="false" autocomplete="off" />
                <div class="setting-url-current">
                  <span>当前已设置</span>
                  <code>${escapeHtml(currentApiUrl || "未设置")}</code>
                </div>
              </label>
              <label class="setting-row">
                <span><strong>${providerInfo.label || "模型"} AK</strong><small>留空则保留原 AK</small></span>
                <input type="password" data-setting="apiKey" value="${escapeHtml(draft.apiKey || "")}" placeholder="${draft.hasApiKey || draft.hasKimiApiKey ? `已保存 ${draft.apiKeyMasked || draft.kimiApiKeyMasked}` : "请输入当前供应商 API Key"}" autocomplete="off" />
              </label>
            </section>
            <section class="settings-section">
              <div class="settings-section-title">
                <h2>观澜理财师</h2>
                <span>角色、模型和回答风格</span>
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
                <h2>管理员密码</h2>
                <span>保护历史持股和仓位数据</span>
              </div>
              <label class="setting-row">
                <span><strong>${admin.hasAdminPassword ? "原密码" : "原密码"}</strong><small>${admin.hasAdminPassword ? "修改前必须验证当前管理员密码" : "首次创建可留空"}</small></span>
                <input type="password" data-setting="adminOldPassword" value="${escapeHtml(draft.adminOldPassword || "")}" placeholder="${admin.hasAdminPassword ? "输入当前管理员密码" : "首次创建无需填写"}" autocomplete="current-password" />
              </label>
              <label class="setting-row">
                <span><strong>新密码</strong><small>至少 6 位，留空则不修改</small></span>
                <input type="password" data-setting="adminNewPassword" value="${escapeHtml(draft.adminNewPassword || "")}" placeholder="输入新管理员密码" autocomplete="new-password" />
              </label>
              <label class="setting-row">
                <span><strong>确认新密码</strong><small>再次输入新管理员密码</small></span>
                <input type="password" data-setting="adminConfirmPassword" value="${escapeHtml(draft.adminConfirmPassword || "")}" placeholder="再次输入新密码" autocomplete="new-password" />
              </label>
              <div class="setting-note">
                ${admin.updatedAt ? `最近修改：${new Date(admin.updatedAt).toLocaleString("zh-CN")}。` : "管理员密码由安装/部署脚本强制设置。"}
                修改成功后，当前浏览器的持股解锁状态会失效，需要重新输入新密码。
              </div>
            </section>
          </div>
          <aside class="settings-side-column">
            <section class="settings-section">
              <div class="settings-section-title">
                <h2>运行策略</h2>
                <span>节流和缓存</span>
              </div>
              <label class="setting-row side-setting-row">
                <span><strong>模型调用 QPM</strong><small>每分钟最多启动的模型请求数</small></span>
                <input type="number" data-setting="modelQpm" value="${Number(draft.modelQpm || 500)}" min="1" max="1000" step="1" inputmode="numeric" />
              </label>
              <label class="setting-row toggle-row">
                <span>
                  <strong>使用缓存</strong>
                  <small>复用历史行情、新闻和模型结果</small>
                </span>
                <input type="checkbox" data-setting="useCache" ${draft.useCache !== false ? "checked" : ""} />
              </label>
            </section>
            <section class="settings-section">
              <div class="settings-section-title">
                <h2>行情数据源</h2>
                <span>失败后自动兜底</span>
              </div>
              <label class="setting-row side-setting-row">
                <span><strong>优先数据源</strong><small>${marketSourceOptions.find(([key]) => key === (draft.marketDataSource || "auto"))?.[2] || marketSourceOptions[0][2]}</small></span>
                <select data-setting="marketDataSource">
                  ${marketSourceOptions.map(([key, label]) => `<option value="${key}" ${(draft.marketDataSource || "auto") === key ? "selected" : ""}>${label}</option>`).join("")}
                </select>
              </label>
            </section>
            <div class="settings-actions">
              <button class="primary" data-action="save-settings" ${state.settingsSaving ? "disabled" : ""}>${state.settingsSaving ? "应用中..." : "保存并应用"}</button>
            </div>
          </aside>
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
            <span>${state.ocrProgress || "AI 模型将识别股票名称、成本价和持有数量；完成后浮层会自动关闭。"}</span>
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
      ${advice.technical ? `<div class="portfolio-t-tags">
        <span>${advice.technical.macdLabel || "MACD待确认"}</span>
        <span>${advice.technical.sarLabel || "SAR待确认"}</span>
        <span>${advice.discipline || "保留底仓，破位不接回"}</span>
      </div>` : ""}
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
          <strong>${fmt(order.price)} · ${fmt(order.qty || 0, 0)}股</strong>
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
        <small>${state.portfolioParser?.includes("ai") ? "AI 识别 + 持久化持股" : "本地持股 + 实时行情"}</small>
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

function buildPositionTop20View(stocks) {
  if (!stocks.length) return `<div class="panel empty">暂无满足建仓条件的股票，等待下一轮推荐池刷新。</div>`;
  return `
    <section class="build-position-section">
      <div class="section-head recommend-subhead">
        <div>
          <h2>Top20 最适合建仓</h2>
          <span class="hint">优先筛选主力方向清晰、技术面允许分批建仓且涨幅未明显透支的标的</span>
        </div>
      </div>
      <div class="build-position-grid">
        ${stocks.map((stock, index) => {
          const levels = stock.advice?.levels || {};
          const score = recommendationOpportunityScore(stock);
          const bullGate = buildPositionBullGateAdvice(stock);
          return `
            <article class="card build-position-card" data-stock="${stock.code}">
              <div class="build-position-head">
                <span class="rank-badge">#${index + 1}</span>
                <div>
                  <strong>${stock.name}</strong>
                  <small>${stock.code} · ${stock.sectorName || "未分组"}</small>
                </div>
                <b>${fmt(score, 1)}</b>
              </div>
              <div class="build-position-quote">
                <span>现价 <b>${fmt(stock.price)}</b></span>
                <span>涨跌 <b class="${pctClass(stock.pct)}">${stock.pct > 0 ? "+" : ""}${fmt(stock.pct)}%</b></span>
                <span>仓位 <b>${stock.advice?.position || "--"}</b></span>
              </div>
              <div class="build-position-levels">
                <span>回踩 ${fmt(levels.pullbackBuy)}</span>
                <span>突破 ${fmt(levels.breakoutBuy)}</span>
                <span>止损 ${fmt(levels.stopLoss)}</span>
              </div>
              <div class="build-position-bullgate">
                <div>
                  <span>牛门线</span>
                  <strong>${bullGate.levelText}</strong>
                  <em>${bullGate.sourceText} · ${bullGate.distance}</em>
                </div>
                <div>
                  <span>${bullGate.tone}</span>
                  <strong>${bullGate.action}</strong>
                  <em>${bullGate.risk}</em>
                </div>
              </div>
              ${stock.savedStrategy ? `<div class="recommend-saved-strategy">历史策略：${escapeHtml(stock.savedStrategy.summary || "已保存单股优化策略")}</div>` : ""}
              <p>${buildPositionReason(stock)}</p>
            </article>
          `;
        }).join("")}
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
            ${stock.savedStrategy ? `<p class="recommend-saved-strategy">历史策略：${escapeHtml(stock.savedStrategy.summary || "已保存单股优化策略")}</p>` : ""}
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
  const tracked = isTrackedStock(stock.code);
  const virtualJoined = isVirtualTradingStock(stock.code);
  return `
    <div class="overlay open" id="stockOverlay" data-stock-code="${escapeHtml(stock.code || "")}">
      <div class="shade" data-close></div>
      <section class="drawer" role="dialog" aria-modal="true">
        <header class="drawer-head">
          <div class="drawer-title-group">
            <div class="stock-title-line">
              <div class="page-title">${stock.name} <span class="stock-code">${stock.code}</span></div>
              <div class="stock-title-actions">
                <button class="ghost title-copy-btn" data-action="copy-stock-name" data-copy-value="${escapeHtml(stock.name || "")}" title="复制股票名称">${icons.copy}<span>复制名称</span></button>
                <button class="ghost title-copy-btn ${discussionReady ? "" : "is-disabled"}" data-action="join-stock-discussion" title="${discussionReady ? "带入详情数据并进入个股讨论" : escapeHtml(discussionHint)}" ${discussionReady ? "" : "disabled"}>${icons.chat}<span>${discussionReady ? "加入讨论" : "数据加载中"}</span></button>
                <button class="ghost title-copy-btn ${tracked ? "is-tracked" : ""}" data-action="add-stock-tracking" title="${tracked ? "已在追踪池中" : "加入追踪池，每15分钟采集价格与成交量"}">${icons.radar}<span>${tracked ? "已追踪" : "加入追踪"}</span></button>
                <button class="ghost title-copy-btn ${virtualJoined ? "is-tracked" : ""}" data-action="add-virtual-trading" title="${virtualJoined ? "已在虚拟交易中" : "加入虚拟交易，每10分钟按技术指标演练交易"}">${icons.radar}<span>${virtualJoined ? "已虚拟" : "虚拟交易"}</span></button>
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
  const bullGate = bullGateLine(stock.candles || []);
  const latestBullGate = bullGate.at(-1);
  const bullGateInfo = bullGateState(latest, latestBullGate);
  const savedStrategy = savedVirtualStrategyForStock(stock.code);
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
        ${savedStrategy ? stockSavedStrategyView(savedStrategy) : ""}
        ${adviceExplanationView(advice)}
        ${bullGateExplanationView(latest, latestBullGate)}
        ${stockNewsPolicyView(stock)}
        <div class="chart-wrap interactive-chart" data-action="open-fullscreen-stock-chart" title="点击全屏查看图表">
          <div class="stock-chart-toolbar">
            ${stockChartIndicatorControls()}
            ${stockChartLegend()}
          </div>
          <div class="stock-chart-canvas">
            <canvas id="stockChart"></canvas>
          </div>
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
      ${indicatorCard("牛门线", bullGateInfo.value, bullGateInfo.detail)}
      ${indicatorCard("主力", money(stock.mainFlow), `主力占比 ${fmt(stock.mainFlowPct)}% / 量 ${fmt(latest.volume, 0)}`)}
    </section>
  `;
}

function stockFullscreenChartModal() {
  const stock = activeFullscreenStockChart();
  if (!state.fullscreenStockChart || !stock) return `<div class="overlay" id="stockFullscreenChartOverlay"></div>`;
  const trades = stockSimulationTrades(stock.code);
  const tradeCount = trades.length;
  const latestTrade = trades.at(-1) || null;
  const latestCandle = (stock.candles || []).at(-1) || {};
  const tradePrice = Number.isFinite(Number(latestTrade?.price)) ? Number(latestTrade.price) : Number(stock.price ?? latestCandle.close);
  return `
    <div class="overlay open stock-fullscreen-chart-overlay" id="stockFullscreenChartOverlay">
      <div class="shade" data-action="close-fullscreen-stock-chart"></div>
      <section class="stock-fullscreen-chart" role="dialog" aria-modal="true" aria-label="${escapeHtml(stock.name || stock.code || "股票")} 全屏图表">
        <header class="stock-fullscreen-head">
          <div>
            <strong>${escapeHtml(stock.name || "--")} <span>${escapeHtml(stock.code || "")}</span></strong>
            <small>全屏图表 · 横向滚动查看全部K线 · ${fmt(stock.candles?.length || 0, 0)}根K线 · ${fmt(tradeCount, 0)}笔模拟交易</small>
          </div>
          <div class="stock-fullscreen-price-strip" aria-label="全屏交易价格摘要">
            <span><small>交易价格</small><b>${fmt(tradePrice)}</b></span>
            <span><small>最近数量</small><b>${latestTrade ? `${fmt(latestTrade.qty, 0)}股` : "--"}</b></span>
            <span><small>K线收盘</small><b>${fmt(latestCandle.close)}</b></span>
          </div>
          <button class="icon-btn" data-action="close-fullscreen-stock-chart" title="关闭">${icons.close}</button>
        </header>
        <div class="stock-fullscreen-toolbar">
          ${stockChartIndicatorControls({ includeSimulation: true })}
          ${stockChartLegend({ includeSimulation: true })}
        </div>
        <div class="stock-fullscreen-chart-stage">
          <div class="stock-fullscreen-scroll" id="stockFullscreenChartScroll">
            <canvas id="stockChartFullscreen"></canvas>
          </div>
          <div class="chart-tip fullscreen-chart-tip" id="stockChartFullscreenTip" aria-hidden="true"></div>
        </div>
      </section>
    </div>
  `;
}

function activeFullscreenStockChart() {
  if (!state.fullscreenStockChart) return null;
  return state.fullscreenStockChartData || state.modalStock || null;
}

function openVirtualBacktestFullscreenChart(code = "") {
  const clean = String(code || "").trim();
  const chart = (state.virtualTrading?.lastBacktest?.stockCharts || [])
    .find((item) => String(item.stock?.code || "").trim() === clean);
  if (!chart) {
    showToast("未找到这只股票的模拟交易图表数据");
    return;
  }
  const rows = (chart.rows || [])
    .filter((row) => ["open", "close", "high", "low"].every((key) => Number.isFinite(Number(row[key]))))
    .map((row) => ({
      day: row.day,
      open: Number(row.open),
      close: Number(row.close),
      high: Number(row.high),
      low: Number(row.low),
      volume: Number(row.volume || 0)
    }));
  if (rows.length < 2) {
    showToast("K线不足，暂时无法全屏查看");
    return;
  }
  fullscreenStockChartPointer = null;
  fullscreenStockChartScrollAnchor = null;
  update({
    fullscreenStockChart: true,
    fullscreenStockChartData: {
      ...(chart.stock || {}),
      candles: rows
    }
  });
}

function stockSavedStrategyView(saved = {}) {
  const s = saved.strategy || {};
  return `
    <section class="stock-saved-strategy">
      <div>
        <span>历史模拟策略已应用</span>
        <strong>${saved.summary || "单股优化策略已保存"}</strong>
      </div>
      <div class="stock-saved-strategy-grid">
        <span>MACD <b>${fmt(s.macdWeight, 2)}</b></span>
        <span>SAR <b>${fmt(s.sarWeight, 2)}</b></span>
        <span>BOLL <b>${fmt(s.bollWeight, 2)}</b></span>
        <span>牛门线 <b>${fmt(s.bullGateWeight, 2)}</b></span>
        <span>止盈 <b>${fmt(s.takeProfitPct, 1)}%</b></span>
        <span>止损 <b>${fmt(s.stopLossPct, 1)}%</b></span>
      </div>
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

function inferredCompanyProfile(stock, sectorName = "") {
  const name = stock.name || stock.code || "该公司";
  const text = `${name} ${sectorName}`;
  const rules = [
    [/白酒|茅台|五粮液|泸州|汾酒|酒/, ["白酒及系列酒的生产与销售", "高端白酒、酱香/浓香系列酒"]],
    [/银行|农商|商行/, ["商业银行综合金融服务", "公司金融、零售金融、财富管理"]],
    [/证券|券商|财富/, ["证券经纪、投行、资管和自营业务", "证券交易服务、财富管理、投行业务"]],
    [/半导体|芯片|集成电路|微电|硅/, ["半导体器件、芯片或设备材料相关业务", "芯片产品、半导体设备/材料"]],
    [/通信|光模块|网络|中际|新易盛/, ["通信设备、光通信或网络设备相关业务", "光模块、通信网络设备"]],
    [/新能源|锂|电池|宁德|汽车|比亚迪|赛力斯/, ["新能源汽车、电池或汽车零部件相关业务", "动力电池、新能源汽车、核心零部件"]],
    [/医药|药|生物|医疗/, ["药品研发、生产和销售", "创新药、仿制药或医疗产品"]],
    [/军工|航空|航天|电子/, ["军工装备、航空航天或电子装备相关业务", "航空装备、军工电子、核心零部件"]],
    [/煤|能源|矿/, ["煤炭、电力或能源资源相关业务", "煤炭产品、电力能源服务"]],
    [/地产|置业|发展|蛇口|万科|保利/, ["房地产开发、运营和物业服务", "住宅开发、商业地产、物业服务"]],
    [/机器人|自动化|智能装备/, ["工业自动化、机器人或智能装备业务", "机器人本体、伺服系统、智能装备"]]
  ];
  const found = rules.find(([pattern]) => pattern.test(text));
  const [mainBusiness, flagshipProduct] = found?.[1] || [
    sectorName ? `${sectorName}相关产品或服务` : "主营业务待公司资料确认",
    sectorName ? `${sectorName}方向核心产品/服务` : "拳头产品待公司资料确认"
  ];
  return { mainBusiness, flagshipProduct, source: "本地推断" };
}

function stockProfileView(stock, advice) {
  const sectorName = stockSectorName(stock);
  const profile = stock.profile || {};
  const inferred = inferredCompanyProfile(stock, sectorName);
  const mainBusiness = profile.mainBusiness || inferred.mainBusiness;
  const flagshipProduct = profile.flagshipProduct || inferred.flagshipProduct;
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
        <small>${stock.quoteSource === "tencent" ? "腾讯行情" : stock.source || "实时行情"} · ${profile.source || inferred.source} · ${sectorName || profile.industry || "全市场匹配"}</small>
      </div>
      <div class="stock-business-grid">
        <div>
          <span>主营业务</span>
          <strong>${mainBusiness || "待确认"}</strong>
        </div>
        <div>
          <span>拳头产品</span>
          <strong>${flagshipProduct || "待确认"}</strong>
        </div>
      </div>
      <p>${summary}</p>
      <div class="stock-profile-tags">
        ${profile.companyName ? `<span>公司：${profile.companyName}</span>` : ""}
        ${profile.industry ? `<span>行业：${profile.industry}</span>` : ""}
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
          <div><span>政策/新闻 Top3</span><strong>正在同步近 3 天消息</strong></div>
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
          <div><span>政策/新闻 Top3</span><strong>近 3 天暂无强相关消息</strong></div>
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
                <span>${item.time ? new Date(item.time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "近 3 天"}</span>
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

function bullGateLine(candles = [], period = 20) {
  return candles.map((_, index) => {
    const rows = candles.slice(Math.max(0, index - period + 1), index + 1);
    if (!rows.length) return null;
    const closeAvg = rows.reduce((sum, row) => sum + Number(row.close || 0), 0) / rows.length;
    const rangeAvg = rows.reduce((sum, row) => sum + Math.max(0, Number(row.high || 0) - Number(row.low || 0)), 0) / rows.length;
    return closeAvg + rangeAvg * 0.38;
  });
}

function bullGateState(latest = {}, gateValue) {
  const close = Number(latest.close);
  const gate = Number(gateValue);
  if (!Number.isFinite(close) || !Number.isFinite(gate)) return { value: "--", detail: "等待 K 线补齐" };
  const diffPct = gate ? ((close - gate) / gate) * 100 : 0;
  if (close >= gate) {
    return {
      value: "站上牛门",
      detail: `牛门线 ${fmt(gate)}，收盘高 ${fmt(Math.abs(diffPct))}%`
    };
  }
  return {
    value: "门下等待",
    detail: `牛门线 ${fmt(gate)}，还差 ${fmt(Math.abs(diffPct))}%`
  };
}

function bullGateExplanation(latest = {}, gateValue) {
  const close = Number(latest.close);
  const gate = Number(gateValue);
  if (!Number.isFinite(close) || !Number.isFinite(gate)) {
    return {
      tone: "等待数据",
      status: "K 线未补齐，暂不使用牛门线做交易判断。",
      distance: "--",
      action: "先等待 K 线、BOLL、SAR 和 MACD 数据同步完成。",
      risk: "数据不完整时不要因为单一报价变化追买。",
      tags: ["等待K线", "不追价", "先看共振"]
    };
  }
  const diff = close - gate;
  const diffPct = gate ? (diff / gate) * 100 : 0;
  const abs = Math.abs(diffPct);
  if (diffPct >= 3) {
    return {
      tone: "强势门上",
      status: `收盘价 ${fmt(close)} 明显站上牛门线 ${fmt(gate)}，趋势门槛已打开，但短线已有 ${fmt(abs)}% 的门上溢价。`,
      distance: `+${fmt(diffPct)}%`,
      action: "已有仓位可继续持有，新增仓位不要一次打满，等回踩不破牛门线或 MACD 柱继续扩张再加。",
      risk: `若放量跌回 ${fmt(gate)} 下方，说明强势确认失败，短线仓位先降一档。`,
      tags: ["趋势偏强", "不宜追满", "回踩确认"]
    };
  }
  if (diffPct >= 0) {
    return {
      tone: "刚过牛门",
      status: `收盘价 ${fmt(close)} 刚站上牛门线 ${fmt(gate)}，这是较好的试仓区，关键是下一根 K 线不能快速跌回门下。`,
      distance: `+${fmt(diffPct)}%`,
      action: "可用 1-2 成试仓；若回踩牛门线不破并重新拉起，再分批提高到计划仓位。",
      risk: `收盘重新跌破 ${fmt(gate)}，或 SAR 翻空、MACD 柱缩短时，试仓应撤回观察。`,
      tags: ["试仓区", "等确认", "分批加"]
    };
  }
  if (diffPct >= -2) {
    return {
      tone: "门下临界",
      status: `收盘价 ${fmt(close)} 位于牛门线 ${fmt(gate)} 下方 ${fmt(abs)}%，离转强只差一步，但还没有完成确认。`,
      distance: `-${fmt(abs)}%`,
      action: "适合放入观察池，等放量站上牛门线再买；激进做法只允许小仓低吸，不能越跌越补。",
      risk: "若继续弱于 BOLL 中轨且 MACD 走弱，说明门下压力仍在，建仓顺延。",
      tags: ["观察位", "等突破", "小仓试错"]
    };
  }
  return {
    tone: "门下偏弱",
    status: `收盘价 ${fmt(close)} 距牛门线 ${fmt(gate)} 仍有 ${fmt(abs)}% 差距，当前不是主动建仓的舒服位置。`,
    distance: `-${fmt(abs)}%`,
    action: "先不追求买入，等价格收复牛门线或出现放量长阳再重新评估。",
    risk: "门下运行时，反弹更容易变成卖压释放；若持仓较重，反弹到牛门线附近反而要检查是否减仓。",
    tags: ["偏弱", "不主动建仓", "反弹看压"]
  };
}

function bullGateExplanationView(latest = {}, gateValue) {
  const info = bullGateExplanation(latest, gateValue);
  return `
    <section class="bullgate-explain">
      <div class="bullgate-explain-head">
        <div>
          <span>牛门线解读</span>
          <strong>${info.tone}</strong>
        </div>
        <div>
          <span>距离牛门</span>
          <strong class="${String(info.distance).startsWith("+") ? "up" : String(info.distance).startsWith("-") ? "down" : ""}">${info.distance}</strong>
        </div>
      </div>
      <p>${info.status}</p>
      <div class="bullgate-playbook">
        <div><span>操作</span><strong>${info.action}</strong></div>
        <div><span>风控</span><strong>${info.risk}</strong></div>
      </div>
      <div class="bullgate-tags">${info.tags.map((tag) => `<span>${tag}</span>`).join("")}</div>
    </section>
  `;
}

function stockChartIndicatorControls({ includeSimulation = false } = {}) {
  const indicators = state.stockChartIndicators || {};
  const items = [
    ["kline", "K", "K线", "显示/隐藏 K 线"],
    ["boll", "B", "BOLL", "显示/隐藏 BOLL"],
    ["sar", "S", "SAR", "显示/隐藏 SAR"],
    ["bullgate", "门", "牛门线", "显示/隐藏 牛门线"],
    ["macd", "M", "MACD", "显示/隐藏 MACD"]
  ];
  if (includeSimulation) items.push(["simulation", "交", "模拟交易", "显示/隐藏 模拟交易成交点"]);
  return `
    <div class="stock-chart-controls" aria-label="图表指标显示控制">
      ${items.map(([key, icon, label, title]) => `
        <button type="button" class="${indicators[key] !== false ? "active" : ""}" data-chart-indicator="${key}" title="${title}" aria-pressed="${indicators[key] !== false ? "true" : "false"}">
          <i>${icon}</i><span>${label}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function stockChartLegend({ includeSimulation = false } = {}) {
  const indicators = state.stockChartIndicators || {};
  const showMacd = indicators.macd !== false;
  const showBullGate = indicators.bullgate !== false;
  const showSimulation = includeSimulation && indicators.simulation !== false;
  const items = [
    { className: "k-up", label: "红K", text: "收盘高于开盘" },
    { className: "k-down", label: "绿K", text: "收盘低于开盘" },
    { className: "boll-upper", label: "BOLL上/下轨", text: "压力与支撑边界" },
    { className: "boll-mid", label: "BOLL中轨", text: "趋势均衡线" },
    { className: "sar", label: "SAR", text: "止损/反转参考点" },
    showBullGate ? { className: "bullgate", label: "牛门线", text: "多头确认门槛" } : null,
    showMacd ? { className: "macd-dif", label: "DIF", text: "快线" } : null,
    showMacd ? { className: "macd-dea", label: "DEA", text: "慢线" } : null,
    showMacd ? { className: "macd-hist", label: "柱", text: "红强绿弱" } : null,
    showSimulation ? { className: "simulation", label: "模拟交易", text: "买卖成交点" } : null
  ].filter(Boolean);
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

function stockSimulationTrades(code = "") {
  const clean = String(code || "").trim();
  if (!clean) return [];
  const backtestChart = (state.virtualTrading?.lastBacktest?.stockCharts || [])
    .find((item) => String(item.stock?.code || "").trim() === clean);
  const backtestTrades = backtestChart?.trades || [];
  const liveTrades = (state.virtualTrading?.trades || []).filter((item) => String(item.code || item.stock?.code || "").trim() === clean);
  return [...backtestTrades, ...liveTrades]
    .filter((item) => item && Number.isFinite(Number(item.price)))
    .sort((a, b) => String(a.time || "").localeCompare(String(b.time || "")));
}

function drawStockChart(stock, options = {}) {
  const fullscreen = Boolean(options.fullscreen);
  const canvas = document.querySelector(options.selector || "#stockChart");
  if (!canvas || !stock.candles?.length) return;
  const tip = document.querySelector(options.tipSelector || "#stockChartTip");
  const fullscreenScroll = fullscreen ? canvas.closest(".stock-fullscreen-scroll") : null;
  const scrollAnchor = fullscreen ? captureFullscreenChartScroll() || fullscreenStockChartScrollAnchor : null;
  if (fullscreen) {
    const minWidth = fullscreenScroll?.clientWidth || 900;
    const desiredWidth = Math.max(minWidth, stock.candles.length * 13 + 128);
    canvas.style.width = `${desiredWidth}px`;
    if (scrollAnchor) restoreFullscreenChartScroll(scrollAnchor);
  }
  const rect = canvas.getBoundingClientRect();
  const wrapRect = (fullscreen ? canvas.closest(".stock-fullscreen-chart-stage") : canvas.closest(".chart-wrap"))?.getBoundingClientRect() || rect;
  const tipOffset = {
    x: rect.left - wrapRect.left,
    y: rect.top - wrapRect.top
  };
  if (rect.width < 20 || rect.height < 20) return;
  const indicators = state.stockChartIndicators || {};
  const showKline = indicators.kline !== false;
  const showBoll = indicators.boll !== false;
  const showSar = indicators.sar !== false;
  const showBullGate = indicators.bullgate !== false;
  const showMacd = indicators.macd !== false;
  const showSimulation = fullscreen && indicators.simulation !== false;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const advice = stockAdvice(stock);
  const candles = fullscreen ? stock.candles : stock.candles.slice(-64);
  const offset = stock.candles.length - candles.length;
  const boll = advice.boll.slice(offset);
  const sar = advice.sar.slice(offset);
  const bullGate = bullGateLine(stock.candles).slice(offset);
  const hist = advice.macd.hist.slice(offset);
  const dif = advice.macd.dif.slice(offset);
  const dea = advice.macd.dea.slice(offset);
  const simulationTrades = showSimulation ? stockSimulationTrades(stock.code) : [];
  const tradeByDay = new Map();
  simulationTrades.forEach((trade) => {
    const day = formatTradeDate(trade.time);
    if (!tradeByDay.has(day)) tradeByDay.set(day, []);
    tradeByDay.get(day).push(trade);
  });
  const pad = { l: 48, r: 58, t: 48, b: 32 };
  const axisH = 28;
  const axisTop = rect.height - axisH;
  const macdGap = showMacd ? 18 : 0;
  const macdH = showMacd ? Math.max(104, Math.min(150, rect.height * 0.22)) : 0;
  const macdTop = showMacd ? axisTop - macdH : axisTop;
  const mainH = showMacd ? macdTop - macdGap : axisTop;
  const mainBottom = mainH;
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  if (showBoll) {
    highs.push(...boll.map((b) => b.upper));
    lows.push(...boll.map((b) => b.lower));
  }
  if (showSar) {
    highs.push(...sar);
    lows.push(...sar);
  }
  if (showBullGate) {
    highs.push(...bullGate.filter((value) => Number.isFinite(Number(value))));
    lows.push(...bullGate.filter((value) => Number.isFinite(Number(value))));
  }
  if (showSimulation) {
    highs.push(...simulationTrades.map((trade) => Number(trade.price)).filter(Number.isFinite));
    lows.push(...simulationTrades.map((trade) => Number(trade.price)).filter(Number.isFinite));
  }
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const xStep = (rect.width - pad.l - pad.r) / candles.length;
  const y = (value) => pad.t + (max - value) / Math.max(0.01, max - min) * (mainBottom - pad.t - 8);
  const chartLeft = pad.l;
  const chartRight = rect.width - pad.r;
  const chartBottom = mainBottom;
  ctx.fillStyle = "#09131c";
  ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.strokeStyle = "#1d3344";
  ctx.fillStyle = "#6f8494";
  ctx.font = "11px system-ui";
  ctx.textAlign = "left";
  ctx.fillText("价格", chartRight + 7, 16);
  for (let i = 0; i < 5; i += 1) {
    const yy = pad.t + i * (mainBottom - pad.t - 8) / 4;
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
  if (showKline) {
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
  }
  if (showBoll) {
    drawLine(ctx, boll.map((b) => b.upper), "#f2b84b", y, pad.l, xStep);
    drawLine(ctx, boll.map((b) => b.mid), "#54a3ff", y, pad.l, xStep);
    drawLine(ctx, boll.map((b) => b.lower), "#f2b84b", y, pad.l, xStep);
  }
  if (showSar) {
    ctx.fillStyle = "#d184ff";
    sar.forEach((value, i) => {
      const x = pad.l + i * xStep + xStep / 2;
      ctx.beginPath();
      ctx.arc(x, y(value), 2.1, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  if (showBullGate) {
    drawLine(ctx, bullGate, "#2ee6d6", y, pad.l, xStep, { dash: [6, 4], width: 1.9 });
  }
  if (showSimulation) {
    candles.forEach((c, i) => {
      const trades = tradeByDay.get(c.day) || [];
      trades.forEach((trade, tradeIndex) => {
        const tx = pad.l + i * xStep + xStep / 2;
        const ty = y(Number(trade.price));
        const buy = trade.side === "buy";
        const markerY = buy ? ty - 7 - tradeIndex * 4 : ty + 7 + tradeIndex * 4;
        ctx.save();
        ctx.fillStyle = buy ? "#ff4d57" : "#00b070";
        ctx.strokeStyle = "#09131c";
        ctx.lineWidth = 2;
        ctx.beginPath();
        if (buy) {
          ctx.moveTo(tx, ty - 7 - tradeIndex * 4);
          ctx.lineTo(tx - 6, ty + 6 - tradeIndex * 4);
          ctx.lineTo(tx + 6, ty + 6 - tradeIndex * 4);
        } else {
          ctx.moveTo(tx, ty + 7 + tradeIndex * 4);
          ctx.lineTo(tx - 6, ty - 6 + tradeIndex * 4);
          ctx.lineTo(tx + 6, ty - 6 + tradeIndex * 4);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        drawTradePriceLabel(ctx, {
          x: tx,
          y: markerY,
          side: trade.side,
          price: trade.price,
          qty: trade.qty,
          chartLeft,
          chartRight,
          mainTop: pad.t,
          mainBottom
        });
        ctx.restore();
      });
    });
  }
  const hMax = Math.max(...hist.map(Math.abs), 0.01);
  if (showMacd) {
    const macdPadT = 20;
    const macdPadB = 18;
    const macdMid = macdTop + macdH / 2;
    const macdAmp = Math.max(18, (macdH - macdPadT - macdPadB) / 2);
    const zero = macdMid;
    ctx.save();
    ctx.fillStyle = "rgba(4, 12, 19, 0.42)";
    ctx.fillRect(chartLeft, macdTop, chartRight - chartLeft, macdH);
    ctx.strokeStyle = "#1d3344";
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(chartLeft, macdTop);
    ctx.lineTo(chartRight, macdTop);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(chartLeft, zero);
    ctx.lineTo(chartRight, zero);
    ctx.stroke();
    hist.forEach((value, i) => {
      const x = pad.l + i * xStep + xStep * 0.25;
      const barH = value / hMax * macdAmp;
      ctx.fillStyle = value >= 0 ? "#ff4d57" : "#00b070";
      ctx.fillRect(x, zero - Math.max(0, barH), Math.max(1, xStep * 0.5), Math.abs(barH));
    });
    const macdY = (value) => zero - value / hMax * (macdAmp * 0.74);
    drawLine(ctx, dif, "#54a3ff", macdY, pad.l, xStep);
    drawLine(ctx, dea, "#f2b84b", macdY, pad.l, xStep);
    ctx.restore();
  }
  const labelEvery = Math.max(1, Math.ceil(candles.length / 6));
  ctx.fillStyle = "#09131c";
  ctx.fillRect(0, axisTop, rect.width, axisH);
  ctx.strokeStyle = "#1d3344";
  ctx.beginPath();
  ctx.moveTo(chartLeft, axisTop + 0.5);
  ctx.lineTo(chartRight, axisTop + 0.5);
  ctx.stroke();
  ctx.fillStyle = "#6f8494";
  ctx.font = "11px system-ui";
  ctx.textAlign = "center";
  candles.forEach((c, i) => {
    if (i % labelEvery && i !== candles.length - 1) return;
    const x = pad.l + i * xStep + xStep / 2;
    ctx.fillText(String(c.day || "").slice(5), x, axisTop + 18);
  });
  const pointer = normalizeStockPointer(fullscreen ? fullscreenStockChartPointer : stockChartPointer, rect, pad, mainBottom, candles.length);
  if (pointer) {
    const index = Math.max(0, Math.min(candles.length - 1, Math.round((pointer.x - pad.l - xStep / 2) / xStep)));
    const candle = candles[index];
    const px = pad.l + index * xStep + xStep / 2;
    const pointerPrice = max - ((pointer.y - pad.t) / Math.max(1, mainBottom - pad.t - 8)) * (max - min);
    ctx.save();
    ctx.strokeStyle = "rgba(218, 230, 238, 0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(px, pad.t);
    ctx.lineTo(px, mainBottom);
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
    updateStockChartTip(
      tip,
      pointer,
      candle,
      pointerPrice,
      showBoll ? boll[index] : null,
      showSar ? sar[index] : null,
      showBullGate ? bullGate[index] : null,
      showMacd ? { dif: dif[index], dea: dea[index], hist: hist[index] } : null,
      showSimulation ? tradeByDay.get(candle.day) || [] : [],
      rect,
      tipOffset
    );
  } else if (tip) {
    tip.classList.remove("show");
  }
  drawChartLineLegend(ctx, pad.l, 18, [
    showKline ? { color: "#ff4d57", label: "红K 多方" } : null,
    showKline ? { color: "#00b070", label: "绿K 空方" } : null,
    showBoll ? { color: "#f2b84b", label: "BOLL上/下轨" } : null,
    showBoll ? { color: "#54a3ff", label: "BOLL中轨" } : null,
    showSar ? { color: "#d184ff", label: "SAR反转点", dot: true } : null,
    showBullGate ? { color: "#2ee6d6", label: "牛门线" } : null,
    showSimulation ? { color: "#ff4d57", label: "模拟买入", marker: "triangle-up" } : null,
    showSimulation ? { color: "#00b070", label: "模拟卖出", marker: "triangle-down" } : null
  ].filter(Boolean));
  if (fullscreen) {
    restoreFullscreenChartScroll(scrollAnchor);
    fullscreenStockChartScrollAnchor = captureFullscreenChartScroll();
  }
}

function findTrackedStock(code = "") {
  return (state.trackingRows || []).find((item) => item.code === code) || null;
}

function drawTrackingChart(stock = {}) {
  const canvas = document.querySelector(`[data-tracking-chart="${CSS.escape(stock.code || "")}"]`);
  if (!canvas) return;
  const rows = (stock.klines || []).filter((row) => ["open", "close", "high", "low"].every((key) => Number.isFinite(Number(row[key])))).slice(-7);
  const tip = document.querySelector(`[data-tracking-tip="${CSS.escape(stock.code || "")}"]`);
  const rect = canvas.getBoundingClientRect();
  const wrapRect = canvas.closest(".tracking-chart")?.getBoundingClientRect() || rect;
  const tipOffset = {
    x: rect.left - wrapRect.left,
    y: rect.top - wrapRect.top
  };
  if (rect.width < 20 || rect.height < 20) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#09131c";
  ctx.fillRect(0, 0, rect.width, rect.height);
  if (!rows.length) {
    ctx.fillStyle = "#6f8494";
    ctx.font = "12px system-ui";
    ctx.fillText("等待最近7天K线数据", 18, 30);
    if (tip) tip.classList.remove("show");
    return;
  }
  const bullGate = bullGateLine(rows);
  const pad = { l: 48, r: 58, t: 38, b: 30 };
  const axisH = 28;
  const axisTop = rect.height - axisH;
  const volumeH = Math.max(46, Math.min(64, rect.height * 0.24));
  const volumeGap = 12;
  const volumeTop = axisTop - volumeH;
  const mainBottom = volumeTop - volumeGap;
  const highs = rows.map((row) => Number(row.high));
  const lows = rows.map((row) => Number(row.low));
  highs.push(...bullGate.filter((value) => Number.isFinite(Number(value))));
  lows.push(...bullGate.filter((value) => Number.isFinite(Number(value))));
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const xStep = (rect.width - pad.l - pad.r) / rows.length;
  const y = (value) => pad.t + (max - value) / Math.max(0.01, max - min) * (mainBottom - pad.t - 8);
  const chartLeft = pad.l;
  const chartRight = rect.width - pad.r;

  ctx.strokeStyle = "#1d3344";
  ctx.fillStyle = "#6f8494";
  ctx.font = "11px system-ui";
  ctx.textAlign = "left";
  ctx.fillText("价格", chartRight + 7, 16);
  for (let i = 0; i < 5; i += 1) {
    const yy = pad.t + i * (mainBottom - pad.t - 8) / 4;
    const price = max - (max - min) * i / 4;
    ctx.beginPath();
    ctx.moveTo(chartLeft, yy);
    ctx.lineTo(chartRight, yy);
    ctx.stroke();
    ctx.fillStyle = "#6f8494";
    ctx.font = "11px system-ui";
    ctx.fillText(fmt(price), chartRight + 7, yy + 4);
  }

  rows.forEach((row, i) => {
    const x = pad.l + i * xStep + xStep / 2;
    const open = Number(row.open);
    const close = Number(row.close);
    const high = Number(row.high);
    const low = Number(row.low);
    const up = close >= open;
    ctx.strokeStyle = up ? "#ff4d57" : "#00b070";
    ctx.fillStyle = up ? "#ff4d57" : "#00b070";
    ctx.beginPath();
    ctx.moveTo(x, y(high));
    ctx.lineTo(x, y(low));
    ctx.stroke();
    const bodyY = Math.min(y(open), y(close));
    const bodyH = Math.max(2, Math.abs(y(open) - y(close)));
    ctx.fillRect(x - xStep * 0.3, bodyY, Math.max(2, xStep * 0.6), bodyH);
  });

  drawDoubleBullGateLine(ctx, bullGate, y, pad.l, xStep);

  ctx.save();
  ctx.fillStyle = "rgba(4, 12, 19, 0.42)";
  ctx.fillRect(chartLeft, volumeTop, chartRight - chartLeft, volumeH);
  ctx.strokeStyle = "#1d3344";
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(chartLeft, volumeTop);
  ctx.lineTo(chartRight, volumeTop);
  ctx.stroke();
  ctx.setLineDash([]);
  const maxVolume = Math.max(...rows.map((row) => Number(row.volume || 0)), 1);
  rows.forEach((row, i) => {
    const x = pad.l + i * xStep + xStep * 0.25;
    const barH = Number(row.volume || 0) / maxVolume * (volumeH - 14);
    ctx.fillStyle = Number(row.close) >= Number(row.open) ? "rgba(255, 77, 87, 0.56)" : "rgba(0, 176, 112, 0.56)";
    ctx.fillRect(x, volumeTop + volumeH - Math.max(2, barH), Math.max(1, xStep * 0.5), Math.max(2, barH));
  });
  ctx.restore();

  ctx.fillStyle = "#09131c";
  ctx.fillRect(0, axisTop, rect.width, axisH);
  ctx.strokeStyle = "#1d3344";
  ctx.beginPath();
  ctx.moveTo(chartLeft, axisTop + 0.5);
  ctx.lineTo(chartRight, axisTop + 0.5);
  ctx.stroke();
  ctx.fillStyle = "#6f8494";
  ctx.font = "11px system-ui";
  ctx.textAlign = "center";
  rows.forEach((row, i) => {
    const x = pad.l + i * xStep + xStep / 2;
    ctx.fillText(String(row.day || "").slice(5) || `D${i + 1}`, x, axisTop + 18);
  });

  const pointer = normalizeStockPointer(trackingChartPointers.get(stock.code), rect, pad, mainBottom, rows.length);
  if (pointer) {
    const index = Math.max(0, Math.min(rows.length - 1, Math.round((pointer.x - pad.l - xStep / 2) / xStep)));
    const candle = rows[index];
    const px = pad.l + index * xStep + xStep / 2;
    const pointerPrice = max - ((pointer.y - pad.t) / Math.max(1, mainBottom - pad.t - 8)) * (max - min);
    ctx.save();
    ctx.strokeStyle = "rgba(218, 230, 238, 0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(px, pad.t);
    ctx.lineTo(px, mainBottom);
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
    updateTrackingChartTip(tip, pointer, candle, pointerPrice, bullGate[index], rect, tipOffset);
  } else if (tip) {
    tip.classList.remove("show");
  }

  drawChartLineLegend(ctx, pad.l, 18, [
    { color: "#ff4d57", label: "红K 多方" },
    { color: "#00b070", label: "绿K 空方" },
    { color: "#2ee6d6", label: "牛门线" }
  ]);
}

function updateTrackingChartTip(tip, pointer, candle, price, bullGate, rect, offset = { x: 0, y: 0 }) {
  if (!tip || !candle) return;
  const left = pointer.x > rect.width * 0.62 ? pointer.x - 172 : pointer.x + 12;
  const top = pointer.y > rect.height * 0.52 ? pointer.y - 112 : pointer.y + 12;
  tip.style.left = `${Math.max(8, offset.x + left)}px`;
  tip.style.top = `${Math.max(8, offset.y + top)}px`;
  tip.innerHTML = `
    <b>${candle.day || "--"}</b>
    <span>开 ${fmt(candle.open)} / 高 ${fmt(candle.high)}</span>
    <span>低 ${fmt(candle.low)} / 收 ${fmt(candle.close)}</span>
    <span>成交量 ${fmt(candle.volume, 0)}</span>
    <span>Y ${fmt(price)} · 牛门线 ${fmt(bullGate)}</span>
  `;
  tip.classList.add("show");
}

function scheduleTrackingChartsDraw() {
  if (trackingChartDrawFrame) return;
  trackingChartDrawFrame = requestAnimationFrame(() => {
    trackingChartDrawFrame = 0;
    if (state.page !== "tracking") return;
    (state.trackingRows || []).forEach((stock) => drawTrackingChart(stock));
  });
}

function scheduleStockChartDraw() {
  if (stockChartDrawFrame) return;
  stockChartDrawFrame = requestAnimationFrame(() => {
    stockChartDrawFrame = 0;
    if (state.modalStock) drawStockChart(state.modalStock);
    const fullscreenStock = activeFullscreenStockChart();
    if (fullscreenStock) {
      drawStockChart(fullscreenStock, {
        fullscreen: true,
        selector: "#stockChartFullscreen",
        tipSelector: "#stockChartFullscreenTip"
      });
    }
  });
}

function syncStockChartIndicatorControls() {
  const indicators = state.stockChartIndicators || {};
  document.querySelectorAll("[data-chart-indicator]").forEach((button) => {
    const key = button.dataset.chartIndicator;
    const active = indicators[key] !== false;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
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
    if (item.marker === "triangle-up" || item.marker === "triangle-down") {
      ctx.beginPath();
      if (item.marker === "triangle-up") {
        ctx.moveTo(cursor + 11, y - 6);
        ctx.lineTo(cursor + 4, y + 6);
        ctx.lineTo(cursor + 18, y + 6);
      } else {
        ctx.moveTo(cursor + 11, y + 6);
        ctx.lineTo(cursor + 4, y - 6);
        ctx.lineTo(cursor + 18, y - 6);
      }
      ctx.closePath();
      ctx.fill();
    } else if (item.dot) {
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

function drawTradePriceLabel(ctx, { x, y, side, price, qty, chartLeft, chartRight, mainTop, mainBottom } = {}) {
  const buy = side === "buy";
  const label = `${buy ? "买" : "卖"} ${fmt(price)} · ${fmt(qty, 0)}股`;
  ctx.save();
  ctx.font = "700 11px system-ui";
  ctx.textBaseline = "middle";
  const paddingX = 7;
  const width = Math.ceil(ctx.measureText(label).width + paddingX * 2);
  const height = 22;
  let left = buy ? x + 8 : x - width - 8;
  let top = buy ? y - height - 6 : y + 6;
  left = Math.max(chartLeft + 2, Math.min(chartRight - width - 2, left));
  top = Math.max(mainTop + 2, Math.min(mainBottom - height - 2, top));
  ctx.fillStyle = buy ? "rgba(255, 77, 87, 0.9)" : "rgba(0, 176, 112, 0.9)";
  ctx.strokeStyle = "rgba(7, 17, 26, 0.95)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  roundedRectPath(ctx, left, top, width, height, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.fillText(label, left + paddingX, top + height / 2);
  ctx.restore();
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
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

function updateStockChartTip(tip, pointer, candle, price, boll, sar, bullGate, macdPoint = null, trades = [], rect, offset = { x: 0, y: 0 }) {
  if (!tip || !candle) return;
  const width = trades.length ? 232 : 178;
  const height = trades.length ? 190 : 150;
  const left = pointer.x > rect.width * 0.62 ? pointer.x - width - 12 : pointer.x + 12;
  const top = pointer.y > rect.height * 0.52 ? pointer.y - height - 12 : pointer.y + 12;
  const tradeRows = trades.length
    ? `<div class="chart-tip-trades">${trades.slice(0, 4).map((trade) => `
        <span class="${trade.side === "buy" ? "buy" : "sell"}">
          <b>${trade.side === "buy" ? "买入" : "卖出"}</b>
          <em>${fmt(trade.price)}</em>
          <small>${fmt(trade.qty, 0)}股 · ${money(trade.amount)}</small>
        </span>
      `).join("")}</div>`
    : `<span>模拟交易 无</span>`;
  tip.style.left = `${offset.x + Math.max(8, Math.min(rect.width - width - 8, left))}px`;
  tip.style.top = `${offset.y + Math.max(8, Math.min(rect.height - height - 8, top))}px`;
  tip.innerHTML = `
    <b>${candle.day}</b>
    <span>X 日期：${candle.day}</span>
    <span>Y 价格：${fmt(price)}</span>
    <span>开 ${fmt(candle.open)} 高 ${fmt(candle.high)}</span>
    <span>低 ${fmt(candle.low)} 收 ${fmt(candle.close)}</span>
    <span>BOLL ${fmt(boll?.upper)} / ${fmt(boll?.mid)} / ${fmt(boll?.lower)}</span>
    <span>SAR ${fmt(sar)}</span>
    <span>牛门线 ${fmt(bullGate)}</span>
    <span>MACD ${fmt(macdPoint?.dif, 3)} / ${fmt(macdPoint?.dea, 3)} / ${fmt(macdPoint?.hist, 3)}</span>
    ${tradeRows}
  `;
  tip.classList.add("show");
}

function drawLine(ctx, values, color, y, left, step, options = {}) {
  if (!values.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = options.width || 1.7;
  if (options.dash) ctx.setLineDash(options.dash);
  ctx.beginPath();
  let started = false;
  values.forEach((value, i) => {
    if (!Number.isFinite(Number(value))) return;
    const x = left + i * step + step / 2;
    const yy = y(value);
    if (!started) {
      ctx.moveTo(x, yy);
      started = true;
    }
    else ctx.lineTo(x, yy);
  });
  ctx.stroke();
  ctx.restore();
}

function drawDoubleBullGateLine(ctx, values, y, left, step) {
  drawLine(ctx, values, "rgba(46, 230, 214, 0.58)", (value) => y(value) - 2.4, left, step, { dash: [6, 4], width: 1.8 });
  drawLine(ctx, values, "#2ee6d6", (value) => y(value) + 2.4, left, step, { width: 1.2 });
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

function render(scrollAnchor = captureScrollAnchors()) {
  if (!isAppAuthenticated()) {
    app.innerHTML = appLoginPage();
    focusAppPassword();
    return;
  }
  if (isAdvisorComposingActive()) {
    advisorDeferredRender = true;
    return;
  }
  if (isPortfolioTextComposingActive()) {
    portfolioTextDeferredRender = true;
    return;
  }
  const advisorFocus = skipAdvisorFocusRestoreOnce ? null : captureAdvisorFocus();
  const stockScroll = captureStockModalScroll();
  skipAdvisorFocusRestoreOnce = false;
  if (state.page === "radar" || state.page === "sector") state.page = "home";
  const pages = { home: homePage, recommend: recommendPage, portfolio: portfolioPage, tracking: trackingPage, virtual: virtualTradingPage, discussion: discussionPage, settings: settingsPage };
  suppressScrollTracking = true;
  app.innerHTML = shell(pages[state.page]());
  restoreScrollAnchors(scrollAnchor);
  syncActiveButtonLoading();
  setTimeout(() => {
    suppressScrollTracking = false;
  }, 140);
  restoreStockModalScroll(stockScroll);
  if (state.modalStock) scheduleStockChartDraw();
  if (activeFullscreenStockChart()) scheduleStockChartDraw();
  if (state.page === "tracking") scheduleTrackingChartsDraw();
  if (state.modalIndex) requestAnimationFrame(() => drawIndexChart(state.modalIndex));
  if (advisorFocus) restoreAdvisorFocus(advisorFocus);
  else focusAdvisorInput();
  if (state.page === "discussion") scrollChatToBottom({ repeat: true });
}

app.addEventListener("pointerdown", (event) => {
  if (!event.target.closest("[data-choice-option], [data-action='fill-advisor-choices'], [data-action='send-advisor-choices'], [data-action='toggle-advisor-thinking']")) return;
  event.preventDefault();
});

app.addEventListener("click", (event) => {
  if (event.target.closest(".sector-news a")) return;
  if (event.target.closest(".tracking-news a")) return;
  if (buttonActionLock && event.target.closest("button, [role='button'], [data-action]")) {
    event.preventDefault();
    showToast(`正在执行：${buttonActionName || "当前功能"}，请等待完成`);
    return;
  }
  if (event.target.closest("[data-action='clear-sector-search']")) {
    runButtonAction(event.target, "清空搜索", async () => {
      update({ sectorSearch: "", sectorSearchDraft: "", sectorPage: 1 });
      await loadSectorNewsForTop();
    });
    return;
  }
  if (event.target.closest("[data-action='clear-tracking-search']")) {
    runButtonAction(event.target, "清空追踪搜索", () => update({ trackingSearch: "", trackingPageNo: 1 }), { successToast: true });
    return;
  }
  if (event.target.closest("[data-action='submit-sector-search']")) {
    runButtonAction(event.target, "搜索", () => applySectorSearch(state.sectorSearchDraft), { successToast: true });
    return;
  }
  const suggestion = event.target.closest("[data-action='apply-search-suggestion']");
  if (suggestion) {
    runButtonAction(suggestion, "应用搜索建议", () => applySectorSearch(suggestion.dataset.searchValue || state.sectorSearchDraft), { successToast: true });
    return;
  }
  const copyTarget = event.target.closest("[data-action='copy-stock-name']");
  if (copyTarget) {
    runButtonAction(copyTarget, "复制股票名称", () => copyText(copyTarget.dataset.copyValue || state.modalStock?.name || "", "股票名称"));
    return;
  }
  if (event.target.closest("[data-action='join-stock-discussion']")) {
    runButtonAction(event.target, "加入讨论", () => joinStockDiscussion());
    return;
  }
  if (event.target.closest("[data-action='add-stock-tracking']")) {
    runButtonAction(event.target, "加入追踪", () => addModalStockToTracking());
    return;
  }
  if (event.target.closest("[data-action='add-virtual-trading']")) {
    runButtonAction(event.target, "加入虚拟交易", () => addModalStockToVirtualTrading());
    return;
  }
  if (event.target.closest("[data-action='close-fullscreen-stock-chart']")) {
    runButtonAction(event.target, "关闭全屏图表", () => {
      fullscreenStockChartPointer = null;
      fullscreenStockChartScrollAnchor = null;
      update({ fullscreenStockChart: false, fullscreenStockChartData: null });
    }, { successToast: true });
    return;
  }
  if (event.target.closest("[data-action='open-fullscreen-stock-chart']") && !event.target.closest("[data-chart-indicator]")) {
    runButtonAction(event.target, "打开全屏图表", () => {
      fullscreenStockChartPointer = null;
      fullscreenStockChartScrollAnchor = null;
      update({ fullscreenStockChart: true, fullscreenStockChartData: null });
    }, { successToast: true });
    return;
  }
  const virtualBacktestChart = event.target.closest("[data-action='open-virtual-backtest-chart']");
  if (virtualBacktestChart) {
    runButtonAction(virtualBacktestChart, "打开模拟交易图表", () => openVirtualBacktestFullscreenChart(virtualBacktestChart.dataset.stockCode));
    return;
  }
  const showVirtualStrategy = event.target.closest("[data-action='show-virtual-stock-strategy']");
  if (showVirtualStrategy) {
    const code = String(showVirtualStrategy.dataset.stockCode || "").trim();
    runButtonAction(showVirtualStrategy, "查看当前策略", () => update({ virtualStrategyPreviewCode: state.virtualStrategyPreviewCode === code ? "" : code }), { successToast: true });
    return;
  }
  const removeTracking = event.target.closest("[data-action='remove-tracking']");
  if (removeTracking) {
    runButtonAction(removeTracking, "取消追踪", () => removeTrackingStock(removeTracking.dataset.trackingCode));
    return;
  }
  const removeVirtual = event.target.closest("[data-action='remove-virtual-trading']");
  if (removeVirtual) {
    runButtonAction(removeVirtual, "移出虚拟交易", () => removeVirtualTradingStock(removeVirtual.dataset.virtualCode));
    return;
  }
  const page = event.target.closest("[data-page]")?.dataset.page;
  const sectorId = event.target.closest("[data-sector]")?.dataset.sector;
  const stockCode = event.target.closest("[data-stock]")?.dataset.stock;
  const indexSymbol = event.target.closest("[data-index]")?.dataset.index;
  const sectorSort = event.target.closest("[data-sector-sort]")?.dataset.sectorSort;
  const sectorPageAction = event.target.closest("[data-sector-page]")?.dataset.sectorPage;
  const trackingPageAction = event.target.closest("[data-tracking-page]")?.dataset.trackingPage;
  const virtualTab = event.target.closest("[data-virtual-tab]")?.dataset.virtualTab;
  const stockSort = event.target.closest("[data-stock-sort]")?.dataset.stockSort;
  if (page) {
    runButtonAction(event.target, "切换页面", async () => {
      update({ page });
      if (page === "recommend") await loadRecommendations();
      if (page === "tracking") await loadTracking();
      if (page === "virtual") await loadVirtualTrading();
      if (page === "portfolio") {
        await loadAdminStatus();
        await loadHoldings();
      }
      if (page === "settings") await loadSettings();
    });
    return;
  }
  if (sectorId) {
    runButtonAction(event.target, "打开板块Top10", async () => {
      update({ selectedSectorId: sectorId, modalSectorId: sectorId });
      await loadStocks(sectorId);
    });
    return;
  }
  if (indexSymbol) {
    runButtonAction(event.target, "打开指数趋势", () => openIndex(indexSymbol));
    return;
  }
  if (stockCode) {
    runButtonAction(event.target, "打开股票详情", () => openStock(stockCode));
    return;
  }
  if (sectorSort) {
    runButtonAction(event.target, "切换板块排序", async () => {
      update({ sectorSort, sectorPage: 1 });
      await loadSectorNewsForTop();
    });
    return;
  }
  if (sectorPageAction) {
    runButtonAction(event.target, "切换板块分页", async () => {
      const pageInfo = homeSectorPageInfo();
      const nextPage = sectorPageAction === "next" ? pageInfo.current + 1 : pageInfo.current - 1;
      update({ sectorPage: Math.min(pageInfo.pageCount, Math.max(1, nextPage)) });
      await loadSectorNewsForTop();
    });
    return;
  }
  if (trackingPageAction) {
    runButtonAction(event.target, "切换追踪分页", () => {
      const pageInfo = trackingPageInfo();
      const nextPage = trackingPageAction === "next" ? pageInfo.current + 1 : pageInfo.current - 1;
      update({ trackingPageNo: Math.min(pageInfo.pageCount, Math.max(1, nextPage)) });
    }, { successToast: true });
    return;
  }
  const stockTradePageButton = event.target.closest("[data-stock-trade-page]");
  if (stockTradePageButton) {
    runButtonAction(stockTradePageButton, "切换交易记录分页", () => {
      const code = String(stockTradePageButton.dataset.stockCode || "").trim();
      const action = stockTradePageButton.dataset.stockTradePage;
      const chart = (state.virtualTrading?.lastBacktest?.stockCharts || []).find((item) => String(item.stock?.code || "").trim() === code);
      const pageCount = Math.max(1, Math.ceil((chart?.trades?.length || 0) / 10));
      const current = Math.min(Math.max(1, Number(state.virtualBacktestTradePages?.[code]) || 1), pageCount);
      const nextPage = action === "next" ? current + 1 : current - 1;
      update({
        virtualBacktestTradePages: {
          ...(state.virtualBacktestTradePages || {}),
          [code]: Math.min(pageCount, Math.max(1, nextPage))
        }
      });
    }, { successToast: true });
    return;
  }
  if (virtualTab) {
    runButtonAction(event.target, "切换虚拟交易视图", () => update({ virtualTradingTab: virtualTab === "backtest" ? "backtest" : "live" }), { successToast: true });
    return;
  }
  if (stockSort) {
    runButtonAction(event.target, "切换股票排序", () => update({ modalStockSort: stockSort }), { successToast: true });
    return;
  }
  const chartIndicator = event.target.closest("[data-chart-indicator]")?.dataset.chartIndicator;
  if (chartIndicator) {
    event.preventDefault();
    runButtonAction(event.target, "切换图表指标", () => {
      const current = state.stockChartIndicators || {};
      state.stockChartIndicators = { ...current, [chartIndicator]: current[chartIndicator] === false };
      syncStockChartIndicatorControls();
      scheduleStockChartDraw();
    }, { successToast: true });
    return;
  }
  const closeTarget = event.target.closest("[data-close]");
  if (closeTarget) {
    runButtonAction(closeTarget, "关闭浮层", () => closeTopOverlay(), { successToast: true });
    return;
  }
  if (event.target.closest("[data-action='refresh']")) {
    runButtonAction(event.target, "刷新行情", async () => {
      state.recommendations = [];
      state.sectorStockIndexReady = false;
      state.sectorStockIndexLoading = false;
      await loadSectors({ silent: true, clearStockCache: true });
      if (state.page === "recommend") await loadRecommendations({ force: true });
      if (state.page === "tracking") await loadTracking({ force: true });
      if (state.page === "virtual") await loadVirtualTrading({ force: true });
    }, { successToast: true });
    return;
  }
  if (event.target.closest("[data-action='refresh-tracking']")) {
    runButtonAction(event.target, "立即采样", () => loadTracking({ force: true }));
    return;
  }
  if (event.target.closest("[data-action='init-virtual-trading']")) {
    runButtonAction(event.target, "开始模拟", () => initVirtualTrading());
    return;
  }
  if (event.target.closest("[data-action='reset-virtual-trading']")) {
    runButtonAction(event.target, "重新模拟", () => resetVirtualTrading());
    return;
  }
  if (event.target.closest("[data-action='run-virtual-backtest']")) {
    runButtonAction(event.target, "策略优化", () => runVirtualTradingBacktest());
    return;
  }
  if (event.target.closest("[data-action='adopt-virtual-optimization']")) {
    runButtonAction(event.target, "优化并执行", () => runVirtualTradingBacktest({ useOptimization: true }));
    return;
  }
  if (event.target.closest("[data-action='apply-virtual-stock-strategies']")) {
    runButtonAction(event.target, "保存策略", () => applyVirtualBacktestStrategies());
    return;
  }
  const saveStockStrategy = event.target.closest("[data-action='save-virtual-stock-strategy']");
  if (saveStockStrategy) {
    runButtonAction(saveStockStrategy, "保存单股策略", () => saveVirtualStockStrategy(saveStockStrategy.dataset.stockCode));
    return;
  }
  const optimizeStockStrategy = event.target.closest("[data-action='optimize-virtual-stock-strategy']");
  if (optimizeStockStrategy) {
    runButtonAction(optimizeStockStrategy, "优化单股策略", () => optimizeVirtualStockStrategy(optimizeStockStrategy.dataset.stockCode));
    return;
  }
  if (event.target.closest("[data-action='analyze-portfolio']")) {
    runButtonAction(event.target, "持股分析", () => analyzePortfolioText());
    return;
  }
  if (event.target.closest("[data-action='verify-app-access']")) {
    runButtonAction(event.target, "身份验证", () => verifyAppAccess());
    return;
  }
  if (event.target.closest("[data-action='open-portfolio-update']")) {
    runButtonAction(event.target, "打开更新持股", () => update({ modalPortfolioUpdate: true, ocrProgress: "" }), { successToast: true });
    return;
  }
  if (event.target.closest("[data-action='reload-portfolio']")) {
    runButtonAction(event.target, "刷新持股建议", () => loadHoldings());
    return;
  }
  if (event.target.closest("[data-action='clear-portfolio']")) {
    runButtonAction(event.target, "清空持股", () => clearHoldings());
    return;
  }
  if (event.target.closest("[data-action='save-settings']")) {
    runButtonAction(event.target, "保存并应用", () => saveSettings());
    return;
  }
  if (event.target.closest("[data-action='send-advisor-message']")) {
    sendAdvisorMessage();
    return;
  }
  if (event.target.closest("[data-action='clear-advisor-chat']")) {
    runButtonAction(event.target, "清空对话", () => clearAdvisorChat(), { successToast: true });
    return;
  }
  if (event.target.closest("[data-action='toggle-advisor-thinking']")) {
    runButtonAction(event.target, state.advisorDeepThinking ? "关闭深度思考" : "开启深度思考", () => setAdvisorDeepThinking(!state.advisorDeepThinking), { successToast: true });
    return;
  }
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
    runButtonAction(fillChoices, "填入选择", () => {
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
    }, { successToast: true });
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
    showToast("发送选择执行中...");
    sendAdvisorMessage(text);
    return;
  }
  const win = event.target.closest("[data-window]")?.dataset.window;
  if (win) {
    runButtonAction(event.target, "切换周期", async () => {
      state.window = Number(win);
      state.sectorPage = 1;
      state.recommendations = [];
      state.sectorStockIndexReady = false;
      state.sectorStockIndexLoading = false;
      await loadSectors({ silent: true, clearStockCache: true });
      if (state.page === "recommend") await loadRecommendations({ force: true });
    });
    return;
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
    const draft = { ...(state.settingsDraft || {}), [key]: value };
    let shouldRenderSettings = false;
    if (key === "aiProvider") {
      const providerInfo = draft.aiProviders?.[value] || state.settings?.aiProviders?.[value] || {};
      draft.apiUrl = providerInfo.apiUrl || draft.apiUrl || "";
      draft.ocrApiUrl = providerInfo.ocrApiUrl || "";
      draft.textModel = providerInfo.textModel || draft.textModel || "";
      draft.visionModel = providerInfo.visionModel || "";
      draft.advisorModel = providerInfo.advisorModel || draft.advisorModel || "";
      draft.apiKey = "";
      shouldRenderSettings = true;
    }
    state.settingsDraft = draft;
    if (shouldRenderSettings) render();
  }
});

app.addEventListener("input", (event) => {
  if (event.target.matches("[data-app-password]")) {
    state.appPasswordInput = event.target.value;
    state.appAuthError = "";
  }
  if (event.target.matches("[data-portfolio-text]")) {
    state.portfolioText = event.target.value;
    if (event.isComposing || state.portfolioTextComposing) return;
  }
  if (event.target.matches("[data-sector-search]")) {
    state.sectorSearchDraft = event.target.value;
    updateSectorSearchDraftStatus(event.target.value);
    renderSectorSearchSuggestions(event.target.value);
  }
  if (event.target.matches("[data-tracking-search]")) {
    const value = event.target.value;
    state.trackingSearch = value;
    if (event.isComposing || state.trackingSearchComposing) return;
    const cursor = event.target.selectionStart ?? value.length;
    state.trackingPageNo = 1;
    render();
    requestAnimationFrame(() => {
      const input = document.querySelector("[data-tracking-search]");
      if (!input) return;
      input.focus();
      input.setSelectionRange(cursor, cursor);
    });
  }
  if (event.target.matches("[data-virtual-capital]")) {
    state.virtualTradingInitAmount = event.target.value;
    state.virtualTradingError = "";
  }
  if (event.target.matches("[data-virtual-backtest-start]")) {
    state.virtualBacktestStart = event.target.value;
    state.virtualTradingError = "";
  }
  if (event.target.matches("[data-virtual-backtest-end]")) {
    state.virtualBacktestEnd = event.target.value;
    state.virtualTradingError = "";
  }
  if (event.target.matches("[data-virtual-stock-strategy]")) {
    const code = String(event.target.dataset.stockCode || "").trim();
    const key = event.target.dataset.virtualStockStrategy;
    if (code && key) {
      state.virtualStockStrategyDrafts = {
        ...(state.virtualStockStrategyDrafts || {}),
        [code]: {
          ...(state.virtualStockStrategyDrafts?.[code] || {}),
          [key]: event.target.value
        }
      };
      state.virtualTradingError = "";
    }
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
  if (event.target.matches("[data-portfolio-text]")) {
    state.portfolioTextComposing = true;
  }
  if (event.target.matches("[data-tracking-search]")) {
    state.trackingSearchComposing = true;
  }
});

app.addEventListener("compositionend", (event) => {
  if (event.target.matches("[data-advisor-input]")) {
    state.advisorComposing = false;
    state.advisorInput = event.target.value;
    if (advisorDeferredRender) {
      advisorDeferredRender = false;
      render();
      focusAdvisorInput();
    }
  }
  if (event.target.matches("[data-portfolio-text]")) {
    const value = event.target.value;
    const start = event.target.selectionStart ?? value.length;
    const end = event.target.selectionEnd ?? start;
    state.portfolioTextComposing = false;
    state.portfolioText = value;
    if (portfolioTextDeferredRender) {
      portfolioTextDeferredRender = false;
      render();
      focusPortfolioText({ value, start, end });
    }
  }
  if (event.target.matches("[data-tracking-search]")) {
    const value = event.target.value;
    const cursor = event.target.selectionStart ?? value.length;
    state.trackingSearchComposing = false;
    state.trackingSearch = value;
    state.trackingPageNo = 1;
    render();
    requestAnimationFrame(() => {
      const input = document.querySelector("[data-tracking-search]");
      if (!input) return;
      input.focus();
      input.setSelectionRange(cursor, cursor);
    });
  }
});

app.addEventListener("keydown", (event) => {
  if (event.target.matches("[data-app-password]") && event.key === "Enter") {
    event.preventDefault();
    verifyAppAccess();
  }
});

app.addEventListener("keydown", (event) => {
  if (event.target.matches("[data-sector-search]") && event.key === "Enter") {
    event.preventDefault();
    applySectorSearch(event.target.value);
  }
  if (event.target.matches("[data-tracking-search]") && event.key === "Enter") {
    if (event.isComposing || state.trackingSearchComposing) return;
    event.preventDefault();
  }
  if (event.target.matches("[data-virtual-capital]") && event.key === "Enter") {
    event.preventDefault();
    initVirtualTrading();
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
  const fullscreenCanvas = event.target.closest("#stockChartFullscreen");
  if (fullscreenCanvas && activeFullscreenStockChart()) {
    const rect = fullscreenCanvas.getBoundingClientRect();
    fullscreenStockChartPointer = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    scheduleStockChartDraw();
    return;
  }
  const trackingCanvas = event.target.closest("[data-tracking-chart]");
  if (trackingCanvas) {
    const code = trackingCanvas.dataset.trackingChart;
    const rect = trackingCanvas.getBoundingClientRect();
    trackingChartPointers.set(code, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    });
    scheduleTrackingChartsDraw();
    return;
  }
  const canvas = event.target.closest("#stockChart");
  if (canvas && state.modalStock) {
    const rect = canvas.getBoundingClientRect();
    stockChartPointer = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    scheduleStockChartDraw();
  }
});

app.addEventListener("pointerleave", (event) => {
  const trackingCanvas = event.target.closest("[data-tracking-chart]");
  if (trackingCanvas) {
    trackingChartPointers.delete(trackingCanvas.dataset.trackingChart);
    scheduleTrackingChartsDraw();
    return;
  }
  if (event.target.closest("#stockChart") && state.modalStock) {
    stockChartPointer = null;
    scheduleStockChartDraw();
  }
  if (event.target.closest("#stockChartFullscreen") && activeFullscreenStockChart()) {
    fullscreenStockChartPointer = null;
    scheduleStockChartDraw();
  }
}, true);

window.addEventListener("resize", () => {
  if (state.modalStock) scheduleStockChartDraw();
  if (state.page === "tracking") scheduleTrackingChartsDraw();
  if (state.modalIndex) drawIndexChart(state.modalIndex);
});

window.addEventListener("scroll", () => {
  if (suppressScrollTracking) return;
  scrollGeneration += 1;
  rememberPageScroll();
}, { passive: true });

app.addEventListener("scroll", (event) => {
  if (event.target?.id === "stockFullscreenChartScroll") {
    fullscreenStockChartScrollAnchor = captureFullscreenChartScroll();
  }
}, true);

render();
startAppDataOnce();
setInterval(() => requestAutoRefresh("home"), homeRefreshMs);
setInterval(() => requestAutoRefresh("recommend"), recommendRefreshMs);
setInterval(() => {
  if (isAppAuthenticated() && state.page === "tracking") loadTracking({ force: true, silent: true });
}, recommendRefreshMs);
setInterval(() => {
  if (isAppAuthenticated() && state.page === "virtual") loadVirtualTrading({ force: true, silent: true });
}, 10 * 60_000);
