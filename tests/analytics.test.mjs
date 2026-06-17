import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boll, ema, ma, macd, sar, sectorReasons, stockAdvice } from "../src/analytics.js";

function candles(closes, options = {}) {
  const {
    volume = 1000,
    highPad = 0.8,
    lowPad = 0.8,
    bullish = true,
    volumeStep = 10
  } = options;
  return closes.map((close, index) => {
    const open = bullish ? close - 0.2 : close + 0.2;
    return {
      day: `D-${index}`,
      open,
      close,
      high: Math.max(open, close) + highPad,
      low: Math.min(open, close) - lowPad,
      volume: volume + index * volumeStep
    };
  });
}

describe("browser analytics indicators", () => {
  it("calculates EMA, MACD, BOLL, MA, and SAR", () => {
    assert.deepEqual(ema([10, 12], 3), [10, 11]);
    const rows = candles([10, 11, 12, 11, 13]);
    assert.equal(macd(rows).hist.length, rows.length);
    const bollRows = boll(rows, 3);
    assert.equal(bollRows.length, rows.length);
    assert.ok(bollRows.at(-1).upper > bollRows.at(-1).mid);
    assert.deepEqual(ma(rows, 2).slice(0, 3), [10, 10.5, 11.5]);
    assert.equal(sar(rows).length, rows.length);
  });

  it("handles SAR reversals in both directions", () => {
    const rows = [
      { high: 10, low: 8, close: 9, open: 8.8 },
      { high: 11, low: 9, close: 10, open: 9.8 },
      { high: 7, low: 5, close: 6, open: 6.8 },
      { high: 12, low: 6, close: 11, open: 10.8 },
      { high: 6, low: 4, close: 5, open: 5.8 }
    ];
    const values = sar(rows);
    assert.equal(values.length, rows.length);
    assert.ok(values.every(Number.isFinite));
  });
});

describe("sector reasons", () => {
  it("explains sectors with main money data and hot stocks", () => {
    const reasons = sectorReasons({
      attackScore: 88,
      amount: 1_200_000_000,
      mainNet: 230_000_000,
      upCount: 12,
      downCount: 3,
      stocks: [
        { name: "龙头股份", pct: 2, mainFlow: 6, score: 90 },
        { name: "跟涨股份", pct: 1.8, mainFlow: 8, score: 80 }
      ]
    });
    assert.equal(reasons.length, 4);
    assert.match(reasons[1], /主力净额/);
    assert.match(reasons[2], /龙头股份/);
  });

  it("falls back when sector money and stock ladder are missing", () => {
    const reasons = sectorReasons({
      attackScore: "bad",
      amount: "bad",
      mainNet: null,
      upCount: 0,
      downCount: 5,
      stocks: []
    });
    assert.match(reasons[0], /0.0 亿/);
    assert.match(reasons[1], /未提供主力净额/);
    assert.match(reasons[2], /尚未加载/);

    const sparse = sectorReasons({ attackScore: 1, amount: 0, mainNet: "bad" });
    assert.match(sparse[1], /0 涨 \/ 0 跌/);
  });
});

describe("stock advice", () => {
  it("returns a loading state when candles are absent", () => {
    const advice = stockAdvice({ name: "测试股份" });
    assert.equal(advice.action, "等待数据");
    assert.equal(advice.checks.length, 4);
    assert.deepEqual(advice.macd, { dif: [], dea: [], hist: [] });
  });

  it("gives a trial-buy plan for confirmed but not overextended strength", () => {
    const rows = candles(Array.from({ length: 45 }, (_, index) => 10 + index * 0.08), { volumeStep: 30 });
    const advice = stockAdvice({ name: "慢牛股份", candles: rows });
    assert.equal(advice.action, "偏多试仓");
    assert.match(advice.explanation.scoreLabel, /技术条件共振/);
    assert.ok(advice.levels.stopLoss < advice.latest.close);
    assert.ok(advice.explanation.playbook.length >= 4);
  });

  it("gives a strong-hold plan after an upper-band breakout", () => {
    const rows = candles(Array.from({ length: 44 }, (_, index) => 10 + index * 0.05).concat(20), { volumeStep: 50 });
    const advice = stockAdvice({ name: "突破股份", candles: rows });
    assert.equal(advice.action, "强势持有");
    assert.match(advice.summary, /突破上轨/);
    assert.match(advice.risk, /BOLL 上轨/);
  });

  it("reduces exposure for weak technical setups", () => {
    const rows = candles(Array.from({ length: 45 }, (_, index) => 30 - index * 0.25), { bullish: false, volumeStep: -5 });
    const advice = stockAdvice({ name: "走弱股份", candles: rows });
    assert.equal(advice.action, "降低仓位");
    assert.match(advice.summary, /动能一般/);
    assert.match(advice.explanation.diagnostics.join("\n"), /量能/);
  });

  it("explains lower-band breaks and zero-volume fallbacks", () => {
    const rows = candles(Array.from({ length: 44 }, () => 10).concat(5), { bullish: false });
    const advice = stockAdvice({ name: "破位股份", candles: rows });
    assert.match(advice.summary, /跌破下轨/);

    const zeroRows = Array.from({ length: 45 }, (_, index) => ({
      day: `Z-${index}`,
      open: 0,
      close: 0,
      high: 0,
      low: 0
    }));
    const zeroAdvice = stockAdvice({ name: "零量股份", candles: zeroRows });
    assert.match(zeroAdvice.explanation.diagnostics.join("\n"), /1.00 倍/);
    assert.equal(zeroAdvice.latest.ma20, 0);
  });

  it("marks volume as strong or weak against the recent baseline", () => {
    const highVolume = candles(Array.from({ length: 45 }, (_, index) => 10 + index * 0.04), { volumeStep: 0 });
    highVolume.forEach((item, index) => {
      item.volume = index >= 40 ? 3000 : 1000;
    });
    assert.match(stockAdvice({ name: "放量股份", candles: highVolume }).explanation.diagnostics.join("\n"), /量能支持度较好/);

    const lowVolume = candles(Array.from({ length: 45 }, (_, index) => 10 + index * 0.04), { volumeStep: 0 });
    lowVolume.forEach((item, index) => {
      item.volume = index >= 40 ? 100 : 1000;
    });
    assert.match(stockAdvice({ name: "缩量股份", candles: lowVolume }).explanation.diagnostics.join("\n"), /量能偏弱/);
  });

  it("keeps observation when only part of the setup confirms", () => {
    const rows = candles(Array.from({ length: 45 }, (_, index) => 10 - 0.4 * index / 45 + Math.sin(index / 0.1) * 0.5), { volumeStep: 0 });
    const advice = stockAdvice({ name: "震荡股份", candles: rows });
    assert.equal(advice.action, "观察");
    assert.match(advice.plan, /等待价格/);
    assert.ok(["中轨上方", "中轨下方", "突破上轨", "跌破下轨"].some((text) => advice.summary.includes(text)));
  });
});
