import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const numbers = require("../src/server/utils/number.js");
const security = require("../src/server/utils/security.js");
const symbols = require("../src/server/market/symbols.js");
const indicators = require("../src/server/market/indicators.js");

function candlesFromCloses(closes, { volume = 1000, bullish = true } = {}) {
  return closes.map((close, index) => {
    const open = bullish ? close - 0.2 : close + 0.2;
    return {
      open,
      close,
      high: Math.max(open, close) + 0.8,
      low: Math.min(open, close) - 0.8,
      volume: volume + index * 10
    };
  });
}

describe("number utilities", () => {
  it("normalizes numbers with explicit fallback", () => {
    assert.equal(numbers.toNumber("12.5"), 12.5);
    assert.equal(numbers.toNumber("bad", 7), 7);
    assert.equal(numbers.toNumber(undefined), null);
  });

  it("averages only finite values", () => {
    assert.equal(numbers.average([1, "2", Number.NaN, "x", 3]), 2);
    assert.equal(numbers.average(["x", null, undefined]), 0);
    assert.equal(numbers.average([]), null);
  });

  it("rounds and splits A-share board lots", () => {
    assert.equal(numbers.roundLot(99), 0);
    assert.equal(numbers.roundLot(260), 200);
    assert.deepEqual(numbers.splitLots(80), [0, 0]);
    assert.deepEqual(numbers.splitLots(500, 0.4), [200, 300]);
    assert.deepEqual(numbers.splitLots(100, 0.5), [100, 0]);
  });

  it("formats money and fixed text defensively", () => {
    assert.equal(numbers.moneyText("bad"), "--");
    assert.equal(numbers.formatNumber(1234567.891, 2), "1,234,567.89");
    assert.equal(numbers.moneyText(9999), "9,999");
    assert.equal(numbers.moneyText(12345), "1.2万");
    assert.equal(numbers.moneyText(234567890), "2.35亿");
    assert.equal(numbers.moneyText(-20000), "-2.0万");
    assert.equal(numbers.toFixedText(1.2345, 3), "1.234");
    assert.equal(numbers.toFixedText(12345.678, 2), "12,345.68");
    assert.equal(numbers.toFixedText("bad"), "--");
  });
});

describe("security utilities", () => {
  it("masks secrets by length", () => {
    assert.equal(security.maskSecret(""), "");
    assert.equal(security.maskSecret("short"), "********");
    assert.equal(security.maskSecret("sk-1234567890abcdef"), "sk-1****cdef");
  });

  it("redacts api keys and bearer tokens from logs", () => {
    const redacted = security.redactLogText("key sk-abcDEF_123456789 token Bearer abc.def-ghi");
    assert.equal(redacted, "key sk-*** token Bearer ***");
    assert.equal(security.redactLogText("x".repeat(2100)).length, 2000);
    assert.equal(security.redactLogText(), "");
  });
});

describe("symbol utilities", () => {
  it("maps A-share codes to markets and symbols", () => {
    assert.equal(symbols.marketOf("600000"), 1);
    assert.equal(symbols.marketOf("688001"), 1);
    assert.equal(symbols.marketOf("830000"), 0);
    assert.equal(symbols.marketOf("300001"), 0);
    assert.equal(symbols.symbolOf("600000"), "sh600000");
    assert.equal(symbols.symbolOf("300001"), "sz300001");
    assert.equal(symbols.symbolOf("bj430001"), "bj430001");
    assert.equal(symbols.symbolOf("sh600519"), "sh600519");
    assert.equal(symbols.symbolOf("sz000001"), "sz000001");
    assert.equal(symbols.symbolOf("000001", 1), "sh000001");
  });

  it("builds Eastmoney secids", () => {
    assert.equal(symbols.eastmoneySecidFromSymbol("sh600000"), "1.600000");
    assert.equal(symbols.eastmoneySecidFromSymbol("sz000001"), "0.000001");
    assert.equal(symbols.eastmoneySecidFromSymbol("bj430001"), "0.430001");
  });
});

describe("technical indicators", () => {
  it("scores trend with price, volume, flow, and bounds", () => {
    const longRows = candlesFromCloses(Array.from({ length: 40 }, (_, index) => 10 + index * 0.2));
    assert.ok(indicators.trendScore(longRows, 0, 300_000_000, 10) > 70);
    const empty = indicators.trendScore([], -50, -900_000_000, 0);
    assert.equal(empty, 5);
    assert.ok(indicators.trendScore([]) > 0);
    const capped = indicators.trendScore(longRows, 30, 9_000_000_000, 100);
    assert.equal(capped, 99);
  });

  it("calculates EMA, MACD, and SAR including edge cases", () => {
    assert.deepEqual(indicators.emaValues([10, 12], 3), [10, 11]);
    assert.deepEqual(indicators.macdForServer([]), { dif: [], dea: [], hist: [] });
    const macd = indicators.macdForServer(candlesFromCloses([10, 11, 12]));
    assert.equal(macd.dif.length, 3);
    assert.equal(macd.dea.length, 3);
    assert.equal(macd.hist.length, 3);
    assert.deepEqual(indicators.sarForServer([]), []);
    const sar = indicators.sarForServer([
      { high: 10, low: 8 },
      { high: Number.NaN, low: 7 },
      { high: 11, low: 9 },
      { high: 7, low: 5 },
      { high: 12, low: 6 },
      { high: 6, low: 4 }
    ]);
    assert.equal(sar.length, 6);
    assert.ok(sar.every((value) => Number.isFinite(value)));
  });

  it("scores technical opportunity for insufficient, bullish, weak, and neutral setups", () => {
    assert.deepEqual(indicators.technicalOpportunityScore([]), {
      score: -4,
      macdLabel: "MACD数据不足",
      sarLabel: "SAR数据不足",
      details: ["K线长度不足，MACD/SAR 不参与加分。"]
    });

    const bullish = candlesFromCloses(Array.from({ length: 40 }, (_, index) => 10 + index * 0.35));
    const bullishScore = indicators.technicalOpportunityScore(bullish);
    assert.ok(bullishScore.score > 0);
    assert.match(bullishScore.macdLabel, /MACD/);
    assert.match(bullishScore.sarLabel, /SAR/);
    assert.ok(bullishScore.details.length >= 2);

    const slowBullish = candlesFromCloses(Array.from({ length: 40 }, (_, index) => 10 + index * 0.04));
    assert.equal(indicators.technicalOpportunityScore(slowBullish).sarLabel, "SAR翻多");

    const goldenCross = candlesFromCloses(Array.from({ length: 40 }, (_, index) => 10 + Math.sin(index / 2) * 2));
    assert.ok(indicators.technicalOpportunityScore(goldenCross).details.includes("MACD 最近金叉，额外加分。"));

    const farAboveSar = candlesFromCloses(Array.from({ length: 40 }, (_, index) => (index < 39 ? 10 + index * 0.1 : 30)));
    assert.ok(indicators.technicalOpportunityScore(farAboveSar).score <= 19);

    const weak = candlesFromCloses(Array.from({ length: 40 }, (_, index) => 30 - index * 0.35), { bullish: false });
    const weakScore = indicators.technicalOpportunityScore(weak);
    assert.ok(weakScore.score < 0);
    assert.equal(weakScore.macdLabel, "MACD空头");
    assert.ok(["SAR趋势压制", "SAR多头保护", "SAR翻多"].includes(weakScore.sarLabel));

    const neutral = candlesFromCloses(Array.from({ length: 40 }, (_, index) => 10 + Math.sin(index) * 0.08));
    const neutralScore = indicators.technicalOpportunityScore(neutral);
    assert.ok(Number.isFinite(neutralScore.score));
    assert.ok(neutralScore.details.length >= 2);

    const flat = candlesFromCloses(Array.from({ length: 40 }, () => 10));
    const flatScore = indicators.technicalOpportunityScore(flat);
    assert.equal(flatScore.macdLabel, "MACD待确认");
    assert.ok(flatScore.details.includes("MACD 尚未形成明确多头共振。"));

    const zeroSar = Array.from({ length: 40 }, () => ({ open: 0, close: 0, high: 0, low: 0, volume: 0 }));
    assert.equal(indicators.technicalOpportunityScore(zeroSar).sarLabel, "SAR趋势压制");
  });
});
