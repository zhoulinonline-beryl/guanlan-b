import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const concentration = require("../src/server/indicators/concentration.js");

function makeStocks(count = 100, baseAmount = 1_000_000) {
  return Array.from({ length: count }, (_, index) => ({
    code: String(600000 + index).slice(-6),
    name: `股票${index + 1}`,
    market: 1,
    price: 10 + index,
    pct: index % 2 === 0 ? 1 : -1,
    change: index % 2 === 0 ? 0.1 : -0.1,
    amount: baseAmount * (count - index),
    volume: 1000,
    turnover: 1.5,
    industry: index < 30 ? "半导体" : index < 60 ? "新能源" : "银行"
  }));
}

describe("concentration calculation", () => {
  it("filters invalid stocks and sorts by amount", () => {
    const stocks = [
      { code: "600000", name: "A", amount: 500 },
      { code: "", name: "B", amount: 100 },
      { code: "300001", name: "C", amount: 300 },
      { code: "invalid", name: "D", amount: 200 }
    ];
    const prepared = concentration.prepareStocks(stocks);
    assert.equal(prepared.length, 2);
    assert.equal(prepared[0].code, "600000");
    assert.equal(prepared[1].code, "300001");
  });

  it("calculates top25, top1% and top5% concentration", () => {
    const stocks = makeStocks(100, 1_000_000);
    const result = concentration.calculateConcentration(stocks);
    assert.equal(result.sampleCount, 100);
    assert.ok(result.totalAmount > 0);
    assert.equal(result.top25.count, 25);
    assert.equal(result.top1pct.count, 1);
    assert.equal(result.top5pct.count, 5);
    assert.ok(result.top25.ratio > result.top1pct.ratio);
    assert.ok(result.top5pct.ratio >= result.top1pct.ratio);
    assert.equal(result.topStocks.length, 25);
  });

  it("handles empty input", () => {
    const result = concentration.calculateConcentration([]);
    assert.equal(result.sampleCount, 0);
    assert.equal(result.top25.ratio, 0);
    assert.equal(result.topStocks.length, 0);
  });

  it("builds industry distribution from top stocks", () => {
    const stocks = makeStocks(100, 1_000_000);
    const calc = concentration.calculateConcentration(stocks);
    const dist = concentration.buildIndustryDistribution(stocks, calc.topStocks);
    assert.ok(dist.length > 0);
    assert.ok(dist[0].amount > 0);
    assert.ok(dist[0].ratio > 0);
    assert.ok(dist.reduce((sum, item) => sum + item.ratio, 0) >= 99.9);
  });

  it("computes percentile rank", () => {
    assert.equal(concentration.percentileRank([1, 2, 3, 4, 5], 3), 60);
    assert.equal(concentration.percentileRank([1, 2, 3, 4, 5], 5), 100);
    assert.equal(concentration.percentileRank([], 3), null);
  });

  it("maps percentile to level", () => {
    assert.equal(concentration.levelFromPercentile(95).level, "极端集中");
    assert.equal(concentration.levelFromPercentile(80).level, "高位集中");
    assert.equal(concentration.levelFromPercentile(50).level, "正常区间");
    assert.equal(concentration.levelFromPercentile(15).level, "低位分散");
    assert.equal(concentration.levelFromPercentile(5).level, "极度分散");
  });

  it("attaches percentiles to dimensions", () => {
    const current = {
      top25: { ratio: 12 },
      top1pct: { ratio: 18 },
      top5pct: { ratio: 35 }
    };
    const history = [
      { dimensions: { top25: { ratio: 10 }, top1pct: { ratio: 15 }, top5pct: { ratio: 30 } } },
      { dimensions: { top25: { ratio: 14 }, top1pct: { ratio: 20 }, top5pct: { ratio: 40 } } }
    ];
    const result = concentration.attachPercentiles(current, history);
    assert.equal(result.top25.percentile, 50);
    assert.equal(result.top1pct.percentile, 50);
    assert.equal(result.top5pct.percentile, 50);
  });

  it("attaches day-over-day change to dimensions", () => {
    const current = {
      top25: { ratio: 12 },
      top1pct: { ratio: 18 },
      top5pct: { ratio: 35 }
    };
    const history = [
      { date: "2026-06-27", dimensions: { top25: { ratio: 10 }, top1pct: { ratio: 15 }, top5pct: { ratio: 30 } } },
      { date: "2026-06-28", dimensions: { top25: { ratio: 11 }, top1pct: { ratio: 16 }, top5pct: { ratio: 33 } } }
    ];
    const result = concentration.attachChanges(current, history, "2026-06-29");
    assert.equal(result.top25.change, 1);
    assert.equal(result.top1pct.change, 2);
    assert.equal(result.top5pct.change, 2);
    assert.equal(result.top25.prevRatio, 11);
  });

  it("skips same-day record when computing change", () => {
    const current = {
      top25: { ratio: 12 },
      top1pct: { ratio: 18 },
      top5pct: { ratio: 35 }
    };
    const history = [
      { date: "2026-06-27", dimensions: { top25: { ratio: 10 }, top1pct: { ratio: 15 }, top5pct: { ratio: 30 } } },
      { date: "2026-06-28", dimensions: { top25: { ratio: 11 }, top1pct: { ratio: 16 }, top5pct: { ratio: 33 } } }
    ];
    const result = concentration.attachChanges(current, history, "2026-06-28");
    assert.equal(result.top25.change, 2);
    assert.equal(result.top25.prevRatio, 10);
  });

  it("returns null change when no previous history exists", () => {
    const current = {
      top25: { ratio: 12 },
      top1pct: { ratio: 18 },
      top5pct: { ratio: 35 }
    };
    const result = concentration.attachChanges(current, [], "2026-06-28");
    assert.equal(result.top25.change, null);
    assert.equal(result.top25.prevRatio, null);
  });

  it("generates possibilities from high concentration", () => {
    const dims = {
      top25: { ratio: 15, percentile: 80, level: "高位集中" },
      top1pct: { ratio: 22, percentile: 90, level: "极端集中" },
      top5pct: { ratio: 40, percentile: 95, level: "极端集中" }
    };
    const history = Array.from({ length: 10 }, (_, i) => ({
      dimensions: { top5pct: { ratio: 30 + i } }
    }));
    const possibilities = concentration.buildPossibilities(dims, history, [{ name: "上证指数", pct: 1.2 }]);
    assert.ok(possibilities.length >= 1);
  });
});

