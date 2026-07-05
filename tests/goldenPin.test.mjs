import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { createGoldenPinService, previousTradingDay, latestTradingDay } = require("../src/server/goldenPin/goldenPinService.js");

function makeKline(day, open, close, high, low, volume = 1_000_000) {
  return {
    day,
    open,
    close,
    high,
    low,
    volume,
    amount: volume * close,
    amplitude: high > low ? ((high - low) / low) * 100 : 0,
    pct: 0,
    change: 0,
    turnover: 1.5
  };
}

function makeHistory(baseClose = 10, count = 60, trend = "down") {
  const history = [];
  let close = baseClose;
  for (let i = 0; i < count; i += 1) {
    const open = close;
    close = trend === "down" ? close * (1 - 0.005) : close * (1 + 0.002);
    const high = Math.max(open, close) * 1.01;
    const low = Math.min(open, close) * 0.99;
    history.push(makeKline(`2026-01-${String(i + 1).padStart(2, "0")}`, open, close, high, low));
  }
  return history;
}

describe("golden pin service", () => {
  it("computes full pattern score for a perfect pin", () => {
    const service = createGoldenPinService();
    const pin = { open: 10, close: 10.15, high: 10.2, low: 9.5 };
    const result = service.computePatternScore(pin);
    assert.equal(result.score, 40);
    assert.ok(result.details.lowerShadowBodyRatio >= 2);
    assert.ok(result.details.lowerShadowRangeRatio >= 0.7);
  });

  it("gives zero pattern score for a doji without lower shadow", () => {
    const service = createGoldenPinService();
    const pin = { open: 10, close: 10, high: 10.1, low: 9.9 };
    const result = service.computePatternScore(pin);
    assert.equal(result.score, 0);
  });

  it("filters out falling candlesticks", () => {
    const service = createGoldenPinService();
    const pin = { open: 10.2, close: 10, high: 10.2, low: 9.5 };
    const result = service.computePatternScore(pin);
    assert.equal(result.score, 0);
  });

  it("filters out pins whose body is too small relative to range", () => {
    const service = createGoldenPinService();
    // 长下影线但实体仅占振幅 5%，属于死线形态，不应入选。
    const pin = { open: 10, close: 10.03, high: 10.05, low: 9.4 };
    const result = service.computePatternScore(pin);
    assert.equal(result.score, 0);
  });

  it("filters out pins with long upper shadow", () => {
    const service = createGoldenPinService();
    // 长下影线但上影线占比 20%（>=10%），属于冲高回落，不应入选。
    const pin = { open: 10, close: 10.15, high: 10.3, low: 9.5 };
    const result = service.computePatternScore(pin);
    assert.equal(result.score, 0);
  });

  it("computes position score near 60-day low and below ma30", () => {
    const service = createGoldenPinService();
    const history = makeHistory(12, 60, "down");
    const pin = history.at(-1);
    pin.close = 9.0;
    pin.low = 8.8;
    pin.high = 9.2;
    pin.open = 9.1;
    const result = service.computePositionScore(pin, history);
    assert.ok(result.score > 15);
    assert.ok(result.details.lowScore > 5);
    assert.ok(result.details.belowMaScore > 0);
  });

  it("returns zero confirm score without confirm candle", () => {
    const service = createGoldenPinService();
    const result = service.computeConfirmScore(null, null, []);
    assert.equal(result.score, 0);
  });

  it("computes full confirm score with volume spike and bullish next day", () => {
    const service = createGoldenPinService();
    const history = makeHistory(10, 30, "down").map((item) => ({ ...item, volume: 1_000_000 }));
    const pin = { open: 10, close: 10.2, high: 10.3, low: 9.5, volume: 2_000_000 };
    const confirm = { open: 10.2, close: 10.5, low: 9.6, volume: 1_000_000 };
    const result = service.computeConfirmScore(pin, confirm, history);
    assert.equal(result.score, 30);
    assert.equal(result.details.tipHold, true);
    assert.equal(result.details.nextDayYang, true);
  });

  it("evaluates a stock above threshold", () => {
    const service = createGoldenPinService();
    const history = makeHistory(12, 60, "down");
    const pin = history.at(-2);
    pin.open = 10;
    pin.close = 10.1;
    pin.high = 10.15;
    pin.low = 9.4;
    pin.volume = 2_000_000;
    const confirm = history.at(-1);
    confirm.open = 10.1;
    confirm.close = 10.4;
    confirm.low = 9.5;
    const stock = { code: "000001", name: "平安银行", market: 0, price: 10.4, pct: 1.2, amount: 100_000_000, turnover: 1.5 };
    const result = service.evaluateStock(stock, history, pin.day);
    assert.ok(result);
    assert.ok(result.score >= 60);
    assert.ok(["trigger", "strong", "watch"].includes(result.signal));
    assert.equal(result.code, "000001");
    assert.equal(result.pinDay, pin.day);
    assert.equal(result.confirmDay, confirm.day);
  });

  it("filters out stocks below threshold", () => {
    const service = createGoldenPinService();
    const history = makeHistory(12, 60, "up");
    const pin = history.at(-2);
    pin.open = 10;
    pin.close = 10.1;
    pin.high = 10.15;
    pin.low = 9.9;
    pin.volume = 1_000_000;
    const confirm = history.at(-1);
    confirm.open = 10.1;
    confirm.close = 10.0;
    confirm.low = 9.8;
    const stock = { code: "000001", name: "平安银行", market: 0, price: 10, pct: 0, amount: 100_000_000, turnover: 1.5 };
    const result = service.evaluateStock(stock, history, pin.day);
    assert.equal(result, null);
  });

  it("evaluates latest trading day without confirm score", () => {
    const service = createGoldenPinService();
    const history = makeHistory(12, 60, "down");
    const pin = history.at(-1);
    pin.open = 10;
    pin.close = 10.1;
    pin.high = 10.15;
    pin.low = 9.4;
    pin.volume = 2_000_000;
    const stock = { code: "000001", name: "平安银行", market: 0, price: 10.1, pct: 1.2, amount: 100_000_000, turnover: 1.5 };
    const result = service.evaluateStock(stock, history, pin.day);
    assert.ok(result);
    assert.equal(result.hasConfirm, false);
    assert.equal(result.confirmScore, 0);
    assert.equal(result.confirmDay, "");
    assert.equal(result.confirmClose, null);
    assert.ok(result.score >= 45 && result.score <= 70);
    assert.ok(result.reason.includes("不引入确认分"));
  });

  it("filters out latest-day pins below no-confirm threshold", () => {
    const service = createGoldenPinService();
    const history = makeHistory(12, 60, "up");
    const pin = history.at(-1);
    pin.open = 10;
    pin.close = 10.05;
    pin.high = 10.1;
    pin.low = 9.9;
    pin.volume = 1_000_000;
    const stock = { code: "000001", name: "平安银行", market: 0, price: 10, pct: 0, amount: 100_000_000, turnover: 1.5 };
    const result = service.evaluateStock(stock, history, pin.day);
    assert.equal(result, null);
  });

  it("returns null when target date is not found in klines", () => {
    const service = createGoldenPinService();
    const history = makeHistory(12, 60, "down");
    const stock = { code: "000001", name: "平安银行", market: 0, price: 10, pct: 0, amount: 100_000_000, turnover: 1.5 };
    const result = service.evaluateStock(stock, history, "2025-12-01");
    assert.equal(result, null);
  });

  it("refreshGoldenPins returns cached result without force", async () => {
    const service = createGoldenPinService({
      getAllAshares: async () => [],
      getStockKline: async () => ({ klines: [] })
    });
    const date = "2026-02-05";
    await service.refreshGoldenPins({ force: true, date });
    const cache = service.getCache(date);
    cache.data = [{ code: "000001", score: 80 }];
    cache.refreshedAt = new Date().toISOString();
    const result = await service.refreshGoldenPins({ force: false, date });
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].code, "000001");
    assert.equal(result.date, date);
  });

  it("refreshGoldenPins scans and filters stocks", async () => {
    const stocks = [
      { code: "000001", name: "A", market: 0, amount: 100_000_000, price: 10, pct: 0, turnover: 1.5 },
      { code: "000002", name: "B", market: 0, amount: 5_000_000, price: 10, pct: 0, turnover: 1.5 }
    ];
    const history = makeHistory(12, 60, "down");
    const pin = history.at(-2);
    pin.open = 10;
    pin.close = 10.1;
    pin.high = 10.15;
    pin.low = 9.4;
    pin.volume = 2_000_000;
    const confirm = history.at(-1);
    confirm.open = 10.1;
    confirm.close = 10.4;
    confirm.low = 9.5;
    const service = createGoldenPinService({
      getAllAshares: async () => stocks,
      getStockKline: async () => ({ klines: history })
    });
    const result = await service.refreshGoldenPins({ force: true, date: pin.day });
    assert.equal(result.status, "ready");
    assert.ok(result.data.length > 0);
    assert.equal(result.scannedCount, 1);
    assert.equal(result.date, pin.day);
  });

  it("computes previous trading day skipping weekends and holidays", () => {
    assert.equal(previousTradingDay("2026-01-05"), "2025-12-31"); // Monday after New Year holiday
    assert.equal(previousTradingDay("2026-01-06"), "2026-01-05");
    assert.equal(previousTradingDay("2026-02-16"), "2026-02-13"); // Monday after CNY, previous is Friday
  });

  it("computes latest trading day", () => {
    assert.equal(latestTradingDay("2026-01-05"), "2026-01-05"); // Monday, trading day
    assert.equal(latestTradingDay("2026-01-03"), "2025-12-31"); // Saturday, fallback to previous trading day
    assert.equal(latestTradingDay("2026-02-16"), "2026-02-13"); // Monday holiday, fallback to previous trading day
  });
});
