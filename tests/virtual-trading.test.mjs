import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);

function loadVirtualStoreWithDataDir(dataDir) {
  process.env.GUANLAN_DATA_DIR = dataDir;
  for (const id of [
    "../src/server/config.js",
    "../src/server/storage/jsonStore.js",
    "../src/server/storage/virtualTradingStore.js"
  ]) {
    delete require.cache[require.resolve(id)];
  }
  return require("../src/server/storage/virtualTradingStore.js");
}

function bullishCandles(length = 48) {
  return Array.from({ length }, (_, index) => {
    const close = 10 + index * 0.18;
    return {
      day: `2026-06-${String(index + 1).padStart(2, "0")}`,
      open: close - 0.08,
      close,
      high: close + 0.22,
      low: close - 0.25,
      volume: 1000 + index * 35
    };
  });
}

function bearishCandles(length = 48) {
  return Array.from({ length }, (_, index) => {
    const close = 24 - index * 0.22;
    return {
      day: `2026-07-${String(index + 1).padStart(2, "0")}`,
      open: close + 0.12,
      close,
      high: close + 0.22,
      low: close - 0.3,
      volume: 3000 + index * 80
    };
  });
}

describe("virtual trading store", () => {
  it("initializes account, adds stocks, toggles enabled, and removes stocks", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "guanlan-virtual-"));
    try {
      const store = loadVirtualStoreWithDataDir(dataDir);
      assert.equal(store.readVirtualTradingStore().account, null);
      assert.throws(() => store.initVirtualTradingAccount(0), /虚拟满仓金额/);

      store.initVirtualTradingAccount(200000);
      let current = store.readVirtualTradingStore();
      assert.equal(current.account.initialCapital, 200000);
      assert.equal(current.account.cash, 200000);
      assert.equal(current.account.enabled, true);
      assert.equal(current.strategy.version, 2);
      assert.equal(Number.isFinite(Number(current.strategy.macdWeight)), true);
      assert.equal(Number.isFinite(Number(current.strategy.sarWeight)), true);
      assert.equal(Number.isFinite(Number(current.strategy.bollWeight)), true);
      assert.equal(Number.isFinite(Number(current.strategy.bullGateWeight)), true);
      assert.deepEqual(current.stockStrategies, []);

      store.addVirtualTradingStock({ code: "sh600000", name: "浦发银行", market: 1 });
      store.addVirtualTradingStock({ code: "600000", name: "浦发银行A", market: 1 });
      current = store.readVirtualTradingStore();
      assert.equal(current.watchlist.length, 1);
      assert.equal(current.watchlist[0].code, "600000");
      assert.equal(current.watchlist[0].name, "浦发银行A");

      const saved = store.saveVirtualStockStrategies([{ code: "600000", name: "浦发银行", strategy: { macdWeight: 1.42 }, summary: "测试策略" }]);
      assert.equal(saved.saved.length, 1);
      current = store.readVirtualTradingStore();
      assert.equal(current.stockStrategies.length, 1);
      assert.equal(current.stockStrategies[0].code, "600000");
      assert.equal(current.stockStrategies[0].strategy.macdWeight, 1.42);

      store.writeVirtualTradingStore({
        ...current,
        account: { ...current.account, cash: 168000, enabled: false },
        positions: [{ code: "600000", name: "浦发银行", qty: 1000, avgCost: 10, lastPrice: 11 }],
        trades: [{ code: "600000", name: "浦发银行", side: "buy", qty: 1000, price: 10, amount: 10000 }],
        equityCurve: [{ time: "2026-06-19T10:00:00.000+08:00", equity: 179000, cash: 168000, positionValue: 11000, pnl: -21000, pnlPct: -10.5 }],
        strategy: { ...current.strategy, stats: { winRate: 12, maxDrawdownPct: -8 } }
      });
      const reset = store.resetVirtualTradingAccount(300000);
      assert.equal(reset.account.initialCapital, 300000);
      assert.equal(reset.account.cash, 300000);
      assert.equal(reset.account.enabled, true);
      assert.equal(reset.positions.length, 0);
      assert.equal(reset.trades.length, 0);
      assert.equal(reset.equityCurve.length, 0);
      assert.equal(reset.watchlist.length, 1);
      assert.equal(reset.stockStrategies.length, 1);
      assert.equal(reset.strategy.stats, undefined);
      assert.match(reset.strategy.note, /重新模拟/);

      store.setVirtualTradingEnabled(false);
      assert.equal(store.readVirtualTradingStore().account.enabled, false);
      store.removeVirtualTradingStock("600000");
      assert.equal(store.readVirtualTradingStore().watchlist.length, 0);
    } finally {
      delete process.env.GUANLAN_DATA_DIR;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("virtual trading service", () => {
  it("enriches legacy virtual stocks with latest backtest chart rows for pool charts", () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "guanlan-virtual-chart-"));
    try {
      const store = loadVirtualStoreWithDataDir(dataDir);
      const serviceModule = require("../src/server/virtualTrading/virtualTradingService.js");
      const candles = bullishCandles();
      store.writeVirtualTradingStore({
        ...store.readVirtualTradingStore(),
        account: { initialCapital: 100000, cash: 100000, enabled: true },
        watchlist: [{ code: "600000", name: "浦发银行", market: 1, klines: [] }],
        lastBacktest: {
          id: "legacy_chart",
          startDate: "2026-06-01",
          endDate: "2026-06-30",
          initialCapital: 100000,
          finalEquity: 100000,
          stockCharts: [{
            stock: { code: "600000", name: "浦发银行", market: 1 },
            rows: candles,
            trades: []
          }]
        }
      });
      const service = serviceModule.createVirtualTradingService({
        readVirtualTradingStore: store.readVirtualTradingStore,
        writeVirtualTradingStore: store.writeVirtualTradingStore,
        saveVirtualStockStrategies: store.saveVirtualStockStrategies,
        addVirtualTradingStock: store.addVirtualTradingStock,
        removeVirtualTradingStock: store.removeVirtualTradingStock,
        initVirtualTradingAccount: store.initVirtualTradingAccount,
        setVirtualTradingEnabled: store.setVirtualTradingEnabled,
        marketOf: () => 1
      });
      const snapshot = service.snapshot();
      assert.equal(snapshot.watchlist.length, 1);
      assert.ok(snapshot.watchlist[0].klines.length > 1);
      assert.equal(snapshot.watchlist[0].klines.at(-1).day, candles.at(-1).day);
    } finally {
      delete process.env.GUANLAN_DATA_DIR;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("applies A-share trading rules for T+1, board lots, and price limits", () => {
    const serviceModule = require("../src/server/virtualTrading/virtualTradingService.js");
    const strategy = {
      maxSinglePositionPct: 0.3,
      minCashPct: 0.02
    };
    const account = { initialCapital: 100000, cash: 100000, enabled: true };
    const stock = { code: "600000", name: "浦发银行", market: 1 };
    const buySignal = {
      action: "buy",
      intensity: "strong",
      price: 10,
      score: 90,
      changePct: 10,
      orderPlan: { budgetScale: 1 },
      reasons: ["涨停附近不追买"]
    };
    const limitUpBuy = serviceModule.executeVirtualTrade({
      signal: buySignal,
      quote: { pct: 9.9 },
      stock,
      position: null,
      positions: [],
      account,
      cash: 100000,
      strategy,
      now: "2026-06-19T10:00:00.000+08:00"
    });
    assert.equal(limitUpBuy.trade, null);

    const positions = [{
      code: "600000",
      name: "浦发银行",
      market: 1,
      qty: 1000,
      availableQty: 0,
      avgCost: 10,
      lastPrice: 9.5,
      marketValue: 9500,
      pnl: -500,
      pnlPct: -5,
      lastBuyDate: "2026-06-19"
    }];
    const sellSignal = {
      action: "sell",
      intensity: "exit",
      price: 9.5,
      score: 20,
      changePct: -4,
      orderPlan: { sellScale: 1 },
      reasons: ["T+1 当日不可卖"]
    };
    const sameDaySell = serviceModule.executeVirtualTrade({
      signal: sellSignal,
      quote: { pct: -4 },
      stock,
      position: positions[0],
      positions,
      account,
      cash: 50000,
      strategy,
      now: "2026-06-19T10:10:00.000+08:00"
    });
    assert.equal(sameDaySell.trade, null);
    assert.equal(positions[0].qty, 1000);

    positions[0].availableQty = 1000;
    const limitDownSell = serviceModule.executeVirtualTrade({
      signal: { ...sellSignal, changePct: -10 },
      quote: { pct: -9.9 },
      stock,
      position: positions[0],
      positions,
      account,
      cash: 50000,
      strategy,
      now: "2026-06-20T10:10:00.000+08:00"
    });
    assert.equal(limitDownSell.trade, null);

    const normalSell = serviceModule.executeVirtualTrade({
      signal: sellSignal,
      quote: { pct: -3 },
      stock,
      position: positions[0],
      positions,
      account,
      cash: 50000,
      strategy,
      now: "2026-06-20T10:20:00.000+08:00"
    });
    assert.equal(normalSell.trade.side, "sell");
    assert.equal(normalSell.trade.qty % 100, 0);
  });

  it("builds bullish signals and executes a simulated buy cycle", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "guanlan-virtual-service-"));
    try {
      const store = loadVirtualStoreWithDataDir(dataDir);
      const serviceModule = require("../src/server/virtualTrading/virtualTradingService.js");
      const candles = bullishCandles();
      const signal = serviceModule.buildVirtualSignal({
        stock: { code: "600000", name: "浦发银行", market: 1 },
        quote: { code: "600000", name: "浦发银行", price: candles.at(-1).close, pct: 2.1, market: 1 },
        candles,
        strategy: store.defaultVirtualStrategy()
      });
      assert.equal(signal.action, "buy");
      assert.ok(signal.score >= 68);
      assert.ok(signal.reasons.some((item) => /MACD|SAR|牛门线/.test(item)));
      assert.ok(signal.indicators.contributions.some((item) => item.label === "MACD"));
      assert.ok(signal.indicators.contributions.some((item) => item.label === "SAR"));
      assert.ok(signal.indicators.contributions.some((item) => item.label === "BOLL"));
      assert.ok(signal.indicators.contributions.some((item) => item.label === "牛门线"));

      const service = serviceModule.createVirtualTradingService({
        readVirtualTradingStore: store.readVirtualTradingStore,
        writeVirtualTradingStore: store.writeVirtualTradingStore,
        saveVirtualStockStrategies: store.saveVirtualStockStrategies,
        addVirtualTradingStock: store.addVirtualTradingStock,
        removeVirtualTradingStock: store.removeVirtualTradingStock,
        initVirtualTradingAccount: store.initVirtualTradingAccount,
        setVirtualTradingEnabled: store.setVirtualTradingEnabled,
        getQuote: async () => ({ code: "600000", name: "浦发银行", price: candles.at(-1).close, pct: 2.1, market: 1 }),
        getStockKline: async () => ({ klines: candles }),
        marketOf: () => 1
      });
      service.initAccount(100000);
      await service.addStock({ code: "600000", name: "浦发银行", market: 1 });
      const afterAdd = store.readVirtualTradingStore();
      assert.equal(afterAdd.stockStrategies.length, 1);
      assert.equal(afterAdd.stockStrategies[0].code, "600000");
      assert.match(afterAdd.stockStrategies[0].summary, /最近一年策略优化|策略优化/);
      assert.equal(Number.isFinite(Number(afterAdd.stockStrategies[0].strategy.buyThreshold)), true);
      assert.ok(afterAdd.watchlist[0].klines.length > 1);
      const result = await service.runCycle({ reason: "test", force: true });
      assert.equal(result.summary.initialized, true);
      assert.equal(result.positions.length, 1);
      assert.equal(result.trades.length, 1);
      assert.equal(result.trades[0].side, "buy");
      assert.ok(result.summary.cash < 100000);
      assert.ok(result.strategy.note);
      assert.ok(result.watchlist[0].klines.length > 1);
    } finally {
      delete process.env.GUANLAN_DATA_DIR;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("records realized PnL on sells and learns from win rate plus drawdown", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "guanlan-virtual-sell-"));
    try {
      const store = loadVirtualStoreWithDataDir(dataDir);
      const serviceModule = require("../src/server/virtualTrading/virtualTradingService.js");
      const up = bullishCandles();
      const down = bearishCandles();
      let phase = "up";
      const service = serviceModule.createVirtualTradingService({
        readVirtualTradingStore: store.readVirtualTradingStore,
        writeVirtualTradingStore: store.writeVirtualTradingStore,
        saveVirtualStockStrategies: store.saveVirtualStockStrategies,
        addVirtualTradingStock: store.addVirtualTradingStock,
        removeVirtualTradingStock: store.removeVirtualTradingStock,
        initVirtualTradingAccount: store.initVirtualTradingAccount,
        setVirtualTradingEnabled: store.setVirtualTradingEnabled,
        getQuote: async () => {
          const rows = phase === "up" ? up : down;
          return { code: "600000", name: "浦发银行", price: rows.at(-1).close, pct: phase === "up" ? 2 : -4, market: 1 };
        },
        getStockKline: async () => ({ klines: phase === "up" ? up : down }),
        marketOf: () => 1
      });
      service.initAccount(100000);
      await service.addStock({ code: "600000", name: "浦发银行", market: 1 });
      await service.runCycle({ reason: "buy", force: true, now: "2026-06-19T10:00:00.000+08:00" });
      phase = "down";
      const result = await service.runCycle({ reason: "sell", force: true, now: "2026-06-22T10:00:00.000+08:00" });
      assert.ok(result.trades.length >= 2);
      const sell = result.trades.find((item) => item.side === "sell");
      assert.ok(sell);
      assert.equal(Number.isFinite(Number(sell.realizedPnl)), true);
      assert.equal(Number.isFinite(Number(sell.realizedPnlPct)), true);
      assert.ok(result.strategy.stats.closedTrades >= 1);
      assert.equal(Number.isFinite(Number(result.strategy.stats.winRate)), true);
      assert.equal(Number.isFinite(Number(result.strategy.stats.maxDrawdownPct)), true);

      const defensive = serviceModule.learnFromVirtualResult(store.defaultVirtualStrategy(), {
        pnlPct: -5,
        trades: [
          { side: "sell", realizedPnl: -1200 },
          { side: "sell", realizedPnl: -800 },
          { side: "sell", realizedPnl: 200 }
        ],
        equityCurve: [
          { equity: 100000 },
          { equity: 96000 },
          { equity: 91000 }
        ],
        positions: []
      });
      assert.ok(defensive.buyThreshold > store.defaultVirtualStrategy().buyThreshold);
      assert.ok(defensive.maxSinglePositionPct < store.defaultVirtualStrategy().maxSinglePositionPct);
      assert.ok(defensive.stats.maxDrawdownPct < 0);
    } finally {
      delete process.env.GUANLAN_DATA_DIR;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("runs a date-range backtest without polluting live virtual trades", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "guanlan-virtual-backtest-"));
    try {
      const store = loadVirtualStoreWithDataDir(dataDir);
      const serviceModule = require("../src/server/virtualTrading/virtualTradingService.js");
      const rows = [
        ...bullishCandles(70).map((item, index) => ({ ...item, day: `2025-01-${String(index + 1).padStart(2, "0")}` })),
        ...bearishCandles(45).map((item, index) => ({ ...item, day: `2025-03-${String(index + 1).padStart(2, "0")}` }))
      ];
      let requestedCount = 0;
      const service = serviceModule.createVirtualTradingService({
        readVirtualTradingStore: store.readVirtualTradingStore,
        writeVirtualTradingStore: store.writeVirtualTradingStore,
        saveVirtualStockStrategies: store.saveVirtualStockStrategies,
        addVirtualTradingStock: store.addVirtualTradingStock,
        removeVirtualTradingStock: store.removeVirtualTradingStock,
        initVirtualTradingAccount: store.initVirtualTradingAccount,
        setVirtualTradingEnabled: store.setVirtualTradingEnabled,
        getQuote: async () => ({ code: "600000", name: "浦发银行", price: 10, pct: 0, market: 1 }),
        getStockKline: async (_code, _market, options = {}) => {
          requestedCount = Number(options.count || 0);
          return { klines: rows };
        },
        marketOf: () => 1,
        kimiStrategyAdvisor: async () => ({
          summary: "测试Kimi辅助：收益和回撤需要均衡。",
          preferredCandidate: "趋势突破增强",
          riskNote: "控制最大回撤。",
          suggestions: ["不要只追求收益率"]
        })
      });
      service.initAccount(120000);
      await service.addStock({ code: "600000", name: "浦发银行", market: 1 });
      const result = await service.runBacktest({ startDate: "2025-01-10", endDate: "2025-03-20" });
      assert.ok(requestedCount >= 260);
      assert.equal(result.backtest.startDate, "2025-01-10");
      assert.equal(result.backtest.endDate, "2025-03-20");
      assert.ok(result.backtest.equityCurve.length > 0);
      assert.ok(result.backtest.equityCurve.length > 26);
      assert.match(result.backtest.equityCurve[0].time, /T09:30:00\.000\+08:00$/);
      assert.ok(result.backtest.trades.length > 0);
      assert.equal(result.backtest.stockCharts.length, 1);
      assert.equal(result.backtest.stockCharts[0].stock.code, "600000");
      assert.ok(result.backtest.stockCharts[0].rows.length > 0);
      assert.ok(result.backtest.stockCharts[0].trades.length > 0);
      assert.equal(Number.isFinite(Number(result.backtest.stockCharts[0].trades[0].price)), true);
      assert.equal(Number.isFinite(Number(result.backtest.stockCharts[0].trades[0].qty)), true);
      assert.match(result.backtest.stockCharts[0].trades[0].time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000\+08:00$/);
      assert.equal(Number.isFinite(Number(result.backtest.stockCharts[0].contribution.amount)), true);
      assert.equal(Number.isFinite(Number(result.backtest.stockCharts[0].contribution.pct)), true);
      assert.equal(Number.isFinite(Number(result.backtest.stockCharts[0].contribution.realizedPnl)), true);
      assert.equal(Number.isFinite(Number(result.backtest.stockCharts[0].contribution.openPnl)), true);
      assert.ok(result.backtest.optimizationAdvice.summary);
      assert.ok(result.backtest.optimizationAdvice.proposedStrategy);
      assert.equal(result.backtest.optimizationAdvice.basis.aiAssist.used, true);
      assert.match(result.backtest.optimizationAdvice.basis.aiAssist.summary, /测试Kimi辅助/);
      assert.equal(result.backtest.stockStrategyAdvice.length, 1);
      assert.equal(result.backtest.stockStrategyAdvice[0].code, "600000");
      assert.ok(result.backtest.stockStrategyAdvice[0].summary);
      assert.ok(result.backtest.portfolioStrategyAdvice.summary);
      assert.equal(Number.isFinite(Number(result.backtest.portfolioStrategyAdvice.pnlPct)), true);
      assert.equal(Number.isFinite(Number(result.backtest.startingStrategy.macdWeight)), true);
      assert.equal(Number.isFinite(Number(result.backtest.startingStrategy.bullGateWeight)), true);
      assert.equal(result.backtest.optimizationApplied, false);
      const adopted = await service.runBacktest({ startDate: "2025-01-10", endDate: "2025-03-20", useOptimization: true });
      assert.equal(adopted.backtest.optimizationApplied, true);
      assert.equal(adopted.backtest.stockStrategyAdvice[0].code, "600000");
      const applied = service.applyBacktestStockStrategies();
      assert.equal(applied.appliedStockStrategies.length, 1);
      assert.equal(store.readVirtualTradingStore().stockStrategies[0].code, "600000");
      assert.equal(Number.isFinite(Number(store.readVirtualTradingStore().strategy.buyThreshold)), true);
      assert.ok(store.readVirtualTradingStore().strategy.note);
      const manual = service.saveStockStrategy({ code: "600000", name: "浦发银行", strategy: { buyThreshold: 70, macdWeight: 1.33 }, summary: "手工单股策略" });
      assert.equal(manual.appliedStockStrategies[0].code, "600000");
      assert.equal(store.readVirtualTradingStore().stockStrategies[0].strategy.buyThreshold, 70);
      assert.equal(store.readVirtualTradingStore().stockStrategies[0].strategy.macdWeight, 1.33);
      assert.equal(result.trades.length, 0);
      assert.equal(store.readVirtualTradingStore().lastBacktest.startDate, "2025-01-10");
    } finally {
      delete process.env.GUANLAN_DATA_DIR;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
