const { VIRTUAL_TRADING_FILE } = require("../config");
const { readJsonFile, writeJsonFile } = require("./jsonStore");

const MAX_VIRTUAL_TRADES = 800;
const MAX_EQUITY_POINTS = 600;

function cleanCode(value = "") {
  return String(value || "").match(/([03648]\d{5}|9\d{5})/)?.[1] || "";
}

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function defaultVirtualStrategy() {
  return {
    version: 2,
    buyThreshold: 66,
    sellThreshold: 45,
    maxSinglePositionPct: 0.22,
    minCashPct: 0.08,
    learningRate: 0.08,
    macdWeight: 1.18,
    sarWeight: 1.12,
    bollWeight: 1.04,
    bullGateWeight: 1.22,
    volumeWeight: 1.08,
    strongBuyBonus: 9,
    riskExitPenalty: 12,
    takeProfitPct: 12,
    stopLossPct: -7,
    updatedAt: "",
    note: "初始策略：MACD动能、SAR趋势、BOLL位置、牛门线突破与量能共振时分批建仓，破位或动能衰减时快速减仓。"
  };
}

function emptyVirtualTradingStore() {
  return {
    account: null,
    watchlist: [],
    positions: [],
    trades: [],
    equityCurve: [],
    lastBacktest: null,
    stockStrategies: [],
    strategy: defaultVirtualStrategy(),
    updatedAt: ""
  };
}

function normalizeAccount(account = null) {
  if (!account) return null;
  const initialCapital = Math.max(0, finiteNumber(account.initialCapital));
  const cash = Math.max(0, finiteNumber(account.cash, initialCapital));
  return {
    initialCapital,
    cash,
    enabled: account.enabled !== false,
    createdAt: account.createdAt || new Date().toISOString(),
    updatedAt: account.updatedAt || ""
  };
}

function normalizeVirtualStock(item = {}) {
  const code = cleanCode(item.code);
  const market = finiteNumber(item.market, NaN);
  if (!code) return null;
  return {
    code,
    name: String(item.name || item.stockName || item.title || code).trim(),
    market: Number.isFinite(market) ? market : null,
    addedAt: item.addedAt || new Date().toISOString(),
    lastPrice: finiteNumber(item.lastPrice, 0),
    lastPct: Number.isFinite(Number(item.lastPct)) ? Number(item.lastPct) : null,
    lastUpdatedAt: item.lastUpdatedAt || "",
    lastSignal: item.lastSignal || null
  };
}

function normalizePosition(item = {}) {
  const code = cleanCode(item.code);
  const qty = Math.max(0, Math.floor(finiteNumber(item.qty)));
  if (!code || qty <= 0) return null;
  const avgCost = Math.max(0, finiteNumber(item.avgCost));
  const lastPrice = Math.max(0, finiteNumber(item.lastPrice, avgCost));
  const marketValue = qty * lastPrice;
  const cost = qty * avgCost;
  const pnl = marketValue - cost;
  const availableQty = Math.max(0, Math.min(qty, Math.floor(finiteNumber(item.availableQty, qty))));
  return {
    code,
    name: String(item.name || code).trim(),
    market: Number.isFinite(Number(item.market)) ? Number(item.market) : null,
    qty,
    availableQty,
    avgCost,
    cost,
    lastPrice,
    marketValue,
    pnl,
    pnlPct: cost ? (pnl / cost) * 100 : 0,
    openedAt: item.openedAt || new Date().toISOString(),
    updatedAt: item.updatedAt || "",
    lastBuyDate: String(item.lastBuyDate || "").trim(),
    lastSellDate: String(item.lastSellDate || "").trim()
  };
}

function normalizeTrade(item = {}) {
  const code = cleanCode(item.code);
  const qty = Math.max(0, Math.floor(finiteNumber(item.qty)));
  const price = Math.max(0, finiteNumber(item.price));
  if (!code || qty <= 0 || price <= 0) return null;
  return {
    id: item.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    time: item.time || new Date().toISOString(),
    side: item.side === "sell" ? "sell" : "buy",
    code,
    name: String(item.name || code).trim(),
    qty,
    price,
    amount: finiteNumber(item.amount, qty * price),
    realizedPnl: Number.isFinite(Number(item.realizedPnl)) ? Number(item.realizedPnl) : null,
    realizedPnlPct: Number.isFinite(Number(item.realizedPnlPct)) ? Number(item.realizedPnlPct) : null,
    score: Number.isFinite(Number(item.score)) ? Number(item.score) : null,
    reason: String(item.reason || "").trim(),
    signal: item.signal || null
  };
}

function normalizeEquityPoint(item = {}) {
  const equity = finiteNumber(item.equity, NaN);
  if (!Number.isFinite(equity)) return null;
  return {
    time: item.time || new Date().toISOString(),
    equity,
    cash: finiteNumber(item.cash),
    positionValue: finiteNumber(item.positionValue),
    pnl: finiteNumber(item.pnl),
    pnlPct: finiteNumber(item.pnlPct)
  };
}

function normalizeBacktestResult(item = null) {
  if (!item) return null;
  return {
    id: String(item.id || `backtest_${Date.now()}`),
    startDate: String(item.startDate || ""),
    endDate: String(item.endDate || ""),
    createdAt: item.createdAt || new Date().toISOString(),
    initialCapital: finiteNumber(item.initialCapital),
    finalEquity: finiteNumber(item.finalEquity),
    pnl: finiteNumber(item.pnl),
    pnlPct: finiteNumber(item.pnlPct),
    positionValue: finiteNumber(item.positionValue),
    cash: finiteNumber(item.cash),
    stats: item.stats || {},
    startingStrategy: normalizeStrategy(item.startingStrategy || item.strategy || {}),
    strategy: normalizeStrategy(item.strategy || {}),
    optimizationAdvice: normalizeBacktestOptimizationAdvice(item.optimizationAdvice),
    optimizationApplied: Boolean(item.optimizationApplied),
    portfolioStrategyAdvice: normalizePortfolioStrategyAdvice(item.portfolioStrategyAdvice),
    watchlist: Array.isArray(item.watchlist) ? item.watchlist.map(normalizeVirtualStock).filter(Boolean) : [],
    positions: Array.isArray(item.positions) ? item.positions.map(normalizePosition).filter(Boolean) : [],
    trades: Array.isArray(item.trades) ? item.trades.map(normalizeTrade).filter(Boolean).slice(-MAX_VIRTUAL_TRADES) : [],
    equityCurve: Array.isArray(item.equityCurve) ? item.equityCurve.map(normalizeEquityPoint).filter(Boolean).slice(-MAX_EQUITY_POINTS) : [],
    stockCharts: Array.isArray(item.stockCharts) ? item.stockCharts.map(normalizeBacktestStockChart).filter(Boolean) : [],
    stockStrategyAdvice: Array.isArray(item.stockStrategyAdvice) ? item.stockStrategyAdvice.map(normalizeStockStrategyAdvice).filter(Boolean) : [],
    notes: Array.isArray(item.notes) ? item.notes.map((note) => String(note || "").trim()).filter(Boolean).slice(0, 8) : []
  };
}

function normalizePortfolioStrategyAdvice(item = null) {
  if (!item) return null;
  return {
    title: String(item.title || "按单股策略组合回放").trim(),
    summary: String(item.summary || "").trim(),
    pnl: finiteNumber(item.pnl),
    pnlPct: finiteNumber(item.pnlPct),
    maxDrawdownPct: finiteNumber(item.maxDrawdownPct),
    winRate: finiteNumber(item.winRate),
    closedTrades: finiteNumber(item.closedTrades),
    tradeCount: finiteNumber(item.tradeCount),
    reasons: Array.isArray(item.reasons) ? item.reasons.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 8) : []
  };
}

function normalizeBacktestOptimizationAdvice(item = null) {
  if (!item) return null;
  return {
    summary: String(item.summary || "").trim(),
    changes: Array.isArray(item.changes) ? item.changes.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 8) : [],
    proposedStrategy: normalizeStrategy(item.proposedStrategy || {}),
    basis: item.basis || {}
  };
}

function normalizeBacktestStockChart(item = {}) {
  const stock = normalizeVirtualStock(item.stock || item);
  if (!stock?.code) return null;
  const rows = Array.isArray(item.rows) ? item.rows.map(normalizeTrackingLikeKline).filter(Boolean).slice(-900) : [];
  const trades = Array.isArray(item.trades) ? item.trades.map(normalizeTrade).filter(Boolean).slice(-200) : [];
  const contribution = item.contribution || {};
  return {
    stock,
    rows,
    trades,
    contribution: {
      amount: finiteNumber(contribution.amount),
      pct: finiteNumber(contribution.pct),
      realizedPnl: finiteNumber(contribution.realizedPnl),
      openPnl: finiteNumber(contribution.openPnl)
    }
  };
}

function normalizeStockStrategyAdvice(item = {}) {
  const code = cleanCode(item.code || item.stock?.code);
  if (!code) return null;
  return {
    code,
    name: String(item.name || item.stock?.name || code).trim(),
    strategy: normalizeStrategy(item.strategy || item.proposedStrategy || {}),
    source: String(item.source || "backtest").trim(),
    summary: String(item.summary || "").trim(),
    basis: item.basis || {},
    updatedAt: item.updatedAt || new Date().toISOString()
  };
}

function normalizeSavedStockStrategy(item = {}) {
  const normalized = normalizeStockStrategyAdvice(item);
  if (!normalized) return null;
  return {
    ...normalized,
    appliedAt: item.appliedAt || item.updatedAt || new Date().toISOString()
  };
}

function normalizeTrackingLikeKline(row = {}) {
  const close = finiteNumber(row.close, NaN);
  if (!Number.isFinite(close)) return null;
  return {
    day: String(row.day || row.date || row.time || "").trim(),
    open: finiteNumber(row.open, close),
    close,
    high: finiteNumber(row.high, close),
    low: finiteNumber(row.low, close),
    volume: finiteNumber(row.volume)
  };
}

function normalizeStrategy(strategy = {}) {
  const base = defaultVirtualStrategy();
  return {
    ...base,
    ...strategy,
    buyThreshold: Math.max(58, Math.min(82, finiteNumber(strategy.buyThreshold, base.buyThreshold))),
    sellThreshold: Math.max(32, Math.min(55, finiteNumber(strategy.sellThreshold, base.sellThreshold))),
    maxSinglePositionPct: Math.max(0.08, Math.min(0.35, finiteNumber(strategy.maxSinglePositionPct, base.maxSinglePositionPct))),
    minCashPct: Math.max(0.02, Math.min(0.25, finiteNumber(strategy.minCashPct, base.minCashPct))),
    learningRate: Math.max(0.02, Math.min(0.18, finiteNumber(strategy.learningRate, base.learningRate))),
    macdWeight: Math.max(0.5, Math.min(1.8, finiteNumber(strategy.macdWeight, base.macdWeight))),
    sarWeight: Math.max(0.5, Math.min(1.8, finiteNumber(strategy.sarWeight, base.sarWeight))),
    bollWeight: Math.max(0.5, Math.min(1.8, finiteNumber(strategy.bollWeight, base.bollWeight))),
    bullGateWeight: Math.max(0.5, Math.min(1.9, finiteNumber(strategy.bullGateWeight, base.bullGateWeight))),
    volumeWeight: Math.max(0.5, Math.min(1.8, finiteNumber(strategy.volumeWeight, base.volumeWeight))),
    strongBuyBonus: Math.max(4, Math.min(16, finiteNumber(strategy.strongBuyBonus, base.strongBuyBonus))),
    riskExitPenalty: Math.max(6, Math.min(20, finiteNumber(strategy.riskExitPenalty, base.riskExitPenalty))),
    takeProfitPct: Math.max(5, Math.min(28, finiteNumber(strategy.takeProfitPct, base.takeProfitPct))),
    stopLossPct: Math.max(-18, Math.min(-3, finiteNumber(strategy.stopLossPct, base.stopLossPct)))
  };
}

function normalizeVirtualTradingStore(store = {}) {
  return {
    account: normalizeAccount(store.account),
    watchlist: Array.isArray(store.watchlist) ? store.watchlist.map(normalizeVirtualStock).filter(Boolean) : [],
    positions: Array.isArray(store.positions) ? store.positions.map(normalizePosition).filter(Boolean) : [],
    trades: Array.isArray(store.trades) ? store.trades.map(normalizeTrade).filter(Boolean).slice(-MAX_VIRTUAL_TRADES) : [],
    equityCurve: Array.isArray(store.equityCurve) ? store.equityCurve.map(normalizeEquityPoint).filter(Boolean).slice(-MAX_EQUITY_POINTS) : [],
    lastBacktest: normalizeBacktestResult(store.lastBacktest),
    stockStrategies: Array.isArray(store.stockStrategies) ? store.stockStrategies.map(normalizeSavedStockStrategy).filter(Boolean) : [],
    strategy: normalizeStrategy(store.strategy),
    updatedAt: store.updatedAt || ""
  };
}

function readVirtualTradingStore() {
  return normalizeVirtualTradingStore(readJsonFile(VIRTUAL_TRADING_FILE, emptyVirtualTradingStore()));
}

function writeVirtualTradingStore(store = {}) {
  const normalized = normalizeVirtualTradingStore({
    ...store,
    updatedAt: new Date().toISOString()
  });
  writeJsonFile(VIRTUAL_TRADING_FILE, normalized);
  return normalized;
}

function saveVirtualStockStrategies(strategies = [], { source = "backtest" } = {}) {
  const current = readVirtualTradingStore();
  const now = new Date().toISOString();
  const byCode = new Map(current.stockStrategies.map((item) => [item.code, item]));
  const saved = (Array.isArray(strategies) ? strategies : [])
    .map((item) => normalizeSavedStockStrategy({ ...item, source, appliedAt: now, updatedAt: now }))
    .filter(Boolean);
  for (const item of saved) byCode.set(item.code, item);
  const store = writeVirtualTradingStore({
    ...current,
    stockStrategies: [...byCode.values()]
  });
  return { store, saved };
}

function initVirtualTradingAccount(initialCapital) {
  const capital = Math.max(0, finiteNumber(initialCapital));
  if (capital <= 0) throw new Error("请输入有效的虚拟满仓金额");
  const current = readVirtualTradingStore();
  const now = new Date().toISOString();
  return writeVirtualTradingStore({
    ...current,
    account: {
      initialCapital: capital,
      cash: capital,
      enabled: true,
      createdAt: current.account?.createdAt || now,
      updatedAt: now
    }
  });
}

function addVirtualTradingStock(stock = {}) {
  const next = normalizeVirtualStock(stock);
  if (!next?.code) throw new Error("缺少股票代码");
  const current = readVirtualTradingStore();
  const existing = current.watchlist.find((item) => item.code === next.code);
  if (existing) {
    Object.assign(existing, {
      name: next.name || existing.name,
      market: next.market ?? existing.market
    });
    return writeVirtualTradingStore(current);
  }
  return writeVirtualTradingStore({
    ...current,
    watchlist: [{ ...next, addedAt: new Date().toISOString() }, ...current.watchlist]
  });
}

function removeVirtualTradingStock(code = "") {
  const clean = cleanCode(code);
  const current = readVirtualTradingStore();
  return writeVirtualTradingStore({
    ...current,
    watchlist: current.watchlist.filter((item) => item.code !== clean)
  });
}

function setVirtualTradingEnabled(enabled) {
  const current = readVirtualTradingStore();
  if (!current.account) throw new Error("请先设置虚拟满仓金额");
  return writeVirtualTradingStore({
    ...current,
    account: {
      ...current.account,
      enabled: Boolean(enabled),
      updatedAt: new Date().toISOString()
    }
  });
}

function resetVirtualTradingAccount(initialCapitalOverride = null) {
  const current = readVirtualTradingStore();
  if (!current.account) throw new Error("请先设置虚拟满仓金额");
  const now = new Date().toISOString();
  const nextCapital = Number.isFinite(Number(initialCapitalOverride)) && Number(initialCapitalOverride) > 0
    ? finiteNumber(initialCapitalOverride)
    : finiteNumber(current.account.initialCapital);
  const { stats: _oldStats, ...strategyWithoutStats } = current.strategy || {};
  return writeVirtualTradingStore({
    ...current,
    account: {
      ...current.account,
      initialCapital: nextCapital,
      cash: nextCapital,
      enabled: true,
      updatedAt: now
    },
    watchlist: current.watchlist.map((stock) => ({ ...stock, lastSignal: null })),
    positions: [],
    trades: [],
    equityCurve: [],
    strategy: {
      ...strategyWithoutStats,
      updatedAt: now,
      note: "已重新模拟，成交统计已清空；策略参数保持不变，等待新一轮盘中模拟反馈。"
    },
    updatedAt: now
  });
}

module.exports = {
  MAX_EQUITY_POINTS,
  MAX_VIRTUAL_TRADES,
  addVirtualTradingStock,
  cleanCode,
  defaultVirtualStrategy,
  emptyVirtualTradingStore,
  initVirtualTradingAccount,
  normalizeVirtualTradingStore,
  readVirtualTradingStore,
  removeVirtualTradingStock,
  resetVirtualTradingAccount,
  saveVirtualStockStrategies,
  setVirtualTradingEnabled,
  writeVirtualTradingStore
};
